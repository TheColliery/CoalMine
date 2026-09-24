// CWK-137 -- bounded reads and contained writes on REPO-DERIVED paths, for the CLI
// scripts (install.mjs, configure.mjs). A cloned repository is untrusted input: every
// path that comes out of it can be a symlink, a junction, a FIFO or a device.
//
// The HOOKS carry their own copy of the READ half in hooks/_shared/node-config.js
// (Phoenix #9: a hook ships as one standalone file and cannot import this ESM module).
// The two MAX_* constants and readRepoFileBounded's rules are kept identical by hand;
// scripts/lib/repo-fs.test.mjs asserts the constants match, so a drift fails the gate.
//
// THE RULES (house law, CWK-137, main-ruled):
//   READ  -- lstat; a regular file proceeds; a symlink proceeds only when its
//            realpath.native target lies inside the project root's realpath AND is a
//            regular file; anything else (FIFO, device, socket, directory, an escaping
//            or dangling link) is skipped BEFORE open. Then open with O_NONBLOCK where
//            the platform has it, fstat the fd, re-check regular + size on the fd.
//            Over the bound = SKIPPED, never truncated-and-parsed.
//   WRITE -- the nearest existing ancestor of the target resolves (realpath.native)
//            inside the root's realpath; the target, if it exists, is a regular file
//            and not a symlink; the bytes go to a sibling temp opened O_EXCL and are
//            renamed over the target, so a link planted after the check is REPLACED,
//            never written through (node/runtime.md section 5).
import fs from 'node:fs';
import path from 'node:path';

// Size bounds, measured on this box 2026-09-24 (scratchpad/cwk137/measure.mjs over every
// repo under source/repos, 27,451 files): the largest real `.coalmine.json` is 9,114 B
// (the shipped, fully commented template); the largest governance markdown the hooks read
// is 216,465 B (a zone's umbrella-agents-mirror.md; TheColliery/AGENTS.md is 216,047 B).
// Headroom: ~115x for config, ~19x for docs -- AGENTS.md grew ~70% in six weeks, and a
// bound a real file crosses silently skips that file.
export const MAX_CONFIG_BYTES = 1024 * 1024;
export const MAX_DOC_BYTES = 4 * 1024 * 1024;

// O_NONBLOCK makes open() return at once on a FIFO swapped in after the lstat (the
// path-vs-fd gap); fstat then rejects it. Windows has no O_NONBLOCK (and no FIFO a repo
// can plant), so it degrades to a plain read-only open there.
const OPEN_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0);

export function isContained(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

// 'file' | 'dir' | null, decided WITHOUT opening the path. `root` null = no containment
// (the user's own home files: a dotfile manager legitimately symlinks them anywhere).
export function repoEntryKind(p, root) {
  try {
    const lst = fs.lstatSync(p);
    if (!lst.isSymbolicLink() && !lst.isFile() && !lst.isDirectory()) return null;
    if (root != null && !isContained(fs.realpathSync.native(p), fs.realpathSync.native(root))) return null;
    const st = lst.isSymbolicLink() ? fs.statSync(p) : lst;
    if (st.isFile()) return 'file';
    if (st.isDirectory()) return 'dir';
    return null;
  } catch { return null; }
}

// The file's text, or null (absent, refused, over the bound, unreadable). `prefixOnly`
// reads the first maxBytes of a larger file instead of skipping it -- for a caller that
// only ever wanted a sample (a language probe), never for one that parses the whole.
export function readRepoFileBounded(file, root, maxBytes, prefixOnly = false) {
  const buf = readRepoBytesBounded(file, root, maxBytes, prefixOnly);
  return buf === null ? null : buf.toString('utf8');
}

// The same read, as raw bytes -- for a caller that hashes (a utf8 round trip would
// change the digest of any non-UTF-8 byte sequence).
export function readRepoBytesBounded(file, root, maxBytes, prefixOnly = false) {
  if (repoEntryKind(file, root) !== 'file') return null;
  let fd;
  try {
    fd = fs.openSync(file, OPEN_FLAGS);
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return null;
    if (st.size > maxBytes && !prefixOnly) return null;
    const want = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(want);
    let got = 0;
    while (got < want) {
      const n = fs.readSync(fd, buf, got, want - got, got);
      if (n === 0) break;
      got += n;
    }
    return got === want ? buf : buf.subarray(0, got);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already closed */ } }
  }
}

// A refused write. `code` lets a caller tell a refusal from an ordinary I/O error.
export class RepoWriteRefused extends Error {
  constructor(message) { super(message); this.code = 'COALMINE_WRITE_REFUSED'; }
}

function nearestExistingAncestor(p) {
  let dir = p;
  for (;;) {
    try { fs.lstatSync(dir); return dir; } catch { /* keep climbing */ }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

// Is `dir` (existing or not) a directory whose writes stay inside `root`? null = yes,
// else the reason, phrased for a human.
export function checkRepoDirTarget(dir, root) {
  let rootReal;
  try { rootReal = fs.realpathSync.native(root); } catch { return `the root ${root} does not resolve`; }
  const anc = nearestExistingAncestor(path.resolve(dir));
  if (anc === null) return `no existing directory above ${dir}`;
  let ancReal;
  try { ancReal = fs.realpathSync.native(anc); } catch { return `${anc} is a link that does not resolve`; }
  if (!isContained(ancReal, rootReal)) return `${anc} resolves to ${ancReal}, outside ${rootReal}`;
  return null;
}

// Is `target` a file CoalMine may (re)write inside `root`? null = yes, else the reason.
export function checkRepoWriteTarget(target, root) {
  const dirWhy = checkRepoDirTarget(path.dirname(path.resolve(target)), root);
  if (dirWhy) return dirWhy;
  let st;
  try { st = fs.lstatSync(target); } catch (e) {
    if (e.code === 'ENOENT') return null;
    return `cannot inspect ${target} (${e.code})`;
  }
  if (st.isSymbolicLink()) {
    let to = 'an unresolvable target';
    try { to = fs.realpathSync.native(target); } catch { /* dangling */ }
    return `${target} is a symbolic link to ${to}`;
  }
  if (!st.isFile()) return `${target} exists but is not a regular file`;
  return null;
}

// Write `content` to `target` inside `root`, or throw RepoWriteRefused. The temp sits in
// the target's own directory (renameSync is same-device only -- guaranteed by construction).
export function writeRepoFile(target, content, root) {
  const why = checkRepoWriteTarget(target, root);
  if (why) throw new RepoWriteRefused(why);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.coalmine-tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, { encoding: 'utf8', flag: 'wx' });
  try {
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    // Windows refuses to rename over a file another process holds open without
    // FILE_SHARE_DELETE (EPERM/EBUSY/EACCES) -- measured: re-installing the git hooks
    // from inside a running `.githooks/pre-commit`. Fall back to an in-place write ONLY
    // when the target re-checks as a plain regular file with a single link: a symlink
    // or a hard link (nlink > 1) would be written THROUGH, so those still fail.
    // RESIDUAL, named: a link swapped in between this lstat and the open.
    if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
    let st;
    try { st = fs.lstatSync(target); } catch { throw e; }
    if (!st.isFile() || st.nlink > 1) throw e;
    fs.writeFileSync(target, content, 'utf8');
  }
}
