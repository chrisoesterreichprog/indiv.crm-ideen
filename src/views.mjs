// Rendering for the Ideen module: three mandatory views (initialization, settings, workbench)
// and adaptive compact views for Fluid Docking v2 rails. Output is static, escaped HTML; the
// CRM host owns event wiring, DnD transport, layout persistence, resize and size limits.
// No fixed slot numbers and no global resize logic live here — only the given dimensions count.
import { deepFreeze, domId, escapeHtml as e } from './html.mjs';
import { cleanText, ideaRef, isMediaRef, laneOf, revisionOf, stateFromContext, tenantScope, TEXT_MAX, TRANSCRIPT_MAX, visibleIdeas, visibleProjects } from './ideas.mjs';
import { normalizeSettings, TRANSFER_TARGET_IDS, VOICE_DURATION_LIMITS } from './settings.mjs';
import { voiceStatus, VOICE_MESSAGES } from './voice.mjs';
import { enabledTransferTargets, TRANSFER_TARGETS, WORKFLOW_CAPABILITY } from './transfer.mjs';
import { DRAG_HELP, INBOX_TARGET_ID, projectTargetId } from './dnd.mjs';

export const RAILS = Object.freeze(['top', 'bottom', 'left', 'right']);
export const SIZE_CLASSES = Object.freeze(['xs', 's', 'm', 'l']);
/** A container is in the first class whose width OR height is below the threshold. */
export const SIZE_THRESHOLDS = deepFreeze({ xs: { width: 160, height: 72 }, s: { width: 260, height: 140 }, m: { width: 420, height: 280 } });
const RAIL_DEFAULTS = deepFreeze({ top: { width: 360, height: 120 }, bottom: { width: 288, height: 160 }, left: { width: 280, height: 260 }, right: { width: 320, height: 260 } });
const MAX_DIMENSION = 10000;
const ENTRY_LIMITS = Object.freeze({ xs: 0, s: 0, m: 2, l: 5 });
/** Compact rails show a shortened title; the full text stays in the Workbench. */
export const COMPACT_TITLE_MAX = 80;

/** v1 default preset: legacy slot → rail + nominal size. Only a compatibility adapter. */
export const LEGACY_SLOT_PRESETS = deepFreeze({
  'left-top': { rail: 'left', width: 280, height: 300 },
  'left-middle': { rail: 'left', width: 280, height: 220 },
  'left-bottom': { rail: 'left', width: 280, height: 130 },
  'right-top': { rail: 'right', width: 440, height: 320 },
  'right-bottom': { rail: 'right', width: 320, height: 200 },
  'footer-left': { rail: 'bottom', width: 288, height: 120 },
  'footer-right': { rail: 'bottom', width: 288, height: 160 },
});

const positive = value => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(value, MAX_DIMENSION) : null);

/** Invalid, missing or hostile dimensions fall back to the rail default instead of throwing. */
export function normalizeDimensions(rail, dimensions) {
  const fallback = RAIL_DEFAULTS[rail] ?? RAIL_DEFAULTS.right;
  const d = dimensions !== null && typeof dimensions === 'object' ? dimensions : {};
  return Object.freeze({ width: positive(d.width) ?? fallback.width, height: positive(d.height) ?? fallback.height });
}

/** Monotonic size class: growing a container never yields a smaller class. */
export function sizeClassFor(rail, dimensions) {
  const { width, height } = normalizeDimensions(rail, dimensions);
  for (const size of ['xs', 's', 'm']) {
    if (width < SIZE_THRESHOLDS[size].width || height < SIZE_THRESHOLDS[size].height) return size;
  }
  return 'l';
}

const STATUS_LABELS = Object.freeze({ done: 'erledigt', todo: 'offen', optional: 'optional', blocked: 'blockiert' });
const TRANSCRIPT_LABELS = Object.freeze({
  pending: 'Transkript wird erstellt …',
  disabled: 'Kein Transkript (Transkription deaktiviert).',
  capability_missing: 'Kein Transkript (nicht freigegeben).',
  consent_missing: 'Kein Transkript (keine Einwilligung).',
  bridge_missing: 'Kein Transkript (keine whispr-Bridge).',
  shield_missing: 'Kein Transkript (Shield nicht bestätigt).',
  interrupted: VOICE_MESSAGES.interrupted,
  error: VOICE_MESSAGES.error,
});

