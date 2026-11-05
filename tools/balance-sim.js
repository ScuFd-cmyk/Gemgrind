#!/usr/bin/env node
/* Gemgrind balance harness CLI (audit W2).
   Boots index.html in headless Chromium with a fresh hero, runs window.GGBalance.run() (the game's own
   newEnemy / stat / heal / genItem code, see <script id="v606-balance-harness">), prints a summary and, by default,
   compares every number against tools/balance-baseline.json so a formula change can't slip through unnoticed.

   node tools/balance-sim.js                       run + compare with the baseline (exit 1 on drift)
   node tools/balance-sim.js --update-baseline     accept the current numbers as the new baseline
   node tools/balance-sim.js --targets=tools/balance-targets.json [--strict]   check design targets (exit 2 with --strict)
   options: --diffs=0,2,4  --nodes=sample|guardians|all  --build=bare|current  --cls=Warrior  --skulls=0.94  --enemySkulls=1.16  --sustain=1.16
            --combo=1.3  --enemyCombo=1.2  --gearRarity=2  --seed=7  --ng=0  --tol=0.005  --csv=out.csv  --json=out.json
   Needs Playwright with Chromium (npm i -D playwright && npx playwright install chromium). */
'use strict';
const fs=require('fs'),path=require('path'),http=require('http');
const ROOT=path.resolve(__dirname,'..');
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const m=a.match(/^--([^=]+)(?:=(.*))?$/);return m?[m[1],m[2]===undefined?true:m[2]]:[a,true]}));
let chromium;try{({chromium}=require('playwright'))}catch(e){console.error('Playwright is required: npm i -D playwright && npx playwright install chromium');process.exit(3)}

const opts={};
if(args.diffs)opts.diffs=String(args.diffs).split(',').map(Number);
for(const k of['nodes','build','cls'])if(args[k])opts[k]=String(args[k]);
for(const k of['skulls','enemySkulls','sustain','combo','enemyCombo','gearRarity','seed','ng'])if(args[k]!=null)opts[k]=Number(args[k]);
const BASE=path.resolve(ROOT,args.baseline||'tools/balance-baseline.json'),TOL=Number(args.tol||0.005);

