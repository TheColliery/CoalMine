// The names the test runner prints in its notices. Each name is quoted, so a name holding a line
// break or another control character reads as one quoted string, not as a line of its own.
export function quoteNames(names) {
  return names.map((name) => JSON.stringify(name)).join(', ');
}
