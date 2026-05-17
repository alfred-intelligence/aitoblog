# aitoblog — Kort horisont

> **Reviderad.** Den ursprungliga planen (Steg 1–8 för Fas 1+2) är implementerad — se Git-historik från `05b2704` och framåt. Detta dokument täcker nu **Fas 4: Maintenance loops install** enligt arkitekturen i `06-ci-cd-plan.md`. När dessa steg är klara är aitoblog i unattended-tillstånd.

---

## Förkrav (innan Steg 1)

- Repot finns och Fas 1+2 är gröna (`pnpm astro check && pnpm build` passar lokalt).
- Operatören har admin-access till GitHub-repot (för branch protection + repo settings).
- `gh` CLI installerad och autentiserad.
- Secrets `ANTHROPIC_API_KEY` redan satt på repot (var det för publish-loopen).

Om något saknas: rapportera och vänta.

---

## Implementeringsordning (sammanfattning från 06 §10)

```
0. SSoT
1. Labels + branch protection
2. Loop 4 (review-grind)
3. Loop 1+2 (auto-merge-trusted)
4. Loop 5 (branch-cleanup) + auto-delete on merge
5. Loop 3 (cron härdning)
6. Loop 6+7 (drift + stale)
7. Loop escalate (förberedd för Telegram)
```

Varje steg landar med en stängd grind under sig så det går att stanna mellan steg utan att lämna repot i halvtillstånd.

---

## Steg 1 — SSoT för Node + workflow-refaktor

**Mål:** Eliminera Node-version-drift mellan filer.

**Filer:**
- Skapa `.nvmrc` med innehåll `22` (Astro 6 kräver Node 22).
- Uppdatera `package.json#engines`:
  ```json
  "engines": { "node": ">=22.0.0" }
  ```
- Refaktorera alla workflows som hårdkodar `node-version: 20`:
  - `.github/workflows/ci.yml`
  - `.github/workflows/commitlint.yml`
  - `.github/workflows/publish.yml`
  - `.github/workflows/release-please.yml` (om relevant — release-please-action använder eget Node internt, kontrollera)

Ersätt:
```yaml
- uses: actions/setup-node@v6
  with:
    node-version: 20
    cache: pnpm
```
Med:
```yaml
- uses: actions/setup-node@v6
  with:
    node-version-file: .nvmrc
    cache: pnpm
```

**Branch:** `chore/node-ssot`.

**PR-titel:** `chore: enforce node-version SSoT via .nvmrc`

**Verifiering:** CI grön på PR:n. Lokalt: `node --version` matchar `.nvmrc` (eller `nvm use` om operatören har nvm).

**Klart när:** PR mergad. Drift-loopen (kommer i Steg 8) kommer fortsätta vakta.

---

## Steg 2 — Labels + branch protection (förberedande)

**Mål:** Definiera labels och branch protection (rulesets) som källfiler i repot innan deras konsumenter (auto-merge, stale, review-grind) deployas.

**Filer att skapa:**

`.github/labels.json` — komplett labelset enligt 05 §5:

```json
[
  { "name": "keep", "color": "0E8A16", "description": "Skydda från cleanup-/stale-loopar" },
  { "name": "wip", "color": "FBCA04", "description": "Pågående arbete; skydd mot stale" },
  { "name": "needs-judge", "color": "5319E7", "description": "Dependabot major; flaggad för extra granskning (historisk; kan tas bort om inte använd)" },
  { "name": "judge-blocked", "color": "B60205", "description": "Reviewer avslog 2x i rad; mänsklig granskning krävs" },
  { "name": "automation-failure", "color": "D93F0B", "description": "Eskalering från en autonom loop" },
  { "name": "cron-degraded", "color": "E99695", "description": "Cron 2 fel i rad" },
  { "name": "cron-paused", "color": "B60205", "description": "Cron pausad efter 3 fel" },
  { "name": "release-blocked", "color": "B60205", "description": "Release-PR har röd CI" },
  { "name": "drift", "color": "BFD4F2", "description": "Drift-detektor fynd" },
  { "name": "security", "color": "EE0701", "description": "Säkerhetsrelaterat" },
  { "name": "priority:critical", "color": "B60205", "description": "Eskalering inom 24h" },
  { "name": "dependencies", "color": "0366D6", "description": "Dependency-uppdatering (sätts av dependabot)" }
]
```

