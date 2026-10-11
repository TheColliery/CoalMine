// git-env-census.pins.mjs -- this room's PINS for the canon git-spawn census (scripts/lib/git-env-census.mjs). ONE home, read by the room test
// (git-env-census.room.test.mjs) and by verify.mjs, so the gate and the test can never disagree about what is exempt.
// A pin is { rel, blob, why }: the file at `rel` is exempt ONLY while its content hashes to `blob` (git hash-object), so one edited byte or one re-sync
// makes the file a finding again ("re-derive") and the exemption cannot outlive its reason. Each `why` quotes the finding it answers.
// The row is a byte-equal org carrier, never edited here; the finding went upward in the 09a return. The second row (scripts/secret-scan.test.mjs) came out at 09b: Bankfire's a0319dcd builds every child env from named keys, which the census reads whole.
export const ROOM_PINS = [
  {
    rel: 'scripts/secret-gate.mjs',
    blob: '856956a1cca6f716e5507f6c23ac90ed34cbbe5f',
    why: "The canon gate (published-code template) builds its git env as a FILTER of process.env that keeps GIT_INDEX_FILE and GIT_CEILING_DIRECTORIES (commit mode must read the index a hook names), which the canon census refuses by rule at lines 57 and 60: \"execFileSync('git', ...) env: holds process.env without gitEnv() -- ambient GIT_* reaches the child\". The canon ships no pins, so each room that carries the gate pins it here.",
  },
];
