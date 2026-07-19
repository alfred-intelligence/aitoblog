# aitoblog — Lång horisont

> Reviderad vid fas B-övergång. Produktdelen (Fas 1–3) är till stora delar implementerad; tyngdpunkten flyttas till Fas 4 (maintenance loops) och Fas 5 (autonom drift). Den ursprungliga "Fas 4: löpande aktiviteter" var inte rätt modell för unattended — den ersätts.

---

## Översikt

| Fas | Namn | Innehåll | Status | Estimat |
|-----|------|----------|--------|---------|
| 1 | Statisk grund | Astro + Cloudflare Pages + manuell test-post + RSS verifierad | ✅ Klar | — |
| 2 | AI-pipeline | Topic-val, Claude-anrop, GitHub Actions cron, första AI-post live | ✅ I grunden klar (behöver härdas i Fas 4) | — |
| 3 | Polish | Styling, AI-disclaimer, sitemap, observerbarhet, SECURITY.md | 🟡 Delvis | 0,5 dag återstår |
| 4 | **Maintenance loops install** | De sju autonoma slingorna enligt 06-ci-cd-plan | 🔴 Återstår | 1,5–2 dagar |
| 5 | Autonom drift | Operatören endast vid eskaleringar | 🔴 Aktiveras efter Fas 4 | Löpande |

Total återstående tid till "unattended"-tillstånd: **~2 dagars fokuserad implementation** för Fas 4 + den lilla rest som finns i Fas 3.

---

## Fas 1: Statisk grund ✅

Astro 6-projekt med content collections, RSS-feed, manuell test-post live. Cloudflare Pages-koppling fungerar. CI-grön.

**Status:** Klar. Se Git-historik från commit `05b2704`.

---

## Fas 2: AI-pipeline ✅ (i grunden)

`scripts/generate-post.ts` implementerat med stöd för både GitHub-repos (README + releases + commits) och artiklar via Readability. `publish.yml` cron-aktiverad. `data/posted.json` cooldown-spårar.

**Status:** Pipelinen kör. Skall härdas i Fas 4 (retry, state-fil, dead-letter, watchdog) men grundfunktionen är på plats.

---

## Fas 3: Polish 🟡

**Klart:**
- Layout, basläsbarhet
- RSS-feed validerad
- AI-disclaimer i sidfot

**Återstår:**
- `SECURITY.md` (krävs för publikt template-repo)
- Verifiering att AI-disclaimer syns *per inlägg*, inte bara i footer
- `/about`-sida
- 404-sida
- Sitemap.xml verifierad
- OG/Twitter Card meta per inlägg

**Klar när:** Listan ovan klockad av.

**Beroenden:** Inga blockerande — kan göras parallellt med Fas 4 om operatören vill.

---

## Fas 4: Maintenance loops install 🔴

**Mål:** Installera de sju kontrollslingorna definierade i `06-ci-cd-plan.md` så att repot går från "halvautomatiskt" till "unattended".

**Klar när:**

1. SSoT för Node-versioner på plats (`.nvmrc` + `engines` + workflow-refaktor). Drift-klassen "Node-mismatch" är omöjlig att reproducera.
2. Befintlig `claude-code-review.yml` verifierad grön på alla PR-typer (operatör, dependabot, release-please). Rulesetet kräver `Claude Code Review / claude-review` som status check.
3. `auto-merge-trusted.yml` deployad. Alla aktuella backlog-PR:er (dependabot + release-please) rensade automatiskt.
4. Auto-delete head branches på + `branch-cleanup.yml` deployad. Inga kvarliggande branches.
5. `publish.yml` refaktorerad med retry + state-fil + paus-mekanism. `cron-watchdog.yml` deployad.
6. `drift-check.yml` + `stale.yml` deployade.
7. `escalate.yml` förberedd (no-op tills `ALFRED_TG_TOKEN` finns).
8. Rulesets + repo settings + labels applicerade enligt JSON-källfilerna under `.github/`.

**Beroenden:** Fas 1+2 klara. Designen i 05+06+07 godkänd.

**Detaljerad arbetsplan:** `03-short-horizon.md`.

