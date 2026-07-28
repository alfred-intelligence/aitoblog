import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Justera när Cloudflare Pages-koppling är klar (ev. egen domän).
export default defineConfig({
  site: 'https://aitoblog.pages.dev',
  integrations: [sitemap()],
});
