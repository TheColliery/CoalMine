#!/usr/bin/env node
// Create-or-update a GitHub Release for a tag (board #114).
//
// Root cause this closes: main's own habit of POSTing a Release by hand
// immediately after pushing a tag races the claude-ai-zips.yml workflow's own
// "Ensure the GitHub Release exists" step (board #99) -- confirmed live on
// v3.17.3: TWO release objects exist for the same tag, created within the same
// second (one by github-actions[bot], 0 assets; one by the authenticated user,
// 10 assets), and /releases/latest serves whichever GitHub's own ordering
// picks. The workflow step is NOT the bug (it already does create-then-verify
// correctly) -- this script closes the OTHER half: main's manual path never
// checked for an existing release before creating one.
//
// GET the release for the tag first; 404 -> POST create; 200 -> PATCH update
// (never a second create). Zero-dep (Phoenix #2): Node's global `fetch`, no
// npm package -- verified available and unflagged on this box (Node 24; this
// room's own dev/CI floor is Node 22, per node/runtime.md section 6, safely
// past fetch's stabilization).
//
// This is a plain CLI tool with no enumerate-and-report contract (node/runtime.md
// section 1's Scope note) -- not a gate, no dynamic-import requirement; static
// imports are fine.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const API_BASE = 'https://api.github.com';

// Pure decision: does an existing release mean create or update? Exported and
// tested standalone -- no fetch, no async, no network -- per this room's own
// testing.md "reach for a fake over a mock when you can": the one true
// externality (GitHub's API) is isolated to publishRelease() below; this
// function has none to fake.
export function decideAction(existingRelease) {
  return existingRelease ? 'update' : 'create';
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'CoalMine-publish-release',
  };
}

// GitHub's own docs (Troubleshooting the REST API, confirmed 2026-08-16 -- not
// assumed) state a 422 Validation Failed body carries an `errors` array with a
// `code` field, and name `already_exists` as the code for "another resource
// has the same value as one of your parameters" -- a unique-key collision,
// exactly what a second create for the same tag_name produces.
function isAlreadyExistsError(errorBody) {
  return Array.isArray(errorBody?.errors) && errorBody.errors.some((e) => e?.code === 'already_exists');
}

// The HTTP-calling half, separated so publishRelease() can take a fetchImpl
// override in tests -- a stub returning canned {status, json} pairs proves the
// create-vs-update BRANCH is chosen correctly without a live network call
// (testing.md's determinism rule: no real network in a unit test).
export async function publishRelease({ owner, repo, tag, title, body, token, fetchImpl = fetch }) {
  if (!owner || !repo || !tag || !title || !token) {
    throw new Error('publishRelease requires owner, repo, tag, title, and token');
  }
  const tagUrl = `${API_BASE}/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  const getRes = await fetchImpl(tagUrl, { headers: authHeaders(token) });
  let existing = null;
  if (getRes.status === 200) {
    existing = await getRes.json();
  } else if (getRes.status !== 404) {
    throw new Error(`unexpected GET status ${getRes.status} checking for an existing release`);
  }
  const action = decideAction(existing);
  const payload = JSON.stringify({ tag_name: tag, name: title, body: body ?? '' });
  let res = action === 'create'
    ? await fetchImpl(`${API_BASE}/repos/${owner}/${repo}/releases`, { method: 'POST', headers: authHeaders(token), body: payload })
    : await fetchImpl(`${API_BASE}/repos/${owner}/${repo}/releases/${existing.id}`, { method: 'PATCH', headers: authHeaders(token), body: payload });
  let effectiveAction = action;
  if (action === 'create' && res.status === 422) {
    // The window this narrows (GET-then-POST is not atomic) is still real: something
    // else (the CI workflow's own "Ensure Release exists" step, board #99) can create
    // the release between our GET and our POST. A 422 whose error body names
    // already_exists means the race was LOST, not that the request failed -- the
    // release now exists, which is the outcome we wanted; re-fetch it and PATCH
    // instead of throwing. Any OTHER 422 (a genuine validation failure) still fails
    // loud below -- this branch never blanket-swallows the status code alone.
    const errorBody = await res.json();
    if (isAlreadyExistsError(errorBody)) {
      const raceGetRes = await fetchImpl(tagUrl, { headers: authHeaders(token) });
      if (raceGetRes.status !== 200) {
        throw new Error(`create request got 422 already_exists, but re-fetching the release returned ${raceGetRes.status}`);
      }
      const raceWinner = await raceGetRes.json();
      effectiveAction = 'update';
      res = await fetchImpl(`${API_BASE}/repos/${owner}/${repo}/releases/${raceWinner.id}`, { method: 'PATCH', headers: authHeaders(token), body: payload });
    } else {
      throw new Error(`create request failed with status 422`);
    }
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${effectiveAction} request failed with status ${res.status}`);
  }
  const result = await res.json();
  return { action: effectiveAction, id: result.id, html_url: result.html_url, upload_url: result.upload_url };
}

async function main() {
  const [tag, title, bodyFile] = process.argv.slice(2);
  if (!tag || !title) {
    console.error('Usage: node scripts/lib/publish-release.mjs <tag> <title> [body-file]');
    process.exitCode = 1;
    return;
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('Error: GITHUB_TOKEN is not set.');
    process.exitCode = 1;
    return;
  }
  const body = bodyFile ? fs.readFileSync(bodyFile, 'utf8') : '';
  try {
    const result = await publishRelease({ owner: 'HetCreep', repo: 'CoalMine', tag, title, body, token });
    console.log(`${result.action === 'create' ? 'Created' : 'Updated'} the release for ${tag}: ${result.html_url}`);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exitCode = 1;
  }
}

// Only run the CLI when invoked directly -- importing this module for tests
// (publishRelease/decideAction) must never fire a real network call as a
// side effect of the import itself.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main();
