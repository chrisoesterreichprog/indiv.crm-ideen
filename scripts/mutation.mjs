// `npm run mutation`: reproducible proof that the safety-relevant checks are really tested.
// Copies src/ + test/ into a temp dir, disables one guard at a time and expects the suite to
// fail ("killed"). A surviving mutation means a guard could be removed without any test noticing.
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const MUTATIONS = [
  ['cross-tenant idea lookup', 'src/ideas.mjs', 'i.id === id && i.tenantId === actor.tenantId', 'i.id === id'],
  ['revoked actor accepted', 'src/ideas.mjs', "if (actor.status === 'active') return null;", 'return null;'],
  ['audio consent gate', 'src/voice.mjs', "if (!consentAudio) return 'consent_missing';", ''],
  ['shield gate for egress', 'src/voice.mjs', "if (egress !== 'none' && !caps.has(VOICE_CAPABILITIES.shield)) return 'shield_missing';", ''],
  ['lane-scoped ↑/↓', 'src/ideas.mjs', 'if (laneOf(list[i], projectIds) === lane) { to = i; break; }', '{ to = i; break; }'],
  ['inbox drop-target namespace', 'src/dnd.mjs', "export const INBOX_TARGET_ID = 'inbox';", "export const INBOX_TARGET_ID = 'project:inbox';"],
  ['tenant-scoped idempotency key', 'src/transfer.mjs', 'ideas.transfer:${c.actor.tenantId}:${idea.id}', 'ideas.transfer:${idea.id}'],
  ['revision guard on actions', 'src/ideas.mjs', 'const expectedRevision = withRevision(d.expectedRevision);', 'const expectedRevision = {};'],
  ['revision pinned on project drops', 'src/dnd.mjs', ', expectedRevision: revisionOf(found.idea) });', ' });'],
  ['strict revision parser', 'src/ideas.mjs', "return typeof value === 'string' && REVISION_RE.test(value) ? Number(value) : undefined;", 'return Number.parseInt(value, 10) || undefined;'],
  ['hostile action data', 'src/ideas.mjs', 'const d = isRecord(data) ? data : {};', 'const d = data;'],
  ['compact title shortening', 'src/views.mjs', 'e(shortTitle(idea))', 'e(ideaTitle(idea))'],
  ['disabled ↑ at lane edge', 'src/views.mjs', "(position.first ? ' disabled' : '')", "''"],
  ['no text in proposals', 'src/transfer.mjs', "kind: idea.audio ? 'voice' : 'text',", "kind: idea.audio ? 'voice' : 'text', text: idea.text,"],
];

const tests = readdirSync(join(root, 'test')).filter(name => name.endsWith('.test.mjs')).map(name => 'test/' + name);
let survived = 0;
for (const [name, file, from, to] of MUTATIONS) {
  const dir = mkdtempSync(join(tmpdir(), 'ideas-mutation-'));
  try {
    for (const sub of ['src', 'test']) cpSync(join(root, sub), join(dir, sub), { recursive: true });
    writeFileSync(join(dir, 'package.json'), readFileSync(join(root, 'package.json')));
    const source = readFileSync(join(dir, file), 'utf8');
    if (!source.includes(from)) {
      survived += 1;
      process.stdout.write(`?  ${name}: guard not found in ${file} (update scripts/mutation.mjs)\n`);
      continue;
    }
    writeFileSync(join(dir, file), source.replace(from, to));
    const run = spawnSync(process.execPath, ['--test', ...tests], { cwd: dir, encoding: 'utf8' });
    const failing = Number(run.stdout.match(/ℹ fail (\d+)/)?.[1] ?? 0);
    if (failing === 0) survived += 1;
    process.stdout.write(`${failing ? '✔ killed  ' : '✖ SURVIVED'} ${name} (${failing} failing tests)\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
process.stdout.write(`${MUTATIONS.length - survived}/${MUTATIONS.length} mutations killed\n`);
if (survived) process.exit(1);
