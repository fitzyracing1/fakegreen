import { RuleMeta } from '../types';

export const RULES: RuleMeta[] = [
  { id: 'test-file-deleted', severity: 'high', title: 'Test file deleted', description: 'A test file was deleted (and not moved/renamed elsewhere in the diff).' },
  { id: 'test-count-dropped', severity: 'high', title: 'Test cases removed', description: 'The net number of test cases (test()/it()/def test_/func Test/#[test]/@Test) went down.' },
  { id: 'test-skipped', severity: 'high', title: 'Test skipped', description: 'A skip was added: .skip, xit/xdescribe, @pytest.mark.skip/xfail, pytest.skip(), t.Skip(), #[ignore], @Disabled, @Ignore.' },
  { id: 'test-focused', severity: 'high', title: 'Test focused', description: '.only / fit / fdescribe silently disables every other test in the file or run.' },
  { id: 'test-conditional-skip', severity: 'low', title: 'Conditional skip added', description: 'A conditional skip (skipif, skipIf, importorskip, assumptions, `if testing.Short()`) was added.' },
  { id: 'assertion-removed', severity: 'medium', title: 'Assertions removed', description: 'Per-file assertion count dropped in a test or test-support file (expect/assert/t.Error/assert_eq!/assertEquals...). Checked per file so a drop cannot hide behind adds elsewhere.' },
  { id: 'assertion-weakened', severity: 'high', title: 'Assertion weakened', description: 'A specific assertion (toBe/toEqual/assert x == y/assertEquals) was replaced by a vague one (toBeTruthy/toBeDefined/assert x/assertNotNull).' },
  { id: 'assertion-trivial', severity: 'high', title: 'Trivially-true assertion', description: 'An assertion that can never fail was added (expect(true).toBe(true), assert True, assert!(true)).' },
  { id: 'assertion-expected-changed', severity: 'low', title: 'Expected value changed', description: 'Only the literal expected value of an assertion changed. Confirm the code was wrong, not the test.' },
  { id: 'suppression-added', severity: 'medium', title: 'Checker suppression added', description: '@ts-ignore, @ts-nocheck, @ts-expect-error, eslint-disable, # type: ignore, noqa, //nolint, #[allow(...)], @SuppressWarnings and friends. Blanket suppressions are medium, ones that name a specific rule are low, file/crate-wide ones are high.' },
  { id: 'coverage-exclusion-added', severity: 'low', title: 'Coverage exclusion added', description: 'istanbul/c8/v8 ignore, pragma: no cover, LCOV_EXCL, #[coverage(off)].' },
  { id: 'ci-failure-ignored', severity: 'high', title: 'CI failure ignored', description: '`|| true`, continue-on-error: true, allow_failure: true, --exit-zero, set +e on a test/lint/build command.' },
  { id: 'ci-step-removed', severity: 'high', title: 'CI/test step removed', description: 'A command that ran tests, lint or type checks was removed from CI config, scripts or package.json.' },
  { id: 'ci-step-disabled', severity: 'high', title: 'CI step disabled', description: 'A CI job/step was disabled with `if: false` or `when: never`.' },
  { id: 'test-script-neutered', severity: 'high', title: 'Test script neutered', description: 'The package.json test script was replaced with echo/true/exit 0.' },
  { id: 'test-exclusion-added', severity: 'medium', title: 'Tests excluded from run', description: '--passWithNoTests, -DskipTests, -x test, testPathIgnorePatterns, --ignore/--deselect, collect_ignore.' },
  { id: 'coverage-threshold-lowered', severity: 'high', title: 'Coverage threshold lowered', description: 'A coverage threshold (coverageThreshold, fail_under, --cov-fail-under, thresholds, jacoco minimum...) was lowered or removed.' },
  { id: 'typecheck-weakened', severity: 'medium', title: 'Type checking weakened', description: 'tsconfig strict flags turned off, mypy ignore_errors / strict = false, pyright typeCheckingMode off.' },
  { id: 'lint-rule-disabled', severity: 'low', title: 'Lint rule disabled', description: 'A lint rule was switched to "off"/0 in an ESLint config.' },
  { id: 'test-env-special-case', severity: 'high', title: 'Test-environment special-casing', description: 'Non-test source code branches on being under test (NODE_ENV === "test", JEST_WORKER_ID, "pytest" in sys.modules, testing.Testing(), cfg!(test)) or on CI.' },
  { id: 'error-swallowed', severity: 'medium', title: 'Error swallowed', description: 'New empty catch / except: pass / .catch(() => {}) / if err != nil {}.' },
  { id: 'ignore-comment-added', severity: 'low', title: 'fakegreen-ignore added', description: 'An inline fakegreen-ignore comment was added. Always reported so reviewers see what was waived.' },
];

export const RULE_IDS = new Set(RULES.map((r) => r.id));

export function ruleMeta(id: string): RuleMeta {
  const r = RULES.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown rule ${id}`);
  return r;
}
