# Problem report — when a CoalMine hook misbehaves

Use this when a user says a CoalMine hook (`coalmine-conductor`, `rot-canary-touch` or `rot-canary-stop`) crashed, stayed silent when it should have spoken, or spoke when it should not. A fault in a skill's own text (a wrong instruction, a wrong finding class) needs no hatch: the hatch only sees hooks, so go straight to step 4.

The hatch is the debug hatch: off by default, it makes each hook write one short line per run to a local file. It records which hook ran, which guard refused, whether it crashed and where in the hook's own code. It never records content or paths.

1. **Offer the hatch.** Tell the user to set `COALMINE_DEBUG=1` in the shell that starts their agent, start a new session and reproduce the fault. Never set the variable yourself.
2. **Read the record.** Read `~/.claude/coal/coalmine/debug-hatch.jsonl` and, if it exists, `debug-hatch.1.jsonl` beside it (the older half, kept when the first file reaches 256 KiB).
3. **Scrub it.** Keep only the fields the hatch writes: `timestamp`, `severity`, `hook`, `plat`, `node`, `ev`, `guard`, `err`, `code`, `at`, `argv`, `name`, `lines`, `files`, `drift`, `reported`, `lane`, `recorded`, `memory`. Drop any line that does not parse as one JSON object, and any line that holds another field or a value that is not a short plain word, a number or a true/false. Add no code, path or memory content the user did not approve.
4. **Attach it to the draft.** Draft the issue at the form named in the Self error-report footer, with the kept lines in it. The user reads the whole draft and submits it. Never send anything automatically.
5. **Switch it off.** Tell the user to unset `COALMINE_DEBUG`. The two files then clear themselves at a later session stop, once each is older than `tempSweepStaleDays` days (7 unless the user set another value), or the user can delete them.
