# aitoblog — CI/CD-plan

> Detta dokument beskriver den autonoma kontrollarkitekturen för `aitoblog`. Det är driverdokumentet för operationaliseringen (fas B) och styr revideringar av 02–05 + 07.

---

## 1. Designprincip

CI/CD i ett solo-underhållet projekt utan kontinuerlig mänsklig närvaro är inte en uppsättning workflows som "körs vid behov". Det är en uppsättning *kontrollslingor* som autonomt:

1. **Stänger sig själva** vid normal drift (PR mergas, release skärs, inlägg publiceras).
2. **Eskalerar** när de inte kan stänga sig — en gång, tydligt, till en kanal operatören läser.
3. **Pausar sig själva** när eskaleringsgränsen passerats istället för att fortsätta misslyckas tyst.

Varje workflow i `.github/workflows/` är implementeringen av en sådan slinga. Alla återkommande fel som hittills uppstått (Node-version-mismatch, fastnad release-PR, kvarliggande dependabot-branches) är manifestationer av *avsaknad* av slinga. När looparna nedan är på plats är dessa fel inte möjliga att reproducera.

**Naming-konvention för deterministiska workflows:** workflow-filer som ska förbli enkla döps efter konkreta vardagsverktyg som har en specialiserad uppgift utan tankekraft — `can-opener.yml`, `dustpan.yml`, `pruner.yml`. Namnet signalerar låg ambition och avskräcker både operatör och framtida agent från att smyga in "smart" funktionalitet där en if-condition räcker. En burköppnare ska inte göra LLM-anrop.

## Tidigare iteration: Loop 4 (PR-judge / claude-code-review)

En tidigare version av denna plan föreskrev `anthropics/claude-code-action@v1` som filterfri review-grind på alla PR:er. Den implementerades, kördes en dag, och kostade $5 i Anthropic-credits utan att leverera en enda komplett review. Plugin-orchestrationen (`code-review@claude-code-plugins`) gjorde flera Opus-anrop per körning utöver vad designen förutsatte. För ett solo-projekt med kanske 20 PR:er/månad är det inte ekonomiskt hyllbart.

Loop 4 är **avaktiverad**. Implementer = reviewer accepteras som tradeoff. Mekaniska grindar (`ci / build`, `commitlint / commitlint`) är enda spelreglerna. Detaljer i §4.4.

---

## 2. Trustmatris

Trustmatrisen styr **vem som får auto-merga** när alla required checks är gröna.

| Aktör | Scope | Auto-merge när checks gröna? |
|-------|-------|------------------------------|
| `dependabot[bot]` | npm patch + minor | **Ja** |
| `dependabot[bot]` | npm major | **Ja** (CI från bygget fångar breaking changes) |
| `dependabot[bot]` | github-actions | **Ja** |
| `github-actions[bot]` på branch `release-please--*` | Release-PR | **Ja** |
| `github-actions[bot]` övrigt | — | Nej (ska inte uppstå) |
| Människa eller `claude/*`-branch | All annan kod | Nej — manuell merge (eller `gh pr merge --auto`) |

**Required checks:** `ci / build` + `commitlint / commitlint`. Inga andra grindar. Major bumps som introducerar breaking changes fångas av att `pnpm astro check` eller `pnpm build` blir rött — inte av en AI-reviewer. För typ-check-passing-men-runtime-breaking ändringar finns ingen automatiserad fallback; operatören ser i Cloudflare Pages-deployen om sajten går sönder och revertar.

**Motivering för att lita på ren CI istället för AI-review:**

- AI-review kostade $5/dygn i praktiken — $150/månad. Inte värt det.
- Solo-projekt: operatören är ende mänskliga källkods-författaren. "Implementer ≠ reviewer" är en princip som lovar mer säkerhet än den levererar i ett singleton-team.
- Bot-PR:er (dependabot, release-please) producerar mekaniska diffar. CI fattar.
- Operatörens egna PR:er granskas lokalt under skrivande — med Claude Code i terminalen, inte i en GitHub-workflow.

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
- Astros version bumpas av Dependabot; major-bumpar landar via auto-merge när CI är grön.