`.github/branch-protection.json` — enligt 06 §5.

`.github/repo-settings.json` — enligt 06 §5.

**Applicera:**

```bash
# Labels
gh label sync -f .github/labels.json

# Branch protection (admin-token krävs)
gh api -X PUT repos/:owner/:repo/branches/main/protection \
  --input .github/branch-protection.json

# Repo settings
gh api -X PATCH repos/:owner/:repo \
  --input .github/repo-settings.json
```

**OBS — beroende:** Rulesetet refererar `Claude Code Review / claude-review` som required check. Eftersom `claude-code-review.yml` redan finns i repot är checken tillgänglig — men *verifiera först att den kör grönt på alla PR-typer* (se Steg 3 substeg 3.2) innan du sätter den som required. Annars blockeras dependabot-PR:erna. Två-fas-applicering via `./scripts/apply-policy.sh --phase=initial` (utan claude-code-review-check) → verifiera → `--phase=final` (med).

**Branch:** `chore/repo-config-files`.

**PR-titel:** `chore: add labels, branch-protection, and repo-settings as committed config`

**Verifiering:** Filer landade. `gh label list` visar nya labels efter `gh label sync`.

**Klart när:** PR mergad + labels synkade + initial branch protection applicerad.

---

## Steg 3 — Aktivera review-grinden (Loop 4)

**Mål:** Säkerställ att `claude-code-review.yml` (befintlig, byggd på `anthropics/claude-code-action@v1`) fungerar som blockerande grind på alla PR-typer, och uppdatera rulesetet att kräva dess status check.

**Förkrav:** `claude-code-review.yml` finns redan i repot. Steg 3 är *konfiguration + verifiering*, inte ny implementation.

**Substeg 3.1 — Sätt dependabot-scope för Anthropic-secret**

Den vanligaste startup_failure-orsaken på dependabot-triggade workflows är att secrets från Actions-scope inte är tillgängliga. Fix:

```bash
gh secret set ANTHROPIC_API_KEY --app dependabot
# klistra in samma värde som Actions-scopets ANTHROPIC_API_KEY
```

Verifiera:

```bash
gh secret list --app dependabot
```

`ANTHROPIC_API_KEY` ska synas i listan.

**Substeg 3.2 — Verifiera att claude-code-review.yml kör på alla PR-typer**

Skapa testbranches och verifiera grön körning:

```bash
clear
# Test 1: operatörens egen branch
git checkout -b chore/test-review-trivial
echo "" >> README.md
git add README.md && git commit -m "chore: trivial whitespace"
git push -u origin chore/test-review-trivial
gh pr create --title "chore: trivial whitespace test" --body "Testar review-loopen"

# Test 2: vänta tills en dependabot-PR finns. Kolla att senaste run blev grön:
gh run list --workflow=claude-code-review.yml --limit 5
```

Båda testerna ska sluta med review postad och status check `Claude Code Review / claude-review` grön (eller röd om review-verdict är request_changes — då är det ändå "fungerar").

**Substeg 3.3 — Uppdatera ruleset till final-fas**

När verifiering ovan är grön, uppdatera rulesetet så `Claude Code Review / claude-review` blir required:

```bash
./scripts/apply-policy.sh --phase=final
```

Eller via UI: redigera `main-branch-protection`-rulesetet, lägg till `Claude Code Review / claude-review` med integration_id `15368` i required status checks. Spara.

**Verifiering:**

```bash
gh api "/repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/rulesets" \
  --jq '.[] | select(.name == "main-branch-protection") | .id' \
  | xargs -I {} gh api "/repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/rulesets/{}" \
  --jq '.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context'
```

Output ska lista exakt: `ci / build`, `commitlint / commitlint`, `Claude Code Review / claude-review`. Inga trailing spaces.

**Branch:** Inget eget branch-arbete krävs — steget är endast konfiguration via `gh`-kommandon och en eventuell ruleset-fil-uppdatering.

**Klart när:** Nästa PR (oavsett actor) blockeras från merge tills `Claude Code Review / claude-review` är grön. Verifierat manuellt på en testbranch.

---

## Steg 4 — Auto-merge för betrodda bots (Loop 1 + 2)

**Mål:** Stänga dependency- och release-looparna utan mänsklig touch.

**Fil att skapa:**

