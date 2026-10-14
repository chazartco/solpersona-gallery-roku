// Talks to a Roku in developer mode. Configuration comes from the environment
// (or a git-ignored .env file in the repo root) — never from this repo:
//
//   ROKU_IP=192.168.1.40           the Roku's address (Settings → Network → About)
//   ROKU_PASSWORD=…                the developer-mode web password you chose
//   ROKU_SIGNING_PASSWORD=…        from `genkey` on that Roku (package only)
//
//   node tools/roku.mjs sideload [zip]     install a zip as the dev channel
//   node tools/roku.mjs test               install the test build, print Rooibos' report
//   node tools/roku.mjs screenshot [file]  save what the TV shows now (PNG/JPG)
//   node tools/roku.mjs package            sign build/…zip into a .pkg for the Channel Store
//   node tools/roku.mjs debug              stream the BrightScript console (port 8085)

import { existsSync, readFileSync, renameSync } from 'node:fs';
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

const host = process.env.ROKU_IP;
const password = process.env.ROKU_PASSWORD;
const need = (value, name) => {
  if (!value) {
    console.error(`Set ${name} (environment or .env). See README → Sideload.`);
    process.exit(2);
  }
  return value;
};

const rokuDeploy = new RokuDeploy();
const [command = 'help', arg] = process.argv.slice(2);

async function sideload(zipPath) {
  const zip = zipPath || join(root, 'build', 'solpersona-gallery-roku.zip');
  if (!existsSync(zip)) need(null, `a built zip at ${zip} (run make zip)`);
  const outDir = join(root, 'build');
  const outFile = zip.split('/').pop();
  await rokuDeploy.publish({ host: need(host, 'ROKU_IP'), password: need(password, 'ROKU_PASSWORD'), outDir, outFile, retainDeploymentArchive: true });
  console.log(`Installed ${outFile} on ${host}.`);
}

/** Reads the BrightScript console until `until` matches (or forever). */
function consoleStream(until, timeoutMs) {
  return new Promise((resolve) => {
    let text = '';
    const socket = net.connect(8085, need(host, 'ROKU_IP'));
    const done = (ok) => { socket.destroy(); resolve({ ok, text }); };
    const timer = timeoutMs ? setTimeout(() => done(false), timeoutMs) : null;
    socket.on('data', (d) => {
      const chunk = d.toString();
      process.stdout.write(chunk);
      text += chunk;
      if (until && until.test(text)) { if (timer) clearTimeout(timer); done(true); }
    });
    socket.on('error', (e) => { console.error(e.message); done(false); });
  });
}

switch (command) {
  case 'sideload':
    await sideload(arg);
    break;
  case 'test': {
    const reading = consoleStream(/\[Rooibos Result\]: (PASS|FAIL)/, 300000);
    await sideload(join(root, 'build', 'solpersona-gallery-roku-tests.zip'));
    const { text } = await reading;
    process.exit(/\[Rooibos Result\]: PASS/.test(text) ? 0 : 1);
    break;
  }
  case 'debug':
    await consoleStream(null, 0);
    break;
  case 'screenshot': {
    const file = await rokuDeploy.takeScreenshot({ host: need(host, 'ROKU_IP'), password: need(password, 'ROKU_PASSWORD'), outDir: join(root, 'build', 'screenshots') });
    const target = arg ? join(root, arg) : file;
    if (arg) renameSync(file, target);
    console.log(`Saved ${target}`);
    break;
  }
  case 'package': {
    // The signing key lives on the Roku (genkey); this asks it to sign the
    // zip and downloads the .pkg. The password never enters the repo.
    await sideload();
    const signingPassword = need(process.env.ROKU_SIGNING_PASSWORD, 'ROKU_SIGNING_PASSWORD');
    const remote = await rokuDeploy.signExistingPackage({ host, password, signingPassword, stagingDir: join(root, 'build', 'staging') });
    const local = await rokuDeploy.retrieveSignedPackage(remote, { host, password, outDir: join(root, 'build'), outFile: 'solpersona-gallery-roku' });
    console.log(`Signed package: ${local}`);
    break;
  }
  default:
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 14).join('\n'));
}
