// UMB3-035 row C9 (order 16i): the outward links of a front door answer at the page they name. Hermetic: a node:http server on the loopback
// stands in for every host, real fetch runs against it, and the CLI is spawned against a fixture that names it. No real network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractLinks, probe, judge, checkFiles } from './lib/front-door-links.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'front-door-links.mjs');
let server; let base; let flakyHits = 0;
const routes = (req, res) => {
  const u = new URL(req.url, 'http://x');
  const redirect = (to) => { res.writeHead(302, { location: to }); res.end(); };
  const ok = () => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>page</html>'); };
  switch (u.pathname) {
    case '/': case '/ok': case '/tools': case '/other/page': case '/docs/tools/x/index': return ok();
    case '/missing': res.writeHead(404); return res.end();
    case '/moved': return redirect('/ok');
    case '/tools/x': return redirect('/tools');               // the deep link lost (C9, CoalMine's docs page)
    case '/deep/page': return redirect('/other/page');        // kept: the page survives a move
    case '/docs/tools/x': return redirect('/docs/tools/x/index'); // kept: the final path still holds the segment
    case '/root1': return redirect('/');                      // a one-segment link may land on a root (a stable entry link)
    case '/loop': return redirect('/loop');
    case '/flaky': flakyHits++; if (flakyHits % 2 === 1) { res.writeHead(503); return res.end(); } return ok();
    case '/limited': res.writeHead(429); return res.end();
    case '/bad-location': res.writeHead(302, { location: 'http://' }); return res.end();
    default: res.writeHead(404); return res.end();
  }
};
before(async () => {
  server = http.createServer(routes);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections?.(); server.close(); });
// No assertion in this file depends on how fast the loopback server answers (17c): a loaded windows runner answered a probe late and the 300 ms clock of 16i
// read it as no answer (CoalMine run 64c3ffb and twice more, CoalWash 3 of 4 pushes). Every real-server probe gets a clock far beyond any load (the file's own
// clock still catches a true hang), and the timeout itself is proved against a fetch that NEVER answers and only honours the abort signal, so it fires on time
// whatever the box is doing.
const LONG = { timeoutMs: 60000, retryMs: 10 };
// A fetch that answers only when probe's own signal aborts it. If no abort reaches it, it fails the case at its own assertion (a named error in
// slow.error) after a bound it owns, never at the runner's deadline (CoalHearth t190, order 18c). The bound is a ceiling for a regression, never a measured time.
const neverAnswers = (u, o) => new Promise((_, reject) => {
  const own = setTimeout(() => reject(Object.assign(new Error('no abort reached the fetch'), { name: 'NoAbortReachedFetch' })), 3000);
  own.unref();
  o.signal.addEventListener('abort', () => { clearTimeout(own); reject(o.signal.reason); });
});

test('extractLinks: markdown links, autolinks and HTML hrefs are read with their line; fenced blocks, inline code, relative paths, mailto and titled links behave', () => {
  const text = [
    '# T', '**Docs:** [a](https://a.example/tools/x "Title") *(publishing soon)*', 'see <https://b.example/p> and <a href="https://c.example/">c</a>',
    '```', '[no](https://fenced.example/)', '```', 'inline `[no](https://code.example/)` here, [rel](docs/x.md), [m](mailto:x@y), ![img](https://d.example/i.png)',
  ].join('\n');
  const links = extractLinks(text);
  assert.deepEqual(links.map((l) => [l.url, l.line]), [['https://a.example/tools/x', 2], ['https://b.example/p', 3], ['https://c.example/', 3], ['https://d.example/i.png', 7]]);
  assert.match(links[0].lineText, /publishing soon/);
  assert.deepEqual(extractLinks('```\n[x](https://x.example)\n'), [], 'an unclosed fence hides the rest');
});

