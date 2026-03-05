# Shader Toy PR Progression Deep Dive

## Scope & method

Covers progression **after** commit `9d55f1a` ("Merge PR #194 — nwhitehead/master").

Focus: code style direction · architecture/machinery evolution · integration strategy · how PR branches were absorbed into the project.
Not: line-by-line change logs.

Evidence:
- first-parent merge timeline on `origin/master`
- commit graph, diffs, and branch ancestry for `pr#webview`, `pr#better-diag`, `pr#error-lines`, `pr#webgl2`
- satellite fix branches (`fix#iChannel`, `fix#deduplication`)
- file-level diff stats and extension-module analysis
- RC/WIP branch divergence points (`rc1–rc3#sound_synth`, `wip#sound-synth`, `wip#sequencer`)

---

## Executive summary

These four PRs form a **deliberately stacked progression** — not isolated feature drops.
The sequence is load-bearing: each layer depends on the contract established by the previous one.

| Layer | PR | Concern |
|-------|----|---------|
| 1 | `pr#webview` | Modular webview runtime injection |
| 2 | `pr#better-diag` | Cross-boundary diagnostics hardening |
| 3 | `pr#error-lines` | Canonical source-id / line-offset pipeline |
| 4 | `pr#webgl2` | Feature-gated WebGL2 + `#iVertex` on top |

All subsequent RC work (`rc1`–`rc3#sound_synth`, `wip#sequencer`) diverges **from or after these merges**, confirming they are the foundation layer.

---

## Timeline

### Master integration milestones (first-parent)

| SHA | Date | PR | Branch | Title |
|-----|------|----|--------|-------|
| `3fd53c2` | 2026-01-01 | #199 | `pr#webview` | Webview: split runtime into loadable modules |
| `358a487` | 2026-01-07 | #200 | `pr#better-diag` | Better diagnostics: glslify errors + runtime failures |
| `a8e9231` | 2026-01-08 | #201 | `pr#error-lines` | Fixed error code lines with multi-level includes |
| `5d00fdb` | 2026-01-14 | #209 | `fix#iChannel` | Fix early crash on missing local `#iChannel` files |
| `be078ac` | 2026-01-16 | #208 | `pr#webgl2` | WebGL2 explicit mode with vertex shader support |
| `50b6429` | 2026-01-16 | #211 | `fix#deduplication` | Fix: dedupe default error display JS |

Dependabot security merges interleaved but did not affect the architecture spine.

### Branch stacking

```
pr#webview (3 own commits, 11 files, +261)
    └─ pr#better-diag  (2 own commits, 4 files, +197)  ← based on merged pr#webview
         └─ pr#error-lines (6 own commits, 16 files, +448/−101) ← master sync merges
              └─ pr#webgl2 (8 own commits, 29 files, +992/−67) ← master sync merges
```

Each branch carried forward the entire stack of its predecessors via merge-from-master synchronization commits. This is **intentional forward momentum with periodic sync**, not rebased independent lanes.

### Satellite fixes

