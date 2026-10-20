# fakegreen

This extension gives you **fakegreen**, a deterministic (zero-LLM) checker that flags ways a code
change can fake a passing build: skipped/focused/deleted tests, weakened or removed assertions,
expected values edited to match wrong output, and CI/build config forced green
(`continue-on-error`, `|| true`, `--passWithNoTests`, coverage thresholds lowered, ...).

## When to use it

Before you say work is done, tests pass, or the build is green, scan your own changes:

- MCP tool `fakegreen_scan` (preferred): scans the current workspace. Options: `base`
  (e.g. `origin/main`), `staged`, `last_commit`, `min_severity`.
- MCP tool `fakegreen_rules`: lists every rule.
- Shell fallback: `npx --yes fakegreen --json` (add `--base origin/main` for a whole branch).

Slash commands: `/fakegreen:scan [base-ref]`, `/fakegreen:branch`, `/fakegreen:rules`.

## How to act on findings

- Treat every `high` finding as a real problem. Fix the code, not the test. Restore skipped or
  deleted tests and the original assertions.
- If a finding is a genuine, intended change (e.g. a test removed with its feature), say so
  explicitly to the user instead of hiding it. Never add suppressions just to silence fakegreen.
- Exit codes: 0 clean, 1 findings at/above `--fail-on`, 2 usage or git error.
