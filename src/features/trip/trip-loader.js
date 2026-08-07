export class TripLoader {
  async loadFromUrl(url) {
    if (!url) {
      throw new TypeError(
        'TripLoader.loadFromUrl requires a URL.'
      );
    }

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Could not load trip: ${response.status}`
      );
    }

    const data = await response.json();

    this.validate(data);

    return data;
  }

  async loadFromFile(file) {
    if (!(file instanceof File)) {
      throw new TypeError(
        'TripLoader.loadFromFile requires a File.'
      );
    }

    const text = await file.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        'The selected trip file is not valid JSON.'
      );
    }

    this.validate(data);

    return data;
  }

  validate(data) {
    if (!data || typeof data !== 'object') {
      throw new Error(
        'Trip data must be an object.'
      );
    }

    if (
      !data.trip ||
      typeof data.trip !== 'object'
    ) {
      throw new Error(
        'Trip data requires a trip object.'
      );
    }

    const days = data.trip.days;

    if (
      !days ||
      typeof days !== 'object' ||
      Array.isArray(days)
    ) {
      throw new Error(
        'Trip data requires trip.days as an object.'
      );
    }

    Object.entries(days).forEach(
      ([dayId, places]) => {
        if (!Array.isArray(places)) {
          throw new Error(
            `Trip day "${dayId}" must be an array.`
          );
        }

        places.forEach((place, index) => {
          if (!place || typeof place !== 'object') {
            throw new Error(
              `Trip day "${dayId}", place ${index} must be an object.`
            );
          }

          if (
            typeof place.name !== 'string' ||
            !Number.isFinite(place.lat) ||
            !Number.isFinite(place.lon)
          ) {
            throw new Error(
              `Trip day "${dayId}", place ${index} requires name, lat and lon.`
            );
          }
        });
      }
    );
  }
}
