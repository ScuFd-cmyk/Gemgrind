#!/usr/bin/env node
/* Gemgrind skill power probe (v6.1.2).
   Boots index.html in headless Chromium, and for every class × every skill × skill level × campaign stage casts the skill
   through the real cast() chain (all layers) at a training dummy, then reports damage against a plain skull match, against
   the balance harness' calibrated damage/turn and against the guardian's HP. Also replays AI moves on real boards to measure
   how often cascades arm the "next skill ×N" multiplier (P.cc).

   node tools/skill-probe.js                      summary to stdout
   node tools/skill-probe.js --json=out.json      also write every cast as a row
   options: --diff=2 (0 Story … 4 Grindmaster)  --conts=1,3,5,10,20,30,40,50  --levels=1,5,10  --mpt=3.9 (mana per turn
            into the skill's colours, for the damage/turn estimate)  --top=15
   Read-only on the save: runs in a throwaway browser context with ?debug=0, so the baked balance profile applies.
   Base numbers: no crits (Math.random pinned high), P.cc = 1, bare build (harness XP curve, rarity-2 gear, no forge/research/talents).
   Needs Playwright with Chromium (pre-installed in the cloud container). */
'use strict';
const fs=require('fs'),path=require('path'),http=require('http');
const ROOT=path.resolve(__dirname,'..');
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const m=a.match(/^--([^=]+)(?:=(.*))?$/);return m?[m[1],m[2]===undefined?true:m[2]]:[a,true]}));
let chromium;try{({chromium}=require('playwright'))}catch(e){console.error('Playwright is required: npm i -D playwright && npx playwright install chromium');process.exit(3)}
const list=(v,d)=>v?String(v).split(',').map(Number).filter(Number.isFinite):d;
const O={diff:Number(args.diff??2),conts:list(args.conts,[1,3,5,10,20,30,40,50]),levels:list(args.levels,[1,5,10]),mpt:Number(args.mpt||3.9),top:Number(args.top||15)};

