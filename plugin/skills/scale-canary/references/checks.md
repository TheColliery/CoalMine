<!-- coalmine: verified 2026-06-12 · revalidate 90d · definition file for scale-canary -->
# Scale canary — concrete detection procedures

## 1. O(N²) on growable data
- Nested loops where the inner iterates a collection that grows with usage (users, orders, files) — `for ... { for ... { } }`, `.filter().map()` inside `.forEach`, `Where` inside `foreach`.
- `Array.includes`/`indexOf`/`list.Contains` inside a loop over another list → suggest Set/Dictionary index (O(N²)→O(N)).
- Only flag when N is unbounded user data; fixed small enums are fine.

## 2. N+1 queries (per-ORM shapes)
| ORM | Smell | Fix |
|---|---|---|
| EF Core | navigation property access in a loop (lazy load) | `.Include()` / projection |
| Prisma | `findUnique`/`findMany` inside `for`/`map` over rows | single `findMany({ where: { in } })` / `include` |
| Sequelize | per-row `.get...()` association calls | `include` eager load |
| Django | attribute access on FK in template/loop | `select_related`/`prefetch_related` |
| Raw SQL | query call inside loop | batch `IN (...)` / JOIN |

## 3. Memory bloat / unbounded growth
- Appends to module/global collections that never clear: `cache.push(...)`, `dict[key] = ...` in long-lived process without eviction/TTL.
- Event listeners/subscriptions added per request and never removed.
- Caches: flag any hand-rolled cache without max-size or TTL.

## 4. Blocking the main/event loop
| Stack | Patterns |
|---|---|
| Node | `fs.*Sync`, `child_process.execSync`, `crypto.pbkdf2Sync`, JSON.parse on multi-MB payloads — inside server handlers |
| C# | `.Result`, `.Wait()`, `Task.Run(...).Result` in async context (deadlock + thread starvation) |
| Python (async) | sync `requests`/file I/O inside `async def` without `to_thread` |
| UI apps | disk/network on UI thread |
- CLI/startup code may legitimately use sync I/O — scope to request/event paths.

## 5. Resource leakage
- Streams/connections/handles opened without `using`/`try-finally`/`with`/`defer` close.
- Pools: connections acquired and returned on the happy path only — check the error path.