`.github/workflows/auto-merge-trusted.yml`:

```yaml
name: auto-merge-trusted

on:
  pull_request_target:
    types: [opened, synchronize, reopened, labeled]

permissions:
  contents: write
  pull-requests: write

jobs:
  dependabot:
    if: github.actor == 'dependabot[bot]'
    runs-on: ubuntu-latest
    steps:
      - uses: dependabot/fetch-metadata@v2
        id: meta
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}

      - name: Enable auto-merge (patch + minor + GHA)
        if: |
          steps.meta.outputs.update-type == 'version-update:semver-patch' ||
          steps.meta.outputs.update-type == 'version-update:semver-minor' ||
          steps.meta.outputs.package-ecosystem == 'github_actions'
        run: gh pr merge --auto --squash "${{ github.event.pull_request.html_url }}"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Label major for awareness
        if: steps.meta.outputs.update-type == 'version-update:semver-major'
        run: gh pr edit "${{ github.event.pull_request.html_url }}" --add-label "needs-judge"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  release-please:
    if: |
      github.actor == 'github-actions[bot]' &&
      startsWith(github.event.pull_request.head.ref, 'release-please--')
    runs-on: ubuntu-latest
    steps:
      - run: gh pr merge --auto --squash "${{ github.event.pull_request.html_url }}"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**OBS — `pull_request_target` är vald medvetet:** denna trigger ger workflowen tillgång till `GITHUB_TOKEN` även när PR:n är från en fork. Detta är säkert *här* eftersom workflowen inte kör kod från PR:n — den läser bara metadata och anropar `gh pr merge`. Använd aldrig `pull_request_target` i workflows som kör PR-kod.

**Branch:** `feat/auto-merge-trusted`.

**PR-titel:** `feat(ci): auto-merge dependabot patch/minor and release-please PRs`

**Verifiering:**
1. PR mergad.
2. Nästkommande dependabot patch-PR auto-mergas inom timmar.
3. Nästkommande release-please-PR auto-mergas när CI grön.
4. Den stuck release-PR:n (`release-please--branches--main`) auto-mergas — backloggen rensas.

**Klart när:** Verifierat att en faktisk dependabot- eller release-PR mergats utan manuell touch.

---

## Steg 5 — Branch-hygien (Loop 5)

**Mål:** Inga kvarliggande branches.

**Repo-inställning:** Settings → General → "Automatically delete head branches" PÅ. (Eller via `gh api -X PATCH repos/:owner/:repo -f delete_branch_on_merge=true`.)

**Fil att skapa:**

`.github/workflows/branch-cleanup.yml`:

```yaml
name: branch-cleanup

on:
  schedule:
    - cron: '0 2 * * 0'  # söndag 02:00 UTC
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: read

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - name: Delete stale branches
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          # Hämta alla branches utom skyddade
          branches=$(gh api repos/${{ github.repository }}/branches --paginate \
            --jq '.[] | select(.name != "main" and (.name | startswith("release-please--") | not)) | .name')

          for branch in $branches; do
            # Senaste commit-datum
            last_commit=$(gh api repos/${{ github.repository }}/branches/$branch \
              --jq '.commit.commit.committer.date')
            age_days=$(( ($(date +%s) - $(date -d "$last_commit" +%s)) / 86400 ))

            # Öppen PR?
            open_pr=$(gh pr list --head "$branch" --state open --json number --jq 'length')

            # Keep-label?
            has_keep=$(gh pr list --head "$branch" --json labels --jq '.[].labels[].name' | grep -c '^keep$' || true)

            if [ "$age_days" -gt 30 ] && [ "$open_pr" = "0" ] && [ "$has_keep" = "0" ]; then
              echo "Deleting $branch (age: $age_days days)"
              gh api -X DELETE "repos/${{ github.repository }}/git/refs/heads/$branch" || true
            fi
          done
