# aitoblog — CI/CD-plan

> Detta dokument beskriver den autonoma kontrollarkitekturen för `aitoblog`. Det är driverdokumentet för operationaliseringen (fas B) och styr revideringar av 02–05 + 07.

---

## 1. Designprincip

CI/CD i ett solo-underhållet projekt utan kontinuerlig mänsklig närvaro är inte en uppsättning workflows som "körs vid behov". Det är en uppsättning *kontrollslingor* som autonomt:

1. **Stänger sig själva** vid normal drift (PR mergas, release skärs, inlägg publiceras).
2. **Eskalerar** när de inte kan stänga sig — en gång, tydligt, till en kanal operatören läser.
3. **Pausar sig själva** när eskaleringsgränsen passerats istället för att fortsätta misslyckas tyst.

Varje workflow i `.github/workflows/` är implementeringen av en sådan slinga. Alla återkommande fel som hittills uppstått (Node-version-mismatch, fastnad release-PR, kvarliggande dependabot-branches) är manifestationer av *avsaknad* av slinga. När looparna nedan är på plats är dessa fel inte möjliga att reproducera.

---

## 2. Trustmatris

Trustmatrisen styr **vem som får auto-merga** när alla required checks är gröna. Den styr *inte* vem som granskas — claude-code-action (Loop 4 §4.4) kör som blockerande grind på *alla* PR:er utan filter, inklusive dependabot och release-please. Det är medvetet: filtreringen jag tidigare designade in skapade den klass av problem som denna revidering retar bort.

| Aktör | Scope | Auto-merge när checks gröna? |
|-------|-------|------------------------------|
| `dependabot[bot]` | npm patch + minor | **Ja** |
| `dependabot[bot]` | npm major | **Ja** (review fångar breaking changes som röd check) |
| `dependabot[bot]` | github-actions | **Ja** |
| `github-actions[bot]` på branch `release-please--*` | Release-PR | **Ja** |
| `github-actions[bot]` övrigt | — | Nej (ska inte uppstå) |
| Människa eller `claude/*`-branch | All annan kod | Nej — manuell merge (eller `gh pr merge --auto`) |

**Motivering:**

- Dependabot patch/minor är mekaniska; review är snabb och billig.
- Dependabot major fångas av claude-code-action på samma sätt som av en human reviewer — om diffen visar breaking API-ändring blir checken röd. Ingen separat path-genom-judge krävs.
- Release-please skapar deterministisk diff men granskas ändå — det är näst intill gratis och håller invarianten ren ("review körs alltid").
- Allt annat går genom samma grind. Operatörens egna PR:er och `claude/*`-branches är inte privilegierade.

Att ta bort filtret är vad som skiljer denna iteration från den första — det löser dependabot-secret-scope-problemet i samma sköld.

---

## 3. Single Source of Truth för tooling

Versionsdrift mellan filer är en återkommande felklass. SSoT eliminerar den.

| Verktyg | SSoT-fil | Mirror | Workflow-läsning |
|---------|----------|--------|------------------|
| Node | `.nvmrc` | `package.json#engines.node` | `setup-node` med `node-version-file: .nvmrc` |
| pnpm | `package.json#packageManager` | — | `pnpm/action-setup` läser automatiskt |
| Astro | `package.json#dependencies.astro` | — | — (CI bygger med det som finns) |

**Regler:**

- Workflows **får inte** ha hårdkodade versionsnummer (`node-version: 20`). De ska läsa från SSoT-filen.
- `engines.node` och `.nvmrc` kontrolleras av drift-loopen (§4.6) varje vecka — om de glider isär eller från Astros peer-deps öppnas issue.
- Astros version bumpas av Dependabot; major-bumpar går genom review som verifierar `engines`-kompatibilitet.

**Konsekvens för befintlig kod:** `ci.yml`, `publish.yml`, `commitlint.yml`, `release-please.yml` ska alla refaktoreras till `node-version-file: .nvmrc`. En commit. Sedan finns "Node 20 vs 22"-klassen av fel inte längre. (`claude-code-review.yml` använder `actions/checkout@v4` direkt utan setup-node och berörs inte.)

