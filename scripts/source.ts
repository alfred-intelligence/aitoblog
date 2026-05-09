import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SourcesSchema, type Source } from './schema.js';

const REPO_SHORTHAND_RE = /^[\w.-]+\/[\w.-]+$/;

function parseSourceString(raw: string): Source | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (REPO_SHORTHAND_RE.test(trimmed)) {
    const [owner, repo] = trimmed.split('/');
    return {
      type: 'repo',
      owner,
      repo,
      fullName: trimmed,
      url: `https://github.com/${owner}/${repo}`,
      key: `https://github.com/${owner}/${repo}`,
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    console.warn(`[source] Skipping malformed entry: ${trimmed}`);
    return null;
  }

  if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length >= 2) {
      const owner = segments[0];
      const repo = segments[1].replace(/\.git$/, '');
      return {
        type: 'repo',
        owner,
        repo,
        fullName: `${owner}/${repo}`,
        url: `https://github.com/${owner}/${repo}`,
        key: `https://github.com/${owner}/${repo}`,
      };
    }
  }

  return {
    type: 'article',
    url: url.toString(),
    host: url.hostname,
    key: url.toString(),
  };
}

async function readLocalSources(): Promise<unknown> {
  const path = resolve(process.cwd(), 'data/sources.json');
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

export async function fetchSources(sourcesUrl?: string): Promise<Source[]> {
  let raw: unknown;

  if (!sourcesUrl || sourcesUrl.startsWith('file://') || sourcesUrl === 'local') {
    raw = await readLocalSources();
  } else {
    const res = await fetch(sourcesUrl, {
      headers: { 'User-Agent': 'aitoblog-source-fetcher/1.0' },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch SOURCES_URL ${sourcesUrl}: ${res.status} ${res.statusText}`);
    }
    raw = await res.json();
  }

  const list = SourcesSchema.parse(raw);

  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const entry of list) {
    const parsed = parseSourceString(entry);
    if (!parsed) continue;
    if (seen.has(parsed.key)) continue;
    seen.add(parsed.key);
    sources.push(parsed);
  }

  return sources;
}
