// ponytail: 915 lines at declaration -- one token census: the lexer, the binding index and every env rule (alias, helper, allowlist literal, key list, options object) read the same token arrays, so splitting them would force each rule to re-pass the shared indexes.
// THE CANON GIT-SPAWN CENSUS (08d D1/D3, 2026-10-09) -- the ONE rule the flock holds for what environment a `git` child gets. Does every spawnSync/execFileSync('git', ...)
// carry an explicit `env:` whose value cannot let an ambient GIT_* name reach the child? A git hook exports an ABSOLUTE GIT_DIR / GIT_INDEX_FILE, and a fixture or a gate that
// inherits them acts on (or re-initialises) the REAL repository (CWK-133, CWK-136). Seven rooms built this census seven ways and each reviewer found a bypass the others had
// not; CoalTipple's token census is the base because it passed every one of the witness vectors the others had found, and this file carries it once, with the
// witnesses as its test corpus (git-env-census.vectors.mjs, git-env-census.test.mjs). A room adopts this file by blob id instead of keeping its own, and passes its own
// pins to scanGitSpawns(files, pins); a room-local widening past the witness list is a named divergence, and a new bypass goes back to the list as a candidate row.
//
// It is a TOKEN census, not a set of regular expressions: lex() turns the file into tokens (comments dropped; strings, templates, regex literals and punctuation told apart, so a
// quote inside a regex or a backtick inside a template can no longer desync it, F41), and the env is judged by a small grammar over those tokens.
// An env is SAFE only when it is one of:
//   (i)  gitEnv(...) / gitTestEnv(...) alone. A call to a name defined in the SAME file is judged by that
//        definition's returned expressions (F42), so a local helper called gitEnv is not trusted by its name; one
//        that is IMPORTED is trusted only when it comes in under that same name from the room's own git-env.mjs (I1:
//        './git-env.mjs' or './lib/git-env.mjs', resolved against the importing file's directory; git-env.mjs is proven
//        by its own test), and an import from any other source is a finding; one neither defined nor imported keeps its
//        name-trust (ceiling item 3).
//   (ii) a helper of this file whose every returned expression is safe (F13, F14), up to a few hops.
//   (iii) an object literal made only of: spreads of a safe expression; `KEY: value` and shorthand members whose
//        KEY is a plain name or string, appears once, and is not a GIT_ name beyond GIT_CONFIG_NOSYSTEM (the literal
//        '1', never anything else), GIT_TERMINAL_PROMPT and GIT_CEILING_DIRECTORIES (each only narrows git); values
//        that read process.env only one named key at a time and hold no spread. Reading the environment at all
//        (a named pick, or process.env.X) requires GIT_CONFIG_NOSYSTEM '1' in the literal.
//   (iv) a NAMED PICK: Object.fromEntries(LIST.filter(K => process.env[K] !== undefined | K in process.env)
//        .map(K => [K, process.env[K]])) where LIST is an inline array, or a const array, of string literals
//        (no GIT_ name beyond the two that narrow git, none computed, none spread, never pushed to).
//   An identifier is resolved to its one const/let/var declaration; it must be declared once in the file, never a
//   parameter, a destructured or imported name, and every other use of it must be a read (a spread, a property or
//   index read, a comparison, an argument of a pure builtin) -- an alias, a write, a call on it, a callee that
//   receives it (fill(env), Reflect.set(env, ...), Object.assign(env, ...), Object(env)) is a finding (F15-F18,
//   F35-F40); so is the env name inside a destructuring-assignment target or the left of a for-in / for-of head (B2),
//   a key list handed to a callback method with more than one parameter (B3), JSON.stringify with a replacer (B4), a var
//   or a declaration that comes after the spawn (B6), a gitEnv assigned in the file (B7), and a spawner named other than
//   as a call (B8). Anything the grammar does not read whole is a finding, never a silent pass.
//
// THE NAMED CEILING (a token census, not a JS parser; it errs toward a finding wherever it can):
//   1. the lexer decides regex-or-division by the previous token: after the `)` of an if/while/for/with head and after the `}`
//      of a block a `/` starts a regex; after `]`, a name or a number it is division; after any other `)` or `}` it is
//      division AND it might be a regex (a block whose `{` follows a label or a `case x:`, the head of a `for await`, an opener
//      nobody has listed yet). Where a regex holding a quote or a backtick was read as division plus a string or a template,
//      the rest of that line was lost, and so was every line the string or template then ran onto (a template, or a string
//      continued by a backslash at the end of a line, crosses lines), so a whole spawn could hide (N17, N24, N25, N28-N30). So
//      every such slash that has a closing slash on its line is read BOTH ways: as lexed, and again as the start of a regex, and
//      every spawn after it, to the end of the file, is judged under either reading (a spawn found by either is counted, a
//      finding from either is a finding). A second ambiguous slash that shows only once the first is forced is forced in turn
//      (N26), and a file with more than MAX_READINGS (16) readings is refused as a whole (N27). What it still does not do: read the
//      OTHER way (a head or block it recognised that is really followed by division), or read a slash with no closing slash on
//      its line (a regex holds no newline, so such a slash is division). The cost is a false finding on genuine division that
//      is followed, later on its line, by a quote, a backtick or another slash, in a file that names a git spawn after it: a
//      visible refusal, never a silent pass (the real tree has none: it holds no such slash, and its bare findings are the same
//      twelve in the same four pinned files);
//   2. identifier lookups are FILE-WIDE, not scope-aware: every declaration and use of a name counts, so two
//      functions that each build a clean `env` are both refused (route one through gitEnv());
//   3. an imported helper is trusted only under the names gitEnv and gitTestEnv, and only when it is imported under THAT name
//      from the room's own git-env.mjs (the specifier './git-env.mjs' or './lib/git-env.mjs', resolved against the importing
//      file's directory where the file has one; the module itself is not opened). An import of either name from another
//      source, under another name, as a default or a namespace, or by destructuring an import() or require() whose source is
//      not one string literal, is a finding, and so is any other imported helper. A name neither defined nor imported in the
//      file keeps its name-trust (a bare call in a fixture reads as the room's gitEnv; at run time it would be a
//      ReferenceError unless something assigned it, and a file that assigns it loses the trust, item 10 and B7). A
//      name bound as a PARAMETER or catch binding (F60) makes every bare gitEnv() call of the file a finding, and a name bound by an import the census cannot parse
//      (an import statement with no `from 'literal'`) is not seen;
//   4. a helper's returned expression is read, not its callers: a helper that returns a clean literal and is then
//      handed to code that mutates it by another route (a closure, a getter, a Proxy) is not seen;
//   5. only spawnSync/execFileSync called with the literal command 'git', 'git.exe' or a template holding just git are
//      spawns: a command held in a variable, spawn(), execFile(), exec(), a spawn reached by `const run = spawnSync`
//      or by member access on a module object (cp['spawnSync']) are not counted (an import or a destructure under
//      another name IS a finding, X3); neither is a spawner whose NAME is written with a unicode escape sequence (a
//      backslash, u and four hex digits standing for one of its letters): the lexer reads the name as it is written, so it is
//      not spawnSync to the census although it is to the engine, and the spawn runs with whatever env it is given (X4);
//   6. eval, new Function, a `with` block and a Proxy over process.env are not seen;
//   7. a comma operator inside an env expression ends it early (but a helper's return statement is read whole, F46: `return { ... }, process.env` is a finding);
//   8. a file that rebinds `process` (an alias, the process module, a ['process'] lookup) is read only for a bare
//      gitEnv() call: any other env in it is a finding, even a clean one (fail closed);
//   9. an env mutated through a closure that captured it, or through a getter or setter defined elsewhere, is not seen;
//      a callee that receives the env as an argument IS a finding (fill(env)), but the census does not read its body;
//  10. a whole-process write outside the env object that still reaches every env at run time is refused only where the file
//      names the builtin it goes through (Object.prototype.X = ..., globalThis.X = ..., a rebound Object/JSON/Reflect/Array/
//      String/Boolean/console): such a file is read only for a bare gitEnv() call. A write through a name the census does
//      not know (a parameter called Object, a module another file imports and runs first) is not seen;
//  11. a declaration is checked against the spawn by TOKEN POSITION (it must come before the spawn, and not be a var): a
//      function that is declared above a const and called below it is judged as if the const came late, which errs toward a
//      finding.
//
// scanGitSpawns() is pure (a fixture map in, { findings, files, calls, safe } out) so it is unit-tested directly,
// red-first, without a repo clone; censusGitSpawns() is its findings-only view; collectScriptsMjs() is the real
// filesystem walk, kept separate so the pure functions never touch disk.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// BLOB-PINNED EXEMPTIONS (CWK-174). A room whose own file cannot be fixed room-side (a byte-equal copy of a source elsewhere, a test that plants GIT_DIR on purpose) passes a
// row { rel, blob, why } to scanGitSpawns(files, pins). A row matches only while the file's git blob id (line endings normalised to LF) equals `blob`, so any edit, or a new
// source blob, re-arms the census on that file. The canon ships NO pins of its own: the default is the empty list, and the canon's one pinned carrier (the secret gate, which
// keeps GIT_INDEX_FILE by design) is pinned in git-env-census.test.mjs, where the reason is quoted. With the token census a file that defines its OWN gitEnv() is judged by
// that body, never by the name (F42).
export const CENSUS_EXEMPT = [];

