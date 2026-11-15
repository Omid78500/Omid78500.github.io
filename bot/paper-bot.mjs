// BTC paper-trading bot for an Alpaca PAPER account. Runs every 5 minutes on GitHub Actions.
// Signal engine is the same scoring used by the BTC Signal app (omid78500.github.io/btc).
import fs from "node:fs";
const DIR="btc/paper", CFG_F=`${DIR}/config.json`, ST_F=`${DIR}/state.json`, TR_F=`${DIR}/trades.json`;
const ALP="https://paper-api.alpaca.markets/v2";  // paper only, by design
const KEY=(process.env.ALPACA_KEY_ID||"").trim(), SEC=(process.env.ALPACA_SECRET_KEY||"").trim();
const TFL={5:"5m",10:"10m",15:"15m",60:"1h"};
const readJ=(f,d)=>{try{return JSON.parse(fs.readFileSync(f,"utf8"));}catch(e){return d;}};
const cfg=Object.assign({enabled:true,cap:100,perTrade:100,tf:15,sensitivity:5,slAtr:1.5,rr:2},readJ(CFG_F,{}));
let TH=cfg.sensitivity;
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
  add(c>X.vw[i]?1:-1,`قیمت ${c>X.vw[i]?"بالای":"زیر"} VWAP روزانه`);
  if(X.obvE[i]!=null)add(X.obv[i]>X.obvE[i]?1:-1,X.obv[i]>X.obvE[i]?"OBV بالای میانگین — ورود پول":"OBV زیر میانگین — خروج پول");
  const pt=pattern(X.cs,i,X);if(pt)add(pt.p,pt.t);
  let fs=s;const ad=X.adx[i];
  if(ad!=null){if(ad<18){fs=s*0.6;r.push({p:0,t:`ADX ${ad.toFixed(0)} — بازار بی‌روند/رنج، قدرت سیگنال کم شد`});}
    else r.push({p:0,t:`ADX ${ad.toFixed(0)} — ${ad>25?"روند قوی":"روند متوسط"}`});}
  if(X.vAvg[i]&&X.cs[i].v>1.8*X.vAvg[i])r.push({p:0,t:`حجم کندل ${(X.cs[i].v/X.vAvg[i]).toFixed(1)} برابر میانگین`});
  return{s:fs,raw:s,r};}

