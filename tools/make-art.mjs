// Draws every bitmap the channel ships: channel art and splash screens, the
// 9-patches that give SceneGraph rounded panels and soft shadows, the frame
// mouldings and the dithered backgrounds. Output is committed under images/,
// so this only needs running when the look changes:  npm run art
//
// Roku 9-patch: a PNG named *.9.png with a 1-pixel border; black pixels on the
// top and left edges mark the stretchable rows/columns. Corners keep their
// pixel size however the Poster is stretched.

import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'images');
mkdirSync(join(out, 'ui'), { recursive: true });

GlobalFonts.registerFromPath(join(root, 'fonts/IBMPlexSerif-Regular.ttf'), 'PlexSerif');
GlobalFonts.registerFromPath(join(root, 'fonts/IBMPlexSerif-Italic.ttf'), 'PlexSerifItalic');
GlobalFonts.registerFromPath(join(root, 'fonts/IBMPlexMono-SemiBold.ttf'), 'PlexMono');

const ACCENT = '#2b7ff5';
const INK = '#ece9e3';

function save(canvas, name) {
  const file = join(out, name);
  mkdirSync(dirname(file), { recursive: true });
  // Full-screen art is JPEG: dithered gradients compress badly as PNG.
  const jpeg = name.endsWith('.jpg');
  writeFileSync(file, jpeg ? canvas.toBuffer('image/jpeg', 92) : canvas.toBuffer('image/png'));
  console.log(`${name}  ${canvas.width}×${canvas.height}`);
}

/** Seeded noise so the art is byte-stable between runs. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** ±1 level of noise: dark gradients band visibly on TVs without it. */
function dither(ctx, w, h, amount = 1.2, seed = 7) {
  const r = rng(seed);
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 2 * amount;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

function radial(w, h, cx, cy, stops) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  // An ellipse: scale a circle to the canvas's aspect.
  ctx.save();
  ctx.translate(cx * w, cy * h);
  ctx.scale(w / h, 1);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, h * 1.05);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(-w * 2, -h * 2, w * 4, h * 4);
  ctx.restore();
  dither(ctx, w, h);
  return c;
}

// --- Backgrounds -----------------------------------------------------------

// The pairing / idle / notice screens (simulator `.screen`).
save(radial(960, 540, 0.5, 0.3, [[0, '#17171a'], [0.6, '#0b0b0c'], [1, '#060606']]), 'ui/bg-screen.jpg');
// The wall behind a framed piece (simulator `.layer.fit-FRAME`).
save(radial(960, 540, 0.5, 0.38, [[0, '#2c2a27'], [0.55, '#1b1a18'], [1, '#121110']]), 'ui/bg-frame-wall.jpg');

// --- Wordmark, channel art, splash -------------------------------------------

function wordmark(ctx, x, y, size) {
  ctx.textBaseline = 'alphabetic';
  const dot = size * 0.42;
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.arc(x + dot / 2, y - size * 0.32, dot / 2, 0, Math.PI * 2);
  ctx.fill();
  let cx = x + dot + size * 0.5;
  ctx.font = `${size}px PlexSerif`;
  ctx.fillStyle = INK;
  ctx.fillText('SolPersona', cx, y);
  cx += ctx.measureText('SolPersona ').width;
  ctx.font = `${size}px PlexSerifItalic`;
  ctx.fillStyle = 'rgba(236,233,227,0.62)';
  ctx.fillText('Gallery', cx, y);
}

function wordmarkWidth(ctx, size) {
  ctx.font = `${size}px PlexSerif`;
  const a = ctx.measureText('SolPersona ').width;
  ctx.font = `${size}px PlexSerifItalic`;
  return size * 0.42 + size * 0.5 + a + ctx.measureText('Gallery').width;
}