function buildModel(ctx) {
  const scope = tenantScope(ctx);
  const raw = stateFromContext(ctx);
  const projects = visibleProjects(raw.projects, scope);
  return {
    denied: scope.mode === 'deny',
    projects,
    projectIds: new Set(projects.map(p => p.id)),
    projectNames: new Map(projects.map(p => [p.id, cleanText(String(p.name ?? '')) || 'Projekt'])),
    ideas: visibleIdeas(raw.ideas, raw.projects, scope),
    settings: normalizeSettings(ctx.settings),
    voice: voiceStatus(ctx),
    transfers: enabledTransferTargets(ctx),
    canPropose: Array.isArray(ctx.capabilities) && ctx.capabilities.includes(WORKFLOW_CAPABILITY),
    prefix: 'ideas-' + domId(ctx.instanceId),
  };
}

const ideaTitle = idea => cleanText(String(idea.text ?? '')) || (idea.audio ? 'Sprachidee' : 'Idee');
/** Shortens by code points (never splits surrogate pairs) and collapses line breaks for one-line rows. */
function shortTitle(idea) {
  const chars = Array.from(ideaTitle(idea).replace(/\s+/g, ' '));
  return chars.length > COMPACT_TITLE_MAX ? chars.slice(0, COMPACT_TITLE_MAX - 1).join('').trimEnd() + '…' : chars.join('');
}
const projectLabel = (model, idea) => (idea.projectId ? model.projectNames.get(idea.projectId) ?? 'Projekt nicht verfügbar' : 'Freie Idee');
const dateLabel = idea => (idea.createdAt ? String(idea.createdAt).slice(0, 10) : 'Idee');
const defaultProject = model => (model.projectNames.has(model.settings.defaultProjectId) ? model.settings.defaultProjectId : null);
const addButton = label => '<button type="button" class="text-button" data-open-dialog="idea-dialog">' + e(label) + '</button>';
const openButton = '<button type="button" class="widget-open" data-module="ideas" aria-label="Ideen-Inbox in der Mitte oeffnen">↗</button>';
const helpText = id => '<p id="' + e(id) + '" class="sr-only">' + e(DRAG_HELP) + '</p>';
const liveRegion = '<div class="sr-only" role="status" aria-live="polite" data-ideas-live></div>';

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return '';
  const total = Math.round(ms / 1000);
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}

function projectOptions(model, selected) {
  return '<option value=""' + (selected ? '' : ' selected') + '>Inbox (ohne Projekt)</option>'
    + model.projects.map(p => '<option value="' + e(p.id) + '"' + (p.id === selected ? ' selected' : '') + '>' + e(model.projectNames.get(p.id)) + '</option>').join('');
}

function quickCapture(model, { idBase, legacy = false, compact = false }) {
  const ids = legacy
    ? { form: 'quick-idea', text: 'quick-idea-text', project: 'quick-idea-project' }
    : { form: idBase + '-quick', text: idBase + '-quick-text', project: idBase + '-quick-project' };
  return '<form id="' + e(ids.form) + '" class="quick-idea' + (compact ? ' compact-idea' : '') + '" data-ideas-form="quick-capture" data-module-id="ideas">'
    + '<label for="' + e(ids.text) + '" class="sr-only">Idee notieren</label>'
    + '<input id="' + e(ids.text) + '" name="text" maxlength="' + TEXT_MAX + '" placeholder="Neue Idee ..." autocomplete="off" required>'
    + '<label for="' + e(ids.project) + '" class="sr-only">Projektzuordnung</label>'
    + '<select name="projectId" id="' + e(ids.project) + '">' + projectOptions(model, defaultProject(model)) + '</select>'
    + '<button type="submit" class="primary-button">Speichern</button></form>';
}

