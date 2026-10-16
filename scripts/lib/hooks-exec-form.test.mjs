// 15b item B (CWK2-027): every Claude Code hook entry of hooks/hooks.json and its plugin/hooks/hooks.json twin names `node` as the
// command and puts the script path in `args` (the exec form), with no shell string, no `shell` and no `onFailure`.
// Why (hooks-safety.md section 3, revalidated 2026-10-11; the vendor's hooks reference): a shell-string command is handed to the user's
// shell, and PowerShell expands `${CLAUDE_PLUGIN_ROOT}` as one of its own variables, so the script path came out empty (CoalWash measured
// exit 1 with a node loader error, 14a). The exec form substitutes the placeholder textually and starts no shell.
// The AG twin plugin/hooks.json is a different file with a different host (AG runs a command from the plugin root) and is NOT read here.
// Hermetic (hooks-safety section 7): TEMP, HOME, USERPROFILE and the host variables point at a fixture; children are heap-capped and timed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLACEHOLDER = '${CLAUDE_PLUGIN_ROOT}';
const FILES = ['hooks/hooks.json', 'plugin/hooks/hooks.json'];

function entries(file) {
  const cfg = JSON.parse(fs.readFileSync(path.join(repo, file), 'utf8'));
  const out = [];
  for (const [event, groups] of Object.entries(cfg.hooks)) for (const g of groups) for (const h of g.hooks) out.push({ event, matcher: g.matcher, h });
  return out;
}

for (const file of FILES) {
  test(`${file}: every hook entry is the exec form -- command "node", the script in args, no shell string, no shell, no onFailure`, () => {
    const es = entries(file);
    assert.equal(es.length, 3, `${file}: the three hooks`);
    for (const { event, h } of es) {
      const at = `${file} ${event}`;
      assert.equal(h.type, 'command', `${at}: type`);
      assert.equal(h.command, 'node', `${at}: command is exactly "node", not a shell string (${JSON.stringify(h.command)})`);
      assert.ok(Array.isArray(h.args) && h.args.length === 1 && typeof h.args[0] === 'string', `${at}: args is one string`);
      assert.ok(h.args[0].startsWith(PLACEHOLDER + '/hooks/') && h.args[0].endsWith('.js'), `${at}: the script is ${PLACEHOLDER}/hooks/<name>.js (${h.args[0]})`);
      assert.ok(!/["'\s]/.test(h.args[0].slice(PLACEHOLDER.length)), `${at}: no quote or space is needed in the arg, the placeholder is substituted textually`);
      assert.ok(!('shell' in h), `${at}: no shell field`);
      assert.ok(!('onFailure' in h), `${at}: no onFailure (hooks-safety section 1: a fail-silent hook is never opted into block)`);
      assert.ok(Number.isInteger(h.timeout) && h.timeout > 0 && h.timeout <= 60, `${at}: a bounded timeout`);
      const script = path.join(repo, file.startsWith('plugin/') ? 'plugin' : '', h.args[0].slice(PLACEHOLDER.length + 1));
      assert.ok(fs.existsSync(script), `${at}: ${script} exists`);
    }
  });
}

// Run each Claude Code hook the way the exec form does: argv = [node, <resolved script>], no shell, the host variables set.
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-exec-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const proj = path.join(dir, 'proj'); fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'coalmine'), { mode: 0o700 });
  fs.writeFileSync(path.join(proj, 'edited.js'), 'x\n');
  return { dir, proj };
}
for (const file of FILES) {
  test(`${file}: each hook runs as node + the resolved script (no shell), exits 0, and emits only its sanctioned output`, (t) => {
    const { dir, proj } = fixture(t);
    const root = path.join(repo, file.startsWith('plugin/') ? 'plugin' : '');
    const payload = (event) => JSON.stringify(event === 'PostToolUse'
      ? { session_id: 'exec-1', cwd: proj, tool_name: 'Write', tool_input: { file_path: path.join(proj, 'edited.js') } }
      : { session_id: 'exec-1', cwd: proj, stop_hook_active: false });
    for (const { event, h } of entries(file)) {
      const script = h.args[0].replace(PLACEHOLDER, root.split(path.sep).join('/'));
      const r = spawnSync(process.execPath, ['--max-old-space-size=512', script], {
        cwd: proj, input: payload(event), encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', shell: false,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: dir, USERPROFILE: dir, TEMP: dir, TMP: dir, TMPDIR: dir, CLAUDE_PLUGIN_ROOT: root, CLAUDE_PROJECT_DIR: proj },
      });
      const at = `${file} ${event}`;
      assert.equal(r.status, 0, `${at}: exit 0 (${r.stderr.slice(0, 200)})`);
      assert.equal(r.stderr, '', `${at}: no stderr (Phoenix #13)`);
      // 15b5 CWK2-039: the WHOLE stdout is held to the sanctioned shape (CoalFace 0cbce52): the header line, then only "- " rule lines (no trailing newline), nothing
      // before, between or after (an earlier version accepted any output that merely CONTAINED the tag, so stray text ahead of the context passed).
      if (event === 'SessionStart') assert.match(r.stdout, /^\[CoalMine\] 9 quality canaries installed\.[^\n]*(?:\n- [^\n]*)+$/, `${at}: the conductor context is the sanctioned stdout, exactly`);
      else if (event === 'PostToolUse') assert.equal(r.stdout, '', `${at}: touch stays silent`);
      else assert.ok(r.stdout === '' || (() => { try { JSON.parse(r.stdout); return true; } catch { return false; } })(), `${at}: silent or one JSON object`);
    }
  });
}
