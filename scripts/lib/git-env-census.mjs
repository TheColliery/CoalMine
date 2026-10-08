// CWK-133 + CWK-136 -- a cheap TEXTUAL census of every call under scripts/ that runs git
// (CoalTipple's shape, adopted as the exemplar, widened at R8 INSPECT LOW-2, rebuilt at 08d on the census witness list). Two families:
//
//   ARGV forms -- spawn / spawnSync / execFile / execFileSync ('git', ...). Two rungs:
//   1. PRESENCE (CWK-133): the call carries an explicit `env:` -- a git spawn with no env
//      inherits process.env, including the ABSOLUTE GIT_DIR a linked-worktree hook exports.
//   2. SAFETY (CWK-136): an `env:` is not safe just because it is there. The env the spawn RECEIVES must be one of
//      (i)  gitEnv(...) / gitTestEnv(...) alone (the name is trusted, a named limit), or
//      (ii) an ALLOWLIST (08c rule (a), main UMB-456 (2); 08d, the witness list F1-F34 and P1-P6 pinned as probes in git-env-census.test.mjs):
//           an object literal -- written in the call, or reached through a const / let / var binding, a same-file helper
//           whose every return is such a literal, or a spread of one -- that reads process.env one named key at a time
//           (`process.env.X`, `process.env[k]` with k from a literal list of strings), carries `GIT_CONFIG_NOSYSTEM: '1'`
//           exactly once, and names no GIT_* key beyond GIT_CONFIG_NOSYSTEM, GIT_TERMINAL_PROMPT and GIT_CEILING_DIRECTORIES.
//      FAIL CLOSED: what the census cannot read whole is a finding, never a pass. Specifically a finding: any bare process.env
//      anywhere in the file (a spread, an alias, process['env'], `import { env } from 'node:process'`, a destructure); a key list
//      that is not a plain array of string literals or that is mutated after its declaration; a write to the env binding after
//      its declaration; a binding that is a parameter, a destructure or a for-of variable; a second declaration of the same name
//      (every declaration is judged); a helper the file does not define; a computed property key; a duplicated or non-literal
//      GIT_CONFIG_NOSYSTEM; a GIT_* name in any case beyond the three; a GIT_ name assembled from string pieces; an options
//      object that spreads something after `env`.
//
//   SHELL forms -- exec / execSync ('git ...' or `git ...`). 3. SHELL (R8 LOW-2): refused
//      outright, with or without gitEnv(). A shell string is a second interpreter between
//      us and git (security.md: argv arrays, never a shell string), and the env rungs cannot
//      make it safe. Use spawnSync/execFileSync with an argv array and env: gitEnv(...).
//
// Comments are blanked before anything is read (a commented-out NOSYSTEM satisfies nothing); string and regex bodies are
// blanked for the structure scan, so a `process.env` inside a string is not a read. This is a textual heuristic, never a JS parser
// and never proof that the env is safe.
// BLIND SPOTS, named (a clean pass does not cover them):
//   - the name `gitEnv(` / `gitTestEnv(` is trusted wherever it is bound, and a helper's body is judged by its `return` texts only;
//   - a GIT_ name assembled at runtime from pieces other than the string-literal shapes this file looks for;
//   - a template-literal body is not scanned for `${process.env}`;
//   - a git command held in a VARIABLE (`const G = 'git'; spawnSync(G, ...)`) or passed through a wrapper
//     (`spawnSandboxed(cmd, ...)` in test-sandbox.mjs spreads process.env for whatever `cmd` it is given -- every caller passes
//     process.execPath today);
//   - keepUserConfig (R14 bounce LOW-1) is judged on the spawn call's own text;
//   - scope: scripts/**/*.mjs only -- .js/.cjs/.ps1 are not read (hooks/ spawns nothing, Phoenix #5; the .ps1 tests' `.git` is a
//     New-Item marker, no git process).
// A file that only wants the allowlist rule pays for it: a bare process.env anywhere in it, even for another purpose, is a finding.
// The helper's own correctness is git-env.test.mjs's job.
//
// censusGitSpawns() is pure (a fixture list in, a findings array out) so it is unit-tested
// red-first without a repo clone; collectScriptsMjs() is the real filesystem walk.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ARGV_RE = /\b(spawn|spawnSync|execFile|execFileSync)\(\s*['"]git['"]/g;
const SHELL_RE = /\b(exec|execSync)\(\s*['"`]git\b/g;
const ALLOWED_GIT_NAMES = new Set(['GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT', 'GIT_CEILING_DIRECTORIES']);
const MAX_DEPTH = 8;
// A GIT_* name (any case: Windows env names are case-insensitive) beyond the three that only narrow git is a finding wherever the env's keys are read.
const gitNameBad = (name) => (/^git_/i.test(name) && !ALLOWED_GIT_NAMES.has(name.toUpperCase())
  ? `names ${name} in the env -- only ${[...ALLOWED_GIT_NAMES].join(', ')} may appear there (CWK-136, 08c)` : null);

const CHAR_SPACE = ' ';
const isWs = (ch) => ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t';
const esc = (s) => s.replace(/[$.*+?^()[\]{}|\\]/g, '\\$&');

// code: the source with COMMENTS blanked (strings kept, offsets kept). masked: the same with string, template and regex BODIES blanked
// too, so brackets, commas and keywords can be read by structure. A regex literal is told from a division by the previous token.
function scanSource(text) {
  const n = text.length;
  const code = text.split('');
  const masked = text.split('');
  const blank = (arr, a, b) => { for (let k = a; k < b; k++) if (arr[k] !== '\n' && arr[k] !== '\r') arr[k] = CHAR_SPACE; };
  const prevIdx = (i) => { let p = i - 1; while (p >= 0 && isWs(masked[p])) p--; return p; };
  let i = 0;
  if (text.startsWith('#!')) { // a shebang line is a comment to the engine
    const j = text.indexOf('\n');
    i = j < 0 ? n : j;
    blank(code, 0, i); blank(masked, 0, i);
  }
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      let j = text.indexOf('\n', i);
      if (j < 0) j = n;
      blank(code, i, j); blank(masked, i, j); i = j; continue;
    }
    if (c === '/' && d === '*') {
      let j = text.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      blank(code, i, j); blank(masked, i, j); i = j; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== '\n') { if (text[j] === '\\') j++; j++; }
      blank(masked, i + 1, Math.min(j, n)); i = Math.min(j + 1, n); continue;
    }
    if (c === '`') {
      let j = i + 1;
      while (j < n && text[j] !== '`') { if (text[j] === '\\') j++; j++; }
      blank(masked, i + 1, Math.min(j, n)); i = Math.min(j + 1, n); continue;
    }
    if (c === '/') {
      const p = prevIdx(i);
      const pc = p < 0 ? '' : masked[p];
      const afterKeyword = /[A-Za-z]/.test(pc) && /(?:^|[^\w$.])(?:return|typeof|case|in|of|delete|void|throw|new|else|do)$/.test(masked.slice(Math.max(0, p - 10), p + 1).join(''));
      if (p < 0 || '(,=:[!&|?{};+-*%<>~^}'.includes(pc) || afterKeyword) {
        let j = i + 1;
        let inClass = false;
        while (j < n && text[j] !== '\n') {
          const ch = text[j];
          if (ch === '\\') { j += 2; continue; }
          if (ch === '[') inClass = true;
          else if (ch === ']') inClass = false;
          else if (ch === '/' && !inClass) break;
          j++;
        }
        blank(masked, i + 1, Math.min(j, n)); i = Math.min(j + 1, n); continue;
      }
    }
    i++;
  }
  return { code: code.join(''), masked: masked.join('') };
}

