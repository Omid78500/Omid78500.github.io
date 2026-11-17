// Combined signal engine: market (multi-timeframe technicals) + news + crowd sentiment + derivatives + calendar risk.
// Runs on GitHub Actions every 15 minutes and writes btc/engine/signals.json and btc/engine/history.json.
import fs from "node:fs";
const OUT="btc/engine", SIG_F=`${OUT}/signals.json`, HIST_F=`${OUT}/history.json`;
const TFL={15:"۱۵ دقیقه",60:"۱ ساعت",240:"۴ ساعت",1440:"روزانه",10080:"هفتگی"};
let TH=5;
const UA={"User-Agent":"Mozilla/5.0 (signal-engine; +https://omid78500.github.io)","Accept":"*/*"};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const readJ=(f,d)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"));}catch(e){return d;}};
const clamp=(v,a=-1,b=1)=>Math.max(a,Math.min(b,v));
async function get(u,{json=true,timeout=12000,opt={}}={}){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);
  try{const r=await fetch(u,{...opt,headers:{...UA,...(opt.headers||{})},signal:c.signal});if(!r.ok)throw new Error(`${r.status} ${u.slice(0,80)}`);return json?await r.json():await r.text();}finally{clearTimeout(t);}}
const SRC={}; const ok=(k,v)=>{SRC[k]=v;};

const ASSETS=[
  {id:"BTC",name:"بیت‌کوین",cb:"BTC-USD",hl:"BTC",kw:/\b(bitcoin|btc)\b/i,dp:2,crypto:true},
  {id:"ETH",name:"اتریوم",cb:"ETH-USD",hl:"ETH",kw:/\b(ethereum|ether|eth)\b/i,dp:2,crypto:true},
  {id:"SOL",name:"سولانا",cb:"SOL-USD",hl:"SOL",kw:/\b(solana|sol)\b/i,dp:3,crypto:true},
  {id:"XRP",name:"ریپل XRP",cb:"XRP-USD",hl:"XRP",kw:/\b(xrp|ripple)\b/i,dp:4,crypto:true},
  {id:"GOLD",name:"طلا (اونس)",cb:"PAXG-USD",hl:"PAXG",kw:/\b(gold|bullion|xau|precious metals?)\b/i,ex:/\b(inc|corp|ltd|tsxv?|nyse|nasdaq|asx|stock|shares|mining|miners?|resources|royalt\w*|explor\w*|golden|goldman|gold card|gold medal)\b/i,dp:2,crypto:false}];
/* ===== indicators ===== */
function ema(src,p){const o=Array(src.length).fill(null),k=2/(p+1);let s=0,c=0;
  for(let i=0;i<src.length;i++){const v=src[i];if(v==null)continue;if(c<p){s+=v;c++;if(c===p)o[i]=s/p;}else o[i]=v*k+o[i-1]*(1-k);}return o;}
function sma(src,p){const o=Array(src.length).fill(null);
  for(let i=p-1;i<src.length;i++){let s=0,ok=true;for(let j=i-p+1;j<=i;j++){if(src[j]==null){ok=false;break;}s+=src[j];}if(ok)o[i]=s/p;}return o;}
function rsi(src,p=14){const o=Array(src.length).fill(null);let g=0,l=0;
  for(let i=1;i<src.length;i++){const d=src[i]-src[i-1],G=Math.max(d,0),L=Math.max(-d,0);
    if(i<=p){g+=G;l+=L;if(i===p){g/=p;l/=p;o[i]=l===0?100:100-100/(1+g/l);}}else{g=(g*(p-1)+G)/p;l=(l*(p-1)+L)/p;o[i]=l===0?100:100-100/(1+g/l);}}return o;}
function stochRsi(R,p=14){const raw=R.map((v,i)=>{if(v==null||i<p-1)return null;let mn=Infinity,mx=-Infinity;
  for(let j=i-p+1;j<=i;j++){if(R[j]==null)return null;mn=Math.min(mn,R[j]);mx=Math.max(mx,R[j]);}return mx===mn?50:(v-mn)/(mx-mn)*100;});
  const k=sma(raw,3);return{k,d:sma(k,3)};}
function macd(C){const a=ema(C,12),b=ema(C,26),m=C.map((_,i)=>a[i]!=null&&b[i]!=null?a[i]-b[i]:null),s=ema(m,9);
  return{m,s,h:m.map((v,i)=>v!=null&&s[i]!=null?v-s[i]:null)};}
function trs(cs){return cs.map((c,i)=>i?Math.max(c.h-c.l,Math.abs(c.h-cs[i-1].c),Math.abs(c.l-cs[i-1].c)):c.h-c.l);}
function wilder(src,p){const o=Array(src.length).fill(null);let a=0;
  for(let i=1;i<src.length;i++){if(i<=p){a+=src[i];if(i===p){a/=p;o[i]=a;}}else{a=(a*(p-1)+src[i])/p;o[i]=a;}}return o;}
