// Ideen domain model (schema v2): opaque refs, validation, tenant/user scoping and a pure
// command reducer. The CRM host/server stays authoritative for persistence, authorization and
// audit; every check here is client-side defense in depth and fails closed.
import { deepFreeze } from './html.mjs';

export const SCHEMA_VERSION = 2;
export const TEXT_MAX = 1200;
export const TRANSCRIPT_MAX = 20000;
export const AUDIO_MAX_MS = 3_600_000;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MEDIA_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const AUDIO_MIME_RE = /^audio\/[a-z0-9][a-z0-9.+-]{0,39}$/;
const LANGUAGE_RE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
// C0/C1 controls (except \t \n \r), zero-width and bidi-override characters (spoofing vectors).
const UNSAFE_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠⁦-⁩﻿]/g;

export const REF_PREFIX = Object.freeze({ idea: 'austriq:idea:', project: 'austriq:project:', media: 'austriq:media:' });
export const TRANSCRIPT_STATUSES = Object.freeze(['ready', 'pending', 'unavailable', 'failed']);
export const TRANSCRIPT_REASONS = Object.freeze(['disabled', 'capability_missing', 'consent_missing', 'bridge_missing', 'shield_missing', 'interrupted', 'error']);
export const COMMAND_TYPES = Object.freeze(['idea.create', 'idea.update', 'idea.setTranscript', 'idea.assignProject', 'idea.move', 'idea.delete']);

const asList = value => (Array.isArray(value) ? value : []);
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const revisionOf = idea => (Number.isInteger(idea?.revision) && idea.revision > 0 ? idea.revision : 0);
const orderOf = idea => (Number.isFinite(idea?.order) ? idea.order : Number.MAX_SAFE_INTEGER);
const nullableProject = value => (value === '' || value === undefined || value === null ? null : value);

export const isId = value => typeof value === 'string' && ID_RE.test(value);
export const ideaRef = id => (isId(id) ? REF_PREFIX.idea + id : null);
export const projectRef = id => (isId(id) ? REF_PREFIX.project + id : null);

/** Returns the idea id for a well-formed opaque idea ref, otherwise null (bad refs fail closed). */
export function parseIdeaRef(ref) {
  if (typeof ref !== 'string' || ref.length > 96 || !ref.startsWith(REF_PREFIX.idea)) return null;
  const id = ref.slice(REF_PREFIX.idea.length);
  return isId(id) ? id : null;
}

export function isMediaRef(ref) {
  return typeof ref === 'string' && ref.length <= 160 && ref.startsWith(REF_PREFIX.media)
    && MEDIA_ID_RE.test(ref.slice(REF_PREFIX.media.length));
}

/** Normalizes user text: NFC, strips control/zero-width/bidi characters, unifies newlines, trims. */
export function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').replace(UNSAFE_CHARS_RE, '').replace(/\r\n?/g, '\n').trim();
}

/** null when the actor may act; otherwise a stable denial code. Missing status is NOT active. */
export function checkActor(actor) {
  if (!isRecord(actor) || !isId(actor.userId) || !isId(actor.tenantId)) return 'unauthenticated';
  if (actor.status === 'active') return null;
  return actor.status === 'revoked' || actor.status === 'suspended' ? 'revoked' : 'unauthenticated';
}

const isMember = (project, userId) => project.ownerId === userId || asList(project.memberIds).includes(userId);

/**
 * Resolves which records a render may show.
 * - actor present: only that active actor's tenant, own ideas and ideas of member projects
 * - tenantId only: only that tenant
 * - nothing: legacy host-scoped data (host already filtered, `dataAccess: host-provided-only`)
 * Invalid/revoked scope information denies everything.
 */
export function tenantScope(ctx) {
  if (!isRecord(ctx)) return Object.freeze({ mode: 'deny' });
  if (ctx.actor !== undefined && ctx.actor !== null) {
    return Object.freeze(checkActor(ctx.actor) ? { mode: 'deny' } : { mode: 'tenant', tenantId: ctx.actor.tenantId, userId: ctx.actor.userId });
  }
  if (ctx.tenantId !== undefined && ctx.tenantId !== null) {
    return Object.freeze(isId(ctx.tenantId) ? { mode: 'tenant', tenantId: ctx.tenantId } : { mode: 'deny' });
  }
  return Object.freeze({ mode: 'host-scoped' });
}