// The git blob id of `text` (what `git hash-object` prints for that content), CRLF -> LF first so
// a Windows autocrlf checkout of the same file pins the same row.
export function gitBlobId(text) {
  const body = Buffer.from(String(text).replace(/\r\n/g, '\n'), 'utf8');
  return createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
}

// ---------------------------------------------------------------------------
// The lexer.
// ---------------------------------------------------------------------------
const KW_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const PUNCTS = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'];
const CTL_HEAD = new Set(['if', 'while', 'for', 'with']);
const BLOCK_BEFORE = new Set(['else', 'do', 'try', 'finally']);
// A '{' opens a BLOCK, not an object literal, at the start of the file, after ')' ';' '{' '}' '=>', after else/do/try/finally,
// and after a plain name (a class head). It is an object literal after '(' ',' '=' ':' '[' an operator, or return/typeof/....
const openIsBlock = (p) => !p || (p.k === 'p' ? [')', ';', '{', '}', '=>'].includes(p.v) : p.k === 'id' ? BLOCK_BEFORE.has(p.v) || !KW_BEFORE_REGEX.has(p.v) : false);
const isIdChar = (c) => /[\w$]/.test(c) || c.charCodeAt(0) > 127;

// lex() is the token list alone. lexAmb() also returns `amb`: every '/' it read as DIVISION after a ')' or '}' that is not a block
// head, where a regex ending on the same line could have started instead (the fail-closed reading, ceiling item 1), and takes
// `force`, a set of offsets of such slashes to read as the start of a regex.
export function lex(text) { return lexAmb(text).toks; }

export function lexAmb(text, force = null) {
  const toks = [];
  const amb = [];
  const holes = []; // brace depth at which each open template hole began
  const parenCtl = []; // per open '(' : is it the head of if/while/for/with (a '/' after its ')' starts a regex)
  const braceBlk = []; // per open '{' : is it a block (a '/' after its '}' starts a regex) or an object literal
  let braces = 0;
  let line = 1;
  let i = 0;
  if (text.startsWith('#!')) { while (i < text.length && text[i] !== '\n') i++; } // a shebang line is not code
  const push = (k, v, s) => toks.push({ k, v, i: s, ln: line });
  const regexAllowed = () => {
    const p = toks[toks.length - 1];
    if (!p) return true;
    if (p.k === 'p') return p.v === ')' || p.v === '}' ? !!p.ctl : p.v !== ']';
    if (p.k === 'id') return KW_BEFORE_REGEX.has(p.v);
    return p.k === 'tplopen';
  };
  const templateChunk = (from) => {
    let j = from;
    while (j < text.length) {
      const d = text[j];
      if (d === '\\') { if (text[j + 1] === '\n') line++; j += 2; continue; }
      if (d === '`') { push('tpl', text.slice(from, j), from); i = j + 1; return; }
      if (d === '$' && text[j + 1] === '{') { push('tpl', text.slice(from, j), from); push('tplopen', '${', j); holes.push(braces); i = j + 2; return; }
      if (d === '\n') line++;
      j++;
    }
    push('tpl', text.slice(from), from);
    i = text.length;
  };
  while (i < text.length) {
    const c = text[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2);
      const stop = e === -1 ? text.length : e + 2;
      for (let j = i; j < stop; j++) if (text[j] === '\n') line++;
      i = stop;
      continue;
    }
    if (c === '"' || c === '\'') {
      const s = i;
      i++;
      while (i < text.length && text[i] !== c && text[i] !== '\n') { if (text[i] === '\\') { if (text[i + 1] === '\n') line++; i++; } i++; }
      push('str', text.slice(s + 1, i), s);
      if (text[i] === c) i++;
      continue;
    }
    if (c === '`') { templateChunk(i + 1); continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] || ''))) {
      const s = i;
      while (i < text.length && /[\w.]/.test(text[i])) i++;
      push('num', text.slice(s, i), s);
      continue;
    }
    if (isIdChar(c)) {
      const s = i;
      while (i < text.length && isIdChar(text[i])) i++;
      push('id', text.slice(s, i), s);
      continue;
    }
    if (c === '/') {
      const allowed = regexAllowed() || (force !== null && force.has(i));
      const p = toks[toks.length - 1];
      const maybe = !allowed && !!p && p.k === 'p' && (p.v === ')' || p.v === '}');
      if (allowed || maybe) {
        let j = i + 1;
        let inClass = false;
        let ok = false;
        while (j < text.length && text[j] !== '\n') {
          const d = text[j];
          if (d === '\\') { j += 2; continue; }
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) { ok = true; break; }
          j++;
        }
        if (ok && allowed) {
          j++;
          while (j < text.length && /[a-z]/i.test(text[j])) j++;
          push('re', text.slice(i, j), i);
          i = j;
          continue;
        }
        if (ok) amb.push({ i, ln: line });
      }
    }
    if (c === '}' && holes.length && braces === holes[holes.length - 1]) {
      holes.pop();
      push('tplclose', '}', i);
      templateChunk(i + 1);
      continue;
    }
    const op = PUNCTS.find((p) => text.startsWith(p, i)) || c;
    const tk = { k: 'p', v: op, i, ln: line };
    const prevTok = toks[toks.length - 1];
    if (op === '(') parenCtl.push(!!prevTok && prevTok.k === 'id' && CTL_HEAD.has(prevTok.v));
    else if (op === ')') tk.ctl = parenCtl.pop() === true;
    else if (op === '{') { braces++; braceBlk.push(openIsBlock(prevTok)); }
    else if (op === '}') { braces--; tk.ctl = braceBlk.pop() === true; }
    toks.push(tk);
    i += op.length;
  }
  return { toks, amb };
}