function atr(cs,p=14){return wilder(trs(cs),p);}
function adx(cs,p=14){const n=cs.length,pd=[0],md=[0];
  for(let i=1;i<n;i++){const up=cs[i].h-cs[i-1].h,dn=cs[i-1].l-cs[i].l;pd.push(up>dn&&up>0?up:0);md.push(dn>up&&dn>0?dn:0);}
  const tr=wilder(trs(cs),p),sp=wilder(pd,p),sm=wilder(md,p),pdi=[],mdi=[],dx=[];
  for(let i=0;i<n;i++){if(tr[i]==null||tr[i]===0){pdi.push(null);mdi.push(null);dx.push(null);continue;}
    const P=100*sp[i]/tr[i],M=100*sm[i]/tr[i];pdi.push(P);mdi.push(M);dx.push(P+M===0?0:100*Math.abs(P-M)/(P+M));}
  const o=Array(n).fill(null);let a=0,c=0,st=dx.findIndex(v=>v!=null);
  for(let i=st;i>=0&&i<n;i++){if(c<p){a+=dx[i];c++;if(c===p){a/=p;o[i]=a;}}else{a=(a*(p-1)+dx[i])/p;o[i]=a;}}
  return{adx:o,pdi,mdi};}
function supertrend(cs,p=10,m=3){const A=atr(cs,p),n=cs.length,fu=Array(n).fill(null),fl=Array(n).fill(null),dir=Array(n).fill(0),line=Array(n).fill(null);
  for(let i=0;i<n;i++){if(A[i]==null)continue;const hl=(cs[i].h+cs[i].l)/2,bu=hl+m*A[i],bl=hl-m*A[i];
    if(fu[i-1]==null){fu[i]=bu;fl[i]=bl;dir[i]=cs[i].c>=hl?1:-1;}
    else{const pc=cs[i-1].c;fu[i]=(bu<fu[i-1]||pc>fu[i-1])?bu:fu[i-1];fl[i]=(bl>fl[i-1]||pc<fl[i-1])?bl:fl[i-1];
      dir[i]=dir[i-1]===-1?(cs[i].c>fu[i]?1:-1):(cs[i].c<fl[i]?-1:1);}
    line[i]=dir[i]===1?fl[i]:fu[i];}
  return{dir,line};}
function vwap(cs){let d=-1,pv=0,vv=0;return cs.map(c=>{const day=Math.floor(c.t/864e5);if(day!==d){d=day;pv=0;vv=0;}
  const tp=(c.h+c.l+c.c)/3;pv+=tp*c.v;vv+=c.v;return vv?pv/vv:tp;});}
function obv(cs){let o=0;return cs.map((c,i)=>{if(i){if(c.c>cs[i-1].c)o+=c.v;else if(c.c<cs[i-1].c)o-=c.v;}return o;});}

function normalize(rows){rows=rows.filter(r=>[r.t,r.o,r.h,r.l,r.c].every(Number.isFinite));const m=new Map();rows.forEach(r=>{if(!Number.isFinite(r.v))r.v=0;m.set(r.t,r);});
  return[...m.values()].sort((a,b)=>a.t-b.t);}
function parseText(txt){txt=txt.trim();let j=null;try{j=JSON.parse(txt);}catch(e){}
  if(j){if(j.result&&typeof j.result==="object"){const k=Object.keys(j.result).find(x=>Array.isArray(j.result[x]));
      if(k)return normalize(j.result[k].map(r=>({t:r[0]*1000,o:+r[1],h:+r[2],l:+r[3],c:+r[4],v:+r[6]})));}
    if(Array.isArray(j)&&Array.isArray(j[0])){if(j[0].length>=11)return normalize(j.map(r=>({t:+r[0],o:+r[1],h:+r[2],l:+r[3],c:+r[4],v:+r[5]})));
      if(j[0].length===6)return normalize(j.map(r=>({t:r[0]*1000,l:+r[1],h:+r[2],o:+r[3],c:+r[4],v:+r[5]})));}
    throw new Error("قالب JSON شناخته نشد");}
  const rows=txt.split(/\r?\n/).map(s=>s.split(/[,;\t]/).map(x=>x.trim())).filter(r=>r.length>=5&&!isNaN(parseFloat(r[1])));
  if(!rows.length)throw new Error("داده‌ای پیدا نشد");
  return normalize(rows.map(r=>{let t=isNaN(+r[0])?Date.parse(r[0]):+r[0];if(t<1e11)t*=1000;return{t,o:+r[1],h:+r[2],l:+r[3],c:+r[4],v:r[5]!=null?+r[5]:0};}));}