const sigOf=s=>s==null?0:s>=TH?1:s<=-TH?-1:0;
async function getJ(u,opt={}){const r=await fetch(u,opt);const t=await r.text();if(!r.ok){const e=new Error(`${r.status} ${t.slice(0,200)}`);e.status=r.status;throw e;}return t?JSON.parse(t):null;}
const alp=(p,opt={})=>getJ(ALP+p,{...opt,headers:{"APCA-API-KEY-ID":KEY,"APCA-API-SECRET-KEY":SEC,"Content-Type":"application/json",...(opt.headers||{})}});
async function coinbase(gran,pages){let all=[],end=Date.now();
  for(let p=0;p<pages;p++){const start=end-300*gran*1000;
    const t=await (await fetch(`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${gran}&start=${new Date(start).toISOString()}&end=${new Date(end).toISOString()}`,{headers:{"User-Agent":"btc-paper-bot"}})).text();
    all=all.concat(parseText(t));end=start;}return normalize(all);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function main(){
  const st=readJ(ST_F,{pos:null,lastBar:0,lastSignal:0,lastRun:0,log:[]}),trades=readJ(TR_F,[]);
  const now=Date.now(),note=m=>{st.log=[{t:now,m},...(st.log||[])].slice(0,30);console.log(m);};
  st.lastRun=now;st.config=cfg;
  if(!KEY||!SEC){st.status="no_keys";st.message="کلیدهای Alpaca هنوز در GitHub Secrets ثبت نشده‌اند.";return save(st,trades);}
  if(!cfg.enabled){st.status="paused";st.message="ربات خاموش است (config.json → enabled:false).";}
  // market data
  const tf=cfg.tf, gran=tf===5?300:tf===15?900:tf===60?3600:300;
  let cs=await coinbase(gran,1); if(tf===10)cs=agg(await coinbase(300,2),5,10);
  const htfm=tf<=10?60:60, h=await coinbase(3600,1);
  const tick=await getJ("https://api.exchange.coinbase.com/products/BTC-USD/ticker",{headers:{"User-Agent":"btc-paper-bot"}}),px=+tick.price;
  // closed bar only
  let k=cs.length-1; if(cs[k].t+tf*6e4>now)k--;
  const X=ctx(cs,h,tf,htfm),sc=scoreAt(X,k),sg=sigOf(sc&&sc.s),prev=sigOf((scoreAt(X,k-1)||{}).s);
  st.signal={bar:cs[k].t,score:sc?+sc.s.toFixed(2):null,sig:sg,price:px,atr:X.atr[k],reasons:(sc?sc.r:[]).map(r=>({p:r.p,t:r.t}))};
  // account + position (Alpaca is the source of truth)
  const acct=await alp("/account");st.account={equity:+acct.equity,cash:+acct.cash,buying_power:+acct.buying_power};
  let pos=null;try{pos=await alp("/positions/BTCUSD");}catch(e){if(e.status!==404)throw e;}
  const exposure=pos?Math.abs(+pos.market_value):0;
  st.position=pos?{qty:+pos.qty,avg:+pos.avg_entry_price,value:+pos.market_value,upl:+pos.unrealized_pl}:null;
  if(st.pos&&!pos){note("پوزیشن بیرون از ربات بسته شده بود؛ وضعیت پاک شد.");st.pos=null;}
  async function close(reason){
    const qty=+pos.qty;await alp("/positions/BTCUSD",{method:"DELETE"});await sleep(2500);
    let exit=px;try{const os=await alp("/orders?status=closed&limit=5&direction=desc&symbols=BTC/USD");const o=os.find(o=>o.side==="sell"&&o.filled_avg_price);if(o)exit=+o.filled_avg_price;}catch(e){}
    const entry=st.pos?st.pos.entry:+pos.avg_entry_price,pnl=(exit-entry)*qty;
    trades.unshift({openAt:st.pos?st.pos.at:null,closeAt:Date.now(),entry,exit,qty,pnl:+pnl.toFixed(2),pnlPct:+((exit/entry-1)*100).toFixed(3),reason});
    note(`فروش ${qty} BTC در ${exit.toFixed(2)} — ${reason} — سود/زیان ${pnl.toFixed(2)}$`);st.pos=null;pos=null;}
  if(pos){ // manage exits
    const sp=st.pos||{stop:+pos.avg_entry_price-cfg.slAtr*X.atr[k],tp:+pos.avg_entry_price+cfg.slAtr*X.atr[k]*cfg.rr,entry:+pos.avg_entry_price,at:null};st.pos=sp;
    if(px<=sp.stop)await close("حد ضرر");else if(px>=sp.tp)await close("حد سود");else if(sg===-1&&cs[k].t!==st.lastBar)await close("سیگنال فروش");
  }
  if(!pos&&cfg.enabled&&sg===1&&prev!==1&&cs[k].t!==st.lastBar){
    const room=cfg.cap-(pos?exposure:0),notional=Math.min(cfg.perTrade,room,+acct.cash);
    if(notional<10)note(`سیگنال خرید آمد ولی جا در سقف ${cfg.cap}$ نیست.`);
    else{const o=await alp("/orders",{method:"POST",body:JSON.stringify({symbol:"BTC/USD",notional:notional.toFixed(2),side:"buy",type:"market",time_in_force:"gtc"})});
      await sleep(2500);let f=o;try{f=await alp("/orders/"+o.id);}catch(e){}
      const entry=+f.filled_avg_price||px,a=X.atr[k];
      st.pos={entry,at:Date.now(),stop:+(entry-cfg.slAtr*a).toFixed(2),tp:+(entry+cfg.slAtr*a*cfg.rr).toFixed(2),orderId:o.id,notional};
      note(`خرید ${notional.toFixed(2)}$ BTC در ${entry.toFixed(2)} — حد ضرر ${st.pos.stop} — حد سود ${st.pos.tp}`);}}
  st.lastBar=cs[k].t;st.lastSignal=sg;
  if(cfg.enabled){st.status="running";st.message="ربات فعال است.";}
  try{const p2=await alp("/positions/BTCUSD");st.position={qty:+p2.qty,avg:+p2.avg_entry_price,value:+p2.market_value,upl:+p2.unrealized_pl};}catch(e){st.position=null;}
  save(st,trades);
}
const fp=st=>JSON.stringify([st.status,st.message,st.pos,st.lastBar,(st.log||[])[0],st.position&&st.position.qty]);
function save(st,trades){
  const old=readJ(ST_F,{}),stale=!old.lastRun||Date.now()-old.lastRun>55*6e4;
  if(fp(st)!==fp(old)||stale){fs.mkdirSync(DIR,{recursive:true});fs.writeFileSync(ST_F,JSON.stringify(st,null,1));fs.writeFileSync(TR_F,JSON.stringify(trades.slice(0,500),null,1));console.log("state saved");}
  else console.log("no change; not saving");
}
main().catch(e=>{console.error("BOT ERROR:",e.message);const st=readJ(ST_F,{});let msg="خطا: "+e.message.slice(0,200);
  if(e.status===401||e.status===403)msg=`کلیدها را Alpaca قبول نکرد (${e.status}). بررسی: Key با «${(KEY||"").trim().slice(0,2)}» شروع می‌شود و ${(KEY||"").length} حرف دارد؛ Secret ${(SEC||"").length} حرف دارد${/\s/.test((KEY||"")+(SEC||""))?" و فاصلهٔ اضافه دارد":""}.`;
  if(st.message!==msg)st.log=[{t:Date.now(),m:msg},...(st.log||[])].slice(0,30);st.status="error";st.message=msg;st.lastRun=Date.now();
  save(st,readJ(TR_F,[]));process.exitCode=0;});
