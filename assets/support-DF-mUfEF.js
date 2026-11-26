import{z as T,L as a,g as p,e as n,i as g,$ as e,a as k,n as c,d as y,k as f,m as $}from"./index-WcEWNVfj.js";const w={pembayaran:"Pembayaran & kredit",upscale:"Upscale",editor:"Knockout & Raster",akun:"Akun & login",lainnya:"Lainnya"},M={baru:["Terkirim","b-warning"],diproses:["Sedang dicek","b-accent"],selesai:["Selesai","b-success"]},x={pembayaran:"Payments & credits",upscale:a("Upscale","Upscale"),editor:a("Knockout & Raster","Knockout & Raster"),akun:"Account & sign-in",lainnya:"Other"},S={baru:"Sent",diproses:"In progress",selesai:"Resolved"},v=i=>($==="en"?x[i]:w[i])||i,L=i=>{const r=M[i]||[i,""];return $==="en"?[S[i]||i,r[1]]:r};function _(i){let r=!0;const u=String(T.kontakWhatsApp||"").replace(/\D/g,""),m=u?`https://wa.me/${u}?text=${encodeURIComponent(a("Halo admin BNW Lab, saya butuh bantuan","Hi BNW Lab admin, I need help")+(p.user?` (${a("akun","account")} ${p.user.email})`:"")+".")}`:"";i.innerHTML=`
  <div class="page"><div class="page-in" style="max-width:1040px">
    <div class="page-head"><div><h1>Support</h1><p>${a("Ada kendala? Kirim pesan ke admin. Balasan muncul di halaman ini.","Need help? Send the admin a message. Replies appear on this page.")}</p></div></div>
    <div class="support">
      <div class="stack">
        <section class="card stack">
          <h2 style="margin:0">${a("Hubungi cepat","Quick contact")}</h2>
          ${m?`<a class="btn btn-primary btn-lg btn-block" href="${n(m)}" target="_blank" rel="noopener">${g("chat","i i-sm")}${a("Chat admin via WhatsApp","Chat with the admin on WhatsApp")}</a>`:`<p class="small muted" style="margin:0">${a("Kirim pesan lewat form di halaman ini.","Send a message with the form on this page.")}</p>`}
          <a class="btn btn-secondary btn-lg btn-block" href="#faq" data-route="faq">${a("Lihat pertanyaan umum (FAQ)","Read the FAQ")}</a>
        </section>
        <section class="card stack">
          <h2 style="margin:0">${a("Masalah yang sering terjadi","Common problems")}</h2>
          <ul class="help-list">
            ${a(`<li><b>Sudah bayar, kredit belum masuk.</b> Pastikan sudah menekan "Saya sudah bayar". Kredit masuk setelah admin mengecek pembayaran. Statusnya bisa dilihat di <a href="#kredit">Riwayat kredit</a>.</li>
            <li><b>Upscale gagal.</b> Kredit dikembalikan otomatis. Coba lagi, atau pilih skala yang lebih kecil.</li>
            <li><b>Lupa password.</b> Di jendela Masuk, klik "Lupa password?" lalu masukkan kode dari email.</li>
            <li><b>Hasil raster kurang pas.</b> Coba ubah Detail raster (LPI) dan pratinjau kaos hitam/putih sebelum mengunduh.</li>`,`<li><b>I paid but got no credits.</b> Make sure you pressed "I have paid". Credits are added once the admin has checked the payment. See the status in <a href="#kredit">Credit history</a>.</li>
            <li><b>Upscale failed.</b> Credits are refunded automatically. Try again, or choose a smaller scale.</li>
            <li><b>Forgot password.</b> In the sign-in window, click "Forgot password?" and enter the code from the email.</li>
            <li><b>The raster doesn't look right.</b> Try another Raster detail (LPI) and preview on a black/white shirt before downloading.</li>`)}
          </ul>
        </section>
      </div>
      <div class="stack">
        <section class="card stack" id="spFormBox"></section>
        <section class="stack" id="spMine"></section>
      </div>
    </div>
  </div></div>`;const b=e("spFormBox");if(!p.user)return b.innerHTML=`<h2 style="margin:0">${a("Kirim pesan ke admin","Message the admin")}</h2><p class="small muted" style="margin:0">${a("Masuk dulu supaya admin bisa melihat akun, kredit, dan pembayaranmu.","Sign in first so the admin can see your account, credits and payments.")}</p>
      <div class="row"><button class="btn btn-primary btn-lg" id="spLogin">${a("Masuk","Sign in")}</button><button class="btn btn-secondary btn-lg" id="spSignup">${a("Daftar","Sign up")}</button></div>`,e("spLogin").onclick=()=>k("masuk","",()=>{location.hash="support"}),e("spSignup").onclick=()=>k("daftar","",()=>{location.hash="support"}),()=>{r=!1};b.innerHTML=`
    <h2 style="margin:0">${a("Kirim pesan ke admin","Message the admin")}</h2>
    <form id="spForm" class="form">
      <div class="field"><label for="spTopic">${a("Topik","Topic")}</label><select id="spTopic">${Object.keys(w).map(t=>`<option value="${t}">${n(v(t))}</option>`).join("")}</select></div>
      <div class="field"><label for="spMsg">${a("Pesan","Message")}</label><textarea id="spMsg" class="plain" rows="5" minlength="5" maxlength="2000" required placeholder="${a("Ceritakan kendalanya. Untuk pembayaran, sebutkan nominal dan kodenya.","Describe the problem. For payments, include the amount and code.")}"></textarea></div>
      <div class="field"><label for="spWa">${a("Nomor WhatsApp","WhatsApp number")} <span class="muted">${a("(opsional, kalau ingin dihubungi)","(optional, if you want us to contact you)")}</span></label><input id="spWa" inputmode="tel" maxlength="20" placeholder="08xxxxxxxxxx"></div>
      <div id="spNotice" aria-live="polite"></div>
      <button class="btn btn-primary btn-lg" type="submit" id="spSend">${g("chat","i i-sm")}${a("Kirim pesan","Send message")}</button>
    </form>`,e("spForm").onsubmit=async t=>{t.preventDefault();const d=e("spMsg").value.trim(),l=e("spWa").value.replace(/[^\d+ -]/g,"").trim();if(d.length<5){e("spNotice").innerHTML=c(a("Pesan terlalu pendek.","The message is too short."),"error");return}if(l&&!/^[0-9+ -]{8,20}$/.test(l)){e("spNotice").innerHTML=c(a("Nomor WhatsApp tidak valid.","Invalid WhatsApp number."),"error");return}const s=e("spSend");s.disabled=!0;const{error:o}=await y.from("support_tickets").insert({user_id:p.user.id,topik:e("spTopic").value,pesan:d,whatsapp:l||null});if(s.disabled=!1,o){e("spNotice").innerHTML=c(/too_many_tickets/.test(o.message)?a("Kamu sudah mengirim 5 pesan dalam 24 jam. Tunggu balasan admin dulu, atau chat lewat WhatsApp.","You have sent 5 messages in 24 hours. Please wait for a reply, or chat on WhatsApp."):a("Pesan gagal dikirim: ","Could not send the message: ")+n(o.message),"error");return}e("spMsg").value="",e("spNotice").innerHTML=c(a("Pesan terkirim. Admin akan membalas di halaman ini.","Message sent. The admin will reply on this page."),"ok"),h()};async function h(){const t=e("spMine");if(!t)return;const{data:d,error:l}=await y.from("support_tickets").select("id,topik,pesan,status,balasan,dibalas_at,created_at").eq("user_id",p.user.id).order("created_at",{ascending:!1}).limit(50);if(r){if(l){t.innerHTML=c(n(l.message),"error");return}if(!d?.length){t.innerHTML="";return}t.innerHTML=`<h2 style="margin:4px 0 0">${a("Pesan saya","My messages")}</h2>`+d.map(s=>{const o=L(s.status);return`<article class="ticket">
        <div class="row"><b class="small">${n(v(s.topik))}</b><span class="badge ${o[1]}">${o[0]}</span><span class="grow"></span><span class="xs subtle">${n(f(s.created_at))}</span></div>
        <div class="msg">${n(s.pesan)}</div>
        ${s.balasan?`<div class="reply"><div class="xs subtle" style="margin-bottom:4px">${a("Balasan admin","Admin reply")} · ${n(f(s.dibalas_at||s.created_at))}</div>${n(s.balasan)}</div>`:""}
      </article>`}).join("")}}return h(),()=>{r=!1}}export{M as TICKET_STATUS,w as TOPICS,_ as mount};
