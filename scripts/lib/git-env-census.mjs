// CWK-133 + CWK-136 -- a cheap TEXTUAL census of every call under scripts/ that runs git
// (CoalTipple's shape, adopted as the exemplar, widened at R8 INSPECT LOW-2). Two families:
//
//   ARGV forms -- spawn / spawnSync / execFile / execFileSync ('git', ...). Two rungs:
//   1. PRESENCE (CWK-133): the call carries an explicit `env:` -- a git spawn with no env
//      inherits process.env, including the ABSOLUTE GIT_DIR a linked-worktree hook exports.
//   2. SAFETY (CWK-136): an `env:` is not safe just because it is there. `env: process.env`
//      or `env: { ...process.env, ... }` passes rung 1 and re-opens the same hazard, so a
//      call whose text holds `process.env` without the room's GIT_*-stripping helper
//      (`gitEnv(`) is refused.
//
//   SHELL forms -- exec / execSync ('git ...' or `git ...`). 3. SHELL (R8 LOW-2): refused
//      outright, with or without gitEnv(). A shell string is a second interpreter between
//      us and git (security.md: argv arrays, never a shell string), and the env rungs cannot
//      make it safe. Use spawnSync/execFileSync with an argv array and env: gitEnv(...).
//
// This is a textual heuristic, never a JS parser and never proof that the env is safe.
// BLIND SPOTS, named (a clean pass does not cover them; 0 instances in this room today):
//   - an `env:` built into a VARIABLE elsewhere (`const e = { ...process.env }` then `env: e`);
//   - a spread that overrides `env` AFTER gitEnv (`{ env: gitEnv(x), ...opts }`);
//   - a git command held in a VARIABLE (`const G = 'git'; spawnSync(G, ...)`) or passed
//     through a wrapper (`spawnSandboxed(cmd, ...)` in test-sandbox.mjs spreads process.env
//     for whatever `cmd` it is given -- every caller passes process.execPath today);
//   - scope: scripts/**/*.mjs only -- .js/.cjs/.ps1 are not read (hooks/ spawns nothing,
//     Phoenix #5; the .ps1 tests' `.git` is a New-Item marker, no git process).
// The helper's own correctness is git-env.test.mjs's job.
//
// censusGitSpawns() is pure (a fixture list in, a findings array out) so it is unit-tested
// red-first without a repo clone; collectScriptsMjs() is the real filesystem walk.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ARGV_RE = /\b(spawn|spawnSync|execFile|execFileSync)\(\s*['"]git['"]/g;
const SHELL_RE = /\b(exec|execSync)\(\s*['"`]git\b/g;

// A match on the same line as an EARLIER `//` is inside a line comment -- skipped. It can
// under-detect (a `//` inside an earlier string on the same line), never report a comment
// as code: the safer failure direction for a gate landing on a densely commented tree.
function isInLineComment(text, matchIndex) {
  const lineStart = text.lastIndexOf('\n', matchIndex) + 1;
  return text.slice(lineStart, matchIndex).includes('//');
}

function findMatchingClose(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function* matches(re, text) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    if (!isInLineComment(text, m.index)) yield { m, line: text.slice(0, m.index).split('\n').length };
  }
}

// R13 / CWK-174 -- the house secret scan arrives as byte-equal copies of the published-code template
// (SERIES-CANON "Secret scan": the scanner and its test byte-equal in every carrier, a parity check measures
// it), so this room cannot route their git spawns through gitEnv() without breaking that parity. They are
// exempt here ONLY while their content is exactly the pinned blob: any edit, or a template re-sync that
// changes them, makes the entry a finding again ("re-derive"), so the exemption cannot widen or outlive its
// reason silently. The pinned ids are git blob ids (git hash-object <file>) measured 2026-10-02 against
// .github/templates/published-code/scripts/. Raised to the owner of the template: its fixtures spread
// process.env into git (the CWK-133 hazard in a linked-worktree hook) and the caller's own spawns inherit it.
export const EXEMPT_CARRIERS = {
  'scripts/secret-gate.mjs': '70954815563c6067cdd233e78f8ea24103027ede',
  'scripts/secret-gate.test.mjs': 'efea22993b15d0a1f0a89632b5661514b775bb88',
  'scripts/secret-scan.test.mjs': 'a9cb7145e31139ec3c490dd7714df8fa7dc6cf86',
};

// The git blob id of `text`, as `git hash-object` would print it for a file holding exactly these bytes.
export function blobId(text) {
  const body = Buffer.from(text, 'utf8');
  return createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + body.length + String.fromCharCode(0)), body])).digest('hex');
}

export function censusGitSpawns(files, exempt = EXEMPT_CARRIERS) {
  const findings = [];
  for (const { rel, text } of files) {
    if (Object.hasOwn(exempt, rel)) {
      const id = blobId(text);
      if (id === exempt[rel]) continue;
      findings.push(`${rel} is an exempt byte-equal org carrier but its blob id is ${id}, not the pinned ${exempt[rel]} -- re-derive it from .github/templates/published-code/scripts/ (CWK-174)`);
      continue;
    }
    for (const { m, line } of matches(ARGV_RE, text)) {
      const openIdx = text.indexOf('(', m.index);
      const closeIdx = findMatchingClose(text, openIdx);
      if (closeIdx === -1) {
        findings.push(`${rel}:${line} unbalanced parens scanning a ${m[1]}('git', ...) call -- the census cannot verify it`);
        continue;
      }
      const callText = text.slice(openIdx, closeIdx + 1);
      if (!/\benv\s*:/.test(callText)) {
        findings.push(`${rel}:${line} ${m[1]}('git', ...) carries no 'env:' -- route it through gitEnv() (CWK-133)`);
      } else if (/\bprocess\.env\b/.test(callText) && !/\bgitEnv\s*\(/.test(callText)) {
        findings.push(`${rel}:${line} ${m[1]}('git', ...) passes process.env without gitEnv() -- the GIT_* family is inherited (CWK-136)`);
      }
    }
    for (const { m, line } of matches(SHELL_RE, text)) {
      findings.push(`${rel}:${line} ${m[1]}('git ...') runs git through a shell string -- use spawnSync/execFileSync with an argv array and env: gitEnv(...) (CWK-136, R8)`);
    }
  }
  return findings;
}

// scripts/**/*.mjs, `rel` relative to `repo` with forward slashes.
export function collectScriptsMjs(repo) {
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.mjs')) files.push({ rel: path.relative(repo, p).split(path.sep).join('/'), text: fs.readFileSync(p, 'utf8') });
    }
  })(path.join(repo, 'scripts'));
  return files;
}
