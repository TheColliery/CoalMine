const NEWLINE = String.fromCharCode(10);
const BSN = String.fromCharCode(92) + 'n';
import test from 'node:test';
import assert from 'node:assert';
import { checkConfigKeys, checkConfigReadPath, PENDING_KEYS, NOT_CONFIG, BLIND_KEYS } from './config-keys.mjs';

// In-memory surfaces: `read` is injected, so these drive the checker with no disk IO.
const mem = (files) => (f) => {
  if (!(f in files)) throw new Error('ENOENT ' + f);
  return files[f];
};
const BASE = ['scanExcludePaths', 'autoScanFileCap'];
// Empty declarations isolate the rule under test from the self-cleaning rules.
const NONE = { pending: {}, notConfig: {}, blind: {} };

test('config-keys: THE DEFECT -- a key named in a doc but absent from the schema FAILs, naming key and file', () => {
  const out = checkConfigKeys({
    schemaKeys: BASE,
    mdFiles: ['skills/x/SKILL.md'],
    read: mem({ 'skills/x/SKILL.md': 'Set `scanEverything` to true.' }),
    ...NONE,
  });
  assert.equal(out.length, 1);
  assert.match(out[0].msg, /scanEverything/);
  assert.match(out[0].msg, /skills\/x\/SKILL\.md/);
  assert.equal(out[0].level, 'FAIL');
});

test('config-keys: a key that DOES resolve is silent', () => {
  const out = checkConfigKeys({
    schemaKeys: BASE,
    mdFiles: ['a.md'],
    read: mem({ 'a.md': 'Narrow `scanExcludePaths` or raise `autoScanFileCap`.' }),
    ...NONE,
  });
  assert.deepEqual(out, []);
});

test('config-keys: CRY-WOLF BOUND -- enum values and lowercase prose words are not candidates', () => {
  // Measured false positives a naive backtick rule produced on this repo: enum values
  // (`off`, `safe`, `interactive`, `true`, `false`) and prose (`file`, `line`, `fs`).
  const out = checkConfigKeys({
    schemaKeys: BASE,
    mdFiles: ['a.md'],
    read: mem({ 'a.md': 'Use `off`, `safe`, `interactive`, `true`, `false`, `file`, `line`, `fs`, `git log`, `--help`.' }),
    ...NONE,
  });
  assert.deepEqual(out, [], 'none of these has an internal capital, so none is a candidate');
});

test('config-keys: a hook is scanned only inside its NOTICE BLOCK, never its whole source', () => {
  const hook = [
    "function loadCfg() { const projectCfg = 1; return projectCfg; }",
    "const TRANSLATIONS = {",
    "  en: { note: 'Set scanEverything to true; skipped per scanExcludePaths.' },",
    "};",
    "const watchedExts = new Set();",
  ].join(NEWLINE);
  const out = checkConfigKeys({
    schemaKeys: BASE,
    hookFiles: ['h.js'],
    read: mem({ 'h.js': hook }),
    ...NONE,
  });
  assert.equal(out.length, 1, 'only the notice-block identifier is a candidate');
  assert.match(out[0].msg, /scanEverything/);
  assert.ok(!out.some((f) => /loadCfg|projectCfg|watchedExts/.test(f.msg)), 'code outside the notice block is never scanned');
});

test('config-keys: an escape sequence does not manufacture a phantom identifier', () => {
  // MEASURED: nReport / nMemory / nTripwires / nAlertas / nInforme -- five languages,
  // one escape, five false positives, before the escape-stripping pass.
  const hook = [
    'const TRANSLATIONS = {',
    "  en: { a: 'line one" + BSN + "Report follows" + BSN + "Memory too' },",
    '};',
  ].join(NEWLINE);
  const out = checkConfigKeys({ schemaKeys: BASE, hookFiles: ['h.js'], read: mem({ 'h.js': hook }), ...NONE });
  assert.deepEqual(out, []);
});

test('config-keys: PENDING_KEYS makes the HONEST case cheap -- a declared planned key is silent', () => {
  const out = checkConfigKeys({
    schemaKeys: BASE,
    mdFiles: ['a.md'],
    read: mem({ 'a.md': 'A `futureKey` override is planned.' }),
    ...NONE,
  });
  assert.equal(out.length, 1, 'undeclared -> FAIL (this is the control)');
  assert.match(out[0].msg, /futureKey/);

  const declared = checkConfigKeys({
    schemaKeys: BASE,
    mdFiles: ['a.md'],
    read: mem({ 'a.md': 'A `futureKey` override is planned.' }),
    pending: { futureKey: 'CWK-999, planned' },
    notConfig: {},
    blind: {},
  });
  assert.deepEqual(declared, [], 'declared with its ticket -> silent: the honest case is one line');
});

