---
type: regex
target: last_message
match: not_contains
flags: i
weight: 0.5
---
collect[^.\n]{0,40}\b(is |appears |looks )?(dead|unused|never (used|called|referenced))
