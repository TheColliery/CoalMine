// CWK-202 (09b): CoalMine as a native Antigravity plugin. AG registers a FOLDER holding plugin.json (+ hooks.json) at its root
// (agy-customizations/docs/plugins.md) and runs a hook command from the directory that holds hooks.json (docs/hooks.md), so the AG
// plugin is plugin/ (the rendered dist), never the repo root, whose skills/ are unrendered templates. The two files are authored at
// plugin-src/ and copied by build-plugin.mjs. These tests (hooks-safety.md section 7, hermetic spawn tests) cover the manifest and the
// hooks.json contract, each shipped command run FROM plugin/ with AG's full stdin and a sandboxed TEMP/HOME, and verify.mjs's gate over them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGIN = path.join(repo, 'plugin');
const AG_EVENTS = ['PreToolUse', 'PostToolUse', 'PreInvocation', 'PostInvocation', 'Stop'];
const readJson = (p) => { const s = fs.readFileSync(p, 'utf8'); return JSON.parse(s.charCodeAt(0) === 0xfeff ? s.slice(1) : s); };

// Every handler of the shipped hooks.json: { event, matcher, handler }.
function handlersOf(hooksJson) {
  const out = [];
  for (const [, spec] of Object.entries(hooksJson)) {
    for (const [event, entries] of Object.entries(spec)) {
      if (event === 'enabled') continue;
      for (const entry of entries) {
        if (event === 'PreToolUse' || event === 'PostToolUse') for (const h of entry.hooks) out.push({ event, matcher: entry.matcher, handler: h });
        else out.push({ event, matcher: undefined, handler: entry });
      }
    }
  }
  return out;
}

const mkSandbox = (t) => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-agplugin-'));
  fs.mkdirSync(path.join(dir, 'coalmine'), { mode: 0o700 });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
// 09b INSPECT HIGH-1: a hook finds its project by walking up from its cwd, so a cwd inside the repo made a result depend on untracked files (the gitignored root MEMORY.md):
// green in the working tree, red on a clean checkout. Every shipped command therefore runs from a copy of plugin/ inside a project the test owns, laid out the way AG discovers it.
function ownProject(t, { memory = false } = {}) {
  const proj = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-agproj-'));
  t.after(() => fs.rmSync(proj, { recursive: true, force: true }));
  fs.mkdirSync(path.join(proj, '.git')); // a git root of its own: the walk-up stops here
  if (memory) fs.writeFileSync(path.join(proj, 'MEMORY.md'), '# MEMORY\n');
  const plug = path.join(proj, '.agents', 'plugins', 'coalmine');
  fs.mkdirSync(path.dirname(plug), { recursive: true });
  fs.cpSync(PLUGIN, plug, { recursive: true });
  return { proj, plug };
}
// The shipped command line, run the way AG runs it: via the shell with cwd = the directory holding hooks.json (the owned copy), AG's stdin on the pipe.
function runShipped(command, stdin, sandbox, cwd) {
  assert.ok(cwd && cwd !== PLUGIN && !cwd.startsWith(PLUGIN + path.sep), 'run the shipped command from an owned plugin copy, never from the repo');
  const r = spawnSync(command, {
    shell: true, cwd, input: JSON.stringify(stdin), encoding: 'utf8', timeout: 30000,
    env: { ...process.env, TEMP: sandbox, TMP: sandbox, TMPDIR: sandbox, USERPROFILE: sandbox, HOME: sandbox },
  });
  return r;
}
const common = (proj, conv) => ({ conversationId: conv, workspacePaths: [proj], transcriptPath: path.join(proj, '.gemini', 'antigravity-cli', 'transcript.jsonl'), artifactDirectoryPath: path.join(proj, '.gemini', 'antigravity-cli', 'artifacts'), modelName: 'auto' });
const cmdFor = (hooks, event) => handlersOf(hooks).find((h) => h.event === event).handler.command;

test('AG plugin: plugin/plugin.json names the plugin and is the build of plugin-src/plugin.json (nothing but a name)', () => {
  const src = readJson(path.join(repo, 'plugin-src', 'plugin.json'));
  const dist = readJson(path.join(PLUGIN, 'plugin.json'));
  assert.deepEqual(dist, src);
  assert.deepEqual(Object.keys(dist), ['name']);
  assert.equal(dist.name, 'coalmine');
});

