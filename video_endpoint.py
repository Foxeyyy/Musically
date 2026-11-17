# Add this to your FastAPI server (same file where /api/stream lives).
# pip install yt-dlp httpx
import asyncio, re, time
import httpx, yt_dlp
from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse

_VCACHE = {}  # video id -> (expires, url, headers)

def _resolve_video(vid: str):
    opts = {
        "quiet": True, "no_warnings": True, "noplaylist": True,
        # small muted-friendly video only (360p max) so it stays light
        "format": "bestvideo[height<=360][ext=mp4]/bestvideo[height<=360]/worst[ext=mp4]/worst",
    }
    with yt_dlp.YoutubeDL(opts) as y:
        info = y.extract_info("https://www.youtube.com/watch?v=" + vid, download=False)
    return info["url"], info.get("http_headers", {})

@app.get("/api/video/{vid}")   # <- use your own FastAPI instance name if not `app`
async def video(vid: str, request: Request):
    if not re.fullmatch(r"[\w-]{6,20}", vid):
        raise HTTPException(400, "bad id")
    hit = _VCACHE.get(vid)
    if not hit or hit[0] < time.time():
        try:
            url, hdrs = await asyncio.to_thread(_resolve_video, vid)
        except Exception:
            raise HTTPException(404, "no video")
        if len(_VCACHE) > 200:
            _VCACHE.clear()
        hit = (time.time() + 3 * 3600, url, hdrs)
        _VCACHE[vid] = hit
    _, url, hdrs = hit
    h = dict(hdrs)
    if "range" in request.headers:
        h["Range"] = request.headers["range"]
    client = httpx.AsyncClient(timeout=30, follow_redirects=True)
    r = await client.send(client.build_request("GET", url, headers=h), stream=True)
    out = {k: r.headers[k] for k in ("content-type", "content-length", "content-range", "accept-ranges") if k in r.headers}

    async def body():
        try:
            async for chunk in r.aiter_raw():
                yield chunk
        finally:
            await r.aclose()
            await client.aclose()

    return StreamingResponse(body(), status_code=r.status_code, headers=out)

