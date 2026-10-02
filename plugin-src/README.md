# CoalMine plugin

CoalMine is a set of nine code-quality "canary" skills for coding agents, plus three small hooks that nudge your agent to run the health scan at the right moments. It reports problems and fixes nothing on its own: every fix goes through a menu you choose from.

The nine skills are `rot-canary` (dead code, bug-prone logic, leaks, silent failures), `gold-standard` (rules and standards completeness), `source-grounding` (verify version-sensitive facts before asserting them), `supply-chain-audit`, `resilience-audit`, `telemetry-canary`, `testability-canary`, `scale-canary` and `drift-canary`. Two commands ship with them: `/coalmine:stats` (a local activity and rule-freshness report) and `/coalmine:update` (check for a newer version and choose how updates are handled). One read-only helper agent, `coalmine-scanner`, carries out scans the skills fan out.

## What the hooks run, and when

All three are `node` scripts started by Claude Code from `hooks/hooks.json`, each with a 10-second timeout. None starts another process, opens a network connection, or sends anything anywhere.

| Hook | When | What it does |
|---|---|---|
| `coalmine-conductor` | Session start | Reads the CoalMine config (`~/.claude/.coalmine.json`, then the project's) and the project's rule files (`.claude/rules/`, `.agents/rules/`, `AGENTS.md`, `STANDARDS.md`) to look for `coalmine: verified` stamps. It then tells your agent which canaries exist and when to offer them. It keeps a local update-check date at `~/.claude/coal/coalmine/update-check`. |
| `rot-canary-touch` | After a `Write`, `Edit` or `MultiEdit` tool call | Records the edited file's path in a session marker under your OS temp folder (`coalmine/`), and flags a file with merge-conflict markers or one that is very long. To do that it reads the edited file (up to a size limit) only to count its lines and spot those markers; it does not analyse the code. A `MEMORY.md` edit is recorded by name only. |
| `rot-canary-stop` | When the agent finishes a turn | If code files were edited, it asks the agent to run `rot-canary` at its quick depth over those files and to report confirmed findings only. It also reminds the agent, quietly, when code changed but no `MEMORY.md` was updated (it checks that a `MEMORY.md` exists at the project root; it does not read it). It deletes its own session markers when the batch is done. |

You can turn the automatic scan off with the `rotCanaryMode` setting (`auto`, `manual` or `off`), or by creating the file `~/.claude/.rot-canary-off`.

## What is fetched or sent

The hooks fetch and send nothing: CoalMine collects no telemetry and has no server (see `PRIVACY.md` in the repository). The hooks write only to your OS temp folder (session markers) and, under `~/.claude/`, the update-check date and the mode files you set yourself.

Some skills can look facts up on the web. `source-grounding` checks version-sensitive facts, and `supply-chain-audit` can look up advisories. Those lookups are your agent's own tool calls, made under your own account, offered through a consent menu, and they degrade to "unverified" when offline. In `auto` update mode, or when you run `/coalmine:update` yourself, the command asks your agent to run `git ls-remote --tags` against `https://github.com/TheColliery/CoalMine.git` to read the latest version tag; that call sends no project data.

## Example uses

1. **Check code you just changed.** Ask: "Run rot-canary on the files I changed this session." The agent scans those files for dead code, resource leaks, swallowed errors and similar, and returns a table of confirmed findings with `path:line` evidence.
2. **Audit your project's rules.** Ask: "Run gold-standard on this project." It scores your rules and standards against best-in-class examples, names the gaps, and offers to draft the missing rules for you to approve.
3. **Check a dependency before adding it.** Ask: "Run supply-chain-audit on package.json before I add this library." It reviews the dependency, its maintenance and licence, and the build and CI trust chain, and reports without changing anything.
4. **Verify a claim before you rely on it.** Ask: "Use source-grounding to check this API version and the deprecation note." Facts it cannot verify are marked unverified rather than guessed.
5. **See what CoalMine did.** Run `/coalmine:stats` for the canaries that ran this session and which of your rules are past their re-check date.

## Where gold-standard reads your project's memory file

`gold-standard` reads a project's memory or decision log only to verify it: in its CONSISTENCY step the skill says "scan the memory/decision log and any in-repo rule register for (a) a prescribed fix/"decision" that contradicts a binding rule or another decision ... (b) references to a file, flag, or command that no longer exists" (`skills/gold-standard/SKILL.md`, the CONSISTENCY item of the RE-VALIDATE step). Its only write there is a one-line `retired <rule> <date>: <reason>` note when you approve retiring a rule. The agent does this with its ordinary file tools inside your project, under your account; the hooks never read a memory file's contents.

## Report a problem

Open an issue at <https://github.com/TheColliery/CoalMine/issues>. For a security problem, follow `SECURITY.md` in the repository and use GitHub's private vulnerability reporting instead of a public issue.

CoalMine is licensed under Apache-2.0.
