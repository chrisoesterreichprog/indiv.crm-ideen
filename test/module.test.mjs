import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifest, render } from '../src/index.mjs';
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