test('AG plugin: plugin/hooks.json is the build of plugin-src/hooks.json, one named group, AG events only, command handlers with a timeout inside AG\'s 30 s', () => {
  const src = fs.readFileSync(path.join(repo, 'plugin-src', 'hooks.json'), 'utf8').replace(/\r\n/g, '\n');
  const dist = fs.readFileSync(path.join(PLUGIN, 'hooks.json'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(dist, src);
  const hooks = JSON.parse(dist);
  assert.deepEqual(Object.keys(hooks), ['coalmine'], 'the top-level key is the named hook group AG requires');
  const hs = handlersOf(hooks);
  assert.deepEqual(hs.map((h) => h.event), ['PreInvocation', 'PostToolUse', 'Stop']);
  for (const { event, matcher, handler } of hs) {
    assert.ok(AG_EVENTS.includes(event), event);
    assert.equal(handler.type, 'command');
    assert.ok(Number.isInteger(handler.timeout) && handler.timeout >= 1 && handler.timeout <= 30, `${event} timeout ${handler.timeout}`);
    const [node, script, arg, ...rest] = handler.command.split(' ');
    assert.equal(node, 'node');
    assert.ok(!path.isAbsolute(script) && !script.includes('..') && !script.includes('\\'), `${event}: ${script} is relative to hooks.json`);
    assert.ok(fs.existsSync(path.join(PLUGIN, script)), `${event}: ${script} ships in plugin/`);
    assert.equal(arg, event, 'the trailing event-name argument switches the CoalMine hooks to AG mode');
    assert.deepEqual(rest, []);
    if (event === 'PostToolUse') assert.ok(typeof matcher === 'string' && matcher.length > 0, 'a tool event takes the grouped matcher shape');
  }
});

test('AG plugin: the PreInvocation command, run from plugin/ with AG\'s stdin, injects the conductor line ONCE per conversation as an ephemeralMessage and writes nothing under plugin/', (t) => {
  const sb = mkSandbox(t);
  const { proj, plug } = ownProject(t);
  const before = fs.readdirSync(plug, { recursive: true }).length;
  const cmd = cmdFor(readJson(path.join(PLUGIN, 'hooks.json')), 'PreInvocation');
  const stdin = { ...common(proj, 'conv-pre-1'), invocationNum: 1, initialNumSteps: 0 };
  const first = runShipped(cmd, stdin, sb, plug);
  assert.equal(first.status, 0);
  assert.equal(first.stderr, '', 'no stderr (Phoenix #13)');
  const out = JSON.parse(first.stdout);
  assert.deepEqual(Object.keys(out), ['injectSteps']);
  assert.equal(out.injectSteps.length, 1);
  assert.deepEqual(Object.keys(out.injectSteps[0]), ['ephemeralMessage']);
  assert.ok(out.injectSteps[0].ephemeralMessage.includes('[CoalMine]'));
  assert.ok(fs.readdirSync(path.join(sb, 'coalmine')).some((f) => f.startsWith('ag-conductor-') && f.endsWith('.marker')), 'the once-per-conversation marker is in the sandbox tmp');
  const second = runShipped(cmd, { ...stdin, invocationNum: 2 }, sb, plug);
  assert.equal(second.stdout, '', 'PreInvocation fires on every model call: the marker silences the repeats');
  assert.equal(fs.readdirSync(plug, { recursive: true }).length, before, 'nothing is written under the plugin folder');
});

test('AG plugin: the PostToolUse command records an AG edit (toolCall.args.TargetFile, relative to workspacePaths[0]) under the conversation id', (t) => {
  const sb = mkSandbox(t);
  const { proj, plug } = ownProject(t);
  fs.writeFileSync(path.join(proj, 'edited.js'), 'x');
  const cmd = cmdFor(readJson(path.join(PLUGIN, 'hooks.json')), 'PostToolUse');
  const r = runShipped(cmd, { ...common(proj, 'conv-touch-1'), stepIdx: 5, toolCall: { name: 'write_to_file', args: { TargetFile: 'edited.js' } } }, sb, plug);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '', 'touch stays silent');
  const touched = path.join(sb, 'coalmine', 'rot-canary-conv-touch-1.touched');
  assert.ok(fs.existsSync(touched), 'the .touched state is keyed by conversationId');
  assert.ok(fs.readFileSync(touched, 'utf8').includes('edited.js'));
});

// The Stop scan adapter. Setup = the same two shipped commands run in turn, so the state chain (touch -> stop) is the real one.
function touchThen(t, conv, { memory = false, fileName = 'edited.js' } = {}) {
  const sb = mkSandbox(t);
  const { proj, plug } = ownProject(t, { memory });
  fs.writeFileSync(path.join(proj, fileName), 'x');
  const hooks = readJson(path.join(PLUGIN, 'hooks.json'));
  const touchCmd = cmdFor(hooks, 'PostToolUse');
  const touch = (stepIdx) => runShipped(touchCmd, { ...common(proj, conv), stepIdx, toolCall: { name: 'write_to_file', args: { TargetFile: fileName } } }, sb, plug);
  assert.equal(touch(1).status, 0);
  return { sb, proj, plug, touch, stopCmd: cmdFor(hooks, 'Stop') };
}
const stopStdin = (proj, conv, extra = {}) => ({ ...common(proj, conv), executionNum: 1, terminationReason: 'model_stop', error: '', fullyIdle: true, ...extra });

test('AG plugin Stop adapter: after an edit the Stop command emits {"decision":"continue","reason":<the scan nudge>} once; the next stop of the batch is silent (the ack marker is a per-batch guard)', (t) => {
  const { sb, proj, plug, stopCmd } = touchThen(t, 'conv-stop-1');
  const first = runShipped(stopCmd, stopStdin(proj, 'conv-stop-1'), sb, plug);
  assert.equal(first.status, 0);
  assert.equal(first.stderr, '');
  const out = JSON.parse(first.stdout);
  assert.deepEqual(Object.keys(out).sort(), ['decision', 'reason']);
  assert.equal(out.decision, 'continue');
  assert.match(out.reason, /rot-canary/);
  assert.ok(out.reason.includes('edited.js'), 'the nudge names the touched file');
  assert.ok(fs.existsSync(path.join(sb, 'coalmine', 'rot-canary-conv-stop-1.scanned')), 'the ack marker landed');
  const second = runShipped(stopCmd, stopStdin(proj, 'conv-stop-1', { executionNum: 2 }), sb, plug);
  assert.equal(second.stdout, '', 'an acknowledged batch emits nothing');
});

// LOW-1 (09b INSPECT; the head's ruling: name the residual, add no marker). AG's Stop payload carries no stop_hook_active, so the ack marker guards one BATCH of edits, not a fix round:
// an edit made after a continue is a new batch and earns another continue. The loop ends when the model stops editing, or at AG's max_steps_exceeded.
test('AG plugin Stop adapter (named residual): an edit made after a continue is a new batch and earns another continue; an unedited stop stays silent', (t) => {
  const { sb, proj, plug, touch, stopCmd } = touchThen(t, 'conv-stop-5');
  assert.equal(JSON.parse(runShipped(stopCmd, stopStdin(proj, 'conv-stop-5'), sb, plug).stdout).decision, 'continue');
  assert.equal(runShipped(stopCmd, stopStdin(proj, 'conv-stop-5', { executionNum: 2 }), sb, plug).stdout, '', 'no edit since the ack: silent');
  const touched = path.join(sb, 'coalmine', 'rot-canary-conv-stop-5.touched');
  const later = new Date(Date.now() + 5000);
  assert.equal(touch(2).status, 0); // the model edits again in the re-entered turn
  fs.utimesSync(touched, later, later); // a newer mtime than the ack, whatever the filesystem's timestamp grain
  const again = runShipped(stopCmd, stopStdin(proj, 'conv-stop-5', { executionNum: 3 }), sb, plug);
  assert.equal(JSON.parse(again.stdout).decision, 'continue', 'the new batch earns another continue');
});

test('AG plugin Stop adapter: a stop the engine did not reach by the model finishing (error, max_steps_exceeded) emits the no-op {} and does NOT consume the batch', (t) => {
  const { sb, proj, plug, stopCmd } = touchThen(t, 'conv-stop-2');
  const ack = path.join(sb, 'coalmine', 'rot-canary-conv-stop-2.scanned');
  for (const why of ['error', 'max_steps_exceeded']) {
    const r = runShipped(stopCmd, stopStdin(proj, 'conv-stop-2', { terminationReason: why }), sb, plug);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '{}', why);
    assert.ok(!fs.existsSync(ack), `${why}: the batch is not consumed (no ack marker written)`);
  }
  const fin = runShipped(stopCmd, stopStdin(proj, 'conv-stop-2'), sb, plug);
  assert.equal(JSON.parse(fin.stdout).decision, 'continue', 'the batch is still owed its scan when the model finally stops');
  assert.ok(fs.existsSync(ack), 'the finished stop acknowledges it');
});