function agg(cs,base,to){if(to===base)return cs.slice();const ms=to*6e4,need=to/base,out=[];let cur=null;
  for(const c of cs){const b=Math.floor(c.t/ms)*ms;if(!cur||cur.t!==b){if(cur)out.push(cur);cur={t:b,o:c.o,h:c.h,l:c.l,c:c.c,v:c.v,n:1};}
    else{cur.h=Math.max(cur.h,c.h);cur.l=Math.min(cur.l,c.l);cur.c=c.c;cur.v+=c.v;cur.n++;}}
  if(cur)out.push(cur);if(out.length&&out[0].n<need)out.shift();return out;}
function ctx(cs,htfCs,tfm,htfm){
  const C=cs.map(c=>c.c),R=rsi(C),M=macd(C),S=stochRsi(R),ST=supertrend(cs),AD=adx(cs),OB=obv(cs);
  const X={cs,C,tfm,htfm,e9:ema(C,9),e21:ema(C,21),e50:ema(C,50),e200:ema(C,200),R,sk:S.k,sd:S.d,mm:M.m,ms:M.s,mh:M.h,atr:atr(cs,14),
    st:ST.dir,stl:ST.line,adx:AD.adx,pdi:AD.pdi,mdi:AD.mdi,vw:vwap(cs),obv:OB,obvE:ema(OB,20),vAvg:sma(cs.map(c=>c.v),20),htf:null};
  if(htfCs&&htfCs.length>=30){const hc=htfCs.map(c=>c.c),h20=ema(hc,20),h50=ema(hc,50);
    const tr=hc.map((c,i)=>h20[i]==null||h50[i]==null?null:(c>h20[i]&&h20[i]>h50[i]?1:c<h20[i]&&h20[i]<h50[i]?-1:0));
    X.htf=Array(cs.length).fill(null);let j=-1;
    for(let i=0;i<cs.length;i++){const te=cs[i].t+tfm*6e4;while(j+1<htfCs.length&&htfCs[j+1].t+htfm*6e4<=te)j++;X.htf[i]=j>=0?tr[j]:null;}}
  return X;}
function pattern(cs,i,X){const c=cs[i],p=cs[i-1];if(!p)return 0;const body=Math.abs(c.c-c.o),up=c.h-Math.max(c.o,c.c),lo=Math.min(c.o,c.c)-c.l,rng=c.h-c.l||1;
  if(p.c<p.o&&c.c>c.o&&c.o<=p.c&&c.c>=p.o&&body>rng*0.5)return{p:1,t:"الگوی پوشای صعودی (Bullish Engulfing)"};
  if(p.c>p.o&&c.c<c.o&&c.o>=p.c&&c.c<=p.o&&body>rng*0.5)return{p:-1,t:"الگوی پوشای نزولی (Bearish Engulfing)"};
  if(body>0&&lo>=2*body&&up<=body*0.6&&c.c<X.e21[i])return{p:1,t:"کندل چکش (Hammer) در کف"};
  if(body>0&&up>=2*body&&lo<=body*0.6&&c.c>X.e21[i])return{p:-1,t:"کندل ستاره دنباله‌دار (Shooting Star) در سقف"};
  return 0;}
