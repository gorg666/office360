---
name: office360-mail-developer
description: Use when implementing production Office360 Mail changes in the Tauri React TypeScript frontend, Rust backend, provider integrations, local database, packaging, security, privacy, or product documentation. Focuses on senior stack judgment, current primary-source knowledge, and safe implementation.
---

# Office360 Mail Developer

Use this skill for production code changes in:

- `/Users/apple/Desktop/Aleksei/office-360/mail/velo`

Follow `AGENTS.md` and the project wiki. Keep changes focused, production-grade, and aligned with existing architecture.

## Source of truth

Read the smallest relevant set before coding:

- Latest explicit user prompt and approved plan or handoff.
- `AGENTS.md` and any nested repo instructions.
- `wiki/` pages for current product/system decisions.
- Relevant files under `../strategy/` when the task comes from an epic or spec.

Precedence:

- Newest explicit user instruction wins over older docs.
- Approved implementation plans win over exploratory notes.
- Wiki captures current system decisions and must be updated when behavior changes.

## Senior implementation rules

- Map impact across React/TypeScript, Tauri/Rust, local DB, provider adapters, packaging, and docs before editing.
- Prefer existing services, stores, hooks, UI primitives, and test patterns.
- Use strict TypeScript and `@/` imports from `src`.
- Keep provider behavior capability-driven. IMAP/POP3 and Yandex are target providers; Gmail-only UI and commands must not leak into default provider flows unless explicitly scoped.
- Preserve local-first mail behavior, sanitized HTML rendering, encrypted credential storage, remote image blocking, and the proprietary license posture.
- Avoid broad refactors, unrelated formatting churn, and ownership overlap with concurrent changes.
- Return product, security, migration, or provider-compatibility uncertainty to `office360-epic-lead`.

## Current knowledge

For fast-moving or security-sensitive areas, verify current primary sources before implementation and list them in the handoff:

- Tauri, Vite, React, TypeScript, Rust crates, browser APIs, packaging/signing.
- OAuth, provider APIs, IMAP/POP3/SMTP behavior, Yandex provider behavior.
- OpenAI or other AI APIs, if AI behavior is touched.
- Security guidance for HTML sanitization, URL handling, credential storage, CSP, and dependency risk.

Use official docs, source repositories, standards, or vendor documentation first. Do not rely on memory for recent APIs, changed defaults, or security rules.

## Security checklist

Before handoff, check the touched surface for:

- No logging of tokens, passwords, raw message bodies, raw MIME, OAuth secrets, local DB contents, or private account identifiers beyond what is required and sanitized.
- No unsafe HTML rendering, remote image auto-loading, unsafe URL opening, or XSS-prone string interpolation.
- Provider commands are gated before execution, not only hidden in one UI entry point.
- Migrations and local data changes are reversible or clearly documented.
- Dependency, license, and package metadata changes do not weaken the closed-source product position.

## Verification during development

Run targeted tests first, then broader checks as scope requires:

```bash
npx vitest run <targeted-test-file>
npm run test
npm run build
```

For Rust or Tauri backend changes:

```bash
cd src-tauri && cargo build
```

If UI behavior changes, prepare a tester-ready smoke brief covering browser and installed desktop/Tauri scenarios.

## Wiki updates

Update `wiki/` when the change affects product behavior, provider policy, security posture, packaging, release workflow, or system architecture. Keep strategy documents historical unless the user explicitly asks to revise them.

## Handoff

End with a packet compatible with `office360-agent-handoff`.

Use:

- `status: ready_for_tests` when implementation is complete and ready for verification.
- `status: blocked` when missing product decisions or external state prevents completion.
- `next_role: office360-mail-tester` when tests and smoke checks should run.
- `next_role: office360-epic-lead` when coordination, scope, or ownership decisions are needed.

Include changed files, commands run, skipped checks, `current_docs_checked`, `security_review`, `wiki_updates`, and a tester-ready smoke prompt.
