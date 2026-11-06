/**
 * Pure auto-slug state machine.
 *
 * The historical bug lived in the React onChange handler:
 *   slug: draft.slug || slugify(event.target.value)
 * The first keystroke produced "t" and every later keystroke saw a truthy
 * slug, so the field froze. This reducer has no such latch: while the owner
 * has not touched the slug, every title change regenerates it from the full
 * current title. Manual edits set touched=true and stop auto-generation.
 *
 * Published items start locked: editing the title never changes the slug.
 * A slug change is an explicit advanced action that unlocks the field and
 * records that the alias workflow is required.
 */

import { finalizeSlug, sanitizeSlugTyping, slugify, uniqueSlug } from './slug.js';

export const SLUG_SOURCE = Object.freeze({
  AUTO: 'auto',
  MANUAL: 'manual',
  PUBLISHED: 'published'
});

export function createSlugState(overrides = {}) {
  const title = String(overrides.title || '');
  const locked = overrides.locked === true || overrides.published === true;
  const touched = overrides.touched === true || locked;
  const slug = String(overrides.slug || (touched ? '' : slugify(title)));
  return {
    title,
    slug,
    touched,
    locked,
    source: locked ? SLUG_SOURCE.PUBLISHED : touched ? SLUG_SOURCE.MANUAL : SLUG_SOURCE.AUTO
  };
}

function autoSlug(title, taken) {
  return uniqueSlug(slugify(title), taken || new Set());
}

export function reduceSlugState(state, action = {}) {
  const current = state || createSlugState();
  switch (action.type) {
    case 'title': {
      const title = String(action.value == null ? '' : action.value);
      if (current.locked || current.touched) {
        return { ...current, title, source: current.locked ? SLUG_SOURCE.PUBLISHED : SLUG_SOURCE.MANUAL };
      }
      return {
        ...current,
        title,
        slug: autoSlug(title, action.taken),
        source: SLUG_SOURCE.AUTO
      };
    }
    case 'slug': {
      if (current.locked) return current;
      return {
        ...current,
        slug: sanitizeSlugTyping(action.value),
        touched: true,
        source: SLUG_SOURCE.MANUAL
      };
    }
    case 'regenerate': {
      if (current.locked) return current;
      return {
        ...current,
        slug: autoSlug(action.title == null ? current.title : action.title, action.taken),
        touched: false,
        source: SLUG_SOURCE.AUTO
      };
    }
    case 'unlock': {
      // Explicit advanced action for a published item: the owner has confirmed
      // the consequences (alias created, old resource kept).
      return { ...current, locked: false, touched: true, source: SLUG_SOURCE.MANUAL };
    }
    case 'finalize': {
      return { ...current, slug: finalizeSlug(current.slug), touched: true, source: current.source };
    }
    case 'init': {
      return createSlugState(action.value || {});
    }
    default:
      return current;
  }
}

/** Guard for authoring: a published slug may only change when explicitly confirmed. */
export function assertSlugChangeAllowed(options = {}) {
  const publishedSlug = String(options.publishedSlug || '');
  const nextSlug = finalizeSlug(options.nextSlug || '');
  const confirmed = options.confirmed === true;
  if (!publishedSlug || publishedSlug === nextSlug) return { ok: true, message: '' };
  if (!confirmed) {
    return {
      ok: false,
      message: 'The slug of a published item can only change through the explicit advanced slug action, which preserves the old URL as an alias and keeps the old QDN resource.'
    };
  }
  return { ok: true, message: '' };
}
