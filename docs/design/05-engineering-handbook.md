# aitoblog — Engineering Handbook

> Detta dokument beskriver *vad* som gäller i `aitoblog` och *varför*. Mekanismerna som realiserar det finns i `06-ci-cd-plan.md`. Dupliceras inte; refereras.

---

## 1. Strikthetsnivå

**Vald nivå:** `solo` med agent-augmentering.

Operatören är ensam mänsklig bidragsgivare. Implementeringsarbete utförs i sessioner av Claude Code (`claude/*`-branches eller lokal session som pushar). Granskning utförs av en separat reviewer-agent: Claude GitHub App via `claude-code-review.yml` (baserad på `anthropics/claude-code-action@v1`).

**Motivering:** Skalan motiverar inte `solo+contrib` eller `team`-overhead. Men avsaknaden av en andra mänsklig granskare täcks inte av "ingen granskning alls" — den täcks av reviewer-agenten. Resultatet är att vissa egenskaper hos `solo+contrib` (oberoende review, CODEOWNERS-liknande gating) uppnås utan att kräva en andra människa.

**Utbyggnadsläge:** När repot konsumeras som template för dotterprojekt under `alfred-intelligence` förblir nivån `solo`. Strikthetsförändring kräver revidering av detta dokument samt 06.

---

## 2. Licens

**MIT.** Befintlig.

**Motivering:**
- Repot är publikt och ska kunna användas som template av andra (även utanför `alfred-intelligence`).
- AI-genererat innehåll i `src/content/blog/` är inte koden — innehållets juridiska status hanteras genom AI-disclaimer per inlägg, inte via licens. Templaten omfattar bara den maskinella infrastrukturen.
- Inga beroenden i `package.json` har inkompatibla licenser med MIT.

**Konsekvens för dotterprojekt:** När template klonas till privat repo behålls LICENSE-filen. Om det privata repot ska bli "All Rights Reserved" istället: ersätt LICENSE-filen och uppdatera `package.json#license`. Inget annat behöver ändras.

---

## 3. Branch-strategi

**Modell:** Trunk-based development.

- `main` är alltid deploybar. Cloudflare Pages bygger varje push.
- Allt arbete sker i kortlivade feature-branches från `main`.
- Branches namnges enligt prefix:
  - `feat/<scope>` — ny funktion
  - `fix/<scope>` — buggfix
  - `chore/<scope>` — underhåll
  - `docs/<scope>` — dokumentation
  - `ci/<scope>` — CI/CD-ändringar
  - `claude/<session-id>` — Claude Code-sessioner (reserverat prefix)
- Branches mergas via PR efter review + CI grön.
- Inga long-lived branches utöver `main`.

**Skyddade branch-prefix** (raderas inte av branch-cleanup, undantagna från stale-loop):
- `release-please--*` — automatgenererat av release-please.
- `keep/*` — om operatören explicit vill bevara en branch.

**Inga merges till `main` utan PR.** Operatören får inte direkt-pusha — branch protection (`enforce_admins: false` undantaget force-merge i nödläge) hindrar.

---

## 4. Commit-konventioner

**Format:** Conventional Commits, enforced via `commitlint` på alla PR-titlar.

`<type>(<scope>)?: <subject>`

**Tillåtna types** (enligt `.commitlintrc.json` och release-please-konfig):

| Type | Användning | CHANGELOG-sektion |
|------|------------|-------------------|
| `feat` | Ny funktion (synlig i prod-bloggen eller pipen) | Features |
| `fix` | Buggfix | Bug Fixes |
| `perf` | Prestandaförbättring | Performance |
| `docs` | Dokumentation | Documentation |
| `refactor` | Omstrukturering utan beteendeändring | Refactors |
| `chore` | Underhåll, deps | Dolt |
| `ci` | CI/CD-ändringar | Dolt |
| `test` | Tester | Dolt |
| `style` | Formatering | Dolt |
| `build` | Byggsystem | Dolt |
| `revert` | Återställning | Reverts |

**Subject-regler:**
- Imperativ form ("add", inte "added").
- ≤ 72 tecken.
- Ingen avslutande punkt.
- Engelska för commits i koden, svenska för rena docs-commits OK (men engelska föredras för konsistens).

