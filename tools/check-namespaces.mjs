// Guards against a BrighterScript trap: inside `namespace X`, a bare
// identifier that matches (case-insensitively) a function or const of the same
// namespace is rewritten to that member — so a parameter called `target` in a
// namespace with a `target()` function, or `w` beside a `const W`, silently
// becomes the function reference or the constant. bsc does not warn.
//
// This finds every bare, non-call use of a sibling member's name inside a
// namespace block. Run: node tools/check-namespaces.mjs (exit 1 on findings).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const dirs = ['source', 'components', 'tests'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.bs')) out.push(p);
  }
  return out;
}

/** The line without its comment and with string contents blanked. */
function code(line) {
  let out = '';
  let inString = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') { inString = !inString; out += c; continue; }
    if (inString) { out += ' '; continue; }
    if (c === "'") break;
    out += c;
  }
  return out;
}

let findings = 0;
for (const file of dirs.flatMap((d) => walk(join(root, d)))) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let ns = null;
  let members = null;
  let start = 0;
  let inClass = false;
  const blocks = [];
  lines.forEach((raw, i) => {
    const line = code(raw).trim();
    const open = /^namespace\s+([\w.]+)/i.exec(line);
    if (open) { ns = open[1]; members = new Set(); start = i; return; }
    if (/^end\s+namespace/i.test(line) && ns) { blocks.push({ ns, members, start, end: i }); ns = null; return; }
    if (!ns) return;
    // Class methods are not namespace members.
    if (/^(?:public\s+|private\s+)?class\s/i.test(line)) { inClass = true; return; }
    if (/^end\s+class/i.test(line)) { inClass = false; return; }
    if (inClass) return;
    const decl = /^(?:function|sub)\s+(\w+)/i.exec(line) || /^const\s+(\w+)/i.exec(line);
    if (decl) members.add(decl[1].toLowerCase());
    // A CONSTANT used by its exact upper-case name is meant; only a
    // differently-cased local (w beside const W) is the trap.
    const constDecl = /^const\s+(\w+)/i.exec(line);
    if (constDecl && /^[A-Z0-9_]+$/.test(constDecl[1])) (members.exactConsts ??= new Set()).add(constDecl[1]);
  });
  for (const block of blocks) {
    for (let i = block.start + 1; i < block.end; i += 1) {
      const line = code(lines[i]);
      const decl = /^\s*(?:function|sub|const)\s+(\w+)/i.exec(line);
      const re = /(^|[^\w.])([A-Za-z_]\w*)(\s*)([(:]?)/g;
      let m;
      while ((m = re.exec(line))) {
        const name = m[2];
        const lower = name.toLowerCase();
        if (!block.members.has(lower)) continue;
        if (block.members.exactConsts?.has(name)) continue;
        if (decl && decl[1] === name && m.index <= decl.index + decl[0].length) continue;
        if (m[4] === '(' || m[4] === ':') continue; // a call, or an AA key: fine
        console.log(`${relative(root, file)}:${i + 1}: '${name}' resolves to ${block.ns}.${name} inside namespace ${block.ns}`);
        findings += 1;
      }
    }
  }
}
if (findings) {
  console.log(`\n${findings} identifier(s) shadowed by namespace members — rename them.`);
  process.exit(1);
}
console.log('namespaces: no shadowed identifiers');
