function readCsv(value = '') {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

function readBoolean(value = '') {
  return value.trim().toLowerCase() === 'true';
}

export const cmsProfile = {
  id: import.meta.env.VITE_CMS_PROFILE || 'generic',
  siteTitle: import.meta.env.VITE_CMS_SITE_TITLE || '',
  tagline: import.meta.env.VITE_CMS_TAGLINE || '',
  ownerName: import.meta.env.VITE_CMS_OWNER_NAME || '',
  publicAuthorName: import.meta.env.VITE_CMS_PUBLIC_AUTHOR_NAME || '',
  contentName: import.meta.env.VITE_CMS_CONTENT_NAME || '',
  mediaName: import.meta.env.VITE_CMS_MEDIA_NAME || '',
  sysopNames: readCsv(import.meta.env.VITE_CMS_SYSOP_NAMES || ''),
  coauthorNames: readCsv(import.meta.env.VITE_CMS_COAUTHOR_NAMES || ''),
  importOwnerName: import.meta.env.VITE_CMS_IMPORT_OWNER_NAME || '',
  trustedCoauthorsCanAdoptImports: readBoolean(import.meta.env.VITE_CMS_TRUSTED_COAUTHORS_CAN_ADOPT_IMPORTS || ''),
  trustedCoauthorsCanPublishMedia: readBoolean(import.meta.env.VITE_CMS_TRUSTED_COAUTHORS_CAN_PUBLISH_MEDIA || ''),
  importManifestIdentifier:
    import.meta.env.VITE_QDN_MANIFEST_IDENTIFIER || 'wpq-qdn-manifest'
};

export function editorialAuthorName(fallback = '') {
  return cmsProfile.publicAuthorName || fallback;
}
