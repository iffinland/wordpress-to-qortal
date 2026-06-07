import logoImage from '../assets/corbett_logo_swirl-1.png';
import bitchuteIcon from '../assets/social-icons/bitchute.png';
import internetArchiveIcon from '../assets/social-icons/internet-archive.png';
import mindsIcon from '../assets/social-icons/minds.png';
import odyseeIcon from '../assets/social-icons/odysee.png';
import rokfinIcon from '../assets/social-icons/rokfin.png';
import rssIcon from '../assets/social-icons/rss.png';
import rumbleIcon from '../assets/social-icons/rumble.png';
import substackIcon from '../assets/social-icons/substack.png';

export const WEB2_BASE_URL = 'https://corbettreport.com';
export const SHOP_LINK_URL = 'https://newworldnextweek.com/';

export const siteConfig = {
  title: 'The Corbett Report',
  tagline: 'Open Source Intelligence News',
  logo: logoImage,
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
  { label: 'Internet Archive', href: 'https://archive.org/details/@corbettreport?sort=-date', icon: internetArchiveIcon },
  { label: 'BitChute', href: 'https://www.bitchute.com/channel/GwPziiQZrVT3/', icon: bitchuteIcon },
  { label: 'Odysee', href: 'https://odysee.com/@corbettreport:0', icon: odyseeIcon },
  { label: 'Rokfin', href: 'https://rokfin.com/corbettreport', icon: rokfinIcon },
  { label: 'Rumble', href: 'https://rumble.com/c/corbettreport', icon: rumbleIcon },
  { label: 'Substack', href: 'https://corbettreport.substack.com/', icon: substackIcon },
  { label: 'Minds', href: 'https://www.minds.com/corbettreport', icon: mindsIcon },
  { label: 'RSS', href: `${WEB2_BASE_URL}/feed/`, icon: rssIcon }
];

export const primaryNavigation = [
  { label: 'Home', href: '#/' },
  { label: 'About', href: '#/pages/about' },
  { label: 'Documentaries', href: '#/documentaries' },
  {
    label: 'Series',
    children: [
      { label: 'Podcasts', href: '#/category/podcasts' },
      { label: 'Interviews', href: '#/category/interviews' },
      { label: 'NWNW', href: '#/category/nwnw' },
      { label: 'Solutions Watch', href: '#/category/solutions-watch' },
      { label: 'Questions For Corbett', href: '#/category/questions-for-corbett' },
      { label: 'Propaganda Watch', href: '#/category/propaganda-watch' },
      { label: 'FLNWO', href: '#/category/flnwo' }
    ]
  },
  { label: 'Newsletter', href: '#/category/newsletter' },
  { label: 'Archive', href: '#/archive' },
  { label: 'Shop', href: SHOP_LINK_URL, copyToClipboard: true },
  { label: 'Contact', href: '#/pages/contact' }
];
