/**
 * Focused documentation consistency checks for active release instructions.
 *
 * Only active sections are checked. Historical release notes, historical
 * changelog entries and later historical-example sections are not rejected.
 */
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function expectedArtifactNames(release) {
  return {
    desktop: 'qortal-migration-studio_' + release.components.desktop.version + '_amd64.deb',
    publisher: 'qortal-migration-publisher-v' + release.components.publisher.version + '.zip',
    cms: 'qortal-migration-generic-cms-v' + release.components.cms.version + '.zip'
  };
}

export function evaluateActiveDocs({
  release,
  changelog = '',
  readme = '',
  quickstart = '',
  install = '',
  manifest = null,
  strictManifest = false
}) {
  const errors = [];
  const version = release.version;
  const tag = release.releaseTag;
  const names = expectedArtifactNames(release);

  if (!new RegExp('^##\\s+' + escapeRegExp(version) + '(?:\\s|$)', 'm').test(changelog)) {
    errors.push('CHANGELOG.md has no active heading for ' + version + '.');
  }

  const downloadSection = (readme.match(/## Download [^\n]*\n[\s\S]*?(?=\n## )/) || [''])[0];
  if (!downloadSection) {
    errors.push('README.md has no active Download section.');
  } else {
    for (const [kind, name] of Object.entries(names)) {
      if (!downloadSection.includes('/download/' + tag + '/' + name)) {
        errors.push('README.md ' + kind + ' download does not point at ' + tag + '/' + name + '.');
      }
    }
  }

  // Label/URL agreement for a release-page link. Use plain string scanning so
  // nested parentheses in a label cannot defeat the check.
  const tagUrl = 'https://github.com/iffinland/wordpress-to-qortal/releases/tag/' + tag;
  let search = 0;
  while ((search = readme.indexOf(tagUrl, search)) !== -1) {
    const before = readme.slice(Math.max(0, search - 120), search);
    if (before.toLowerCase().includes('beta.1') || before.toLowerCase().includes('rc.7')) {
      errors.push('README.md release-link label disagrees with URL tag ' + tag + '.');
    }
    search += tagUrl.length;
  }

  const quickStartActive = quickstart.split('\n').slice(0, 30).join('\n');
  if (!quickStartActive.includes('/download/' + tag + '/' + names.desktop)) {
    errors.push('QUICKSTART.md primary desktop download does not point at ' + tag + '/' + names.desktop + '.');
  }
  if (quickStartActive.toLowerCase().includes('rc.7')) {
    errors.push('QUICKSTART.md primary instructions still reference 0.8.0-rc.7.');
  }

  // Active installation text is the top of the document; later upgrade notes
  // may legitimately mention older releases.
  const installActive = install.split('\n').slice(0, 60).join('\n');
  if (installActive.toLowerCase().includes('rc.7')) {
    errors.push('INSTALL-LINUX.md still claims an rc.7 release is current.');
  }
  if (!installActive.includes(names.desktop)) {
    errors.push('INSTALL-LINUX.md instructions do not name the current desktop artifact ' + names.desktop + '.');
  }
  if (!installActive.includes(tag)) {
    errors.push('INSTALL-LINUX.md instructions do not name the current bundle tag ' + tag + '.');
  }

  if (strictManifest) {
    if (!manifest) errors.push('release manifest is missing while strict validation is required.');
    else if (manifest.version !== version) {
      errors.push('release manifest is stale: expected ' + version + ', found ' + manifest.version + '.');
    }
  }

  // A manifest from another release is ignored when strict validation is off;
  // checkInstallableArtifacts still verifies the current manifest at prepublish.
  if (manifest && manifest.version === version) {
    if (manifest.tag !== tag) errors.push('release manifest tag does not match ' + tag + '.');
    const byKind = Object.fromEntries((manifest.artifacts || []).map((entry) => [entry.kind, entry]));
    for (const [kind, name] of Object.entries(names)) {
      const entry = byKind[kind === 'desktop' ? 'deb' : kind];
      const component = release.components[kind];
      if (!entry) {
        errors.push('release manifest has no ' + kind + ' artifact.');
        continue;
      }
      if (entry.name !== name) errors.push('release manifest ' + kind + ' name does not match ' + name + '.');
      if (entry.componentVersion !== component.version) {
        errors.push('release manifest ' + kind + ' componentVersion does not match ' + component.version + '.');
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
