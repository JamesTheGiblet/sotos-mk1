#!/usr/bin/env node
'use strict';

/**
 * SMART DISCOVERY ENGINE v1
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 1 — Grid seeds population from known signals
 * Phase 2 — GA evolves population (annealing mutation, elite + injection)
 * Phase 3 — Latency search on finalists
 * Phase 4 — Monte Carlo on trade outcomes (not candle shuffles)
 * Phase 5 — Cross-asset summary
 *
 * Key differences from genetic_discovery_v2:
 *  - Fitness = avgExpectancy across 3 periods (NOT expectancy * sqrt(trades))
 *  - Walk-forward 3-period split (train/test/validate) — GA sees all 3
 *  - Overfit penalty: if train >> test+validate avg, score drops
 *  - MC shuffles trade outcomes, not candle blocks
 *  - Deduplication before saving
 *  - State phase engine with evolvable weights
 *  - Trailing stop as chromosome gene
 *  - AND / OR / SEQUENCE signal stacking
 *
 * MODES: --quick (50/20) --standard (100/50) --deep (200/100) --overnight (500/200)
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.env.HOME, 'kraken-intelligence/data/intelligence.db');
const OUT_DIR = path.join(__dirname, '../strategies/smart');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ── Config ────────────────────────────────────────────────────────────────────
const MODES = {
  '--quick':     { pop: 50,  gens: 20  },
  '--standard':  { pop: 100, gens: 50  },
  '--deep':      { pop: 200, gens: 100 },
  '--overnight': { pop: 500, gens: 200 }
};
const COSTS            = { entry: 0.0015, exit: 0.0015 };
const MIN_T            = { train: 5, test: 3, val: 3 };
const MC_RUNS          = 1000;
const MC_MIN           = 60;      // % of MC runs must be profitable
const ELITE_PCT        = 0.10;
const INJECT_PCT       = 0.05;
const CONV_GENS        = 10;
const CONV_DELTA       = 0.005;

// ── Math helpers ──────────────────────────────────────────────────────────────
function pick(a)         { return a[Math.floor(Math.random() * a.length)]; }
function mean(a)         { return a.length ? a.reduce((s,v)=>s+v,0)/a.length : 0; }
function stddev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s,v)=>s+Math.pow(v-m,2),0)/a.length);
}
function sharpeR(a)      { const sd = stddev(a); return sd===0 ? 0 : mean(a)/sd; }
function shuffle(a) {
  const b = a.slice();
  for (let i=b.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [b[i],b[j]]=[b[j],b[i]]; }
  return b;
}
function snap(v, arr)    { return arr.reduce((p,c)=>Math.abs(c-v)<Math.abs(p-v)?c:p); }
function cloneDeep(o)    { return JSON.parse(JSON.stringify(o)); }

// ── Indicator library ─────────────────────────────────────────────────────────
const SIG_TYPES = [
  'consecutive_red','consecutive_green',
  'price_drop','price_surge',
  'rsi_oversold','rsi_overbought',
  'volume_spike','atr_low','atr_high',
  'ma_distance_below','ma_distance_above',
  'candle_body_ratio','bb_squeeze','state_phase'
];

const SIG_RANGES = {
  consecutive_red:   { count:      [2,3,4,5,6] },
  consecutive_green: { count:      [2,3,4,5,6] },
  price_drop:        { dropPct:    [1,2,3,4,5,6,7,8,10] },
  price_surge:       { surgePct:   [1,2,3,4,5,6,7,8,10] },
  rsi_oversold:      { period:     [7,14,21], threshold: [20,25,30,35] },
  rsi_overbought:    { period:     [7,14,21], threshold: [65,70,75,80] },
  volume_spike:      { period:     [10,20,30], multiplier: [1.5,2.0,2.5,3.0] },
  atr_low:           { period:     [7,14,21], pctOfPrice: [0.5,1.0,1.5,2.0] },
  atr_high:          { period:     [7,14,21], pctOfPrice: [2.0,3.0,4.0,5.0] },
  ma_distance_below: { period:     [20,50,100,200], pct: [2,5,8,10,15] },
  ma_distance_above: { period:     [20,50,100,200], pct: [2,5,8,10,15] },
  candle_body_ratio: { minRatio:   [0.3,0.5,0.7], direction: ['bearish','bullish'] },
  bb_squeeze:        { period:     [14,20], threshold: [0.02,0.03,0.05] },
  state_phase:       { phase:      ['accumulation','markup','distribution','markdown','capitulation'] }
};

const EXIT_T  = [0.5,1,1.5,2,2.5,3,4,5];
const EXIT_S  = [0.5,0.75,1,1.5,2,2.5];
const EXIT_H  = [2,3,5,7,10,14];
const TRAIL_P = [0.5,0.75,1.0,1.5,2.0];
const TIMINGS = ['trigger_close','next_open','next_close'];
const LOGICS  = ['AND','OR','SEQUENCE'];

// ── Default phase weights (GA seed — evolved per asset) ───────────────────────
const DEFAULT_PW = {
  accum:  { atrMax:1.5, atrW:1, volMax:0.8, volW:1, maDistMax:3, maW:1 },
  markup: { minGreens:3, greenW:1, maBullMin:2, maW:1, atrMin:1.0, atrW:0.5 },
  dist:   { maBullMin:5, maW:1, volMin:1.3, volW:1, rsiMin:60, rsiW:1 },
  mark:   { minReds:3, redW:1, maDistMax:-2, maW:1, rsiMax:45, rsiW:1 },
  cap:    { rsiMax:30, rsiW:2, volMin:1.5, volW:1, atrMin:2.0, atrW:1, maDistMax:-5, maW:1 }
};

// ── Indicator calculations ────────────────────────────────────────────────────
function calcRSI(cs, i, p) {
  if (i < p) return null;
  let g=0, l=0;
  for (let j=i-p+1;j<=i;j++) { const d=cs[j].close-cs[j-1].close; if(d>0) g+=d; else l-=d; }
  const ag=g/p, al=l/p;
  if (al===0) return 100;
  return 100-(100/(1+ag/al));
}

function calcATR(cs, i, p) {
  if (i < p) return null;
  let s=0;
  for (let j=i-p+1;j<=i;j++) {
    s+=Math.max(cs[j].high-cs[j].low, Math.abs(cs[j].high-cs[j-1].close), Math.abs(cs[j].low-cs[j-1].close));
  }
  return s/p;
}

function calcMA(cs, i, p) {
  if (i < p-1) return null;
  let s=0; for (let j=i-p+1;j<=i;j++) s+=cs[j].close; return s/p;
}

function calcVolAvg(cs, i, p) {
  if (i < p) return null;
  let s=0; for (let j=i-p;j<i;j++) s+=cs[j].volume; return s/p;
}

function calcBBW(cs, i, p) {
  if (i < p) return null;
  const pr=[]; for (let j=i-p;j<=i;j++) pr.push(cs[j].close);
  const m=mean(pr), sd=stddev(pr);
  return m>0 ? (sd*2)/m : null;
}

// ── State phase detection ─────────────────────────────────────────────────────
function detectPhase(cs, i, pw) {
  if (i < 20) return 'unknown';
  const w = pw || DEFAULT_PW;
  const rsi = calcRSI(cs,i,14), atr=calcATR(cs,i,14), ma20=calcMA(cs,i,20), va=calcVolAvg(cs,i,20);
  if (rsi===null||atr===null||ma20===null||va===null) return 'unknown';
  const price=cs[i].close, atrP=(atr/price)*100, maDist=((price-ma20)/ma20)*100, vr=cs[i].volume/va;
  let reds=0, greens=0;
  for (let j=i-4;j<=i;j++) { if(cs[j].close<cs[j].open) reds++; else greens++; }
  const sc = {
    accumulation: (atrP<w.accum.atrMax?1:0)*w.accum.atrW + (vr<w.accum.volMax?1:0)*w.accum.volW + (Math.abs(maDist)<w.accum.maDistMax?1:0)*w.accum.maW,
    markup:       (greens>=w.markup.minGreens?1:0)*w.markup.greenW + (maDist>w.markup.maBullMin?1:0)*w.markup.maW + (atrP>w.markup.atrMin?1:0)*w.markup.atrW,
    distribution: (maDist>w.dist.maBullMin?1:0)*w.dist.maW + (vr>w.dist.volMin?1:0)*w.dist.volW + (rsi>w.dist.rsiMin?1:0)*w.dist.rsiW,
    markdown:     (reds>=w.mark.minReds?1:0)*w.mark.redW + (maDist<w.mark.maDistMax?1:0)*w.mark.maW + (rsi<w.mark.rsiMax?1:0)*w.mark.rsiW,
    capitulation: (rsi<w.cap.rsiMax?1:0)*w.cap.rsiW + (vr>w.cap.volMin?1:0)*w.cap.volW + (atrP>w.cap.atrMin?1:0)*w.cap.atrW + (maDist<w.cap.maDistMax?1:0)*w.cap.maW
  };
  let best='unknown', bs=0, ks=Object.keys(sc);
  for (let ki=0;ki<ks.length;ki++) { if(sc[ks[ki]]>bs){bs=sc[ks[ki]];best=ks[ki];} }
  return bs>0 ? best : 'unknown';
}

// ── Signal evaluation ─────────────────────────────────────────────────────────
function evalSig(cs, i, sig, st, pw) {
  const c=cs[i], p=sig.params;
  switch(sig.type) {
    case 'consecutive_red':    return st.cRed >= p.count;
    case 'consecutive_green':  return st.cGreen >= p.count;
    case 'price_drop':         return (c.open-c.close)/c.open*100 >= p.dropPct;
    case 'price_surge':        return (c.close-c.open)/c.open*100 >= p.surgePct;
    case 'rsi_oversold':       { const r=calcRSI(cs,i,p.period); return r!==null && r<p.threshold; }
    case 'rsi_overbought':     { const r=calcRSI(cs,i,p.period); return r!==null && r>p.threshold; }
    case 'volume_spike':       { const va=calcVolAvg(cs,i,p.period); return va!==null && c.volume>va*p.multiplier; }
    case 'atr_low':            { const a=calcATR(cs,i,p.period); return a!==null && (a/c.close*100)<p.pctOfPrice; }
    case 'atr_high':           { const a=calcATR(cs,i,p.period); return a!==null && (a/c.close*100)>p.pctOfPrice; }
    case 'ma_distance_below':  { const m=calcMA(cs,i,p.period); return m!==null && ((c.close-m)/m*100)<-p.pct; }
    case 'ma_distance_above':  { const m=calcMA(cs,i,p.period); return m!==null && ((c.close-m)/m*100)>p.pct; }
    case 'candle_body_ratio':  { const b=Math.abs(c.close-c.open), rng=c.high-c.low; if(rng===0||b/rng<p.minRatio) return false; return p.direction==='bearish'?c.close<c.open:c.close>c.open; }
    case 'bb_squeeze':         { const w=calcBBW(cs,i,p.period); return w!==null && w<p.threshold; }
    case 'state_phase':        return detectPhase(cs,i,pw)===p.phase;
    default: return false;
  }
}

function evalEntry(cs, i, chr, st, pw) {
  const sigs=chr.entrySignals, lg=chr.logic;
  if (!sigs||sigs.length===0) return false;
  if (lg==='OR')  { for(let si=0;si<sigs.length;si++){if(evalSig(cs,i,sigs[si],st,pw))return true;} return false; }
  if (lg==='SEQUENCE') {
    if (!evalSig(cs,i,sigs[sigs.length-1],st,pw)) return false;
    const win=chr.seqWin||5;
    for (let si=0;si<sigs.length-1;si++) {
      let fired=false;
      for (let j=Math.max(0,i-win);j<i;j++) { if(evalSig(cs,j,sigs[si],st,pw)){fired=true;break;} }
      if (!fired) return false;
    }
    return true;
  }
  // AND
  for (let si=0;si<sigs.length;si++) { if(!evalSig(cs,i,sigs[si],st,pw)) return false; }
  return true;
}

// ── Backtest ──────────────────────────────────────────────────────────────────
function backtest(cs, chr) {
  let capital=100, pos=null, pending=null, hw=0, trades=[];
  const st={cRed:0,cGreen:0};
  const pw=chr.phaseWeights||DEFAULT_PW;

  for (let i=30;i<cs.length;i++) {
    const c=cs[i];
    if (c.close<c.open){st.cRed++;st.cGreen=0;}else{st.cGreen++;st.cRed=0;}

    // Resolve deferred entry
    if (pending && !pos) {
      const ep=pending.t==='next_open'?c.open:c.close;
      capital-=capital*COSTS.entry;
      pos={ep:ep,ei:i,sz:capital};
      hw=ep; pending=null;
    }

    // New entry
    if (!pos && !pending && evalEntry(cs,i,chr,st,pw)) {
      const tm=chr.entryTiming||'trigger_close';
      if (tm==='trigger_close') {
        capital-=capital*COSTS.entry;
        pos={ep:c.close,ei:i,sz:capital}; hw=c.close;
      } else { pending={t:tm}; }
    }

    // Manage position
    if (pos) {
      if (c.close>hw) hw=c.close;
      const pnl=(c.close-pos.ep)/pos.ep*100;
      const hd=i-pos.ei;
      let trail=false;
      if (chr.trailingStop && chr.trailingPct && pnl>0) {
        if ((hw-c.close)/hw*100 >= chr.trailingPct) trail=true;
      }
      if (pnl>=chr.targetPct || pnl<=-chr.stopPct || hd>=chr.maxHoldDays || trail) {
        const gross=pos.sz*(pnl/100), ec=pos.sz*COSTS.exit;
        capital+=gross-ec;
        const net=((gross-ec)/pos.sz)*100;
        trades.push({win:net>0, pnl:net, hd:hd, exit:pnl>=chr.targetPct?'target':trail?'trail':pnl<=-chr.stopPct?'stop':'timeout'});
        pos=null; hw=0;
      }
    }
  }

  const n=trades.length;
  if (n===0) return {trades:0,wr:0,exp:0,ret:0,aw:0,al:0,sh:0};
  const wins=trades.filter(t=>t.win), losses=trades.filter(t=>!t.win);
  const wr=wins.length/n*100, lr=1-wr/100;
  const aw=wins.length?mean(wins.map(t=>t.pnl)):0;
  const al=losses.length?Math.abs(mean(losses.map(t=>t.pnl))):0;
  const exp=(wr/100*aw)-(lr*al);
  return {
    trades:n, wr:+wr.toFixed(2), exp:+exp.toFixed(3),
    ret:+((capital-100)/100*100).toFixed(2),
    aw:+aw.toFixed(3), al:+al.toFixed(3),
    sh:+sharpeR(trades.map(t=>t.pnl)).toFixed(3),
    rawTrades:trades
  };
}

// ── Fitness ── (avgExpectancy across periods, not expectancy*sqrt(trades)) ────
function calcFitness(tr, te, va) {
  if (tr.trades<MIN_T.train||te.trades<MIN_T.test||va.trades<MIN_T.val) return -Infinity;
  if (tr.exp<=0||te.exp<=0||va.exp<=0) return -Infinity;
  const avgE=(tr.exp+te.exp+va.exp)/3;
  const avgS=(tr.sh+te.sh+va.sh)/3;
  const cons=((tr.exp>0?1:0)+(te.exp>0?1:0)+(va.exp>0?1:0))/3;
  const deg=tr.exp>0?Math.max(0,(tr.exp-va.exp)/tr.exp):0;
  const oos=(te.exp+va.exp)/2;
  const ofit=(tr.exp>0 && oos>0)?Math.max(0,(tr.exp/oos)-3):0;
  return avgE*1.0 + cons*0.5 + deg*(-0.8) + ofit*(-1.0) + avgS*0.2;
}

// ── Monte Carlo (shuffles trade outcomes, not candle blocks) ──────────────────
function monteCarlo(rawTrades, runs) {
  if (rawTrades.length<3) return 0;
  let profit=0;
  for (let r=0;r<runs;r++) {
    const sh=shuffle(rawTrades);
    let cap=100;
    for (let ti=0;ti<sh.length;ti++) cap+=cap*(sh[ti].pnl/100);
    if (cap>100) profit++;
  }
  return (profit/runs)*100;
}

// ── Chromosome factory ────────────────────────────────────────────────────────
function randSig() {
  const type=pick(SIG_TYPES), ranges=SIG_RANGES[type], params={}, keys=Object.keys(ranges);
  for (let ki=0;ki<keys.length;ki++) params[keys[ki]]=pick(ranges[keys[ki]]);
  return {type:type,params:params};
}

function randChr() {
  const n=Math.floor(Math.random()*3)+1, sigs=[];
  for(let i=0;i<n;i++) sigs.push(randSig());
  const lg=n>1?pick(LOGICS):'AND';
  let tgt=pick(EXIT_T), stp=pick(EXIT_S);
  if (stp>=tgt) stp=tgt*0.5;
  const trail=Math.random()<0.5;
  return {
    entrySignals:sigs, logic:lg, seqWin:pick([3,5,7,10]),
    entryTiming:pick(TIMINGS), targetPct:tgt, stopPct:stp,
    trailingStop:trail, trailingPct:trail?pick(TRAIL_P):0,
    maxHoldDays:pick(EXIT_H), phaseWeights:cloneDeep(DEFAULT_PW)
  };
}

// ── GA operators ──────────────────────────────────────────────────────────────
function crossover(a, b) {
  const c=cloneDeep(a);
  if(Math.random()<0.5){c.entrySignals=cloneDeep(b.entrySignals);c.logic=b.logic;}
  if(Math.random()<0.5){c.targetPct=b.targetPct;c.stopPct=b.stopPct;c.maxHoldDays=b.maxHoldDays;c.trailingStop=b.trailingStop;c.trailingPct=b.trailingPct;}
  if(Math.random()<0.3) c.entryTiming=b.entryTiming;
  if(Math.random()<0.3) c.phaseWeights=cloneDeep(b.phaseWeights);
  return c;
}

function mutate(chr, rate) {
  const c=cloneDeep(chr);
  if(Math.random()<0.4){c.targetPct=snap(c.targetPct*(1+(Math.random()*2-1)*rate),EXIT_T);c.stopPct=snap(c.stopPct*(1+(Math.random()*2-1)*rate),EXIT_S);if(c.stopPct>=c.targetPct)c.stopPct=c.targetPct*0.5;}
  if(Math.random()<0.3) c.maxHoldDays=snap(c.maxHoldDays*(1+(Math.random()*2-1)*rate),EXIT_H);
  if(Math.random()<0.2){c.trailingStop=!c.trailingStop;c.trailingPct=c.trailingStop?pick(TRAIL_P):0;}
  if(Math.random()<0.2) c.entryTiming=pick(TIMINGS);
  if(Math.random()<0.3 && c.entrySignals.length>0){
    const si=Math.floor(Math.random()*c.entrySignals.length);
    const sig=c.entrySignals[si];
    const ranges=SIG_RANGES[sig.type],keys=Object.keys(ranges);
    if(keys.length>0){const k=pick(keys);sig.params[k]=pick(ranges[k]);}
  }
  if(Math.random()<0.15) c.entrySignals[Math.floor(Math.random()*c.entrySignals.length)]=randSig();
  if(Math.random()<0.1){
    if(c.entrySignals.length<3){c.entrySignals.push(randSig());if(c.entrySignals.length>1)c.logic=pick(LOGICS);}
    else if(c.entrySignals.length>1) c.entrySignals.splice(Math.floor(Math.random()*c.entrySignals.length),1);
  }
  if(Math.random()<0.2){
    const pk=pick(Object.keys(c.phaseWeights));
    const ph=c.phaseWeights[pk];
    const wk=pick(Object.keys(ph));
    ph[wk]=Math.max(0.1,ph[wk]*(1+(Math.random()*2-1)*rate));
  }
  return c;
}

// ── Grid seed generator ───────────────────────────────────────────────────────
function getGridSeeds() {
  const seeds=[], targets=[0.5,1,1.5,2,2.5,3,4,5], stops=[0.5,0.75,1,1.5,2,2.5], holds=[2,3,5,7,10,14];
  const quickSigs=[
    {type:'consecutive_red',   params:{count:3}},
    {type:'consecutive_red',   params:{count:4}},
    {type:'rsi_oversold',      params:{period:14,threshold:30}},
    {type:'rsi_oversold',      params:{period:14,threshold:25}},
    {type:'price_drop',        params:{dropPct:3}},
    {type:'price_drop',        params:{dropPct:5}},
    {type:'volume_spike',      params:{period:20,multiplier:2.0}},
    {type:'ma_distance_below', params:{period:50,pct:5}},
    {type:'state_phase',       params:{phase:'capitulation'}},
    {type:'state_phase',       params:{phase:'accumulation'}}
  ];
  for(let si=0;si<quickSigs.length;si++){
    for(let ti=0;ti<targets.length;ti++){
      for(let sti=0;sti<stops.length;sti++){
        if(stops[sti]>=targets[ti]) continue;
        for(let hi=0;hi<holds.length;hi++){
          for(let tmi=0;tmi<TIMINGS.length;tmi++){
            for(let tri=0;tri<2;tri++){
              const trail=tri===1;
              seeds.push({
                entrySignals:[quickSigs[si]], logic:'AND', seqWin:5,
                entryTiming:TIMINGS[tmi], targetPct:targets[ti], stopPct:stops[sti],
                trailingStop:trail, trailingPct:trail?pick(TRAIL_P):0,
                maxHoldDays:holds[hi], phaseWeights:cloneDeep(DEFAULT_PW)
              });
            }
          }
        }
      }
    }
  }
  return seeds;
}

// ── Label ─────────────────────────────────────────────────────────────────────
function label(chr) {
  const sl=chr.entrySignals.map(s=>{
    const p=s.params;
    switch(s.type){
      case 'consecutive_red':    return p.count+'-red';
      case 'consecutive_green':  return p.count+'-green';
      case 'price_drop':         return 'drop>='+p.dropPct+'%';
      case 'price_surge':        return 'surge>='+p.surgePct+'%';
      case 'rsi_oversold':       return 'RSI('+p.period+')<'+p.threshold;
      case 'rsi_overbought':     return 'RSI('+p.period+')>'+p.threshold;
      case 'volume_spike':       return 'VOL('+p.period+')x'+p.multiplier;
      case 'atr_low':            return 'ATR-lo('+p.period+')<'+p.pctOfPrice+'%';
      case 'atr_high':           return 'ATR-hi('+p.period+')>'+p.pctOfPrice+'%';
      case 'ma_distance_below':  return 'MA'+p.period+'-'+p.pct+'%below';
      case 'ma_distance_above':  return 'MA'+p.period+'+'+p.pct+'%above';
      case 'candle_body_ratio':  return 'body>'+p.minRatio+'('+p.direction+')';
      case 'bb_squeeze':         return 'BBsq('+p.period+')<'+p.threshold;
      case 'state_phase':        return 'phase:'+p.phase;
      default: return s.type;
    }
  });
  const trail=chr.trailingStop?' trail:'+chr.trailingPct+'%':'';
  return sl.join(' '+chr.logic+' ')+' | '+chr.entryTiming+' | tgt:'+chr.targetPct+'% stp:'+chr.stopPct+'%'+trail+' hold:'+chr.maxHoldDays+'d';
}

// ── Deduplication ─────────────────────────────────────────────────────────────
function dedupe(results) {
  const seen=new Set(), out=[];
  for(let i=0;i<results.length;i++){
    const k=label(results[i].chromosome);
    if(!seen.has(k)){seen.add(k);out.push(results[i]);}
  }
  return out;
}

// ── Main discovery class ──────────────────────────────────────────────────────
function SD(mode){
  const cfg=MODES[mode]||MODES['--deep'];
  this.popSz=cfg.pop; this.gens=cfg.gens; this.mode=mode;
}

SD.prototype.getCandles=async function(pair){
  const SQL=await initSqlJs();
  const db=new SQL.Database(fs.readFileSync(DB_PATH));
  const res=db.exec('SELECT timestamp,open,high,low,close,volume FROM candles WHERE pair=? AND interval=? ORDER BY timestamp ASC',[pair,'1D']);
  db.close();
  if(!res.length) return [];
  const col=res[0].columns, vals=res[0].values;
  return vals.map(row=>{const c={};col.forEach((k,i)=>{c[k]=row[i];});return c;});
};

SD.prototype.split=function(cs){
  const sz=Math.floor(cs.length/3);
  return {train:cs.slice(0,sz), test:cs.slice(sz,sz*2), val:cs.slice(sz*2)};
};

SD.prototype.ev=function(chr,periods){
  const tr=backtest(periods.train,chr), te=backtest(periods.test,chr), va=backtest(periods.val,chr);
  return {chromosome:chr, train:tr, test:te, val:va, fitness:calcFitness(tr,te,va)};
};

SD.prototype.seed=function(periods){
  console.log('  Phase 1: Seeding from grid...');
  const survivors=[], seeds=getGridSeeds();
  for(let i=0;i<seeds.length;i++){
    const r=this.ev(seeds[i],periods);
    if(isFinite(r.fitness) && r.fitness>0) survivors.push(r);
  }
  survivors.sort((a,b)=>b.fitness-a.fitness);
  console.log('  Grid: '+seeds.length+' tested | '+survivors.length+' survivors');
  let pop=survivors.slice(0,this.popSz).map(r=>r.chromosome);
  while(pop.length<this.popSz) pop.push(randChr());
  return pop;
};

SD.prototype.evolve=function(pop,periods){
  console.log('  Phase 2: Evolving ('+this.gens+' gens, pop '+this.popSz+')...');
  let cur=pop, best=-Infinity, noImprove=0, finalEval=[];
  for(let gen=0;gen<this.gens;gen++){
    const evald=[];
    for(let pi=0;pi<cur.length;pi++) evald.push(this.ev(cur[pi],periods));
    evald.sort((a,b)=>b.fitness-a.fitness);
    const gb=evald[0].fitness;
    if(gb>best+Math.abs(best)*CONV_DELTA){best=gb;noImprove=0;}else noImprove++;
    const mRate=0.30*Math.pow(1-gen/this.gens,1.5)+0.05;
    if(gen%10===0 || gen===this.gens-1) console.log('    Gen '+(gen+1)+'/'+this.gens+' | best: '+(isFinite(gb)?gb.toFixed(3):'none')+' | mut: '+(mRate*100).toFixed(1)+'%'+(noImprove>=CONV_GENS?' [converging]':''));
    finalEval=evald;
    if(noImprove>=CONV_GENS && gen>20){console.log('  Converged at gen '+gen);break;}
    const en=Math.floor(this.popSz*ELITE_PCT), rn=Math.floor(this.popSz*INJECT_PCT);
    const next=evald.slice(0,en).map(r=>r.chromosome);
    const valid=evald.filter(r=>isFinite(r.fitness));
    const pool=valid.length>=2?valid.slice(0,Math.max(10,Math.floor(valid.length*0.3))):evald;
    while(next.length<this.popSz-rn){
      const a=pool[Math.floor(Math.random()*pool.length)].chromosome;
      const b=pool[Math.floor(Math.random()*pool.length)].chromosome;
      next.push(mutate(crossover(a,b),mRate));
    }
    for(let ri=0;ri<rn;ri++) next.push(randChr());
    cur=next;
  }
  return finalEval;
};

SD.prototype.latency=function(top,periods){
  console.log('  Phase 3: Latency search on top '+top.length+'...');
  const self=this, refined=[];
  for(let fi=0;fi<top.length;fi++){
    let best=top[fi];
    for(let ti=0;ti<TIMINGS.length;ti++){
      const v=cloneDeep(top[fi].chromosome); v.entryTiming=TIMINGS[ti];
      const r=self.ev(v,periods);
      if(isFinite(r.fitness) && r.fitness>best.fitness) best=r;
    }
    refined.push(best);
  }
  refined.sort((a,b)=>b.fitness-a.fitness);
  return refined;
};

SD.prototype.mc=function(top,allCs){
  console.log('  Phase 4: Monte Carlo ('+MC_RUNS+' runs)...');
  const validated=[];
  for(let fi=0;fi<top.length;fi++){
    const r=top[fi];
    const full=backtest(allCs,r.chromosome);
    const mcPct=monteCarlo(full.rawTrades,MC_RUNS);
    if(mcPct>=MC_MIN) validated.push(Object.assign({},r,{mcPct:mcPct}));
  }
  validated.sort((a,b)=>b.fitness-a.fitness);
  console.log('  MC passed: '+validated.length+'/'+top.length);
  return validated;
};

SD.prototype.discover=async function(pair){
  console.log('\n'+'='.repeat(70));
  console.log('SMART DISCOVERY v1 — '+pair+'  ['+this.mode+']');
  console.log('='.repeat(70));
  const allCs=await this.getCandles(pair);
  if(allCs.length<90){console.log('Not enough candles. Skipping.');return [];}
  const periods=this.split(allCs);
  const d=ts=>new Date(ts*1000).toISOString().slice(0,10);
  console.log('Candles: '+allCs.length);
  console.log('  TRAIN:    '+d(periods.train[0].timestamp)+' -> '+d(periods.train[periods.train.length-1].timestamp)+' ('+periods.train.length+')');
  console.log('  TEST:     '+d(periods.test[0].timestamp)+' -> '+d(periods.test[periods.test.length-1].timestamp)+' ('+periods.test.length+')');
  console.log('  VALIDATE: '+d(periods.val[0].timestamp)+' -> '+d(periods.val[periods.val.length-1].timestamp)+' ('+periods.val.length+')');
  console.log('');
  const seeds=this.seed(periods);
  const evolved=this.evolve(seeds,periods);
  const top20=evolved.filter(r=>isFinite(r.fitness)).slice(0,20);
  if(top20.length===0){console.log('No viable strategies found.');return [];}
  const refined=this.latency(top20,periods);
  const champs=dedupe(this.mc(refined,allCs));
  console.log('\nCHAMPIONS ('+champs.length+' unique, passed MC)');
  console.log('-'.repeat(70));
  champs.slice(0,10).forEach((r,idx)=>{
    console.log('\n'+(idx+1)+'. '+label(r.chromosome));
    console.log('   Fitness: '+r.fitness.toFixed(3)+'  MC: '+r.mcPct.toFixed(1)+'%');
    console.log('   Train:    '+String(r.train.trades).padStart(3)+' trades | WR:'+r.train.wr.toFixed(1).padStart(5)+'% | E:'+r.train.exp.toFixed(2).padStart(5)+' | R:'+r.train.ret.toFixed(1).padStart(6)+'% | Sh:'+r.train.sh.toFixed(2));
    console.log('   Test:     '+String(r.test.trades).padStart(3)+' trades | WR:'+r.test.wr.toFixed(1).padStart(5)+'% | E:'+r.test.exp.toFixed(2).padStart(5)+' | R:'+r.test.ret.toFixed(1).padStart(6)+'% | Sh:'+r.test.sh.toFixed(2));
    console.log('   Validate: '+String(r.val.trades).padStart(3)+' trades | WR:'+r.val.wr.toFixed(1).padStart(5)+'% | E:'+r.val.exp.toFixed(2).padStart(5)+' | R:'+r.val.ret.toFixed(1).padStart(6)+'% | Sh:'+r.val.sh.toFixed(2));
  });
  const outFile=path.join(OUT_DIR,'smart_'+pair.replace('/','_')+'.json');
  fs.writeFileSync(outFile,JSON.stringify(champs,null,2));
  console.log('\nSaved '+champs.length+' results -> '+outFile);
  return champs;
};

// ── Entry point ───────────────────────────────────────────────────────────────
(async function(){
  const args=process.argv.slice(2);
  const mode=args.find(a=>a.startsWith('--'))||'--deep';
  const pairs=args.filter(a=>!a.startsWith('--'));
  const targets=pairs.length?pairs:['BTC/USD'];
  const cfg=MODES[mode]||MODES['--deep'];
  console.log('\n'+'='.repeat(70));
  console.log('SMART DISCOVERY ENGINE v1');
  console.log('='.repeat(70));
  console.log('Mode: '+mode+' | Pop: '+cfg.pop+' | Gens: '+cfg.gens);
  console.log('Signals: '+SIG_TYPES.length+' types | Logic: AND/OR/SEQUENCE');
  console.log('MC: '+MC_RUNS+' trade-outcome shuffles | Min pass: '+MC_MIN+'%');
  console.log('Fitness: avgExpectancy/3periods - overfit penalty (not E*sqrt(T))');
  console.log('='.repeat(70));
  const engine=new SD(mode), all={};
  for(let pi=0;pi<targets.length;pi++) all[targets[pi]]=await engine.discover(targets[pi]);
  if(targets.length>1){
    console.log('\n'+'='.repeat(70));
    console.log('CROSS-ASSET SUMMARY');
    console.log('='.repeat(70));
    const lmap={};
    const pks=Object.keys(all);
    for(let pi=0;pi<pks.length;pi++){
      const res=all[pks[pi]];
      for(let ri=0;ri<Math.min(10,res.length);ri++){
        const lbl=label(res[ri].chromosome);
        if(!lmap[lbl]) lmap[lbl]=[];
        lmap[lbl].push({pair:pks[pi],fitness:res[ri].fitness,mc:res[ri].mcPct});
      }
    }
    const cross=Object.keys(lmap).filter(l=>lmap[l].length>1).sort((a,b)=>lmap[b].length-lmap[a].length);
    if(cross.length){
      console.log('\nStrategies surviving across multiple assets:');
      cross.forEach(lbl=>{
        const hits=lmap[lbl];
        console.log('  * '+lbl);
        console.log('    '+hits.map(h=>h.pair+'(fit:'+h.fitness.toFixed(2)+' mc:'+h.mc.toFixed(0)+'%)').join('  '));
      });
    } else {
      console.log('\nNo cross-asset survivors. Edges are asset-specific.');
    }
  }
  console.log('\nDone.\n');
})().catch(e=>{console.error('Fatal:',e.message,e.stack);process.exit(1);});
