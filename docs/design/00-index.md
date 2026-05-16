# aitoblog — Designpaket

Designdokument för en helautomatisk AI-driven blogg med GitOps-arbetsflöde och autonoma maintenance-slingor. Levereras till Claude Code för implementation.

## Filer

**Produktdesign (fas A):**

- **`01-whitepaper.md`** — Produktbeskrivning, arkitektur, designval och motiveringar. Inkluderar §11 Antaganden för fas B.
- **`02-long-horizon.md`** — Faser och milstolpar från setup till autonom drift.
- **`03-short-horizon.md`** — Detaljerad steg-för-steg-plan för **nuvarande fas (Fas 4: maintenance loops install)**.
- **`04-agent-instructions.md`** — Instruktioner till Claude Code som implementerar projektet.

**Operationalisering (fas B):**

- **`05-engineering-handbook.md`** — Strikthetsnivå, licens, branch-strategi, commits, PR-process, release-policy, maintenance-policy, säkerhet, template-konsumtion, roller och ansvar.
- **`06-ci-cd-plan.md`** — De sju autonoma kontrollslingorna i detalj: trigger, mekanism, grind, stängning, eskalering. Trustmatris, SSoT för tooling, branch protection, eskaleringskanaler.
- **`07-agent-loop.md`** — Implementer-agentens och reviewer-agentens loopar, kommunikationskontrakt, sessions-kontinuitet, anti-mönster.

## Snabbsammanfattning

| Fält | Värde |
|------|-------|
| Stack | Astro 6 + TypeScript |
| Hosting | Cloudflare Pages |
| Innehållskälla | JSON-array av GitHub-repos + artikel-URLs |
| AI | Claude Sonnet (publish-pipen) + Claude GitHub App (PR-review) |
| Schemaläggning | GitHub Actions cron, mån/ons/fre 08:00 UTC |
| Format | Mix — AI väljer per inlägg (TIL / djupdyk / nyhetsrundup) |
| Godkännande | Inget för innehåll; Claude Code Review-grind för kod-PR:er |
| Output | Markdown i Git → push → Cloudflare Pages bygger → RSS uppdateras |
| Maintenance | Sju autonoma kontrollslingor (06) |
| Driftläge | Unattended efter Fas 4 |

## Läsordning för implementeraren

Vid sessionstart, i denna ordning:

1. `04-agent-instructions.md` — roll och guardrails (alltid först)
2. `03-short-horizon.md` — nuvarande arbetsplan (det är *härifrån* steg tas)
3. `05-engineering-handbook.md §10` — rollens får/får inte
4. `06-ci-cd-plan.md` — skannas för loop-kontext
5. `07-agent-loop.md` — loop-kontrakt (rapportformat, PR-flöde)
6. `01-whitepaper.md` — refresh av produkt vid behov
7. `02-long-horizon.md` — översiktlig referens

## Status

- ✅ Fas A (produktdesign) levererad
- ✅ Fas B (operationalisering) levererad
- 🟢 Repot bootstrapat och Fas 1+2 implementerade (se Git-historik från `05b2704`)
- 🔴 Fas 4 (maintenance loops install) återstår — se `03-short-horizon.md`
- ⏸ Fas 5 (autonom drift) aktiveras automatiskt när Fas 4 är klar
