---
type: regex
target: last_message
match: not_contains
flags: i
weight: 0.5
---
category 6[^.\n]{0,60}(CRITICAL|HIGH|MEDIUM|LOW)
