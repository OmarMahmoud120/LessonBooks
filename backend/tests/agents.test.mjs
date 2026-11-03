import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { root } from '../scripts/agent-hook.mjs';
import openCodePlugin from '../../.opencode/plugins/lessonbooks.js';
const manifest = JSON.parse(
  readFileSync(new URL('../../.agents/manifest.json', import.meta.url), 'utf8'),
);

test('every role has native adapters with read-only reviewers', () => {
  const openCode = JSON.parse(readFileSync(`${root}/opencode.json`, 'utf8'));
  for (const role of manifest.agents) {
    assert.ok(existsSync(`${root}/.codex/agents/${role.name}.toml`));
    const claude = readFileSync(`${root}/.claude/agents/${role.name}.md`, 'utf8');
    if (role.readOnly) {
      assert.match(claude, /tools: Read, Grep, Glob\n/);
      assert.ok(
        openCode.agents[role.name].permissions.some(
          (p) => p.action === 'edit' && p.effect === 'deny',
        ),
      );
    }
  }
});
test('skills have discovery fields and all workflow prompts resolve', () => {
  for (const name of manifest.skills) {
    const skill = readFileSync(`${root}/.agents/skills/${name}/SKILL.md`, 'utf8');
    assert.match(skill, new RegExp(`name: ${name}\\n`));
    assert.match(skill, /description: .+/);
  }
  for (const name of manifest.commands.filter((n) => !['check', 'eval-prompts'].includes(n))) {
    const result = spawnSync(
      process.execPath,
      ['backend/scripts/workflow.mjs', name, '--preview'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.length > 50);
  }
});
test('native hook entrypoint blocks a destructive command without executing it', () => {
  const result = spawnSync(process.execPath, ['backend/scripts/agent-hook.mjs', 'codex'], {
    cwd: root,
    encoding: 'utf8',
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
    }),
  });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('OpenCode v2 adapter registers hooks and preserves restrictive native permissions', async () => {
  const callbacks = {};
  await openCodePlugin.setup({
    permission: {
      hook: async (name, fn) => {
        callbacks[name] = fn;
      },
    },
    tool: {
      hook: async (name, fn) => {
        callbacks[name] = fn;
      },
    },
  });
  const input = { action: 'edit', resources: ['.env.local'], effect: 'allow' };
  callbacks.evaluate(input);
  assert.equal(input.effect, 'deny');
  const shell = { action: 'shell', resources: ['npm install'], effect: 'allow' };
  callbacks.evaluate(shell);
  assert.equal(shell.effect, 'ask');
  const safe = { action: 'shell', resources: ['npm test'], effect: 'ask' };
  callbacks.evaluate(safe);
  assert.equal(safe.effect, 'ask');
  assert.equal(typeof callbacks['execute.after'], 'function');
});
