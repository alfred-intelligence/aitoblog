# Contributing to aitoblog

Tack för att du vill bidra. Det här dokumentet täcker allt du behöver för att
skicka en PR som blir mergebar.

## Komma igång lokalt

Krav: Node ≥ 20, [pnpm](https://pnpm.io/installation) ≥ 9, git.

```bash
git clone https://github.com/alfred-intelligence/aitoblog.git
cd aitoblog
pnpm install            # installerar deps + aktiverar Husky-hooks
pnpm dev                # http://localhost:4321
pnpm astro check        # typecheck
pnpm build              # statisk bygg till dist/
```

För att testa AI-genereringen lokalt:

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
pnpm tsx scripts/generate-post.ts --dry-run
```

## Conventional Commits — krav

**Alla commits måste följa
[Conventional Commits 1.0.0](https://www.conventionalcommits.org/).**
Detta är inte en stilfråga — release-please-pipen läser commit-meddelandena
för att avgöra version-bump och generera CHANGELOG.md. En PR med felformaterade
commits kommer **blockeras av CI** (commitlint kör som GitHub Action på alla
PRs och kan inte bypassas).

Format: `<type>[optional scope]: <description>`

Vanliga types:

| Type | Effekt på release | Exempel |
|------|-------------------|---------|
| `feat:` | minor bump (`0.2.0` → `0.3.0`) | `feat: add support for atom feeds` |
| `fix:` | patch bump (`0.2.0` → `0.2.1`) | `fix: handle missing README on archived repos` |
| `feat!:` eller `BREAKING CHANGE:` i body | major bump (`0.x` → `1.0`) | `feat!: drop Node 18 support` |
| `chore:` | ingen | `chore: bump dev deps` |
| `docs:` | ingen | `docs: clarify setup steps` |
| `refactor:` | ingen | `refactor: extract source parser` |
| `test:` | ingen | `test: add coverage for cooldown logic` |
| `ci:` | ingen | `ci: cache pnpm store` |
| `build:` | ingen | `build: switch to pnpm 10` |
| `perf:` | patch bump | `perf: trim README before sending to Claude` |

Lokalt aktiveras en Husky-hook som validerar commits innan de skapas. Den
kommer från `prepare`-scriptet som körs vid `pnpm install`. Om du använder
en git-klient som hoppar hooks (eller kör med `--no-verify`) kommer
GitHub Action-grinden ändå fånga upp det.

## PR-flödet

1. **Forka eller branscha**: `git checkout -b feat/short-description`.
2. **Implementera** ändringen. Kör `pnpm astro check` och `pnpm build` lokalt.
3. **Committa** med korrekt format (se ovan).
4. **Pusha** och öppna PR mot `main`.
5. **CI-checkar**: `ci.yml` (typecheck + build) och `commitlint.yml` måste vara
   gröna innan merge är möjlig.
6. **Granskning**: vänta på review. Var redo att rebasea om main har gått
   framåt.

## Områden där bidrag är extra välkomna

- Stylingvarianter (light theme, alternativa typsnitt) som kan väljas via en
  config-flag.
- Ytterligare källtyper (RSS-feeds som källa, YouTube-transcripts via API).
- Bättre cooldown-logik (släppfrekvens, GitHub trending som signal).
- Sökfunktion (Pagefind eller liknande).
- Per-tagg-RSS-feeds.
- I18n för svenska/engelska-prompten.

Stora ändringar — öppna gärna en issue först för att diskutera approach innan
du investerar tid i implementation.

## Code of Conduct

Detta projekt följer [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md). Genom
att bidra accepterar du dess villkor.

## Licens

Bidrag licensieras under projektets [MIT-licens](./LICENSE).
