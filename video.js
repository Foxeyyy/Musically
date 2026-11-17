// video.js — muted YouTube video proxy (yt-dlp) for Musically's video background.
// Same style as stream.js. Needs Node 18+ and yt-dlp installed.
//
//   import video from './video.js';
//   app.get('/api/video/:id', video);
//
import { execFile } from 'node:child_process';
import { Readable } from 'node:stream';

const ID_RE = /^[\w-]{11}$/;
const UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

const cache = new Map();    // id -> { url, exp }
const inflight = new Map(); // id -> Promise<string>

function resolveUrl(id, fresh) {
  if (!fresh) {
    const hit = cache.get(id);
    if (hit && hit.exp > Date.now()) return Promise.resolve(hit.url);
    if (inflight.has(id)) return inflight.get(id);
  }
  const p = new Promise((resolve, reject) => {
    execFile(
      'yt-dlp',
      [
        // small H.264 mp4 video (max 360p) so every browser can play it
        '-f', 'bestvideo[height<=360][vcodec^=avc1][ext=mp4]/bestvideo[height<=360][ext=mp4]/worst[ext=mp4]/worst',
        '-g',
        '--no-playlist',
        '--no-warnings',
        'https://www.youtube.com/watch?v=' + id,
      ],
      { timeout: 40000 },
      (err, out) => {
        if (err) return reject(err);
        const url = String(out).trim().split('\n')[0];
        if (!url.startsWith('http')) return reject(new Error('yt-dlp returned no url'));
        const m = /[?&]expire=(\d+)/.exec(url);
        const exp = m ? Number(m[1]) * 1000 - 5 * 60 * 1000 : Date.now() + 30 * 60 * 1000;
        cache.set(id, { url, exp });
        if (cache.size > 200) cache.delete(cache.keys().next().value);
        resolve(url);
      }
    );
  }).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

function fail(res, code, msg) {
  if (!res.headersSent) {
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(msg);
  } else {
    res.destroy();
  }
}

export default async function video(req, res) {
  const id = (req.params && req.params.id) || req.url.split('?')[0].split('/').pop();
  if (!ID_RE.test(id)) return fail(res, 400, 'bad id');
  try {
    const headers = { 'User-Agent': UA };
    if (req.headers.range) headers.Range = req.headers.range;

    let url = await resolveUrl(id);
    let up = await fetch(url, { headers });
    if (up.status === 403 || up.status === 410) {   // expired url: resolve again once
      cache.delete(id);
      url = await resolveUrl(id, true);
      up = await fetch(url, { headers });
    }
    if (!up.ok && up.status !== 206) return fail(res, 502, 'upstream ' + up.status);

    const h = { 'Cache-Control': 'public, max-age=3600' };
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = up.headers.get(k);
      if (v) h[k] = v;
    }
    res.writeHead(up.status, h);
    if (!up.body) return res.end();
    const rs = Readable.fromWeb(up.body);
    res.on('close', () => rs.destroy());
    rs.on('error', () => res.destroy());
    rs.pipe(res);
  } catch (e) {
    console.error('video error:', e.message);
    fail(res, 502, 'video failed');
  }
}

