# Map Context Controller

`MapContextController` is the single owner of the floating map header.

Other modules do not update the header DOM directly.

Supported modes:

- `idle`
- `following`
- `exploring`

Example:

    mapContext.showFollowing({
      heading: position.heading,
      speed: position.speed
    });

    mapContext.showExploring({
      lat,
      lon,
      zoom
    });

This prevents GPS updates and map movement events from fighting over the
same UI elements.
