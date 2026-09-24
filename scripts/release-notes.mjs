#!/usr/bin/env node
// UMB-162 (a). Reads CHANGELOG.md, derives the canon Release title + body for the pushed tag
// (GITHUB_REF_NAME), and writes them to release-title.txt / release-body.md for the workflow's
// next step to hand to `gh release create`/`gh release edit`. A plain CLI entry, not a gate
// (node/runtime.md sec 1's own scope note) -- a crash here is an ordinary uncaught exception,
// non-zero exit, no false green; static top-level lib imports are fine.
import fs from 'node:fs';
import { extractChangelogEntry, buildReleaseTitle, buildReleaseBody, ChangelogShapeError } from './lib/release-shape.mjs';

function main() {
  const ref = process.env.GITHUB_REF_NAME;
  if (!ref || !/^v\d+\.\d+\.\d+$/.test(ref)) {
    console.error(`release-notes: GITHUB_REF_NAME "${ref}" is not a bare vX.Y.Z tag -- refusing to guess a title/body`);
    process.exitCode = 1;
    return;
  }
  const tagVersion = ref.slice(1);

  let changelog;
  try {
    changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
  } catch (e) {
    console.error(`release-notes: could not read CHANGELOG.md: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    const { summary, sectionsBody } = extractChangelogEntry(changelog, tagVersion);
    fs.writeFileSync('release-title.txt', buildReleaseTitle(tagVersion, summary));
    fs.writeFileSync('release-body.md', buildReleaseBody(summary, sectionsBody));
    console.log(`release-notes: derived the Release title + body for ${ref} from CHANGELOG.md's [${tagVersion}] entry`);
  } catch (e) {
    if (e instanceof ChangelogShapeError) {
      console.error(`release-notes: ${e.message}`);
      process.exitCode = 1;
      return;
    }
    throw e;
  }
}

main();