---

## 4. Looparna

Varje loop dokumenteras med samma fält: **Syfte → Trigger → Mekanism → Grind → Stängning → Eskalering → Filer**.

### 4.1 Loop 1 — Dependency-update

**Syfte:** Håll beroenden uppdaterade utan manuell granskning av varje patch.

**Trigger:** Dependabot öppnar PR (måndag, veckovis, grupperad enligt befintlig `.github/dependabot.yml`).

**Mekanism:** Workflow `auto-merge-trusted.yml` triggar på `pull_request` (opened, synchronize, reopened, ready_for_review). Filtrerar på `github.actor == 'dependabot[bot]'`, kör `gh pr merge --auto --squash` på alla. Inga `fetch-metadata`-anrop, inga labels, ingen routing — CI grindär.

**Grind:** Branch protection kräver `ci / build` och `commitlint / commitlint` gröna → squash-merge sker när CI klar. Auto-merge är aktiverat på PR-nivå, GitHub väntar på checks själv.

**Stängning:** PR mergad → branch raderad (auto-delete head branches på).

**Eskalering:** Om CI röd: operatören tittar manuellt. Inaktiv PR > 7 dagar fastnar i `dustpan.yml` (§4.7). Om dependabot recreate:ar pga rebase-fail → `can-opener.yml` (§4.8) stänger den superseded gamla.

**Filer:** `.github/workflows/auto-merge-trusted.yml`, `.github/dependabot.yml` (befintlig).

---

### 4.2 Loop 2 — Release-cut

**Syfte:** Cut releaser deterministiskt baserat på Conventional Commits utan att en människa rör knappen.

**Trigger:** Push till `main` → `release-please.yml` (befintlig) öppnar/uppdaterar PR på branch `release-please--branches--main`.

**Mekanism:** Samma `auto-merge-trusted.yml` som loop 1 hanterar även denna. Filter: `github.actor == 'github-actions[bot]'` OCH `head.ref` matchar `release-please--*`. Auto-merge slås på, CI-grön släpper igenom.

**Grind:** CI grön. CHANGELOG och version är genererade deterministiskt.

**Stängning:** PR mergad → release-please publicerar GitHub Release + tag (befintlig flöde).

**Eskalering:** Om CI röd på release-PR: kritiskt issue (release är blockerad → ingen ny version → ingen rollback-target). Failsafe: `release-blocked`-label triggar hög-prio notifikation (issue + Telegram via Alfred om aktiverad).

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

### 4.4 Loop 4 — PR-review (AVAKTIVERAD)

**Status: AVAKTIVERAD.** Originaldesignen specificerade `anthropics/claude-code-action@v1` med `code-review`-pluginen som filterfri review-grind på alla PR:er. Implementerades, kördes en dag, kostade $5 i Anthropic-credits utan att leverera en enda postad review (plugin-orchestration gjorde flera Opus-anrop per körning, några failade tidigt utan att posta).

**Vad som faktiskt hände i praktiken:**

- Plugin (`code-review@claude-code-plugins`) är blackbox — vi vet inte vilken modell den anropar, eller hur många gånger per PR.
- En genomsnittlig PR-körning dök upp på ~$0.50–1.50, med vissa runs >$2.
- Stora PR:er (t.ex. README-översättningar på ~300 rader) tar förmodligen Opus + extended thinking och kostar mer per anrop.
- 5 dependabot-PR:er + några operatör-PR:er per dag → $5/dygn ren burn.

**Beslut:** Loop 4 stryks. Implementer = reviewer-anti-pattern accepteras. Tradeoffsen:

- Förlust: inget AI-öga på PR:erna innan merge.
- Vinst: $150/månad sparas. CI (`ci / build` + `commitlint / commitlint`) fångar mekaniska fel. Cloudflare Pages-deploy syns omedelbart — om main går sönder revertar operatören.

