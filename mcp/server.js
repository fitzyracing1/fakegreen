#!/usr/bin/env node
// Zero-dependency stdio MCP server that wraps the fakegreen CLI for Gemini CLI.
// Transport: newline-delimited JSON-RPC 2.0 over stdin/stdout (MCP stdio).
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const VERSION = require('../package.json').version;
const SEVERITIES = ['high', 'medium', 'low'];

function parseArgv(argv) {
  const out = { workspace: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--workspace' && argv[i + 1]) out.workspace = argv[++i];
  }
  return out;
}

/** How to invoke the CLI: FAKEGREEN_CLI (a JS file), a local build, or npx. */
function cliCommand() {
  const override = process.env.FAKEGREEN_CLI;
  if (override) return [process.execPath, [override]];
  const local = path.join(__dirname, '..', 'dist', 'cli.js');
  if (fs.existsSync(local)) return [process.execPath, [local]];
  return [process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'fakegreen']];
}

function runCli(args, cwd) {
  const [cmd, pre] = cliCommand();
  const r = spawnSync(cmd, [...pre, ...args], {
    cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '' },
    shell: process.platform === 'win32' && cmd.endsWith('.cmd'),
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || (r.error ? String(r.error.message) : '') };
}

const TOOLS = [
  {
    name: 'fakegreen_scan',
    description: 'Scan a git diff for faked green builds: skipped/deleted/focused tests, weakened assertions, CI forced green. Defaults to uncommitted + staged + untracked changes in the workspace. Returns fakegreen JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        base: { type: 'string', description: 'Scan everything since the merge-base with this ref, e.g. origin/main.' },
        staged: { type: 'boolean', description: 'Only staged changes.' },
        last_commit: { type: 'boolean', description: 'Only the last commit (HEAD~1..HEAD).' },
        commit: { type: 'string', description: 'A specific commit sha.' },
        min_severity: { type: 'string', enum: SEVERITIES, description: 'Hide findings below this severity.' },
        cwd: { type: 'string', description: 'Directory to scan (defaults to the workspace).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'fakegreen_rules',
    description: 'List every fakegreen rule with its id and severity.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function scanArgs(a) {
  const args = ['--json', '--fail-on', 'none'];
  const picks = [a.base, a.staged, a.last_commit, a.commit].filter((v) => v !== undefined && v !== false && v !== '');
  if (picks.length > 1) throw new Error('Pick only one of base, staged, last_commit, commit.');
  if (typeof a.base === 'string' && a.base) {
    if (a.base.startsWith('-')) throw new Error('Invalid base ref.');
    args.push('--base', a.base);
  }
  if (a.staged === true) args.push('--staged');
  if (a.last_commit === true) args.push('--last-commit');
  if (typeof a.commit === 'string' && a.commit) {
    if (a.commit.startsWith('-')) throw new Error('Invalid commit.');
    args.push('--commit', a.commit);
  }
  if (a.min_severity !== undefined) {
    if (!SEVERITIES.includes(a.min_severity)) throw new Error('min_severity must be high, medium or low.');
    args.push('--min-severity', a.min_severity);
  }
  return args;
}

function callTool(name, a, workspace) {
  a = a || {};
  const cwd = (typeof a.cwd === 'string' && a.cwd) || workspace || process.cwd();
  if (name === 'fakegreen_scan') {
    const r = runCli(scanArgs(a), cwd);
    if (r.status !== 0) return { isError: true, content: [{ type: 'text', text: (r.stderr || r.stdout || `fakegreen exited ${r.status}`).trim() }] };
    let summary = '';
    try {
      const j = JSON.parse(r.stdout);
      const s = j.summary || {};
      summary = `fakegreen: ${s.total || 0} finding(s) (high ${s.high || 0}, medium ${s.medium || 0}, low ${s.low || 0}) in ${j.source}\n`;
    } catch (_) { /* pass raw output through */ }
    return { content: [{ type: 'text', text: summary + r.stdout }] };
  }
  if (name === 'fakegreen_rules') {
    const r = runCli(['rules', '--no-color'], cwd);
    return { isError: r.status !== 0, content: [{ type: 'text', text: (r.stdout || r.stderr).trim() }] };
  }
  throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
}

function handle(msg, workspace) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: (params && params.protocolVersion) || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'fakegreen', version: VERSION },
      };
    case 'ping': return {};
    case 'tools/list': return { tools: TOOLS };
    case 'tools/call': {
      try { return callTool(params && params.name, params && params.arguments, workspace); }
      catch (e) {
        if (e.code === -32602) throw e;
        return { isError: true, content: [{ type: 'text', text: String(e.message) }] };
      }
    }
    default:
      if (id === undefined) return undefined; // notification
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

function main() {
  const { workspace } = parseArgv(process.argv.slice(2));
  const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch (_) { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    if (msg.id === undefined) { try { handle(msg, workspace); } catch (_) { /* ignore */ } return; }
    try { send({ jsonrpc: '2.0', id: msg.id, result: handle(msg, workspace) }); }
    catch (e) { send({ jsonrpc: '2.0', id: msg.id, error: { code: e.code || -32603, message: String(e.message) } }); }
  });
}

if (require.main === module) main();
module.exports = { TOOLS, scanArgs, handle };
