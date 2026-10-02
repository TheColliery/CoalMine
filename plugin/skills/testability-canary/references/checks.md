<!-- coalmine: verified 2026-06-12 · revalidate 90d · definition file for testability-canary -->
# Testability canary — concrete detection procedures

## 1. Hardcoded constructors (no seam to mock)
- Grep `new ` inside constructors/methods for I/O classes: `new HttpClient(`, `new SqlConnection(`, `new SmtpClient(`, `new S3Client(`, `new PrismaClient(` etc.
- Right shape: dependency arrives via constructor param / factory / DI container registration. The class should depend on an interface/abstract type where one exists.
- Flag only I/O or stateful deps — `new List<>()`/value objects are fine.

## 2. SRP violations blocking unit tests
- One class that parses + computes + persists + formats: count distinct reasons to change. >2 = flag with the split suggestion.
- Heuristic greps: a "Service" importing both an HTTP framework and a DB driver; methods >50 lines mixing I/O with branching logic.

## 3. Static / singleton dependencies
| Stack | Patterns |
|---|---|
| C# | `static` mutable fields · `Foo.Instance` · `ServiceLocator` · static `HttpClient` used directly in logic |
| TS/JS | module-level mutable singletons imported everywhere · `export const db = new Client()` consumed deep in logic |
| Python | module-global clients (`requests.Session()` at import time) · singletons via module state |
| Java/Kotlin | `getInstance()` chains · static utility classes wrapping I/O |
- Fix shape: pass the instance in; keep module-level only for pure/stateless helpers.

## 4. Time & environment coupling
- Direct calls inside business logic: `DateTime.Now`/`UtcNow` · `Date.now()`/`new Date()` · `time.time()`/`datetime.now()` · `process.env`/`os.environ` · `fs`/file paths.
- Fix shape: inject a clock (`IClock`, `() => Date`), read env/config once at the boundary and pass values down.
- Only flag where behavior depends on the value (scheduling, expiry, paths) — timestamps on log lines are fine.

## 5. Private logic gaps
- Complex branching (cyclomatic >5) inside private methods with no public seam: recommend extracting a pure function/module with direct unit tests.
- Do NOT recommend reflection or exposing privates — extraction only.

## Mock strategy column (output)
For each finding name the seam: constructor injection · interface extract · clock injection · boundary param · pure-function extract.
