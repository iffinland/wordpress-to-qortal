import { SourceAdapterRegistry } from './registry.js';
import { createWordPressAdapter } from './wordpress/index.js';

/** Built-in adapters only. Future Joomla/Wix adapters register here or are injected. */
export function createBuiltinSourceRegistry() {
  return new SourceAdapterRegistry([createWordPressAdapter()]);
}
