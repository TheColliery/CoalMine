// JSONC comment stripper — MIRROR of hooks/_shared/node-config.js (CJS, Phoenix self-contained). Keep the regex in sync; both copies are covered by tests.
//
// Strips // and /* */ comments that sit OUTSIDE strings, then leaves the rest
// untouched so JSON.parse can read a comment-tolerant .coalmine.json. The string
// alternative consumes an escaped char (\\.) or any non-quote/non-backslash char,
// so a value ending in a literal backslash (e.g. "C:\\") terminates the string
// correctly instead of leaking escape state into the next token — which would
// mis-strip a later //-containing string and silently revert the whole config.

export function stripJsonc(content) {
  return content.replace(/"(?:\\.|[^"\\])*"|\/\/.*|\/\*[\s\S]*?\*\//g, (m) => (m[0] === '"' ? m : ''));
}