---

## 4. Looparna

Varje loop dokumenteras med samma fält: **Syfte → Trigger → Mekanism → Grind → Stängning → Eskalering → Filer**.

### 4.1 Loop 1 — Dependency-update

**Syfte:** Håll beroenden uppdaterade utan manuell granskning av varje patch.

**Trigger:** Dependabot öppnar PR (måndag, veckovis, grupperad enligt befintlig `.github/dependabot.yml`).

**Mekanism:** Workflow `auto-merge-trusted.yml` triggar på `pull_request` (opened, synchronize, reopened). Filtrerar på `github.actor == 'dependabot[bot]'`, läser `dependabot-metadata`-actionens output för uppdateringstyp (patch/minor/major).

```yaml
# Skiss
- uses: dependabot/fetch-metadata@v2
  id: meta
- if: steps.meta.outputs.update-type == 'version-update:semver-patch' ||
      steps.meta.outputs.update-type == 'version-update:semver-minor' ||
      steps.meta.outputs.package-ecosystem == 'github_actions'
  run: gh pr merge --auto --squash "$PR_URL"
- if: steps.meta.outputs.update-type == 'version-update:semver-major'
  run: gh pr edit "$PR_URL" --add-label "needs-judge"
```

**Grind:** Branch protection kräver `ci` grön → squash-merge sker när CI klar. Auto-merge är aktiverat på PR-nivå, GitHub väntar på checks själv.

**Stängning:** PR mergad → branch raderad (auto-delete head branches på).

**Eskalering:** Om CI röd på dependabot-PR i >24h: stale-loopen (4.7) hanterar. Om same PR re-öppnas av dependabot efter rebase med samma röda CI tre gånger i rad: review-loopen kan flaggas för att granska om dependency-grupperingen är fel.

**Filer:** `.github/workflows/auto-merge-trusted.yml`, `.github/dependabot.yml` (befintlig).

---

### 4.2 Loop 2 — Release-cut

**Syfte:** Cut releaser deterministiskt baserat på Conventional Commits utan att en människa rör knappen.

**Trigger:** Push till `main` → `release-please.yml` (befintlig) öppnar/uppdaterar PR på branch `release-please--branches--main`.

**Mekanism:** Samma `auto-merge-trusted.yml` som loop 1 hanterar även denna. Filter: `github.event.pull_request.head.ref` matchar `release-please--*` och actor är `github-actions[bot]`. Auto-merge slås på, CI-grön släpper igenom.

**Grind:** CI grön. CHANGELOG och version är genererade deterministiskt — inget mer behöver granskas.

**Stängning:** PR mergad → release-please publicerar GitHub Release + tag (befintlig flöde).

**Eskalering:** Om CI röd på release-PR: kritiskt issue (release är blockerad → ingen ny version → ingen rollback-target). Failsafe: `release-blocked`-label triggar en hög-prio notifikation (issue + Telegram via Alfred om aktiverad).

**Filer:** `.github/workflows/release-please.yml` (befintlig), `.github/workflows/auto-merge-trusted.yml`.

---

### 4.3 Loop 3 — Cron-publish

**Syfte:** Producera ett blogginlägg på schema med självläkning vid transienta fel och kontrollerad paus vid persistenta.

**Trigger:** `schedule: cron '0 8 * * 1,3,5'` + `workflow_dispatch`.

**Mekanism:** Tre lager.

1. **Gate-steg** i början läser `data/cron-state.json`:
   ```json
   { "consecutive_failures": 0, "last_success": "2026-05-08T08:00:00Z", "paused": false }
   ```
   Om `paused == true` → workflowen exit:ar tidigt med klart meddelande. Operatören återställer manuellt eller via `workflow_dispatch` med `--reset`-flagga.

2. **Generate-steg** kör scriptet med inbyggd retry för API-fel (rate-limit, 5xx från Anthropic/GitHub) — max 3 försök, exponentiell backoff. Inte i workflow-lagret; *i scriptet* eftersom retry-logiken är specifik (vissa fel ska inte retrias).

