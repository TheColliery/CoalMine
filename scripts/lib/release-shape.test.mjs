import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractChangelogEntry, buildReleaseTitle, buildReleaseBody, ChangelogShapeError, makeLatestFlag, ReleaseRefError } from './release-shape.mjs';

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

// 14h (item 14, courier 10; CoalLedger PR #20 #8): the standard `## [Unreleased]` heading carries no date, so it used to throw from the DATE check, whose message merely quotes the heading;
// the test matched /Unreleased/, which that message holds, so it stayed green with the [Unreleased] branch deleted. The test now holds the branch's own message, for the standard and the dated heading.
test('extractChangelogEntry: [Unreleased] top entry fails loud with the rule\'s own message, dated or not -- RED before 14h (10 #8)', () => {
  for (const heading of ['## [Unreleased]', '## [unreleased]', '## [Unreleased] - 2026-10-14', '##[Unreleased]']) {
    const cl = `${heading}\n\nsomething\n`;
    assert.throws(() => extractChangelogEntry(cl, '1.0.0'), (e) => e instanceof ChangelogShapeError && /top entry is still \[Unreleased\] -- the CHANGELOG entry is written and finalized BEFORE the tag/.test(e.message), heading);
  }
  // control: a top heading that is neither Unreleased nor dated keeps the date message
  assert.throws(() => extractChangelogEntry('## [1.0.0]\n\nsomething\n', '1.0.0'), (e) => e instanceof ChangelogShapeError && /is not "## \[X\.Y\.Z\] - YYYY-MM-DD"/.test(e.message));
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

// UMB-182 / courier C-2: the byte re-read proves GitHub stored what was derived, never that what was derived was
// right. CoalFace's live exhibit: the doc-writer REPLACED the [0.11.0] heading instead of inserting above it, so
// [0.12.0] swallowed v0.11.0's sections. The derive path now checks the entry is followed by the previous stable tag.
const REPLACED = `## [0.12.0] - 2026-09-23

The sole-creator workflow.

### Added
- 0.11.0's own line, now published twice.

## [0.10.0] - 2026-09-10

older.
`;

test('extractChangelogEntry (C-2): the released entry followed by the previous stable tag heading passes', () => {
  const e = extractChangelogEntry(CL, '3.20.0', { previousStable: '3.19.0' });
  assert.equal(e.version, '3.20.0');
});

test('extractChangelogEntry (C-2): a replaced heading (next stable heading is NOT the previous stable tag) throws -- RED before the check', () => {
  assert.throws(() => extractChangelogEntry(REPLACED, '0.12.0', { previousStable: '0.11.0' }), (err) => err instanceof ChangelogShapeError && /\[0\.10\.0\].*v0\.11\.0|v0\.11\.0.*\[0\.10\.0\]/.test(err.message));
});

test('extractChangelogEntry (C-2): pre-release headings between the entry and the previous stable one are skipped, not compared', () => {
  const text = '## [1.0.0] - 2026-09-25\n\nFirst stable.\n\n## [1.0.0-rc.1] - 2026-09-20\n\nrc.\n\n## [0.9.0] - 2026-09-01\n\nold.\n';
  assert.equal(extractChangelogEntry(text, '1.0.0', { previousStable: '0.9.0' }).version, '1.0.0');
});

test('extractChangelogEntry (C-2): a previous stable tag with no heading after the entry throws', () => {
  const text = '## [1.1.0] - 2026-09-25\n\nOnly entry.\n';
  assert.throws(() => extractChangelogEntry(text, '1.1.0', { previousStable: '1.0.0' }), ChangelogShapeError);
});

test('extractChangelogEntry (C-2): no previous stable tag (a first stable release) skips the check', () => {
  assert.equal(extractChangelogEntry(REPLACED, '0.12.0').version, '0.12.0');
  assert.equal(extractChangelogEntry(REPLACED, '0.12.0', { previousStable: '' }).version, '0.12.0');
});

// UMB-182 default-Latest: a Release created with no --latest takes Latest (measured on CoalFace's rehearsal,
// v0.0.2 over v0.11.0). A backfill for an OLD tag must pass make_latest false (UMB-189).
test('makeLatestFlag: no current Latest, or a tag newer than or equal to it, is "true"; an older tag is "false" -- RED before the rule', () => {
  assert.equal(makeLatestFlag('1.0.0', ''), 'true');
  assert.equal(makeLatestFlag('1.2.0', 'v1.1.9'), 'true');
  assert.equal(makeLatestFlag('1.1.9', 'v1.1.9'), 'true');
  assert.equal(makeLatestFlag('1.1.8', 'v1.1.9'), 'false');
  assert.equal(makeLatestFlag('1.10.0', 'v1.9.0'), 'true', 'numeric compare, never string order');
  assert.equal(makeLatestFlag('0.9.9', 'v1.0.0'), 'false');
});

test('makeLatestFlag: a Latest tag that is not a bare vX.Y.Z throws a named error -- never a guessed flag', () => {
  assert.throws(() => makeLatestFlag('1.0.0', 'nightly'), ReleaseRefError);
});

// UMB-392 / BA-14 (the owner: fix it at the source of the river): the Release title is derived from the CHANGELOG summary line, so the
// length bound lives there. A SIGNAL with a band, never a hard cap: aim 60 characters, 45 to 75 passes clean, outside the band a named
// warning. The numbers are the house's own (no formal standard sets one), declared in RELEASE-PATTERN.md.
import { SUMMARY_AIM, SUMMARY_BAND, titleBandWarning, MIRROR_TITLE_CAP, mirroredTitle, mirroredTitleOverflow } from './release-shape.mjs';

const titleOf = (n) => `v1.2.3 - ${'a'.repeat(n)}`;

test('the summary band: aim 60, clean from 45 to 75', () => {
  assert.equal(SUMMARY_AIM, 60);
  assert.deepEqual(SUMMARY_BAND, [45, 75]);
});

test('titleBandWarning: 60, 45 and 75 pass clean; 44 and 76 warn, naming the length, the band and the way out; nothing refuses', () => {
  for (const n of [60, 45, 75]) assert.equal(titleBandWarning(titleOf(n)), null, String(n));
  for (const n of [44, 76, 140, 1]) {
    const w = titleBandWarning(titleOf(n));
    assert.ok(w.startsWith(`release-title-band: the summary in the title is ${n} characters, outside the band 45 to 75 (aim 60)`), String(n));
    assert.match(w, /lead paragraph/, 'it says where a longer explanation goes');
  }
});

test('titleBandWarning counts characters, not UTF-16 units, and reads only the part after the first " - "', () => {
  assert.equal(titleBandWarning('v1.0.0 - ' + '\u{1F600}'.repeat(60)), null, '60 astral characters are 60 characters');
  assert.equal(titleBandWarning('v1.0.0 - ' + 'a'.repeat(30) + ' - ' + 'b'.repeat(30)), null, 'a hyphen inside the summary does not split it');
  assert.equal(titleBandWarning('v1.0.0'), null, 'a title with no summary has nothing to measure (the shape rail owns that)');
});

// The lead paragraph under the summary line: text between the summary and the first "### " heading rides into the body right after the
// Lead (it used to be dropped, so a longer explanation had nowhere to go).
test('extractChangelogEntry: the text between the summary line and the first "### " heading is the lead paragraph', () => {
  const e = extractChangelogEntry('## [1.2.3] - 2026-10-03\n\nShort summary.\n\nA longer explanation that\nspans two lines.\n\n### Fixed\n- x\n', '1.2.3');
  assert.equal(e.summary, 'Short summary.');
  assert.equal(e.lead, 'A longer explanation that\nspans two lines.');
  assert.equal(e.sectionsBody, '### Fixed\n- x');
  assert.equal(extractChangelogEntry('## [1.2.3] - 2026-10-03\n\nShort summary.\n\n### Fixed\n- x\n', '1.2.3').lead, '');
  assert.equal(extractChangelogEntry('## [1.2.3] - 2026-10-03\n\nShort summary.\n', '1.2.3').lead, '');
});

test('buildReleaseBody: Lead, then the lead paragraph, then the sections, a blank line between each; without a lead paragraph the body is unchanged', () => {
  assert.equal(buildReleaseBody('Short.', '### Fixed\n- x', 'More words.'), 'Short.\n\nMore words.\n\n### Fixed\n- x\n');
  assert.equal(buildReleaseBody('Short.', '', 'More words.'), 'Short.\n\nMore words.\n');
  assert.equal(buildReleaseBody('Short.', '### Fixed\n- x', ''), 'Short.\n\n### Fixed\n- x\n');
  assert.equal(buildReleaseBody('Short.', '### Fixed\n- x'), 'Short.\n\n### Fixed\n- x\n');
});

// UMB-417 (the CoalFace room's INSPECT, M-A): a first word with an INTERIOR capital is a product or identifier name, never an
// ordinary sentence opener, so it keeps its case. "CoalFace ..." used to become "coalFace ..." in the Release title.
test('buildReleaseTitle: a CamelCase first word keeps its case (the product name), the cases the comment names are unchanged -- RED before UMB-417', () => {
  assert.equal(buildReleaseTitle('0.14.0', 'CoalFace now reads its config from both legacy paths'), 'v0.14.0 - CoalFace now reads its config from both legacy paths');
  assert.equal(buildReleaseTitle('0.14.0', "CoalFace's config walk names the file it read."), "v0.14.0 - CoalFace's config walk names the file it read");
  assert.equal(buildReleaseTitle('2.0.0', 'CoalBoard, CoalTipple and CoalHearth share one config walk'), 'v2.0.0 - CoalBoard, CoalTipple and CoalHearth share one config walk');
  assert.equal(buildReleaseTitle('1.0.0', 'McKinsey-style review now ships'), 'v1.0.0 - McKinsey-style review now ships');
  // unchanged: an acronym or file name, an article, a pronoun, an ordinary word with later capitals in other words
  assert.equal(buildReleaseTitle('1.0.0', 'SHA256SUMS.txt now ships beside every ZIP'), 'v1.0.0 - SHA256SUMS.txt now ships beside every ZIP');
  assert.equal(buildReleaseTitle('1.0.0', 'CI now runs on macOS'), 'v1.0.0 - CI now runs on macOS');
  assert.equal(buildReleaseTitle('1.0.0', 'A fix'), 'v1.0.0 - a fix');
  assert.equal(buildReleaseTitle('1.0.0', 'I moved the file'), 'v1.0.0 - i moved the file');
  assert.equal(buildReleaseTitle('1.0.0', 'Fixed the CoalFace config walk'), 'v1.0.0 - fixed the CoalFace config walk', 'only the first word decides');
  assert.equal(buildReleaseTitle('1.0.0', 'A project config is now reported'), 'v1.0.0 - a project config is now reported');
});

// A-2 (pass 14): only a first word made of ONE capital followed by lower-case letters is an ordinary sentence opener and lower-cases;
// every other opener is left as written ("V8 flags", "Node.js 22", "CoalFace", "SHA256SUMS.txt", "CI", "Python3").
test('buildReleaseTitle: V8, Node.js and every other non-ordinary opener keeps its case; only One-capital-then-lowercase lowers -- RED before the pass 14 fix', () => {
  const t = (s) => buildReleaseTitle('1.0.0', s);
  assert.equal(t('V8 flags are now documented'), 'v1.0.0 - V8 flags are now documented');
  assert.equal(t('Node.js 22 is now the floor'), 'v1.0.0 - Node.js 22 is now the floor');
  assert.equal(t('Python3 hooks now run'), 'v1.0.0 - Python3 hooks now run');
  assert.equal(t('CoalFace reads both paths'), 'v1.0.0 - CoalFace reads both paths');
  assert.equal(t('SHA256SUMS.txt now ships'), 'v1.0.0 - SHA256SUMS.txt now ships');
  assert.equal(t('CI now runs on macOS'), 'v1.0.0 - CI now runs on macOS');
  // ordinary openers still lower, with punctuation, a contraction or a hyphenated compound
  assert.equal(t('Fixed the thing'), 'v1.0.0 - fixed the thing');
  assert.equal(t('Fixed, then shipped'), 'v1.0.0 - fixed, then shipped');
  assert.equal(t("It's fixed now"), "v1.0.0 - it's fixed now");
  assert.equal(t('Two-phase commit now ships'), 'v1.0.0 - two-phase commit now ships');
  assert.equal(t('A fix'), 'v1.0.0 - a fix');
  assert.equal(t('I moved the file'), 'v1.0.0 - i moved the file');
});

// UMB-433 (the owner on org discussion #23: "if it really overflows, re-compose it, never leave the text off"): the org announcement mirrors
// "<Repo> <Release title>" as a discussion title, and GitHub's title ceiling is a hard 200 (it stored a 211-character title as 199, n = 1).
// A title that fits posts whole; a real overflow is never cut by a machine and never posted bare, so the DRAFTER re-composes the summary
// BEFORE the tag. One definition of the mirrored title and its ceiling, here, used by the announcer and by the pre-tag check.
test('mirroredTitle: "<Repo> <Release title>" when the title opens with its tag, else "<Repo> <tag> - <name>", else "<Repo> <tag>"', () => {
  assert.equal(MIRROR_TITLE_CAP, 200);
  assert.equal(mirroredTitle('CoalBoard', 'v2.7.0', 'v2.7.0 - a summary'), 'CoalBoard v2.7.0 - a summary');
  assert.equal(mirroredTitle('CoalBoard', 'v2.7.0', 'a hand-named release'), 'CoalBoard v2.7.0 - a hand-named release');
  assert.equal(mirroredTitle('CoalBoard', 'v2.7.0', ''), 'CoalBoard v2.7.0');
  assert.equal(mirroredTitle('CoalBoard', 'v2.7.0', '  v2.7.0 - padded  '), 'CoalBoard v2.7.0 - padded');
});

// UMB-456 (1) iv (CoalHearth t19 #2): a Release name that merely BEGINS with the tag's characters is not named by the tag. "v2.7.0" is a prefix of
// "v2.7.01" and of "v2.7.0-rc1", and the old startsWith test dropped the real tag from the announcement title.
test('mirroredTitle: the tag counts as the name\'s own prefix only at a boundary (end or whitespace) -- RED before UMB-456 (1) iv', () => {
  assert.equal(mirroredTitle('R', 'v2.7.0', 'v2.7.01 - x'), 'R v2.7.0 - v2.7.01 - x');
  assert.equal(mirroredTitle('R', 'v2.7.0', 'v2.7.0-rc1 - x'), 'R v2.7.0 - v2.7.0-rc1 - x');
  assert.equal(mirroredTitle('R', 'v2.7.0', 'v2.7.0'), 'R v2.7.0');
  assert.equal(mirroredTitle('R', 'v2.7.0', 'v2.7.0 - x'), 'R v2.7.0 - x');
  assert.equal(mirroredTitle('R', 'v2.7.0', 'v2.7.0\t- tabbed'), 'R v2.7.0\t- tabbed');
});

test('mirroredTitleOverflow: null at 200 characters and below, a named message at 201 and above; CoalBoard v2.7.0 (name 201) overflows -- RED before UMB-433', () => {
  const nameOf = (total) => 'v1.0.0 - ' + 'a'.repeat(total - 'CoalBoard '.length - 'v1.0.0 - '.length);
  assert.equal(mirroredTitle('CoalBoard', 'v1.0.0', nameOf(200)).length, 200);
  assert.equal(mirroredTitleOverflow('CoalBoard', 'v1.0.0', nameOf(200)), null);
  assert.equal(mirroredTitleOverflow('CoalBoard', 'v1.0.0', nameOf(150)), null);
  for (const n of [201, 211, 400]) {
    const m = mirroredTitleOverflow('CoalBoard', 'v1.0.0', nameOf(n));
    assert.match(m, new RegExp('^release-title-cap: the announcement title "CoalBoard v1\\.0\\.0 - a+" is ' + n + ' characters, over GitHub\'s ' + MIRROR_TITLE_CAP + '-character title ceiling'), String(n));
    assert.match(m, /re-compose|shorten/i, 'it says what to do');
  }
  assert.ok(mirroredTitleOverflow('CoalBoard', 'v2.7.0', 'v2.7.0 - ' + 'x'.repeat(192)) !== null, 'the real v2.7.0 shape (a 201-character Release name) overflows');
});

test('mirroredTitleOverflow counts UTF-16 units (the conservative count: an astral character may count twice at GitHub)', () => {
  const emoji = '\u{1F600}';
  const name = 'v1.0.0 - ' + emoji.repeat(100);
  assert.equal(Array.from(mirroredTitle('R', 'v1.0.0', name)).length < 200, true);
  assert.ok(mirroredTitleOverflow('R', 'v1.0.0', name) !== null, '100 emoji are 200 units: held, never risked');
});

test('extractChangelogEntry: a summary line carrying a control character is refused by name, never printed or posted -- RED before 2026-11-03a', () => {
  // Built from code points so no escape travels through a tool: ESC (C0), a lone CR (C0), DEL, and CSI (C1).
  for (const cp of [0x1b, 0x0d, 0x7f, 0x9b]) {
    const bad = String.fromCharCode(cp);
    const text = `# Changelog\n\n## [1.2.3] - 2026-11-03\n\nA summary with a ${bad}[31m hidden control.\n\n### Fixed\n- Thing.\n`;
    assert.throws(() => extractChangelogEntry(text, '1.2.3'), (e) => e instanceof ChangelogShapeError && /control character/.test(e.message) && !e.message.includes(bad), `code point ${cp} is refused, and the message never echoes it`);
  }
  // A tab is a C0 character too: refused the same way.
  assert.throws(() => extractChangelogEntry('## [1.2.3] - 2026-11-03\n\nA\tsummary.\n\n### Fixed\n- x.\n', '1.2.3'), ChangelogShapeError);
  // An ordinary summary (Thai and an em dash included) still passes.
  const ok = extractChangelogEntry('## [1.2.3] - 2026-11-03\n\nสรุป: a summary \u2014 fine.\n\n### Fixed\n- x.\n', '1.2.3');
  assert.equal(ok.summary, 'สรุป: a summary \u2014 fine.');
});

// UMB3-193 (2026-11-09): the multi-package form. A repository that ships more than one package on independent version lines tags each line
// `<pkg>-vX.Y.Z` and heads each entry `## [<pkg> X.Y.Z] - YYYY-MM-DD`; the title carries the package. The single-package form is unchanged.
const KOLWEN_SHAPED = '## [npm 0.0.2] - 2026-11-03\n\nThe npm package publishes its first client.\n\n### Added\n- n\n\n## [py 0.0.1] - 2026-11-02\n\nThe Python package publishes its first client.\n\n### Added\n- p\n\n## [npm 0.0.1] - 2026-11-01\n\nThe first npm shell.\n\n### Added\n- shell\n';

test('parseReleaseTag: a bare vX.Y.Z tag has no package; <pkg>-vX.Y.Z names its package; a pre-release label rides on either; every other shape is null -- RED before UMB3-193', async () => {
  const { parseReleaseTag } = await import('./release-shape.mjs');
  assert.deepEqual(parseReleaseTag('v1.2.3'), { pkg: '', version: '1.2.3', pre: '' });
  assert.deepEqual(parseReleaseTag('v1.2.3-beta.1'), { pkg: '', version: '1.2.3', pre: '-beta.1' });
  assert.deepEqual(parseReleaseTag('py-v0.0.1'), { pkg: 'py', version: '0.0.1', pre: '' });
  assert.deepEqual(parseReleaseTag('npm-v0.0.2'), { pkg: 'npm', version: '0.0.2', pre: '' });
  assert.deepEqual(parseReleaseTag('npm-v0.0.2-beta.1'), { pkg: 'npm', version: '0.0.2', pre: '-beta.1' });
  assert.deepEqual(parseReleaseTag('py2-v1.0.0'), { pkg: 'py2', version: '1.0.0', pre: '' });
  // the package name is lower-case letters and digits, opening with a letter: a hyphen inside it would read as the pre-release marker, a capital or a dot
  // would spell one package two ways between the tag and the heading
  for (const bad of ['Py-v0.0.1', 'my_pkg-v1.0.0', 'my-pkg-v1.0.0', 'py.ext-v1.0.0', '2py-v1.0.0', 'py-1.0.0', 'py--v1.0.0', 'py-v0.0.1.dev1', 'v1.2', 'release-v1', '', 'py-v1.0.0 ']) {
    assert.equal(parseReleaseTag(bad), null, JSON.stringify(bad));
  }
});

test('extractChangelogEntry with a package: the entry is the FIRST heading of that package, other packages\' entries above it are skipped, and the label is "<pkg> X.Y.Z" -- RED before UMB3-193', () => {
  const py = extractChangelogEntry(KOLWEN_SHAPED, '0.0.1', { pkg: 'py' });
  assert.equal(py.version, '0.0.1');
  assert.equal(py.summary, 'The Python package publishes its first client.');
  assert.match(py.sectionsBody, /^### Added\n- p$/);
  const npm = extractChangelogEntry(KOLWEN_SHAPED, '0.0.2', { pkg: 'npm' });
  assert.equal(npm.summary, 'The npm package publishes its first client.');
  assert.match(npm.sectionsBody, /^### Added\n- n$/, 'the entry ends at the next heading of ANY package');
});

test('extractChangelogEntry with a package: no heading of that package is refused by name; the single-package read of a multi-package CHANGELOG is refused as before (the top label is not the version) -- RED before UMB3-193', () => {
  assert.throws(() => extractChangelogEntry(KOLWEN_SHAPED, '1.0.0', { pkg: 'rs' }), /CHANGELOG\.md has no \[rs X\.Y\.Z\] heading \("## \[rs X\.Y\.Z\] - YYYY-MM-DD"\)/);
  assert.throws(() => extractChangelogEntry(KOLWEN_SHAPED, '0.0.2', { pkg: 'py' }), /first \[py\] entry is \[py 0\.0\.1\] but the pushed tag is py-v0\.0\.2/);
  assert.throws(() => extractChangelogEntry(KOLWEN_SHAPED, '0.0.2'), /top entry is \[npm 0\.0\.2\] but the pushed tag is v0\.0\.2/);
  assert.throws(() => extractChangelogEntry('## [py Unreleased] - 2026-11-02\n\nx\n', '0.0.1', { pkg: 'py' }), /\[Unreleased\]/);
});

test('extractChangelogEntry with a package (C-2): the previous stable tag is matched against the next stable heading of the SAME package; another package\'s headings in between are skipped -- RED before UMB3-193', () => {
  assert.doesNotThrow(() => extractChangelogEntry(KOLWEN_SHAPED, '0.0.2', { pkg: 'npm', previousStable: '0.0.1' }));
  assert.throws(() => extractChangelogEntry(KOLWEN_SHAPED, '0.0.2', { pkg: 'npm', previousStable: '0.0.0' }), /followed by \[npm 0\.0\.1\], but the previous stable tag is npm-v0\.0\.0/);
  assert.throws(() => extractChangelogEntry(KOLWEN_SHAPED, '0.0.1', { pkg: 'py', previousStable: '0.0.0' }), /followed by no stable heading, but the previous stable tag is py-v0\.0\.0/);
});

test('buildReleaseTitle with a package: "<pkg> vX.Y.Z - <summary>"; without one the title is unchanged -- RED before UMB3-193', () => {
  assert.equal(buildReleaseTitle('0.0.1', 'The Python package publishes its first client.', 'py'), 'py v0.0.1 - the Python package publishes its first client');
  assert.equal(buildReleaseTitle('0.0.1', 'A fix.'), 'v0.0.1 - a fix');
  assert.equal(buildReleaseTitle('0.0.1', 'A fix.', ''), 'v0.0.1 - a fix');
});

test('makeLatestFlag with a package: Latest moves only within the package line; a Latest on another line is left standing ("false"); a Latest that is no tag of the form still throws -- RED before UMB3-193', () => {
  assert.equal(makeLatestFlag('0.0.1', '', 'py'), 'true');
  assert.equal(makeLatestFlag('0.0.2', 'py-v0.0.1', 'py'), 'true');
  assert.equal(makeLatestFlag('0.0.1', 'py-v0.0.2', 'py'), 'false');
  assert.equal(makeLatestFlag('0.0.1', 'py-v0.0.1', 'py'), 'true', 'a re-run keeps Latest');
  assert.equal(makeLatestFlag('0.0.1', 'npm-v0.0.2', 'py'), 'false', 'another package line holds Latest');
  assert.equal(makeLatestFlag('9.0.0', 'v1.0.0', 'py'), 'false', 'a bare line is another line too');
  assert.throws(() => makeLatestFlag('0.0.1', 'garbage', 'py'), /not a bare vX\.Y\.Z or <pkg>-vX\.Y\.Z/);
  assert.throws(() => makeLatestFlag('1.0.0', 'py-v0.0.1'), /not a bare vX\.Y\.Z/, 'a single-package repo never guesses around a prefixed Latest');
});

test('mirroredTitle: a Release title that opens with its package and version ("py v0.0.1 - ...") is the name\'s own opening for the tag py-v0.0.1 -- RED before UMB3-193', () => {
  assert.equal(mirroredTitle('Kolwen', 'py-v0.0.1', 'py v0.0.1 - the Python package publishes its first client'), 'Kolwen py v0.0.1 - the Python package publishes its first client');
  assert.equal(mirroredTitle('Kolwen', 'py-v0.0.1', 'odd name'), 'Kolwen py-v0.0.1 - odd name');
  assert.equal(mirroredTitle('Kolwen', 'py-v0.0.1', 'py v0.0.10 - x'), 'Kolwen py-v0.0.1 - py v0.0.10 - x', 'only at a boundary');
});

// UMB3-193 round 3 (2026-11-09): the back-fill of a tag cut BEFORE its CHANGELOG entry existed reads that version's entry from the default branch's CHANGELOG, which
// has newer entries above it, so the entry is found by its exact label, not as the first heading.
test('hasEntryHeading: true only for the exact label of the version (and package), anywhere in the file -- RED before UMB3-193 round 3', async () => {
  const { hasEntryHeading } = await import('./release-shape.mjs');
  assert.equal(hasEntryHeading('## [1.3.0] - 2026-10-02\n\nx\n\n## [1.2.0] - 2026-09-01\n\ny\n', '1.2.0'), true);
  assert.equal(hasEntryHeading('## [1.3.0] - 2026-10-02\n\nx\n', '1.2.0'), false);
  assert.equal(hasEntryHeading('## [1.2.0-beta.1] - 2026-10-02\n\nx\n', '1.2.0'), false, 'a pre-release heading is not the stable version');
  assert.equal(hasEntryHeading('## [py 0.0.1] - 2026-11-02\n\nx\n', '0.0.1', 'py'), true);
  assert.equal(hasEntryHeading('## [py 0.0.1] - 2026-11-02\n\nx\n', '0.0.1', 'npm'), false);
  assert.equal(hasEntryHeading('## [py 0.0.1] - 2026-11-02\n\nx\n', '0.0.1'), false, 'a bare tag does not read a package heading');
  assert.equal(hasEntryHeading('', '1.0.0'), false);
});

test('extractChangelogEntry exact: the entry of THAT version is read from below newer entries, for a bare tag and for a package; absent is a named refusal -- RED before UMB3-193 round 3', () => {
  const bare = '## [1.3.0] - 2026-10-02\n\nNewest.\n\n### Added\n- n\n\n## [1.2.0] - 2026-09-01\n\nThe one asked for.\n\n### Fixed\n- f\n\n## [1.1.0] - 2026-08-01\n\nOlder.\n';
  const e = extractChangelogEntry(bare, '1.2.0', { exact: true });
  assert.equal(e.summary, 'The one asked for.'); assert.equal(e.sectionsBody, '### Fixed\n- f');
  assert.throws(() => extractChangelogEntry(bare, '1.2.0'), /top entry is \[1\.3\.0\] but the pushed tag is v1\.2\.0/, 'without exact the top entry still must match');
  assert.doesNotThrow(() => extractChangelogEntry(bare, '1.2.0', { exact: true, previousStable: '1.1.0' }));
  assert.throws(() => extractChangelogEntry(bare, '1.2.0', { exact: true, previousStable: '1.0.0' }), /followed by \[1\.1\.0\], but the previous stable tag is v1\.0\.0/);
  assert.throws(() => extractChangelogEntry(bare, '1.9.0', { exact: true }), /CHANGELOG\.md has no \[1\.9\.0\] heading/);
  const two = '## [py 0.0.3] - 2026-11-05\n\nNewer py.\n\n## [npm 0.0.2] - 2026-11-03\n\nnpm.\n\n## [py 0.0.1] - 2026-11-02\n\nThe py one.\n';
  assert.equal(extractChangelogEntry(two, '0.0.1', { exact: true, pkg: 'py' }).summary, 'The py one.');
  assert.throws(() => extractChangelogEntry(two, '0.0.1', { pkg: 'py' }), /first \[py\] entry is \[py 0\.0\.3\] but the pushed tag is py-v0\.0\.1/);
});
