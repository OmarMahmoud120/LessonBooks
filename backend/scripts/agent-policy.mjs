import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export function canonicalPath(path) {
  let existing = resolve(path);
  const tail = [];
  while (!existsSync(existing)) {
    tail.unshift(existing.slice(dirname(existing).length + 1));
    const parent = dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  return resolve(realpathSync(existing), ...tail);
}

export function inspectPath(path, root, write = false) {
  const target = canonicalPath(resolve(root, path));
  const rel = relative(canonicalPath(root), target).split(sep).join('/');
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) {
    return { decision: 'deny', reason: 'File access is outside the repository.' };
  }
  const parts = rel.split('/');
  if (
    parts.some(
      (part) => (part === '.env' || part.startsWith('.env.')) && part !== '.env.example',
    ) ||
    parts.some((part) => /^(secrets?|credentials?|\.aws|\.ssh)$/i.test(part)) ||
    /(?:\.(?:pem|key|p12|pfx|jks|keystore)$|service[-_]account|adminsdk)/i.test(rel)
  ) {
    return { decision: 'deny', reason: 'Secret files cannot be read or edited by agents.' };
  }
  if (write && rel.startsWith('doc/contracts/generated/')) {
    return {
      decision: 'deny',
      reason: 'Run npm run contracts:generate; do not hand-edit generated contracts.',
    };
  }
  return { decision: 'allow', reason: 'Repository file.' };
}

export function inspectCommand(command) {
  if (typeof command !== 'string' || command.length > 20000) {
    return { decision: 'deny', reason: 'Missing or oversized shell command.' };
  }
  if (
    /\bgit\s+push\b[^\n]*(?:--force|(?:^|\s)-[a-z]*f[a-z]*(?:\s|$)|\+\S)/i.test(command) ||
    /\bgit\s+(?:reset\b[^\n]*--hard|clean\b[^\n]*-[a-z]*f)/i.test(command) ||
    /(?:^|[\s;&|])(?:rm|rmdir|sudo|shred|mkfs)(?:\s|$)/.test(command)
  ) {
    return { decision: 'deny', reason: 'Destructive shell operation blocked.' };
  }
  if (
    /(?:^|[\s/'"])(?:\.env(?:\.[\w-]+)?)(?![\w.-])/.test(
      command.replaceAll('.env.example', 'EXAMPLE'),
    ) ||
    /(?:\.(?:pem|p12|pfx|jks|keystore)\b|service[-_]account|adminsdk|\/\.ssh\/|\/\.aws\/)/i.test(
      command,
    )
  ) {
    return { decision: 'deny', reason: 'Shell access to secrets is blocked.' };
  }
  if (
    /doc\/contracts\/generated/.test(command) &&
    /(?:>|\b(?:cp|mv|tee|sed|perl|python\w*|node)\b)/.test(command)
  ) {
    return { decision: 'deny', reason: 'Use the contract generator for generated output.' };
  }
  // Complex shell is deliberately not parsed or auto-approved. Native approvals remain in force.
  if (/[;&|<>`\n]|\$\(|\$\{|\\/.test(command)) {
    return { decision: 'ask', reason: 'Compound or dynamic shell commands need review.' };
  }
  if (
    /^npm (?:test|run (?:check(?::fast)?|lint|typecheck|build|format|emulators|contracts:(?:generate|check)|agents:(?:sync|check)|eval:prompts|phase-status))$/.test(
      command.trim(),
    ) ||
    /^git (?:status|diff|log)(?: [\w./:=@~^ -]+)?$/.test(command.trim())
  ) {
    return { decision: 'allow', reason: 'Known local verification command.' };
  }
  return {
    decision: 'ask',
    reason: 'Shell commands outside the local verification allowlist need approval.',
  };
}

export function inspectTool(input, root) {
  const name = String(input.tool_name ?? '').toLowerCase();
  const args = input.tool_input ?? {};
  if (name === 'apply_patch' || name === 'patch') {
    const patch = args.command ?? args.patch ?? args.patchText ?? args.input ?? '';
    const paths = [
      ...String(patch).matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm),
    ].map((m) => m[1]);
    if (!paths.length) return { decision: 'deny', reason: 'Cannot identify patch target paths.' };
    for (const path of paths) {
      const result = inspectPath(path, root, true);
      if (result.decision !== 'allow') return result;
    }
    return { decision: 'allow', reason: 'Patch targets are permitted.' };
  }
  if (['bash', 'shell', 'exec_command'].includes(name))
    return inspectCommand(args.command ?? args.cmd);
  const path = args.file_path ?? args.filePath ?? args.path;
  if (typeof path === 'string') return inspectPath(path, root, /edit|write|delete|move/.test(name));
  return { decision: 'defer', reason: 'Use native permissions for this tool.' };
}