const trimRange = (m, s, e) => { while (s < e && isWs(m[s])) s++; while (e > s && isWs(m[e - 1])) e--; return [s, e]; };

// The index of the bracket that closes the one at openIdx (same bracket type only), or -1. One matcher for (), [] and {}.
function findMatching(m, openIdx, open = m[openIdx], close = { '(': ')', '[': ']', '{': '}' }[open]) {
  let depth = 0;
  for (let i = openIdx; i < m.length; i++) {
    if (m[i] === open) depth++;
    else if (m[i] === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// Top-level comma-separated segments of m[s, e), as [a, b) pairs.
function splitTop(m, s, e) {
  const out = [];
  let depth = 0;
  let a = s;
  for (let i = s; i < e; i++) {
    const ch = m[i];
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) { out.push([a, i]); a = i + 1; }
  }
  out.push([a, e]);
  return out;
}

// Where the expression starting at s ends: a depth-0 `;` or `,`, a closing bracket of the enclosing scope, or a depth-0 newline that is not a continuation.
function statementEnd(m, s, limit) {
  let depth = 0;
  for (let i = s; i < limit; i++) {
    const ch = m[i];
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) { if (depth === 0) return i; depth--; }
    else if (depth === 0) {
      if (ch === ';' || ch === ',') return i;
      if (ch === '\n') {
        let a = i - 1;
        while (a >= s && isWs(m[a])) a--;
        if (a < s) continue;
        let b = i + 1;
        while (b < limit && isWs(m[b])) b++;
        const continues = '=+-*/%&|?:<>!(.'.includes(m[a]) || (b < limit && '.?:+-*/%&|<>='.includes(m[b]));
        if (!continues) return i;
      }
    }
  }
  return limit;
}

const GIT_ENV_CALL = /^(?:gitEnv|gitTestEnv)\s*\(/;
const isGitEnvAlone = (m, s, e) => { const mm = GIT_ENV_CALL.exec(m.slice(s, e)); return mm !== null && findMatching(m, s + mm[0].length - 1) === e - 1; };
const IDENT = /^[A-Za-z_$][\w$]*$/;
// `'K' in process.env` only asks whether a key exists, so it is not a read of the object.
const FOR_IN_ENV = /\bfor\s*\(\s*(?:(?:const|let|var)\s+)?[\w$]+\s+in\s+process\s*\.\s*env\b/;
const BARE_ENV = /(?<!\bin\s+)\bprocess\s*\.\s*env\b(?!\s*\[)(?!\s*\.\s*[A-Za-z_$])/;
const BARE_PROCESS_VALUE = /(?<![\w$.])process\b(?!\s*\.\s*[A-Za-z_$])(?!\s*\[)/;

// True when a binding that feeds an env (the env itself or a spread source) is mentioned anywhere but its declaration, a member read (a write is judged apart) and the spawn's own { name } / env: name (a spread's name sits after dots the pattern already skips).
function strayUse(m, name) {
  const re = new RegExp('(?<![\\w$.])' + esc(name) + '(?![\\w$])', 'g');
  const asValue = new RegExp('[{,]\\s*' + esc(name) + '\\s*:\\s*$');
  for (const mm of m.matchAll(re)) {
    const before = m.slice(0, mm.index);
    const after = m.slice(mm.index + name.length);
    if (/\b(?:const|let|var)\s+$/.test(before) && /^\s*=(?![=>])/.test(after)) continue;
    if (/^\s*(?:\.\s*[A-Za-z_$]|\[)/.test(after)) continue;
    if (/[{,]\s*$/.test(before) && /^\s*(?:[,}]|:)/.test(after)) continue;
    if (asValue.test(before) && /^\s*[,}]/.test(after)) continue;
    return true;
  }
  return false;
}

// The reasons the declarations of `name` cannot be read, or that it is written after its declaration.
function bindingHazards(ctx, name) {
  const { masked: m, code } = ctx;
  const q = esc(name);
  const bad = [];
  const paramLists = [
    /\bfunction\b[^(){}]*\(([^()]*)\)/g,
    /\(([^()]*)\)\s*=>/g,
    /(?<![\w$.)\]])([A-Za-z_$][\w$]*)\s*=>/g,
    /\bcatch\s*\(([^()]*)\)/g,
    /(?<![\w$.])(?!if\b|for\b|while\b|switch\b|with\b|catch\b|function\b|return\b)[A-Za-z_$][\w$]*\s*\(([^()]*)\)\s*\{/g,
  ];
  for (const re of paramLists) {
    for (const mm of m.matchAll(re)) {
      if ((mm[1].match(/[A-Za-z_$][\w$]*/g) || []).includes(name)) { bad.push(`binds ${name} as a parameter, which the census cannot follow`); break; }
    }
  }
  if (new RegExp('\\b(?:const|let|var)\\s+' + q + '\\s+(?:of|in)\\b').test(m)) bad.push(`binds ${name} as a loop variable`);
  if (new RegExp('\\b(?:const|let|var)\\s*[\\[{][^=;]*\\b' + q + '\\b[^=;]*[\\]}]\\s*=').test(m)) bad.push(`binds ${name} through a destructure`);
  if (new RegExp('\\bimport\\b[^;]*\\b' + q + '\\b[^;]*\\bfrom\\b').test(code)) bad.push(`binds ${name} through an import`);
  const writes = [
    new RegExp('(?<![\\w$.])' + q + '\\s*(?:\\.\\s*[A-Za-z_$][\\w$]*|\\[[^\\]]*\\])\\s*(?:=(?!=)|\\+=|\\|\\|=|\\?\\?=)'),
    new RegExp('(?<![\\w$.])' + q + '\\s*\\.\\s*(?:push|unshift|splice|fill|copyWithin|pop|shift)\\s*\\('),
    new RegExp('\\bObject\\s*\\.\\s*(?:assign|defineProperty|defineProperties|setPrototypeOf)\\s*\\(\\s*' + q + '\\b'),
    new RegExp('\\bdelete\\s+' + q + '\\b'),
    new RegExp('(?<!\\b(?:const|let|var)\\s)(?<![\\w$.])' + q + '\\s*(?:=(?![=>])|\\+=)'),
  ];
  if (writes.some((re) => re.test(m))) bad.push(`writes to ${name} after its declaration`);
  if (strayUse(m, name)) bad.push(`uses ${name} by a bare reference (an alias, a call argument, Reflect.*, Object(...)), so the object can change where the census cannot see; only its declaration, a member read and the spawn's own env are allowed`);
  return bad;
}

function declarations(ctx, name) {
  const { masked: m } = ctx;
  const re = new RegExp('(?<![\\w$.])(?:const|let|var)\\s+' + esc(name) + '\\s*=(?![=>])', 'g');
  const out = [];
  for (const mm of m.matchAll(re)) {
    const s = mm.index + mm[0].length;
    out.push(trimRange(m, s, statementEnd(m, s, m.length)));
  }
  return out;
}

// An array literal of plain string literals, or a reason it is not.
function stringArrayProblems(ctx, s, e) {
  const { masked: m, code } = ctx;
  if (m[s] !== '[' || findMatching(m, s) !== e - 1) return ['has a key list that is not an array literal'];
  for (const [a, b] of splitTop(m, s + 1, e - 1)) {
    const [x, y] = trimRange(m, a, b);
    if (x >= y) continue;
    const el = code.slice(x, y);
    if (!/^(?:'[^'\\]*'|"[^"\\]*")$/.test(el)) return ['has a key list element that is not a plain string literal'];
    if (gitNameBad(el.slice(1, -1))) return [gitNameBad(el.slice(1, -1))];
  }
  return [];
}

// Object.fromEntries(<keys>.filter(...).map(...)): the named-pick form. The keys must be a literal list, nothing may be concatenated in.
function pickProblems(ctx, s, e, depth) {
  const { masked: m } = ctx;
  const head = /^Object\s*\.\s*fromEntries\s*\(/.exec(m.slice(s, e));
  if (!head) return ['spreads an expression the census cannot read'];
  const open = s + head[0].length - 1;
  if (findMatching(m, open) !== e - 1) return ['spreads an expression the census cannot read'];
  let [a, b] = trimRange(m, open + 1, e - 1);
  const problems = [];
  let keys;
  if (m[a] === '[') {
    const close = findMatching(m, a);
    if (close < 0) return ['spreads an expression the census cannot read'];
    problems.push(...stringArrayProblems(ctx, a, close + 1));
    a = close + 1;
  } else {
    const id = /^[A-Za-z_$][\w$]*/.exec(m.slice(a, b));
    if (!id) return ['spreads an expression the census cannot read'];
    keys = id[0];
    a += keys.length;
    problems.push(...bindingHazards(ctx, keys));
    const decls = declarations(ctx, keys);
    if (decls.length === 0) problems.push(`picks keys from ${keys}, which has no readable declaration`);
    for (const [x, y] of decls) problems.push(...stringArrayProblems(ctx, x, y));
  }
  for (;;) {
    const [x] = trimRange(m, a, b);
    if (x >= b) break;
    const call = /^\s*\.\s*(?:filter|map)\s*\(/.exec(m.slice(a, b));
    if (!call) { problems.push('puts something other than .filter(...) and .map(...) after the key list'); break; }
    const open = a + call[0].length - 1;
    const close = findMatching(m, open);
    if (close < 0 || close >= b) { problems.push('puts something other than .filter(...) and .map(...) after the key list'); break; }
    if (/\bObject\s*\.\s*(?:entries|keys|values|assign|fromEntries)\b|\.\.\./.test(m.slice(open, close))) problems.push('reads the whole environment inside the pick');
    a = close + 1;
  }
  return depth > MAX_DEPTH ? ['nests env bindings too deeply for the census'] : problems;
}

// Judge one env-valued expression m[s, e). res = { problems, wide, entries, gitEnv }. mode 'env' is the spawn's own value, 'spread' a spread target.
function judgeValue(ctx, s, e, depth, res, mode) {
  const { masked: m } = ctx;
  [s, e] = trimRange(m, s, e);
  if (depth > MAX_DEPTH) { res.problems.push('nests env bindings too deeply for the census'); return; }
  if (s >= e) { res.problems.push('has an empty env'); return; }
  if (isGitEnvAlone(m, s, e)) { res.gitEnv = true; return; }
  res.wide = true;
  if (m[s] === '(' && findMatching(m, s) === e - 1) { judgeValue(ctx, s + 1, e - 1, depth + 1, res, mode); return; }
  if (m[s] === '{' && findMatching(m, s) === e - 1) { judgeLiteral(ctx, s, e, depth, res); return; }
  if (mode === 'spread' && /^Object\s*\./.test(m.slice(s, e))) { res.problems.push(...pickProblems(ctx, s, e, depth)); return; }
  const text = m.slice(s, e);
  if (IDENT.test(text)) {
    res.problems.push(...bindingHazards(ctx, text));
    const decls = declarations(ctx, text);
    if (decls.length === 0) { res.problems.push(`uses ${text}, which has no readable declaration`); return; }
    for (const [x, y] of decls) {
      if (mode === 'spread') judgeValue(ctx, x, y, depth + 1, res, 'spread');
      else { const sub = fresh(); judgeValue(ctx, x, y, depth + 1, sub, 'env'); finish(sub); merge(res, sub); res.finished = true; }
    }
    return;
  }
  const call = /^([A-Za-z_$][\w$]*)\s*\(/.exec(text);
  if (call && mode === 'env' && findMatching(m, s + call[0].length - 1) === e - 1) { judgeHelper(ctx, call[1], depth, res); return; }
  res.problems.push(`has an env the census cannot read (${text.replace(/\s+/g, ' ').slice(0, 40)})`);
}

const fresh = () => ({ problems: [], wide: false, entries: [], gitEnv: false });
function merge(into, from) { into.problems.push(...from.problems); into.wide = into.wide || from.wide; }

// The GIT_CONFIG_NOSYSTEM requirement, judged once per complete env (a literal with its spreads flattened in).
function finish(res) {
  if (res.finished) return;
  res.finished = true;
  const nosys = res.entries.filter((en) => en.key.toUpperCase() === 'GIT_CONFIG_NOSYSTEM');
  if (nosys.length > 1) res.problems.push("sets GIT_CONFIG_NOSYSTEM more than once (the last one wins) -- build an allowlist env without GIT_CONFIG_NOSYSTEM: '1' exactly once");
  else if (nosys.length === 1 && !/^(?:'1'|"1")$/.test(nosys[0].value)) res.problems.push("builds an allowlist env without GIT_CONFIG_NOSYSTEM: '1' -- the system git config would be read (value is not the literal 1) (CWK-136, 08c)");
  else if (nosys.length === 0 && !res.gitEnv) res.problems.push("builds an allowlist env without GIT_CONFIG_NOSYSTEM: '1' -- the system git config would be read (CWK-136, 08c)");
}

function judgeLiteral(ctx, s, e, depth, res) {
  const { masked: m, code } = ctx;
  for (const [ms, me] of splitTop(m, s + 1, e - 1)) {
    const [x, y] = trimRange(m, ms, me);
    if (x >= y) continue;
    if (m.startsWith('...', x)) { judgeValue(ctx, x + 3, y, depth + 1, res, 'spread'); continue; }
    if (m[x] === '[') { res.problems.push('has a computed property key (the census cannot read the name)'); continue; }
    const kre = /(?:([A-Za-z_$][\w$]*)|'([^']*)'|"([^"]*)")\s*/y;
    kre.lastIndex = x;
    const km = kre.exec(code.slice(0, y));
    if (!km) { res.problems.push('has an object member the census cannot read'); continue; }
    const key = km[1] ?? km[2] ?? km[3];
    if (gitNameBad(key)) res.problems.push(gitNameBad(key));
    const rest = kre.lastIndex;
    if (rest >= y) { res.entries.push({ key, value: null }); continue; }
    if (m[rest] !== ':') { res.problems.push('has an object member the census cannot read'); continue; }
    res.entries.push({ key, value: code.slice(rest + 1, y).trim() });
  }
}

// env: sandboxEnv(dir) -- a helper the same file defines. Every return of it is judged as an env of its own.
function judgeHelper(ctx, name, depth, res) {
  const { masked: m } = ctx;
  const q = esc(name);
  const defs = [];
  for (const mm of m.matchAll(new RegExp('(?<![\\w$.])(?:const|let|var)\\s+' + q + '\\s*=\\s*(?:async\\s*)?(?:\\([^()]*\\)|[A-Za-z_$][\\w$]*)\\s*=>\\s*', 'g'))) defs.push({ arrow: true, at: mm.index + mm[0].length });
  for (const mm of m.matchAll(new RegExp('\\bfunction\\s+' + q + '\\s*\\([^()]*\\)\\s*(?=\\{)', 'g'))) defs.push({ arrow: false, at: mm.index + mm[0].length });
  if (defs.length === 0) { res.problems.push(`has an env from ${name}(...), which this file does not define`); return; }
  for (const def of defs) {
    const exprs = [];
    if (def.arrow && m[def.at] !== '{') exprs.push([def.at, statementEnd(m, def.at, m.length)]);
    else {
      const close = findMatching(m, def.at);
      if (close < 0) { res.problems.push(`has a helper ${name} the census cannot read`); continue; }
      for (const rm of m.slice(def.at, close).matchAll(/\breturn\b/g)) {
        const from = def.at + rm.index + rm[0].length;
        exprs.push([from, statementEnd(m, from, close)]);
      }
    }
    if (exprs.length === 0) { res.problems.push(`has a helper ${name} that returns nothing the census can read`); continue; }
    for (const [x, y] of exprs) { const sub = fresh(); judgeValue(ctx, x, y, depth + 1, sub, 'env'); finish(sub); merge(res, sub); res.finished = true; }
  }
}

// File-wide hazard, checked whenever the env is not gitEnv(...) alone: the whole process.env object reachable by any route.
function fileWideReasons(ctx) {
  const { masked: m, code } = ctx;
  const out = [];
  if (BARE_ENV.test(m) || FOR_IN_ENV.test(m) || /\bprocess\s*\[/.test(m) || BARE_PROCESS_VALUE.test(m)
    || /\bimport\b[^;]*\benv\b[^;]*\bfrom\s*['"](?:node:)?process['"]/.test(code)
    || /\brequire\s*\(\s*['"](?:node:)?process['"]\s*\)/.test(code)
    || /\{[^}]*\benv\b[^}]*\}\s*=\s*(?:globalThis\s*\.\s*)?process\b/.test(m)) {
    out.push('passes process.env without gitEnv() -- the GIT_* family is inherited (CWK-136); an allowlist env picks named keys out of process.env, it never spreads, copies, aliases or loops over the object (08c)');
  }
  return out;
}

// All reasons one git call's env is unsafe, or [] when it is safe.
function envReasons(ctx, openIdx, closeIdx) {
  const { masked: m, code } = ctx;
  let envRange = null;
  let spreadAfter = false;
  for (const [a, b] of splitTop(m, openIdx + 1, closeIdx)) {
    const [x, y] = trimRange(m, a, b);
    if (m[x] !== '{' || findMatching(m, x) !== y - 1) continue;
    for (const [ma, mb] of splitTop(m, x + 1, y - 1)) {
      const [p, q] = trimRange(m, ma, mb);
      if (p >= q) continue;
      if (m.startsWith('...', p)) { if (envRange) spreadAfter = true; continue; }
      const km = /^env\b\s*/.exec(code.slice(p, q));
      if (!km) continue;
      if (km[0].length === q - p) envRange = [p, q];
      else if (m[p + km[0].length] === ':') envRange = [p + km[0].length + 1, q];
    }
  }
  if (!envRange) return ["carries no 'env:' -- route it through gitEnv() (CWK-133)"];
  const [s, e] = trimRange(m, envRange[0], envRange[1]);
  const res = fresh();
  judgeValue(ctx, s, e, 0, res, 'env');
  finish(res);
  const reasons = [];
  if (BARE_ENV.test(m.slice(s, e)) && !res.problems.some((p) => p.startsWith('passes'))) reasons.push('passes process.env without gitEnv() -- the GIT_* family is inherited (CWK-136)');
  reasons.push(...res.problems);
  if (res.wide) reasons.push(...fileWideReasons(ctx));
  if (spreadAfter) reasons.push('spreads another object into the options AFTER env (the spread can replace it)');
  return [...new Set(reasons)];
}

// R13 / CWK-174, narrowed at R14, emptied at 08c, one pin again at 08d: the house secret scan arrives as byte-equal copies of the org canon (SERIES-CANON
// "Secret scan": scanner-parity measures it). A byte-equal org carrier whose git spawn the census cannot read could be exempted by
// PINNING its blob id: exempt ONLY while its content is exactly the pinned blob, so any edit or re-sync makes the entry a finding
// again ("re-derive") and the exemption cannot widen or outlive its reason silently. The pin is a git blob id (git hash-object <file>).
// 08c/08d: scripts/release-notes.mjs (canon f8d998d8) and scripts/release-notes.test.mjs (canon 7e779ef8, one sandboxEnv literal) pass
// by rule (a). scripts/secret-scan.test.mjs (Bankfire d0db994d) takes its git env from a local helper spelled gitEnv(...), which the
// census trusts by name (the blind spot above). ONE pin remains, quoted with the finding it answers:
//   scripts/secret-gate.test.mjs, canon blob 71452210 -- `execFileSync('git', ..., env: { ...gitEnv(), ...extra })` at gitWith(extra, ...):
//   "binds extra as a parameter, which the census cannot follow; uses extra, which has no readable declaration". The caller's `extra`
//   can hold any key and the census cannot read the callers. It is a byte-equal org carrier, so the file is not edited here; the
//   finding goes upward with the 08d return. The pin holds only while the content is exactly that blob.
export const EXEMPT_CARRIERS = {
  'scripts/secret-gate.test.mjs': '71452210d6a6f793895bc502557fce7e1f3e890c',
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
    const { code, masked } = scanSource(text);
    const ctx = { code, masked };
    const live = (re) => [...code.matchAll(re)].filter((mm) => masked.startsWith(mm[1], mm.index)).map((mm) => ({ m: mm, line: code.slice(0, mm.index).split('\n').length }));
    for (const { m: mm, line } of live(ARGV_RE)) {
      const openIdx = code.indexOf('(', mm.index);
      const closeIdx = findMatching(masked, openIdx);
      if (closeIdx === -1) {
        findings.push(`${rel}:${line} unbalanced parens scanning a ${mm[1]}('git', ...) call -- the census cannot verify it`);
        continue;
      }
      const callText = code.slice(openIdx, closeIdx + 1);
      // R14 bounce LOW-1: `keepUserConfig` lets GIT_CONFIG_GLOBAL/SYSTEM/NOSYSTEM through, which is right for ONE spawn:
      // the installer's read of the user's core.hooksPath. Any other spawn that asks for it is a finding.
      if (/\bkeepUserConfig\b/.test(callText) && !(rel === 'scripts/install.mjs' && /core\.hooksPath/.test(callText))) {
        findings.push(`${rel}:${line} ${mm[1]}('git', ...) passes keepUserConfig -- only the installer's core.hooksPath read in scripts/install.mjs may (R14-N1)`);
      }
      const reasons = envReasons(ctx, openIdx, closeIdx);
      if (reasons.length) findings.push(`${rel}:${line} ${mm[1]}('git', ...) ${reasons.join('; ')}`);
    }
    for (const { m: mm, line } of live(SHELL_RE)) {
      findings.push(`${rel}:${line} ${mm[1]}('git ...') runs git through a shell string -- use spawnSync/execFileSync with an argv array and env: gitEnv(...) (CWK-136, R8)`);
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
