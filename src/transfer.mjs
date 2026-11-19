// Hand-over of ideas to Learn, Experience, Studio and Kalender as typed workflow proposals.
// The Ideen module never writes into other modules: the host/workflow service
// (indiv.crm-workflows#1, permission checks in CRM host #18) shows the confirmation, enforces
// permissions, executes, deduplicates via the idempotency key and offers undo.
// Proposals carry opaque refs only — never idea text, transcripts or audio content.
import { deepFreeze } from './html.mjs';
import { authorizeIdea, checkActor, ideaRef, isRecord, parseIdeaRef, projectRef, revisionOf, stateFromContext } from './ideas.mjs';
import { normalizeSettings, TRANSFER_TARGET_IDS } from './settings.mjs';

/** Provisional until indiv.crm-workflows#1 publishes the canonical proposal schema. */
export const PROPOSAL_CONTRACT = 'austriq.workflow.proposal@0-provisional';
export const PROPOSAL_TYPE = 'ideas.transfer.requested';
export const WORKFLOW_CAPABILITY = 'workflow:propose';

export const TRANSFER_TARGETS = deepFreeze({
  learn: { id: 'learn', module: 'learn', label: 'Learn', hint: 'Als Lernthema vorschlagen' },
  experience: { id: 'experience', module: 'experience', label: 'Experience', hint: 'Als Erfahrung festhalten' },
  studio: { id: 'studio', module: 'studio', label: 'Studio', hint: 'Im Studio weiterentwickeln' },
  calendar: { id: 'calendar', module: 'calendar', label: 'Kalender', hint: 'Termin vorschlagen' },
});

const fail = code => Object.freeze({ ok: false, code });
const hasCapability = (ctx, capability) => Array.isArray(ctx?.capabilities) && ctx.capabilities.includes(capability);

/** Targets offered in the UI: enabled in settings AND workflow proposals granted by the host. */
export function enabledTransferTargets(ctx) {
  if (!hasCapability(ctx, WORKFLOW_CAPABILITY)) return [];
  return normalizeSettings(ctx?.settings).transfers.targets.map(id => TRANSFER_TARGETS[id]);
}

/**
 * Builds a confirmation-required transfer proposal. `ctx` = `{ actor, ideas|state, settings, capabilities }`.
 * Returns `{ ok: true, proposal }` or `{ ok: false, code }`; nothing is executed.
 */
export function proposeTransfer(ctx, input) {
  const c = isRecord(ctx) ? ctx : {};
  const actorError = checkActor(c.actor);
  if (actorError) return fail(actorError);
  if (!parseIdeaRef(input?.ref)) return fail('bad_ref');
  if (!TRANSFER_TARGET_IDS.includes(input?.target)) return fail('bad_target');
  if (!hasCapability(c, WORKFLOW_CAPABILITY)) return fail('capability_missing');
  if (!normalizeSettings(c.settings).transfers.targets.includes(input.target)) return fail('target_disabled');
  const found = authorizeIdea(stateFromContext(c), c.actor, input.ref);
  if (found.code) return fail(found.code);
  const { idea } = found;
  const ref = ideaRef(idea.id);
  const revision = revisionOf(idea);
  return Object.freeze({
    ok: true,
    proposal: deepFreeze({
      contract: PROPOSAL_CONTRACT,
      type: PROPOSAL_TYPE,
      // Same idea revision + target ⇒ same key, so repeated drops cannot create duplicates.
      idempotencyKey: `ideas.transfer:${idea.id}:${input.target}:r${revision}`,
      requiresConfirmation: true,
      status: 'proposed',
      source: { module: 'ideas', ref, revision },
      target: { module: TRANSFER_TARGETS[input.target].module },
      payload: {
        ref,
        projectRef: projectRef(idea.projectId),
        kind: idea.audio ? 'voice' : 'text',
        hasAudio: Boolean(idea.audio),
        transcriptStatus: typeof idea.transcript?.status === 'string' ? idea.transcript.status : 'none',
      },
    }),
  });
}
