// Discord Rich Presence bridge for Musically.
// Run on the SAME PC where Discord desktop is open:
//   npm i @xhayper/discord-rpc
//   DISCORD_CLIENT_ID=your_app_id node rpc-bridge.js
// Then open Musically in a browser on this PC -> Library -> "Discord RPC: On".
const http = require('http');
const { Client } = require('@xhayper/discord-rpc');

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || 'PASTE_YOUR_APPLICATION_ID';
const PORT = 6464;

const rpc = new Client({ clientId: CLIENT_ID });
let ready = false;

async function connect() {
  try { await rpc.login(); }
  catch (e) { console.log('Discord not found, retrying in 5s...'); setTimeout(connect, 5000); }
}
rpc.on('ready', () => { ready = true; console.log('Discord connected'); });
rpc.on('disconnected', () => { ready = false; setTimeout(connect, 5000); });
connect();

const clip = (s, n) => String(s || '').slice(0, n);

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method !== 'POST' || req.url !== '/rpc') { res.writeHead(404); return res.end(); }

  let body = '';
  req.on('data', c => { body += c; if (body.length > 20000) req.destroy(); });
  req.on('end', async () => {
    res.writeHead(204); res.end();
    if (!ready || !rpc.user) return;
    try {
      const m = JSON.parse(body);
      if (m.clear) return await rpc.user.clearActivity();
      const act = {
        type: 2, // Listening
        details: clip(m.title, 128).padEnd(2, ' '),
        state: clip(m.artist, 128).padEnd(2, ' '),
        startTimestamp: m.start,
        instance: false,
      };
      if (m.end) act.endTimestamp = m.end;
      if (m.cover && /^https:\/\//.test(m.cover)) { act.largeImageKey = m.cover; act.largeImageText = clip(m.title, 128); }
      await rpc.user.setActivity(act);
    } catch (e) { console.log('RPC error:', e.message); }
  });
}).listen(PORT, '127.0.0.1', () => console.log('Bridge on http://127.0.0.1:' + PORT));

