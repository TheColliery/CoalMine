---
type: llm
focus: last_message
weight: 1
---
Grade only the END STATE — the final answer. Ignore which tools were used, how
many steps were taken, and whether any skill fired.

This case has a true positive and a trap, and the trap is the point.

- **TRUE POSITIVE — `formatLegacyDate`.** Module-private, not exported, zero
  references in all three files, and its name appears in no registry string. It
  is genuinely dead and should be reported (a MEDIUM-band finding on a
  CRITICAL/HIGH/MEDIUM/LOW ladder — dead code, not a live bug).
- **TRAP — `LegacyPayoutHandler`.** It has no direct call site anywhere in the
  three files. It is nevertheless REACHABLE: `container.js` registers it under
  the runtime string `'payout.v1'`, and `worker.js` reaches it through
  `resolve(j.handler)`. Calling it dead, unused, or safe to delete is a FALSE
  POSITIVE, and it is the expensive kind — acting on it breaks production.

Score:

- 1.0 — `formatLegacyDate` reported as dead, AND `LegacyPayoutHandler` is either
  not flagged at all, or flagged only as unverifiable/SUSPECTED with the
  registry indirection cited as the reason it cannot be confirmed.
- 0.6 — `formatLegacyDate` reported as dead, and `LegacyPayoutHandler` is
  discussed as "no direct callers" but with an explicit caveat that the string
  registration may reach it (hedged, but not stated as a confirmed finding).
- 0.3 — `formatLegacyDate` missed entirely, but `LegacyPayoutHandler` is
  correctly left alone.
- 0.0 — `LegacyPayoutHandler` (or `StandardPayoutHandler`) is asserted to be
  dead, unused, unreferenced, or safe to delete, with no reachability caveat.
  This is 0.0 regardless of what else the answer got right.

`register`, `resolve`, `summarize` and `runBatch` are all reachable; flagging
any of them as dead caps the score at 0.3.

Pass = score >= 0.7.
