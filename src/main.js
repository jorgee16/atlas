import './styles.css';
import "./ui/components/header/header.css";
import { createApp } from './app.js';

const root = document.querySelector('#app');

window.roamApp = await createApp(root);

if ('serviceWorker' in navigator) {
  // window.addEventListener(
  //   'load',
  //   () => navigator.serviceWorker
  //     .register('/sw.js')
  //     .catch(console.error)
  // );
}

