// UMB3-035 row C9 (order 16i): the outward links of a front door answer at the page they name. Hermetic: a node:http server on the loopback
// stands in for every host, real fetch runs against it, and the CLI is spawned against a fixture that names it. No real network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
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
// The ceiling timer is NOT unref'd (CoalBoard t202, CoalMine t197, CoalFace t204, order 20a): AbortSignal.timeout's own timer is unref'd, so with this one
// unref'd too nothing holds the event loop and the process ends with the case unsettled (exit 13) instead of failing at its line. The abort, which
// is due at 300 ms and cancels this timer, always runs before the 3 s ceiling even when a loaded runner stalls the loop past both (timers run in expiry order).
const neverAnswers = (u, o) => new Promise((_, reject) => {
  const own = setTimeout(() => reject(Object.assign(new Error('no abort reached the fetch'), { name: 'NoAbortReachedFetch' })), 3000);
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

// ---- 29e (b), CoalTipple 29d: the autolink alternative of the link regex was quadratic on a repeated <https:// run with no closing >. The
// witness counts the work the reader does (one count per position it visits and per character a run scan reads): no clock.
const OLD_extractLinks = (text) => {
  const out = [];
  let fenced = false;
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*(```|~~~)/.test(raw)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const line = raw.replace(/`[^`]*`/g, '`');
    for (const m of line.matchAll(/\]\((https?:\/\/[^\s)>]+)|<(https?:\/\/[^\s>]+)>|href=["'](https?:\/\/[^"']+)["']/g)) out.push({ url: m[1] || m[2] || m[3], line: i + 1, lineText: raw });
  }
  return out;
};
const simplify = (links) => links.map((l) => [l.url, l.line]);

test('the link reader does linear work on the repeated <https:// shapes: steps per character stay bounded, and doubling the text at most doubles the steps -- RED before 29e (b)', () => {
  const shapes = { repeatedAutolink: (n) => '<https://x'.repeat(n), openAutolink: (n) => '<https://' + 'a'.repeat(n) };
  for (const [name, make] of Object.entries(shapes)) {
    const at = (n) => { const c = { steps: 0 }; const text = make(n); extractLinks(text, c); return { chars: text.length, steps: c.steps }; };
    const small = at(1000), big = at(2000);
    assert.ok(big.steps > 0, `${name}: the reader counts its work`);
    assert.ok(big.steps / big.chars <= 6, `${name}: steps per character ${big.steps / big.chars}`);
    assert.ok(big.steps / small.steps <= 2.2, `${name}: doubling the text took ${big.steps / small.steps} times the steps`);
  }
});

test('positive control: a counted stand-in that rescans from every < is quadratic on the same shape, so the count tells the two apart', () => {
  const naive = (text) => {
    let steps = 0;
    for (let p = 0; p < text.length; p++) {
      if (text[p] !== '<') continue;
      let e = p + 1;
      while (e < text.length && !/[\s>]/.test(text[e])) { e++; steps++; }
    }
    return steps;
  };
  const a = naive('<https://x'.repeat(1000)), b = naive('<https://x'.repeat(2000));
  assert.ok(b / a >= 3, `doubling took ${b / a} times the steps`);
});

test('the one-pass reader returns the same links as the old alternation on every markdown file in this tree and on 3000 seeded texts -- the differential for 29e (b)', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const md = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.name.startsWith('.') || e.name === 'node_modules' ? [] : e.isDirectory() ? md(path.join(dir, e.name)) : e.name.endsWith('.md') ? [path.join(dir, e.name)] : []));
  const files = md(root);
  assert.ok(files.length > 0, 'the walk found the markdown');
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    assert.deepEqual(simplify(extractLinks(text)), simplify(OLD_extractLinks(text)), f);
  }
  let seed = 7;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  const pieces = ['<', '>', 'https://', 'http://', 'x', ' ', '](', ')', 'href="', "href='", '"', "'", '`', '\n', '\t', '<https://a.b/c>', '](https://d.e)'];
  for (let i = 0; i < 3000; i++) {
    let s = '';
    const n = Math.floor(rnd() * 40);
    for (let j = 0; j < n; j++) s += pieces[Math.floor(rnd() * pieces.length)];
    assert.deepEqual(simplify(extractLinks(s)), simplify(OLD_extractLinks(s)), JSON.stringify(s));
  }
});

