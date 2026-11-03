import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inspectTool, inspectPath } from './agent-policy.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function handleHook(input, run = spawnSync, adapter = 'claude') {
  const event = input.hook_event_name;
  if (event === 'PreToolUse') {
    const result = inspectTool(input, root);
    if (result.decision === 'ask' && adapter === 'codex') {
      // Codex currently parses but does not support permissionDecision=ask.
      return {
        systemMessage: `Approval required by repository policy: ${result.reason} Use native approval controls before proceeding.`,
      };
    }
    if (result.decision === 'deny' || result.decision === 'ask') {
      return {
        hookSpecificOutput: {
          hookEventName: event,
          permissionDecision: result.decision,
          permissionDecisionReason: result.reason,
        },
      };
    }
    // Do not grant approval: a clean guard result must not override native permissions.
    return {};
  }
  if (event === 'PostToolUse') {
    const args = input.tool_input ?? {};
    const path = args.file_path ?? args.filePath;
    const patch = args.command ?? args.patchText ?? '';
    const paths = path
      ? [path]
      : [...String(patch).matchAll(/^\*\*\* (?:Add File|Update File|Move to): (.+)$/gm)].map(
          (m) => m[1],
        );
    const files = paths.filter(
      (p) => inspectPath(p, root, true).decision === 'allow' && existsSync(resolve(root, p)),
    );
    if (!files.length) return {};
    const result = run(process.execPath, ['backend/scripts/format-changed.mjs', ...files], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
    });
    if (result.status !== 0)
      return {
        systemMessage:
          'Changed-file checks failed. Run npm run lint and fix failures before completion.',
      };
    return {};
  }
  if (event === 'Stop') {
    const result = run('npm', ['run', 'check:fast'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120000,
    });
    if (result.status !== 0) {
      const reason =
        'Fast checks failed or could not run. Report the blocker and fix failures; do not claim completion.';
      return input.stop_hook_active ? { systemMessage: reason } : { decision: 'block', reason };
    }
    return {};
  }
  return {};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    process.stdout.write(
      JSON.stringify(handleHook(input, spawnSync, process.argv[2] ?? 'claude')) + '\n',
    );
  } catch {
    process.stderr.write('Agent hook failed: invalid input or unavailable checks.\n');
    process.exitCode = 2;
  }
}
