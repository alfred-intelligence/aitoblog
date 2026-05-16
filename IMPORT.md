# Post-merge setup

The operationalisation in `feat/ops-foundation` ships three SSoT configuration files committed to the repo:

- `.github/branch-protection.json`
- `.github/repo-settings.json`
- `.github/labels.json`

GitHub does not auto-apply them from disk — they are documentation + machine-readable inputs for one-time `gh` commands. Run the steps below **once** after this PR (and its first follower) lands on `main`. The same steps apply when a user clones this repo via "Use this template".

Prerequisites: `gh` CLI installed, authenticated against an account with admin rights on the repo, and `jq` available.

```bash
OWNER=alfred-intelligence
REPO=aitoblog
```

## 1. Labels

Sync the eleven labels the loops emit or consume. Existing labels with matching names are updated; unrelated labels are left alone.

```bash
jq -c '.[]' .github/labels.json | while read -r row; do
  name=$(jq -r '.name' <<<"$row")
  color=$(jq -r '.color' <<<"$row")
  desc=$(jq -r '.description' <<<"$row")
  if gh label list -R "$OWNER/$REPO" --json name --jq '.[].name' | grep -Fxq "$name"; then
    gh label edit "$name" -R "$OWNER/$REPO" --color "$color" --description "$desc"
  else
    gh label create "$name" -R "$OWNER/$REPO" --color "$color" --description "$desc"
  fi
done
```

## 2. Repo settings

Applied via the REST repo-edit endpoint. Fields that the API rejects (e.g. `template_repository`) must be set in the dashboard.

```bash
gh api -X PATCH "/repos/$OWNER/$REPO" --input .github/repo-settings.json
```

Then, manually in the dashboard:

- **Settings → Template repository**: checked (only relevant for the public template; downstream clones leave unchecked).
- **Settings → General → Discussions**: enabled if you want the issue-template `config.yml` discussion link to resolve.
- **Settings → Rules → Rulesets**: verify the list is empty before applying branch-protection (avoid double-stacked rules).

## 3. Branch protection on `main`

Applied via the branches-protection REST endpoint. Required because the build + commitlint checks need to be enforced for the auto-merge-trusted loop to be meaningful.

Only `build` and `commitlint` are required — not `judge`. Judge skips bot-authored PRs (dependabot, github-actions, release-please) via an `if:` condition in `judge.yml`, so the `judge` check never posts on those PRs. Listing it as required would deadlock every bot-PR. Judge stays as a soft signal: its `request_changes` verdict still calls `exit 1` and shows up as a failing check, and `auto-merge-trusted.yml` will not enable auto-merge on a PR whose judge check is red.

```bash
gh api -X PUT "/repos/$OWNER/$REPO/branches/main/protection" \
  --input .github/branch-protection.json
```

Verify:

```bash
gh api "/repos/$OWNER/$REPO/branches/main/protection" | jq '.required_status_checks'
```

Expect `build` and `commitlint` in the `checks` list.

## 4. Secrets and variables

The judge loop reads `ANTHROPIC_API_KEY` from repo secrets. If it is not already set (it is shared with the publish workflow), provision it:

```bash
gh secret set ANTHROPIC_API_KEY -R "$OWNER/$REPO"
# (paste key when prompted)
```

No other secrets are introduced by this PR.

## 5. Smoke test

Open a trivial PR (e.g. `docs(readme): typo fix`) from a non-bot branch. Within a few minutes:

- `build`, `commitlint`, and `judge` checks all post.
- `judge` posts a review (approve/comment/request_changes).
- If verdict is `approve` or `comment` and the other checks are green, merge is unblocked.

For dependabot smoke test: wait for the next Monday-morning dependabot run, or trigger one manually:

```bash
gh api -X POST "/repos/$OWNER/$REPO/dependency-graph/snapshots"
```

A patch-level bump should appear, the auto-merge-trusted workflow should enable auto-merge, and after CI it should land on `main` without operator intervention.

## Note on CodeQL warnings

CodeQL default setup will flag every unpinned 3rd-party action (`pnpm/action-setup`, `dependabot/fetch-metadata`, etc.) with "Unpinned tag for a non-immutable Action". These are **warning-severity** — they do not block merge. An attempt to suppress them via advanced setup was reverted from this PR because both Analyze jobs failed on the committed config. Either dismiss the alerts manually in **Security → Code scanning** with reason "won't fix — trusted upstream", or revisit advanced setup in a dedicated follow-up PR.
