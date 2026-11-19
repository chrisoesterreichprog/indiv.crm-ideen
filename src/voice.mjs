// Gated adapter for the separately owned whispr voice bridge.
// The module never touches microphones, media streams or the network itself: the CRM host
// injects an approved bridge object. Recording starts only on explicit user action with
// consent, stops at a hard maximum duration and on interruption (no background recording).
// Original audio (opaque media ref) and transcript are separate artifacts.
//
// Provisional bridge interface (pending the whispr repository contract):
//   { kind: 'whispr' | 'local', egress: 'none' | 'shielded',
//     hasMicrophone(): Promise<boolean>,
//     startRecording({ maxDurationMs, signal }): Promise<handle>,
//     stopRecording(handle): Promise<{ audioRef, mimeType, durationMs }>,
//     cancelRecording(handle): Promise<void>,               // discards partial audio
//     transcribe?(audioRef, { signal }): Promise<{ text, language }> }   // whispr only
import { cleanText, isMediaRef, isRecord, normalizeAudio, normalizeTranscript, TRANSCRIPT_MAX } from './ideas.mjs';
import { normalizeSettings } from './settings.mjs';

export const VOICE_CAPABILITIES = Object.freeze({ capture: 'voice:capture', transcribe: 'voice:transcribe', shield: 'ai:shield' });

export const VOICE_MESSAGES = Object.freeze({
  ready: 'Sprachaufnahme bereit. Aufnahme startet erst nach Klick.',
  recording: 'Aufnahme läuft.',
  disabled: 'Sprachideen sind in den Einstellungen deaktiviert.',
  capability_missing: 'Der CRM-Host hat die Sprachaufnahme nicht freigegeben.',
  bridge_missing: 'Keine freigegebene whispr-Bridge verbunden.',
  no_microphone: 'Kein Mikrofon verfügbar. Text-Ideen funktionieren weiterhin.',
  consent_missing: 'Für Audioaufnahmen ist deine ausdrückliche Einwilligung nötig.',
  shield_missing: 'Transkription gesperrt: serverseitiger Shield ist nicht bestätigt.',
  interrupted: 'Transkription wurde unterbrochen. Das Originalaudio bleibt erhalten.',
  error: 'Transkription fehlgeschlagen. Das Originalaudio bleibt erhalten.',
});

const capabilitySet = value => new Set(Array.isArray(value) ? value.filter(v => typeof v === 'string') : []);
const ACTIVE_STATES = new Set(['starting', 'recording', 'processing']);

function captureGate({ settings, caps, hasBridge, microphone, consentAudio }) {
  if (!settings.voice.enabled) return 'disabled';
  if (!caps.has(VOICE_CAPABILITIES.capture)) return 'capability_missing';
  if (!hasBridge) return 'bridge_missing';
  if (microphone === false) return 'no_microphone';
  if (!consentAudio) return 'consent_missing';
  return null;
}

function transcriptionGate({ settings, caps, bridgeKind, hasTranscriber, egress, consentTranscription }) {
  if (!settings.voice.transcribe) return 'disabled';
  if (!caps.has(VOICE_CAPABILITIES.transcribe)) return 'capability_missing';
  if (bridgeKind !== 'whispr' || !hasTranscriber) return 'bridge_missing';
  if (!consentTranscription) return 'consent_missing';
  // Anything that may leave the device is an AI data path: only behind a server-enforced Shield.
  if (egress !== 'none' && !caps.has(VOICE_CAPABILITIES.shield)) return 'shield_missing';
  return null;
}

/**
 * Render-time voice status from host-reported facts (`ctx.voice`), e.g.
 * `{ bridge: 'available', kind: 'whispr', egress: 'none', microphone: true, consent: { audio, transcription }, session }`.
 * Pure: never touches devices.
 */
export function voiceStatus(ctx) {
  const c = isRecord(ctx) ? ctx : {};
  const settings = normalizeSettings(c.settings);
  const caps = capabilitySet(c.capabilities);
  const voice = isRecord(c.voice) ? c.voice : {};
  const consent = isRecord(voice.consent) ? voice.consent : {};
  const reason = captureGate({ settings, caps, hasBridge: voice.bridge === 'available', microphone: voice.microphone, consentAudio: consent.audio === true });
  const transcriptionReason = transcriptionGate({
    settings, caps, bridgeKind: voice.kind ?? 'whispr', hasTranscriber: voice.bridge === 'available', egress: voice.egress, consentTranscription: consent.transcription === true,
  });
  let state = 'ready';
  if (reason === 'disabled') state = 'disabled';
  else if (reason === 'consent_missing') state = 'consent_required';
  else if (reason) state = 'unavailable';
  else if (voice.session === 'recording') state = 'recording';
  return Object.freeze({
    state,
    reason,
    message: VOICE_MESSAGES[reason ?? (state === 'recording' ? 'recording' : 'ready')],
    transcription: Object.freeze({ allowed: !reason && !transcriptionReason, reason: transcriptionReason }),
  });
}

