<!-- coalmine: verified 2026-06-12 · revalidate 90d · definition file for telemetry-canary -->
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
