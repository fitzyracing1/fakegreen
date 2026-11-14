import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ids, lines, only, scanChange, scanEdit } from './helpers';

const T = lines(
  "describe('user', () => {",
  "  it('loads', async () => {",
  '    const u = await load(1);',
  "    expect(u.name).toBe('Ada');",
  '    expect(u.age).toEqual(36);',
  '    expect(u.tags).toHaveLength(2);',
  '  });',
  '});',
);

describe('assertion-weakened', () => {
  test('toBe -> toBeTruthy / toEqual -> toBeDefined', () => {
    const f = scanEdit('src/user.test.ts', T, T.replace("expect(u.name).toBe('Ada');", 'expect(u.name).toBeTruthy();').replace('expect(u.age).toEqual(36);', 'expect(u.age).toBeDefined();'));
    const w = only(f, 'assertion-weakened');
    assert.equal(w.length, 2);
    assert.equal(w[0].severity, 'high');
    assert.match(w[0].snippet!, /^- .*toBe\('Ada'\);\n\+ .*toBeTruthy/);
  });

  test('python assert x == y -> assert x', () => {
    const a = 'def test_u():\n    u = load(1)\n    assert u.name == "Ada"\n';
    const f = scanEdit('tests/test_u.py', a, a.replace('assert u.name == "Ada"', 'assert u.name'));
    assert.deepEqual(ids(f), ['assertion-weakened']);
  });

  test('python assertEqual -> assertIsNotNone', () => {
    const a = 'class T(unittest.TestCase):\n    def test_u(self):\n        self.assertEqual(load(1).name, "Ada")\n';
    const f = scanEdit('tests/test_u.py', a, a.replace('self.assertEqual(load(1).name, "Ada")', 'self.assertIsNotNone(load(1))'));
    assert.deepEqual(ids(f), ['assertion-weakened']);
  });

  test('java assertEquals -> assertNotNull, go assert.Equal -> assert.NotNil, rust assert_eq! -> assert!', () => {
    const j = 'class UTest {\n  @Test\n  void u() {\n    assertEquals("Ada", load(1).name);\n  }\n}\n';
    assert.deepEqual(ids(scanEdit('src/test/java/UTest.java', j, j.replace('assertEquals("Ada", load(1).name);', 'assertNotNull(load(1));'))), ['assertion-weakened']);
    const g = 'package u\nfunc TestU(t *testing.T) {\n\tassert.Equal(t, "Ada", Load(1).Name)\n}\n';
    assert.deepEqual(ids(scanEdit('u/u_test.go', g, g.replace('assert.Equal(t, "Ada", Load(1).Name)', 'assert.NotNil(t, Load(1))'))), ['assertion-weakened']);
    const r = '#[test]\nfn u() {\n    assert_eq!(load(1).name, "Ada");\n}\n';
    assert.deepEqual(ids(scanEdit('tests/u.rs', r, r.replace('assert_eq!(load(1).name, "Ada");', 'assert!(load(1).is_ok());'))), ['assertion-weakened']);
  });

  test('idiomatic python rewrites are not weakening', () => {
    const a = 'def test_l():\n    leaks = run()\n    assert leaks == []\n';
    assert.deepEqual(ids(scanEdit('tests/test_l.py', a, a.replace('assert leaks == []', 'assert not leaks'))), []);
  });

  test('strengthening an assertion is fine', () => {
    const weak = T.replace("expect(u.name).toBe('Ada');", 'expect(u.name).toBeTruthy();');
    assert.deepEqual(ids(scanEdit('src/user.test.ts', weak, T)), []);
  });

  test('restructured go test (Equal -> NoError on a different call) is not weakening', () => {
    const g = 'package u\nfunc TestU(t *testing.T) {\n\tinfo, _ := os.Stat(dst)\n\tassert.Equal(t, info.Mode().Perm(), mode)\n}\n';
    const f = scanEdit('u/u_test.go', g, g.replace('\tinfo, _ := os.Stat(dst)\n\tassert.Equal(t, info.Mode().Perm(), mode)', '\trequire.NoError(t, c.Save(f, dst, mode))'));
    assert.deepEqual(only(f, 'assertion-weakened'), []);
  });

  test('unrelated subjects are not paired', () => {
    const f = scanEdit('src/user.test.ts', T, T.replace("expect(u.name).toBe('Ada');", "expect(u.name).toBe('Ada');\n    expect(u.id).toBeDefined();").replace('    expect(u.tags).toHaveLength(2);\n', ''));
    assert.deepEqual(only(f, 'assertion-weakened'), []);
  });
});

