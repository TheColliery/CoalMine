// Install manifest with per-file integrity hashes — the SFC-lite layer.
//
// Windows' System File Checker restores OS files that no longer match a known
// hash. CoalMine's installer is the analog: at install time it records the
// SHA-256 of every file it writes into the manifest; `verify.mjs <target>` later
// re-hashes those files and flags any that changed. This catches an installed
// skill or hook that was altered AFTER install — a surface git never sees,
// because installs live outside the repo.
//
// Threat boundary (stated honestly): an attacker who rewrites a file AND its
// manifest hash defeats this self-check. That is a higher bar (needs the format
// + recompute), and the repo side is covered separately by the git-signed
// canonical + verify.mjs byte-compare. Defense in depth, not a silver bullet.
//
// SECOND CEILING, structural and unfixable by a better walk: a hash list proves the
// RECORDED set only. A file ADDED to the target after install has no manifest entry,
// so nothing looks for it and it is invisible to this check — detecting it would need
// a directory walk at VERIFY time, which is a different design. That is exactly why a
// file must never be dropped from the manifest at write time (see hashInstalledTree):
// an omitted file is downgraded from "checked" to that same blind spot, silently.
//
// Pure, Node built-ins only.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const MANIFEST_NAME = '.coalmine-manifest.json';

export function hashFile(p) {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

// Walk each installed skill dir and hash every file. Keys are POSIX-style
// "<skill>/<relpath>" so the manifest is identical across OSes (determinism).
//
// DELIBERATELY UNGUARDED — a readdir or hash failure PROPAGATES, and the bare calls
// below are the fix, not an oversight. This walk WRITES its result into a persistent
// artifact, and `verifyAgainstManifest` never walks the disk: it iterates only the
// recorded keys. So a file this walk skipped is not merely missed once — it sits
// permanently OUTSIDE the integrity net, and later tamper on it reports `ok` with no
// trace at either end. The miss direction is a false "verified clean", the worst
// outcome an integrity check has.
//
// There is no legitimate-absence carve-out to preserve here, unlike the rule-home walk
// in consistency.mjs: every name reaching this function was JUST written successfully
// (install.mjs pushes onto `installed` only after installSkillDir returns), so an
// ENOENT means something raced or lied about the copy. Any failure is a failure.
//
// The caller closes the loop: writeManifest's existing catch turns the throw into the
// house `[warn] could not write install manifest: <reason>` + `process.exitCode = 1`,
// and NO manifest is written. That is the right outcome — a missing manifest makes
// verifyAgainstManifest report an honest SKIP, where a manifest with a silent hole
// would report a clean pass forever.
export function hashInstalledTree(destDir, skillNames) {
  const hashes = {};
  const walk = (abs, relParts) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const childAbs = path.join(abs, e.name);
      const childRel = [...relParts, e.name];
      if (e.isDirectory()) walk(childAbs, childRel);
      else hashes[childRel.join('/')] = hashFile(childAbs);
    }
  };
  for (const s of skillNames) walk(path.join(destDir, s), [s]);
  return hashes;
}

// Re-hash the installed tree and compare to the manifest's recorded hashes.
// Returns { ok, findings[], checked } — findings carry { level, msg }.
export function verifyAgainstManifest(destDir) {
  const findings = [];
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(destDir, MANIFEST_NAME), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return { ok: true, findings: [{ level: 'SKIP', msg: 'no install manifest at target — integrity check skipped' }], checked: 0 };
  }
  const recorded = manifest && manifest.hashes;
  if (!recorded || typeof recorded !== 'object') {
    return { ok: true, findings: [{ level: 'SKIP', msg: 'manifest predates integrity hashes (reinstall to enable) — check skipped' }], checked: 0 };
  }
  let checked = 0;
  const destAbs = path.resolve(destDir);
  for (const [rel, want] of Object.entries(recorded)) {
    // rel is "<skill>/<posix relpath>" — never trust it to escape destDir.
    // Resolve and confirm containment rather than scanning for '..' segments:
    // a segment scan splits on '/' only, so a Windows-backslash key like
    // `..\..\evil` slips through and escapes. path.resolve handles both
    // separators, absolute, and drive-relative keys in one check.
    const p = path.resolve(destAbs, rel);
    const relCheck = path.relative(destAbs, p);
    if (relCheck === '' || relCheck === '..' || relCheck.startsWith('..' + path.sep) || path.isAbsolute(relCheck)) {
      findings.push({ level: 'FAIL', msg: `manifest entry '${rel}' resolves outside the target — ignored (path traversal)` });
      continue;
    }
    checked++;
    let got;
    try { got = hashFile(p); } catch {
      findings.push({ level: 'FAIL', msg: `installed file MISSING: ${rel}` });
      continue;
    }
    if (got !== want) findings.push({ level: 'FAIL', msg: `installed file TAMPERED (hash changed): ${rel}` });
  }
  return { ok: findings.every((f) => f.level !== 'FAIL'), findings, checked };
}
