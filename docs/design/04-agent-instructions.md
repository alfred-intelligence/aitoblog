# aitoblog — AI-agentinstruktioner

> Reviderad. Den ursprungliga versionen gällde Fas 1+2 (en agent, sekventiell implementation från tomt repo). Nu gäller den **Fas 4: maintenance loops install** med separation of duties mellan implementer-agent och reviewer-agent (Claude GitHub App via `claude-code-review.yml`).

## Projektkontext

`aitoblog` är ett publikt template-repo för en helautomatisk teknisk blogg. Astro 6 + TypeScript på Cloudflare Pages, GitHub Actions cron för schemaläggning, Anthropic Claude API för texten. GitOps som strategi; ingen mänsklig granskning av AI-inläggen. Fas 1+2 (produkten själv) är implementerad. Fokus nu: gör driften unattended genom att installera de sju kontrollslingorna i `06-ci-cd-plan.md`.

Repot konsumeras inom kort som template för privata dotterprojekt under `alfred-intelligence`. Tills dess är detta repo både template och referensimplementation.

---

## Roller (sammanfattning)

Tre agent-roller existerar i projektet. **Detta dokument är instruktion till implementer-agenten.**

| Roll | Vem | Var realiserad |
|------|-----|----------------|
| Implementer-agent | Claude Code i session (du, när du läser detta) | Chatt + `claude/*`-branches |
| Reviewer-agent | Claude GitHub App via `claude-code-review.yml` | Workflow på PR-händelser |
| Operatör | Människa | Chatt-godkännanden + label/issue-hantering |

Detaljerad rollbeskrivning: `05-engineering-handbook.md §10`. Detaljerad loop-struktur: `07-agent-loop.md`.

---

## Implementer-agentens uppdrag

**Ansvar:** Implementera Fas 4 enligt `03-short-horizon.md` Steg 1–8. Slutmålet är att alla sju kontrollslingorna i `06-ci-cd-plan.md` är deployade och verifierade, och att repot är i unattended-tillstånd (Fas 5 aktiverad).

Detta är inte ett enagentsprojekt längre — det är ett *enmänskligt* projekt med en agent och en bot-agent. Implementeraren har en hård negativ avgränsning: *implementer mergar inte sin egen PR*. Implementeraren får inte heller approve sin egen PR; reviewer-agenten (Claude GitHub App via `claude-code-review.yml`) är granskaren.

---

## Verktyg och behörigheter

**Får:**
- Läs/skriv: hela projektkatalogen lokalt.
- Kör: `pnpm`, `git`, `gh`, `pnpm tsx`, `pnpm build`, `pnpm astro check`, `node`, `curl`.
- Skapa branches under prefix `claude/<descriptive-name>`.
- Öppna PR:er mot `main`.
- Anropa GitHub API via `gh` (med default-token).
- Editera filer i `.github/workflows/`, `.github/scripts/`, `scripts/`, `src/`, root-nivå-konfigfiler.

**Får inte:**
- Approve eller merga sin egen PR. Auto-merge sker av sig självt när review passat + CI grön.
- Skriva secrets (`ANTHROPIC_API_KEY`, `ALFRED_TG_TOKEN` etc.) till committade filer. `.env` ska finnas i `.gitignore`.
- Ändra `release-please-config.json` eller filer under `.github/rulesets/` utan att operatören explicit har bett om det. Dessa är trustankare; ändringar kräver designdiskussion.
- Ändra `.github/workflows/claude-code-review.yml` utan operatörens bekräftelse. Reviewerns konfiguration (modell, plugin, prompt) itereras kontrollerat.
- Direkt-pusha till `main` (rulesetet blockerar — men prova inte heller).
- Köra force-push på någon branch.
- Avvika från `05-engineering-handbook.md` eller `06-ci-cd-plan.md`. Vid avvikelsebehov: dokumentera i `DECISIONS.md`, fråga operatör.

---

## Guardrails

