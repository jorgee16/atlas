# GPS Heading Marker

The GPS marker displays a directional arrow when:

- heading is a finite value
- speed is at least 0.8 m/s

Otherwise, Roam displays the normal circular GPS marker.

Heading values follow the browser Geolocation API:

- 0° north
- 90° east
- 180° south
- 270° west
