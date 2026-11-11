#!/usr/bin/env node
// UMB-162 (a). Reads CHANGELOG.md, derives the canon Release title + body for the tag being posted
// (RELEASE_TAG when the workflow sets it, else the pushed tag, GITHUB_REF_NAME), and writes them to release-title.txt / release-body.md for the workflow's
// next step to hand to `gh release create`/`gh release edit`. A plain CLI entry, not a gate
// (node/runtime.md sec 1's own scope note) -- a crash here is an ordinary uncaught exception,
// non-zero exit, no false green; static top-level lib imports are fine.
import fs from 'node:fs';
// UMB-182: the workflow also hands in PREVIOUS_STABLE_TAG (`git describe --exclude='*-*'`, '' on a
// first stable release) and LATEST_TAG (the repo's current Latest, '' when there is none). Unset
// behaves as '' -- the heading check is then skipped and says so -- so the canon workflow always sets both.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractChangelogEntry, hasEntryHeading,buildReleaseTitle, buildReleaseBody, makeLatestFlag, titleBandWarning, mirroredTitleOverflow, parseReleaseTag, tagOf, ChangelogShapeError, ReleaseRefError } from './lib/release-shape.mjs';

const BARE = /^v\d+\.\d+\.\d+$/;
// The tag forms are read by parseReleaseTag (release-shape.mjs): a bare vX.Y.Z, or `<pkg>-vX.Y.Z` in a multi-package repository (UMB3-193), each with an
// optional pre-release label. The launch form (RELEASE-PATTERN.md): ONE pre-release tag, posted as a pre-release Release, only when the workflow says
// so out loud (LAUNCH_FORM=true) and only for a tag carrying the label.

const USAGE = 'usage: node scripts/release-notes.mjs            (derive mode: the workflow sets RELEASE_TAG or GITHUB_REF_NAME)\n'
  + '       node scripts/release-notes.mjs --check [--repo <name>] | -h\n'
  + '  a multi-package repository tags each package line <pkg>-vX.Y.Z and heads its entries "## [<pkg> X.Y.Z] - YYYY-MM-DD" (RELEASE-PATTERN.md, "The multi-package form")\n'
  + '  --check reads the TOP CHANGELOG.md entry, writes nothing, and fails a summary whose announcement title ("<Repo> <Release title>")\n'
  + '  would overflow GitHub\'s 200-character title ceiling; run it BEFORE the tag. The repository name: --repo, else GITHUB_REPOSITORY,\n'
  + '  else the origin remote.\n'
  + '  example: node scripts/release-notes.mjs --check --repo CoalBoard\n'
  + '  exit 0 done · 1 refused or a failed check · 64 usage error';

