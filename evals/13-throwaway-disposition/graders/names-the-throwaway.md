---
type: regex
target: last_message
match: contains
weight: 0.5
---
probe-once\.mjs[^\n]{0,80}THROWAWAY|THROWAWAY[^\n]{0,80}probe-once\.mjs
