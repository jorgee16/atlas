# Atlas bootstrap resilience V3.6

Hardens startup without changing routing logic.

- Each plugin start is isolated; one plugin no longer prevents later plugins from starting.
- Plugin stop failures are isolated too.
- AppBootstrap reports failed plugin IDs through Atlas status.
- `index.html` installs an early fatal error boundary before the app module runs, surfacing runtime and unhandled-promise failures instead of a silent frozen screen.
- Installer is guarded against unexpected source shapes and creates `.v36-backup` files.

Apply from the Atlas repository root, then run tests/build/dev.
