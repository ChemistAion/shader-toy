# `.github` Workspace Index

This `.github` directory is a local documentation and agent-workspace overlay for the current branch/worktree. It contains reference material, architecture notes, skills, agent guidance, and workflow definitions used during analysis and maintenance work. These files are support assets for contributors and agents; they are not part of the extension runtime shipped to users.

## Current Contents

### Top-level reference files

- `README.md` — this index for the local `.github` workspace.
- `copilot-instructions.md` — shared Copilot-oriented guidance imported for this worktree.

### Architecture documentation

- `docs/architecture/overview.md` — pass2 architecture overview for the `shader-toy` VS Code extension. This is the primary deep-dive reference for the current `.github` workspace: corrected metrics, hot-reload coverage, CI/tooling risks, test-surface analysis, extension inventory, and gap assessment.

### Skills

- `skills/shader-toy/SKILL.md` — refined reference skill for the `shader-toy` extension, aligned with the latest architecture report and intended for agent use during implementation, debugging, and feature planning.

### Agent-specific overlays

- `agents/README.md` — index for agent-oriented files stored under `.github/agents/`.
- `agents/codex/AGENTS.md` — Codex-focused instructions derived from the shared `.github` guidance and aligned with the local docs set.

### Workflows

- `workflows/` — GitHub workflow definitions and related automation metadata for this worktree snapshot.

## Notes

- Internal references in this `.github` workspace should target the local files present in this branch/worktree.
- The main authoritative deep-dive documents are `docs/architecture/overview.md` and `skills/shader-toy/SKILL.md`; they were refreshed in the latest pass2 review and should stay aligned.
- `overview.md` is the renamed architecture document that replaced the earlier `shadertoy-report.md` path.
- Agent-specific overlays should remain additive where possible so the shared source material is preserved for comparison.
