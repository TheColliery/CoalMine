// CWK-133 (R6 AMENDMENT 3) -- a git spawn made from THIS room's fixtures or gate scripts
// never inherits an ambient GIT_* override. A LINKED WORKTREE's own pre-commit/pre-push
// hook exports an ABSOLUTE GIT_DIR (the worktree's admin dir) and an ABSOLUTE
// GIT_INDEX_FILE; both override `cwd` AND any GIT_CEILING_DIRECTORIES a spawn tries to
// impose. Measured in CoalFace r5 (2026-09-23): `GIT_DIR=<abs> git init -q .` in an EMPTY
// fixture dir created NO fixture `.git` and flipped the REAL enclosing repository's
// `core.bare` to true.
//
// This room's variable matches CoalTipple's, not the test-only exemplar (CoalFace
// `0a614ae`): verify.mjs, dist-changelog.mjs and install.mjs also spawn git, and verify
// runs AS the pre-commit/pre-push gate, so the helper covers production call sites too --
// hence `git-env.mjs`, CoalTipple's name, not CoalFace's `git-test-env.mjs`.
// Consequence for the gate, named: inside a `git commit -a` the hook's GIT_INDEX_FILE
// points at git's temporary index; stripping it makes verify's `git ls-files` read the
// repository's real index instead. The census below and the zone rule take that trade.
//
// Deleting the WHOLE `GIT_*` family, never a hand-kept list: a list rots, and the family is
// what git reads (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_COMMON_DIR,
// GIT_OBJECT_DIRECTORY, and whatever a later git adds under the same prefix).
//
// `ceilingDir` is the one directory a spawn may never walk up past -- ordinarily the
// parent of the fixture or repository the spawn works in.
export function gitEnv(ceilingDir) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  env.GIT_CEILING_DIRECTORIES = ceilingDir;
  return env;
}
