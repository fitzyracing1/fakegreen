# fakegreen

[![npm](https://img.shields.io/npm/v/fakegreen.svg)](https://www.npmjs.com/package/fakegreen)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/node/v/fakegreen.svg)](https://nodejs.org)

**One command scans your agent's diff and flags every way it faked a green build.**

### Who it's for

- Teams shipping with Claude Code, Codex, Cursor, Gemini CLI, or Aider who want a hard stop on fake-green diffs
- Maintainers who want a deterministic CI / pre-commit / end-of-turn tripwire — no LLM, no API key, zero runtime deps
- Anyone tired of agents that `.skip` tests, weaken assertions, or append `|| true` and then claim *"All tests pass ✅"*

⭐ **If fakegreen catches a fake-green commit for you, [star the repo](https://github.com/fitzyracing1/fakegreen)** — it helps other teams find the tripwire.

### Try it in 30 seconds

```sh
npx fakegreen
```

No install. Needs Node.js 18+ and `git` on your `PATH`. Pin with `npm i -D fakegreen` when you're ready.

| | LLM code review | fakegreen |
|---|---|---|
| **Speed & cost** | Seconds–minutes, API spend | Usually **under 100 ms**, free, offline |
| **Determinism** | Can vary; easy to talk around | Same answer every time |
| **Setup** | API key + prompts | Zero runtime deps — `npx fakegreen` |

---

Coding agents (Claude Code, Codex, Cursor, Gemini CLI, Aider) are rewarded for "tests pass". Sometimes they get there by
deleting the test, slapping `.skip` on it, swapping `toBe(42)` for `toBeDefined()`, adding `@ts-ignore`, teaching the code
to detect `NODE_ENV === 'test'`, or appending `|| true` to the CI step. Then they say *"All tests pass ✅"*.

`fakegreen` reads the git diff and catches those moves. It is **deterministic**, needs **no LLM and no API key**, has
**zero runtime dependencies**, and usually finishes in **under 100 ms**. Hook it into your agent's end-of-turn event so the
agent gets blocked and told what it did *before* it can claim it's done.

<p align="center"><img src="docs/demo.gif" alt="fakegreen catching a fake-green agent commit" width="760"></p>

## Demo

The recording above ([`docs/demo.cast`](docs/demo.cast), [`docs/demo.gif`](docs/demo.gif), [`docs/demo.png`](docs/demo.png))
is a real run against a sample repo built by [`scripts/make-demo-repo.sh`](scripts/make-demo-repo.sh). An honest commit adds a
cart module with tests. Then an "agent" commit titled `fix: make the test suite pass` skips one test, weakens an
assertion, deletes a test file, adds `@ts-ignore` plus a `NODE_ENV === 'test'` shortcut, and appends `|| true` to CI:

```text
$ fakegreen --last-commit
fakegreen · last commit (8797f43) · 4/4 files · +5 −13

   HIGH  .github/workflows/ci.yml:10  ci-failure-ignored
         Failure ignored with `|| true` on a test/check command
         │ + - run: npm test || true

   MED   src/cart.ts:4  suppression-added
         Checker silenced with @ts-ignore
         │ + // @ts-ignore

   HIGH  src/cart.ts:5  test-env-special-case
         Non-test code branches on the test env (NODE_ENV === 'test'); tests skip the real path
         │ + if (process.env.NODE_ENV === 'test') return items.length ? 8 : 0;

   HIGH  test/cart.test.ts:9  test-skipped
         Test skipped with .skip
         │ + it.skip('applies SAVE10', () => {

   HIGH  test/cart.test.ts:14  assertion-weakened
         Specific assertion replaced with a vague one
         │ - expect(total([])).toBe(0);
         │ + expect(total([])).toBeDefined();

   HIGH  test/checkout.test.ts  test-file-deleted
         Test file deleted (2 test cases removed)
         │ - it('rejects negative quantities', () => {

  5 high · 1 medium · 0 low  ✖ fake green detected (fail-on: high) · 41ms
```

Exit code `1`. Replay it with `asciinema play docs/demo.cast`, or rebuild it with
`scripts/make-demo-repo.sh /tmp/fakegreen-demo && cd /tmp/fakegreen-demo && fakegreen --last-commit`.

## Install

```sh
npx fakegreen                 # run once, no install
npm i -D fakegreen            # or pin it in a project
```

You need Node.js 18 or newer and `git` on your `PATH`.

## Usage

```sh
fakegreen                     # uncommitted + staged changes vs HEAD, plus untracked files (default)
fakegreen --staged            # only what is staged (good for pre-commit)
fakegreen --base origin/main  # everything since the merge-base with main, including uncommitted work (good for PRs)
fakegreen --last-commit       # just HEAD~1..HEAD
fakegreen --commit <sha>      # one specific commit
git diff main... | fakegreen --diff -   # any unified diff from stdin or a file

fakegreen --json              # machine-readable findings
fakegreen --sarif > fg.sarif  # SARIF 2.1.0 for GitHub code scanning and IDEs
fakegreen --format github     # ::error annotations for GitHub Actions
fakegreen --fail-on medium    # exit 1 on medium or higher (default: high; `none` never fails)
fakegreen --min-severity medium  # hide low-severity findings
fakegreen rules               # list every rule
```

Exit codes: `0` clean (or below `--fail-on`), `1` findings at or above `--fail-on`, `2` usage or git error.

Each finding includes a severity, `file:line`, a rule id, a short explanation, and the offending `+`/`-` lines.
`--json` output looks like this:

```json
{
  "tool": "fakegreen", "version": "0.1.0", "source": "last commit (8797f43)", "failed": true,
  "summary": { "high": 5, "medium": 1, "low": 0, "total": 6, "files": 4, "analyzedFiles": 4, "added": 5, "removed": 13 },
  "findings": [
    { "ruleId": "test-skipped", "severity": "high", "file": "test/cart.test.ts", "side": "added", "line": 9,
      "message": "Test skipped with .skip", "snippet": "+ it.skip('applies SAVE10', () => {" }
  ]
}
```

## What it checks

It looks **only at added and removed lines** in the diff, so old code isn't re-flagged. Comments and string literals
are lexed out before matching, which keeps `".skip"` inside a string or a comment from triggering anything. Lines that
were only *moved* (renames, file splits, reordering) are ignored. A test file that moved, or whose tests reappear in
another file, does not count as a deletion. Supported languages: **JavaScript/TypeScript, Python, Go, Rust, Java**
(plus Kotlin test annotations), as well as CI and config files: GitHub Actions, GitLab CI, `package.json`, `tsconfig`,
jest/vitest/c8/nyc configs, `pyproject.toml`/`setup.cfg`/`tox.ini`/`.coveragerc`, Maven/Gradle, Makefiles, and
husky/shell hooks.

| Rule | Default | What it catches |
|---|---|---|
| `test-file-deleted` | high | A test file was deleted (and not moved/renamed elsewhere in the diff). |
| `test-count-dropped` | high | The net number of test cases (test()/it()/def test_/func Test/#[test]/@Test) went down. |
| `test-skipped` | high | A skip was added: .skip, xit/xdescribe, @pytest.mark.skip/xfail, pytest.skip(), t.Skip(), #[ignore], @Disabled, @Ignore. |
| `test-focused` | high | .only / fit / fdescribe silently disables every other test in the file or run. |
| `test-conditional-skip` | low | A conditional skip (skipif, skipIf, importorskip, assumptions, `if testing.Short()`) was added. |
| `assertion-removed` | medium | Net assertion count in a test file dropped (expect/assert/t.Error/assert_eq!/assertEquals...). |
| `assertion-weakened` | high | A specific assertion (toBe/toEqual/assert x == y/assertEquals) was replaced by a vague one (toBeTruthy/toBeDefined/assert x/assertNotNull). |
| `assertion-trivial` | high | An assertion that can never fail was added (expect(true).toBe(true), assert True, assert!(true)). |
| `assertion-expected-changed` | low | Only the literal expected value of an assertion changed. Confirm the code was wrong, not the test. |
| `suppression-added` | medium | @ts-ignore, @ts-nocheck, @ts-expect-error, eslint-disable, # type: ignore, noqa, //nolint, #[allow(...)], @SuppressWarnings and friends. Blanket suppressions are medium, ones that name a specific rule are low, file/crate-wide ones are high. |
| `coverage-exclusion-added` | low | istanbul/c8/v8 ignore, pragma: no cover, LCOV_EXCL, #[coverage(off)]. |
| `ci-failure-ignored` | high | `\|\| true`, continue-on-error: true, allow_failure: true, --exit-zero, set +e on a test/lint/build command. |
| `ci-step-removed` | high | A command that ran tests, lint or type checks was removed from CI config, scripts or package.json. |
| `ci-step-disabled` | high | A CI job/step was disabled with `if: false` or `when: never`. |
| `test-script-neutered` | high | The package.json test script was replaced with echo/true/exit 0. |
| `test-exclusion-added` | medium | --passWithNoTests, -DskipTests, -x test, testPathIgnorePatterns, --ignore/--deselect, collect_ignore. |
| `coverage-threshold-lowered` | high | A coverage threshold (coverageThreshold, fail_under, --cov-fail-under, thresholds, jacoco minimum...) was lowered or removed. |
| `typecheck-weakened` | medium | tsconfig strict flags turned off, mypy ignore_errors / strict = false, pyright typeCheckingMode off. |
| `lint-rule-disabled` | low | A lint rule was switched to "off"/0 in an ESLint config. |
| `test-env-special-case` | high | Non-test source code branches on being under test (NODE_ENV === "test", JEST_WORKER_ID, "pytest" in sys.modules, testing.Testing(), cfg!(test)) or on CI. |
| `error-swallowed` | medium | New empty catch / except: pass / .catch(() => {}) / if err != nil {}. |
| `ignore-comment-added` | low | An inline fakegreen-ignore comment was added. Always reported so reviewers see what was waived. |

Severity is graded where it matters. For example, a blanket `# type: ignore` is medium, a targeted
`# type: ignore[attr-defined]` is low, and a file-wide `// @ts-nocheck` is high. `|| true` on `npm test` is high, while
`|| true` on `rm -rf build` is low. A conditional `skipif(sys.platform == "win32")` is low, but `skipif(True)` is high.

**Skipped automatically:** Markdown/docs, lockfiles, vendored and `node_modules` code, generated files, and
`fixtures/` / `testdata/` directories.

## Stop the agent in its tracks: end-of-turn hooks

Claude Code, Codex and Gemini CLI can run a command when the agent finishes its turn and **block** the stop, sending
the command's feedback back to the model. `fakegreen hook` speaks each agent's protocol. If it finds something at or
above `--fail-on`, the agent is told exactly what it faked and asked to fix it, or to stop and explain to you why the
change is intentional.

```sh
npx fakegreen install claude     # .claude/settings.json   (--local → settings.local.json, --global → ~/.claude)
npx fakegreen install codex      # .codex/hooks.json       (--global → ~/.codex/hooks.json)
npx fakegreen install gemini     # .gemini/settings.json   (--global → ~/.gemini/settings.json)
```

The installer shows a diff of the config change and asks before writing. Pass `--yes` to skip the prompt or
`--dry-run` to only preview. It merges into existing config, is idempotent, and refuses to touch a file that isn't
valid JSON.

<details><summary><b>Claude Code</b>: <code>.claude/settings.json</code></summary>

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npx --yes fakegreen hook --agent claude",
            "timeout": 120,
            "statusMessage": "fakegreen: checking the diff for fake-green changes"
          }
        ]
      }
    ]
  }
}
```
On findings, the hook prints `{"decision":"block","reason":"..."}` and Claude keeps working with the reason as its
next instruction. ([Claude Code hooks docs](https://code.claude.com/docs/en/hooks))
</details>

<details><summary><b>Codex</b>: <code>.codex/hooks.json</code></summary>

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npx --yes fakegreen hook --agent codex",
            "timeout": 120,
            "statusMessage": "fakegreen: checking the diff for fake-green changes"
          }
        ]
      }
    ]
  }
}
```
On findings, the hook prints `{"decision":"block","reason":"..."}`, and Codex continues with the reason as a new
prompt. Codex only loads project hooks when the project's `.codex/` layer is trusted, and it asks you to review and
trust each new hook (`/hooks`) before running it.
([Codex hooks docs](https://developers.openai.com/codex/hooks))
</details>

<details><summary><b>Gemini CLI</b>: <code>.gemini/settings.json</code></summary>

```json
{
  "hooks": {
    "AfterAgent": [
      {
        "hooks": [
          {
            "name": "fakegreen",
            "type": "command",
            "command": "npx --yes fakegreen hook --agent gemini",
            "timeout": 120000,
            "description": "Block the turn when the diff fakes a green build"
          }
        ]
      }
    ]
  }
}
```
On findings, the hook prints `{"decision":"deny","reason":"..."}`, which makes Gemini retry the turn with the reason
as feedback. Gemini timeouts are in milliseconds. ([Gemini CLI hooks reference](https://geminicli.com/docs/hooks/reference/))
</details>

**Cursor and Aider.** Neither has a blocking end-of-turn hook that fakegreen targets yet. Use the pre-commit hook and the
agent skill below, or run `npx fakegreen --base main` before you accept the agent's work. Aider skips git hooks by
default, so either enable them with `--git-commit-verify` or run `npx fakegreen --last-commit` after each Aider commit.

**Hook details:**
- **Clean diffs produce no output.** fakegreen exits 0 silently.
- **Errors fail open.** If fakegreen itself breaks, your agent is never stuck.
- **Loop guard.** If the agent was already blocked once (`stop_hook_active`) and the findings haven't changed, the
  second stop is allowed and a warning is shown to you. That way an agent that has explained an intentional change
  isn't trapped.
- **Choosing the diff.** By default the hook scans uncommitted work vs `HEAD`. If your agent commits as it goes, scan
  the whole branch instead: `fakegreen install claude --hook-args "--base origin/main"`.
- **Before the npm release, or with a local checkout:** point hooks at the build directly with
  `--command "node /path/to/fakegreen/dist/cli.js"`.

## Pre-commit, CI and the agent skill

```sh
npx fakegreen install pre-commit     # git pre-commit hook (respects core.hooksPath and .husky/pre-commit)
npx fakegreen install github-action  # writes .github/workflows/fakegreen.yml
npx fakegreen install skill          # copies SKILL.md to .claude/skills/fakegreen/ (--global → ~/.claude/skills)
```

**pre-commit framework** (`.pre-commit-config.yaml`):

```yaml
- repo: https://github.com/fitzyracing1/fakegreen
  rev: v0.1.0
  hooks:
    - id: fakegreen
```

**GitHub Actions.** Findings show up as annotations on the PR. See [`examples/github-workflow.yml`](examples/github-workflow.yml):

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- uses: fitzyracing1/fakegreen@v0.1.1   # composite action; inputs: version, base, fail-on, args
  with:
    fail-on: high
```

**Agent skill.** [`skills/fakegreen/SKILL.md`](skills/fakegreen/SKILL.md) tells agents never to skip, delete or weaken
tests to get green, never to special-case the test environment, and to run `npx fakegreen` before claiming they're
done. It works as a Claude Code skill. Paste it into `AGENTS.md`, `GEMINI.md`, `.cursor/rules` or `CONVENTIONS.md` for
other agents.

## Configuration

Add an optional `.fakegreenrc.json`, a `.fakegreenrc`, or a `"fakegreen"` key in `package.json`:

```json
{
  "rules": {
    "coverage-exclusion-added": "off",
    "suppression-added": "low",
    "error-swallowed": "high"
  },
  "ignore": ["scripts/**", "**/generated/**"],
  "testPatterns": ["e2e/**/*.ts"],
  "failOn": "high",
  "untracked": true
}
```

| Key | Meaning |
|---|---|
| `rules` | Per-rule `"off"` or a severity override (`"high"`, `"medium"`, `"low"`). |
| `ignore` | Globs for files to skip entirely. |
| `testPatterns` | Extra globs for files that should be treated as tests. |
| `failOn` | Default for `--fail-on`. |
| `untracked` | Include untracked files in working-tree scans (default `true`). |

### Allowing an intentional change

Add a `fakegreen-ignore` comment on the line, or on the line above it. You can name rules, and adding a reason is a
good idea:

```ts
// fakegreen-ignore test-skipped -- flaky upstream API, tracked in #123
it.skip('talks to the payments sandbox', async () => { ... });
```

```python
except Exception:  # fakegreen-ignore error-swallowed: best-effort telemetry
    pass
```

For removed lines (like a deleted assertion), put the comment anywhere among the added lines of the same hunk.
`fakegreen-ignore-file` waives a whole file. Every ignore comment is itself reported as a **low** finding
(`ignore-comment-added`), so a reviewer still sees what was waived. The hook's feedback explicitly tells agents not to
add waivers themselves. If you don't trust your agent with them at all, set
`"rules": { "ignore-comment-added": "high" }` so any new waiver blocks the turn and gets surfaced to you.

## FAQ

**Why not just ask an LLM to review the diff?**
LLM reviewers are slow, cost money, need keys, and are easy to talk around. fakegreen runs in milliseconds, gives the
same answer every time, and works offline and in CI. Use both if you like. fakegreen is the cheap tripwire that runs on
every turn.

**Will it flag my legitimate refactors?**
Sometimes, and that's the point of a review signal. Moves and renames are recognised, and so are tests that move
between files and migrations from one CI command to another. In a dogfood run over the last 100 commits of 12 popular
human-maintained repos (express, zod, vite, requests, flask, httpx, gin, cobra, ripgrep, clap, gson, spring-petclinic;
1,200 commits), **34 high-severity findings** came up, about one every 35 commits. Almost all were real test removals
(reverts, feature removals) that a reviewer would want to see anyway. Medium and low findings are context. The
default `--fail-on high` only blocks on the high ones.

**Does it understand my code (AST)?**
No. It uses a small lexer (strings and comments) plus targeted patterns on changed lines. That's what keeps it fast,
dependency-free, and multi-language. See the limitations below.

**Can the agent just disable fakegreen?**
It could edit the hook config, but that edit shows up in your diff. Combine the hook with the pre-commit hook or the
GitHub Action, and treat changes to `.claude/`, `.codex/`, `.gemini/` or `.fakegreenrc.json` like changes to CI.

**Does it send my code anywhere?**
No. It never makes a network call. It shells out to `git` and nothing else.

## Known limitations

- Heuristic, line-based analysis with no AST. Unusual formatting (a test declaration split across lines, regex
  literals that contain quotes, macros) can cause misses or occasional false positives.
- Test-count compensation is diff-wide. If an agent deletes one test and adds an unrelated trivial one, the count
  doesn't drop, though a weakened or trivial assertion is still caught by the assertion rules.
- Only JS/TS, Python, Go, Rust and Java/Kotlin source are analysed. Ruby, C#, C/C++, PHP, Swift and custom test DSLs
  are not, though their CI config changes still are.
- The hook's default diff is uncommitted work vs `HEAD`. Use `--hook-args "--base origin/main"` if the agent commits
  during the session.
- `fakegreen-ignore-file` is only honoured when it appears in the diff's added lines or context.

## Support & services

fakegreen is MIT-licensed and the CLI, hooks, pre-commit hook and GitHub Action will stay free. I'm Joshua Almeida, and I
build and maintain it on my own. If it saves you from merging a "fixed" test suite that was really a deleted one, here
are three ways to help:

**Sponsor the project.** [GitHub Sponsors](https://github.com/sponsors/fitzyracing1) pays for the time I spend on new
rules, new languages and false-positive fixes. Every sponsorship helps, small ones included.

**fakegreen for Teams (early access waitlist).** I'm looking into a hosted version for teams running AI coding agents
across many repos. The plan is a GitHub App that posts findings as PR comments and check runs, one shared policy for the
whole org, and a history of fake-green incidents grouped by agent and repo. **Nothing is built yet.** If your team would
use it, [join the waitlist](https://fitzyracing1.github.io/fakegreen/#teams) and tell me what you'd need, because that
decides what gets built.

**Consulting & custom rules.** If your team is rolling out Claude Code, Codex, Gemini CLI, Cursor or Aider, I can
help you write fakegreen rules for your own codebase, test conventions and CI setup, and wire up guardrails (hooks,
pre-commit, CI gates) that agents can't quietly route around. Email
[fitzyracing1@gmail.com](mailto:fitzyracing1@gmail.com?subject=fakegreen%20consulting).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). New detectors need a true-positive fixture **and** a false-positive guard.

## License

[MIT](LICENSE) © 2026 Joshua Almeida