test('config-keys: SELF-CLEANING 1, PENDING branch -- a planned key that LANDS in the schema FAILs, so the entry expires on the event', () => {
  // LOW-1. The NOT_CONFIG half of rule 1 was tested; this half was not, and it is the half
  // the whole expiry design rests on -- "an entry expires exactly when it stops being true",
  // which is the argument for having no calendar date at all. Dormant today only because
  // PENDING_KEYS is empty (scanEverything's own entry died this way in CWK-057), so the
  // declarations are injected rather than relying on the module's live list.
  const out = checkConfigKeys({
    schemaKeys: [...BASE, 'futureKey'],           // it landed
    mdFiles: ['a.md'],
    read: mem({ 'a.md': 'A `futureKey` override is planned.' }),
    pending: { futureKey: 'CWK-999, planned' },   // ...but the entry still claims it is pending
    notConfig: {},
    blind: {},
  });
  assert.equal(out.length, 1, 'the stale declaration is the only finding -- the key itself now resolves');
  assert.equal(out[0].level, 'FAIL');
  assert.match(out[0].msg, /futureKey/);
  assert.match(out[0].msg, /now resolves in the schema/, 'the message must say WHY it expired');
  assert.match(out[0].msg, /delete the entry/, 'and what to do about it');
});

const TABLE = [
  '# Doc',
  '## Configure',
  '| Key | Default | What it does |',
  '|---|---|---|',
  '| `theme` | `dark` | a LOWERCASE key the prose rule can never see |',
  '| `scanExcludePaths` | `[]` | a real one |',
  '## Commands',
  '| `/tool:stats` | shows stats |',
].join(String.fromCharCode(10));

test('config-keys: STRUCTURED SURFACE -- a LOWERCASE key documented in a key table IS caught, where prose cannot be', () => {
  // LOW-1. In free prose `theme` is indistinguishable from an English word and stays
  // undetectable. Inside a key table the FIRST CELL IS A KEY by the table's own contract, so
  // POSITION supplies the signal SHAPE cannot -- and the check is shape-free on purpose.
  const out = checkConfigKeys({
    schemaKeys: ['scanExcludePaths'],
    keyTables: [{ file: 'r.md', heading: 'Configure' }],
    read: mem({ 'r.md': TABLE }),
    ...NONE,
  });
  const hard = out.filter((f) => f.level === 'FAIL');
  assert.equal(hard.length, 1, 'the lowercase key must be caught');
  assert.match(hard[0].msg, /theme/);
  assert.match(hard[0].msg, /whatever its shape/, 'and the message must say why it was catchable');
});

test('config-keys: STRUCTURED SURFACE is REGION-BOUNDED -- rows outside the key table are never claims', () => {
  // The bound is what keeps this from being a second cry-wolf path. MEASURED on the real
  // README: unbounded it fires on the Commands table's 2 slash-command rows; bounded, zero.
  // Asserted POSITIVELY -- the scan must be shown to have HAPPENED, or an empty region would
  // satisfy a bare "no findings" check vacuously (which an earlier draft of this test did).
  const out = checkConfigKeys({
    schemaKeys: ['scanExcludePaths'],          // `theme` deliberately absent...
    keyTables: [{ file: 'r.md', heading: 'Configure' }],
    read: mem({ 'r.md': TABLE }),
    ...NONE,
  });
  const fails = out.filter((f) => f.level === 'FAIL');
  assert.equal(fails.length, 1, 'exactly one row is a live claim');
  assert.match(fails[0].msg, /theme/, '...so the in-region row IS scanned -- the check is not vacuous');
  assert.ok(!fails.some((f) => /tool:stats/.test(f.msg)),
    'and the row under the OTHER heading is not a key claim, so widening the region would redden this');
});

test('config-keys: STRUCTURED SURFACE honours the declarations -- a documented PENDING key stays cheap', () => {
  const out = checkConfigKeys({
    schemaKeys: ['scanExcludePaths'],
    keyTables: [{ file: 'r.md', heading: 'Configure' }],
    read: mem({ 'r.md': TABLE }),
    pending: { theme: 'CWK-999, planned' },
    notConfig: {}, blind: {},
  });
  assert.deepEqual(out, [], 'honestly-planned and documented is still one line, not a red gate');
});

