/**
 * Citations & physical equivalencies. Every number surfaced in the UI
 * maps back to one of these sources.
 */

export interface Citation {
  key: string;
  title: string;
  venue: string;
  year: string;
}

export const CITATIONS: Record<string, Citation> = {
  ucr_ren_2023: {
    key: 'ucr_ren_2023',
    title: "Making AI Less 'Thirsty': Uncovering and Quantifying AI Data Center Water Usage in the United States",
    venue: 'Li, Hua, Ren et al.: UC Riverside / arXiv:2304.03271',
    year: '2023-2025',
  },
  huggingface_luccioni_2024: {
    key: 'huggingface_luccioni_2024',
    title: 'Power Hungry Processing: Text Generation Yields a Carbon Footprint',
    venue: 'Luccioni et al.: Hugging Face',
    year: '2024',
  },
  iea_datacenter_2024: {
    key: 'iea_datacenter_2024',
    title: 'Data Centres and Data Transmission Networks',
    venue: 'International Energy Agency (IEA)',
    year: '2024',
  },
};

export interface ScopeNote {
  label: string;
  body: string;
}

/** Scope breakdown rendered inside the citation modal. */
export const SCOPE_NOTES: ScopeNote[] = [
  {
    label: 'Scope 1: On-Site Cooling',
    body: 'Direct evaporation of potable water inside the data center\u2019s own cooling towers as heat is rejected from the racks running your inference.',
  },
  {
    label: 'Scope 2: Off-Site Power Grid',
    body: 'Thermoelectric water withdrawal and consumption incurred upstream by power plants generating the electricity your query drew from the grid.',
  },
];

/** Physical equivalency constants used by the copy engine. */
export const EQUIVALENCIES = {
  /** Fresh water in one espresso shot, ml. */
  ESPRESSO_SHOT_ML: 15,
  /** Energy of one standard Google search, Wh. */
  GOOGLE_SEARCH_WH: 0.3,
  /** Energy of one full smartphone charge (typical Li-ion pack), Wh. */
  PHONE_CHARGE_WH: 5.0,
} as const;
