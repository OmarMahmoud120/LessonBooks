import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { root } from './agent-hook.mjs';
const script = readFileSync(`${root}/site/dist/player/player.js`, 'utf8');
const css = readFileSync(`${root}/site/dist/player/player.css`, 'utf8');
const hash = createHash('sha256').update(script).digest('base64');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>LessonBooks</title><style>${css}</style></head><body><div id="root"></div><script>${script.replaceAll('</script', '<\\/script')}</script></body></html>`;
mkdirSync(`${root}/mobile/assets/player`, { recursive: true });
writeFileSync(
  `${root}/mobile/assets/player/player.json`,
  JSON.stringify({ html, sha256: createHash('sha256').update(script).digest('hex') }),
);
console.log('Bundled the shared player into mobile/assets/player/player.json.');
