import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { git, repoRoot } from './git';
import { lineDiff } from './linediff';

export type InstallTarget = 'claude' | 'codex' | 'gemini' | 'pre-commit' | 'github-action' | 'skill';
export const INSTALL_TARGETS: InstallTarget[] = ['claude', 'codex', 'gemini', 'pre-commit', 'github-action', 'skill'];

export interface InstallOptions {
  cwd: string;
  global?: boolean;
  local?: boolean;
  /** Base command used to invoke fakegreen, e.g. "npx --yes fakegreen" or "node /path/dist/cli.js". */
  command?: string;
  /** Extra args appended to the hook command (e.g. "--base origin/main"). */
  hookArgs?: string;
  home?: string;
}

export interface InstallPlan {
  target: InstallTarget;
  file: string;
  before: string;
  after: string;
  mode?: number;
  alreadyInstalled: boolean;
  notes: string[];
}

export const DEFAULT_COMMAND = 'npx --yes fakegreen';
const MARK_START = '# >>> fakegreen >>>';
const MARK_END = '# <<< fakegreen <<<';

function read(file: string): string {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

function readJson(file: string, before: string): Record<string, any> {
  if (!before.trim()) return {};
  try {
    const j = JSON.parse(before);
    if (j && typeof j === 'object' && !Array.isArray(j)) return j;
  } catch { /* fallthrough */ }
  throw new Error(`${file} is not valid JSON; add the fakegreen hook manually (see README).`);
}

function rootFor(o: InstallOptions): string {
  try { return repoRoot(o.cwd); } catch { return path.resolve(o.cwd); }
}

function hookCommand(o: InstallOptions, agent: string): string {
  return `${o.command ?? DEFAULT_COMMAND} hook --agent ${agent}${o.hookArgs ? ' ' + o.hookArgs : ''}`;
}

function hasFakegreen(groups: unknown): boolean {
  return Array.isArray(groups) && groups.some((g) => Array.isArray(g?.hooks) && g.hooks.some((h: any) => typeof h?.command === 'string' && /fakegreen\b.*\bhook\b/.test(h.command)));
}

function jsonPlan(target: InstallTarget, file: string, event: string, handler: Record<string, unknown>, notes: string[]): InstallPlan {
  const before = read(file);
  const json = readJson(file, before);
  json.hooks = json.hooks && typeof json.hooks === 'object' ? json.hooks : {};
  const groups = Array.isArray(json.hooks[event]) ? json.hooks[event] : [];
  if (hasFakegreen(groups)) return { target, file, before, after: before, alreadyInstalled: true, notes };
  json.hooks[event] = [...groups, { hooks: [handler] }];
  const indent = /^( +|\t)"/m.exec(before)?.[1] ?? '  ';
  return { target, file, before, after: JSON.stringify(json, null, indent) + '\n', alreadyInstalled: false, notes };
}

export function planInstall(target: InstallTarget, o: InstallOptions): InstallPlan {
  const home = o.home ?? os.homedir();
  const root = rootFor(o);
  switch (target) {
    case 'claude': {
      const file = o.global ? path.join(home, '.claude', 'settings.json') : path.join(root, '.claude', o.local ? 'settings.local.json' : 'settings.json');
      return jsonPlan(target, file, 'Stop', {
        type: 'command',
        command: hookCommand(o, 'claude'),
        timeout: 120,
        statusMessage: 'fakegreen: checking the diff for fake-green changes',
      }, ['Claude Code runs this Stop hook at the end of every turn; findings at or above fail-on block the stop and are sent back to Claude.']);
    }
    case 'codex': {
      const file = o.global ? path.join(home, '.codex', 'hooks.json') : path.join(root, '.codex', 'hooks.json');
      return jsonPlan(target, file, 'Stop', {
        type: 'command',
        command: hookCommand(o, 'codex'),
        timeout: 120,
        statusMessage: 'fakegreen: checking the diff for fake-green changes',
      }, [
        'Codex only runs new or changed hooks after you review and trust them: open `/hooks` in Codex once after installing.',
        o.global ? 'User-level hooks load in every project.' : 'Project hooks load only when the project .codex/ layer is trusted.',
      ]);
    }
    case 'gemini': {
      const file = o.global ? path.join(home, '.gemini', 'settings.json') : path.join(root, '.gemini', 'settings.json');
      return jsonPlan(target, file, 'AfterAgent', {
        name: 'fakegreen',
        type: 'command',
        command: hookCommand(o, 'gemini'),
        timeout: 120000,
        description: 'Block the turn when the diff fakes a green build',
      }, ['Gemini CLI runs AfterAgent hooks once per turn; a "deny" decision makes the agent retry with the findings as feedback.']);
    }
    case 'pre-commit': {
      const hooksDir = gitHooksDir(root);
      const huskyFile = path.join(root, '.husky', 'pre-commit');
      const file = fs.existsSync(huskyFile) ? huskyFile : path.join(hooksDir, 'pre-commit');
      const before = read(file);
      if (before.includes(MARK_START)) return { target, file, before, after: before, alreadyInstalled: true, notes: [] };
      const block = `${MARK_START}\n${o.command ?? DEFAULT_COMMAND} --staged || exit $?\n${MARK_END}\n`;
      let after: string;
      if (!before.trim()) after = `#!/bin/sh\n${block}`;
      else if (before.startsWith('#!')) {
        const nl = before.indexOf('\n');
        after = before.slice(0, nl + 1) + block + before.slice(nl + 1);
      } else after = block + before;
      return {
        target, file, before, after, mode: 0o755, alreadyInstalled: false,
        notes: [
          'Runs `fakegreen --staged` before every commit; bypass once with `git commit --no-verify`.',
          'Using the pre-commit framework instead? Add to .pre-commit-config.yaml:\n  - repo: https://github.com/fitzyracing1/fakegreen\n    rev: v0.1.0\n    hooks:\n      - id: fakegreen',
        ],
      };
    }
    case 'github-action': {
      const file = path.join(root, '.github', 'workflows', 'fakegreen.yml');
      const before = read(file);
      if (before) return { target, file, before, after: before, alreadyInstalled: true, notes: [] };
      return { target, file, before, after: GITHUB_WORKFLOW, alreadyInstalled: false, notes: ['Annotates pull requests with findings and fails the check on high-severity ones.'] };
    }
    case 'skill': {
      const file = o.global ? path.join(home, '.claude', 'skills', 'fakegreen', 'SKILL.md') : path.join(root, '.claude', 'skills', 'fakegreen', 'SKILL.md');
      const before = read(file);
      const after = [path.join(__dirname, '..', 'skills'), path.join(__dirname, '..', '..', 'skills')].map((d) => read(path.join(d, 'fakegreen', 'SKILL.md'))).find(Boolean) ?? '';
      if (!after) throw new Error('Bundled SKILL.md not found');
      return { target, file, before, after, alreadyInstalled: before === after, notes: ['For Codex/Gemini/Cursor/Aider, paste the same rules into AGENTS.md, GEMINI.md, .cursor/rules or CONVENTIONS.md.'] };
    }
  }
}

function gitHooksDir(root: string): string {
  try {
    const custom = git(['config', '--get', 'core.hooksPath'], root).trim();
    if (custom) return path.resolve(root, custom);
  } catch { /* unset */ }
  const p = git(['rev-parse', '--git-path', 'hooks'], root).trim();
  return path.resolve(root, p);
}

export function renderPlan(plan: InstallPlan, cwd: string): string {
  // Compare real paths: on Windows cwd and the git root can differ in 8.3 short names or
  // drive-letter case while naming the same directory.
  const real = (p: string) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  const fileDir = real(path.dirname(plan.file));
  const rel = path.relative(real(cwd), path.join(fileDir, path.basename(plan.file)));
  // Repo-relative labels are shown POSIX-style, like git does, on every OS.
  const label = !rel || rel.startsWith('..') || path.isAbsolute(rel) ? plan.file : rel.split(path.sep).join('/');
  if (plan.alreadyInstalled) return `fakegreen is already installed in ${label}; nothing to do.`;
  return lineDiff(plan.before, plan.after, label);
}

export function applyPlan(plan: InstallPlan): void {
  fs.mkdirSync(path.dirname(plan.file), { recursive: true });
  fs.writeFileSync(plan.file, plan.after);
  if (plan.mode) fs.chmodSync(plan.file, plan.mode);
}

export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer: string = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

export const GITHUB_WORKFLOW = `name: fakegreen

on:
  pull_request:

permissions:
  contents: read

jobs:
  fakegreen:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Scan the PR diff for fake-green changes
        run: npx --yes fakegreen --base "origin/\${{ github.base_ref }}" --format github
`;
