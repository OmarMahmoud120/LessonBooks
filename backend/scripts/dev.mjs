import { spawn } from 'node:child_process';
const children = ['@lessonbooks/backend', '@lessonbooks/site'].map((name) =>
  spawn('npm', ['run', 'dev', '--workspace', name], { stdio: 'inherit' }),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
  });
for (const child of children)
  child.on('exit', (code) => {
    if (code) {
      process.exitCode = code;
      for (const sibling of children) if (sibling !== child) sibling.kill();
    }
  });
