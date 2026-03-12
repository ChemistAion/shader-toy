# Codex Agent Instructions

Use this file as the Codex-oriented companion to the imported `.github` workspace material.

## Scope

- Follow the user request first and stay scoped to the task at hand.
- Treat `.github/` as the local agent-workspace for this branch: shared docs, imported instructions, and architecture references live there.
- Use the local `.github` docs as reference material; do not treat them as code or runtime assets.

## Working style

- Inspect the relevant code and docs before changing implementation details.
- Keep diffs small, reviewable, and limited to the requested surface.
- Prefer root-cause fixes over cosmetic patching.
- Avoid unrelated renames, formatting churn, or directory reshuffles.
- Do not create commits unless the user explicitly asks for one.

## Communication

- State a short plan before multi-step changes.
- Provide concise progress updates during longer work.
- Summarize outcomes with the key files touched and any verification performed.
- Ask only targeted questions when a decision or permission is actually required.

## Verification

- Prefer the narrowest useful verification first.
- Run relevant build, lint, or test commands after meaningful changes when practical.
- Report unrelated failures separately instead of folding them into the requested task.

## Repo guidance

- Treat `origin/master` as the base integration branch unless the user says otherwise.
- Use dedicated branches and worktrees for experiments and feature work.
- Push to remotes only when explicitly requested.
- Avoid interactive terminal tools and disable pagers for git-style inspection flows.

## Local references

Use these files when they are relevant to the task:

- `../../README.md`
- `../../copilot-instructions.md`
- `../../docs/architecture/overview.md`
- `../../skills/shader-toy/SKILL.md`

## Codex note

This file is a Codex-specific overlay derived from the shared `.github` inputs. If you want these instructions to apply automatically to Codex in this repo, place or mirror the final approved version as a repo-root `AGENTS.md`.
