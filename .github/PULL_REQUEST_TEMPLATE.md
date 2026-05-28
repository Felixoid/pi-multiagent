## Summary

<!-- What changed, in one or two paragraphs? -->

## Scope

<!-- Name the one coherent change this PR owns. If this is part of a larger design, link the accepted proposal issue. -->

Proposal issue, if required: <!-- #123 or N/A -->

## Checklist

- [ ] This branch is based on current `origin/main`.
- [ ] The PR is scoped to one coherent change.
- [ ] I did not bump `package.json` version.
- [ ] I did not create a dated release section in `CHANGELOG.md`.
- [ ] User-visible unreleased changes are recorded under `## Unreleased`, if applicable.
- [ ] I did not reintroduce removed compatibility paths, old action names, stale trust gates, or non-enforced authority paperwork.
- [ ] I did not weaken role capability truth: `package:validator` requires effective `bash`; `package:worker` requires effective `edit` or `write`.
- [ ] I did not run `npm publish`, create tags, push release branches, or create GitHub Releases.

## Design-gate check

This PR changes any of the following:

- [ ] public `agent_team` actions or schema
- [ ] graph authority, tool/capability policy, or package-agent semantics
- [ ] persistence, recovery, reattach, cleanup, or retention
- [ ] mutation/edit behavior, git worktrees, or patch handling
- [ ] scheduling/background/repeated execution
- [ ] provider/model/extension discovery policy
- [ ] secret, credential, environment, or filesystem trust boundaries

If any box above is checked, link the accepted proposal issue and summarize the accepted scope:

<!-- Accepted proposal and scope summary -->

## Validation

Paste fresh command output or explain why a command is deferred.

```bash
pnpm run typecheck
pnpm test
pnpm run gate
git diff --check
```

## Notes for reviewers

<!-- Known risks, intentional non-goals, follow-up PRs, or proof gaps. -->
