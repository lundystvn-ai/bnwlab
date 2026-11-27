// Runs the gangsheet layout off the main thread so the page stays responsive.
import { pack } from './engine.js';

self.onmessage = (e) => {
  try { self.postMessage({ items: pack(e.data) }); }
  catch (err) { self.postMessage({ error: err?.message || 'pack' }); }
};
