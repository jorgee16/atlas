import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import {
  GpsController
} from '../../src/gps.js';

const map =
  L.map('map')
    .setView(
      [51.5155, -0.1754],
      16
    );

L.tileLayer(
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  {
    maxZoom: 19,
    attribution:
      '© OpenStreetMap contributors'
  }
).addTo(map);

const truthLine =
  L.polyline(
    [],
    {
      weight: 4
    }
  ).addTo(map);

const rawLine =
  L.polyline(
    [],
    {
      weight: 2,
      dashArray: '5 7'
    }
  ).addTo(map);

const filteredLine =
  L.polyline(
    [],
    {
      weight: 5
    }
  ).addTo(map);

const truthMarker =
  L.circleMarker(
    [51.5155, -0.1754],
    {
      radius: 6
    }
  ).addTo(map);

const rawMarker =
  L.circleMarker(
    [51.5155, -0.1754],
    {
      radius: 6
    }
  ).addTo(map);

const filteredMarker =
  L.circleMarker(
    [51.5155, -0.1754],
    {
      radius: 7
    }
  ).addTo(map);

const stats =
  document.getElementById(
    'stats'
  );

const startButton =
  document.getElementById(
    'start'
  );

const stopButton =
  document.getElementById(
    'stop'
  );

const EARTH_METERS_PER_LAT =
  111320;

function offsetPoint(
  origin,
  northMeters,
  eastMeters
) {
  const latitude =
    origin.latitude +
    northMeters /
      EARTH_METERS_PER_LAT;

  const metersPerLon =
    EARTH_METERS_PER_LAT *
    Math.cos(
      origin.latitude *
      Math.PI /
      180
    );

  return {
    latitude,
    longitude:
      origin.longitude +
      eastMeters /
        metersPerLon
  };
}

function seededRandom(
  seed = 123456
) {
  let value =
    seed >>> 0;

  return () => {
    value =
      (
        value *
          1664525 +
        1013904223
      ) >>> 0;

    return (
      value /
      0xffffffff
    );
  };
}

function symmetric(random) {
  return (
    random() *
      2 -
    1
  );
}

function bearing(
  a,
  b
) {
  const lat1 =
    a.latitude *
    Math.PI /
    180;

  const lat2 =
    b.latitude *
    Math.PI /
    180;

  const dLon =
    (
      b.longitude -
      a.longitude
    ) *
    Math.PI /
    180;

  const y =
    Math.sin(dLon) *
    Math.cos(lat2);

  const x =
    Math.cos(lat1) *
      Math.sin(lat2) -
    Math.sin(lat1) *
      Math.cos(lat2) *
      Math.cos(dLon);

  return (
    Math.atan2(y, x) *
      180 /
      Math.PI +
    360
  ) % 360;
}

function accuracyForStep(step) {
  if (step < 15) {
    return (
      8 +
      Math.random() * 6
    );
  }

  if (step < 30) {
    return (
      20 +
      Math.random() * 15
    );
  }

  if (step < 42) {
    return (
      60 +
      Math.random() * 35
    );
  }

  if (step < 50) {
    return (
      100 +
      Math.random() * 25
    );
  }

  return (
    15 +
    Math.random() * 10
  );
}

const origin = {
  latitude: 51.5155,
  longitude: -0.1754
};

let timer = null;
let step = 0;

const random =
  seededRandom(42);

let lastTruth =
  origin;

let currentFiltered = null;

const gps =
  new GpsController({
    onUpdate(update) {
      currentFiltered =
        update;

      filteredMarker
        .setLatLng([
          update.latitude,
          update.longitude
        ]);

      filteredLine.addLatLng([
        update.latitude,
        update.longitude
      ]);

      stats.innerHTML = `
        <strong>Step ${step}</strong>
        <span>
          Accuracy:
          ${Math.round(
            update.accuracy
          )} m
        </span>
        <span>
          Trusted speed:
          ${update.speed.toFixed(2)}
          m/s
        </span>
        <span>
          Heading:
          ${
            Number.isFinite(
              update.heading
            )
              ? `${Math.round(
                  update.heading
                )}°`
              : '—'
          }
        </span>
      `;
    },

    onStatus() {}
  });

function truthForStep(index) {
  /*
   * 0-9:
   * stationary
   *
   * 10-39:
   * walking NE at about 1.4 m/s
   *
   * 40-59:
   * walking with degraded GPS
   *
   * 60+:
   * stationary again
   */

  if (index < 10) {
    return origin;
  }

  if (index >= 60) {
    return offsetPoint(
      origin,
      57.5,
      40
    );
  }

  const walkingStep =
    index - 10;

  return offsetPoint(
    origin,
    walkingStep * 1.15,
    walkingStep * 0.8
  );
}

function runStep() {
  const truth =
    truthForStep(step);

  const accuracy =
    accuracyForStep(step);

  let noiseRadius;

  if (accuracy < 20) {
    noiseRadius = 2;
  } else if (accuracy < 40) {
    noiseRadius = 5;
  } else if (accuracy < 90) {
    noiseRadius = 12;
  } else {
    noiseRadius = 24;
  }

  const raw =
    offsetPoint(
      truth,
      symmetric(random) *
        noiseRadius,
      symmetric(random) *
        noiseRadius
    );

  const truthHeading =
    bearing(
      lastTruth,
      truth
    );

  const fakeNativeSpeed =
    step < 10 ||
    step >= 60
      ? 0.8 +
        random() * 1.2
      : 1.0 +
        random();

  truthMarker.setLatLng([
    truth.latitude,
    truth.longitude
  ]);

  rawMarker.setLatLng([
    raw.latitude,
    raw.longitude
  ]);

  truthLine.addLatLng([
    truth.latitude,
    truth.longitude
  ]);

  rawLine.addLatLng([
    raw.latitude,
    raw.longitude
  ]);

  gps.handlePosition({
    coords: {
      latitude:
        raw.latitude,

      longitude:
        raw.longitude,

      accuracy,

      heading:
        Number.isFinite(
          truthHeading
        )
          ? truthHeading +
            symmetric(random) *
              25
          : null,

      speed:
        fakeNativeSpeed
    }
  });

  lastTruth =
    truth;

  step += 1;

  if (step > 75) {
    stopReplay();
  }
}

function startReplay() {
  if (timer !== null) {
    return;
  }

  timer =
    setInterval(
      runStep,
      1000
    );
}

function stopReplay() {
  if (timer === null) {
    return;
  }

  clearInterval(timer);
  timer = null;
}

startButton.addEventListener(
  'click',
  startReplay
);

stopButton.addEventListener(
  'click',
  stopReplay
);
