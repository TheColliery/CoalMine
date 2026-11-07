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

  // Both sides, the intended and the published, lose the same thing before they are hashed: ONE trailing newline (LF or CRLF), and nothing else. Whether
  // release-title.txt/release-body.md end in a newline and whether the API keeps or strips one on `body` is not assumed either way, so one trailing newline
  // on either side is never a mismatch, which would block every release under this rail. No other byte is removed: a leading space or newline, a trailing
  // space or tab, a second trailing newline and a same-length substitution mid-body (the em-dash-to-hyphen shape this rail exists for) all still differ.
  // History: trim() forgave a leading byte (CoalWash PR #18, CoalBoard T5) and trimEnd() trailing spaces and tabs (CoalLedger t142, CoalMine t148, CoalWash E1),
  // so 16j and then 17b narrowed both to this one newline.
  const oneNewline = (s) => s.replace(/\r?\n$/, '');
  const titleMatch = sha256(oneNewline(published.name)) === sha256(oneNewline(intendedTitle));
  const bodyMatch = sha256(oneNewline(published.body)) === sha256(oneNewline(intendedBody));

  // A signal, never a refusal (RELEASE-PATTERN.md "The title"): outside the summary-length band the rail names it and goes on.
  const band = titleBandWarning(intendedTitle.trim());
  if (band) console.log(`${process.env.GITHUB_ACTIONS ? '::warning title=release-title-band::' : ''}verify-release-shape: WARNING ${band}`);

  if (titleMatch && bodyMatch) {
    console.log('verify-release-shape: published title + body match the derived CHANGELOG-sourced text, byte for byte');
    return;
  }
  // Both titles go out through JSON.stringify (CWE-117): the published name is the API's text, and a newline in it must not forge a line of this log.
  if (!titleMatch) console.error(`verify-release-shape: TITLE MISMATCH -- intended ${JSON.stringify(intendedTitle.trim())}, published ${JSON.stringify(published.name)}`);
  if (!bodyMatch) console.error('verify-release-shape: BODY MISMATCH -- the published body does not hash to the same bytes as the derived body (see RELEASE-PATTERN.md\'s PS 5.1 / Invoke-RestMethod trap class for how this happens even on a 200)');
  process.exitCode = 1;
}

main();
