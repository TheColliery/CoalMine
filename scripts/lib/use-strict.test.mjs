// CM-T1 (OpenSSF warnings, hardening): every shipped CommonJS hook opens with 'use strict'.
// Lists the *.js files directly in hooks/ and in plugin/hooks/ (non-recursive, so the count is derived, never pinned)
// and asserts that each one's first statement is 'use strict'; after skipping a shebang, blank lines, // comments and
// /* */ comments. The second leg proves the checker itself can fail on a file without the directive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIRS = [path.join(repo, 'hooks'), path.join(repo, 'plugin', 'hooks')];

// True when the first statement of src is exactly 'use strict'; (after a shebang, blank lines, // and /* */ comments).
export function firstStatementIsUseStrict(src) {
  let s = src;
  if (s.startsWith('#!')) {
    const nl = s.indexOf('\n');
    s = nl === -1 ? '' : s.slice(nl + 1);
  }
  for (;;) {
    s = s.replace(/^\s+/, '');
    if (s.startsWith('//')) {
      const nl = s.indexOf('\n');
      s = nl === -1 ? '' : s.slice(nl + 1);
      continue;
    }
    if (s.startsWith('/*')) {
      const end = s.indexOf('*/');
      if (end === -1) return false;
      s = s.slice(end + 2);
      continue;
    }
    break;
  }
  return /^'use strict';(?:\s|$)/.test(s);
}

function jsFilesDirectlyIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => e.name)
    .sort();
}

for (const dir of DIRS) {
  const rel = path.relative(repo, dir).split(path.sep).join('/');
  test(`every shipped CommonJS hook in ${rel}/ opens with 'use strict'`, () => {
    const files = jsFilesDirectlyIn(dir);
    assert.ok(files.length >= 3, `${rel}/ should hold at least the three hooks, found ${files.length}`);
    const missing = files.filter((f) => !firstStatementIsUseStrict(fs.readFileSync(path.join(dir, f), 'utf8')));
    assert.deepEqual(missing, [], `${rel}/: first statement is not 'use strict';`);
  });
}

test('the strict-mode checker itself can fail: a file without the directive reports false, one with it true', () => {
  const without = "#!/usr/bin/env node\n// c\nconst fs = require('fs');\n";
  const withDirective = "#!/usr/bin/env node\n// c\n'use strict';\nconst fs = require('fs');\n";
  const withBlock = "/* header */\n'use strict';\nconst fs = require('fs');\n";
  assert.equal(firstStatementIsUseStrict(without), false);
  assert.equal(firstStatementIsUseStrict(withDirective), true);
  assert.equal(firstStatementIsUseStrict(withBlock), true);
});