function scoreAt(X,i){const r=[];let s=0;const add=(p,t)=>{s+=p;r.push({p,t});},c=X.C[i];
  if(X.e50[i]==null||X.mh[i]==null||X.R[i]==null)return null;
  if(X.e9[i]>X.e21[i]&&X.e21[i]>X.e50[i])add(2,"EMA 9 > 21 > 50 — روند صعودی مرتب");
  else if(X.e9[i]<X.e21[i]&&X.e21[i]<X.e50[i])add(-2,"EMA 9 < 21 < 50 — روند نزولی مرتب");
  else add(0,"میانگین‌های متحرک درهم — روند مشخص نیست");
  if(X.e200[i]!=null)add(c>X.e200[i]?1:-1,`قیمت ${c>X.e200[i]?"بالای":"زیر"} EMA 200`);
  if(X.htf&&X.htf[i]!=null){const h=X.htf[i];add(h*2,h===1?`روند تایم‌فریم بالاتر (${TFL[X.htfm]}) صعودی`:h===-1?`روند تایم‌فریم بالاتر (${TFL[X.htfm]}) نزولی`:`روند تایم‌فریم بالاتر (${TFL[X.htfm]}) خنثی`);}
  if(X.st[i]){const flip=X.st[i-1]&&X.st[i-1]!==X.st[i];add(X.st[i]*2,X.st[i]===1?(flip?"سوپرترند همین الان صعودی شد":"سوپرترند صعودی"):(flip?"سوپرترند همین الان نزولی شد":"سوپرترند نزولی"));}
  let cross=0;for(let k=i-2;k<=i;k++){const a=X.mh[k-1],b=X.mh[k];if(a!=null&&b!=null){if(a<=0&&b>0)cross=1;if(a>=0&&b<0)cross=-1;}}
  if(cross)add(cross*2,cross===1?"کراس صعودی MACD در چند کندل اخیر":"کراس نزولی MACD در چند کندل اخیر");
  else add(X.mh[i]>0?1:-1,X.mh[i]>0?"هیستوگرام MACD مثبت":"هیستوگرام MACD منفی");
  const rv=X.R[i];
  if(rv>75)add(-1,`RSI ${rv.toFixed(1)} — اشباع خرید شدید`);else if(rv<25)add(1,`RSI ${rv.toFixed(1)} — اشباع فروش شدید`);
  else add(rv>=50?1:-1,`RSI ${rv.toFixed(1)} — مومنتوم ${rv>=50?"مثبت":"منفی"}`);
  let sc=0;for(let k=i-1;k<=i;k++){const k0=X.sk[k-1],d0=X.sd[k-1],k1=X.sk[k],d1=X.sd[k];
    if([k0,d0,k1,d1].every(v=>v!=null)){if(k0<=d0&&k1>d1&&k1<35)sc=1;if(k0>=d0&&k1<d1&&k1>65)sc=-1;}}
  if(sc)add(sc,sc===1?"Stoch RSI از ناحیه اشباع فروش رو به بالا کراس کرد":"Stoch RSI از ناحیه اشباع خرید رو به پایین کراس کرد");
  if(X.tfm<300)add(c>X.vw[i]?1:-1,`قیمت ${c>X.vw[i]?"بالای":"زیر"} VWAP روزانه`);
  if(X.obvE[i]!=null)add(X.obv[i]>X.obvE[i]?1:-1,X.obv[i]>X.obvE[i]?"OBV بالای میانگین — ورود پول":"OBV زیر میانگین — خروج پول");
  const pt=pattern(X.cs,i,X);if(pt)add(pt.p,pt.t);
  let fs=s;const ad=X.adx[i];
  if(ad!=null){if(ad<18){fs=s*0.6;r.push({p:0,t:`ADX ${ad.toFixed(0)} — بازار بی‌روند/رنج، قدرت سیگنال کم شد`});}
    else r.push({p:0,t:`ADX ${ad.toFixed(0)} — ${ad>25?"روند قوی":"روند متوسط"}`});}
  if(X.vAvg[i]&&X.cs[i].v>1.8*X.vAvg[i])r.push({p:0,t:`حجم کندل ${(X.cs[i].v/X.vAvg[i]).toFixed(1)} برابر میانگین`});
  return{s:fs,raw:s,r};}
const sigOf=s=>s==null?0:s>=TH?1:s<=-TH?-1:0;
const EXIT=1; // hysteresis: a signal starts at |score|>=TH and only ends when the score drops back near zero (or flips past -TH)
function sigSeries(X,k){if(X._ss&&X._ssk===k&&X._sth===TH)return X._ss;const out=Array(k+1).fill(0);let st=0;
  for(let i=60;i<=k;i++){const sc=scoreAt(X,i),s=sc?sc.s:0;
    if(st===1){if(s<=-TH)st=-1;else if(s<EXIT)st=0;}else if(st===-1){if(s>=TH)st=1;else if(s>-EXIT)st=0;}else st=s>=TH?1:s<=-TH?-1:0;
    out[i]=st;}X._ss=out;X._ssk=k;X._sth=TH;return out;}

function divergence(X,k){const piv=(arr,i,f)=>{for(let j=1;j<=3;j++){if(f(arr[i-j],arr[i])||f(arr[i+j],arr[i]))return false;}return true;};
  const lows=[],highs=[];for(let i=Math.max(4,k-45);i<=k-3;i++){if(piv(X.cs.map(c=>c.l),i,(a,b)=>a<b))lows.push(i);if(piv(X.cs.map(c=>c.h),i,(a,b)=>a>b))highs.push(i);}
  if(lows.length>=2){const[a,b]=lows.slice(-2);if(X.cs[b].l<X.cs[a].l&&X.R[b]>X.R[a])return{p:1,t:"واگرایی مثبت RSI (کف پایین‌تر قیمت، کف بالاتر RSI)"};}
  if(highs.length>=2){const[a,b]=highs.slice(-2);if(X.cs[b].h>X.cs[a].h&&X.R[b]<X.R[a])return{p:-1,t:"واگرایی منفی RSI (سقف بالاتر قیمت، سقف پایین‌تر RSI)"};}
  return null;}