function voiceControl(model, idBase) {
  const v = model.voice;
  if (v.state === 'recording') return '<button type="button" class="text-button ideas-recording" data-action="voice.stop">● Aufnahme läuft – stoppen</button>';
  if (v.state === 'ready') return '<button type="button" class="text-button" data-action="voice.start">Sprachidee aufnehmen</button>';
  if (v.state === 'consent_required') return '<button type="button" class="text-button" data-action="voice.requestConsent">Einwilligung für Audioaufnahme geben</button>';
  const id = idBase + '-voice-reason';
  return '<button type="button" class="text-button" aria-disabled="true" aria-describedby="' + e(id) + '">Sprachidee</button>'
    + '<small id="' + e(id) + '" class="ideas-voice-reason">' + e(v.message) + '</small>';
}

function compactEntry(model, idea, helpId) {
  const ref = ideaRef(idea.id);
  const badges = (idea.audio ? '<span class="idea-badge">Audio</span>' : '')
    + (idea.transcript?.status === 'ready' ? '<span class="idea-badge">Transkript</span>' : '');
  return '<li class="item-row idea-entry" data-ref="' + e(ref) + '" data-drag-ref="' + e(ref) + '" draggable="true" tabindex="0" aria-describedby="' + e(helpId) + '">'
    + '<span class="item-copy"><strong>' + e(shortTitle(idea)) + '</strong><small>' + e(projectLabel(model, idea)) + '</small></span>' + badges + '</li>';
}

function renderCompact(model, rail, dimensions, legacySlot) {
  const size = sizeClassFor(rail, dimensions);
  const orientation = rail === 'top' || rail === 'bottom' ? 'horizontal' : 'vertical';
  const idBase = model.prefix + '-' + (legacySlot ?? rail);
  const classes = 'widget-card ideas-compact widget-rail-' + rail + ' widget-size-' + size + (legacySlot ? ' widget-' + legacySlot : '');
  const open = '<div class="' + e(classes) + '" data-module-id="ideas" data-rail="' + e(rail) + '" data-size="' + size + '" data-orientation="' + orientation + '"'
    + (legacySlot ? ' data-slot="' + e(legacySlot) + '"' : '') + '>';
  const heading = '<div class="widget-title"><span class="eyebrow">Ideen-Inbox</span>' + openButton + '</div>';
  if (model.denied) return open + heading + '<p class="widget-sub" role="status">Kein Zugriff auf Ideen.</p></div>';

  const count = model.ideas.length;
  const withProject = model.ideas.filter(i => i.projectId).length;
  const kpi = count + (count === 1 ? ' Idee' : ' Ideen');
  const sub = withProject + ' einem Projekt zugeordnet';
  if (size === 'xs') {
    return open + '<button type="button" class="widget-open ideas-chip" data-module="ideas" aria-label="Ideen-Inbox öffnen: ' + e(kpi) + '">Ideen <strong>' + count + '</strong></button></div>';
  }
  const legacyQuick = legacySlot === 'footer-right';
  const quick = size === 's' && !legacyQuick ? addButton('+ Idee') : quickCapture(model, { idBase, legacy: legacyQuick, compact: true });
  const helpId = idBase + '-dnd-help';
  const entries = model.ideas.slice(0, ENTRY_LIMITS[size]);
  const list = entries.length
    ? '<ul class="widget-list idea-list" aria-label="Neueste Ideen">' + entries.map(i => compactEntry(model, i, helpId)).join('') + '</ul>' + helpText(helpId)
    : (size === 's' ? '' : '<p class="widget-sub">Noch keine Ideen.</p>');
  const summary = '<div class="widget-footer-summary"><strong>' + e(kpi) + '</strong><span>' + e(sub) + '</span></div>';
  const voice = size === 'l' && model.voice.state !== 'disabled' ? '<div class="ideas-voice">' + voiceControl(model, idBase) + '</div>' : '';
  return open + heading + summary + quick + voice + list + '</div>';
}

