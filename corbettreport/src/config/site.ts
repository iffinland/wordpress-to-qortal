export const WEB2_BASE_URL = 'https://corbettreport.com';

export const siteConfig = {
  title: 'The Corbett Report',
  tagline: 'Open Source Intelligence News',
  logo: './assets/corbett_logo_swirl-1.png',
  publicAuthor: 'Corbett',
  siteName: import.meta.env.VITE_QDN_NAME || 'CorbettReport',
  contentName: import.meta.env.VITE_CONTENT_QDN_NAME || 'Corbett',
  mediaName: import.meta.env.VITE_MEDIA_QDN_NAME || 'CorbettReportMedia',
  coauthorNames: (import.meta.env.VITE_COAUTHOR_NAMES || 'iffi,AgoristMarket')
    .split(',')
    .map((name: string) => name.trim())
    .filter(Boolean)
};

export const socialLinks = [
  { label: 'Internet Archive', href: 'https://archive.org/details/@corbettreport?sort=-date', shortLabel: 'IA' },
  { label: 'BitChute', href: 'https://www.bitchute.com/channel/GwPziiQZrVT3/', shortLabel: 'BC' },
  { label: 'Odysee', href: 'https://odysee.com/@corbettreport:0', shortLabel: 'OD' },
  { label: 'Rokfin', href: 'https://rokfin.com/corbettreport', shortLabel: 'RK' },
  { label: 'Rumble', href: 'https://rumble.com/c/corbettreport', shortLabel: 'RU' },
  { label: 'Substack', href: 'https://corbettreport.substack.com/', shortLabel: 'SS' },
  { label: 'Minds', href: 'https://www.minds.com/corbettreport', shortLabel: 'MI' },
  { label: 'RSS', href: `${WEB2_BASE_URL}/feed/`, shortLabel: 'RSS' }
];

export const primaryNavigation = [
  { label: 'Home', href: '#/' },
  { label: 'About', href: '#/pages/about' },
  { label: 'Documentaries', href: '#/category/documentaries' },
  { label: 'Series', href: '#/category/series' },
  { label: 'Newsletter', href: '#/category/newsletter' },
  { label: 'Sign Up', href: '#/member' },
  { label: 'Shop', href: '#/pages/shop' },
  { label: 'Contact', href: '#/pages/contact' },
  { label: 'RSS', href: '#/pages/rss' }
];