function art(w, h, size, withFrame) {
  const c = radial(w, h, 0.5, 0.42, [[0, '#1d1c1f'], [0.65, '#0c0c0d'], [1, '#060606']]);
  const ctx = c.getContext('2d');
  if (withFrame) {
    // A small framed rectangle above the wordmark: a picture on a wall.
    const fw = h * 0.3, fh = h * 0.22, fx = (w - fw) / 2, fy = h * 0.2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(fx + 2, fy + 6, fw, fh);
    ctx.fillStyle = '#e9e5dc';
    ctx.fillRect(fx, fy, fw, fh);
    ctx.fillStyle = '#fbfaf7';
    const mat = fh * 0.12;
    ctx.fillRect(fx + 3, fy + 3, fw - 6, fh - 6);
    const g = ctx.createLinearGradient(fx, fy, fx + fw, fy + fh);
    g.addColorStop(0, '#2b7ff5');
    g.addColorStop(0.55, '#7a5cf0');
    g.addColorStop(1, '#f08a5c');
    ctx.fillStyle = g;
    ctx.fillRect(fx + mat, fy + mat, fw - 2 * mat, fh - 2 * mat);
  }
  const ww = wordmarkWidth(ctx, size);
  wordmark(ctx, (w - ww) / 2, withFrame ? h * 0.72 : h * 0.54, size);
  return c;
}

// Channel poster (the tile on the Roku home screen). Not transparent (cert 6.4).
save(art(540, 405, 46, true), 'channel-poster_fhd.png');
save(art(290, 218, 25, true), 'channel-poster_hd.png');
// Splash screens.
save(art(1920, 1080, 78, false), 'splash_fhd.jpg');
save(art(1280, 720, 52, false), 'splash_hd.jpg');
save(art(720, 480, 32, false), 'splash_sd.jpg');

// --- 9-patches ---------------------------------------------------------------

/**
 * Wraps a drawing of size w×h in the 1-pixel 9-patch border. `sx`/`sy` are
 * the stretchable [from, to) ranges inside the drawing.
 */
function ninePatch(w, h, draw, sx, sy) {
  const c = createCanvas(w + 2, h + 2);
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.translate(1, 1);
  draw(ctx);
  ctx.restore();
  ctx.fillStyle = '#000000';
  ctx.fillRect(1 + sx[0], 0, sx[1] - sx[0], 1);
  ctx.fillRect(0, 1 + sy[0], 1, sy[1] - sy[0]);
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A white rounded rectangle; tinted with Poster.blendColor. */
function rounded(r) {
  const s = r * 2 + 4;
  return ninePatch(s, s, (ctx) => {
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, 0, 0, s, s, r);
    ctx.fill();
  }, [r + 1, r + 3], [r + 1, r + 3]);
}

/** A white rounded outline of `line` px. */
function ring(r, line) {
  const s = r * 2 + 4;
  return ninePatch(s, s, (ctx) => {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = line;
    roundRect(ctx, line / 2, line / 2, s - line, s - line, Math.max(1, r - line / 2));
    ctx.stroke();
  }, [r + 1, r + 3], [r + 1, r + 3]);
}

save(rounded(6), 'ui/round6.9.png');
save(rounded(12), 'ui/round12.9.png');
save(rounded(22), 'ui/pill.9.png');
save(ring(6, 1), 'ui/ring6.9.png');
save(ring(22, 2), 'ui/pill-ring.9.png');

/**
 * A soft shadow of a rectangle: black, Gaussian-like, `blur` px on every side.
 * Stretched to (piece + 2·blur) it reads as CSS box-shadow with that blur.
 */
function shadow(blur, alpha) {
  const core = 8;
  const s = core + blur * 4;
  return ninePatch(s, s, (ctx) => {
    ctx.shadowColor = `rgba(0,0,0,${alpha})`;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    // Draw the casting rectangle far off-canvas and offset its shadow back,
    // so only the shadow lands (no hard core edge).
    ctx.shadowOffsetX = 10000;
    ctx.fillRect(blur * 2 - 10000, blur * 2, core, core);
  }, [blur * 2 + 2, blur * 2 + core - 2], [blur * 2 + 2, blur * 2 + core - 2]);
}

