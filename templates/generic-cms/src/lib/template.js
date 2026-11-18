/**
 * Public site template registry metadata.
 *
 * Templates own presentation only. Catalog loading, routing, owner editing and
 * publication stay in the CMS core so every template serves the same data and
 * the same publishing guarantees.
 */

export const DEFAULT_TEMPLATE_ID = 'default';

export const TEMPLATE_OPTIONS = [
  {
    id: 'default',
    label: 'Default',
    description: 'The neutral QMS site layout: latest posts, categories, tags and the archive.'
  },
  {
    id: 'magazine',
    label: 'Magazine / News',
    description: 'Editorial front page with a featured story, image-led cards, category strips and a responsive news grid.'
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    description: 'Image-led project gallery with a large introduction, about and contact sections, and consistent project pages.'
  },
  {
    id: 'docs',
    label: 'Documentation / Knowledge Base',
    description: 'Clean documentation layout with a category sidebar, guide index, technical article pages and integrated search.'
  },
  {
    id: 'gallery',
    label: 'Photography / Gallery',
    description: 'Image-first gallery with a full-bleed hero, masonry photographs, album collections and distraction-free articles.'
  },
  {
    id: 'business',
    label: 'Business / Services',
    description: 'Professional business layout with services, company introduction, completed projects, contact sections and consistent service pages.'
  },
  {
    id: 'video',
    label: 'Video / Media',
    description: 'Cinematic video library with a featured player, series collections, thumbnail gallery and embedded playback on video pages.'
  },
  {
    id: 'journal',
    label: 'Personal Journal',
    description: 'Warm personal journal with an introduction, recent entries, a chronological timeline, topics and calm reading pages.'
  }
];

export const TEMPLATE_IDS = TEMPLATE_OPTIONS.map((option) => option.id);

export function normalizeTemplateId(value) {
  const id = String(value || '').trim().toLowerCase();
  return TEMPLATE_IDS.includes(id) ? id : DEFAULT_TEMPLATE_ID;
}

export function templateOption(value) {
  const id = normalizeTemplateId(value);
  return TEMPLATE_OPTIONS.find((option) => option.id === id) || TEMPLATE_OPTIONS[0];
}
