# Copilot instructions for `aitoblog`

## Build, check, and validation commands

This repo uses **pnpm** (locked to `pnpm@10` in `package.json`).

```bash
# Install dependencies
corepack pnpm install --frozen-lockfile

# Type/content checks (Astro)
corepack pnpm astro check
# or
corepack pnpm check

# Production build (includes astro check)
corepack pnpm build

# Local dev server
corepack pnpm dev
```

There is currently **no unit/integration test runner** configured (no Jest/Vitest test suite).  
For targeted validation of the content-generation pipeline, run the generator in dry-run mode:

```bash
# "Single-case" pipeline run without writing files
corepack pnpm tsx scripts/generate-post.ts --source=cloudflare/workers-sdk --dry-run
```

## High-level architecture

The project has two coupled parts: a static Astro site and an automated content-generation pipeline.

1. **Static site layer (Astro content collections)**  
   - `src/content.config.ts` defines the frontmatter contract for blog posts (`format`, `sourceType`, `sourceUrl`, `aiGenerated`, etc.).  
   - `src/pages/index.astro` and `src/pages/blog/[...slug].astro` render collection entries.  
   - `src/pages/rss.xml.ts` builds RSS directly from the same collection.

2. **AI generation pipeline (scripts/)**  
   - Entry point: `scripts/generate-post.ts`.  
   - Sources are normalized in `scripts/source.ts` from `SOURCES_URL` (or fallback `data/sources.json`) into typed `Source` values.  
   - Candidate selection uses cooldown logic in `scripts/topic-selector.ts` backed by `data/posted.json` (60-day cooldown by `source.key`).  
   - Context fetch is split by source type: `scripts/fetch-repo.ts` (GitHub API) and `scripts/fetch-article.ts` (HTML + Readability).  
   - AI generation is in `scripts/claude.ts` with Zod-validated structured output (`scripts/schema.ts`).  
   - `scripts/post-writer.ts` writes `src/content/blog/<date>-<slug>.md` and updates `data/posted.json`.

3. **Automation layer (GitHub Actions)**  
   - `.github/workflows/publish.yml` runs the generator on cron/manual dispatch, then commits only `src/content/blog/` and `data/posted.json`.  
   - `.github/workflows/ci.yml` enforces `pnpm astro check` + `pnpm build` on PRs/pushes to `main`.  
   - `.github/workflows/commitlint.yml` enforces Conventional Commits on PR commit history.

## Key repository conventions

- **Frontmatter is a strict interface shared across scripts and Astro.**  
  Keep `scripts/schema.ts`, `scripts/post-writer.ts`, and `src/content.config.ts` aligned when changing post fields.

- **Source identity is canonicalized and reused as state key.**  
  Repos become canonical `https://github.com/owner/repo`; cooldown tracking keys off `source.key`.  
  Changing source normalization impacts deduplication and cooldown behavior.

- **`--source=` must already exist in the source list.**  
  `scripts/generate-post.ts` rejects forced sources not present in `data/sources.json`/`SOURCES_URL`.

- **Swedish-first product voice and AI disclosure are intentional.**  
  Default UX copy is Swedish (`src/layouts/*`, README, prompts), and AI-generated content must keep explicit disclaimer behavior.

- **Conventional Commits are required for merge/release flow.**  
  Commitlint + release-please depend on correct commit format (`feat:`, `fix:`, `docs:`, etc.).

- **Publish workflow commit shape matters.**  
  Automation commits staged changes for generated posts + cooldown state only; avoid unrelated writes in generation paths.
