import { createHash } from 'node:crypto';

export const TAG = 'v0.8.0-alpha.1';

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function artifactFor(component, version = '0.8.0-alpha.1') {
  const tag = 'v' + version;
  if (component === 'desktop') {
    const name = 'qortal-migration-studio_' + version.replace(/-/g, '~') + '_amd64.deb';
    return {
      platform: 'linux-x64',
      format: 'deb',
      name,
      bytes: 34567890,
      sha256: hash('desktop-' + version),
      url: 'https://github.com/iffinland/wordpress-to-qortal/releases/download/' + tag + '/' + name
    };
  }
  const name = (component === 'publisher'
    ? 'qortal-migration-publisher-v'
    : 'qortal-migration-generic-cms-v') + version + '.zip';
  return {
    platform: 'qortal-hub',
    format: 'zip',
    name,
    bytes: 2345678,
    sha256: hash(component + '-' + version),
    url: 'https://github.com/iffinland/wordpress-to-qortal/releases/download/' + tag + '/' + name
  };
}

export function componentFor(component, version = '0.8.0-alpha.1', overrides = {}) {
  const tag = 'v' + version;
  return {
    id: component,
    displayName: component === 'desktop' ? 'Qortal Migration Studio (Desktop)' : component === 'publisher' ? 'Migration Publisher' : 'Generic CMS',
    version,
    channel: version.includes('-alpha.') ? 'alpha' : version.includes('-beta.') ? 'beta' : version.includes('-rc.') ? 'rc' : 'stable',
    releaseTag: tag,
    releaseDate: '2026-11-05T05:00:00.000Z',
    releaseUrl: 'https://github.com/iffinland/wordpress-to-qortal/releases/tag/' + tag,
    changelog: {
      summary: component + ' changes in ' + version + '.',
      url: 'https://github.com/iffinland/wordpress-to-qortal/releases/tag/' + tag
    },
    supportedPlatforms: [artifactFor(component, version).platform],
    minimumDependencies: {},
    install: {
      kind: component === 'desktop' ? 'debian-package' : 'qapp-zip',
      instructions: 'Follow the release notes.'
    },
    artifacts: [artifactFor(component, version)],
    ...overrides
  };
}

export function registryFixture({ sequence = 3, versions = {}, components = ['desktop', 'publisher', 'cms'], generatedAt = '2026-11-05T05:10:00.000Z' } = {}) {
  const records = {};
  for (const id of components) {
    records[id] = componentFor(id, versions[id] ?? '0.8.0-alpha.1');
  }
  return {
    schema: 'qms-update-registry@1',
    registry: { service: 'DOCUMENT', name: 'developer iffi', identifier: 'qms-update-registry' },
    product: 'Qortal Migration Studio',
    generatedAt,
    sequence,
    components: records
  };
}
