import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import { applyPlan, planInstall } from '../src/install';
import { tmpRepo } from './helpers';

const CLI = path.join(__dirname, '..', '..', 'dist', 'cli.js');

describe('install', () => {
  test('claude: merges into existing settings and is idempotent', () => {
    const dir = tmpRepo({ '.claude/settings.json': JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'prettier' }] }] } }, null, 2) });
    const plan = planInstall('claude', { cwd: dir });
    assert.equal(plan.alreadyInstalled, false);
    applyPlan(plan);
    const j = JSON.parse(fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf8'));
    assert.deepEqual(j.permissions, { allow: ['Bash(ls)'] });
    assert.equal(j.hooks.PostToolUse.length, 1);
    assert.equal(j.hooks.Stop[0].hooks[0].type, 'command');
    assert.equal(j.hooks.Stop[0].hooks[0].command, 'npx --yes fakegreen hook --agent claude');
    assert.equal(j.hooks.Stop[0].matcher, undefined);
    assert.equal(planInstall('claude', { cwd: dir }).alreadyInstalled, true);
  });

  test('claude --global / --local and custom command', () => {
    const dir = tmpRepo();
    const home = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fg-home-'));
    assert.equal(planInstall('claude', { cwd: dir, global: true, home }).file, path.join(home, '.claude/settings.json'));
    assert.ok(planInstall('claude', { cwd: dir, local: true }).file.endsWith(path.normalize('.claude/settings.local.json')));
    const p = planInstall('claude', { cwd: dir, command: 'node /opt/fg/cli.js', hookArgs: '--base origin/main' });
    assert.match(p.after, /node \/opt\/fg\/cli\.js hook --agent claude --base origin\/main/);
  });

  test('codex: .codex/hooks.json Stop hook', () => {
    const dir = tmpRepo();
    const p = planInstall('codex', { cwd: dir });
    assert.ok(p.file.endsWith(path.normalize('.codex/hooks.json')));
    const j = JSON.parse(p.after);
    assert.equal(j.hooks.Stop[0].hooks[0].command, 'npx --yes fakegreen hook --agent codex');
    assert.equal(j.hooks.Stop[0].hooks[0].timeout, 120);
    assert.ok(p.notes.some((n) => n.includes('/hooks')));
  });

  test('gemini: AfterAgent hook with ms timeout', () => {
    const dir = tmpRepo({ '.gemini/settings.json': '{\n  "theme": "Dracula"\n}\n' });
    const p = planInstall('gemini', { cwd: dir });
    const j = JSON.parse(p.after);
    assert.equal(j.theme, 'Dracula');
    const h = j.hooks.AfterAgent[0].hooks[0];
    assert.equal(h.type, 'command');
    assert.equal(h.name, 'fakegreen');
    assert.equal(h.timeout, 120000);
  });

  test('invalid JSON is refused, not clobbered', () => {
    const dir = tmpRepo({ '.claude/settings.json': '{ nope' });
    assert.throws(() => planInstall('claude', { cwd: dir }), /not valid JSON/);
  });

  test('pre-commit: writes an executable hook, preserves an existing one', () => {
    const dir = tmpRepo();
    const hook = path.join(dir, '.git/hooks/pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\necho existing\n');
    const p = planInstall('pre-commit', { cwd: dir });
    applyPlan(p);
    const text = fs.readFileSync(hook, 'utf8');
    assert.match(text, /^#!\/bin\/sh\n# >>> fakegreen >>>\nnpx --yes fakegreen --staged \|\| exit \$\?\n# <<< fakegreen <<<\necho existing\n$/);
    // Windows has no POSIX exec bit (statSync reports none); Git for Windows runs hooks regardless.
    if (process.platform !== 'win32') assert.ok(fs.statSync(hook).mode & 0o100);
    assert.equal(planInstall('pre-commit', { cwd: dir }).alreadyInstalled, true);
  });

  test('github-action and skill', () => {
    const dir = tmpRepo();
    const g = planInstall('github-action', { cwd: dir });
    assert.ok(g.file.endsWith(path.normalize('.github/workflows/fakegreen.yml')));
    assert.match(g.after, /fetch-depth: 0/);
    assert.match(g.after, /--base "origin\/\$\{\{ github\.base_ref \}\}"/);
    const s = planInstall('skill', { cwd: dir });
    assert.match(s.after, /^---\nname: fakegreen/);
  });

  test('CLI shows a diff and refuses to write without --yes when not a TTY', () => {
    const dir = tmpRepo();
    const r = spawnSync(process.execPath, [CLI, 'install', 'claude'], { cwd: dir, encoding: 'utf8', input: '' });
    assert.equal(r.status, 2);
    assert.match(r.stdout, /\+\+\+ \.claude\/settings\.json/);
    assert.match(r.stdout, /\+ +"command": "npx --yes fakegreen hook --agent claude"/);
    assert.ok(!fs.existsSync(path.join(dir, '.claude/settings.json')));
    const dry = spawnSync(process.execPath, [CLI, 'install', 'codex', '--dry-run'], { cwd: dir, encoding: 'utf8' });
    assert.equal(dry.status, 0);
    assert.ok(!fs.existsSync(path.join(dir, '.codex/hooks.json')));
    const yes = spawnSync(process.execPath, [CLI, 'install', 'gemini', '--yes'], { cwd: dir, encoding: 'utf8' });
    assert.equal(yes.status, 0);
    assert.ok(fs.existsSync(path.join(dir, '.gemini/settings.json')));
  });
});
