# AustriQ Individual CRM · Ideen

Eigenständiges Frontend-Modul. Ideen-Inbox mit Projektzuordnung, Sprachideen über eine freigegebene whispr-Bridge und Übergaben an Learn, Experience, Studio und Kalender – ausschließlich als bestätigungspflichtige Vorschläge. Keine Drittanbieter-Verarbeitung, keine Netzwerkzugriffe, kein Gerätezugriff im Modul, keine externen npm-Abhängigkeiten.

Der CRM-Host besitzt Anmeldung, Mandanten, Projektmitgliedschaft, Persistenz, Layout/Docking und Capability-Freigaben. Alle Prüfungen in diesem Modul sind clientseitige Defense-in-Depth und schlagen geschlossen fehl; maßgeblich bleibt die serverseitige Autorisierung und das Audit des Hosts.

## Render-Vertrag

| Aufruf | Bedeutung |
| --- | --- |
| `render(slot, context)` | **v1**, unverändert gültig. `slot` ∈ `center` + sieben Legacy-Slots (nur Default-Preset, kein Layout-Limit). |
| `render(rail, context, dimensions)` | **v2 (provisional)** für Fluid Docking: `rail` ∈ `top`, `bottom`, `left`, `right`; `dimensions = { width, height }` der tatsächlichen Containergröße. Alternativ `context.dimensions`. |
| `render('initialization' \| 'settings' \| 'workbench', context)` | Die drei Pflichtansichten; `workbench` ≡ `center`. |

- `manifest.apiVersion` bleibt `1`, damit bestehende Host-Loader das Modul weiter akzeptieren; `manifest.apiVersions = [1, 2]` und `contractStatus: 'provisional'` kündigen v2 an, bis `indiv.crm-module-sdk#1` die kanonischen Slots/Ports veröffentlicht.
- Kompakte Views passen sich stufenlos an: Größenklasse `xs` (< 160×72), `s` (< 260×140), `m` (< 420×280), sonst `l`. Wachsen eines Containers liefert nie eine kleinere Klasse. Ungültige Maße fallen auf Rail-Defaults zurück.
- Die Footer-Karte im Default-Preset (1/5 einer 1440 px-Leiste, 288×160) ist Klasse `m`: Schnellerfassung, Zähler, zwei neueste Ideen.
- Mehrere Instanzen: `context.instanceId` setzen, damit DOM-IDs eindeutig bleiben. Unbekannte Ziele → `RangeError`, fehlender Kontext → `TypeError`.

### Kontext (alles vom Host, alles optional)

```js
{
  actor: { userId, tenantId, status: 'active' },     // ohne actor: v1-Modus, Host hat bereits gefiltert
  ideas: [...], projects: [{ id, tenantId, name, ownerId, memberIds }],   // oder unter context.state
  settings: { defaultProjectId, voice: { enabled, transcribe, maxDurationSec }, transfers: { targets } },
  capabilities: ['workflow:propose', 'voice:capture', 'voice:transcribe', 'ai:shield'],
  voice: { bridge: 'available', kind: 'whispr', egress: 'none', microphone: true, consent: { audio, transcription }, session },
  instanceId: 'dock-1', dimensions: { width, height }
}
```

Ist ein `actor` gesetzt, werden nur Ideen desselben Mandanten angezeigt, die der Person gehören oder in einem Projekt liegen, in dem sie Mitglied ist. Ein widerrufener/ungültiger `actor` oder eine ungültige `tenantId` zeigt keinerlei Daten.

## Datenschema v2 einer Idee

```js
{ id, schemaVersion: 2, tenantId, ownerId, projectId | null, kind: 'text' | 'voice', text,
  audio: { ref: 'austriq:media:…', mimeType, durationMs, source: 'whispr-bridge' | 'local' } | null,
  transcript: { status: 'ready' | 'pending' | 'unavailable' | 'failed', text, source, language, reason? } | null,
  order, revision, createdAt, updatedAt }
```

Originalaudio (opaque Media-Ref) und Transkript sind getrennte Artefakte: Transkript bearbeiten oder neu anfordern verändert das Audio nie. Einheitliche Refs: `austriq:idea:<id>`, `austriq:project:<id>`, `austriq:media:<id>`.

## Befehle (`applyIdeaCommand(state, command, actor, { now })`)

`idea.create`, `idea.update`, `idea.setTranscript`, `idea.assignProject`, `idea.move`, `idea.delete` – reiner Reducer, liefert `{ ok, state, event }` oder `{ ok: false, code }` (`unauthenticated`, `revoked`, `not_found` für fremde Mandanten, `forbidden`, `project_forbidden`, `bad_ref`, `conflict` bei veralteter `expectedRevision`, …). Events enthalten nur Refs/Feldnamen, niemals Text oder Transkript; `idea.deleted` meldet `mediaRefs` zur serverseitigen Löschung. Der Host führt Befehle serverseitig aus; `commandFromForm()`/`commandFromAction()` übersetzen die gerenderten Formulare und Buttons.

