// THE WITNESS LIST AS DATA (08d, merged into the canon 2026-10-09): the union of what seven rooms' reviewers found against their git-spawn censuses, rounds 1 to 3
// (the chief's scratchpad/dispatch/08d-census-witness-list.md: F1-F60 a git spawn whose env must be a finding, R1-R5 a spawn the census must COUNT, P1-P7 an env it must pass
// with no pin). One entry per vector; `texts` are whole fixture files, so a vector that declares `const env` carries BOTH call forms (the shorthand `{ env }` and
// `env: env`). Three sources are merged: CoalTipple's fixtures (F1-F42, R1-R2, its own X, B, N and I rows, P3-P8), the round-3 rows written for the canon from the list's own
// wording (ROUND3), and CoalFace's independent fixtures of the same rows (FROM_FACE, `src: 'CoalFace'`). Every fixture is a string or a template literal here, so the real
// census (a token census) reads none of it as a spawn. Used by git-env-census.test.mjs. A new bypass a reviewer finds is added here as a row before its fix is written.
const BT = String.fromCharCode(96);
const SHORT = "spawnSync('git', ['status'], { env });";
const KEYED = "spawnSync('git', ['status'], { env: env });";
const INLINE = (expr) => `spawnSync('git', ['status'], { env: ${expr} });`;
// A const env declaration, judged through both call forms.
const both = (decl) => [`${decl}\n${SHORT}\n`, `${decl}\n${KEYED}\n`];
const PICK = "Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]))";
const KEEP = "const keep = ['PATH', 'HOME'];";
const ALLOW = "const env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1' };";
const NOSYS = "GIT_CONFIG_NOSYSTEM: '1'";
const PICKENV = (tail) => `${KEEP}\nconst env = { ...${PICK}, ${tail} };`;
// A spawn on the same line as a regex holding a quote, after a '}' or ')' the lexer may read as division: the first reading loses the line.
const RAW = "spawnSync('git', ['status'], { env: process.env });";
const DIRTY = 'const env = { ...process.env };';
const HIDE = (head, spawn) => `${head}\n/'/.test(String(1)) || ${spawn} // '\n`;
const TWO = (spawn) => `L: {} /'/.test(1); L2: {} /"/.test(2) || ${spawn} // "\n`;
// The same slash, but the division reading opens a template or a backslash-continued string that runs onto the NEXT line and swallows the spawn there.
const BS = String.fromCharCode(92);
const TPL = (head, spawn) => `${head}\n/${BT}/.test(String(1));\n${spawn}\n// ${BT}\n`;
const CONT = (head, spawn) => `${head}\n/'/.test(String(1)); // ${BS}\n${spawn}\n// '\n`;

