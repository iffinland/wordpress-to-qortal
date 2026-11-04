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

export function themeStyle(config) {
  const theme = config.theme;
  return {
    '--qms-bg': theme.colors.background,
    '--qms-surface': theme.colors.surface,
    '--qms-surface-alt': theme.colors.surfaceAlt || theme.colors.surface,
    '--qms-text': theme.colors.text,
    '--qms-muted': theme.colors.muted,
    '--qms-accent': theme.colors.accent,
    '--qms-accent-text': theme.colors.accentText || theme.colors.background,
    '--qms-border': theme.colors.border,
    '--qms-danger': theme.colors.danger || '#ff7b72',
    '--qms-warning': theme.colors.warning || '#e3b341',
    '--qms-font': theme.fontFamily,
    '--qms-heading-font': theme.headingFontFamily || theme.fontFamily,
    '--qms-radius': theme.radius || '10px',
    '--qms-max-width': theme.maxWidth || '1120px'
  };
}
