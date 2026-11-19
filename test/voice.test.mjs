// Voice capture gating: consent, missing microphone, capability/bridge gates, interruption,
// max duration and separation of original audio and transcript. Fake bridge, no devices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceCapture, attachInterruptionGuards, voiceStatus, applyIdeaCommand, render } from '../src/index.mjs';
import { alice, clock, fixture } from './fixtures.mjs';

const CAPS = ['voice:capture', 'voice:transcribe'];
const SETTINGS = { voice: { enabled: true, transcribe: true, maxDurationSec: 30 } };
const CONSENT = { audio: true, transcription: true };

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeBridge(overrides = {}) {
  const calls = [];
  const bridge = {
    kind: 'whispr',
    egress: 'none',
    async hasMicrophone() { calls.push('hasMicrophone'); return true; },
    async startRecording(options) { calls.push(['startRecording', options.maxDurationMs]); bridge.signal = options.signal; return { id: 'h1' }; },
    async stopRecording(handle) { calls.push(['stopRecording', handle.id]); return { audioRef: 'austriq:media:rec-1', mimeType: 'audio/webm', durationMs: 4200 }; },
    async cancelRecording(handle) { calls.push(['cancelRecording', handle?.id]); },
    async transcribe(ref) { calls.push(['transcribe', ref]); return { text: 'Synthetische Sprachnotiz', language: 'de' }; },
    ...overrides,
  };
  return { bridge, calls };
}

function fakeTimers() {
  const timers = new Map();
  let next = 1;
  return {
    setTimer: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id; },
    clearTimer: id => timers.delete(id),
    fireAll: () => { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } },
    pending: () => [...timers.values()].map(t => t.ms),
  };
}

const capture = (bridge, extra = {}) => createVoiceCapture({ bridge, capabilities: CAPS, settings: SETTINGS, consent: CONSENT, ...fakeTimers(), ...extra });

test('recording without explicit audio consent is refused before touching the bridge', async () => {
  const { bridge, calls } = fakeBridge();
  const voice = capture(bridge, { consent: { audio: false, transcription: true } });
  const result = await voice.start();
  assert.deepEqual([result.ok, result.code], [false, 'consent_missing']);
  assert.deepEqual(calls, []);
  assert.equal(voice.getState(), 'idle');
});

test('voice stays off unless settings, capability and bridge allow it', async () => {
  const { bridge, calls } = fakeBridge();
  assert.equal((await capture(bridge, { settings: {} }).start()).code, 'disabled');
  assert.equal((await capture(bridge, { capabilities: [] }).start()).code, 'capability_missing');
  assert.equal((await capture({ kind: 'whispr' }).start()).code, 'bridge_missing');
  assert.equal((await capture(null).start()).code, 'bridge_missing');
  assert.deepEqual(calls, []);
});

test('missing microphone is reported and nothing is recorded', async () => {
  for (const hasMicrophone of [async () => false, async () => { throw new Error('NotAllowedError'); }, async () => 'yes']) {
    const { bridge, calls } = fakeBridge({ hasMicrophone });
    const voice = capture(bridge);
    const result = await voice.start();
    assert.equal(result.code, 'no_microphone');
    assert.equal(voice.getState(), 'unavailable');
    assert.ok(!calls.some(c => Array.isArray(c) && c[0] === 'startRecording'));
  }
});

test('happy path yields separate original audio and transcript usable for idea.create', async () => {
  const { bridge, calls } = fakeBridge();
  const timers = fakeTimers();
  const voice = capture(bridge, timers);
  const states = [];
  voice.subscribe(event => states.push(event.state));
  assert.equal((await voice.start()).ok, true);
  assert.deepEqual(timers.pending(), [30000]);
  const result = await voice.stop();
  assert.equal(result.ok, true);
  assert.deepEqual(result.audio, { ref: 'austriq:media:rec-1', mimeType: 'audio/webm', durationMs: 4200, source: 'whispr-bridge' });
  assert.deepEqual(result.transcript, { status: 'ready', text: 'Synthetische Sprachnotiz', source: 'whispr-bridge', language: 'de' });
  assert.deepEqual(states, ['starting', 'recording', 'processing', 'done']);
  assert.deepEqual(timers.pending(), []);
  assert.deepEqual(calls.find(c => c[0] === 'transcribe'), ['transcribe', 'austriq:media:rec-1']); // only the opaque ref
  const created = applyIdeaCommand(fixture(), { type: 'idea.create', id: 'v-new', audio: result.audio, transcript: result.transcript }, alice, { now: clock });
  assert.equal(created.ok, true);
  assert.equal(created.state.ideas.at(-1).kind, 'voice');
});

