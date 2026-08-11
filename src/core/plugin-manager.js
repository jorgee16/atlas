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

    try {
      await plugin.start(this.context);
      this.startedPlugins.push(plugin);
    } catch (error) {
      const box = document.createElement('pre');
      box.style.cssText = `
        position:fixed;
        z-index:999999;
        left:8px;
        right:8px;
        top:8px;
        max-height:40vh;
        overflow:auto;
        padding:12px;
        background:#111827;
        color:#fff;
        border:2px solid #ef4444;
        border-radius:10px;
        white-space:pre-wrap;
        font:12px monospace;
      `;
      box.textContent =
        `PLUGIN FAILED: ${plugin.id}\n\n` +
        `${error?.stack ?? error?.message ?? String(error)}`;

      document.body.appendChild(box);

      throw error;
    }
  }
}
