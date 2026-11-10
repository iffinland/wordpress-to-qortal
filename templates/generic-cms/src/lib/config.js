import { buildThemePalette } from './theme.js';

export const CMS_TEMPLATE_CONFIG_SCHEMA = 'qms-cms-template-config@1';

const REQUIRED_COLORS = ['background', 'surface', 'text', 'muted', 'accent', 'border'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isColor(value) {
  if (!isNonEmptyString(value)) return false;
  return /^#(?:[0-9a-f]{3,8})$/i.test(value.trim())
    || /^(?:rgb|hsl)a?\([^)]*\)$/i.test(value.trim())
    || /^[a-z]+$/i.test(value.trim());
}

export function validateCmsConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object') {
    return { ok: false, errors: ['Configuration must be an object.'] };
  }
  if (config.schema !== CMS_TEMPLATE_CONFIG_SCHEMA) {
    errors.push('schema must be ' + CMS_TEMPLATE_CONFIG_SCHEMA + '.');
  }
  if (config.deployment !== undefined) {
    if (!config.deployment || typeof config.deployment !== 'object') {
      errors.push('deployment must be an object when present.');
    } else {
      if (!['APP', 'WEBSITE'].includes(config.deployment.service)) errors.push('deployment.service must be APP or WEBSITE.');
      if (!isNonEmptyString(config.deployment.name)) errors.push('deployment.name must be a non-empty string.');
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(String(config.deployment.identifier || ''))) {
        errors.push('deployment.identifier must be a QDN identifier.');
      }
    }
  }
  if (!config.site || typeof config.site !== 'object') {
    errors.push('site is required.');
  } else {
    for (const field of ['title', 'tagline', 'ownerName']) {
      if (!isNonEmptyString(config.site[field])) errors.push('site.' + field + ' must be a non-empty string.');
    }
    if (config.site.id !== undefined && !isNonEmptyString(config.site.id)) errors.push('site.id must be a non-empty string when present.');
  }
  if (!Array.isArray(config.navigation) || config.navigation.length === 0) {
    errors.push('navigation must contain at least one item.');
  } else {
    config.navigation.forEach((item, index) => {
      if (!item || !isNonEmptyString(item.label) || !isNonEmptyString(item.href)) {
        errors.push('navigation[' + index + '] must have label and href.');
      }
    });
  }
  if (!config.theme || typeof config.theme !== 'object') {
    errors.push('theme is required.');
  } else {
    if (!config.theme.colors || typeof config.theme.colors !== 'object') {
      errors.push('theme.colors is required.');
    } else {
      for (const key of REQUIRED_COLORS) {
        if (!isColor(config.theme.colors[key])) errors.push('theme.colors.' + key + ' must be a CSS color.');
      }
    }
    if (!isNonEmptyString(config.theme.fontFamily)) errors.push('theme.fontFamily must be a non-empty string.');
    if (!isNonEmptyString(config.theme.maxWidth)) errors.push('theme.maxWidth must be a non-empty string.');
  }
  if (!config.content || typeof config.content !== 'object') {
    errors.push('content is required.');
  } else {
    if (!['qdn', 'fixture'].includes(config.content.source)) errors.push('content.source must be qdn or fixture.');
    if (!isNonEmptyString(config.content.manifestIdentifier)) errors.push('content.manifestIdentifier is required.');
    if (!Number.isFinite(Number(config.content.pageSize)) || Number(config.content.pageSize) < 1) {
      errors.push('content.pageSize must be a positive number.');
    }
    if (!Number.isFinite(Number(config.content.staleAfterDays)) || Number(config.content.staleAfterDays) < 1) {
      errors.push('content.staleAfterDays must be a positive number.');
    }
  }
  if (!config.admin || typeof config.admin !== 'object') {
    errors.push('admin is required.');
  } else {
    if (typeof config.admin.qdnName !== 'string') {
      errors.push('admin.qdnName must be a string; leave it empty to discover the name from Qortal hosting at runtime.');
    }
    if (config.admin.requireOwnerForImport !== undefined && typeof config.admin.requireOwnerForImport !== 'boolean') {
      errors.push('admin.requireOwnerForImport must be a boolean when present.');
    }
  }
  return { ok: errors.length === 0, errors };
}

export function themeStyle(config, resolvedMode = 'dark') {
  const theme = config.theme;
  return {
    ...buildThemePalette(config, resolvedMode),
    '--qms-font': theme.fontFamily,
    '--qms-heading-font': theme.headingFontFamily || theme.fontFamily,
    '--qms-radius': theme.radius || '10px',
    '--qms-max-width': theme.maxWidth || '1120px'
  };
}
