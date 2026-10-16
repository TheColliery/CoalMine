// R14 red: the append half of the marker helpers, synced into the TOUCH hook only (the stop hook never appends; an unused function in
// it is a CodeQL js/unused-local-variable alert). Uses ensureMarkerDir/markerBase from the common markers region.
const MARKER_APPEND_FLAGS = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT
  | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
function appendMarker(file, text) {
  let fd;
  try {
    fd = fs.openSync(file, MARKER_APPEND_FLAGS, 0o600);
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return false;
    // 16f row 18 (CWK2-044; PR #36 thread, the reviewer's cure): the read side (readMarker) returns null for a marker over MARKER_MAX_BYTES, so an append that would cross the bound
    // makes the WHOLE touched list unreadable at stop time. Refuse the append that would cross it: the new entry is dropped silently (Phoenix #4), the list already written stays readable.
    if (st.size + Buffer.byteLength(text) > MARKER_MAX_BYTES) return false;
    fs.writeSync(fd, text);
    return true;
  } catch { return false; } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}
