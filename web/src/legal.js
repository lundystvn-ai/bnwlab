// Kebijakan Privasi and Syarat & Ketentuan (Indonesian + English), public pages.
import { L } from './i18n.js';
import { cfg } from './config.js';
import { esc } from './util.js';

const UPDATED = { id: '26 November 2026', en: '26 November 2026' };

const contact = () => {
  const wa = String(cfg.kontakWhatsApp || '').replace(/\D/g, '');
  return L(
    `Hubungi kami lewat halaman <a href="#support">Support</a>${wa ? `, WhatsApp <a href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">+${esc(wa)}</a>` : ''}, atau Instagram <a href="https://www.instagram.com/bnwlab.id" target="_blank" rel="noopener">@bnwlab.id</a>.`,
    `Contact us through the <a href="#support">Support</a> page${wa ? `, WhatsApp <a href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">+${esc(wa)}</a>` : ''}, or Instagram <a href="https://www.instagram.com/bnwlab.id" target="_blank" rel="noopener">@bnwlab.id</a>.`);
};

function privacy() {
  return {
    title: L('Kebijakan Privasi', 'Privacy Policy'),
    intro: L(
      'Kebijakan ini menjelaskan data apa yang dikumpulkan BNW Design Lab ("kami") saat Anda memakai bnwlab.com, untuk apa data itu dipakai, dan hak Anda atas data tersebut.',
      'This policy explains what data BNW Design Lab ("we") collects when you use bnwlab.com, what we use it for, and your rights over it.'),
    sections: [
      [L('1. Data yang kami kumpulkan', '1. Data we collect'), L(`
        <ul>
          <li><b>Data akun:</b> nama dan alamat email. Password disimpan dalam bentuk terenkripsi oleh penyedia layanan login kami; kami tidak dapat melihatnya.</li>
          <li><b>Data kredit dan pembayaran:</b> paket yang dibeli, nominal, kode pembayaran, status, dan waktunya. Pembayaran QRIS dilakukan di aplikasi e-wallet atau m-banking Anda sendiri, jadi kami <b>tidak</b> menerima atau menyimpan nomor rekening, kartu, atau PIN.</li>
          <li><b>Riwayat unduhan:</b> nama file, jenis proses (misalnya raster bulat + knockout), ukuran gambar dalam piksel, pilihan warna kaos, dan waktu unduh.</li>
          <li><b>Riwayat upscale:</b> nama file, skala, jenis gambar, status, dan link hasil.</li>
          <li><b>Pesan Support:</b> isi pesan, topik, dan nomor WhatsApp bila Anda mengisinya.</li>
          <li><b>Penyimpanan di browser:</b> sesi login, pilihan tema, dan pilihan bahasa disimpan di browser Anda (local storage). Kami tidak memakai cookie iklan atau pelacak pihak ketiga.</li>
        </ul>`, `
        <ul>
          <li><b>Account data:</b> your name and email address. Passwords are stored encrypted by our sign-in provider; we cannot see them.</li>
          <li><b>Credit and payment data:</b> the pack you bought, the amount, payment code, status and time. QRIS payments are made in your own e-wallet or banking app, so we do <b>not</b> receive or store account numbers, card numbers or PINs.</li>
          <li><b>Download history:</b> file name, operation (for example round raster + knockout), image size in pixels, shirt colour preview and time.</li>
          <li><b>Upscale history:</b> file name, scale, image type, status and result link.</li>
          <li><b>Support messages:</b> the message, its topic, and your WhatsApp number if you give it.</li>
          <li><b>Browser storage:</b> your sign-in session, theme and language are kept in your browser (local storage). We use no advertising cookies or third-party trackers.</li>
        </ul>`)],
      [L('2. Gambar Anda', '2. Your images'), L(`
        <ul>
          <li><b>Knockout dan Raster</b> diproses sepenuhnya di browser Anda. Gambar tidak pernah diunggah ke server kami.</li>
          <li><b>Upscale</b> mengunggah gambar ke penyimpanan kami, lalu mengirimkannya ke penyedia layanan upscale pihak ketiga untuk diproses. Gambar asli dihapus dari penyimpanan kami setelah proses selesai atau gagal. Hasil upscale disimpan oleh penyedia tersebut dan bisa diunduh lewat link yang berlaku terbatas.</li>
        </ul>`, `
        <ul>
          <li><b>Knockout and Raster</b> run entirely in your browser. Your images are never uploaded to our servers.</li>
          <li><b>Upscale</b> uploads the image to our storage and sends it to a third-party upscaling provider for processing. The original is deleted from our storage once processing finishes or fails. The upscaled result is held by that provider and can be downloaded from a link that expires.</li>
        </ul>`)],
      [L('3. Untuk apa data dipakai', '3. How we use data'), L(`
        <ul>
          <li>Menjalankan layanan: login, saldo kredit, unduhan, upscale, dan riwayat.</li>
          <li>Memeriksa dan mengonfirmasi pembayaran. Saat Anda menekan "Saya sudah bayar", admin menerima notifikasi internal berisi email akun, paket, nominal, dan kode pembayaran.</li>
          <li>Menjawab pesan Support.</li>
          <li>Mencegah penyalahgunaan, misalnya pembuatan banyak akun untuk mengambil kredit gratis.</li>
        </ul>
        <p>Kami tidak menjual data Anda dan tidak memakainya untuk iklan.</p>`, `
        <ul>
          <li>To run the service: sign-in, credit balance, downloads, upscaling and history.</li>
          <li>To check and confirm payments. When you press "I have paid", the admin receives an internal notification with your account email, pack, amount and payment code.</li>
          <li>To answer Support messages.</li>
          <li>To prevent abuse, such as creating many accounts to collect free credits.</li>
        </ul>
        <p>We do not sell your data and do not use it for advertising.</p>`)],
      [L('4. Pihak yang membantu kami', '4. Service providers'), L(`
        <p>Kami memakai beberapa penyedia layanan yang hanya memproses data sesuai kebutuhan layanan ini:</p>
        <ul>
          <li>Penyedia hosting website, database, login, dan penyimpanan file (layanan cloud).</li>
          <li>Penyedia layanan upscale gambar (hanya untuk gambar yang Anda upscale).</li>
          <li>Layanan pesan untuk notifikasi internal admin tentang pembayaran.</li>
          <li>Have I Been Pwned: saat Anda membuat password, browser hanya mengirim 5 karakter pertama dari sidik digital (hash) password untuk mengecek apakah password itu pernah bocor. Password Anda sendiri tidak pernah dikirim.</li>
        </ul>
        <p>Kami juga dapat membuka data bila diwajibkan oleh hukum yang berlaku.</p>`, `
        <p>We use a few providers that only process data as needed to run this service:</p>
        <ul>
          <li>Cloud providers for website hosting, database, sign-in and file storage.</li>
          <li>An image upscaling provider (only for images you upscale).</li>
          <li>A messaging service for internal admin notifications about payments.</li>
          <li>Have I Been Pwned: when you create a password, your browser sends only the first 5 characters of the password's hash to check whether it has appeared in a breach. Your password itself is never sent.</li>
        </ul>
        <p>We may also disclose data when required by applicable law.</p>`)],
      [L('5. Berapa lama data disimpan', '5. How long we keep data'), L(`
        <p>Data akun, kredit, dan riwayat disimpan selama akun Anda aktif. Catatan pembayaran dapat disimpan lebih lama untuk keperluan pembukuan. Gambar untuk upscale dihapus dari penyimpanan kami setelah diproses.</p>`, `
        <p>Account, credit and history data are kept while your account is active. Payment records may be kept longer for bookkeeping. Images for upscaling are deleted from our storage after processing.</p>`)],
      [L('6. Hak Anda', '6. Your rights'), L(`
        <p>Sesuai peraturan yang berlaku di Indonesia, termasuk Undang-Undang Pelindungan Data Pribadi, Anda dapat meminta salinan data Anda, memperbaiki data yang salah, atau menghapus akun beserta datanya. Kirim permintaan lewat halaman Support. Kredit yang tersisa akan hilang bila akun dihapus.</p>`, `
        <p>Under the laws that apply in Indonesia, including the Personal Data Protection Law, you can ask for a copy of your data, correct wrong data, or delete your account and its data. Send your request through the Support page. Any remaining credits are lost when an account is deleted.</p>`)],
      [L('7. Keamanan', '7. Security'), L(`
        <p>Data dikirim lewat koneksi terenkripsi (HTTPS). Akses data dibatasi per akun: Anda hanya bisa melihat data milik Anda sendiri. Tidak ada sistem yang sepenuhnya kebal, jadi pakai password yang kuat dan tidak dipakai di tempat lain.</p>`, `
        <p>Data travels over encrypted connections (HTTPS). Access is restricted per account: you can only see your own data. No system is completely secure, so use a strong password that you don't use anywhere else.</p>`)],
      [L('8. Perubahan kebijakan', '8. Changes to this policy'), L(`
        <p>Kebijakan ini dapat diperbarui. Tanggal di atas menunjukkan versi terakhir. Perubahan penting akan kami umumkan di website.</p>`, `
        <p>We may update this policy. The date above shows the latest version. We will announce important changes on the website.</p>`)],
      [L('9. Kontak', '9. Contact'), `<p>${contact()}</p>`],
    ],
  };
}

function terms() {
  return {
    title: L('Syarat & Ketentuan', 'Terms of Service'),
    intro: L(
      'Dengan membuat akun atau memakai bnwlab.com, Anda menyetujui syarat berikut. Layanan ini dijalankan oleh BNW Design Lab ("kami").',
      'By creating an account or using bnwlab.com you agree to these terms. The service is run by BNW Design Lab ("we").'),
    sections: [
      [L('1. Layanan', '1. The service'), L(`
        <p>BNW Lab menyediakan alat untuk menyiapkan file cetak DTF: knockout latar, raster halftone, dan upscale gambar. Pratinjau di layar gratis; mengunduh hasil dan upscale memakai kredit.</p>`, `
        <p>BNW Lab provides tools to prepare DTF print files: background knockout, halftone raster and image upscaling. On-screen previews are free; downloading results and upscaling use credits.</p>`)],
      [L('2. Akun', '2. Accounts'), L(`
        <ul>
          <li>Isi data yang benar dan jaga kerahasiaan password Anda. Anda bertanggung jawab atas semua aktivitas di akun Anda.</li>
          <li>Bonus kredit untuk akun baru berlaku satu kali per orang. Kami dapat menghapus bonus atau menangguhkan akun yang dibuat berulang untuk mengambil kredit gratis.</li>
        </ul>`, `
        <ul>
          <li>Give accurate details and keep your password secret. You are responsible for all activity on your account.</li>
          <li>The new-account credit bonus is once per person. We may remove bonuses from, or suspend, accounts created repeatedly to collect free credits.</li>
        </ul>`)],
      [L('3. Kredit dan pembayaran', '3. Credits and payment'), L(`
        <ul>
          <li>Harga dalam Rupiah dan tertera di halaman Harga. Pembayaran dilakukan dengan QRIS sesuai nominal paket.</li>
          <li>Kredit masuk setelah admin memastikan pembayaran diterima. Simpan kode pembayaran sampai kredit masuk.</li>
          <li>Kredit tidak memiliki masa berlaku, tidak dapat ditukar dengan uang, dan tidak dapat dipindahkan ke akun lain.</li>
          <li>Kredit yang sudah terpakai tidak dapat dikembalikan. Bila upscale gagal, kreditnya dikembalikan otomatis.</li>
          <li>Bila Anda sudah membayar tetapi kredit belum masuk, atau membayar dengan nominal yang salah, hubungi kami lewat Support dengan kode pembayarannya. Kami akan memeriksa dan menyelesaikannya.</li>
          <li>Harga dapat berubah. Perubahan harga tidak memengaruhi kredit yang sudah Anda beli.</li>
        </ul>`, `
        <ul>
          <li>Prices are in Indonesian Rupiah and shown on the Pricing page. Payment is by QRIS for the pack amount.</li>
          <li>Credits are added once the admin has confirmed the payment was received. Keep your payment code until the credits arrive.</li>
          <li>Credits do not expire, cannot be exchanged for cash, and cannot be moved to another account.</li>
          <li>Used credits are not refunded. If an upscale fails, its credits are refunded automatically.</li>
          <li>If you paid but did not receive credits, or paid the wrong amount, contact us through Support with your payment code. We will check and resolve it.</li>
          <li>Prices may change. Price changes do not affect credits you have already bought.</li>
        </ul>`)],
      [L('4. Gambar dan hak cipta', '4. Your images and copyright'), L(`
        <ul>
          <li>Gambar yang Anda proses tetap milik Anda. Kami tidak mengklaim hak atas gambar atau hasilnya.</li>
          <li>Anda bertanggung jawab memastikan Anda berhak memakai dan mencetak gambar yang Anda proses, termasuk logo, karakter, dan merek milik pihak lain.</li>
          <li>Jangan memakai layanan untuk konten yang melanggar hukum atau hak orang lain. Kami dapat menangguhkan akun yang melanggar.</li>
        </ul>`, `
        <ul>
          <li>Images you process remain yours. We claim no rights over them or the results.</li>
          <li>You are responsible for having the right to use and print the images you process, including other parties' logos, characters and brands.</li>
          <li>Do not use the service for content that breaks the law or infringes others' rights. We may suspend accounts that do.</li>
        </ul>`)],
      [L('5. Hasil cetak', '5. Print results'), L(`
        <p>Pratinjau di layar adalah perkiraan. Warna dan hasil akhir bergantung pada printer, tinta, film, bubuk, kain, dan pengaturan RIP Anda. Periksa file dan lakukan tes cetak sebelum produksi. Kami tidak bertanggung jawab atas kerugian bahan atau produksi akibat hasil cetak.</p>`, `
        <p>On-screen previews are an approximation. Colours and the final result depend on your printer, ink, film, powder, fabric and RIP settings. Check the file and run a test print before production. We are not liable for material or production losses caused by print results.</p>`)],
      [L('6. Ketersediaan layanan', '6. Availability'), L(`
        <p>Kami berusaha menjaga layanan tetap berjalan, tetapi layanan disediakan "sebagaimana adanya". Fitur dapat berubah, dan layanan dapat terganggu sementara, misalnya karena pemeliharaan atau gangguan penyedia pihak ketiga. Upscale bergantung pada kuota bulanan penyedia layanan upscale.</p>`, `
        <p>We work to keep the service running, but it is provided "as is". Features may change, and the service may be interrupted, for example for maintenance or because of a third-party provider. Upscaling depends on the upscaling provider's monthly quota.</p>`)],
      [L('7. Batas tanggung jawab', '7. Limitation of liability'), L(`
        <p>Sejauh diizinkan hukum, total tanggung jawab kami atas klaim apa pun terkait layanan ini tidak melebihi jumlah yang Anda bayarkan kepada kami dalam 3 bulan sebelum klaim.</p>`, `
        <p>To the extent the law allows, our total liability for any claim related to the service is limited to the amount you paid us in the 3 months before the claim.</p>`)],
      [L('8. Penghentian', '8. Ending your use'), L(`
        <p>Anda dapat berhenti memakai layanan dan meminta penghapusan akun kapan saja lewat Support. Kami dapat menangguhkan atau menutup akun yang melanggar syarat ini.</p>`, `
        <p>You can stop using the service and ask us to delete your account at any time through Support. We may suspend or close accounts that break these terms.</p>`)],
      [L('9. Hukum yang berlaku', '9. Governing law'), L(`
        <p>Syarat ini tunduk pada hukum Republik Indonesia.</p>`, `
        <p>These terms are governed by the laws of the Republic of Indonesia.</p>`)],
      [L('10. Perubahan syarat', '10. Changes to these terms'), L(`
        <p>Syarat ini dapat diperbarui. Tanggal di atas menunjukkan versi terakhir. Dengan tetap memakai layanan setelah perubahan, Anda menyetujui syarat yang baru.</p>`, `
        <p>We may update these terms. The date above shows the latest version. By continuing to use the service after a change, you accept the new terms.</p>`)],
      [L('11. Kontak', '11. Contact'), `<p>${contact()}</p>`],
    ],
  };
}

export function renderLegal(view, which) {
  const doc = which === 'ketentuan' ? terms() : privacy();
  document.title = `${doc.title} · BNW Lab`;
  view.innerHTML = `
  <main class="landing legal">
    <div class="wrap legal-wrap">
      <p class="eyebrow">BNW Design Lab</p>
      <h1>${doc.title}</h1>
      <p class="muted small">${L('Terakhir diperbarui', 'Last updated')}: ${L(UPDATED.id, UPDATED.en)}</p>
      <p class="lead">${doc.intro}</p>
      ${doc.sections.map(([h, body]) => `<section><h2>${h}</h2>${body}</section>`).join('')}
      <p class="muted small" style="margin-top:32px"><a href="#${which === 'ketentuan' ? 'privasi' : 'ketentuan'}">${which === 'ketentuan' ? L('Baca juga Kebijakan Privasi', 'See also the Privacy Policy') : L('Baca juga Syarat & Ketentuan', 'See also the Terms of Service')}</a></p>
    </div>
    ${footer()}
  </main>`;
}

export const footer = () => `<footer class="footer"><div class="wrap"><img src="/logo-64.png" alt="BNW Lab"><span class="foot-links"><a href="#privasi">${L('Privasi', 'Privacy')}</a><a href="#ketentuan">${L('Syarat & Ketentuan', 'Terms')}</a><a href="#support">Support</a></span><span>© ${new Date().getFullYear()} BNW Design Lab · <a href="https://www.instagram.com/bnwlab.id" target="_blank" rel="noopener">Instagram @bnwlab.id</a></span></div></footer>`;
