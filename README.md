# aitoblog

Helautomatisk teknisk blogg där en AI skriver inlägg om GitHub-repos och
artiklar i en kurerad lista. Markdown-filer i Git är källan, push till `main`
triggar Cloudflare Pages-build, RSS uppdateras automatiskt. Ingen mänsklig
granskning innan publicering — det är medvetet, designen accepterar det som
priset för full automation.

## Hur det fungerar

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
       │                         │                  │
       └──────────┬──────────────┘                 │
                  ▼                                 │
       ┌──────────────────────────┐                │
       │ Anthropic Claude Sonnet  │                │
       │ (structured outputs)     │                │
       └────────────┬─────────────┘                │
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

## Källor (`SOURCES_URL` / `data/sources.json`)

Pipen läser en JSON-array av strängar. Varje sträng är antingen:

- **`"owner/repo"`** eller **`https://github.com/owner/repo`** — skriptet
  använder GitHub API och hämtar README, senaste release och senaste 5 commits.
- **valfri webb-URL** — skriptet hämtar HTML och extraherar huvudinnehållet med
  [Readability](https://github.com/mozilla/readability) (samma teknik som
  Firefox Reader View).

Default-listan i `data/sources.json` blandar båda typerna så pipen demonstrerar
båda kodvägarna utan extra setup. Byt ut den till din egen URL via repo-variabeln
`SOURCES_URL`.

Cooldown är **60 dagar** — en källa skrivs inte om innan dess. Nyckel = `sourceUrl`
i `data/posted.json`. Om alla källor är i cooldown faller pipen tillbaka på
least-recently-posted.

## Setup efter merge

### 1. Lägg in GitHub Secret + Variable

I `Settings → Secrets and variables → Actions`:

- **Secrets** → New: `ANTHROPIC_API_KEY` ([Anthropic-konsolen](https://console.anthropic.com/) →
  Settings → API Keys).
- **Variables** → New (valfri): `SOURCES_URL`. Pekar på en publik URL som returnerar en
  JSON-array enligt formatet ovan. Lämnas tom → skriptet läser `data/sources.json`
  i repot.

Doc: <https://docs.github.com/en/actions/security-guides/encrypted-secrets>

### 2. Aktivera write-permission för workflows

`Settings → Actions → General → Workflow permissions` → välj
**Read and write permissions**. Annars kan workflowen inte committa nya inlägg.

### 3. Koppla Cloudflare Pages

I Cloudflare-dashen: `Workers & Pages → Create → Pages → Connect to Git` → välj
detta repo. Build-inställningar:

| Inställning | Värde |
|-------------|-------|
| Framework preset | Astro |
| Build command | `pnpm build` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION=20` |

Doc: <https://developers.cloudflare.com/pages/framework-guides/deploy-an-astro-site/>

När bygget är klart syns sajten på `https://<projektnamn>.pages.dev`. Uppdatera
`site:` i `astro.config.mjs` om du använder annan domän.

### 4. Verifiera kedjan

```bash
# Kör utan att committa — markdown loggas
gh workflow run publish.yml -f dry_run=true

# Kör skarpt — committar inlägg, Cloudflare bygger om
gh workflow run publish.yml
```

Cron-schemat (`'0 8 * * 1,3,5'`) aktiveras automatiskt så snart workflowen finns
på `main`.

## Lokal utveckling

```bash
pnpm install
pnpm dev                 # http://localhost:4321
pnpm build               # bygg statisk site till dist/
pnpm astro check         # typecheck
```

Generera ett inlägg lokalt (kräver `ANTHROPIC_API_KEY` i `.env`):

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
pnpm tsx scripts/generate-post.ts --dry-run
pnpm tsx scripts/generate-post.ts --source=cloudflare/workers-sdk --dry-run
pnpm tsx scripts/generate-post.ts --sources-url=https://example.com/my-list.json --dry-run
```

Flaggor:
- `--dry-run` — skriver markdown till stdout, ingen fil skrivs
- `--source=<url-or-owner/repo>` — tvinga en specifik källa (måste finnas i sources)
- `--sources-url=<url>` — override `SOURCES_URL` env

## Pausa eller återuppta

- **Pausa schemat**: `Actions` → `publish` → `...` → `Disable workflow`.
- **Tillfälligt mute** utan att stänga: kommentera ut `cron`-raden i
  `.github/workflows/publish.yml` och pusha — `workflow_dispatch` finns kvar.

## Hur du justerar AI:n

- **Promptändringar**: redigera `SYSTEM_PROMPT` i `scripts/claude.ts`.
- **Annan modell**: byt `MODEL`-konstanten i `scripts/claude.ts` (t.ex.
  `claude-haiku-4-5` om du vill prova billigare).
- **Annan effort/thinking**: ändra `effort`/`thinking`-fälten i samma fil.
- **Längre/kortare inlägg**: justera ord-intervallen i systemprompten.

## Designval (kort)

| Val | Motivering |
|-----|-----------|
| Astro 5 | Native content collections + RSS via `@astrojs/rss`, native pnpm-stöd på Cloudflare Pages |
| Cloudflare Pages | Generös free tier, native git-deploy, ingen cold start |
| GitHub Actions cron | Kör i samma kontext som repot, kan committa direkt med `GITHUB_TOKEN` |
| Markdown i Git som SoT | GitOps — allt versionshanterat, granskbart, portabelt |
| JSON för cooldown-state | En fil i repot räcker — sekventiella körningar, `concurrency: publish` skyddar mot races |
| AI väljer själv format | Naturlig variation utan extra logik |
| Cooldown 60 dagar | Med 12 inlägg/månad krävs ~24 unika källor i poolen |
| Sonnet 4.6 | Bra kvalitet för teknisk skrivning till låg kostnad. Strukturerad output via Zod-schema gör validering trivial |
| Hybridkälla (repo + artikel) | Ger AI:n tillgång till READMEs/releases för repos OCH artikeltext från resten av webben — samma promptmall, olika kontextpaket |

## Begränsningar

- AI kan ha fel — varje inlägg är märkt med disclaimer både i sidfot och
  per-inlägg. Verifiera mot källan innan du citerar.
- Readability-extraktion fungerar dåligt på SPAs som renderas med JS. Sådana
  artikel-URL:er kan ge tunna inlägg eller falla — pipen rapporterar tydligt
  och cron försöker igen vid nästa fönster.
- Token-kostnaden för långa artiklar trunkeras till ~12 KB innan de skickas
  till Claude.

## Filstruktur

```
.
├── .github/workflows/publish.yml
├── astro.config.mjs
├── data/
│   ├── posted.json              # cooldown-state
│   └── sources.json             # default källista (placeholder)
├── package.json
├── public/favicon.svg
├── scripts/
│   ├── claude.ts                # Anthropic SDK + structured outputs
│   ├── fetch-article.ts         # HTML + Readability
│   ├── fetch-repo.ts            # GitHub API
│   ├── generate-post.ts         # entry point
│   ├── post-writer.ts           # skriv markdown + uppdatera posted.json
│   ├── schema.ts                # Zod-scheman + Source-typer
│   ├── source.ts                # parse SOURCES_URL → Source[]
│   └── topic-selector.ts        # cooldown-logik
├── src/
│   ├── content.config.ts
│   ├── content/blog/*.md
│   ├── layouts/{BaseLayout,BlogPost}.astro
│   ├── pages/{index.astro,blog/[...slug].astro,rss.xml.ts}
│   └── styles/global.css
└── tsconfig.json
```
