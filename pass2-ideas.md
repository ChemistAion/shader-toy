# Shadertoy codebase — second-pass, full-scope deep examination and report refinement

We are doing a **second-pass / follow-up proceeding** on top of the preliminary outcome from the previous investigation.

## Context

The previous pass already performed an initial deep review and produced/refactored `shadertoy-report.md`.  
This new task is **not** a light cleanup. It is a **fresh, full-blown, full-scope, deep-scope, comprehensive, exhaustive, technical re-examination** of the current `master` branch codebase and the current state of the report.

Treat this as a **serious second-pass audit and refinement**:
- re-open the codebase from first principles,
- re-check the existing findings,
- challenge assumptions,
- refine weak spots,
- fill gaps,
- expand coverage,
- improve technical precision,
- and harden the report into something we could actually use as a foundation for a dedicated **project skill** for this repository.

## Important framing

Please treat all wording like **“full scope”, “deep analysis”, “deep examination”, “full examination”, “comprehensive”, “exhaustive”, “broad”, “fresh pass”, “PhD-level”, “strictly technical”, “pro-engineering”** as **intentional tuning**, not noise.  
Do **not** compress or dilute that intent.

This is meant to be:
- broad,
- deep,
- architectural,
- mechanistic,
- implementation-aware,
- evidence-based,
- and highly technical.

## Repository / branch constraints

- Work against the repository **as-is on `master`**.
- Assume this worktree/branch is now effectively just **`master`**.
- **Local working changes only**.
- **No commits**.
- **No branch operations** unless absolutely required for local inspection, and do not leave branch-management side effects.
- Do not produce superficial summaries. This should be a real engineering investigation.

## File handling constraints

- The old overview files were already part of the prior cleanup:
  - `shadertoy-panels-overview.md`
  - `shadertoy-prs-overview.md`

For this second pass:
- **do not recreate** those files unless there is a truly compelling technical reason,
- and keep the focus on refining and strengthening:
  - `shadertoy-report.md`

## Primary mission

Perform a **new deep-scope examination of the entire project machinery and architecture** and then **refactor / rewrite / substantially improve `shadertoy-report.md` accordingly**.

This is a **second-pass refinement**, but it must still behave like a **fresh, full-blown investigation**, not a cosmetic edit pass.

## Required level of examination

Please do a **comprehensive codebase investigation** covering, as applicable:

- overall repository structure,
- architectural decomposition,
- runtime model,
- subsystem boundaries,
- data flow,
- control flow,
- build / tooling / scripts / generation pipeline,
- entry points,
- configuration surfaces,
- conventions and invariants,
- content pipeline and asset flow,
- rendering / shader / panel / report machinery,
- interfaces between modules,
- responsibility split across files,
- dependency graph and coupling patterns,
- extension points,
- brittle areas,
- duplication,
- technical debt,
- implicit assumptions,
- hidden mechanisms,
- undocumented behaviors,
- dead or stale code,
- mismatch between intended design and actual implementation,
- and anything relevant for turning this repository into a well-grounded **Shadertoy project skill** later.

Do not stop at obvious files.  
Do not stay at the surface.  
Trace the machinery.

## Second-pass expectations specifically

Because this is a follow-up / redo with a different model, I want you to explicitly do **second-pass behaviors**, including:

1. **Re-validate prior conclusions** rather than inheriting them blindly.
2. **Look for omissions** in the preliminary outcome.
3. **Challenge structure and terminology** in the current `shadertoy-report.md`.
4. **Refine the architecture narrative** so it matches the actual code machinery.
5. **Strengthen evidence density**.
6. **Add missing cross-references**.
7. **Correct any overstatements or understatements**.
8. **Promote implicit mechanisms to explicit documentation** where justified.
9. **Improve usefulness for future skill-building**, not just for one-off reading.
10. **Prefer technical truth over elegance** if the codebase is messy in messy ways.

## Evidence / citation requirements

The report must be **verbose, technical, and evidence-backed**.

Please point out **sources / refs explicitly**, grounded in the local codebase, using concrete references such as:
- file paths,
- relevant symbols,
- function/class/module names,
- and where practical, line ranges or tightly localized anchors.

Do not write vague claims like “the system seems to do X” unless that uncertainty is real and clearly labeled as such.  
When making claims about architecture or machinery, tie them back to inspected implementation.

## Output requirements for `shadertoy-report.md`

Refactor `shadertoy-report.md` into a **strictly technical, pro-engineering, PhD-level investigation report**.

It should read like a serious internal engineering analysis document.

### Desired qualities
- technically dense,
- explicit,
- structured,
- evidence-backed,
- architecture-first but implementation-grounded,
- suitable as a basis for a future dedicated project skill,
- useful for future maintainers or agents,
- and honest about uncertainty.

### Avoid
- marketing tone,
- fluffy prose,
- shallow summaries,
- generic observations,
- ungrounded speculation,
- broad claims without code references,
- and “looks good overall” nonsense.

## Suggested report structure

Use or adapt a structure along these lines if it helps, but prioritize technical clarity over rigid formatting:

1. **Executive technical synopsis**
2. **Repository purpose and operational role**
3. **Top-level architecture**
4. **Subsystem decomposition**
5. **Execution / processing pipeline**
6. **Core machinery and implementation patterns**
7. **Data / artifact flow**
8. **Configuration and control surfaces**
9. **Dependency and coupling analysis**
10. **Key invariants and assumptions**
11. **Observed technical debt / fragility / risk areas**
12. **Mismatches between apparent and actual architecture**
13. **Implications for building a dedicated Shadertoy skill**
14. **Recommended documentation / refactor priorities**
15. **Appendix of concrete code references**

## Skill-foundation angle

Please keep in mind throughout the pass that the refined report is meant to become a **foundation artifact** for building a dedicated **Shadertoy project skill**.

So the report should help answer questions like:
- what the system actually is,
- how it is organized,
- how an agent should navigate it,
- what the critical modules are,
- what workflows exist,
- what invariants must not be violated,
- what output artifacts matter,
- and where the risky / authoritative parts of the code live.

In other words: document the codebase in a way that is genuinely useful for future agentic operation, not just human browsing.

## Working mode

Please proceed in a **broad, full-scope, deep-analysis mode**.

You may use as many passes, sub-analyses, internal checkpoints, or parallel investigation strategies as useful, but the final result must be coherent and consolidated into the refined `shadertoy-report.md`.

Treat this as:
- a fresh pass,
- a second pass,
- a refinement pass,
- and an audit pass,
all at once.

## Final instruction

Please perform a **full-blown, comprehensive, exhaustive re-examination of the codebase as it currently stands on `master`**, then **refactor `shadertoy-report.md` accordingly**.

Again:
- **full scope**
- **deep scope**
- **comprehensive**
- **exhaustive**
- **strictly technical**
- **pro-engineering**
- **PhD-level**
- **sources/refs pointed out**
- **local working changes only**
- **no commits**

Proceed accordingly.