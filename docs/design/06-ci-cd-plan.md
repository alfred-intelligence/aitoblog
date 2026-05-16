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

Trustmatrisen styr vem som får merga till `main` utan judge-granskning. Den är den enda regel som skiljer "auto-merge" från "kräver review" — inga andra trösklar krävs.

| Aktör | Scope | Auto-merge utan judge? |
|-------|-------|------------------------|
| `dependabot[bot]` | npm patch + minor | **Ja** |
| `dependabot[bot]` | npm major | Nej — går genom judge |
| `dependabot[bot]` | github-actions | **Ja** (alla typer) |
| `github-actions[bot]` på branch `release-please--*` | Release-PR (version + CHANGELOG) | **Ja** |
| `github-actions[bot]` övrigt | — | Nej (ska inte uppstå) |
| Människa eller `claude/*`-branch | All annan kod | Nej — kräver judge |

**Motivering:**

- Dependabot patch/minor är mekanisk; CI fångar regressioner. Risk × frekvens × tid att åtgärda > värdet av att läsa varje sådan PR.
- Dependabot major kan kräva kod-ändringar. Judge granskar och kan godkänna mekaniska bumpar med oförändrad API men flagga riktiga breaking changes.
- GitHub Actions-bumpar är alltid mekaniska (action-versioner är pin:ade per SHA i värsta fall).
- Release-please skapar deterministisk diff (version + CHANGELOG från Conventional Commits). Det finns ingenting i den PR:n som behöver judge.
- Allt annat (inklusive operatörens egna PR:er) går genom judge eftersom *implementer ≠ reviewer* är en hård invariant.

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
- Astros version bumpas av Dependabot; major-bumpar går genom judge som verifierar `engines`-kompatibilitet.

**Konsekvens för befintlig kod:** `ci.yml`, `publish.yml`, `commitlint.yml`, `release-please.yml`, `judge.yml` (ny) ska alla refaktoreras till `node-version-file: .nvmrc`. En commit. Sedan finns "Node 20 vs 22"-klassen av fel inte längre.

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

**Eskalering:** Om CI röd på dependabot-PR i >24h: stale-loopen (4.7) hanterar. Om same PR re-öppnas av dependabot efter rebase med samma röda CI tre gånger i rad: judge-loopen kan flaggas för att granska om dependency-grupperingen är fel.

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

### 4.4 Loop 4 — PR-judge

**Syfte:** Separera implementer från reviewer. Säkerställa att kod som rör inte-mekaniska delar av repot granskas av en annan identitet än den som skrev den.

**Trigger:** `pull_request: [opened, synchronize, reopened]`.

**Filter (skippa när):**
- `github.actor == 'dependabot[bot]'` (loop 1 hanterar).
- `github.actor == 'github-actions[bot]'` (release-please).
- Branch matchar `release-please--*`.

**Mekanism:**

1. Checkout med `fetch-depth: 0` (för att kunna diffa mot base).
2. Compute diff: `git diff origin/main...HEAD --unified=3`. Trunkera till ~50 000 tokens om större.
3. Anrop till Anthropic API (`claude-sonnet-4-6` eller senare stable — versions-pin:as i workflow via env var).
4. Prompt-template (egen fil `.github/judge-prompt.md` så den iterereras utan workflow-ändring).
5. Parsa strukturerad JSON-respons:
   ```json
   {
     "verdict": "approve" | "request_changes" | "comment",
     "summary": "...",
     "concerns": ["..."],
     "suggestions": ["..."]
   }
   ```
6. Posta review via `gh pr review`:
   - `approve` → `gh pr review --approve --body "$(summary)"`
   - `request_changes` → `gh pr review --request-changes --body "$(summary + concerns)"`
   - `comment` → `gh pr review --comment --body "$(summary + concerns)"` (osäker, vill ha mänsklig blick)
7. Sätt status check `judge` enligt verdict (success / failure / neutral).

**Säkerhet:**

- Triggern är `pull_request`, **inte** `pull_request_target` — fork-PR:er får inte secrets.
- `permissions: { contents: read, pull-requests: write, issues: write }`.
- `concurrency: { group: judge-${{ github.event.pull_request.number }}, cancel-in-progress: true }` — bara senaste pushen granskas.
- Modellnamn pin:as i workflow för reproducerbarhet; bumpas via egen PR.

**Grind:** Judge måste passa (status check) + CI grön. Branch protection enforced.

**Stängning:** Verdict `approve` → status check grön → om actor är trusted för auto-merge: merge. Annars väntar på `gh pr merge` från operatör eller Claude Code.

**Eskalering:**

- Två `request_changes` i rad utan att PR-titel ändrats → workflowen kommenterar `@operatör manuell granskning rekommenderas` och sätter label `judge-blocked`.
- `judge`-workflowen själv fail (Anthropic API down etc.): status = neutral (inte failure), kommentar postas, en retry inom workflow:n är OK men ingen blockering. Branch protection ska tillåta `judge`-checken vara `success` ELLER `neutral` (inte kräva success — annars blir judge-utfall en hård SPOF).

