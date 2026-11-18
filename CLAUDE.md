# AUSTRIQ-CLAUDE-TASK v1.1.0 · Safe module development

## Source of truth
- Read the triggering GitHub Issue #1, this file, README, existing `dev` branch, and parent host `chrisoesterreichprog/indiv.crm` before implementation.
- The CRM host owns environment/auth, project membership, layout/persistence and capability grants. Do **not** copy its server or introduce an unreviewed second CRM backend.
- Each module implements a versioned declarative manifest, `render(slot, context)` (or a documented backwards-compatible v2 contract), **Initialization**, **Settings**, and a full **Workbench**. Compact views must exist for top, left, right and five bottom slots; make them accessible and keyboard-operated.

## Model and authorization
- Only owner-authored comments with exact first line `@claude [model:opus] [effort:xhigh]` or `@claude [model:fable] [effort:xhigh]` may start Claude.
- Route to `claude-opus-5-5` / xhigh for ordinary development; `claude-fable-5-2` / xhigh only for explicit high-risk integration work.
- No Haiku/Sonnet, lower effort, Anthropic API key or paid usage-credit fallbacks. If OAuth secret missing or model unavailable, **stop and report**.

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
