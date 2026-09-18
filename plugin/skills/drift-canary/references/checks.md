<!-- coalmine: verified 2026-06-12 · revalidate 90d · definition file for drift-canary -->
# Drift canary — concrete detection procedures

## 1. Breaking schema migrations — expand/contract rule
Safe order (expand → migrate → contract; never combined in one release):
1. **Expand:** add nullable column / new table / new index — old code keeps working.
2. **Migrate:** backfill data; deploy code that writes both / reads new-with-fallback.
3. **Contract:** only after all writers upgraded — add NOT NULL, drop old column.

Flag as CRITICAL in one migration: `DROP COLUMN`/`DROP TABLE` still referenced by deployed code · type narrowing (`TEXT→INT`, shrinking varchar) · `ADD COLUMN ... NOT NULL` without `DEFAULT` on a populated table · renames (= drop+add to every old client).

## 2. Breaking API contract changes
Breaking (flag): removing/renaming an endpoint, field, or enum value · changing a field's type/format · making an optional param required · changing error shape/status codes clients branch on.
Safe (additive): new optional field · new endpoint · new enum value IF clients tolerate unknowns (verify!).
Check: OpenAPI/GraphQL schema diff if present; otherwise diff DTO/serializer classes.

## 3. Serialization mismatches
- JSON: removed/renamed properties without alias support (`[JsonPropertyName]`, `@JsonAlias`, serde `alias`) · strict deserializers that throw on unknown fields meeting a newer producer.
- Protobuf: field NUMBER reuse or type change (wire-breaking) — numbers must be `reserved` after deletion; new fields = new numbers.
- Queues/events: producer upgraded before consumers — old messages still in flight must deserialize.

## 4. Library contract drift (shared/public libs)
- Public signature changes without `[Obsolete]`/`@deprecated` wrapper for one release window.
- Behavior changes under an unchanged signature (return null→throw) — worse than signature breaks; flag.
- SemVer: breaking change without major bump.

## 5. Config drift
- New required env/config key read with no default and no startup validation → first crash happens in production.
- Right shape: default value, or fail-fast at startup with the exact missing-key name, plus README/.env.example entry.

## Migration-path column (output)
Each finding names its safe path: expand/contract step · alias/reserved-number · deprecated wrapper · default+validate.
