import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Bookmark AI',
  tagline: 'Save a page from any browser and find it again by what it means.',
  favicon: 'img/logo.png',

  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  url: 'https://docs.bookmark-ai.cloud',
  baseUrl: '/',

  organizationName: 'Tarachand-Gupta',
  projectName: 'bookmark-ai',

  onBrokenLinks: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/', // docs-only mode — the docs ARE the site
          editUrl:
            'https://github.com/Tarachand-Gupta/bookmark-ai/tree/main/apps/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/logo.png',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Bookmark AI',
      logo: {
        alt: 'Bookmark AI',
        src: 'img/logo.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://bookmark-ai.cloud/app',
          label: 'Open the app',
          position: 'right',
        },
        {
          href: 'https://github.com/Tarachand-Gupta/bookmark-ai',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'light',
      links: [
        {
          label: 'Website',
          href: 'https://bookmark-ai.cloud',
        },
        {
          label: 'App',
          href: 'https://bookmark-ai.cloud/app',
        },
        {
          label: 'GitHub',
          href: 'https://github.com/Tarachand-Gupta/bookmark-ai',
        },
      ],
      copyright: `Bookmark AI`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
