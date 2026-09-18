# CoalMine evals — `rot-canary` pilot

Measures one thing we have never measured: **does the skill actually help?**
`claude plugin eval --ablation with-without` runs every case twice — once with
the plugin loaded, once without — and reports the score delta. The headline
number is Δ, not the pass rate.

Pilot scope: `rot-canary` only, 7 cases. Prove the shape, then the room extends
it toward the ~20 real cases Anthropic reports is enough to steer on.

---

## ⚠️ Status: WRITTEN, NEVER RUN

**No number in this suite has been measured. There are no results.** Every
expectation below is a design claim about what the graders should reward, not an
observation. Do not cite this suite as evidence of anything until a pilot runs.

**Running it spends real money** (agent runs + LLM judge calls). Two guards
before the first run:

1. **Get the owner's consent.** This is a paid, outward action.
2. **Always pass `--max-cost-usd`.** The run aborts and reports partial results
   with exit 2 when hit. It is **not** a pre-spend cap: per the CLI's own help,
   "overrun is bounded to one agent run" — the breaching run still completes,
   only its paid (`llm`/`baseline`) graders are skipped. So set the ceiling
   below what you are willing to lose, never at it.

**Second blocker: `claude plugin eval` is gated behind EARLY ACCESS on this
machine.** `--help` renders in full, but any real subcommand refuses:

```
$ claude plugin eval init --bare probecase
`plugin eval` is currently in early access
```

The suite is written against the schema extracted from the shipped CLI binary,
not against a successful run. Until the gate opens, nothing here can execute.

---

## Running it

Run from the CoalMine repo root — **the target must be a plugin root**, because
that is what resolves `--plugin-dir` for the "with" arm. Targeting `evals/`
directly yields `plugins: []`, which silently makes the whole run meaningless.

```bash
# pilot: 1 run per case, both arms — read the cost before committing to a full run
claude plugin eval . --ablation with-without --no-scaffold \
  --runs 1 --judge-model sonnet --max-cost-usd 3

# full suite: 3 runs per case (the floor), both arms
claude plugin eval . --ablation with-without --no-scaffold \
  --judge-model sonnet --max-cost-usd 8 --report evals/report.html
```

`--ablation with-without` is **not optional here**. It defaults to `with-without`
only when the target is a plugin *name*; for a *path* target it defaults to
`none`, which measures nothing.

Useful filters: `--tag negative` (the two false-positive cases), `--tag fire`,
`--case '03-*'`.

### Judge model — override the default

`--judge-model` defaults to **haiku**, and the CLI's own embedded authoring guide
says not to leave it there:

> For llm graders: use a sonnet-tier or larger judge (`--judge-model sonnet` in
> the run cmd). Small judges miss nuance; every advisor-graded eval that's
> trusted uses a big model. The judge must NOT be the agent model
> (self-preference).

So: judge on sonnet-tier or above, and if the agent runs are also sonnet, move
one of the two so judge ≠ agent.

### Cost — estimated, not measured

7 cases × 3 runs × 2 arms = **42 agent runs**, plus **42 LLM-judge calls** (one
`llm` grader per case; the `regex` and `tool_used` graders are free).

Order of magnitude, **⚠️ unverified — do not quote this without the marker:
≈ $2–4 for the full suite, ≈ $1 for the `--runs 1` pilot.**
That is arithmetic over assumed per-token prices, and prices and model IDs rot —
check current Anthropic pricing before relying on it. The only
trustworthy figure is the pilot's own top-level `cost_usd` in
`evals/results/<timestamp>/aggregate-result.json`: one full suite ≈ that × `runs`.

---

## The cases

Five where the skill should fire, two where it should not.

