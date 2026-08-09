import {iconFor, escapeHtml, googleWalkingDirections} from './utils.js';

function firstText(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim()) ?? '';
}

function stopImage(place) {
  return firstText(place.image, place.thumbnail, place.imageUrl);
}

function stopMeta(place) {
  const time = firstText(place.time, place.startTime, place.start, place.timeLabel);
  const duration = firstText(place.duration, place.stay, place.durationLabel);
  return [time, duration].filter(Boolean).map(String).join(' · ');
}

export class ItineraryController {
  constructor({data, map, listElement, daySelect, status}) {
    this.days = data.trip.days;
    this.map = map;
    this.list = listElement;
    this.daySelect = daySelect;
    this.status = status;
    this.selected = null;
    this.selectedDay = null;
    this.onSelect = null;
    this.onRender = null;
    Object.keys(this.days).forEach(day => {
      const option = document.createElement('option');
      option.value = day;
      option.textContent = `Day ${day}`;
      this.daySelect.appendChild(option);
    });
    this.daySelect.addEventListener('change', () => this.render(this.daySelect.value));
  }

  setSelectHandler(handler) { this.onSelect = handler; }
  setRenderHandler(handler) { this.onRender = handler; }

  render(day) {
    this.selectedDay = String(day);
    this.daySelect.value = this.selectedDay;
    this.selected = null;
    const places = this.days[day] ?? [];
    this.list.innerHTML = '';
    if (!places.length) {
      this.list.innerHTML = '<div class="place"><b>No planned stops yet</b><small>This day is currently empty in the supplied itinerary — a good candidate for recommendations.</small></div>';
    }
    places.forEach((place, index) => {
      const element = document.createElement('div');
      element.className = 'place trip-timeline-stop';
      element.dataset.stopIndex = String(index);
      const meta = stopMeta(place);
      const image = stopImage(place);
      if (image) element.classList.add('has-thumbnail');
      element.innerHTML = `
        <div class="trip-stop-rail" aria-hidden="true"><span>${index + 1}</span></div>
        <div class="trip-stop-main">
          ${meta ? `<small class="trip-stop-meta">${escapeHtml(meta)}</small>` : ''}
          <b>${iconFor(place.type)} ${escapeHtml(place.name)}</b>
          ${place.note ? `<small class="trip-stop-note">${escapeHtml(place.note)}</small>` : ''}
          <div class="trip-stop-inline-actions" aria-label="Actions for ${escapeHtml(place.name)}">
            <button type="button" data-trip-nearby>Nearby</button>
            <button class="primary" type="button" data-trip-navigate>Navigate</button>
          </div>
        </div>`;
      if (image) {
        const thumbnail = document.createElement('img');
        thumbnail.className = 'trip-stop-thumb';
        thumbnail.src = String(image);
        thumbnail.alt = '';
        thumbnail.decoding = 'async';
        thumbnail.addEventListener('error', () => {
          thumbnail.remove();
          element.classList.remove('has-thumbnail');
        }, { once: true });
        const main = element.querySelector('.trip-stop-main');
        element.insertBefore(thumbnail, main);
      }
      element.addEventListener('click', event => {
        if (event.target.closest('[data-trip-nearby], [data-trip-navigate]')) return;
        this.select(place, element, null, {source: 'schedule'});
      });
      this.list.appendChild(element);
    });
    this.map.showItinerary(places, (place, marker) => this.select(place, null, marker, {source: 'map'}));
    this.onRender?.(this.selectedDay, places);
    this.status(`Day ${day} — ${places.length} planned stop${places.length === 1 ? '' : 's'}`, places.length ? 'Select a stop to discover what is nearby.' : 'Use this empty day as a candidate for trip recommendations.');
  }

  restoreSelection(place) {
    if (!place) return;
    this.selected = place;
    const places = this.days[this.selectedDay] ?? [];
    const index = places.findIndex(candidate => candidate === place || (
      candidate?.name === place.name && candidate?.lat === place.lat && candidate?.lon === place.lon
    ));
    this.list.querySelectorAll?.('.place').forEach(node => node.classList.remove('active'));
    if (index >= 0) this.list.querySelector?.(`[data-stop-index="${index}"]`)?.classList.add('active');
  }

  select(place, element = null, marker = null, meta = {}) {
    this.list.querySelectorAll?.('.place').forEach(node => node.classList.remove('active'));
    if (element) element.classList.add('active');
    else {
      const places = this.days[this.selectedDay] ?? [];
      const index = places.findIndex(candidate => candidate === place || (
        candidate?.name === place.name && candidate?.lat === place.lat && candidate?.lon === place.lon
      ));
      if (index >= 0) this.list.querySelector?.(`[data-stop-index="${index}"]`)?.classList.add('active');
    }
    this.selected = place;
    this.map.focus(place.lat, place.lon);
    if (marker) marker.openPopup();
    this.status(place.name, 'Ready to discover nearby cafés, restaurants, pubs and attractions.');
    this.onSelect?.(place, meta);
  }
}