const isP = (t, v) => !!t && t.k === 'p' && t.v === v;
const isId = (t, v) => !!t && t.k === 'id' && (v === undefined || t.v === v);

function bracketMap(toks) {
  const m = new Map();
  const st = [];
  for (let n = 0; n < toks.length; n++) {
    const t = toks[n];
    if ((t.k === 'p' && (t.v === '(' || t.v === '[' || t.v === '{')) || t.k === 'tplopen') st.push(n);
    else if ((t.k === 'p' && (t.v === ')' || t.v === ']' || t.v === '}')) || t.k === 'tplclose') {
      const o = st.pop();
      if (o !== undefined) { m.set(o, n); m.set(n, o); }
    }
  }
  return m;
}

const STMT_KW = new Set(['const', 'let', 'var', 'function', 'class', 'if', 'for', 'while', 'return', 'export', 'import', 'try', 'throw', 'switch']);

// The end of the expression that starts at token `from`: the first top-level `,` (or `;` when `semi`), or the closer of
// whatever encloses it. Brackets nest. With `semi`, a statement keyword that starts a new line also ends it (no ASI).
function exprEnd(ctx, from, semi, commaOk = false) {
  const { toks, m } = ctx;
  let n = from;
  while (n < toks.length) {
    const t = toks[n];
    if (t.k === 'p') {
      if (t.v === '(' || t.v === '[' || t.v === '{') { const c = m.get(n); if (c === undefined) return toks.length; n = c + 1; continue; }
      if (t.v === ')' || t.v === ']' || t.v === '}' || (t.v === ',' && !commaOk) || (semi && t.v === ';')) return n;
    } else if (t.k === 'tplopen') {
      const c = m.get(n);
      n = (c === undefined ? toks.length : c) + 1;
      continue;
    } else if (t.k === 'tplclose') return n;
    if (semi && n > from && t.ln !== toks[n - 1].ln && t.k === 'id' && STMT_KW.has(t.v)) return n;
    n++;
  }
  return n;
}

const BUILTINS = new Set(['Object', 'JSON', 'Reflect', 'Array', 'String', 'Boolean', 'console']);

// Where the room's own git-env.mjs lives, and the two specifiers its files import it by (for a file under scripts/ the specifier is
// resolved against that file's own directory; a bare fixture name has no directory, so the specifier is matched as written).
const GIT_ENV_HOME = 'scripts/lib/git-env.mjs';
const GIT_ENV_SPECS = new Set(['./git-env.mjs', './lib/git-env.mjs']);
const TRUSTED_NAMES = new Set(['gitEnv', 'gitTestEnv']);

function ownGitEnvSource(rel, src) {
  if (typeof src !== 'string') return false;
  if (!rel.includes('/')) return GIT_ENV_SPECS.has(src);
  return /^\.\.?\//.test(src) && path.posix.normalize(path.posix.join(path.posix.dirname(rel), src)) === GIT_ENV_HOME;
}

// Every name bound by an import of this file, as local -> { src, imported }: `import a, { b, c as d } from 'x'`, `import * as n from 'x'`,
// and `const { g, h: i } = await import('x') / require('x')` (src null when the source is not one string literal).
function collectImports(toks, m) {
  const imports = new Map();
  const bind = (local, src, imported) => { imports.set(local, [...(imports.get(local) || []), { src, imported }]); };
  for (let n = 0; n < toks.length; n++) {
    const t = toks[n];
    if (isId(t, 'import') && !isP(toks[n - 1], '.') && !isP(toks[n + 1], '(') && !isP(toks[n + 1], '.') && !(toks[n + 1] && toks[n + 1].k === 'str')) {
      let j = n + 1;
      let inBrace = false;
      const pending = [];
      for (; j < toks.length && j < n + 400 && !isP(toks[j], ';'); j++) {
        const x = toks[j];
        if (isId(x, 'from') && toks[j + 1] && toks[j + 1].k === 'str') break;
        if (isP(x, '{')) inBrace = true;
        else if (isP(x, '}')) inBrace = false;
        else if (isP(x, '*') && isId(toks[j + 1], 'as') && toks[j + 2] && toks[j + 2].k === 'id') { pending.push([toks[j + 2].v, '*']); j += 2; }
        else if (x.k === 'id' && isId(toks[j + 1], 'as') && toks[j + 2] && toks[j + 2].k === 'id') { pending.push([toks[j + 2].v, x.v]); j += 2; }
        else if (x.k === 'id') pending.push([x.v, inBrace ? x.v : 'default']);
      }
      const src = toks[j + 1] && toks[j + 1].k === 'str' && isId(toks[j], 'from') ? toks[j + 1].v : null;
      if (src !== null) for (const [local, imported] of pending) bind(local, src, imported);
    } else if (isP(t, '{') && (isId(toks[n - 1], 'const') || isId(toks[n - 1], 'let') || isId(toks[n - 1], 'var')) && m.get(n) !== undefined && isP(toks[m.get(n) + 1], '=')) {
      // a destructuring declaration: find the one string literal of an import(...) / require(...) in its initializer
      let src = null;
      const end = Math.min(toks.length, m.get(n) + 12);
      for (let k = m.get(n) + 2; k < end; k++) {
        if ((isId(toks[k], 'import') || isId(toks[k], 'require')) && isP(toks[k + 1], '(') && toks[k + 2] && toks[k + 2].k === 'str' && isP(toks[k + 3], ')')) { src = toks[k + 2].v; break; }
      }
      for (let k = n + 1; k < m.get(n); k++) {
        const x = toks[k];
        if (x.k !== 'id' || (!isP(toks[k - 1], '{') && !isP(toks[k - 1], ',') && !isP(toks[k - 1], ':'))) continue;
        if (isP(toks[k + 1], ':')) continue; // a key: its local name follows the colon
        bind(x.v, src, isP(toks[k - 1], ':') && toks[k - 2] && toks[k - 2].k === 'id' ? toks[k - 2].v : x.v);
      }
    }
  }
  return imports;
}

