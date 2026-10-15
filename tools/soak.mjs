// The pre-submission soak test: runs the exact build that goes to the Channel
// Store on a real Roku for hours and writes a report (docs/STORE-SUBMISSION.md).
//
//   node tools/soak.mjs [--hours=8] [--minutes=N] [--mem-mins=2] [--shot-mins=10]
//                       [--warmup-mins=15] [--no-package] [--allow-no-memory]
//
// 1. Signs build/solpersona-gallery-roku.zip on the Roku (tools/roku.mjs
//    package: installs it as the dev channel, then signs that same zip), so
//    what runs is what is uploaded. --no-package just installs the zip.
// 2. Every --mem-mins: the channel's memory and CPU and the texture memory
//    (developer console, telnet 8080: `chanperf`, `r2d2_bitmaps`; or ECP's
//    query/chanperf and query/r2d2-bitmaps where Network access is
//    Permissive), and which app is in front / whether the screensaver is up
//    (ECP query/active-app). The console takes one client: close any telnet
//    session to 8080 first.
// 3. Every --shot-mins: a screenshot.
// 4. The whole time: the BrightScript console (port 8085), for crashes. Close
//    `make debug` first — the Roku takes one console client.
// 5. The report: build/soak/<time>/report.html and report.md. Ctrl-C ends the
//    run early and still writes it.
//
// Reads ROKU_IP, ROKU_PASSWORD, ROKU_SIGNING_PASSWORD from the environment or
// .env, like tools/roku.mjs. Nothing secret is written to the report.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RokuDeploy } from 'roku-deploy';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
if (existsSync(join(root, '.env'))) {
  for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const opts = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
  if (!m) { console.error(`Unknown argument ${a}`); process.exit(2); }
  return [m[1], m[2] ?? true];
}));
const minutes = opts.minutes ? Number(opts.minutes) : Number(opts.hours ?? 8) * 60;
const memMins = Number(opts['mem-mins'] ?? 2);
const shotMins = Number(opts['shot-mins'] ?? 10);
const warmupMins = Number(opts['warmup-mins'] ?? Math.min(15, minutes / 4));
const host = process.env.ROKU_IP;
const password = process.env.ROKU_PASSWORD;
if (!host || !password) { console.error('Set ROKU_IP and ROKU_PASSWORD (environment or .env).'); process.exit(2); }
if (!opts['no-package'] && !process.env.ROKU_SIGNING_PASSWORD) {
  console.error('Set ROKU_SIGNING_PASSWORD (from genkey) so the soak runs the signed build, or pass --no-package.');
  process.exit(2);
}

const zip = join(root, 'build', 'solpersona-gallery-roku.zip');
const pkg = join(root, 'build', 'solpersona-gallery-roku.pkg');
if (!existsSync(zip)) { console.error(`No ${zip}: run make zip.`); process.exit(2); }

const started = new Date();
const stamp = started.toISOString().replace(/[:T]/g, '-').slice(0, 19);
const dir = join(root, 'build', 'soak', stamp);
mkdirSync(dir, { recursive: true });
const say = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rokuDeploy = new RokuDeploy();

// --- The build ---------------------------------------------------------------------------

const manifest = Object.fromEntries(readFileSync(join(root, 'manifest'), 'utf8').split('\n')
  .map((l) => /^([a-z_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2]]));
const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim();
const build = {
  version: `${manifest.major_version}.${manifest.minor_version}.${manifest.build_version}`,
  commit: git(['rev-parse', '--short', 'HEAD']),
  dirty: git(['status', '--porcelain']) !== '',
  zipSha: sha256(zip),
  pkgSha: null,
  signed: false,
};

