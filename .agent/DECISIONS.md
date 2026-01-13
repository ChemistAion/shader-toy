# Decisions (ADR-lite)

Record *agreements* here so they survive chat resets and sync across machines via git.

Template:

## YYYY-MM-DD — <Decision title>
- **Decision**: <what we decided>
- **Why**: <reasoning / tradeoffs>
- **Consequences**: <what this changes, follow-ups>
- **Related**: <files, issues, links>
- **Trigger** (optional): `EXPLICIT:` | `PREMISE:`

---

## 2026-01-13 — Bootstrap project memory in-repo
- **Decision**: Store key agreements in `.agent/` instead of relying on Copilot Chat session history.
- **Why**: Copilot chat sessions/history are not a durable, cross-machine source of truth.
- **Consequences**: Update this file when we agree on important behavior/API/architecture.
- **Related**: `.agent/WORKLOG.md`, `.prompts/INIT.md`
