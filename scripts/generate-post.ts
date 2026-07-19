import { config as loadEnv } from 'dotenv';
import { fetchSources } from './source.js';
import { selectCandidate } from './topic-selector.js';
import { fetchRepoContext } from './fetch-repo.js';
import { fetchArticleContext } from './fetch-article.js';
import { generatePost } from './claude.js';
import { buildMarkdown, readPosted, writePost } from './post-writer.js';
import { withRetry } from './retry.js';
import { markSuccess, readState } from './cron-state.js';
import type { Source } from './schema.js';

loadEnv();

type Args = {
  dryRun: boolean;
  sourcesUrl?: string;
  forcedSource?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false };
  for (const raw of argv.slice(2)) {
    if (raw === '--dry-run' || raw === '-n') {
      args.dryRun = true;
    } else if (raw.startsWith('--sources-url=')) {
      args.sourcesUrl = raw.slice('--sources-url='.length);
    } else if (raw.startsWith('--source=')) {
      args.forcedSource = raw.slice('--source='.length);
    } else {
      console.warn(`[generate-post] Ignoring unknown arg: ${raw}`);
    }
  }
  return args;
}

async function resolveSource(args: Args): Promise<Source> {
  const sourcesUrl = args.sourcesUrl ?? process.env.SOURCES_URL;
  const sources = await withRetry('fetchSources', () => fetchSources(sourcesUrl));

  if (args.forcedSource) {
    const target = args.forcedSource;
    const match = sources.find(
      (s) =>
        s.url === target ||
        s.key === target ||
        (s.type === 'repo' && s.fullName === target),
    );
    if (!match) {
      throw new Error(
        `--source=${target} hittades inte i sources-listan. Lägg till den i data/sources.json först.`,
      );
    }
    return match;
  }

  const posted = await readPosted();
  return selectCandidate(sources, posted);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const state = await readState();
  if (state.paused) {
    // Belt-and-braces — workflowens gate-steg ska ha stoppat innan hit.
    throw new Error(
      'Cron är pausad (data/cron-state.json paused=true). Återställ filen för att återuppta.',
    );
  }

  const source = await resolveSource(args);
  console.log(`[generate-post] Selected source (${source.type}): ${source.url}`);

  const context =
    source.type === 'repo'
      ? await withRetry('fetchRepoContext', () => fetchRepoContext(source))
      : await withRetry('fetchArticleContext', () => fetchArticleContext(source));
  console.log(
    `[generate-post] Context fetched (${
      source.type === 'repo' ? 'GitHub API' : 'HTML + Readability'
    }).`,
  );

  const aiPost = await withRetry('generatePost', () => generatePost(source, context));
  console.log(`[generate-post] AI returned format=${aiPost.format} title="${aiPost.title}"`);

  if (args.dryRun) {
    const built = buildMarkdown(source, aiPost);
    console.log('--- DRY RUN ---');
    console.log(`Path: ${built.path}`);
    console.log('---');
    console.log(built.markdown);
    return;
  }

  const written = await writePost(source, aiPost);
  console.log(`[generate-post] Wrote ${written.path}`);

  // Failure räknas i workflowens failure-steg (cron-state.ts CLI), inte här —
  // så att fel utanför scriptet också fångas och inget dubbelräknas.
  await markSuccess();
  console.log('[generate-post] cron-state: success markerad.');
}

main().catch((err) => {
  console.error('[generate-post] Failed:', err);
  process.exitCode = 1;
});
