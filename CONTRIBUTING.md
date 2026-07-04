# Contributing to pi-multiagent

Thanks for contributing. This project is small and maintainer-led, so the fastest path is a scoped change that preserves the current public contract and arrives with fresh proof.

## Choose the right workflow

### Direct PR is fine for small changes

Use a normal pull request for:

- focused bug fixes
- small documentation corrections
- small tests that prove current behavior
- narrowly scoped examples that do not change runtime behavior

A direct PR should be ready to merge after review.

### Open a proposal issue before large changes

Open a GitHub issue first for changes that affect product shape, public API, lifecycle, authority, trust, persistence, scheduling, mutation behavior, provider/model integration, release flow, or package-agent semantics.

Examples that need a proposal before implementation:

- new `agent_team` actions or public schema fields
- background/scheduled/repeated runs
- persistent run state, recovery, orphan handling, or reattach semantics
- mutation isolation, git worktrees, patch application, or cleanup machinery
- graph authority or child capability changes
- extension/provider/model discovery policy changes
- secret/environment/credential handling
- new bundled package agents or changed role requirements
- release, publish, tag, or package-version choreography

Use the feature proposal template and wait for maintainer scope before opening an implementation PR. The accepted proposal should name the minimal first PR.

## Proposal expectations

A proposal should answer:

- What user problem does this solve?
- What is explicitly out of scope?
- What public API or docs change is proposed?
- What happens on cancel, reload, crash, timeout, and failure?
- What state is stored, where, for how long, and who owns cleanup?
- What authority, trust, secret, credential, or provider-cost risks exist?
- How will operators see, stop, recover, or audit the behavior?
- What alternatives were considered?
- What is the smallest safe first PR?

For scheduling/background execution specifically, cover repeated provider/API cost, visibility, cancellation, reload behavior, overlap behavior, ownership, and failure handling before writing runtime code.

## PR requirements

Start from current `origin/main`; do not build on stale package snapshots or old release branches.

Before requesting review:

1. Keep the PR scoped to one coherent change.
2. Preserve the current public contract unless an accepted proposal explicitly changes it.
3. Keep one current `agent_team` public surface: the strict action set, schema-owned graph fields, catalog provenance routing, and real graph authority/tool gates.
4. Do not weaken package role capability truth: `package:validator` requires effective `bash`, and `package:worker` requires effective `edit` or `write`.
5. Do not bump `package.json` version.
6. Do not create a dated release section in `CHANGELOG.md`.
7. Put user-visible unreleased changes under `## Unreleased` in `CHANGELOG.md`.
8. Do not run `npm publish`, create tags, push release branches, or create GitHub Releases from a contributor PR.
9. Include fresh validation output from the commands below, or explain exactly why a command is deferred.

Required local proof for normal PRs:

```bash
pnpm run typecheck
pnpm test
pnpm run gate
git diff --check
```

For docs-only GitHub metadata changes, a maintainer may accept a smaller proof surface such as:

```bash
pnpm run check:public-docs
pnpm run check:pack
git diff --check
```

For package-surface changes, include the dry-run package readback in the PR notes. Package budgets live in `tests/package-policy.ts`; `pnpm run check:pack` enforces the package file allowlist, packed file count, and unpacked-size budget.

```bash
npm pack --dry-run --json
```

Release readiness is split from the normal development gate. `pnpm run check:release:offline` is a clean-commit lineage/changelog guard, `pnpm run check:release:npm` is the network npm-version availability check, and `pnpm run check:release` runs both before maintainer-owned publish work. Do not treat release checks as dirty-tree PR validation.

Real Pi smoke may spend model/API credentials or invoke local provider state. Run it only with explicit operator approval:

```bash
PI_MULTIAGENT_REAL_SMOKE=1 PI_MULTIAGENT_REAL_SMOKE_TIMEOUT_MS=180000 pnpm run smoke:pi
```

Major runtime or live-integration changes need more than static gates or toy smoke: when approved, observe a meaningful articulated graph through terminal state, inspect its final artifacts, and do not count final-less, stalled, or canceled runs as GO evidence.

## Changelog and release ownership

`package.json` version, dated changelog release sections, npm publish, git tags, pushes, and GitHub Releases are maintainer-owned release work.

Contributor PRs should normally update only `## Unreleased`, and only when the change affects shipped behavior, public docs, examples, tests, package metadata, or operator-facing guidance.

## Agent-generated contributions

Agent-generated PRs are welcome only when the branch is reviewable by the same standards as human-authored code:

- base the work on current `origin/main`
- avoid bundling unrelated architecture changes
- include the exact proposal link for design-gated work
- report the commands actually run and their fresh results
- separate intended behavior from observed proof
- do not claim release, publication, runtime availability, or live Pi behavior unless directly observed

If an agent produced a broad branch, split it before review rather than asking maintainers to review every possible system at once.