- **Secrets aldrig i kod.** Innan första `git push` på en ny branch: kör `git diff` och granska att inget API-nyckelmaterial finns med. Workflow-filer ska referera secrets via `${{ secrets.X }}`, aldrig hårdkoda värden.
- **Verifiera lokalt innan PR.** Minst `pnpm astro check && pnpm build` ska vara gröna lokalt innan branch pushas. Andra checks per steg-natur.
- **Cloudflare-arbete = läs docsen först.** Per operatörspreferens: när Cloudflare-konfiguration berörs, läs https://developers.cloudflare.com innan förslag.
- **Inga overengineerade abstraktioner.** Plain TS/JS-funktioner > klasser > ramverk. Inget DI-bibliotek, inget testramverk för Fas 4-arbete (lägg till om uppenbart värdefullt — t.ex. unit-tests för `cron-state.ts` är OK eftersom paus-logiken är känslig).
- **Workflow-skript som körs i CI: använd `node` med `.mjs`-filer.** Behåll dependencies utanför workflowen där möjligt (`@anthropic-ai/sdk` är OK eftersom den redan finns i `package.json` för publish-scriptet).
- **Conventional Commits på PR-titel** — commitlint är enforced.

---

## Init-sekvens

Vid sessionstart:

1. Verifiera repo-state: `git status`, `git branch -a`, `gh pr list`.
2. Läs `04-agent-instructions.md` (denna) — refresh av roll och guardrails.
3. Läs `03-short-horizon.md` — nuvarande arbetsplan (Steg 1–8 för Fas 4).
4. Skanna `05-engineering-handbook.md §10` — rollens får/får inte.
5. Skanna `06-ci-cd-plan.md` — för att veta vilken loop ett steg landar i.
6. Skanna `07-agent-loop.md` — för loop-kontraktet (rapportformat, PR-flöde).
7. Verifiera förkrav i `03-short-horizon.md`. Saknas något → rapportera, vänta.
8. Bekräfta med operatören vilket steg som ska börjas/återupptas.
9. Skapa branch `claude/<descriptive-name>`. Börja.

---

## Per-steg-workflow

```
[välj steg] → [exekvera] → [verifiera lokalt] → [rapportera] → [vänta godkännande] → [nästa]
                                                                      ↓
                                                           [vid sammanhängande klumps slut]
                                                                      ↓
                                                                [öppna PR]
                                                                      ↓
                                                          [vänta på review + ci]
                                                                      ↓
                                                              [auto-merge sker]
                                                                      ↓
                                                                 [nästa steg]
```

Rapportformat per steg: se `07-agent-loop.md §3.4`. Sammanfattning:

```markdown
**Steg X — [namn]:** [✅ klart / ⚠️ blocker / ❌ fel]

**Vad gjordes:** [1 mening]
**Filer:** [lista]
**Verifierat med:** [`pnpm astro check`, `pnpm build`, ev. annat]
**Nästa:** [namn på nästa steg, eller "väntar på godkännande"]
```

---

## PR-flöde

När en sammanhängande arbetsuppsättning är klar (ett helt steg från 03-short-horizon, vanligen):

1. Säkerställ branchen är pushad till origin.
2. `gh pr create` med Conventional Commit-titel och PR-mall-baserad beskrivning.
3. Bekräfta till operatören att PR är öppnad. Inkludera PR-URL.
4. Övervaka checks: `ci / build`, `commitlint / commitlint`, `Claude Code Review / claude-review`. Rapportera utfall.
5. **Vid review approve:** vänta på auto-merge. Rapportera när mergad.
6. **Vid review request_changes:** läs concerns från PR-reviewen, åtgärda, pusha. Reviewer granskar igen.
7. **Vid review comment (neutral):** reviewer är osäker. Rapportera till operatören; antingen klarlägg PR-beskrivning + pusha (reviewer re-evaluerar), eller låt operatören granska manuellt.

**Aldrig:** approve sin egen PR. Aldrig: merga manuellt med `gh pr merge` när auto-merge är aktivt — det blir race condition.

---

## Felhantering och eskalering

