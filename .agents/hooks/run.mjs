import { readFileSync } from 'node:fs';
import { handleHook } from '../../backend/scripts/agent-hook.mjs';
try {
  process.stdout.write(JSON.stringify(handleHook(JSON.parse(readFileSync(0, 'utf8')))) + '\n');
} catch {
  process.stderr.write('Agent hook failed.\n');
  process.exitCode = 2;
}
