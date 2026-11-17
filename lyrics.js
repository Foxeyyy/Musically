
const TTL = 24 * 60 * 60 * 1000;
const MAX_CACHE = 500;
const UA = "Musically/1.0 (music player)";

const cache = new Map();

const clean = (s) =>
  s
    .replace(/\s*[(\[].*?[)\]]/g, "")
    .replace(/\s+-\s+(from|remaster|remastered|live|version|feat).*$/i, "")
    .trim();

async function getJson(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(8000),
  });

  if (!r.ok) return null;

  return r.json();
}

function pick(list, dur) {
  if (!Array.isArray(list)) return null;

  const candidates = list.filter(
    (x) =>
      (x.syncedLyrics || x.plainLyrics) &&
      (!dur || !x.duration || Math.abs(x.duration - dur) <= 10)
  );

  const score = (x) =>
    (x.syncedLyrics ? 0 : 1000) +
    (dur && x.duration ? Math.abs(x.duration - dur) : 50);

  return candidates.sort((a, b) => score(a) - score(b))[0] || null;
}

function saveCache(key, data) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }

  cache.set(key, {
    at: Date.now(),
    data,
  });
}

export default async function lyrics(req, res) {
  const title = String(req.query.title || "").trim().slice(0, 150);
  const artist = String(req.query.artist || "").trim().slice(0, 150);
  const dur = Math.max(0, Number(req.query.duration) || 0);

  if (!title) {
    return res.status(422).json({
      detail: "title is required",
    });
  }

  const key = `${title}|${artist}|${Math.round(dur)}`.toLowerCase();
  const hit = cache.get(key);

  if (hit && Date.now() - hit.at < TTL) {
    return res.json(hit.data);
  }

  if (hit) cache.delete(key);

  try {
    let found = null;

    if (dur) {
      const p = new URLSearchParams({
        track_name: title,
        artist_name: artist,
        duration: String(Math.round(dur)),
      });

      const result = await getJson(
        "https://lrclib.net/api/get?" + p
      );

      if (result?.syncedLyrics || result?.plainLyrics) {
        found = result;
      }
    }

    for (const t of new Set([title, clean(title)])) {
      if (found || !t) continue;

      const p = new URLSearchParams({
        track_name: t,
        artist_name: artist,
      });

      found = pick(
        await getJson("https://lrclib.net/api/search?" + p),
        dur
      );
    }

    if (!found) {
      const p = new URLSearchParams({
        q: `${clean(title)} ${artist}`.trim(),
      });

      found = pick(
        await getJson("https://lrclib.net/api/search?" + p),
        dur
      );
    }

    const data = {
      synced: found?.syncedLyrics || null,
      plain: found?.plainLyrics || null,
    };

    saveCache(key, data);

    return res.json(data);
  } catch (err) {
    console.error("Lyrics lookup error:", err.message);

    return res.status(502).json({
      detail: "Lyrics service temporarily unavailable",
    });
  }
}

