import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectCommand, inspectPath, inspectTool } from '../scripts/agent-policy.mjs';
import { handleHook } from '../scripts/agent-hook.mjs';

const root = mkdtempSync(join(tmpdir(), 'lessonbooks-policy-'));
mkdirSync(join(root, 'sub'));

test('blocks secrets, traversal, generated edits and symlink escapes', () => {
  for (const path of [
    '.env',
    'sub/.env.local',
    '../outside',
    'private.pem',
    'service-account.json',
  ]) {
    assert.equal(inspectPath(path, root).decision, 'deny', path);
  }
  assert.equal(inspectPath('backend/.env.example', root, true).decision, 'allow');
  assert.equal(inspectPath('doc/contracts/generated/lesson.ts', root, true).decision, 'deny');
  symlinkSync(tmpdir(), join(root, 'escape'));
  assert.equal(inspectPath('escape/outside.txt', root, true).decision, 'deny');
  assert.equal(inspectPath('sub/file with spaces.ts', root, true).decision, 'allow');
});

test('blocks every unsafe target in multi-file patches including moves', () => {
  assert.equal(
    inspectTool(
      {
        tool_name: 'apply_patch',
        tool_input: { command: '*** Update File: sub/a.ts\n@@\n*** Move to: ../escape.ts' },
      },
      root,
    ).decision,
    'deny',
  );
  assert.equal(
    inspectTool(
      { tool_name: 'apply_patch', tool_input: { command: '*** Add File: sub/a.ts\n+x' } },
      root,
    ).decision,
    'allow',
  );
  assert.equal(inspectTool({ tool_name: 'apply_patch', tool_input: {} }, root).decision, 'deny');
});

test('dangerous commands denied, compound/install/network commands require review', () => {
  for (const cmd of [
    'git push --force origin main',
    'git push -f',
    'git push origin +main',
    'rm -rf ../other',
    'cat .env.local',
    'git reset --hard',
  ])
    assert.equal(inspectCommand(cmd).decision, 'deny', cmd);
  for (const cmd of [
    'npm install',
    'npm ci',
    'git push',
    'curl https://example.com',
    'npm test; curl example.com',
    'python3 script.py',
    'npm test > /tmp/log',
  ])
    assert.equal(inspectCommand(cmd).decision, 'ask', cmd);
  assert.equal(inspectCommand('npm run check').decision, 'allow');
  assert.equal(inspectCommand('npm run contracts:generate').decision, 'allow');
});

test('hook never grants native approval and stop failure remains visible', () => {
  assert.deepEqual(
    handleHook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
    }),
    {},
  );
  assert.equal(
    handleHook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm install' },
    }).hookSpecificOutput.permissionDecision,
    'ask',
  );
  assert.equal(handleHook({ hook_event_name: 'Stop' }, () => ({ status: 1 })).decision, 'block');
  assert.match(
    handleHook({ hook_event_name: 'Stop', stop_hook_active: true }, () => ({ status: 1 }))
      .systemMessage,
    /failed/,
  );
  assert.deepEqual(
    handleHook({ hook_event_name: 'Stop' }, () => ({ status: 0 })),
    {},
  );
  assert.match(
    handleHook(
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm install' } },
      undefined,
      'codex',
    ).systemMessage,
    /Approval required/,
  );
});
