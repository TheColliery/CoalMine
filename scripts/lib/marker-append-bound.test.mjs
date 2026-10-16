// 16f row 18 (CWK2-044, PR #36 thread): the touch hook's marker append is bounded by MARKER_MAX_BYTES. The read side (readMarker) returns null for a marker over the bound, so an append that
// crossed it made the WHOLE touched list unreadable at stop time and the scan silently never ran. Now the append that would cross the bound is refused (the new entry is dropped
// silently, Phoenix #4) and the list already written stays readable. Hermetic spawn tests: the real touch and stop hooks, HOME/TEMP in a throwaway folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTree } from './test-sandbox.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAX = 1024 * 1024;
const SID = 'MB1';

function setup(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-markerbound-'));
  t.after(() => removeTree(root));
  const home = path.join(root, 'home');
  const proj = path.join(root, 'proj');
  fs.mkdirSync(path.join(home, 'coalmine'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  const marker = path.join(home, 'coalmine', `rot-canary-${SID}.touched`);
  return { home, proj, marker };
}
function hook(script, input, { home, proj }) {
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: home, TMP: home, TMPDIR: home, USERPROFILE: home, HOME: home };
  const r = spawnSync(process.execPath, ['--max-old-space-size=512', path.join(repo, 'hooks', script)], { cwd: proj, input: JSON.stringify(input), encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', env });
  assert.equal(r.status, 0, `${script}: exit 0 (${r.stderr.slice(0, 200)})`);
  return r;
}
const touch = (cfg, file) => hook('rot-canary-touch.js', { session_id: SID, cwd: cfg.proj, tool_name: 'Write', tool_input: { file_path: file } }, cfg);
const stop = (cfg) => hook('rot-canary-stop.js', { session_id: SID, cwd: cfg.proj, stop_hook_active: false }, cfg);

// A marker holding `first` as its one real entry, padded with unreadable-as-code filler lines (nonexistent files, so the scan filters them) to exactly `size` bytes.
function plant(cfg, first, size) {
  let body = `${first}\n`;
  const pad = path.join(cfg.proj, 'gone', 'x'.repeat(60)) + '\n';
  while (Buffer.byteLength(body) + Buffer.byteLength(pad) <= size) body += pad;
  const rest = size - Buffer.byteLength(body);
  if (rest > 0) body += 'y'.repeat(rest - 1) + '\n';
  fs.writeFileSync(cfg.marker, body, { mode: 0o600 });
  assert.equal(fs.statSync(cfg.marker).size, size, 'the planted marker is exactly the size asked for');
}

test('an append with room is written; the marker grows by exactly that entry (control)', (t) => {
  const cfg = setup(t);
  const first = path.join(cfg.proj, 'edited.js');
  fs.writeFileSync(first, 'x\n');
  plant(cfg, first, MAX - 4096);
  const second = path.join(cfg.proj, 'second.js');
  fs.writeFileSync(second, 'x\n');
  touch(cfg, second);
  assert.equal(fs.statSync(cfg.marker).size, MAX - 4096 + Buffer.byteLength(second + '\n'), 'the new entry landed');
});

test('an append that would take the marker past MARKER_MAX_BYTES is refused: the marker is unchanged, still readable, and the stop hook still scans the list already written', (t) => {
  const cfg = setup(t);
  const first = path.join(cfg.proj, 'edited.js');
  fs.writeFileSync(first, 'x\n');
  plant(cfg, first, MAX - 20); // 20 bytes of room: the next entry's path is longer than that
  const second = path.join(cfg.proj, 'second.js');
  fs.writeFileSync(second, 'x\n');
  assert.ok(Buffer.byteLength(second + '\n') > 20, 'the fixture really crosses the bound');
  touch(cfg, second);
  assert.equal(fs.statSync(cfg.marker).size, MAX - 20, 'the refused append wrote nothing: the marker stays at the bound it had');
  assert.ok(!fs.readFileSync(cfg.marker, 'utf8').includes(second), 'the over-bound entry was dropped');
  const r = stop(cfg);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block', 'the stop hook still reads the list and asks for the scan');
  assert.ok(out.reason.includes(first), 'and names the entry that was already recorded');
});

test('an append that lands EXACTLY on the bound is allowed (the bound is inclusive: the reader accepts a marker of MARKER_MAX_BYTES)', (t) => {
  const cfg = setup(t);
  const first = path.join(cfg.proj, 'edited.js');
  fs.writeFileSync(first, 'x\n');
  const second = path.join(cfg.proj, 'second.js');
  fs.writeFileSync(second, 'x\n');
  plant(cfg, first, MAX - Buffer.byteLength(second + '\n'));
  touch(cfg, second);
  assert.equal(fs.statSync(cfg.marker).size, MAX, 'the entry that fills the marker to exactly the bound landed');
  assert.equal(JSON.parse(stop(cfg).stdout).decision, 'block', 'and a marker of exactly MARKER_MAX_BYTES is still read');
});

test('a marker already AT the bound refuses every further append (it never crosses it by one byte)', (t) => {
  const cfg = setup(t);
  const first = path.join(cfg.proj, 'edited.js');
  fs.writeFileSync(first, 'x\n');
  plant(cfg, first, MAX);
  const second = path.join(cfg.proj, 's.js');
  fs.writeFileSync(second, 'x\n');
  touch(cfg, second);
  assert.equal(fs.statSync(cfg.marker).size, MAX);
  assert.equal(JSON.parse(stop(cfg).stdout).decision, 'block', 'a marker at exactly MARKER_MAX_BYTES is still readable');
});
