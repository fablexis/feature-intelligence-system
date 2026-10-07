# Project Rules

## Prompt Logging

Every time you receive a new instruction or prompt, append it to `prompts.txt` in the project root with a timestamp (ISO 8601) and a brief summary of what you did in response. Create the file if it doesn't exist. Keep this log updated throughout all sessions.

## Prompt Log Format

Each `prompts.txt` entry:

```
=== <ISO 8601> ===
PROMPT (verbatim):
<exact text received, never paraphrased>

RESPONSE:
<brief summary of what was done>
```

One entry per prompt, including short follow-ups and corrections.

## Methodology

Spec-driven development: `docs/PRODUCT.md` → `docs/ARCHITECTURE.md` + `docs/adr/` → `docs/TASKS.md` → code.

**No code without a task ID** (C1–C8, E1…). New work becomes a task first.

## Task Workflow

1. **Explore** — re-read the task, the relevant docs, and the existing code.
2. **Plan** — state a short plan before editing.
3. **Implement.**
4. **Verify** — check each acceptance criterion individually.
5. **Commit.**

Once C7 exists, **any change to prompts, thresholds, or models requires an eval run** (eval-driven development). A threshold changed without re-running the harness is a defect.

## Definition of Done

- All acceptance criteria checked
- Typecheck, lint and tests pass
- Docs updated if a decision changed
- `TASKS.md` updated: Status, Actual time, Deviation from plan
- `prompts.txt` updated
- Committed

## Commits

Conventional commits carrying the task ID — e.g. `feat(C3): three-way resolution at intake`. **Never mix tasks in one commit.**

## Engineering Conventions

**Commands** (established by C1): `npm run dev` · `test` · `typecheck` · `lint` · `seed` · `record` · `eval`

- Folder structure per [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md#components).
- **Vitest** for tests.
- **All model calls go through the `AiProvider` abstraction** with Zod-validated structured output. No direct SDK calls from app code.
- Prompts are versioned in `/prompts`; the version is stored on every `ai_decisions` row.
- **No secrets in code** — `.env.example` only. Model IDs are env vars, never literals.
- Respect the [Non-Goals](./docs/PRODUCT.md#non-goals) in `PRODUCT.md`. Scope additions need a task ID.
