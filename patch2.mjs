import fs from 'fs';
const f='static/index.html';
let h=fs.readFileSync(f,'utf8');
if(h.includes('/* floating pills */')){console.log('already patched');process.exit()}
const css=`
/* floating pills */
.glass.nav,.glass.player{position:fixed!important;left:12px!important;right:12px!important;width:auto!important;max-width:936px;margin:0 auto!important;border-radius:999px!important;z-index:30}
.glass.nav{bottom:calc(12px + env(safe-area-inset-bottom))!important;padding:6px 8px;display:flex;align-items:center;justify-content:space-around}
.glass.nav button{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 0;border-radius:999px;font-size:.8rem;font-weight:600;color:#fff}
.glass.nav button.on,.glass.nav .on{background:var(--lg-lite);box-shadow:var(--lg-rim)}
.glass.nav svg{width:24px;height:24px}
.glass.player{bottom:calc(92px + env(safe-area-inset-bottom))!important;padding:10px 12px}
.glass.player img,.glass.player .th{border-radius:18px}
.glass.player button{border-radius:50%}
`;
const i=h.lastIndexOf('</style>');
h=h.slice(0,i)+css+h.slice(i);
fs.writeFileSync(f,h);
console.log('done');
