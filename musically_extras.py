"""Backend extras for Musically: listen-together WebSocket + optional image proxy.

Usage in your FastAPI app:

    from musically_extras import add_routes
    add_routes(app)

Needs:  pip install websockets httpx
"""
import json
import time
from urllib.parse import urlparse

from fastapi import HTTPException, Response, WebSocket, WebSocketDisconnect

# Image proxy only fetches from these hosts (prevents an open proxy).
# Add whatever host your thumbnails come from.
ALLOWED_IMG_HOSTS = ("ytimg.com", "googleusercontent.com", "ggpht.com")


def add_routes(app):
    rooms = {}  # code -> {"peers": set(ws), "last": {"track": msg, "tr": msg}}

    @app.websocket("/ws/{code}")
    async def ws_room(ws: WebSocket, code: str):
        await ws.accept()
        room = rooms.setdefault(code, {"peers": set(), "last": {}})
        room["peers"].add(ws)

        # Tell the joiner whether the room already has state.
        await ws.send_text(json.dumps({"type": "hello", "empty": not room["last"]}))
        for key in ("track", "tr"):
            m = room["last"].get(key)
            if not m:
                continue
            m = dict(m)
            if m["type"] == "play":  # compensate for time elapsed since it was sent
                m["t"] += time.time() - m["srv"]
            await ws.send_text(json.dumps(m))

        try:
            while True:
                m = json.loads(await ws.receive_text())
                m["srv"] = time.time()
                if m.get("type") == "track":
                    room["last"] = {"track": m}  # new track resets play/pause state
                elif m.get("type") in ("play", "pause"):
                    room["last"]["tr"] = m
                for p in list(room["peers"]):
                    if p is ws:
                        continue
                    try:
                        await p.send_text(json.dumps(m))
                    except Exception:
                        room["peers"].discard(p)
        except WebSocketDisconnect:
            pass
        finally:
            room["peers"].discard(ws)
            if not room["peers"]:
                rooms.pop(code, None)

    @app.get("/api/img")
    async def img_proxy(url: str):
        """Lets the share-card canvas load album art that has no CORS headers."""
        import httpx

        u = urlparse(url)
        host = u.hostname or ""
        if u.scheme != "https" or not any(host == d or host.endswith("." + d) for d in ALLOWED_IMG_HOSTS):
            raise HTTPException(status_code=400, detail="host not allowed")
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(url)
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail="image fetch failed")
        return Response(
            r.content,
            media_type=r.headers.get("content-type", "image/jpeg"),
            headers={"Cache-Control": "public, max-age=86400"},
        )

