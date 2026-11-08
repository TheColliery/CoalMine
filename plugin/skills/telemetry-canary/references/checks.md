<!-- coalmine: verified 2026-09-22 · revalidate 90d · definition file for telemetry-canary -->
# Telemetry canary — concrete detection procedures

## 1. Empty / silent catch — grep first, then confirm by reading
| Stack | Patterns to grep |
|---|---|
| C#/.NET | `catch { }` · `catch (Exception) { }` · `catch (Exception ex) { }` with no `_logger`/throw inside |
| TS/JS | `catch {}` · `catch (e) {}` · `.catch(() => {})` · `.catch(console.log)` (downgrades errors) |
| Python | `except: pass` · `except Exception: pass` · bare `except:` |
| Go | `_ = err` · `if err != nil { }` empty body · err assigned then never checked |

Confirm: a catch is only SILENT if nothing inside logs with stack, rethrows, or sets a failure result.

## 2. Unstructured logs (server/API code only)
- String concatenation/interpolation into log calls: `log.info('user ' + id + ' did X')`, `$"..."`, f-strings.
- Structured replacements: .NET `ILogger` message templates (`_logger.LogInformation("User {UserId}", id)`) / Serilog · TS `pino`/`winston` object form (`log.info({userId}, 'did X')`) · Python `structlog` or `logger.info(..., extra={})` · Go `log/slog` / `zap` fields.
- CLI tools writing human output to stdout are NOT findings — scope this to services.

## 3. No correlation/trace ID across boundaries
- Outbound HTTP/gRPC/queue publish without propagating context: look for missing W3C `traceparent` header / OTel propagation (`propagation.inject`, .NET `Activity.Current`, Python `opentelemetry.propagate`).
- New thread/task/queue consumer that starts logging without the parent's correlation ID.

## 4. Missing metrics on critical transactions
- Identify money/auth/data-loss paths (checkout, login, write/delete APIs). Each should touch a counter or histogram (OTel `Counter`/`Histogram`, Prometheus client, StatsD).
- Error paths that increment nothing are invisible in dashboards — flag.

## 5. No stack traces
| Stack | Wrong | Right |
|---|---|---|
| TS/JS | `logger.error(e.message)` | `logger.error(e)` / `logger.error({err: e}, msg)` |
| Python | `logger.error(str(e))` | `logger.exception(...)` or `exc_info=True` |
| C# | `_logger.LogError(ex.Message)` | `_logger.LogError(ex, "msg")` |
| Go | `log.Error(err.Error())` only | wrap with `%w`, log with stack lib |

## 6. Sensitive data in logs — grep for candidates, then confirm by reading
The canary reads; a grep only finds candidates.

| Item | What to look for |
|---|---|
| Sink | `console.log/info/warn/error/debug` · `logger.*` · `log.*` |
| Argument | a request body (`await request.text()`, `request.json()`, `request.body`, or a variable assigned from them) · the whole `request.headers`, or `headers.get('authorization')`, `headers.get('cookie')` or `headers.get('set-cookie')` · an identifier named like model text (`prompt`, `messages`, `completion`, `output`, `responseText`, `generated`) |
| Where | a file the runtime loads: a `wrangler.toml`, `wrangler.jsonc` or `wrangler.json` in the package root, or an `export default { fetch` / `addEventListener('fetch'` shape; other server code by the server-only rule in section 2 |
| Worker row | `[observability] enabled = true` (TOML) or `"observability": { "enabled": true }` (JSON) ships logs to Cloudflare: HIGH. Without it only `wrangler tail` shows them: MEDIUM |
| Other runtimes | a log shipper or drain the repo configures: HIGH; none shown: MEDIUM |
| Secret value | a confirmed token or key value in the logged argument is CRITICAL whatever the config says |

The class is any log shipped off the box (Workers Logs, CloudWatch, Datadog, a log drain); the Worker row is the stack with a config signal for severity.

False-positive classes, confirm each by reading before reporting:
1. Lengths and presence, not content: `body.length`, `headers.has('Authorization')`, a status code.
2. Redacted output: a `redact(...)` or `mask(...)` wrapper, or a logger configured with redaction paths.
3. Look-alike names: `promptId`, `promptCount`, `outputPath`, `messagesSent`.
4. Not a runtime file: tests, fixtures, local scripts, a CLI's stdout (the server-only rule).
5. Metadata only: `request.method`, `request.url` path. A full URL with query parameters is NOT clean (tokens ride there): report SUSPECTED.
