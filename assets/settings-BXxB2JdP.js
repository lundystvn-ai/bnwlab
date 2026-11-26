import{g as v,n as l,e as t,w as y,B as p,C as o,$ as e,m as g,D as k,E as f}from"./index-C2iuFjng.js";function w(d,c={}){if(!v()){d.innerHTML='<div class="page"><div class="page-in">'+l("Halaman ini hanya untuk admin.","error")+"</div></div>";return}const m=c.embedded?"":'<div class="page"><div class="page-in" style="max-width:820px"><div class="page-head"><div><h1>Pengaturan</h1><p>Hanya terlihat oleh admin.</p></div></div>';d.innerHTML=m+`
    <div class="stack" style="max-width:820px">
      <section class="card stack">
        <div class="toolbar" style="margin:0"><div><h2>API BigJPG</h2><p class="xs muted" style="margin:2px 0 0">Key disimpan di server lewat Edge Function, tidak pernah dikirim ke browser.</p></div><span class="badge" id="bjStatus">Memuat…</span></div>
        <form id="bjForm" class="row" style="align-items:flex-end;flex-wrap:wrap">
          <div class="field grow" style="min-width:240px"><label for="bjKey">API key BigJPG</label><input id="bjKey" type="password" autocomplete="new-password" placeholder="Tempel API key BigJPG"></div>
          <button class="btn btn-primary btn-lg" id="bjSave" type="submit">Simpan API key</button>
        </form>
        <div id="bjNotice"></div>
      </section>

      <section class="card stack">
        <div class="toolbar" style="margin:0"><div><h2>Koneksi Supabase</h2><p class="xs muted" style="margin:2px 0 0">Dari Supabase Dashboard → Settings → API.</p></div><span class="badge b-success">Terhubung</span></div>
        ${l(`Memakai proyek <b>${t(y.supabaseUrl)}</b>${p?" (pengaturan browser ini)":" (bawaan situs)"}`,"ok")}
        <form id="sbForm" class="form">
          <div class="field"><label for="sbUrl">Project URL</label><input id="sbUrl" placeholder="https://xxxx.supabase.co" value="${t(o.get("cfg")?.supabaseUrl||"")}" autocomplete="off"></div>
          <div class="field"><label for="sbKey">Anon / publishable key</label><input id="sbKey" placeholder="sb_publishable_… atau eyJ…" value="${t(o.get("cfg")?.supabaseAnonKey||"")}" autocomplete="off"></div>
          <p class="xs muted" style="margin:0">Jangan tempel kunci <b>service_role</b> / <b>secret</b>; kunci itu ditolak.</p>
          <div class="row" style="flex-wrap:wrap"><button class="btn btn-secondary btn-lg" type="submit" id="sbTest">Uji koneksi</button><button class="btn btn-secondary btn-lg" type="button" id="sbUse" disabled>Pakai di browser ini</button>${p?'<button class="btn btn-danger btn-lg" type="button" id="sbClear">Hapus pengaturan browser</button>':""}</div>
        </form>
        <div id="sbResult" class="check-list" aria-live="polite"></div>
      </section>
    </div>`+(c.embedded?"":"</div></div>");async function u(){const i=e("bjStatus");try{const a=await g("bigjpg-upscale",{action:"config_status"});i.textContent=a.configured?"Aktif"+(a.masked_key?" · "+a.masked_key:""):"Belum diatur",i.className="badge "+(a.configured?"b-success":"b-warning")}catch(a){i.textContent="Belum terhubung",i.className="badge b-danger",e("bjNotice").innerHTML=l(t(a.message)+" Pastikan Edge Function bigjpg-upscale sudah dipasang.","warn")}}e("bjForm").onsubmit=async i=>{i.preventDefault();const a=e("bjKey").value.trim(),s=e("bjSave");if(!a){e("bjNotice").innerHTML=l("API key BigJPG wajib diisi.","error");return}s.disabled=!0,s.textContent="Menyimpan…";try{const n=await g("bigjpg-upscale",{action:"save_config",api_key:a});e("bjKey").value="",e("bjNotice").innerHTML=l(t(n.message||"API key BigJPG berhasil disimpan."),"ok"),await u()}catch(n){e("bjNotice").innerHTML=l(t(n.message),"error")}finally{s.disabled=!1,s.textContent="Simpan API key"}},u();let b=null;e("sbForm").onsubmit=async i=>{i.preventDefault(),b=null,e("sbUse").disabled=!0;const a=k(e("sbUrl").value,e("sbKey").value);if(a.error){e("sbResult").innerHTML=l(t(a.error),"error");return}const s=e("sbTest");s.disabled=!0,s.textContent="Menguji…";let n;try{n=await f(a.url,a.key)}catch(r){n=[{ok:!1,label:"Gagal memuat pustaka Supabase",hint:r.message}]}s.disabled=!1,s.textContent="Uji koneksi",e("sbResult").innerHTML=n.map(r=>l(`<b>${t(r.label)}</b>${r.hint?"<br>"+t(r.hint):""}`,r.ok?"ok":"warn")).join(""),n[0]?.ok&&(b=a,e("sbUse").disabled=!1)},e("sbUse").onclick=()=>{b&&(o.set("cfg",{supabaseUrl:b.url,supabaseAnonKey:b.key}),location.reload())},e("sbClear")?.addEventListener("click",()=>{o.set("cfg",null),location.reload()})}export{w as mount};