function buildCtx(text, force = null, rel = '') {
  const { toks, amb } = lexAmb(text, force);
  const m = bracketMap(toks);
  const decls = new Map(); // name -> [{ n, init }]  (init = index of the first token after `=`, or -1)
  const funcs = new Map(); // name -> [index of the name token of `function NAME`]
  let envImport = false;
  let processAlias = false;
  let shadowed = false; // a builtin the grammar leans on (Object, JSON, ...) is rebound, or globalThis is in play
  let gitEnvAssigned = false; // gitEnv / gitTestEnv is assigned somewhere in the file, so its name proves nothing
  for (let n = 0; n < toks.length; n++) {
    const t = toks[n];
    if (t.k === 'id') {
      if (t.v === 'process' && !isP(toks[n + 1], '.')) processAlias = true;
      const p = toks[n - 1];
      if ((t.v === 'globalThis' || t.v === 'global') && !isP(p, '.')) shadowed = true;
      if (t.v === 'prototype' && isP(p, '.') && toks[n - 2] && BUILTINS.has(toks[n - 2].v)) shadowed = true; // Object.prototype.X = ... reaches every env
      if (BUILTINS.has(t.v) && (isP(p, '{') || isP(p, ',')) && (isP(toks[n + 1], '}') || isP(toks[n + 1], ',')) && isP(toks[nearestOpener({ toks, m }, n)], '{')) shadowed = true; // an import or destructure list names it
      if (BUILTINS.has(t.v) && !isP(p, '.') && (isId(p, 'const') || isId(p, 'let') || isId(p, 'var') || isId(p, 'function') || isId(p, 'class') || isId(p, 'as') || isId(p, 'import') || isP(toks[n + 1], '='))) shadowed = true;
      if ((t.v === 'gitEnv' || t.v === 'gitTestEnv') && isP(toks[n + 1], '=') && !(isId(p, 'const') || isId(p, 'let') || isId(p, 'var'))) gitEnvAssigned = true;
      if (isId(p) && (p.v === 'const' || p.v === 'let' || p.v === 'var')) {
        const list = decls.get(t.v) || [];
        list.push({ n, kind: p.v, init: isP(toks[n + 1], '=') ? n + 2 : -1 });
        decls.set(t.v, list);
      } else if (isId(p, 'function')) {
        const list = funcs.get(t.v) || [];
        list.push(n);
        funcs.set(t.v, list);
      }
    } else if (t.k === 'str' && (t.v === 'node:process' || t.v === 'process') && (isId(toks[n - 1], 'from') || (isP(toks[n - 1], '(') && (isId(toks[n - 2], 'require') || isId(toks[n - 2], 'import'))))) envImport = true;
    else if (t.k === 'str' && t.v === 'process' && isP(toks[n - 1], '[')) processAlias = true;
  }
  // gitEnv / gitTestEnv is BOUND as a parameter or a catch binding somewhere (F60): a bare call to it is then not the helper, whatever it is called. A call, a member name, an
  // object key and a declaration (judged by its body) are not that; anything else that mentions the name inside a parameter list (or as the one parameter of an arrow) is.
  let gitEnvParam = false;
  for (let n = 0; n < toks.length && !gitEnvParam; n++) {
    const t = toks[n];
    if (t.k !== 'id' || (t.v !== 'gitEnv' && t.v !== 'gitTestEnv')) continue;
    const p = toks[n - 1];
    const q = toks[n + 1];
    if (isP(q, '(') || isP(p, '.') || isP(p, '?.')) continue;
    if (isId(p) && ['const', 'let', 'var', 'function', 'class'].includes(p.v)) continue;
    if ((isP(p, '{') || isP(p, ',')) && isP(q, ':')) continue;
    if (isP(q, '=>')) { gitEnvParam = true; continue; }
    for (let o = nearestOpener({ toks, m }, n); o >= 0; o = nearestOpener({ toks, m }, o)) {
      const c = m.get(o);
      if (isP(toks[o], '(') && c !== undefined && (isP(toks[c + 1], '=>') || isP(toks[c + 1], '{'))) { gitEnvParam = true; break; }
    }
  }
  return { toks, m, decls, funcs, envImport, shadowed, gitEnvAssigned, gitEnvParam, envTainted: envImport || processAlias || shadowed, memo: new Set(), amb, rel, imports: collectImports(toks, m) };
}

// ---------------------------------------------------------------------------
// Uses of a name: every use must be a read.
// ---------------------------------------------------------------------------
const ALLOWED_CALLEES = new Set(['Object.keys', 'Object.values', 'Object.entries', 'Object.hasOwn', 'Object.getOwnPropertyNames', 'JSON.stringify', 'console.log', 'console.error', 'console.warn', 'console.info', 'Array.isArray', 'String', 'Boolean']);
const PURE_LIST_METHODS = new Set(['includes', 'indexOf', 'join', 'slice', 'concat', 'at']);
const CALLBACK_LIST_METHODS = new Set(['filter', 'map', 'some', 'every', 'find', 'findIndex', 'forEach', 'flatMap']);
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**=', '<<=', '>>=', '>>>=', '&&=', '||=', '??=', '++', '--']);
const COMPARE_OPS = new Set(['===', '!==', '==', '!=']);

// The callee name of the call whose argument list holds token n directly, or null.
function directCallee(ctx, n) {
  const { toks, m } = ctx;
  let j = n - 1;
  while (j >= 0) {
    const t = toks[j];
    if ((t.k === 'p' && (t.v === ')' || t.v === ']' || t.v === '}')) || t.k === 'tplclose') { const o = m.get(j); if (o === undefined) return null; j = o - 1; continue; }
    if (isP(t, '(')) break;
    if ((t.k === 'p' && (t.v === '[' || t.v === '{')) || t.k === 'tplopen') return null;
    j--;
  }
  if (j < 0) return null;
  const parts = [];
  let k = j - 1;
  while (k >= 0 && toks[k].k === 'id') {
    parts.unshift(toks[k].v);
    if (isP(toks[k - 1], '.') && toks[k - 2] && toks[k - 2].k === 'id') k -= 2;
    else { k--; break; }
  }
  if (isId(toks[k], 'function') || isId(toks[k], 'catch')) return null;
  ctx.lastOpen = j; // the '(' of that call, for the caller that must look at the other arguments
  return parts.length ? parts.join('.') : null;
}

// The index of the nearest bracket that encloses token n and is still open there, or -1.
function nearestOpener(ctx, n) {
  const { toks, m } = ctx;
  for (let j = n - 1; j >= 0; j--) {
    const t = toks[j];
    if ((t.k === 'p' && (t.v === ')' || t.v === ']' || t.v === '}')) || t.k === 'tplclose') { const o = m.get(j); if (o === undefined) return -1; j = o; continue; }
    if ((t.k === 'p' && (t.v === '(' || t.v === '[' || t.v === '{')) || t.k === 'tplopen') return j;
  }
  return -1;
}

