import {iconFor, escapeHtml, googleWalkingDirections} from './utils.js';

export class ItineraryController {
  constructor({data, map, listElement, daySelect, status}) {
    this.days = data.trip.days;
    this.map = map;
    this.list = listElement;
    this.daySelect = daySelect;
    this.status = status;
    this.selected = null;
    this.onSelect = null;
    Object.keys(this.days).forEach(day => {
      const option = document.createElement('option');
      option.value = day;
      option.textContent = `Day ${day}`;
      this.daySelect.appendChild(option);
    });
    this.daySelect.addEventListener('change', () => this.render(this.daySelect.value));
  }

  setSelectHandler(handler) { this.onSelect = handler; }

  render(day) {
    this.selected = null;
    const places = this.days[day] ?? [];
    this.list.innerHTML = '';
    if (!places.length) {
      this.list.innerHTML = '<div class="place"><b>No planned stops yet</b><small>This day is currently empty in the supplied itinerary — a good candidate for recommendations.</small></div>';
    }
    places.forEach((place, index) => {
      const element = document.createElement('div');
      element.className = 'place';
      element.innerHTML = `<div class="top"><b>${iconFor(place.type)} ${escapeHtml(place.name)}</b><span>${index + 1}</span></div><small>${escapeHtml(place.note)}</small>`;
      element.addEventListener('click', () => this.select(place, element));
      this.list.appendChild(element);
    });
    this.map.showItinerary(places, (place, marker) => this.select(place, null, marker));
    this.status(`Day ${day} — ${places.length} planned stop${places.length === 1 ? '' : 's'}`, places.length ? 'Select a stop to discover what is nearby.' : 'Use this empty day as a candidate for trip recommendations.');
  }

  select(place, element = null, marker = null) {
    document.querySelectorAll('.place').forEach(node => node.classList.remove('active'));
    if (element) element.classList.add('active');
    this.selected = place;
    this.map.focus(place.lat, place.lon);
    if (marker) marker.openPopup();
    this.status(place.name, 'Ready to discover nearby cafés, restaurants, pubs and attractions.');
    this.onSelect?.(place);
  }
}
