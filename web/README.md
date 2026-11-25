# bnwlab.com source

Vite + vanilla JS. Builds straight into the repo root, which GitHub Pages serves.

    cd web
    npm install
    npm run build      # writes ../index.html and ../assets/

- `src/engine.js` – KTX knockout & raster (runs in the browser; byte-identical to the previous site)
- `src/editor.js` – Knockout & Raster editor · `src/upscale.js` – BigJPG upscale
- `src/history.js` – download history · `src/settings.js` – admin settings
- `src/session.js` – auth, credits, top-up · `src/tokens.css` – design tokens (dark default, light option)

The previous single-file site is kept at `/legacy.html`.
