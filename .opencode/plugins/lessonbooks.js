import { inspectCommand, inspectPath } from '../../backend/scripts/agent-policy.mjs';
import { handleHook, root } from '../../backend/scripts/agent-hook.mjs';

// OpenCode v2's default export uses id/setup. No npm plugin or MCP dependency.
export default {
  id: 'lessonbooks-local-policy',
  async setup(ctx) {
    await ctx.permission.hook('evaluate', (event) => {
      for (const resource of event.resources) {
        const result = event.action === 'shell'
          ? inspectCommand(resource)
          : ['read', 'edit'].includes(event.action)
            ? inspectPath(resource, root, event.action === 'edit')
            : null;
        if (result?.decision === 'deny') {
          event.effect = 'deny';
          event.message = result.reason;
          break;
        }
        if (result?.decision === 'ask' && event.effect !== 'deny') {
          event.effect = 'ask';
          event.message = result.reason;
        }
      }
    });
    await ctx.tool.hook('execute.after', (event) => {
      if (event.status !== 'completed' || !['write', 'edit', 'patch'].includes(event.tool)) return;
      const report = handleHook({ hook_event_name: 'PostToolUse', tool_name: event.tool, tool_input: event.input });
      if (report.systemMessage) console.error(report.systemMessage);
    });
  },
};
