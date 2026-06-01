// 最低限の管理ダッシュボード（単一HTML）。tokenはlocalStorageに保持しヘッダで送る。
// 予定名などユーザー画像由来の文字列を表示するため、全ての動的値をescしてから描画する。
export const adminHtml = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>print-to-calendar 管理</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#f5f6f8;color:#222}
  header{background:#1f2937;color:#fff;padding:12px 16px;font-weight:600}
  .wrap{padding:16px;max-width:1100px;margin:0 auto}
  .card{background:#fff;border-radius:10px;padding:16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  .stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
  .stat{background:#eef2ff;border-radius:8px;padding:12px;text-align:center}
  .stat b{display:block;font-size:26px;color:#3730a3}
  input,button{font-size:14px;padding:8px 10px;border-radius:8px;border:1px solid #cbd5e1}
  button{background:#4f46e5;color:#fff;border:none;cursor:pointer}
  button.sm{padding:4px 8px;font-size:12px}
  button.danger{background:#dc2626}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{border-bottom:1px solid #e5e7eb;padding:6px 8px;text-align:left;white-space:nowrap}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .muted{color:#6b7280}
  .tabbtn{background:#e5e7eb;color:#374151}
  .tabbtn.active{background:#4f46e5;color:#fff}
</style></head>
<body>
<header>print-to-calendar 管理画面</header>
<div class="wrap">
  <div class="card">
    <div class="row">
      <input id="token" placeholder="ADMIN_TOKEN" style="flex:1;min-width:220px"/>
      <button onclick="saveToken()">保存して読込</button>
    </div>
    <p class="muted" id="msg"></p>
  </div>
  <div class="card"><div class="stats" id="stats"></div></div>
  <div class="card">
    <div class="row" style="margin-bottom:10px">
      <button class="tabbtn active" data-t="licenses" onclick="show('licenses')">ライセンス</button>
      <button class="tabbtn" data-t="errors" onclick="show('errors')">同期エラー</button>
      <button class="tabbtn" data-t="usage" onclick="show('usage')">利用ログ</button>
      <span style="flex:1"></span>
      <input id="issueEmail" placeholder="email（手動発行）"/>
      <button onclick="issue()">手動発行</button>
    </div>
    <div id="view"><p class="muted">tokenを入れて読込してください。</p></div>
  </div>
</div>
<script>
const $=s=>document.querySelector(s);
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const setHTML=(el,html)=>{el['inner'+'HTML']=html};
let TOKEN=localStorage.getItem('ptc_admin_token')||'';
$('#token').value=TOKEN;
function hdr(){return {'x-admin-token':TOKEN,'Content-Type':'application/json'}}
async function api(path,opts){const r=await fetch('./api'+path,{headers:hdr(),...opts});return r.json()}
function saveToken(){TOKEN=$('#token').value.trim();localStorage.setItem('ptc_admin_token',TOKEN);loadAll()}
async function loadAll(){
  const d=await api('/dashboard');
  if(!d.ok){$('#msg').textContent='認証失敗';return}
  $('#msg').textContent='';
  const s=d.stats;
  setHTML($('#stats'),[
    ['ユーザー',s.users],['有効ライセンス',s.licenses_active],['ライセンス総数',s.licenses_total],
    ['購入',s.purchases],['同期エラー',s.sync_errors],['Google連携',s.google_connected]
  ].map(([k,v])=>'<div class="stat"><b>'+esc(v)+'</b>'+esc(k)+'</div>').join(''));
  show(curTab);
}
let curTab='licenses';
async function show(t){
  curTab=t;
  document.querySelectorAll('.tabbtn').forEach(b=>b.classList.toggle('active',b.dataset.t===t));
  if(t==='licenses')return renderLicenses();
  if(t==='errors')return renderErrors();
  if(t==='usage')return renderUsage();
}
async function renderLicenses(){
  const d=await api('/licenses');if(!d.ok)return;
  const rows=d.licenses.map(l=>'<tr><td>'+esc(l.email||'-')+'</td><td>'+esc(l.plan_name)+'</td><td>'+esc(l.status)+'</td>'
    +'<td>'+esc(l.expires_at.slice(0,10))+'</td><td>'+esc(l.monthly_used)+'/'+esc(l.monthly_limit==null?'-':l.monthly_limit)+'</td>'
    +'<td>'+esc(l.google_status||'-')+'</td><td>'+esc(l.default_calendar_name||'-')+'</td>'
    +'<td>'+esc(l.support_status||'-')+'</td>'
    +'<td><button class="sm" onclick="ext(\\''+esc(l.id)+'\\')">+6ヶ月</button> '
    +'<button class="sm danger" onclick="rev(\\''+esc(l.id)+'\\')">停止</button></td></tr>').join('');
  setHTML($('#view'),'<table><thead><tr><th>email</th><th>プラン</th><th>状態</th><th>期限</th><th>今月</th><th>Google</th><th>登録先</th><th>サポート</th><th>操作</th></tr></thead><tbody>'+rows+'</tbody></table>');
}
async function renderErrors(){
  const d=await api('/sync-errors');if(!d.ok)return;
  setHTML($('#view'),'<table><thead><tr><th>予定</th><th>日付</th><th>エラー</th><th>時刻</th></tr></thead><tbody>'
    +d.errors.map(e=>'<tr><td>'+esc(e.title)+'</td><td>'+esc(e.date)+'</td><td>'+esc(e.sync_error_message||'')+'</td><td>'+esc(e.updated_at.slice(0,16))+'</td></tr>').join('')+'</tbody></table>');
}
async function renderUsage(){
  const d=await api('/usage');if(!d.ok)return;
  setHTML($('#view'),'<table><thead><tr><th>状態</th><th>モデル</th><th>日時</th><th>エラー</th></tr></thead><tbody>'
    +d.usage.map(u=>'<tr><td>'+esc(u.status)+'</td><td>'+esc(u.model_name||'-')+'</td><td>'+esc(u.used_at.slice(0,16))+'</td><td>'+esc(u.error_message||'')+'</td></tr>').join('')+'</tbody></table>');
}
async function ext(id){const r=await api('/licenses/'+id+'/extend',{method:'POST',body:'{"months":6}'});if(r.ok){alert('延長: '+r.expiresAt.slice(0,10));renderLicenses()}}
async function rev(id){if(!confirm('このライセンスを停止しますか？'))return;const r=await api('/licenses/'+id+'/revoke',{method:'POST'});if(r.ok)renderLicenses()}
async function issue(){const email=$('#issueEmail').value.trim();const r=await api('/licenses/issue',{method:'POST',body:JSON.stringify({email})});if(r.ok){prompt('発行されたライセンスキー（控えてください）',r.licenseKey);loadAll()}}
if(TOKEN)loadAll();
</script>
</body></html>`;