```

**Engångsstädning:** Innan workflowen schemalägger sin första körning, kör manuellt en gång via `workflow_dispatch` så befintliga skräpbranches (`claude/new-session-VkB13` etc.) försvinner.

**Branch:** `chore/branch-hygiene`.

**PR-titel:** `chore(ci): add branch-cleanup workflow + enable auto-delete on merge`

**Verifiering:** Manuell workflow_dispatch rensar befintliga skräpbranches. Auto-delete verifieras vid nästa merge.

**Klart när:** Branch-listan i repot innehåller bara `main`, eventuella aktiva PR-branches, och `release-please--*`.

---

## Steg 6 — Cron-publish-härdning (Loop 3)

**Mål:** Cron som självläker och pausar sig själv.

**Filer att skapa/ändra:**

`data/cron-state.json` (initial):
```json
{
  "consecutive_failures": 0,
  "last_success": null,
  "paused": false
}
```

`scripts/cron-state.ts` — ny modul som läser/skriver state-filen, hanterar inkrement, paus-flag, success-reset.

`scripts/generate-post.ts` — uppdatera:
1. Inbyggd retry för Anthropic API och GitHub API (3 försök, exponentiell backoff 2s → 5s → 15s). Bara för transienta fel (rate-limit, 5xx). Permanenta fel (auth, 4xx utöver rate-limit) ska inte retrias.
2. Vid success: anropa `cron-state.markSuccess()`.
3. Vid permanent fail: anropa `cron-state.markFailure()` → exit non-zero.

`.github/workflows/publish.yml` — uppdatera:

```yaml
# Lägg till EFTER checkout, INNAN generate:
- name: Check pause state
  id: state
  run: |
    paused=$(jq -r '.paused' data/cron-state.json)
    if [ "$paused" = "true" ]; then
      echo "Cron is paused. Reset data/cron-state.json to resume." >> $GITHUB_STEP_SUMMARY
      echo "paused=true" >> $GITHUB_OUTPUT
      exit 0
    fi
    echo "paused=false" >> $GITHUB_OUTPUT

# Lägg till EFTER generate-steget (skippa om paused):
- name: Update state on success
  if: success() && steps.state.outputs.paused == 'false'
  run: |
    # markSuccess körs redan i scriptet; commit i nästa steg fångar det
    echo "Marked success"

- name: Update state on failure
  if: failure() && steps.state.outputs.paused == 'false'
  run: |
    node scripts/cron-state-cli.mjs mark-failure
    # Om consecutive_failures >= 3: skapa kritiskt issue
    failures=$(jq -r '.consecutive_failures' data/cron-state.json)
    if [ "$failures" -ge 3 ]; then
      gh issue create \
        --title "🚨 cron-publish pausad efter 3 fel i rad" \
        --body "Workflow-run: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}" \
        --label "cron-paused,priority:critical,automation-failure"
    fi
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

# Commit-steget måste committa cron-state.json också:
- name: Commit and push
  if: ${{ inputs.dry_run != 'true' && (success() || failure()) }}
  run: |
    git add src/content/blog/ data/posted.json data/cron-state.json
    if git diff --staged --quiet; then exit 0; fi
    # ... resten oförändrat
```

`.github/workflows/cron-watchdog.yml` — separat workflow som triggar på `workflow_run` completion av publish:

```yaml
name: cron-watchdog

on:
  workflow_run:
    workflows: [publish]
    types: [completed]

permissions:
  contents: read
  issues: write

jobs:
  watch:
    if: github.event.workflow_run.conclusion == 'failure'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - name: Check failure count
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          failures=$(jq -r '.consecutive_failures' data/cron-state.json)
          if [ "$failures" = "2" ]; then
            gh issue create \
              --title "⚠️ cron-publish 2 fel i rad" \
              --body "Workflow-run: ${{ github.event.workflow_run.html_url }}" \
              --label "cron-degraded,automation-failure"
          fi
```

**Branch:** `feat/cron-resilience`.

**PR-titel:** `feat(publish): add retry, state-file, and self-pausing watchdog`

**Verifiering:** Tre tester via `workflow_dispatch`:
1. Lyckad körning → `cron-state.json` uppdaterad med `last_success`.
2. Tvinga ett fel (t.ex. via fel API-nyckel temporärt) → `consecutive_failures` ökar, ingen paus.
3. Tre fel i rad → `paused: true`, kritiskt issue skapat, nästkommande cron skippar tidigt.

**Klart när:** Tre testkörningar gröna enligt ovan + manuell reset av `data/cron-state.json` återställer driften.

---

## Steg 7 — Drift-detektor + stale (Loop 6 + 7)

**Mål:** Förebyggande loopar.

**Filer att skapa:**

`.github/workflows/drift-check.yml`:

```yaml
name: drift-check

