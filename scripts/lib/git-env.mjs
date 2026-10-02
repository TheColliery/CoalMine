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
//
// R14-N1 (`keepUserConfig`): the installer's READ of the USER's `core.hooksPath` must see the same global and system
// git config the user's own git sees, and those can be chosen by GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM and
// GIT_CONFIG_NOSYSTEM. Stripped, git reports no hooksPath and the installer writes inert hooks into .git/hooks under a
// success message. Only those three names pass, only when the caller asks, and only for that read; every fixture
// spawn and every other production spawn keeps the full strip (the census still requires `env: gitEnv(...)` on each).
const USER_CONFIG_SELECTION = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM'];
export function gitEnv(ceilingDir, { keepUserConfig = false } = {}) {
  const env = { ...process.env };
  const kept = {};
  if (keepUserConfig) {
    for (const k of USER_CONFIG_SELECTION) if (Object.hasOwn(env, k)) kept[k] = env[k];
  }
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  Object.assign(env, kept);
  env.GIT_CEILING_DIRECTORIES = ceilingDir;
  return env;
}
