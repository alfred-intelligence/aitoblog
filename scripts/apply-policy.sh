#!/usr/bin/env bash
#
# Apply repository policy (rulesets, labels, repo settings) from .github/.
# Idempotent: re-running updates existing entries in place.
#
# Single-phase: there is no longer a Claude Code Review check to phase in
# (Loop 4 was removed — see docs/design/06-ci-cd-plan.md §4.4).

set -euo pipefail

OWNER="${OWNER:-alfred-intelligence}"
REPO="${REPO:-aitoblog}"

command -v gh >/dev/null || { echo "gh CLI required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }

apply_ruleset() {
  local file="$1"
  local name
  name=$(jq -r '.name' "$file")

  local existing_id
  existing_id=$(gh api "/repos/$OWNER/$REPO/rulesets" \
    --jq ".[] | select(.name == \"$name\") | .id" 2>/dev/null || true)

  if [[ -n "$existing_id" ]]; then
    echo "  Updating ruleset '$name' (id=$existing_id)"
    gh api -X PUT "/repos/$OWNER/$REPO/rulesets/$existing_id" --input "$file" >/dev/null
  else
    echo "  Creating ruleset '$name'"
    gh api -X POST "/repos/$OWNER/$REPO/rulesets" --input "$file" >/dev/null
  fi
}

echo "==> Applying repo settings"
gh api -X PATCH "/repos/$OWNER/$REPO" --input .github/repo-settings.json >/dev/null

echo "==> Syncing labels"
jq -c '.[]' .github/labels.json | while read -r row; do
  name=$(jq -r '.name' <<<"$row")
  color=$(jq -r '.color' <<<"$row")
  desc=$(jq -r '.description' <<<"$row")
  if gh label list -R "$OWNER/$REPO" --json name --jq '.[].name' | grep -Fxq "$name"; then
    gh label edit "$name" -R "$OWNER/$REPO" --color "$color" --description "$desc" >/dev/null
  else
    gh label create "$name" -R "$OWNER/$REPO" --color "$color" --description "$desc" >/dev/null
  fi
done

echo "==> Applying rulesets"
for f in .github/rulesets/*.json; do
  apply_ruleset "$f"
done

echo
echo "Policy applied."
