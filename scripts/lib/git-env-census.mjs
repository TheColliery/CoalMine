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
//   - keepUserConfig (R14 bounce LOW-1) is judged on the spawn call's own text, so an `env` built into a variable
//     elsewhere escapes it, the same blind spot as the first bullet;
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

// 08c, rule (a) (main's ruling UMB-456 (2)): an ALLOWLIST env is the other safe shape. It picks NAMED keys out of process.env and
// never spreads or copies the whole object, so no GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE a hook exports can come through. Three
// conditions, all required, judged on the env object's text:
//   1. no BARE process.env in it (a spread, Object.assign, the whole object): `process.env[k]` and `process.env.NAME` reads are fine;
//   2. it carries GIT_CONFIG_NOSYSTEM: '1' (the canon sets it so the system git config is never read);
//   3. the FILE names no GIT_* identifier beyond the three the canon uses (GIT_CONFIG_NOSYSTEM, GIT_TERMINAL_PROMPT,
//      GIT_CEILING_DIRECTORIES, which only narrows where git searches), a line comment aside. File-wide on purpose: a key
//      list declared above the env (const keep = [...]) is where a GIT_DIR would be smuggled in.
// It applies to an env WRITTEN INLINE in the call (when it reads process.env and the call has no gitEnv()) and to a SHORTHAND
// `env` property whose `const env = { ... }` sits in the same file. NOT covered, named: `env: someVariable` (the old blind spot, the
// presence rung still accepts it), an env built by a call or declared in another file (a shorthand `env` the census cannot read
// stays the 'carries no env:' finding), and a GIT_* key assembled at runtime from string pieces.
const ALLOWED_GIT_NAMES = new Set(['GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT', 'GIT_CEILING_DIRECTORIES']);
const BARE_PROCESS_ENV = /\bprocess\.env\b(?!\s*\[)(?!\.[A-Za-z_$])/;
const NOSYSTEM_ONE = /\bGIT_CONFIG_NOSYSTEM\s*:\s*['"`]1['"`]/;

function findMatching(text, openIdx, open, close) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// The env object text of a call, or null when rule (a) does not apply to it.
function allowlistEnvBody(text, callText) {
  if (/\bgitEnv\s*\(/.test(callText)) return null;
  const colon = /\benv\s*:\s*/.exec(callText);
  if (colon) {
    const at = colon.index + colon[0].length;
    if (callText[at] !== '{') return null;
    const end = findMatching(callText, at, '{', '}');
    const body = end === -1 ? null : callText.slice(at, end + 1);
    return body !== null && /\bprocess\.env\b/.test(body) ? body : null;
  }
  if (!/[{,]\s*env\s*(?=[,}])/.test(callText)) return null;
  const decl = /\b(?:const|let|var)\s+env\s*=\s*\{/.exec(text);
  if (!decl) return null;
  const open = decl.index + decl[0].length - 1;
  const end = findMatching(text, open, '{', '}');
  return end === -1 ? null : text.slice(open, end + 1);
}

// A finding text for an allowlist env that breaks a condition, or null when it holds all three.
function allowlistVerdict(text, body) {
  if (BARE_PROCESS_ENV.test(body)) return "passes process.env without gitEnv() -- the GIT_* family is inherited (CWK-136); an allowlist env picks named keys out of process.env, it never spreads or copies the object (08c)";
  if (!NOSYSTEM_ONE.test(body)) return "builds an allowlist env without GIT_CONFIG_NOSYSTEM: '1' -- the system git config would be read (CWK-136, 08c)";
  for (const { m } of matches(/\bGIT_[A-Z0-9_]+\b/g, text)) {
    if (!ALLOWED_GIT_NAMES.has(m[0])) return `has an allowlist env in a file that names ${m[0]} -- only ${[...ALLOWED_GIT_NAMES].join(', ')} may appear there (CWK-136, 08c)`;
  }
  return null;
}

function* matches(re, text) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    if (!isInLineComment(text, m.index)) yield { m, line: text.slice(0, m.index).split('\n').length };
  }
}

// R13 / CWK-174, narrowed at R14, emptied at 08c: the house secret scan arrives as byte-equal copies of the org canon (SERIES-CANON
// "Secret scan": scanner-parity measures it). A byte-equal org carrier whose git spawn the census cannot read could be exempted by
// PINNING its blob id: exempt ONLY while its content is exactly the pinned blob, so any edit or re-sync makes the entry a finding
// again ("re-derive") and the exemption cannot widen or outlive its reason silently. The pin is a git blob id (git hash-object <file>).
// 08c: BOTH pins this table held are out. scripts/release-notes.mjs (canon f8d998d8) builds an allowlist env and now passes by rule (a)
// above. scripts/secret-scan.test.mjs (Bankfire 4433fb56) no longer needs one: its git spawns take their env from its own gitEnv()
// (a filter of GIT_* out of process.env, passed by name) or a cleaned copy (`env: cleanEnv`, which the presence rung accepts and the
// "env built into a VARIABLE" blind spot above leaves unchecked: it was not verified by this census). The table and the
// mechanism stay, empty, so the next carrier whose spawn the census cannot read is pinned the same way (the exemption tests inject
// their own table). The 08c release of the d7e299c4 hold on scripts/release-notes.test.mjs: the canon fixed the defective assertion
// (its env check failed on macOS and under coverage), and the room holds the canon test, blob 8cf7e5fd, byte for byte.
export const EXEMPT_CARRIERS = {};
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
      // R14 bounce LOW-1: `keepUserConfig` lets GIT_CONFIG_GLOBAL/SYSTEM/NOSYSTEM through, which is right for ONE spawn:
      // the installer's read of the user's core.hooksPath. Any other spawn that asks for it is a finding.
      if (/\bkeepUserConfig\b/.test(callText) && !(rel === 'scripts/install.mjs' && /core\.hooksPath/.test(callText))) {
        findings.push(`${rel}:${line} ${m[1]}('git', ...) passes keepUserConfig -- only the installer's core.hooksPath read in scripts/install.mjs may (R14-N1)`);
      }
      const body = allowlistEnvBody(text, callText);
      if (body !== null) {
        const why = allowlistVerdict(text, body);
        if (why) findings.push(`${rel}:${line} ${m[1]}('git', ...) ${why}`);
      } else if (!/\benv\s*:/.test(callText)) {
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
