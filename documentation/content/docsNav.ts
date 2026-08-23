export interface DocsNavItem {
  id: string;
  label: string;
}

export interface DocsNavGroup {
  title: string;
  items: DocsNavItem[];
}

/** Single source of truth for the docs sidebar and the scroll-spy. */
export const DOCS_NAV: DocsNavGroup[] = [
  {
    title: 'Introduction',
    items: [
      { id: 'overview', label: 'Overview' },
      { id: 'problem', label: 'The problem' },
      { id: 'solution', label: 'The solution' },
      { id: 'novelty', label: 'Novelty & prior art' },
    ],
  },
  {
    title: 'Getting started',
    items: [
      { id: 'quick-start', label: 'Quick start' },
      { id: 'clients', label: 'Clients' },
      { id: 'configuration', label: 'Configuration' },
    ],
  },
  {
    title: 'Reference',
    items: [
      { id: 'architecture', label: 'Architecture' },
      { id: 'protocol', label: 'AWP protocol' },
      { id: 'policy-engine', label: 'Policy engine' },
      { id: 'approvals', label: 'Approval lifecycle' },
      { id: 'sessions', label: 'Sessions & replay' },
      { id: 'security', label: 'Security model' },
    ],
  },
  {
    title: 'Engineering notes',
    items: [
      { id: 'acp', label: 'ACP integration' },
      { id: 'honesty', label: 'The honesty rule' },
      { id: 'testing', label: 'Testing & verification' },
    ],
  },
  {
    title: 'Project',
    items: [
      { id: 'impact', label: 'Impact & use cases' },
      { id: 'roadmap', label: 'Roadmap' },
      { id: 'limitations', label: 'Known limitations' },
      { id: 'built-with-kiro', label: 'Built with Kiro' },
      { id: 'contributing', label: 'Contributing' },
      { id: 'attribution', label: 'Attribution & licence' },
    ],
  },
];

export const DOCS_SECTION_IDS: string[] = DOCS_NAV.flatMap((g) => g.items.map((i) => i.id));