test('config-keys: a DECLARED blind key still DISCLOSES -- the stop did not cost the disclosure', () => {
  // INSPECT MEDIUM-1: the first cut took `continue` on a declared key and printed nothing, so
  // verify's ok line claimed coverage over a key being read and discarded. A stop and a
  // disclosure are not a trade.
  const out = checkConfigKeys({
    schemaKeys: [...BASE, 'language'],
    mdFiles: ['a.md'],
    read: mem({ 'a.md': 'Set `language` to en.' }),
    pending: {}, notConfig: {},
    blind: { language: 'mandated flock-wide; indistinguishable from prose' },
  });
  assert.equal(out.filter((f) => f.level === 'FAIL').length, 0, 'declared, so no stop');
  assert.equal(out.length, 1);
  assert.equal(out[0].level, 'SKIP', 'but it must still SAY SO -- and a SKIP cannot redden the gate');
  assert.match(out[0].msg, /language/);
  assert.match(out[0].msg, /read and discarded/, 'the disclosure states the consequence, not just the name');
});

test('config-keys: THE CLASS -- an UNDECLARED lowercase schema key is a hard FAIL, not a printed note', () => {
  // CWK-061's bar: the gate must be structurally INCAPABLE of acquiring a blind spot
  // silently. `theme` is a NEW key, not the known `language` -- the proof has to be that an
  // unforeseen one is caught, otherwise it only proves the instance was patched.
  const out = checkConfigKeys({
    schemaKeys: [...BASE, 'theme'],
    mdFiles: ['a.md'],
    read: mem({ 'a.md': 'Set `theme` to dark.' }),
    ...NONE,
  });
  const hard = out.filter((f) => f.level === 'FAIL');
  assert.equal(hard.length, 1, 'a gate that only PRINTS its blind spot has not closed it');
  assert.match(hard[0].msg, /theme/, 'the FAIL names the key');
  assert.match(hard[0].msg, /BLIND_KEYS/, 'and tells the reader how to accept it deliberately');
});


test('config-keys: BLIND_KEYS expires on the EVENT -- a declared key that LEFT the schema FAILs', () => {
  const out = checkConfigKeys({
    schemaKeys: BASE,
    mdFiles: ['a.md'],
    read: mem({ 'a.md': 'nothing' }),
    pending: {}, notConfig: {},
    blind: { theme: 'accepted once' },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].level, 'FAIL');
  assert.match(out[0].msg, /not in the schema at all/, 'the key is gone, so the declaration is a lie');
});

test('config-keys: BLIND_KEYS expires on the EVENT -- a declared key the rule CAN now see FAILs', () => {
  // e.g. the room renames `theme` to `themeName`: the gate can detect it, so the accepted
  // blind spot no longer exists and the entry must not sit there granting a pass forever.
  const out = checkConfigKeys({
    schemaKeys: [...BASE, 'themeName'],
    mdFiles: ['a.md'],
    read: mem({ 'a.md': 'Set `themeName` to dark.' }),
    pending: {}, notConfig: {},
    blind: { themeName: 'stale: this now matches the shape rule' },
  });
  const hard = out.filter((f) => f.level === 'FAIL');
  assert.equal(hard.length, 1);
  assert.match(hard[0].msg, /now matches the shape rule/);
});

test("config-keys: this repo's own BLIND_KEYS is non-empty and covers `language`", () => {
  // AGENTS.md's 5 Standard Systems mandates `language` in EVERY room, and it fails the shape
  // rule -- so every adopting room collides with this list on day one. Pinning it here means
  // a port that forgets the declaration fails its own suite, not just its verify run.
  assert.ok(Object.hasOwn(BLIND_KEYS, 'language'), 'the flock-mandated key must be declared');
  assert.ok(BLIND_KEYS.language.length > 20, 'and carry a real reason, not a bare entry');
});

test('config-keys: SELF-CLEANING 1 -- a NOT_CONFIG entry that becomes a real key FAILs as a lie', () => {
  const tok = Object.keys(NOT_CONFIG)[0];
  const out = checkConfigKeys({
    schemaKeys: [...BASE, tok],
    mdFiles: ['a.md'],
    read: mem({ 'a.md': 'mentions `' + tok + '` here' }),
  });
  assert.ok(out.some((f) => /the entry is a lie/.test(f.msg)), 'the declaration must not outlive its truth');
});

test('config-keys: SELF-CLEANING 2 -- a declaration no surface mentions FAILs as dead weight', () => {
  const out = checkConfigKeys({ schemaKeys: BASE, mdFiles: ['a.md'], read: mem({ 'a.md': 'nothing here' }) });
  const dead = out.filter((f) => /protects nothing/.test(f.msg));
  assert.equal(dead.length, Object.keys(NOT_CONFIG).length + Object.keys(PENDING_KEYS).length,
    'every unreferenced declaration is reported, so the list prunes itself');
});

