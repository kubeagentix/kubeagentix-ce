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
        'users/incidents',
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
        'developers/incident-v1-roadmap',
        'developers/incident-v1-spec',
        'developers/incident-v1-release-notes',
        'developers/incident-observability-connectors',
        'developers/runtime-architecture',
        'developers/rca-engine',
        'developers/cli-first-agent-ops',
        'developers/claude-code-subscription-integration',
        'developers/workspace-evolution',
        'developers/security-devsecops',
      ],
    },
  ],
};

export default sidebars;
