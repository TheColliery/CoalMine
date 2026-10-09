// git-env-census.pins.mjs -- this room's PINS for the canon git-spawn census (scripts/lib/git-env-census.mjs). ONE home, read by the room test
// (git-env-census.room.test.mjs) and by verify.mjs, so the gate and the test can never disagree about what is exempt.
// A pin is { rel, blob, why }: the file at `rel` is exempt ONLY while its content hashes to `blob` (git hash-object), so one edited byte or one re-sync
// makes the file a finding again ("re-derive") and the exemption cannot outlive its reason. Each `why` quotes the finding it answers.
// Both rows are byte-equal org carriers, never edited here; the finding goes upward in the 09a return.
export const ROOM_PINS = [
  {
    rel: 'scripts/secret-gate.mjs',
    blob: '856956a1cca6f716e5507f6c23ac90ed34cbbe5f',
    why: "The canon gate (published-code template) builds its git env as a FILTER of process.env that keeps GIT_INDEX_FILE and GIT_CEILING_DIRECTORIES (commit mode must read the index a hook names), which the canon census refuses by rule at lines 57 and 60: \"execFileSync('git', ...) env: holds process.env without gitEnv() -- ambient GIT_* reaches the child\". The canon pins this same file.",
  },
  {
    rel: 'scripts/secret-scan.test.mjs',
    blob: 'd0db994df855ccd647f3ded878a6867bb198e196',
    why: "Bankfire's test (held at d0db994d by the 09a order; the canon template is at cc3939db, so the rooms drift) takes every child env from a local gitEnv() written as (envSeen = { named keys }), a witness the census cannot read whole. Five findings, lines 547, 548, 715, 820, 825: \"env: is neither gitEnv() nor an allowlist env of named keys (gitEnv() returns an env the census refuses: an expression the census cannot read whole)\". The deputy's pending decision D1 (drop the witness) retires this pin.",
  },
];
