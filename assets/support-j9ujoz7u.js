import{I as M,L as a,i as b,B as g,$ as e,h as p,a as h,e as t,n as c,d as k,l as y,o as v}from"./index-DNvJ2pi7.js";const $={pembayaran:"Pembayaran & kredit",upscale:"Upscale",editor:"Knockout & Raster",akun:"Akun & login",lainnya:"Lainnya"},T={baru:["Terkirim","b-warning"],diproses:["Sedang dicek","b-accent"],selesai:["Selesai","b-success"]},I={pembayaran:"Payments & credits",upscale:"Upscale",editor:"Knockout & Raster",akun:"Account & sign-in",lainnya:"Other"},S={baru:"Sent",diproses:"In progress",selesai:"Resolved"},f=i=>(v==="en"?I[i]:$[i])||i,w=i=>{const r=T[i]||[i,""];return v==="en"?[S[i]||i,r[1]]:r};function _(i){let r=!0;i.innerHTML=`
  <div class="page"><div class="page-in" style="max-width:1040px">
    <div class="page-head"><div><h1>Support</h1><p>${a("Ada kendala? Kirim pesan ke admin. Balasan muncul di halaman ini.","Need help? Send the admin a message. Replies appear on this page.")}</p></div></div>
    <div class="support">
      <div class="stack">
        <section class="card stack">
          <h2 style="margin:0">${a("Hubungi cepat","Quick contact")}</h2>
          <a class="btn btn-primary btn-lg btn-block" href="${M}" target="_blank" rel="noopener">${b("chat","i i-sm")}${a("Chat admin via Instagram","Chat with the admin on Instagram")}</a>
          <p class="xs muted" style="margin:0;text-align:center">${a(`DM ke @${g}. Sebutkan email akunmu supaya cepat dibantu.`,`DM @${g}. Include your account email so we can help faster.`)}</p>
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
  </div></div>`;const u=e("spFormBox");if(!p.user)return u.innerHTML=`<h2 style="margin:0">${a("Kirim pesan ke admin","Message the admin")}</h2><p class="small muted" style="margin:0">${a("Masuk dulu supaya admin bisa melihat akun, kredit, dan pembayaranmu.","Sign in first so the admin can see your account, credits and payments.")}</p>
      <div class="row"><button class="btn btn-primary btn-lg" id="spLogin">${a("Masuk","Sign in")}</button><button class="btn btn-secondary btn-lg" id="spSignup">${a("Daftar","Sign up")}</button></div>`,e("spLogin").onclick=()=>h("masuk","",()=>{location.hash="support"}),e("spSignup").onclick=()=>h("daftar","",()=>{location.hash="support"}),()=>{r=!1};u.innerHTML=`
    <h2 style="margin:0">${a("Kirim pesan ke admin","Message the admin")}</h2>
    <form id="spForm" class="form">
      <div class="field"><label for="spTopic">${a("Topik","Topic")}</label><select id="spTopic">${Object.keys($).map(n=>`<option value="${n}">${t(f(n))}</option>`).join("")}</select></div>
      <div class="field"><label for="spMsg">${a("Pesan","Message")}</label><textarea id="spMsg" class="plain" rows="5" minlength="5" maxlength="2000" required placeholder="${a("Ceritakan kendalanya. Untuk pembayaran, sebutkan nominal dan kodenya.","Describe the problem. For payments, include the amount and code.")}"></textarea></div>
      <div class="field"><label for="spIg">${a("Username Instagram","Instagram username")} <span class="muted">${a("(opsional, kalau ingin dihubungi lewat DM)","(optional, if you want us to DM you)")}</span></label><input id="spIg" maxlength="31" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="@username"></div>
      <div id="spNotice" aria-live="polite"></div>
      <button class="btn btn-primary btn-lg" type="submit" id="spSend">${b("chat","i i-sm")}${a("Kirim pesan","Send message")}</button>
    </form>`,e("spForm").onsubmit=async n=>{n.preventDefault();const d=e("spMsg").value.trim(),l=e("spIg").value.trim().replace(/^@/,"");if(d.length<5){e("spNotice").innerHTML=c(a("Pesan terlalu pendek.","The message is too short."),"error");return}if(l&&!/^[A-Za-z0-9._]{1,30}$/.test(l)){e("spNotice").innerHTML=c(a("Username Instagram tidak valid.","Invalid Instagram username."),"error");return}const s=e("spSend");s.disabled=!0;const{error:o}=await k.from("support_tickets").insert({user_id:p.user.id,topik:e("spTopic").value,pesan:d,instagram:l||null});if(s.disabled=!1,o){e("spNotice").innerHTML=c(/too_many_tickets/.test(o.message)?a("Kamu sudah mengirim 5 pesan dalam 24 jam. Tunggu balasan admin dulu, atau DM kami di Instagram.","You have sent 5 messages in 24 hours. Please wait for a reply, or DM us on Instagram."):a("Pesan gagal dikirim: ","Could not send the message: ")+t(o.message),"error");return}e("spMsg").value="",e("spNotice").innerHTML=c(a("Pesan terkirim. Admin akan membalas di halaman ini.","Message sent. The admin will reply on this page."),"ok"),m()};async function m(){const n=e("spMine");if(!n)return;const{data:d,error:l}=await k.from("support_tickets").select("id,topik,pesan,status,balasan,dibalas_at,created_at").eq("user_id",p.user.id).order("created_at",{ascending:!1}).limit(50);if(r){if(l){n.innerHTML=c(t(l.message),"error");return}if(!d?.length){n.innerHTML="";return}n.innerHTML=`<h2 style="margin:4px 0 0">${a("Pesan saya","My messages")}</h2>`+d.map(s=>{const o=w(s.status);return`<article class="ticket">
        <div class="row"><b class="small">${t(f(s.topik))}</b><span class="badge ${o[1]}">${o[0]}</span><span class="grow"></span><span class="xs subtle">${t(y(s.created_at))}</span></div>
        <div class="msg">${t(s.pesan)}</div>
        ${s.balasan?`<div class="reply"><div class="xs subtle" style="margin-bottom:4px">${a("Balasan admin","Admin reply")} · ${t(y(s.dibalas_at||s.created_at))}</div>${t(s.balasan)}</div>`:""}
      </article>`}).join("")}}return m(),()=>{r=!1}}export{T as TICKET_STATUS,$ as TOPICS,_ as mount};