// ---- CoalTipple's fixtures: the list's rounds 1 and 2, its own X, B and N rows (round 3's F49, F50, F52, F55-F57, F59) and the import rows I1, I2 ----
const FROM_TIPPLE = [
  // whole-object copies, one or more hops away
  { id: 'F1', expect: 'fail', texts: [...both(`const base = { ...process.env };\nconst env = { ...base, ${NOSYS} };`), ...both(`const extra = process.env;\nconst env = { ...extra, ${NOSYS} };`), ...both(`const e = process.env;\nconst env = { ...Object.fromEntries(Object.entries(e)), ${NOSYS} };`)] },
  { id: 'F2', expect: 'fail', texts: both(`const env = { ...Object.fromEntries(Object.entries(process.env)), ${NOSYS} };`) },
  { id: 'F3', expect: 'fail', texts: both(`const env = { ...Object.fromEntries(Object.entries(process.env).filter(() => true)), ${NOSYS} };`) },
  { id: 'F4', expect: 'fail', texts: both(`const env = { ...process['env'], ${NOSYS} };`) },
  { id: 'F5', expect: 'fail', texts: both(`import { env as penv } from 'node:process';\nconst env = { ...penv, ${NOSYS} };`) },
  { id: 'F6', expect: 'fail', texts: [INLINE(`{ ...gitEnv(d), ...process.env }`), ...both('const env = { ...gitEnv(d), ...process.env };')] },
  { id: 'F7', expect: 'fail', texts: both('const base = { ...process.env };\nconst env = { ...gitEnv(d), ...base };') },
  { id: 'F8', expect: 'fail', texts: [INLINE(`{ ${NOSYS}, extra: { ...process.env } }`), ...both(`const env = { ${NOSYS}, extra: { ...process.env } };`)] },
  { id: 'F9', expect: 'fail', texts: both(`const keep = ['PATH'];\nconst env = { ...Object.fromEntries(keep.filter(Boolean).map((k) => [k, process.env[k]]).concat(Object.entries(process.env))), ${NOSYS} };`) },
  { id: 'F10', expect: 'fail', texts: both(`const keep = ['PATH'];\nconst env = { ...Object.fromEntries(keep.filter(Boolean).flatMap(() => Object.entries(process.env))), ${NOSYS} };`) },
  { id: 'F11', expect: 'fail', texts: [INLINE(`{ ${NOSYS}, all: process.env }`), ...both(`const env = { ${NOSYS}, all: process.env };`)] },
  // helpers and aliases
  { id: 'F12', expect: 'fail', texts: both(`function all() { return process.env; }\nconst env = { ...Object.fromEntries(Object.entries(all())), ${NOSYS} };`) },
  { id: 'F13', expect: 'fail', texts: [`function mk(x) { if (x) return { PATH: process.env.PATH, ${NOSYS} }; return process.env; }\n${INLINE('mk(d)')}\n`, ...both('function mk(x) { if (x) return { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: \'1\' }; return process.env; }\nconst env = mk(d);')] },
  { id: 'F14', expect: 'fail', texts: [`${INLINE('sandboxEnv(cwd)')}\n`, `import { sandboxEnv } from './sandbox.mjs';\n${INLINE('sandboxEnv(cwd)')}\n`, ...both('const env = sandboxEnv(cwd);')] },
  // mutation after declaration
  { id: 'F15', expect: 'fail', texts: both(`${PICKENV(NOSYS)}\nObject.assign(env, process.env);`) },
  { id: 'F16', expect: 'fail', texts: both(`const env = { ${NOSYS} };\nfor (const k of Object.keys(process.env)) env[k] = process.env[k];`) },
  { id: 'F17', expect: 'fail', texts: both(`${PICKENV(NOSYS)}\nenv.GIT_DIR = '/elsewhere/.git';`) },
  { id: 'F18', expect: 'fail', texts: both(`const keep = ['PATH'];\nkeep.push('GIT_DIR');\nconst env = { ...${PICK}, ${NOSYS} };`) },
  // the GIT_ names and the NOSYSTEM literal
  { id: 'F19', expect: 'fail', texts: both(`const keep = ['PATH', 'GIT_DIR'];\nconst env = { ...${PICK}, ${NOSYS} };`) },
  { id: 'F20', expect: 'fail', texts: both(`const k2 = ['GIT_DIR'];\nconst keep = ['PATH', ...k2];\nconst env = { ...${PICK}, ${NOSYS} };`) },
  { id: 'F21', expect: 'fail', texts: both(`const keep = ['PATH', 'GIT_' + 'DIR'];\nconst env = { ...${PICK}, ${NOSYS} };`) },
  { id: 'F22', expect: 'fail', texts: both(`const env = { ${NOSYS}, ['GIT' + '_DIR']: process.env['GIT' + '_DIR'] };`) },
  { id: 'F23', expect: 'fail', texts: both(`${KEEP}\nconst env = { ...${PICK}, GIT_CONFIG_NOSYSTEM: '0' };`) },
  { id: 'F24', expect: 'fail', texts: both(`${KEEP}\nconst env = { ...${PICK}, ${NOSYS}, GIT_CONFIG_NOSYSTEM: '0' };`) },
  { id: 'F25', expect: 'fail', texts: both(`${KEEP}\nconst pick = ${PICK};\nconst over = { GIT_CONFIG_NOSYSTEM: '0' };\nconst env = { ${NOSYS}, ...pick, ...over };`) },
  { id: 'F26', expect: 'fail', texts: both(`${KEEP}\nconst env = { ...${PICK}, TEMP: '/t' };`) },
  { id: 'F27', expect: 'fail', texts: both(`${KEEP}\nconst flag = '1';\nconst env = { ...${PICK}, GIT_CONFIG_NOSYSTEM: flag };`) },
  { id: 'F28', expect: 'fail', texts: both(`${KEEP}\n// GIT_CONFIG_NOSYSTEM: '1' is set below\nconst env = { ...${PICK}, TEMP: '/t' };`) },
  { id: 'F29', expect: 'fail', texts: both(`const env = { PATH: process.env.PATH, git_dir: d, ${NOSYS} };`) },
  { id: 'F30', expect: 'fail', texts: both(`const env = { PATH: process.env.PATH, GIT_DIR: d, ${NOSYS} };`) },
  // scope and binding
  { id: 'F31', expect: 'fail', texts: [`function a() { ${ALLOW} return ${SHORT} }\nfunction b() { const env = { ...process.env }; return ${SHORT} }\n`, `function a() { ${ALLOW} return ${KEYED} }\nfunction b() { const env = { ...process.env }; return ${KEYED} }\n`] },
  { id: 'F32', expect: 'fail', texts: [`${ALLOW}\nfunction b() { let env = { ...process.env }; return ${SHORT} }\n`, `${ALLOW}\nfunction b() { let env = { ...process.env }; return ${KEYED} }\n`] },
  { id: 'F33', expect: 'fail', texts: [`${ALLOW}\nfunction run(env) { return ${SHORT} }\n`, `${ALLOW}\nfunction run(env) { return ${KEYED} }\n`, `function run(env) { return ${SHORT} }\n`, `function run(env) { return ${KEYED} }\n`] },
  { id: 'F34', expect: 'fail', texts: [`function a() { const e2 = { PATH: process.env.PATH, ${NOSYS} }; return spawnSync('git', ['a'], { env: e2 }); }\nfunction b() { const e2 = { ...process.env }; return spawnSync('git', ['b'], { env: e2 }); }\n`] },
  // round 2
  { id: 'F35', expect: 'fail', texts: both(`${ALLOW}\nconst alias = env;\nfor (const k in process.env) alias[k] = process.env[k];`) },
  { id: 'F36', expect: 'fail', texts: both(`${ALLOW}\nfunction fill(o) { for (const k in process.env) o[k] = process.env[k]; }\nfill(env);`) },
  { id: 'F37', expect: 'fail', texts: both(`${ALLOW}\nReflect.set(env, 'GIT_DIR', d);`) },
  { id: 'F38', expect: 'fail', texts: both(`${ALLOW}\nconst alias = env;\nalias.GIT_DIR = d;`) },
  { id: 'F39', expect: 'fail', texts: both(`${ALLOW}\nObject.assign(Object(env), { GIT_DIR: d });`) },
  { id: 'F40', expect: 'fail', texts: both(`${ALLOW}\nenv.__defineGetter__('GIT_DIR', () => d);`) },
  { id: 'F41', expect: 'fail', texts: [
    ...both(`const env = { a: /'/, GIT_DIR: d, ${NOSYS} };`),
    ...both(`const env = { a: ${BT}\\${BT}${BT}, GIT_DIR: d, ${NOSYS} };`),
    ...both(`const re = /"/;\nconst env = { PATH: process.env.PATH, GIT_DIR: d, ${NOSYS} };`),
    ...both(`const env = { u: 'http://x', GIT_DIR: d, ${NOSYS} };`),
    ...both(`const env = { u: ${BT}\${'a'}${BT}, p: /[/']/, GIT_DIR: d, ${NOSYS} };`),
  ] },
  { id: 'F42', expect: 'fail', texts: [
    `const gitEnv = () => ({ ...process.env });\n${INLINE('gitEnv()')}\n`,
    `function gitEnv() { return { ...Object.fromEntries(Object.entries(process.env)) }; }\n${INLINE('gitEnv()')}\n`,
    `const gitEnv = () => process.env;\n${INLINE("{ ...gitEnv(), LC_ALL: 'C' }")}\n`,
    `const gitTestEnv = (d) => ({ ...process.env, HOME: d });\n${INLINE('gitTestEnv(d)')}\n`,
    ...both('const gitEnv = () => ({ ...process.env });\nconst env = gitEnv();'),
  ] },
  // recognition: the census must COUNT the spawn, then judge its env
  { id: 'R1', expect: 'fail', texts: [`spawnSync(${BT}git${BT}, ['status'], { env: process.env });\n`] },
  { id: 'R2', expect: 'fail', texts: [`spawnSync('git.exe', ['status'], { env: process.env });\n`, `execFileSync('git.exe', ['status'], { cwd: d });\n`] },
  // room-local candidates found while building the census (not on the witness list; offered to the chief as rows X1-X6)
  { id: 'X1', expect: 'fail', texts: both(`const p = process;\nconst env = { all: p.env, ${NOSYS} };`) },
  { id: 'X2', expect: 'fail', texts: ["spawnSync('git', [{ env: gitEnv(d) }, 'status'], { cwd: d });\n"] },
  { id: 'X3', expect: 'fail', noCount: true, texts: ["import { spawnSync as run } from 'node:child_process';\nrun('git', ['status'], { env: process.env });\n", "const { execFileSync: run } = cp;\nrun('git', ['status'], { env: process.env });\n"] },
  { id: 'X4', expect: 'fail', texts: [...both(`const env = { __proto__: process.env, ${NOSYS} };`), ...both(`import { env as penv } from 'node:process';\nconst env = { __proto__: penv, ${NOSYS} };`)] },
  { id: 'X5', expect: 'fail', texts: ["spawnSync('git', ['status'], { env: gitEnv(d), ...opts });\n", "spawnSync('git', ['status'], { ...opts, env: gitEnv(d) });\n"] },
  { id: 'X6', expect: 'fail', texts: ["spawnSync('git', ['status'], { env: gitEnv(d), env: process.env });\n"] },
  // 08d bounce 1: the INSPECT attack past the list (B1-B9), shapes the 99593ee census refused or the token census passed
  { id: 'B1', expect: 'fail', texts: ["function f() {}\n/'/.test(String(1)) && spawnSync('git', ['status'], { env: process.env }); // '\n", "const x = 1;\nif (x) /'/.test(String(x)); spawnSync('git', ['status'], { env: process.env }); // '\n", "const x = 1;\nwhile (x) /'/.test(String(x)); spawnSync('git', ['status'], { env: process.env }); // '\n"] },
  { id: 'B2', expect: 'fail', texts: [...both(`${ALLOW}\n({ GIT_DIR: env.GIT_DIR } = { GIT_DIR: '/elsewhere/.git' });`), ...both(`${ALLOW}\n[env.GIT_DIR] = ['/elsewhere/.git'];`), ...both(`${ALLOW}\nfor (env.GIT_DIR of ['/elsewhere/.git']) { /* nothing */ }`), ...both(`${ALLOW}\nfor (env.GIT_DIR in { a: 1 }) { /* nothing */ }`)] },
  { id: 'B3', expect: 'fail', texts: [...both(`${KEEP}\nkeep.forEach((k, i, a) => { a[i] = 'GIT_DIR'; });\nconst env = { ...${PICK}, ${NOSYS} };`), ...both(`${KEEP}\nkeep.map((k, i, a) => a.push('GIT_DIR'));\nconst env = { ...${PICK}, ${NOSYS} };`), ...both(`${KEEP}\nkeep.map(function (k) { this.push('GIT_DIR'); }, keep);\nconst env = { ...${PICK}, ${NOSYS} };`)] },
  { id: 'B4', expect: 'fail', texts: both(`${ALLOW}\nJSON.stringify(env, function (k, v) { if (k) this.GIT_DIR = '/elsewhere/.git'; return v; });`) },
  { id: 'B5', expect: 'fail', texts: [...both(`const Object = { fromEntries: () => ({ ...process.env }), keys: globalThis.Object.keys };\n${PICKENV(NOSYS)}`), ...both(`import { Object } from './shim.mjs';\n${PICKENV(NOSYS)}`), ...both(`const JSON = { stringify: () => '' };\n${ALLOW}`)] },
  { id: 'B6', expect: 'fail', texts: [`${SHORT}\nvar env = { PATH: process.env.PATH, ${NOSYS} };\n`, `${KEYED}\nvar env = { PATH: process.env.PATH, ${NOSYS} };\n`, `${SHORT}\nconst env = { PATH: process.env.PATH, ${NOSYS} };\n`, `${KEYED}\nlet env = { PATH: process.env.PATH, ${NOSYS} };\n`, `var env = { PATH: process.env.PATH, ${NOSYS} };\n${SHORT}\n`] },
  { id: 'B7', expect: 'fail', texts: ["globalThis.gitEnv = () => process.env;\n" + INLINE('gitEnv()') + '\n', "gitEnv = () => process.env;\n" + INLINE('gitEnv()') + '\n', "Object.assign(globalThis, { gitTestEnv: () => process.env });\n" + INLINE('gitTestEnv()') + '\n'] },
  { id: 'B8', expect: 'fail', noCount: true, texts: ["spawnSync.call(null, 'git', ['status'], { env: process.env });\n", "spawnSync.apply(null, ['git', ['status'], { env: process.env }]);\n", "Reflect.apply(execFileSync, null, ['git', ['status'], { env: process.env }]);\n", "const run = spawnSync;\nrun('git', ['status'], { env: process.env });\n"] },
  { id: 'B9', expect: 'fail', texts: both(`Object.prototype.GIT_DIR = '/elsewhere/.git';\n${ALLOW}`) },
  // 08d bounce 2: a slash after ')' or '}' read as division is ALSO read as the start of a regex, and the spawns either reading finds are judged
  // (the re-INSPECT's M-1r: N17 a regex after a labelled block, N24 after a case block; N25 a regex after a for-await head)
  { id: 'N17', expect: 'fail', texts: [HIDE('L: {}', RAW), HIDE(`${DIRTY}\nL: {}`, SHORT), HIDE(`${DIRTY}\nL: {}`, KEYED)] },
  { id: 'N24', expect: 'fail', texts: [HIDE('const x = 1;\nswitch (x) { case 1: {}', RAW) + '}\n', HIDE(`${DIRTY}\nconst x = 1;\nswitch (x) { case 1: {}`, SHORT) + '}\n', HIDE(`${DIRTY}\nconst x = 1;\nswitch (x) { case 1: {}`, KEYED) + '}\n'] },
  { id: 'N25', expect: 'fail', texts: [HIDE('async function f(y) { for await (const x of y)', RAW) + '}\n', HIDE(`${DIRTY}\nasync function f(y) { for await (const x of y)`, SHORT) + '}\n'] },
  // two ambiguous slashes on one line: the second shows only once the first is read as a regex; and a line with more ways to read it than the budget
  { id: 'N26', expect: 'fail', texts: [TWO(RAW), `${DIRTY}\n${TWO(SHORT)}`, `${DIRTY}\n${TWO(KEYED)}`] },
  { id: 'N27', expect: 'fail', texts: [`const v = ${Array(20).fill('(a)').join(' / ')}; spawnSync('git', ['status'], { env: gitEnv(d) });\n`] },
  // 08d bounce 3 (the re-INSPECT 2's M-2r, X1-X3): the division reading opens a template or a continued string that hides the spawn on a LATER line
  { id: 'N28', expect: 'fail', texts: [TPL('L: {}', RAW), TPL(`${DIRTY}\nL: {}`, SHORT), TPL(`${DIRTY}\nL: {}`, KEYED)] },
  { id: 'N29', expect: 'fail', texts: [CONT('L: {}', RAW), CONT(`${DIRTY}\nL: {}`, SHORT), CONT(`${DIRTY}\nL: {}`, KEYED)] },
  { id: 'N30', expect: 'fail', texts: [TPL('const x = 1;\nswitch (x) { case 1: {}', RAW) + '}\n', TPL(`${DIRTY}\nconst x = 1;\nswitch (x) { case 1: {}`, SHORT) + '}\n', TPL(`${DIRTY}\nconst x = 1;\nswitch (x) { case 1: {}`, KEYED) + '}\n'] },
  // 08d bounce 2: an imported gitEnv / gitTestEnv is trusted only by that name from the room's own git-env.mjs (I1 refused, I2 passed)
  { id: 'I1', expect: 'fail', texts: [
    `import { gitEnv } from './elsewhere.mjs';\n${INLINE('gitEnv(d)')}\n`,
    `import { gitEnv } from 'node:x';\n${INLINE('gitEnv(d)')}\n`,
    `import { gitTestEnv } from './lib/git-env.js';\n${INLINE('gitTestEnv(d)')}\n`,
    `import { gitEnv } from './git-env.mjs/../evil.mjs';\n${INLINE('gitEnv(d)')}\n`,
    `import { evil as gitEnv } from './git-env.mjs';\n${INLINE('gitEnv(d)')}\n`,
    `import gitEnv from './git-env.mjs';\n${INLINE('gitEnv(d)')}\n`,
    `import * as gitEnv from './git-env.mjs';\n${INLINE('gitEnv(d)')}\n`,
    `const { gitEnv } = await import('./elsewhere.mjs');\n${INLINE('gitEnv(d)')}\n`,
    `const { gitEnv } = require('node:x');\n${INLINE('gitEnv(d)')}\n`,
    `const { gitEnv } = await import(where);\n${INLINE('gitEnv(d)')}\n`,
    ...both(`import { gitEnv } from './elsewhere.mjs';\nconst env = gitEnv(d);`),
    `import { gitEnv } from './lib/git-env.mjs';\nasync function f(d) { const { gitEnv } = await import('./elsewhere.mjs'); return ${INLINE('gitEnv(d)')} }\n`,
  ] },
  // the controls
  { id: 'I2', expect: 'pass', texts: [
    `import { gitEnv } from './git-env.mjs';\n${INLINE('gitEnv(d)')}\n`,
    `import { gitEnv } from './lib/git-env.mjs';\n${INLINE('gitEnv(d)')}\n`,
    `import { gitEnv, other } from "./lib/git-env.mjs";\n${INLINE('gitEnv(d)')}\n`,
    `import { gitTestEnv } from './git-env.mjs';\n${INLINE('gitTestEnv(d)')}\n`,
    `const { gitEnv } = await import('./lib/git-env.mjs');\n${INLINE('gitEnv(d)')}\n`,
    ...both(`import { gitEnv } from './git-env.mjs';\nconst env = gitEnv(d);`),
  ] },
  { id: 'P7', expect: 'pass', texts: ["const half = (n + 1) / 2; spawnSync('git', ['status'], { env: gitEnv(d) }); // half/2\n", "const half = f(n) / 2; const s = '/x'; spawnSync('git', ['status'], { env: gitEnv(d) });\n"] },
  { id: 'P8', expect: 'pass', texts: [TPL('L: {}', INLINE('gitEnv(d)')), CONT('L: {}', INLINE('gitEnv(d)'))] },
  { id: 'P3', expect: 'pass', texts: [INLINE('gitEnv(d)') + '\n', ...both('const env = gitEnv(d);')] },
  { id: 'P4', expect: 'pass', texts: [INLINE("{ PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: '1' }") + '\n'] },
  { id: 'P5', expect: 'pass', texts: [...both(`${KEEP}\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), ${NOSYS} };`), ...both(`${PICKENV(NOSYS)}`)] },
  { id: 'P6', expect: 'pass', texts: both(`const keep = ['PATH'];\nconst pick = ${PICK};\nconst env = { ...pick, ${NOSYS}, GIT_TERMINAL_PROMPT: '0', GIT_CEILING_DIRECTORIES: d };`) },
];

