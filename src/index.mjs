// AustriQ CRM module: Ideen-Inbox. Host-provided synthetic state only; no network calls.
export const manifest = Object.freeze({"id":"ideas","label":"Ideen-Inbox","version":"0.1.0","apiVersion":1,"slots":["center","left-top","left-middle","left-bottom","right-top","right-bottom","footer-left","footer-right"],"capabilities":["render:center","render:slots"],"dataAccess":"host-provided-only"});

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeRows = (items, fn) => (Array.isArray(items) ? items : []).map(fn).join('');
const getItems = (ctx, name) => Array.isArray(ctx?.[name]) ? ctx[name] : (Array.isArray(ctx?.state?.[name]) ? ctx.state[name] : []);
const button = (dialog, label) => '<button type="button" class="text-button" data-open-dialog="' + escapeHtml(dialog) + '">' + escapeHtml(label) + '</button>';
const row = (title, subtitle, right = '') => '<div class="item-row"><span class="item-copy"><strong>' + escapeHtml(title) + '</strong><small>' + escapeHtml(subtitle) + '</small></span>' + right + '</div>';
const board = (title, description, action, body) => '<div class="module-workbench"><div class="wb-hero"><div><span class="eyebrow">MODULSPIELWIESE</span><h2>' + escapeHtml(title) + '</h2><p>' + escapeHtml(description) + '</p></div>' + (action || '') + '</div>' + body + '</div>';
const desc = (title, text) => '<div class="widget-copy"><strong>' + escapeHtml(title) + '</strong><small>' + escapeHtml(text) + '</small></div>';
function renderCompact(slot, ctx) {
  const v = compact(ctx);
  const entries = Array.isArray(v.entries) ? v.entries : [];
  const primary = escapeHtml(v.primary);
  const secondary = escapeHtml(v.secondary);
  const name = escapeHtml(v.title);
  const list = safeRows(entries.slice(0, 3), e => row(e.title,e.subtitle));
  const act = v.action || '';
  const opening = '<div class="widget-card widget-' + escapeHtml(slot) + '" data-module-id="' + escapeHtml(manifest.id) + '">';
  const heading = '<div class="widget-title"><span class="eyebrow">' + name + '</span><button type="button" class="widget-open" data-module="' + escapeHtml(manifest.id) + '" aria-label="' + name + ' in der Mitte oeffnen">↗</button></div>';
  if(slot === 'left-top') return opening + heading + '<div class="widget-kpi">' + primary + '</div><p class="widget-sub">' + secondary + '</p><div class="widget-list">' + list + '</div>' + act + '</div>';
  if(slot === 'left-middle') return opening + heading + '<div class="widget-list widget-people">' + list + '</div><p class="widget-sub">' + secondary + '</p>' + act + '</div>';
  if(slot === 'left-bottom') return opening + heading + '<p class="widget-sub">' + secondary + '</p><div class="widget-kpi small-kpi">' + primary + '</div>' + act + '</div>';
  if(slot === 'right-top') return opening + heading + '<div class="widget-list">' + list + '</div>' + desc(v.primary, v.secondary) + act + '</div>';
  if(slot === 'right-bottom') return opening + heading + '<p class="widget-sub">' + secondary + '</p>' + desc(primary, v.footer) + act + '</div>';
  if(slot === 'footer-left') return opening + heading + '<div class="widget-footer-summary"><strong>' + primary + '</strong><span>' + secondary + '</span></div></div>';
  if(slot === 'footer-right') return opening + heading + (v.quick || '<div class="widget-footer-summary"><strong>' + primary + '</strong><span>' + secondary + '</span></div>') + '</div>';
  return opening + heading + '</div>';
}
export function render(slot, ctx = {}) {
  if (!manifest.slots.includes(slot)) throw new RangeError('Unsupported CRM module slot');
  if (!ctx || typeof ctx !== 'object') throw new TypeError('CRM module context required');
  return slot === 'center' ? renderWorkbench(ctx) : renderCompact(slot,ctx);
}


function compact(ctx) {
  const items=getItems(ctx,'ideas'),withProject=items.filter(i=>i.projectId).length;
  return {title:'Ideen-Inbox',primary:String(items.length)+' Ideen',secondary:String(withProject)+' einem Projekt zugeordnet',footer:'Ideen sortieren und weiterentwickeln',entries:items.slice(0,3).map(x=>({title:x.text,subtitle:x.projectId?'Projektidee':'Freie Idee'})),action:button('idea-dialog','+ Idee'),quick:'<button type="button" class="secondary-button" data-open-dialog="idea-dialog">Neue Idee notieren</button>'};
}
function renderWorkbench(ctx){
  const items=getItems(ctx,'ideas');
  const cards=safeRows(items,(i)=>'<article class="idea-work-card"><span class="eyebrow">'+escapeHtml((ctx?.state?.projects||[]).find(p=>p.id===i.projectId)?.name||'Freie Idee')+'</span><p>'+escapeHtml(i.text)+'</p><small>'+escapeHtml(i.createdAt?String(i.createdAt).slice(0,10):'Idee')+'</small></article>');
  return board('Ideenwerkstatt','Sammeln, kombinieren und neue Ansätze entwickeln. Ideen bleiben hier in deiner lokalen Demo gespeichert.',button('idea-dialog','+ Neue Idee'),'<div class="idea-work-grid">'+(cards||'<p>Noch keine Ideen.</p>')+'</div><div class="idea-play"><strong>Impuls fuers Weiterdenken</strong><p>Welche zwei Ideen koenntest du verbinden? Ordne sie einem Projekt zu und entwickle daraus den naechsten Schritt.</p></div>');
}
