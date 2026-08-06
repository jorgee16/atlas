export class PluginManager {
  constructor({ context }) {
    if (!context) {
      throw new TypeError(
        'PluginManager requires an AppContext.'
      );
    }

    this.context = context;
    this.plugins = new Map();
    this.startedPlugins = [];
  }

  register(plugin) {
    if (!plugin) {
      throw new TypeError(
        'PluginManager.register requires a plugin.'
      );
    }

    if (!plugin.id) {
      throw new TypeError(
        'Every plugin requires a unique id.'
      );
    }

    if (this.plugins.has(plugin.id)) {
      throw new Error(
        `Plugin already registered: ${plugin.id}`
      );
    }

    this.plugins.set(plugin.id, plugin);

    return this;
  }

  async start() {
    for (const plugin of this.plugins.values()) {
      await this.#startPlugin(plugin);
    }
  }

  async stop() {
    const plugins =
      [...this.startedPlugins].reverse();

    for (const plugin of plugins) {
      if (typeof plugin.stop === 'function') {
        await plugin.stop(this.context);
      }
    }

    this.startedPlugins = [];
  }

  get(id) {
    return this.plugins.get(id) ?? null;
  }

  has(id) {
    return this.plugins.has(id);
  }

  async #startPlugin(plugin) {
    if (typeof plugin.start !== 'function') {
      throw new TypeError(
        `Plugin "${plugin.id}" requires start(context).`
      );
    }

    await plugin.start(this.context);
    this.startedPlugins.push(plugin);
  }
}
