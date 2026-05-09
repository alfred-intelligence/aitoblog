import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    format: z.enum(['til', 'deep-dive', 'news']),
    sourceType: z.enum(['repo', 'article', 'docs']),
    sourceUrl: z.string().url(),
    sourceTitle: z.string(),
    sourceRepo: z.string().optional(),
    tags: z.array(z.string()).default([]),
    aiGenerated: z.boolean().default(true),
  }),
});

export const collections = { blog };
