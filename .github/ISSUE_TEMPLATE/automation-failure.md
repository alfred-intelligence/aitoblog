---
name: Automation failure
about: Auto-opened by a loop or workflow when it cannot self-close. Manual triage required.
title: "[automation] <one-line summary>"
labels: automation-failure
assignees: ''
---

<!--
  This template is used by the workflows under .github/workflows/ when a loop
  escalates. Issues are normally created via `gh issue create` from the failing
  workflow, but the format below is what humans should follow if they file one
  manually.
-->

## Summary

One-sentence description of what failed.

## Source

- Workflow: `<name of yml file>`
- Run: <link to the failing workflow-run page>
- Trigger: `schedule` / `pull_request` / `push` / `workflow_dispatch` / `workflow_run`

## Last log lines

```
<paste the final ~20 lines of the failing step here — or `gh run view <id> --log-failed`>
```

## Suggested action

What the operator most likely needs to do to recover. Be specific:

- File(s) to inspect:
- Command(s) to run locally:
- Whether a re-run is safe:

## Loop ownership

Which loop in `.github/workflows/` owns this failure (per the CI/CD plan, sektion 4)?

- [ ] Loop 1 — dependency-update
- [ ] Loop 2 — release-cut
- [ ] Loop 3 — cron-publish
- [ ] Loop 4 — PR-judge
- [ ] Loop 5 — branch-hygien
- [ ] Loop 6 — drift-detektor
- [ ] Loop 7 — stuck-PR
- [ ] Other / cross-cutting
