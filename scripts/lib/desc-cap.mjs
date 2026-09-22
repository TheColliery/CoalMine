// Skill-listing description-length gate — shared parser + cap check for
// skills/*/SKILL.md and commands/*.md frontmatter. verify.mjs fails the gate on
// an oversized description instead of shipping a value a listing UI would
// truncate or reject.
//
// Skill-listing description cap: gate at 1024 = cross-platform-safe (agentskills.io / agnix);
// CC's own listing truncation is 1536 chars combined description+when_to_use
// (code.claude.com/docs/en/skills, verified 2026-07-16). USER standard 2026-07-16: never exceed.
export const DESC_CAP = 1024;

// Extract a YAML frontmatter field: bare/quoted single-line, or a block scalar
// (>-, |-, >, |) whose indented continuation lines are joined with single spaces.
// Returns null if the frontmatter block or the key is absent.
export function frontmatterField(text, key) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith(key + ':'));
  if (i === -1) return null;
  let v = lines[i].slice(key.length + 1).trim();
  if (/^[>|][-+]?$/.test(v)) {
    const parts = [];
    for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) parts.push(lines[j].trim());
    return parts.join(' ');
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
}

// description + when_to_use combined length vs the cap (a listing UI truncates the pair together).
export function descriptionCapCheck(text, cap = DESC_CAP) {
  const description = frontmatterField(text, 'description') || '';
  const whenToUse = frontmatterField(text, 'when_to_use') || '';
  const len = description.length + whenToUse.length;
  return { description, whenToUse, len, over: len > cap };
}
