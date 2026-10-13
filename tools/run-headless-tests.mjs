// Builds the Rooibos test package and runs it without a Roku, in brs-node (the
// BrightScript Simulation Engine, with its SceneGraph extension). Exits 0 only
// when every suite passes. The same package runs on a device: `make test-device`.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const bin = (name) => join(root, 'node_modules', '.bin', name);
const zip = join(root, 'build', 'solpersona-gallery-roku-tests.zip');

const build = spawnSync(bin('bsc'), ['--project', 'bsconfig.test.json'], { cwd: root, encoding: 'utf8' });
process.stdout.write(build.stdout.split('\n').filter((l) => / - (error|warning)/.test(l)).join('\n'));
if (build.status !== 0 || !existsSync(zip)) {
  console.error(build.stdout, build.stderr);
  console.error('\nThe test package did not build.');
  process.exit(1);
}

const child = spawn(bin('brs-cli'), [zip, '-c', '0'], { cwd: root });
let out = '';
let verdict = null;
const timer = setTimeout(() => { verdict = verdict ?? 'timeout'; child.kill('SIGKILL'); }, 180000);

function scan(chunk) {
  const text = chunk.toString().replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
  out += text;
  if (/\[Rooibos Result\]: PASS|RESULT: Success/.test(out)) verdict = 'pass';
  else if (/\[Rooibos Result\]: FAIL|RESULT: Fail|EXIT_BRIGHTSCRIPT_CRASH/.test(out)) verdict = 'fail';
  if (verdict && /\[Rooibos Shutdown\]|EXIT_/.test(out)) child.kill('SIGKILL');
}
child.stdout.on('data', scan);
child.stderr.on('data', scan);
child.on('close', () => {
  clearTimeout(timer);
  // Only the report: the suites, their tests, and the totals.
  const lines = out.split('\n').filter((l) => /\|--|Total:|Passed:|Failed:|Crashed:|Ignored:|RESULT|Message|Crashed at|Rooibos Result|^\s{2}\S.*spec\.bs/.test(l));
  console.log(lines.join('\n'));
  if (verdict !== 'pass') {
    if (verdict === 'timeout') console.error('\nThe test run did not finish in time.');
    if (!lines.length) console.error(out);
    process.exit(1);
  }
});
