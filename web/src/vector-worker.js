// Web Worker wrapper around the vectorizer so the page stays responsive while it traces.
import { vectorizeRaster } from './vector-engine.js';

self.onmessage = (e) => {
  const { bytes, w, h, ow, oh, settings } = e.data;
  try {
    const result = vectorizeRaster(new Uint8ClampedArray(bytes), w, h, ow, oh, settings, (label, progress) => self.postMessage({ label, progress }));
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message || 'FAILED' });
  }
};