/** Host data may arrive flat (`ctx.ideas`) or nested (`ctx.state.ideas`), as in API v1. */
export function stateFromContext(ctx) {
  const c = isRecord(ctx) ? ctx : {};
  const s = isRecord(c.state) ? c.state : {};
  return {
    ideas: Array.isArray(c.ideas) ? c.ideas : asList(s.ideas),
    projects: Array.isArray(c.projects) ? c.projects : asList(s.projects),
  };
}

/** Stable sort by `order`; legacy records without order keep their host order at the end. */
export function sortIdeas(ideas) {
  return asList(ideas)
    .map((idea, index) => ({ idea, index }))
    .sort((a, b) => (orderOf(a.idea) - orderOf(b.idea)) || (a.index - b.index))
    .map(entry => entry.idea);
}

export function visibleProjects(projects, scope) {
  if (!scope || scope.mode === 'deny') return [];
  const valid = asList(projects).filter(p => isRecord(p) && isId(p.id));
  if (scope.mode === 'host-scoped') return valid;
  return valid.filter(p => p.tenantId === scope.tenantId && (!scope.userId || isMember(p, scope.userId)));
}

export function visibleIdeas(ideas, projects, scope) {
  if (!scope || scope.mode === 'deny') return [];
  const valid = asList(ideas).filter(i => isRecord(i) && isId(i.id));
  if (scope.mode === 'host-scoped') return sortIdeas(valid);
  const memberProjects = new Set(visibleProjects(projects, scope).map(p => p.id));
  return sortIdeas(valid.filter(i => i.tenantId === scope.tenantId
    && (!scope.userId || i.ownerId === scope.userId || (isId(i.projectId) && memberProjects.has(i.projectId)))));
}

/**
 * Workbench lane of an idea: its project if that project is visible to the viewer, otherwise the
 * Inbox (`null`). Shared by rendering and `idea.move`, so ↑/↓ always swaps an idea with a
 * neighbour in the column the person actually sees.
 */
export const laneOf = (idea, visibleProjectIds) => (isId(idea?.projectId) && visibleProjectIds.has(idea.projectId) ? idea.projectId : null);

function findProject(state, actor, projectId) {
  const project = asList(state?.projects).find(p => isRecord(p) && p.id === projectId && p.tenantId === actor.tenantId);
  if (!project) return { code: 'project_not_found' };
  if (!isMember(project, actor.userId)) return { code: 'project_forbidden' };
  return { project };
}

/**
 * Authorizes access to one idea. Cross-tenant ideas are reported as `not_found` so that the
 * existence of foreign records is never revealed. Write access: owner or project member;
 * `requireOwner` (delete) restricts to the owner.
 */
export function authorizeIdea(state, actor, ref, { requireOwner = false } = {}) {
  const actorError = checkActor(actor);
  if (actorError) return { code: actorError };
  const id = parseIdeaRef(ref);
  if (!id) return { code: 'bad_ref' };
  const ideas = asList(state?.ideas);
  const index = ideas.findIndex(i => isRecord(i) && i.id === id && i.tenantId === actor.tenantId);
  if (index < 0) return { code: 'not_found' };
  const idea = ideas[index];
  const owner = idea.ownerId === actor.userId;
  const member = !owner && !requireOwner && isId(idea.projectId) && !findProject(state, actor, idea.projectId).code;
  if (!owner && !member) return { code: 'forbidden' };
  return { idea, index };
}