- **`fix#iChannel`** (PR #209) — forked after `pr#error-lines` merged; one-commit defensive fix in `BufferProvider` against missing local texture files. Merged between `pr#error-lines` and `pr#webgl2`.
- **`fix#deduplication`** (PR #211) — forked after `pr#webgl2` merged; fixed a JS injection duplication bug in `DefaultErrorsExtension` introduced by the error-display rewrite. Same-day stabilization.

These small follow-up fix branches are a consistent pattern: broad PRs land, targeted fixes follow immediately.

---

## Architecture view: how each PR sat in the codebase

### 1) `pr#webview` (PR #199) — runtime composition contract

**What it established:**
The webview HTML was assembled from `webview_base.html` via `WebviewContentAssembler`, but the runtime JavaScript was still one big inline blob. This PR extracted runtime JS into **separate module files** under `resources/webview/` (7 files: `runtime_env.js`, `glsl_error_hook.js`, `shader_compile.js`, `gl_context.js`, `ui_controls.js`, `time_input.js`, `render_loop.js`) and introduced a generic `WebviewModuleScriptExtension` to wire them in through the placeholder system.

**Key design decision:** `WebviewModuleScriptExtension` handles both modes:
- VS Code webview → `<script src="...">` tag pointing at extension resources
- Portable/standalone preview → reads file content and inlines it as `<script>` block

This dual-mode constructor pattern (`getWebviewResourcePath` + optional `getResourceText`) became the template for all later runtime module additions.

**Placeholder contract additions:**
```html
<!-- Webview runtime_env.js -->
<!-- Webview glsl_error_hook.js -->
<!-- Webview shader_compile.js -->
...
```

**Test anchor:** `webview_split.test.ts` (39 lines) — validates that template placeholders exist and module insertion produces expected HTML structure.

**Why it was prerequisite:**
Later PRs needed stable, ordered script insertion points. The `glsl_error_hook.js` module introduced here became the **pluggable error rewriting system** that `pr#webgl2` hooks into for iVertex error rewriting.

---

### 2) `pr#better-diag` (PR #200) — diagnostics as behavioral contract

**What it established:**
Two specific hardening areas:
1. **`runtime_env.js`** — added defensive error surfacing for webview runtime failures (so they become visible diagnostics instead of silent swallows)
2. **`BufferProvider`** — tightened main-function detection logic; handles edge cases like commented-out `main()`, multiple conflicting entry points, and ambiguous `mainImage` signatures

**Key design decision:** Diagnostics treated as a cross-layer contract — not just "error logging" but a behavioral API with defined inputs (shader source, parse state) and outputs (diagnostic emission, error display). Tests validate both sides:
- `better_diag_runtime_env.test.ts` (41 lines) — runtime error surfacing
- `better_diag_main_injection.test.ts` (83 lines) — entry point detection and wrapper generation edge cases

**Style signal:** Conservative, low-blast-radius commits. Only 4 files changed, but each change is test-paired. This established the pattern: **no diagnostic behavior change without a regression test**.

**Why it was prerequisite:**
WebGL2 doubles the compile paths (fragment + vertex). `#iVertex` introduces a new class of error (standalone vertex file opened as fragment). Without reliable entry-point detection and error surfacing, these would be invisible failures.

---

### 3) `pr#error-lines` (PR #201) — canonical source-id and line-offset pipeline

**What it established:**
This is the most structurally impactful PR — it touched 16 files and did a partial rewrite of both error display extensions. Core contribution:

1. **`src/constants.ts`** (new file) — extracted `SELF_SOURCE_ID = 65535` and `WEBGL2_EXTRA_SHADER_LINES = 16` as shared named constants. Previously these were scattered magic numbers.

2. **`SelfSourceIdExtension`** (new) — injects the sentinel value into the webview template via `<!-- Self Source Id -->` placeholder, so the runtime JavaScript shares the same constant as the TypeScript side.

3. **Error display rewrite** — `DefaultErrorsExtension` and `DiagnosticsErrorsExtension` were substantially rewritten:
   - Old: regex matched only `ERROR: <sourceId>:<line>: <msg>` with hardcoded assumptions about source-id 0
   - New: source-id is used to resolve the originating file (include vs. main), with proper fallback chain
   - New: pluggable rewrite hook (`window.shaderToyRewriteGlslError`) allows feature extensions to intercept and transform errors without forking the core display logic
   - New: error display falls through to `console.error` for non-shader errors

4. **`shader_compile.js`** — webview-side `#line` directive normalization now uses the shared `SELF_SOURCE_ID` sentinel.

5. **`BufferProvider`** — `SELF_SOURCE_ID` replaces hardcoded sentinel; post-transform normalization (`#line N 65535` → `#line N 0`) is explicit.

**Key design decision:** Error attribution is a **pipeline** concern, not ad-hoc per-callsite logic. The pipeline: TS-side `#line` injection → webview-side compile → `getShaderInfoLog` regex parsing → source-id resolution → optional rewrite hook → display. Each stage operates on shared constants.

**Test anchor:** `error_lines_regression.test.ts` (134→160 lines) — exercises multi-level include error attribution, source-id resolution, and line offset correctness.

**Why it was prerequisite:**
WebGL2 inserts extra lines (`#version 300 es`, output declarations, compatibility shims — exactly `WEBGL2_EXTRA_SHADER_LINES = 16` of them). Without the shared constant and centralized offset pipeline, every new shader wrapper would require parallel offset math — a guaranteed source of "off-by-N" diagnostics bugs.

---

### 4) `pr#webgl2` (PR #208) — capability expansion on stabilized infrastructure

**What it established:**
The largest PR (29 files, +992/−67), but it composes cleanly with the foundation from PRs 1–3:

1. **Parser/lexer expansion:**
   - `ShaderLexer`: added `iVertex` to preprocessor keywords
   - `ShaderParser`: new `ObjectType.Vertex`, new `getVertex()` parse method
   - `Types`: `BufferDefinition` extended with `VertexFile`, `VertexCode`, `VertexLineOffset`

2. **`BufferProvider` — vertex shader handling:**
   - `looksLikeStandaloneVertexShader()` heuristic (checks `gl_Position`/`gl_VertexID` without `mainImage`/`gl_FragColor`)
   - When a vertex file is opened directly → replaced with a stub containing `ERROR_IVERTEX_SOURCE` marker → triggers the error rewrite hook
   - Vertex shader file reading, `#version` stripping, and line offset tracking

3. **New extension modules (all follow existing patterns):**
   - `WebglVersionExtension` — injects `'Default'` or `'WebGL2'` into `<!-- GLSL Version -->` placeholder
   - `Webgl2ExtraShaderLinesExtension` — injects the shared constant into `<!-- WebGL2 Extra Shader Lines -->` placeholder
   - `GlslVersionExtension` — re-export alias for naming consistency
   - `IvertexErrorRewriteExtension` — hooks into the `glsl_error_hook.js` rewrite system to intercept `ERROR_IVERTEX_SOURCE` errors and produce a human-readable message

4. **Webview runtime changes:**
   - `gl_context.js` — context creation now respects `glslVersionSetting`
   - `shader_compile.js` — `prepareFragmentShader()` and `prepareVertexShader()` handle GLSL ES 3.00 wrapping, output variable declarations, and compatibility shims
   - `webview_base.html` — vertex shader compile path, `VertexLineOffset` tracking, `WEBGL2_EXTRA_SHADER_LINES` used instead of magic `16`

5. **Demos:** 6 new files (`webgl2_features.glsl`, `webgl2_iVertexDemo.glsl`, `vertex/pass1*.glsl`, `vertex/pass2*.glsl`)

**Key design decisions:**
- WebGL version is a **configuration axis**, not a code branch — the extension/placeholder system gates behavior declaratively
- Vertex shaders compose with the existing buffer graph rather than requiring a separate rendering pipeline
- Error rewriting for iVertex uses the **hook system from `pr#error-lines`** rather than forking error display logic
- The standalone-vertex-file detection is **heuristic + graceful degradation** (stub + descriptive error) rather than hard validation

**Test anchors:**
- `glsl_es_compat.test.ts` (101 lines) — GLSL ES 3.00 wrapping, output variable declarations, version injection
- `ivertex.test.ts` (112 lines) — vertex shader parsing, buffer definition wiring, standalone detection
- Updated `better_diag_main_injection.test.ts` and `error_lines_regression.test.ts` for WebGL2-aware line offsets

---

## Integration mechanics: how branches reached upstream

**Workflow model:**

```
ChemistAion/pr#... branch (rtj / Rafal Janik)
    → PR opened against stevensona/shader-toy master
    → periodic merge-from-master syncs on the PR branch
    → Malacath-92 performs standard GitHub merge ("Merge pull request #...")
    → follow-up fix#... branches if needed (same cycle)
```

This is a **maintainer-led integration model with contributor branch stacking**:
- Contributor (rtj) maintains the stacked branches and keeps them fresh by merging master in
- Maintainer (Malacath-92) reviews and merges via standard PR flow
- Master history preserves merge commits and conflict-resolution context

**Naming convention:**
- `pr#<name>` — ready-for-review PR branches
- `fix#<name>` — targeted post-merge stabilization
- `rc<N>#<feature>` — release candidate iterations
- `wip#<name>` — work-in-progress / experimental

---

## Code style trajectory (cross-cutting observations)

### 1) Extension-oriented composition over monolithic edits

Every new capability — WebGL2 version injection, source-id embedding, vertex error rewriting — is a **new `WebviewExtension` implementation**. Central files (`webviewcontentprovider.ts`, `bufferprovider.ts`) grow by wiring, not by inlining logic.

Concrete pattern:
```typescript
const ext = new SomeExtension(params);
this.webviewAssembler.addReplaceModule(ext, 'template line with <!-- Placeholder -->', '<!-- Placeholder -->');
```

Impact: low merge conflict pressure, easy feature gating, clear insertion/removal path.

### 2) Placeholder contract as stable ABI

Template placeholders in `webview_base.html` function as an interface between static HTML and TypeScript-driven assembly. Each PR added new placeholders:

| PR | Placeholders added |
|----|--------------------|
| `pr#webview` | `<!-- Webview runtime_env.js -->`, `<!-- Webview glsl_error_hook.js -->`, ... (7 modules) |
| `pr#error-lines` | `<!-- Self Source Id -->` |
| `pr#webgl2` | `<!-- GLSL Version -->`, `<!-- WebGL2 Extra Shader Lines -->` |

Tests that assert placeholder existence are **architecture tests**, not formatting tests.

### 3) Shared constants bridge the TS ↔ JS boundary

The `constants.ts` → `SelfSourceIdExtension` → `window.ShaderToy.SELF_SOURCE_ID` chain is the canonical pattern for sharing invariants between the TypeScript extension and the webview JavaScript runtime. The same pattern was used for `WEBGL2_EXTRA_SHADER_LINES`.

Rule: any new cross-layer invariant should follow this path rather than duplicating derivation on each side.

### 4) Test-driven seam protection

Each PR paired its changes with focused regression tests at integration boundaries:

| Test file | Lines | What it protects |
|-----------|-------|------------------|
| `webview_split.test.ts` | 39 | Template placeholder existence and module insertion |
| `better_diag_runtime_env.test.ts` | 41 | Runtime error surfacing contract |
| `better_diag_main_injection.test.ts` | 83 | Entry-point detection edge cases |
| `error_lines_regression.test.ts` | 160 | Multi-level include error attribution + line offsets |
| `glsl_es_compat.test.ts` | 101 | GLSL ES 3.00 wrapping and output declarations |
| `ivertex.test.ts` | 112 | Vertex shader parsing, standalone detection |

Total: ~536 lines of targeted seam tests. These are not unit tests of isolated functions — they test **contract boundaries** between parser, assembler, runtime, and diagnostics.

### 5) Conservative TypeScript: explicit over abstract

Observed preferences:
- Explicit classes/interfaces/types (no generic meta-frameworks)
- Straightforward control flow (no monadic chains or complex generics)
- Localized utility functions (not shared utility libraries)
- String-template code generation in extension classes (direct, inspectable)
- `BoxedValue<T>` pattern for out-parameters instead of complex return types

---

## Load-bearing architecture (stable contracts for PoC/RC work)

### 1) Webview assembly pipeline

```
WebviewContentProvider
  → WebviewContentAssembler.addReplaceModule(extension, templateLine, placeholder)
  → WebviewExtension.generateContent() → string injection
```

Any new runtime module or configuration value enters through this pipeline. Do not bypass it.

### 2) Shader parsing and buffer graph

```
BufferProvider.parseShaderCode()
  → ShaderParser (lexer-driven directive extraction)
  → #include inline expansion with #line remapping
  → #iChannel / #iVertex / #iSound dependency resolution
  → BufferDefinition[] with resolved cross-references
```

Parser extensions follow the pattern: add keyword to `ShaderLexer.preprocessor_keywords`, add `ObjectType` enum variant, add parse method, add case in `ShaderParser.parse()`, handle in `BufferProvider.transformCode()`.

### 3) Diagnostic attribution pipeline

```
TS-side: #line injection with SELF_SOURCE_ID → include source-ids
Webview: shader_compile.js normalizes #line directives
Webview: getShaderInfoLog() → regex parse → source-id resolution → rewrite hook → display
```

The pluggable rewrite hook (`glsl_error_hook.js` / `window.ShaderToy.glslError.registerRewriter`) is the extension point for mode-specific error transformations. Used by `IvertexErrorRewriteExtension`; available for future sound-shader or other error rewriting.

### 4) Mode gating

WebGL version is a declarative configuration axis (`'Default'` | `'WebGL2'`), flowing through:
- `package.json` setting → `Context.getConfig()` → `WebglVersionExtension` → template placeholder → runtime `glslVersionSetting` variable → `prepareFragmentShader()` / `prepareVertexShader()` / `getContext()` branching.

New mode-dependent behavior should consume this axis rather than introducing parallel mode detection.

### 5) RC branch lineage

All RC/WIP branches diverge from the merged PR stack:

| Branch | Diverges from | Ahead of master |
|--------|---------------|-----------------|
| `rc1#sound_synth` | post-`#212` (lodash) | 18 commits |
| `rc2#sound_synth` | post-`#212` | 11 commits |
| `rc3#sound_synth` | post-README fix | 10 commits |
| `wip#sequencer` | `pr#error-lines` merge | 14 commits |
| `wip#sound-synth` | post-`#212` | 29 commits |

This confirms the PR stack is the foundation — RC work assumes all four PRs are merged.

---

## Recommendations for upcoming PoC / RC / PR work

### Branch strategy

- Continue stacked branches when architecture dependencies are real.
- Keep a narrow "integration spine" branch for cross-cutting machinery; branch feature experiments from there.
- Merge `master` into long-lived PR branches when needed, but keep sync commits purposeful.
- Use `fix#<name>` for targeted post-merge stabilization (same-day fixes are expected and normal).

### Implementation strategy

- New runtime modules → `WebviewModuleScriptExtension` pattern with dual-mode support.
- New configuration values → extension class + placeholder injection, not inline template edits.
- New cross-layer constants → `constants.ts` → extension → `window.ShaderToy.*` chain.
- New parser directives → lexer keyword + `ObjectType` + parse method + `BufferProvider` wiring.
- New error classes → `glslError.registerRewriter()` hook, not error-display forking.

### Testing strategy

- Every seam boundary gets at least one regression test.
- Test the contract (placeholder presence, error format, line offset correctness), not implementation details.
- Update existing tests when line offsets or preamble sizes change (these are intentional contract changes).

### Review strategy

- Review for contract stability first (placeholders, extension hooks, source-id semantics), then feature behavior.
- Prefer "one architectural concern per PR" with demos and tests attached.
- Accept small follow-up `fix#...` PRs as normal stabilization rhythm.

---

## Risk map

| Risk | Trigger | Mitigation |
|------|---------|------------|
| **Placeholder drift** | Template text/line assumptions change without test updates | Placeholder-existence tests in `webview_split.test.ts`; extend for new placeholders |
| **Line-offset desync** | New shader wrappers/preambles change line counts | Shared `WEBGL2_EXTRA_SHADER_LINES` constant; regression tests in `error_lines_regression.test.ts` |
| **Branch entanglement** | Stacked PRs hide dependency coupling | Document branch prerequisites explicitly; keep dependency chain visible |
| **TS/JS split-brain** | Behavior diverges between extension TypeScript and webview JavaScript | Mirror contract tests on both sides; use shared constants via the injection chain |
| **Mode explosion** | Each new mode (WebGL2, sound, sequencer) multiplies compile/error paths | Declarative mode gating through existing configuration axis; hook system for error rewriting |

---

## Practical takeaway

The post-`9d55f1a` progression established a coherent modernization path:

1. **Runtime assembly** became modular and contract-driven (`pr#webview`)
2. **Diagnostics** became deterministic and test-anchored (`pr#better-diag`)
3. **Source mapping** became explicit shared infrastructure (`pr#error-lines`)
4. **WebGL2/iVertex** landed as a composed capability, not a parallel codebase (`pr#webgl2`)

The winning pattern for future work:
**compose through existing extension/placeholder contracts, gate mode-specific behavior declaratively, bridge TS↔JS invariants through the constants→extension→window chain, and protect every seam with a targeted regression test.**