3. **State-uppdatering** efter generate:
   - Success → `consecutive_failures = 0`, `last_success = now()`, commit `data/cron-state.json` tillsammans med inlägget.
   - Failure → `consecutive_failures += 1`. Om `>= 3`: `paused = true` + öppna kritiskt issue. Commit `data/cron-state.json` i ett separat steg (även om generate misslyckades).

**Grind:** `concurrency: { group: publish, cancel-in-progress: false }` (befintlig) — endast en publish kör i taget. Skydd mot race på `data/posted.json` och `data/cron-state.json`.

**Stängning:** Inlägg committat → Cloudflare bygger → RSS uppdateras. State-fil reflekterar success.

**Eskalering:** Tre nivåer.

- **1 fel:** Tyst — workflow-fel-mejl räcker. State-fil noterar.
- **2 fel i rad:** Workflow `cron-watchdog.yml` (separat, körs efter publish via `workflow_run`) öppnar issue med label `cron-degraded`, summerar de två run-URL:erna.
- **3 fel i rad:** `paused = true` committas. Kritiskt issue med label `cron-paused, priority:critical` + Telegram-notifikation via Alfred om secret `ALFRED_TG_TOKEN` finns. Cron slutar köra tills operatören återställer state-filen.

**Filer:** `.github/workflows/publish.yml` (befintlig, refaktor), `.github/workflows/cron-watchdog.yml` (ny), `scripts/cron-state.ts` (ny modul), `data/cron-state.json` (ny).

---

### 4.4 Loop 4 — PR-review

**Syfte:** Separera implementer från reviewer. Säkerställa att kod som rör inte-mekaniska delar av repot granskas av en annan identitet än den som skrev den.

