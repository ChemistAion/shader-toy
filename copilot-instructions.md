# Copilot Instructions (Project-Agnostic)

These instructions are meant to be reusable across projects. Keep them **short, explicit, and enforceable**.

## Operating Principles
- Follow **explicit user instructions** first; do not invent requirements.
- Stay scoped to the request; avoid side quests.
- Prefer fixing root causes over patching symptoms.
- Be minimal: avoid sweeping refactors unless requested.
- When uncertain, ask **1–2 targeted clarifying questions**, then proceed.

## Communication
- Be concise, direct, and actionable.
- Before making multi-step changes, state a short plan (goal + next steps).
- Provide short progress updates during longer work.
- Summarize outcomes and point to the relevant files/commands.

## Change Management
- Keep diffs small and reviewable.
- Don’t reformat unrelated code.
- Don’t change public APIs, filenames, or directory layouts unless requested.
- If you introduce new dependencies, explain why and how to install them.

## Verification
- Prefer the narrowest verification first (lint/typecheck/unit tests for touched areas).
- If tests/build exist, run them when practical after meaningful changes.
- Don’t “fix” unrelated test failures; report them separately.

## Persistence & “Durable Memory” (Repo-Based)
Chat history is not durable. Persist important agreements in the repo.

### Recommended structure (optional)
- `.agent/DECISIONS.md`: durable agreements/decisions (ADR-lite).
- `.agent/WORKLOG.md`: lightweight progress log and next steps.
- `.prompts/INIT.md`: bootstrap context + workflow rules for new chats.

### Marker protocol
Use one of these markers when proposing or requiring durable changes to project-process rules:
- `PREMISE:` proposal — **do not persist** until the user confirms.
- `EXPLICIT:` directive — **must persist** (distilled, grammar-correct, same meaning).

If something seems important but no marker is present, ask once:
- “Should I persist this as `PREMISE:` or `EXPLICIT:`?”

### Periodic process review
- Roughly every ~10 user inquiries, consider whether a **global** project-processing improvement is warranted.
- If yes, propose it as `PREMISE:` (do not persist until confirmed).
- Do not use this for one-off debugging or local experiments.

## Git / Branching Workflow (Reusable Pattern)
- Treat the main branch as **sacred** (e.g., `origin/master` or `origin/main`): do not rewrite it.
- Create work on dedicated branches; rebase/merge according to the team’s conventions.
- Do not push to remotes unless explicitly asked.

### Optional “toggle branch” pattern
For local-only tooling or workflow overlays (e.g., agent/docs, dev helpers):
- Keep a local-only toggle branch (e.g., `setup#agents`) as **one amendable commit**.
- Enable/disable by rebasing WIP branches onto/off the toggle.
- Never push local-only toggles to `origin`.

### Optional playground pattern
For offside experiments:
- Use a dedicated `playground#XYZ` branch based on the main branch.
- Delete/reinitialize the playground branch after experiments.

## Debugging Discipline
- Reproduce first; collect logs; then change one thing at a time.
- When chasing IDE/task issues, prefer deterministic CLI repro steps.
- If you add debug-only settings, keep them isolated and easy to revert.

## Safety Rails
- Never exfiltrate secrets.
- Don’t add telemetry, network calls, or logging of sensitive data unless requested.
- Avoid generating or including copyrighted content not provided by the user.
