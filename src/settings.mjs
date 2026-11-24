// Ideen module settings (per user/environment, persisted by the CRM host).
// Everything privacy-relevant is opt-in: voice capture and transcription default to off.
import { deepFreeze } from './html.mjs';
import { isId, readFormEntries } from './ideas.mjs';

export const SETTINGS_VERSION = 1;
export const TRANSFER_TARGET_IDS = Object.freeze(['learn', 'experience', 'studio', 'calendar']);
export const VOICE_DURATION_LIMITS = Object.freeze({ min: 10, max: 600, default: 120 });

export const DEFAULT_SETTINGS = deepFreeze({
  version: SETTINGS_VERSION,
  defaultProjectId: null,
  voice: { enabled: false, transcribe: false, maxDurationSec: VOICE_DURATION_LIMITS.default },
  transfers: { targets: [...TRANSFER_TARGET_IDS] },
});

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function clampDuration(value) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) return VOICE_DURATION_LIMITS.default;
  return Math.min(VOICE_DURATION_LIMITS.max, Math.max(VOICE_DURATION_LIMITS.min, Math.round(number)));
}

/** Accepts anything, returns a complete, frozen, valid settings object (unknown keys dropped). */
export function normalizeSettings(raw) {
  const source = isRecord(raw) ? raw : {};
  const voice = isRecord(source.voice) ? source.voice : {};
  const transfers = isRecord(source.transfers) ? source.transfers : {};
  const targets = Array.isArray(transfers.targets)
    ? TRANSFER_TARGET_IDS.filter(id => transfers.targets.includes(id))
    : [...DEFAULT_SETTINGS.transfers.targets];
  const enabled = voice.enabled === true;
  return deepFreeze({
    version: SETTINGS_VERSION,
    defaultProjectId: isId(source.defaultProjectId) ? source.defaultProjectId : null,
    // Transcription can never be active while voice capture itself is disabled.
    voice: { enabled, transcribe: enabled && voice.transcribe === true, maxDurationSec: clampDuration(voice.maxDurationSec) },
    transfers: { targets },
  });
}

/** Converts the submitted settings form (`data-ideas-form="settings"`) into normalized settings. */
export function parseSettingsForm(entries) {
  const values = readFormEntries(entries);
  const one = name => values.get(name)?.[0];
  const checked = name => ['on', 'true', '1'].includes(one(name));
  return normalizeSettings({
    defaultProjectId: one('defaultProjectId') || null,
    voice: { enabled: checked('voice.enabled'), transcribe: checked('voice.transcribe'), maxDurationSec: one('voice.maxDurationSec') },
    transfers: { targets: values.get('transfers.targets') ?? [] },
  });
}
