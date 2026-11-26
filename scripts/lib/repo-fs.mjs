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
// is a room's own MEMORY.md (the umbrella AGENTS.md runs close behind it). Re-measure it
// at any edit with, from the TheColliery root (the umbrella folder, NOT source/repos, where the glob
// matches nothing and Math.max prints -Infinity):
//   node -e "const fs=require('fs');console.log(Math.max(...fs.globSync('*/*/MEMORY.md').map((f)=>fs.statSync(f).size)))"
// and keep MAX_DOC_BYTES a large multiple of that figure: governance files grow fast (AGENTS.md
// grew ~70% in six weeks), and a bound a real file crosses silently skips that file.
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
// 15b5 (CWK2-037; hooks-safety.md section 6 row 10, node/runtime.md section 4: an allowlist pins the LITERAL expected location). When `root`
// is set the check runs for EVERY entry, not only for a symlinked file: a junction (Windows) or symlink (POSIX) planted at a PARENT folder
// (`.claude`, `.claude/coal`) leaves the file itself lstat-ing as a plain file, and a realpath-inside-the-ROOT test let that link out to any
// folder of the project. So: (1) FOLDER PIN, by lstat per component (never by comparing a realpath with a hand-joined string: case and 8.3
// short names are VOLUME properties): every component between `root` and the entry's own folder must be a real directory, a link at any of
// them refused wherever it points, a target inside the project included; `root` itself is not walked, so a project opened through a linked
// path still reads its own files; a `..` segment is refused outright, because the lexical walk cannot see which link it would climb out of.
// (2) ENTRY PIN: the entry's realpath (`.native` on both sides) must stay inside its own folder's realpath, which refuses a FILE symlink that
// leaves its folder. Node reports a Windows junction as a symbolic link, so one lstat test covers both kinds. The link is resolved ONCE (resolveInsideFolder),
// and its identity is read from that resolved path (T-29nj-1), never from a second stat of the name. The open is then compared with that identity (dev and ino,
// T-76). The limit, where it stops, is written at the open in readRepoBytesAndStat and readRepoFileBounded.
// T-29qn-1 (29qn): the entry's own folder is pinned by the chain walk and the pin is compared again with the folder the realpath lands in. One swap of that
// folder to a junction after the walk moves the realpath into the swapped target, so the compare refuses it before the identity is taken (resolveInsideFolder),
// and a link entry is compared a second time after its identity is read (entryIdentity). The check and the open stay in these functions, one code path for both readers.
function folderChainPin(p, root) {
  if (p.split(/[\\/]/).includes('..')) return { ok: false, folder: null };
  const rel = path.relative(root, p);
  if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return { ok: false, folder: null };
  let cur = root;
  let folder = null; // the entry's own folder, the last one walked; null when the entry sits directly in `root`, which is not walked
  for (const part of rel.split(path.sep).slice(0, -1)) {
    cur = path.join(cur, part);
    let st;
    try { st = fs.lstatSync(cur, { bigint: true }); } catch { return { ok: false, folder: null }; }
    if (st.isSymbolicLink()) return { ok: false, folder: null };
    folder = { dev: st.dev, ino: st.ino };
  }
  return { ok: true, folder };
}
// Is `dirPath` the folder the chain walk pinned? No pin (the root is not walked) and an ino of 0 on either side (a volume that reports none) skip the compare.
function folderIs(dirPath, folder) {
  if (folder === null) return true;
  const st = fs.lstatSync(dirPath, { bigint: true });
  if (!st.isDirectory()) return false;
  if (folder.ino === 0n || st.ino === 0n) return true;
  return st.dev === folder.dev && st.ino === folder.ino;
}
// The entry's realpath, with the folder it resolved into, or null. ONE realpath of the entry: the caller takes the entry's identity from the path returned here,
// never from a second resolution of the name (T-29nj-1). The folder is compared after its realpath is taken and before the entry's own (T-29qn-1).
function resolveInsideFolder(p, root) {
  try {
    if (path.relative(root, p) === '') return { real: fs.realpathSync.native(p), realFolder: null, folder: null };
    const chain = folderChainPin(p, root);
    if (!chain.ok) return null;
    const realFolder = fs.realpathSync.native(path.dirname(p));
    if (!folderIs(realFolder, chain.folder)) return null;
    const real = fs.realpathSync.native(p);
    return real !== realFolder && isContained(real, realFolder) ? { real, realFolder, folder: chain.folder } : null;
  } catch { return null; }
}
function identityOf(st) { // dev and ino as bigint, so a 64-bit file id is never rounded
  return st.isFile() ? { kind: 'file', dev: st.dev, ino: st.ino } : { kind: 'dir', dev: st.dev, ino: st.ino };
}
// (T-76, 29nj) The entry's kind and identity. A plain entry: its one lstat. A link: the path resolveInsideFolder resolved (taken once), read by an lstat that must
// say regular file or directory (a link there is refused). Never a second stat of the name, so a link retargeted after the realpath is not the file read.
// T-29qn-1: a link's folder is compared again after that lstat, so a swap made between the resolution and the lstat is refused as well.
function entryIdentity(p, root) {
  try {
    const lst = fs.lstatSync(p, { bigint: true });
    if (!lst.isSymbolicLink() && !lst.isFile() && !lst.isDirectory()) return null;
    if (!lst.isSymbolicLink()) {
      if (root != null && resolveInsideFolder(p, root) === null) return null;
      return identityOf(lst);
    }
    const resolved = root != null ? resolveInsideFolder(p, root) : { real: fs.realpathSync.native(p), realFolder: null, folder: null };
    if (resolved === null) return null;
    const rst = fs.lstatSync(resolved.real, { bigint: true });
    if (!rst.isFile() && !rst.isDirectory()) return null;
    if (resolved.realFolder !== null && !folderIs(resolved.realFolder, resolved.folder)) return null;
    return identityOf(rst);
  } catch { return null; }
}
export function repoEntryKind(p, root) { // 'file' | 'dir' | null, decided WITHOUT opening p
  const id = entryIdentity(p, root);
  return id === null ? null : id.kind;
}
// The opened handle is the entry the check took (T-76). ino 0 on either side (a volume that reports none) skips the compare, as the name check did.
function sameHandle(fst, id) {
  if (fst.ino === 0n || id.ino === 0n) return true;
  return fst.dev === id.dev && fst.ino === id.ino;
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
// (T-76) A regular file swapped in between the check and the open is refused: the opened handle's dev and ino are compared with the check's identity.
// The one bounded reader, one descriptor: the bytes AND the fstat come from the same open file (29kk), so a caller
// that keys an identity on the stat is keyed on the file it read, never on a name it stat'ed separately.
export function readRepoBytesAndStat(file, root, maxBytes, prefixOnly = false) {
  const id = entryIdentity(file, root);
  if (id === null || id.kind !== 'file') return null;
  let fd;
  try {
    // THE LIMIT (T-29nj-1; the reader's own statement). Closed: a file or link swapped or retargeted after its identity was taken is refused by the compare
    // below. NOT closed: a timed multi-swap of a FOLDER in the chain, back and forth around the kind check and this open. Node has no handle-relative open (no
    // *at() call), and /proc/self/fd exists on Linux only (measured in TheColliery/scratchpad/dispatch/29np-t82-answer.md). Also not closed: a swap of the
    // resolved file's own name before its identity is read, which is the window a plain file has.
    fd = fs.openSync(file, OPEN_FLAGS);
    if (!sameHandle(fs.fstatSync(fd, { bigint: true }), id)) return null; // T-76: the name changed between the check and the open; refused, never read
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
    return { bytes: got === want ? buf : buf.subarray(0, got), st };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already closed */ } }
  }
}

