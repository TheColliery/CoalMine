## Escalation — Scope & Model Quality

Tiers are **capability targets**, not platform commands — resolve each to your host's nearest lever. No lever for one? **Degrade gracefully — never fake parallelism you can't do**; escalate via model tier + reasoning depth instead.

| Level | Intent | Capability target | Cost |
|---|---|---|---|
| **Light** | {{LIGHT_INTENT}} | Cheapest model · single agent, no sub-agents. | Low |
| **Standard** | {{STANDARD_INTENT}} | Balanced model · raised reasoning · sub-agents per category **only if your platform runs concurrent workers** (else single-agent). | Balanced |
| **Heavy** | {{HEAVY_INTENT}} | Most capable model + largest context · deepest reasoning · max sub-agent fan-out **if supported** · adversarial cross-check where available. | High |

Per-platform Heavy levers + Heavy-run durability: read `references/escalation.md` before a Heavy run. No concurrent fan-out on your host → escalate by model + reasoning only.