export function normalizeAudio(audio) {
  if (audio === undefined || audio === null) return { value: null };
  if (!isRecord(audio) || !isMediaRef(audio.ref)) return { code: 'bad_media_ref' };
  const mimeType = audio.mimeType === undefined ? 'audio/webm' : String(audio.mimeType).toLowerCase();
  if (!AUDIO_MIME_RE.test(mimeType)) return { code: 'bad_audio' };
  const durationMs = Number.isFinite(audio.durationMs) && audio.durationMs >= 0 ? Math.min(Math.round(audio.durationMs), AUDIO_MAX_MS) : null;
  const source = audio.source === 'whispr-bridge' ? 'whispr-bridge' : 'local';
  return { value: Object.freeze({ ref: audio.ref, mimeType, durationMs, source }) };
}

export function normalizeTranscript(transcript) {
  if (transcript === undefined || transcript === null) return { value: null };
  if (!isRecord(transcript) || !TRANSCRIPT_STATUSES.includes(transcript.status)) return { code: 'bad_transcript' };
  const text = transcript.status === 'ready' ? cleanText(transcript.text) : '';
  if (text.length > TRANSCRIPT_MAX) return { code: 'transcript_too_long' };
  if (transcript.status === 'ready' && !text) return { code: 'bad_transcript' };
  const value = {
    status: transcript.status,
    text,
    source: transcript.source === 'whispr-bridge' ? 'whispr-bridge' : 'manual',
    language: typeof transcript.language === 'string' && LANGUAGE_RE.test(transcript.language) ? transcript.language : null,
  };
  if (transcript.status !== 'ready') value.reason = TRANSCRIPT_REASONS.includes(transcript.reason) ? transcript.reason : null;
  return { value: Object.freeze(value) };
}

const fail = code => Object.freeze({ ok: false, code });
const done = (state, ideas, event) => Object.freeze({ ok: true, state: { ...state, ideas }, event: deepFreeze({ ...event }) });
const staleRevision = (idea, command) => command.expectedRevision !== undefined && command.expectedRevision !== revisionOf(idea);

function replaceIdea(context, found, patch, type, changed, extra = {}) {
  const revision = revisionOf(found.idea) + 1;
  const next = Object.freeze({ ...found.idea, ...patch, revision, updatedAt: context.at });
  const ideas = context.ideas.slice();
  ideas[found.index] = next;
  return done(context.state, ideas, { type, ref: ideaRef(next.id), revision, at: context.at, changed, ...extra });
}

function checkProjectTarget(context, value) {
  const projectId = nullableProject(value);
  if (projectId === null) return { projectId };
  if (!isId(projectId)) return { code: 'bad_project' };
  const project = findProject(context.state, context.actor, projectId);
  return project.code ? { code: project.code } : { projectId };
}

