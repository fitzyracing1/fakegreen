import { Draft, FileCtx, isMovedLine, norm, ScanCtx } from '../context';
import { DiffLine, Hunk } from '../types';
import { ASSERT, INLINE_TEST_LANGS, countMatches, STRONG, TRIVIAL, WEAK } from './patterns';
import { declStats } from './tests';

type Emit = (d: Draft) => void;

/** Test files, shared test helpers, and languages that embed tests in source. */
function inScope(f: FileCtx): boolean {
  if (f.kind !== 'code' || !ASSERT[f.lang]) return false;
  return f.isTest || f.isTestSupport || INLINE_TEST_LANGS.includes(f.lang);
}

export function assertCount(f: FileCtx, l: DiffLine): number {
  return countMatches(l.code, ASSERT[f.lang]);
}

export function isAssert(f: FileCtx, l: DiffLine): boolean {
  return assertCount(f, l) > 0;
}

/**
 * Per-file assertion-count floor: flag when this file's assertion count drops
 * vs its own base side. Adds in another file cannot hide it; verbatim moves
 * (the shared added/removed-line multiset) are discounted; a drop that comes
 * with lost test cases in the same file is left to `test-count-dropped`.
 */
export function assertionsRemoved(ctx: ScanCtx, emit: Emit) {
  const stats = declStats(ctx);
  for (const f of ctx.files) {
    if (!inScope(f) || f.diff.status === 'deleted') continue;
    if ((stats.get(f)?.lost ?? 0) > 0) continue; // already reported as dropped tests
    const removed = f.removed.filter((l) => isAssert(f, l));
    if (!removed.length) continue;
    const added = f.added.filter((l) => isAssert(f, l));
    const removedN = removed.reduce((n, l) => n + assertCount(f, l), 0);
    const addedN = added.reduce((n, l) => n + assertCount(f, l), 0);
    const addedHere = new Set(added.map((l) => norm(l.text)));
    const movedOut = removed
      .filter((l) => !addedHere.has(norm(l.text)) && isMovedLine(ctx, l))
      .reduce((n, l) => n + assertCount(f, l), 0);
    const lost = removedN - addedN - movedOut;
    if (lost <= 0) continue;
    const commented = removed.filter((r) => f.added.some((a) => a.comment && a.comment.includes(norm(r.text).slice(0, 40)))).length;
    const first = removed.find((l) => !isMovedLine(ctx, l)) ?? removed[0];
    let message = `Per-file assertion count dropped by ${lost} (${removedN} removed, ${addedN} added)`;
    if (commented) message += `; ${commented} commented out`;
    emit({
      ruleId: 'assertion-removed',
      severity: lost >= 3 || commented > 0 ? 'high' : 'medium',
      file: f, line: first, side: 'removed', message, snippet: first.text.trim(),
    });
  }
}

const STOP = new Set(['expect', 'assert', 'self', 'require', 'not', 'to', 'be', 'is', 'in', 'and', 'or', 'await', 'async', 'function', 'return', 'true', 'false', 'True', 'False', 'None', 'null', 'undefined', 'nil', 'new', 'this', 'it', 'ok']);

/** Identifier tokens that describe what an assertion is about (minus assertion vocabulary). */
function subjectTokens(l: DiffLine): Set<string> {
  const out = new Set<string>();
  for (const m of l.code.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const t = m[0];
    if (t.length < 2 || STOP.has(t) || /^(assert|expect|to[A-Z]|should|verify|is[A-Z])/.test(t)) continue;
    out.add(t);
  }
  return out;
}

function sharesSubject(a: DiffLine, b: DiffLine): boolean {
  const ta = subjectTokens(a);
  for (const t of subjectTokens(b)) if (ta.has(t)) return true;
  return false;
}

/** Index of the contiguous run of changed lines (no context in between) each line belongs to. */
function changeBlocks(h: Hunk): Map<DiffLine, number> {
  const m = new Map<DiffLine, number>();
  let block = 0;
  let inBlock = false;
  for (const l of h.lines) {
    if (l.kind === ' ') { if (inBlock) block++; inBlock = false; continue; }
    inBlock = true;
    m.set(l, block);
  }
  return m;
}

