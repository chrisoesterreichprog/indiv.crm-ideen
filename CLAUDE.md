# AUSTRIQ-CLAUDE-TASK v1.1.0 · Safe module development

## Source of truth
- Read the triggering GitHub Issue #1, this file, README, existing `dev` branch, and parent host `chrisoesterreichprog/indiv.crm` before implementation.
- The CRM host owns environment/auth, project membership, layout/persistence and capability grants. Do **not** copy its server or introduce an unreviewed second CRM backend.
- Each module implements a versioned declarative manifest, `render(slot, context)` (or a documented backwards-compatible v2 contract), **Initialization**, **Settings**, and a full **Workbench**. The current eight-slot manifest is a backwards-compatible default preset only. The approved Fluid Docking v2 host offers dynamic top/bottom/left/right edge lanes with variable size, order and count. This module must render adaptive compact views and keep keyboard support; canonical versioned slots/typed ports come from indiv.crm-module-sdk #1.

## Model and authorization (Owner decision, 20.11.2026)
- Only exact first-line owner comment `@claude [model:opus] [effort:xhigh]`; always `claude-opus-5-5` with `xhigh` on subscription OAuth, never Haiku/Sonnet/Fable downgrade or paid API-key fallback.
- The authorized GitHub Action and AUSTRIQ 11-section preflight govern the run. No feature code or unauthorized deployments may be executed before these gates.

## Mandatory safety
- Use only synthetic fixtures, never real mailbox contents, customer data, recordings, access tokens, secrets or private business details in issues, code, tests, screenshots, PRs, logs or prompts.
- No unrestricted network calls, live connector authorization, email sending, data export, background recording, direct AI egress, or deployment to production/staging. AI data paths require server-enforced fail-closed Shield and explicit user consent. Frontend capabilities and DnD must use opaque references, not raw message bodies/secrets.
- Do not modify VPS, Traefik, Authelia, Docker, infrastructure, database migrations or other repositories. Development is **feature branch + Draft PR + tests** only. Protected DEV publication is a separate reviewed host operation after green CI; never claim it occurred without verification.
- Respect tenants/profiles, setup permissions and server-side audit. Deny unauthenticated, cross-user and revoked actions.

## Workflow
1. Inventory actual APIs, existing modules, state of PRs/issues and dependency contracts. Do not duplicate existing functionality.
2. Implement small vertical slice with tests and accessible UI; document blockers.
3. `npm test`, `npm run check`, negative authorization tests, reproducible browser checks and screenshots where possible.
4. Submit a **Draft PR** against `dev` with named commits, test evidence and exact integration/rollback instructions; no merge.
5. Update Issue progress only based on verified milestones; do not invent percentages or claim running DEV when not deployed.

## Shared component owner boundaries (20.11.2026)
- `indiv.crm-module-sdk#1` owns versioned manifest/slots/render/typed port and safe UI primitive contracts. Do not copy other modules' HTML helpers as a new shared framework.
- `indiv.crm-workflows#1` owns event/proposal/confirm/undo, idempotency and approval contracts, with actual permission checks in the CRM Host #18.
- `indiv.crm-usage#1` owns provider-neutral usage and budget contracts (if this module consumes them). No credential/identity store in the frontend.
- PR and local tests are not proof of a real DEV-integrated UI. The relevant source SHA must be pinned into the protected CRM DEV container with user-visible feature smoke and last-good rollback; see austriq-deploy-hub#77. Never change production/staging.
