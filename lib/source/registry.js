import { describeAdapter, assertSourceAdapter } from './contract.js';
import { SourceError, SOURCE_ERROR_CODES } from './errors.js';

/**
 * Registry for source adapters. Future Joomla/Wix adapters register here; the
 * engine, model and publisher code never branch on adapter ids.
 */
export class SourceAdapterRegistry {
  constructor(adapters = []) {
    this._adapters = new Map();
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  register(adapter) {
    assertSourceAdapter(adapter);
    if (this._adapters.has(adapter.id)) {
      throw new SourceError(
        SOURCE_ERROR_CODES.ADAPTER_EXISTS,
        `Source adapter already registered: ${adapter.id}`,
        { details: { adapterId: adapter.id } }
      );
    }
    this._adapters.set(adapter.id, adapter);
    return this;
  }

  has(adapterId) {
    return this._adapters.has(adapterId);
  }

  get(adapterId = 'wordpress') {
    const adapter = this._adapters.get(adapterId);
    if (!adapter) {
      throw new SourceError(
        SOURCE_ERROR_CODES.ADAPTER_NOT_FOUND,
        `Source adapter is not registered: ${adapterId}`,
        { details: { adapterId, available: this.ids() } }
      );
    }
    return adapter;
  }

  ids() {
    return [...this._adapters.keys()].sort();
  }

  list() {
    return this.ids().map((id) => describeAdapter(this._adapters.get(id)));
  }

  capabilities(adapterId = 'wordpress') {
    return describeAdapter(this.get(adapterId));
  }
}

export function createSourceRegistry(adapters = []) {
  return new SourceAdapterRegistry(adapters);
}
