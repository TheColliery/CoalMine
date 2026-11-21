// The snapshot read for a destructive step on a user's file (29kk; BB-533 replaced the re-check with move-aside.mjs).
// seedOf reads the raw bytes ONCE, before the step touches the file. The step moves the file aside by one rename (move-aside.mjs) and compares what
// is on disk after the move with these bytes. The bytes are kept raw (no BOM strip) so that comparison is exact.
import { readRepoBytesBounded } from './repo-fs.mjs';

// Returns { bytes }, or null when the file is absent, a link, not a regular file, or over the bound.
export function seedOf(abs, root, maxBytes) {
  const bytes = readRepoBytesBounded(abs, root, maxBytes);
  return bytes === null ? null : { bytes };
}
