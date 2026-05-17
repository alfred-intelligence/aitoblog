# aitoblog

[![CI](https://github.com/alfred-intelligence/aitoblog/actions/workflows/ci.yml/badge.svg)](https://github.com/alfred-intelligence/aitoblog/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Deploy to Cloudflare Pages](https://img.shields.io/badge/Deploy%20to-Cloudflare%20Pages-F38020?logo=cloudflare&logoColor=white)](https://dash.cloudflare.com/?to=/:account/pages/new/provider/github)

A fully automated technical blog where an AI writes posts about GitHub repos and
articles from a curated list. Markdown files in Git are the source of truth, a push
to `main` triggers a Cloudflare Pages build, and RSS is updated automatically. No
human review before publishing — this is intentional; the design accepts it as the
price of full automation.

## Use as a template

Click **"Use this template"** at the top of the GitHub page (or clone manually)
to create your own repo. Then set up Cloudflare Pages and secrets as described in
[Setup after merge](#setup-after-merge) below.

Template updates are not pulled automatically — when this repo is updated you can
cherry-pick the changes you want into your clone.

## How it works

```
┌────────────────────────────────────────────────────────────┐
│           GitHub Actions (cron Mon/Wed/Fri 08:00 UTC)      │
│           scripts/generate-post.ts                          │
└──────┬─────────────────────────┬──────────────────┬─────────┘
       │                         │                  │
       ▼                         ▼                  ▼
┌──────────────┐         ┌───────────────┐   ┌────────────┐
│ SOURCES_URL  │         │ GitHub API /  │   │ posted.json│
│ → JSON array │         │ HTML+         │   │ (cooldown) │
│ of repos +   │         │ Readability   │   │            │
│ article URLs │         │               │   │            │
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

## Sources (`SOURCES_URL` / `data/sources.json`)

The pipeline reads a JSON array of strings. Each string is either:

- **`"owner/repo"`** or **`https://github.com/owner/repo`** — the script uses
  the GitHub API and fetches the README, latest release, and the 5 most recent commits.
- **any web URL** — the script fetches the HTML and extracts the main content using
  [Readability](https://github.com/mozilla/readability) (the same technique used by
  Firefox Reader View).

The default list in `data/sources.json` mixes both types so the pipeline demonstrates
both code paths without extra setup. Replace it with your own URL via the repo variable
`SOURCES_URL`.

Cooldown is **60 days** — a source will not be rewritten before then. The key is
`sourceUrl` in `data/posted.json`. If all sources are in cooldown the pipeline falls
back to the least-recently-posted source.

## Setup after merge

### 1. Add a GitHub Secret + Variable

In `Settings → Secrets and variables → Actions`:

- **Secrets** → New: `ANTHROPIC_API_KEY` ([Anthropic console](https://console.anthropic.com/) →
  Settings → API Keys).
- **Variables** → New (optional): `SOURCES_URL`. Points to a public URL that returns a
  JSON array in the format described above. Leave empty → the script reads
  `data/sources.json` from the repo.

Docs: <https://docs.github.com/en/actions/security-guides/encrypted-secrets>

### 2. Enable write permissions for workflows

`Settings → Actions → General → Workflow permissions` → select
**Read and write permissions**. Otherwise the workflow cannot commit new posts.

### 3. Connect Cloudflare Pages

In the Cloudflare dashboard: `Workers & Pages → Create → Pages → Connect to Git` →
select this repo. Build settings:

| Setting | Value |
|---------|-------|
| Framework preset | Astro |
| Build command | `pnpm build` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION=20` |

Docs: <https://developers.cloudflare.com/pages/framework-guides/deploy-an-astro-site/>

Once the build is complete the site will be available at
`https://<project-name>.pages.dev`. Update `site:` in `astro.config.mjs` if you are
using a different domain.

### 4. Verify the pipeline

```bash
# Run without committing — markdown is logged to stdout
gh workflow run publish.yml -f dry_run=true

# Run for real — commits posts, Cloudflare rebuilds
gh workflow run publish.yml
```

The cron schedule (`'0 8 * * 1,3,5'`) activates automatically as soon as the workflow
exists on `main`.

## Local development

```bash
pnpm install
pnpm dev                 # http://localhost:4321
pnpm build               # build static site to dist/
pnpm astro check         # typecheck
```

Generate a post locally (requires `ANTHROPIC_API_KEY` in `.env`):

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
pnpm tsx scripts/generate-post.ts --dry-run
pnpm tsx scripts/generate-post.ts --source=cloudflare/workers-sdk --dry-run
pnpm tsx scripts/generate-post.ts --sources-url=https://example.com/my-list.json --dry-run
```

Flags:
- `--dry-run` — writes markdown to stdout, no file is written
- `--source=<url-or-owner/repo>` — force a specific source (must exist in sources)
- `--sources-url=<url>` — override the `SOURCES_URL` env variable

## Pause or resume

- **Pause the schedule**: `Actions` → `publish` → `...` → `Disable workflow`.
- **Temporary mute** without disabling: comment out the `cron` line in
  `.github/workflows/publish.yml` and push — `workflow_dispatch` remains available.

## How to tune the AI

- **Prompt changes**: edit `SYSTEM_PROMPT` in `scripts/claude.ts`.
- **Different model**: change the `MODEL` constant in `scripts/claude.ts` (e.g.
  `claude-haiku-4-5` if you want to try a cheaper option).
- **Different effort/thinking**: change the `effort`/`thinking` fields in the same file.
- **Longer/shorter posts**: adjust the word-count intervals in the system prompt.

## Design decisions (brief)

| Decision | Rationale |
|----------|-----------|
| Astro 5 | Native content collections + RSS via `@astrojs/rss`, native pnpm support on Cloudflare Pages |
| Cloudflare Pages | Generous free tier, native git-deploy, no cold starts |
| GitHub Actions cron | Runs in the same context as the repo, can commit directly with `GITHUB_TOKEN` |
| Markdown in Git as SoT | GitOps — everything versioned, reviewable, and portable |
| JSON for cooldown state | One file in the repo is enough — sequential runs, `concurrency: publish` protects against races |
| AI chooses its own format | Natural variation without extra logic |
| 60-day cooldown | With 12 posts/month you need ~24 unique sources in the pool |
| Sonnet 4.6 | Good quality for technical writing at low cost. Structured output via Zod schema makes validation trivial |
| Hybrid source (repo + article) | Gives the AI access to READMEs/releases for repos AND article text from the rest of the web — same prompt template, different context packages |

## Limitations

- The AI can be wrong — every post is marked with a disclaimer both in the footer and
  per post. Verify against the source before citing.
- Readability extraction works poorly on SPAs rendered with JS. Such article URLs may
  produce thin posts or fail entirely — the pipeline reports this clearly and the cron
  will retry at the next window.
- Token cost for long articles is truncated to ~12 KB before being sent to Claude.

## Contributing

Use [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`,
`chore:`, `docs:`, etc. This drives the release-please pipeline which handles versions
and `CHANGELOG.md` automatically.

A commitlint check (GitHub Action) blocks PRs where commit messages do not follow the
convention. A local Husky hook provides the same feedback before pushing — activated
automatically on `pnpm install`.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide.

## License

[MIT](./LICENSE) © Alfred Intelligence

## File structure

```
.
├── .github/
│   ├── ISSUE_TEMPLATE/          # bug + feature templates
│   ├── workflows/
│   │   ├── ci.yml               # typecheck + build on PRs
│   │   ├── commitlint.yml       # blocks non-conventional commits
│   │   ├── publish.yml          # cron → AI → commit
│   │   └── release-please.yml   # auto-changelog + tags
│   ├── dependabot.yml
│   └── pull_request_template.md
├── .husky/commit-msg            # local commit-format validation
├── astro.config.mjs
├── data/
│   ├── posted.json              # cooldown state
│   └── sources.json             # default source list (placeholder)
├── package.json
├── public/favicon.svg
├── scripts/
│   ├── claude.ts                # Anthropic SDK + structured outputs
│   ├── fetch-article.ts         # HTML + Readability
│   ├── fetch-repo.ts            # GitHub API
│   ├── generate-post.ts         # entry point
│   ├── post-writer.ts           # write markdown + update posted.json
│   ├── schema.ts                # Zod schemas + Source types
│   ├── source.ts                # parse SOURCES_URL → Source[]
│   └── topic-selector.ts        # cooldown logic
├── src/
│   ├── content.config.ts
│   ├── content/blog/*.md
│   ├── layouts/{BaseLayout,BlogPost}.astro
│   ├── pages/{index.astro,blog/[...slug].astro,rss.xml.ts}
│   └── styles/global.css
└── tsconfig.json
```