**Mekanism:** [`anthropics/claude-code-action@v1`](https://github.com/anthropics/claude-code-action) — Anthropics officiella GitHub Action. Den postar PR-reviews under en separat Claude GitHub App-identitet (inte `github-actions[bot]`), vilket gör implementer ≠ reviewer-invarianten till en hård struktur, inte en konvention.

**Trigger:** `pull_request: [opened, synchronize, ready_for_review, reopened]`.

**Konfiguration:**

```yaml
name: Claude Code Review

on:
  pull_request:
    types: [opened, synchronize, ready_for_review, reopened]

jobs:
  claude-review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
      issues: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 1
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          plugin_marketplaces: 'https://github.com/anthropics/claude-code.git'
          plugins: 'code-review@claude-code-plugins'
          prompt: '/code-review:code-review ${{ github.repository }}/pull/${{ github.event.pull_request.number }}'
```

**Grind:** Status check `Claude Code Review / claude-review` är required i rulesetet (06 §5). PR mergas inte utan att checken är grön. Verdict från modellen reflekteras genom action:ens exit-code: approve → green check, request_changes → red check, comment → neutral.

**Filterfri.** Till skillnad från en custom workflow med write-permissions och egna secrets, kör claude-code-action utan startup-friction på dependabot- och release-please-PR:er. Den behöver `read`-permissions + en Anthropic-secret som dependabot-scope kan dela. Detta eliminerar hela klassen av "judge filtrerar bort dependabot men checken är required" som blockerade en tidigare iteration av denna loop.

**Stängning:** Verdict approve → grön check → PR mergas via Loop 1/2 (auto-merge-trusted) eller manuellt enligt trustmatris.

**Eskalering:**

- Mekanisk: röd check blockerar merge tills modellen approve:ar nästa push.
- Mönsterbaserad: separat liten workflow `review-escalation.yml` *kan* lyssna på `pull_request_review`-events och räkna `CHANGES_REQUESTED` per PR. Vid 2 i rad: lägg label `judge-blocked` och tagga operatören. **Implementeras först om mönstret faktiskt uppstår** — onödig komplexitet annars.
- Anthropic API/action själv fail: status check blir röd (eller skipped vid GitHub-sida-utfall). Behandlas som vilken CI-fel som helst: åtgärda eller manuellt mergea via admin-bypass (operatören har den).

**Filer:** `.github/workflows/claude-code-review.yml` (befintlig — bygger på Anthropics action). *Inte* en custom judge-workflow, inget tsx-script, ingen egen prompt-fil. Anthropics plugin `code-review@claude-code-plugins` driver review-logiken.

**Anpassning av prompt:** Om defaultpluginens granskning inte räcker, byt ut `plugins:`-fältet mot en explicit `prompt:`-sträng med projektets specifika regler. Det kan göras senare, behövs sannolikt inte initialt.

---

### 4.5 Loop 5 — Branch-hygien

**Syfte:** Inga kvarliggande branches efter merge eller övergivna PR:er.

**Trigger:** Två separata.

- **Auto-delete on merge:** Repo-inställning, inte workflow. Settings → "Automatically delete head branches" = på.
- **Orphan-städning:** `branch-cleanup.yml` schemalagd söndag 02:00 UTC.

**Mekanism (orphan-städning):**

1. Lista alla branches utom `main` och `release-please--*`.
2. För varje: hämta senaste commit-datum + öppen PR-status (`gh api`).
3. Radera om: (senaste commit > 30 dagar gammal) OCH (ingen öppen PR) OCH (ingen label `keep`).
4. Logga vad som raderades i workflow-summary.

**Grind:** Hårdkodad skyddslista i workflow (`main`, `release-please--*`). Plus label `keep` på associerad senast-öppna PR fungerar som veto.

**Stängning:** Workflow slutar. Inga issues skapas (passiv loop).

**Eskalering:** Inget — det här är en städloop, fel här är inte kritiska. Om workflowen själv fail: enkel issue via samma "failure"-mall som övriga loopar.

**Filer:** `.github/workflows/branch-cleanup.yml` (ny), repo-inställning "auto-delete head branches" PÅ.

---

### 4.6 Loop 6 — Drift-detektor

**Syfte:** Fånga drift mellan SSoT-filer, mellan SSoT och faktisk kompatibilitet, och mellan deklarerade vs faktiska build-villkor.

**Trigger:** `schedule: cron '0 6 * * 1'` (måndag 06:00 UTC, två timmar före dependabot för att inte krocka).

**Mekanism:** Workflow `drift-check.yml` kör tre kontroller:

1. **Intern drift:**
   - `.nvmrc`-värde måste matcha `package.json#engines.node` (samma major).
   - `package.json#packageManager` måste matcha installerad pnpm.

2. **Extern drift:**
   - Kör `pnpm install --frozen-lockfile` med Node = senaste LTS (`actions/setup-node@v6` med `node-version: lts/*`).
   - Kör `pnpm astro check` och `pnpm build`.
   - Om något steg fail på LTS men passar på pin:ad version: drift.

3. **Beroendegapsdrift:**
   - `pnpm outdated --recursive --format json` parsas.
   - Om paket med major behind > 1 (alltså vi ligger 2+ majors efter): drift.

**Grind:** Workflowen läser bara, ändrar inget. Resultatet posstas som issue om drift hittas.

**Stängning:** Inget drift → workflow grön, ingen åtgärd. Drift → issue öppnas med label `drift` och konkreta åtgärdsförslag (filerna som behöver synkas, kommandona som behöver köras).

**Eskalering:** Om samma drift-issue förblir öppen i >30 dagar: label `priority:high` läggs till av en separat liten workflow som triggar på `schedule`. Det är allt — drift är aldrig akut.

**Filer:** `.github/workflows/drift-check.yml` (ny).

---

### 4.7 Loop 7 — Stuck-PR-escalation

**Syfte:** PR:er som ingen rör ska stängas, inte hopa sig.

**Trigger:** `schedule: cron '0 4 * * *'` (dagligen 04:00 UTC).

**Mekanism:** `actions/stale@v9` med config:

```yaml
days-before-stale: 7
days-before-close: 14
stale-pr-label: stale
stale-pr-message: >
  Denna PR har inte uppdaterats på 7 dagar och markeras som stale.
  Den stängs om 7 dagar om ingen aktivitet sker. Lägg label `keep`
  för att förhindra.
close-pr-message: Stängd p.g.a. inaktivitet. Återöppna om relevant.
exempt-pr-labels: keep,wip,needs-judge,judge-blocked,security
exempt-draft-pr: true
operations-per-run: 100
```

PR:er från `release-please--*` filtreras bort via custom action eller via label `automated` som workflowen själv lägger på dem.

**Grind:** Labels `keep`, `wip`, `needs-judge`, `judge-blocked`, `security` skyddar. Draft-PR:er undantas.

**Stängning:** Stängd PR → branch-cleanup-loopen tar branchen senare.

**Eskalering:** Inget. Det här är passiv hygien.

**Filer:** `.github/workflows/stale.yml` (ny).

---

## 5. Branch protection & repo-inställningar

Sätts via Repository Rulesets (2026-ersättningen för legacy "branch protection rules"). Källfiler committas i `.github/rulesets/` så de versionshanteras.

**Rulesets:**

| Fil | Scope | Skyddar |
|-----|-------|---------|
| `.github/rulesets/01-main-branch.json` | `~DEFAULT_BRANCH` | PR-krav, required status checks, linear history, ingen radering eller force-push |
| `.github/rulesets/02-release-tags.json` | `refs/tags/v*` | Ingen radering eller force-push på release-tags |

**Required status checks på main:**

| Context | Integration | Rapporterar |
|---------|-------------|-------------|
| `ci / build` | GitHub Actions (15368) | Typecheck + build grön |
| `commitlint / commitlint` | GitHub Actions (15368) | PR-titel följer Conventional Commits |
| `Claude Code Review / claude-review` | GitHub Actions (15368) | claude-code-action har approved |

Context-strängen formatteras alltid `<workflow-name> / <job-name>`. GitHub matchar bytvis — trailing whitespace, fel case, eller fel skiljetecken gör att checken aldrig matchas och PR:n fastnar i "Expected — Waiting for status to be reported".

**PR-rule (i `01-main-branch.json`):**

```json
{
  "type": "pull_request",
  "parameters": {
    "required_approving_review_count": 0,
    "required_reviewers": [],
    "allowed_merge_methods": ["squash"]
  }
}
```

`required_approving_review_count: 0` är medvetet. GitHubs review-mekanism kräver att approval kommer från en användare med skrivåtkomst — vilket i ett solo-repo är operatören själv. Att kräva 1+ skulle tvinga self-approval, vilket bryter implementer ≠ reviewer-invarianten.

Istället är `Claude Code Review / claude-review`-checken grinden. Den postas av Claude GitHub App (separat identitet från operatören och från `github-actions[bot]`), vilket ger separation of duties som hård struktur — inte en konvention.

**Bypass-actors:**

```json
"bypass_actors": [
  { "actor_type": "OrganizationAdmin", "actor_id": null, "bypass_mode": "always" },
  { "actor_type": "RepositoryRole", "actor_id": 5, "bypass_mode": "always" }
]
```

Operatören har bypass via admin-rollen — nödutgång när hela automation-stacken går sönder samtidigt. Bots listas *inte* som bypass; de följer reglerna och får merga via auto-merge-workflowen + gröna checks.

**Repo-inställningar (`.github/repo-settings.json`):**

- Default merge method: Squash
- Default commit message: PR title
- Allow auto-merge: PÅ
- Automatically delete head branches: PÅ
- Allow force-pushing: AV
- Allow deletions: AV

**Secrets & variables:**

| Namn | Typ | Scope | Syfte |
|------|-----|-------|-------|
| `ANTHROPIC_API_KEY` | Secret | Actions | Publish (cron) |
| `ANTHROPIC_API_KEY` | Secret | Dependabot | Claude Code Review när workflow triggas av dependabot |
| `ALFRED_TG_TOKEN` | Secret | Actions | Telegram-eskalering (optional) |
| `ALFRED_TG_CHAT_ID` | Variable | Actions | Telegram-eskalering (optional) |
| `SOURCES_URL` | Variable | Actions | Publish-källor |

**Dependabot-scope för `ANTHROPIC_API_KEY` är kritiskt.** Dependabot-triggade workflows läser secrets från ett separat scope (`Settings → Secrets and variables → Dependabot`). Saknas det får workflowen `startup_failure` på dependabot-PR:er, vilket gör review-checken aldrig grön → PR:erna blockeras evigt. Sätt sec­ret på båda scopes (Actions + Dependabot) med samma värde:

```bash
gh secret set ANTHROPIC_API_KEY                  # Actions-scope
gh secret set ANTHROPIC_API_KEY --app dependabot # Dependabot-scope
```

Saknas `ALFRED_TG_TOKEN` → eskalerings-workflowen skippar Telegram-steget graceful, öppnar bara issue.


---

## 6. Eskaleringskanaler

Två kanaler, alltid båda när relevant, men Telegram är opportunistisk:

**GitHub-issues (alltid):**

- Label-schema:
  - `automation-failure` — generisk
  - `cron-degraded` (2 fel i rad)
  - `cron-paused` (3 fel → cron pausad)
  - `release-blocked` (release-PR CI röd)
  - `drift` (drift-detektor fynd)
  - `judge-blocked` (reviewer avslår 2x)
  - `priority:critical` läggs till på cron-paused och release-blocked

- Mall: kort beskrivning + link till workflow-run + sista loggraderna + suggested action.

**Telegram via Alfred (opportunistisk):**

Endast för `priority:critical`-issues. Workflow `escalate.yml` triggar på `issues.opened` med label-filter:

```yaml
- if: contains(github.event.issue.labels.*.name, 'priority:critical') &&
      secrets.ALFRED_TG_TOKEN != ''
  run: |
    curl -sf -X POST "https://api.telegram.org/bot${{ secrets.ALFRED_TG_TOKEN }}/sendMessage" \
      -d "chat_id=${{ vars.ALFRED_TG_CHAT_ID }}" \
      -d "text=🚨 aitoblog: ${{ github.event.issue.title }}%0A${{ github.event.issue.html_url }}"
```

Skippa-säkert om secret saknas.

**Filer:** `.github/workflows/escalate.yml` (ny).

---

## 7. Observability

Lågprofil, eftersom projektet är litet. Tre mekanismer räcker:

**a) Workflow-summaries.** Varje workflow skriver en kort sammanfattning till `$GITHUB_STEP_SUMMARY` så att Actions-fliken visar vad som hänt utan att klicka in i loggen. Standard för alla loopar.

