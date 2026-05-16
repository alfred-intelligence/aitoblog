# aitoblog — Agent-loop

> Detta dokument beskriver hur agenter arbetar i `aitoblog`-projektet — implementer-agentens loop, judge-agentens loop, och kommunikationskontraktet dem emellan. Reglerna i `05-engineering-handbook.md §10` är input; detta dokument är *cykeln* som realiserar dem.

---

## 1. Strikthetsnivå

**Vald nivå:** `solo` + separation of duties.

`solo` eftersom det finns en mänsklig operatör. Separation of duties eftersom implementer-agenten och judge-agenten är olika identiteter med olika scope och olika trigger-kanaler. Den invarianten gör att en `solo`-konfiguration uppfyller granskningsmål som annars hade krävt `solo+contrib`.

---

## 2. Aktörer

| Aktör | Identitet | Trigger | Persistens |
|-------|-----------|---------|------------|
| Operatör | Människa | Manuell | Mellan sessioner |
| Implementer-agent | `claude/<session-id>`-branch + chatt-session | Session start | Per session |
| Judge-agent | `github-actions[bot]` via `judge.yml` | PR-event | Per PR-händelse |
| Auto-merge-workflow | `github-actions[bot]` via `auto-merge-trusted.yml` | PR-event | Per PR-händelse |
| Release-please | `github-actions[bot]` | Push till `main` | Stateless |
| Dependabot | `dependabot[bot]` | Schemalagd (vecka) | Stateless |
| Cron-publish | `github-actions[bot]` via `publish.yml` | Schemalagd (mån/ons/fre) | State i `data/cron-state.json` |

---

## 3. Implementer-loopen

### 3.1 Loop-struktur

```
[init] → [välj nästa steg] → [exekvera] → [verifiera] → [rapportera]
                                                              ↓
                              ┌─────── [operatör godkänner / justerar]
                              ↓
                         [nästa steg]
                              ↓
                   ... tills fasens steg är slut ...
                              ↓
                    [öppna PR] → [vänta på judge] → [auto-merge sker]
                              ↓
                         [fas/milstolpe klar]
```

### 3.2 Init

Vid sessionstart läser implementer-agenten i denna ordning:

1. `01-whitepaper.md` — *vad* och *varför* (1 gång per projekt, snabb refresh per session).
2. `04-agent-instructions.md` — roll, guardrails, init-sekvens (alltid).
3. `03-short-horizon.md` — nuvarande arbetsplan (det är *här* implementeraren tar sina steg ifrån).
4. `05-engineering-handbook.md §10` — roll-policy. Förstår sina får/får inte-regler.
5. `06-ci-cd-plan.md` — endast skannas, refereras vid behov för att förstå vilken loop som triggas av en handling.
6. `02-long-horizon.md` — översiktlig referens.

`07-agent-loop.md` (denna) läses också, men dess regler är realiserade nedan så referensen är retroaktiv om något känns oklart.

Verifiering av förkrav (verktyg, secrets, konton) görs vid sessionstart. Saknas något → rapportera och vänta.

### 3.3 Cykel

**Granularitet:** Ett steg = en logiskt sammanhållen ändring (vanligen 1–5 filer). Stora steg bryts ner.

**Branch-strategi:**
- Skapa branch `claude/<descriptive-name>` när första steget i en sammanhängande PR börjar.
- Pusha efter varje verifierat steg — branchen är persistent state.
- Öppna PR först när hela det sammanhängande arbetet är klart (inte per steg). Undantag: större arbeten där delvis-PR ger värde för judge-granskning — öppna då draft-PR med label `wip`.

**Per steg:**
1. **Välj nästa steg** ur 03-short-horizon eller från operatörens uppdrag.
2. **Exekvera** — kod-ändringar, filer skapas/ändras.
3. **Verifiera lokalt** — `pnpm astro check` + `pnpm build` minst. Andra checks per steg-natur.
4. **Rapportera** till operatören enligt mallen (§3.4).
5. **Invänta godkännande** — explicit "fortsätt" eller "justera X". Vid tystnad >30 min i aktiv session: påminn en gång, sedan pausa.
6. **Nästa steg.**

### 3.4 Rapportformat per steg

Kort markdown-blob i chatten:

```markdown
**Steg X — [namn]:** [✅ klart / ⚠️ blocker / ❌ fel]

**Vad gjordes:** [1 mening]
**Filer:** [lista]
**Verifierat med:** [`pnpm astro check`, `pnpm build`, ev. annat]
**Nästa:** [namn på nästa steg, eller "väntar på godkännande"]
```

Vid blocker eller fel: lägg till sektion **Hypotes:** med rotorsaksgissning och föreslagen åtgärd.

### 3.5 PR-flöde

När en sammanhängande arbetsuppsättning är klar:

1. **Öppna PR** mot `main`. Titel följer Conventional Commits (commitlint enforced på titel).
2. **PR-beskrivning** följer mallen i `.github/PULL_REQUEST_TEMPLATE.md` — Vad / Varför / Verifiering.
3. **Vänta på checks:**
   - `ci` (typecheck + build)
   - `commitlint` (PR-titel)
   - `judge` (review-verdict)