**Filer:** `.github/workflows/judge.yml` (ny), `.github/judge-prompt.md` (ny, iterereras separat).

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

**Branch protection på `main`** (sätts via `gh api` eller manuellt — bör committas som `.github/branch-protection.json` så det är dokumenterat):

```json
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      { "context": "ci" },
      { "context": "commitlint" },
      { "context": "judge" }
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": true
}
```

**Notera:**
- `required_pull_request_reviews: null` — vi använder *inte* GitHubs review-system som grind. Judge-checken är grinden. Detta är medvetet: GitHub kräver att review kommer från en användare med skrivåtkomst, vilket är operatören själv, vilket gör review självgranskning. Judge som status check istället låter `github-actions[bot]` vara den blockerande granskaren.
- `enforce_admins: false` — operatören kan i nödfall force-merga, vilket är rätt eskaleringsväg när alla loopar gått sönder.
- `required_linear_history: true` — squash-only, ger ren tagghistorik och enkel CHANGELOG.

**Repo-inställningar** (Settings → General):

- Default merge method: Squash
- Default commit message: PR title
- Allow auto-merge: PÅ
- Automatically delete head branches: PÅ
- Allow force-pushing: AV
- Allow deletions: AV (för main)

**Secrets & variables:**

| Namn | Typ | Scope | Syfte |
|------|-----|-------|-------|
| `ANTHROPIC_API_KEY` | Secret | Actions | Publish + judge |
| `ALFRED_TG_TOKEN` | Secret | Actions | Telegram-eskalering (optional) |
| `ALFRED_TG_CHAT_ID` | Variable | Actions | Telegram-eskalering (optional) |
| `SOURCES_URL` | Variable | Actions | Publish-källor |

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
  - `judge-blocked` (judge avslår 2x)
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
- Branch protection-config (`.github/branch-protection.json`) som dokumentation, måste appliceras manuellt en gång efter klon (eller via `gh` script i `IMPORT.md`).
- Repo-inställnings-config (`.github/repo-settings.json`).
- Trustmatris och denna plan som dokumentation.

**Bryts av template-klon:**
- `data/cron-state.json` — initieras tomt.
- `data/posted.json` — initieras tomt.
- Secrets — måste sättas på nytt i det nya repot.

**IMPORT.md** (en del av bootstrap, inte denna plan) listar de `gh`-kommandon som måste köras efter klon för att applicera branch protection och repo settings. Allt annat är passivt klar.

---

## 9. Bilaga: filöversikt under `.github/`

Slutligt målmaterial när alla loopar är implementerade.

```
.github/
├── branch-protection.json        # SSoT för branch-protection-config
├── dependabot.yml                # Befintlig
├── ISSUE_TEMPLATE/
│   ├── bug_report.md             # Befintlig
│   ├── config.yml                # Befintlig
│   ├── feature_request.md        # Befintlig
│   └── automation-failure.md     # Ny — mall för loop-eskaleringsissues
├── PULL_REQUEST_TEMPLATE.md      # Befintlig
├── judge-prompt.md               # Ny — judge-promptens text, itereras separat
├── labels.json                   # Ny — labels: stale, keep, wip, needs-judge,
│                                 #       judge-blocked, drift, cron-degraded,
│                                 #       cron-paused, release-blocked,
│                                 #       automation-failure, priority:critical
├── repo-settings.json            # Ny — SSoT för repo-inställningar
└── workflows/
    ├── ci.yml                    # Befintlig, refaktoreras till .nvmrc
    ├── commitlint.yml            # Befintlig, refaktoreras till .nvmrc
    ├── release-please.yml        # Befintlig
    ├── publish.yml               # Befintlig, refaktoreras (state-fil, retry, paus)
    ├── auto-merge-trusted.yml    # Ny — loop 1 & 2
    ├── judge.yml                 # Ny — loop 4
    ├── cron-watchdog.yml         # Ny — loop 3 eskalering
    ├── branch-cleanup.yml        # Ny — loop 5
    ├── drift-check.yml           # Ny — loop 6
    ├── stale.yml                 # Ny — loop 7
    └── escalate.yml              # Ny — Telegram för priority:critical
```

Totalt: 7 nya workflows. 3 nya konfig-filer. 1 ny issue-template. 2 refaktorerade existerande workflows. 2 nya data-filer.

---

## 10. Implementeringsordning

Looparna är inte oberoende. Ordningen är optimerad så varje loop landar med en stängd grind under sig:

1. **Steg 0 — SSoT.** `.nvmrc` + `engines` + refaktorera ci.yml/commitlint.yml/publish.yml/release-please.yml till `node-version-file`. Stänger Node-driften.
2. **Steg 1 — labels.json + branch-protection.json applicerade.** Förutsättning för alla checks.
3. **Steg 2 — Loop 4 (judge).** Måste finnas före auto-merge eftersom auto-merge förlitar sig på att judge-checken finns på PR:er som inte är trusted.
4. **Steg 3 — Loop 1 + 2 (auto-merge-trusted).** Stänger dependency- och release-looparna direkt — alla kvarliggande PR:er rensas.
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
