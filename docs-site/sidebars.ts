import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Users',
      items: [
        'users/quickstart',
        'users/guided-rca',
        'users/skills-runbooks',
        'users/terminal-natural-language',
      ],
    },
    {
      type: 'category',
      label: 'Developers',
      items: [
        'developers/overview',
        'developers/api-reference',
        'developers/spec-driven-development',
        'developers/runtime-architecture',
        'developers/rca-engine',
        'developers/cli-first-agent-ops',
        'developers/workspace-evolution',
        'developers/security-devsecops',
      ],
    },
  ],
};

export default sidebars;
