// Move a user's file aside by ONE rename, then read the moved file back and compare it with the bytes read before (BB-533, under 29kk).
// The rename is the only destroying call: nothing is removed, unlinked or copied over, and nothing is decided at one moment and destroyed at a later one.
// It never retries, never loops and never throws to its caller: every failure comes back as a verdict the caller prints.
//
// Stated limits:
//  - `replaced` is a note read BEFORE the rename, so it is one step stale: a file that appears between that lstat and the rename is replaced without
//    being reported. The rename decides; the note only words the line.
//  - The read-back reads the moved file's path after the rename. A writer that changes the moved file after the read-back is not seen (the window
//    after the last check is a stated limit, as in seed-identity.mjs).
import fs from 'node:fs';
import { checkRepoWriteTarget, readRepoBytesAndStat } from './repo-fs.mjs';

// What a failed rename left of its source: still there ('kept'), gone ('gone'), or unknown because the lstat itself threw ('unchecked').
function sourceState(src) {
  try {
    fs.lstatSync(src);
    return 'kept';
  } catch (e) {
    return e && e.code === 'ENOENT' ? 'gone' : 'unchecked';
  }
}

// The words a caller prints for a source state, without a trailing period: "<name> is kept", "<name> is no longer there", "<name> could not be checked".
export function sourceNote(state, name) {
  if (state === 'kept') return `${name} is kept`;
  if (state === 'gone') return `${name} is no longer there`;
  return `${name} could not be checked`;
}

// Returns one of:
//   { moved: true, replaced: <bool>, same: true | false | null }  (same null = the read-back could not be made)
//   { moved: false, code, srcState: 'kept' | 'gone' | 'unchecked' }  (the rename failed)
//   { moved: false, refused: <why> }  (the destination is a link or otherwise refused; nothing was renamed)
export function moveAndCompare({ src, dest, root, maxBytes, snapshot }) {
  let why = null;
  try {
    why = checkRepoWriteTarget(dest, root);
  } catch {
    why = 'the destination could not be checked';
  }
  if (why) return { moved: false, refused: why };
  let replaced = false;
  try {
    fs.lstatSync(dest);
    replaced = true;
  } catch { /* absent: nothing to replace */ }
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    return { moved: false, code: (e && e.code) || 'UNKNOWN', srcState: sourceState(src) };
  }
  let same = null;
  try {
    const back = readRepoBytesAndStat(dest, root, maxBytes);
    same = back === null ? null : back.bytes.equals(snapshot);
  } catch {
    same = null;
  }
  return { moved: true, replaced, same };
}