function transcriptBlock(idea, idBase) {
  const t = idea.transcript;
  if (!t || typeof t !== 'object') return '<div class="idea-transcript" data-transcript-status="none"><span class="eyebrow">Transkript</span><small>Kein Transkript vorhanden.</small></div>';
  if (t.status === 'ready') {
    return '<div class="idea-transcript" data-transcript-status="ready"><span class="eyebrow">Transkript ' + (t.source === 'whispr-bridge' ? '(whispr)' : '(manuell)') + '</span>'
      + '<blockquote>' + e(cleanText(String(t.text ?? ''))) + '</blockquote></div>';
  }
  const key = t.status === 'pending' ? 'pending' : t.reason;
  const label = typeof key === 'string' && Object.hasOwn(TRANSCRIPT_LABELS, key) ? TRANSCRIPT_LABELS[key] : VOICE_MESSAGES.error;
  const retry = (t.status === 'failed' || t.status === 'unavailable') && isMediaRef(idea.audio?.ref)
    ? '<button type="button" class="text-button" data-action="voice.retranscribe" data-ref="' + e(ideaRef(idea.id)) + '" data-media-ref="' + e(idea.audio.ref) + '" aria-describedby="' + e(idBase + '-transcript-status') + '">Transkript erneut anfordern</button>'
    : '';
  return '<div class="idea-transcript" data-transcript-status="' + e(t.status) + '"><span class="eyebrow">Transkript</span><small id="' + e(idBase + '-transcript-status') + '">' + e(label) + '</small>' + retry + '</div>';
}

function ideaCard(model, idea, prefix, position = { first: false, last: false }) {
  const ref = ideaRef(idea.id);
  const base = prefix + '-idea-' + idea.id;
  const revision = revisionOf(idea);
  const hidden = '<input type="hidden" name="ref" value="' + e(ref) + '"><input type="hidden" name="expectedRevision" value="' + revision + '">';
  const hasAudio = Boolean(idea.audio) && isMediaRef(idea.audio.ref);
  const audio = hasAudio
    ? '<div class="idea-audio" data-media-ref="' + e(idea.audio.ref) + '"><span class="eyebrow">Originalaudio</span> <span>' + e(formatDuration(idea.audio.durationMs)) + '</span> '
      + '<button type="button" class="text-button" data-action="voice.play" data-media-ref="' + e(idea.audio.ref) + '" aria-label="Originalaudio abspielen">Abspielen</button></div>'
    : '';
  const transcript = hasAudio ? transcriptBlock(idea, base) : '';
  const transcriptForm = hasAudio
    ? '<form data-ideas-form="transcript">' + hidden + '<label for="' + e(base + '-transcript') + '">Transkript (Originalaudio bleibt unverändert)</label>'
      + '<textarea id="' + e(base + '-transcript') + '" name="transcript" maxlength="' + TRANSCRIPT_MAX + '" rows="4">' + e(idea.transcript?.status === 'ready' ? cleanText(String(idea.transcript.text ?? '')) : '') + '</textarea>'
      + '<button type="submit" class="text-button">Transkript speichern</button></form>'
    : '';
  // Mutating controls carry the rendered revision: a stale view yields `conflict`, never a lost update.
  const guarded = ' data-ref="' + e(ref) + '" data-expected-revision="' + revision + '"';
  const button = (action, label, extra) => '<button type="button" class="text-button" data-action="' + action + '"' + extra + '>' + label + '</button>';
  return '<li class="idea-work-card" data-ref="' + e(ref) + '" data-drag-ref="' + e(ref) + '" draggable="true" tabindex="0" aria-labelledby="' + e(base + '-title') + '" aria-describedby="' + e(prefix + '-dnd-help') + '">'
    + '<span class="eyebrow">' + e(projectLabel(model, idea)) + '</span>'
    + '<p id="' + e(base + '-title') + '" class="idea-text">' + e(ideaTitle(idea)) + '</p>'
    + audio + transcript
    + '<small>' + e(dateLabel(idea)) + '</small>'
    + '<div class="idea-card-controls">'
    + '<label for="' + e(base + '-project') + '">Projekt</label><select id="' + e(base + '-project') + '" data-action="idea.assignProject"' + guarded + '>' + projectOptions(model, laneOf(idea, model.projectIds)) + '</select>'
    // ↑/↓ move within the column; at its edges they are disabled instead of silently doing nothing.
    + button('idea.move', '↑', guarded + ' data-direction="up" aria-label="Idee innerhalb der Spalte nach oben verschieben"' + (position.first ? ' disabled' : ''))
    + button('idea.move', '↓', guarded + ' data-direction="down" aria-label="Idee innerhalb der Spalte nach unten verschieben"' + (position.last ? ' disabled' : ''))
    + button('idea.pickUp', 'Verschieben …', ' data-ref="' + e(ref) + '" aria-describedby="' + e(prefix + '-dnd-help') + '"')
    + button('idea.delete', 'Löschen', guarded + ' data-confirm="Idee löschen? Originalaudio und Transkript werden ebenfalls entfernt."')
    + '</div>'
    + '<details class="idea-edit"><summary>Bearbeiten</summary>'
    + '<form data-ideas-form="edit">' + hidden + '<label for="' + e(base + '-text') + '">Notiz</label>'
    + '<textarea id="' + e(base + '-text') + '" name="text" maxlength="' + TEXT_MAX + '" rows="3">' + e(cleanText(String(idea.text ?? ''))) + '</textarea>'
    + '<button type="submit" class="primary-button">Speichern</button></form>'
    + transcriptForm + '</details></li>';
}

