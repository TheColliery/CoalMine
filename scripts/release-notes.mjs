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
import { extractChangelogEntry, buildReleaseTitle, buildReleaseBody, makeLatestFlag, titleBandWarning, mirroredTitleOverflow, ChangelogShapeError, ReleaseRefError } from './lib/release-shape.mjs';

const BARE = /^v\d+\.\d+\.\d+$/;
// The launch form (RELEASE-PATTERN.md): ONE pre-release tag, posted as a pre-release Release, only when the
// workflow says so out loud (LAUNCH_FORM=true) and only for a hyphenated tag.
const PRE = /^v\d+\.\d+\.\d+-[0-9A-Za-z][0-9A-Za-z.-]*$/;

const USAGE = 'usage: node scripts/release-notes.mjs            (derive mode: the workflow sets RELEASE_TAG or GITHUB_REF_NAME)\n'
  + '       node scripts/release-notes.mjs --check [--repo <name>] | -h\n'
  + '  --check reads the TOP CHANGELOG.md entry, writes nothing, and fails a summary whose announcement title ("<Repo> <Release title>")\n'
  + '  would overflow GitHub\'s 200-character title ceiling; run it BEFORE the tag. The repository name: --repo, else GITHUB_REPOSITORY,\n'
  + '  else the origin remote.\n'
  + '  example: node scripts/release-notes.mjs --check --repo CoalBoard\n'
  + '  exit 0 done · 1 refused or a failed check · 64 usage error';

function repoName(args) {
  const at = args.indexOf('--repo');
  if (at !== -1) return args[at + 1] || '';
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY.split('/').pop();
  // An EXPLICIT environment (UMB-443 ruling 2): only what git needs to start. A GIT_DIR or GIT_WORK_TREE a hook or a patrol leaves in the
  // environment would aim this at ANOTHER repository's origin, and --local reads this repository's own config only, never the user's.
  const keep = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE'];
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
  try { changelog = fs.readFileSync('CHANGELOG.md', 'utf8'); } catch (e) { console.error('release-notes --check: could not read CHANGELOG.md: ' + e.message); process.exitCode = 1; return; }
  const version = /^##\s*\[([^\]]+)\]/m.exec(changelog)?.[1] ?? '';
  try {
    const { summary } = extractChangelogEntry(changelog, version);
    const title = buildReleaseTitle(version, summary);
    const tag = 'v' + version;
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
  const known = (a, i) => a === '--check' || a === '--repo' || args[i - 1] === '--repo';
  const bad = args.find((a, i) => !known(a, i));
  if (bad !== undefined) { console.error('release-notes: unknown argument ' + JSON.stringify(bad) + '\n' + USAGE); process.exitCode = 64; return; }
  if (args.includes('--check')) { check(args); return; }
  // A workflow_dispatch run sits on the default branch, so GITHUB_REF_NAME is the branch name: the tag it posts
  // arrives as RELEASE_TAG, validated by the workflow and checked again here (the input is untrusted text).
  const ref = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME;
  const launch = process.env.LAUNCH_FORM === 'true';
  if (launch ? !(ref && PRE.test(ref)) : !(ref && BARE.test(ref))) {
    console.error(launch
      ? `release-notes: the launch form is ONE pre-release tag (vX.Y.Z-label), got "${ref}" -- refusing to guess a title/body`
      : `release-notes: ${process.env.RELEASE_TAG ? 'RELEASE_TAG' : 'GITHUB_REF_NAME'} "${ref}" is not a bare vX.Y.Z tag${ref && PRE.test(ref) ? ' (a pre-release tag is posted only as the launch form, LAUNCH_FORM=true)' : ''} -- refusing to guess a title/body`);
    process.exitCode = 1;
    return;
  }
  const tagVersion = ref.slice(1);
  const prev = process.env.PREVIOUS_STABLE_TAG || '';
  const latest = process.env.LATEST_TAG || '';
  for (const [name, value] of [['PREVIOUS_STABLE_TAG', prev], ['LATEST_TAG', latest]]) {
    if (value && !BARE.test(value)) {
      console.error(`release-notes: ${name} "${value}" is not a bare vX.Y.Z tag -- refusing to guess`);
      process.exitCode = 1;
      return;
    }
  }

  let changelog;
  try {
    changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
  } catch (e) {
    console.error(`release-notes: could not read CHANGELOG.md: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    const { summary, lead, sectionsBody } = extractChangelogEntry(changelog, tagVersion, { previousStable: prev.slice(1) });
    // A pre-release is never Latest, even when the repo has no Latest yet.
    const latestFlag = launch ? 'false' : makeLatestFlag(tagVersion, latest);
    fs.writeFileSync('release-title.txt', buildReleaseTitle(tagVersion, summary));
    fs.writeFileSync('release-body.md', buildReleaseBody(summary, sectionsBody, lead));
    fs.writeFileSync('release-latest.txt', latestFlag);
    fs.writeFileSync('release-prerelease.txt', launch ? 'true' : 'false');
    console.log(`release-notes: derived the Release title + body for ${ref} from CHANGELOG.md's [${tagVersion}] entry`);
    console.log(prev ? `release-notes: the entry is followed by the previous stable tag's heading [${prev.slice(1)}]` : 'release-notes: no previous stable tag -- the heading-continuity check is skipped');
    console.log(`release-notes: make_latest=${latestFlag} (current Latest: ${latest || 'none'})`);
    // After the tag the Release is still made: an announcement overflow is a warning here, and the pre-tag --check is where it fails.
    const cap = process.env.GITHUB_REPOSITORY ? mirroredTitleOverflow(process.env.GITHUB_REPOSITORY.split('/').pop(), 'v' + tagVersion, buildReleaseTitle(tagVersion, summary)) : null;
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

main();