- `idea.move` mit `direction: 'up' | 'down'` verschiebt **innerhalb der Workbench-Spalte** (gleiches sichtbares Projekt bzw. Inbox) und überspringt Ideen anderer Projekte; am Spaltenrand → `no_change` (Buttons sind dort `disabled`). `toIndex` bleibt eine absolute Position in der Gesamtliste der Person (kompakte Views).
- Optimistische Nebenläufigkeit: Alle verändernden Controls tragen `data-expected-revision`. Der Host übergibt `commandFromAction(action, { ...element.dataset, value: element.value })`; ein veralteter Stand ergibt `conflict` statt eines überschriebenen/gelöschten neueren Stands. Nur nicht-negative Ganzzahlen werden akzeptiert (`parseRevision`).

## Drag & Drop und Übergaben

- Drag-Quellen tragen nur `data-drag-ref="austriq:idea:…"`; Ziele `data-drop-target="inbox" | "project:<id>" | "transfer:<learn|experience|studio|calendar>"` (`INBOX_TARGET_ID`, `projectTargetId()`). Die Inbox liegt bewusst außerhalb des `project:`-Namensraums, damit ein Projekt mit der ID `inbox` nie als „Projekt entfernen“ gedeutet wird.
- `dragReducer` bildet Tastatur (Leertaste/Enter anheben, Pfeile/Home/End wählen, Enter wählen, Escape/Tab abbrechen) und Pointer-Drops ab, inkl. Ansagen für die `aria-live`-Region.
- `resolveDrop()` führt nie etwas aus: Projekt-Drops werden zu `{ kind: 'command', requiresConfirmation: true, command: { …, expectedRevision } }` (Revision zum Zeitpunkt des Drops – ändert sich die Idee vor der Bestätigung, liefert der Befehl `conflict`), Modul-Drops zu einem Workflow-Proposal `{ contract: 'austriq.workflow.proposal@0-provisional', type: 'ideas.transfer.requested', idempotencyKey, requiresConfirmation: true, payload: { ref, projectRef, kind, hasAudio, transcriptStatus } }`. `idempotencyKey = ideas.transfer:<tenantId>:<ideaId>:<target>:r<revision>` – mandantengebunden, weil Idee-IDs nur je Mandant eindeutig sind. Bestätigung, Berechtigung, Ausführung und Undo liegen bei `indiv.crm-workflows#1` bzw. CRM-Host #18. Ohne `workflow:propose` werden keine Übergabeziele angeboten.

## Sprachideen (whispr-Bridge)

`createVoiceCapture({ bridge, settings, capabilities, consent })` kapselt eine vom Host injizierte, freigegebene Bridge (Schnittstelle siehe `src/voice.mjs`). Aufnahme nur nach Klick, mit `voice:capture`, aktivierter Einstellung und ausdrücklicher Audio-Einwilligung; harte Maximaldauer; `attachInterruptionGuards()` bricht bei `visibilitychange`/`freeze`/`pagehide` ab und verwirft Teilaufnahmen. Transkription zusätzlich nur mit `voice:transcribe`, eigener Einwilligung und – falls die Bridge nicht rein lokal arbeitet (`egress !== 'none'`) – nur mit host-bestätigtem `ai:shield`. Fehlt Bridge oder Mikrofon, bleiben Text-Ideen voll nutzbar; eine lokale Bridge (`kind: 'local'`) liefert nur Audio.

## Host-Hooks im Markup

`data-ideas-form="quick-capture | edit | transcript | settings"`, `data-action="idea.assignProject | idea.move | idea.pickUp | idea.delete (data-confirm) | voice.start | voice.stop | voice.requestConsent | voice.play | voice.retranscribe | ideas.completeSetup | ideas.openSettings"` (verändernde Actions mit `data-ref` + `data-expected-revision`), `data-open-dialog="idea-dialog"`, `.widget-open[data-module="ideas"]`. Der Legacy-Slot `footer-right` behält `form#quick-idea`. Kompakte Einträge kürzen den Titel auf `COMPACT_TITLE_MAX` (80) Zeichen; der volle Text steht in der Workbench.

## Prüfen

```sh
npm test         # Node-Tests: Vertrag, adaptive Größen, Domain, negative AuthZ, Voice, DnD, Privacy
npm run check    # Syntaxprüfung aller Dateien + Render-Smoke über alle Ziele
npm run mutation # schaltet je einen Sicherheits-Guard ab und erwartet rote Tests (Mandant, Widerruf, Consent, Shield, Revision, …)
npm run preview  # schreibt preview/index.html (statisch, synthetisch) für Browser-/Tastaturchecks
```

Nur synthetische Fixtures (`test/fixtures.mjs`). Keine echten Personen-, Kunden-, Audio- oder Zugangsdaten.

## Offene Abhängigkeiten

- `indiv.crm-module-sdk#1`: kanonische Slots/typisierte Ports und gemeinsame Safe-UI-Primitives (lokale Helfer in `src/html.mjs` werden danach ersetzt).
- `indiv.crm-workflows#1`: endgültiges Proposal-/Confirm-/Undo-Schema (aktuell `@0-provisional`).
- CRM-Host #49 (Fluid Docking v2): Aufruf `render(rail, context, dimensions)`, Verdrahtung der Hooks, Persistenz.
- whispr-Repository: verbindliche Bridge-Schnittstelle.