describe('assertion-removed', () => {
  test('net assertion drop in a test file', () => {
    const f = scanEdit('src/user.test.ts', T, T.replace("    expect(u.name).toBe('Ada');\n", ''));
    const r = only(f, 'assertion-removed');
    assert.equal(r.length, 1);
    assert.equal(r[0].severity, 'medium');
    assert.equal(r[0].side, 'removed');
  });

  test('removing three or more assertions is high', () => {
    const f = scanEdit('src/user.test.ts', T, T.replace(/    expect\(.*\n/g, ''));
    assert.equal(only(f, 'assertion-removed')[0].severity, 'high');
  });

  test('commented-out assertions are high and labelled', () => {
    const f = scanEdit('src/user.test.ts', T, T.replace("    expect(u.name).toBe('Ada');", "    // expect(u.name).toBe('Ada');"));
    const r = only(f, 'assertion-removed');
    assert.equal(r[0].severity, 'high');
    assert.match(r[0].message, /commented out/);
  });

  test('rewriting an assertion (same count) is not a removal', () => {
    const f = scanEdit('src/user.test.ts', T, T.replace("expect(u.name).toBe('Ada');", "expect(u.name).toStrictEqual('Ada');"));
    assert.deepEqual(only(f, 'assertion-removed'), []);
  });

  test('assertions in non-test files are ignored', () => {
    const src = 'export function f(x) {\n  assert(x > 0);\n  return x;\n}\n';
    assert.deepEqual(ids(scanEdit('src/f.ts', src, src.replace('  assert(x > 0);\n', ''))), []);
  });

  test('adding assertions in another file does not hide a per-file drop', () => {
    const other = lines(
      "it('other', () => {",
      "  expect(ok()).toBe(true);",
      '});',
    );
    const f = scanChange(
      { 'src/user.test.ts': T, 'src/other.test.ts': other },
      {
        'src/user.test.ts': T.replace("    expect(u.name).toBe('Ada');\n", ''),
        'src/other.test.ts': other.replace("  expect(ok()).toBe(true);", "  expect(ok()).toBe(true);\n  expect(ok()).toBeDefined();"),
      },
    );
    const r = only(f, 'assertion-removed');
    assert.equal(r.length, 1);
    assert.equal(r[0].file, 'src/user.test.ts');
    assert.match(r[0].message, /dropped by 1/);
  });

  test('drop explained by removed tests is not flagged', () => {
    const before = lines(
      "describe('user', () => {",
      "  it('loads', async () => {",
      "    expect(u.name).toBe('Ada');",
      '  });',
      "  it('saves', async () => {",
      '    expect(u.ok).toBe(true);',
      '  });',
      '});',
    );
    const after = lines(
      "describe('user', () => {",
      "  it('loads', async () => {",
      "    expect(u.name).toBe('Ada');",
      '  });',
      '});',
    );
    const f = scanEdit('src/user.test.ts', before, after);
    assert.deepEqual(only(f, 'assertion-removed'), []);
    assert.equal(only(f, 'test-count-dropped').length, 1);
  });

  test('moving an assertion verbatim to another file is not a drop', () => {
    const line = "    expect(u.age).toEqual(36);\n";
    const dest = lines(
      "it('age', () => {",
      '    expect(u.age).toEqual(36);',
      '});',
    );
    const f = scanChange(
      { 'src/user.test.ts': T },
      { 'src/user.test.ts': T.replace(line, ''), 'src/age.test.ts': dest },
    );
    assert.deepEqual(only(f, 'assertion-removed'), []);
    assert.deepEqual(only(f, 'test-count-dropped'), []);
  });

  test('gutted asserts in a shared test helper are flagged', () => {
    const before = lines(
      'export function expectUser(u) {',
      "  expect(u.name).toBe('Ada');",
      '  expect(u.age).toEqual(36);',
      '}',
    );
    const f = scanEdit('src/test-helpers.ts', before, before.replace("  expect(u.name).toBe('Ada');\n", ''));
    const r = only(f, 'assertion-removed');
    assert.equal(r.length, 1);
    assert.equal(r[0].file, 'src/test-helpers.ts');
    assert.equal(r[0].severity, 'medium');
  });

  test('gutted asserts in conftest.py are flagged', () => {
    const before = 'def assert_user(u):\n    assert u.name == "Ada"\n    assert u.age == 36\n';
    const f = scanEdit('conftest.py', before, 'def assert_user(u):\n    assert u.age == 36\n');
    assert.equal(only(f, 'assertion-removed').length, 1);
  });

  test('two assertions on one line becoming one is a drop', () => {
    const before = lines(
      "it('loads', () => {",
      "  expect(u.name).toBe('Ada'); expect(u.age).toEqual(36);",
      '});',
    );
    const after = lines(
      "it('loads', () => {",
      "  expect(u.name).toBe('Ada');",
      '});',
    );
    const r = only(scanEdit('src/user.test.ts', before, after), 'assertion-removed');
    assert.equal(r.length, 1);
    assert.match(r[0].message, /dropped by 1/);
  });
});

describe('assertion-trivial', () => {
  test('flags assertions that cannot fail', () => {
    const cases: [string, string, string][] = [
      ['src/a.test.ts', T, T.replace("expect(u.name).toBe('Ada');", 'expect(true).toBe(true);')],
      ['tests/test_a.py', 'def test_a():\n    assert f() == 1\n', 'def test_a():\n    assert True\n'],
      ['tests/a.rs', '#[test]\nfn a() {\n    assert_eq!(f(), 1);\n}\n', '#[test]\nfn a() {\n    assert!(true);\n}\n'],
      ['src/test/java/ATest.java', 'class ATest {\n  @Test void a() {\n    assertEquals(1, f());\n  }\n}\n', 'class ATest {\n  @Test void a() {\n    assertTrue(true);\n  }\n}\n'],
    ];
    for (const [file, a, b] of cases) {
      assert.ok(ids(scanEdit(file, a, b)).includes('assertion-trivial'), file);
    }
  });

  test('a trivial assertion inside a string literal is not flagged', () => {
    const f = scanEdit('src/a.test.ts', T, T.replace("expect(u.name).toBe('Ada');", "expect(u.name).toBe('Ada');\n    const code = 'expect(true).toBe(true);';"));
    assert.deepEqual(only(f, 'assertion-trivial'), []);
  });

  test('expect(result).toBe(true) is not trivial', () => {
    const f = scanEdit('src/a.test.ts', T, T.replace("expect(u.name).toBe('Ada');", "expect(u.name === 'Ada').toBe(true);"));
    assert.deepEqual(only(f, 'assertion-trivial'), []);
  });
});

describe('assertion-expected-changed', () => {
  test('only the expected literal changed -> low', () => {
    const f = scanEdit('src/user.test.ts', T, T.replace('expect(u.age).toEqual(36);', 'expect(u.age).toEqual(37);'));
    const c = only(f, 'assertion-expected-changed');
    assert.equal(c.length, 1);
    assert.equal(c[0].severity, 'low');
  });
});
