// A stand-in SolPersona for developing and testing the channel without a
// SolPersona stack: the public device API of docs/solpersona/SPEC.md, with
// generated test art and a control surface to drive it from a shell.
//
//   npm run mock                     # listens on :8090 (SolPersona dev stacks use :8080)
//   PORT=9000 node tools/mock-server.mjs
//
// Point a sideloaded Roku at it from the hidden developer menu (★ five times
// on the pairing screen), or:  curl -d '' "http://<roku>:8060/launch/dev?baseUrl=http://<this-machine>:8090"
//
// Control (GET, from a browser or curl):
//   /mock/link                      link the screen that is showing a code
//   /mock/set?fit=FRAME&frameStyle=OAK&slideSeconds=10 …   change settings (new version)
//   /mock/status?value=IDLE|PLAYING|UNLICENSED
//   /mock/next  /mock/prev  /mock/pause  /mock/resume  /mock/restart
//   /mock/command?type=identify|reload|clear-cache
//   /mock/takeover?item=a:3&seconds=30   /mock/takeover?clear=1
//   /mock/keep?on=1                 the owner's "Keep this gallery on the screen"
//   /mock/offline?seconds=30        drop every API and media request for a while (an outage)
//   /mock/unlink                    remove the screen from its account
//   /mock/state                     what the mock holds; /mock/log: the last sync bodies
//
// Not part of the channel package; no secrets: tokens are random per run.

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { createCanvas } from '@napi-rs/canvas';

const PORT = Number(process.env.PORT || 8090);
const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...headers });
  res.end(JSON.stringify(body));
};
const error = (res, status, code, message, headers) => json(res, status, { error: { code, message } }, headers);

// --- Test art ------------------------------------------------------------------

const media = new Map(); // name → { type, body }

function paint(w, h, seed, style) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  const hue = (seed * 67) % 360;
  if (style === 'white') {
    ctx.fillStyle = '#fbfbf8';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = Math.max(2, w / 300);
    for (let i = 0; i < 9; i += 1) {
      ctx.beginPath();
      ctx.arc(w * (0.2 + 0.07 * i), h * 0.5, w * 0.05 * (i + 1), 0, Math.PI * 1.3);
      ctx.stroke();
    }
    return c;
  }
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `hsl(${hue},70%,45%)`);
  g.addColorStop(0.5, `hsl(${(hue + 60) % 360},65%,35%)`);
  g.addColorStop(1, `hsl(${(hue + 140) % 360},70%,20%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 24; i += 1) {
    ctx.fillStyle = `hsla(${(hue + i * 23) % 360},80%,${40 + (i % 5) * 9}%,0.55)`;
    const r = Math.min(w, h) * (0.05 + ((i * 37) % 11) / 60);
    ctx.beginPath();
    ctx.arc(((i * 97) % 100) / 100 * w, ((i * 53) % 100) / 100 * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `${Math.round(h / 9)}px sans-serif`;
  ctx.fillText(`#${seed}`, w * 0.06, h * 0.9);
  return c;
}

function addPiece(id, w, h, style, originalType = 'image/jpeg') {
  const big = paint(w, h, id, style);
  const scale = (max) => {
    const s = Math.min(1, max / Math.max(w, h));
    const c = createCanvas(Math.round(w * s), Math.round(h * s));
    c.getContext('2d').drawImage(big, 0, 0, c.width, c.height);
    return c;
  };
  const ext = originalType === 'image/png' ? 'png' : 'jpg';
  media.set(`p${id}-original.${ext}`, { type: originalType, body: big.toBuffer(originalType, 88) });
  media.set(`p${id}-display.webp`, { type: 'image/webp', body: scale(1000).toBuffer('image/webp', 82) });
  media.set(`p${id}-poster.webp`, { type: 'image/webp', body: scale(600).toBuffer('image/webp', 75) });
}

addPiece(1, 3000, 2000, 'color');
addPiece(2, 2000, 3000, 'color');
addPiece(3, 2400, 2400, 'color', 'image/png');
addPiece(4, 3200, 1800, 'white');
addPiece(5, 1600, 900, 'color');

