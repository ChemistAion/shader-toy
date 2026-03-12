# Copilot Instructions (Project-Agnostic)

These instructions are meant to be reusable across projects. Keep them **short, explicit, and enforceable**.

## Operating Principles
- Follow **explicit user instructions** first; do not invent requirements.
- Stay scoped to the request; avoid side quests.
- Prefer fixing root causes over patching symptoms.
- Be minimal: avoid sweeping refactors unless requested.
- When uncertain, ask **1–2 targeted clarifying questions**, then proceed.

## Communication
- Be concise, direct, and actionable — perhaps a nerdy, with constructive critique.
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

## Git / Branching Workflow (Reusable Pattern)
- Treat the main branch as **sacred** (e.g., `origin/master` or `origin/main`): do not rewrite it.
- Create work on dedicated branches; rebase/merge according to the team’s conventions.
- Do not push to remotes unless explicitly asked.

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


<!-- Added 2026-02-13T21:51:05Z -->

## Additions (2026-02-13T21:51:05Z)
- Study the codebase first and mirror existing architecture, naming, and feature/editor machinery instead of inventing new patterns.
- Prefer alignment with project conventions over clever or overly optimized approaches.
- If a plan/progress file is provided for the task, keep it updated and note major blockers briefly.
- (MUST!) Avoid interactive terminal tools (vim/less/MORE) or any output that requires user scrolling.
- (MUST!) Disable pagers for git commands and keep output concise; avoid dumping heavy diffs or parsing logs into chat.
- Work independently through sub-steps; ask for user input only when a decision or permission is required.
- (MUST!) After meaningful changes, run relevant build/tests and iterate until they pass.
- Do not create commits unless explicitly requested, work as locally, working changes untill we are happy (perhaps my explicit prompt about hat).
- When asked to commit working changes, follow the requested structure and force-push afterward by default.

