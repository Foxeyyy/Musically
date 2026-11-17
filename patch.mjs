import fs from 'fs';
const f='static/index.html';
let h=fs.readFileSync(f,'utf8');
const svg=`<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="lens" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".008 .012" numOctaves="2" seed="4" result="n"/><feGaussianBlur in="n" stdDeviation="6" result="nb"/><feDisplacementMap in="SourceGraphic" in2="nb" scale="30" xChannelSelector="R" yChannelSelector="G"/></filter></svg>`;
const css=`
/* ---- liquid glass override ---- */
:root{
  --lg-fill:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.03) 45%,rgba(0,0,0,.18));
  --lg-lite:linear-gradient(145deg,rgba(255,255,255,.14),rgba(255,255,255,.04));
  --lg-rim:inset 0 1.5px 0 rgba(255,255,255,.55),inset 0 -1px 0 rgba(255,255,255,.12),inset 0 0 0 1px rgba(255,255,255,.10)}
.glass{-webkit-backdrop-filter:url(#lens) blur(28px) saturate(180%) brightness(.85);backdrop-filter:url(#lens) blur(28px) saturate(180%) brightness(.85);
  box-shadow:var(--lg-rim),inset 0 0 30px rgba(255,255,255,.06),0 18px 50px rgba(0,0,0,.5)}
.glass::before{padding:1.5px;background:linear-gradient(135deg,rgba(255,255,255,.9),rgba(255,255,255,.05) 35%,rgba(255,255,255,.05) 65%,rgba(255,255,255,.6))}
.glass::after{background:radial-gradient(90% 70% at 20% -20%,rgba(255,255,255,.28),transparent 60%)}
.pill,.chip,.ib,.add,.sbtn{background:color-mix(in srgb,var(--acc,#fff) 22%,rgba(255,255,255,.04));box-shadow:var(--lg-rim),0 6px 18px rgba(0,0,0,.25)}
.pill.on,.cb.on,.pbtn{background:color-mix(in srgb,var(--acc,#fff) 70%,#fff 30%);color:color-mix(in srgb,var(--acc,#fff) 20%,#000);box-shadow:inset 0 1px 0 rgba(255,255,255,.6),0 8px 24px color-mix(in srgb,var(--acc,#fff) 40%,transparent)}
`;
h=h.replace(/<body[^>]*>/i,m=>m+svg);
const i=h.lastIndexOf('</style>');
h=h.slice(0,i)+css+h.slice(i);
fs.writeFileSync(f,h);
console.log('done');