// A short H.264 film, if an ffmpeg is at hand (ffmpeg-static or the system's).
let film = null;
for (const ff of [process.env.FFMPEG, join(process.env.HOME || '', '.cache/ff/node_modules/ffmpeg-static/ffmpeg'), 'ffmpeg']) {
  if (!ff) continue;
  try {
    const out = join(tmpdir(), 'solpersona-mock-film.mp4');
    if (!existsSync(out)) {
      execFileSync(ff, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=25', '-f', 'lavfi', '-i', 'sine=f=440:r=44100',
        '-t', '7', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', out]);
    }
    film = readFileSync(out);
    media.set('film.mp4', { type: 'video/mp4', body: film });
    break;
  } catch { /* try the next */ }
}

function base(req) {
  return `http://${req.headers.host}`;
}

function item(req, id, title, artist, year, extra = {}) {
  const b = base(req);
  const n = id.replace(/\D/g, '');
  const ext = n === '3' ? 'png' : 'jpg';
  return {
    id, kind: 'IMAGE', title, artist: { name: artist, handle: artist.toLowerCase().replace(/\W/g, '') }, year,
    description: 'A study in colour and weight, made for the wall. Generated by the mock server so every fit and label can be checked.',
    media: { original: `${b}/media/p${n}-original.${ext}`, display: `${b}/media/p${n}-display.webp`, poster: `${b}/media/p${n}-poster.webp`, fallbacks: [] },
    links: { solpersona: `https://solpersona.com/art/${id}`, vault: null, marketplace: null },
    ...extra,
  };
}

function items(req) {
  const b = base(req);
  const list = [
    item(req, 'a:1', 'Evening, Harbour', 'Ines Okafor', 2024),
    item(req, 'a:2', 'Tall Weather', 'Ines Okafor', 2023),
    item(req, 'a:3', 'Square Garden', 'Mo Lindqvist', 2025),
    item(req, 'a:4', 'White Study No. 4', 'Mo Lindqvist', 2022),
  ];
  if (film) {
    list.push({ ...item(req, 'v:5', 'Signal Test', 'Mock Studio', 2026), kind: 'VIDEO',
      media: { original: `${b}/media/film.mp4`, display: `${b}/media/p5-display.webp`, poster: `${b}/media/p5-poster.webp`, fallbacks: [] } });
  }
  list.push({ ...item(req, 'v:6', 'A Film in WebM', 'Mock Studio', 2026), kind: 'VIDEO',
    media: { original: `${b}/media/film.webm`, display: `${b}/media/p5-display.webp`, poster: `${b}/media/p5-poster.webp`, fallbacks: [] } });
  return list;
}

// --- State ------------------------------------------------------------------------

const DEFAULTS = {
  slideSeconds: 12, order: 'GALLERY', transition: 'FADE', transitionMs: 1200, loopShortVideos: true, maxVideoLoops: 3,
  videoSound: false, fit: 'BLUR', washOpacity: 60, pieceShadow: true, frameStyle: 'GALLERY_WHITE', marginPercent: 4,
  imageQuality: 'AUTO', captionStyle: 'LABEL', captionTiming: 'ALWAYS', captionCorner: 'BOTTOM_LEFT', showTitle: true,
  showArtist: true, showYear: true, showDescription: false, qrTarget: 'SOLPERSONA', qrCorner: 'BOTTOM_RIGHT',
  burnInGuard: true, prefetch: 2, schedule: null,
};

const state = {
  registrations: new Map(), // deviceCode → { pairingCode, deviceId, expiresAt, linked, polls }
  screens: new Map(),       // token → { deviceId, name, ackSeq, removed }
  status: 'PLAYING',
  settings: { ...DEFAULTS },
  version: 1,
  epochMs: Date.now(),
  pausedAtMs: null,
  durations: {},            // itemId → ms, as reported
  takeover: null,
  commands: [],
  seq: 0,
  keepOffline: false,
  offlineUntil: 0,
  log: [],
};

function timeline(list) {
  const still = state.settings.slideSeconds * 1000;
  return list.map((it) => {
    if (it.kind !== 'VIDEO') return { id: it.id, ms: still };
    const known = state.durations[it.id];
    if (!known) return { id: it.id, ms: still, estimated: true };
    const plays = state.settings.loopShortVideos ? Math.min(state.settings.maxVideoLoops, Math.max(1, Math.ceil(still / known))) : 1;
    return { id: it.id, ms: known * plays };
  });
}

function positionAt(tl, now) {
  const total = tl.reduce((s, x) => s + x.ms, 0);
  const at = (state.pausedAtMs ?? now) - state.epochMs;
  const lap = Math.floor(at / total);
  let into = at - lap * total;
  for (let i = 0; i < tl.length; i += 1) {
    if (into < tl[i].ms) return { index: i, offsetMs: into };
    into -= tl[i].ms;
  }
  return { index: tl.length - 1, offsetMs: 0 };
}

function startOf(tl, index) {
  return tl.slice(0, index).reduce((s, x) => s + x.ms, 0);
}

function show(req, full) {
  const list = items(req);
  const out = { id: 'mock-show', version: state.version, sourceRef: 'collection:mock', epochMs: state.epochMs, pausedAtMs: state.pausedAtMs };
  if (full) Object.assign(out, { settings: state.settings, items: list, timeline: timeline(list) });
  return out;
}

function bump() {
  // A new version re-times without moving what is on the wall (reanchor).
  const list = items({ headers: { host: 'x' } });
  const before = timeline(list);
  const now = Date.now();
  const pos = positionAt(before, now);
  state.version += 1;
  const after = timeline(list);
  state.epochMs = (state.pausedAtMs ?? now) - startOf(after, pos.index) - Math.min(pos.offsetMs, after[pos.index].ms - 1);
}

function step(by) {
  const list = items({ headers: { host: 'x' } });
  const tl = timeline(list);
  const now = Date.now();
  const pos = positionAt(tl, now);
  const n = tl.length;
  const index = (((pos.index + by) % n) + n) % n;
  state.epochMs = (state.pausedAtMs ?? now) - startOf(tl, index);
}

function auth(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  return state.screens.get(token) || null;
}

function body(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve(null); } });
  });
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => Array.from({ length: 8 }, () => ALPHABET[randomBytes(1)[0] % ALPHABET.length]).join('').replace(/^(.{4})/, '$1-');

