// Marker-delimited shared regions inside standalone hook files.
//
// Hooks must stay copy-one-file portable (Phoenix #9), so they cannot require()
// a shared module — instead the duplicated plumbing lives once in hooks/_shared/
// and build-plugin syncs it into each file between marker lines. verify.mjs
// fails the gate when a region drifts from its partial.
//
// Marker shape (comment = '//' or '#'):
//   <comment> <coalmine-shared: NAME> ...optional note...
//   ...body (owned by the partial)...
//   <comment> </coalmine-shared: NAME>

export function findRegion(text, name, comment) {
  const open = `${comment} <coalmine-shared: ${name}>`;
  const close = `${comment} </coalmine-shared: ${name}>`;
  const a = text.indexOf(open);
  if (a === -1) return null;
  const bodyStart = text.indexOf('\n', a);
  const b = text.indexOf(close, a);
  if (bodyStart === -1 || b === -1 || b < bodyStart) return null;
  return { start: bodyStart + 1, end: b };
}

// Body between the marker lines (close-marker line excluded), or null if the
// markers are missing/malformed.
export function extractRegion(text, name, comment) {
  const r = findRegion(text, name, comment);
  return r ? text.slice(r.start, r.end) : null;
}

// Replace the region body with `body` (normalized to end with one newline).
// Returns the new text, or null if the markers are missing/malformed.
export function syncRegion(text, name, comment, body) {
  const r = findRegion(text, name, comment);
  if (r === null) return null;
  const want = body.endsWith('\n') ? body : body + '\n';
  return text.slice(0, r.start) + want + text.slice(r.end);
}

// Every synced region in the repo — build-plugin writes, verify checks.
// Paths are repo-relative.
export const REGION_TARGETS = [
  { file: 'hooks/rot-canary-touch.js', name: 'node-config', comment: '//', partial: 'hooks/_shared/node-config.js' },
  { file: 'hooks/rot-canary-stop.js', name: 'node-config', comment: '//', partial: 'hooks/_shared/node-config.js' },
  { file: 'hooks/coalmine-conductor.js', name: 'node-config', comment: '//', partial: 'hooks/_shared/node-config.js' },
  { file: 'alt/powershell/rot-canary-touch.ps1', name: 'ps-config', comment: '#', partial: 'hooks/_shared/ps-config.ps1' },
  { file: 'alt/powershell/rot-canary-stop.ps1', name: 'ps-config', comment: '#', partial: 'hooks/_shared/ps-config.ps1' },
];