on:
  schedule:
    - cron: '0 6 * * 1'  # måndag 06:00 UTC, två timmar före dependabot
  workflow_dispatch:

permissions:
  contents: read
  issues: write

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      # 1. Intern drift: .nvmrc vs package.json#engines
      - name: Check internal version drift
        run: |
          nvmrc=$(cat .nvmrc | tr -d 'v\n')
          engines=$(jq -r '.engines.node' package.json | grep -oE '[0-9]+' | head -1)
          if [ "$nvmrc" != "$engines" ]; then
            echo "drift_internal=true" >> $GITHUB_ENV
            echo "Internal drift: .nvmrc=$nvmrc, engines=$engines" >> $GITHUB_STEP_SUMMARY
          fi

      # 2. Extern drift: bygger på LTS?
      - uses: actions/setup-node@v6
        with:
          node-version: lts/*
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Build on LTS
        id: lts_build
        continue-on-error: true
        run: pnpm build

      - name: Detect external drift
        if: steps.lts_build.outcome == 'failure'
        run: echo "drift_external=true" >> $GITHUB_ENV

      # 3. Behind-by-major check
      - name: Check outdated
        run: |
          outdated=$(pnpm outdated --recursive --format json 2>/dev/null || echo '{}')
          # Förenkla: räkna majors-behind > 1
          echo "$outdated" > /tmp/outdated.json

      # 4. Skapa issue vid drift
      - name: Open drift issue
        if: env.drift_internal == 'true' || env.drift_external == 'true'
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh issue create \
            --title "drift: $(date +%Y-%m-%d) version-/build-drift detekterad" \
            --body "Se workflow-run: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}" \
            --label "drift,automation-failure"
```

`.github/workflows/stale.yml`:

```yaml
name: stale

on:
  schedule:
    - cron: '0 4 * * *'  # dagligen
  workflow_dispatch:

permissions:
  pull-requests: write
  issues: write

jobs:
  stale:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/stale@v9
        with:
          days-before-stale: 7
          days-before-close: 14
          stale-pr-label: stale
          stale-pr-message: |
            Denna PR har inte uppdaterats på 7 dagar.
            Den stängs om 7 dagar om ingen aktivitet sker.
            Lägg label `keep` för att förhindra.
          close-pr-message: Stängd p.g.a. inaktivitet. Återöppna om relevant.
          exempt-pr-labels: keep,wip,needs-judge,judge-blocked,security
          exempt-draft-pr: true
          operations-per-run: 100
          # Stale endast på PR; issues lämnas (har egna SLA enligt 05 §7)
          days-before-issue-stale: -1
          days-before-issue-close: -1
```

**Branch:** `feat/preventive-loops`.

**PR-titel:** `feat(ci): add drift-check and stale workflows`

**Verifiering:** Manuell workflow_dispatch på båda. Drift-check ska vara grön (ingen drift just nu eftersom Steg 1 fixade det). Stale ska producera workflow-summary utan att stänga något.

**Klart när:** PR mergad.

---

## Steg 8 — Eskaleringskedja (Loop escalate)

**Mål:** Förbered Telegram-kanalen, no-op tills aktiverad.

**Fil att skapa:**

`.github/workflows/escalate.yml`:

```yaml
name: escalate

on:
  issues:
    types: [opened, labeled]

permissions:
  issues: read

jobs:
  telegram:
    if: |
      contains(github.event.issue.labels.*.name, 'priority:critical') &&
      vars.ALFRED_TG_CHAT_ID != ''
    runs-on: ubuntu-latest
    steps:
      - name: Notify Telegram
        if: ${{ secrets.ALFRED_TG_TOKEN != '' }}
        run: |
          curl -sf -X POST \
            "https://api.telegram.org/bot${{ secrets.ALFRED_TG_TOKEN }}/sendMessage" \
            -d "chat_id=${{ vars.ALFRED_TG_CHAT_ID }}" \
            -d "text=🚨 aitoblog: ${{ github.event.issue.title }}%0A${{ github.event.issue.html_url }}"

      - name: Note skipped (no secret)
        if: ${{ secrets.ALFRED_TG_TOKEN == '' }}
        run: echo "Telegram skipped — ALFRED_TG_TOKEN not set. This is expected until Alfred is wired up." >> $GITHUB_STEP_SUMMARY
```

**SECURITY.md** — passa på att lägga till nu (var en kvarvarande Fas 3-bit):

```markdown
# Security policy

## Rapportera sårbarheter

Rapportera privat via [GitHub Security Advisory](https://github.com/alfred-intelligence/aitoblog/security/advisories/new).
Använd inte publika issues för sårbarheter.

## Stödda versioner

Endast senaste minor-versionen får säkerhetsfixar.

## Tidsförväntningar

- Bekräftelse: inom 1 vecka.
- Fixåtaganden: bestäms per fall.

## Scope

Säkerhetsproblem i:
- AI-pipelinen (`scripts/`)
- Workflows (`.github/workflows/`)
- Genererat innehåll på sajten

Faller inte under scope: kvaliteten i AI-genererat innehåll.
```

**Branch:** `feat/escalation-and-security`.

**PR-titel:** `feat(ci): add escalation workflow with telegram preparation + SECURITY.md`

**Verifiering:** Manuellt skapat issue med `priority:critical`-label → workflow kör och loggar "Telegram skipped" i step-summary (secret saknas, det är förväntat).

**Klart när:** PR mergad. Telegram-kanalen är förberedd, no-op tills `ALFRED_TG_TOKEN` läggs in.

---

## Verifiering av hela fas 4

När alla 8 steg är mergade:

1. **Backlog rensad:**
   - `git branch -a` visar bara `main` + ev. aktiva PR-branches.
   - Ingen öppen release-please-PR äldre än senaste push.
   - Ingen dependabot-PR äldre än några timmar (auto-merge har stängt).

2. **Branch protection enforced:**
   - Försök push direkt till `main` → blockerad.
   - Öppna trivial PR → review-grinden granskar, ci kör, auto-merge sker.

3. **Cron resilient:**
   - `data/cron-state.json` finns och uppdateras vid varje körning.

4. **Preventiva loopar aktiva:**
   - `gh workflow list` visar drift-check, stale, branch-cleanup.

5. **Eskalering förberedd:**
   - Manuellt issue med `priority:critical` triggar `escalate.yml` som loggar "skipped" graceful.

**Fas 4 är klar när:** Alla 5 verifieringar gröna.

> ✅ **Milstolpe M13 nådd** — projektet är i unattended-tillstånd. Övergång till Fas 5.

---

## Filer som ska existera vid avslutad Fas 4

```
.github/
├── rulesets/
│   ├── 01-main-branch.json           # Ny
│   └── 02-release-tags.json          # Ny
├── repo-settings.json                # Ny
├── labels.json                       # Ny
├── dependabot.yml                    # Befintlig
├── ISSUE_TEMPLATE/                   # Befintlig
├── PULL_REQUEST_TEMPLATE.md          # Befintlig
└── workflows/
    ├── ci.yml                        # Refaktorerad (SSoT)
    ├── commitlint.yml                # Refaktorerad (SSoT)
    ├── publish.yml                   # Refaktorerad (state, retry)
    ├── release-please.yml            # Befintlig
    ├── claude-code-review.yml        # Befintlig — Loop 4 (review-grind)
    ├── auto-merge-trusted.yml        # Ny
    ├── branch-cleanup.yml            # Ny
    ├── cron-watchdog.yml             # Ny
    ├── drift-check.yml               # Ny
    ├── stale.yml                     # Ny
    └── escalate.yml                  # Ny

scripts/
├── apply-policy.sh                   # Ny — applicerar rulesets/labels/repo-settings
└── cron-state.ts                     # Ny
scripts/cron-state-cli.mjs            # Ny (CLI wrapper)

.nvmrc                                # Ny
data/cron-state.json                  # Ny
SECURITY.md                           # Ny (Fas 3-rest)
IMPORT.md                             # Ny — template-konsument-onboarding
```

Plus `docs/design/00-07.md` om designen committas till repot (rekommenderat enligt diskussion).

---

## Kritisk väg

```
Steg 1 (SSoT) → Steg 2 (labels+config-filer) → Steg 3 (review-grind aktiverad)
   → Steg 4 (auto-merge) → Steg 5 (branch-hygien)
   → Steg 6 (cron-härdning) → Steg 7 (drift+stale) → Steg 8 (escalate)
```

Steg 7 kan parallelliseras med Steg 8 (oberoende). Övriga är sekventiella eftersom varje steg landar med stängd grind.
