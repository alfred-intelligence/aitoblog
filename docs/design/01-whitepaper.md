# aitoblog — Whitepaper

> En helautomatisk teknisk blogg som skriver om GitHub-repos och artiklar från en kurerad källista. Inriktning: nätverksteknik och mjukvaruutveckling. Ingen mänsklig redaktionell process — Git är källan, AI är skribenten, push är publiceringen. *Reviderad: Antaganden för fas B tillagda i §11.*

## Problem

Ägaren konsumerar mängder av tekniskt material (starrar repos på GitHub, läser artiklar) men har varken tid att skriva om det eller intresse av att kuratera/godkänna inlägg manuellt. Samtidigt finns ett värde i att producera publik teknisk text — för egen räkning (kunskap stelnar när man skriver) och för läsare med samma intressen.

Lösningen ska därför vara *passiv* för ägaren: lägg till ett repo eller en URL i en lista, och förr eller senare dyker det upp som ett blogginlägg.

## Lösning

En statisk blogg som genererar nya inlägg automatiskt enligt schema. Ett GitHub Actions-jobb kör 2–3 gånger per vecka och:

1. Hämtar källistan från en JSON-URL (`SOURCES_URL`) eller `data/sources.json`
2. Filtrerar bort källor som täckts under cooldown-perioden
3. Väljer en kandidatkälla. Om GitHub-repo: hämtar README + senaste releases/commits. Om artikel-URL: hämtar HTML och extraherar huvudinnehållet med Readability
4. Skickar materialet till Claude API med uppmaning att producera ett inlägg i lämpligt format
5. Committar markdown-filen till repot
6. Cloudflare Pages detekterar push och bygger om sajten — RSS uppdateras automatiskt

GitOps som strategi: alla inlägg lever som markdown i Git. Hela bloggens historik, inklusive AI-genererat innehåll, är versionshanterad och granskbar i efterhand.

## Arkitektur

```
┌────────────────────────────────────────────────────────────┐
│           GitHub Actions (cron mån/ons/fre 08:00 UTC)      │
│           scripts/generate-post.ts                          │
└──────┬─────────────────────────┬──────────────────┬─────────┘
       │                         │                  │
       ▼                         ▼                  ▼
┌──────────────┐         ┌───────────────┐   ┌────────────┐
│ SOURCES_URL  │         │ GitHub API /  │   │ posted.json│
│ → JSON-array │         │ HTML+         │   │ (cooldown) │
│ av repos +   │         │ Readability   │   │            │
│ artikel-URLs │         │               │   │            │
└──────┬───────┘         └───────┬───────┘   └─────┬──────┘
       └──────────┬──────────────┘                 │
                  ▼                                │
       ┌─────────────────────────┐                 │
       │ Anthropic Claude Sonnet │                 │
       │ (structured outputs)    │                 │
       └────────────┬────────────┘                 │
                    │                              │
                    ▼                              │
       ┌─────────────────────────┐                 │
       │  src/content/blog/*.md  │◄────────────────┘
       │  (frontmatter + body)   │
       └────────────┬────────────┘
                    │ git push
                    ▼
       ┌─────────────────────────┐
       │   Cloudflare Pages      │
       │   Astro build → /dist   │
       │   + /rss.xml            │
       └─────────────────────────┘
```

### Komponenter

- **Frontend (Astro)**: Statisk site, content collections för blogposts, RSS-feed via `@astrojs/rss`.
- **AI-pipeline (`scripts/generate-post.ts`)**: Node/TypeScript-script som körs i GitHub Actions, gör hela kedjan från topic-val till commit.
- **State (`data/posted.json`)**: Enkel JSON-fil i repot som spårar `sourceUrl → senaste publiceringsdatum`. Cooldown 60 dagar.
- **State (`data/cron-state.json`)**: Spårar consecutive failures + paus-flagga för publish-loopen. Se 06.
- **Hosting (Cloudflare Pages)**: Lyssnar på push till `main`, bygger Astro, deployar globalt CDN.

## Designval och motivering

