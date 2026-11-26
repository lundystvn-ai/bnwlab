// Passes an image from the Cek Gambar page to the Editor without uploading it again.
let pending = null;
export const giveHandoff = (file) => { pending = file || null; };
export const takeHandoff = () => { const f = pending; pending = null; return f; };
