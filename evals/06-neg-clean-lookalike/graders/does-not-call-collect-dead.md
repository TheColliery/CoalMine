---
type: regex
target: last_message
match: not_contains
flags: i
weight: 0.5
---
collect(?:(?!\bnot\b|n't|\bno\b)[^.\n]){0,40}?\b(dead|unused|never (used|called|referenced))