function lane(model, group, ideas, prefix) {
  // Inbox and project lanes live in separate namespaces, so a project whose id is "inbox"
  // can neither shadow the Inbox drop target nor duplicate its heading id.
  const headingId = prefix + '-lane-' + (group.id ? 'p-' + group.id : 'inbox');
  return '<section class="idea-lane" data-drop-target="' + e(group.id ? projectTargetId(group.id) : INBOX_TARGET_ID) + '" aria-labelledby="' + e(headingId) + '">'
    + '<h3 id="' + e(headingId) + '">' + e(group.label) + ' <small>(' + ideas.length + ')</small></h3>'
    + (ideas.length ? '<ol class="idea-work-grid idea-list">' + ideas.map((i, index) => ideaCard(model, i, prefix, { first: index === 0, last: index === ideas.length - 1 })).join('') + '</ol>' : '<p class="idea-empty">Keine Ideen in dieser Spalte.</p>')
    + '</section>';
}

function transferZone(model, prefix) {
  const headingId = prefix + '-transfer';
  const head = '<section class="idea-transfer-targets" aria-labelledby="' + e(headingId) + '"><h3 id="' + e(headingId) + '">Übergeben an</h3>';
  if (!model.transfers.length) {
    const why = model.canPropose ? 'Alle Übergabeziele sind in den Einstellungen deaktiviert.' : 'Übergaben sind vom CRM-Host (Workflow-Freigabe) noch nicht freigegeben.';
    return head + '<p class="widget-sub">' + e(why) + '</p></section>';
  }
  return head + '<p class="widget-sub">Idee hierher ziehen oder per Tastatur „Verschieben …“ wählen. Es entsteht nur ein Vorschlag; ausgeführt wird erst nach Bestätigung.</p>'
    + '<ul class="idea-drop-zones">' + model.transfers.map(t => '<li class="idea-drop-zone" data-drop-target="transfer:' + e(t.id) + '"><strong>' + e(t.label) + '</strong><small>' + e(t.hint) + '</small></li>').join('') + '</ul></section>';
}

