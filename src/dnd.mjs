// Pointer and keyboard drag & drop model for ideas. Pure state machine: no DOM access, no
// writes. Every drop resolves to a confirmation-required command (project reassignment within
// Ideen) or a workflow proposal (other modules). Nothing is executed automatically.
import { deepFreeze } from './html.mjs';
import { applyIdeaCommand, cleanText, parseIdeaRef, stateFromContext, tenantScope, visibleProjects } from './ideas.mjs';
import { enabledTransferTargets, proposeTransfer } from './transfer.mjs';

export const DRAG_HELP = 'Leertaste oder Enter hebt die Idee an. Pfeiltasten wählen ein Ziel, Enter wählt es aus, Escape bricht ab. Ausgeführt wird erst nach Bestätigung.';
export const DRAG_IDLE = Object.freeze({ mode: 'idle', announcement: '' });
export const INBOX_TARGET_ID = 'project:inbox';

const fail = code => Object.freeze({ ok: false, code });
const validTarget = t => t && typeof t.id === 'string' && typeof t.label === 'string';

/** Drop targets for the current context: Inbox, member projects, enabled transfer targets. */
export function dropTargets(ctx) {
  const scope = tenantScope(ctx);
  const projects = visibleProjects(stateFromContext(ctx).projects, scope);
  return deepFreeze([
    { id: INBOX_TARGET_ID, kind: 'project', projectId: null, label: 'Inbox (ohne Projekt)' },
    ...projects.map(p => ({ id: 'project:' + p.id, kind: 'project', projectId: p.id, label: cleanText(String(p.name ?? '')) || 'Projekt' })),
    ...enabledTransferTargets(ctx).map(t => ({ id: 'transfer:' + t.id, kind: 'transfer', target: t.id, label: t.label })),
  ]);
}

const focusTarget = (state, index) => {
  const count = state.targets.length;
  const next = ((index % count) + count) % count;
  const target = state.targets[next];
  return Object.freeze({ ...state, index: next, announcement: `Ziel: ${target.label} (${next + 1} von ${count}).` });
};
const chosen = (ref, target) => Object.freeze({
  mode: 'idle',
  drop: Object.freeze({ ref, targetId: target.id }),
  announcement: `Ziel ${target.label} gewählt. Bitte im Bestätigungsdialog freigeben.`,
});
const cancelled = Object.freeze({ mode: 'idle', cancelled: true, announcement: 'Verschieben abgebrochen.' });

/**
 * Actions: `{ type: 'pickUp', ref, targets }`, `{ type: 'key', key }` (KeyboardEvent.key),
 * `{ type: 'drop', ref, targetId, targets }` (pointer), `{ type: 'cancel' }`.
 * A finished interaction returns `{ mode: 'idle', drop: { ref, targetId } }` for `resolveDrop`.
 */
export function dragReducer(state = DRAG_IDLE, action = {}) {
  const current = state?.mode === 'lifted' ? state : DRAG_IDLE;
  switch (action?.type) {
    case 'pickUp': {
      if (!parseIdeaRef(action.ref)) return Object.freeze({ ...DRAG_IDLE, error: 'bad_ref', announcement: 'Diese Idee kann nicht verschoben werden.' });
      const targets = Array.isArray(action.targets) ? action.targets.filter(validTarget) : [];
      if (!targets.length) return Object.freeze({ ...DRAG_IDLE, error: 'no_targets', announcement: 'Keine Ziele verfügbar.' });
      const lifted = focusTarget({ mode: 'lifted', ref: action.ref, targets, index: 0 }, 0);
      return Object.freeze({ ...lifted, announcement: 'Idee angehoben. ' + lifted.announcement + ' Enter wählt, Escape bricht ab.' });
    }
    case 'key': {
      if (current.mode !== 'lifted') return current;
      switch (action.key) {
        case 'ArrowDown': case 'ArrowRight': return focusTarget(current, current.index + 1);
        case 'ArrowUp': case 'ArrowLeft': return focusTarget(current, current.index - 1);
        case 'Home': return focusTarget(current, 0);
        case 'End': return focusTarget(current, current.targets.length - 1);
        case 'Enter': case ' ': case 'Spacebar': return chosen(current.ref, current.targets[current.index]);
        case 'Escape': case 'Esc': case 'Tab': return cancelled;
        default: return current;
      }
    }
    case 'drop': {
      const ref = action.ref ?? current.ref;
      const targets = Array.isArray(action.targets) ? action.targets.filter(validTarget) : (current.targets ?? []);
      const target = targets.find(t => t.id === action.targetId);
      if (!parseIdeaRef(ref) || !target) return Object.freeze({ ...DRAG_IDLE, error: 'bad_drop', announcement: 'Ablegen hier nicht möglich.' });
      return chosen(ref, target);
    }
    case 'cancel':
      return current.mode === 'lifted' ? cancelled : current;
    default:
      return current;
  }
}

/**
 * Turns a finished drag into something the host must confirm before executing:
 * `{ ok, kind: 'command', requiresConfirmation: true, command }` for project reassignment or
 * `{ ok, kind: 'proposal', requiresConfirmation: true, proposal }` for other modules.
 */
export function resolveDrop(ctx, drop) {
  if (!parseIdeaRef(drop?.ref)) return fail('bad_ref');
  const target = dropTargets(ctx).find(t => t.id === drop.targetId);
  if (!target) return fail('bad_target');
  if (target.kind === 'transfer') {
    const outcome = proposeTransfer(ctx, { ref: drop.ref, target: target.target });
    return outcome.ok ? Object.freeze({ ok: true, kind: 'proposal', requiresConfirmation: true, proposal: outcome.proposal }) : outcome;
  }
  const command = Object.freeze({ type: 'idea.assignProject', ref: drop.ref, projectId: target.projectId });
  // Dry run for validation/authorization only; the result is discarded and nothing is persisted.
  const check = applyIdeaCommand(stateFromContext(ctx), command, ctx?.actor);
  if (!check.ok) return check;
  return Object.freeze({ ok: true, kind: 'command', requiresConfirmation: true, command });
}