function levels(X,k){const cs=X.cs,c=X.C[k];let sup=null,res=null;
  for(let i=Math.max(3,k-80);i<=k-3;i++){const isL=[1,2,3].every(j=>cs[i].l<=cs[i-j].l&&cs[i].l<=cs[i+j].l),isH=[1,2,3].every(j=>cs[i].h>=cs[i-j].h&&cs[i].h>=cs[i+j].h);
    if(isL&&cs[i].l<c&&(sup==null||cs[i].l>sup))sup=cs[i].l;if(isH&&cs[i].h>c&&(res==null||cs[i].h<res))res=cs[i].h;}
  return{sup,res};}
function backtest(X,k,rr,slm){const T=[],marks=[];let pos=null,prev=0;
  for(let i=60;i<=k;i++){
    if(pos){const c=X.cs[i];const hitSL=pos.d===1?c.l<=pos.sl:c.h>=pos.sl,hitTP=pos.d===1?c.h>=pos.tp:c.l<=pos.tp;
      if(hitSL||hitTP){T.push({...pos,win:!hitSL,exit:i});pos=null;}}
    const sg=sigSeries(X,k)[i];
    if(sg&&sg!==prev){marks.push({i,d:sg});if(!pos&&X.atr[i]){const e=X.C[i],risk=slm*X.atr[i];pos={d:sg,i,e,sl:e-sg*risk,tp:e+sg*risk*rr};}}
    prev=sg;}
  const w=T.filter(t=>t.win).length;return{T,marks,n:T.length,w,wr:T.length?w/T.length*100:0,netR:w*rr-(T.length-w),open:pos};}

/* ================= MARKET DATA ================= */
async function candles(product,gran,pages){let all=[],end=Date.now();
  for(let p=0;p<pages;p++){const st=end-300*gran*1000;
    const t=await get(`https://api.exchange.coinbase.com/products/${product}/candles?granularity=${gran}&start=${new Date(st).toISOString()}&end=${new Date(end).toISOString()}`,{json:false});
    all=all.concat(parseText(t));end=st;await sleep(150);}return normalize(all);}

function techFor(sets){ // sets: {15:cs,60:cs,240:cs,1440:cs,10080:cs}
  const W={15:0.15,60:0.3,240:0.3,1440:0.25},HT={15:60,60:240,240:1440,1440:10080},out={tfs:[],score:0,reasons:[]};let wsum=0;
  for(const tf of [15,60,240,1440]){const cs=sets[tf];if(!cs||cs.length<80)continue;
    const n=cs.length-1,k=cs[n].t+tf*6e4>Date.now()+5000?n-1:n,X=ctx(cs,sets[HT[tf]],tf,HT[tf]),sc=scoreAt(X,k);if(!sc)continue;
    const st=sigSeries(X,k)[k],v=0.5*st+0.5*clamp(sc.s/10),bt=backtest(X,k,2,1.5);
    out.tfs.push({tf,label:TFL[tf],score:+sc.s.toFixed(1),state:st,rsi:X.R[k]!=null?+X.R[k].toFixed(0):null,adx:X.adx[k]!=null?+X.adx[k].toFixed(0):null,
      bt:{n:bt.n,wr:Math.round(bt.wr),netR:+bt.netR.toFixed(1)}});
    out.score+=W[tf]*v;wsum+=W[tf];
    if(tf===240){out.atr=X.atr[k];out.reasons=sc.r.filter(r=>r.p).slice(0,6).map(r=>({p:r.p,t:r.t}));const lv=levels(X,k);out.sup=lv.sup;out.res=lv.res;}}
  out.score=wsum?out.score/wsum:0;const up=out.tfs.filter(t=>t.state===1).length,dn=out.tfs.filter(t=>t.state===-1).length;
  out.align=up&&!dn?"up":dn&&!up?"down":up&&dn?"mixed":"none";return out;}

/* ================= NEWS (RSS) ================= */
const FEEDS=[
  ["CoinDesk","https://www.coindesk.com/arc/outboundfeeds/rss/"],["Cointelegraph","https://cointelegraph.com/rss"],["Decrypt","https://decrypt.co/feed"],
  ["Bitcoin Magazine","https://bitcoinmagazine.com/.rss/full/"],["The Block","https://www.theblock.co/rss.xml"],
  ["Google News: Ethereum/Solana/XRP","https://news.google.com/rss/search?q=ethereum+OR+solana+OR+xrp+when:1d&hl=en-US&gl=US&ceid=US:en"],
  ["Google News: Bitcoin","https://news.google.com/rss/search?q=bitcoin+OR+crypto+when:1d&hl=en-US&gl=US&ceid=US:en"],
  ["Google News: Gold","https://news.google.com/rss/search?q=gold+price+when:1d&hl=en-US&gl=US&ceid=US:en"],
  ["Google News: Fed","https://news.google.com/rss/search?q=federal+reserve+OR+inflation+OR+dollar+when:1d&hl=en-US&gl=US&ceid=US:en"],
  ["Kitco (gold)","https://news.google.com/rss/search?q=gold+site:kitco.com+when:2d&hl=en-US&gl=US&ceid=US:en"]];
