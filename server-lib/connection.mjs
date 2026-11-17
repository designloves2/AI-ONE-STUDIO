// Connection setup of the desktop app: where the ComfyUI / AI ONE STUDIO backend is.
//   - POST /aos/probe       {address, id?, secret?}  -> works out what the address is (1: an AI ONE STUDIO server, 2: a ComfyUI), localhost only
//   - GET/POST /aos/connection                        -> the saved choice (AOS_CONFIG file), localhost only
//   - GET /aos/connect                                -> the setup page
//   - GET /  (desktop app only, before a choice is saved)  -> redirected to the setup page
import fs from 'node:fs';
import path from 'node:path';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const isLocal = (req) => LOCAL_HOST.test(req.headers.host ?? '');
const configFile = () => process.env.AOS_CONFIG || null;

export function readConfig() {
  const f = configFile(); if (!f) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}
export function writeConfig(c) {
  const f = configFile(); if (!f) return;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(c, null, 2));
}

/** "comfy.example.com" -> https://comfy.example.com ; an IP, localhost or a LAN name -> http:// */
export function normalize(address) {
  let a = String(address ?? '').trim().replace(/\/+$/, '');
  if (!a) return '';
  if (!/^https?:\/\//i.test(a)) a = (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])|\.local(:|\/|$)/i.test(a) ? 'http://' : 'https://') + a;
  return new URL(a).origin;
}

export const tokenHeaders = (id, secret) => (id && secret ? { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret } : {});

async function get(url, headers) {
  try {
    const r = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    const text = r.status === 200 ? await r.text() : '';
    return { status: r.status, location: r.headers.get('location') ?? '', text };
  } catch (e) { return { status: 0, location: '', text: '', error: e.cause?.code ?? e.message }; }
}
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
/** a Cloudflare Access (or similar) login wall: the address answers, but only after a sign-in */
const wall = (r) => r.status === 401 || r.status === 403 || /cloudflareaccess|\/cdn-cgi\/access|login|signin/i.test(r.location);

const MSG = {
  ko: { studio: '1) AI ONE STUDIO 서버입니다', wall: '1) 로그인이 필요한 주소입니다', notStudio: (d) => `1) AI ONE STUDIO 서버가 아닙니다${d}`, comfy: (v) => `2) ComfyUI입니다${v ? ` (${v})` : ''}`,
    login: '2) 로그인 후에 알 수 있습니다 → 창에서 이 주소를 열어 로그인합니다 (서비스 토큰이 있으면 아래에 넣어 주세요)', notComfy: (d, tok) => `2) ComfyUI가 아닙니다${d}${tok ? ' - 서비스 토큰이 맞는지 확인하세요' : ''}`, resp: (n) => ` (응답 ${n})`, bad: (e) => `주소를 읽을 수 없습니다 (${e})` },
  en: { studio: '1) This is an AI ONE STUDIO server', wall: '1) This address needs a sign-in', notStudio: (d) => `1) Not an AI ONE STUDIO server${d}`, comfy: (v) => `2) This is a ComfyUI${v ? ` (${v})` : ''}`,
    login: '2) Known only after signing in → the window opens this address so you can sign in (or enter a service token below)', notComfy: (d, tok) => `2) Not a ComfyUI${d}${tok ? ' - check the service token' : ''}`, resp: (n) => ` (response ${n})`, bad: (e) => `Cannot read this address (${e})` },
};

/** what is behind this address? 1) an AI ONE STUDIO server -> the window just opens it; 2) a ComfyUI -> the built-in server forwards to it */
export async function probe(address, id, secret, lang = 'en') {
  const m = MSG[lang === 'ko' ? 'ko' : 'en'];
  const base = normalize(address); const steps = [];
  const tok = tokenHeaders(id, secret);
  const why = (r) => (r.status ? m.resp(r.status) : r.error ? ` (${r.error})` : '');
  const a = await get(`${base}/aos/target`, {});
  if (a.status === 200 && typeof json(a.text)?.url === 'string') { steps.push(m.studio); return { kind: 'studio', address: base, steps }; }
  const walled = wall(a);
  steps.push(walled ? m.wall : m.notStudio(why(a)));
  const b = await get(`${base}/system_stats`, tok);
  if (b.status === 200 && json(b.text)?.system) { steps.push(m.comfy(json(b.text).system.comfyui_version)); return { kind: 'comfy', address: base, steps }; }
  if ((walled || wall(b)) && !id) { steps.push(m.login); return { kind: 'login', address: base, steps }; }
  steps.push(m.notComfy(why(b), wall(b)));
  return { kind: 'fail', address: base, steps };
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>AI ONE STUDIO</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
html,body{margin:0;min-height:100%;background:#14161c;color:#cfd3dc;font:15px/1.5 system-ui,"Malgun Gothic",sans-serif}
main{max-width:560px;margin:7vh auto;padding:0 20px}h1{font-size:20px;margin:0 0 4px}p.sub{margin:0 0 22px;color:#8b93a3}
label{display:block;margin:14px 0 4px;font-size:13px;color:#aab1bf}
input{width:100%;box-sizing:border-box;background:#0f1116;border:1px solid #2a2e38;border-radius:8px;padding:10px 12px;color:inherit;font:inherit;outline:none}input:focus{border-color:#7612DA}
button{margin-top:16px;background:#7612DA;color:#fff;border:0;border-radius:8px;padding:10px 18px;font:inherit;cursor:pointer}button.alt{background:#2a2e38;color:#cfd3dc;margin-left:8px}button:disabled{opacity:.5}
details{margin-top:12px}summary{cursor:pointer;color:#8b93a3;font-size:13px}
#log{margin-top:18px;white-space:pre-wrap;font-size:13.5px;color:#aab1bf}#log b{color:#34c98e}#log em{color:#ff7a7a;font-style:normal}
small{color:#6f7788;display:block;margin-top:6px}
.pick{display:flex;gap:12px;margin:0 0 6px}.card{flex:1;margin:0;text-align:left;background:#1b1e26;border:1px solid #2a2e38;padding:16px;color:#cfd3dc;line-height:1.5}.card b{display:block;font-size:16px;margin-bottom:4px}.card span{font-size:12.5px;color:#8b93a3}.card:hover,.card.on{border-color:#7612DA}
</style></head><body><main>
<h1>AI ONE STUDIO</h1><p class="sub" data-t="where">Where is ComfyUI (the backend)?</p>
<div class="pick"><button id="pl" class="card"><b data-t="local">This PC (local)</b><span><i data-t="localD">ComfyUI runs on this computer</i><br>127.0.0.1:8188</span></button><button id="pr" class="card"><b data-t="remote">Somewhere else (remote)</b><span data-t="remoteD">Another PC · a domain · a Cloudflare tunnel</span></button></div>
<div id="remote" hidden>
<label for="a" data-t="addr">Address (domain · tunnel address · IP:port)</label>
<input id="a" placeholder="studio.example.com  /  comfy.example.com  /  192.168.0.20:8188" autofocus>
<small data-t="hint">It first checks for an AI ONE STUDIO server, then tries ComfyUI.</small>
<details id="t"><summary data-t="tokenS">ComfyUI behind a sign-in (Cloudflare service token)</summary>
<label for="i">Client ID</label><input id="i" autocomplete="off"><label for="s">Client Secret</label><input id="s" type="password" autocomplete="off">
<small data-t="tokenD">A Cloudflare Access service token. An AI ONE STUDIO server address does not need it: you sign in inside the window.</small></details>
<button id="go" data-t="go">Connect</button>
</div><div id="log"></div></main>
<script>
const KO=/^ko/i.test(navigator.language||''), L=KO?'ko':'en';
const TX={ko:{where:'ComfyUI(백엔드)가 어디에 있나요?',local:'이 PC (로컬)',localD:'이 컴퓨터에서 ComfyUI가 실행 중입니다',remote:'다른 곳 (원격)',remoteD:'다른 PC · 도메인 · Cloudflare 터널',addr:'접속 주소 (도메인 · 터널 주소 · IP:포트)',hint:'먼저 AI ONE STUDIO 서버인지 보고, 아니면 ComfyUI로 시도합니다.',tokenS:'로그인이 필요한 ComfyUI (Cloudflare 서비스 토큰)',tokenD:'Cloudflare Access의 서비스 토큰입니다. AI ONE STUDIO 서버 주소는 창에서 직접 로그인하므로 필요 없습니다.',go:'연결',ask:'주소를 넣어 주세요',busy:'알아보는 중…',conn:'연결합니다…',fail:'연결하지 못했습니다. 주소를 확인해 주세요.'},
 en:{ask:'Enter an address',busy:'Checking…',conn:'Connecting…',fail:'Could not connect. Check the address.'}};
const T=(k)=>(TX[L][k]||TX.en[k]);
document.documentElement.lang=L; document.querySelectorAll('[data-t]').forEach(e=>{ if(TX[L][e.dataset.t]) e.textContent=TX[L][e.dataset.t]; });
const $=(i)=>document.getElementById(i), log=(h)=>{$('log').innerHTML=h};
const post=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json());
fetch('/aos/connection').then(r=>r.json()).then(c=>{ if(c&&c.address) $('a').value=c.address; if(c&&c.hasToken) $('t').open=true; }).catch(()=>{});
$('pl').onclick=async()=>{ await post('/aos/connection',{mode:'local'}); location.href='/'; };
$('pr').onclick=()=>{ $('remote').hidden=false; $('pr').classList.add('on'); $('a').focus(); };
fetch('/aos/connection').then(r=>r.json()).then(c=>{ if(c&&c.mode&&c.mode!=='local') $('pr').click(); }).catch(()=>{});
$('go').onclick=async()=>{
  const address=$('a').value.trim(); if(!address) return log('<em>'+T('ask')+'</em>');
  $('go').disabled=true; log(T('busy'));
  try{
    const r=await post('/aos/probe',{address,id:$('i').value.trim(),secret:$('s').value,lang:L});
    const text=(r.steps||[]).join('\\n');
    if(r.kind==='studio'||r.kind==='login'){ await post('/aos/connection',{mode:'remote',address:r.address}); log(text+'\\n<b>'+T('conn')+'</b>'); location.href=r.address+'/'; }
    else if(r.kind==='comfy'){ await post('/aos/connection',{mode:'proxy',address:r.address,id:$('i').value.trim(),secret:$('s').value}); log(text+'\\n<b>'+T('conn')+'</b>'); location.href='/'; }
    else log(text+'\\n<em>'+T('fail')+'</em>');
  }catch(e){ log('<em>'+e.message+'</em>'); } finally{ $('go').disabled=false; }
};
$('a').addEventListener('keydown',e=>{ if(e.key==='Enter') $('go').click(); });
</script></body></html>`;

/** `api` = { getTarget(), setTarget(url, headers) } of the proxy in serve.mjs */
export async function handleConnection(req, res, api) {
  const p = new URL(req.url, 'http://x').pathname;
  const send = (code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'content-type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  const body = async () => { let s = ''; for await (const c of req) s += c; try { return JSON.parse(s || '{}'); } catch { return {}; } };

  if (p === '/' && process.env.AOS_APP && configFile() && !readConfig() && isLocal(req)) { res.writeHead(302, { location: '/aos/connect' }); res.end(); return true; }
  if (p === '/aos/connect') { send(200, PAGE, 'text/html; charset=utf-8'); return true; }
  if (p === '/aos/probe' && req.method === 'POST') {
    if (!isLocal(req)) { send(403, { error: 'only from localhost' }); return true; }
    const b = await body();
    try { send(200, await probe(b.address, b.id, b.secret, b.lang)); } catch (e) { send(200, { kind: 'fail', steps: [MSG[b.lang === 'ko' ? 'ko' : 'en'].bad(e.message)] }); }
    return true;
  }
  if (p === '/aos/connection') {
    if (!isLocal(req)) { send(403, { error: 'only from localhost' }); return true; }
    const c = readConfig();
    if (req.method === 'GET') { send(200, c ? { mode: c.mode, address: c.address ?? '', hasToken: !!c.id } : {}); return true; }
    const b = await body();
    if (b.mode === 'remote') writeConfig({ mode: 'remote', address: b.address });
    else if (b.mode === 'proxy') { writeConfig({ mode: 'proxy', address: b.address, id: b.id || '', secret: b.secret || '' }); api.setTarget(b.address, tokenHeaders(b.id, b.secret)); }
    else { writeConfig({ mode: 'local' }); api.setTarget('', {}); }
    send(200, { ok: true }); return true;
  }
  return false;
}

/** at start: apply a saved "forward to this ComfyUI" choice */
export function applySaved(api) {
  const c = readConfig();
  if (c?.mode === 'proxy' && c.address) { try { api.setTarget(c.address, tokenHeaders(c.id, c.secret)); } catch { /* bad saved address: keep the default */ } }
}
