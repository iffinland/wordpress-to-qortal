/**
 * Focused documentation consistency checks for active release instructions.
 *
 * Historical documents and explicitly labeled historical changelog entries are
 * intentionally outside this check.
 */
const RC7 = /0\.8\.0-rc\.7/;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function expectedArtifactNames(release) {
  return {
    desktop: 'qortal-migration-studio_' + release.components.desktop.version + '_amd64.deb',
    publisher: 'qortal-migration-publisher-v' + release.components.publisher.version + '.zip',
    cms: 'qortal-migration-generic-cms-v' + release.components.cms.version + '.zip'
  };
}

export function evaluateActiveDocs({ release, changelog = '', readme = '', quickstart = '', manifest = null }) {
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

  const quickStartActive = quickstart.split('\n').slice(0, 30).join('\n');
  if (!quickStartActive.includes('/download/' + tag + '/' + names.desktop)) {
    errors.push('QUICKSTART.md primary desktop download does not point at ' + tag + '/' + names.desktop + '.');
  }
  if (RC7.test(quickStartActive)) {
    errors.push('QUICKSTART.md primary instructions still reference 0.8.0-rc.7.');
  }

  // A manifest from another release is ignored here; checkInstallableArtifacts
  // verifies the current manifest at prepublish.
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
