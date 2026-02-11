import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

const config: Config = {
  title: 'KubeAgentiX CE Docs',
  tagline: 'Guided Kubernetes RCA and Skill-Driven Execution',
  favicon: 'img/favicon.ico',

  url: process.env.DOCS_SITE_URL ?? 'https://kubeagentix.github.io',
  baseUrl: process.env.DOCS_BASE_URL ?? (isGitHubActions ? '/kubeagentix-ce/' : '/'),

  organizationName: 'kubeagentix',
  projectName: 'kubeagentix-ce',

  onBrokenLinks: 'warn',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
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
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    navbar: {
      title: 'KubeAgentiX CE',
      items: [
        { to: '/users/quickstart', label: 'Users', position: 'left' },
        { to: '/developers/overview', label: 'Developers', position: 'left' },
        { href: 'https://github.com/kubeagentix/kubeagentix-ce', label: 'GitHub', position: 'right' },
      ],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