**Body:** Frivillig men uppmuntrad när PR:n innehåller ett "varför" som inte syns i diffen. Inga hårda radlängdskrav (är medvetet avstängt i commitlint för att inte krocka med markdown-länkar — se befintlig fix-commit `c986272`).

**Breaking changes:** `feat!: <subject>` eller footer `BREAKING CHANGE: <förklaring>`. Triggar major-bump via release-please.

**Squash-merge konsekvens:** Det är *PR-titeln* som blir commit-meddelandet på `main`. Branch-commits granskas inte av commitlint utöver title (men subject-konvention bör följas även i branch-commits för läsbarhet).

---

## 5. PR-process

### Invariant: implementer ≠ reviewer

Den hårda regeln. Den som öppnade PR:n granskar den inte. Mekaniken finns i 06 (loop 4 + branch protection); här är policyn.

### Krav för merge

| Aktör | Krav |
|-------|------|
| Dependabot patch/minor + GHA-bumpar | CI grön + review approve. Auto-merge sker via `auto-merge-trusted.yml`. |
| Dependabot major | CI grön + review approve. Auto-merge sker. |
| Release-please | CI grön + review approve. Auto-merge sker. |
| Operatör eller `claude/*` | CI grön + review approve. Auto-merge på PR. |

Review körs på *alla* PR:er — den är filterfri. Trustmatrisen i 06 §2 styr bara om auto-merge slås på, inte om review körs.

### PR-storlek

Riktlinje: < 400 rader diff. Större PR:er motiveras i beskrivningen och kan flaggas av reviewer som "request_changes" om motivering saknas. Mekaniska massändringar (t.ex. SSoT-refaktor) undantas.

### PR-beskrivning

Mall finns i `.github/PULL_REQUEST_TEMPLATE.md`. Innehåller minimum:

- **Vad** — en mening.
- **Varför** — en mening eller länk till issue.
- **Verifiering** — `pnpm astro check && pnpm build` grön; eventuella manuella steg listas.

Reviewer läser titel + beskrivning + diff. Tom beskrivning på icke-mekanisk PR är skäl för `request_changes`.

### Mergestrategi

Squash, alltid. Commit-message = PR-titel. Default-inställning på repo-nivå (`.github/repo-settings.json`).

### Labels med beteende

| Label | Effekt |
|-------|--------|
| `keep` | Skyddar PR/branch från stale- och cleanup-loopar |
| `wip` | Skyddar PR från stale-loop; signalerar opågående arbete |
| `needs-judge` | Sätts på dependabot major av auto-merge-workflowen; informativ signal (historisk; review körs ändå på alla PR:er) |
| `judge-blocked` | Sätts vid 2 `request_changes` i rad om review-escalation-workflowen aktiveras; signal till operatör |
| `automation-failure` | Generiskt issue-label från eskalerings-workflow |
| `cron-degraded` / `cron-paused` | Specifika fel i publish-loopen |
| `release-blocked` | Release-PR har röd CI |
| `drift` | Drift-detektorn har funnit inkonsistens |
| `security` | Säkerhetsrelevant; skyddas från stale-loop |
| `priority:critical` | Triggar eskaleringskanal (Telegram när aktiverat) |

Hela labelsetet definieras i `.github/labels.json` och synkas via `gh label sync` (eller `./scripts/apply-policy.sh`) vid setup.

---

## 6. Release-policy

**Mekanism:** release-please (befintligt). Versionsnummer styrs deterministiskt av Conventional Commits sedan föregående tag.

**Kadens:** Ingen schemalagd. Release skärs så fort en release-värd commit landat på `main` och CI är grön. För `aitoblog` betyder det:

- En ren `chore`/`ci`-vecka → ingen ny release.
- En `feat` eller `fix` → release-PR öppnas, auto-mergas (loop 2 i 06), tag + GitHub Release publiceras.

**SemVer-tolkning:**

| Commit-type | Bump |
|-------------|------|
| `fix:`, `perf:` | patch |
| `feat:` | minor |
| `<type>!:` eller `BREAKING CHANGE:` i body | major |

**Tag-format:** `v<major>.<minor>.<patch>`, drivs av `include-v-in-tag: true` i `release-please-config.json`.

