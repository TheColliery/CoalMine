---
tags: [fire, async, doc-rot]
runs: 3
max_turns: 8
timeout_seconds: 300
allowed_tools: [Skill, Read, Glob, Grep]
---
Give this class a health check. It is the write path for our session journal.

```js
// src/journal.js
import { appendFile } from 'node:fs/promises';

export class Journal {
  constructor(path, flushEveryMs) {
    this.path = path;
    this.flushEveryMs = flushEveryMs;
    this.buffer = [];
  }

  /**
   * Append one entry to the journal.
   * @param {string} entry   the line to append
   * @param {number} retries how many times to retry a failed write
   */
  record(entry) {
    this.buffer.push(entry);
    if (this.buffer.length >= 10) {
      this.flush();
    }
  }

  async flush() {
    const batch = this.buffer;
    this.buffer = [];
    await appendFile(this.path, batch.join('\n') + '\n');
  }
}
```