**Om Loop 4 ska återinföras någon gång:**

- Använd `claude-haiku-4-5` ($1/$5 per MTok, ~15x billigare än Opus) i en egen workflow utan plugin.
- Egen kort prompt, inte plugin-orchestration.
- `paths`-filter: skippa README/docs-ändringar.
- Per-PR-cost-budget i workflow:t (om token-räkningen överstiger gräns → skip).
- Hard spend-cap i Anthropic Console som backstop.

**Filer:** Inga. `claude-code-review.yml` raderad.

---

### 4.5 Loop 5 — Branch-hygien (`pruner.yml`)

**Syfte:** Inga kvarliggande branches efter merge eller övergivna PR:er.

**Trigger:** Två separata.

- **Auto-delete on merge:** Repo-inställning, inte workflow. Settings → "Automatically delete head branches" = på.
- **Orphan-städning:** `pruner.yml` schemalagd söndag 02:00 UTC.

**Mekanism (`pruner.yml`):**

1. Lista alla icke-protected branches.
2. Skippa `main` och `release-please--*`.
3. För varje: kontrollera öppen PR-status, `keep`-label på associerad PR (open eller closed), och senaste commit-datum.
4. Radera om: ingen öppen PR OCH ingen `keep`-label OCH senaste commit > 30 dagar.
5. Logga deleted/kept till `$GITHUB_STEP_SUMMARY`.

**Grind:** Hårdkodad skyddslista i workflow (`main`, `release-please--*`). Label `keep` på associerad PR fungerar som veto.

**Stängning:** Workflow slutar. Inga issues skapas (passiv loop).

**Eskalering:** Inget — det här är en städloop, fel här är inte kritiska. Om workflowen själv fail: enkel issue via samma "failure"-mall som övriga loopar.

**Filer:** `.github/workflows/pruner.yml`, repo-inställning "auto-delete head branches" PÅ.

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

### 4.7 Loop 7 — Stuck-PR-escalation (`dustpan.yml`)

**Syfte:** PR:er och issues som ingen rör ska stängas, inte hopa sig.

**Trigger:** `schedule: cron '0 4 * * *'` (dagligen 04:00 UTC) + `workflow_dispatch`.

**Mekanism:** `actions/stale@v9` med config:

```yaml
days-before-stale: 7
days-before-close: 7
stale-pr-label: stale
stale-issue-label: stale
exempt-pr-labels: keep,wip,security,priority:critical
exempt-issue-labels: keep,priority:critical
exempt-draft-pr: true
operations-per-run: 100
```

Dependabot- och release-please-PR:er hanteras genom samma stale-flöde. Om de fastnar (CI röd, recreate-loop) blir de stale och stängs efter 14 dagar — dependabot recreate:ar på nästa veckocykel om det är en äkta uppdatering.

**Grind:** Labels `keep`, `wip`, `security`, `priority:critical` skyddar. Draft-PR:er undantas.

**Stängning:** Stängd PR → `pruner.yml` (§4.5) tar branchen senare.

**Eskalering:** Inget. Det här är passiv hygien.

**Filer:** `.github/workflows/dustpan.yml` (ny).

---

### 4.8 Loop 8 — Superseded-PR-stängning (`can-opener.yml`)

**Syfte:** När dependabot tvingas göra `recreate` istället för `rebase` (typiskt när icke-dependabot har edited PR:n via en workflow-comment), kommenterar den `Superseded by #X` på den gamla PR:n men lämnar den öppen. Det skapar zombie-PR:er som hopar sig.

**Trigger:** `issue_comment: types: [created]` med filter på dependabot[bot] som author OCH comment-body innehåller "Superseded by".

**Mekanism:** `gh pr close $PR_NUMBER --comment "Auto-closed by can-opener: dependabot says superseded."`. Det här är tre rader bash. Inga API-anrop till AI. Inga tankar.

**Grind:** Filtret på actor + comment-body. Om någon annan skriver "Superseded by" i en comment, ignorerar workflowen — actor måste vara dependabot[bot].

