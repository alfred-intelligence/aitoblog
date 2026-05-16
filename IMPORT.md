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

## 3. Branch protection on `main`

Applied via the branches-protection REST endpoint. Required because the judge + auto-merge loops rely on `required_status_checks` being enforced.

```bash
gh api -X PUT "/repos/$OWNER/$REPO/branches/main/protection" \
  --input .github/branch-protection.json
```

Verify:

```bash
gh api "/repos/$OWNER/$REPO/branches/main/protection" | jq '.required_status_checks'
```

Expect `build`, `commitlint`, `judge` in the `checks` list.

## 4. CodeQL: switch default → advanced setup

This PR ships `.github/workflows/codeql.yml` and `.github/codeql-config.yml`, but they are inert until CodeQL is switched from GitHub's default setup to advanced. Default setup uses a hidden GitHub-hosted config and ignores files in the repo — so any query-filters (like the trust-list for upstream actions) require advanced setup.

In the dashboard:

1. Go to **Settings → Code security and analysis → CodeQL analysis**.
2. If "Default" is selected, click **Set up → Advanced**.
3. GitHub will offer to create a `codeql.yml` workflow — decline (one is already committed in this PR).
4. Confirm the switch.

The next push to `main` (or PR to `main`) will trigger the committed `codeql.yml` instead, and the actions/unpinned-tag warnings will stop appearing for trusted upstream orgs.

## 5. Secrets and variables

The judge loop reads `ANTHROPIC_API_KEY` from repo secrets. If it is not already set (it is shared with the publish workflow), provision it:

```bash
gh secret set ANTHROPIC_API_KEY -R "$OWNER/$REPO"
# (paste key when prompted)
```

No other secrets are introduced by this PR.

## 6. Smoke test

Open a trivial PR (e.g. `docs(readme): typo fix`) from a non-bot branch. Within a few minutes:

- `build`, `commitlint`, and `judge` checks all post.
- `judge` posts a review (approve/comment/request_changes).
- If verdict is `approve` or `comment` and the other checks are green, merge is unblocked.

For dependabot smoke test: wait for the next Monday-morning dependabot run, or trigger one manually:

```bash
gh api -X POST "/repos/$OWNER/$REPO/dependency-graph/snapshots"
```

A patch-level bump should appear, the auto-merge-trusted workflow should enable auto-merge, and after CI it should land on `main` without operator intervention.
