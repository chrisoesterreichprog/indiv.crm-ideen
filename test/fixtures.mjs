// Synthetic fixtures only. No real people, mailboxes, recordings, tokens or business data.
export const SECRET = 'SYNTH-PRIVAT-7f3a'; // marker used to detect personal-data leakage
export const FOREIGN = 'FOREIGN-TENANT-MARKER';

export const alice = Object.freeze({ userId: 'user-a1', tenantId: 'tenant-a', status: 'active' });
export const bob = Object.freeze({ userId: 'user-a2', tenantId: 'tenant-a', status: 'active' });
export const mallory = Object.freeze({ userId: 'user-b1', tenantId: 'tenant-b', status: 'active' });
export const revokedAlice = Object.freeze({ ...alice, status: 'revoked' });

export const ALL_CAPS = Object.freeze(['workflow:propose', 'voice:capture', 'voice:transcribe']);
export const VOICE_ON = Object.freeze({ voice: { enabled: true, transcribe: true } });
export const clock = () => '2026-11-19T12:00:00.000Z';

export function fixture() {
  return {
    projects: [
      { id: 'p-alpha', tenantId: 'tenant-a', name: 'Projekt Alpha', ownerId: 'user-a1', memberIds: ['user-a1'] },
      { id: 'p-shared', tenantId: 'tenant-a', name: 'Gemeinsames Projekt', ownerId: 'user-a2', memberIds: ['user-a1', 'user-a2'] },
      { id: 'p-bob', tenantId: 'tenant-a', name: 'Bob intern', ownerId: 'user-a2', memberIds: ['user-a2'] },
      { id: 'p-foreign', tenantId: 'tenant-b', name: 'Fremdprojekt ' + FOREIGN, ownerId: 'user-b1', memberIds: ['user-b1'] },
    ],
    ideas: [
      {
        id: 'i-text', schemaVersion: 2, tenantId: 'tenant-a', ownerId: 'user-a1', projectId: 'p-alpha', kind: 'text',
        text: 'Workshop-Format testen ' + SECRET, audio: null, transcript: null, order: 0, revision: 1,
        createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z',
      },
      {
        id: 'i-voice', schemaVersion: 2, tenantId: 'tenant-a', ownerId: 'user-a1', projectId: null, kind: 'voice', text: '',
        audio: { ref: 'austriq:media:m-voice', mimeType: 'audio/webm', durationMs: 42000, source: 'whispr-bridge' },
        transcript: { status: 'ready', text: 'Synthetisches Transkript ' + SECRET, source: 'whispr-bridge', language: 'de' },
        order: 1, revision: 2, createdAt: '2026-11-02T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z',
      },
      { id: 'i-shared', schemaVersion: 2, tenantId: 'tenant-a', ownerId: 'user-a2', projectId: 'p-shared', kind: 'text', text: 'Gemeinsame Idee', order: 2, revision: 1 },
      { id: 'i-bob', schemaVersion: 2, tenantId: 'tenant-a', ownerId: 'user-a2', projectId: 'p-bob', kind: 'text', text: 'Bob intern Idee', order: 3, revision: 1 },
      { id: 'i-foreign', schemaVersion: 2, tenantId: 'tenant-b', ownerId: 'user-b1', projectId: 'p-foreign', kind: 'text', text: 'Fremde Idee ' + FOREIGN, order: 0, revision: 1 },
    ],
  };
}

/** Context as the CRM host would pass it for an authenticated actor. */
export const ctxFor = (actor, extra = {}) => ({ ...fixture(), actor, capabilities: [...ALL_CAPS], settings: VOICE_ON, ...extra });

/** Returns every duplicated DOM id in a markup string. */
export function duplicateIds(html) {
  const seen = new Set();
  const dupes = new Set();
  for (const [, id] of html.matchAll(/\sid="([^"]+)"/g)) (seen.has(id) ? dupes : seen).add(id);
  return [...dupes];
}

/** Returns ids of form controls that lack a matching <label for>. */
export function unlabelledControls(html) {
  const labelled = new Set([...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map(m => m[1]));
  return [...html.matchAll(/<(?:input|select|textarea)\b(?![^>]*type="hidden")[^>]*\sid="([^"]+)"/g)].map(m => m[1]).filter(id => !labelled.has(id));
}
