# Changelog

## Unreleased

## 0.8.1 - 2026-05-19

- Moved maintainer-only npm publishing choreography out of the public README and into local control-plane instructions, with explicit current-source, changelog, version, clean-commit, tag, publish, GitHub Release, and artifact-verification gates.
- Compressed the public README into a human Pi operator guide for install, trust boundaries, lifecycle, authority, examples, limits, troubleshooting, and source validation.
- Added terminal pushed-notice receipts that expose full sink artifact paths and retention expiry when available while keeping milestone notices compact.
- Added copyable cwd-scoped audit, implementation-validation, and sharded map-reduce graph examples, plus cookbook guidance for those patterns and the cookbook-only web-research/local-decision lane.

## 0.8.0 - 2026-05-19

- Replaced the public supervision contract with `run_status` for compact run snapshots and `step_result` for single-step inspection across runtime, schema, docs, examples, and tests.
- Hardened model-facing delegation guidance for package-only default catalog sources, positive catalog routing tags, artifact-first supervision, copy/adapt packets, reducer contracts, and command/mutation scope handoffs.

## 0.7.2 - 2026-05-19

- Improved detached-run diagnostics for retained-capacity failures, stalled pending steps, retained-run capacity buckets, terminal pushed notices, and compact failed-step reasons.
- Hardened child RPC handling with byte-based JSONL limits, bounded stdin backpressure sends, stdout/stderr error guards, parent-message budget checks, and listener teardown.
- Fixed cleanup result rendering so successful cleanup is receipt-only evidence deletion, denied or failed cleanup remains distinct, and plain notices never point operators back to deleted artifacts.
- Tightened planning and policy copy for mandatory filesystem-read authority, project/local extension-tool trust via `allowProjectCode:true`, and cleanup failure retention.
- Added fail-closed map-reduce, release-readiness, and release-fix graph examples, with validator steps requiring parent-copied command scope and release-foundry lanes denying version bump, commit, tag, push, publish, delete, install, deploy, and GitHub Release creation.
- Clarified graphFile copy/adapt usage, catalog query patterns, skeleton `NEEDS-SCOPE` behavior, filesystem-read non-sandbox guidance, and action `run` denial across docs, skill, cookbook, examples, and tests.
- Tightened release-prep guardrails so `pnpm run check:release` runs only from the clean release commit before tag/push, while npm publish and GitHub Release creation remain human-owned.
- Clarified that ignored local control-plane notes stay local while public-doc and package checks use shipped source, docs, tests, and examples as package truth.

## 0.7.1 - 2026-05-17

- Hardened `agent_team` usability surfaces by exposing effective child tools, reused `clientMessageId` receipts, cleanup-as-evidence-deletion copy, `follow_up` artifact-path guidance, and `mutationScope` non-sandbox warnings across runtime snapshots, model/TUI rendering, docs, examples, and tests.
- Added GitHub Release creation and verification to the standard release choreography, package skill, cookbook, public-release foundry, and public-doc checks.
- Split deterministic release validation from explicit-approval real Pi smoke guidance.

## 0.7.0 - 2026-05-17

- Replaced foreground `agent_team run` with detached lifecycle actions: `start`, compact `run_status`, `step_result`, `message`, `cancel`, and `cleanup`.
- Moved execution to an RPC-backed detached run manager with compact sink-final indexing, single-step inspection, live step messaging, cancellation, retention cleanup, and pure graph-file ingress.
- Added capped compact milestone/terminal pushed notices, a single live-only low-noise TUI card, debug-only raw events, and tmp final artifacts for every finalized step.
- Made detached background UI/final callbacks compaction-safe by avoiding retained tool-update callbacks and surfacing UI/final callback failures as compact run_status diagnostics plus debug events.
- Hardened detached RPC closeout, max-run expiry, event pagination, JSONL framing, artifact ownership/cleanup, launch-time source verification, and fail-closed planning diagnostics.
- Changed library-agent tool grants to inherit catalog `defaultTools` capped by graph authority, expanded read/discovery primitives into the full `read`/`grep`/`find`/`ls` suite, and split shell authority (`allowShellTools`) from structured mutation authority (`allowMutationTools`).
- Made filesystem read/discovery mandatory for every child step, so `agent.tools:[]` now means mandatory read-only rather than no tools, and `package:synthesizer`/`package:web-researcher` can inspect delegated artifact paths.
- Added fail-closed planning for mutation-capable steps without concrete first-class `mutationScope`, including write-capable steps and bash-capable `package:worker` steps.
- Added run_status `waitSeconds` for bounded wait/read snapshots, chronological append-only assistant-final artifacts, clearer compact live-step phase labels, and retention guidance that treats artifacts as durable handoff/context evidence rather than automatic cleanup trash.
- Kept `step_result` step-not-found output compact, made run_status/step_result assistant text opt-in with `preview:false` by default, added run_status hints for non-sink terminal evidence, and strengthened child prompts to require self-contained final answers.
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
- Added package release-readiness metadata and human-owned npm publish boundary guidance.
- Updated README, package skill, graph cookbook, examples, catalog tests, package checks, and public-doc checks for the breaking detached-only contract and release guardrails.

## 0.6.2 - 2026-05-07

- Added package-local TypeScript source typechecking to the release gate.
- Refreshed package-local dependencies to their latest pnpm-resolved versions.

## 0.6.1 - 2026-05-07

- Aligned Pi runtime imports, peer dependencies, and package-load tests to the `@earendil-works` Pi 0.74 package scope.
- Added release notes to the packaged npm artifact.