const ROUND3 = [
  // ---- ROUND 3 of the witness list (F43-F54, F58, F60, R3), written for the canon from the list's own wording; the earlier rounds' rows above carry the finders' ids ----
  // F43 an escaped name in the named list (a backslash, the letter u and four hex digits, built from a code point: a typed escape can arrive already decoded)
  { id: 'F43', expect: 'fail', texts: both(`const keep = ['PATH', '${BS}u0047IT_DIR'];\nconst env = { ...${PICK}, ${NOSYS} };`) },
  // F44 the map callback emits a key other than its own parameter
  { id: 'F44', expect: 'fail', texts: both(`${KEEP}\nconst env = { ...Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => ['GIT_DIR', process.env[k]])), ${NOSYS} };`) },
  // F45 a declaration continued on the next line
  { id: 'F45', expect: 'fail', texts: [
    ...both(`const env = { PATH: process.env.PATH, ${NOSYS} }\n&& process.env;`),
    ...both(`const env = { PATH: process.env.PATH, ${NOSYS} }\n|| process.env;`),
    ...both(`const env = { PATH: process.env.PATH, ${NOSYS} }\n?? process.env;`),
    ...both(`const env = { PATH: process.env.PATH, ${NOSYS} }\n? process.env : {};`),
  ] },
  // F46 a helper's single return with a tail
  { id: 'F46', expect: 'fail', texts: [
    `function mk() { return { PATH: process.env.PATH, ${NOSYS} } && process.env; }\n${INLINE('mk()')}\n`,
    `function mk() { return { PATH: process.env.PATH, ${NOSYS} }, process.env; }\n${INLINE('mk()')}\n`,
    `const mk = () => { return { PATH: process.env.PATH, ${NOSYS} }, process.env; };\n${INLINE('mk()')}\n`,
  ] },
  // F47 an options entry the census cannot read beside a readable env: a computed key, or a getter
  { id: 'F47', expect: 'fail', texts: [
    `spawnSync('git', ['status'], { env: gitEnv(d), ['env']: process.env });\n`,
    `spawnSync('git', ['status'], { env: gitEnv(d), get env() { return process.env; } });\n`,
    `spawnSync('git', ['status'], { ['en' + 'v']: process.env, env: gitEnv(d) });\n`,
  ] },
  // F48 an argument after the options object
  { id: 'F48', expect: 'fail', texts: [`spawnSync('git', ['status'], { env: process.env }, { env: { PATH: process.env.PATH, ${NOSYS} } });\n`, `spawnSync('git', ['status'], { env: gitEnv(d) }, { env: process.env });\n`] },
  // F49 a regex after if(...) holding a quote hides a mutation on the same line
  { id: 'F49', expect: 'fail', texts: [`const env = { PATH: process.env.PATH, ${NOSYS} };\nif (1) /'/.test('x'); env.GIT_DIR = d; // '\n${SHORT}\n`, `const env = { PATH: process.env.PATH, ${NOSYS} };\nif (1) /'/.test('x'); env.GIT_DIR = d; // '\n${KEYED}\n`] },
  // F50 a global helper
  { id: 'F50', expect: 'fail', texts: [`globalThis.gitEnv = () => process.env;\n${INLINE('gitEnv()')}\n`] },
  // F51 a dynamic import whose literal segments equal the definer path under an unbound base
  { id: 'F51', expect: 'fail', texts: [`const base = './';\nconst { gitEnv } = await import(base + 'lib/git-env.mjs');\n${INLINE('gitEnv(d)')}\n`, `const { gitEnv } = await import(${BT}\${base}lib/git-env.mjs${BT});\n${INLINE('gitEnv(d)')}\n`] },
  // F52 a shadowed global the grammar leans on
  { id: 'F52', expect: 'fail', texts: [`const Object = { fromEntries: () => process.env };\n${KEEP}\nconst env = { ...${PICK}, ${NOSYS} };\n${SHORT}\n`] },
  // F53 a write through the decrement
  { id: 'F53', expect: 'fail', texts: both(`const env = { PATH: process.env.PATH, ${NOSYS} };\nenv.GIT_CONFIG_NOSYSTEM--;`) },
  // F54 a write through a comma expression
  { id: 'F54', expect: 'fail', texts: both(`const env = { PATH: process.env.PATH, ${NOSYS} };\n(0, env).GIT_DIR = d;`) },
  // F58 a __proto__ key in the allowlist literal
  { id: 'F58', expect: 'fail', texts: [...both(`const env = { __proto__: process.env, ${NOSYS} };`), `spawnSync('git', ['status'], { env: { '__proto__': process.env, ${NOSYS} } });\n`] },
  // F60 a gitEnv bound as a parameter, by destructuring, or in a loop, and used as the env
  { id: 'F60', expect: 'fail', texts: [
    `function f(gitEnv) { spawnSync('git', ['status'], { env: gitEnv() }); }\n`,
    `const f = (gitEnv) => spawnSync('git', ['status'], { env: gitEnv() });\n`,
    `const f = gitEnv => spawnSync('git', ['status'], { env: gitEnv() });\n`,
    `function f({ gitEnv }) { spawnSync('git', ['status'], { env: gitEnv() }); }\n`,
    `try { x(); } catch (gitEnv) { spawnSync('git', ['status'], { env: gitEnv() }); }\n`,
    `const { gitEnv } = evil;\n${INLINE('gitEnv()')}\n`,
    `for (const gitEnv of fns) { ${INLINE('gitEnv()').trim()} }\n`,
  ] },
  // R3 a member callee is still a counted spawn
  { id: 'R3', expect: 'fail', texts: [`const cp = require('node:child_process');\ncp.spawnSync('git', ['status'], { env: process.env });\n`, `import * as cp from 'node:child_process';\ncp.execFileSync('git', ['status'], { env: process.env });\n`] },
  // P9 the lock rows for the round: a helper imported by its own name and a parameter named something else are NOT refused
  { id: 'P9', expect: 'pass', texts: [`import { gitEnv } from './lib/git-env.mjs';\nfunction f(root, extra) { return spawnSync('git', ['status'], { cwd: root, env: gitEnv(root) }); }\n`, `import { gitEnv } from './git-env.mjs';\nexport const run = (args) => spawnSync('git', args, { env: gitEnv() });\n`] },
];