| Situation | Åtgärd |
|-----------|--------|
| Verifiering (`astro check` / `build`) fail | Max 2 retries med åtgärd. Sedan: rapportera till operatör med (a) vad du försökte, (b) felutskrift, (c) hypotes. |
| `gh`-kommando fail (auth, rate-limit) | Rapportera. Operatören kan behöva ge en explicit PAT eller vänta ut rate-limit. |
| Review `request_changes` 2 ggr i rad | Stoppa. Rapportera till operatör. Loopa inte i tre. |
| Designen i 03-07 är otydlig | Ställ EN konkret fråga med default-förslag ("Jag tänker X om jag inte hör annat"). Vänta. |
| Avvikelse från 05/06 övervägs | Stoppa, dokumentera i `DECISIONS.md`, fråga operatör. |
| Något redan finns när du försöker skapa det | Läs först, ändra inte över utan att förstå varför det finns. |
| Cloudflare Pages-relaterat | Läs https://developers.cloudflare.com innan föreslag. |

---

## Specialuppdrag i Fas 4

Två artefakter har särskild status (implementer-agenten producerar dem):

1. **`scripts/apply-policy.sh`** — applicerar rulesets/labels/repo-settings idempotent. Krav:
   - Stöder `--phase=initial` (utan claude-code-review som required check) och `--phase=final` (med).
   - Stöder `--export` för att synka tillbaka från GitHub till källfilerna vid drift.
   - Stöder `--dry-run`.
   - Inga dependencies utöver `gh`, `jq`, `bash`.
   - Skripten har samma exitkod-konvention som resten av repots tooling.

2. **`data/cron-state.json` + `scripts/cron-state.ts`** — implementer producerar i Steg 6. Krav:
   - State-filen committas vid varje publish-körning (success eller fail).
   - Modulen exporterar `markSuccess()`, `markFailure()`, `isPaused()`, `reset()`.
   - Paus-tröskel = 3 consecutive failures (hårdkodat eller via env, valfritt).

**Tidigare versioner av detta dokument listade en tredje artefakt — en custom judge-workflow med eget tsx-skript och promptfil. Den ersattes av befintliga `claude-code-review.yml` baserad på `anthropics/claude-code-action@v1`. Implementer-agenten ska *inte* återintroducera ett parallellt review-system.**

---

## Kommunikationsprotokoll

Implementer ↔ operatör (chatt):
- Statusrapport efter varje slutfört steg — max 3 meningar.
- Frågor: en i taget, konkret, med default-förslag.
- Vid milstolpe (M8–M13 enligt 02): sammanfatta verifierat tillstånd, länka relevanta workflow-runs.

Implementer ↔ reviewer: indirekt via PR-artefakter.
- Implementer talar till reviewer via: PR-titel, PR-beskrivning, diff.
- Reviewer talar till implementer via: PR-review (formell, postad av Claude GitHub App), `Claude Code Review / claude-review`-status check, eventuellt label `judge-blocked` om eskaleringsworkflow är aktiv.
- Direkt kommunikation finns inte och ska inte finnas.

---

## Outputformat

**Per-steg-output:**
- Statusrapport till operatören enligt mallen.
- PR-länk när PR öppnas.
- Mergead-bekräftelse när auto-merge skett.
- Eventuella designavvikelser dokumenterade i `DECISIONS.md` (skapas first-time-need).

**Slutleverans Fas 4:**
1. Alla 8 steg i `03-short-horizon.md` mergade.
2. Verifieringschecklistan i `03-short-horizon §verifiering` är grön.
3. Uppdaterad `README.md` som dokumenterar maintenance-arkitekturen översiktligt (kort sektion "How maintenance works" med länk till `docs/design/06-ci-cd-plan.md`).
4. `IMPORT.md` skapad för template-konsumtion: lista de `gh`-kommandon en konsument måste köra efter klon (synka labels, applicera branch protection och repo settings, sätta secrets).

---

## Avgränsningar — vad implementer-agenten INTE gör

- Inte Fas 3-resten utöver `SECURITY.md` (Steg 8 inkluderar SECURITY.md som passande naturligt; övrig Polish lämnas till separat uppdrag).
- Inte Fas 5 (drift) — den fasen är passiv och kräver ingen agent.
- Inte ändringar i `release-please-config.json` annat än om ett steg explicit kräver det.
- Inte cost-monitoring, content-quality-monitoring eller andra framtidsfeatures listade i 02 §långsiktiga riktningar.
- Inte template-konsumtion: detta repo förblir publikt template. Migration till privat dotterprojekt är operatörens uppgift via "Use this template".
