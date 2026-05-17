# Changelog

## Unreleased

## 0.7.1 - 2026-05-17

- Hardened `agent_team` usability surfaces by exposing effective child tools, reused `clientMessageId` receipts, cleanup-as-evidence-deletion copy, `follow_up` artifact-path guidance, and `mutationScope` non-sandbox warnings across runtime snapshots, model/TUI rendering, docs, examples, and tests.
- Added GitHub Release creation and verification to the standard release choreography, package skill, cookbook, public-release foundry, and public-doc checks.
- Split deterministic release validation from explicit-approval real Pi smoke guidance.

## 0.7.0 - 2026-05-17

- Replaced foreground `agent_team run` with detached lifecycle actions: `start`, compact `retrieve`, `peek`, `message`, `cancel`, and `cleanup`.
- Moved execution to an RPC-backed detached run manager with compact sink-final retrieval, node peeking, live step messaging, cancellation, retention cleanup, and pure graph-file ingress.
- Added capped compact milestone/terminal pushed notices, a single live-only low-noise TUI card, debug-only raw events, and tmp final artifacts for every finalized step.
- Made detached background UI/final callbacks compaction-safe by avoiding retained tool-update callbacks and surfacing UI/final callback failures as compact retrieve diagnostics plus debug events.
- Hardened detached RPC closeout, max-run expiry, event pagination, JSONL framing, artifact ownership/cleanup, launch-time source verification, and fail-closed planning diagnostics.
- Changed library-agent tool grants to inherit catalog `defaultTools` capped by graph authority, expanded read/discovery primitives into the full `read`/`grep`/`find`/`ls` suite, and split shell authority (`allowShellTools`) from structured mutation authority (`allowMutationTools`).
- Made filesystem read/discovery mandatory for every child step, so `agent.tools:[]` now means mandatory read-only rather than no tools, and `package:synthesizer`/`package:web-researcher` can inspect delegated artifact paths.
- Added fail-closed planning for mutation-capable steps without concrete first-class `mutationScope`, including write-capable steps and bash-capable `package:worker` steps.
- Added retrieve `waitSeconds` for bounded wait/read snapshots, chronological append-only assistant-final artifacts, clearer compact live-step phase labels, and retention guidance that treats artifacts as durable handoff/context evidence rather than automatic cleanup trash.
- Kept `peek` step-not-found output compact, made retrieve/peek assistant text opt-in with `preview:false` by default, added retrieve hints for non-sink terminal evidence, and strengthened child prompts to require self-contained final answers.
- Added schema-valid all-inline starter guidance so parents can hand-author useful no-catalog graphs without invalid dependency or tool placement.
- Added a shared internal authority-policy matrix and removed latent extension-confirm/caller-skill inheritance branches so start planning keeps explicit include-only skill selection and deny/allow extension-source policy.
- Added graph design ladder guidance, `artifact-chained-decision.json`, and cookbook-only Web Research to Local Decision guidance with exact active catalog provenance requirements.
- Added `package:web-researcher` for explicit extension-tool web research and narrowed `package:scout` to local repo/dependency exploration.
- Sharpened bundled catalog role routing copy for local scout, web researcher, planner, critic, reviewer, docs auditor, validator, worker, and synthesizer boundaries.
- Made catalog search route on non-stopword query terms instead of exact full-phrase-only matches, and tightened package role defaults so read-only Scout/Reviewer no longer inherit `bash` unless a step asks for it explicitly.
- Tightened trust-boundary checks so global Pi settings are not treated as project `.pi/settings.json` launch blockers, repo-local caller skills require project-code authority even from subdirectory invocations, and parent messages use escaped JSON payloads instead of delimiter-sensitive raw text.
- Tightened model-facing action/result copy, catalog routing metadata, graph first-success guidance, and fail-closed approved-plan implementation examples without adding new runtime knobs.
- Reworked the interactive live `agent_team` widget, compact tool rows, and pushed notice fallback text into human operator surfaces that prioritize run health, progress, active lanes, queued work, terminal receipts, stop receipts, and attention states without model-facing control guidance.
- Hardened project-root detection, project-agent open-time checks, blank-after-trim planning validation, run-backed error rendering, pushed notice fallbacks, and added an opt-in real Pi smoke target for release-candidate validation.
- Added package release-readiness metadata and release handoff guidance for the human-owned npm publish boundary.
- Updated README, package skill, graph cookbook, examples, catalog tests, package checks, and public-doc checks for the breaking detached-only contract and release guardrails.

## 0.6.2 - 2026-05-07

- Added package-local TypeScript source typechecking to the release gate.
- Refreshed package-local dependencies to their latest pnpm-resolved versions.

## 0.6.1 - 2026-05-07

- Aligned Pi runtime imports, peer dependencies, and package-load tests to the `@earendil-works` Pi 0.74 package scope.
- Added release notes to the packaged npm artifact.
