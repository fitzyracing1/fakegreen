import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { parseDiff, unquote } from '../src/diff';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '..', '..', 'test', 'fixtures', name), 'utf8');

test('parses modified, added, deleted and renamed files', () => {
  const files = parseDiff(fixture('mixed.diff'));
  const byPath = Object.fromEntries(files.map((f) => [f.newPath ?? f.oldPath, f]));
  assert.equal(files.length, 5);
  assert.equal(byPath['src/app.ts'].status, 'modified');
  assert.equal(byPath['src/new.ts'].status, 'added');
  assert.equal(byPath['tests/old.test.ts'].status, 'deleted');
  assert.equal(byPath['tests/b.test.ts'].status, 'renamed');
  assert.equal(byPath['tests/b.test.ts'].oldPath, 'tests/a.test.ts');
  assert.equal(byPath['tests/b.test.ts'].similarity, 100);
  assert.equal(byPath['img/logo.png'].binary, true);
});

test('tracks old/new line numbers through a hunk', () => {
  const [app] = parseDiff(fixture('mixed.diff'));
  const added = app.hunks[0].lines.filter((l) => l.kind === '+');
  const removed = app.hunks[0].lines.filter((l) => l.kind === '-');
  assert.deepEqual(added.map((l) => l.newNo), [11]);
  assert.deepEqual(removed.map((l) => l.oldNo), [11]);
  assert.equal(added[0].text, '  return computeTotal(items) ?? 0;');
});

test('ignores "\\ No newline at end of file" markers', () => {
  const files = parseDiff(fixture('mixed.diff'));
  const n = files.find((f) => f.newPath === 'src/new.ts')!;
  assert.equal(n.hunks[0].lines.length, 2);
});

test('parses CRLF-terminated diff output (Git for Windows)', () => {
  const lf = fixture('mixed.diff').replace(/\r\n/g, '\n');
  const crlf = lf.replace(/\n/g, '\r\n');
  const a = parseDiff(lf);
  const b = parseDiff(crlf);
  assert.ok(a.length > 0);
  assert.deepEqual(b, a);
  assert.ok(!JSON.stringify(b).includes('\\r'));
});

test('handles quoted paths with spaces and unicode', () => {
  const d = [
    'diff --git "a/dir/my file.ts" "b/dir/my file.ts"',
    'index 1..2 100644',
    '--- "a/dir/my file.ts"',
    '+++ "b/dir/my file.ts"',
    '@@ -1 +1 @@',
    '-a',
    '+b',
    '',
  ].join('\n');
  const [f] = parseDiff(d);
  assert.equal(f.newPath, 'dir/my file.ts');
  assert.equal(unquote('"caf\\303\\251.ts"'), 'café.ts');
});

test('does not mistake content lines starting with --- or +++ for headers', () => {
  const d = [
    'diff --git a/x.md b/x.md',
    '--- a/x.md',
    '+++ b/x.md',
    '@@ -1,2 +1,2 @@',
    '---- old',
    '++++ new',
    ' ctx',
    '',
  ].join('\n');
  const [f] = parseDiff(d);
  assert.equal(f.hunks[0].lines.length, 3);
  assert.equal(f.hunks[0].lines[0].text, '--- old');
  assert.equal(f.hunks[0].lines[1].text, '+++ new');
});

test('parses multiple hunks and empty files', () => {
  const d = [
    'diff --git a/e.txt b/e.txt',
    'new file mode 100644',
    'index 0000000..e69de29',
    'diff --git a/m.py b/m.py',
    '--- a/m.py',
    '+++ b/m.py',
    '@@ -1,1 +1,1 @@',
    '-x = 1',
    '+x = 2',
    '@@ -10,0 +11,1 @@ def f():',
    '+y = 3',
    '',
  ].join('\n');
  const files = parseDiff(d);
  assert.equal(files.length, 2);
  assert.equal(files[0].status, 'added');
  assert.equal(files[0].newPath, 'e.txt');
  assert.equal(files[1].hunks.length, 2);
  assert.equal(files[1].hunks[1].lines[0].newNo, 11);
});