const HANDLERS = {
  'idea.create'(context) {
    const { command, actor, ideas, at } = context;
    if (!isId(command.id)) return fail('bad_id');
    if (ideas.some(i => isRecord(i) && i.id === command.id && i.tenantId === actor.tenantId)) return fail('conflict');
    const text = cleanText(command.text);
    if (text.length > TEXT_MAX) return fail('text_too_long');
    const audio = normalizeAudio(command.audio);
    if (audio.code) return fail(audio.code);
    const transcript = normalizeTranscript(command.transcript);
    if (transcript.code) return fail(transcript.code);
    if (transcript.value && !audio.value) return fail('transcript_requires_audio');
    if (!audio.value && !text) return fail('text_required');
    const target = checkProjectTarget(context, command.projectId);
    if (target.code) return fail(target.code);
    const order = ideas.reduce((min, i) => (isRecord(i) && i.tenantId === actor.tenantId && Number.isFinite(i.order) ? Math.min(min, i.order - 1) : min), 0);
    const idea = Object.freeze({
      id: command.id, schemaVersion: SCHEMA_VERSION, tenantId: actor.tenantId, ownerId: actor.userId,
      projectId: target.projectId, kind: audio.value ? 'voice' : 'text', text,
      audio: audio.value, transcript: transcript.value, order, revision: 1, createdAt: at, updatedAt: at,
    });
    const changed = ['text', 'projectId', ...(audio.value ? ['audio'] : []), ...(transcript.value ? ['transcript'] : [])];
    return done(context.state, [...ideas, idea], { type: 'idea.created', ref: ideaRef(idea.id), revision: 1, at, changed, projectRef: projectRef(idea.projectId) });
  },

  'idea.update'(context) {
    const found = authorizeIdea(context.state, context.actor, context.command.ref);
    if (found.code) return fail(found.code);
    if (staleRevision(found.idea, context.command)) return fail('conflict');
    const text = cleanText(context.command.text);
    if (text.length > TEXT_MAX) return fail('text_too_long');
    if (!text && !found.idea.audio) return fail('text_required');
    if (text === found.idea.text) return fail('no_change');
    return replaceIdea(context, found, { text }, 'idea.updated', ['text']);
  },

  'idea.setTranscript'(context) {
    const found = authorizeIdea(context.state, context.actor, context.command.ref);
    if (found.code) return fail(found.code);
    if (staleRevision(found.idea, context.command)) return fail('conflict');
    if (!found.idea.audio) return fail('transcript_requires_audio');
    const transcript = normalizeTranscript(context.command.transcript);
    if (transcript.code) return fail(transcript.code);
    if (!transcript.value) return fail('bad_transcript');
    // Original audio stays untouched: transcript and audio are separate artifacts.
    return replaceIdea(context, found, { transcript: transcript.value }, 'idea.transcriptUpdated', ['transcript']);
  },

  'idea.assignProject'(context) {
    const found = authorizeIdea(context.state, context.actor, context.command.ref);
    if (found.code) return fail(found.code);
    if (staleRevision(found.idea, context.command)) return fail('conflict');
    const target = checkProjectTarget(context, context.command.projectId);
    if (target.code) return fail(target.code);
    if (nullableProject(found.idea.projectId) === target.projectId) return fail('no_change');
    return replaceIdea(context, found, { projectId: target.projectId }, 'idea.projectAssigned', ['projectId'], { projectRef: projectRef(target.projectId) });
  },

  'idea.move'(context) {
    const { state, ideas, command, actor, at } = context;
    const found = authorizeIdea(state, actor, command.ref);
    if (found.code) return fail(found.code);
    if (staleRevision(found.idea, command)) return fail('conflict');
    const byDirection = command.direction === 'up' || command.direction === 'down';
    if (!byDirection && !Number.isInteger(command.toIndex)) return fail('bad_position');
    const scope = { mode: 'tenant', tenantId: actor.tenantId, userId: actor.userId };
    const list = visibleIdeas(ideas, state.projects, scope);
    const from = list.findIndex(i => i.id === found.idea.id);
    if (from < 0) return fail('no_change');
    let to = from;
    if (byDirection) {
      // ↑/↓ follow the Workbench columns: swap with the nearest idea of the same lane, never
      // with an idea of another project that happens to sit next to it in the overall order.
      const projectIds = new Set(visibleProjects(state.projects, scope).map(p => p.id));
      const lane = laneOf(found.idea, projectIds);
      const step = command.direction === 'up' ? -1 : 1;
      for (let i = from + step; i >= 0 && i < list.length; i += step) {
        if (laneOf(list[i], projectIds) === lane) { to = i; break; }
      }
    } else {
      // `toIndex` is an absolute position in the person's overall list (compact views).
      to = Math.max(0, Math.min(list.length - 1, command.toIndex));
    }
    if (to === from) return fail('no_change');
    const reordered = list.slice();
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    const positions = new Map(reordered.map((idea, position) => [idea.id, position]));
    const revision = revisionOf(moved) + 1;
    const next = ideas.map(i => {
      if (!isRecord(i) || i.tenantId !== actor.tenantId || !positions.has(i.id)) return i;
      const order = positions.get(i.id);
      if (i.id === moved.id) return Object.freeze({ ...i, order, revision, updatedAt: at });
      return i.order === order ? i : Object.freeze({ ...i, order });
    });
    return done(state, next, { type: 'idea.moved', ref: ideaRef(moved.id), revision, at, changed: ['order'], position: to });
  },

  'idea.delete'(context) {
    const found = authorizeIdea(context.state, context.actor, context.command.ref, { requireOwner: true });
    if (found.code) return fail(found.code);
    if (staleRevision(found.idea, context.command)) return fail('conflict');
    const ideas = context.ideas.filter((_, index) => index !== found.index);
    // The host deletes referenced media server-side; only opaque refs are reported.
    const mediaRefs = isMediaRef(found.idea.audio?.ref) ? [found.idea.audio.ref] : [];
    return done(context.state, ideas, { type: 'idea.deleted', ref: ideaRef(found.idea.id), at: context.at, changed: ['deleted'], mediaRefs });
  },
};