**Stängning:** PR stängd → `pruner.yml` (§4.5) tar branchen efter 30 dagar.

**Eskalering:** Inget. Den dagen can-opener.yml failas är operatören märkligt långt borta från hur ändringen syns i UI:t direkt.

**Filer:** `.github/workflows/can-opener.yml` (ny).

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
| `ci / build (pull_request)` | GitHub Actions (15368) | Typecheck + build grön |
| `commitlint / commitlint (pull_request)` | GitHub Actions (15368) | PR-titel följer Conventional Commits |

(Tidigare iteration hade `Claude Code Review / claude-review` här. Borttagen efter Loop 4 avaktiverades — se §4.4.)

`(pull_request)`-suffix är vad GitHub Actions faktiskt postar som status-check-context när workflowen är PR-triggad. Tidigare iteration använde `ci / build` utan suffix — det matchade aldrig vad GitHub postar och fastnade i "Expected — Waiting for status to be reported".

Context-strängen formatteras `<workflow-name> / <job-name> (<event>)` när workflowen kan triggas av flera events, annars `<workflow-name> / <job-name>`. GitHub matchar bytvis — trailing whitespace, fel case, eller saknad event-suffix gör att checken aldrig matchas och PR:n fastnar i "Expected — Waiting for status to be reported". Kontrollera vad GitHub *faktiskt* postar via Actions-fliken på en testkörning innan du sätter required checks.

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

`required_approving_review_count: 0` är medvetet. GitHubs review-mekanism kräver att approval kommer från en användare med skrivåtkomst — vilket i ett solo-repo är operatören själv. Att kräva 1+ skulle tvinga self-approval, vilket inte gör någon nytta.

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
| `ALFRED_TG_TOKEN` | Secret | Actions | Telegram-eskalering (optional) |
| `ALFRED_TG_CHAT_ID` | Variable | Actions | Telegram-eskalering (optional) |
| `SOURCES_URL` | Variable | Actions | Publish-källor |

Dependabot-scope för `ANTHROPIC_API_KEY` behövs inte längre — ingen AI kör på dependabot-triggade workflows. Tas ut ur IMPORT.md.

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
  - `priority:critical` läggs till på cron-paused och release-blocked

- Mall: kort beskrivning + link till workflow-run + sista loggraderna + suggested action.

**Telegram via Alfred (opportunistisk):**

Endast för `priority:critical`-issues. Workflow `escalate.yml` triggar på `issues.opened` med label-filter. Skippa-säkert om secret saknas.

**Filer:** `.github/workflows/escalate.yml` (ny).

---

## 7. Observability

Lågprofil, eftersom projektet är litet. Tre mekanismer räcker:

**a) Workflow-summaries.** Varje workflow skriver en kort sammanfattning till `$GITHUB_STEP_SUMMARY` så att Actions-fliken visar vad som hänt utan att klicka in i loggen.

**b) `data/cron-state.json`.** Är repo-committed observability — vem som helst som klonar repot kan se senaste lyckade publish och eventuell paus-state.

**c) Issues som status.** Öppna issues med labels `cron-degraded`, `drift`, `release-blocked` ger en visuell status.

Ingen Prometheus, ingen Grafana. Skalan är fel.

---

## 8. Migration till privat template

När operatören migrerar till privat repo via "Use this template":

**Behålls i template:**
- Alla workflows (loop 1–3, 5–8).
- Rulesets-källfiler (`.github/rulesets/*.json`), appliceras via `./scripts/apply-policy.sh` enligt `IMPORT.md`.
- Repo-inställnings-config (`.github/repo-settings.json`).
- Labels-fil (`.github/labels.json`).
- Denna plan som dokumentation.

**Bryts av template-klon:**
- `data/cron-state.json` — initieras tomt.
- `data/posted.json` — initieras tomt.
- Secrets — måste sättas på nytt i det nya repot (`ANTHROPIC_API_KEY` på Actions-scope endast).

