---
tags: [fire, resource-leak]
runs: 3
max_turns: 8
timeout_seconds: 300
allowed_tools: [Skill, Read, Glob, Grep]
---
Anything rotten in this script? It runs at the end of every audit.

```js
// scripts/export-report.mjs
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export function exportReport(rows, outDir, outFile) {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const out = createWriteStream(outFile);
  for (const row of rows) {
    if (!row.id) {
      throw new Error(`row missing id: ${JSON.stringify(row)}`);
    }
    out.write(`${row.id},${row.severity},${row.path}\n`);
  }
  out.end();

  spawnSync('git', ['add', outFile]);
  console.log(`wrote ${rows.length} rows to ${outFile}`);
  return true;
}
```
