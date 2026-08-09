const STORAGE_KEY = 'roam.navigation.voice';

export class NavigationVoice {
  constructor({
    speechSynthesisRef =
      globalThis.speechSynthesis,
    Utterance =
      globalThis.SpeechSynthesisUtterance,
    storage = globalThis.localStorage
  } = {}) {
    this.speech = speechSynthesisRef;
    this.Utterance = Utterance;
    this.storage = storage;
    this.enabled = false;

    try {
      this.enabled =
        this.isSupported() &&
        this.storage?.getItem(STORAGE_KEY) ===
          'true';
    } catch {
      this.enabled = false;
    }
  }

  isSupported() {
    return Boolean(
      this.speech &&
      this.Utterance
    );
  }

  isEnabled() {
    return this.enabled;
  }

  setEnabled(enabled) {
    const desired = enabled === true;

    if (!this.isSupported()) {
      this.enabled = false;
      return false;
    }

    if (this.enabled === desired) {
      return this.enabled;
    }

    return this.toggle();
  }

  toggle() {
    if (!this.isSupported()) {
      return false;
    }

    this.enabled = !this.enabled;

    try {
      this.storage?.setItem(
        STORAGE_KEY,
        String(this.enabled)
      );
    } catch {
      // Voice still works for this session when storage is unavailable.
    }

    if (this.enabled) {
      this.speak('Voice guidance on.');
    } else {
      this.speech.cancel();
    }

    return this.enabled;
  }

  speak(text) {
    if (
      !this.enabled ||
      !this.isSupported() ||
      !text
    ) {
      return false;
    }

    const utterance = new this.Utterance(text);
    utterance.lang = 'en-GB';
    utterance.rate = 1;
    utterance.pitch = 1;

    this.speech.cancel();
    this.speech.speak(utterance);
    return true;
  }

  stop() {
    this.speech?.cancel?.();
  }
}

export function spokenInstruction(
  maneuver,
  distanceMeters
) {
  if (!maneuver) {
    return '';
  }

  if (distanceMeters <= 35) {
    return maneuver.instruction;
  }

  const roundedDistance = distanceMeters < 1000
    ? `${Math.max(
        50,
        Math.round(distanceMeters / 50) * 50
      )} metres`
    : `${(
        distanceMeters / 1000
      ).toFixed(1)} kilometres`;

  return `In ${roundedDistance}, ${maneuver.instruction}`;
}