4. **Vid `judge.verdict == approve`:** auto-merge slås på via `auto-merge-trusted.yml` (eller manuellt om implementeraren har explicit uppdrag att merga). PR mergas när alla checks gröna.
5. **Vid `judge.verdict == request_changes`:** läs concerns + suggestions från judge-kommentaren, åtgärda, pusha. Judge granskar igen.
6. **Vid `judge.verdict == comment`:** judge är osäker. Implementer-agenten ska antingen (a) lägga till tydligare PR-beskrivning som adresserar judge-concerns och pusha så judge re-evaluerar, eller (b) rapportera till operatören att mänsklig granskning behövs.

### 3.6 Eskaleringsregler

| Situation | Åtgärd |
|-----------|--------|
| Designen är otydlig | Ställ EN konkret fråga till operatören med default-förslag ("Jag tänker X om jag inte hör annat"). Vänta. |
| Verktyg saknas (förkrav) | Rapportera och pausa. Gissa inte. |
| Verifiering fail (`astro check` eller `build` röd) | Max 2 retries med åtgärd, sedan eskalera till operatör. |
| Judge `request_changes` 2 ggr i rad utan att problemet löst | Rapportera till operatör. Loopa inte i tre. |
| `judge`-workflowen själv fail (Anthropic API down etc.) | Vänta 15 min, pusha tom commit för att retrigga (eller använd `gh workflow run`). Om fortfarande fail: rapportera. |
| Förändring kräver avvikelse från 05/06 | Stoppa, dokumentera i `DECISIONS.md`, fråga operatör innan fortsatt. |

### 3.7 Termineringsvillkor

| Nivå | "Klart" betyder |
|------|-----------------|
| Steg | Verifierat lokalt + rapporterat + operatör godkänd |
| PR | Mergad (judge approve + CI grön + auto-merge slog till) |
| Fas | Alla PR:er i fasen mergade, CI grön på `main`, milstolpa-villkor från 02 uppfyllt |
| Projekt | Aldrig — kontinuerlig drift via cron-publish-loopen |

---

## 4. Judge-loopen

### 4.1 Trigger och scope

**Triggas på:** `pull_request: [opened, synchronize, reopened]`.

**Skippas när:**
- `github.actor == 'dependabot[bot]'`
- `github.actor == 'github-actions[bot]'`
- Branch matchar `release-please--*`

### 4.2 Cykel

```
[pull_request-event] → [checkout + diff] → [Anthropic API-anrop]
                                                    ↓
                                           [parsa JSON-respons]
                                                    ↓
                                  [posta review via gh pr review]
                                                    ↓
                                       [sätt judge-status check]
```

Detta är en *händelse*-driven loop, inte en cyklisk. Varje PR-uppdatering → en judge-körning.

### 4.3 Prompt-template

Prompten lever som separat fil `.github/judge-prompt.md` så den itereras utan workflow-ändring. Implementer-agenten producerar första versionen som artefakt; operatören kan editera direkt.

**Innehåll (sammanfattning av krav på prompten):**

- Förklarar judge-rollen: granskning, inte implementation. Implementer ≠ judge.
- Definierar verdict-trösklarna (när approve, när request_changes, när comment).
- Specifikt: secrets i diff, ny dependency utan motivering, permissions-utvidgning, scope-expansion, regressionsrisk = `request_changes`.
- Domänlogik som inte kan verifieras utan körning = `comment` (osäker).
- Returnerar strikt JSON: `{verdict, summary, concerns[], suggestions[]}`.

Detaljerad prompt skrivs i Fas 4 Steg 2 (se 03-short-horizon).

### 4.4 Output-kontrakt

Judge-svaret PARSAS som:

```json
{
  "verdict": "approve" | "request_changes" | "comment",
  "summary": "<2 meningar prosa>",
  "concerns": ["<sträng>", ...],
  "suggestions": ["<sträng>", ...]
}
```

Workflowen postar reviewen via `gh pr review`:

| Verdict | gh-flagga | Status check `judge` |
|---------|-----------|----------------------|
| `approve` | `--approve` | success |
| `request_changes` | `--request-changes` | failure (blockerar merge) |
| `comment` | `--comment` | neutral (blockerar inte) |

### 4.5 Eskaleringsregler

| Situation | Åtgärd |
|-----------|--------|
| Anthropic API fail | Retry 1 gång efter 30 s. Vid fortsatt fail: status = neutral, kommentar "judge unavailable, manual review needed". Workflowen exit 0 (blockerar inte merge — det är operatörens beslut då). |
| JSON-parsing fail | Retry 1 gång med skärpt prompt-instruktion. Vid fortsatt fail: samma som ovan — neutral + kommentar. |
| 2 `request_changes` i rad på samma PR utan branch-titel-ändring | Workflowen lägger label `judge-blocked`, taggar i kommentar "@operatör manuell review rekommenderas". |
| PR > 50 000 tokens diff | Trunkera och nämn i review-kommentaren att judge såg en trunkerad version. |