const dec=s=>s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/<[^>]+>/g,"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&#x27;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").trim();
function parseRSS(xml,src){const items=[];for(const m of xml.matchAll(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/g)){const it=m[0];
  const t=(it.match(/<title[^>]*>([\s\S]*?)<\/title>/)||[])[1],l=(it.match(/<link[^>]*>([\s\S]*?)<\/link>/)||it.match(/<link[^>]*href="([^"]+)"/)||[])[1],
    d=(it.match(/<pubDate>([\s\S]*?)<\/pubDate>/)||it.match(/<published>([\s\S]*?)<\/published>/)||it.match(/<updated>([\s\S]*?)<\/updated>/)||[])[1];
  if(t)items.push({t:dec(t).replace(/\s+-\s+[^-]{2,40}$/,""),u:l?dec(l):"",src,ts:d?Date.parse(dec(d)):Date.now()});}return items;}
// finance lexicon; gold reacts opposite to crypto for fear/war/recession headlines
const POS=/\b(surg|soar|rall|jump|gain|bull|record high|all-time high|ath|approv|inflow|adopt|buy(ing)?\b|rise|rises|rising|climb|breakout|upgrade|boost|recover|rebound|optimis|beat|accumulat|higher|green|uptrend|outperform)/i;
const NEG=/\b(crash|plung|drop|fall|falls|falling|slump|bear|hack|exploit|outflow|sell-?off|lawsuit|\bsue|ban\b|bans|liquidat|collaps|declin|tumbl|slid|plummet|lower|red\b|downtrend|fraud|probe|warn|dump|losses|lose|underperform)/i;
const RISK_OFF=/\b(war|attack|missile|conflict|recession|crisis|tariff|geopolitic|safe[- ]haven|uncertain|turmoil|panic)/i;
const RATE_CUT=/\b(rate cuts?|cut rates|dovish|easing|stimulus)/i, RATE_HIKE=/\b(rate hikes?|hike rates|hawkish|tightening|strong(er)? dollar|dollar (rallies|jumps|strengthens|surges))/i;
function headlineScore(t,a){let s=0;if(POS.test(t))s+=1;if(NEG.test(t))s-=1;
  if(RATE_CUT.test(t))s+=0.7;if(RATE_HIKE.test(t))s-=0.7;
  if(RISK_OFF.test(t))s+=a.crypto?-0.5:0.8;return clamp(s,-1.5,1.5);}
async function loadNews(){let all=[];
  for(const[src,u]of FEEDS){try{const x=await get(u,{json:false});const it=parseRSS(x,src);all=all.concat(it);ok("news:"+src,it.length);}catch(e){ok("news:"+src,"ERR "+e.message.slice(0,60));}}
  const seen=new Set();return all.filter(n=>n.t&&isFinite(n.ts)&&Date.now()-n.ts<36*36e5).filter(n=>{const k=n.t.toLowerCase().slice(0,70);if(seen.has(k))return false;seen.add(k);return true;});}
const MACRO=/\b(fed|federal reserve|inflation|cpi|interest rate|dollar|treasury|yields?|jobs report|payrolls|powell|recession|tariff)/i;
function newsFor(a,news){
  // asset-specific headlines carry 70%; macro (Fed, inflation, dollar) headlines are capped at 30% so one widely-copied story can't dominate
  const own=news.filter(n=>a.kw.test(n.t)&&!(a.ex&&a.ex.test(n.t))),mac=news.filter(n=>!a.kw.test(n.t)&&MACRO.test(n.t));
  const sc=list=>{let ws=0,s=0;const out=list.map(n=>{const v=headlineScore(n.t,a),age=(Date.now()-n.ts)/36e5,w=Math.exp(-age/10);ws+=w;s+=w*v;return{...n,s:v,age};});return{v:ws?clamp(s/ws):0,out,ws};};
  const O=sc(own),Mc=sc(mac),score=O.ws>0.2?0.7*O.v+0.3*Mc.v:0.5*Mc.v,rel=own.concat(mac.slice(0,0));
  const scored=O.out.sort((x,y)=>x.age-y.age).concat(Mc.out.sort((x,y)=>x.age-y.age).slice(0,3));
  return{score:clamp(score),macro:+Mc.v.toFixed(2),count:own.length,pos:scored.filter(n=>n.s>0).length,neg:scored.filter(n=>n.s<0).length,
    headlines:scored.slice(0,8).map(n=>({t:n.t,u:n.u,src:n.src,s:+n.s.toFixed(1),ts:n.ts}))};}

