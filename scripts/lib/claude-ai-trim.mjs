// Deterministic description trim for claude.ai's ZIP-install skill-listing
// cap (200 chars) — a DERIVED value only, computed at build time for the
// ZIP artifact; the source skills/*/SKILL.md description stays at our own
// cross-platform 1024 cap (desc-cap.mjs) and is never edited by this.
//
// ⚠️ unverified (board #40 fixback F4, CoalFace's own port of the same finding): this
// trims `description` ALONE, while our own desc-cap.mjs sums `description +
// when_to_use` against the 1024 cap on the stated ground that a listing UI truncates
// the pair together. Whether claude.ai's ZIP-install listing does the same has not
// been checked against the platform directly — no `when_to_use` field exists anywhere
// in this flock today, so nothing is live either way. If a skill ever adds
// `when_to_use`, re-verify claude.ai's actual behavior before trusting this cap
// covers the pair. NOT fixed here — a different question from the trim bug below.
export const CLAUDE_AI_DESC_CAP = 200;

// Trim to <= cap: cut at the last whitespace boundary before the reserved
// ellipsis budget, then append '...' (itself counted inside the cap).
// Deterministic — same input always produces the same output (Phoenix #8's
// no-randomness discipline, extended to build tooling).
export function trimDescription(description, cap = CLAUDE_AI_DESC_CAP) {
  if (description.length <= cap) return description;
  const budget = cap - 3; // reserve 3 chars for '...'
  let cut = description.slice(0, budget);
  // A UTF-16 slice can land mid-surrogate-pair (a non-BMP character, e.g. an emoji or
  // a CJK extension codepoint, straddling the cut index), leaving a lone high
  // surrogate (0xD800-0xDBFF) at the end -- invalid UTF-16, decodes to U+FFFD
  // downstream. The whitespace-boundary rescue below only fires when an ASCII space
  // exists in the first `budget` chars, so a spaceless description (Thai/CJK, no
  // ASCII word breaks) would otherwise ship the raw split (board #40 fixback F3).
  // Deliberately NOT switched to code-point (Array.from) slicing -- and this is not
  // a guess about which counting convention claude.ai uses: for text containing
  // non-BMP characters, a UTF-16 code-unit count is NEVER less than the codepoint
  // count of the same string (a surrogate pair is 2 code units but always 1
  // codepoint). So trimming to <= cap in code UNITS stays <= cap in CODE POINTS too
  // -- it can only come in UNDER a codepoint-counted limit, never over. (This
  // dominance does NOT extend to UTF-8 byte count -- a 200-code-unit Thai/CJK
  // string can measure ~600 bytes -- so it says nothing about a byte-counted cap.)
  // Dropping the one trailing lone surrogate preserves this dominance and fixes
  // only the boundary defect.
  //
  // Scope note: this only cleans a surrogate this function's OWN slice produced AT
  // the cut boundary. A lone surrogate already present in malformed input (upstream
  // corruption, not ours to fix) passes through unchanged regardless -- whether the
  // string is short enough to skip trimming entirely, or long enough to hit the
  // trim path with the stray surrogate sitting elsewhere, away from the one
  // boundary this check inspects. Input validation is a separate concern from this
  // function's job of not creating a NEW one at the cut.
  if (cut.length > 0) {
    const lastCode = cut.charCodeAt(cut.length - 1);
    if (lastCode >= 0xD800 && lastCode <= 0xDBFF) cut = cut.slice(0, -1);
  }
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > 0) cut = cut.slice(0, lastSpace);
  return cut.trimEnd() + '...';
}
