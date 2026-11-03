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
// room's own link check) · a host on the caller's skip list (a placeholder or a host that refuses robots), whether the link names it or a redirect leads into it · a redirect to a sign-in page whose query
// names the asked page (GitHub's /login?return_to=<the page>: a wall in front of the page, not a page that is gone).
// Zero dependencies (Phoenix #2): global fetch. Requests run one at a time with a timeout each, and ONE retry after a pause when the answer was
// transient (no answer, or a 5xx), so a weekly run never hammers a docs host. Every link is fetched once per run, however many lines name it.
export const MAX_HOPS = 5;
export const DEFAULT_TIMEOUT_MS = 10000;
export const DEFAULT_RETRY_MS = 2000;
export const USER_AGENT = 'TheColliery-front-door-links/1 (+https://thecolliery.org)';
const SOON = /\b(?:publishing|coming)\s+soon\b/i;

const segments = (u) => u.pathname.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s).toLowerCase(); } catch { return s.toLowerCase(); } });

/** The outward links of a markdown text: [{ url, line, lineText }], fenced blocks and inline code spans skipped, fragments kept on `url` for the report.
 * `counter`, when given, receives `steps`: one per position the reader visits and one per character an autolink run reads (the work, not a clock). */
export function extractLinks(text, counter) {
  const out = [];
  let fenced = false;
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*(```|~~~)/.test(raw)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const line = raw.replace(/`[^`]*`/g, '`');
    // a markdown link or image destination, an autolink, an HTML href: the three shapes a front door uses
    for (const url of linkUrls(line, counter)) out.push({ url, line: i + 1, lineText: raw });
  }
  return out;
}

const MARKDOWN_DEST = /\]\((https?:\/\/[^\s)>]+)/y;
const HREF_DEST = /href=["'](https?:\/\/[^"']+)["']/y;
const isStop = (c) => c === undefined || c === '>' || /\s/.test(c);

/** The URLs of one line's three shapes, read left to right in one pass; a failed autolink run is skipped, because a < inside it stops at the same character. */
export function linkUrls(line, counter) {
  const urls = [];
  let skipAutolinkUntil = -1;
  let p = 0;
  while (p < line.length) {
    if (counter) counter.steps++;
    let hit = null;
    if (line[p] === ']') {
      MARKDOWN_DEST.lastIndex = p;
      const m = MARKDOWN_DEST.exec(line);
      if (m) hit = { url: m[1], end: p + m[0].length };
    } else if (line[p] === 'h') {
      HREF_DEST.lastIndex = p;
      const m = HREF_DEST.exec(line);
      if (m) hit = { url: m[1], end: p + m[0].length };
    } else if (line[p] === '<' && p >= skipAutolinkUntil) {
      const prefix = line.startsWith('https://', p + 1) ? 8 : line.startsWith('http://', p + 1) ? 7 : 0;
      if (prefix) {
        const from = p + 1 + prefix;
        let e = from;
        while (e < line.length && !isStop(line[e])) { e++; if (counter) counter.steps++; }
        if (e > from && line[e] === '>') hit = { url: line.slice(p + 1, e), end: e + 1 };
        else skipAutolinkUntil = e;
      }
    }
    if (hit) { urls.push(hit.url); p = hit.end; } else p++;
  }
  return urls;
}

/** Follow the chain by hand: { status, finalUrl, hops } or { status: 0, error, finalUrl } when nothing answered. Never throws.
 * A hop into a host on `skipHosts` (lower-case) is not fetched: the chain stops there with { skippedHost, finalUrl }, because the caller's skip list
 * names hosts this check must never ask, and a redirect is the asked server's choice, not the caller's. */
export async function probe(fetchFn, url, { timeoutMs = DEFAULT_TIMEOUT_MS, maxHops = MAX_HOPS, skipHosts = [] } = {}) {
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
    let next;
    try { next = new URL(location, u); } catch { return { status: r.status, error: `a redirect to an unreadable location (${location})`, finalUrl: u, hops }; }
    if (skipHosts.includes(next.hostname.toLowerCase())) return { status: r.status, skippedHost: next.hostname.toLowerCase(), finalUrl: next.href, hops: hops + 1 };
    u = next.href;
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
        result = await probe(fetchFn, target.href, { timeoutMs, maxHops, skipHosts });
        if (transient(result)) { await sleep(retryMs); result = await probe(fetchFn, target.href, { timeoutMs, maxHops, skipHosts }); }
        seen.set(target.href, result);
      }
      if (result.skippedHost) { skipped.push(link.url); continue; }
      const message = judge(link, result);
      if (message) findings.push({ file: name, line: link.line, url: link.url, message });
    }
  }
  return { findings, links, fetched: seen.size, skipped };
}