/* ================= CROWD SENTIMENT ================= */
async function fearGreed(){try{const j=await get("https://api.alternative.me/fng/?limit=8");ok("fear&greed","ok");
  return{v:+j.data[0].value,label:j.data[0].value_classification,wk:+j.data[7]?.value};}catch(e){ok("fear&greed","ERR "+e.message.slice(0,60));return null;}}
async function reddit(sub){try{const j=await get(`https://www.reddit.com/r/${sub}/hot.json?limit=40`);const p=j.data.children.map(c=>c.data);ok("reddit:"+sub,p.length);return p;}
  catch(e){ok("reddit:"+sub,"ERR "+e.message.slice(0,60));return[];}}
function crowdFor(a,fg,posts){const d=[];let s=0,w=0;
  if(a.crypto&&fg){const c=fg.v<=20?0.6:fg.v<=35?0.25:fg.v>=80?-0.6:fg.v>=65?-0.25:0;s+=c*1;w+=1;
    d.push({p:Math.sign(c),t:`شاخص ترس و طمع ${fg.v} (${fg.label}) — ${fg.v<=35?"ترس زیاد معمولاً نزدیک کف‌هاست (نگاه مخالف جمع)":fg.v>=65?"طمع زیاد معمولاً نزدیک سقف‌هاست (نگاه مخالف جمع)":"خنثی"}`});}
  const rel=posts.filter(p=>a.kw.test(p.title)||(!a.crypto&&/gold/i.test(p.subreddit)));
  if(rel.length>=3){let ps=0,pw=0;rel.forEach(p=>{const sc=headlineScore(p.title,a),ww=Math.log10(10+p.score);ps+=sc*ww;pw+=ww;});const r=clamp(ps/pw);
    s+=r*0.6;w+=0.6;d.push({p:Math.sign(Math.round(r*10)),t:`حال‌وهوای Reddit (${rel.length} پست داغ): ${r>0.15?"مثبت":r<-0.15?"منفی":"خنثی"}`});}
  return{score:w?clamp(s/w):0,detail:d};}

/* ================= DERIVATIVES (Hyperliquid perps) ================= */
async function perps(){try{const j=await get("https://api.hyperliquid.xyz/info",{opt:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"metaAndAssetCtxs"})}});
  const m={};j[0].universe.forEach((u,i)=>m[u.name]=j[1][i]);ok("hyperliquid",Object.keys(m).length);return m;}catch(e){ok("hyperliquid","ERR "+e.message.slice(0,60));return null;}}
function derivFor(a,P,prev){if(!P||!P[a.hl])return null;const c=P[a.hl],f=+c.funding,ann=f*24*365*100,oi=+c.openInterest*(+c.markPx||+c.oraclePx),d=[];let s=0;
  if(ann>40){s-=0.6;d.push({p:-1,t:`فاندینگ خیلی مثبت (${ann.toFixed(0)}٪ سالانه) — خریداران اهرمی زیادند، خطر ریزش ناگهانی`});}
  else if(ann>15){s-=0.25;d.push({p:-1,t:`فاندینگ مثبت (${ann.toFixed(0)}٪ سالانه) — کمی شلوغی سمت خرید`});}
  else if(ann<-10){s+=0.6;d.push({p:1,t:`فاندینگ منفی (${ann.toFixed(0)}٪ سالانه) — فروشندگان اهرمی زیادند، احتمال جهش (Short squeeze)`});}
  else d.push({p:0,t:`فاندینگ عادی (${ann.toFixed(0)}٪ سالانه)`});
  const p0=prev&&prev.oi;if(p0){const ch=(oi/p0-1)*100;if(Math.abs(ch)>3)d.push({p:0,t:`حجم قراردادهای باز ${ch>0?"افزایش":"کاهش"} ${Math.abs(ch).toFixed(1)}٪ از آخرین بررسی`});}
  return{score:clamp(s),detail:d,oi,fundingAnn:+ann.toFixed(1)};}

/* ================= CALENDAR RISK ================= */
async function calendar(){let ev=[];for(const u of["https://nfs.faireconomy.media/ff_calendar_thisweek.json","https://nfs.faireconomy.media/ff_calendar_nextweek.json"]){
  try{const j=await get(u);ev=ev.concat(j.filter(e=>e.country==="USD"&&e.impact==="High").map(e=>({t:e.title,ts:Date.parse(e.date)})));ok("economic calendar "+(u.includes("next")?"next week":"this week"),j.length);}catch(e){if(!/404/.test(e.message))ok("economic calendar","ERR "+e.message.slice(0,60));}}
  return ev.filter(e=>isFinite(e.ts)).sort((a,b)=>a.ts-b.ts);}

