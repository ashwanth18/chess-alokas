import { registerSW } from 'virtual:pwa-register';

/** Check for a new service worker as soon as the tab loads, then reload once. */
registerSW({ immediate: true });
