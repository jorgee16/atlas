import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NavigationGuidance
} from '../src/features/navigation/navigation-guidance.js';

import {
  NavigationVoice,
  spokenInstruction
} from '../src/features/navigation/navigation-voice.js';

class FakeElement {
  constructor() {
    this.hidden = true;
    this.dataset = {};
    this.innerHTML = '';
    this.listeners = new Map();
  }

  addEventListener(name, callback) {
    this.listeners.set(name, callback);
  }

  replaceChildren() {
    this.innerHTML = '';
  }
}

test(
  'distant complex maneuver stays compact with ETA and voice control',
  () => {
    const element = new FakeElement();

    const guidance = new NavigationGuidance({
      element,
      onStop: () => {},
      voiceState: () => ({
        enabled: true,
        supported: true
      }),
      now: () => 0
    });

    guidance.showRoute({
      route: {},
      destinationName: 'Praça do Comércio',
      progress: {
        distanceToManeuverMeters: 240,
        remainingDistanceMeters: 7_400,
        remainingDurationSeconds: 1_080,
        nextManeuver: {
          type: 'roundabout',
          exitNumber: 2,
          instruction:
            'At the roundabout, take the 2nd exit onto Avenida da República',
          roadName: 'Avenida da República',
          roadRef: 'N1'
        },
        followingManeuver: {
          type: 'turn-right',
          instruction:
            'Turn right onto Rua do Arsenal'
        }
      }
    });

    assert.equal(element.hidden, false);
    assert.equal(element.dataset.state, 'ready');
    assert.match(element.innerHTML, /250 m/);
    assert.match(element.innerHTML, /maneuver-exit-number[^>]*>2/);
    assert.match(element.innerHTML, /Avenida da República · N1/);
    assert.doesNotMatch(element.innerHTML, /At the roundabout/);
    assert.doesNotMatch(element.innerHTML, />Then</);
    assert.match(element.innerHTML, /Voice on/);
    assert.match(element.innerHTML, /navigation-guidance-compact/);
    assert.match(element.innerHTML, /navigation-journey-summary/);
    assert.match(element.innerHTML, /navigation-route-progress/);
  }
);


test(
  'simple distant maneuver uses the compact left HUD',
  () => {
    const element = new FakeElement();
    const guidance = new NavigationGuidance({ element, onStop: () => {} });

    guidance.showRoute({
      route: {},
      destinationName: 'Home',
      progress: {
        distanceToManeuverMeters: 550,
        remainingDistanceMeters: 2_000,
        remainingDurationSeconds: 300,
        nextManeuver: {
          type: 'turn-right',
          instruction: 'Turn right onto Unnamed road',
          roadName: 'Unnamed road'
        },
        followingManeuver: { type: 'turn-left', instruction: 'Turn left' }
      }
    });

    assert.match(element.innerHTML, /navigation-guidance-compact/);
    assert.doesNotMatch(element.innerHTML, /navigation-following-turn/);
    assert.doesNotMatch(element.innerHTML, /navigation-lane-guidance/);
  }
);

test(
  'near junction expands and highlights a recommended lane',
  () => {
    const element = new FakeElement();
    const guidance = new NavigationGuidance({ element, onStop: () => {} });

    guidance.showRoute({
      route: {},
      destinationName: 'Cascais',
      progress: {
        distanceToManeuverMeters: 120,
        remainingDistanceMeters: 1_200,
        remainingDurationSeconds: 180,
        nextManeuver: {
          type: 'fork',
          instruction: 'Keep right toward Cascais',
          lanes: [
            { indication: 'straight' },
            { indication: 'straight' },
            { indication: 'slight_right', recommended: true }
          ]
        },
        followingManeuver: null
      }
    });

    assert.match(element.innerHTML, /navigation-guidance-expanded/);
    assert.match(element.innerHTML, /navigation-lane-guidance/);
    assert.match(element.innerHTML, /navigation-lane is-recommended/);
  }
);