/* ================= COMBINE ================= */
const W={tech:0.55,news:0.15,crowd:0.12,deriv:0.18};
function combine(a,T,N,C,D,risk,prevState){const parts={tech:T.score,news:N.score,crowd:C.score};if(D)parts.deriv=D.score;
  let ws=0,s=0;for(const k in parts){s+=W[k]*parts[k];ws+=W[k];}let f=s/ws;
  // agreement bonus/penalty: technicals across timeframes
  if(T.align==="mixed")f*=0.75;
  const near=risk.find(e=>e.ts>Date.now()-36e5&&e.ts<Date.now()+6*36e5);if(near)f*=0.6;
  // hysteresis across runs so the verdict does not flip on noise
  const ENTER=0.30,EXITV=0.08;let st=prevState||0;
  if(st===1){if(f<=-ENTER)st=-1;else if(f<EXITV)st=0;}else if(st===-1){if(f>=ENTER)st=1;else if(f>-EXITV)st=0;}else st=f>=ENTER?1:f<=-ENTER?-1:0;
  const conf=Math.round(clamp(Math.abs(f)/0.7,0,1)*100);
  return{final:+f.toFixed(3),state:st,conf,near};}

async function main(){
  const prevSig=readJ(SIG_F,{assets:[]}),hist=readJ(HIST_F,{}),prevBy={};(prevSig.assets||[]).forEach(a=>prevBy[a.id]=a);
  const[news,fg,P,risk]=await Promise.all([loadNews(),fearGreed(),perps(),calendar()]);
  const posts=[]; // Reddit blocks requests from GitHub's servers, so crowd mood comes from the Fear & Greed index
  const out=[];
  for(const a of ASSETS){try{
    const c15=await candles(a.cb,900,1),c1h=await candles(a.cb,3600,4),c1d=await candles(a.cb,86400,1);ok("candles:"+a.id,`${c15.length}/${c1h.length}/${c1d.length}`);
    const sets={15:c15,60:c1h,240:agg(c1h,60,240),1440:c1d,10080:agg(c1d,1440,10080)};
    const T=techFor(sets),N=newsFor(a,news),C=crowdFor(a,fg,posts),D=derivFor(a,P,prevBy[a.id]&&prevBy[a.id].deriv),prev=prevBy[a.id];
    const R=combine(a,T,N,C,D,risk,prev&&prev.state),price=c15[c15.length-1].c,p24=c1h[Math.max(0,c1h.length-25)].c;
    const dir=R.state||Math.sign(R.final)||1,atr=T.atr||price*0.01;
    const sig=R.state===1?"BUY":R.state===-1?"SELL":"WAIT";
    out.push({id:a.id,name:a.name,dp:a.dp,price,ch24:+((price/p24-1)*100).toFixed(2),signal:sig,state:R.state,final:R.final,conf:R.conf,
      since:prev&&prev.state===R.state?prev.since:Date.now(),
      parts:{tech:+T.score.toFixed(2),news:+N.score.toFixed(2),crowd:+C.score.toFixed(2),deriv:D?+D.score.toFixed(2):null},
      tech:T,news:N,crowd:C,deriv:D,risk:R.near?{t:R.near.t,ts:R.near.ts}:null,
      levels:{entry:price,sl:price-dir*1.5*atr,tp1:price+dir*1.5*atr,tp2:price+dir*3*atr,sup:T.sup,res:T.res}});
    // history: log every change of verdict and score it 24h later
    const H=hist[a.id]||(hist[a.id]=[]);if(!prev||prev.state!==R.state)H.unshift({t:Date.now(),signal:sig,price,final:R.final});
    H.forEach(h=>{if(h.res==null&&h.signal!=="WAIT"&&Date.now()-h.t>=24*36e5){const r=(price/h.price-1)*100;h.ret24=+r.toFixed(2);h.res=(h.signal==="BUY"?r>0:r<0)?"win":"loss";}});
    hist[a.id]=H.slice(0,200);
  }catch(e){ok("asset:"+a.id,"ERR "+e.message.slice(0,80));if(prevBy[a.id])out.push({...prevBy[a.id],stale:true});}}
  const res={updated:Date.now(),fg,calendar:risk.filter(e=>e.ts>Date.now()-36e5).slice(0,8),sources:SRC,weights:W,assets:out};
  fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(SIG_F,JSON.stringify(res));fs.writeFileSync(HIST_F,JSON.stringify(hist));
  console.log(JSON.stringify(SRC,null,1));out.forEach(a=>console.log(a.id,a.signal,a.final,JSON.stringify(a.parts)));}
main().catch(e=>{console.error("ENGINE ERROR",e);process.exitCode=1;});
