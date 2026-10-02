// R14 / CWK-158 item 8 (CSV-4, CSV-6, CSV-7, B-u1-L6): the per-session temp markers
// (.touched .smells .scanned .memmoved) used to sit FLAT in os.tmpdir(), where on a shared
// POSIX /tmp another user can plant a symlink (the .scanned write followed it) or a FIFO (a
// blocking readFileSync hung the Stop hook, WSL exit 124). They now live in the owner-only
// <tmpdir>/coalmine/ subdir the conductor and the sweep throttle already use, and are
// read and written only through the helpers below:
//   - the dir is accepted ONLY if it is a real directory (not a link), owned by this user and
//     not group/other-writable (POSIX; fs.getuid is absent on Windows, where %TEMP% is per-user).
//     A dir somebody else made is refused: the marker functions return null/false and the
//     hook degrades to "no marker" (fail-silent), never writes into it.
//   - READ = O_NONBLOCK open, fstat must be a regular file, size bounded (the
//     readRepoFileBounded shape), so a FIFO or device cannot block and a huge file cannot
//     be slurped.
//   - WRITE = append with O_NOFOLLOW + fstat regular (the log-style .touched/.smells), a
//     wx temp + rename (the whole-value .scanned), or wx create (the write-once .memmoved).
// RESIDUALS, named: Windows has no O_NOFOLLOW/O_NONBLOCK, but its temp dir is per-user and
// a FIFO cannot be planted; a dir pre-created by THIS user with loose bits is refused, not
// tightened.
const MARKER_MAX_BYTES = 1024 * 1024; // a .touched/.smells list is one short line per edited file
const MARKER_READ_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0);
const MARKER_APPEND_FLAGS = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT
  | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
function markerDirPath() { return path.join(os.tmpdir(), 'coalmine'); }
function ensureMarkerDir() {
  const dir = markerDirPath();
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const st = fs.lstatSync(dir);
    if (st.isSymbolicLink() || !st.isDirectory()) return null;
    if (typeof process.getuid === 'function') {
      if (st.uid !== process.getuid() || (st.mode & 0o022) !== 0) return null;
    }
    return dir;
  } catch { return null; }
}
// <markerdir>/rot-canary-<sid>, or null when the dir is not trustworthy. `sid` is already
// allowlisted by the caller (/^[A-Za-z0-9_-]+$/), so it cannot traverse out of the dir.
function markerBase(sid) {
  const dir = ensureMarkerDir();
  return dir ? path.join(dir, `rot-canary-${sid}`) : null;
}
function readMarker(file) { // text, or null when absent / not a regular file / over the bound / unreadable
  let fd;
  try {
    fd = fs.openSync(file, MARKER_READ_FLAGS);
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > MARKER_MAX_BYTES) return null;
    const buf = Buffer.alloc(st.size);
    let got = 0;
    while (got < st.size) {
      const n = fs.readSync(fd, buf, got, st.size - got, got);
      if (n === 0) break;
      got += n;
    }
    return buf.toString('utf8', 0, got);
  } catch { return null; } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}
function markerExists(file) { // lstat: a link or FIFO is "present" as an entry, but readMarker will refuse it
  try { fs.lstatSync(file); return true; } catch { return false; }
}
function appendMarker(file, text) {
  let fd;
  try {
    fd = fs.openSync(file, MARKER_APPEND_FLAGS, 0o600);
    if (!fs.fstatSync(fd).isFile()) return false;
    fs.writeSync(fd, text);
    return true;
  } catch { return false; } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}
function writeMarkerAtomic(file, text) { // wx temp in the same dir, then rename over the entry (replaces a planted link, never writes through it)
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, file);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
    return false;
  }
}
