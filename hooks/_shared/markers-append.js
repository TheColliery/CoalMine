// R14 red: the append half of the marker helpers, synced into the TOUCH hook only (the stop hook never appends; an unused function in
// it is a CodeQL js/unused-local-variable alert). Uses ensureMarkerDir/markerBase from the common markers region.
const MARKER_APPEND_FLAGS = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT
  | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
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