test('probe: follows a chain by hand and reports the final status and URL; a loop, a timeout and an unreadable location are errors, never throws', async () => {
  assert.deepEqual(await probe(fetch, `${base}/moved`, LONG), { status: 200, finalUrl: `${base}/ok`, hops: 1 });
  assert.deepEqual(await probe(fetch, `${base}/missing`, LONG), { status: 404, finalUrl: `${base}/missing`, hops: 0 });
  const loop = await probe(fetch, `${base}/loop`, LONG);
  assert.match(loop.error, /more than 5 redirects/);
  const slow = await probe(neverAnswers, 'http://never.example/', { timeoutMs: 300, retryMs: 10 });
  assert.equal(slow.status, 0); assert.equal(slow.error, 'timeout');
  const dead = await probe(fetch, 'http://127.0.0.1:1/x', LONG);
  assert.equal(dead.status, 0); assert.ok(dead.error, 'a refused connection names its error');
  assert.match((await probe(fetch, `${base}/bad-location`, LONG)).error, /unreadable location/);
});

test('judge: the C9 shapes are findings (a 404, a dropped deep link, a stale publishing-soon note, no answer, a 429); a kept redirect, a root landing and a live page are not', () => {
  const link = (url, lineText = '') => ({ url, line: 1, lineText });
  assert.match(judge(link('https://h/tools/x'), { status: 404, finalUrl: 'https://h/tools/x', hops: 0 }), /^HTTP 404$/);
  assert.match(judge(link('https://h/tools/x'), { status: 404, finalUrl: 'https://h/gone', hops: 1 }), /HTTP 404 after a redirect to https:\/\/h\/gone/);
  assert.match(judge(link('https://h/tools/x'), { status: 200, finalUrl: 'https://h/tools', hops: 1 }), /dropped "x"/);
  assert.match(judge(link('https://h/docs/tools/x'), { status: 200, finalUrl: 'https://d/', hops: 1 }), /dropped "x"/, 'the stable-link shape that loses its deep path');
  assert.equal(judge(link('https://h/docs'), { status: 200, finalUrl: 'https://d/', hops: 1 }), null, 'a one-segment link may land on a root');
  assert.equal(judge(link('https://g/space/tools/x'), { status: 200, finalUrl: 'https://d/tools/x', hops: 1 }), null, 'a custom-domain redirect keeps the page');
  assert.equal(judge(link('https://h/Tools/X'), { status: 200, finalUrl: 'https://h/tools/x/', hops: 1 }), null, 'case and a trailing slash do not matter');
  assert.equal(judge(link('https://h/docs/tools/x'), { status: 200, finalUrl: 'https://h/docs/tools/x/index', hops: 1 }), null, 'a page that moved under its own name keeps the segment');
  const walled = 'https://github.com/o/r/security/advisories/new';
  assert.equal(judge(link(walled), { status: 200, finalUrl: `https://github.com/login?return_to=${encodeURIComponent(walled)}`, hops: 1 }), null, 'a sign-in wall that names the page is not a dropped page');
  assert.match(judge(link(walled), { status: 200, finalUrl: 'https://github.com/login', hops: 1 }), /dropped "new"/, 'a sign-in page that names nothing is');
  assert.match(judge(link('https://h/tools/x', '**Docs:** [x](https://h/tools/x) *(publishing soon)*'), { status: 200, finalUrl: 'https://h/tools/x', hops: 0 }), /publishing soon.*stale/);
  assert.match(judge(link('https://h/tools/x', '*(Coming Soon)*'), { status: 200, finalUrl: 'https://h/tools/x', hops: 0 }), /stale/);
  assert.equal(judge(link('https://h/tools/x', '*(publishing soon)*'), { status: 200, finalUrl: 'https://h/tools', hops: 1 }).includes('dropped'), true, 'the dropped page outranks the note');
  assert.match(judge(link('https://h/'), { status: 0, error: 'timeout', finalUrl: 'https://h/' }), /no answer \(timeout\)/);
  assert.match(judge(link('https://h/'), { status: 429, finalUrl: 'https://h/', hops: 0 }), /rate limited/);
  assert.equal(judge(link('https://h/ok#frag'), { status: 200, finalUrl: 'https://h/ok', hops: 0 }), null, 'a fragment is not part of the page');
});

