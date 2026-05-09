import { Octokit } from 'octokit';
import type { RepoSource } from './schema.js';

export type RepoContext = {
  metadata: {
    fullName: string;
    description: string | null;
    language: string | null;
    stargazers: number;
    topics: string[];
    homepage: string | null;
    htmlUrl: string;
  };
  readme: string;
  latestRelease: { name: string; publishedAt: string; body: string } | null;
  recentCommits: Array<{ sha: string; message: string; date: string | null }>;
};

const README_MAX = 8000;
const RELEASE_BODY_MAX = 2000;
const COMMIT_MESSAGE_MAX = 240;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[trunkerat]`;
}

export async function fetchRepoContext(source: RepoSource): Promise<RepoContext> {
  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
    userAgent: 'aitoblog/1.0',
  });

  const { owner, repo } = source;

  const repoResp = await octokit.rest.repos.get({ owner, repo });
  const data = repoResp.data;

  let readme = '';
  try {
    const readmeResp = await octokit.rest.repos.getReadme({
      owner,
      repo,
      mediaType: { format: 'raw' },
    });
    readme = String(readmeResp.data ?? '');
  } catch {
    readme = '(README ej tillgänglig)';
  }

  let latestRelease: RepoContext['latestRelease'] = null;
  try {
    const rel = await octokit.rest.repos.getLatestRelease({ owner, repo });
    latestRelease = {
      name: rel.data.name ?? rel.data.tag_name,
      publishedAt: rel.data.published_at ?? rel.data.created_at ?? '',
      body: truncate(rel.data.body ?? '', RELEASE_BODY_MAX),
    };
  } catch {
    latestRelease = null;
  }

  const commits = await octokit.rest.repos.listCommits({
    owner,
    repo,
    per_page: 5,
  });
  const recentCommits = commits.data.map((c) => ({
    sha: c.sha.slice(0, 7),
    message: truncate((c.commit.message ?? '').split('\n')[0], COMMIT_MESSAGE_MAX),
    date: c.commit.author?.date ?? null,
  }));

  return {
    metadata: {
      fullName: source.fullName,
      description: data.description,
      language: data.language,
      stargazers: data.stargazers_count,
      topics: data.topics ?? [],
      homepage: data.homepage,
      htmlUrl: data.html_url,
    },
    readme: truncate(readme, README_MAX),
    latestRelease,
    recentCommits,
  };
}

export function repoContextToPrompt(ctx: RepoContext): string {
  const parts: string[] = [];
  parts.push(`# Repository: ${ctx.metadata.fullName}`);
  if (ctx.metadata.description) parts.push(`Beskrivning: ${ctx.metadata.description}`);
  if (ctx.metadata.language) parts.push(`Primärt språk: ${ctx.metadata.language}`);
  parts.push(`Stjärnor: ${ctx.metadata.stargazers}`);
  if (ctx.metadata.topics.length) parts.push(`Topics: ${ctx.metadata.topics.join(', ')}`);
  if (ctx.metadata.homepage) parts.push(`Hemsida: ${ctx.metadata.homepage}`);
  parts.push(`URL: ${ctx.metadata.htmlUrl}`);
  parts.push('');
  parts.push('## README');
  parts.push(ctx.readme);
  if (ctx.latestRelease) {
    parts.push('');
    parts.push(`## Senaste release: ${ctx.latestRelease.name} (${ctx.latestRelease.publishedAt})`);
    parts.push(ctx.latestRelease.body);
  }
  if (ctx.recentCommits.length) {
    parts.push('');
    parts.push('## Senaste commits');
    for (const c of ctx.recentCommits) {
      parts.push(`- ${c.sha} — ${c.message}${c.date ? ` (${c.date})` : ''}`);
    }
  }
  return parts.join('\n');
}