**IMPORT.md** listar de `gh`-kommandon som måste köras efter klon för att applicera rulesets, repo settings, labels, och sätta secrets. Allt annat är passivt klart.

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
│   └── automation-failure.md     # För loop-eskaleringsissues
├── PULL_REQUEST_TEMPLATE.md      # Befintlig
├── labels.json                   # 9 labels: stale, keep, wip, drift,
│                                 #          cron-degraded, cron-paused,
│                                 #          release-blocked,
│                                 #          automation-failure,
│                                 #          priority:critical
├── repo-settings.json            # Repo-level settings
├── rulesets/
│   ├── 01-main-branch.json       # required checks, PR-rule, linear history
│   └── 02-release-tags.json      # skydd för v*-tags
└── workflows/
    ├── ci.yml                    # Befintlig (läser .nvmrc)
    ├── commitlint.yml            # Befintlig
    ├── release-please.yml        # Befintlig
    ├── publish.yml               # Befintlig (refaktoreras: state-fil, retry, paus)
    ├── auto-merge-trusted.yml    # loop 1 & 2
    ├── cron-watchdog.yml         # loop 3 eskalering (kommande)
    ├── pruner.yml                # loop 5 (branch-cleanup)
    ├── drift-check.yml           # loop 6 (kommande)
    ├── dustpan.yml               # loop 7 (stale)
    ├── can-opener.yml            # loop 8 (superseded-PR-stängning)
    └── escalate.yml              # Telegram för priority:critical (kommande)
```

Ingen `claude-code-review.yml`. Ingen `judge.yml`. Inga AI-anrop på PR-triggers.

---

## 10. Implementeringsordning

Looparna är inte oberoende. Ordningen är optimerad så varje loop landar med en stängd grind under sig:

1. **Steg 0 — SSoT.** `.nvmrc` + `engines` + refaktorera ci.yml/commitlint.yml/publish.yml till `node-version-file`. Stänger Node-driften.
2. **Steg 1 — labels + repo-settings + rulesets.** Källfiler committas. `apply-policy.sh` kör. Förutsättning för senare steg.
3. **Steg 2 — Loop 1 + 2 (auto-merge-trusted).** Stänger dependency- och release-looparna direkt — backlog rensas automatiskt när CI är grön.
4. **Steg 3 — Loop 5 (pruner) + Loop 7 (dustpan) + Loop 8 (can-opener).** De tre "appliances". Rensar skräpbranches och stale PRs/issues. Ingen AI, deterministiska.
5. **Steg 4 — Loop 3 (cron-watchdog + state).** Hardenar publish.
6. **Steg 5 — Loop 6 (drift).** Lågfrekvent, kan komma sist.
7. **Steg 6 — escalate.yml + Telegram.** Sista lagret. Allt fungerar utan men blir bättre med.

Efter Steg 3 är repot i ett tillstånd där operatören kan vara borta i veckor utan att backloggen växer. Det är minimum-viable för unattended. Steg 4–6 är polish.

---

## 11. Vad denna plan inte gör

- **Inte AI-PR-review.** Försökte (Loop 4) men kostnaden var $5/dygn i praktiken — ohållbart. Se §4.4 för förutsättningar när det skulle kunna återinföras.
- **Inte testautomation.** `pnpm astro check` + `pnpm build` är hela testningen. Att lägga till enhetstester för `scripts/`-mappen är värdefullt men utanför CI/CD-plan-scope.
- **Inte performance-monitoring.** Cloudflare Pages-deploy-tid spåras inte. Inte kritiskt.
- **Inte cost-monitoring.** Anthropic API-kostnaden spåras inte automatiskt — föreslår manuell granskning i Anthropic-konsolen månadsvis tills/om problem dyker upp. För publish-loopen är kostnaden låg och förutsägbar (en API-call per cron-tick, 3x/vecka).
- **Inte content quality monitoring.** Det är ett separat problem (innehållskvalitet i AI-genererade inlägg) som ligger utanför CI/CD och egentligen utanför detta projekts scope helt.