/**
 * Pure reducer for idea commands. Returns `{ ok: true, state, event }` or `{ ok: false, code }`.
 * Never throws for bad input, never echoes user text in events or error codes.
 */
export function applyIdeaCommand(state, command, actor, options = {}) {
  const actorError = checkActor(actor);
  if (actorError) return fail(actorError);
  if (!isRecord(command) || !COMMAND_TYPES.includes(command.type)) return fail('bad_command');
  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString();
  const base = isRecord(state) ? state : {};
  return HANDLERS[command.type]({ state: base, ideas: asList(base.ideas), command, actor, at: String(now()) });
}

function readEntries(entries) {
  const values = new Map();
  const add = (name, value) => {
    if (typeof name !== 'string' || typeof value !== 'string') return; // File/Blob values are ignored on purpose
    if (!values.has(name)) values.set(name, []);
    values.get(name).push(value);
  };
  if (entries && typeof entries[Symbol.iterator] === 'function' && typeof entries !== 'string') {
    for (const pair of entries) if (Array.isArray(pair)) add(pair[0], pair[1]);
  } else if (isRecord(entries)) {
    for (const [name, value] of Object.entries(entries)) asList(Array.isArray(value) ? value : [value]).forEach(v => add(name, v));
  }
  return values;
}
export { readEntries as readFormEntries };

const REVISION_RE = /^\d{1,9}$/;

/** Strict expected-revision parser for form values and `dataset` strings; anything else → undefined. */
export function parseRevision(value) {
  if (Number.isInteger(value)) return value >= 0 ? value : undefined;
  return typeof value === 'string' && REVISION_RE.test(value) ? Number(value) : undefined;
}
const withRevision = value => {
  const revision = parseRevision(value);
  return revision === undefined ? {} : { expectedRevision: revision };
};

/** Maps a submitted module form (`data-ideas-form`) to a command. `id` must be generated by the host. */
export function commandFromForm(kind, entries, { id } = {}) {
  const values = readEntries(entries);
  const one = name => values.get(name)?.[0];
  const expectedRevision = withRevision(one('expectedRevision'));
  if (kind === 'quick-capture') return { type: 'idea.create', id, text: one('text') ?? '', projectId: nullableProject(one('projectId')) };
  if (kind === 'edit') return { type: 'idea.update', ref: one('ref'), text: one('text') ?? '', ...expectedRevision };
  if (kind === 'transcript') {
    return { type: 'idea.setTranscript', ref: one('ref'), ...expectedRevision, transcript: { status: 'ready', text: one('transcript') ?? '', source: 'manual' } };
  }
  return null;
}

/**
 * Maps a clicked/changed module control (`data-action`) to a command; unknown actions → null.
 * `data` is the control's `dataset` (`ref`, `direction`, `expectedRevision`) plus `value` for selects.
 * The rendered revision travels along, so a stale view can never delete/move/reassign a newer idea.
 */
export function commandFromAction(action, data = {}) {
  const d = isRecord(data) ? data : {};
  const ref = d.ref;
  const expectedRevision = withRevision(d.expectedRevision);
  if (action === 'idea.delete') return { type: 'idea.delete', ref, ...expectedRevision };
  if (action === 'idea.move') return { type: 'idea.move', ref, direction: ['up', 'down'].includes(d.direction) ? d.direction : undefined, ...expectedRevision };
  if (action === 'idea.assignProject') return { type: 'idea.assignProject', ref, projectId: nullableProject(d.value), ...expectedRevision };
  return null;
}
