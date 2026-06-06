import { siteConfig, WEB2_BASE_URL } from '../config/site';
import type { Documentary, PublicPage, SiteDataset } from '../types/content';

const uploads = `${WEB2_BASE_URL}/wp-content/uploads`;

function post(
  id: string,
  slug: string,
  title: string,
  excerpt: string,
  publishedAt: string,
  categories: string[],
  image?: string,
  heroImage?: string
) {
  return {
    id,
    slug,
    title,
    excerpt,
    author: siteConfig.publicAuthor,
    publishedAt,
    modifiedAt: publishedAt,
    categories,
    tags: [],
    image,
    heroImage,
    contentHtml: `<p>${excerpt}</p><p>This preview content is provided by the public-site scaffold. Imported WordPress HTML and QDN-backed CMS content will replace it through the repository layer.</p>`,
    commentsEnabled: true,
    source: 'demo' as const
  };
}

const posts = [
  post('demo-japanese-qa', 'james-corbett-the-japanese-qa', 'James Corbett: The Japanese Q&A', 'Following is the Question and Answer interview from the newly published Japanese version of REPORTAGE.', '2026-05-31T12:00:00Z', ['Newsletter'], `${uploads}/2026/05/japanese_qa-featured.jpg`, `${uploads}/2026/05/japanese_qa-latest.jpg`),
  post('demo-ai-line', 'drawing-the-ai-line-in-the-sand-solutionswatch', 'Drawing the AI Line in the Sand - #SolutionsWatch', 'Where do we draw the line when algorithms are inserted into every part of daily life?', '2026-05-29T12:00:00Z', ['Solutions Watch', 'Videos'], `${uploads}/2026/05/imaaifeatured3.jpg`),
  post('demo-enhanced-games', 'what-are-the-enhanced-games-questions-for-corbett', 'What are the Enhanced Games? - Questions For Corbett', 'Questions, answers and context for the latest story.', '2026-05-27T12:00:00Z', ['Questions For Corbett', 'Videos'], `${uploads}/2026/05/QFC-Enhanced-Games-featured.jpg`),
  post('demo-post-truth', 'interview-2018-the-post-truth-era', 'Interview 2018 - The Post-Truth Era on Forbidden Knowledge News', 'An interview on media, narrative and the post-truth era.', '2026-05-26T12:00:00Z', ['Interviews'], `${uploads}/2026/05/interview_2018-featured.jpg`),
  post('demo-mask', 'literal-skin-suits-on-the-news-propagandawatch', 'So, They Are Wearing Literal Skin Suits on the News Now... - #PropagandaWatch', 'A Propaganda Watch examination of another unusual media story.', '2026-05-25T12:00:00Z', ['Propaganda Watch', 'Videos'], `${uploads}/2026/05/Prop-Watch-Mask-featured.jpg`),
  post('demo-cia', 'the-cia-won-everything-you-believe-is-false', 'The CIA Won: Everything You Believe Is False', 'You have heard the quotation, but what does it really mean?', '2026-05-24T19:39:59Z', ['Newsletter'], `${uploads}/2026/05/everything_false-featured.jpg`),
  post('demo-claude', 'the-claude-delusion', 'The Claude Delusion', 'A closer look at the latest artificial intelligence narrative.', '2026-05-16T21:05:32Z', ['Newsletter'], `${uploads}/2026/05/claude_delusion-featured.jpg`),
  post('demo-ted-turner', 'ted-turner-contributes-to-the-depopulation-agenda', 'Ted Turner Contributes to the Depopulation Agenda!', 'A review of the public record and its implications.', '2026-05-10T18:59:02Z', ['Newsletter'], `${uploads}/2026/05/tedturnerkicksthebucket-featured.jpg`)
];

const documentaries: Documentary[] = [
  {
    id: 'doc-al-qaeda',
    title: 'False Flags: The Secret History of Al Qaeda',
    image: './assets/documentaries/false-flags-al-qaeda.jpg',
    href: '#/category/documentaries'
  },
  {
    id: 'doc-big-oil',
    title: 'How Big Oil Conquered the World',
    image: './assets/documentaries/how-big-oil-conquered-the-world.jpg',
    href: '#/category/documentaries'
  },
  {
    id: 'doc-war-games',
    title: 'War Games',
    image: './assets/documentaries/war-games.jpg',
    href: '#/category/documentaries'
  }
];

const pages: PublicPage[] = [
  {
    slug: 'about',
    title: 'About',
    contentHtml: '<p>The Corbett Report is an independent, listener-supported alternative news source.</p><p>This Qortal-native edition is being built to preserve the public archive and support decentralized publishing.</p>'
  },
  {
    slug: 'shop',
    title: 'Shop',
    contentHtml: '<p>The Qortal-native shop will be connected in a later implementation phase.</p>'
  },
  {
    slug: 'contact',
    title: 'Contact',
    contentHtml: '<p>The contact workflow will be connected after the public archive foundation is complete.</p>'
  },
  {
    slug: 'rss',
    title: 'RSS',
    contentHtml: '<p>Qortal-native feed options will be added after the publishing model is finalized.</p>'
  }
];

export const demoDataset: SiteDataset = {
  posts,
  pages,
  documentaries
};
