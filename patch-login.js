// patch-login.js - run once from your project folder:  node patch-login.js
// Adds the login screen, account sync and a Log out button to static/index.html (backup saved as index.html.bak)
import fs from 'node:fs';

const F = 'static/index.html';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('/* ---------- login + account sync')) { console.log('Already patched.'); process.exit(0); }
fs.copyFileSync(F, F + '.bak');

const rep = (a, b) => {
  if (!s.includes(a)) { console.error('Anchor not found, nothing written:\n' + a.slice(0, 70)); process.exit(1); }
  s = s.replace(a, () => b);
};

const CSS = `
/* ---------- login ---------- */
.auth{position:fixed;inset:0;z-index:100;background:#000;display:grid;place-items:center;padding:20px;overflow:auto}
.auth::before{content:"";position:fixed;inset:0;background:radial-gradient(60% 42% at 50% 0%,rgba(122,92,255,.35),transparent 72%),radial-gradient(50% 36% at 100% 100%,rgba(255,80,140,.22),transparent 72%)}
.acard{width:min(100%,380px);border-radius:30px;padding:26px 22px;display:flex;flex-direction:column;gap:12px;position:relative}
.acard h1{margin:0;font-size:2.1rem;letter-spacing:-.03em}
.acard input{padding:13px 18px;border-radius:999px;border:0;background:rgba(255,255,255,.1);box-shadow:var(--lg-rim);color:var(--ink);font:inherit;width:100%}
.acard input:focus{outline:none;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.55)}
.acard .pbtn{justify-content:center;width:100%;padding:13px 20px}
.acard .pbtn:disabled{opacity:.6}
.aerr{color:#ff7b9c;min-height:1.2em;font-size:.9rem;margin:0;padding:0 6px}
.alink{color:var(--muted);text-align:center;padding:6px}
`;

const JS = `/* ---------- login + account sync ---------- */
let me=null,pulling=false,pushT=0;
async function authApi(p,body,method){
  const r=await fetch('/api/auth/'+p,{method:method||(body?'POST':'GET'),headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||'Something went wrong');
  return j;
}
/* liked songs + playlists follow the account: any write to them is pushed to the server */
function pushSoon(){
  if(!me||pulling)return;
  clearTimeout(pushT);
  pushT=setTimeout(()=>authApi('data',{liked,pls},'PUT').catch(()=>{}),1200);
}
const _si=Storage.prototype.setItem;
Storage.prototype.setItem=function(k,v){_si.call(this,k,v);if(k==='ml'||k==='pl')pushSoon()};
async function pullData(){
  pulling=true;
  try{
    const d=await authApi('data');
    if(Array.isArray(d.liked))liked=d.liked;
    if(Array.isArray(d.pls))pls=d.pls;
    localStorage.setItem('ml',JSON.stringify(liked));
    localStorage.setItem('pl',JSON.stringify(pls));
  }catch(e){}
  pulling=false;
  pushSoon(); /* first login: uploads what this device already had */
}
async function logout(){
  clearTimeout(pushT);
  if(me)await authApi('data',{liked,pls},'PUT').catch(()=>{});
  try{await authApi('logout',{})}catch(e){}
  ['ml','pl','mq','mh','rs'].forEach(k=>{try{localStorage.removeItem(k)}catch(e){}});
  location.reload();
}
function showLogin(){
  let signup=false;
  const err=h('p',{class:'aerr'});
  const u=h('input',{type:'text',placeholder:'Username',autocomplete:'username',autocapitalize:'none',autocorrect:'off',maxlength:'20',required:''});
  const p=h('input',{type:'password',placeholder:'Password',autocomplete:'current-password',minlength:'8',required:''});
  const go=h('button',{class:'pbtn',type:'submit'},'Log in');
  const sw=h('button',{class:'alink',type:'button'},'');
  const paint=()=>{
    go.textContent=signup?'Create account':'Log in';
    sw.textContent=signup?'Already have an account? Log in':'New here? Create account';
    p.autocomplete=signup?'new-password':'current-password';err.textContent='';
  };
  sw.addEventListener('click',()=>{signup=!signup;paint()});
  const form=h('form',{class:'acard glass',onsubmit:async e=>{
    e.preventDefault();go.disabled=true;err.textContent='';
    try{
      me=await authApi(signup?'signup':'login',{user:u.value.trim(),pass:p.value});
      await pullData();ov.remove();home();
    }catch(x){err.textContent=x.message}
    go.disabled=false;
  }},h('h1',{},'Musically'),h('p',{class:'msg',style:'padding:0 0 4px'},'Sign in to continue'),u,p,err,go,sw);
  const ov=h('div',{class:'auth'},form);
  paint();document.body.append(ov);u.focus();
}
async function boot(){
  try{me=await authApi('me')}catch(e){return showLogin()}
  await pullData();home();
}

`;

// 1. styles
rep('</style>', CSS + '</style>');
// 2. account block in Settings
rep(`h('h1',{class:'greet'},'Settings'),`,
  `h('h1',{class:'greet'},'Settings'),
    h('h2',{},'Account'),
    h('div',{class:'lset'},h('span',{class:'msg',style:'padding:8px 4px'},'Signed in as '+(me?me.user:'')),btn('Log out',logout)),`);
// 3. login code (before the icon init lines so everything is defined before boot runs)
rep(`$('prev').innerHTML=svg(I.prev,'solid',24);`, JS + `$('prev').innerHTML=svg(I.prev,'solid',24);`);
// 4. start with the login check instead of going straight home
rep('renderQ();now();home();', 'renderQ();now();boot();');

fs.writeFileSync(F, s);
console.log('Done. Backup: ' + F + '.bak');