const TYPES={'.html':'text/html','.js':'text/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'};
const server=http.createServer((q,r)=>{const f=path.join(ROOT,decodeURIComponent(q.url.split('?')[0]));
 if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return}
 r.writeHead(200,{'content-type':TYPES[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r)});

(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/index.html?debug=0';
 const browser=await chromium.launch();let code=0;
 try{
  const page=await (await browser.newContext({viewport:{width:420,height:860}})).newPage();const errs=[];page.on('pageerror',e=>errs.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>typeof window.GGBalance=='object'&&typeof newGame=='function');
  await page.evaluate(()=>{newGame({name:'Sim',cr:'Warrior',hue:30,lg:0,av:CL.Warrior.i,look:AV.look({look:{}}),hh:0})});
  await page.waitForTimeout(1500);
  const res=await page.evaluate(o=>GGBalance.run(o),opts);
  if(errs.length)console.warn('page errors:',errs.slice(0,5));
  const o=res.opts;
  console.log(`Gemgrind balance sim · build=${o.build} cls=${o.cls} nodes=${o.nodes} skulls/turn=${o.skulls} enemy skulls/turn=${o.enemySkulls} sustain=×${o.sustain} combo=${o.combo} enemyCombo=${o.enemyCombo} gear rarity=${o.gearRarity} seed=${o.seed} · ${res.rows.length} fights in ${res.ms} ms\n`);
  console.table(Object.fromEntries(Object.entries(res.summary).map(([k,s])=>[k,{'first loss':s.firstLoss||'none','first enrage wall':s.firstEnrageWall||'none','peak power needed':'×'+s.maxPowerNeeded.toFixed(2),'at':s.at}])));
  const G=res.rows.filter(r=>r.fight=='continent guardian'&&(r.cont==1||r.cont%5==0));
  {for(const d of [...new Set(G.map(r=>r.diff))]){console.log('\n'+d+' · continent guardians (every 5th)');
   console.table(G.filter(r=>r.diff==d).map(r=>({cont:r.cont,heroLv:r.heroLv,enemyLv:r.enemyLv,enemyHP:r.enemyHP,heroHP:r.heroHP,'kill in':r.turnsToKill,'survive':r.turnsSurvived,'enrage@':r.enrageTurn,win:r.win?'yes':'NO','power needed':'×'+r.powerNeeded.toFixed(2)})))}}
  if(args.csv){fs.writeFileSync(path.resolve(String(args.csv)),toCsv(res.rows));console.log('\nCSV → '+args.csv)}
  if(args.json){fs.writeFileSync(path.resolve(String(args.json)),JSON.stringify(res,null,1));console.log('JSON → '+args.json)}

  /* ---- baseline: every numeric field of every fight, matched by difficulty + node + fight ---- */
  const key=r=>r.diff+'|'+r.node+'|'+r.fight,snap={opts:o,rows:res.rows};
  if(args['update-baseline']){fs.writeFileSync(BASE,'{"opts":'+JSON.stringify(o)+',"rows":[\n'+res.rows.map(r=>JSON.stringify(r)).join(',\n')+'\n]}\n');/* one fight per line: git diffs show exactly which fights moved */console.log('\nBaseline updated → '+path.relative(ROOT,BASE))}
  else if(fs.existsSync(BASE)){const b=JSON.parse(fs.readFileSync(BASE,'utf8'));
   if(JSON.stringify(b.opts)!==JSON.stringify(o))console.log('\nBaseline was recorded with different options; pass the same options or --update-baseline.\n  baseline: '+JSON.stringify(b.opts)+'\n  now:      '+JSON.stringify(o));
   else{const old=new Map(b.rows.map(r=>[key(r),r])),drift=[];
    for(const r of res.rows){const p=old.get(key(r));if(!p){drift.push(key(r)+': new fight');continue}
     for(const k of Object.keys(r)){const a=p[k],v=r[k];if(typeof v=='number'&&typeof a=='number'){const rel=Math.abs(v-a)/Math.max(1e-9,Math.abs(a));if(rel>TOL)drift.push(`${key(r)} ${k}: ${a} → ${v} (${(rel*100).toFixed(1)}%)`)}else if(a!==v&&typeof v!='number')drift.push(`${key(r)} ${k}: ${a} → ${v}`)}}
    if(drift.length){code=1;console.log(`\n✗ Balance drift vs baseline (${drift.length} changes, tolerance ${(TOL*100).toFixed(1)}%):`);drift.slice(0,40).forEach(x=>console.log('  '+x));if(drift.length>40)console.log('  …');console.log('If intended: re-run with --update-baseline and commit tools/balance-baseline.json.')}
    else console.log('\n✓ No drift vs baseline ('+res.rows.length+' fights).')}}
  else console.log('\nNo baseline yet: run with --update-baseline to record one.');

  /* ---- design targets (optional) ---- */
  if(args.targets){const T=JSON.parse(fs.readFileSync(path.resolve(String(args.targets)),'utf8')),bad=[];
   for(const t of T.rules||[])for(const r of res.rows){if(t.diff&&t.diff!==r.diff)continue;if(t.fight&&t.fight!==r.fight)continue;if(t.fromCont&&r.cont<t.fromCont)continue;if(t.toCont&&r.cont>t.toCont)continue;
    if(t.maxPowerNeeded!=null&&r.powerNeeded>t.maxPowerNeeded)bad.push(`${r.diff} C${r.cont} ${r.fight}: power needed ×${r.powerNeeded} > ×${t.maxPowerNeeded}`+(t.why?` (${t.why})`:''));
    if(t.mustBeatEnrage&&r.beatsEnrage===false)bad.push(`${r.diff} C${r.cont} ${r.fight}: ${r.turnsToKill} turns to kill, enrage at ${r.enrageTurn}`+(t.why?` (${t.why})`:''))}
   if(bad.length){console.log(`\n✗ ${bad.length} target violation(s):`);bad.slice(0,40).forEach(x=>console.log('  '+x));if(args.strict&&!code)code=2}else console.log('\n✓ All design targets met.')}
 }finally{await browser.close();server.close()}
 process.exit(code)})().catch(e=>{console.error(e);process.exit(3)});

function toCsv(rows){if(!rows.length)return'';const k=Object.keys(rows[0]);return[k.join(',')].concat(rows.map(r=>k.map(x=>r[x]==null?'':String(r[x]).replace(/,/g,';')).join(','))).join('\n')+'\n'}
