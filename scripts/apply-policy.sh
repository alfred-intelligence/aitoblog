#!/usr/bin/env bash
#
# Apply repository policy (rulesets, labels, repo settings) from .github/.
# Idempotent: re-running updates existing entries in place.
#
# Usage:
#   ./scripts/apply-policy.sh --phase=initial   # before claude-code-review is verified
#   ./scripts/apply-policy.sh --phase=final     # after verified
#
# Two phases exist because the 'Claude Code Review / claude-review' status check
# cannot be required before it has been observed to post green on every PR type
# (human + dependabot + release-please). Initial phase applies everything else,
# operator verifies, then final phase adds the review check to required-checks.

set -euo pipefail

OWNER="${OWNER:-alfred-intelligence}"
REPO="${REPO:-aitoblog}"
ARG="${1:-}"

case "$ARG" in
  --phase=initial) PHASE="initial" ;;
  --phase=final)   PHASE="final"   ;;
  *)
    echo "Usage: $0 --phase=initial|--phase=final" >&2
    exit 2
    ;;
esac

command -v gh >/dev/null || { echo "gh CLI required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }

REVIEW_CONTEXT="Claude Code Review / claude-review"

apply_ruleset() {
  local file="$1"
  local name
  name=$(jq -r '.name' "$file")

  local body
  body=$(cat "$file")
  if [[ "$PHASE" == "initial" ]]; then
    body=$(jq --arg ctx "$REVIEW_CONTEXT" '
      .rules |= map(
        if .type == "required_status_checks" then
          .parameters.required_status_checks |= map(select(.context != $ctx))
        else .
        end
      )
    ' "$file")
  fi

  local existing_id
  existing_id=$(gh api "/repos/$OWNER/$REPO/rulesets" \
    --jq ".[] | select(.name == \"$name\") | .id" 2>/dev/null || true)

  if [[ -n "$existing_id" ]]; then
    echo "  Updating ruleset '$name' (id=$existing_id, phase=$PHASE)"
    echo "$body" | gh api -X PUT "/repos/$OWNER/$REPO/rulesets/$existing_id" --input - >/dev/null
  else
    echo "  Creating ruleset '$name' (phase=$PHASE)"
    echo "$body" | gh api -X POST "/repos/$OWNER/$REPO/rulesets" --input - >/dev/null
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

echo "==> Applying rulesets (phase=$PHASE)"
for f in .github/rulesets/*.json; do
  apply_ruleset "$f"
done

echo
echo "Policy applied for phase=$PHASE."
if [[ "$PHASE" == "initial" ]]; then
  echo
  echo "Next: verify 'Claude Code Review / claude-review' posts green on a test PR"
  echo "(human + dependabot), then re-run with --phase=final."
fi