**Manuella releaser:** Förbjudna. Om release-please går sönder är åtgärden att laga release-please, inte att tagga manuellt. (Eskalering: `release-blocked`-label.)

**Rollback:** Inte automatiserad. Cloudflare Pages behåller tidigare deploys; via Cloudflare dashboard kan en tidigare deploy ompublikeras. För kod-rollback: revert-commit på `main` (en `revert:`-commit triggar release-please till patch-bump → en motbump).

---

## 7. Maintenance-policy

**Princip:** Maintenance är autonoma kontrollslingor, inte mänskliga aktiviteter. Operatören har inga regelbundna ansvar. De enda interventioner som krävs är vid eskaleringar.

**Operatörens läsning vid normal drift:** Ingen. Mejl från GitHub Actions om en workflow misslyckas är passiv signal; behöver inte agera.

**Operatörens läsning vid eskalering:** Sju label-värden räcker som hela alarmpanelen.

| Label | Tidsfönster | Åtgärd |
|-------|-------------|--------|
| `priority:critical` | Inom 24h | Läsa issue, agera enligt suggested action |
| `cron-paused` | Inom 24h | Återställ `data/cron-state.json` när rotorsaken är fixad |
| `release-blocked` | Inom 72h | Laga underliggande CI-fel; release-please återföljer |
| `cron-degraded` | Inom 1 vecka | Granska; ofta löser den sig själv vid nästa körning |
| `drift` | Inom 30 dagar | Synk enligt åtgärdsförslag i issue |
| `judge-blocked` | Inom 1 vecka | Mänsklig granskning av PR |
| `security` | Inom 24h | Hantera enligt SECURITY.md |

**Granskningsfrekvens:** Operatören förväntas öppna `https://github.com/alfred-intelligence/aitoblog/issues` ungefär varannan vecka. Allt brådskande har eskalerat via mejl (default GitHub) eller Telegram (när aktiverat).

**Garantier:** Looparna i 06 säkerställer att backloggen inte växer. Stale-loopen stänger glömda PR:er. Branch-cleanup raderar skräp. Drift-detektorn fångar versionsinkonsistens innan den orsakar fel. Det enda som *inte* hanteras autonomt är förändringar som kräver designval — och de förändringarna får sitta i `drift`- eller `judge-blocked`-issues tills operatören återkommer.

---

## 8. Säkerhetspolicy

### Secrets-hantering

- **Aldrig** i committad kod. `.env` finns i `.gitignore`.
- Lokala utvecklingsmiljöer använder `.env`.
- Prod använder GitHub Secrets på repo-nivå.
- Aktuella secrets/variabler listas i `06-ci-cd-plan.md §5`.

### Graceful degradation för optional secrets

Workflows som använder optional secrets (`ALFRED_TG_TOKEN`, `ALFRED_TG_CHAT_ID`) **måste** kontrollera att secret är satt innan användning. Workflowen får inte misslyckas på grund av avsaknad. Mall:

```yaml
- name: Notify Telegram
  if: ${{ secrets.ALFRED_TG_TOKEN != '' }}
  run: curl ...
```

Detta gäller alla framtida integrationsworkflows.

### SECURITY.md

Saknas idag. Skapas innan publik konsumtion av templaten.

**Innehåll (skiss):**
- Hur sårbarheter rapporteras (GitHub Security Advisory på repot, *inte* publika issues).
- Vilka versioner som stöds (senaste minor, eftersom det är ett solo-projekt utan LTS-åtaganden).
- Tidsförväntningar: bekräftelse inom 1 vecka, fix-åtaganden bestäms case-by-case.

### Dependabot security alerts

Aktiverade automatiskt eftersom repot är publikt. Security-PR:er behandlas som vanliga dependabot-PR:er av trustmatrisen — auto-mergas när CI + review är gröna.

### AI-pipeline-specifik säkerhet

- Anthropic API-nyckeln har bara `messages:create`-rättigheter. Roteras minst årligen.
- Genererat innehåll får inte innehålla länkar som inte finns i source-materialet. Verifieras av prompt-instruktionen, inte av koden — accepteras som tradeoff.
- Inkommande material (README, artiklar via Readability) behandlas som otrusted indata. Klistras inte in i shell-kommandon eller filnamn utan sanitisering. (Slug-generering i `scripts/post-writer.ts` ska använda strikt allowlist `[a-z0-9-]`.)

