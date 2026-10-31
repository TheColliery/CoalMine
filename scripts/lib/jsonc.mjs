// JSONC comment stripper — MIRROR of hooks/_shared/node-config.js (CJS, Phoenix self-contained). The declaration and its
// body must stay byte-equal in both copies: scripts/lib/consistency.mjs pins them.
//
// Strips // and /* */ comments that sit OUTSIDE strings, then leaves the rest
// untouched so JSON.parse can read a comment-tolerant .coalmine.json. A string
// runs to its first unescaped quote, so a value ending in a literal backslash
// (e.g. "C:\\") terminates the string correctly instead of leaking escape state
// into the next token — which would mis-strip a later //-containing string and
// silently revert the whole config.
//
// One left-to-right pass with no backtracking: each character is visited once or twice, so the work is linear
// however many openers never close. An unclosed string or block comment is kept to the end of the input, so a
// malformed config still fails JSON.parse. An optional counter, `{ steps }`, receives one step per character
// visit; scripts/lib/jsonc-linear.test.mjs asserts the work by that count instead of reading a clock.

export function stripJsonc(content, counter) {
  const n = content.length;
  let out = '';
  let from = 0; // start of the text not yet copied to out
  let i = 0;
  let steps = 0;
  while (i < n) {
    steps++;
    const c = content[i];
    if (c === '"') {
      // a string runs to its first unescaped quote, or to the end of the input; it is kept whole
      i++;
      while (i < n) {
        steps++;
        if (content[i] === '\\') i += 2;
        else if (content[i++] === '"') break;
      }
      continue;
    }
    if (c === '/' && content[i + 1] === '/') {
      out += content.slice(from, i);
      i += 2;
      while (i < n) {
        steps++;
        const d = content[i];
        if (d === '\n' || d === '\r' || d === '\u2028' || d === '\u2029') break;
        i++;
      }
      from = i;
      continue;
    }
    if (c === '/' && content[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(content[j] === '*' && content[j + 1] === '/')) { steps++; j++; }
      if (j >= n) break; // unclosed: the rest of the input is kept as it is
      out += content.slice(from, i);
      i = j + 2;
      from = i;
      continue;
    }
    i++;
  }
  out += content.slice(from);
  if (counter) counter.steps += steps;
  return out;
}
