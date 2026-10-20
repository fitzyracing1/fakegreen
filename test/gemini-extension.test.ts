import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { tmpRepo, writeFiles } from './helpers';

const ROOT = path.join(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'mcp', 'server.js');
const CLI = path.join(ROOT, 'dist', 'cli.js');
const T = "it('a', () => {\n  expect(f()).toBe(1);\n});\n";

function rpc(cwd: string, msgs: object[]): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [SERVER, '--workspace', cwd], { env: { ...process.env, FAKEGREEN_CLI: CLI } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', reject);
    p.on('close', () => resolve(out.split('\n').filter(Boolean).map((l) => JSON.parse(l))));
    for (const m of msgs) p.stdin.write(JSON.stringify(m) + '\n');
    p.stdin.end();
  });
}

describe('gemini extension', () => {
  test('manifest is valid and points at real files', () => {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'gemini-extension.json'), 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(m.name, 'fakegreen');
    assert.match(m.name, /^[a-z0-9-]+$/);
    assert.equal(m.version, pkg.version);
    assert.ok(m.description);
    assert.ok(fs.existsSync(path.join(ROOT, m.contextFileName)));
    const s = m.mcpServers.fakegreen;
    assert.equal(s.command, 'node');
    assert.ok(fs.existsSync(path.join(ROOT, s.args[0].replace('${extensionPath}', '').split('${/}').join(path.sep))));
  });

  test('command TOML files have description and prompt', () => {
    const dir = path.join(ROOT, 'commands', 'fakegreen');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.toml'));
    assert.deepEqual(files.sort(), ['branch.toml', 'rules.toml', 'scan.toml']);
    for (const f of files) {
      const t = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.match(t, /^description = ".+"$/m, f);
      assert.match(t, /^prompt = """\n[\s\S]+\n"""\s*$/m, f);
      assert.match(t, /npx --yes fakegreen/, f);
    }
  });

  describe('mcp server', () => {
    let dir: string;
    before(() => { dir = tmpRepo({ 'src/a.test.ts': T }); });
    after(() => fs.rmSync(dir, { recursive: true, force: true }));

    test('handshake, tools/list, unknown method', async () => {
      const [init, list, bad] = await rpc(dir, [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        { jsonrpc: '2.0', id: 3, method: 'nope' },
      ]);
      assert.equal(init.result.serverInfo.name, 'fakegreen');
      assert.equal(init.result.protocolVersion, '2025-06-18');
      assert.deepEqual(list.result.tools.map((t: any) => t.name), ['fakegreen_scan', 'fakegreen_rules']);
      assert.equal(bad.error.code, -32601);
    });

    test('tools/call fakegreen_scan flags a skipped test, rules lists rules, bad args error', async () => {
      writeFiles(dir, { 'src/a.test.ts': T.replace("it('a'", "it.skip('a'") });
      const [scan, rules, bad] = await rpc(dir, [
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'fakegreen_scan', arguments: {} } },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fakegreen_rules', arguments: {} } },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fakegreen_scan', arguments: { base: '--evil' } } },
      ]);
      const text: string = scan.result.content[0].text;
      assert.ok(!scan.result.isError, text);
      const j = JSON.parse(text.slice(text.indexOf('{')));
      assert.ok(j.summary.high >= 1, text);
      assert.match(rules.result.content[0].text, /\w/);
      assert.equal(bad.result.isError, true);
    });
  });
});