// ---- 2026-11-03a: the redirect chain honours the skip list, a control character never reaches a FAIL line raw, and a named file is read only as a
// regular file under a byte bound. Each was RED on the code before it.
test('checkFiles: a redirect into a skipped host is not followed -- that host is never fetched and the link counts as skipped -- RED before 2026-11-03a', async () => {
  const asked = [];
  const fake = async (u) => {
    const host = new URL(u).hostname;
    asked.push(host);
    return host === 'start.example' ? new Response(null, { status: 302, headers: { location: 'https://SKIP.example/landing' } }) : new Response('page', { status: 200 });
  };
  const r = await checkFiles([{ name: 'README.md', text: '[a](https://start.example/x)' }], { ...LONG, fetchFn: fake, skipHosts: ['skip.example'] });
  assert.deepEqual(asked, ['start.example'], 'the skipped host was never asked');
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.skipped, ['https://start.example/x']);
});

const CONTROL = (s) => Array.from(s).filter((ch) => { const c = ch.codePointAt(0); return (c < 0x20 && c !== 0x0a && c !== 0x0d) || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029; });

test('CLI: a control character in a link is written as its code point on the FAIL line, so no line can be forged or erased -- RED before 2026-11-03a', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fdl-'));
  try {
    const f = path.join(dir, 'README.md');
    // ESC [2K erases the terminal line, CSI (C1) does the same in one byte: both are built from code points, so no escape travels through a tool.
    fs.writeFileSync(f, `[a](${base}/missing${String.fromCharCode(0x1b)}[2K${String.fromCharCode(0x9b)}forged)\n`);
    const r = await run([f]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.deepEqual(CONTROL(r.stdout), [], 'no raw control character on stdout');
    const bs = String.fromCharCode(92);
    assert.ok(r.stdout.includes(`${bs}u{1b}[2K${bs}u{9b}forged`), r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: a named file past the byte bound, or one that is not a regular file, is a FAIL line, never read -- RED before 2026-11-03a', async () => {
  const bound = Number(/^const MAX_FILE_BYTES = ([0-9]+);/m.exec(fs.readFileSync(CLI, 'utf8'))?.[1]);
  assert.ok(bound > 0, 'the CLI states its byte bound');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fdl-'));
  try {
    const big = path.join(dir, 'README.md');
    fs.writeFileSync(big, 'x'.repeat(bound + 1));
    const r = await run([big, dir]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const lines = r.stdout.split(/\r?\n/);
    assert.ok(lines.some((l) => l.startsWith('FAIL ') && l.endsWith(`README.md: cannot be read (${bound + 1} bytes, past the byte bound of ${bound})`)), r.stdout);
    assert.match(r.stdout, /^FAIL .*: cannot be read \((not a regular file|EISDIR)\)$/m);
    assert.match(r.stdout, /^2 finding\(s\)/m);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// order 2026-11-03b: a named file is opened before any check of its name, a link is refused rather than followed, and a pipe never holds the open.
// The link and pipe legs need a file symlink and a real FIFO; each skips visibly where the account or the volume cannot make one, decided by PROBING the capability (AGENTS.md Hard-won lessons: never by process.platform).
test('CLI: a named file that is a symlink is refused, never followed -- RED before 2026-11-03b where a file symlink can be made', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fdl-'));
  try {
    fs.writeFileSync(path.join(dir, 'real.md'), `[a](${base}/ok)\n`);
    const link = path.join(dir, 'README.md');
    try { fs.symlinkSync(path.join(dir, 'real.md'), link, 'file'); } catch { t.skip('this account cannot make a file symlink here'); return; }
    const r = await run([link]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok(r.stdout.split(/\r?\n/).some((l) => l.startsWith('FAIL ') && l.endsWith('README.md: cannot be read (not a regular file)')), r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: a named file that is a pipe is refused at once, never waited on -- RED before 2026-11-03b where mkfifo exists', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fdl-'));
  try {
    const fifo = path.join(dir, 'README.md');
    const mk = spawnSync('mkfifo', [fifo], { timeout: 10000, env: childEnv() });
    // the probe: a mkfifo that runs AND leaves a real FIFO (Node's own lstat says so). A mkfifo of an emulation layer (Git Bash on Windows) answers 0 and leaves a plain file.
    if (mk.status !== 0 || !fs.lstatSync(fifo, { throwIfNoEntry: false })?.isFIFO()) { t.skip('this machine cannot make a real FIFO here (no mkfifo, or one that leaves no pipe)'); return; }
    const r = await run([fifo]);
    assert.equal(r.status, 1, 'the child ended on its own, refusing the pipe: ' + r.stdout + r.stderr);
    assert.ok(r.stdout.split(/\r?\n/).some((l) => l.startsWith('FAIL ') && l.endsWith('README.md: cannot be read (not a regular file)')), r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