**b) `data/cron-state.json`.** Är repo-committed observability — vem som helst som klonar repot kan se senaste lyckade publish och eventuell paus-state.

**c) Issues som status.** Öppna issues med labels `cron-degraded`, `drift`, `release-blocked` ger en visuell status. En enkel badge i README kan visa antal öppna `automation-failure`-issues via shields.io.

Ingen Prometheus, ingen Grafana. Skalan är fel.

---

## 8. Migration till privat template

När operatören migrerar till privat repo via "Use this template":

**Behålls i template:**
- Alla workflows (loop 1–7).
- Rulesets-källfiler (`.github/rulesets/*.json`), appliceras via `./scripts/apply-policy.sh` enligt `IMPORT.md`.
- Repo-inställnings-config (`.github/repo-settings.json`).
- Labels-fil (`.github/labels.json`).
- Trustmatris och denna plan som dokumentation.

**Bryts av template-klon:**
- `data/cron-state.json` — initieras tomt.
- `data/posted.json` — initieras tomt.
- Secrets — måste sättas på nytt i det nya repot (både Actions- och Dependabot-scope för `ANTHROPIC_API_KEY`).

**IMPORT.md** (en del av bootstrap, inte denna plan) listar de `gh`-kommandon som måste köras efter klon för att applicera rulesets, repo settings, labels, och sätta secrets på rätt scopes. Allt annat är passivt klart.

