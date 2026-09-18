// Single source of truth for every .coalmine.json key.
// verify.mjs validates against it; configure.mjs builds its CLI flags, parsing,
// and help text from it — a key added here is automatically validated,
// settable, and documented, so the two scripts can never drift apart.
//
// Spec fields:
//   key       canonical .coalmine.json key
//   type      'bool' | 'int' | 'enum' | 'strArr'
//   min       optional lower bound for 'int' (inclusive)
//   values    allowed values for 'enum' (compared case-insensitively)
//   titleCase store enum Title-Cased (defaultTier: Light/Standard/Heavy; 'auto' stays lowercase)
//   lower     lowercase each 'strArr' item on write
//   flags     extra CLI aliases besides --<key> (legacy names included)
//   help      one-line description for --help

export const CONFIG_SCHEMA = [
  { key: 'language', type: 'enum', values: ['auto', 'th', 'en', 'ja', 'zh', 'es'], flags: ['-l'], help: 'Language override for prompts and nudges (auto, th, en, ja, zh, es)' },
  { key: 'enableConductor', type: 'bool', flags: ['-d', '--conductor'], help: 'Enable/disable conductor rules injection at session start' },
  { key: 'skipOnboarding', type: 'bool', flags: ['-o'], help: 'Skip the gold-standard onboarding offer at session start' },
  { key: 'defaultTier', type: 'enum', values: ['light', 'standard', 'heavy', 'auto'], titleCase: true, flags: ['-t'], help: 'Force an execution tier (Light, Standard, Heavy, auto)' },
  { key: 'autoScanFileCap', type: 'int', min: 1, max: 1000, flags: ['-c', '--file-cap'], help: 'Max touched files scanned automatically at session end (default: 10)' },
  { key: 'autoScanFileCapSlice', type: 'int', min: 1, max: 1000, flags: ['-y'], help: 'Number of most-recently-modified files kept (a file count, not a fraction) when autoScanFileCap is exceeded (default: 5)' },
  { key: 'tripwireMaxFileSizeKb', type: 'int', min: 1, max: 102400, flags: ['-s', '--tripwire-cap'], help: 'Max file size in KB for the tripwire scan (default: 100)' },
  { key: 'tripwireMaxLines', type: 'int', min: 1, max: 100000, flags: ['-n'], help: 'Line count that flags a source file as a smell; test files and files declaring the over-run (top-of-file "ponytail:/waiver: <N> lines" comment) are exempt (default: 800)' },
  { key: 'tempSweepStaleDays', type: 'int', min: 1, max: 3650, flags: ['-w'], help: 'Age in days before session temp files are swept (default: 7)' },
  { key: 'watchedExtensions', type: 'strArr', lower: true, flags: ['-e'], help: 'Comma-separated file extensions the touch hook watches (empty = defaults)' },
  { key: 'scanExcludePaths', type: 'strArr', flags: ['--scan-exclude'], help: 'Comma-separated path fragments/globs (* wildcard, / separator on every OS) skipped by the session-end auto-scan — for throwaway lab tooling only (scratch probes, one-shot harnesses); shipped/tracked source is never excluded by this key (default: [])' },
  { key: 'scanEverything', type: 'bool', flags: ['--scan-everything'], help: 'Bypass EVERY scan-scope cut for the run — scanExcludePaths ignored, autoScanFileCap not applied (default: off). Positive polarity: true = more scanning. Does NOT re-enable a disabled canary, and does not reach the recording-side cuts (watchedExtensions, tmpdir) — those decide what is recorded, before a scan-time key can be read — nor the tripwireMaxFileSizeKb pre-flag cap' },
  { key: 'ruleRevalidateDays', type: 'int', min: 1, max: 3650, flags: ['-v', '--antivirusStalenessDays'], help: 'Days before general rules need re-validation (default: 90)' },
  { key: 'platformRuleRevalidateDays', type: 'int', min: 1, max: 3650, flags: ['-g'], help: 'Days before platform/model rules need re-validation (default: 30)' },
  { key: 'definitionRevalidateDays', type: 'int', min: 1, max: 3650, flags: ['-j'], help: 'Days before general reference definitions are stale (default: 90)' },
  { key: 'platformDefinitionRevalidateDays', type: 'int', min: 1, max: 3650, flags: ['-k'], help: 'Days before platform definitions are stale (default: 30)' },
  { key: 'disabledCanaries', type: 'strArr', lower: true, flags: ['-x', '--disable'], help: 'Comma-separated canaries to disable (or "all")' },
  { key: 'rotCanaryMode', type: 'enum', values: ['auto', 'manual', 'off'], flags: ['-m', '--mode'], help: 'rot-canary auto-scan mode (auto, manual, off)' },
  { key: 'memoryDriftNudge', type: 'bool', flags: ['--memory-drift-nudge'], help: 'Session-end advisory when code changed this session but no MEMORY.md was updated (default: on; quiet model-only note, not part of the scan report, never blocks)' },
  { key: 'autoFixMode', type: 'enum', values: ['interactive', 'safe', 'off'], flags: ['-f'], help: 'Default fix-mode behavior (interactive, safe, off; default: interactive)' },
  { key: 'updateMode', type: 'enum', values: ['ask', 'auto', 'remind', 'off'], flags: ['-u', '--update-mode'], help: 'Self-update behavior at session start (ask, auto, remind, off; default: ask)' },
  { key: 'updateCheckDays', type: 'int', min: 1, max: 365, flags: ['-p', '--update-days'], help: 'Days between self-update checks/reminders (default: 14)' },
  { key: 'schemaPaths', type: 'strArr', flags: ['--schemas'], help: 'Comma-separated glob paths to schemas/API specs' },
  { key: 'migrationDirs', type: 'strArr', flags: ['--migrations'], help: 'Comma-separated database migration directories' },
  { key: 'packageManifests', type: 'strArr', flags: ['--manifests'], help: 'Comma-separated package manifest / lockfile paths' },
  { key: 'trustedDomains', type: 'strArr', flags: ['--domains'], help: 'Comma-separated extra trusted domains for source grounding' },
];

// Validate an already-parsed JSON value against a spec.
// Returns an error message fragment ("must be ...") or null when valid.
export function validateValue(spec, v) {
  switch (spec.type) {
    case 'bool':
      return typeof v === 'boolean' ? null : 'must be a boolean';
    case 'int':
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'must be a finite number';
      if (!Number.isInteger(v)) return 'must be an integer';
      if (spec.min != null && v < spec.min) return `must be >= ${spec.min}`;
      if (spec.max != null && v > spec.max) return `must be <= ${spec.max}`;
      return null;
    case 'enum':
      return typeof v === 'string' && spec.values.includes(v.toLowerCase())
        ? null
        : `must be one of: ${spec.values.join(', ')}`;
    case 'strArr':
      return Array.isArray(v) && v.every((x) => typeof x === 'string')
        ? null
        : 'must be an array of strings';
    default:
      return `has an unknown spec type '${spec.type}'`;
  }
}