function renderWorkbench(model) {
  const prefix = model.prefix + '-wb';
  const open = '<div class="module-workbench ideas-workbench" data-module-id="ideas" data-view="workbench">';
  if (model.denied) return open + '<p role="status">Kein Zugriff auf Ideen. Bitte Anmeldung und Berechtigung im CRM prüfen.</p></div>';
  const hero = '<div class="wb-hero"><div><span class="eyebrow">MODULSPIELWIESE</span><h2>Ideenwerkstatt</h2>'
    + '<p>Sammeln, Projekten zuordnen und als Vorschlag an Learn, Experience, Studio oder Kalender übergeben.</p></div>'
    + '<div class="wb-actions">' + addButton('+ Neue Idee') + (model.voice.state === 'disabled' ? '' : voiceControl(model, prefix)) + '</div></div>';
  const groups = [{ id: null, label: 'Inbox – ohne Projekt' }, ...model.projects.map(p => ({ id: p.id, label: model.projectNames.get(p.id) }))];
  const byLane = new Map(groups.map(g => [g.id, []]));
  for (const idea of model.ideas) byLane.get(laneOf(idea, model.projectIds)).push(idea);
  const lanes = model.ideas.length
    ? groups.map(g => lane(model, g, byLane.get(g.id), prefix)).join('')
    : '<p>Noch keine Ideen.</p>';
  return open + hero + quickCapture(model, { idBase: prefix }) + helpText(prefix + '-dnd-help') + liveRegion
    + '<div class="idea-lanes">' + lanes + '</div>' + transferZone(model, prefix)
    + '<div class="idea-play"><strong>Impuls fuers Weiterdenken</strong><p>Welche zwei Ideen koenntest du verbinden? Ordne sie einem Projekt zu und entwickle daraus den naechsten Schritt.</p></div></div>';
}

function renderSettings(model) {
  const p = model.prefix + '-settings';
  const s = model.settings;
  const check = (name, checked, label, value) => '<label class="check-row"><input type="checkbox" name="' + e(name) + '"' + (value ? ' value="' + e(value) + '"' : '') + (checked ? ' checked' : '') + '> ' + e(label) + '</label>';
  return '<form class="module-settings ideas-settings" data-module-id="ideas" data-view="settings" data-ideas-form="settings" aria-labelledby="' + e(p + '-title') + '">'
    + '<h2 id="' + e(p + '-title') + '">Ideen · Einstellungen</h2>'
    + (model.denied ? '<p role="status">Kein Zugriff: Einstellungen können nicht geändert werden.</p></form>'
      : '<fieldset><legend>Projektzuordnung</legend><label for="' + e(p + '-default-project') + '">Standardprojekt für neue Ideen</label>'
      + '<select id="' + e(p + '-default-project') + '" name="defaultProjectId">' + projectOptions(model, defaultProject(model)) + '</select></fieldset>'
      + '<fieldset><legend>Sprachideen (whispr-Bridge)</legend><p class="widget-sub" data-voice-state="' + e(model.voice.state) + '">' + e(model.voice.message) + '</p>'
      + check('voice.enabled', s.voice.enabled, 'Sprachideen aktivieren (Aufnahme nur nach Klick und Einwilligung)')
      + check('voice.transcribe', s.voice.transcribe, 'Transkript über die freigegebene whispr-Bridge erstellen')
      + '<label for="' + e(p + '-max-duration') + '">Maximale Aufnahmedauer (Sekunden)</label>'
      + '<input id="' + e(p + '-max-duration') + '" type="number" name="voice.maxDurationSec" min="' + VOICE_DURATION_LIMITS.min + '" max="' + VOICE_DURATION_LIMITS.max + '" step="10" value="' + s.voice.maxDurationSec + '">'
      + '<p class="widget-sub">Originalaudio und Transkript werden getrennt gespeichert. Ohne Bridge, Mikrofon oder Einwilligung bleiben Text-Ideen voll nutzbar.</p></fieldset>'
      + '<fieldset><legend>Übergabeziele (nur als bestätigte Vorschläge)</legend>'
      + TRANSFER_TARGET_IDS.map(id => check('transfers.targets', s.transfers.targets.includes(id), TRANSFER_TARGETS[id].label, id)).join('')
      + (model.canPropose ? '' : '<p class="widget-sub">Hinweis: Der CRM-Host hat Workflow-Vorschläge noch nicht freigegeben.</p>')
      + '</fieldset><div class="form-actions"><button type="submit" class="primary-button">Einstellungen speichern</button></div></form>');
}

