import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyIdeaCommand, commandFromAction, commandFromForm, ideaRef, parseIdeaRef, cleanText, visibleIdeas, tenantScope } from '../src/index.mjs';
import { alice, bob, clock, fixture } from './fixtures.mjs';

const run = (state, command, actor = alice) => applyIdeaCommand(state, command, actor, { now: clock });
const byId = (state, id) => state.ideas.find(i => i.id === id);
const audio = { ref: 'austriq:media:m-new', mimeType: 'audio/ogg', durationMs: 12345.6, source: 'whispr-bridge' };

test('opaque refs round-trip and reject malformed input', () => {
  assert.equal(ideaRef('i-text'), 'austriq:idea:i-text');
  assert.equal(parseIdeaRef('austriq:idea:i-text'), 'i-text');
  for (const bad of [null, 42, '', 'i-text', 'austriq:idea:', 'austriq:idea:../x', 'austriq:idea:a b', 'austriq:idea:__proto__x<', 'austriq:project:p1', 'austriq:idea:' + 'x'.repeat(80)]) {
    assert.equal(parseIdeaRef(bad), null, String(bad));
  }
  assert.equal(ideaRef('<bad>'), null);
});

test('text idea can be captured with project assignment', () => {
  const result = run(fixture(), { type: 'idea.create', id: 'n1', text: '  Neue Idee\r\nZeile 2‮ ', projectId: 'p-alpha' });
  assert.equal(result.ok, true);
  const idea = byId(result.state, 'n1');
  assert.equal(idea.text, 'Neue Idee\nZeile 2');
  assert.equal(idea.projectId, 'p-alpha');
  assert.equal(idea.kind, 'text');
  assert.equal(idea.tenantId, 'tenant-a');
  assert.equal(idea.ownerId, 'user-a1');
  assert.equal(idea.revision, 1);
  assert.equal(idea.createdAt, clock());
  assert.ok(Object.isFrozen(idea));
  assert.equal(result.event.type, 'idea.created');
  assert.equal(result.event.ref, 'austriq:idea:n1');
  // newest idea is on top of the inbox
  const visible = visibleIdeas(result.state.ideas, result.state.projects, tenantScope({ actor: alice }));
  assert.equal(visible[0].id, 'n1');
});

test('quick capture from the inbox without project and from form data', () => {
  const command = commandFromForm('quick-capture', [['text', 'Formular-Idee'], ['projectId', '']], { id: 'n2' });
  assert.deepEqual(command, { type: 'idea.create', id: 'n2', text: 'Formular-Idee', projectId: null });
  const result = run(fixture(), command);
  assert.equal(result.ok, true);
  assert.equal(byId(result.state, 'n2').projectId, null);
});

test('voice idea stores original audio and transcript as separate artifacts', () => {
  const result = run(fixture(), {
    type: 'idea.create', id: 'v1', text: '', audio,
    transcript: { status: 'ready', text: 'Transkript synthetisch', source: 'whispr-bridge', language: 'de' },
  });
  assert.equal(result.ok, true);
  const idea = byId(result.state, 'v1');
  assert.equal(idea.kind, 'voice');
  assert.deepEqual(idea.audio, { ref: 'austriq:media:m-new', mimeType: 'audio/ogg', durationMs: 12346, source: 'whispr-bridge' });
  assert.equal(idea.transcript.text, 'Transkript synthetisch');
  assert.equal(idea.text, '');
  assert.deepEqual(result.event.changed, ['text', 'projectId', 'audio', 'transcript']);
});

test('audio-only idea without transcript (local fallback) is allowed', () => {
  const result = run(fixture(), { type: 'idea.create', id: 'v2', audio: { ref: 'austriq:media:m-local', source: 'local' } });
  assert.equal(result.ok, true);
  assert.equal(byId(result.state, 'v2').transcript, null);
  assert.equal(byId(result.state, 'v2').audio.source, 'local');
});

test('editing the transcript never touches the original audio', () => {
  const state = fixture();
  const before = byId(state, 'i-voice').audio;
  const command = commandFromForm('transcript', { ref: 'austriq:idea:i-voice', expectedRevision: '2', transcript: 'Korrigiertes Transkript' });
  const result = run(state, command);
  assert.equal(result.ok, true);
  const idea = byId(result.state, 'i-voice');
  assert.deepEqual(idea.audio, before);
  assert.equal(idea.transcript.text, 'Korrigiertes Transkript');
  assert.equal(idea.transcript.source, 'manual');
  assert.equal(idea.revision, 3);
  assert.deepEqual(result.event.changed, ['transcript']);
});

test('editing text keeps audio and transcript', () => {
  const state = fixture();
  const result = run(state, commandFromForm('edit', { ref: 'austriq:idea:i-voice', expectedRevision: '2', text: 'Titel für Sprachidee' }));
  assert.equal(result.ok, true);
  const idea = byId(result.state, 'i-voice');
  assert.equal(idea.text, 'Titel für Sprachidee');
  assert.deepEqual(idea.audio, byId(state, 'i-voice').audio);
  assert.deepEqual(idea.transcript, byId(state, 'i-voice').transcript);
});

