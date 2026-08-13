import {
  queryNearby,
  nearbyCardHtml,
  nearbyPresentation
} from '../../nearby.js';

import {
  escapeHtml,
  formatDistance
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
    this.fullResults = false;
    this.resultsVisible = false;

    this.bindFilters();
    this.listElement.addEventListener('click', event => {
      if (event.target.closest('[data-nearby-see-all]')) {
        this.fullResults = true;
        this.render();
      }

      if (event.target.closest('[data-nearby-close-all]')) {
        this.fullResults = false;
        this.render();
      }

      if (event.target.closest('[data-nearby-dismiss]')) {
        this.dismissResults();
      }

      const showButton = event.target.closest('[data-nearby-show]');
      if (showButton) {
        const place = this.placeById(showButton.dataset.nearbyShow);
        if (place) {
          this.map.focus(place.lat, place.lon, 17);
          this.map.showSelectionPin(place.lat, place.lon);
        }
      }

      const navigateButton = event.target.closest('[data-nearby-navigate]');
      if (navigateButton) {
        const place = this.placeById(
          navigateButton.dataset.nearbyNavigate
        );
        if (place) {
          this.listElement.dispatchEvent(
            new CustomEvent('nearbynavigate', {
              bubbles: true,
              detail: { place }
            })
          );
        }
      }

      const bookmarkButton =
        event.target.closest('[data-nearby-bookmark]');

      if (bookmarkButton) {
        const place = this.placeById(
          bookmarkButton.dataset.nearbyBookmark
        );

        if (place) {
          this.listElement.dispatchEvent(
            new CustomEvent('nearbybookmark', {
              bubbles: true,
              detail: { place }
            })
          );
        }
      }
    });
  }

  syncFullResultsUiState() {
    const root =
      this.listElement.ownerDocument
        ?.documentElement;

    root?.classList.toggle(
      'atlas-nearby-open',
      this.resultsVisible
    );

    root?.classList.toggle(
      'atlas-nearby-full',
      this.fullResults && this.resultsVisible
    );
  }

  async search(anchor) {
    if (!anchor) {
      throw new TypeError(
        'NearbyFeature.search requires an anchor.'
      );
    }

    this.map.clearNearby();
    this.fullResults = false;
    this.resultsVisible = true;
    this.syncFullResultsUiState();

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

  dismissResults() {
    this.resultsVisible = false;
    this.fullResults = false;
    this.syncFullResultsUiState();
    this.listElement.replaceChildren();
  }

  showResults() {
    this.resultsVisible = true;
    this.render();
  }

  clear() {
    this.results = [];
    this.fullResults = false;
    this.resultsVisible = false;
    this.syncFullResultsUiState();
    this.map.clearNearby();
    this.listElement.replaceChildren();
  }

  render() {
    this.syncFullResultsUiState();
    this.listElement.replaceChildren();
    this.map.clearNearby();

    const items = this.deduplicatePlaces(
      this.results.filter(place =>
        this.category === 'all' ||
        place.type === this.category
      )
    ).slice(0, 40);

    if (!items.length) {
      return;
    }

    for (const place of items) {
      const presentation = nearbyPresentation(place);
      const popup = `
        <b>${escapeHtml(place.name)}</b><br>
        ${escapeHtml(presentation.category)} ·
        ${formatDistance(place.distance)} away
      `;

      this.map.addNearby(place, popup);
    }

    if (!this.resultsVisible) {
      return;
    }

    const visible = this.fullResults ? items : items.slice(0, 2);
    const container = document.createElement('div');
    container.className = this.fullResults
      ? 'nearby nearby--full'
      : 'nearby nearby--peek';

    container.innerHTML = `
      <div class="nearby-peek-header">
        <div>
          <small>${this.category === 'all' ? 'Around you' : 'Nearby'}</small>
          <strong>${items.length} ${items.length === 1 ? 'place' : 'places'}</strong>
        </div>
        <button
          type="button"
          data-nearby-dismiss
          aria-label="Hide nearby results"
          title="Full map"
        >×</button>
      </div>
    `;

    for (const place of visible) {
      const card = document.createElement('div');
      card.className = 'nearby-card';
      card.innerHTML = nearbyCardHtml(place);
      card.querySelectorAll('.nearby-thumb').forEach(thumbnail => {
        thumbnail.addEventListener('error', () => {
          const resultCard = thumbnail.closest('.nearby-card');
          thumbnail.remove();
          resultCard?.classList.remove('has-thumbnail');
        }, { once: true });
      });
      container.appendChild(card);
    }

    if (!this.fullResults && items.length > 2) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'nearby-see-all';
      more.dataset.nearbySeeAll = '';
      more.textContent = `See all ${items.length}`;
      container.appendChild(more);
    }

    this.listElement.appendChild(container);
  }

  placeById(id) {
    return this.results.find(place => {
      const placeId = String(
        place.id ??
        `${place.name ?? 'place'}:${place.lat ?? ''}:${place.lon ?? ''}`
      );
      return placeId === String(id);
    }) ?? null;
  }

  deduplicatePlaces(places) {
    const unique = [];
    for (const place of places) {
      const duplicateIndex = unique.findIndex(existing =>
        this.sameNearbyPlace(existing, place)
      );
      if (duplicateIndex === -1) {
        unique.push(place);
      } else if (
        this.placeQuality(place) >
        this.placeQuality(unique[duplicateIndex])
      ) {
        unique[duplicateIndex] = place;
      }
    }
    return unique;
  }

  sameNearbyPlace(left, right) {
    if (String(left.id) === String(right.id)) return true;
    if (left.wikidata && right.wikidata && left.wikidata === right.wikidata) {
      return true;
    }

    const leftName = String(left.name || '').trim().toLocaleLowerCase();
    const rightName = String(right.name || '').trim().toLocaleLowerCase();
    const latDelta = Math.abs(Number(left.lat) - Number(right.lat));
    const lonDelta = Math.abs(Number(left.lon) - Number(right.lon));

    if (latDelta > 0.00012 || lonDelta > 0.00018) return false;
    if (leftName === rightName) return true;

    const landmarkCategories = new Set([
      'Landmark',
      'Attraction',
      'Museum',
      'Place of Worship'
    ]);
    return (
      landmarkCategories.has(nearbyPresentation(left).category) &&
      landmarkCategories.has(nearbyPresentation(right).category)
    );
  }

  placeQuality(place) {
    let score = 0;
    if (place.image || place.thumbnail || place.imageUrl) score += 8;
    if (place.wikimedia_commons) score += 7;
    if (place.opening_hours) score += 4;
    if (place['addr:street'] || place.address) score += 3;
    if (place.wikidata) score += 2;
    score += Math.max(0, 3 - String(place.name || '').length / 20);
    return score;
  }

  bindFilters() {
    this.chipElements.forEach(chip => {
      chip.addEventListener('click', () => {
        this.chipElements.forEach(node => {
          node.classList.remove('on');
        });

        chip.classList.add('on');
        this.category = chip.dataset.cat;
        this.fullResults = false;
        this.resultsVisible = true;
        this.render();
      });
    });
  }
}
