
import "dotenv/config";
import express from "express";
import YTMusic from "ytmusic-api";
import path from "node:path";
import { fileURLToPath } from "node:url";

import stream from "./stream.js";
import video from "./video.js";
import lyrics from "./lyrics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.join(__dirname, "static");

const PORT = Number(process.env.PORT) || 8000;

const CACHE_TTL = 10 * 60 * 1000;
const TREND_TTL = 30 * 60 * 1000;
const SUGGEST_TTL = 5 * 60 * 1000;
const MAX_CACHE = 500;

const SECTIONS = [
  ["Trending now", "trending songs 2026"],
  ["Bollywood hits", "latest bollywood songs 2026"],
  ["Punjabi picks", "new punjabi songs 2026"],
  ["Global top songs", "top english songs 2026"],
  ["Chill and lo-fi", "lofi chill songs"],
];

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

// --------------------------------
// YOUTUBE MUSIC INITIALIZATION
// --------------------------------

const ytmusic = new YTMusic();

let musicReady = false;
let musicError = null;

const ready = ytmusic.initialize()
  .then(() => {
    musicReady = true;
    musicError = null;
    console.log("YouTube Music initialized successfully");
  })
  .catch(err => {
    musicError = err;
    console.error("YouTube Music initialization failed:", err.message);
    throw err;
  });

// Prevent an unhandled rejection before the first API request.
ready.catch(() => {});

async function ensureReady() {
  await ready;
}

// --------------------------------
// CACHING
// --------------------------------

const cache = new Map();
const sugCache = new Map();

const inFlight = new Map();

let trendCache = null;
let trendPromise = null;

function getCache(map, key, ttl) {
  const item = map.get(key);

  if (!item) return null;

  if (Date.now() - item.at > ttl) {
    map.delete(key);
    return null;
  }

  return item.data;
}

function setCache(map, key, data, max = MAX_CACHE) {
  if (map.has(key)) {
    map.delete(key);
  }

  if (map.size >= max) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }

  map.set(key, {
    at: Date.now(),
    data
  });
}

async function cachedRequest(map, key, ttl, task) {
  const hit = getCache(map, key, ttl);

  if (hit !== null) {
    return hit;
  }

  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const promise = Promise.resolve()
    .then(task)
    .then(data => {
      setCache(map, key, data);
      return data;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);

  return promise;
}

// --------------------------------
// DISCORD LOGGING
// --------------------------------

function discordLog(title, description) {
  const webhook = process.env.DISCORD_WEBHOOK;

  if (!webhook) return;

  Promise.resolve()
    .then(() => fetch(webhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        embeds: [{
          title,
          description,
          color: 0x8b5cf6,
          timestamp: new Date().toISOString()
        }]
      }),
      signal: AbortSignal.timeout(5000)
    }))
    .then(response => {
      if (!response.ok) {
        console.error("Discord webhook returned:", response.status);
      }
    })
    .catch(err => {
      console.error("Discord webhook error:", err.message);
    });
}

// --------------------------------
// HELPERS
// --------------------------------

function fmt(sec) {
  if (!Number.isFinite(sec)) return null;

  return `${Math.floor(sec / 60)}:${String(
    Math.floor(sec % 60)
  ).padStart(2, "0")}`;
}

function resize(url, n) {
  if (!url || !/googleusercontent|ggpht/.test(url)) {
    return url || null;
  }

  return url
    .replace(/=w\d+-h\d+/, `=w${n}-h${n}`)
    .replace(/=s\d+/, `=s${n}`);
}

function normalize(s) {
  if (!s?.videoId) return null;

  const thumbs = s.thumbnails || [];

  const src = thumbs.length
    ? thumbs[thumbs.length - 1].url
    : null;

  return {
    id: s.videoId,
    title: s.name || "Untitled",
    artist:
      s.artist?.name ||
      (typeof s.artist === "string" ? s.artist : null) ||
      "Unknown artist",
    album: s.album?.name ?? null,
    duration: fmt(s.duration),
    seconds: s.duration ?? null,
    thumbnail: resize(src, 360),
    cover: resize(src, 800)
  };
}

function cleanQuery(value, max = 100) {
  return String(value || "").trim().slice(0, max);
}

// --------------------------------
// HEALTH API
// --------------------------------

app.get("/api/health", (_req, res) => {
  res.json({
    status: "online",
    musicReady,
    musicError: musicError?.message || null,
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage().rss,
    timestamp: new Date().toISOString()
  });
});

// --------------------------------
// SEARCH API
// --------------------------------

app.get("/api/search", async (req, res) => {
  const q = cleanQuery(req.query.q);

  if (!q) {
    return res.status(422).json({
      detail: "Search query is required."
    });
  }

  const key = q.toLowerCase();

  try {
    const data = await cachedRequest(
      cache,
      `search:${key}`,
      CACHE_TTL,
      async () => {
        await ensureReady();

        const songs = await ytmusic.searchSongs(q);

        return songs
          .map(normalize)
          .filter(Boolean)
          .slice(0, 20);
      }
    );

    res.json(data);

  } catch (err) {
    console.error("Search error:", err.message);

    discordLog(
      "Musically Search Error",
      err.message
    );

    res.status(502).json({
      detail: "Search service temporarily unavailable."
    });
  }
});