// The CHANGELOG is the tag's own file, so it is read only as a regular file (a link or a device in its place is refused by name) and only under a byte
// bound (ours: 8 MiB, twenty times the longest CHANGELOG of the flock). The file is OPENED first and every check reads the open descriptor: a stat of
// the name before the open leaves a window in which the entry can be swapped between the check and the read. The open itself refuses a link where the
// platform can (O_NOFOLLOW) and never waits on a pipe (O_NONBLOCK). After the open, the descriptor must be the file the name names NOW (CoalLedger's
// CodeQL #29 hardening, brought into the canon 2026-11-07): a name that is a link is refused with the link message, on every platform, and a name that
// holds another file (a different dev or ino, the open followed a link the name no longer holds, or the entry was swapped) is refused before any read.
// Both checks can only refuse, never pick another file. shortcut: a filesystem that reports ino 0 gives both sides 0 and cannot tell files apart there.
const MAX_CHANGELOG_BYTES = 8388608;
const OPEN_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
// What an O_NOFOLLOW open of a link fails with: ELOOP (POSIX, Linux, macOS), EMLINK (FreeBSD open(2): "O_NOFOLLOW was specified and the target is a symbolic
// link"), EFTYPE (NetBSD open(2): "O_NOFOLLOW was specified, but the last path component is a symlink"). Each is the link message; any other error is itself.
const LINK_OPEN_ERRORS = new Set(['ELOOP', 'EMLINK', 'EFTYPE']);
function readChangelog(name = 'CHANGELOG.md') {
  const notRegular = 'is not a regular file (a link or a device is refused, never followed)';
  const refuse = (why) => { throw new Error(`${name} ${why}`); };
  let fd;
  try { fd = fs.openSync(name, OPEN_FLAGS); } catch (e) { if (e && LINK_OPEN_ERRORS.has(e.code)) refuse(notRegular); throw e; }
  try {
    const open = fs.fstatSync(fd, { bigint: true });
    const named = fs.lstatSync(name, { bigint: true });
    if (!open.isFile() || named.isSymbolicLink()) refuse(notRegular);
    if (named.dev !== open.dev || named.ino !== open.ino) refuse('changed between the check and the read: refused, never read');
    if (open.size > MAX_CHANGELOG_BYTES) refuse(`is ${open.size} bytes, past the byte bound of ${MAX_CHANGELOG_BYTES}: refused before it is read`);
    // The size above is the size AT the fstat: a file that grows after it would be read to its new end, so the read itself stops at the bound plus one byte.
    const chunks = [];
    let total = 0;
    const chunk = Buffer.alloc(65536);
    for (let n; (n = fs.readSync(fd, chunk, 0, Math.min(chunk.length, MAX_CHANGELOG_BYTES + 1 - total), null)) > 0;) {
      chunks.push(Buffer.from(chunk.subarray(0, n)));
      total += n;
      if (total > MAX_CHANGELOG_BYTES) refuse(`is more than ${MAX_CHANGELOG_BYTES} bytes by the read (it grew after the size check), past the byte bound of ${MAX_CHANGELOG_BYTES}: refused before it is used`);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { fs.closeSync(fd); }
}

// A release file is written to a new temporary name beside it and renamed into place (node/runtime.md section 5): the rename replaces the directory entry,
// so a link or a second name already standing there is replaced, never written through.
function writeOutput(name, text) {
  const tmp = `${name}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, text, { flag: 'wx' });
    fs.renameSync(tmp, name);
  } finally { fs.rmSync(tmp, { force: true }); }
}

function repoName(args) {
  const at = args.indexOf('--repo');
  if (at !== -1) return args[at + 1] || '';
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY.split('/').pop();
  // An EXPLICIT environment (UMB-443 ruling 2): only what git needs to start. A GIT_DIR or GIT_WORK_TREE a hook or a patrol leaves in the
  // environment would aim this at ANOTHER repository's origin, and --local reads this repository's own config only, never the user's.
  // GIT_CEILING_DIRECTORIES is kept on purpose (UMB-456 (1) iii): it only NARROWS where git searches, and without it a plain folder inside a repository reads that repository's origin.
  const keep = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'GIT_CEILING_DIRECTORIES'];
  const env = { ...Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  const r = spawnSync('git', ['config', '--local', '--get', 'remote.origin.url'], { encoding: 'utf8', timeout: 30000, env });
  const m = r.status === 0 ? /([^/:]+?)(?:\.git)?\s*$/.exec(r.stdout.trim()) : null;
  return m ? m[1] : '';
}

// The pre-tag check (UMB-433): no tag, no files; the top entry's announcement title against GitHub's ceiling.
function check(args) {
  const repo = repoName(args);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repo)) { console.error('release-notes --check: cannot tell the repository name; pass --repo <name>'); process.exitCode = 1; return; }
  let changelog;
  try { changelog = readChangelog(); } catch (e) { console.error('release-notes --check: could not read CHANGELOG.md: ' + e.message); process.exitCode = 1; return; }
  // the top label is "X.Y.Z", or "<pkg> X.Y.Z" in a multi-package repository (UMB3-193): the package rides into the tag and the title
  const [, pkg = '', version = ''] = /^(?:([a-z][a-z0-9]*) )?(.*)$/.exec(/^##\s*\[([^\]]+)\]/m.exec(changelog)?.[1] ?? '');
  try {
    const { summary } = extractChangelogEntry(changelog, version, { pkg });
    const title = buildReleaseTitle(version, summary, pkg);
    const tag = tagOf(pkg, version);
    const cap = mirroredTitleOverflow(repo, tag, title);
    if (cap) { console.error('release-notes --check: ' + cap); process.exitCode = 1; return; }
    const band = titleBandWarning(title);
    if (band) console.log('release-notes --check: WARNING ' + band);
    console.log('release-notes --check: ' + tag + ', announcement title "' + repo + ' ' + title + '" fits GitHub\'s 200-character ceiling');
  } catch (e) {
    if (e instanceof ChangelogShapeError) { console.error('release-notes --check: ' + e.message); process.exitCode = 1; return; }
    throw e;
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) { console.log(USAGE); return; }
  // --repo names the repository for --check only (UMB-456 (1) vii); in the derive step it would be accepted and ignored.
  const checking = args.includes('--check');
  const known = (a, i) => a === '--check' || (checking && (a === '--repo' || args[i - 1] === '--repo'));
  const bad = args.find((a, i) => !known(a, i));
  if (bad !== undefined) { console.error('release-notes: unknown argument ' + JSON.stringify(bad) + '\n' + USAGE); process.exitCode = 64; return; }
  if (args.includes('--check')) { check(args); return; }
  // A workflow_dispatch run sits on the default branch, so GITHUB_REF_NAME is the branch name: the tag it posts
  // arrives as RELEASE_TAG, validated by the workflow and checked again here (the input is untrusted text).
  const ref = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME;
  const launch = process.env.LAUNCH_FORM === 'true';
  const parsed = parseReleaseTag(ref);
  if (!parsed || (launch ? !parsed.pre : parsed.pre)) {
    console.error(launch
      ? `release-notes: the launch form is ONE pre-release tag (vX.Y.Z-label), got "${ref}" -- refusing to guess a title/body`
      : `release-notes: ${process.env.RELEASE_TAG ? 'RELEASE_TAG' : 'GITHUB_REF_NAME'} "${ref}" is not a bare vX.Y.Z tag (or <pkg>-vX.Y.Z in a multi-package repository)${parsed && parsed.pre ? ' (a pre-release tag is posted only as the launch form, LAUNCH_FORM=true)' : ''} -- refusing to guess a title/body`);
    process.exitCode = 1;
    return;
  }
  // the entry's label carries the pre-release label too (a launch form's heading is `## [0.1.0-beta.1]`)
  const { pkg } = parsed;
  const tagVersion = parsed.version + parsed.pre;
  const prev = process.env.PREVIOUS_STABLE_TAG || '';
  const latest = process.env.LATEST_TAG || '';
  // The previous stable tag is the SAME package line's; the current Latest may sit on another line (makeLatestFlag then leaves it standing, UMB3-193).
  for (const [name, value] of [['PREVIOUS_STABLE_TAG', prev], ['LATEST_TAG', latest]]) {
    if (!value) continue;
    const p = parseReleaseTag(value);
    const ok = pkg ? p && !p.pre && (name === 'LATEST_TAG' || p.pkg === pkg) : BARE.test(value);
    if (!ok) {
      const form = !pkg ? 'vX.Y.Z tag' : name === 'LATEST_TAG' ? 'vX.Y.Z tag (or <pkg>-vX.Y.Z)' : `${pkg}-vX.Y.Z tag of the same package line`;
      console.error(`release-notes: ${name} "${value}" is not a bare ${form} -- refusing to guess`);
      process.exitCode = 1;
      return;
    }
  }
  const prevVersion = prev ? parseReleaseTag(prev).version : '';

  // The tag's own CHANGELOG.md is read first and used whenever it HAS the heading for exactly this version (and package). A tag cut BEFORE its entry
  // existed has none; the DISPATCH path (and only it: the workflow sets CHANGELOG_FALLBACK on a dispatch, never on a push) then reads that version's entry
  // from the default branch's CHANGELOG at the dispatch commit, found by its exact label. The log says which source was used (UMB3-193 round 3).
  let changelog = null;
  let fromFallback = false;
  const fallbackPath = process.env.CHANGELOG_FALLBACK || '';
  let reading = 'CHANGELOG.md';
  try {
    try {
      changelog = readChangelog();
    } catch (e) {
      if (!(fallbackPath && e && e.code === 'ENOENT')) throw e; // a missing file is "no heading"; a link, a device or an oversize file is refused as ever
    }
    if (fallbackPath && (changelog === null || !hasEntryHeading(changelog, tagVersion, pkg))) {
      reading = fallbackPath;
      changelog = readChangelog(fallbackPath);
      fromFallback = true;
      if (!hasEntryHeading(changelog, tagVersion, pkg)) {
        console.error(`release-notes: neither the tag's own CHANGELOG.md nor the default branch's has a [${pkg ? pkg + ' ' : ''}${tagVersion}] heading -- refusing to guess a title/body`);
        process.exitCode = 1;
        return;
      }
    }
  } catch (e) {
    console.error(`release-notes: could not read ${reading}: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    const { summary, lead, sectionsBody } = extractChangelogEntry(changelog, tagVersion, { previousStable: prevVersion, pkg, exact: fromFallback });
    // A pre-release is never Latest, even when the repo has no Latest yet.
    const latestFlag = launch ? 'false' : makeLatestFlag(tagVersion, latest, pkg);
    const label = pkg ? `${pkg} ` : '';
    writeOutput('release-title.txt', buildReleaseTitle(tagVersion, summary, pkg));
    writeOutput('release-body.md', buildReleaseBody(summary, sectionsBody, lead));
    writeOutput('release-latest.txt', latestFlag);
    writeOutput('release-prerelease.txt', launch ? 'true' : 'false');
    console.log(`release-notes: derived the Release title + body for ${ref} from CHANGELOG.md's [${label}${tagVersion}] entry`);
    console.log(fromFallback
      ? `release-notes: source: the default branch's CHANGELOG.md at the dispatch commit (the tag's own CHANGELOG.md has no [${label}${tagVersion}] heading)`
      : "release-notes: source: the tag's own CHANGELOG.md");
    console.log(prev ? `release-notes: the entry is followed by the previous stable tag's heading [${label}${prevVersion}]` : 'release-notes: no previous stable tag -- the heading-continuity check is skipped');
    console.log(`release-notes: make_latest=${latestFlag} (current Latest: ${latest || 'none'})`);
    // After the tag the Release is still made: an announcement overflow is a warning here, and the pre-tag --check is where it fails.
    const cap = process.env.GITHUB_REPOSITORY ? mirroredTitleOverflow(process.env.GITHUB_REPOSITORY.split('/').pop(), tagOf(pkg, tagVersion), buildReleaseTitle(tagVersion, summary, pkg)) : null;
    if (cap) console.log(`${process.env.GITHUB_ACTIONS ? '::warning title=release-title-cap::' : ''}release-notes: WARNING ${cap}`);
  } catch (e) {
    if (e instanceof ChangelogShapeError || e instanceof ReleaseRefError) {
      console.error(`release-notes: ${e.message}`);
      process.exitCode = 1;
      return;
    }
    throw e;
  }
}

// Runs only as the entry point, never on import (UMB3-193 round 3): a test or a tool can import this file and nothing runs. Both sides go through realpath.native
// (node/runtime.md section 4: a Windows 8.3 name or a symlinked folder spells one file two ways). If either cannot be resolved the file runs, as it always did:
// a silent no-op of a release deriver is worse than an unwanted run, and the workflow's four-file check would blame a stale script.
const isEntry = () => {
  try { return fs.realpathSync.native(process.argv[1]) === fs.realpathSync.native(fileURLToPath(import.meta.url)); } catch { return true; }
};
if (process.argv[1] && isEntry()) main();
