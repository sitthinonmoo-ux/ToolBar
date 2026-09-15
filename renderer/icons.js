// Hand-authored line icon set (Feather-style: 24x24 viewbox, stroke=currentColor).
// Replaces emoji glyphs so the app looks consistent across every machine's font/emoji set.
const ICONS = {
  logo: `<svg viewBox="0 0 40 40" width="20" height="20" aria-hidden="true">
    <defs>
      <linearGradient id="toolbarLogoGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" style="stop-color:var(--accent-1)"/>
        <stop offset="1" style="stop-color:var(--accent-2)"/>
      </linearGradient>
    </defs>
    <polygon points="20,9 31,20 20,31 9,20" fill="url(#toolbarLogoGrad)"/>
    <g stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none">
      <path d="M4 11.5V4.5H11"/>
      <path d="M29 4.5H36V11.5"/>
      <path d="M36 28.5V35.5H29"/>
      <path d="M11 35.5H4V28.5"/>
    </g>
  </svg>`,

  'nav-all': `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/>
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/>
  </svg>`,

  'nav-graphics': `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9"/>
    <line x1="14.6" y1="3.6" x2="7.6" y2="20.4"/><line x1="20.4" y1="14.6" x2="3.6" y2="9.6"/><line x1="20.4" y1="9.6" x2="3.6" y2="14.6"/>
  </svg>`,

  'nav-maintenance': `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M14.7 6.3a4 4 0 1 0 3 3l3.8-3.8-2-2z"/><path d="M9.5 11.5 3.5 17.5a2.1 2.1 0 0 0 3 3l6-6"/>
  </svg>`,

  'nav-connect': `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polygon points="6 3 20 12 6 21 6 3"/>
  </svg>`,

  'nav-settings': `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3.2"/>
    <path d="M19.4 13.5a1.7 1.7 0 0 0 .35 1.9l.05.05a2.1 2.1 0 1 1-3 3l-.06-.06a1.7 1.7 0 0 0-1.9-.34 1.7 1.7 0 0 0-1.02 1.55v.16a2.1 2.1 0 0 1-4.2 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.9.34l-.06.06a2.1 2.1 0 1 1-3-3l.06-.06a1.7 1.7 0 0 0 .34-1.9 1.7 1.7 0 0 0-1.55-1.02H2.1a2.1 2.1 0 0 1 0-4.2h.09a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.9l-.06-.06a2.1 2.1 0 1 1 3-3l.06.06a1.7 1.7 0 0 0 1.9.34h.08a1.7 1.7 0 0 0 1.02-1.55V2.1a2.1 2.1 0 0 1 4.2 0v.09a1.7 1.7 0 0 0 1.02 1.55h.08a1.7 1.7 0 0 0 1.9-.34l.06-.06a2.1 2.1 0 1 1 3 3l-.06.06a1.7 1.7 0 0 0-.34 1.9v.08c.27.66.86 1.1 1.55 1.02h.16a2.1 2.1 0 0 1 0 4.2h-.09a1.7 1.7 0 0 0-1.55 1.02z"/>
  </svg>`,

  'tool-launch': `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>
  </svg>`,

  history: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>
  </svg>`,

  search: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.2" y2="16.2"/>
  </svg>`,

  'tool-reshade': `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>
    <line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>
    <line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>
  </svg>`,

  'tool-addon': `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.8"/>
  </svg>`,

  'tool-cache': `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/>
    <line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
  </svg>`,

  sun: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/>
    <line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="18.4" y1="18.4" x2="19.8" y2="19.8"/>
    <line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/>
    <line x1="4.2" y1="19.8" x2="5.6" y2="18.4"/><line x1="18.4" y1="5.6" x2="19.8" y2="4.2"/>
  </svg>`,

  moon: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>
  </svg>`,

  home: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 11.5 12 4l9 7.5"/>
    <path d="M5.5 10v9.5a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1V16a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3.5a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1V10"/>
  </svg>`,

  edit: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>
  </svg>`,

  trash: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/>
  </svg>`,

  'status-ok': `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9"/><polyline points="8 12.5 11 15.5 16 9"/>
  </svg>`,

  'status-bad': `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9"/><line x1="12" y1="7.5" x2="12" y2="13"/><line x1="12" y1="16" x2="12" y2="16.01"/>
  </svg>`,

  grip: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
    <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>
  </svg>`,

  'nav-apps': `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 9l1.5-5h13L20 9"/><path d="M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9z"/><path d="M9 13a3 3 0 0 0 6 0"/>
  </svg>`,

  'nav-drivers': `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M10 2v3M14 2v3M10 19v3M14 19v3M2 10h3M2 14h3M19 10h3M19 14h3"/>
  </svg>`,

  'tool-generic': `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 12h6"/><path d="M12 9v6"/>
  </svg>`,
};

// Category -> nav icon key, and a generic fallback for any plugin.icon that
// doesn't match a known key (keeps the UI from silently rendering nothing).
const CATEGORY_ICON = { all: 'nav-all', graphics: 'nav-graphics', maintenance: 'nav-maintenance', connect: 'nav-connect', settings: 'nav-settings', apps: 'nav-apps', drivers: 'nav-drivers' };
const FALLBACK_ICON = 'nav-graphics';

function iconMarkup(key) {
  return ICONS[key] || ICONS[FALLBACK_ICON];
}