test('project can be switched and cleared', () => {
  let state = fixture();
  let result = run(state, commandFromAction('idea.assignProject', { ref: 'austriq:idea:i-text', value: 'p-shared' }));
  assert.equal(result.ok, true);
  assert.equal(byId(result.state, 'i-text').projectId, 'p-shared');
  assert.equal(result.event.projectRef, 'austriq:project:p-shared');
  state = result.state;
  result = run(state, commandFromAction('idea.assignProject', { ref: 'austriq:idea:i-text', value: '' }));
  assert.equal(result.ok, true);
  assert.equal(byId(result.state, 'i-text').projectId, null);
  assert.equal(run(result.state, { type: 'idea.assignProject', ref: 'austriq:idea:i-text', projectId: null }).code, 'no_change');
});

test('ideas can be moved inside the inbox (reorder)', () => {
  const state = fixture();
  const order = s => visibleIdeas(s.ideas, s.projects, tenantScope({ actor: alice })).map(i => i.id);
  assert.deepEqual(order(state), ['i-text', 'i-voice', 'i-shared']);
  let result = run(state, commandFromAction('idea.move', { ref: 'austriq:idea:i-text', direction: 'down' }));
  assert.equal(result.ok, true);
  assert.deepEqual(order(result.state), ['i-voice', 'i-text', 'i-shared']);
  result = run(result.state, { type: 'idea.move', ref: 'austriq:idea:i-shared', toIndex: 0 });
  assert.deepEqual(order(result.state), ['i-shared', 'i-voice', 'i-text']);
  assert.equal(run(result.state, { type: 'idea.move', ref: 'austriq:idea:i-shared', direction: 'up' }).code, 'no_change');
  assert.equal(run(result.state, { type: 'idea.move', ref: 'austriq:idea:i-shared' }).code, 'bad_position');
  // ideas of other users/tenants keep their order untouched
  assert.equal(byId(result.state, 'i-bob').order, 3);
  assert.equal(byId(result.state, 'i-foreign').order, 0);
});

test('delete removes the idea and reports media refs for host-side cleanup', () => {
  const result = run(fixture(), commandFromAction('idea.delete', { ref: 'austriq:idea:i-voice' }));
  assert.equal(result.ok, true);
  assert.equal(byId(result.state, 'i-voice'), undefined);
  assert.deepEqual(result.event.mediaRefs, ['austriq:media:m-voice']);
  assert.equal(result.state.ideas.length, 4);
});

test('validation errors are explicit and never throw', () => {
  const state = fixture();
  const cases = [
    [{ type: 'idea.create', id: 'x', text: '   ' }, 'text_required'],
    [{ type: 'idea.create', id: 'x', text: 'a'.repeat(1201) }, 'text_too_long'],
    [{ type: 'idea.create', id: 'bad id', text: 'a' }, 'bad_id'],
    [{ type: 'idea.create', id: 'i-text', text: 'dup' }, 'conflict'],
    [{ type: 'idea.create', id: 'x', text: 'a', audio: { ref: 'https://example.invalid/a.webm' } }, 'bad_media_ref'],
    [{ type: 'idea.create', id: 'x', text: 'a', audio: { ref: 'austriq:media:m1', mimeType: 'text/html' } }, 'bad_audio'],
    [{ type: 'idea.create', id: 'x', text: 'a', transcript: { status: 'ready', text: 't' } }, 'transcript_requires_audio'],
    [{ type: 'idea.create', id: 'x', audio, transcript: { status: 'bogus' } }, 'bad_transcript'],
    [{ type: 'idea.create', id: 'x', text: 'a', projectId: 'nope' }, 'project_not_found'],
    [{ type: 'idea.update', ref: 'austriq:idea:i-text', text: 'neu', expectedRevision: 7 }, 'conflict'],
    [{ type: 'idea.update', ref: 'austriq:idea:i-text', text: '' }, 'text_required'],
    [{ type: 'idea.setTranscript', ref: 'austriq:idea:i-text', transcript: { status: 'ready', text: 't' } }, 'transcript_requires_audio'],
    [{ type: 'idea.drop' }, 'bad_command'],
    [null, 'bad_command'],
  ];
  for (const [command, code] of cases) assert.equal(run(state, command).code, code, JSON.stringify(command));
  assert.equal(run(null, { type: 'idea.create', id: 'x', text: 'a' }).ok, true);
});

test('cleanText strips control, zero-width and bidi characters', () => {
  assert.equal(cleanText('a\u0000b​c‮d⁦e﻿\tf'), 'abcde\tf');
  assert.equal(cleanText(42), '');
});

test('commandFromForm ignores files and unknown forms', () => {
  const file = { name: 'x.webm' };
  assert.equal(commandFromForm('quick-capture', [['text', file], ['text', 'echt']], { id: 'n' }).text, 'echt');
  assert.equal(commandFromForm('unknown', []), null);
  assert.equal(commandFromAction('idea.explode', {}), null);
  assert.equal(commandFromAction('idea.move', { ref: 'r', direction: 'sideways' }).direction, undefined);
});

test('a project member may edit a shared idea but only the owner may delete it', () => {
  const state = fixture();
  assert.equal(run(state, { type: 'idea.update', ref: 'austriq:idea:i-shared', text: 'Ergänzt' }, alice).ok, true);
  assert.equal(run(state, { type: 'idea.delete', ref: 'austriq:idea:i-shared' }, alice).code, 'forbidden');
  assert.equal(run(state, { type: 'idea.delete', ref: 'austriq:idea:i-shared' }, bob).ok, true);
});