// The bytes only, for a caller that does not key on the stat.
export function readRepoBytesBounded(file, root, maxBytes, prefixOnly = false) {
  const r = readRepoBytesAndStat(file, root, maxBytes, prefixOnly);
  return r === null ? null : r.bytes;
}

// A refused write. `code` lets a caller tell a refusal from an ordinary I/O error.
export class RepoWriteRefused extends Error {
  constructor(message) { super(message); this.code = 'COALMINE_WRITE_REFUSED'; }
}

// 17a (CWK2-042, the project-write folder pin; CoalLedger's mkdirRepoParents, v0.15.0-beta.7, ported). The write side follows the same literal pin as the 15b read side
// (repoEntryKind): a link or junction at ANY component between the project root and the target's folder is refused wherever it points, a target INSIDE the project
// included (the read side refuses to read that very path, so a config written there would be ignored by the hooks). `root` itself is not walked (a project opened through a
// linked path still works, as for reads). Measured at main (scratchpad/r17a/witness-042.mjs): the OUTSIDE escape was already refused (checkRepoWriteTarget resolves the
// nearest existing ancestor by realpath BEFORE the make), so nothing was made outside; the gap was the in-project link.
// What a user is told for a refused FOLDER (a link, a junction or a file on the chain); the callers keep their file instruction for a refused FILE (17a INSPECT LOW-1).
export const FOLDER_FIX = 'make that path a real folder inside the project (remove the link or the file that sits there) and re-run';
// The instruction a read-only FILE carries (T-29mk-D2). A caller that prints link advice checks for this text and prints it instead, as it does for FOLDER_FIX.
export const READONLY_FIX = 'make the file writable if you mean to change it';
function escapesRoot(rel) { return rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel); }
// The reason a folder chain is refused, or null: only existing components are judged (a missing one has nothing under it). Used by checkRepoDirTarget, so every caller's
// pre-check refuses before anything is written, and by mkdirRepoParents below.
function folderChainWhy(dir, root) {
  if (root == null) return null;
  const rel = path.relative(root, dir);
  if (rel === '') return null;
  if (escapesRoot(rel)) return `${dir} is outside the project root ${root} -- ${FOLDER_FIX}`;
  let cur = root;
  for (const part of rel.split(path.sep)) {
    cur = path.join(cur, part);
    let st;
    try { st = fs.lstatSync(cur); } catch (e) { if (e.code === 'ENOENT') return null; return `${cur} could not be inspected (${e.code}) -- ${FOLDER_FIX}`; }
    if (st.isSymbolicLink()) return `${cur} is a link or junction on the path to ${dir}, and a link at any folder under the project root is refused wherever it points -- ${FOLDER_FIX}`;
    if (!st.isDirectory()) return `${cur} exists and is not a directory -- ${FOLDER_FIX}`;
  }
  return null;
}
// Make `dir` (and its missing parents) under `root`, one component at a time with a plain NON-recursive mkdir, lstat-ing each component after it exists, so a refused target
// makes nothing past a checked component. `root = null` (a user-chosen folder that is its own root) keeps the plain recursive make. Residual, named: the walk and the later write
// are separate steps, so a folder swapped for a junction by a local process after the last re-check is caught only by writeRepoFile's realpath check on the nearest ancestor.
export function mkdirRepoParents(dir, root) {
  if (root == null) { fs.mkdirSync(dir, { recursive: true }); return; }
  const rel = path.relative(root, dir);
  if (rel === '') return;
  if (escapesRoot(rel)) throw new RepoWriteRefused(`${dir} is outside the project root ${root} -- ${FOLDER_FIX}.`);
  let cur = root;
  for (const part of rel.split(path.sep)) {
    cur = path.join(cur, part);
    let st = null;
    try { st = fs.lstatSync(cur); } catch (e) { if (e.code !== 'ENOENT') throw new RepoWriteRefused(`${cur} could not be inspected (${e.code}) -- ${FOLDER_FIX}.`); }
    if (st === null) {
      try { fs.mkdirSync(cur); } catch (e) { if (e.code !== 'EEXIST') throw new RepoWriteRefused(`${cur}: its folder could not be made (${e.code}) -- ${FOLDER_FIX}.`); }
      try { st = fs.lstatSync(cur); } catch (e) { throw new RepoWriteRefused(`${cur} could not be inspected after it was made (${e.code}) -- ${FOLDER_FIX}.`); }
    }
    if (st.isSymbolicLink()) throw new RepoWriteRefused(`${cur} is a link or junction on the path to ${dir}, and a link at any folder under the project root is refused wherever it points -- ${FOLDER_FIX}.`);
    if (!st.isDirectory()) throw new RepoWriteRefused(`${cur} exists and is not a directory -- ${FOLDER_FIX}.`);
  }
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
  // Every reason below judges a FOLDER on the way to the target, so each carries the folder instruction (17a CI red 2: the ancestor-outside reason did not,
  // and a linked folder or file at .claude was told nothing). The root's own failure, and the file-level reasons in checkRepoWriteTarget, keep their own text.
  if (anc === null) return `no existing directory above ${dir} -- ${FOLDER_FIX}`;
  let ancReal;
  try { ancReal = fs.realpathSync.native(anc); } catch { return `${anc} is a link that does not resolve -- ${FOLDER_FIX}`; }
  if (!isContained(ancReal, rootReal)) return `${anc} resolves to ${ancReal}, outside ${rootReal} -- ${FOLDER_FIX}`;
  return folderChainWhy(path.resolve(dir), path.resolve(root)); // 17a: a link anywhere under the root is refused, in-project included
}

