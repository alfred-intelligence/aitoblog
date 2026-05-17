# Post-merge setup

aitoblog ships its repo policy as code under `.github/`:

- `.github/rulesets/01-main-branch.json` — required checks, PR-rule, linear history, bypass actors
- `.github/rulesets/02-release-tags.json` — protection for v* tags
- `.github/repo-settings.json` — squash-only merge, auto-merge, auto-delete head branches
- `.github/labels.json` — labels the loops emit or consume

GitHub does not auto-apply these from disk. The companion `scripts/apply-policy.sh` reads them and calls the REST API. Run it once after this PR lands, and re-run whenever you clone this repo via "Use this template".

Prerequisites: `gh` CLI authenticated against an account with admin rights on the repo, plus `jq`.

```bash
export OWNER=alfred-intelligence
export REPO=aitoblog
```

## 1. Provision secrets

`ANTHROPIC_API_KEY` is read by the publish loop only. Set on the Actions scope:

```bash
gh secret set ANTHROPIC_API_KEY -R "$OWNER/$REPO"
```

No Dependabot-scope secret is needed anymore — there is no AI in the PR-review path (see docs/design/06-ci-cd-plan.md §4.4 on why Loop 4 was removed).

Optional Telegram escalation (Loop 7 — only triggers on `priority:critical` issues):

```bash
gh secret   set ALFRED_TG_TOKEN   -R "$OWNER/$REPO"  # paste bot token
gh variable set ALFRED_TG_CHAT_ID -R "$OWNER/$REPO"  # numeric chat id
```

Missing Telegram credentials is fine — `escalate.yml` (when added) skips the Telegram step gracefully.

## 2. Apply policy

```bash
./scripts/apply-policy.sh
```

This applies labels, repo-settings, and rulesets. Required status checks on `main`: `ci / build`, `commitlint / commitlint`. PR-rule, linear history, bypass-actors, and tag protection are all enforced.

## 3. Auto-merge for trusted bots

`.github/workflows/auto-merge-trusted.yml` enables `--auto --squash` on every dependabot PR and on release-please PRs. With the rulesets in place, those PRs land on `main` without operator intervention when CI is green.

## 4. Appliances (single-purpose deterministic workflows)

Three workflows handle repo hygiene without AI:

- `can-opener.yml` — closes superseded dependabot PRs (triggered by dependabot's own "Superseded by #X" comment).
- `dustpan.yml` — marks inactive PRs/issues stale after 7 days, closes after 14. Exempt by label `keep`/`wip`/`security`/`priority:critical`.
- `pruner.yml` — deletes branches >30 days old with no open PR and no `keep` label. Sundays 02:00 UTC.

They require no secrets and run on schedule + event triggers. See `docs/design/06-ci-cd-plan.md` §4.5–4.8.

## 5. Smoke test

For dependabot:

```bash
# wait for next Monday morning, or just observe an existing dep-PR rebase
```

A patch-level bump should appear and auto-merge after CI is green.

For release-please: next push to main with a `feat:`/`fix:`/etc. commit updates PR #release-please. When you're ready to cut, the workflow auto-merges it after CI is green.

## On the CodeQL warnings

CodeQL default setup will flag every unpinned 3rd-party action (`pnpm/action-setup`, `dependabot/fetch-metadata`, `wagoid/commitlint-github-action`, `googleapis/release-please-action`, `actions/stale`) with "Unpinned tag for a non-immutable Action". These are **warning-severity** — they do not block merge. Either dismiss the alerts manually in **Security → Code scanning** with reason "won't fix — trusted upstream", or revisit advanced setup in a dedicated follow-up PR.
