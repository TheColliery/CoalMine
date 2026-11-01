// 29q c36 item 3.1: the ratchet census of raw file reads under scripts/. A raw `readFileSync` or `readFile` call takes an unbounded
// file into memory, and the bounded readers in repo-fs.mjs (readRepoFileBounded, readRepoBytesBounded) refuse links, FIFOs and
// oversize files. The census lists the raw read call sites its pattern matches (`readFileSync(` and `readFile(`, `.mjs` only, one count per line); an alias, a computed property, `createReadStream` and `.cjs` files are outside it. It fails on any site not in ALLOWLIST. Each ALLOWLIST
// entry carries an exact count and a reason, so a count that drops must be lowered in the same change (the ratchet): a stale
// allowance fails too, and a site that moves to a bounded reader leaves the list when its count reaches zero.
// The census reads source text only; a line that begins with a comment marker is not a call. Zero-dep (node built-ins only).
import fs from 'node:fs';
import path from 'node:path';

// The census's own file is excluded by name, because this module names the call in its own regex text.
const SELF = 'scripts/lib/read-census.mjs';
const RAW_READ = /\breadFile(?:Sync)?\s*\(/;
const COMMENT = /^\s*(\/\/|\*|\/\*)/;

// The target state after item 3.2's conversions. Files converted in that group are absent: a raw read left in one is a violation.
export const ALLOWLIST = {
  'scripts/lib/consistency.mjs': { count: 9, reason: 'conversion owed, T-29q-1' },
  'scripts/verify-release-shape.mjs': { count: 3, reason: 'conversion owed, T-29q-1' },
  'scripts/install.mjs': { count: 3, reason: 'conversion owed, T-29q-1' },
  'scripts/decide-upload.mjs': { count: 2, reason: 'conversion owed, T-29q-1' },
  'scripts/build-plugin.mjs': { count: 2, reason: 'conversion owed, T-29q-1' },
  'scripts/secret-gate.mjs': { count: 1, reason: 'conversion owed, T-29q-1' },
  'scripts/lib/publish-release.mjs': { count: 1, reason: 'conversion owed, T-29q-1' },
  'scripts/lib/machine-reading.mjs': { count: 1, reason: 'conversion owed, T-29q-1' },
  'scripts/lib/dist-changelog.mjs': { count: 1, reason: 'conversion owed, T-29q-1' },
  'scripts/front-door-links.mjs': { count: 1, reason: 'conversion owed, T-29q-1' },
  'scripts/release-notes.mjs': { count: 2, reason: "canon copy, the .github deputy's" },
  'scripts/build-claude-ai-zips.mjs': { count: 1, reason: "canon copy, the .github deputy's" },
  'scripts/lib/git-env-census.mjs': { count: 1, reason: "canon copy, the .github deputy's" },
};

// Every .mjs under root/scripts, minus tests and the census itself, as repo-relative posix paths.
export function censusFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(full); continue; }
      if (!ent.isFile() || !ent.name.endsWith('.mjs') || ent.name.endsWith('.test.mjs')) continue;
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (rel !== SELF) out.push(rel);
    }
  };
  walk(path.join(root, 'scripts'));
  return out.sort();
}

// The raw read sites per file: { file -> { count, lines: [line numbers] } }, files with no site omitted.
export function rawReadSites(root) {
  const sites = {};
  for (const file of censusFiles(root)) {
    const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n');
    const hit = [];
    lines.forEach((text, i) => { if (RAW_READ.test(text) && !COMMENT.test(text)) hit.push(i + 1); });
    if (hit.length) sites[file] = { count: hit.length, lines: hit };
  }
  return sites;
}

// The violations of a census against an allowlist, as human sentences. An empty array is a pass.
export function violations(root, allowlist = ALLOWLIST) {
  const sites = rawReadSites(root);
  const out = [];
  for (const [file, { count, lines }] of Object.entries(sites)) {
    const allowed = allowlist[file];
    if (!allowed) out.push(`${file}: ${count} raw read(s) at line ${lines.join(', ')} and no allowlist entry`);
    else if (count > allowed.count) out.push(`${file}: ${count} raw read(s), the allowlist permits ${allowed.count} (line ${lines.join(', ')})`);
    else if (count < allowed.count) out.push(`${file}: ${count} raw read(s), the allowlist still says ${allowed.count} — lower the count in the same change (the ratchet)`);
  }
  for (const [file, entry] of Object.entries(allowlist)) {
    if (!sites[file]) out.push(`${file}: allowlisted for ${entry.count} raw read(s) but none remain — remove the entry (the ratchet)`);
  }
  return out;
}

// Total raw read sites, for the build note's before and after numbers.
export function totalSites(root) {
  return Object.values(rawReadSites(root)).reduce((n, s) => n + s.count, 0);
}
