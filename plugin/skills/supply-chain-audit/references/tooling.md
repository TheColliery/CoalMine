<!-- coalmine: verified 2026-06-12 · revalidate 90d · definition file for supply-chain-audit -->
# Supply-chain audit — per-ecosystem tooling

| Ecosystem | vuln | license | outdated |
|---|---|---|---|
| .NET | Dependabot / OSV (packages.config → no `--vulnerable`) | clearlydefined | `dotnet list package --outdated` |
| npm | `npm audit` | `license-checker` | `npm outdated` |
| Python | `pip-audit` | `pip-licenses` | `pip list --outdated` |
| Rust | `cargo audit` (RustSec) | `cargo-deny` | `cargo outdated` |
| Go | `govulncheck` | `go-licenses` | `go list -u -m all` |

Offline fallback: when registry/advisory queries are blocked, inspect committed lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `Cargo.lock`, …) and any locally stored Dependabot logs / GitHub Security Alerts; mark the live checks N-A.
