export const WEB2_BASE_URL = 'https://corbettreport.com';

export const siteConfig = {
  title: 'The Corbett Report',
  tagline: 'Open Source Intelligence News',
  logo: './assets/corbett_logo_swirl-1.png',
  publicAuthor: 'Corbett',
  siteName: import.meta.env.VITE_QDN_NAME || 'Corbett',
  contentName: import.meta.env.VITE_CONTENT_QDN_NAME || 'Corbett',
  mediaName: import.meta.env.VITE_MEDIA_QDN_NAME || '',
  coauthorNames: (import.meta.env.VITE_COAUTHOR_NAMES || '')
    .split(',')
    .map((name: string) => name.trim())
    .filter(Boolean)
};

export const socialLinks = [
  { label: 'Internet Archive', href: 'https://archive.org/details/@corbettreport?sort=-date', icon: './assets/social-icons/internet-archive.png' },
  { label: 'BitChute', href: 'https://www.bitchute.com/channel/GwPziiQZrVT3/', icon: './assets/social-icons/bitchute.png' },
  { label: 'Odysee', href: 'https://odysee.com/@corbettreport:0', icon: './assets/social-icons/odysee.png' },
  { label: 'Rokfin', href: 'https://rokfin.com/corbettreport', icon: './assets/social-icons/rokfin.png' },
  { label: 'Rumble', href: 'https://rumble.com/c/corbettreport', icon: './assets/social-icons/rumble.png' },
  { label: 'Substack', href: 'https://corbettreport.substack.com/', icon: './assets/social-icons/substack.png' },
  { label: 'Minds', href: 'https://www.minds.com/corbettreport', icon: './assets/social-icons/minds.png' },
  { label: 'RSS', href: `${WEB2_BASE_URL}/feed/`, icon: './assets/social-icons/rss.png' }
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