---

## 9. Bilaga: filöversikt under `.github/`

Slutligt målmaterial när alla loopar är implementerade.

```
.github/
├── dependabot.yml                # Befintlig
├── ISSUE_TEMPLATE/
│   ├── bug_report.md             # Befintlig
│   ├── config.yml                # Befintlig
│   ├── feature_request.md        # Befintlig
│   └── automation-failure.md     # Ny — mall för loop-eskaleringsissues
├── PULL_REQUEST_TEMPLATE.md      # Befintlig
├── labels.json                   # Ny — labels: stale, keep, wip, drift,
│                                 #       cron-degraded, cron-paused,
│                                 #       release-blocked, automation-failure,
│                                 #       judge-blocked, priority:critical, m.fl.
├── repo-settings.json            # Ny — repo-level settings (auto-delete, squash)
├── rulesets/
│   ├── 01-main-branch.json       # Ny — required checks, PR-rule, linear history
│   └── 02-release-tags.json      # Ny — skydd för v*-tags
└── workflows/
    ├── ci.yml                    # Befintlig, refaktoreras till .nvmrc
    ├── commitlint.yml            # Befintlig, refaktoreras till .nvmrc
    ├── release-please.yml        # Befintlig
    ├── publish.yml               # Befintlig, refaktoreras (state-fil, retry, paus)
    ├── claude-code-review.yml    # Befintlig — Loop 4 (review-grind)
    ├── auto-merge-trusted.yml    # Ny — loop 1 & 2
    ├── cron-watchdog.yml         # Ny — loop 3 eskalering
    ├── branch-cleanup.yml        # Ny — loop 5
    ├── drift-check.yml           # Ny — loop 6
    ├── stale.yml                 # Ny — loop 7
    └── escalate.yml              # Ny — Telegram för priority:critical
```

