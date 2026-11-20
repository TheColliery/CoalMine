// A user's file read once to decide a destructive step, and re-checked just before that step (29kk, HIGH).
// seedOf takes the bytes and the identity of the file it read, both from ONE descriptor (readRepoBytesAndStat in repo-fs.mjs).
// stillSeeded opens the path once more, reads and fstat's through that descriptor, and says whether the bytes and the identity
// are the seed's, and whether the name still names the same file (its lstat against the descriptor's fstat: same dev and ino).
// A failed re-read counts as changed, so the caller keeps the file.
// Stated limit: the window between the last check and the act itself is not closed here; a swap in that window is not caught.
import fs from 'node:fs';
import { readRepoBytesAndStat } from './repo-fs.mjs';

// dev:ino:size:mtimeMs, taken from the descriptor's fstat. A replaced file changes ino even when its bytes are equal.
function identityOf(st) {
  return `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}`;
}

// The name must still name the file the descriptor read. A failed lstat counts as "not the same".
function nameNamesSameFile(abs, st) {
  try {
    const named = fs.lstatSync(abs);
    return named.dev === st.dev && named.ino === st.ino;
  } catch {
    return false;
  }
}

// Returns { abs, root, maxBytes, bytes, id }, or null when the file is absent, a link, not a regular file, or over the bound.
export function seedOf(abs, root, maxBytes) {
  const r = readRepoBytesAndStat(abs, root, maxBytes);
  if (r === null) return null;
  return { abs, root, maxBytes, bytes: r.bytes, id: identityOf(r.st) };
}

// True only when the file still reads as the seed's bytes, still has the seed's identity, and the name still names that file.
export function stillSeeded(seed) {
  if (!seed) return false;
  const r = readRepoBytesAndStat(seed.abs, seed.root, seed.maxBytes);
  if (r === null) return false;
  return r.bytes.equals(seed.bytes) && identityOf(r.st) === seed.id && nameNamesSameFile(seed.abs, r.st);
}
