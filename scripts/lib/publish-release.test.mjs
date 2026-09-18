// Unit tests for scripts/lib/publish-release.mjs's create-or-update logic.
// Zero-dep (node:test + built-ins), per scripts-quality.md section 2.
// No live network call anywhere in this file (testing.md's determinism rule) --
// fetchImpl is stubbed per test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAction, publishRelease } from './publish-release.mjs';

test('decideAction: no existing release (404) -> create', () => {
  assert.equal(decideAction(null), 'create');
});

test('decideAction: an existing release (200) -> update', () => {
  assert.equal(decideAction({ id: 123, tag_name: 'v1.0.0' }), 'update');
});

test('publishRelease: GET 404 -> POST create (never PATCH)', async () => {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method ?? 'GET' });
    if ((opts.method ?? 'GET') === 'GET') {
      return { status: 404, json: async () => ({}) };
    }
    assert.equal(opts.method, 'POST', 'must create, never PATCH, when no release exists');
    return { status: 201, json: async () => ({ id: 1, html_url: 'https://x/1', upload_url: 'https://x/1/assets' }) };
  };
  const result = await publishRelease({ owner: 'o', repo: 'r', tag: 'v9.9.9', title: 'v9.9.9', body: 'notes', token: 't', fetchImpl });
  assert.equal(result.action, 'create');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[1].method, 'POST');
});

test('publishRelease: GET 200 -> PATCH update (never a second create)', async () => {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method ?? 'GET' });
    if ((opts.method ?? 'GET') === 'GET') {
      return { status: 200, json: async () => ({ id: 42, html_url: 'https://x/42' }) };
    }
    assert.equal(opts.method, 'PATCH', 'must update the existing release, never create a second one');
    assert.ok(url.includes('/releases/42'), 'PATCH must target the existing release id');
    return { status: 200, json: async () => ({ id: 42, html_url: 'https://x/42', upload_url: 'https://x/42/assets' }) };
  };
  const result = await publishRelease({ owner: 'o', repo: 'r', tag: 'v9.9.9', title: 'v9.9.9', body: 'notes', token: 't', fetchImpl });
  assert.equal(result.action, 'update');
  assert.equal(result.id, 42);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, 'PATCH');
});

test('publishRelease: an unexpected GET status (not 200/404) fails loud, never silently creates', async () => {
  const fetchImpl = async () => ({ status: 500, json: async () => ({}) });
  await assert.rejects(
    () => publishRelease({ owner: 'o', repo: 'r', tag: 'v9.9.9', title: 'v9.9.9', body: '', token: 't', fetchImpl }),
    /unexpected GET status 500/,
  );
});

test('publishRelease: a failed create/update request rejects with the status in the message', async () => {
  const fetchImpl = async (url, opts = {}) => {
    if ((opts.method ?? 'GET') === 'GET') return { status: 404, json: async () => ({}) };
    return { status: 422, json: async () => ({ message: 'validation failed' }) };
  };
  await assert.rejects(
    () => publishRelease({ owner: 'o', repo: 'r', tag: 'v9.9.9', title: 'v9.9.9', body: '', token: 't', fetchImpl }),
    /create request failed with status 422/,
  );
});

test('publishRelease: GET 404 -> POST 422 already_exists (the CI workflow won the race) resolves to update, never throws', async () => {
  // The literal mechanism that produced the live v3.17.3 duplicate: GET-then-POST is
  // not atomic, so something else can create the release between our two calls. A 422
  // whose error body names already_exists means the race was LOST, not that the
  // request failed -- confirm the function recovers by re-fetching and PATCHing rather
  // than propagating the error (main's own reading of GitHub's docs: the errors[]
  // array carries a `code` field, `already_exists` documented for a unique-key clash).
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const method = opts.method ?? 'GET';
    calls.push({ url, method });
    if (method === 'GET' && calls.filter((c) => c.method === 'GET').length === 1) {
      return { status: 404, json: async () => ({}) }; // our own pre-check: nothing yet
    }
    if (method === 'POST') {
      return {
        status: 422,
        json: async () => ({
          message: 'Validation Failed',
          errors: [{ resource: 'Release', code: 'already_exists', field: 'tag_name' }],
        }),
      };
    }
    if (method === 'GET') {
      // the race-recovery re-fetch: the OTHER creator's release is here now
      return { status: 200, json: async () => ({ id: 77, html_url: 'https://x/77' }) };
    }
    assert.equal(method, 'PATCH', 'must update the race winner\'s release, never attempt a second create');
    assert.ok(url.includes('/releases/77'), 'PATCH must target the release id the re-fetch found');
    return { status: 200, json: async () => ({ id: 77, html_url: 'https://x/77', upload_url: 'https://x/77/assets' }) };
  };
  const result = await publishRelease({ owner: 'o', repo: 'r', tag: 'v9.9.9', title: 'v9.9.9', body: 'notes', token: 't', fetchImpl });
  assert.equal(result.action, 'update');
  assert.equal(result.id, 77);
  assert.equal(calls.length, 4, 'GET (miss), POST (422 race loss), GET (re-fetch), PATCH');
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'POST', 'GET', 'PATCH']);
});

test('publishRelease: a 422 WITHOUT an already_exists code still fails loud (the swallow is scoped, not blanket)', async () => {
  const fetchImpl = async (url, opts = {}) => {
    if ((opts.method ?? 'GET') === 'GET') return { status: 404, json: async () => ({}) };
    return {
      status: 422,
      json: async () => ({ message: 'Validation Failed', errors: [{ resource: 'Release', code: 'invalid', field: 'tag_name' }] }),
    };
  };
  await assert.rejects(
    () => publishRelease({ owner: 'o', repo: 'r', tag: 'v9.9.9', title: 'v9.9.9', body: '', token: 't', fetchImpl }),
    /create request failed with status 422/,
  );
});

test('publishRelease: missing required fields throws before any fetch call', async () => {
  let fetchCalled = false;
  const fetchImpl = async () => { fetchCalled = true; return { status: 404, json: async () => ({}) }; };
  await assert.rejects(
    () => publishRelease({ owner: 'o', repo: 'r', tag: '', title: 't', body: '', token: 'x', fetchImpl }),
    /requires owner, repo, tag, title, and token/,
  );
  assert.equal(fetchCalled, false, 'validation must fail before any network attempt');
});