Totalt: 6 nya workflows. 2 ruleset-filer + 2 övriga konfig-filer. 1 ny issue-template. 2 refaktorerade existerande workflows. 2 nya data-filer. Inga egna review-skript — claude-code-action driver review-loopen.

---

## 10. Implementeringsordning

Looparna är inte oberoende. Ordningen är optimerad så varje loop landar med en stängd grind under sig:

1. **Steg 0 — SSoT.** `.nvmrc` + `engines` + refaktorera ci.yml/commitlint.yml/publish.yml/release-please.yml till `node-version-file`. Stänger Node-driften.
2. **Steg 1 — labels + repo-settings + rulesets (initial-fas).** Källfiler committas. Apply-skriptet kör i `--phase=initial` (utan claude-code-review som required check). Förutsättning för senare steg.
3. **Steg 2 — Loop 4 (claude-code-review).** Säkerställ att `claude-code-review.yml` kör grön på alla PR-typer (operatör, dependabot, release-please). Inkluderar verifiering att `ANTHROPIC_API_KEY` är satt på *både* Actions- och Dependabot-scope. När verifierat → uppdatera ruleset med `--phase=final` så `Claude Code Review / claude-review` blir required.
4. **Steg 3 — Loop 1 + 2 (auto-merge-trusted).** Stänger dependency- och release-looparna direkt — backlog rensas automatiskt.
5. **Steg 4 — Loop 5 (branch-cleanup) + auto-delete on merge.** Rensar skräpbranches.
6. **Steg 5 — Loop 3 (cron-watchdog + state).** Hardenar publish.
7. **Steg 6 — Loop 6 (drift) + Loop 7 (stale).** Lågfrekventa, kan komma sist.
8. **Steg 7 — escalate.yml + Telegram.** Sista lagret. Allt fungerar utan men blir bättre med.

Efter steg 4 är repot i ett tillstånd där operatören kan vara borta i veckor utan att backloggen växer. Det är minimum-viable för unattended. Steg 5–7 är polish.

---

## 11. Vad denna plan inte gör

- **Inte testautomation.** `pnpm astro check` + `pnpm build` är hela testningen. Att lägga till enhetstester för `scripts/`-mappen är värdefullt men utanför CI/CD-plan-scope.
- **Inte performance-monitoring.** Cloudflare Pages-deploy-tid spåras inte. Inte kritiskt.
- **Inte cost-monitoring.** Anthropic API-kostnaden spåras inte automatiskt — föreslår manuell granskning i Anthropic-konsolen månadsvis tills/om problem dyker upp.
- **Inte content quality monitoring.** Det är ett separat problem (innehållskvalitet i AI-genererade inlägg) som ligger utanför CI/CD och egentligen utanför detta projekts scope helt.