---

## 9. Template-konsumtionspolicy

`aitoblog` är publikt template-repo. Konsumenter (operatören själv för dotterprojekt, eller externa) som klonar via "Use this template" får:

**Inkluderat:**
- All kod, alla workflows, alla konfigfiler.
- Tom `data/posted.json` och `data/cron-state.json` (initieras via `bootstrap/`-mappen).
- Default `data/sources.json` med exempelvärden.

**Måste konfigureras efter klon** (listas i `IMPORT.md`):
1. Sätt secrets: `ANTHROPIC_API_KEY` (obligatorisk).
2. Applicera branch protection: `gh api ... --input .github/branch-protection.json`.
3. Applicera repo-settings: `gh api ... --input .github/repo-settings.json`.
4. Synka labels: `gh label sync -f .github/labels.json`.
5. Sätt repo-variabel `SOURCES_URL` eller redigera `data/sources.json`.
6. Koppla Cloudflare Pages enligt 03-short-horizon Steg 5.

**Optionellt:**
- Telegram-eskalering: sätt `ALFRED_TG_TOKEN` + `ALFRED_TG_CHAT_ID`.
- Egen domän via Cloudflare Pages custom domain.

**Template-uppdateringar:** Drar inte automatiskt. Vid större infra-bumpar i denna repo kan konsumenter cherry-picka. Ingen subscription-mekanism är inbyggd; det är medvetet — varje dotterprojekt äger sina egna val.

---

## 10. Roller och ansvar

### Operatör (människa)

**Får:**
- Öppna PR:er.
- Force-merga via admin-bypass i absolut nödläge (rulesetet har bypass-actors för admin-roll).
- Återställa `data/cron-state.json` när cron pausats.
- Eskalera issues, stänga issues, anpassa labels.
- Bumpa pin:ade modellversioner.

**Får inte:**
- Direkt-pusha till `main` (rulesetet blockerar i normalflöde).
- Approve sin egen PR (review-checken kräver Claude GitHub App, som är en annan identitet).

### Implementer-agent (Claude Code i sessioner)

**Får:**
- Skapa branches under `claude/*`-prefix.
- Öppna PR:er.
- Köra `pnpm`, `git`, `gh`, `pnpm tsx`, `pnpm build`.

**Får inte:**
- Approve sin egen PR.
- Merga utan att review passat.
- Skriva secrets till committade filer.
- Ändra `release-please-config.json`, filer under `.github/rulesets/`, eller `.github/workflows/claude-code-review.yml` utan explicit uppdrag.

### Reviewer-agent (Claude GitHub App via `claude-code-review.yml`)

**Får:**
- Läsa PR-diff, titel, beskrivning.
- Posta formell PR-review (approve / request_changes / comment) under Claude GitHub App-identiteten.
- Sätta `Claude Code Review / claude-review`-status check.

**Får inte:**
- Skriva kod till repot.
- Merga PR:er (separation of duties — reviewer granskar, auto-merge-workflowen agerar).
- Konsumera secrets utöver `ANTHROPIC_API_KEY` (på både Actions- och Dependabot-scope).

### Dependabot

**Får:** Öppna PR:er för dependency-uppdateringar enligt `.github/dependabot.yml`.

**Får inte:** Allt annat (är begränsad av GitHubs egen sandboxing).

### Release-please

**Får:** Öppna och uppdatera release-PR på `release-please--*`-branch. Publicera GitHub Release + tag efter merge.

**Får inte:** Allt annat.

---

## 11. Avvikelser och hur de loggas

Om operatören eller en implementer-agent fattar ett beslut som avviker från denna handbok (eller från designval i 01–04 / 06): logga avvikelsen i `DECISIONS.md` i repo-roten.

Format per beslut:
```markdown
## YYYY-MM-DD — <kort titel>

**Kontext:** Vad som motiverade beslutet.
**Beslut:** Vad som valdes.
**Avvikelse från:** Vilken regel eller dokument.
**Konsekvens:** Vad detta betyder för framtida arbete.
```

`DECISIONS.md` skapas first-time-need. Om filen inte finns: det betyder inga avvikelser har dokumenterats.