// Spawns the census does NOT count, named as ceilings (the list's R4 and R5): until a census counts them the row stays here and the test holds that it is what it says, so
// the day one of them is counted the test goes red and the ceiling item in the census header is rewritten with it.
export const CEILINGS = [
  { id: 'R4', why: 'a spawner whose name is written with a unicode escape sequence: valid JavaScript, a spawn the lexer reads under another name', texts: [`spawn${BS}u0053ync('git', ['status'], { env: process.env });\n`] },
  { id: 'R5', why: 'a command built by concatenation: the census reads only a literal \'git\', \'git.exe\' or a template holding just git', texts: [`spawnSync('gi' + 't', ['status'], { env: process.env });\n`] },
];

// Where a witness id of the list is carried by a row under the finders' own ids (every other id is carried by the row of the same name).
export const COVERS = {
  F55: ['N17', 'N24', 'N25', 'N26', 'N28', 'N29', 'N30'],
  F56: ['I1', 'I2'],
  F57: ['F40', 'B2', 'B3', 'B4'],
  F59: ['B1', 'N17', 'N24'],
};

// CoalFace's fixtures of the same rows, as data.
const FROM_FACE = [
 {
  "id": "F1 alias copy, one hop {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst base = { ...process.env };\nconst env = { ...base, GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F1 alias copy, one hop env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst base = { ...process.env };\nconst env = { ...base, GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F1 const extra = process.env (CoalTipple A6) {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst extra = process.env;\nconst env = { ...extra, GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F1 const extra = process.env (CoalTipple A6) env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst extra = process.env;\nconst env = { ...extra, GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F1 Object.entries of an alias (CoalBoard A1) {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst e = process.env;\nconst env = { ...Object.fromEntries(Object.entries(e)), GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F1 Object.entries of an alias (CoalBoard A1) env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst e = process.env;\nconst env = { ...Object.fromEntries(Object.entries(e)), GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F2 fromEntries(entries(process.env)) {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { ...Object.fromEntries(Object.entries(process.env)), GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F2 fromEntries(entries(process.env)) env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { ...Object.fromEntries(Object.entries(process.env)), GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F3 a filter over the whole env {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { ...Object.fromEntries(Object.entries(process.env).filter(() => true)), GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F3 a filter over the whole env env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { ...Object.fromEntries(Object.entries(process.env).filter(() => true)), GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F4 process['env'] {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { ...process['env'], GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F4 process['env'] env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { ...process['env'], GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F5 import { env as penv } {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nimport { env as penv } from 'node:process';\nconst env = { ...penv, GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F5 import { env as penv } env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nimport { env as penv } from 'node:process';\nconst env = { ...penv, GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F6 {...gitEnv(d), ...process.env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nspawnSync('git', ['status'], { env: { ...gitEnv(d), ...process.env } });\n"
  ]
 },
 {
  "id": "F7 {...gitEnv(d), ...base} {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst base = { ...process.env };\nconst env = { ...gitEnv(d), ...base };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F7 {...gitEnv(d), ...base} env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst base = { ...process.env };\nconst env = { ...gitEnv(d), ...base };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F8 nested spread {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { GIT_CONFIG_NOSYSTEM: '1', extra: { ...process.env } };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F8 nested spread env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { GIT_CONFIG_NOSYSTEM: '1', extra: { ...process.env } };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F9 concat of Object.entries after an allowed spread {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst env = { ...Object.fromEntries(keep.filter(Boolean).map((k) => [k, process.env[k]]).concat(Object.entries(process.env))), GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F9 concat of Object.entries after an allowed spread env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst env = { ...Object.fromEntries(keep.filter(Boolean).map((k) => [k, process.env[k]]).concat(Object.entries(process.env))), GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F10 flatMap over Object.entries {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst env = { ...Object.fromEntries(keep.filter(Boolean).flatMap(() => Object.entries(process.env))), GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F10 flatMap over Object.entries env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst env = { ...Object.fromEntries(keep.filter(Boolean).flatMap(() => Object.entries(process.env))), GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F11 a value that is process.env {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { GIT_CONFIG_NOSYSTEM: '1', all: process.env };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F11 a value that is process.env env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { GIT_CONFIG_NOSYSTEM: '1', all: process.env };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F12 helper returning process.env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nfunction all() { return process.env; }\nspawnSync('git', ['status'], { env: { ...Object.fromEntries(Object.entries(all())), GIT_CONFIG_NOSYSTEM: '1' } });\n"
  ]
 },
 {
  "id": "F13 helper with a second path returning process.env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nfunction mk(x) { if (x) return { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1' }; return process.env; }\nspawnSync('git', ['status'], { env: mk(d) });\n"
  ]
 },
 {
  "id": "F14 a helper call defined in another file",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nspawnSync('git', ['status'], { env: sandboxEnv(cwd) });\n"
  ]
 },
 {
  "id": "F15 Object.assign(env, process.env) after declaration {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nObject.assign(env, process.env);\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F15 Object.assign(env, process.env) after declaration env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nObject.assign(env, process.env);\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F16 for-of copy into env {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { GIT_CONFIG_NOSYSTEM: '1' };\nfor (const k of Object.keys(process.env)) env[k] = process.env[k];\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F16 for-of copy into env env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { GIT_CONFIG_NOSYSTEM: '1' };\nfor (const k of Object.keys(process.env)) env[k] = process.env[k];\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F17 env.GIT_DIR = x {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nenv.GIT_DIR = '/elsewhere/.git';\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F17 env.GIT_DIR = x env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nenv.GIT_DIR = '/elsewhere/.git';\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F18 the key list mutated (KEYS.push) {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst KEYS = ['PATH'];\nKEYS.push('GIT_DIR');\nconst env = { ...Object.fromEntries(KEYS.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F18 the key list mutated (KEYS.push) env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst KEYS = ['PATH'];\nKEYS.push('GIT_DIR');\nconst env = { ...Object.fromEntries(KEYS.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F19 GIT_DIR in the key list {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'GIT_DIR'];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F19 GIT_DIR in the key list env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'GIT_DIR'];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F20 GIT_DIR two consts away {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst k2 = ['GIT_DIR'];\nconst keep = ['PATH', ...k2];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F20 GIT_DIR two consts away env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst k2 = ['GIT_DIR'];\nconst keep = ['PATH', ...k2];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F21 a computed GIT_ name in the key list {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'GIT_' + 'DIR'];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F21 a computed GIT_ name in the key list env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'GIT_' + 'DIR'];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F22 a computed property key {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { GIT_CONFIG_NOSYSTEM: '1', ['GIT' + '_DIR']: process.env['GIT' + '_DIR'] };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F22 a computed property key env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { GIT_CONFIG_NOSYSTEM: '1', ['GIT' + '_DIR']: process.env['GIT' + '_DIR'] };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F23 GIT_CONFIG_NOSYSTEM zero {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '0' };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F23 GIT_CONFIG_NOSYSTEM zero env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '0' };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F24 a duplicate GIT_CONFIG_NOSYSTEM, last wins {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_NOSYSTEM: '0' };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F24 a duplicate GIT_CONFIG_NOSYSTEM, last wins env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_NOSYSTEM: '0' };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F25 NOSYSTEM one, then a spread const that sets zero {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst over = { GIT_CONFIG_NOSYSTEM: '0' };\nconst env = { GIT_CONFIG_NOSYSTEM: '1', ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), ...over };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F25 NOSYSTEM one, then a spread const that sets zero env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst over = { GIT_CONFIG_NOSYSTEM: '0' };\nconst env = { GIT_CONFIG_NOSYSTEM: '1', ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), ...over };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F26 no GIT_CONFIG_NOSYSTEM at all {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { PATH: process.env.PATH };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F26 no GIT_CONFIG_NOSYSTEM at all env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { PATH: process.env.PATH };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F27 GIT_CONFIG_NOSYSTEM not a literal {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: flag };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F27 GIT_CONFIG_NOSYSTEM not a literal env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: flag };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F28 the literal only inside a comment {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { PATH: process.env.PATH, // GIT_CONFIG_NOSYSTEM: '1'\n};\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F28 the literal only inside a comment env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { PATH: process.env.PATH, // GIT_CONFIG_NOSYSTEM: '1'\n};\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F29 a lower-case git_dir key {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { GIT_CONFIG_NOSYSTEM: '1', git_dir: d };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F29 a lower-case git_dir key env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { GIT_CONFIG_NOSYSTEM: '1', git_dir: d };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F30 an explicit GIT_DIR key {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { GIT_CONFIG_NOSYSTEM: '1', GIT_DIR: 'x' };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F30 an explicit GIT_DIR key env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { GIT_CONFIG_NOSYSTEM: '1', GIT_DIR: 'x' };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F31 clean env in a(), process.env env in b() {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nfunction a() { const env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1' }; return env; }\nfunction b() {\n  const env = { ...process.env };\n  spawnSync('git', ['status'], { env });\n}\n"
  ]
 },
 {
  "id": "F31 clean env in a(), process.env env in b() env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nfunction a() { const env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1' }; return env; }\nfunction b() {\n  const env = { ...process.env };\n  spawnSync('git', ['status'], { env: env });\n}\n"
  ]
 },
 {
  "id": "F32 module-level clean env, shadowed by an inner let {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1' };\nfunction f() {\n  let env = { ...process.env };\n  spawnSync('git', ['status'], { env });\n}\n"
  ]
 },
 {
  "id": "F32 module-level clean env, shadowed by an inner let env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1' };\nfunction f() {\n  let env = { ...process.env };\n  spawnSync('git', ['status'], { env: env });\n}\n"
  ]
 },
 {
  "id": "F33 env is a parameter, a clean const elsewhere {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1' };\nfunction f(env) {\n  spawnSync('git', ['status'], { env });\n}\n"
  ]
 },
 {
  "id": "F33 env is a parameter, a clean const elsewhere env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1' };\nfunction f(env) {\n  spawnSync('git', ['status'], { env: env });\n}\n"
  ]
 },
 {
  "id": "F34 two functions each declare e2",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nfunction a() { const e2 = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1' }; return e2; }\nfunction b() {\n  const e2 = { ...process.env };\n  spawnSync('git', ['status'], { env: e2 });\n}\n"
  ]
 },
 {
  "id": "F35 an alias, then a for-in copy {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nconst alias = env;\nfor (const k in process.env) alias[k] = process.env[k];\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F35 an alias, then a for-in copy env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nconst alias = env;\nfor (const k in process.env) alias[k] = process.env[k];\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F36 the copy moved into a helper {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nfunction fill(o) { for (const k in process.env) o[k] = process.env[k]; }\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nfill(env);\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F36 the copy moved into a helper env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nfunction fill(o) { for (const k in process.env) o[k] = process.env[k]; }\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nfill(env);\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F37 Reflect.set(env, ...) {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nReflect.set(env, 'GIT_DIR', d);\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F37 Reflect.set(env, ...) env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nReflect.set(env, 'GIT_DIR', d);\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F38 an alias, then alias.GIT_DIR = d {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nconst alias = env;\nalias.GIT_DIR = d;\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F38 an alias, then alias.GIT_DIR = d env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nconst alias = env;\nalias.GIT_DIR = d;\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F39 Object.assign(Object(env), ...) {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nObject.assign(Object(env), { GIT_DIR: d });\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F39 Object.assign(Object(env), ...) env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nObject.assign(Object(env), { GIT_DIR: d });\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F40 a method call on env (__defineGetter__) {env}",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nenv.__defineGetter__('GIT_DIR', () => d);\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F40 a method call on env (__defineGetter__) env:env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nenv.__defineGetter__('GIT_DIR', () => d);\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "F41 two regexes holding a single quote hide the GIT_DIR between them",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { GIT_CONFIG_NOSYSTEM: '1', A: /'/.test(x), GIT_DIR: d, B: /'/.test(z) };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F41 two regexes holding a double quote hide the GIT_DIR between them",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { GIT_CONFIG_NOSYSTEM: '1', A: /\"/.test(x), GIT_DIR: d, B: /\"/.test(z) };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F41 two regexes holding a backtick hide the GIT_DIR between them",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = { GIT_CONFIG_NOSYSTEM: '1', A: /`/.test(x), GIT_DIR: d, B: /`/.test(z) };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "F42 a file-local gitEnv arrow returning process.env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst gitEnv = () => ({ ...process.env });\nspawnSync('git', ['status'], { env: gitEnv() });\n"
  ]
 },
 {
  "id": "F42 a file-local gitEnv function returning process.env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nfunction gitEnv() { return process.env; }\nspawnSync('git', ['status'], { env: gitEnv() });\n"
  ]
 },
 {
  "id": "F42 a file-local gitTestEnv spreading process.env",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst gitTestEnv = (d) => ({ ...process.env, GIT_CEILING_DIRECTORIES: d });\nspawnSync('git', ['status'], { env: gitTestEnv(d) });\n"
  ]
 },
 {
  "id": "F42 gitEnv imported from a file that is not a trusted definer",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nimport { gitEnv } from './evil.mjs';\nspawnSync('git', ['status'], { env: gitEnv() });\n"
  ]
 },
 {
  "id": "R1 the command as a template literal",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nspawnSync(`git`, ['status'], { env: process.env });\n"
  ]
 },
 {
  "id": "R2 the command as git.exe",
  "src": "CoalFace",
  "expect": "fail",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nspawnSync('git.exe', ['status'], { env: process.env });\n"
  ]
 },
 {
  "id": "P3 env: gitEnv(d)",
  "src": "CoalFace",
  "expect": "pass",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nspawnSync('git', ['status'], { env: gitEnv(d) });\n"
  ]
 },
 {
  "id": "P3 const env = gitEnv(d) {env}",
  "src": "CoalFace",
  "expect": "pass",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = gitEnv(d);\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "P3 const env = gitEnv(d) env:env",
  "src": "CoalFace",
  "expect": "pass",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst env = gitEnv(d);\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "P3 trusted import of gitEnv",
  "src": "CoalFace",
  "expect": "pass",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nimport { gitEnv } from './lib/git-env.mjs';\nspawnSync('git', ['status'], { env: gitEnv() });\n"
  ]
 },
 {
  "id": "P4 an inline allowlist literal",
  "src": "CoalFace",
  "expect": "pass",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nspawnSync('git', ['status'], { env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: '1' } });\n"
  ]
 },
 {
  "id": "P5 the named-pick form {env}",
  "src": "CoalFace",
  "expect": "pass",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "P5 the named-pick form env:env",
  "src": "CoalFace",
  "expect": "pass",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1' };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 },
 {
  "id": "P6 the three allowed names together {env}",
  "src": "CoalFace",
  "expect": "pass",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_CEILING_DIRECTORIES: d };\nspawnSync('git', ['status'], { env });\n"
  ]
 },
 {
  "id": "P6 the three allowed names together env:env",
  "src": "CoalFace",
  "expect": "pass",
  "texts": [
   "import { spawnSync } from 'node:child_process';\nconst keep = ['PATH', 'HOME'];\nconst env = { ...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_CEILING_DIRECTORIES: d };\nspawnSync('git', ['status'], { env: env });\n"
  ]
 }
];

export const VECTORS = [...FROM_TIPPLE, ...ROUND3, ...FROM_FACE];
