// Resolve one independently released component without disturbing the bundle.
export const COMPONENT_PATTERNS = {
  desktop: /^qortal-migration-studio_.+_amd64\.deb$/,
  publisher: /^qortal-migration-publisher-.+\.zip$/,
  cms: /^qortal-migration-generic-cms-.+\.zip$/
};
export function latestComponentAssets(releases) {
  const sorted = releases.filter((item) => !item.draft).sort((a, b) => Date.parse(b.published_at || b.created_at) - Date.parse(a.published_at || a.created_at));
  return Object.fromEntries(Object.entries(COMPONENT_PATTERNS).map(([kind, pattern]) => {
    const release = sorted.find((item) => item.assets?.some((asset) => pattern.test(asset.name)));
    if (!release) throw new Error('No published artifact for ' + kind);
    const assets = release.assets.filter((asset) => pattern.test(asset.name));
    if (assets.length !== 1) throw new Error('Ambiguous artifacts for ' + kind + ' in ' + release.tag_name);
    return [kind, { release, asset: assets[0] }];
  }));
}
export function parseChecksums(text) {
  return new Map(text.trim().split('\n').map((line) => line.trim().split(/\s+/)).filter((parts) => parts.length === 2 && /^[a-f0-9]{64}$/.test(parts[0])).map(([hash, name]) => [name.replace(/^\*/, ''), hash]));
}
