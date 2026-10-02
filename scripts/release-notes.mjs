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
import { extractChangelogEntry, buildReleaseTitle, buildReleaseBody, makeLatestFlag, ChangelogShapeError, ReleaseRefError } from './lib/release-shape.mjs';

const BARE = /^v\d+\.\d+\.\d+$/;
// The launch form (RELEASE-PATTERN.md): ONE pre-release tag, posted as a pre-release Release, only when the
// workflow says so out loud (LAUNCH_FORM=true) and only for a hyphenated tag.
const PRE = /^v\d+\.\d+\.\d+-[0-9A-Za-z][0-9A-Za-z.-]*$/;

function main() {
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
    const { summary, sectionsBody } = extractChangelogEntry(changelog, tagVersion, { previousStable: prev.slice(1) });
    // A pre-release is never Latest, even when the repo has no Latest yet.
    const latestFlag = launch ? 'false' : makeLatestFlag(tagVersion, latest);
    fs.writeFileSync('release-title.txt', buildReleaseTitle(tagVersion, summary));
    fs.writeFileSync('release-body.md', buildReleaseBody(summary, sectionsBody));
    fs.writeFileSync('release-latest.txt', latestFlag);
    fs.writeFileSync('release-prerelease.txt', launch ? 'true' : 'false');
    console.log(`release-notes: derived the Release title + body for ${ref} from CHANGELOG.md's [${tagVersion}] entry`);
    console.log(prev ? `release-notes: the entry is followed by the previous stable tag's heading [${prev.slice(1)}]` : 'release-notes: no previous stable tag -- the heading-continuity check is skipped');
    console.log(`release-notes: make_latest=${latestFlag} (current Latest: ${latest || 'none'})`);
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