// true when token n is inside the target of a destructuring assignment ({ a: x.y } = o, [x.y] = a) or the left of a for-in / for-of head.
function inAssignTarget(ctx, n) {
  const { toks, m } = ctx;
  let j = n - 1;
  while (j >= 0) {
    const t = toks[j];
    if ((t.k === 'p' && (t.v === ')' || t.v === ']' || t.v === '}')) || t.k === 'tplclose') { const o = m.get(j); if (o === undefined) return false; j = o - 1; continue; }
    if (t.k === 'p' && (t.v === '[' || t.v === '{')) { const c = m.get(j); if (c !== undefined && isP(toks[c + 1], '=')) return true; }
    else if (isP(t, '(') && isId(toks[j - 1], 'for')) {
      const c = m.get(j);
      if (c === undefined) return false;
      for (let k = n; k < c; k++) {
        if ((toks[k].k === 'p' && (toks[k].v === '(' || toks[k].v === '[' || toks[k].v === '{')) || toks[k].k === 'tplopen') { const e = m.get(k); if (e === undefined) return false; k = e; continue; }
        if (isP(toks[k], ';')) return false;
        if (isId(toks[k], 'of') || isId(toks[k], 'in')) return true;
      }
      return false;
    }
    j--;
  }
  return false;
}

// A callback method is read-only only when its one argument is an arrow with at most one parameter: a third parameter hands
// the callback the array itself (keep.forEach((k, i, a) => a.push(...))), and a thisArg or a function expression hands it more.
function onlyUnaryArrow(ctx, open) {
  const { toks, m } = ctx;
  const c = m.get(open);
  if (c === undefined || exprEnd(ctx, open + 1, false) !== c) return false;
  const a = open + 1;
  if (toks[a] && toks[a].k === 'id' && isP(toks[a + 1], '=>')) return true;
  if (isP(toks[a], '(')) { const e = m.get(a); return e !== undefined && e - a <= 2 && isP(toks[e + 1], '=>'); }
  return false;
}

// JSON.stringify(x) and JSON.stringify(x, null, 2) cannot run caller code; a replacer function sees the holder as `this`.
function plainStringify(ctx, open) {
  const { toks, m } = ctx;
  const c = m.get(open);
  if (c === undefined) return false;
  const args = [];
  for (let k = open + 1; k < c;) { const e = Math.min(exprEnd(ctx, k, false), c); args.push([k, e]); k = e + 1; }
  if (args.length === 1) return true;
  if (args.length > 3) return false;
  const [a1, b1] = args[1];
  if (!(b1 - a1 === 1 && toks[a1].k === 'id' && (toks[a1].v === 'null' || toks[a1].v === 'undefined'))) return false;
  if (args.length === 2) return true;
  const [a2, b2] = args[2];
  return b2 - a2 === 1 && (toks[a2].k === 'num' || toks[a2].k === 'str');
}

// null when every use of `name` is a read; otherwise the reason. `sites` = the token indexes where it is handed to a spawn.
function usesCheck(ctx, name, sites, kind) {
  const { toks, m } = ctx;
  for (let n = 0; n < toks.length; n++) {
    const t = toks[n];
    if (t.k !== 'id' || t.v !== name) continue;
    const p = toks[n - 1];
    const q = toks[n + 1];
    if (isId(p) && (p.v === 'const' || p.v === 'let' || p.v === 'var')) continue; // the declaration
    if (isP(p, '.') || isP(p, '?.')) continue; // a member name
    if ((isP(p, '{') || isP(p, ',')) && isP(q, ':')) continue; // an object key
    if (sites.has(n)) continue;
    const why = () => `${name} is used at line ${t.ln} in a way the census cannot read as a plain read`;
    if (inAssignTarget(ctx, n)) return why();
    if (isP(p, '...')) continue;
    if (isId(p, 'return')) continue;
    if (isId(p, 'typeof') || isP(p, '!')) continue;
    if ((q && q.k === 'p' && COMPARE_OPS.has(q.v)) || (p && p.k === 'p' && COMPARE_OPS.has(p.v))) continue;
    if (isId(p, 'delete') || (p && p.k === 'p' && (p.v === '++' || p.v === '--'))) return why();
    if (isP(q, '.') || isP(q, '?.') || isP(q, '[')) {
      let j = n + 1;
      let last = null;
      let steps = 0;
      for (;;) {
        if ((isP(toks[j], '.') || isP(toks[j], '?.')) && toks[j + 1] && toks[j + 1].k === 'id') { last = toks[j + 1].v; j += 2; steps++; continue; }
        if (isP(toks[j], '[')) { const c = m.get(j); if (c === undefined) return why(); last = null; j = c + 1; steps++; continue; }
        break;
      }
      const after = toks[j];
      if (after && after.k === 'p' && ASSIGN_OPS.has(after.v)) return why();
      if (isP(after, '(') || (after && after.k === 'tpl')) {
        if (kind === 'list' && steps === 1 && last && PURE_LIST_METHODS.has(last)) continue;
        if (kind === 'list' && steps === 1 && last && CALLBACK_LIST_METHODS.has(last) && isP(toks[j], '(') && onlyUnaryArrow(ctx, j)) continue;
        return why();
      }
      continue;
    }
    if ((isP(p, '(') || isP(p, ',')) && (isP(q, ')') || isP(q, ','))) {
      const callee = directCallee(ctx, n);
      if (callee && ALLOWED_CALLEES.has(callee) && (callee !== 'JSON.stringify' || plainStringify(ctx, ctx.lastOpen))) continue;
    }
    return why();
  }
  return null;
}

// ---------------------------------------------------------------------------
// The grammar. Every judge function returns null (safe) or a reason string.
// ---------------------------------------------------------------------------
const SAFE_NARROWING = new Set(['GIT_TERMINAL_PROMPT', 'GIT_CEILING_DIRECTORIES']);
const NOSYSTEM = 'GIT_CONFIG_NOSYSTEM';
const PICK_FILTERS = new Set(['( $K ) => process . env [ $K ] !== undefined', '( $K ) => $K in process . env']);
const PICK_MAP = '( $K ) => [ $K , process . env [ $K ] ]';
const MAX_DEPTH = 6;

function canonArrow(toks, a, b) {
  let k;
  let rest;
  if (b - a >= 3 && toks[a].k === 'id' && isP(toks[a + 1], '=>')) { k = toks[a].v; rest = a + 2; }
  else if (b - a >= 5 && isP(toks[a], '(') && toks[a + 1].k === 'id' && isP(toks[a + 2], ')') && isP(toks[a + 3], '=>')) { k = toks[a + 1].v; rest = a + 4; }
  else return null;
  return '( $K ) => ' + toks.slice(rest, b).map((t) => (t.k === 'id' && t.v === k ? '$K' : t.v)).join(' ');
}

const cooked = (t) => (t.k === 'str' && !t.v.includes('\\') ? t.v : null);

// A list of string literals: every name a plain string, none naming GIT_ beyond the two that narrow git. Returns a reason or null.
function listElements(ctx, a, b) {
  const { toks } = ctx;
  let n = a;
  while (n < b) {
    const v = cooked(toks[n]);
    if (v === null) return 'a key list holds something other than plain string literals (a computed name, a spread or an escape)';
    const U = v.toUpperCase();
    if (U.startsWith('GIT_') && !SAFE_NARROWING.has(U)) return `a key list names ${v}, a GIT_ name that can aim git elsewhere`;
    n++;
    if (n < b) { if (!isP(toks[n], ',')) return 'a key list holds something other than plain string literals'; n++; }
  }
  return null;
}