test('transcription is skipped (audio kept) without transcription consent, capability or shield', async () => {
  const variants = [
    [{ consent: { audio: true, transcription: false } }, 'consent_missing'],
    [{ capabilities: ['voice:capture'] }, 'capability_missing'],
    [{ settings: { voice: { enabled: true, transcribe: false } } }, 'disabled'],
  ];
  for (const [extra, reason] of variants) {
    const { bridge, calls } = fakeBridge();
    const voice = capture(bridge, extra);
    await voice.start();
    const result = await voice.stop();
    assert.equal(result.ok, true);
    assert.equal(result.audio.ref, 'austriq:media:rec-1');
    assert.deepEqual([result.transcript.status, result.transcript.reason], ['unavailable', reason]);
    assert.ok(!calls.some(c => c[0] === 'transcribe'));
  }
  const { bridge, calls } = fakeBridge({ egress: 'shielded' });
  const voice = capture(bridge);
  await voice.start();
  assert.equal((await voice.stop()).transcript.reason, 'shield_missing');
  assert.ok(!calls.some(c => c[0] === 'transcribe'));
  const shielded = fakeBridge({ egress: 'shielded' });
  const allowed = capture(shielded.bridge, { capabilities: [...CAPS, 'ai:shield'] });
  await allowed.start();
  assert.equal((await allowed.stop()).transcript.status, 'ready');
});

test('a local media fallback bridge records audio without transcription', async () => {
  const { bridge } = fakeBridge({ kind: 'local', transcribe: undefined });
  const voice = capture(bridge);
  await voice.start();
  const result = await voice.stop();
  assert.equal(result.audio.source, 'local');
  assert.deepEqual([result.transcript.status, result.transcript.reason], ['unavailable', 'bridge_missing']);
});

test('transcription failure keeps the original audio', async () => {
  const { bridge } = fakeBridge({ async transcribe() { throw new Error('model down'); } });
  const voice = capture(bridge);
  await voice.start();
  const result = await voice.stop();
  assert.equal(result.ok, true);
  assert.equal(result.audio.ref, 'austriq:media:rec-1');
  assert.deepEqual([result.transcript.status, result.transcript.reason], ['failed', 'error']);
});

test('interrupting a running recording discards it via the bridge', async () => {
  const { bridge, calls } = fakeBridge();
  const voice = capture(bridge);
  await voice.start();
  const result = await voice.interrupt('hidden');
  assert.deepEqual([result.ok, result.discarded, result.state], [true, true, 'interrupted']);
  assert.ok(bridge.signal.aborted);
  assert.deepEqual(calls.at(-1), ['cancelRecording', 'h1']);
  assert.equal((await voice.stop()).code, 'not_recording');
});

test('interrupting while the recording is starting cancels the late handle', async () => {
  const gate = deferred();
  const { bridge, calls } = fakeBridge({ async startRecording() { return gate.promise; } });
  const voice = capture(bridge);
  const starting = voice.start();
  await new Promise(resolve => setImmediate(resolve));
  await voice.interrupt('pagehide');
  gate.resolve({ id: 'late' });
  const result = await starting;
  assert.deepEqual([result.ok, result.code], [false, 'interrupted']);
  assert.equal(voice.getState(), 'interrupted');
  assert.deepEqual(calls.at(-1), ['cancelRecording', 'late']);
});

