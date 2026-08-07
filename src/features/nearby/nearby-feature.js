import {
  queryNearby,
  nearbyCardHtml
} from '../../nearby.js';

import {
  escapeHtml,
  formatDistance,
  googleWalkingDirections
} from '../../utils.js';

export class NearbyFeature {
  constructor({
    map,
    panelController,
    listElement,
    chipElements,
    status
  }) {
    if (!map) {
      throw new TypeError(
        'NearbyFeature requires a map controller.'
      );
    }

    if (!panelController) {
      throw new TypeError(
        'NearbyFeature requires a panel controller.'
      );
    }

    if (!listElement) {
      throw new TypeError(
        'NearbyFeature requires a list element.'
      );
    }

    this.map = map;
    this.panelController = panelController;
    this.listElement = listElement;
    this.chipElements = [...chipElements];
    this.status = status;

    this.results = [];
    this.category = 'all';

    this.bindFilters();
  }

  async search(anchor, {
    expandPanel = true
  } = {}) {
    if (!anchor) {
      throw new TypeError(
        'NearbyFeature.search requires an anchor.'
      );
    }

    if (expandPanel) {
        this.panelController.showMode(
          'explore',
          { snap: 'expanded' }
        );
      }

    this.map.clearNearby();

    this.status(
      'Searching nearby…',
      'Searching the installed local region database.'
    );

    try {
      this.results = await queryNearby(anchor);
      this.render();

      this.status(
        `Nearby: ${this.results.length} places`,
        `Within about 900 m of ${
          anchor.name ?? 'your location'
        }.`
      );
    } catch (error) {
      console.error(error);

      this.status(
        'Nearby search unavailable',
        error.message ||
          'Local region data could not be loaded.'
      );
    }
  }

  clear() {
    this.results = [];
    this.map.clearNearby();

    this.listElement
      .querySelector('.nearby')
      ?.remove();
  }

  render() {
    this.listElement
      .querySelector('.nearby')
      ?.remove();

    this.map.clearNearby();

    const items = this.results
      .filter(place =>
        this.category === 'all' ||
        place.type === this.category
      )
      .slice(0, 40);

    if (!items.length) {
      return;
    }

    const container = document.createElement('div');
    container.className = 'nearby';

    container.innerHTML = `
      <div class="section-title">
        Nearby discoveries
        <span>${items.length}</span>
      </div>
    `;

    items.forEach(place => {
      const card = document.createElement('div');

      card.className = 'nearby-card';
      card.innerHTML = nearbyCardHtml(place);

      container.appendChild(card);

      const popup = `
        <b>${escapeHtml(place.name)}</b><br>
        ${escapeHtml(place.amenity || 'place')}<br>
        ${formatDistance(place.distance)} away
        <br><br>
        <a
          target="_blank"
          rel="noopener"
          href="${googleWalkingDirections(place.name)}"
        >
          Open Google Maps →
        </a>
      `;

      this.map.addNearby(place, popup);
    });

    this.listElement.appendChild(container);
  }

  bindFilters() {
    this.chipElements.forEach(chip => {
      chip.addEventListener('click', () => {
        this.chipElements.forEach(node => {
          node.classList.remove('on');
        });

        chip.classList.add('on');
        this.category = chip.dataset.cat;
        this.render();
      });
    });
  }
}
