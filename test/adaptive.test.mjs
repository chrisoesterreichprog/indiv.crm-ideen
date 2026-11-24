import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, sizeClassFor, normalizeDimensions, manifest, SIZE_CLASSES, COMPACT_TITLE_MAX } from '../src/index.mjs';
import { alice, ctxFor, duplicateIds, unlabelledControls } from './fixtures.mjs';

const sizeOf = html => html.match(/data-size="(xs|s|m|l)"/)?.[1];
const rank = size => SIZE_CLASSES.indexOf(size);

test('size classes follow the actual container, not a slot number', () => {
  assert.equal(sizeClassFor('left', { width: 120, height: 400 }), 'xs');
  assert.equal(sizeClassFor('bottom', { width: 600, height: 60 }), 'xs');
  assert.equal(sizeClassFor('right', { width: 220, height: 400 }), 's');
  assert.equal(sizeClassFor('bottom', { width: 288, height: 160 }), 'm');
  assert.equal(sizeClassFor('top', { width: 1200, height: 320 }), 'l');
});

test('continuous resize on every rail never throws and is monotonic', () => {
  const ctx = ctxFor(alice);
  for (const rail of manifest.rails) {
    for (const height of [40, 90, 150, 300, 700]) {
      let previous = -1;
      for (let width = 40; width <= 1600; width += 7) {
        const html = render(rail, ctx, { width, height });
        const size = sizeOf(html);
        assert.ok(SIZE_CLASSES.includes(size), `${rail} ${width}x${height}`);
        assert.ok(rank(size) >= previous, `size shrank while growing: ${rail} ${width}x${height}`);
        previous = rank(size);
        assert.match(html, new RegExp(`data-rail="${rail}"`));
      }
    }
  }
});

test('hostile or missing dimensions fall back to rail defaults', () => {
  for (const dims of [undefined, null, 'big', {}, { width: NaN, height: -5 }, { width: Infinity, height: 0 }, { width: '300', height: '200' }, []]) {
    const normalized = normalizeDimensions('bottom', dims);
    assert.ok(Number.isFinite(normalized.width) && normalized.width > 0);
    assert.ok(Number.isFinite(normalized.height) && normalized.height > 0);
    assert.equal(typeof render('bottom', ctxFor(alice), dims), 'string');
  }
  assert.deepEqual(normalizeDimensions('left', { width: 1e9, height: 1e9 }), { width: 10000, height: 10000 });
});

test('dimensions may also arrive inside the context (adapter for single-argument hosts)', () => {
  assert.equal(sizeOf(render('right', { ...ctxFor(alice), dimensions: { width: 100, height: 100 } })), 'xs');
});

test('each size class shows an adapted compact view', () => {
  const ctx = ctxFor(alice, { voice: { bridge: 'available', microphone: true, consent: { audio: true } } });
  const xs = render('left', ctx, { width: 120, height: 400 });
  const s = render('left', ctx, { width: 220, height: 400 });
  const m = render('bottom', ctx, { width: 288, height: 160 });
  const l = render('right', ctx, { width: 480, height: 600 });
  assert.match(xs, /ideas-chip/);
  assert.doesNotMatch(xs, /<form|<li/);
  assert.match(s, /data-open-dialog="idea-dialog"/);
  assert.doesNotMatch(s, /<form/);
  assert.match(m, /data-ideas-form="quick-capture"/);
  assert.equal((m.match(/<li /g) ?? []).length, 2);
  assert.match(l, /data-ideas-form="quick-capture"/);
  assert.match(l, /data-action="voice.start"/);
  assert.equal((l.match(/<li /g) ?? []).length, 3); // alice sees 3 ideas (own + shared project)
});

test('horizontal and vertical rails declare their orientation', () => {
  const ctx = ctxFor(alice);
  assert.match(render('top', ctx), /data-orientation="horizontal"/);
  assert.match(render('bottom', ctx), /data-orientation="horizontal"/);
  assert.match(render('left', ctx), /data-orientation="vertical"/);
  assert.match(render('right', ctx), /data-orientation="vertical"/);
});

test('several instances in the same rail get distinct ids via instanceId', () => {
  const a = render('bottom', ctxFor(alice, { instanceId: 'dock-1' }), { width: 300, height: 200 });
  const b = render('bottom', ctxFor(alice, { instanceId: 'dock-2' }), { width: 300, height: 200 });
  assert.deepEqual(duplicateIds(a + b), []);
  for (const html of [a, b]) assert.deepEqual(unlabelledControls(html), []);
});

test('all legacy slots and rails render together without id collisions', () => {
  const ctx = ctxFor(alice);
  const html = [...manifest.slots, ...manifest.rails].map(target => render(target, ctx)).join('');
  assert.deepEqual(duplicateIds(html), []);
});

test('compact rows shorten long titles without splitting characters; the workbench keeps the full text', () => {
  const long = '😀'.repeat(100);
  const ctx = { ideas: [{ id: 'long', text: long, order: 1 }, { id: 'lines', text: 'Zeile eins\nZeile zwei', order: 2 }] };
  const html = render('right', ctx, { width: 480, height: 600 });
  const titles = [...html.matchAll(/<strong>([^<]*)<\/strong><small>/g)].map(m => m[1]);
  assert.equal(titles.length, 2);
  assert.equal(Array.from(titles[0]).length, COMPACT_TITLE_MAX);
  assert.ok(titles[0].endsWith('…'));
  assert.doesNotMatch(titles[0], /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/, 'no lone surrogates');
  assert.equal(titles[1], 'Zeile eins Zeile zwei');
  assert.ok(render('center', ctx).includes(long), 'workbench shows the full idea');
});

test('compact entries are keyboard focusable drag sources with instructions', () => {
  const html = render('right', ctxFor(alice), { width: 480, height: 600 });
  const entries = [...html.matchAll(/<li class="item-row idea-entry"[^>]*>/g)].map(m => m[0]);
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    assert.match(entry, /tabindex="0"/);
    assert.match(entry, /draggable="true"/);
    const help = entry.match(/aria-describedby="([^"]+)"/)[1];
    assert.match(html, new RegExp(`<p id="${help}" class="sr-only">`));
  }
});
