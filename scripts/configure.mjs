// CoalMine configurator — edit .coalmine.json from the command line.
// Flags, parsing, validation, and help all come from one table
// (scripts/lib/config-schema.mjs, shared with verify.mjs): a key added there
// is automatically settable, validated, and documented here.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CONFIG_SCHEMA, validateValue } from './lib/config-schema.mjs';
import { stripJsonc } from './lib/jsonc.mjs';
import { projectConfigPath, ownDirDefault } from './lib/config-paths.mjs';

// The three per-agent-dir shapes were added by the namespace campaign
// (#69+#39, owner-designated 2026-08-08) alongside the LEGACY dotfile: a
// project configured ONLY through the new shape (no `.git` present) would
// otherwise match nothing and fall through to the raw `startDir` fallback —
// the same per-subdir-scatter class hooks/_shared/node-config.js's own
// widened findGitRoot exists to close (this file keeps its own local copy,
// consistent with the existing split between the two — a CJS hook cannot
// import this ESM script's lib, so the logic is duplicated, not shared).
// Additive-only: each new marker can only make the walk stop LOWER/narrower,
// `.git` is checked first and still wins wherever it is present.
const ROOT_MARKERS = [
  '.git',
  '.claude/coal/coalmine.json', '.agents/coal/coalmine.json', '.gemini/coal/coalmine.json',
  '.coalmine.json',
];

