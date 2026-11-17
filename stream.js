
import { execFile } from "node:child_process";
import { Readable } from "node:stream";

const ID_RE = /^[\w-]{11}$/;

const UA =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

const CACHE_TTL = 25 * 60 * 1000;
const MAX_CACHE = 500;

const cache = new Map();
const inflight = new Map();

function getCached(id) {
  const hit = cache.get(id);

  if (!hit) return null;

  if (hit.exp <= Date.now()) {
    cache.delete(id);
    return null;
  }

  // Refresh LRU order
  cache.delete(id);
  cache.set(id, hit);

  return hit.url;
}

function saveCache(id, url) {
  cache.delete(id);

  while (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }

  const match = /[?&]expire=(\d+)/.exec(url);

  const expiry = match
    ? Number(match[1]) * 1000 - 5 * 60 * 1000
    : Date.now() + CACHE_TTL;

  cache.set(id, {
    url,
    exp: Math.min(expiry, Date.now() + CACHE_TTL),
  });
}

function resolveUrl(id) {
  const cached = getCached(id);

  if (cached) return Promise.resolve(cached);

  if (inflight.has(id)) return inflight.get(id);

  const promise = new Promise((resolve, reject) => {
    execFile(
      "yt-dlp",
      [
        "--no-playlist",
        "--no-warnings",
        "--no-progress",
        "-f",
        "bestaudio[ext=m4a]/bestaudio",
        "-g",
        `https://www.youtube.com/watch?v=${id}`,
      ],
      {
        timeout: 40000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout) => {
        if (error) return reject(error);

        const url = String(stdout).trim().split("\n")[0];

        if (!url || !url.startsWith("https://")) {
          return reject(new Error("Invalid stream URL"));
        }

        saveCache(id, url);
        resolve(url);
      }
    );
  }).finally(() => {
    inflight.delete(id);
  });

  inflight.set(id, promise);

  return promise;
}

function fail(res, status, message) {
  if (res.headersSent) {
    return res.destroy();
  }

  res.status(status).type("text/plain").send(message);
}

export default async function stream(req, res) {
  const id =
    req.params?.id ||
    req.url.split("?")[0].split("/").pop();

  if (!ID_RE.test(id)) {
    return fail(res, 400, "Invalid video ID");
  }

  const controller = new AbortController();

  const abort = () => {
    if (!res.writableFinished) {
      controller.abort();
    }
  };

  req.once("aborted", abort);
  res.once("close", abort);

  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const url = await resolveUrl(id);

      if (controller.signal.aborted) return;

      const headers = {
        "User-Agent": UA,
      };

      if (req.headers.range) {
        headers.Range = req.headers.range;
      }

      const upstream = await fetch(url, {
        method: req.method === "HEAD" ? "HEAD" : "GET",
        headers,
        signal: controller.signal,
        redirect: "follow",
      });

      if (
        upstream.status === 403 ||
        upstream.status === 410
      ) {
        cache.delete(id);
        continue;
      }

      if (
        !upstream.ok &&
        upstream.status !== 416
      ) {
        return fail(
          res,
          502,
          `Upstream error: ${upstream.status}`
        );
      }

      const responseHeaders = {
        "Accept-Ranges": "bytes",
        "Content-Type":
          upstream.headers.get("content-type") ||
          "application/octet-stream",
        "Cache-Control": "no-store",
      };

      for (const key of [
        "content-length",
        "content-range",
      ]) {
        const value = upstream.headers.get(key);

        if (value) {
          responseHeaders[key] = value;
        }
      }

      res.writeHead(upstream.status, responseHeaders);

      if (req.method === "HEAD") {
        return res.end();
      }

      if (!upstream.body) {
        return res.end();
      }

      Readable.fromWeb(upstream.body)
        .on("error", () => res.destroy())
        .pipe(res);

      return;
    }

    fail(res, 502, "Unable to refresh stream URL");

  } catch (error) {
    if (controller.signal.aborted) return;

    cache.delete(id);

    console.error(
      "[Musically Stream Error]",
      error.message
    );

    fail(res, 502, "Unable to extract audio");
  }
}

