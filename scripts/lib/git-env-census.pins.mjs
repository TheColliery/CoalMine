// git-env-census.pins.mjs -- this room's PINS for the canon git-spawn census (scripts/lib/git-env-census.mjs). ONE home, read by the room test
// (git-env-census.room.test.mjs) and by verify.mjs, so the gate and the test can never disagree about what is exempt.
// A pin is { rel, blob, why }: the file at `rel` is exempt ONLY while its content hashes to `blob` (git hash-object), so one edited byte or one re-sync
// makes the file a finding again ("re-derive") and the exemption cannot outlive its reason. Each `why` quotes the finding it answers.
// A second export, ASYNC_GIT_PINS, takes the same { rel, blob, why } rows for the room's MEDIUM-1 rule only (git-env-census.room.test.mjs), never the census or verify.mjs.
// The row is a byte-equal org carrier, never edited here; the finding went upward in the 09a return. The second row (scripts/secret-scan.test.mjs) came out at 09b: Bankfire's a0319dcd builds every child env from named keys, which the census reads whole.
export const ROOM_PINS = [
  {
    rel: 'scripts/secret-gate.mjs',
    blob: '33e8a4ae82683316832bbdc1100a56eabc65ee62',
    why: "The pin follows the canon re-copy of this file from .github 1af0733 (its git spawns are re-read at INSPECT; the blob moved from 856956a1 to 6b452f2f at f1c9a4d, and from 6b452f2f to 4bf97717 at 1af0733; and from 4bf97717 to 175f0a52 at 609d86b, and from 175f0a52 to 33e8a4ae at a7161df). The canon gate (published-code template) builds its git env as a FILTER of process.env that keeps GIT_INDEX_FILE and GIT_CEILING_DIRECTORIES (commit mode must read the index a hook names), which the canon census refuses by rule at both of its git spawns (`gitIn` and `readBlobs`):\"execFileSync('git', ...) env: holds process.env without gitEnv() -- ambient GIT_* reaches the child\". The canon ships no pins, so each room that carries the gate pins it here.",
  },
];

// The room's MEDIUM-1 rule (async or shell git spawns) reads these rows, and nothing else does: the census and verify.mjs count ROOM_PINS only.
export const ASYNC_GIT_PINS = [
  {
    rel: 'scripts/secret-gate.mjs',
    blob: '33e8a4ae82683316832bbdc1100a56eabc65ee62',
    why: "Its one async git spawn (cat-file --batch, streamed on stdin, read at a7161df) passes gitEnv(), the canon's own filter of process.env that keeps GIT_INDEX_FILE and GIT_CEILING_DIRECTORIES; the canon census reads only spawnSync and execFileSync, so this spawn is unseen by it.",
  },
  {
    rel: 'scripts/secret-gate.test.mjs',
    blob: '0d82f7061b768e425e12dcf1c19444515f903bee',
    why: "Its two async git spawns (hash-object -w --stdin, at lines 423 and 760, read at a7161df) each pass gitEnv(), the same canon filter; the canon census reads only spawnSync and execFileSync, so this spawn is unseen by it.",
  },
];