test('AG plugin Stop adapter: when the ack marker cannot land the Stop emits {} (fail closed: no continue that the next stop would repeat)', (t) => {
  const { sb, proj, plug, stopCmd } = touchThen(t, 'conv-stop-3');
  // A directory where the ack file belongs makes the atomic replace fail on every platform.
  fs.mkdirSync(path.join(sb, 'coalmine', 'rot-canary-conv-stop-3.scanned'));
  const r = runShipped(stopCmd, stopStdin(proj, 'conv-stop-3'), sb, plug);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '{}');
});

// HIGH-1: both outcomes of a drift-only stop (the edited file is gone, so no scan reason) are fixed by a project the test owns: a root MEMORY.md there makes the drift note
// fire, which AG mode answers with {} (no continue); with none the hook stays silent. Neither depends on the repo's gitignored MEMORY.md.
test('AG plugin Stop adapter: a drift-only stop emits {} (never a continue) where the project has a root MEMORY.md, and nothing where it has none', (t) => {
  for (const [conv, memory, want] of [['conv-stop-4a', true, '{}'], ['conv-stop-4b', false, '']]) {
    const { sb, proj, plug, stopCmd } = touchThen(t, conv, { memory });
    fs.rmSync(path.join(proj, 'edited.js'));
    const r = runShipped(stopCmd, stopStdin(proj, conv), sb, plug);
    assert.equal(r.status, 0, conv);
    assert.equal(r.stdout.trim(), want, `${conv} (MEMORY.md ${memory ? 'present' : 'absent'})`);
  }
});

