export class JourneyProvider {
  async journeys(_origin, _destination, _options = {}) {
    throw new Error('JourneyProvider.journeys() must be implemented.');
  }
}
