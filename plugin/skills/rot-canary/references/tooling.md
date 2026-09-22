<!-- coalmine: verified 2026-06-12 · revalidate 90d · definition file for rot-canary -->
# Rot-Canary — per-stack tooling

| Stack | build/warnings | dead-code | lint |
|---|---|---|---|
| C#/.NET | `dotnet build -warnaserror` · Roslyn IDE0051/CS0162 | Roslyn analyzers | nullable, `dotnet format` |
| TS/JS | `tsc --noEmit` | `knip`, `ts-prune`, `depcheck` | `eslint` |
| Python | the project's test command + `-W error` (e.g. `python -m pytest -W error`) | `vulture`, `ruff F401/F841` | `mypy`, `ruff` |
| Rust | `cargo build` | `cargo machete` | `cargo clippy` |
| Go | `go build`, `go vet` | `deadcode`, `staticcheck` | `staticcheck` |

Prefer the project's existing toolchain; never add dependencies just to scan.
