// 29ae: the install record. The installer writes or removes a skill folder only when this record (or a byte match, see
// install.mjs ownership) proves CoalMine installed it. The record lives under the user's home, in the tool's own namespace
// (Phoenix #10): `~/.claude/coal/coalmine/install-record.json`.
//
// Shape: { stateSchema: 1, targets: { "<realpath of the target>": { version, skills: { "<skill>": { "<rel/path>": "<sha256>" } } } } }
//
// Reads are bounded and contained; anything unusable reads as NO RECORD, never as a claim. A record written by a NEWER schema is
// never rewritten: it is reported as 'newer' and the caller leaves it alone (the rollback half of the state-schema law).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MAX_CONFIG_BYTES, MAX_DOC_BYTES, mkdirRepoParents, readRepoBytesBounded, readRepoFileBounded, writeRepoFile } from './repo-fs.mjs';

export const RECORD_SCHEMA = 1;
const BOM = String.fromCharCode(0xfeff);

export function recordDir(home = os.homedir()) { return path.join(home, '.claude', 'coal', 'coalmine'); }
export function recordFile(home = os.homedir()) { return path.join(recordDir(home), 'install-record.json'); }

const emptyRecord = () => ({ stateSchema: RECORD_SCHEMA, targets: {} });
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// { state: 'ok' | 'none' | 'newer', record } . 'none' covers a missing, unreadable or malformed file; 'newer' a schema above ours.
export function loadInstallRecord(home = os.homedir()) {
  const raw = readRepoFileBounded(recordFile(home), recordDir(home), MAX_CONFIG_BYTES);
  if (raw === null) return { state: 'none', record: emptyRecord() };
  let parsed;
  try { parsed = JSON.parse(raw.startsWith(BOM) ? raw.slice(1) : raw); } catch { return { state: 'none', record: emptyRecord() }; }
  if (!isPlainObject(parsed)) return { state: 'none', record: emptyRecord() };
  if (typeof parsed.stateSchema === 'number' && parsed.stateSchema > RECORD_SCHEMA) return { state: 'newer', record: emptyRecord() };
  if (parsed.stateSchema !== RECORD_SCHEMA || !isPlainObject(parsed.targets)) return { state: 'none', record: emptyRecord() };
  return { state: 'ok', record: parsed };
}

// Writes the record in one contained step (temp file opened exclusively, then rename; a link at any folder or the file is refused).
// Throws on failure: the caller warns and sets the exit code, never crashes the install.
export function saveInstallRecord(home, record) {
  const dir = recordDir(home);
  mkdirRepoParents(dir, home);
  writeRepoFile(recordFile(home), JSON.stringify(record, null, 2) + '\n', dir);
}

// The sha256 of every file under `dir`, keyed by its path inside `dir` with forward slashes. null when anything under it is a link,
// a non-file, an empty sub-folder, a file over MAX_DOC_BYTES, or cannot be read: a folder with any of those is proven by nothing.
export function folderHashes(dir) {
  // 29am (T-29al-7): a null prototype, so a file named __proto__ is an own key and is hashed like any other (the JSON shape on disk is unchanged).
  const out = Object.create(null);
  const fail = () => { throw new Error('refused'); };
  const walk = (abs, rel) => {
    const entries = fs.readdirSync(abs);
    if (entries.length === 0 && rel !== '') fail();
    for (const name of entries) {
      const child = path.join(abs, name);
      const key = rel === '' ? name : `${rel}/${name}`;
      const st = fs.lstatSync(child);
      if (st.isSymbolicLink()) fail();
      if (st.isDirectory()) { walk(child, key); continue; }
      if (!st.isFile()) fail();
      const bytes = readRepoBytesBounded(child, dir, MAX_DOC_BYTES);
      if (bytes === null) fail();
      out[key] = createHash('sha256').update(bytes).digest('hex');
    }
  };
  try { walk(dir, ''); return out; } catch { return null; }
}

// Two hash maps name exactly the same files with exactly the same hashes.
export function sameHashes(a, b) {
  if (!a || !b) return false;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}
