import express from "express";
import YTMusic from "ytmusic-api";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.join(__dirname, "static");
const PORT = process.env.PORT || 8000;
const CACHE_TTL = 10 * 60 * 1000;
const TREND_TTL = 30 * 60 * 1000;

const SECTIONS = [
  ["Trending now", "trending songs 2026"],
  ["Bollywood hits", "latest bollywood songs 2026"],
  ["Punjabi picks", "new punjabi songs 2026"],
  ["Global top songs", "top english songs 2026"],
  ["Chill and lo-fi", "lofi chill songs"],
];

const app = express();
const ytmusic = new YTMusic();
const ready = ytmusic.initialize();
const cache = new Map();
let trendCache = null;

function fmt(sec) {
  if (!Number.isFinite(sec)) return null;
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

function normalize(s) {
  if (!s.videoId) return null;
  const thumbs = s.thumbnails || [];
  return {
    id: s.videoId,
    title: s.name || "Untitled",
    artist: s.artist?.name || "Unknown artist",
    album: s.album?.name ?? null,
    duration: fmt(s.duration),
    seconds: s.duration ?? null,
    thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : null,
  };
}

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q || q.length > 100) {
    return res.status(422).json({ detail: "Enter a search between 1 and 100 characters." });
  }
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return res.json(hit.data);
  try {
    await ready;
    const songs = await ytmusic.searchSongs(q);
    const data = songs.map(normalize).filter(Boolean).slice(0, 20);
    cache.set(key, { at: Date.now(), data });
    res.json(data);
  } catch (err) {
    res.status(502).json({ detail: `Search failed: ${err.message}` });
  }
});

app.get("/api/trending", async (_req, res) => {
  if (trendCache && Date.now() - trendCache.at < TREND_TTL) return res.json(trendCache.data);
  try {
    await ready;
    const settled = await Promise.allSettled(SECTIONS.map(([, q]) => ytmusic.searchSongs(q)));
    const data = settled
      .map((r, i) => ({
        title: SECTIONS[i][0],
        tracks: r.status === "fulfilled"
          ? r.value.map(normalize).filter(Boolean).slice(0, i === 0 ? 10 : 15)
          : [],
      }))
      .filter((s) => s.tracks.length);
    if (!data.length) throw new Error("No sections could be loaded");
    trendCache = { at: Date.now(), data };
    res.json(data);
  } catch (err) {
    res.status(502).json({ detail: err.message });
  }
});

app.use("/static", express.static(STATIC_DIR));
app.get("/", (_req, res) => res.sendFile(path.join(STATIC_DIR, "index.html")));

app.listen(PORT, () => console.log(`Player running at http://localhost:${PORT}`));