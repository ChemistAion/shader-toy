# Docs

This folder stores project-level architecture reports and implementation planning notes.

## Architecture

- `architecture/shadertoy-report.md` — complete architecture report of the shader-toy extension (entry points, parsing pipeline, webview assembly, render loop, IPC, feature modules).
- `architecture/shadertoyPRs-overview.md` — progression deep dive across merged PR branches and architectural decisions.
- `architecture/shadertoyPanels-overview.md` — webview/panel machinery deep dive.
- `architecture/shadertoy-audio.md` — historical audio synthesis analysis notes (kept for context; not authoritative for current implementation status).

## Planning

- `planning/fragcoord-overview(0.7.1).md` — FragCoord v0.7.1 source architecture overview used by transplant plans.
- `planning/fragcoord-transplant-plan(0.7.1).md` — cross-feature transplant strategy (inspect/errors/frames/heatmap).
- `planning/fragcoord(0.7.1)-PLAN#inspect.md` — inspect feature implementation plan.
- `planning/fragcoord(0.7.1)-PLAN#errors.md` — errors feature implementation plan.
- `planning/fragcoord(0.7.1)-PLAN#frames.md` — frames feature implementation plan.
- `planning/fragcoord(0.7.1)-PLAN#heatmap.md` — heatmap feature implementation plan.
- `planning/fragcoord(0.6.2)-PLAN#inspect.md` — legacy baseline inspect plan (older version).

## FragCoord References (Source Material)

Primary FragCoord v0.7.1 references live in `references/fragcoord/`:
- reports: `fragcoord-*(0.7.1)-REPORT.md`
- overview and transplant docs: `fragcoord-overview(0.7.1).md`, `fragcoord-transplant-plan(0.7.1).md`
- extracted snippets: `inspector(0.7.1)/071_*.txt`

For current work in this repository, prefer v0.7.1 references over older 0.6.2/0.5.0 materials unless a historical comparison is explicitly needed.