test('config-keys: an absent surface is a visible SKIP, never a silent pass and never a false accusation', () => {
  const out = checkConfigKeys({
    schemaKeys: BASE,
    mdFiles: ['missing.md'],
    read: mem({}),
    notConfig: { someIdent: 'declared, but the only surface naming it was unreadable' },
    pending: {},
    blind: {},
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].level, 'SKIP', 'a partial scan degrades visibly');
  assert.match(out[0].msg, /missing\.md/);
  assert.ok(!out.some((f) => /protects nothing/.test(f.msg)),
    'and it must NOT convict the declaration -- a 0-hit proves nothing when the scope was incomplete');
});

// --- CWK-064: one config-read path per room -------------------------------------------

test('read-path: a surface naming the config WITHOUT the global tier FAILs -- the live defect', () => {
  // The failure this catches is not cosmetic: on a machine configured only globally, the bare
  // project file is ABSENT, so an agent following such a line reads nothing and silently uses
  // defaults. The owner's machine is in exactly that state today.
  const out = checkConfigReadPath({
    surfaces: [{ label: 'skills/x/SKILL.md', text: 'honor `.coalmine.json` `schemaPaths` if set' }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].level, 'FAIL');
  assert.match(out[0].msg, /skills\/x\/SKILL\.md/, 'the FAIL names the surface');
  assert.match(out[0].msg, /ABSENT on a machine/, 'and states the consequence, not just the rule');
});

test('read-path: naming the global tier satisfies it', () => {
  const out = checkConfigReadPath({
    surfaces: [{ label: 'a.md', text: 'read `~/.claude/.coalmine.json` then the project config' }],
  });
  assert.deepEqual(out, []);
});

test('read-path: a surface that never names the config at all is not a finding', () => {
  const out = checkConfigReadPath({ surfaces: [{ label: 'b.md', text: 'no config here' }] });
  assert.deepEqual(out, [], 'the rail is owed only where a config read is implied');
});

test('read-path: the check is COARSE on purpose -- it does not try to tell a read from a description', () => {
  // A regex cannot distinguish "instructs an agent read" from "describes hook behaviour", and
  // guessing wrong in the permissive direction is the defect itself. The price is a rail
  // sentence on a surface that arguably did not need one; the alternative price is a silent
  // miss. This test pins the cheap side so nobody "improves" it into cleverness later.
  const out = checkConfigReadPath({
    surfaces: [{ label: 'c.md', text: 'the conductor is gated by `.coalmine.json` `updateMode`' }],
  });
  assert.equal(out.length, 1, 'even a descriptive mention owes the rail');
});

test('read-path: configName and globalHome are parameters -- an adopting room supplies its own', () => {
  const out = checkConfigReadPath({
    surfaces: [{ label: 'd.md', text: 'honor `.coalledger.json` `severityFloor`' }],
    configName: '.coalledger.json',
    globalHome: '~/.claude/',
  });
  assert.equal(out.length, 1, 'nothing here hardcodes CoalMine');
  assert.match(out[0].msg, /coalledger/);
});

test('read-path: GRANULARITY -- one compliant line no longer immunises the rest of the file', () => {
  // INSPECT MEDIUM-2, measured live by the reviewer on the per-file version. A LOCAL rail
  // (one that names the global tier while discussing a single key) governs its own line only.
  const text = [
    'read `~/.claude/.coalmine.json` then the project config for fix mode',
    'honor `.coalmine.json` `schemaPaths` if set',
  ].join(String.fromCharCode(10));
  const out = checkConfigReadPath({ surfaces: [{ label: 's.md', text }] });
  assert.equal(out.length, 1, 'the second, unrelated mention is NOT vouched for by the first');
  assert.equal(out[0].line, 2, 'and the finding is anchored to the offending LINE');
  assert.match(out[0].msg, /s\.md:2/);
});

test('read-path: a UNIVERSAL rail vouches for the whole surface, because that is what it says', () => {
  const text = [
    'Config reads -- every config key, always the CASCADE: `~/.claude/.coalmine.json` first, then the project config.',
    'honor `.coalmine.json` `schemaPaths` if set',
    'honor `.coalmine.json` `trustedDomains` if set',
  ].join(String.fromCharCode(10));
  assert.deepEqual(checkConfigReadPath({ surfaces: [{ label: 's.md', text }] }), []);
});

test('read-path: the universal escape needs BOTH the global tier and the universality words', () => {
  const halfA = 'read `~/.claude/.coalmine.json` first' + String.fromCharCode(10) + 'honor `.coalmine.json` `x`';
  const halfB = 'every config key matters' + String.fromCharCode(10) + 'honor `.coalmine.json` `x`';
  assert.equal(checkConfigReadPath({ surfaces: [{ label: 'a.md', text: halfA }] }).length, 1,
    'the global tier alone is a LOCAL rail, not a universal one');
  assert.equal(checkConfigReadPath({ surfaces: [{ label: 'b.md', text: halfB }] }).length, 1,
    'and the words alone, with no global tier, vouch for nothing');
});