function findGitRoot(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (ROOT_MARKERS.some((m) => fs.existsSync(path.join(dir, m)))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return startDir;
}

function printHelp() {
  const lines = [
    'CoalMine Configurator Utility',
    'Usage: node scripts/configure.mjs [options]',
    '',
    'Options:',
  ];
  for (const spec of CONFIG_SCHEMA) {
    const flags = [`--${spec.key}`, ...(spec.flags || [])].join(', ');
    lines.push(`  ${flags.padEnd(48)} ${spec.help}`);
  }
  lines.push(`  ${'--global'.padEnd(48)} Write ~/.claude/.coalmine.json (the global layer) instead of the project config`);
  lines.push(`  ${'--help, -h'.padEnd(48)} Show this help message`);
  lines.push('');
  lines.push('Examples:');
  lines.push('  node scripts/configure.mjs --language th --file-cap 15');
  lines.push('  node scripts/configure.mjs --disable rot-canary,drift-canary');
  lines.push('  node scripts/configure.mjs --global --default-tier light');
  console.log(lines.join('\n'));
}

// Parse one raw CLI value against a spec. Returns { value } or { error }.
function parseValue(spec, raw) {
  switch (spec.type) {
    case 'bool': {
      if (raw !== 'true' && raw !== 'false') {
        return { error: `${spec.key} needs true or false` };
      }
      return { value: raw === 'true' };
    }
    case 'int': {
      // Number() (not parseInt) so a float like "5.9" or a garbage tail like "50abc"
      // is rejected outright rather than silently truncated to 5/50. validateValue
      // then enforces the integer + min/max contract — the SAME check verify.mjs runs
      // on the JSON value, so the CLI parser and the JSON validator cannot drift apart
      // (parseValue used to honor spec.min but not spec.max — a write of 1001 vs max 1000).
      const n = Number(raw);
      const err = validateValue(spec, n);
      if (err) return { error: `${spec.key} ${err}` };
      return { value: n };
    }
    case 'enum': {
      const v = (raw || '').toLowerCase();
      if (!spec.values.includes(v)) {
        return { error: `${spec.key} must be one of: ${spec.values.join(', ')}` };
      }
      if (spec.titleCase && v !== 'auto') {
        return { value: v.charAt(0).toUpperCase() + v.slice(1) };
      }
      return { value: v };
    }
    case 'strArr': {
      if (raw === undefined) {
        return { error: `${spec.key} needs a comma-separated value (pass "" to clear the list)` };
      }
      if (raw === '' || raw === '""') return { value: [] };
      let items = raw.split(',').map((s) => s.trim()).filter(Boolean);
      if (spec.lower) items = items.map((s) => s.toLowerCase());
      return { value: items };
    }
    default:
      return { error: `internal: unknown spec type '${spec.type}'` };
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exitCode = 0;
    return;
  }

  // --global targets the global layer (~/.claude/.coalmine.json); default targets
  // the project config. Hooks merge the two per key, project wins.
  //
  // Per-project READ follows projectConfigPath's rail (namespace campaign
  // #69+#39, owner-designated 2026-08-08 — see lib/config-paths.mjs for the
  // full precedence): own-dir -> other known agent dirs -> LEGACY root
  // dotfile. WRITE goes back to wherever the config was found, EXCEPT a
  // config found at the LEGACY location migrates on this write (INSPECT
  // MEDIUM 2, 2026-08-08: to ownDirDefault, the first agent dir the project
  // ALREADY HAS on disk, never a bare `.claude` — a project that only uses
  // `.agents`/`.gemini` must not get a foreign `.claude/` planted into it) —
  // move-on-CONFIG-WRITE-only (Phoenix #5, a hook never performs this move on
  // a mere read; configure.mjs is a CLI script the user/agent explicitly
  // runs). A config found at another new-shape candidate (e.g.
  // `.agents/coal/coalmine.json`) is NOT force-migrated between agent dirs —
  // it is written back where it already lives.
  const globalIdx = args.indexOf('--global');
  const isGlobal = globalIdx !== -1;
  if (isGlobal) args.splice(globalIdx, 1);
  const projectRoot = findGitRoot(process.cwd());
  const legacyPath = path.join(projectRoot, '.coalmine.json');
  const readPath = isGlobal
    ? path.join(os.homedir(), '.claude', '.coalmine.json')
    : projectConfigPath(projectRoot);
  const writePath = isGlobal
    ? readPath
    : (readPath === legacyPath ? ownDirDefault(projectRoot) : readPath);

  let cfg = {};
  let hadComments = false;
  // Read once via try/catch (no existsSync precheck) so there is no check-to-use gap.
  let rawConfig = null;
  try { rawConfig = fs.readFileSync(readPath, 'utf8').replace(/^\uFEFF/, ''); } catch {}
  if (rawConfig !== null) {
    try {
      const content = rawConfig;
      hadComments = content.includes('//');
      const cleanJson = stripJsonc(content);
      cfg = JSON.parse(cleanJson) || {};
      // Migrate legacy/retired keys to their current forms.
      if (cfg.conductor !== undefined) {
        cfg.enableConductor = cfg.enableConductor ?? cfg.conductor;
        delete cfg.conductor;
      }
      if (cfg.disable !== undefined) {
        cfg.disabledCanaries = cfg.disabledCanaries ?? cfg.disable;
        delete cfg.disable;
      }
      if (cfg.mode !== undefined) {
        cfg.rotCanaryMode = cfg.rotCanaryMode ?? cfg.mode;
        delete cfg.mode;
      }
      if (cfg.antivirusStalenessDays !== undefined) {
        cfg.ruleRevalidateDays = cfg.ruleRevalidateDays ?? cfg.antivirusStalenessDays;
        delete cfg.antivirusStalenessDays;
      }
      if (cfg.tempSweepProbability !== undefined) {
        delete cfg.tempSweepProbability; // retired: the sweep is deterministically throttled (24h marker), per Phoenix #8
      }
      if (cfg.branchPrefix !== undefined) {
        delete cfg.branchPrefix;
      }
      if (cfg.pullRequestRemote !== undefined) {
        delete cfg.pullRequestRemote;
      }
    } catch (e) {
      // Fail loud (scripts-quality §1): a malformed config we silently overwrite is a
      // partial failure the user must notice — flag the non-zero exit even though the
      // run continues from defaults (the old config is backed up where possible).
      process.exitCode = 1;
      try {
        fs.copyFileSync(readPath, readPath + '.bak');
        console.warn(`Warning: existing config is malformed — backed it up to ${readPath}.bak and rebuilding.`);
      } catch {
        console.warn('Warning: existing config is malformed. Overwriting.');
      }
    }
  }

  // Flag lookup: --<key> plus every alias in the table.
  const flagMap = new Map();
  for (const spec of CONFIG_SCHEMA) {
    flagMap.set(`--${spec.key}`, spec);
    for (const f of spec.flags || []) flagMap.set(f, spec);
  }

  for (let i = 0; i < args.length; i++) {
    const spec = flagMap.get(args[i]);
    if (!spec) {
      console.error(`Error: Unrecognized option '${args[i]}'`);
      printHelp();
      process.exitCode = 1;
      return;
    }
    const parsed = parseValue(spec, args[++i]);
    if (parsed.error) {
      console.error(`Error: ${parsed.error}`);
      process.exitCode = 1;
      return;
    }
    cfg[spec.key] = parsed.value;
  }

  try {
    fs.mkdirSync(path.dirname(writePath), { recursive: true });
    fs.writeFileSync(writePath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    // Move-on-CONFIG-WRITE-only (no-old-version-leftover): the legacy root
    // file is removed only AFTER the new-home write above succeeded, and only
    // when this write actually migrated it (readPath was the legacy file and
    // writePath moved away from it). Best-effort — a failed delete here still
    // leaves a correctly-written new config; the stray legacy file is simply
    // not cleaned up this run.
    if (readPath === legacyPath && writePath !== legacyPath) {
      try { fs.rmSync(legacyPath, { force: true }); } catch {}
      console.log(`Migrated the project config from ${legacyPath} to ${writePath}.`);
    }
    if (hadComments) {
      console.warn('Note: inline comments were stripped (this tool writes plain JSON). Every key stays documented in platform-configs/.coalmine.json.');
    }
    console.log(`Successfully updated configuration in: ${writePath}`);
    console.log(JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error(`Error: Failed to write to config file: ${e.message}`);
    process.exitCode = 1;
    return;
  }
}

main();