const isBridge = b => isRecord(b) && (b.kind === 'whispr' || b.kind === 'local')
  && ['hasMicrophone', 'startRecording', 'stopRecording', 'cancelRecording'].every(name => typeof b[name] === 'function');

/**
 * Creates a single-recording controller around an injected bridge.
 * States: idle → starting → recording → processing → done | interrupted | unavailable | error.
 * Listeners receive `{ state, reason, result? }`; `done` always carries `{ audio, transcript }`
 * (also when auto-stopped at the maximum duration).
 */
export function createVoiceCapture(options = {}) {
  const opts = isRecord(options) ? options : {};
  const settings = normalizeSettings(opts.settings);
  const caps = capabilitySet(opts.capabilities);
  const bridge = isBridge(opts.bridge) ? opts.bridge : null;
  const consent = { audio: opts.consent?.audio === true, transcription: opts.consent?.transcription === true };
  const setTimer = typeof opts.setTimer === 'function' ? opts.setTimer : (fn, ms) => setTimeout(fn, ms);
  const clearTimer = typeof opts.clearTimer === 'function' ? opts.clearTimer : id => clearTimeout(id);
  const maxDurationMs = settings.voice.maxDurationSec * 1000;
  const listeners = new Set();
  let state = 'idle';
  let handle = null;
  let controller = null;
  let timer = null;

  const result = (ok, extra = {}) => Object.freeze({ ok, state, ...extra });
  const emit = (next, reason = null, payload) => {
    state = next;
    const event = Object.freeze({ state, reason, ...(payload ? { result: payload } : {}) });
    for (const listener of [...listeners]) {
      try { listener(event); } catch { /* listener errors never break capture */ }
    }
  };
  const stopTimer = () => { if (timer !== null) { clearTimer(timer); timer = null; } };
  const release = current => { if (controller === current) controller = null; };
  const safeCancel = async recording => { try { await bridge.cancelRecording(recording); } catch { /* bridge discards anyway */ } };
  const failedTranscript = reason => normalizeTranscript({ status: 'failed', reason, source: 'whispr-bridge' }).value;

  const captureBlocked = () => captureGate({ settings, caps, hasBridge: Boolean(bridge), microphone: undefined, consentAudio: consent.audio });
  const transcriptionBlocked = () => transcriptionGate({
    settings, caps, bridgeKind: bridge?.kind, hasTranscriber: typeof bridge?.transcribe === 'function', egress: bridge?.egress, consentTranscription: consent.transcription,
  });

  async function transcribe(audioRef, current) {
    const blocked = transcriptionBlocked();
    if (blocked) return normalizeTranscript({ status: 'unavailable', reason: blocked, source: 'whispr-bridge' }).value;
    if (current.signal.aborted) return failedTranscript('interrupted');
    try {
      const output = await bridge.transcribe(audioRef, { signal: current.signal });
      if (current.signal.aborted) return failedTranscript('interrupted');
      const text = cleanText(output?.text);
      if (!text || text.length > TRANSCRIPT_MAX) return failedTranscript('error');
      return normalizeTranscript({ status: 'ready', text, source: 'whispr-bridge', language: output?.language }).value;
    } catch {
      return failedTranscript(current.signal.aborted ? 'interrupted' : 'error');
    }
  }

  async function start() {
    if (ACTIVE_STATES.has(state)) return result(false, { code: 'busy' });
    const blocked = captureBlocked();
    if (blocked) return result(false, { code: blocked });
    const current = new AbortController();
    controller = current;
    emit('starting');
    let microphone = false;
    try { microphone = (await bridge.hasMicrophone()) === true; } catch { microphone = false; }
    if (current.signal.aborted) return result(false, { code: 'interrupted' });
    if (!microphone) {
      release(current);
      emit('unavailable', 'no_microphone');
      return result(false, { code: 'no_microphone' });
    }
    let started;
    try {
      started = await bridge.startRecording({ maxDurationMs, signal: current.signal });
    } catch {
      if (current.signal.aborted) return result(false, { code: 'interrupted' });
      release(current);
      emit('error', 'start_failed');
      return result(false, { code: 'start_failed' });
    }
    if (current.signal.aborted) {
      await safeCancel(started);
      return result(false, { code: 'interrupted' });
    }
    handle = started;
    emit('recording');
    timer = setTimer(() => { timer = null; stop('max_duration').catch(() => {}); }, maxDurationMs);
    return result(true);
  }

  async function stop(reason = 'user') {
    if (state !== 'recording') return result(false, { code: 'not_recording' });
    stopTimer();
    const current = controller ?? new AbortController();
    const recording = handle;
    handle = null;
    emit('processing', reason);
    let recorded;
    try {
      recorded = await bridge.stopRecording(recording);
    } catch {
      release(current);
      emit('error', 'stop_failed');
      return result(false, { code: 'stop_failed' });
    }
    const audio = normalizeAudio({
      ...(isRecord(recorded) ? { ref: recorded.audioRef, mimeType: recorded.mimeType, durationMs: recorded.durationMs } : {}),
      source: bridge.kind === 'whispr' ? 'whispr-bridge' : 'local',
    });
    if (audio.code) {
      release(current);
      emit('error', 'bad_media_ref');
      return result(false, { code: 'bad_media_ref' });
    }
    const transcript = await transcribe(audio.value.ref, current);
    release(current);
    const payload = Object.freeze({ audio: audio.value, transcript });
    emit('done', reason, payload);
    return result(true, payload);
  }

  /** Re-runs transcription for an existing original audio ref (e.g. after an interruption). */
  async function retranscribe(audioRef) {
    if (ACTIVE_STATES.has(state)) return result(false, { code: 'busy' });
    if (!isMediaRef(audioRef)) return result(false, { code: 'bad_media_ref' });
    const current = new AbortController();
    controller = current;
    emit('processing', 'retranscribe');
    const transcript = await transcribe(audioRef, current);
    release(current);
    const payload = Object.freeze({ transcript });
    emit('done', 'retranscribe', payload);
    return result(true, payload);
  }

  /** Stops any active capture immediately; partial recordings are discarded via the bridge. */
  async function interrupt(reason = 'interrupted') {
    stopTimer();
    if (state === 'starting' || state === 'recording') {
      controller?.abort();
      controller = null;
      const recording = handle;
      handle = null;
      emit('interrupted', reason);
      if (recording !== null) await safeCancel(recording);
      return result(true, { discarded: true });
    }
    if (state === 'processing') {
      // Audio was explicitly stopped by the user and is kept; only transcription is aborted.
      controller?.abort();
      return result(true, { discarded: false });
    }
    return result(false, { code: 'not_active' });
  }

  async function updateConsent(next = {}) {
    if (typeof next?.audio === 'boolean') consent.audio = next.audio;
    if (typeof next?.transcription === 'boolean') consent.transcription = next.transcription;
    if (!consent.audio && (state === 'starting' || state === 'recording')) return interrupt('consent_revoked');
    if (!consent.transcription && state === 'processing') controller?.abort();
    return result(true);
  }

  return Object.freeze({
    start,
    stop: () => stop('user'),
    retranscribe,
    interrupt,
    updateConsent,
    getState: () => state,
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async dispose() {
      const outcome = await interrupt('disposed');
      listeners.clear();
      return outcome;
    },
  });
}

/**
 * Interrupts capture when the page is hidden, frozen or left, so recording can never continue
 * in the background. Pass the real `document`/`window` (or EventTarget fakes in tests).
 * Returns a detach function.
 */
export function attachInterruptionGuards(capture, { document: doc, window: win } = {}) {
  if (!capture || typeof capture.interrupt !== 'function') throw new TypeError('voice capture controller required');
  const onVisibility = () => { if (doc?.visibilityState === 'hidden') capture.interrupt('hidden'); };
  const onFreeze = () => capture.interrupt('freeze');
  const onPageHide = () => capture.interrupt('pagehide');
  doc?.addEventListener?.('visibilitychange', onVisibility);
  doc?.addEventListener?.('freeze', onFreeze);
  win?.addEventListener?.('pagehide', onPageHide);
  return () => {
    doc?.removeEventListener?.('visibilitychange', onVisibility);
    doc?.removeEventListener?.('freeze', onFreeze);
    win?.removeEventListener?.('pagehide', onPageHide);
  };
}