**Where the answer key comes from.** Every planted defect belongs to a class in
rot-canary's own benchmark corpus — `silent-failure`, `resource-leak`,
`dead-code`, `input-boundary`, `concurrency`, `doc-rot`, `clean-decoy`,
`bug-prone` — all eight of its classes, under
[`.github/benchmarks/CoalMine/fixtures/rot-canary`](https://github.com/TheColliery/.github/tree/main/benchmarks/CoalMine/fixtures/rot-canary).
So the key is the skill's own declared detection taxonomy, not an invented
rubric. Case 07 (over-trigger) is the one class with no corpus counterpart.

Two cases go further and reconstruct defects **this repo shipped and fixed in
its own code**: case 01 is `consistency.mjs`'s fail-open `isDir`/`walkMd`
(commits `d65ae5c`, `0989082`), and case 04's two halves are the `manifest.mjs`
path-traversal bypass (v3.5.1) and the `>maxLines` off-by-one (v3.7.11). The
other three have no such history and must not be described as if they do — this
repo's scripts have never held an `async` function, a `spawnSync` outside tests,
or a write stream.

| # | Case | Planted | What it measures |
|---|------|---------|------------------|
| 01 | `fail-open-enumeration` | `catch → return []` on `readdirSync`, `catch → false` on `statSync` | TP on the swallowed-enumeration class — a guard reporting a pass it never earned |
| 02 | `leak-and-ignored-status` | stream never closed on the throw path; `spawnSync` status ignored | TP on resource leak + ignored return code |
| 03 | `dead-vs-di-wired` | one genuinely dead private fn **+ a DI-registered class with no direct caller** | **The discipline rail.** Finding the dead one is easy; not deleting the DI-wired one is the skill's actual claim |
| 04 | `traversal-and-off-by-one` | unvalidated path join, off-by-one loop, comment contradicting the code | Severity *ordering* — traversal must outrank the stale comment |
| 05 | `unawaited-flush-and-doc-rot` | unawaited `flush()` that clears the buffer first; stale `@param`; unused field | TP on async data loss, and that doc rot is not ranked alongside it |
| 06 | `neg-clean-lookalike` | **nothing — the file is clean** | **False-positive rate.** Four constructs shaped like classic defects, all correct |
| 07 | `neg-not-a-code-request` | **nothing — no code at all** | **Over-trigger.** A conceptual question must not produce a scan report |

Case 03 is the one worth watching. A naive "no callers → dead" pass deletes
`LegacyPayoutHandler` and breaks production; the SKILL.md rail
("zero-reference reachability … not a single-file grep") exists precisely to
stop that. If the plugin has value, Δ shows up here.

## The graders

Every case carries one weight-1 `llm` grader as the primary outcome check, plus
a cheap weight-0.5 deterministic check. Four rules they all follow:

- **End state, never trajectory.** Every rubric opens by telling the judge to
  ignore which tools ran, how many steps were taken, and whether any skill
  fired. Anthropic's own finding: agents reach the same goal by different paths.
- **Single judge, single call, 0.0–1.0 plus a pass line.** Not a board. Anthropic
  tested multiple judges and found one call with one prompt was the most
  consistent and the closest to human judgement.
- **Concrete checkable claims, not vibes.** Each rubric names the exact defect,
  the exact consequence that must be stated, and a banded score for partial
  credit — so a run that names the bug but misses why it matters lands at 0.7,
  not at the grader's mood.
- **A format literal never scores alone.** The `CRITICAL|HIGH|MEDIUM|LOW` regex
  is lifted from SKILL.md's own severity ladder, so it is weight 0.5 and
  secondary — the CLI's authoring guide warns that a spec literal as the only
  scored check makes the eval measure the spec instead of the outcome.

Rubric axes, per the brief: **TP** (did it find the planted defect), **FP** (did
it fire on the clean file), **severity sanity** (is the ranking defensible).
Cases 04 and 05 make severity ordering a scored condition rather than prose —
an answer that ranks a stale comment above a path traversal fails even with
every defect listed.

Case 07 carries a `tool_used` grader with `min: 0, max: 0, arm: both` — the
guide's prescribed shape for "must NOT call this tool". It is scored, unlike the
usual display-only `tool_used`. Note the asymmetry, deliberately accepted: the
baseline arm cannot invoke a plugin that is not loaded, so it passes for free
and this grader can only ever *lower* Δ. That is the honest direction — an
over-triggering plugin should pay for it.

---

## Design decisions worth knowing before you extend this

**Why this lives in the repo and not at the series umbrella — a NAMED divergence,
pending main's ruling.** The series CLEAN-CLONE principle sends benchmarks to
`TheColliery/.github/benchmarks/`, and this room already moved a rot-canary eval
harness there once (`4c12c91`, 2026-06-16 — "so a clone of the skill carries only
the plugin and its docs"). That precedent does **not** transfer, for a mechanical
reason: the old harness was hand-rolled (`score.mjs` reads fixtures from wherever
you point it) and therefore location-independent, while `claude plugin eval`
treats eval cases as a property *of the plugin* — discovery is `evals/**` under
the plugin target, and the only relocation lever is an `evals` key in
`.claude-plugin/plugin.json`, which would be a shipped-artifact change on a
manifest block the CLI's own schema marks as unstable. Hosting these at the
umbrella would need the cases to sit under a path that is not a subdirectory of
that repo. The cost of staying is bounded and was measured, not assumed:
`evals/` is **not** copied into `plugin/` (`build-plugin.mjs` copies a closed
list), `verify.mjs`'s orphan guard walks `plugin/` only, and the markdownlint
workflow is `continue-on-error`. So a *plugin* install never carries this; a
*git* clone does. **No sibling repo has an `evals/` dir**, so this is a new shape
for the flock — main rules on whether the flock adopts it or CLEAN-CLONE gets an
explicit carve-out for vendor-convention directories.

**Fixtures are inlined in `prompt.md`, not written to disk.** The eval sandbox
cwd is created empty (`mkdtemp` + four bare dirs), so a case's code has to
arrive by one of three routes: inline in the prompt, `context.scaffold_script`
(needs `--scaffold`, which runs author-supplied bash as you, and which the
guide's own pilot command disables), or `context.add_dirs` (resolved relative to
the case dir, containment-checked, passed as `--add-dir` — but then the prompt
cannot name the path, since absolute paths are banned in prompts).

Inline was chosen because it has zero unknowns and needs no gated tools. The
cost is real and should be named: **this measures the skill's analysis
discipline, not its file-discovery or touched-files scoping.** Case 03 still
exercises cross-file reachability by supplying three labelled files in one
prompt. If the room later wants to test scoping and the cap, that needs
`case.yaml` with `context.add_dirs` — a different suite, not a patch to this one.

**`prompt.md` + `graders/`, not `case.yaml`.** `case.yaml` is only needed for the
`context` block (scaffold / add_dirs / history_file), which this suite does not
use. The loader supplies `schema_version: "1.1"` and takes `name` from the
directory basename when there is no `case.yaml`, so neither key is written here.

**`allowed_tools` is read-only and minimal** — `[Skill, Read, Glob, Grep]` for
the scan cases so the skill can load its own `references/*`, `[Skill]` alone for
case 07. Nothing writes, so the plugin's own Stop hook never finds a touched
file and never blocks the run. `Bash`, `Write`, `Edit` and `WebFetch` would
additionally need an `--allow-tools` operator grant on the command line.

**The target loads the SOURCE tree, not `plugin/`.** `CoalMine/` root is itself a
valid plugin root (`.claude-plugin/plugin.json` + `skills/` + `hooks/`), and
`verify.mjs` enforces source↔dist parity, so the two are equivalent today. If
that gate ever stops running, this suite is measuring the source and the users
are running the dist.

## Floor invariants — do not "simplify" these away

The CLI's authoring guide marks these non-negotiable, and they are what makes the
number mean anything:

- ≥ 1 should-NOT-fire case stays in the suite (here: two)
- every case has ≥ 1 outcome grader, never only a `tool_used`
- `runs: 3` minimum
- `--ablation with-without` stays

Softening a grader until it always passes turns this into a vanity metric. The
useful question when one looks too harsh is not "how do we make it pass" but
"what is the version that would still catch a real regression".

## Extending it

Add a directory under `evals/`, give it `prompt.md` plus a `graders/` dir, done —
discovery walks for any dir under an `evals/` path segment containing a
`prompt.md` or `case.yaml`. Grader types available: `regex`, `file_exists`,
`llm`, `tool_used`, `tool_order`, `baseline` (`baseline` is in the CLI schema but
absent from its own documentation table — treat it as unverified).

Prefer the cheap tiers: a verifiable check (`regex`, `file_exists`) beats a
binary criterion beats an LLM rubric. Reach for `llm` only when nothing cheaper
can express the claim.
