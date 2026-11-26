import{w as y,f as r,e,i as b,$ as a,a as k,n as d,d as g,j as h}from"./index-DjakfsJt.js";const v={pembayaran:"Pembayaran & kredit",upscale:"Upscale",editor:"Knockout & Raster",akun:"Akun & login",lainnya:"Lainnya"},x={baru:["Terkirim","b-warning"],diproses:["Sedang dicek","b-accent"],selesai:["Selesai","b-success"]};function M(f){let o=!0;const p=String(y.kontakWhatsApp||"").replace(/\D/g,""),c=p?`https://wa.me/${p}?text=${encodeURIComponent("Halo admin BNW Lab, saya butuh bantuan"+(r.user?` (akun ${r.user.email})`:"")+".")}`:"";f.innerHTML=`
  <div class="page"><div class="page-in" style="max-width:1040px">
    <div class="page-head"><div><h1>Support</h1><p>Ada kendala? Kirim pesan ke admin. Balasan muncul di halaman ini.</p></div></div>
    <div class="support">
      <div class="stack">
        <section class="card stack">
          <h2 style="margin:0">Hubungi cepat</h2>
          ${c?`<a class="btn btn-primary btn-lg btn-block" href="${e(c)}" target="_blank" rel="noopener">${b("chat","i i-sm")}Chat admin via WhatsApp</a>`:'<p class="small muted" style="margin:0">Kirim pesan lewat form di halaman ini.</p>'}
          <a class="btn btn-secondary btn-lg btn-block" href="#faq" data-route="faq">Lihat pertanyaan umum (FAQ)</a>
        </section>
        <section class="card stack">
          <h2 style="margin:0">Masalah yang sering terjadi</h2>
          <ul class="help-list">
            <li><b>Sudah bayar, kredit belum masuk.</b> Pastikan sudah menekan "Saya sudah bayar". Kredit masuk setelah admin mengecek pembayaran. Statusnya bisa dilihat di <a href="#kredit">Riwayat kredit</a>.</li>
            <li><b>Upscale gagal.</b> Kredit dikembalikan otomatis. Coba lagi, atau pilih skala yang lebih kecil.</li>
            <li><b>Lupa password.</b> Di jendela Masuk, klik "Lupa password?" lalu masukkan kode dari email.</li>
            <li><b>Hasil raster kurang pas.</b> Coba ubah Detail raster (LPI) dan pratinjau kaos hitam/putih sebelum mengunduh.</li>
          </ul>
        </section>
      </div>
      <div class="stack">
        <section class="card stack" id="spFormBox"></section>
        <section class="stack" id="spMine"></section>
      </div>
    </div>
  </div></div>`;const u=a("spFormBox");if(!r.user)return u.innerHTML=`<h2 style="margin:0">Kirim pesan ke admin</h2><p class="small muted" style="margin:0">Masuk dulu supaya admin bisa melihat akun, kredit, dan pembayaranmu.</p>
      <div class="row"><button class="btn btn-primary btn-lg" id="spLogin">Masuk</button><button class="btn btn-secondary btn-lg" id="spSignup">Daftar</button></div>`,a("spLogin").onclick=()=>k("masuk","",()=>{location.hash="support"}),a("spSignup").onclick=()=>k("daftar","",()=>{location.hash="support"}),()=>{o=!1};u.innerHTML=`
    <h2 style="margin:0">Kirim pesan ke admin</h2>
    <form id="spForm" class="form">
      <div class="field"><label for="spTopic">Topik</label><select id="spTopic">${Object.entries(v).map(([i,n])=>`<option value="${i}">${e(n)}</option>`).join("")}</select></div>
      <div class="field"><label for="spMsg">Pesan</label><textarea id="spMsg" class="plain" rows="5" minlength="5" maxlength="2000" required placeholder="Ceritakan kendalanya. Untuk pembayaran, sebutkan nominal dan kodenya."></textarea></div>
      <div class="field"><label for="spWa">Nomor WhatsApp <span class="muted">(opsional, kalau ingin dihubungi)</span></label><input id="spWa" inputmode="tel" maxlength="20" placeholder="08xxxxxxxxxx"></div>
      <div id="spNotice" aria-live="polite"></div>
      <button class="btn btn-primary btn-lg" type="submit" id="spSend">${b("chat","i i-sm")}Kirim pesan</button>
    </form>`,a("spForm").onsubmit=async i=>{i.preventDefault();const n=a("spMsg").value.trim(),t=a("spWa").value.replace(/[^\d+ -]/g,"").trim();if(n.length<5){a("spNotice").innerHTML=d("Pesan terlalu pendek.","error");return}if(t&&!/^[0-9+ -]{8,20}$/.test(t)){a("spNotice").innerHTML=d("Nomor WhatsApp tidak valid.","error");return}const s=a("spSend");s.disabled=!0;const{error:l}=await g.from("support_tickets").insert({user_id:r.user.id,topik:a("spTopic").value,pesan:n,whatsapp:t||null});if(s.disabled=!1,l){a("spNotice").innerHTML=d(/too_many_tickets/.test(l.message)?"Kamu sudah mengirim 5 pesan dalam 24 jam. Tunggu balasan admin dulu, atau chat lewat WhatsApp.":"Pesan gagal dikirim: "+e(l.message),"error");return}a("spMsg").value="",a("spNotice").innerHTML=d("Pesan terkirim. Admin akan membalas di halaman ini.","ok"),m()};async function m(){const i=a("spMine");if(!i)return;const{data:n,error:t}=await g.from("support_tickets").select("id,topik,pesan,status,balasan,dibalas_at,created_at").eq("user_id",r.user.id).order("created_at",{ascending:!1}).limit(50);if(o){if(t){i.innerHTML=d(e(t.message),"error");return}if(!n?.length){i.innerHTML="";return}i.innerHTML='<h2 style="margin:4px 0 0">Pesan saya</h2>'+n.map(s=>{const l=x[s.status]||[s.status,""];return`<article class="ticket">
        <div class="row"><b class="small">${e(v[s.topik]||s.topik)}</b><span class="badge ${l[1]}">${l[0]}</span><span class="grow"></span><span class="xs subtle">${e(h(s.created_at))}</span></div>
        <div class="msg">${e(s.pesan)}</div>
        ${s.balasan?`<div class="reply"><div class="xs subtle" style="margin-bottom:4px">Balasan admin · ${e(h(s.dibalas_at||s.created_at))}</div>${e(s.balasan)}</div>`:""}
      </article>`}).join("")}}return m(),()=>{o=!1}}export{x as TICKET_STATUS,v as TOPICS,M as mount};