save(shadow(24, 1), 'ui/shadow.9.png');

/** A soft white glow ring, for the focused button. */
const dot = createCanvas(64, 64);
{
  const ctx = dot.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(32, 32, 31, 0, Math.PI * 2);
  ctx.fill();
}
save(dot, 'ui/dot.png');

// --- Frame mouldings -----------------------------------------------------------
//
// Each moulding is drawn as four strips (top, bottom, left, right). The CSS
// original is one 145° gradient over the whole frame, light at the top left;
// each strip carries its share of it, plus grain for the woods and a thin
// bevel highlight on the inner edge.

const MOULDINGS = {
  GALLERY_WHITE: { stops: ['#fdfcf9', '#ece9e2', '#dedad2'], grain: 0, bevel: 'rgba(0,0,0,0.06)' },
  MUSEUM_BLACK: { stops: ['#2c2c2c', '#0d0d0d', '#060606'], grain: 0, bevel: 'rgba(255,255,255,0.07)' },
  OAK: { stops: ['#d3ad7f', '#b88b5c', '#a07447'], grain: 1, bevel: 'rgba(255,240,210,0.18)' },
  WALNUT: { stops: ['#74492b', '#553420', '#3c2415'], grain: 1.4, bevel: 'rgba(255,220,180,0.10)' },
};

function mix(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}
function along(stops, t) {
  return t < 0.5 ? mix(stops[0], stops[1], t * 2) : mix(stops[1], stops[2], (t - 0.5) * 2);
}

function strip(style, side) {
  const long = 512, thick = 32;
  const horizontal = side === 'top' || side === 'bottom';
  const w = horizontal ? long : thick, h = horizontal ? thick : long;
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  const m = MOULDINGS[style];
  // Where along the 145° gradient each end of this strip falls.
  const range = { top: [0, 0.55], left: [0, 0.55], right: [0.45, 1], bottom: [0.45, 1] }[side];
  const g = horizontal ? ctx.createLinearGradient(0, 0, w, 0) : ctx.createLinearGradient(0, 0, 0, h);
  for (let i = 0; i <= 8; i += 1) g.addColorStop(i / 8, along(m.stops, range[0] + (range[1] - range[0]) * (i / 8)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  if (m.grain) {
    const r = rng(style.length * 31 + side.length);
    // Grain runs along the moulding, as it does in a real frame.
    for (let i = 0; i < 70 * m.grain; i += 1) {
      const across = r() * thick;
      const light = r() < 0.4;
      ctx.strokeStyle = light ? `rgba(255,240,210,${0.05 + r() * 0.07})` : `rgba(60,35,15,${0.06 + r() * 0.1})`;
      ctx.lineWidth = 0.6 + r() * 1.6;
      ctx.beginPath();
      const wobble = r() * 2.5;
      for (let t = 0; t <= long; t += 16) {
        const off = across + Math.sin(t / (40 + r() * 30) + i) * wobble;
        if (horizontal) (t === 0 ? ctx.moveTo(t, off) : ctx.lineTo(t, off));
        else (t === 0 ? ctx.moveTo(off, t) : ctx.lineTo(off, t));
      }
      ctx.stroke();
    }
  }
  // Inner-edge bevel and outer-edge shade give the moulding a profile.
  const inner = { top: [0, thick - 3, w, 3], bottom: [0, 0, w, 3], left: [thick - 3, 0, 3, h], right: [0, 0, 3, h] }[side];
  const outer = { top: [0, 0, w, 2], bottom: [0, thick - 2, w, 2], left: [0, 0, 2, h], right: [thick - 2, 0, 2, h] }[side];
  ctx.fillStyle = m.bevel;
  ctx.fillRect(...inner);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(...outer);
  return c;
}

for (const style of Object.keys(MOULDINGS)) {
  for (const side of ['top', 'bottom', 'left', 'right']) {
    save(strip(style, side), `frames/${style.toLowerCase()}-${side}.png`);
  }
}
