// Debug hatch (CWK3-007 stage 1): an opt-in diagnostic record for a fail-silent hook. OFF unless COALMINE_DEBUG is set.
// A hook that crashed, a hook whose guard refused and a hook that found nothing are otherwise indistinguishable from outside
// (hooks-safety.md §4.1). This partial is copied into each hook by build-plugin (region 'debug-hatch'); it stays self-contained.
// Writes go to ONE file under ~/.claude/coal/coalmine/, never stdout or stderr, and nothing it records can carry a payload value:
// every field passes hatchClean, so a path, a newline or free text becomes the word 'redacted'.
const HATCH_ON = !!process.env.COALMINE_DEBUG;
const HATCH_MAX_BYTES = 256 * 1024;
const HATCH_FILE = 'debug-hatch.jsonl';
const HATCH_OLD = 'debug-hatch.1.jsonl';
const HATCH_SAFE = /^[A-Za-z0-9_.:-]{1,64}$/;
const HATCH_OPEN_FLAGS = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT
  | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
function hatchDir() { return path.join(os.homedir(), '.claude', 'coal', 'coalmine'); }
function hatchClean(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 'redacted';
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string' && HATCH_SAFE.test(v)) return v;
  return 'redacted';
}
function hatch(ev, fields) {
  if (!HATCH_ON) return;
  try {
    const rec = Object.assign({}, fields || {}, {
      ts: new Date().toISOString(),
      hook: path.basename(__filename, '.js'),
      plat: process.platform,
      node: process.version,
      ev,
    });
    for (const k of Object.keys(rec)) rec[k] = hatchClean(rec[k]);
    const line = JSON.stringify(rec) + '\n';
    const dir = hatchDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const live = path.join(dir, HATCH_FILE);
    let size = 0;
    try {
      const st = fs.lstatSync(live);
      if (!st.isFile()) return;
      size = st.size;
    } catch (e) { if (!e || e.code !== 'ENOENT') return; }
    // Rotate BEFORE the write that would cross the bound: the newest lines always survive, and the two files together stay under 2 x the bound.
    if (size + Buffer.byteLength(line) > HATCH_MAX_BYTES) fs.renameSync(live, path.join(dir, HATCH_OLD));
    let fd;
    try {
      fd = fs.openSync(live, HATCH_OPEN_FLAGS, 0o600);
      if (!fs.fstatSync(fd).isFile()) return;
      fs.writeSync(fd, line);
    } finally {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already closed */ } }
    }
  } catch { /* the hatch never throws: a diagnostic must not take the host down */ }
}
function hatchGuard(name) { hatch('guard', { guard: name }); return undefined; }
function hatchCrash(e) {
  if (!HATCH_ON) return;
  try {
    const base = path.basename(__filename);
    const fields = { err: e && e.name, at: 'unknown' };
    if (e && typeof e.code === 'string') fields.code = e.code;
    // The first frame naming THIS hook: basename and line only, so no directory and no message text reach the record.
    const stack = e && typeof e.stack === 'string' ? e.stack : '';
    for (const ln of stack.split('\n')) {
      if (!/^\s+at /.test(ln)) continue;
      const i = ln.indexOf(base + ':');
      if (i === -1) continue;
      const m = /^(\d{1,7})/.exec(ln.slice(i + base.length + 1));
      if (m) { fields.at = base + ':' + m[1]; break; }
    }
    hatch('crash', fields);
  } catch { /* swallowed: see hatch() */ }
}