const TYPES={'.html':'text/html','.js':'text/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml'};
const server=http.createServer((q,r)=>{const f=path.join(ROOT,decodeURIComponent(q.url.split('?')[0]));
 if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return}
 r.writeHead(200,{'content-type':TYPES[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r)});

/* runs inside the page, once per class */
function probeClass({cls,diff,conts,levels}){
 const g=GGBalance.run({diffs:[diff],nodes:'guardians',cls}).rows,pick=conts.map(c=>g[c-1]).filter(Boolean),out=[];
 const R0=Math.random;let seed=11;const R=()=>(seed=(seed*16807)%2147483647)/2147483647;
 window.GG_SIM=1;
 try{S.cls=cls;if(!S.c[cls])S.c[cls]={l:1,x:0,n:[]};
  for(const row of pick){const w=node(row.node);S.diff=diff;if(S.ng)S.ng.t=0;S.at=S.loc=row.node;S.k=w.g;const c=S.c[cls];c.l=row.heroLv;c.x=0;c.n=[];S.eq={};Math.random=R;
   for(const sl of SLOT4)S.eq[sl]=genItem(row.heroLv,sl,2,R);
   newEnemy();heal();const st=stat(),eHP=E.mx+Math.max(0,E.arm||0),eName=E.n;
   const skullT=st.atk*.8*3*st.skd*D().sk*st.dmg,           // one plain 3-skull match, no combo, no crit
         modelT=st.atk*.8*.94*1.3*st.skd*D().sk*st.dmg;     // GGBalance' calibrated whole-player damage/turn, no crit
   Math.random=()=>.999;                                     // no crits / procs: deterministic base numbers
   for(const id of avail(cls)){const k=SKL[id];if(!k)continue;const had=S.slv[id];
    for(const lv of levels){S.slv[id]=lv;
     Object.assign(E,{dead:false,mx:1e15,hp:1e15,arm:0,st:{burn:0,poison:0,frz:0,fi:0,stun:0,curse:0,sund:0}});E.n='Training Dummy';
     P.cc=1;P.hp=1;P.arm=0;P.m=[99,99,99,99,99,99];P.st={burn:0,poison:0};busy=false;dead=false;
     let err=null;try{cast(k,0)}catch(e){err=String(e)}       // damage/heal/armor land synchronously, before cast's first await
     const dmg=1e15-E.hp,co=cost(k,0),mana=Object.values(co).reduce((a,b)=>a+b,0);
     out.push({cls,id,eff:k[2],price:k[4]||0,rider:k[5]||null,lv,cont:row.cont,heroLv:row.heroLv,atk:Math.round(st.atk),hp:Math.round(st.hp),
      mana,colors:Object.keys(co).length,dmg:Math.round(dmg),heal:Math.round(Math.max(0,P.hp-1)),arm:Math.round(Math.max(0,P.arm)),eHP:Math.round(eHP),
      pctGuardian:+(100*dmg/eHP).toFixed(1),skullT:Math.round(skullT),modelT:Math.round(modelT),err})}
    if(had===undefined)delete S.slv[id];else S.slv[id]=had}
   E.n=eName}
 }finally{Math.random=R0;window.GG_SIM=0}
 return out}

/* runs inside the page: cascade depth per AI move with the game's own find()/refillGem() (specials not spawned) */
function cascades(){const R0=Math.random;let seed=5;Math.random=()=>(seed=(seed*16807)%2147483647)/2147483647;const hist={};let moves=0;
 try{for(let g=0;g<400;g++){newBoard();for(let t=0;t<25;t++){const mv=aiMove();if(!mv)break;const[a,b]=mv;[B[a],B[b]]=[B[b],B[a]];let combo=0;
   for(let guard=0;guard<80;guard++){const m=find();if(!m.size)break;combo++;m.forEach(i=>B[i]=-1);
    for(let x=0;x<N;x++){let w=N-1;for(let y=N-1;y>=0;y--){const s=y*N+x;if(B[s]>=0){if(w!=y){B[w*N+x]=B[s];B[s]=-1}w--}}for(;w>=0;w--)B[w*N+x]=refillGem()}}
   hist[combo]=(hist[combo]||0)+1;moves++}}}finally{Math.random=R0}
 return{moves,hist}}

function report(rows,casc){
 const OFF=new Set(['dmg','drain','shred','nova','envn','turn','bash','trap']),med=a=>{a=[...a].sort((x,y)=>x-y);return a.length?a[a.length>>1]:NaN};
 const gem=r=>(r.dmg/r.mana)/(r.skullT/3),dpt=r=>r.dmg/(r.mana/O.mpt+1),f=(x,n=2)=>Number.isFinite(x)?x.toFixed(n):'-';
 const lo=Math.min(...O.levels),hi=Math.max(...O.levels),L=[];
 L.push(`Skill probe · difficulty ${O.diff} · ${rows.length} casts · mana/turn ${O.mpt}`,'');
 L.push('"gem×" = damage per mana ÷ damage per skull gem (3-skull match). >1 means a mana gem is worth more than a skull gem.');
 L.push('"dpt×" = skill damage/turn (charge at mana/turn, then 1 turn to cast) ÷ harness calibrated whole-player damage/turn.','');
 L.push(`cont heroLv guardianHP skull3 model | med cast L${lo} L${hi} | %guardian med L${lo} L${hi} max L${hi} | gem× L${lo} L${hi} | dpt× L${lo} L${hi}`);
 for(const c of O.conts){const s=rows.filter(r=>r.cont==c&&OFF.has(r.eff));if(!s.length)continue;const w=s[0],a=s.filter(r=>r.lv==lo),b=s.filter(r=>r.lv==hi);
  L.push(`C${String(c).padEnd(3)} ${String(w.heroLv).padStart(5)} ${String(w.eHP).padStart(10)} ${String(w.skullT).padStart(6)} ${String(w.modelT).padStart(5)} | ${String(med(a.map(r=>r.dmg))).padStart(8)} ${String(med(b.map(r=>r.dmg))).padStart(8)} | ${f(med(a.map(r=>r.pctGuardian)),1).padStart(6)} ${f(med(b.map(r=>r.pctGuardian)),1).padStart(6)} ${f(Math.max(...b.map(r=>r.pctGuardian)),1).padStart(7)} | ${f(med(a.map(gem))).padStart(5)} ${f(med(b.map(gem))).padStart(5)} | ${f(med(a.map(dpt))/w.modelT).padStart(5)} ${f(med(b.map(dpt))/w.modelT).padStart(5)}`)}
 const mid=O.conts[Math.floor(O.conts.length/2)];
 L.push('',`Per class @C${mid}, skill Lv${hi}: median gem×, best skill`);
 for(const cl of [...new Set(rows.map(r=>r.cls))]){const s=rows.filter(r=>r.cont==mid&&r.lv==hi&&r.cls==cl&&OFF.has(r.eff));if(!s.length)continue;const b=s.reduce((a,r)=>gem(r)>gem(a)?r:a);
  L.push(`${cl.padEnd(8)} atk ${String(s[0].atk).padStart(5)} hp ${String(s[0].hp).padStart(6)} | med ${f(med(s.map(gem)))} | best ${b.id} ${f(gem(b))} (${b.dmg} dmg, ${b.mana} mana, ${b.pctGuardian}% guardian)`)}
 const t=rows.filter(r=>r.cont==mid&&r.lv==hi&&OFF.has(r.eff)).sort((a,b)=>gem(b)-gem(a)),seen=new Set(),u=t.filter(r=>!seen.has(r.id)&&seen.add(r.id));
 L.push('',`Top ${O.top} / bottom 8 by gem× @C${mid}, Lv${hi} (one row per skill)`);
 for(const r of [...u.slice(0,O.top),null,...u.slice(-8)])L.push(r?`${r.id.padEnd(20)} ${r.eff.padEnd(6)} ${String(r.mana).padStart(3)} mana ${r.colors}c  gem× ${f(gem(r)).padStart(6)}  ${String(r.pctGuardian).padStart(6)}% guardian  ${r.price}g${r.rider?'  '+JSON.stringify(r.rider):''}`:'  …');
 const x=rows.filter(r=>r.cont==mid&&OFF.has(r.eff));L.push('',`Skill level Lv${hi}/Lv${lo} damage: ×${f(med(x.filter(r=>r.lv==hi).map(r=>r.dmg))/med(x.filter(r=>r.lv==lo).map(r=>r.dmg)))}`);
 for(const e of['heal','arm']){const s=rows.filter(r=>r.cont==mid&&r.eff==e);if(!s.length)continue;L.push(`${e.padEnd(4)} @C${mid} median % max HP: `+O.levels.map(lv=>{const q=s.filter(r=>r.lv==lv);return 'Lv'+lv+' '+f(med(q.map(r=>100*(e=='heal'?r.heal:r.arm)/r.hp)),0)+'%'}).join(' · '))}
 const n=casc.moves,ge2=n-(casc.hist[1]||0);L.push('',`Cascade depth per AI move (${n} moves): `+Object.entries(casc.hist).map(([k,v])=>k+': '+f(100*v/n,1)+'%').join(' · ')+` → next-skill multiplier (P.cc) armed on ${f(100*ge2/n,1)}% of moves`);
 const bad=rows.filter(r=>r.err).length,zero=rows.filter(r=>OFF.has(r.eff)&&r.dmg<=0).length;if(bad||zero)L.push('',`⚠ ${bad} casts threw, ${zero} offensive casts dealt no damage`);
 return L.join('\n')}

(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/index.html?debug=0';
 const browser=await chromium.launch();let code=0;
 try{const page=await (await browser.newContext({viewport:{width:420,height:860}})).newPage();const errs=[];page.on('pageerror',e=>errs.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>typeof window.GGBalance=='object'&&typeof newGame=='function');
  await page.evaluate(()=>{newGame({name:'Probe',cr:'Warrior',hue:30,lg:0,av:CL.Warrior.i,look:AV.look({look:{}}),hh:0})});
  await page.waitForTimeout(1500);
  const classes=await page.evaluate(()=>Object.keys(CL)),rows=[];
  for(const cls of classes){rows.push(...await page.evaluate(probeClass,{cls,diff:O.diff,conts:O.conts,levels:O.levels}));process.stderr.write('.')}
  const casc=await page.evaluate(cascades);process.stderr.write('\n');
  console.log(report(rows,casc));
  if(args.json){fs.writeFileSync(path.resolve(String(args.json)),JSON.stringify({opts:O,rows,cascades:casc}));console.error('wrote '+args.json)}
  if(errs.length){console.warn('page errors:',errs.slice(0,5));code=1}
  if(rows.some(r=>r.err))code=1;
 }catch(e){console.error(e);code=1}finally{await browser.close();server.close()}
 process.exit(code)})();
