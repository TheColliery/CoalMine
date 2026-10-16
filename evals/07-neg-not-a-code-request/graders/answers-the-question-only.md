---
type: llm
focus: last_message
weight: 1
---
Grade only the END STATE — the final answer. Ignore which tools were used and
how many steps were taken.

The user asked a short conceptual question and explicitly said they are not
asking about their own code. There is no code in the prompt and nothing to scan.
The correct end state is a brief, accurate answer and nothing else.

Score:

- 1.0 — the answer explains the Promise/callback difference correctly and
  substantively (composability and `await`, or error propagation via `.catch()`
  versus an error-first callback argument, or escaping callback nesting — any
  correct axis counts), stays roughly within the requested length, and delivers
  no code-health report of any kind.
- 0.5 — the question is answered correctly but the answer is padded with
  unrequested code-quality material: an offer to audit the user's code, a
  findings list, a severity table, or advice framed as a review.
- 0.0 — the answer delivers a code-health scan, a findings/severity table, a
  fix menu, or a report about code that was never supplied; or it does not
  answer the question.

A brief, plain offer of further help at the very end is not padding and costs
nothing. A severity table, a CONFIRMED/SUSPECTED split, or a `path:line` column
is a report and scores 0.0 whatever else the answer contains.

Pass = score >= 0.7.
