// CWK-133 + CWK-136 -- a cheap TEXTUAL census of every spawnSync('git', ...) /
// execFileSync('git', ...) call under scripts/ (CoalTipple's shape, adopted as the
// exemplar). Two rungs, each a finding:
//   1. PRESENCE (CWK-133): the call carries an explicit `env:` -- a git spawn with no env
//      inherits process.env, including the ABSOLUTE GIT_DIR a linked-worktree hook exports.
//   2. SAFETY (CWK-136): an `env:` is not safe just because it is there. `env: process.env`
//      or `env: { ...process.env, ... }` passes rung 1 and re-opens the same hazard, so a
//      call whose text holds `process.env` without the room's GIT_*-stripping helper
//      (`gitEnv(`) is refused.
// This is a textual heuristic, never a JS parser and never proof that the env is safe: an
// `env:` built into a VARIABLE elsewhere (`const e = { ...process.env }` then `env: e`) is
// out of its sight, and so is a spread that overrides `env` after gitEnv (`...opts`). The
// helper's own correctness is git-env.test.mjs's job.
//
// censusGitSpawns() is pure (a fixture list in, a findings array out) so it is unit-tested
// red-first without a repo clone; collectScriptsMjs() is the real filesystem walk.
import fs from 'node:fs';
import path from 'node:path';

const CALL_RE = /(spawnSync|execFileSync)\(\s*['"]git['"]/g;

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

export function censusGitSpawns(files) {
  const findings = [];
  for (const { rel, text } of files) {
    CALL_RE.lastIndex = 0;
    let m;
    while ((m = CALL_RE.exec(text))) {
      if (isInLineComment(text, m.index)) continue;
      const line = text.slice(0, m.index).split('\n').length;
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
