// Keyboard and pointer drag & drop: every drop needs confirmation, nothing is written directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dragReducer, dropTargets, resolveDrop, DRAG_IDLE, proposeTransfer, applyIdeaCommand, render, PROPOSAL_CONTRACT } from '../src/index.mjs';
import { alice, clock, ctxFor, duplicateIds, fixture, mallory } from './fixtures.mjs';

const REF = 'austriq:idea:i-text';
const keys = (state, ...list) => list.reduce((s, key) => dragReducer(s, { type: 'key', key }), state);

test('drop targets: inbox, member projects and enabled transfer targets only', () => {
  const ids = dropTargets(ctxFor(alice)).map(t => t.id);
  assert.deepEqual(ids, ['inbox', 'project:p-alpha', 'project:p-shared', 'transfer:learn', 'transfer:experience', 'transfer:studio', 'transfer:calendar']);
  const noWorkflow = dropTargets(ctxFor(alice, { capabilities: [] })).map(t => t.id);
  assert.ok(noWorkflow.every(id => id === 'inbox' || id.startsWith('project:')));
});

test('keyboard: pick up, arrow through targets, Enter chooses, nothing executed yet', () => {
  const targets = dropTargets(ctxFor(alice));
  let state = dragReducer(DRAG_IDLE, { type: 'pickUp', ref: REF, targets });
  assert.equal(state.mode, 'lifted');
  assert.match(state.announcement, /Idee angehoben\. Ziel: Inbox \(ohne Projekt\) \(1 von 7\)/);
  state = keys(state, 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowRight');
  assert.equal(state.targets[state.index].id, 'transfer:experience');
  state = keys(state, 'ArrowUp');
  assert.equal(state.targets[state.index].id, 'transfer:learn');
  state = keys(state, 'End');
  assert.equal(state.targets[state.index].id, 'transfer:calendar');
  state = keys(state, 'ArrowDown');
  assert.equal(state.index, 0, 'wraps around');
  state = keys(state, 'Home', 'ArrowLeft');
  assert.equal(state.targets[state.index].id, 'transfer:calendar');
  const done = keys(state, 'Enter');
  assert.deepEqual(done.drop, { ref: REF, targetId: 'transfer:calendar' });
  assert.equal(done.mode, 'idle');
  assert.match(done.announcement, /Bestätigungsdialog/);
});

test('keyboard: Escape and Tab cancel, other keys are ignored', () => {
  const lifted = dragReducer(DRAG_IDLE, { type: 'pickUp', ref: REF, targets: dropTargets(ctxFor(alice)) });
  assert.equal(keys(lifted, 'Escape').cancelled, true);
  assert.equal(keys(lifted, 'Tab').cancelled, true);
  assert.equal(keys(lifted, 'a', 'Shift').index, 0);
  assert.equal(keys(DRAG_IDLE, 'Enter'), DRAG_IDLE, 'Enter without a lifted idea does nothing');
  assert.equal(dragReducer(lifted, { type: 'cancel' }).cancelled, true);
});

test('pick up of bad refs or without targets fails closed', () => {
  assert.equal(dragReducer(DRAG_IDLE, { type: 'pickUp', ref: 'javascript:alert(1)', targets: dropTargets(ctxFor(alice)) }).error, 'bad_ref');
  assert.equal(dragReducer(DRAG_IDLE, { type: 'pickUp', ref: REF, targets: [] }).error, 'no_targets');
  assert.equal(dragReducer(undefined, { type: 'drop', ref: REF, targetId: 'transfer:nowhere', targets: dropTargets(ctxFor(alice)) }).error, 'bad_drop');
  assert.equal(dragReducer(DRAG_IDLE, { type: 'unknown' }), DRAG_IDLE);
});

test('pointer drop to another module becomes a confirmation-required workflow proposal', () => {
  const ctx = ctxFor(alice);
  const drag = dragReducer(DRAG_IDLE, { type: 'drop', ref: REF, targetId: 'transfer:learn', targets: dropTargets(ctx) });
  const resolved = resolveDrop(ctx, drag.drop);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.kind, 'proposal');
  assert.equal(resolved.requiresConfirmation, true);
  assert.deepEqual(resolved.proposal, {
    contract: PROPOSAL_CONTRACT,
    type: 'ideas.transfer.requested',
    idempotencyKey: 'ideas.transfer:tenant-a:i-text:learn:r1',
    requiresConfirmation: true,
    status: 'proposed',
    source: { module: 'ideas', ref: REF, revision: 1 },
    target: { module: 'learn' },
    payload: { ref: REF, projectRef: 'austriq:project:p-alpha', kind: 'text', hasAudio: false, transcriptStatus: 'none' },
  });
  assert.ok(Object.isFrozen(resolved.proposal.payload));
});

test('idempotency key is stable for repeated drops and changes with the idea revision', () => {
  const ctx = ctxFor(alice);
  const first = proposeTransfer(ctx, { ref: REF, target: 'studio' });
  const again = proposeTransfer(ctx, { ref: REF, target: 'studio' });
  assert.equal(first.proposal.idempotencyKey, again.proposal.idempotencyKey);
  const edited = applyIdeaCommand(fixture(), { type: 'idea.update', ref: REF, text: 'geändert' }, alice, { now: clock });
  const later = proposeTransfer({ ...ctx, ...edited.state }, { ref: REF, target: 'studio' });
  assert.notEqual(later.proposal.idempotencyKey, first.proposal.idempotencyKey);
});

