// The test runner's notices quote each file name (28c round 2, fix 3). A name that holds a line
// break must not start a new line of notice output: the break reads as an escape inside a string.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteNames } from './test-notice.mjs';

test('quoteNames quotes each name, so a name with a line break stays on one line', () => {
  const out = quoteNames(['scripts/lib/a.test.mjs', 'scripts/lib/b\nFAIL forged.test.mjs']);
  assert.ok(!out.includes('\n'), `a raw line break reached the notice: ${JSON.stringify(out)}`);
  assert.ok(out.includes('"scripts/lib/b\\nFAIL forged.test.mjs"'), `the name is not quoted: ${out}`);
});

test('quoteNames quotes a plain name in double quotes and joins names with a comma', () => {
  assert.equal(quoteNames(['x.test.mjs', 'y.test.mjs']), '"x.test.mjs", "y.test.mjs"');
});
