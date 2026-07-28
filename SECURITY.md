# Säkerhetspolicy / Security Policy

## Rapportera en sårbarhet / Reporting a vulnerability

Rapportera sårbarheter privat via GitHubs **Private vulnerability reporting**:
[Security → Report a vulnerability](https://github.com/alfred-intelligence/aitoblog/security/advisories/new).
Öppna inte ett publikt issue för säkerhetsproblem.

Please report vulnerabilities privately via GitHub's private vulnerability
reporting (link above). Do not open a public issue for security problems.

Inkludera om möjligt / please include:

- Berörd fil/workflow och version eller commit
- Reproduktionssteg eller proof-of-concept
- Bedömd påverkan (t.ex. läckta secrets, kodkörning i CI)

## Svarstid / Response time

- Bekräftelse inom **7 dagar**.
- Kritiska fynd (läckta nycklar, kodkörning i workflows) hanteras enligt
  repots prioriteringsregler för `priority:critical` — åtgärd inom 24 h efter
  triage.

## Omfattning / Scope

Detta är ett template-repo för en statiskt genererad blogg (Astro +
Cloudflare Pages) med GitHub Actions-automation. Särskilt intressant att
rapportera:

- Secrets-hantering i workflows (`.github/workflows/`)
- Prompt-/innehållsinjektion i genereringspipelinen (`scripts/`)
- Beroendesårbarheter som når byggd output

## Versioner / Supported versions

Endast senaste release på `main` underhålls. Forks/instanser av templaten
ansvarar för sina egna deployer.
