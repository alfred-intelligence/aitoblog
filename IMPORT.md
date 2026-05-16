# Post-merge setup

aitoblog ships its repo policy as code under `.github/`:

- `.github/rulesets/01-main-branch.json` — required checks, PR-rule, linear history, bypass actors
- `.github/rulesets/02-release-tags.json` — protection for v* tags
- `.github/repo-settings.json` — squash-only merge, auto-merge, auto-delete head branches
- `.github/labels.json` — labels the loops emit or consume

GitHub does not auto-apply these from disk. The companion `scripts/apply-policy.sh` reads them and calls the REST API. Run it once after this PR lands, and re-run whenever you clone this repo via "Use this template".

**Order matters.** The CI/CD plan (`docs/design/06-ci-cd-plan.md` §10) lays out a two-phase sequence so each grind is in place before the loop that depends on it.

Prerequisites: `gh` CLI authenticated against an account with admin rights on the repo, plus `jq`.

```bash
export OWNER=alfred-intelligence
export REPO=aitoblog
```

## 1. Provision secrets

`ANTHROPIC_API_KEY` is read by both the publish loop (Actions scope) and Claude Code Review on dependabot-triggered runs (Dependabot scope). **Set both.**

```bash
gh secret set ANTHROPIC_API_KEY                  -R "$OWNER/$REPO"
gh secret set ANTHROPIC_API_KEY --app dependabot -R "$OWNER/$REPO"
```

This is critical. Without the Dependabot-scope copy, `Claude Code Review` fails with `startup_failure` on every dependabot PR — the required check never posts green, and every dependabot PR is blocked forever (docs §5).

Optional Telegram escalation (Loop 7, only triggers on `priority:critical` issues):

```bash
gh secret   set ALFRED_TG_TOKEN   -R "$OWNER/$REPO"  # paste bot token
gh variable set ALFRED_TG_CHAT_ID -R "$OWNER/$REPO"  # numeric chat id
```

Missing Telegram credentials is fine — `escalate.yml` skips the Telegram step gracefully and still opens the issue.

## 2. Initial-phase policy

Apply labels, repo-settings, and rulesets without the `Claude Code Review / claude-review` required check. Until we have observed the review workflow run green on every PR type, requiring it would block all merges (chicken-and-egg).

```bash
./scripts/apply-policy.sh --phase=initial
```

After this, required status checks on `main` are: `ci / build`, `commitlint / commitlint`. The PR-rule, linear history, bypass-actors, and tag protection are all already enforced.

## 3. Verify Claude Code Review

Open a trivial PR (e.g. `docs(readme): typo fix`) from a non-bot branch. Within a few minutes:

- `ci / build`, `commitlint / commitlint` post green.
- `Claude Code Review / claude-review` posts a review and a status check.

Repeat for a dependabot PR. Trigger one manually if you don't want to wait for the next Monday-morning run:

```bash
gh api -X POST "/repos/$OWNER/$REPO/dependency-graph/snapshots"
```

Verify that `Claude Code Review / claude-review` does **not** report `startup_failure` on the dependabot PR. If it does, the Dependabot-scope secret is missing — re-run §1.

## 4. Final-phase policy

Once §3 verifies that `Claude Code Review / claude-review` posts green on both human and dependabot PRs:

```bash
./scripts/apply-policy.sh --phase=final
```

This adds the review check to the required-checks list. From now on, all PRs go through the review grind — no filter, no exceptions.

## 5. Auto-merge for trusted bots

`.github/workflows/auto-merge-trusted.yml` enables `--auto --squash` on every dependabot PR and on release-please PRs. With the rulesets and the review grind in place, those PRs land on `main` without operator intervention when all checks (including review) are green. Breaking changes in major bumps surface as a red `Claude Code Review` check; trustmatrix §2 considers that sufficient protection.

## 6. Smoke test

For dependabot:

```bash
gh api -X POST "/repos/$OWNER/$REPO/dependency-graph/snapshots"
```

A patch-level bump should appear, the review reviews it, auto-merge takes it.

For release-please: next push to main with a `feat:`/`fix:`/etc. commit updates PR #release-please. When you're ready to cut, the workflow auto-merges it after CI is green.

## On the CodeQL warnings

CodeQL default setup will flag every unpinned 3rd-party action (`pnpm/action-setup`, `dependabot/fetch-metadata`, `wagoid/commitlint-github-action`, `googleapis/release-please-action`) with "Unpinned tag for a non-immutable Action". These are **warning-severity** — they do not block merge. Either dismiss the alerts manually in **Security → Code scanning** with reason "won't fix — trusted upstream", or revisit advanced setup in a dedicated follow-up PR.
