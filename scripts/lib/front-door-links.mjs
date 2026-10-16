// front-door-links.mjs -- every outward http(s) link of a front-door markdown file answers, at the page it names (UMB3-035 row C9, order 16i).
//
// WHY: a room's link-check.yml checks the links INSIDE the repository (relative paths, anchors); nothing read the links that leave it. That class
// slipped past every room for weeks: six READMEs said their GitBook page was "publishing soon" while the page was live, one Docs link answered 404,
// and one redirected to the docs root with the tool's own page dropped. A visitor reads the README before anything else, so its outward links are
// claims the repository makes. They are checked on every change to a front door and on a weekly clock: a page rots while the README stands still.
//
// A FINDING: a final status outside 2xx after at most MAX_HOPS redirects · no answer (a network error, a timeout) · HTTP 429 (reported, never retried)
// · a redirect chain whose final path lost the last segment of a link TWO OR MORE segments deep (docs.example/tools/x -> docs.example/, the deep link
// lost; a one-segment link may land on a site root, the shape of a stable entry link) · a "publishing soon" or "coming soon" note on the line of a link
// whose page answers.
// NOT a finding: a link inside a fenced code block or an inline code span (an example, not a claim) · a mailto:, a relative path, a bare anchor (the
// room's own link check) · a host on the caller's skip list (a placeholder or a host that refuses robots) · a redirect to a sign-in page whose query
// names the asked page (GitHub's /login?return_to=<the page>: a wall in front of the page, not a page that is gone).
// Zero dependencies (Phoenix #2): global fetch. Requests run one at a time with a timeout each, and ONE retry after a pause when the answer was
// transient (no answer, or a 5xx), so a weekly run never hammers a docs host. Every link is fetched once per run, however many lines name it.
export const MAX_HOPS = 5;
export const DEFAULT_TIMEOUT_MS = 10000;
export const DEFAULT_RETRY_MS = 2000;
export const USER_AGENT = 'TheColliery-front-door-links/1 (+https://thecolliery.org)';
const SOON = /\b(?:publishing|coming)\s+soon\b/i;

const segments = (u) => u.pathname.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s).toLowerCase(); } catch { return s.toLowerCase(); } });

/** The outward links of a markdown text: [{ url, line, lineText }], fenced blocks and inline code spans skipped, fragments kept on `url` for the report. */
export function extractLinks(text) {
  const out = [];
  let fenced = false;
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*(```|~~~)/.test(raw)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const line = raw.replace(/`[^`]*`/g, '`');
    // a markdown link or image destination, an autolink, an HTML href: the three shapes a front door uses
    for (const m of line.matchAll(/\]\((https?:\/\/[^\s)>]+)|<(https?:\/\/[^\s>]+)>|href=["'](https?:\/\/[^"']+)["']/g)) {
      out.push({ url: m[1] || m[2] || m[3], line: i + 1, lineText: raw });
    }
  }
  return out;
}

/** Follow the chain by hand: { status, finalUrl, hops } or { status: 0, error, finalUrl } when nothing answered. Never throws. */
export async function probe(fetchFn, url, { timeoutMs = DEFAULT_TIMEOUT_MS, maxHops = MAX_HOPS } = {}) {
  let u = url;
  for (let hops = 0; ; hops++) {
    let r;
    try {
      r = await fetchFn(u, { method: 'GET', redirect: 'manual', headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*;q=0.8' }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      return { status: 0, error: (e && (e.name === 'TimeoutError' ? 'timeout' : e.cause?.code || e.code || e.name)) || 'error', finalUrl: u, hops };
    }
    try { await r.body?.cancel(); } catch { /* the body is not the answer */ }
    const location = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
    if (!location) return { status: r.status, finalUrl: u, hops };
    if (hops >= maxHops) return { status: r.status, error: `more than ${maxHops} redirects`, finalUrl: u, hops };
    try { u = new URL(location, u).href; } catch { return { status: r.status, error: `a redirect to an unreadable location (${location})`, finalUrl: u, hops }; }
  }
}

/** One message for a link given its probe result, or null when the link is fine. */
export function judge(link, result) {
  const asked = new URL(link.url);
  asked.hash = '';
  if (result.status === 0) return `no answer (${result.error})`;
  if (result.error) return `${result.error} (last at ${result.finalUrl})`;
  if (result.status === 429) return 'HTTP 429, rate limited: not retried, read it by hand';
  if (result.status < 200 || result.status >= 300) return `HTTP ${result.status}${result.finalUrl !== asked.href ? ` after a redirect to ${result.finalUrl}` : ''}`;
  const final = new URL(result.finalUrl);
  // a sign-in wall that names the asked page in its query (GitHub's /login?return_to=..., a ?next=...) stands in front of the page, not instead of it
  const wall = (() => { try { return decodeURIComponent(final.search).includes(asked.href); } catch { return false; } })();
  const segs = segments(asked);
  if (segs.length >= 2 && !wall) {
    const last = segs[segs.length - 1];
    if (!segments(final).includes(last)) return `redirected to ${result.finalUrl}, which dropped "${last}": the page the link names is not there`;
  }
  if (SOON.test(link.lineText)) return `the page answers HTTP ${result.status}, so the "publishing soon" note beside the link is stale`;
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const transient = (r) => r.status === 0 || (r.status >= 500 && r.status < 600);

/**
 * Check the outward links of named texts. `files` = [{ name, text }]. Returns { findings: [{ file, line, url, message }], links: n } with one fetch per
 * distinct URL per run. `skipHosts` is an array of host names (lower-case) to leave alone, reported as skipped.
 */
export async function checkFiles(files, { fetchFn = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, retryMs = DEFAULT_RETRY_MS, maxHops = MAX_HOPS, skipHosts = [] } = {}) {
  const findings = [];
  const seen = new Map();
  const skipped = [];
  let links = 0;
  for (const { name, text } of files) {
    for (const link of extractLinks(text)) {
      links++;
      let target;
      try { target = new URL(link.url); target.hash = ''; } catch { findings.push({ file: name, line: link.line, url: link.url, message: 'not a readable URL' }); continue; }
      if (skipHosts.includes(target.hostname.toLowerCase())) { skipped.push(link.url); continue; }
      let result = seen.get(target.href);
      if (!result) {
        result = await probe(fetchFn, target.href, { timeoutMs, maxHops });
        if (transient(result)) { await sleep(retryMs); result = await probe(fetchFn, target.href, { timeoutMs, maxHops }); }
        seen.set(target.href, result);
      }
      const message = judge(link, result);
      if (message) findings.push({ file: name, line: link.line, url: link.url, message });
    }
  }
  return { findings, links, fetched: seen.size, skipped };
}
