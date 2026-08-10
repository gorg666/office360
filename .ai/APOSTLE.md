# APOSTLE Protocol

APOSTLE is the mandatory HEADROOM preflight gate for AI agents.

Before doing any task, the agent must:

1. Read `AGENTS.md`.
2. Read `.ai/PROJECT_CONTEXT.md`.
3. Read `.ai/CURRENT_STATE.md`.
4. Identify relevant files only.
5. State a short plan before changes.
6. Confirm no secrets/runtime configs will be touched.
7. For destructive actions, deploy, seed, migration, reset, or delete — ask explicit confirmation.

The agent must begin work with:

APOSTLE_CHECK:
- Project context read: yes/no
- Current state read: yes/no
- Secrets policy read: yes/no
- Relevant files identified: yes/no
- Destructive action: yes/no
- User confirmation required: yes/no

If this block is missing, the user should stop the agent.
