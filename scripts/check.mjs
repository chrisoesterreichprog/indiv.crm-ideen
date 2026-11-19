// `npm run check`: syntax-checks every module/test/script file and smoke-loads the public entry.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = ['src', 'test', 'scripts'].flatMap(dir => readdirSync(new URL('../' + dir + '/', import.meta.url))
  .filter(name => name.endsWith('.mjs'))
  .map(name => dir + '/' + name));

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    failed += 1;
    process.stderr.write(`✖ ${file}\n${result.stderr}`);
  }
}

const entry = await import('../src/index.mjs');
for (const name of ['manifest', 'render']) {
  if (!(name in entry)) { failed += 1; process.stderr.write(`✖ public entry lacks ${name}\n`); }
}
for (const target of [...entry.manifest.slots, ...entry.manifest.rails, ...entry.manifest.views]) {
  if (typeof entry.render(target, {}) !== 'string') { failed += 1; process.stderr.write(`✖ render(${target}) did not return markup\n`); }
}

if (failed) process.exit(1);
process.stdout.write(`✔ ${files.length} files syntax-checked, public contract renders ${entry.manifest.slots.length + entry.manifest.rails.length + entry.manifest.views.length} targets\n`);
