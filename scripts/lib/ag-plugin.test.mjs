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
// The shipped command line, run the way AG runs it: via the shell with cwd = the directory holding hooks.json, AG's stdin on the pipe.
function runShipped(command, stdin, sandbox) {
  const r = spawnSync(command, {
    shell: true, cwd: PLUGIN, input: JSON.stringify(stdin), encoding: 'utf8', timeout: 30000,
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
  const proj = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-agproj-'));
  t.after(() => fs.rmSync(proj, { recursive: true, force: true }));
  const before = fs.readdirSync(PLUGIN, { recursive: true }).length;
  const cmd = cmdFor(readJson(path.join(PLUGIN, 'hooks.json')), 'PreInvocation');
  const stdin = { ...common(proj, 'conv-pre-1'), invocationNum: 1, initialNumSteps: 0 };
  const first = runShipped(cmd, stdin, sb);
  assert.equal(first.status, 0);
  assert.equal(first.stderr, '', 'no stderr (Phoenix #13)');
  const out = JSON.parse(first.stdout);
  assert.deepEqual(Object.keys(out), ['injectSteps']);
  assert.equal(out.injectSteps.length, 1);
  assert.deepEqual(Object.keys(out.injectSteps[0]), ['ephemeralMessage']);
  assert.ok(out.injectSteps[0].ephemeralMessage.includes('[CoalMine]'));
  assert.ok(fs.readdirSync(path.join(sb, 'coalmine')).some((f) => f.startsWith('ag-conductor-') && f.endsWith('.marker')), 'the once-per-conversation marker is in the sandbox tmp');
  const second = runShipped(cmd, { ...stdin, invocationNum: 2 }, sb);
  assert.equal(second.stdout, '', 'PreInvocation fires on every model call: the marker silences the repeats');
  assert.equal(fs.readdirSync(PLUGIN, { recursive: true }).length, before, 'nothing is written under the plugin folder');
});

test('AG plugin: the PostToolUse command records an AG edit (toolCall.args.TargetFile, relative to workspacePaths[0]) under the conversation id', (t) => {
  const sb = mkSandbox(t);
  const proj = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-agproj-'));
  t.after(() => fs.rmSync(proj, { recursive: true, force: true }));
  fs.writeFileSync(path.join(proj, 'edited.js'), 'x');
  const cmd = cmdFor(readJson(path.join(PLUGIN, 'hooks.json')), 'PostToolUse');
  const r = runShipped(cmd, { ...common(proj, 'conv-touch-1'), stepIdx: 5, toolCall: { name: 'write_to_file', args: { TargetFile: 'edited.js' } } }, sb);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '', 'touch stays silent');
  const touched = path.join(sb, 'coalmine', 'rot-canary-conv-touch-1.touched');
  assert.ok(fs.existsSync(touched), 'the .touched state is keyed by conversationId');
  assert.ok(fs.readFileSync(touched, 'utf8').includes('edited.js'));
});

// The Stop scan adapter. Setup = the same two shipped commands run in turn, so the state chain (touch -> stop) is the real one.
function touchThen(t, conv, fileName = 'edited.js') {
  const sb = mkSandbox(t);
  const proj = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-agproj-'));
  t.after(() => fs.rmSync(proj, { recursive: true, force: true }));
  fs.writeFileSync(path.join(proj, fileName), 'x');
  const hooks = readJson(path.join(PLUGIN, 'hooks.json'));
  const touch = runShipped(cmdFor(hooks, 'PostToolUse'), { ...common(proj, conv), stepIdx: 1, toolCall: { name: 'write_to_file', args: { TargetFile: fileName } } }, sb);
  assert.equal(touch.status, 0);
  return { sb, proj, stopCmd: cmdFor(hooks, 'Stop') };
}
const stopStdin = (proj, conv, extra = {}) => ({ ...common(proj, conv), executionNum: 1, terminationReason: 'model_stop', error: '', fullyIdle: true, ...extra });

test('AG plugin Stop adapter: after an edit the Stop command emits {"decision":"continue","reason":<the scan nudge>} once; the next stop of the batch is silent (the ack marker is the loop guard)', (t) => {
  const { sb, proj, stopCmd } = touchThen(t, 'conv-stop-1');
  const first = runShipped(stopCmd, stopStdin(proj, 'conv-stop-1'), sb);
  assert.equal(first.status, 0);
  assert.equal(first.stderr, '');
  const out = JSON.parse(first.stdout);
  assert.deepEqual(Object.keys(out).sort(), ['decision', 'reason']);
  assert.equal(out.decision, 'continue');
  assert.match(out.reason, /rot-canary/);
  assert.ok(out.reason.includes('edited.js'), 'the nudge names the touched file');
  assert.ok(fs.existsSync(path.join(sb, 'coalmine', 'rot-canary-conv-stop-1.scanned')), 'the ack marker landed');
  const second = runShipped(stopCmd, stopStdin(proj, 'conv-stop-1', { executionNum: 2 }), sb);
  assert.equal(second.stdout, '', 'an acknowledged batch emits nothing, so AG cannot be held in the loop');
});

test('AG plugin Stop adapter: a stop the engine did not reach by the model finishing (error, max_steps_exceeded) emits the no-op {} and does NOT consume the batch', (t) => {
  const { sb, proj, stopCmd } = touchThen(t, 'conv-stop-2');
  for (const why of ['error', 'max_steps_exceeded']) {
    const r = runShipped(stopCmd, stopStdin(proj, 'conv-stop-2', { terminationReason: why }), sb);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '{}', why);
  }
});

test('AG plugin Stop adapter: when the ack marker cannot land the Stop emits {} (fail closed: no continue that the next stop would repeat)', (t) => {
  const { sb, proj, stopCmd } = touchThen(t, 'conv-stop-3');
  // A directory where the ack file belongs makes the atomic replace fail on every platform.
  fs.mkdirSync(path.join(sb, 'coalmine', 'rot-canary-conv-stop-3.scanned'));
  const r = runShipped(stopCmd, stopStdin(proj, 'conv-stop-3'), sb);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '{}');
});

test('AG plugin Stop adapter: a drift-only stop (the edited file is gone) has no scan reason and emits {}, never a continue', (t) => {
  const { sb, proj, stopCmd } = touchThen(t, 'conv-stop-4');
  fs.rmSync(path.join(proj, 'edited.js'));
  const r = runShipped(stopCmd, stopStdin(proj, 'conv-stop-4'), sb);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '{}');
});

// verify.mjs gates the AG files. Each case copies the tree (without .git and scratch) and breaks one thing.
function verifyCopy(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-agverify-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const skip = new Set(['.git', 'scratchpad', '.claude', 'node_modules', 'dist-claude-ai']);
  fs.cpSync(repo, dir, { recursive: true, filter: (src) => !skip.has(path.basename(src)) });
  const run = () => spawnSync(process.execPath, [path.join(dir, 'scripts', 'verify.mjs')], {
    cwd: dir, encoding: 'utf8', timeout: 100000, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048', TEMP: dir, TMP: dir, TMPDIR: dir },
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
