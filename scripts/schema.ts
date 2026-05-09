import { z } from 'zod';

export const FormatSchema = z.enum(['til', 'deep-dive', 'news']);

export const AiPostSchema = z.object({
  title: z.string().min(5).max(120),
  description: z.string().min(20).max(280),
  format: FormatSchema,
  tags: z.array(z.string()).max(8).default([]),
  body: z.string().min(200),
});
export type AiPost = z.infer<typeof AiPostSchema>;

export const PostedRecordSchema = z.record(z.string(), z.string());
export type PostedRecord = z.infer<typeof PostedRecordSchema>;

export const SourcesSchema = z.array(z.string().min(1));
export type Sources = z.infer<typeof SourcesSchema>;

export type RepoSource = {
  type: 'repo';
  owner: string;
  repo: string;
  fullName: string;
  url: string;
  key: string;
};

export type ArticleSource = {
  type: 'article';
  url: string;
  host: string;
  key: string;
};

export type Source = RepoSource | ArticleSource;