/** Idiomatic rewrites that are not weaker: `assert x == []` -> `assert not x`, `assert x is True` -> `assert x`. */
function equivalent(strong: DiffLine, weak: DiffLine): boolean {
  const s = strong.codeStr.trim();
  const w = weak.codeStr.trim();
  const falsy = /^assert\s+(.+?)\s*(?:==|is)\s*(?:\[\]|\{\}|""|''|0|None|False|set\(\)|\(\))\s*(?:,.*)?$/.exec(s);
  if (falsy && new RegExp('^assert\\s+not\\s+' + escapeRe(falsy[1]) + '\\s*(?:,.*)?$').test(w)) return true;
  const truthy = /^assert\s+(.+?)\s*(?:==|is)\s*True\s*(?:,.*)?$/.exec(s);
  if (truthy && new RegExp('^assert\\s+' + escapeRe(truthy[1]) + '\\s*(?:,.*)?$').test(w)) return true;
  return false;
}

function escapeRe(x: string): string {
  return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesAnyPat(code: string, pats: { re: RegExp }[] | undefined): boolean {
  return !!pats?.some((p) => p.re.test(code));
}

const LITERAL = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b(?:true|false|True|False|None|null|undefined|nil)\b/g;

export function normalizeLiterals(s: string): string {
  return s.replace(LITERAL, 'L').replace(/\s+/g, '');
}

export function assertionChanges(ctx: ScanCtx, emit: Emit) {
  for (const f of ctx.files) {
    if (!inScope(f) || f.diff.status === 'deleted') continue;
    for (const h of f.diff.hunks) analyseHunk(ctx, f, h, emit);
    // Trivially-true assertions anywhere in added test code.
    for (const l of f.added) {
      if (isMovedLine(ctx, l)) continue;
      if ((TRIVIAL[f.lang] ?? []).some((r) => {
        // Match on code WITH strings (to compare literals), but the call itself must not sit inside a string.
        const m = new RegExp(r.source, r.flags.replace('g', '')).exec(l.codeStr);
        return !!m && l.code.slice(m.index, m.index + 3) === l.codeStr.slice(m.index, m.index + 3);
      })) {
        emit({ ruleId: 'assertion-trivial', severity: 'high', file: f, line: l, side: 'added', message: 'Assertion can never fail', snippet: l.text.trim() });
      }
    }
  }
}

function analyseHunk(ctx: ScanCtx, f: FileCtx, h: Hunk, emit: Emit) {
  const removed = h.lines.filter((l) => l.kind === '-' && isAssert(f, l) && !isMovedLine(ctx, l));
  const added = h.lines.filter((l) => l.kind === '+' && isAssert(f, l) && !isMovedLine(ctx, l));
  if (!removed.length || !added.length) return;
  const used = new Set<DiffLine>();
  // 1) weakening: strong removed -> weak added, within the same contiguous change block
  const blocks = changeBlocks(h);
  const weakAdded = added.filter((l) => matchesAnyPat(l.code, WEAK[f.lang]) && !matchesAnyPat(l.code, STRONG[f.lang]));
  const strongRemoved = removed.filter((l) => matchesAnyPat(l.code, STRONG[f.lang]));
  for (const r of strongRemoved) {
    const b = blocks.get(r);
    const sameBlockWeak = weakAdded.filter((a) => !used.has(a) && blocks.get(a) === b);
    const sameBlockStrong = strongRemoved.filter((x) => blocks.get(x) === b);
    let w = sameBlockWeak.find((a) => sharesSubject(r, a));
    if (!w && sameBlockWeak.length === 1 && sameBlockStrong.length === 1) w = sameBlockWeak[0];
    if (!w) continue;
    used.add(w);
    used.add(r);
    if (equivalent(r, w)) continue;
    emit({
      ruleId: 'assertion-weakened', severity: 'high', file: f, line: w, side: 'added',
      message: 'Specific assertion replaced with a vague one',
      snippet: `- ${r.text.trim()}\n+ ${w.text.trim()}`,
    });
  }
  // 2) only the literal expected value changed
  for (const r of removed) {
    if (used.has(r)) continue;
    const key = normalizeLiterals(r.codeStr);
    const a = added.find((x) => !used.has(x) && normalizeLiterals(x.codeStr) === key && norm(x.codeStr) !== norm(r.codeStr));
    if (!a) continue;
    used.add(a);
    used.add(r);
    emit({
      ruleId: 'assertion-expected-changed', severity: 'low', file: f, line: a, side: 'added',
      message: 'Expected value in assertion changed; make sure the code (not the test) was wrong',
      snippet: `- ${r.text.trim()}\n+ ${a.text.trim()}`,
    });
  }
}
