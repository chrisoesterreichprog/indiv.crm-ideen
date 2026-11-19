import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifest, render } from '../src/index.mjs';
import { ctxFor, alice, duplicateIds, unlabelledControls } from './fixtures.mjs';
const state = {
  stages:['Lead','Kontakt','Bedarf','Loesung & Umfang','Angebot','Auftrag'],
  projects:[{id:'p1',name:'Beispielprojekt'}],
  contacts:[{id:'c1',firstName:'Ein',lastName:'Kontakt',email:'ein@example.invalid',projectId:'p1'}],
  opportunities:[{id:'o1',title:'Testchance',contactId:'c1',stage:'Lead'}],
  events:[{id:'e1',title:'Meeting',date:'2026-12-03',projectId:'p1'}],
  ideas:[{id:'i1',text:'Idee',projectId:'p1'}],
  modules:[{id:'contacts',label:'Kontakte',group:'CRM'}],emails:[]
};
test('contract and version are explicit',()=>{
  assert.equal(manifest.apiVersion,1);
  assert.equal(typeof manifest.id,'string');
  assert.equal(manifest.slots.length,8);
  assert.equal(manifest.dataAccess,'host-provided-only');
});
test('each dock position and full workbench returns its own safe markup',()=>{
  const ctx={state,...state};
  const views=manifest.slots.map(slot=>render(slot,ctx));
  assert.ok(views.every(v=>typeof v==='string'&&v.length>30));
  assert.match(views[0],/module-workbench/);
  assert.ok(views.slice(1).every(v=>v.includes('widget-')));
  assert.equal(new Set(views).size,manifest.slots.length);
});
test('unknown slot fails closed',()=>assert.throws(()=>render('__proto__', {state}),RangeError));
test('render handles no records safely',()=>{
  for(const slot of manifest.slots) assert.equal(typeof render(slot,{state:{}}),'string');
});

test('v2 contract is advertised without breaking v1 hosts', () => {
  assert.deepEqual(manifest.apiVersions, [1, 2]);
  assert.equal(manifest.contractStatus, 'provisional');
  assert.deepEqual(manifest.rails, ['top', 'bottom', 'left', 'right']);
  assert.deepEqual(manifest.views, ['initialization', 'settings', 'workbench']);
  assert.equal(manifest.network, 'none');
  assert.ok(manifest.ports.out.every(port => port.carries === 'opaque-ref'));
});

test('manifest is deeply immutable', () => {
  assert.ok(Object.isFrozen(manifest) && Object.isFrozen(manifest.slots) && Object.isFrozen(manifest.ports.out[0]));
  assert.throws(() => { 'use strict'; manifest.slots.push('evil'); }, TypeError);
});

test('invalid targets and contexts fail closed', () => {
  for (const target of [undefined, null, 42, '', 'constructor', 'toString', 'CENTER', 'top ', 'footer']) {
    assert.throws(() => render(target, { state }), RangeError);
  }
  assert.throws(() => render('center', null), TypeError);
  assert.throws(() => render('top', 'ctx'), TypeError);
});

test('three mandatory views render for an authorized actor', () => {
  const ctx = ctxFor(alice);
  assert.match(render('initialization', ctx), /data-view="initialization"/);
  assert.match(render('settings', ctx), /data-view="settings"[^>]*data-ideas-form="settings"/);
  assert.match(render('workbench', ctx), /data-view="workbench"/);
  assert.equal(render('workbench', ctx), render('center', ctx));
});

test('user content is escaped in every view', () => {
  const payload = '<img src=x onerror="alert(1)">`\'"</textarea><script>x</script>';
  const ctx = {
    ideas: [{ id: 'x1', text: payload, projectId: 'p1', audio: { ref: 'austriq:media:m1' }, transcript: { status: 'ready', text: payload } }],
    projects: [{ id: 'p1', name: payload }],
    instanceId: '"><script>',
  };
  for (const target of [...manifest.slots, ...manifest.rails, 'settings', 'initialization']) {
    for (const width of [100, 200, 300, 900]) {
      const html = render(target, ctx, { width, height: 400 });
      assert.doesNotMatch(html, /<script|<img|<\/textarea><script/i, target + '@' + width);
      assert.doesNotMatch(html, /onerror="/i, target + '@' + width);
    }
  }
});

test('hostile host data in transcript fields degrades to safe labels', () => {
  const html = render('center', { ideas: [{ id: 'x', audio: { ref: 'austriq:media:m' }, transcript: { status: '"><b>', reason: '__proto__' } }] });
  assert.match(html, /Transkription fehlgeschlagen/);
  assert.doesNotMatch(html, /<b>|\[object Object\]/);
});

test('legacy footer-right keeps the quick-capture form hooks with project options', () => {
  const html = render('footer-right', { state });
  assert.match(html, /<form id="quick-idea"[^>]*data-ideas-form="quick-capture"/);
  assert.match(html, /id="quick-idea-text" name="text" maxlength="1200"/);
  assert.match(html, /<select name="projectId" id="quick-idea-project"><option value="" selected>Inbox \(ohne Projekt\)<\/option><option value="p1">Beispielprojekt<\/option>/);
});

test('workbench has unique ids and labelled controls', () => {
  const html = render('center', ctxFor(alice));
  assert.deepEqual(duplicateIds(html), []);
  assert.deepEqual(unlabelledControls(html), []);
  assert.doesNotMatch(html, /<button(?![^>]*type="(?:button|submit)")/);
});

test('settings view has unique ids and labelled controls', () => {
  const html = render('settings', ctxFor(alice));
  assert.deepEqual(duplicateIds(html), []);
  assert.deepEqual(unlabelledControls(html), []);
  assert.match(html, /name="voice.enabled" checked/);
  assert.match(html, /name="transfers.targets" value="calendar" checked/);
});
