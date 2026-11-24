// No personal-data leakage: events, proposals, errors, drag state and setup data carry opaque
// refs only. Static guard: the module source contains no network, device, storage or eval APIs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { applyIdeaCommand, proposeTransfer, resolveDrop, dragReducer, dropTargets, DRAG_IDLE, setupStatus, createVoiceCapture, manifest } from '../src/index.mjs';
import { alice, bob, mallory, clock, ctxFor, fixture, SECRET } from './fixtures.mjs';

const leaks = value => JSON.stringify(value).includes(SECRET) || JSON.stringify(value).includes('Synthetisch');

test('command events and errors never contain idea text or transcripts', () => {
  const state = fixture();
  const commands = [
    { type: 'idea.create', id: 'n1', text: 'Neu ' + SECRET },
    { type: 'idea.create', id: 'n2', audio: { ref: 'austriq:media:m2' }, transcript: { status: 'ready', text: SECRET } },
    { type: 'idea.update', ref: 'austriq:idea:i-text', text: 'Update ' + SECRET },
    { type: 'idea.setTranscript', ref: 'austriq:idea:i-voice', transcript: { status: 'ready', text: SECRET } },
    { type: 'idea.assignProject', ref: 'austriq:idea:i-text', projectId: 'p-shared' },
    { type: 'idea.move', ref: 'austriq:idea:i-text', direction: 'down' },
    { type: 'idea.delete', ref: 'austriq:idea:i-voice' },
  ];
  for (const actor of [alice, bob, mallory, null]) {
    for (const command of commands) {
      const result = applyIdeaCommand(state, command, actor, { now: clock });
      if (result.ok) assert.ok(!leaks(result.event), command.type);
      else assert.ok(!leaks(result), command.type);
    }
  }
  assert.equal(applyIdeaCommand(state, { type: 'idea.create', id: 'x', text: SECRET.repeat(200) }, alice).code, 'text_too_long');
});

test('workflow proposals and drop results carry opaque refs only', () => {
  const ctx = ctxFor(alice);
  for (const ref of ['austriq:idea:i-text', 'austriq:idea:i-voice']) {
    for (const target of ['learn', 'experience', 'studio', 'calendar']) {
      const result = proposeTransfer(ctx, { ref, target });
      assert.equal(result.ok, true);
      assert.ok(!leaks(result), `${ref} → ${target}`);
      assert.ok(!JSON.stringify(result).includes('austriq:media:'), 'no media refs leave the module via proposals');
    }
    for (const target of dropTargets(ctx)) {
      const drag = dragReducer(DRAG_IDLE, { type: 'drop', ref, targetId: target.id, targets: dropTargets(ctx) });
      assert.ok(!leaks(drag));
      assert.ok(!leaks(resolveDrop(ctx, drag.drop)));
    }
  }
});

test('setup status and voice results contain no user content', async () => {
  assert.ok(!leaks(setupStatus(ctxFor(alice))));
  const voice = createVoiceCapture({ settings: { voice: { enabled: true } }, capabilities: ['voice:capture'], consent: { audio: true } });
  assert.ok(!leaks(await voice.start()));
});

test('manifest declares no network and host-provided data only', () => {
  assert.equal(manifest.network, 'none');
  assert.equal(manifest.dataAccess, 'host-provided-only');
  assert.ok(!leaks(manifest));
});

test('module source uses no network, device, storage, logging or dynamic code APIs', async () => {
  const forbidden = [
    /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /navigator\./, /sendBeacon/, /mediaDevices/, /getUserMedia/,
    /MediaRecorder/, /localStorage/, /sessionStorage/, /indexedDB/, /document\.cookie/, /\beval\s*\(/, /new\s+Function\s*\(/,
    /\bimport\s*\(/, /console\./, /innerHTML/, /process\.env/, /https?:\/\//,
  ];
  const dir = new URL('../src/', import.meta.url);
  const files = (await readdir(dir)).filter(name => name.endsWith('.mjs'));
  assert.ok(files.length >= 6);
  for (const name of files) {
    const source = await readFile(new URL(name, dir), 'utf8');
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${name} uses ${pattern}`);
  }
});
