import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NavigationVoice,
  spokenInstruction
} from '../src/features/navigation/navigation-voice.js';

test(
  'voice guidance uses the installed speech engine and persists its toggle',
  () => {
    const calls = [];

    class FakeUtterance {
      constructor(text) {
        this.text = text;
      }
    }

    const stored = new Map([
      ['roam.navigation.voice', 'true']
    ]);

    const voice = new NavigationVoice({
      speechSynthesisRef: {
        cancel: () => calls.push('cancel'),
        speak: utterance =>
          calls.push(utterance)
      },
      Utterance: FakeUtterance,
      storage: {
        getItem: key => stored.get(key),
        setItem: (key, value) =>
          stored.set(key, value)
      }
    });

    assert.equal(voice.isEnabled(), true);
    assert.equal(
      voice.speak('Turn right.'),
      true
    );
    assert.equal(calls[1].text, 'Turn right.');
    assert.equal(calls[1].lang, 'en-GB');

    assert.equal(voice.toggle(), false);
    assert.equal(
      stored.get('roam.navigation.voice'),
      'false'
    );
  }
);

test(
  'spoken instructions add a useful offline distance prefix',
  () => {
    const maneuver = {
      instruction:
        'Turn right onto Avenida Central.'
    };

    assert.equal(
      spokenInstruction(maneuver, 180),
      'In 200 metres, Turn right onto Avenida Central.'
    );

    assert.equal(
      spokenInstruction(maneuver, 20),
      maneuver.instruction
    );
  }
);

test(
  'voice guidance can be set explicitly for Settings without double toggling',
  () => {
    class FakeUtterance {
      constructor(text) { this.text = text; }
    }

    const stored = new Map();
    const voice = new NavigationVoice({
      speechSynthesisRef: {
        cancel: () => {},
        speak: () => {}
      },
      Utterance: FakeUtterance,
      storage: {
        getItem: key => stored.get(key) ?? null,
        setItem: (key, value) => stored.set(key, value)
      }
    });

    assert.equal(voice.setEnabled(true), true);
    assert.equal(voice.setEnabled(true), true);
    assert.equal(stored.get('roam.navigation.voice'), 'true');
    assert.equal(voice.setEnabled(false), false);
    assert.equal(stored.get('roam.navigation.voice'), 'false');
  }
);
