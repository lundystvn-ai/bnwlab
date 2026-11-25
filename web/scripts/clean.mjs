// Removes the previous build output from the repo root (GitHub Pages serves the root).
import { rmSync } from 'node:fs';
rmSync(new URL('../../assets', import.meta.url), { recursive: true, force: true });