if (opts['no-package']) {
  say('Installing the zip (not signed: --no-package).');
  const r = spawnSync(process.execPath, [join(root, 'tools', 'roku.mjs'), 'sideload', zip], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(1);
} else {
  say('Installing and signing the build on the Roku.');
  const r = spawnSync(process.execPath, [join(root, 'tools', 'roku.mjs'), 'package'], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0 || !existsSync(pkg)) { console.error('Signing failed; nothing was tested.'); process.exit(1); }
  build.pkgSha = sha256(pkg);
  build.signed = true;
}

// --- Talking to the Roku -----------------------------------------------------------------

async function ecp(path) {
  try {
    const res = await fetch(`http://${host}:8060${path}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { text: await res.text() };
  } catch (e) {
    return { error: e.message };
  }
}
const tag = (xml, name) => (new RegExp(`<${name}[^>]*>([^<]*)</${name}>`).exec(xml) || [])[1] ?? null;

/** Runs one command on the developer console (port 8080) and returns what it printed. */
function console8080(command, listenMs = 3000) {
  return new Promise((resolve) => {
    let text = '';
    let sent = false;
    const socket = net.connect(8080, host);
    const finish = () => { socket.destroy(); resolve(text); };
    socket.setTimeout(10000, finish);
    socket.on('data', (d) => {
      text += d.toString();
      if (!sent && />\s*$/.test(text)) {
        sent = true;
        text = '';
        socket.write(`${command}\r\n`);
        setTimeout(finish, listenMs);
      }
    });
    socket.on('error', (e) => { text += `\n[error] ${e.message}`; finish(); });
    // Some firmware prints no prompt until a key: nudge once.
    setTimeout(() => { if (!sent) socket.write('\r\n'); }, 1500);
  });
}

function parseChanperf(text) {
  const lines = text.split(/\r?\n/).filter((l) => /mem=/.test(l));
  const line = lines[lines.length - 1];
  if (!line) return { running: !/not running/i.test(text) ? null : false };
  const kib = (k) => { const m = new RegExp(`${k}=(\\d+)`).exec(line); return m ? Number(m[1]) : null; };
  const cpu = /%cpu=(\d+(?:\.\d+)?)/.exec(line);
  return { running: true, memKiB: kib('mem'), anonKiB: kib('anon'), fileKiB: kib('file'), cpu: cpu ? Number(cpu[1]) : null };
}

function parseBitmaps(text) {
  const m = /used\s+(\d+)\s+max\s+(\d+)/i.exec(text);
  return m ? { texUsed: Number(m[1]), texMax: Number(m[2]) } : {};
}

// ECP's answers (XML). Memory figures are bytes; old firmware gave KiB.
const num = (xml, name) => { const v = tag(xml, name); return v == null || v === '' ? null : Number(v); };
const toKiB = (v) => (v == null ? null : v > 4 * 1024 * 1024 ? v / 1024 : v);
function parseEcpChanperf(xml) {
  if (!/<chanperf/.test(xml)) return null;
  if (/<status>\s*FAILED/i.test(xml)) return { running: false };
  const res = num(xml, 'res');
  const parts = ['anon', 'file', 'shared'].map((k) => num(xml, k));
  const mem = res ?? (parts.every((v) => v != null) ? parts.reduce((a, b) => a + b, 0) : null);
  const user = num(xml, 'user'), sys = num(xml, 'sys');
  return { running: mem != null ? true : null, memKiB: toKiB(mem), anonKiB: toKiB(num(xml, 'anon')), fileKiB: toKiB(num(xml, 'file')), cpu: user != null ? user + (sys ?? 0) : null };
}
function parseEcpBitmaps(xml) {
  const used = num(xml, 'bytes') ?? num(xml, 'used');
  const max = num(xml, 'max-bytes') ?? num(xml, 'max');
  return used != null ? { texUsed: used, texMax: max } : {};
}
let perfSource = null; // 'ecp' | 'telnet', found on the first sample

async function readPerf() {
  let ecpError = 'not tried';
  if (perfSource !== 'telnet') {
    const perf = await ecp('/query/chanperf');
    const bmp = await ecp('/query/r2d2-bitmaps');
    const parsed = perf.text ? parseEcpChanperf(perf.text) : null;
    if (parsed) {
      perfSource = 'ecp';
      return { raw: `GET /query/chanperf\n${perf.text}\n\nGET /query/r2d2-bitmaps\n${bmp.text ?? bmp.error}\n`, ...parsed, ...(bmp.text ? parseEcpBitmaps(bmp.text) : {}) };
    }
    if (perfSource === 'ecp') return { raw: `GET /query/chanperf: ${perf.error ?? perf.text}`, running: null, note: `ECP ${perf.error ?? 'unreadable'}` };
    ecpError = perf.error ?? 'unreadable';
  }
  const perfText = await console8080('chanperf');
  const bmpText = await console8080('r2d2_bitmaps', 2500);
  const parsed = parseChanperf(perfText);
  if (parsed.memKiB != null) {
    perfSource = 'telnet';
    return { raw: `$ chanperf\n${perfText}\n\n$ r2d2_bitmaps\n${bmpText}\n`, ...parsed, ...parseBitmaps(bmpText) };
  }
  return { raw: `ECP query/chanperf: ${ecpError}; developer console: ${perfText.trim() || 'no answer'}`, running: null, note: `ECP ${ecpError}, port 8080 busy or no answer` };
}

// The BrightScript console for the whole run: a crash or a STOP shows up here.
const crashes = [];
const consoleLog = createWriteStream(join(dir, 'console.log'));
let consoleTail = '';
let consoleSocket = null;
let ending = false;
function openConsole() {
  consoleSocket = net.connect(8085, host);
  consoleSocket.on('data', (d) => {
    const chunk = d.toString();
    consoleLog.write(chunk);
    consoleTail = (consoleTail + chunk).slice(-20000);
    if (/BrightScript Debugger>|Brightscript Debugger>|BRIGHTSCRIPT: ERROR: Runtime|Backtrace:|EXIT_BRIGHTSCRIPT_CRASH/.test(chunk)) {
      const at = (Date.now() - started.getTime()) / 60000;
      if (!crashes.length || at - crashes[crashes.length - 1].atMin > 1) {
        crashes.push({ atMin: at, excerpt: consoleTail.slice(-3000) });
        say(`CRASH or debugger stop at ${at.toFixed(1)} min — see console.log`);
      }
    }
  });
  consoleSocket.on('error', () => {});
  consoleSocket.on('close', () => { if (!ending) setTimeout(openConsole, 5000); });
}
openConsole();

// --- Device and run ----------------------------------------------------------------------

const info = await ecp('/query/device-info');
const device = info.text ? {
  model: `${tag(info.text, 'model-name') ?? '?'} ${tag(info.text, 'model-number') ?? ''}`.trim(),
  os: `${tag(info.text, 'software-version') ?? '?'} build ${tag(info.text, 'software-build') ?? '?'}`,
  display: `${tag(info.text, 'ui-resolution') ?? '?'} UI`,
  network: tag(info.text, 'network-type') ?? '?',
} : { model: `unknown (ECP ${info.error})`, os: '?', display: '?', network: '?' };

const samples = [];
const shots = [];

async function sample() {
  const atMin = (Date.now() - started.getTime()) / 60000;
  const { raw, ...perf } = await readPerf();
  const active = await ecp('/query/active-app');
  const s = {
    atMin,
    time: new Date().toISOString(),
    ...perf,
    activeApp: active.text ? (tag(active.text, 'app') ?? '?') : `ECP ${active.error}`,
    screensaver: active.text ? /<screensaver/.test(active.text) : null,
  };
  if (s.memKiB == null && !s.note) s.note = (raw.trim().split('\n').pop() || 'no answer').slice(0, 160);
  samples.push(s);
  writeFileSync(join(dir, 'samples.json'), JSON.stringify(samples, null, 1));
  writeFileSync(join(dir, 'perf-last.txt'), raw);
  say(`mem ${s.memKiB != null ? (s.memKiB / 1024).toFixed(1) + ' MiB' : '—'} · cpu ${s.cpu ?? '—'}% · textures ${s.texUsed != null ? (s.texUsed / 1048576).toFixed(1) + ' MiB' : '—'} · ${s.activeApp}${s.screensaver ? ' · SCREENSAVER' : ''}`);
}

async function shoot() {
  const atMin = (Date.now() - started.getTime()) / 60000;
  try {
    const file = await rokuDeploy.takeScreenshot({ host, password, outDir: dir });
    const ext = file.split('.').pop();
    const name = `shot-${String(Math.round(atMin)).padStart(4, '0')}min.${ext}`;
    renameSync(file, join(dir, name));
    shots.push({ atMin, file: name, sha: sha256(join(dir, name)) });
  } catch (e) {
    shots.push({ atMin, file: null, error: e.message });
  }
}

// --- The report --------------------------------------------------------------------------

function analyse() {
  const mem = samples.filter((s) => s.memKiB != null);
  const after = mem.filter((s) => s.atMin >= warmupMins);
  const fit = (pts) => {
    if (pts.length < 3) return null;
    const n = pts.length;
    const mx = pts.reduce((a, p) => a + p.atMin, 0) / n;
    const my = pts.reduce((a, p) => a + p.memKiB, 0) / n;
    const sxy = pts.reduce((a, p) => a + (p.atMin - mx) * (p.memKiB - my), 0);
    const sxx = pts.reduce((a, p) => a + (p.atMin - mx) ** 2, 0);
    return sxx ? (sxy / sxx) * 60 / 1024 : null; // MiB per hour
  };
  const mib = (k) => (k == null ? null : k / 1024);
  const ran = samples.length ? samples[samples.length - 1].atMin : 0;
  const notRunning = samples.filter((s) => s.running === false || (s.activeApp && !/dev|SolPersona/i.test(s.activeApp) && !s.activeApp.startsWith('ECP')));
  const saver = samples.filter((s) => s.screensaver);
  const slope = fit(after);
  const distinct = new Set(shots.filter((s) => s.sha).map((s) => s.sha)).size;
  const checks = [
    { name: 'No crash or debugger stop', ok: crashes.length === 0, detail: crashes.length ? `${crashes.length} — see console.log` : 'console clean' },
    { name: 'Channel in front at every sample', ok: notRunning.length === 0, detail: notRunning.length ? `${notRunning.length} samples elsewhere` : `${samples.length} samples` },
    { name: 'Memory steady after warm-up (< 2 MiB/hour growth)', ok: slope != null && slope < 2, detail: slope == null ? 'not enough samples' : `${slope >= 0 ? '+' : ''}${slope.toFixed(2)} MiB/hour` },
    { name: 'The wall changes (screenshots differ)', ok: distinct > 1 || shots.length < 2, detail: `${distinct} different of ${shots.filter((s) => s.sha).length}` },
    { name: 'No screensaver over the art', ok: saver.length === 0, warnOnly: true, detail: saver.length ? `seen in ${saver.length} samples — disable it on the Roku (README)` : 'not seen' },
  ];
  return {
    ran, checks, slope, distinct,
    memStart: mib(after[0]?.memKiB ?? mem[0]?.memKiB), memEnd: mib(mem[mem.length - 1]?.memKiB),
    memMax: mib(Math.max(...mem.map((s) => s.memKiB))), memMin: mib(Math.min(...mem.map((s) => s.memKiB))),
    cpuAvg: mem.length ? mem.reduce((a, s) => a + (s.cpu ?? 0), 0) / mem.length : null,
    texMax: Math.max(0, ...samples.map((s) => s.texUsed ?? 0)) / 1048576,
    pass: checks.every((c) => c.ok || c.warnOnly),
  };
}

function chart() {
  const pts = samples.filter((s) => s.memKiB != null);
  if (pts.length < 2) return '<p>Not enough memory samples for a chart.</p>';
  const W = 900, H = 260, P = 40;
  const xs = pts.map((p) => p.atMin), ys = pts.map((p) => p.memKiB / 1024);
  const x0 = 0, x1 = Math.max(...xs, 1);
  const y0 = Math.floor(Math.min(...ys) * 0.9), y1 = Math.ceil(Math.max(...ys) * 1.05);
  const X = (v) => P + ((v - x0) / (x1 - x0)) * (W - 2 * P);
  const Y = (v) => H - P - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * P);
  const line = pts.map((p) => `${X(p.atMin).toFixed(1)},${Y(p.memKiB / 1024).toFixed(1)}`).join(' ');
  const warm = X(Math.min(warmupMins, x1));
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Channel memory over time">
  <rect x="${P}" y="${P}" width="${(warm - P).toFixed(1)}" height="${H - 2 * P}" fill="var(--warm)"/>
  <line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="var(--rule)"/>
  <line x1="${P}" y1="${P}" x2="${P}" y2="${H - P}" stroke="var(--rule)"/>
  <text x="${P - 6}" y="${Y(y1) + 4}" text-anchor="end">${y1}</text>
  <text x="${P - 6}" y="${Y(y0) + 4}" text-anchor="end">${y0}</text>
  <text x="${W - P}" y="${H - P + 18}" text-anchor="end">${(x1 / 60).toFixed(1)} h</text>
  <text x="${P}" y="${H - P + 18}">0</text>
  <text x="${P + 4}" y="${P - 8}">MiB (shaded: warm-up)</text>
  <polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${line}"/>
</svg>`;
}

const fmt = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));
const hm = (min) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function writeReport(final) {
  const a = analyse();
  const verdict = !final ? 'IN PROGRESS' : a.pass ? 'PASS' : 'FAIL';
  const buildRows = [
    ['Channel version', build.version],
    ['Commit', `${build.commit}${build.dirty ? ' (uncommitted changes!)' : ''}`],
    ['Zip SHA-256', build.zipSha],
    ['Signed package SHA-256', build.pkgSha ?? 'not signed (--no-package)'],
    ['Roku', device.model],
    ['Roku OS', device.os],
    ['UI / network', `${device.display} · ${device.network}`],
    ['Started', started.toLocaleString()],
    ['Ran for', `${hm(a.ran)} of ${hm(minutes)} planned`],
    ['Sampling', `${perfSource === 'ecp' ? 'ECP query/chanperf' : perfSource === 'telnet' ? 'developer console chanperf' : 'memory unreadable'} · memory every ${memMins} min · screenshot every ${shotMins} min · warm-up ${warmupMins} min`],
  ];
  const memRows = [
    ['Memory after warm-up', `${fmt(a.memStart)} MiB`],
    ['Memory at the end', `${fmt(a.memEnd)} MiB`],
    ['Min / max', `${fmt(a.memMin)} / ${fmt(a.memMax)} MiB`],
    ['Trend after warm-up', a.slope == null ? '—' : `${a.slope >= 0 ? '+' : ''}${fmt(a.slope, 2)} MiB/hour`],
    ['Average CPU', a.cpuAvg == null ? '—' : `${fmt(a.cpuAvg, 0)} %`],
    ['Peak texture memory', a.texMax ? `${fmt(a.texMax)} MiB` : '—'],
  ];

  const md = [
    `# SolPersona Gallery — soak test: ${verdict}`, '',
    ...buildRows.map(([k, v]) => `- **${k}:** ${v}`), '',
    '## Checks', '', '| Check | Result | Detail |', '|---|---|---|',
    ...a.checks.map((c) => `| ${c.name} | ${c.ok ? '✅' : c.warnOnly ? '⚠️' : '❌'} | ${c.detail} |`), '',
    '## Memory', '', ...memRows.map(([k, v]) => `- **${k}:** ${v}`), '',
    '## Samples', '', '| Time | Memory MiB | CPU % | Textures MiB | In front |', '|---|---|---|---|---|',
    ...samples.map((s) => `| ${hm(s.atMin)} | ${fmt(s.memKiB / 1024)} | ${s.cpu ?? '—'} | ${s.texUsed != null ? fmt(s.texUsed / 1048576) : '—'} | ${s.activeApp}${s.screensaver ? ' (screensaver)' : ''}${s.note ? ` — ${s.note}` : ''} |`), '',
    '## Screenshots', '', ...shots.map((s) => s.file ? `- ${hm(s.atMin)}: ![${hm(s.atMin)}](${s.file})` : `- ${hm(s.atMin)}: failed (${s.error})`), '',
    crashes.length ? '## Crashes\n\n' + crashes.map((c) => `### At ${hm(c.atMin)}\n\n\`\`\`\n${c.excerpt}\n\`\`\``).join('\n\n') : '', '',
  ].join('\n');
  writeFileSync(join(dir, 'report.md'), md);

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Roku Soak Report</title>
<style>
:root{--bg:#fafaf8;--fg:#1b1b1b;--muted:#666;--rule:#d8d8d2;--accent:#2f6fde;--warm:#ececE6;--ok:#1d7a3a;--bad:#b42318;--warn:#a15c00}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#121212;--fg:#ececec;--muted:#9a9a9a;--rule:#333;--accent:#7aa7ff;--warm:#1f1f1f;--ok:#5fd08a;--bad:#ff7b72;--warn:#e3a33b}}
:root[data-theme="dark"]{--bg:#121212;--fg:#ececec;--muted:#9a9a9a;--rule:#333;--accent:#7aa7ff;--warm:#1f1f1f;--ok:#5fd08a;--bad:#ff7b72;--warn:#e3a33b}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0 auto;max-width:1000px;padding:24px 16px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 8px;border-bottom:1px solid var(--rule);padding-bottom:4px}
.verdict{font-weight:700;color:${verdict === 'PASS' ? 'var(--ok)' : verdict === 'FAIL' ? 'var(--bad)' : 'var(--warn)'}}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{border-bottom:1px solid var(--rule);padding:4px 8px;text-align:left;vertical-align:top}
th{color:var(--muted);font-weight:600}.mono{font-family:ui-monospace,monospace;word-break:break-all}
.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}
svg{width:100%;height:auto}svg text{fill:var(--muted);font-size:12px}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.shots figure{margin:0}.shots img{width:100%;border:1px solid var(--rule)}.shots figcaption{font-size:12px;color:var(--muted)}
pre{white-space:pre-wrap;font-size:12px;background:var(--warm);padding:8px;overflow-x:auto}
.scroll{overflow-x:auto}
</style></head><body>
<h1>SolPersona Gallery — soak test</h1>
<p class="verdict">${verdict}</p>
<table>${buildRows.map(([k, v]) => `<tr><th>${esc(k)}</th><td class="${/SHA|Commit/.test(k) ? 'mono' : ''}">${esc(v)}</td></tr>`).join('')}</table>
<h2>Checks</h2>
<table><tr><th>Check</th><th>Result</th><th>Detail</th></tr>${a.checks.map((c) => `<tr><td>${esc(c.name)}</td><td class="${c.ok ? 'ok' : c.warnOnly ? 'warn' : 'bad'}">${c.ok ? 'pass' : c.warnOnly ? 'warning' : 'fail'}</td><td>${esc(c.detail)}</td></tr>`).join('')}</table>
<h2>Memory</h2>
${chart()}
<table>${memRows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
<h2>Screenshots</h2>
<p>Roku screenshots leave the video plane out: a film shows as black.</p>
<div class="shots">${shots.map((s) => s.file ? `<figure><img src="${s.file}" alt="Screen at ${hm(s.atMin)}" loading="lazy"><figcaption>${hm(s.atMin)}</figcaption></figure>` : `<figure><figcaption>${hm(s.atMin)}: failed (${esc(s.error)})</figcaption></figure>`).join('')}</div>
${crashes.length ? `<h2>Crashes</h2>${crashes.map((c) => `<h3>At ${hm(c.atMin)}</h3><pre>${esc(c.excerpt)}</pre>`).join('')}` : ''}
<h2>Samples</h2>
<div class="scroll"><table><tr><th>Time</th><th>Memory MiB</th><th>CPU %</th><th>Textures MiB</th><th>In front</th></tr>
${samples.map((s) => `<tr><td>${hm(s.atMin)}</td><td>${fmt(s.memKiB / 1024)}</td><td>${s.cpu ?? '—'}</td><td>${s.texUsed != null ? fmt(s.texUsed / 1048576) : '—'}</td><td>${esc(s.activeApp)}${s.screensaver ? ' <span class="warn">(screensaver)</span>' : ''}${s.note ? ` — ${esc(s.note)}` : ''}</td></tr>`).join('')}</table></div>
<p>Raw data: samples.json, console.log (BrightScript console), perf-last.txt (the last memory query as the Roku answered it).</p>
</body></html>`;
  writeFileSync(join(dir, 'report.html'), html);
  return a;
}

// --- Run ---------------------------------------------------------------------------------

async function finish(reason) {
  if (ending) return;
  ending = true;
  say(`Finishing (${reason}).`);
  const a = writeReport(true);
  consoleSocket?.destroy();
  consoleLog.end();
  say(`${a.pass ? 'PASS' : 'FAIL'} — report: ${join(dir, 'report.html')}`);
  process.exit(a.pass ? 0 : 1);
}
process.on('SIGINT', () => finish('stopped early'));

say(`Soak: ${hm(minutes)} on ${device.model} (${device.os}). Results in ${dir}`);
await sleep(15000); // let the channel start after install

// Without memory figures the run proves little: say how to fix it and stop.
const first = await readPerf();
if (first.memKiB == null && !opts['allow-no-memory']) {
  ending = true;
  consoleSocket?.destroy();
  writeFileSync(join(dir, 'perf-last.txt'), first.raw);
  console.error(`
The Roku will not report the channel's memory (${first.note ?? 'no answer'}).
Close any other telnet session to ${host}:8080 (the Roku takes one), or turn on
Settings → System → Advanced system settings → Control by mobile apps →
Network access → Permissive, then run again. (--allow-no-memory runs anyway.)`);
  process.exit(2);
}
const endAt = started.getTime() + minutes * 60000;
let nextMem = Date.now();
let nextShot = Date.now();
while (Date.now() < endAt && !ending) {
  if (Date.now() >= nextMem) { await sample(); nextMem += memMins * 60000; writeReport(false); }
  if (Date.now() >= nextShot) { await shoot(); nextShot += shotMins * 60000; writeReport(false); }
  await sleep(5000);
}
await sample();
await shoot();
await finish('time is up');
