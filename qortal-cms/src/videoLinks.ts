import type { CmsVideoEmbed } from './types';

const qTubeLinkPattern = /qortal:\/\/APP\/Q-Tube\/video\/([^"'<>\s]+)\/([^"'<>\s]+)/i;
const qdnVideoLinkPattern = /qortal:\/\/VIDEO\/([^"'<>\s]+)\/([^"'<>\s]+)/i;

function decodePathPart(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function toUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    try {
      return new URL(value, 'http://localhost');
    } catch {
      return null;
    }
  }
}

function trimMetadataSuffix(identifier: string) {
  return identifier.replace(/_metadata$/i, '');
}

export function parseVideoLink(value: string): CmsVideoEmbed | null {
  const input = value.trim();
  if (!input) return null;

  const qdnMatch = input.match(qdnVideoLinkPattern);
  if (qdnMatch) {
    const name = decodePathPart(qdnMatch[1]);
    const identifier = decodePathPart(qdnMatch[2]);
    return {
      id: `video-${Date.now().toString(36)}`,
      title: identifier,
      source: 'qdn',
      source_url: input,
      created_at: new Date().toISOString(),
      qdn: { service: 'VIDEO', name, identifier }
    };
  }

  const qTubeMatch = input.match(qTubeLinkPattern);
  if (qTubeMatch) {
    const name = decodePathPart(qTubeMatch[1]);
    const identifier = trimMetadataSuffix(decodePathPart(qTubeMatch[2]));
    return {
      id: `video-${Date.now().toString(36)}`,
      title: identifier,
      source: 'qtube',
      source_url: input,
      created_at: new Date().toISOString(),
      qdn: { service: 'VIDEO', name, identifier }
    };
  }

  const url = toUrl(input);
  if (!url) return null;

  const queryService = url.searchParams.get('service');
  const queryName = url.searchParams.get('name');
  const queryIdentifier = url.searchParams.get('identifier');
  if (queryService?.toUpperCase() === 'VIDEO' && queryName && queryIdentifier) {
    return {
      id: `video-${Date.now().toString(36)}`,
      title: queryIdentifier,
      source: 'bridge',
      source_url: input,
      created_at: new Date().toISOString(),
      qdn: { service: 'VIDEO', name: queryName, identifier: queryIdentifier }
    };
  }

  const parts = url.pathname.split('/').filter(Boolean).map(decodePathPart);
  const arbitraryIndex = parts.findIndex((part) => part.toLowerCase() === 'arbitrary');
  const service = parts[arbitraryIndex + 1];
  const name = parts[arbitraryIndex + 2];
  const identifier = parts[arbitraryIndex + 3];

  if (arbitraryIndex >= 0 && service?.toUpperCase() === 'VIDEO' && name && identifier) {
    return {
      id: `video-${Date.now().toString(36)}`,
      title: identifier,
      source: 'qdn',
      source_url: input,
      created_at: new Date().toISOString(),
      qdn: { service: 'VIDEO', name, identifier }
    };
  }

  return null;
}