// The room's one write-bit test (T-29mk-D2; BB-533 ruling 6 reuses it): a mode with no write bit. On Windows the read-only attribute reads as 0o444.
export function isNoWriteMode(mode) { return (mode & 0o222) === 0; }

// Is `target` a file CoalMine may (re)write inside `root`? null = yes, else the reason.
// `movedAside` (29nj N1): the caller MOVES this file (a rename keeps its bytes and mode) and never writes it, so a read-only file is not refused for that move.
export function checkRepoWriteTarget(target, root, { movedAside = false } = {}) {
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
  // T-29mk-D2: a file with no write bit is refused by name, never chmodded and never replaced. Windows reports the read-only attribute as 0o444, so one check covers both.
  // Stated limit (H3): a file made read-only AFTER this check is still replaced on POSIX, because the rename needs only the folder's write bit. Not closed here.
  if (!movedAside && isNoWriteMode(st.mode)) return `${target} is read-only; nothing was written -- ${READONLY_FIX}`;
  return null;
}

// Write `content` to `target` inside `root`, or throw RepoWriteRefused. The temp sits in
// the target's own directory (renameSync is same-device only -- guaranteed by construction).
export function writeRepoFile(target, content, root) {
  const why = checkRepoWriteTarget(target, root);
  if (why) throw new RepoWriteRefused(why);
  mkdirRepoParents(path.dirname(path.resolve(target)), path.resolve(root)); // 17a (CWK2-042): one component at a time, a link at any component refused
  // The pid, not a random suffix: the installer's leftover sweep reads the pid to tell a dead writer's temp from a live one (render.mjs sweepInstallLeftovers).
  const tmp = `${target}.coalmine-tmp-${process.pid}`;
  let fd;
  try { fd = fs.openSync(tmp, 'wx'); }
  catch (e) {
    // A leftover we did not create: never unlinked here, only named to the user.
    if (e.code === 'EEXIST') throw new RepoWriteRefused(`${target}: a leftover file ${tmp} is in the way -- remove that file and re-run`);
    throw e;
  }
  try {
    fs.writeFileSync(fd, content, 'utf8');
    fs.closeSync(fd);
  } catch (e) {
    try { fs.closeSync(fd); } catch { /* already closed */ }
    try { fs.unlinkSync(tmp); } catch { /* best effort: this temp is ours, the write just failed */ }
    throw e;
  }
  try {
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    // Windows refuses to rename over a file another process holds open without
    // FILE_SHARE_DELETE (EPERM/EBUSY/EACCES) -- measured: re-installing the git hooks
    // from inside a running `.githooks/pre-commit`. Fall back to an in-place write ONLY
    // when the target is a plain regular file with a single link: a symlink or a hard link
    // (nlink > 1) would be written THROUGH, so those still fail.
    // CWK-137 carry-over, CodeQL #69 (js/file-system-race): the check is made ON THE OPEN
    // HANDLE, never on the path -- open without truncating (O_NOFOLLOW where the platform
    // has it, so a planted link fails the open on POSIX), fstat that fd, and only then
    // truncate + write through the SAME fd. A link swapped in after the rename failed can
    // no longer redirect the write. RESIDUAL, named: Windows has no O_NOFOLLOW, so there a
    // symlink planted in that window would be followed -- it still has to resolve to a
    // single-link regular file, and creating a symlink on Windows needs a privilege.
    // R8 INSPECT LOW-1: O_NONBLOCK too -- an O_WRONLY open of a FIFO planted in the same
    // window would otherwise BLOCK until a reader appears (a hung installer), because the
    // fstat below only runs after the open returns. With it, a reader-less FIFO fails
    // ENXIO at the open and the original error is rethrown; O_NONBLOCK does not change a
    // regular file's writes. Windows has no O_NONBLOCK (0), and no FIFOs in a directory.
    if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
    let fd;
    const flags = fs.constants.O_WRONLY | (fs.constants.O_NONBLOCK || 0) | (fs.constants.O_NOFOLLOW || 0);
    try { fd = fs.openSync(target, flags); } catch { throw e; }
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.nlink > 1) throw e;
      const buf = Buffer.from(content, 'utf8');
      fs.ftruncateSync(fd, 0);
      let off = 0;
      while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off, off);
    } finally {
      fs.closeSync(fd);
    }
  }
}
