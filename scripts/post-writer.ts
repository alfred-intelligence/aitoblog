import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import matter from 'gray-matter';
import { PostedRecordSchema, type AiPost, type PostedRecord, type Source } from './schema.js';

const POSTED_PATH = resolve(process.cwd(), 'data/posted.json');
const BLOG_DIR = resolve(process.cwd(), 'src/content/blog');

const MAX_SLUG_LEN = 64;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LEN) || 'post';
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function deriveSlugBase(source: Source, ai: AiPost): string {
  if (source.type === 'repo') return slugify(source.repo);
  const fromTitle = slugify(ai.title);
  if (fromTitle && fromTitle !== 'post') return fromTitle;
  return slugify(source.host);
}

function deriveSourceTitle(source: Source): string {
  if (source.type === 'repo') return source.fullName;
  return source.host;
}

function deriveSourceType(source: Source, ai: AiPost): 'repo' | 'article' | 'docs' {
  if (source.type === 'repo') return 'repo';
  if (/\.dev\b|\bdocs\.|\/docs\//i.test(source.url) || ai.tags.includes('docs')) {
    return 'docs';
  }
  return 'article';
}

export async function readPosted(): Promise<PostedRecord> {
  if (!existsSync(POSTED_PATH)) return {};
  const raw = await readFile(POSTED_PATH, 'utf8');
  if (!raw.trim()) return {};
  return PostedRecordSchema.parse(JSON.parse(raw));
}

async function writePosted(record: PostedRecord): Promise<void> {
  const json = `${JSON.stringify(record, Object.keys(record).sort(), 2)}\n`;
  await writeFile(POSTED_PATH, json, 'utf8');
}

export type WrittenPost = {
  slug: string;
  path: string;
  markdown: string;
};

export function buildMarkdown(source: Source, ai: AiPost): WrittenPost {
  const date = todayIso();
  const slugBase = deriveSlugBase(source, ai);
  const slug = `${date}-${slugBase}`;
  const sourceType = deriveSourceType(source, ai);

  const frontmatter: Record<string, unknown> = {
    title: ai.title,
    description: ai.description,
    pubDate: date,
    format: ai.format,
    sourceType,
    sourceUrl: source.url,
    sourceTitle: deriveSourceTitle(source),
    tags: ai.tags,
    aiGenerated: true,
  };
  if (source.type === 'repo') {
    frontmatter.sourceRepo = source.fullName;
  }

  const markdown = matter.stringify(`\n${ai.body.trim()}\n`, frontmatter);
  const path = resolve(BLOG_DIR, `${slug}.md`);
  return { slug, path, markdown };
}

export async function writePost(source: Source, ai: AiPost): Promise<WrittenPost> {
  const built = buildMarkdown(source, ai);
  await mkdir(dirname(built.path), { recursive: true });
  await writeFile(built.path, built.markdown, 'utf8');

  const posted = await readPosted();
  posted[source.key] = todayIso();
  await writePosted(posted);

  return built;
}