function transcriptionDetail(voice) {
  if (voice.transcription.allowed) return 'Über die freigegebene whispr-Bridge.';
  if (voice.transcription.reason) return TRANSCRIPT_LABELS[voice.transcription.reason] ?? VOICE_MESSAGES.error;
  return 'Erst nach freigegebener Sprachaufnahme verfügbar.';
}

function setupSteps(model) {
  const v = model.voice;
  const voiceStep = { ready: 'done', recording: 'done', disabled: 'optional', consent_required: 'todo', unavailable: 'blocked' }[v.state];
  let transcriptionStep = 'optional';
  if (v.transcription.allowed) transcriptionStep = 'done';
  else if (model.settings.voice.transcribe) transcriptionStep = 'blocked';
  let transferStep = 'done';
  let transferDetail = model.transfers.map(t => t.label).join(', ');
  if (!model.canPropose) { transferStep = 'blocked'; transferDetail = 'Workflow-Freigabe des CRM-Hosts fehlt (indiv.crm-workflows#1).'; }
  else if (!model.transfers.length) { transferStep = 'optional'; transferDetail = 'Alle Übergabeziele deaktiviert.'; }
  return deepFreeze([
    { id: 'access', label: 'Zugriff', status: model.denied ? 'blocked' : 'done', detail: model.denied ? 'Keine gültige Anmeldung bzw. kein Mandant.' : 'Daten kommen ausschließlich vom CRM-Host.' },
    { id: 'projects', label: 'Projekte', status: model.projects.length ? 'done' : 'optional', detail: model.projects.length ? model.projects.length + ' Projekte verfügbar.' : 'Ohne Projekte landen Ideen in der Inbox.' },
    { id: 'voice', label: 'Sprachaufnahme', status: voiceStep, detail: v.message },
    { id: 'transcription', label: 'Transkription', status: transcriptionStep, detail: transcriptionDetail(v) },
    { id: 'transfers', label: 'Übergaben', status: transferStep, detail: transferDetail },
  ]);
}

function renderInitialization(model) {
  const p = model.prefix + '-setup';
  return '<section class="module-setup ideas-setup" data-module-id="ideas" data-view="initialization" aria-labelledby="' + e(p + '-title') + '">'
    + '<h2 id="' + e(p + '-title') + '">Ideen einrichten</h2>'
    + '<p>Ideen nutzen nur Daten des CRM-Hosts. Sprachaufnahmen sind optional und starten nie ohne Einwilligung; Übergaben an andere Module sind immer Vorschläge mit Bestätigung.</p>'
    + '<ol class="setup-steps">' + setupSteps(model).map(step => '<li data-step="' + e(step.id) + '" data-status="' + e(step.status) + '"><strong>' + e(step.label) + '</strong> '
      + '<span class="setup-status">' + e(STATUS_LABELS[step.status]) + '</span><small>' + e(step.detail) + '</small></li>').join('') + '</ol>'
    + '<div class="form-actions"><button type="button" class="primary-button" data-action="ideas.completeSetup"' + (model.denied ? ' aria-disabled="true"' : '') + '>Einrichtung abschließen</button>'
    + '<button type="button" class="text-button" data-action="ideas.openSettings">Einstellungen öffnen</button></div></section>';
}

/** Structured setup checklist (same data as the initialization view) for host-side gating. */
export function setupStatus(ctx = {}) {
  return setupSteps(buildModel(ctx !== null && typeof ctx === 'object' ? ctx : {}));
}

/** Dispatches a validated target to its view. `target` must already be checked by the caller. */
export function renderTarget(target, ctx, dimensions) {
  const model = buildModel(ctx);
  if (target === 'center' || target === 'workbench') return renderWorkbench(model);
  if (target === 'settings') return renderSettings(model);
  if (target === 'initialization') return renderInitialization(model);
  const preset = Object.hasOwn(LEGACY_SLOT_PRESETS, target) ? LEGACY_SLOT_PRESETS[target] : null;
  if (preset) return renderCompact(model, preset.rail, dimensions ?? preset, target);
  return renderCompact(model, target, dimensions);
}
