// AustriQ CRM module: Ideen-Inbox. Host-provided synthetic state only; no network calls,
// no device access, no direct writes into other modules. The CRM host owns auth, tenants,
// persistence, layout/docking and capability grants.
import { deepFreeze } from './html.mjs';
import { COMMAND_TYPES, SCHEMA_VERSION } from './ideas.mjs';
import { PROPOSAL_CONTRACT } from './transfer.mjs';
import { RAILS, SIZE_CLASSES, renderTarget } from './views.mjs';

const LEGACY_SLOTS = ['center', 'left-top', 'left-middle', 'left-bottom', 'right-top', 'right-bottom', 'footer-left', 'footer-right'];
const VIEWS = ['initialization', 'settings', 'workbench'];

export const manifest = deepFreeze({
  id: 'ideas',
  label: 'Ideen-Inbox',
  version: '0.2.0',
  // Kept at 1 so existing v1 host loaders keep accepting the module. `apiVersions` advertises the
  // provisional v2 contract `render(rail, context, dimensions)` until indiv.crm-module-sdk#1 is final.
  apiVersion: 1,
  apiVersions: [1, 2],
  contractStatus: 'provisional',
  schemaVersion: SCHEMA_VERSION,
  slots: LEGACY_SLOTS, // v1 default preset only, not a layout limit
  rails: [...RAILS],
  views: VIEWS,
  sizeClasses: [...SIZE_CLASSES],
  capabilities: ['render:center', 'render:slots', 'render:rails', 'render:settings', 'render:initialization'],
  hostCapabilities: {
    required: [],
    optional: ['workflow:propose', 'voice:capture', 'voice:transcribe', 'ai:shield'],
  },
  ports: {
    out: [
      { name: 'idea', type: 'austriq.ref.idea@1', carries: 'opaque-ref' },
      { name: 'transfer', type: PROPOSAL_CONTRACT, carries: 'opaque-ref', requiresConfirmation: true },
    ],
    in: [],
  },
  commands: [...COMMAND_TYPES],
  dataAccess: 'host-provided-only',
  network: 'none',
});

const TARGETS = new Set([...LEGACY_SLOTS, ...RAILS, ...VIEWS]);

/**
 * v1: `render(slot, context)`; v2: `render(rail, context, dimensions)` with `rail` in
 * top|bottom|left|right and `dimensions = { width, height }` of the actual container.
 * Also renders the mandatory views `initialization`, `settings` and `workbench` (= `center`).
 * Unknown targets and missing context fail closed.
 */
export function render(target, ctx = {}, dimensions) {
  if (typeof target !== 'string' || !TARGETS.has(target)) throw new RangeError('Unsupported CRM module slot');
  if (!ctx || typeof ctx !== 'object') throw new TypeError('CRM module context required');
  return renderTarget(target, ctx, dimensions ?? ctx.dimensions);
}

// Note: HTML helpers stay module-private on purpose; shared safe-render primitives belong to
// indiv.crm-module-sdk#1 and must not be re-exported as a de-facto shared framework from here.
export {
  applyIdeaCommand, authorizeIdea, checkActor, cleanText, commandFromAction, commandFromForm, COMMAND_TYPES,
  ideaRef, isMediaRef, parseIdeaRef, projectRef, REF_PREFIX, SCHEMA_VERSION, TEXT_MAX, TRANSCRIPT_MAX, tenantScope, visibleIdeas,
} from './ideas.mjs';
export { DEFAULT_SETTINGS, normalizeSettings, parseSettingsForm, TRANSFER_TARGET_IDS } from './settings.mjs';
export { attachInterruptionGuards, createVoiceCapture, VOICE_CAPABILITIES, voiceStatus } from './voice.mjs';
export { enabledTransferTargets, PROPOSAL_CONTRACT, PROPOSAL_TYPE, proposeTransfer, TRANSFER_TARGETS, WORKFLOW_CAPABILITY } from './transfer.mjs';
export { DRAG_HELP, DRAG_IDLE, dragReducer, dropTargets, resolveDrop } from './dnd.mjs';
export { LEGACY_SLOT_PRESETS, normalizeDimensions, RAILS, setupStatus, SIZE_CLASSES, SIZE_THRESHOLDS, sizeClassFor } from './views.mjs';