test('idempotency keys are tenant-scoped: the same idea id in another tenant never collides', () => {
  const base = fixture();
  base.ideas.push({ id: 'i-text', schemaVersion: 2, tenantId: 'tenant-b', ownerId: 'user-b1', projectId: null, kind: 'text', text: 'Gleiche ID, anderer Mandant', order: 1, revision: 1 });
  const ours = proposeTransfer(ctxFor(alice, base), { ref: REF, target: 'learn' });
  const theirs = proposeTransfer(ctxFor(mallory, base), { ref: REF, target: 'learn' });
  assert.equal(ours.ok && theirs.ok, true);
  assert.equal(ours.proposal.source.revision, theirs.proposal.source.revision);
  assert.notEqual(ours.proposal.idempotencyKey, theirs.proposal.idempotencyKey);
});

test('drop on a project lane is a confirmation-required command, never applied automatically', () => {
  const ctx = ctxFor(alice);
  const before = JSON.stringify(ctx.ideas);
  const resolved = resolveDrop(ctx, { ref: REF, targetId: 'project:p-shared' });
  assert.deepEqual(resolved, { ok: true, kind: 'command', requiresConfirmation: true, command: { type: 'idea.assignProject', ref: REF, projectId: 'p-shared', expectedRevision: 1 } });
  assert.equal(JSON.stringify(ctx.ideas), before, 'context state untouched');
  assert.equal(resolveDrop(ctx, { ref: REF, targetId: 'project:p-alpha' }).code, 'no_change');
  assert.equal(resolveDrop(ctx, { ref: REF, targetId: 'project:p-bob' }).code, 'bad_target');
  assert.equal(resolveDrop(ctx, { ref: 'austriq:idea:i-bob', targetId: 'inbox' }).code, 'forbidden');
  assert.equal(resolveDrop(ctx, { ref: REF, targetId: 'transfer:crm-export' }).code, 'bad_target');
  assert.equal(resolveDrop(ctx, { ref: REF, targetId: 'project:inbox' }).code, 'bad_target', 'old inbox id is no longer a target');
  assert.equal(resolveDrop({ ...ctx, actor: undefined }, { ref: REF, targetId: 'inbox' }).code, 'unauthenticated');
});

test('a confirmed project drop of a meanwhile edited idea is rejected as conflict', () => {
  const ctx = ctxFor(alice);
  const { command } = resolveDrop(ctx, { ref: REF, targetId: 'project:p-shared' });
  const edited = applyIdeaCommand(fixture(), { type: 'idea.update', ref: REF, text: 'inzwischen geändert' }, alice, { now: clock });
  assert.equal(applyIdeaCommand(edited.state, command, alice, { now: clock }).code, 'conflict');
  assert.equal(applyIdeaCommand(fixture(), command, alice, { now: clock }).ok, true);
});

test('a project whose id is "inbox" stays a project target and never clears the assignment', () => {
  const base = fixture();
  base.projects.push({ id: 'inbox', tenantId: 'tenant-a', name: 'Projekt namens Inbox', ownerId: 'user-a1', memberIds: ['user-a1'] });
  const ctx = ctxFor(alice, base);
  const targets = dropTargets(ctx).map(t => t.id);
  assert.equal(new Set(targets).size, targets.length, 'drop target ids are unique');
  assert.ok(targets.includes('inbox') && targets.includes('project:inbox'));
  assert.equal(resolveDrop(ctx, { ref: REF, targetId: 'project:inbox' }).command.projectId, 'inbox');
  assert.equal(resolveDrop(ctx, { ref: REF, targetId: 'inbox' }).command.projectId, null);
  const html = render('center', ctx);
  assert.deepEqual(duplicateIds(html), []);
  assert.equal((html.match(/data-drop-target="inbox"/g) ?? []).length, 1);
  assert.equal((html.match(/data-drop-target="project:inbox"/g) ?? []).length, 1);
});

test('workbench exposes drop zones and keyboard alternatives for every idea', () => {
  const html = render('center', ctxFor(alice));
  for (const id of ['inbox', 'project:p-alpha', 'project:p-shared', 'transfer:learn', 'transfer:experience', 'transfer:studio', 'transfer:calendar']) {
    assert.match(html, new RegExp(`data-drop-target="${id}"`));
  }
  const cards = [...html.matchAll(/<li class="idea-work-card"[^>]*>/g)].map(m => m[0]);
  assert.equal(cards.length, 3);
  for (const card of cards) {
    assert.match(card, /tabindex="0"/);
    assert.match(card, /draggable="true"/);
    assert.match(card, /data-drag-ref="austriq:idea:[A-Za-z0-9_-]+"/);
  }
  assert.equal((html.match(/data-action="idea.pickUp"/g) ?? []).length, 3);
  assert.equal((html.match(/data-direction="up"/g) ?? []).length, 3);
  assert.match(html, /role="status" aria-live="polite" data-ideas-live/);
  assert.match(html, /erst nach Bestätigung/);
});