// Object.fromEntries(LIST[.filter(F)].map(M)) -- undefined when the tokens are not that shape, else null | reason.
function matchPick(ctx, a, b, st) {
  const { toks, m } = ctx;
  if (!(isId(toks[a], 'Object') && isP(toks[a + 1], '.') && isId(toks[a + 2], 'fromEntries') && isP(toks[a + 3], '(') && m.get(a + 3) === b - 1)) return undefined;
  let n = a + 4;
  let listIdx = -1;
  let inlineArr = null;
  if (isP(toks[n], '[')) { const c = m.get(n); if (c === undefined) return undefined; inlineArr = [n + 1, c]; n = c + 1; }
  else if (toks[n] && toks[n].k === 'id') { listIdx = n; n++; }
  else return undefined;
  if (isP(toks[n], '.') && isId(toks[n + 1], 'filter') && isP(toks[n + 2], '(')) {
    const fc = m.get(n + 2);
    if (fc === undefined || !PICK_FILTERS.has(canonArrow(toks, n + 3, fc))) return undefined;
    n = fc + 1;
  }
  if (!(isP(toks[n], '.') && isId(toks[n + 1], 'map') && isP(toks[n + 2], '('))) return undefined;
  const mc = m.get(n + 2);
  if (mc === undefined || canonArrow(toks, n + 3, mc) !== PICK_MAP || mc + 1 !== b - 1) return undefined;
  if (inlineArr) {
    const r = listElements(ctx, inlineArr[0], inlineArr[1]);
    if (r) return r;
  } else {
    const name = toks[listIdx].v;
    const ds = ctx.decls.get(name) || [];
    if (ds.length !== 1 || ds[0].init < 0 || !isP(toks[ds[0].init], '[')) return `${name} is not a single const array literal here`;
    const c = m.get(ds[0].init);
    if (c === undefined) return `${name} is not a single const array literal here`;
    const r = listElements(ctx, ds[0].init + 1, c) || usesCheck(ctx, name, new Set([listIdx]), 'list');
    if (r) return r;
  }
  st.ambient = true;
  return null;
}

// A value (the right side of KEY:, or a shorthand): reads process.env one named key at a time, holds no spread.
function judgeValue(ctx, a, b, st) {
  const { toks } = ctx;
  for (let n = a; n < b; n++) {
    const t = toks[n];
    if (isP(t, '...')) return 'a spread inside a value';
    if (isId(t, 'process')) {
      if (!isP(toks[n + 1], '.')) return 'process is used other than as process.NAME';
      if (isId(toks[n + 2], 'env')) {
        const after = toks[n + 3];
        if (isP(after, '[') || (isP(after, '.') && toks[n + 4] && toks[n + 4].k === 'id')) st.ambient = true;
        else return 'a value that is process.env itself';
      }
    }
  }
  if (b - a === 1 && toks[a].k === 'id') {
    const ds = ctx.decls.get(toks[a].v) || [];
    for (const d of ds) {
      if (d.init < 0) continue;
      const e = exprEnd(ctx, d.init, true);
      for (let n = d.init; n < e; n++) {
        if (isId(toks[n], 'process') && !(isP(toks[n + 1], '.') && isId(toks[n + 2], 'env') && (isP(toks[n + 3], '[') || (isP(toks[n + 3], '.') && toks[n + 4] && toks[n + 4].k === 'id')))) return `${toks[a].v} holds process.env whole`;
      }
    }
  }
  return null;
}

function judgeMember(ctx, a, b, st, keys) {
  const { toks } = ctx;
  if (isP(toks[a], '...')) return judgeExpr(ctx, a + 1, b, st);
  let key;
  let va;
  if (toks[a] && (toks[a].k === 'id' || toks[a].k === 'str') && isP(toks[a + 1], ':')) {
    if (toks[a].k === 'str' && cooked(toks[a]) === null) return 'a key with an escape';
    key = toks[a].v;
    va = a + 2;
  } else if (b - a === 1 && toks[a].k === 'id') { key = toks[a].v; va = a; }
  else return 'a member the census cannot read (a computed key, a method, a getter or a number key)';
  const U = key.toUpperCase();
  if (U === '__PROTO__') return 'a __proto__ member sets the prototype of the env';
  if (keys.has(U)) return `the key ${key} appears twice`;
  keys.add(U);
  if (U.startsWith('GIT_')) {
    if (U === NOSYSTEM) {
      if (!(b - va === 1 && cooked(toks[va]) === '1')) return 'GIT_CONFIG_NOSYSTEM is not the literal \'1\'';
      st.nosys = true;
    } else if (!SAFE_NARROWING.has(U)) return `the env sets ${key}, a GIT_ name that can aim git elsewhere`;
  }
  return judgeValue(ctx, va, b, st);
}

function judgeObject(ctx, a, b, st) {
  const keys = new Set();
  let n = a + 1;
  while (n < b - 1) {
    const e = Math.min(exprEnd(ctx, n, false), b - 1);
    if (e > n) { const r = judgeMember(ctx, n, e, st, keys); if (r) return r; }
    n = e + 1;
  }
  return null;
}

function judgeIdent(ctx, n, st) {
  const name = ctx.toks[n].v;
  const ds = ctx.decls.get(name) || [];
  if (ds.length !== 1 || ds[0].init < 0) return `${name} is not declared exactly once here with an initializer (a parameter, an import, a destructured or a repeated name)`;
  if (ds[0].kind === 'var') return `${name} is a var: its declaration is hoisted, so at the spawn it can still be undefined, which hands the child the whole environment`;
  if (ds[0].n > st.at) return `${name} is declared after the spawn that uses it, so it is undefined there (and undefined hands the child the whole environment)`;
  const r = usesCheck(ctx, name, st.sites, 'env');
  if (r) return r;
  return judgeExpr(ctx, ds[0].init, exprEnd(ctx, ds[0].init, true), st);
}

// The returned expressions of a helper defined in this file: [[a,b), ...] or a reason string.
function helperReturns(ctx, name) {
  const { toks, m } = ctx;
  const ds = ctx.decls.get(name) || [];
  const fs_ = ctx.funcs.get(name) || [];
  if (ds.length + fs_.length !== 1) return `${name} is not defined exactly once in this file`;
  let body;
  if (fs_.length) {
    let n = fs_[0] + 1;
    if (!isP(toks[n], '(') || m.get(n) === undefined) return `${name} is not a readable function`;
    n = m.get(n) + 1;
    if (!isP(toks[n], '{') || m.get(n) === undefined) return `${name} is not a readable function`;
    body = { block: [n + 1, m.get(n)] };
  } else {
    let n = ds[0].init;
    if (n < 0) return `${name} has no initializer`;
    if (isId(toks[n], 'async')) n++;
    if (isId(toks[n], 'function')) {
      n++;
      if (toks[n] && toks[n].k === 'id') n++;
      if (!isP(toks[n], '(') || m.get(n) === undefined) return `${name} is not a readable function`;
      n = m.get(n) + 1;
      if (!isP(toks[n], '{') || m.get(n) === undefined) return `${name} is not a readable function`;
      body = { block: [n + 1, m.get(n)] };
    } else {
      if (toks[n] && toks[n].k === 'id' && isP(toks[n + 1], '=>')) n += 2;
      else if (isP(toks[n], '(') && m.get(n) !== undefined && isP(toks[m.get(n) + 1], '=>')) n = m.get(n) + 2;
      else return `${name} is not a function this census can read (it is a value, or defined elsewhere)`;
      if (isP(toks[n], '{') && m.get(n) !== undefined) body = { block: [n + 1, m.get(n)] };
      else body = { expr: [n, exprEnd(ctx, n, true)] };
    }
  }
  if (body.expr) return [body.expr];
  const out = [];
  for (let n = body.block[0]; n < body.block[1]; n++) {
    if (isId(toks[n], 'return')) {
      const e = Math.min(exprEnd(ctx, n + 1, true, true), body.block[1]); // a comma in a return is the comma operator: the value is the last operand, so the whole statement is read (F46)
      if (e > n + 1) out.push([n + 1, e]);
    }
  }
  return out.length ? out : `${name} returns nothing this census can read`;
}

