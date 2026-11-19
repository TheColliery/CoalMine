// git-env-census.pins.mjs -- this room's PINS for the canon git-spawn census (scripts/lib/git-env-census.mjs). ONE home, read by the room test
// (git-env-census.room.test.mjs) and by verify.mjs, so the gate and the test can never disagree about what is exempt.
// A pin is { rel, blob, why }: the file at `rel` is exempt ONLY while its content hashes to `blob` (git hash-object), so one edited byte or one re-sync
// makes the file a finding again ("re-derive") and the exemption cannot outlive its reason. Each `why` quotes the finding it answers.
// A second export, ASYNC_GIT_PINS, takes the same { rel, blob, why } rows for the room's MEDIUM-1 rule only (git-env-census.room.test.mjs), never the census or verify.mjs.
// The row is a byte-equal org carrier, never edited here; the finding went upward in the 09a return. The second row (scripts/secret-scan.test.mjs) came out at 09b: a canon test builds every child env from named keys, which the census reads whole.
export const ROOM_PINS = [
  {
    rel: 'scripts/secret-gate.mjs',
    blob: '2800aab9812999c8e4378164aaf0af7ebf1b119a',
    why: "The pin follows the canon re-copy of this file from .github 1af0733 (its git spawns are re-read at INSPECT; the blob moved from 856956a1 to 6b452f2f at f1c9a4d, and from 6b452f2f to 4bf97717 at 1af0733; and from 4bf97717 to 175f0a52 at 609d86b, and from 175f0a52 to 33e8a4ae at a7161df, and from 33e8a4ae to 0dd7e4e1 at 03438a1, and from 0dd7e4e1 to 719f7667 at 78c53e6, and from 719f7667 to 2800aab98129 at .github 90c1933). The canon gate (published-code template) builds its git env as a FILTER of process.env that keeps GIT_INDEX_FILE and GIT_CEILING_DIRECTORIES (commit mode must read the index a hook names), which the canon census refuses by rule at both of its git spawns (`gitIn` and `readBlobs`):\"execFileSync('git', ...) env: holds process.env without gitEnv() -- ambient GIT_* reaches the child\". The canon ships no pins, so each room that carries the gate pins it here.",
  },
];

// The room's MEDIUM-1 rule (async or shell git spawns) reads these rows, and nothing else does: the census and verify.mjs count ROOM_PINS only.
export const ASYNC_GIT_PINS = [
  {
    rel: 'scripts/secret-gate.mjs',
    blob: '2800aab9812999c8e4378164aaf0af7ebf1b119a',
    why: "Its one async git spawn (cat-file --batch, streamed on stdin, line 108, read at 90c1933, from 0dd7e4e1 to 719f7667 at 78c53e6, from 719f7667 to 2800aab98129 at .github 90c1933) passes gitEnv(), the canon's own filter of process.env that keeps GIT_INDEX_FILE and GIT_CEILING_DIRECTORIES; the canon census reads only spawnSync and execFileSync, so this spawn is unseen by it.",
  },
  {
    rel: 'scripts/secret-gate.test.mjs',
    blob: 'f98cfc8a3faeee342eb0a3906ccc40910271ba8a',
    why: "Its two async git spawns (hash-object -w --stdin, at lines 429 and 801, read at 90c1933, from 77eeb126 to 18842d60 at 78c53e6, from 18842d60 to f98cfc8a3fae at .github 90c1933) each pass gitEnv(), the same canon filter; the canon census reads only spawnSync and execFileSync, so this spawn is unseen by it.",
  },
];
