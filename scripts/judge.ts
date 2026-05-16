import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4000;
const DIFF_CHAR_LIMIT = 200_000;

const JudgeVerdictSchema = z.object({
  verdict: z.enum(['approve', 'request_changes', 'comment']),
  summary: z.string().min(10).max(800),
  concerns: z.array(z.string()).max(8),
  suggestions: z.array(z.string()).max(8),
});

function truncate(diff: string): string {
  if (diff.length <= DIFF_CHAR_LIMIT) return diff;
  return diff.slice(0, DIFF_CHAR_LIMIT) + '\n\n[... diff truncated at ' + DIFF_CHAR_LIMIT + ' chars]';
}

async function main() {
  const diffPath = process.argv[2];
  if (!diffPath) {
    throw new Error('Usage: tsx scripts/judge.ts <diff-file>');
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY saknas i miljön.');
  }

  const prTitle = process.env.PR_TITLE ?? '(no title)';
  const prBody = process.env.PR_BODY ?? '(no body)';
  const diff = truncate(readFileSync(diffPath, 'utf-8'));
  const systemPrompt = readFileSync('.github/judge-prompt.md', 'utf-8');

  const userPrompt =
    `# PR title\n${prTitle}\n\n# PR body\n${prBody}\n\n# Diff\n\n\`\`\`diff\n${diff}\n\`\`\``;

  const client = new Anthropic({ apiKey });

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: {
      format: zodOutputFormat(JudgeVerdictSchema),
      effort: 'medium',
    },
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  if (!response.parsed_output) {
    throw new Error('Judge: model returned unparseable output');
  }

  process.stdout.write(JSON.stringify(response.parsed_output, null, 2) + '\n');
}

main().catch((err) => {
  console.error(`[judge] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
