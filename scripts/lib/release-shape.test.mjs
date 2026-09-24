import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractChangelogEntry, buildReleaseTitle, buildReleaseBody, ChangelogShapeError } from './release-shape.mjs';

const CL = `# Changelog

## [3.20.0] - 2026-09-21

A project config written where the walk does not read it is now reported, not silently ignored.

### Added
- Line one.
- Line two.

### Fixed
-

## [3.19.0] - 2026-09-19

older entry.
`;

test('extractChangelogEntry: reads the top entry matching the tag, summary + sections split correctly', () => {
  const { version, date, summary, sectionsBody } = extractChangelogEntry(CL, '3.20.0');
  assert.equal(version, '3.20.0');
  assert.equal(date, '2026-09-21');
  assert.equal(summary, 'A project config written where the walk does not read it is now reported, not silently ignored.');
  assert.match(sectionsBody, /^### Added/);
  assert.match(sectionsBody, /### Fixed/);
  assert.doesNotMatch(sectionsBody, /3\.19\.0/, 'must not bleed into the next entry');
});

test('extractChangelogEntry: version mismatch (tag cut without updating CHANGELOG first) fails loud', () => {
  assert.throws(() => extractChangelogEntry(CL, '3.20.1'), (e) => e instanceof ChangelogShapeError && /pushed tag is v3\.20\.1/.test(e.message));
});

test('extractChangelogEntry: [Unreleased] top entry fails loud (RED before this rule existed)', () => {
  const cl = '## [Unreleased]\n\nsomething\n';
  assert.throws(() => extractChangelogEntry(cl, '1.0.0'), (e) => e instanceof ChangelogShapeError && /Unreleased/.test(e.message));
});

test('extractChangelogEntry: no version heading at all fails loud, not a crash', () => {
  assert.throws(() => extractChangelogEntry('# Changelog\n\nnothing here\n', '1.0.0'), ChangelogShapeError);
});

test('extractChangelogEntry: malformed heading (missing date) fails loud, names the offending line', () => {
  assert.throws(() => extractChangelogEntry('## [1.0.0]\n\nx\n', '1.0.0'), (e) => e instanceof ChangelogShapeError && e.message.includes('[1.0.0]'));
});

test('extractChangelogEntry: an entry with NO summary line (a bare "### " right after the heading) fails loud, RED before the summary rule -- this is the exact shape every pre-UMB-162 CHANGELOG entry has', () => {
  const cl = '## [1.0.0] - 2026-01-01\n\n### Added\n- x\n';
  assert.throws(() => extractChangelogEntry(cl, '1.0.0'), (e) => e instanceof ChangelogShapeError && /no one-line summary/.test(e.message));
});

test('extractChangelogEntry: an entry that is only a summary line, no Keep-a-Changelog sections at all, is legal (sectionsBody empty)', () => {
  const cl = '## [1.0.0] - 2026-01-01\n\nOne small fix, nothing else.\n';
  const { summary, sectionsBody } = extractChangelogEntry(cl, '1.0.0');
  assert.equal(summary, 'One small fix, nothing else.');
  assert.equal(sectionsBody, '');
});

test('extractChangelogEntry: an entirely empty entry fails loud', () => {
  const cl = '## [1.0.0] - 2026-01-01\n\n## [0.9.0] - 2025-12-01\n\nsomething\n';
  assert.throws(() => extractChangelogEntry(cl, '1.0.0'), (e) => e instanceof ChangelogShapeError && /entry is empty/.test(e.message));
});

test('buildReleaseTitle: bare version, spaced hyphen, first letter lower-cased, trailing period dropped', () => {
  assert.equal(buildReleaseTitle('3.20.0', 'A project config written where the walk does not read it is now reported.'), 'v3.20.0 - a project config written where the walk does not read it is now reported');
});

test('buildReleaseTitle: an acronym/identifier-leading summary is left alone (no lower-casing SHA256SUMS-style openers)', () => {
  assert.equal(buildReleaseTitle('1.0.0', 'SHA256SUMS.txt now ships beside every ZIP'), 'v1.0.0 - SHA256SUMS.txt now ships beside every ZIP');
});

test('buildReleaseTitle: a single-letter opening word (an article/pronoun, not an identifier) still lower-cases', () => {
  assert.equal(buildReleaseTitle('1.0.0', 'A fix'), 'v1.0.0 - a fix');
  assert.equal(buildReleaseTitle('1.0.0', 'I moved the file'), 'v1.0.0 - i moved the file');
});

test('buildReleaseBody: Lead + Keep-a-Changelog sections verbatim, blank line between', () => {
  const body = buildReleaseBody('Fixed the thing.', '### Fixed\n- The thing.');
  assert.equal(body, 'Fixed the thing.\n\n### Fixed\n- The thing.\n');
});

test('buildReleaseBody: no sections -- the Lead alone, still newline-terminated', () => {
  assert.equal(buildReleaseBody('Just a summary, nothing else.', ''), 'Just a summary, nothing else.\n');
});