// --------------------------------
// SPOTIFY-STYLE SEARCH SUGGESTIONS
// --------------------------------

app.get("/api/suggest", async (req, res) => {
  const q = cleanQuery(req.query.q, 80);

  if (!q || q.length < 1) {
    return res.json([]);
  }

  const key = q.toLowerCase();

  try {
    const suggestions = await cachedRequest(
      sugCache,
      `suggest:${key}`,
      SUGGEST_TTL,
      async () => {
        await ensureReady();

        const result = await ytmusic.getSearchSuggestions(q);

        return (Array.isArray(result) ? result : [])
          .map(item => {
            if (typeof item === "string") return item;
            return item?.text || item?.query || item?.name || "";
          })
          .filter(Boolean)
          .filter((value, index, array) =>
            array.indexOf(value) === index
          )
          .slice(0, 8);
      }
    );

    res.json(suggestions);

  } catch (err) {
    console.error("Suggestion error:", err.message);
    res.json([]);
  }
});

// --------------------------------
// TRENDING REFRESH
// --------------------------------

async function refreshTrending() {
  if (trendPromise) return trendPromise;

  trendPromise = (async () => {
    await ensureReady();

    const settled = await Promise.allSettled(
      SECTIONS.map(([, q]) => ytmusic.searchSongs(q))
    );

    const data = settled
      .map((result, index) => ({
        title: SECTIONS[index][0],
        tracks:
          result.status === "fulfilled"
            ? result.value
                .map(normalize)
                .filter(Boolean)
                .slice(0, index === 0 ? 10 : 15)
            : []
      }))
      .filter(section => section.tracks.length);

    if (!data.length) {
      throw new Error("No trending sections available.");
    }

    trendCache = {
      at: Date.now(),
      data
    };

    return data;
  })().finally(() => {
    trendPromise = null;
  });

  return trendPromise;
}

// --------------------------------
// TRENDING API
// --------------------------------

app.get("/api/trending", async (_req, res) => {
  if (
    trendCache &&
    Date.now() - trendCache.at < TREND_TTL
  ) {
    return res.json(trendCache.data);
  }

  // Serve stale data immediately while refreshing.
  if (trendCache) {
    res.json(trendCache.data);

    refreshTrending().catch(err => {
      console.error("Trending refresh failed:", err.message);
    });

    return;
  }

  try {
    const data = await refreshTrending();
    res.json(data);

  } catch (err) {
    console.error("Trending error:", err.message);

    discordLog(
      "Musically Trending Error",
      err.message
    );

    res.status(502).json({
      detail: "Trending songs are temporarily unavailable."
    });
  }
});

// --------------------------------
// STREAM API
// --------------------------------

app.get("/api/stream/:id", async (req, res, next) => {
  const id = cleanQuery(req.params.id, 100);

  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return res.status(400).json({
      detail: "Invalid video ID."
    });
  }

  res.once("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      discordLog(
        "Musically Stream Delivered",
        `Video ID: ${id}\nStatus: ${res.statusCode}`
      );
    }
  });

  try {
    await stream(req, res, next);
  } catch (err) {
    console.error("Stream error:", err.message);

    discordLog(
      "Musically Stream Error",
      err.message
    );

    if (!res.headersSent) {
      next(err);
    } else {
      res.destroy(err);
    }
  }
});

// --------------------------------
// VIDEO API
// --------------------------------

app.get("/api/video/:id", video);

// --------------------------------
// LYRICS API
// --------------------------------

app.get("/api/lyrics", lyrics);

// --------------------------------
// STATIC FILES
// --------------------------------

app.use(
  "/static",
  express.static(STATIC_DIR, {
    maxAge: "1d",
    etag: true,
    lastModified: true
  })
);

// --------------------------------
// HOME PAGE
// --------------------------------

app.get("/", (_req, res, next) => {
  res.sendFile(
    path.join(STATIC_DIR, "index.html"),
    err => {
      if (err) next(err);
    }
  );
});

// --------------------------------
// 404
// --------------------------------

app.use((req, res) => {
  res.status(404).json({
    detail: "Route not found"
  });
});

// --------------------------------
// ERROR HANDLER
// --------------------------------

app.use((err, req, res, next) => {
  console.error("Backend error:", err);

  discordLog(
    "Musically Backend Error",
    `Route: ${req.originalUrl}\nError: ${err.message}`
  );

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    detail: "Internal server error"
  });
});

// --------------------------------
// START SERVER
// --------------------------------

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("🎵 Musically Backend Started");
  console.log(`🌐 http://localhost:${PORT}`);
  console.log(`📡 Health: http://localhost:${PORT}/api/health`);
  console.log("");

  discordLog(
    "Musically Server Online",
    `Backend started on port ${PORT}`
  );
});

// Graceful shutdown
function shutdown() {
  console.log("Shutting down Musically...");

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