test(
  'driving HUD uses arrows, road names and lane arrows instead of instruction sentences',
  () => {
    const element = new FakeElement();
    const guidance = new NavigationGuidance({ element, onStop: () => {} });

    guidance.showRoute({
      route: { distanceMeters: 2000 },
      destinationName: 'Cascais',
      travelMode: 'drive',
      progress: {
        distanceToManeuverMeters: 120,
        remainingDistanceMeters: 1200,
        remainingDurationSeconds: 180,
        nextManeuver: {
          type: 'turn-right',
          instruction: 'Turn right onto IC25',
          roadRef: 'IC25',
          lanes: [
            { indication: 'straight' },
            { indication: 'right', recommended: true }
          ]
        },
        followingManeuver: {
          type: 'turn-left',
          instruction: 'Turn left onto A5',
          roadRef: 'A5'
        }
      }
    });

    assert.match(element.innerHTML, /IC25/);
    assert.match(element.innerHTML, /navigation-lane-guidance/);
    assert.match(element.innerHTML, /navigation-lane is-recommended/);
    assert.doesNotMatch(element.innerHTML, /Turn right onto IC25/);
    assert.doesNotMatch(element.innerHTML, /Turn left onto A5/);
    assert.doesNotMatch(element.innerHTML, />Then</);
  }
);


test(
  'voice guidance uses the installed speech engine and announces distance',
  () => {
    const spoken = [];

    const speech = {
      cancel: () => {},
      speak: utterance =>
        spoken.push(utterance.text)
    };

    class Utterance {
      constructor(text) {
        this.text = text;
      }
    }

    const storage = {
      value: null,
      getItem() {
        return this.value;
      },
      setItem(_key, value) {
        this.value = value;
      }
    };

    const voice = new NavigationVoice({
      speechSynthesisRef: speech,
      Utterance,
      storage
    });

    assert.equal(voice.toggle(), true);
    assert.equal(spoken[0], 'Voice guidance on.');

    voice.speak(
      spokenInstruction(
        {
          instruction:
            'Turn right onto Avenida Central'
        },
        240
      )
    );

    assert.equal(
      spoken[1],
      'In 250 metres, Turn right onto Avenida Central'
    );
  }
);


test(
  'guidance communicates GPS confidence states without replacing the driving layout',
  () => {
    const element = new FakeElement();
    const guidance = new NavigationGuidance({
      element,
      onStop: () => {},
      now: () => 0
    });

    const route = { distanceMeters: 1000 };
    const progress = {
      distanceToManeuverMeters: 120,
      remainingDistanceMeters: 700,
      remainingDurationSeconds: 300,
      nextManeuver: {
        type: 'turn-right',
        instruction: 'Turn right onto Main Street'
      },
      followingManeuver: null
    };

    guidance.showRoute({
      route,
      progress,
      destinationName: 'Home',
      navigationState: 'reduced'
    });
    assert.match(element.innerHTML, /GPS accuracy reduced/);
    assert.match(element.innerHTML, /navigation-journey-summary/);

    guidance.showRoute({
      route,
      progress,
      destinationName: 'Home',
      navigationState: 'checking'
    });
    assert.match(element.innerHTML, /Checking route/);

    guidance.showRoute({
      route,
      progress,
      destinationName: 'Home',
      navigationState: 'changed',
      canUndoRoute: true
    });
    assert.match(element.innerHTML, /Route changed/);
    assert.match(element.innerHTML, /data-navigation-undo-route/);
  }
);


test(
  'single-destination arrival stays compact and exposes Parking, Save, and Finish',
  () => {
    const element = new FakeElement();
    const guidance = new NavigationGuidance({
      element,
      onStop: () => {}
    });

    guidance.showArrival({
      destinationName: 'Belém Tower'
    });

    assert.equal(element.dataset.state, 'arrival');
    assert.match(element.innerHTML, /Arrived/);
    assert.match(element.innerHTML, /Belém Tower/);
    assert.match(element.innerHTML, />Parking</);
    assert.match(element.innerHTML, />Save</);
    assert.match(element.innerHTML, />Finish</);
    assert.doesNotMatch(element.innerHTML, /View trip/);
  }
);

test(
  'itinerary arrival preserves trip context and never auto-starts the next stop',
  () => {
    const element = new FakeElement();
    const guidance = new NavigationGuidance({
      element,
      onStop: () => {}
    });

    guidance.showArrival({
      destinationName: 'Museum',
      context: {
        type: 'itinerary',
        nextStop: { name: 'Castle' },
        isFinalStop: false
      }
    });

    assert.match(element.innerHTML, /Next stop/);
    assert.match(element.innerHTML, /Castle/);
    assert.match(element.innerHTML, />View trip</);
    assert.match(element.innerHTML, />Finish</);
    assert.doesNotMatch(element.innerHTML, /Start navigation/);
  }
);