test('checkFiles: one fetch per distinct URL, a transient answer gets ONE retry, a skipped host is counted and not fetched, findings carry file and line', async () => {
  flakyHits = 0;
  const text = [`[a](${base}/ok)`, `[b](${base}/ok#x) and [c](${base}/missing)`, `[d](${base}/flaky)`, `[e](${base}/tools/x) *(publishing soon)*`, '[s](https://skip.example/p)', '[z](http://127.0.0.1:1/dead)'].join('\n');
  let calls = 0;
  const counting = (u, o) => { calls++; return fetch(u, o); };
  const r = await checkFiles([{ name: 'README.md', text }], { ...LONG, fetchFn: counting, skipHosts: ['skip.example'] });
  assert.equal(r.links, 7); assert.equal(r.fetched, 5, 'ok and ok#x are one fetch; the skipped host and nothing else is left out'); assert.deepEqual(r.skipped, ['https://skip.example/p']);
  assert.equal(flakyHits, 2, 'the 503 was retried once and answered');
  assert.equal(calls, 5 + 1 + 1 + 1, 'five distinct pages, one hop for the redirect, one retry for the 503 and one for the dead host: a line that repeats a URL costs no fetch');
  assert.deepEqual(r.findings.map((f) => [f.file, f.line, f.message.replace(/\(.*\)/, '(...)')]), [
    ['README.md', 2, 'HTTP 404'],
    ['README.md', 4, `redirected to ${base}/tools, which dropped "x": the page the link names is not there`],
    ['README.md', 6, 'no answer (...)'],
  ]);
  assert.deepEqual((await checkFiles([{ name: 'x', text: '[u](https://%zz/)' }], LONG)).findings.map((f) => f.message), ['not a readable URL']);
});

// The child is awaited, never spawnSync: the server it fetches from lives in THIS process, and a synchronous wait would starve it (measured: every
// request timed out). The spawn carries its own timeout, as every spawn in a test must.
// The child's environment is named keys and a sandbox for HOME and the temp folders, never a copy of the operator's own (CoalGob t147, 17b).
const CHILD_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'fdl-home-'));
after(() => fs.rmSync(CHILD_HOME, { recursive: true, force: true }));
const childEnv = (extra = {}) => ({
  ...Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'PATHEXT', 'ComSpec'].filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])),
  HOME: CHILD_HOME, USERPROFILE: CHILD_HOME, TEMP: CHILD_HOME, TMP: CHILD_HOME, TMPDIR: CHILD_HOME,
  FRONT_DOOR_LINKS_TIMEOUT_MS: '60000', FRONT_DOOR_LINKS_RETRY_MS: '10', ...extra,
});
const run = (args, env = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, ['--max-old-space-size=512', CLI, ...args], { timeout: 60000, env: childEnv(env) });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});

test('CLI: FAIL lines name file, line, url and why, the summary line always prints, exit 1 on a finding, 0 on a clean file, 1 on an unreadable file, 64 on a usage error, 0 on -h', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fdl-'));
  try {
    const bad = path.join(dir, 'README.md'); const good = path.join(dir, 'SECURITY.md');
    fs.writeFileSync(bad, `# x\n[a](${base}/missing)\n[b](${base}/tools/x) *(publishing soon)*\n`);
    fs.writeFileSync(good, `[a](${base}/ok)\n[r](${base}/root1)\n[d](${base}/deep/page)\n`);
    const r = await run([bad, good]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`^FAIL ${bad.replace(/[\\]/g, '\\\\')}:2: ${base}/missing: HTTP 404$`, 'm'));
    assert.match(r.stdout, /:3: .*dropped "x"/);
    assert.match(r.stdout, /^2 finding\(s\); 5 link\(s\) in 2 file\(s\), 5 fetched$/m);
    const ok = await run([good]);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /^0 finding\(s\); 3 link\(s\) in 1 file\(s\), 3 fetched$/m);
    const skip = await run(['--skip-host=127.0.0.1', good]);
    assert.equal(skip.status, 0); assert.match(skip.stdout, /0 fetched, 3 skipped by host/);
    const missing = await run([path.join(dir, 'nope.md')]);
    assert.equal(missing.status, 1); assert.match(missing.stdout, /^FAIL .*nope\.md: cannot be read \(ENOENT\)$/m); assert.match(missing.stdout, /^1 finding\(s\)/m);
    assert.equal((await run(['--bogus', good])).status, 64); assert.equal((await run([])).status, 64);
    const h = await run(['-h']); assert.equal(h.status, 0); assert.match(h.stdout, /^usage:/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
