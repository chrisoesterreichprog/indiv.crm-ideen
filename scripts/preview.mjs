// `npm run preview`: writes preview/index.html with every view and rail size rendered from the
// synthetic test fixture. Static file, no scripts, no network — open it in any browser for
// reproducible visual/keyboard checks and screenshots. Output is git-ignored.
import { mkdirSync, writeFileSync } from 'node:fs';
import { render } from '../src/index.mjs';
import { escapeHtml } from '../src/html.mjs';
import { alice, ctxFor } from '../test/fixtures.mjs';

const ctx = ctxFor(alice, {
  instanceId: 'preview',
  voice: { bridge: 'available', kind: 'whispr', egress: 'none', microphone: true, consent: { audio: true, transcription: true } },
});
const frames = [
  ['bottom', 288, 160, 'Footer-Karte (Default-Preset 1/5 von 1440 px)'],
  ['bottom', 140, 60, 'Footer sehr schmal'],
  ['left', 220, 400, 'Linke Kante schmal'],
  ['left', 300, 260, 'Linke Kante mittel'],
  ['right', 480, 600, 'Rechte Kante breit'],
  ['top', 900, 320, 'Obere Kante breit'],
];
const section = (title, html, style = '') => `<section class="frame"><h2>${escapeHtml(title)}</h2><div class="box" style="${style}">${html}</div></section>`;
const body = [
  ...frames.map(([rail, width, height, label], index) => section(`${label} · ${rail} ${width}×${height}`,
    render(rail, { ...ctx, instanceId: 'preview-' + index }, { width, height }), `width:${width}px;height:${height}px`)),
  section('Initialization', render('initialization', ctx)),
  section('Settings', render('settings', ctx)),
  section('Workbench (center)', render('center', ctx)),
].join('\n');

const page = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Ideen v2 – Preview (synthetisch)</title>
<style>
body{font:14px system-ui,sans-serif;margin:24px;background:#f4f5f7;color:#1d1f23}
.frame{margin-bottom:28px}.frame h2{font-size:13px;color:#555;margin:0 0 6px}
.box{background:#fff;border:1px dashed #9aa;overflow:auto;padding:8px;box-sizing:border-box}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.eyebrow{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#667}
.idea-lanes{display:flex;gap:12px;flex-wrap:wrap}.idea-lane{flex:1 1 260px;background:#f7f8fa;padding:8px;border-radius:6px}
.idea-work-card,.item-row{list-style:none;background:#fff;border:1px solid #dde;border-radius:6px;padding:8px;margin:6px 0}
.idea-work-card:focus,.item-row:focus{outline:3px solid #2563eb}
.idea-drop-zones{display:flex;gap:8px;padding:0}.idea-drop-zone{list-style:none;border:2px dashed #88a;padding:8px;border-radius:6px}
[data-orientation=horizontal] .idea-list{display:flex;gap:6px;padding:0}
.idea-badge{font-size:11px;background:#eef;border-radius:4px;padding:0 4px;margin-left:4px}
</style></head><body><h1>Ideen v2 – adaptive Views (synthetische Daten)</h1>${body}</body></html>`;

mkdirSync(new URL('../preview/', import.meta.url), { recursive: true });
writeFileSync(new URL('../preview/index.html', import.meta.url), page);
process.stdout.write('preview/index.html written (' + page.length + ' bytes)\n');
