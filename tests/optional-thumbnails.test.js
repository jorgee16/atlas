import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const itinerary = fs.readFileSync(new URL('../src/itinerary.js', import.meta.url), 'utf8');
const trip = fs.readFileSync(new URL('../src/features/trip/trip-feature.js', import.meta.url), 'utf8');
const bookmarks = fs.readFileSync(new URL('../src/features/bookmarks/bookmarks-feature.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('Trip and Bookmarks support tiny optional thumbnails without requiring images', () => {
  assert.match(itinerary, /place\.image, place\.thumbnail, place\.imageUrl/);
  assert.match(itinerary, /trip-stop-thumb/);
  assert.match(trip, /trip-map-stop-thumb/);
  assert.match(bookmarks, /image = null, thumbnail = null, imageUrl = null/);
  assert.match(bookmarks, /bookmark-library-thumb/);
  assert.match(styles, /\.bookmark-library-thumb/);
  assert.match(styles, /\.trip-stop-thumb/);
  assert.match(styles, /\.trip-map-stop-thumb/);
});
