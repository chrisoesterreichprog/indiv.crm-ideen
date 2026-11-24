import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyIdeaCommand, commandFromAction, commandFromForm, ideaRef, parseIdeaRef, parseRevision, cleanText, render, visibleIdeas, tenantScope } from '../src/index.mjs';
import { alice, bob, clock, ctxFor, fixture } from './fixtures.mjs';

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
  const order = s => visibleIdeas(s.ideas, s.projects, tenantScope({ actor: alice })).map(i => i.id);
  // a second Inbox idea (newest on top) next to the existing Inbox voice idea
  let result = run(fixture(), { type: 'idea.create', id: 'n-inbox', text: 'Zweite Inbox-Idee' });
  const state = result.state;
  assert.deepEqual(order(state), ['n-inbox', 'i-text', 'i-voice', 'i-shared']);
  // ↓ skips the Alpha idea in between: it swaps with the next idea of the same (Inbox) lane
  result = run(state, commandFromAction('idea.move', { ref: 'austriq:idea:n-inbox', direction: 'down' }));
  assert.equal(result.ok, true);
  assert.deepEqual(order(result.state), ['i-text', 'i-voice', 'n-inbox', 'i-shared']);
  assert.equal(result.event.position, 2);
  result = run(result.state, { type: 'idea.move', ref: 'austriq:idea:n-inbox', direction: 'up' });
  assert.deepEqual(order(result.state), ['i-text', 'n-inbox', 'i-voice', 'i-shared']);
  // `toIndex` stays an absolute position in the overall list (compact views)
  result = run(result.state, { type: 'idea.move', ref: 'austriq:idea:i-shared', toIndex: 0 });
  assert.deepEqual(order(result.state), ['i-shared', 'i-text', 'n-inbox', 'i-voice']);
  assert.equal(run(result.state, { type: 'idea.move', ref: 'austriq:idea:i-shared', toIndex: 0 }).code, 'no_change');
  assert.equal(run(result.state, { type: 'idea.move', ref: 'austriq:idea:i-shared' }).code, 'bad_position');
  // ideas of other users/tenants keep their order untouched
  assert.equal(byId(result.state, 'i-bob').order, 3);
  assert.equal(byId(result.state, 'i-foreign').order, 0);
});

test('↑/↓ never jump across project lanes (visible no-op is refused, revision unchanged)', () => {
  const state = fixture();
  // Alpha, Inbox and Shared each hold a single idea for alice: nothing to swap with
  for (const [ref, direction] of [['i-text', 'down'], ['i-text', 'up'], ['i-voice', 'up'], ['i-voice', 'down'], ['i-shared', 'up']]) {
    assert.equal(run(state, { type: 'idea.move', ref: 'austriq:idea:' + ref, direction }).code, 'no_change', ref + ' ' + direction);
  }
  assert.equal(byId(state, 'i-text').revision, 1);
  // an idea in a project the viewer is no member of sits in the viewer's Inbox lane
  const hidden = fixture();
  hidden.ideas.push({ id: 'i-own-hidden', tenantId: 'tenant-a', ownerId: 'user-a1', projectId: 'p-bob', text: 'Eigene Idee im fremden Projekt', order: 5, revision: 1 });
  const moved = run(hidden, { type: 'idea.move', ref: 'austriq:idea:i-own-hidden', direction: 'up' });
  assert.equal(moved.ok, true);
  const order = visibleIdeas(moved.state.ideas, moved.state.projects, tenantScope({ actor: alice })).map(i => i.id);
  assert.ok(order.indexOf('i-own-hidden') < order.indexOf('i-voice'), 'swapped with the Inbox neighbour');
  assert.ok(order.indexOf('i-own-hidden') > order.indexOf('i-text'), 'Alpha idea untouched');
});

test('actions carry the rendered revision so stale views cannot delete, move or reassign', () => {
  const state = fixture();
  const edited = run(state, { type: 'idea.update', ref: 'austriq:idea:i-text', text: 'von jemand anderem geändert' }).state;
  const stale = { ref: 'austriq:idea:i-text', expectedRevision: '1' }; // as read from `dataset`
  assert.equal(run(edited, commandFromAction('idea.delete', stale)).code, 'conflict');
  assert.equal(run(edited, commandFromAction('idea.assignProject', { ...stale, value: 'p-shared' })).code, 'conflict');
  assert.equal(run(edited, commandFromAction('idea.move', { ...stale, direction: 'down' })).code, 'conflict');
  assert.ok(byId(edited, 'i-text'), 'nothing deleted');
  assert.equal(run(edited, commandFromAction('idea.delete', { ...stale, expectedRevision: '2' })).ok, true);
  // only plain non-negative integers count; garbage is ignored instead of guessed
  for (const bad of ['1abc', '-1', '1.5', ' 1', '', 'NaN', -1, 1.5, null, {}]) {
    assert.equal(parseRevision(bad), undefined, String(bad));
    assert.equal('expectedRevision' in commandFromAction('idea.delete', { ...stale, expectedRevision: bad }), false);
  }
  assert.equal(parseRevision('0'), 0);
  assert.equal(parseRevision(7), 7);
  assert.equal(commandFromForm('edit', { ref: 'austriq:idea:i-text', expectedRevision: '2x', text: 'x' }).expectedRevision, undefined);
  // the workbench renders the guard on every mutating control
  const html = render('center', ctxFor(alice));
  for (const action of ['idea.assignProject', 'idea.move', 'idea.delete']) {
    const controls = [...html.matchAll(new RegExp(`<(?:button|select)[^>]*data-action="${action}"[^>]*>`, 'g'))].map(m => m[0]);
    assert.ok(controls.length >= 3, action);
    for (const control of controls) assert.match(control, /data-expected-revision="\d+"/, action);
  }
});

test('commandFromAction never throws for missing or hostile data', () => {
  for (const data of [null, undefined, 'x', 42, []]) {
    assert.deepEqual(commandFromAction('idea.move', data), { type: 'idea.move', ref: undefined, direction: undefined });
    assert.equal(run(fixture(), commandFromAction('idea.delete', data)).code, 'bad_ref');
  }
});

test('workbench disables ↑/↓ at the edges of each lane', () => {
  const state = run(fixture(), { type: 'idea.create', id: 'n-inbox', text: 'Zweite Inbox-Idee' }).state;
  const html = render('center', ctxFor(alice, state));
  const control = (ref, direction) => html.match(new RegExp(`<button[^>]*data-ref="austriq:idea:${ref}"[^>]*data-direction="${direction}"[^>]*>`))[0];
  assert.match(control('n-inbox', 'up'), /\sdisabled/);
  assert.doesNotMatch(control('n-inbox', 'down'), /\sdisabled/);
  assert.doesNotMatch(control('i-voice', 'up'), /\sdisabled/);
  assert.match(control('i-voice', 'down'), /\sdisabled/);
  assert.match(control('i-text', 'up'), /\sdisabled/);
  assert.match(control('i-text', 'down'), /\sdisabled/);
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
