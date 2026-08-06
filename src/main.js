import './styles.css';
import {createApp} from './app.js';

createApp(document.querySelector('#app'));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(console.error));
}
