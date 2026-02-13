import { defineConfig } from 'vitepress';
import { groupIconVitePlugin } from 'vitepress-plugin-group-icons';

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'hono-zod-openapi',
  description: 'OpenAPI in Hono made easy',
  vite: {
    plugins: [groupIconVitePlugin()],
  },
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'API Reference', link: '/api-reference' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'Usage', link: '/usage' },
          { text: 'Typed Responses', link: '/typed-responses' },
          { text: 'Recipes', link: '/recipes' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'API Reference', link: '/api-reference' },
          { text: 'Contributing', link: '/contributing' },
        ],
      },
    ],
    socialLinks: [
      {
        icon: 'github',
        link: 'https://github.com/paolostyle/hono-zod-openapi',
      },
    ],
    search: {
      provider: 'local',
    },
  },
  markdown: {
    theme: {
      dark: 'monokai',
      light: 'snazzy-light',
    },
  },
});