function judgeCall(ctx, a, b, st) {
  const name = ctx.toks[a].v;
  const defined = (ctx.decls.get(name) || []).length + (ctx.funcs.get(name) || []).length > 0;
  if (!defined) {
    if (TRUSTED_NAMES.has(name)) {
      if (ctx.gitEnvAssigned || ctx.shadowed || ctx.gitEnvParam) return `${name} is assigned, bound as a parameter or catch binding, or reachable through globalThis in this file, so its name proves nothing`;
      // every binding of the name counts (a function-scope destructure of another module beside a trusted top-level import)
      const imp = (ctx.imports.get(name) || []).find((b) => !(b.imported === name && ownGitEnvSource(ctx.rel, b.src)));
      if (imp) return `${name} is imported ${imp.src === null ? 'from a source the census cannot read' : `from '${imp.src}'${imp.imported === name ? '' : ` as ${imp.imported}`}`}, not by that name from the room's own git-env.mjs (the census does not open the module, so it trusts only that one)`;
      st.trusted = true;
      return null;
    }
    return `${name}(...) is a helper this file does not define (the census reads only same-file helpers, and trusts only gitEnv and gitTestEnv by name)`;
  }
  if (ctx.memo.has(name)) return `${name} calls itself`;
  const rets = helperReturns(ctx, name);
  if (typeof rets === 'string') return rets;
  ctx.memo.add(name);
  try {
    for (const [ra, rb] of rets) { const r = judgeExpr(ctx, ra, rb, st); if (r) return `${name}() returns an env the census refuses: ${r}`; }
  } finally { ctx.memo.delete(name); }
  return null;
}

function judgeExpr(ctx, a, b, st) {
  if (st.depth >= MAX_DEPTH) return 'an env expression nested too deeply to read';
  st.depth++;
  try { return judgeExpr0(ctx, a, b, st); } finally { st.depth--; }
}

function judgeExpr0(ctx, a, b, st) {
  const { toks, m } = ctx;
  while (b - a >= 2 && isP(toks[a], '(') && m.get(a) === b - 1) { a++; b--; }
  if (a >= b) return 'an empty env expression';
  const t0 = toks[a];
  if (isP(t0, '(')) { // ( () => E )()
    const c = m.get(a);
    if (c !== undefined && c + 3 === b && isP(toks[c + 1], '(') && isP(toks[c + 2], ')') && isP(toks[a + 1], '(') && isP(toks[a + 2], ')') && isP(toks[a + 3], '=>')) return judgeExpr(ctx, a + 4, c, st);
  }
  if (b - a === 1 && t0.k === 'id') return judgeIdent(ctx, a, st);
  if (t0.k === 'id' && isP(toks[a + 1], '(') && m.get(a + 1) === b - 1) return judgeCall(ctx, a, b, st);
  if (isP(t0, '{') && m.get(a) === b - 1) return judgeObject(ctx, a, b, st);
  const pick = matchPick(ctx, a, b, st);
  if (pick !== undefined) return pick;
  return 'an expression the census cannot read whole';
}

// The whole judgement of one env value starting at token a, ending before b.
function judgeEnv(ctx, a, b, sites, at) {
  const st = { depth: 0, ambient: false, nosys: false, trusted: false, sites, at };
  const r = judgeExpr(ctx, a, b, st);
  if (r) return r;
  if (ctx.envTainted) {
    const bare = ctx.toks[a] && ctx.toks[a].k === 'id' && (ctx.toks[a].v === 'gitEnv' || ctx.toks[a].v === 'gitTestEnv') && isP(ctx.toks[a + 1], '(') && ctx.m.get(a + 1) === b - 1;
    if (!(bare && st.trusted && !st.ambient)) return 'this file rebinds process or a builtin the grammar leans on (an alias, the process module, Object, JSON, globalThis ...), so only a bare gitEnv() call is read';
  }
  if (st.ambient && ctx.envImport) return 'this file imports the process module, so a named read of the environment cannot be told from a whole copy';
  if (st.ambient && !st.nosys && !st.trusted) return 'the env reads process.env but sets no GIT_CONFIG_NOSYSTEM: \'1\'';
  return null;
}