### 4.6 Termineringsvillkor

En judge-körning terminerar när review är postad och status check är satt. Det är inte en kontinuerlig loop — den vaknar per event och somnar igen.

---

## 5. Kommunikationskontrakt

Hela koordinationen mellan aktörer sker genom artefakter i GitHub, inte direkt agent-till-agent. Det betyder att tillståndet alltid är observerbart och persistent.

| Kanal | Producent | Konsument | Innehåll |
|-------|-----------|-----------|----------|
| PR-titel | Implementer | commitlint, release-please, judge, operatör | Conventional Commit-formatterat sammanfattning |
| PR-beskrivning | Implementer | judge, operatör | Vad / Varför / Verifiering |
| PR-review-kommentar | Judge | Implementer, operatör | Verdict + concerns + suggestions |
| Status check `judge` | Judge | Branch protection | success / failure / neutral |
| Status check `ci` | CI-workflow | Branch protection | success / failure |
| Labels på PR | Olika | Stale-loop, auto-merge, operatör | Tillståndssignaler (`wip`, `keep`, `judge-blocked`, `needs-judge` etc.) |
| Issues | Eskalerings-workflows, operatör | Operatör | Eskaleringar |
| `data/cron-state.json` | Cron-publish | Cron-publish (nästa körning), operatör | Sekventiellt tillstånd för publish-loopen |
| `data/posted.json` | Cron-publish | Cron-publish (nästa körning) | Cooldown-spårning |
| Chatt | Operatör + implementer | Varandra | Realtid under session |

**Regel:** Ingen aktör läser en annan aktörs *interna* tillstånd. Implementer kan inte läsa judges arbete — bara dess output (review-kommentar). Judge kan inte läsa implementerns chatt-historik — bara dess output (PR-diff + beskrivning). Operatören kan läsa alla artefakter men interagerar primärt via chatt (med implementer), labels och PR-godkännande.

---

## 6. Sessions-kontinuitet

Implementer-sessioner kan vara kortare än en hel fas. Mellan sessioner försvinner agentens minne. Persistensen lever i:

| Persistent state | Var |
|------------------|-----|
| Pågående arbete | Branch `claude/*` på origin |
| Senaste rapporterade steg | Senaste commit-message på branchen |
| Operatörens senaste godkännande | Implicit i att branchen pushats / PR öppnats |
| Cron-publish-state | `data/cron-state.json` |
| Postade-källor-cooldown | `data/posted.json` |
| Designval och deras motivering | `docs/design/*.md` |

**Sessionsstart efter avbrott:**

1. Identifiera vilken branch som var aktiv (operatören anger, eller agenten listar `claude/*`-branches via `gh`).
2. Pull branchen lokalt.
3. Läs senaste commit-message + senaste rapport i chatt-historik (om sessionen återupptas).
4. Avgör nästa steg från 03-short-horizon eller från senaste rapport.
5. Fortsätt.

Vid total session-förlust (ny chatt, ingen historik): agenten läser branchens commits och PR-beskrivningen (om PR öppnats) som rekonstruktion av kontext.

---

## 7. Operatörens roll i loopen

Operatörens närvaro krävs:

- Vid sessionsstart (godkänna förkrav, ge första uppdraget).
- Per steg vid aktiv session (kort godkännande "fortsätt" eller justering).
- Vid eskalerings-labels enligt 05 §7 (tidsfönster per kategori).

Operatören krävs *inte*:

- För att merga PR:er som passerar judge + CI (auto-merge sker).
- För att hantera dependabot patch/minor (auto-merge sker).
- För att skära releaser (release-please + auto-merge).
- För daglig drift (cron + looparna i 06 hanterar).

Detta är vad "unattended" betyder för aitoblog: operatörens närvaro är *nödvändig* vid eskaleringar och vid medvetna arbetstoppar, *frivillig* annars.

---

## 8. Anti-mönster (vad loopen inte är)

- **Implementer godkänner sin egen PR** — invarianten bryts. Branch protection ska blockera detta men låt det inte ens prövas.
- **Judge skriver kod till repot** — bryter scope. Judge granskar; implementer implementerar.
- **Operatören mergar utan att judge passat** — i nödläge är det tekniskt möjligt via admin-bypass, men ska dokumenteras i `DECISIONS.md` när det sker.
- **Agenten ändrar i 05/06/07 utan explicit uppdrag** — designdokumenten är inte arbetsmaterial för implementer-rollen.
- **Mer än en agent samtidigt på samma branch** — branch är persistent state per implementer-session. Två samtidiga sessioner på samma branch leder till merge-konflikter och förlorat arbete.
- **Loop utan terminering** — varje cykel (steg, PR, review) har ett tydligt slut. Implementer-agenten *stannar* när rapporten är skickad och väntar.
