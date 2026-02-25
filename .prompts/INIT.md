You are helping with this repo.

Source of truth (if not available yet, here and now - do no ask about them):
- This file (`.prompts/INIT.md`) for repo context + workflow rules.
- `.agent/DECISIONS.md` for durable agreements.
- `.agent/WORKLOG.md` for recent progress and next steps.

Repo context (summary):
- VS Studio/Code extension tooling around Shadertoy-style GLSL (webview renderer, shader parsing, demos).
- Platform: VS Code extension (TypeScript), runs on Windows/macOS/Linux.
- Webview + WebGL runtime assets live in `resources/`.

Architecture map (quick):
- `src/extension.ts`: extension activation.
- `src/webviewcontent*.ts`: webview HTML/JS assembly.
- `resources/webview/*`: runtime scripts.
- `src/shaderparser.ts`, `src/shaderlexer.ts`: shader parsing.
- `demos/*.glsl`: sample shaders.

Rules:
- Follow explicit user instructions until told otherwise.
- Stay scoped to what was asked: do not guess next steps; avoid side quests.
- If we make an important agreement (API behavior, architecture, parsing rules, webview behavior), summarize it into `.agent/DECISIONS.md`.
- Keep changes minimal and consistent with existing style.
- When unsure, ask 1-2 clarifying questions.

Persistence protocol (how we update `.agent/*` and keep it safe across chat resets):
- `PREMISE: ...` means: propose adding the described rule/instruction/guideline to the tool, but do not persist it until the user confirms.
- `EXPLICIT: ...` means: the described rule/instruction/guideline MUST be persisted (in a distilled / grammar-correct form, preserving the meaning).
- If it looks important but no marker was used, ask once: “Should I persist this as `PREMISE:` or `EXPLICIT:`?”

Periodic process review:
- Roughly every 10 chat inquiries, do a quick check whether any *global* project-processing change is warranted.
- If so, propose it as `PREMISE:` (do not persist until confirmed).
- These proposals must be about project processing in general and/or changes to the scope of project processing.
- Do not use this for local helpers, minor improvements, WIP tryouts, debugging, or one-off experiments.

Git / branching workflow:
- NEVER-EVER sync/push `setup#agents` to `origin`.
- Keep `setup#agents` local-only and maintain it as a single-commit toggle (`chores: setup`) by squashing/amending updates.
- Treat `origin/master` as sacred: do not rewrite it and do not push changes onto it.
- All WIP branches are based on (rebased onto) `origin/master`.
- Offside experiments / one-off tests must be done on a dedicated playground branch:
	- Naming: `playground#XYZ` where `XYZ` is the suffix of the active WIP branch (e.g. `wip#sequencer` → `playground#sequencer`).
	- Base: always start from `origin/master`, then apply whatever commits/changes are needed for the experiment.
	- Hygiene: after the experiment, delete the playground branch; if it already exists, delete/reinitialize it from `origin/master` before reuse.
- `test#builder` is a `master`-based on/off “builder switch” branch:
	- Enable during WIP via rebase onto `test#builder` for hands-on test runs.
	- Disable for final PR via rebase back onto `origin/master` when explicitly requested.
- Do not push to `origin` unless explicitly asked.
- It is OK to commit good changes to the current local branch; avoid committing throwaway experiments.

When an item is persisted (typically via `EXPLICIT:`):
- Update the relevant files under `.agent/` / `.prompts/`.
- Keep `setup#agents` as a single-commit toggle by amending/squashing into `chores: setup` (no new commits).
- Do not auto-rebase the active WIP branch onto `setup#agents` just because the tool was updated.

Exception (tool dev mode):
- If the current branch is `setup#agents`, do not treat chat text as an implicit update to these files unless explicitly directed.
- `EXPLICIT:` always counts as explicitly directed.