// true when the env value, or the one declaration an identifier in it names, holds process.env whole (picks the finding's wording).
function holdsWholeEnv(ctx, a, b) {
  const { toks } = ctx;
  const scan = (x, y) => {
    for (let n = x; n < y; n++) {
      if (!isId(toks[n], 'process')) continue;
      if (!isP(toks[n + 1], '.') || (isId(toks[n + 2], 'env') && !(isP(toks[n + 3], '[') || (isP(toks[n + 3], '.') && toks[n + 4] && toks[n + 4].k === 'id')))) return true;
    }
    return false;
  };
  if (scan(a, b)) return true;
  for (let n = a; n < b; n++) {
    if (toks[n].k !== 'id') continue;
    for (const d of ctx.decls.get(toks[n].v) || []) if (d.init >= 0 && scan(d.init, exprEnd(ctx, d.init, true))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The census.
// ---------------------------------------------------------------------------
const GIT_COMMAND = /^(?:.*[\\/])?git(?:\.exe)?$/i;
const SPAWNERS = new Set(['spawnSync', 'execFileSync']);

// One reading of one file: every spawner token `accept` takes, judged. Returns the findings in source order and, for each counted git
// spawn (keyed by the offset of its spawner token), whether its env was judged safe.
function scanOne(rel, ctx, accept) {
  const findings = [];
  const calls = new Map();
  const { toks, m } = ctx;
  const fileSites = new Set();
  const spawns = [];
  for (let n = 0; n < toks.length; n++) {
    const t = toks[n];
    if (t.k !== 'id' || !SPAWNERS.has(t.v) || !accept(t)) continue;
    // A spawner named anywhere but as a call is a finding: an import under another name, a destructure with a rename, an alias
    // (const run = spawnSync), a value, an argument, and spawnSync.call / .apply / .bind / Reflect.apply(spawnSync, ...), none of
    // which the census can count. Only an import or destructure LIST names it without calling it.
    if (!isP(toks[n + 1], '(')) {
      const prev = toks[n - 1];
      const next = toks[n + 1];
      const o = nearestOpener(ctx, n);
      const listShape = (isP(prev, '{') || isP(prev, ',')) && (isP(next, ',') || isP(next, '}')) && o >= 0 && isP(toks[o], '{');
      if (!listShape) findings.push(`${rel}:${t.ln} ${t.v} is named other than as a call (re-bound, aliased, passed on, or reached by .call / .apply / .bind) -- the census cannot follow it, so it cannot count its git spawns`);
      continue;
    }
    const first = toks[n + 2];
    const second = toks[n + 3];
    const gitCmd = first && ((first.k === 'str' && GIT_COMMAND.test(first.v)) || (first.k === 'tpl' && !(second && second.k === 'tplopen') && GIT_COMMAND.test(first.v)));
    if (!gitCmd || !(isP(second, ',') || isP(second, ')'))) continue;
    calls.set(t.i, false);
    const open = n + 1;
    const close = m.get(open);
    if (close === undefined) { findings.push(`${rel}:${t.ln} unbalanced parens scanning a ${t.v}('git', ...) call -- census cannot verify it`); continue; }
    // The env must be a top-level member of an OBJECT ARGUMENT of this call (the options), never one nested in the args array
    // or in another value: a decoy env elsewhere in the call would be judged while the real options inherit process.env.
    const sites = [];
    let ca = open + 1;
    while (ca < close) {
      const ce = Math.min(exprEnd(ctx, ca, false), close);
      if (isP(toks[ca], '{') && m.get(ca) === ce - 1) {
        const found = [];
        let spread = false;
        for (let k = ca + 1; k < ce - 1;) {
          const me = Math.min(exprEnd(ctx, k, false), ce - 1);
          if (isP(toks[k], '...') || isP(toks[k], '[') || ((isId(toks[k], 'get') || isId(toks[k], 'set')) && toks[k + 1] && (toks[k + 1].k === 'id' || toks[k + 1].k === 'str') && isP(toks[k + 2], '('))) spread = true;
          else if ((isId(toks[k], 'env') || (toks[k] && toks[k].k === 'str' && toks[k].v === 'env')) && isP(toks[k + 1], ':')) found.push({ j: k, a: k + 2, b: me, shorthand: false });
          else if (isId(toks[k], 'env') && me - k === 1) found.push({ j: k, a: k, b: k + 1, shorthand: true });
          k = me + 1;
        }
        for (const x of found) sites.push({ ...x, spread });
      }
      ca = ce + 1;
    }
    if (!sites.length) { findings.push(`${rel}:${t.ln} ${t.v}('git', ...) carries no 'env:' -- must route through gitEnv() (CWK-133/C-4)`); continue; }
    for (const s of sites) fileSites.add(s.shorthand ? s.j : s.b - s.a === 1 ? s.a : -1);
    spawns.push({ t, open, close, sites });
  }
  for (const { t, open, sites } of spawns) {
    let bad = null;
    for (const s of sites) {
      const reason = s.spread ? 'the options object holds a spread, a computed key or an accessor, which could override env' : judgeEnv(ctx, s.a, s.b, fileSites, open);
      if (reason) { bad = { reason, s }; break; }
    }
    if (!bad) { calls.set(t.i, true); continue; }
    const whole = holdsWholeEnv(ctx, bad.s.a, bad.s.b);
    if (whole) findings.push(`${rel}:${t.ln} ${t.v}('git', ...) env: holds process.env without gitEnv() -- ambient GIT_* reaches the child (CWK-133/C-4, CWK-136)`);
    else if (bad.s.shorthand) findings.push(`${rel}:${t.ln} ${t.v}('git', ...) shorthand env is neither an allowlist env (named keys, GIT_CONFIG_NOSYSTEM=1, no GIT_* beyond the safe three) nor resolvable here (${bad.reason}) -- route it through gitEnv() (CWK-133/C-4)`);
    else findings.push(`${rel}:${t.ln} ${t.v}('git', ...) env: is neither gitEnv() nor an allowlist env of named keys (${bad.reason}) -- route it through gitEnv() (CWK-133/C-4)`);
  }
  return { findings, calls };
}

// The census of one file reads it more than once where a slash is ambiguous (ceiling item 1): once as lexed, and again for each '/' the
// lexer took for division after a ')' or '}' that is not a block head, with that slash read as the start of a regex. The two readings
// can part ways past the slash's own line, because the division reading may open a template or a backslash-continued string that
// runs onto later lines and swallows a spawn there (X1-X3), so every spawn after the slash, to the end of the file, is judged again;
// a spawn found by either reading is counted, and a finding from either reading is a finding. A second ambiguous slash that only
// appears once the first is read as a regex is forced in turn, and a file whose readings pass MAX_READINGS is itself a finding. The
// cost is a false finding on genuine division followed by a quote or a backtick, in a file that names a git spawn after it, never
// a silent pass.
const MAX_READINGS = 16;
const hasSpawner = (text, from) => { const tail = text.slice(from); return [...SPAWNERS].some((s) => tail.includes(s)); };

export function scanGitSpawns(files, exempt = CENSUS_EXEMPT) {
  const findings = [];
  let calls = 0;
  let safe = 0;
  let exempted = 0;
  for (const { rel, text } of files) {
    if (exempt.some((e) => e.rel === rel && e.blob === gitBlobId(text))) { exempted++; continue; }
    const ctx = buildCtx(text, null, rel);
    const base = scanOne(rel, ctx, () => true);
    findings.push(...base.findings);
    const state = new Map(base.calls);
    const queue = ctx.amb.filter((a) => hasSpawner(text, a.i)).map((a) => ({ force: [a.i], ln: a.ln }));
    for (let r = 0; r < queue.length; r++) {
      const { force, ln } = queue[r];
      if (r >= MAX_READINGS) { findings.push(`${rel}:${ln} more than ${MAX_READINGS} ways to read the slashes that precede a spawn (a '/' after a ')' or '}' may be division or a regex) -- the census stops reading and refuses the file`); break; }
      const alt = buildCtx(text, new Set(force), rel);
      const res = scanOne(rel, alt, (t) => t.i > force[0]);
      for (const f of res.findings) if (!findings.includes(f)) findings.push(f);
      for (const [i, ok] of res.calls) state.set(i, (state.has(i) ? state.get(i) : true) && ok);
      for (const a of alt.amb) if (a.i > force[force.length - 1] && hasSpawner(text, a.i)) queue.push({ force: [...force, a.i], ln });
    }
    calls += state.size;
    for (const ok of state.values()) if (ok) safe++;
  }
  return { findings, files: files.length, calls, safe, exempted };
}

export function censusGitSpawns(files, exempt = CENSUS_EXEMPT) {
  return scanGitSpawns(files, exempt).findings;
}

// Real filesystem walk of scripts/**/*.mjs, `rel` relative to `repo` so a finding names the
// exact path the reviewer's own manual census used (`scripts/lib/...`).
export function collectScriptsMjs(repo) {
  const scriptsDir = path.join(repo, 'scripts');
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.mjs')) {
        files.push({ rel: path.relative(repo, p).replace(/\\/g, '/'), text: fs.readFileSync(p, 'utf8') });
      }
    }
  })(scriptsDir);
  return files;
}
