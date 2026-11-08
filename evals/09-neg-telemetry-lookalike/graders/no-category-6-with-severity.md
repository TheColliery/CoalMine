---
type: regex
target: last_message
match: not_contains
weight: 0.5
---
[Cc]ategory 6(?:(?!\bno\b|\bnot\b|n't)[^.\n]){0,60}?\b(CRITICAL|HIGH|MEDIUM|LOW)\b