// verify.mjs gates the AG files. Each case copies the tree (without .git and scratch) and breaks one thing.
function verifyCopy(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-agverify-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const skip = new Set(['.git', 'scratchpad', '.claude', 'node_modules', 'dist-claude-ai']);
  fs.cpSync(repo, dir, { recursive: true, filter: (src) => !skip.has(path.basename(src)) });
  // LOW-2: HOME and USERPROFILE are sandboxed with the temp folders, so verify.mjs reads no global config of the operator's (the copy has no .git and no scratch either).
  const run = () => spawnSync(process.execPath, [path.join(dir, 'scripts', 'verify.mjs')], {
    cwd: dir, encoding: 'utf8', timeout: 100000, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048', TEMP: dir, TMP: dir, TMPDIR: dir, HOME: dir, USERPROFILE: dir },
  });
  return { dir, run };
}

test('AG plugin: verify.mjs fails a hooks.json naming a missing script, an event outside AG\'s five, a timeout over 30 s, or a wrong plugin name', (t) => {
  const { dir, run } = verifyCopy(t);
  assert.equal(run().status, 0, 'control: the copied tree verifies clean');
  const srcHooks = path.join(dir, 'plugin-src', 'hooks.json');
  const distHooks = path.join(dir, 'plugin', 'hooks.json');
  const good = fs.readFileSync(srcHooks, 'utf8');
  const both = (text) => { fs.writeFileSync(srcHooks, text); fs.writeFileSync(distHooks, text); };
  both(good.replace('hooks/coalmine-conductor.js', 'hooks/no-such-adapter.js'));
  let r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /no-such-adapter\.js does not exist/);
  both(good.replace('"PreInvocation"', '"SessionStart"').replace('coalmine-conductor.js PreInvocation', 'coalmine-conductor.js SessionStart'));
  r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /SessionStart is not one of AG's five events/);
  both(good.replace('"timeout": 10', '"timeout": 31'));
  r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /timeout '31'/);
  both(good);
  const srcName = path.join(dir, 'plugin-src', 'plugin.json');
  const distName = path.join(dir, 'plugin', 'plugin.json');
  fs.writeFileSync(srcName, '{"name":"coalmin"}\n'); fs.writeFileSync(distName, '{"name":"coalmin"}\n');
  r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /plugin\.json name = 'coalmin'/);
});

test('AG plugin: verify.mjs fails a plugin/ whose AG files are missing or stale against plugin-src/', (t) => {
  const { dir, run } = verifyCopy(t);
  assert.equal(run().status, 0, 'control: the copied tree verifies clean');
  const dist = path.join(dir, 'plugin', 'hooks.json');
  const good = fs.readFileSync(dist, 'utf8');
  fs.writeFileSync(dist, good + '\n');
  let r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /plugin\/hooks\.json STALE vs plugin-src\/hooks\.json/);
  fs.rmSync(dist);
  r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /plugin\/hooks\.json missing/);
  fs.writeFileSync(dist, good);
  fs.rmSync(path.join(dir, 'plugin', 'plugin.json'));
  r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /plugin\/plugin\.json missing/);
});
