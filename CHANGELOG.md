# Changelog

## Unreleased

### Changed
- Provider error messages now name the likely cause and a concrete fix (chat error card, Settings → Providers "Test connection", headless `error`). Covers missing/invalid keys (401), forbidden (403), out of credits / `insufficient_quota`, unknown model, wrong base URL (404 without a model message), rate limits (429), context too long, server errors (5xx), and network failures (offline, DNS, timeout, connection refused, proxy, blocked port).
- "No provider or model configured" now shows a setup error that points to Settings → Providers / Models.

### Security
- API keys and tokens (`sk-…`, `sk-ant-…`, `Bearer …`, `api_key` / `x-api-key` / `authorization` values, `?key=` query params) are masked in error details, chat error messages, and headless output.

### Fixed
- `pawn-headless run` now reports a turn that ended in a provider error card as `ok: false` / `outcome: "error"` and exits with `1` (previously `ok: true`, exit `0`).

### Headless exit codes
- `0` success · `1` the run or eval failed (including provider errors) or crashed · `2` usage or setup error before any turn ran (no usable provider, empty prompt, no tasks matched, unknown command).
