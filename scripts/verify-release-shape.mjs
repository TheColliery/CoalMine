#!/usr/bin/env node
// UMB-050's re-read rail, run BY the workflow itself now that the workflow is the sole
// Release creator (UMB-162 (a)): a 200 on `gh release create`/`gh release edit` is evidence
// the request was well-formed, never evidence the body it carried survived transport intact
// (RELEASE-PATTERN.md "A Release body is re-read after every write" -- the CoalHearth em-dash
// and the PowerShell ETS-decoration incidents it cites are exactly this failure mode, just
// hit through a different tool). MUST: a SHA256 compare over the UTF-8 BYTES, never a length
// compare -- a length match proves nothing when the corruption is a same-length substitution.
//
// Reads the intended title/body from release-title.txt / release-body.md (written by
// release-notes.mjs) and the PUBLISHED name/body as JSON on stdin -- the workflow step feeds
// it `gh release view "$TAG" --json name,body`, so this file makes no network call of its own
// and its comparison logic is exercised by a test with no `gh`/network dependency at all.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { titleBandWarning } from './lib/release-shape.mjs';

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (e) {
    return '';
  }
}

function main() {
  let intendedTitle, intendedBody;
  try {
    intendedTitle = fs.readFileSync('release-title.txt', 'utf8');
    intendedBody = fs.readFileSync('release-body.md', 'utf8');
  } catch (e) {
    console.error(`verify-release-shape: could not read the derived title/body: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  const raw = readStdin().trim();
  if (!raw) {
    console.error('verify-release-shape: no published Release JSON on stdin -- feed it `gh release view "$TAG" --json name,body`');
    process.exitCode = 1;
    return;
  }
  let published;
  try {
    published = JSON.parse(raw);
  } catch (e) {
    console.error(`verify-release-shape: stdin was not valid JSON: ${e.message}`);
    process.exitCode = 1;
    return;
  }
  // JSON that parses is still not a Release: 'null', a list or a bare value has no name or body to read, and a name or body that is not a string would be compared as an empty one (14h, CoalMine PR #36 oZt-9)
  if (published === null || typeof published !== 'object' || Array.isArray(published)) {
    console.error(`verify-release-shape: the published Release JSON is not an object (got ${published === null ? 'null' : Array.isArray(published) ? 'a list' : typeof published}) -- feed it \`gh release view "$TAG" --json name,body\``);
    process.exitCode = 1;
    return;
  }
  for (const field of ['name', 'body']) {
    if (typeof published[field] !== 'string') {
      console.error(`verify-release-shape: the published Release's ${field} is not a string (got ${published[field] === null ? 'null' : Array.isArray(published[field]) ? 'a list' : typeof published[field]}) -- the Release was not read back, so it is not cleared`);
      process.exitCode = 1;
      return;
    }
  }

  // Trim BOTH sides the same way, never only the intended one -- release-title.txt/
  // release-body.md are written by release-notes.mjs with no guaranteed trailing newline
  // convention on one side and GitHub's own on the other; whether the API preserves or
  // strips a trailing newline on `body` is not something this file assumes either way.
  // Trimming both sides identically removes that ambiguity as a source of a FALSE
  // mismatch (which would block every future release under this mechanism) while still
  // catching a real corruption -- a substituted character mid-body, the exact same-length
  // em-dash-to-hyphen shape this rail exists for, trims away to nothing and still differs.
  // trimEnd, never trim (16j; CoalWash PR #18, CoalBoard T5, CoalLedger): only the trailing newline GitHub appends is tolerated; a leading byte is the corruption this rail is for.
  const titleMatch = sha256(published.name.trimEnd()) === sha256(intendedTitle.trimEnd());
  const bodyMatch = sha256(published.body.trimEnd()) === sha256(intendedBody.trimEnd());

  // A signal, never a refusal (RELEASE-PATTERN.md "The title"): outside the summary-length band the rail names it and goes on.
  const band = titleBandWarning(intendedTitle.trim());
  if (band) console.log(`${process.env.GITHUB_ACTIONS ? '::warning title=release-title-band::' : ''}verify-release-shape: WARNING ${band}`);

  if (titleMatch && bodyMatch) {
    console.log('verify-release-shape: published title + body match the derived CHANGELOG-sourced text, byte for byte');
    return;
  }
  if (!titleMatch) console.error(`verify-release-shape: TITLE MISMATCH -- intended "${intendedTitle.trim()}", published "${published.name}"`);
  if (!bodyMatch) console.error('verify-release-shape: BODY MISMATCH -- the published body does not hash to the same bytes as the derived body (see RELEASE-PATTERN.md\'s PS 5.1 / Invoke-RestMethod trap class for how this happens even on a 200)');
  process.exitCode = 1;
}

main();
