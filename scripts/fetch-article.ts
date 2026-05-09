import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import type { ArticleSource } from './schema.js';

const ARTICLE_TEXT_MAX = 12000;
const FETCH_TIMEOUT_MS = 15_000;

export type ArticleContext = {
  url: string;
  host: string;
  title: string;
  byline: string | null;
  siteName: string | null;
  excerpt: string | null;
  content: string;
};

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[trunkerat]`;
}

function fallbackStrip(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchArticleContext(source: ArticleSource): Promise<ArticleContext> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let html: string;
  try {
    const res = await fetch(source.url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; aitoblog/1.0; +https://aitoblog.pages.dev)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${source.url}`);
    }
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const dom = new JSDOM(html, { url: source.url });
  const article = new Readability(dom.window.document).parse();

  if (article && article.textContent && article.textContent.trim().length > 200) {
    return {
      url: source.url,
      host: source.host,
      title: article.title || source.host,
      byline: article.byline ?? null,
      siteName: article.siteName ?? null,
      excerpt: article.excerpt ?? null,
      content: truncate(article.textContent.trim(), ARTICLE_TEXT_MAX),
    };
  }

  const stripped = fallbackStrip(html);
  return {
    url: source.url,
    host: source.host,
    title: dom.window.document.title || source.host,
    byline: null,
    siteName: null,
    excerpt: null,
    content: truncate(stripped, ARTICLE_TEXT_MAX),
  };
}

export function articleContextToPrompt(ctx: ArticleContext): string {
  const parts: string[] = [];
  parts.push(`# Artikel: ${ctx.title}`);
  parts.push(`Källa: ${ctx.host}`);
  parts.push(`URL: ${ctx.url}`);
  if (ctx.byline) parts.push(`Författare: ${ctx.byline}`);
  if (ctx.siteName) parts.push(`Sajt: ${ctx.siteName}`);
  if (ctx.excerpt) {
    parts.push('');
    parts.push(`Sammanfattning (extraherad): ${ctx.excerpt}`);
  }
  parts.push('');
  parts.push('## Innehåll');
  parts.push(ctx.content);
  return parts.join('\n');
}
