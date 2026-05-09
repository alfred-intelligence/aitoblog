import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { AiPostSchema, type AiPost, type Source } from './schema.js';
import { repoContextToPrompt, type RepoContext } from './fetch-repo.js';
import { articleContextToPrompt, type ArticleContext } from './fetch-article.js';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 8000;

const SYSTEM_PROMPT = `Du är skribent för en teknisk blogg riktad till nätverkstekniker
och mjukvaruutvecklare. Skriv på svenska om inte källan är väsentligen
engelskspråkig — då skriv på engelska.

Du får en källa som antingen är ett GitHub-repo (med metadata, README och
senaste aktivitet) eller en webbartikel/dokumentationssida (med extraherad
text). Producera ETT inlägg och välj självständigt format:

- "til" (Today I Learned, ~200–400 ord) — om materialet är litet/specifikt
- "deep-dive" (~600–1200 ord) — om materialet är substantiellt och har djup
- "news" (~300–500 ord) — om det finns ny release / aktualitet att lyfta

Krav på output:
- "title": kort, konkret, klickbar utan att vara clickbait
- "description": 1–2 meningar som sammanfattar inläggets vinkel
- "format": en av "til" | "deep-dive" | "news"
- "tags": 2–6 relevanta tekniska taggar i kebab-case (t.ex. "rust", "edge-compute")
- "body": ren markdown utan frontmatter-fences. Du får använda kodblock,
  rubriker (h2/h3), listor och citat.

Stil:
- Var konkret. Citera korta README-fraser eller artikeltext när relevant —
  paraphrasera resten.
- Inkludera en länk till källan någonstans i brödtexten.
- Tydliggör vad materialet handlar om, vem det är för, och avsluta med en
  åsiktsbärande slutkläm.
- Ljug aldrig om funktioner — om något inte framgår av materialet, skriv det.
- Inga utfyllande fraser, inga AI-floskler, ingen meta-kommentar om att du är
  en AI.`;

function buildUserPrompt(source: Source, context: RepoContext | ArticleContext): string {
  const today = new Date().toISOString().slice(0, 10);
  const header = `Dagens datum: ${today}\nKälltyp: ${source.type}\n\n`;
  if (source.type === 'repo') {
    return header + repoContextToPrompt(context as RepoContext);
  }
  return header + articleContextToPrompt(context as ArticleContext);
}

export async function generatePost(
  source: Source,
  context: RepoContext | ArticleContext,
): Promise<AiPost> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY saknas i miljön.');
  }

  const client = new Anthropic({ apiKey });
  const userPrompt = buildUserPrompt(source, context);

  const request: Anthropic.MessageCreateParamsNonStreaming = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: {
      format: zodOutputFormat(AiPostSchema),
      effort: 'medium',
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  };

  let response = await client.messages.parse(request);

  if (!response.parsed_output) {
    console.warn('[claude] First parse failed, retrying with stricter instruction.');
    const retryRequest: Anthropic.MessageCreateParamsNonStreaming = {
      ...request,
      messages: [
        { role: 'user', content: userPrompt },
        {
          role: 'user',
          content:
            'Föregående försök matchade inte schemat. Returnera STRIKT giltig JSON enligt schemat — alla obligatoriska fält (title, description, format, tags, body) måste finnas. Inga extra fält, ingen prosa runtomkring.',
        },
      ],
    };
    response = await client.messages.parse(retryRequest);
    if (!response.parsed_output) {
      throw new Error('AI returnerade ogiltig output även efter retry. Avbryter publicering.');
    }
  }

  return response.parsed_output;
}
