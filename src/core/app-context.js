export class AppContext {
  constructor({
    root,
    map,
    panelController,
    mapContext,
    statusController,
    status
  }) {
    this.root = root;
    this.map = map;
    this.panelController = panelController;
    this.mapContext = mapContext;
    this.statusController = statusController;
    this.status = status;

    this.services = new Map();
  }

  provide(name, service) {
    if (!name) {
      throw new TypeError(
        'AppContext.provide requires a service name.'
      );
    }

    if (this.services.has(name)) {
      throw new Error(
        `Service already registered: ${name}`
      );
    }

    this.services.set(name, service);

    return service;
  }

  get(name) {
    if (!this.services.has(name)) {
      throw new Error(
        `Service is not registered: ${name}`
      );
    }

    return this.services.get(name);
  }

  has(name) {
    return this.services.has(name);
  }
}