test('interrupting during transcription keeps audio and marks the transcript interrupted', async () => {
  const gate = deferred();
  const { bridge } = fakeBridge({ async transcribe() { return gate.promise; } });
  const voice = capture(bridge);
  await voice.start();
  const stopping = voice.stop();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(voice.getState(), 'processing');
  assert.equal((await voice.interrupt('hidden')).discarded, false);
  gate.resolve({ text: 'zu spät' });
  const result = await stopping;
  assert.equal(result.audio.ref, 'austriq:media:rec-1');
  assert.deepEqual([result.transcript.status, result.transcript.reason], ['failed', 'interrupted']);
});

test('retranscribe re-runs only the transcript for an existing audio ref', async () => {
  const { bridge, calls } = fakeBridge();
  const voice = capture(bridge);
  assert.equal((await voice.retranscribe('https://example.invalid/a')).code, 'bad_media_ref');
  const result = await voice.retranscribe('austriq:media:old');
  assert.equal(result.transcript.status, 'ready');
  assert.deepEqual(calls, [['transcribe', 'austriq:media:old']]);
});

test('revoking consent while recording stops and discards immediately', async () => {
  const { bridge, calls } = fakeBridge();
  const voice = capture(bridge);
  await voice.start();
  await voice.updateConsent({ audio: false });
  assert.equal(voice.getState(), 'interrupted');
  assert.deepEqual(calls.at(-1), ['cancelRecording', 'h1']);
  assert.equal((await voice.start()).code, 'consent_missing');
});

test('the hard maximum duration auto-stops and still delivers a result', async () => {
  const { bridge } = fakeBridge();
  const timers = fakeTimers();
  const voice = capture(bridge, timers);
  const done = new Promise(resolve => voice.subscribe(event => { if (event.state === 'done') resolve(event); }));
  await voice.start();
  timers.fireAll();
  const event = await done;
  assert.equal(event.reason, 'max_duration');
  assert.equal(event.result.audio.ref, 'austriq:media:rec-1');
});

test('double start is rejected while busy', async () => {
  const { bridge } = fakeBridge();
  const voice = capture(bridge);
  await voice.start();
  assert.equal((await voice.start()).code, 'busy');
  await voice.dispose();
  assert.equal(voice.getState(), 'interrupted');
});

test('page visibility, freeze and pagehide interrupt capture (no background recording)', async () => {
  for (const [targetName, type] of [['document', 'visibilitychange'], ['document', 'freeze'], ['window', 'pagehide']]) {
    const { bridge } = fakeBridge();
    const voice = capture(bridge);
    const doc = new EventTarget();
    doc.visibilityState = 'hidden';
    const win = new EventTarget();
    const detach = attachInterruptionGuards(voice, { document: doc, window: win });
    await voice.start();
    (targetName === 'document' ? doc : win).dispatchEvent(new Event(type));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(voice.getState(), 'interrupted', type);
    detach();
  }
  assert.throws(() => attachInterruptionGuards(null), TypeError);
});

test('render-time voice status reflects consent, microphone and bridge facts', () => {
  const base = { settings: SETTINGS, capabilities: CAPS };
  assert.equal(voiceStatus({}).state, 'disabled');
  assert.equal(voiceStatus({ ...base }).reason, 'bridge_missing');
  assert.equal(voiceStatus({ ...base, voice: { bridge: 'available', microphone: false, consent: { audio: true } } }).reason, 'no_microphone');
  assert.equal(voiceStatus({ ...base, voice: { bridge: 'available', microphone: true } }).state, 'consent_required');
  const ready = voiceStatus({ ...base, voice: { bridge: 'available', microphone: true, egress: 'none', consent: { audio: true, transcription: true } } });
  assert.deepEqual([ready.state, ready.transcription.allowed], ['ready', true]);
  const workbench = render('center', { ...base, voice: { bridge: 'available', microphone: false } });
  assert.match(workbench, /aria-disabled="true"[^>]*>Sprachidee<\/button><small[^>]*>Kein Mikrofon verfügbar/);
  assert.match(render('center', { ...base, voice: { bridge: 'available', consent: {} } }), /data-action="voice.requestConsent"/);
  assert.match(render('center', { ...base, voice: { bridge: 'available', consent: { audio: true }, session: 'recording' } }), /data-action="voice.stop"/);
});
