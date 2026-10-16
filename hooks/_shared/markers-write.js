// R14 red: the existence-check and atomic-write half of the marker helpers, synced into the STOP hook only (the touch hook uses
// neither; an unused function there is a CodeQL js/unused-local-variable alert).
function markerExists(file) { // lstat: a link or FIFO is "present" as an entry, but readMarker will refuse it
  try { fs.lstatSync(file); return true; } catch { return false; }
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