| Val | Alternativ övervägda | Motivering |
|-----|---------------------|------------|
| **Astro** som SSG | Hugo, 11ty, Next.js | Native content collections för markdown, bra TypeScript-stöd, `@astrojs/rss` är trivialt, första-klass på Cloudflare Pages. |
| **Cloudflare Pages** | Vercel, Netlify, GitHub Pages | Generös free tier, native git-deploy, ägaren använder redan Cloudflare-stack. |
| **GitHub Actions** för cron | Cloudflare Workers Cron, extern scheduler | Kör i samma kontext som repot, kan committa direkt, ingen extra infra. |
| **Markdown i Git som SoT** | Headless CMS, databas | GitOps. Allt versionshanterat, granskbart, portabelt. |
| **JSON för cooldown-state** | SQLite, Redis, KV | En fil i repot räcker — `concurrency:` i workflow förhindrar race. |
| **AI väljer själv format** | Användaren godkänner per inlägg | Användaren har avstått godkännande. Naturlig variation utan extra logik. |
| **Cooldown 60 dagar** | 30 / 90 / ingen | Med 12 inlägg/månad krävs ~24 unika källor i poolen. |
| **Sonnet (inte Haiku)** | Haiku 4.5, Opus | Sonnet 4.6 ger tillräcklig kvalitet för teknisk skrivning. Operatörspreferens: aldrig Haiku. |
| **Källor utöver GitHub stars** | Endast starred repos | Generaliserat till JSON-array — repos OCH artiklar. Pipen demonstrerar båda kodvägarna utan extra setup. |

## Beroenden

- **GitHub** — repo, Actions, public API för repos.
- **Cloudflare** — Pages-projekt kopplat till repot.
- **Anthropic** — API-nyckel med kreditbalans.
- **NPM-paket**:
  - `astro`, `@astrojs/rss`
  - `@anthropic-ai/sdk`
  - `octokit`
  - `@mozilla/readability` + `jsdom`
  - `gray-matter`
  - `zod`

## Begränsningar och risker

| Risk | Sannolikhet | Mitigering |
|------|-------------|------------|
| AI producerar lågkvalitativt inlägg | Medel | Stark systemprompt med exempel. Validera frontmatter med Zod. Accepterat tradeoff. |
| Faktafel i AI-text | Hög | Inläggen markeras tydligt som AI-genererade. Disclaimer i sidfoten + per inlägg. |
| Pool av eligible källor töms | Låg om >24 källor | Fallback: least-recently-posted. Logga varning. |
| GitHub API-rate-limit | Låg | Authenticated `GITHUB_TOKEN` ger 5000 req/h; ~5 req per körning. |
| Concurrent workflow runs | Låg | `concurrency: { group: publish }`. |
| Slug-kollision | Mycket låg | `YYYY-MM-DD-<slug>` unikt per källa per dag + cooldown garanterar inte samma källa två gånger samma dag. |
| Cron pausar sig själv vid återkommande fel | — | *Avsiktligt* — se 06 Loop 3. Operatören återställer manuellt. |
| Stuck PR:er, drift mellan tooling-versioner | Var hög, nu låg | Maintenance loops i 06 eliminerar. |

## Framtida riktning (utanför scope för MVP)

- Sökfunktion (Pagefind eller liknande)
- Per-tagg-RSS-feeds
- Kommentarer (Giscus)
- Notifikation till operatören via Telegram (Alfred-integration förberedd i 06, no-op tills aktiverad)
- Mer avancerad topic-val (släppfrekvens, GitHub trending som signal)
- Mänsklig "veto"-möjlighet via PR istället för commit till main
- Bilder / OG-tags via AI-genererade illustrationer
- Cost-monitoring av Anthropic API
- Content-quality-monitoring av AI-output

---

## 11. Antaganden för fas B (registrerade)

Följande beslut låg tysta i fas A och har konkretiserats i fas B-dokumenten (`05-engineering-handbook.md`, `06-ci-cd-plan.md`, `07-agent-loop.md`). De registreras här så att kontexten finns kvar även om sessionerna byts.

| Område | Antagande | Realiserat i |
|--------|-----------|--------------|
| Strikthetsnivå | `solo` med separation-of-duties via judge-agent | 05 §1, 07 §1 |
| Licens | MIT (publikt template) | 05 §2 |
| Branch-strategi | Trunk-based, kortlivade branches, squash-only | 05 §3 |
| Commit-konventioner | Conventional Commits, commitlint-enforced | 05 §4 |
| PR-process | Implementer ≠ reviewer; judge är granskare; trustmatris styr auto-merge | 05 §5, 06 §2, 07 §3.5 |
| Releasekadens | Continuous via release-please, deterministic SemVer | 05 §6 |
| Maintenance | Autonoma kontrollslingor, inte mänsklig drift; sju loopar | 06 |
| Distribution | Publikt template-repo; konsumenter klonar via "Use this template" | 05 §9 |
| Eskaleringskanal | GitHub-issues (alltid) + Telegram via Alfred (opportunistisk, no-op tills aktiverad) | 06 §6 |
| Säkerhetspolicy | SECURITY.md, GitHub Security Advisories för sårbarhetsrapportering | 05 §8 |
| Granskningstakt | Operatören varannan vecka vid normal drift; tidsfönster per eskalering | 05 §7 |

Inga av dessa antaganden ändrar produktbeskrivningen ovan — de styr *hur* den drivs över tid.
