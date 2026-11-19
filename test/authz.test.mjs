// Negative authorization tests: unauthenticated, revoked, cross-tenant, cross-user, bad refs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyIdeaCommand, render, proposeTransfer, resolveDrop, manifest, setupStatus } from '../src/index.mjs';
import { alice, bob, mallory, revokedAlice, clock, ctxFor, fixture, FOREIGN, SECRET } from './fixtures.mjs';

const run = (command, actor, state = fixture()) => applyIdeaCommand(state, command, actor, { now: clock });
const create = { type: 'idea.create', id: 'n1', text: 'Synthetische Idee' };

test('unauthenticated actors are denied for every command', () => {
  for (const actor of [undefined, null, {}, { userId: 'user-a1' }, { tenantId: 'tenant-a' }, { userId: 'u 1', tenantId: 'tenant-a', status: 'active' }, { userId: 'user-a1', tenantId: 'tenant-a' }, 'alice']) {
    assert.equal(run(create, actor).code, 'unauthenticated', JSON.stringify(actor));
    assert.equal(run({ type: 'idea.delete', ref: 'austriq:idea:i-text' }, actor).code, 'unauthenticated');
  }
});

test('revoked and suspended actors are denied', () => {
  assert.equal(run(create, revokedAlice).code, 'revoked');
  assert.equal(run(create, { ...alice, status: 'suspended' }).code, 'revoked');
  assert.equal(run({ type: 'idea.update', ref: 'austriq:idea:i-text', text: 'x' }, revokedAlice).code, 'revoked');
});

test('cross-tenant access looks like not_found and changes nothing', () => {
  const state = fixture();
  for (const command of [
    { type: 'idea.update', ref: 'austriq:idea:i-text', text: 'gekapert' },
    { type: 'idea.delete', ref: 'austriq:idea:i-text' },
    { type: 'idea.move', ref: 'austriq:idea:i-text', direction: 'down' },
    { type: 'idea.assignProject', ref: 'austriq:idea:i-text', projectId: 'p-foreign' },
    { type: 'idea.setTranscript', ref: 'austriq:idea:i-voice', transcript: { status: 'ready', text: 'x' } },
  ]) {
    const result = run(command, mallory, state);
    assert.deepEqual(result, { ok: false, code: 'not_found' }, command.type);
  }
  assert.deepEqual(state, fixture());
});

test('ideas cannot be assigned to projects of another tenant or without membership', () => {
  assert.equal(run({ type: 'idea.assignProject', ref: 'austriq:idea:i-text', projectId: 'p-foreign' }, alice).code, 'project_not_found');
  assert.equal(run({ type: 'idea.assignProject', ref: 'austriq:idea:i-text', projectId: 'p-bob' }, alice).code, 'project_forbidden');
  assert.equal(run({ ...create, projectId: 'p-bob' }, alice).code, 'project_forbidden');
  assert.equal(run({ ...create, projectId: '../p-alpha' }, alice).code, 'bad_project');
});

test('cross-user access within a tenant is forbidden', () => {
  assert.equal(run({ type: 'idea.update', ref: 'austriq:idea:i-bob', text: 'x' }, alice).code, 'forbidden');
  assert.equal(run({ type: 'idea.delete', ref: 'austriq:idea:i-text' }, bob).code, 'forbidden');
  assert.equal(run({ type: 'idea.move', ref: 'austriq:idea:i-voice', direction: 'up' }, bob).code, 'forbidden');
});

test('bad refs are rejected before any lookup', () => {
  for (const ref of [undefined, '', 'i-text', 'austriq:idea:', 'austriq:media:m-voice', 'austriq:idea:<x>', { id: 'i-text' }]) {
    assert.equal(run({ type: 'idea.update', ref, text: 'x' }, alice).code, 'bad_ref', String(ref));
    assert.equal(proposeTransfer(ctxFor(alice), { ref, target: 'learn' }).code, 'bad_ref');
    assert.equal(resolveDrop(ctxFor(alice), { ref, targetId: 'transfer:learn' }).code, 'bad_ref');
  }
});

test('rendering is isolated per tenant and user', () => {
  for (const target of [...manifest.slots, ...manifest.rails]) {
    const html = render(target, ctxFor(alice), { width: 900, height: 900 });
    assert.doesNotMatch(html, new RegExp(FOREIGN), target);
    assert.doesNotMatch(html, /i-bob|Bob intern/, target);
  }
  const malloryView = render('center', ctxFor(mallory));
  assert.doesNotMatch(malloryView, new RegExp(SECRET));
  assert.match(malloryView, /Fremde Idee/);
});

test('tenantId-only scope filters records without tenant', () => {
  const html = render('center', { ideas: [{ id: 'legacy', text: 'ohne Mandant' }, ...fixture().ideas], projects: fixture().projects, tenantId: 'tenant-b' });
  assert.doesNotMatch(html, /ohne Mandant/);
  assert.doesNotMatch(html, new RegExp(SECRET));
  assert.match(html, /Fremde Idee/);
});

test('revoked, malformed or unauthenticated scopes render no data at all', () => {
  for (const scope of [{ actor: revokedAlice }, { actor: { userId: 'user-a1' } }, { tenantId: '' }, { tenantId: '../a' }]) {
    for (const target of [...manifest.slots, ...manifest.rails, 'settings']) {
      const html = render(target, { ...fixture(), ...scope }, { width: 900, height: 900 });
      assert.doesNotMatch(html, new RegExp(SECRET), target);
      assert.doesNotMatch(html, /Projekt Alpha|Gemeinsame Idee/, target);
      assert.match(html, /Kein Zugriff/, target);
    }
  }
  assert.equal(setupStatus({ ...fixture(), actor: revokedAlice })[0].status, 'blocked');
});

test('transfers require an active actor, the workflow capability and an enabled target', () => {
  const ref = 'austriq:idea:i-text';
  assert.equal(proposeTransfer(ctxFor(revokedAlice), { ref, target: 'learn' }).code, 'revoked');
  assert.equal(proposeTransfer(ctxFor(mallory), { ref, target: 'learn' }).code, 'not_found');
  assert.equal(proposeTransfer(ctxFor(bob), { ref: 'austriq:idea:i-voice', target: 'learn' }).code, 'forbidden');
  assert.equal(proposeTransfer(ctxFor(alice, { capabilities: [] }), { ref, target: 'learn' }).code, 'capability_missing');
  assert.equal(proposeTransfer(ctxFor(alice, { settings: { transfers: { targets: ['studio'] } } }), { ref, target: 'learn' }).code, 'target_disabled');
  assert.equal(proposeTransfer(ctxFor(alice), { ref, target: 'crm-export' }).code, 'bad_target');
  assert.equal(proposeTransfer(ctxFor(alice), { ref, target: '__proto__' }).code, 'bad_target');
});