// --- Server -----------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  const q = Object.fromEntries(url.searchParams);
  // A simulated outage: the device API and media drop the connection, the
  // control surface keeps answering, and nothing is forgotten.
  if ((path.startsWith('/api/') || path.startsWith('/media/')) && Date.now() < state.offlineUntil) {
    req.socket.destroy();
    return;
  }
  try {
    if (path.startsWith('/media/')) {
      const file = media.get(path.slice(7));
      if (!file) return error(res, 404, 'NOT_FOUND', 'No such file.');
      res.writeHead(200, { 'Content-Type': file.type, 'Content-Length': file.body.length });
      return res.end(file.body);
    }

    if (path === '/api/v1/device/register' && req.method === 'POST') {
      const b = (await body(req)) || {};
      const reg = { pairingCode: code(), deviceCode: randomBytes(16).toString('hex'), deviceId: randomBytes(6).toString('hex'),
        expiresAt: new Date(Date.now() + 15 * 60000).toISOString(), linked: false, name: b.name || 'Roku', platform: b.platform };
      state.registrations.set(reg.deviceCode, reg);
      const pairUrl = `${base(req)}/pair?code=${reg.pairingCode}`;
      const png = await QRCode.toBuffer(pairUrl, { width: 360, margin: 1 });
      console.log(`register  ${reg.platform} ${reg.deviceId}  code ${reg.pairingCode}  caps ${JSON.stringify(b.capabilities)}`);
      return json(res, 201, { deviceId: reg.deviceId, deviceCode: reg.deviceCode, pairingCode: reg.pairingCode, pairUrl,
        qrDataUri: `data:image/png;base64,${png.toString('base64')}`, expiresAt: reg.expiresAt, intervalMs: 3000 });
    }

    if (path === '/api/v1/device/token' && req.method === 'POST') {
      const b = (await body(req)) || {};
      const reg = state.registrations.get(b.deviceCode);
      if (!reg || reg.spent) return error(res, 401, 'SCREEN_NOT_LINKED', 'Unknown code.');
      if (Date.parse(reg.expiresAt) < Date.now()) return error(res, 401, 'TOKEN_EXPIRED', 'The code ran out.');
      if (!reg.linked) return json(res, 202, { status: 'PENDING', expiresAt: reg.expiresAt });
      reg.spent = true;
      const token = `sps_${randomBytes(24).toString('hex')}`;
      state.screens.set(token, { deviceId: reg.deviceId, name: 'Front window', ackSeq: 0 });
      console.log(`linked    ${reg.deviceId}`);
      return json(res, 200, { status: 'LINKED', accessToken: token, device: { id: reg.deviceId, name: 'Front window' } });
    }

    if (path === '/api/v1/device/sync' && req.method === 'POST') {
      const screen = auth(req);
      if (!screen || screen.removed) return error(res, 401, 'SCREEN_NOT_LINKED', 'This screen was removed from its account.');
      const b = (await body(req)) || {};
      state.log.unshift({ at: new Date().toISOString(), ...b });
      state.log.length = Math.min(state.log.length, 30);
      if (typeof b.ackSeq === 'number') state.commands = state.commands.filter((c) => c.seq > b.ackSeq);
      for (const d of b.durations || []) {
        if (!state.durations[d.itemId]) { state.durations[d.itemId] = d.ms; bump(); console.log(`duration  ${d.itemId} ${d.ms} ms → v${state.version}`); }
      }
      if (b.plays) console.log(`plays     ${JSON.stringify(b.plays)}`);
      if (state.takeover && state.takeover.untilMs && state.takeover.untilMs < Date.now()) state.takeover = null;
      const playing = state.status === 'PLAYING';
      const full = b.showId !== 'mock-show' || b.version !== state.version;
      return json(res, 200, {
        serverTime: Date.now(), pollMs: 3000,
        device: { id: screen.deviceId, name: screen.name, owner: 'mockowner', keepOffline: state.keepOffline },
        status: state.status,
        show: playing ? show(req, full) : null,
        takeover: state.takeover ? { item: items(req).find((i) => i.id === state.takeover.item) || items(req)[0], settings: { ...state.settings, fit: 'BLACK' },
          startedAt: new Date(state.takeover.startedAt).toISOString(), until: state.takeover.untilMs ? new Date(state.takeover.untilMs).toISOString() : null } : null,
        commands: state.commands,
      });
    }

    if (path === '/api/v1/device/sample' && req.method === 'GET') {
      const list = items(req).slice(0, 4);
      const day = new Date(); day.setUTCHours(0, 0, 0, 0);
      return json(res, 200, { serverTime: Date.now(), pollMs: 60000,
        show: { id: 'sample', version: 3, sourceRef: 'sample', epochMs: day.getTime(), pausedAtMs: null,
          settings: { ...DEFAULTS, slideSeconds: 10, fit: 'FRAME', frameStyle: 'WALNUT', captionStyle: 'MINIMAL', captionCorner: 'BOTTOM_LEFT', qrCorner: 'BOTTOM_RIGHT' },
          items: list, timeline: list.map((i) => ({ id: i.id, ms: 10000 })) } });
    }

    if ((path === '/api/v1/device/qr' || path === '/api/v1/device/sample/qr') && req.method === 'GET') {
      if (path === '/api/v1/device/qr' && !auth(req)) return error(res, 401, 'SCREEN_NOT_LINKED', 'Unknown screen.');
      const it = items(req).find((i) => i.id === q.item);
      if (!it) return error(res, 404, 'NOT_FOUND', 'No code for this piece.');
      const link = path.endsWith('sample/qr') ? 'https://solpersona.com/gallery-app' : it.links.solpersona;
      const png = await QRCode.toBuffer(link, { width: 360, margin: 1 });
      res.writeHead(200, { 'Content-Type': 'image/png', 'x-qr-link': link, 'Access-Control-Allow-Origin': '*' });
      return res.end(png);
    }

    if (path === '/api/v1/device' && req.method === 'DELETE') {
      const h = req.headers.authorization || '';
      state.screens.delete(h.slice(7));
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      return res.end();
    }

    // --- Control -------------------------------------------------------------------
    if (path === '/mock/link') {
      const pending = [...state.registrations.values()].filter((r) => !r.linked);
      pending.forEach((r) => { r.linked = true; });
      return json(res, 200, { linked: pending.map((r) => r.pairingCode) });
    }
    if (path === '/mock/set') {
      for (const [k, v] of Object.entries(q)) {
        if (!(k in DEFAULTS)) continue;
        state.settings[k] = v === 'true' ? true : v === 'false' ? false : v === 'null' ? null : /^-?\d+$/.test(v) ? Number(v) : v;
      }
      if (q.on && q.off) state.settings.schedule = { on: q.on, off: q.off };
      bump();
      return json(res, 200, { version: state.version, settings: state.settings });
    }
    if (path === '/mock/status') { state.status = q.value || 'PLAYING'; return json(res, 200, { status: state.status }); }
    if (path === '/mock/next') { step(1); return json(res, 200, { epochMs: state.epochMs }); }
    if (path === '/mock/prev') { step(-1); return json(res, 200, { epochMs: state.epochMs }); }
    if (path === '/mock/restart') { state.epochMs = state.pausedAtMs ?? Date.now(); return json(res, 200, { epochMs: state.epochMs }); }
    if (path === '/mock/pause') { if (state.pausedAtMs === null) state.pausedAtMs = Date.now(); return json(res, 200, { pausedAtMs: state.pausedAtMs }); }
    if (path === '/mock/resume') {
      if (state.pausedAtMs !== null) { state.epochMs += Date.now() - state.pausedAtMs; state.pausedAtMs = null; }
      return json(res, 200, { epochMs: state.epochMs });
    }
    if (path === '/mock/command') {
      state.seq += 1;
      state.commands.push({ seq: state.seq, type: q.type || 'identify', issuedAt: new Date().toISOString() });
      return json(res, 200, { commands: state.commands });
    }
    if (path === '/mock/takeover') {
      state.takeover = q.clear ? null : { item: q.item || 'a:3', startedAt: Date.now(), untilMs: q.seconds ? Date.now() + Number(q.seconds) * 1000 : null };
      return json(res, 200, { takeover: state.takeover });
    }
    if (path === '/mock/keep') { state.keepOffline = q.on === '1' || q.on === 'true'; return json(res, 200, { keepOffline: state.keepOffline }); }
    if (path === '/mock/offline') { state.offlineUntil = Date.now() + Number(q.seconds || 30) * 1000; return json(res, 200, { offlineUntil: state.offlineUntil }); }
    if (path === '/mock/unlink') { state.screens.forEach((s) => { s.removed = true; }); return json(res, 200, { ok: true }); }
    if (path === '/mock/state') return json(res, 200, { ...state, registrations: [...state.registrations.values()], screens: [...state.screens.values()], log: undefined });
    if (path === '/mock/log') return json(res, 200, state.log);

    return error(res, 404, 'NOT_FOUND', 'Not here.');
  } catch (e) {
    console.error(e);
    return error(res, 500, 'INTERNAL', 'Mock failure.');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`mock SolPersona on http://0.0.0.0:${PORT}  (film: ${film ? 'yes' : 'no ffmpeg — videos are WebM only'})`);
});