---

## Fas 5: Autonom drift

**Mål:** Hålla bloggen levande utan operatörens dagliga deltagande.

**Definition:** Operatören granskar `https://github.com/alfred-intelligence/aitoblog/issues` ungefär varannan vecka. Allt akut har eskalerat via mejl eller (när aktiverat) Telegram. Inga andra schemalagda aktiviteter.

**Operatörens aktiviteter (vid behov, inte schema):**

- Granska AI-inlägg sporadiskt — om kvaliteten driftar, justera prompten i `scripts/generate-post.ts` (egen PR går genom review-grinden).
- Hantera `priority:critical`-issues inom 24h enligt 05 §7.
- Återställa `data/cron-state.json` om cron pausat sig (3 fel i rad).
- Granska `drift`-issues inom 30 dagar.
- Granska PR:er med `judge-blocked`-label inom 1 vecka (om review-escalation-workflowen aktiverats).

**Klar när:** Aldrig — det är drift. Övergången sker när Fas 4 är klar.

---

## Milstolpar

**Produktdelen (Fas 1–3):**

- [x] **M1:** Repo skapat och Astro-projekt initierat
- [x] **M2:** Cloudflare Pages kopplat, första statiska sidan live
- [x] **M3:** Manuell test-post + RSS validerad
- [x] **M4:** `generate-post.ts` kör med `--dry-run`
- [x] **M5:** GitHub Action committar inlägg, Cloudflare bygger om
- [x] **M6:** Cron aktiverat, schemalagt inlägg publicerat
- [ ] **M7:** Polish klart — sajten ser presentabel ut, SECURITY.md finns

**Maintenance-delen (Fas 4):**

- [ ] **M8:** SSoT på plats, drift-mismatchen försvunnen
- [ ] **M9:** Review-grinden aktiv (`Claude Code Review / claude-review` required check), `ANTHROPIC_API_KEY` på både Actions- och Dependabot-scope
- [ ] **M10:** Auto-merge för betrodda bots aktivt, dependabot- och release-backlog rensad
- [ ] **M11:** Branch-hygien aktiv, cron härdad
- [ ] **M12:** Drift-detektor + stale-loop aktiva
- [ ] **M13:** Eskalerings-kedjan komplett (issue-flöde fungerar; Telegram förberett)

**Autonom drift (Fas 5):**

- [ ] **M14:** Fas 4 verifierat — en hel vecka utan operatör-intervention med fullt fungerande publish-cron och CI

---

## Riskbuffert

**Fas 4 är känslig på två punkter:**

1. **Review-grinden måste vara grön på dependabot-PR:er innan den görs required.** Den absolut vanligaste fallgropen är att `ANTHROPIC_API_KEY` bara sätts på Actions-scope, inte Dependabot-scope. Resultat: `startup_failure` på alla dependabot-PR:er, vilket blockerar deras merge eftersom checken aldrig rapporteras. Mitigering: Steg 3 är uppdelat så scope-fixet sker före rulesetet uppdateras till final-fas. Verifiering på testbranch krävs.

2. **Rulesetet kan låsa ute operatören om review-grinden går sönder.** Mitigering: rulesetet har bypass-actors för admin-rollen, vilket ger operatören admin-bypass i nödfall. Plus: Anthropic API-fel reflekteras som röd check på enskilda PR:er, inte som global stack-collapse — gäller bara den aktuella PR:n.

**Lägg en halv dags marginal på Fas 4.**

---

## Långsiktiga riktningar (utanför scope för nuvarande arbete)

Lyfts ur tidigare version men förblir framtidsoptioner:

- Sökfunktion (Pagefind)
- Per-tagg-RSS-feeds
- Kommentarer (Giscus)
- Notifikationer till operatören (Discord/Telegram) — *delvis förberett* i Fas 4 via Alfred-integration som no-op tills aktiverad
- Mer avancerad topic-val (släppfrekvens, GitHub trending som signal)
- Bilder / OG-tags via AI-genererade illustrationer
- Cost-monitoring av Anthropic API
- Innehållskvalitets-monitoring

Inget av detta blockerar unattended-tillståndet.
