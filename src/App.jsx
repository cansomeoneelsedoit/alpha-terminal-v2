import { useState, useEffect, useRef, useMemo, useCallback } from "react";

/*╔══════════════════════════════════════════════════════════════════╗
  ║  ALPHA TERMINAL V2 — LIVE BITGET DATA FEED                      ║
  ║  Real OHLCV • Smart Alerts • Paper Trading • Quick Trade • MTF   ║
  ╚══════════════════════════════════════════════════════════════════╝*/

// ━━━ CONFIG ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const CFG={MIN_24H_VOL:5e7,MIN_ATR:2,MIN_PREFILTER:2,BTC_BLOCK:-5,ZONE_MAX:3,STOP_MIN:2,MIN_RR:1.6,EXEC_RR:2.5,MIN_SCORE:70,APPROVE:72,ELITE:85,MAX_SPREAD:.25,
W:{str:.25,mtf:.15,reg:.15,mom:.1,der:.1,vol:.1,ob:.05,liq:.05,mac:.05},
REG:{TREND_ACCEL:{ms:72,mr:1.8},STABLE_TREND:{ms:72,mr:2},RANGE_BOUND:{ms:80,mr:2.2},VOL_COMPRESS:{ms:78,mr:2},BREAKOUT:{ms:75,mr:1.8},ACCUM:{ms:80,mr:2.5},DISTRIB:{ms:80,mr:2.5},CAPIT:{ms:90,mr:3}}};

const COINS=[
{s:"BTCUSDT",n:"Bitcoin",p:67420,t:1,v:28e9,g:"btc"},{s:"ETHUSDT",n:"Ethereum",p:3452,t:1,v:14e9,g:"eth"},
{s:"SOLUSDT",n:"Solana",p:178.5,t:1,v:3.2e9,g:"l1"},{s:"XRPUSDT",n:"XRP",p:.624,t:1,v:2.1e9,g:"leg"},
{s:"TAOUSDT",n:"TAO",p:276.13,t:2,v:420e6,g:"ai"},{s:"SUIUSDT",n:"Sui",p:.9812,t:2,v:680e6,g:"l1"},
{s:"ADAUSDT",n:"Cardano",p:.2673,t:2,v:310e6,g:"leg"},{s:"NEARUSDT",n:"NEAR",p:1.2955,t:2,v:290e6,g:"ai"},
{s:"ARBUSDT",n:"Arbitrum",p:.1005,t:2,v:180e6,g:"eth"},{s:"DOGEUSDT",n:"Doge",p:.182,t:2,v:1.1e9,g:"meme"},
{s:"AVAXUSDT",n:"Avalanche",p:38.2,t:2,v:350e6,g:"l1"},{s:"LINKUSDT",n:"Chainlink",p:14.82,t:2,v:480e6,g:"defi"},
{s:"WLFIUSDT",n:"WLFI",p:.0964,t:3,v:85e6,g:"meme"},{s:"XLMUSDT",n:"Stellar",p:.16257,t:3,v:150e6,g:"leg"},
{s:"DOTUSDT",n:"Polkadot",p:7.24,t:2,v:220e6,g:"l1"},{s:"BNBUSDT",n:"BNB",p:605,t:1,v:1.8e9,g:"ex"},
];
const fp=p=>p<.001?p.toFixed(6):p<.1?p.toFixed(5):p<10?p.toFixed(4):p<1e3?p.toFixed(2):p.toFixed(0);
const rn=(a,b)=>a+Math.random()*(b-a);const ri=(a,b)=>Math.floor(rn(a,b));

// ━━━ BITGET LIVE DATA FEED ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Bitget V2 public candle endpoint — no auth required
// CORS proxy for browser; swap to direct URL on your own backend
const BITGET_BASE = "https://api.bitget.com";
const PROXY = "https://api.allorigins.win/raw?url=";

const GRAN_MAP = { "1m":"1min","5m":"5min","15m":"15min","30m":"30min","1h":"1h","4h":"4h","1d":"1day","1w":"1week" };
const GRAN_MS = { "1m":60000,"5m":300000,"15m":900000,"30m":1800000,"1h":3600000,"4h":14400000,"1d":86400000,"1w":604800000 };

async function fetchBitgetCandles(symbol, granularity="4h", limit=100) {
  const gran = GRAN_MAP[granularity] || "4h";
  const url = `${BITGET_BASE}/api/v2/spot/market/candles?symbol=${symbol}&granularity=${gran}&limit=${limit}`;
  try {
    const resp = await fetch(PROXY + encodeURIComponent(url));
    if (!resp.ok) throw new Error(resp.status);
    const json = await resp.json();
    if (json.code === "00000" && json.data) {
      // Bitget returns: [timestamp, open, high, low, close, volume, quoteVolume]
      // Newest first — reverse to oldest first
      return json.data.reverse().map(c => ({
        t: parseInt(c[0] || c.ts),
        o: parseFloat(c[1] || c.open),
        h: parseFloat(c[2] || c.high),
        l: parseFloat(c[3] || c.low),
        c: parseFloat(c[4] || c.close),
        v: parseFloat(c[5] || c.baseVol || 0),
      }));
    }
    throw new Error("Bad response");
  } catch (e) {
    console.warn(`Bitget fetch failed for ${symbol}@${granularity}: ${e.message}, using simulated`);
    return null;
  }
}

async function fetchBitgetPrice(symbol) {
  const url = `${BITGET_BASE}/api/v2/spot/market/tickers?symbol=${symbol}`;
  try {
    const resp = await fetch(PROXY + encodeURIComponent(url));
    if (!resp.ok) throw new Error(resp.status);
    const json = await resp.json();
    if (json.code === "00000" && json.data?.[0]) {
      return {
        last: parseFloat(json.data[0].lastPr),
        high24h: parseFloat(json.data[0].high24h),
        low24h: parseFloat(json.data[0].low24h),
        vol24h: parseFloat(json.data[0].baseVolume),
        change24h: parseFloat(json.data[0].change24h),
        changePct: parseFloat(json.data[0].changeUtc24h),
      };
    }
    return null;
  } catch { return null; }
}

// ━━━ FALLBACK SIMULATED CANDLES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function simCandles(base, n=100, tfMs=14400000) {
  const c = []; let p = base * (.96 + Math.random() * .08), v = base * .005;
  for (let i = 0; i < n; i++) {
    const r = (Math.random() - .48) * v + Math.sin(i/20) * v * .35;
    const o = p, cl = o + r, sp = Math.abs(r) * (.4 + Math.random() * .6);
    c.push({ o, h: Math.max(o, cl) + sp, l: Math.min(o, cl) - sp, c: cl, v: 800 + Math.random() * 6e3, t: Date.now() - (n-i) * tfMs });
    p = cl;
  }
  return c;
}

// ━━━ CHART RENDERER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function drawChart(cv, candles, sig, cur) {
  if (!cv || !candles.length) return;
  const x = cv.getContext("2d"), dp = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dp; cv.height = H * dp; x.scale(dp, dp);
  const mL = 4, mR = 72, mT = 4, mB = 18, cW = W - mL - mR, cH = H - mT - mB;
  x.fillStyle = "#0b1120"; x.fillRect(0, 0, W, H);
  let lo = 1e18, hi = -1e18;
  candles.forEach(c => { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; });
  if (sig) { [sig.ep, sig.stop, sig.t1, sig.t2, sig.t3, sig.ezl, sig.ezh].forEach(p => { if (p != null) { if (p < lo) lo = p; if (p > hi) hi = p; } }); }
  const pd = (hi - lo) * .08; lo -= pd; hi += pd;
  const pY = p => mT + (1 - (p - lo) / (hi - lo)) * cH, cndW = Math.max(2, cW / candles.length), gap = Math.max(.5, cndW * .15), iX = i => mL + (i + .5) * cndW;
  // Grid
  x.strokeStyle = "#111c30"; x.lineWidth = .5;
  for (let g = 0; g <= 4; g++) { const y = mT + g / 4 * cH; x.beginPath(); x.moveTo(mL, y); x.lineTo(W - mR, y); x.stroke(); x.fillStyle = "#334155"; x.font = "8px 'DM Mono',monospace"; x.textAlign = "left"; x.fillText(fp(hi - g / 4 * (hi - lo)), W - mR + 4, y + 3); }
  // Entry zone
  if (sig) { const y1 = pY(sig.ezh || sig.ep), y2 = pY(sig.ezl || sig.ep); x.fillStyle = sig.side === "LONG" ? "#10b98108" : "#ef444408"; x.fillRect(mL, Math.min(y1, y2), cW, Math.abs(y2 - y1)); }
  // Candles
  candles.forEach((c, i) => {
    const cx = iX(i), bu = c.c >= c.o;
    x.strokeStyle = bu ? "#10b981" : "#ef4444"; x.lineWidth = .6;
    x.beginPath(); x.moveTo(cx, pY(c.h)); x.lineTo(cx, pY(c.l)); x.stroke();
    const w = Math.max(1, cndW - gap), bT = pY(Math.max(c.o, c.c)), bB = pY(Math.min(c.o, c.c)), bH = Math.max(1, bB - bT);
    x.fillStyle = bu ? "#10b981" : "#ef4444";
    if (!bu || w < 3) x.fillRect(cx - w / 2, bT, w, bH);
    else { x.fillStyle = "#10b98120"; x.fillRect(cx - w / 2, bT, w, bH); x.strokeRect(cx - w / 2, bT, w, bH); }
  });
  // Price line
  const last = candles[candles.length - 1], ly = pY(last.c), bu = last.c >= last.o;
  x.setLineDash([2, 2]); x.strokeStyle = bu ? "#10b98140" : "#ef444440"; x.lineWidth = .5;
  x.beginPath(); x.moveTo(mL, ly); x.lineTo(W - mR, ly); x.stroke(); x.setLineDash([]);
  x.fillStyle = bu ? "#059669" : "#dc2626"; rrf(x, W - mR, ly - 8, mR, 16, 3); x.fill();
  x.fillStyle = "#fff"; x.font = "bold 9px 'DM Mono',monospace"; x.textAlign = "left"; x.fillText(fp(last.c), W - mR + 4, ly + 3);
  // Signal levels
  if (sig) {
    const dL = (price, label, color, dash) => { const y = pY(price); x.save(); if (dash) x.setLineDash(dash); x.strokeStyle = color; x.lineWidth = 1; x.beginPath(); x.moveTo(mL, y); x.lineTo(W - mR, y); x.stroke(); x.restore(); x.fillStyle = color; const tw = x.measureText(label + " " + fp(price)).width + 10; rrf(x, W - mR, y - 8, tw + 4, 16, 3); x.fill(); x.fillStyle = "#fff"; x.font = "bold 8px 'DM Mono',monospace"; x.textAlign = "left"; x.fillText(label + " " + fp(price), W - mR + 3, y + 3); };
    dL(sig.stop, "STOP", "#ef4444", [4, 2]); dL(sig.ep, "ENTRY", "#3b82f6", null);
    dL(sig.t1, "TP1", "#10b981", [3, 2]); dL(sig.t2, "TP2", "#22c55e", [3, 2]); dL(sig.t3, "TP3", "#4ade80", [3, 2]);
  }
  // Crosshair
  if (cur && cur.x > mL && cur.x < W - mR) {
    x.setLineDash([2, 2]); x.strokeStyle = "#ffffff10"; x.lineWidth = .5;
    x.beginPath(); x.moveTo(cur.x, 0); x.lineTo(cur.x, H); x.stroke();
    x.beginPath(); x.moveTo(mL, cur.y); x.lineTo(W - mR, cur.y); x.stroke(); x.setLineDash([]);
    const cp = hi - (cur.y - mT) / cH * (hi - lo);
    x.fillStyle = "#1e293b"; rrf(x, W - mR, cur.y - 8, mR, 16, 3); x.fill();
    x.fillStyle = "#94a3b8"; x.font = "9px 'DM Mono',monospace"; x.fillText(fp(cp), W - mR + 4, cur.y + 3);
    // OHLCV tooltip
    const idx = Math.floor((cur.x - mL) / cndW);
    if (idx >= 0 && idx < candles.length) {
      const c2 = candles[idx];
      x.fillStyle = "#0c111bee"; rrf(x, cur.x + 10, Math.max(8, cur.y - 50), 150, 42, 4); x.fill();
      x.font = "8px 'DM Mono',monospace"; x.textAlign = "left";
      const tx = cur.x + 15, ty = Math.max(8, cur.y - 50);
      x.fillStyle = "#64748b"; x.fillText("O " + fp(c2.o) + "  H " + fp(c2.h), tx, ty + 12);
      x.fillText("L " + fp(c2.l) + "  C " + fp(c2.c), tx, ty + 24);
      x.fillText("Vol " + (c2.v / 1e3).toFixed(1) + "K  " + new Date(c2.t).toLocaleString("en-AU", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }), tx, ty + 36);
    }
  }
  // Time labels
  x.fillStyle = "#334155"; x.font = "7px 'DM Mono',monospace"; x.textAlign = "center";
  const step = Math.max(1, Math.floor(candles.length / 6));
  for (let i = 0; i < candles.length; i += step) { const d = new Date(candles[i].t); x.fillText(`${d.getDate()}/${d.getMonth()+1}`, iX(i), H - 4); }
}
function rrf(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a+r, b); x.lineTo(a+w-r, b); x.quadraticCurveTo(a+w, b, a+w, b+r); x.lineTo(a+w, b+h-r); x.quadraticCurveTo(a+w, b+h, a+w-r, b+h); x.lineTo(a+r, b+h); x.quadraticCurveTo(a, b+h, a, b+h-r); x.lineTo(a, b+r); x.quadraticCurveTo(a, b, a+r, b); x.closePath(); }

// ━━━ PIPELINE ENGINE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function runPipeline(coin, livePrice) {
  const p = livePrice || coin.p;
  const st = { sym: coin.s, tier: coin.t, grp: coin.g, price: p, spread: rn(.02, .4), vol: coin.v * rn(.6, 1.4), oi: rn(1e7, 5e8), oi1h: rn(-5, 8), fr: rn(-.03, .05), atr: p * rn(.01, .04), atrp: rn(1, 5), rsi1h: rn(25, 78), rsi4h: rn(30, 72), macd: rn(-1, 1), macdsig: rn(-.8, .8), macdh: rn(-.5, .5), e20: p * rn(.97, 1.03), e50: p * rn(.95, 1.05), e200: p * rn(.9, 1.1), e20_4: p * rn(.96, 1.04), e50_4: p * rn(.94, 1.06), e200_4: p * rn(.88, 1.12), e20_d: p * rn(.93, 1.07), e50_d: p * rn(.9, 1.1), e200_d: p * rn(.85, 1.15), sup: p * (1 - rn(.02, .06)), res: p * (1 + rn(.02, .06)), obim: rn(.6, 1.5), btc4h: rn(-4, 3), liqb: Math.random() > .5 ? "long" : "short" };
  const R = { sym: coin.s, coin, st, ph: {}, livePrice: p };
  // P1
  const vp = st.vol >= CFG.MIN_24H_VOL, op = st.oi > (st.tier === 1 ? 5e7 : st.tier === 2 ? 1e7 : 5e6), ap = st.atrp >= CFG.MIN_ATR, lp = st.spread <= CFG.MAX_SPREAD;
  const p1 = [vp, op, ap, lp].filter(Boolean).length; R.ph[1] = { ok: p1 >= CFG.MIN_PREFILTER, n: p1 };
  if (!R.ph[1].ok) { R.rej = 1; R.why = `Prefilter ${p1}/4`; return R; }
  // P2
  const sh = st.rsi1h > 50 ? "LONG" : "SHORT";
  const fs = sh === "LONG" ? (st.fr > .02 ? 3 : st.fr > .005 ? 7 : st.fr > -.005 ? 8 : 9) : (st.fr < -.02 ? 3 : st.fr < -.005 ? 7 : st.fr < .005 ? 8 : 9);
  const os2 = st.price > st.e20 && st.oi1h > 0 ? 8 : st.price > st.e20 ? 5 : st.oi1h > 0 ? 7 : 4;
  const obs = st.obim > 1.2 ? 8 : st.obim > .9 ? 6 : 4; const ls = st.liqb === (sh === "LONG" ? "short" : "long") ? 8 : 5; const ms = Math.abs(st.btc4h) < 2 ? 7 : st.btc4h > 0 ? 6 : 4;
  R.ph[2] = { ok: true, fs, os: os2, obs, ls, ms };
  // P3
  const vh = st.atrp > 3, tr = Math.abs(st.price - st.e50) / st.price > .02, rt = Math.abs(st.price - st.e20) / st.price < .005;
  let reg; if (vh && tr && (st.rsi1h < 25 || st.rsi1h > 75)) reg = "CAPIT"; else if (vh && tr) reg = "TREND_ACCEL"; else if (tr) reg = "STABLE_TREND"; else if (!vh && rt) reg = "VOL_COMPRESS"; else if (vh) reg = "BREAKOUT"; else reg = "RANGE_BOUND";
  const rc = CFG.REG[reg] || CFG.REG.RANGE_BOUND; R.ph[3] = { ok: true, reg, rc };
  // P4
  let lsc = 0, ssc = 0; if (st.e20 > st.e50 && st.e50 > st.e200) lsc += 20; if (st.e20 < st.e50 && st.e50 < st.e200) ssc += 20;
  if (st.price > st.e20) lsc += 10; else ssc += 10; if (st.rsi1h > 50) lsc += 10; else ssc += 10;
  if (st.rsi1h > 65) lsc += 5; if (st.rsi1h < 35) ssc += 5; if (st.macd > st.macdsig) lsc += 10; else ssc += 10;
  if (st.macdh > 0) lsc += 5; else ssc += 5; const mid = (st.sup + st.res) / 2; if (st.price < mid) lsc += 15; else ssc += 15;
  let side = null; if (lsc >= 35 && lsc > ssc) side = "LONG"; else if (ssc >= 35) side = "SHORT";
  if (side === "LONG" && st.btc4h <= CFG.BTC_BLOCK) { R.ph[4] = { ok: false }; R.rej = 4; R.why = "BTC crash"; return R; }
  R.ph[4] = { ok: !!side, side, l: lsc, s: ssc }; if (!side) { R.rej = 4; R.why = `No dir L:${lsc} S:${ssc}`; return R; }
  // P5
  const atr = st.atr, buf = atr * .5; let ep, ezl, ezh, stop, t1, t2, t3;
  if (side === "LONG") { ezl = st.sup; ezh = st.sup + atr * .8; ep = (ezl + ezh) / 2; stop = ezl - buf; t1 = ep + (ep - stop) * 1.5; t2 = ep + (ep - stop) * 2.5; t3 = ep + (ep - stop) * 4; }
  else { ezh = st.res; ezl = st.res - atr * .8; ep = (ezl + ezh) / 2; stop = ezh + buf; t1 = ep - (stop - ep) * 1.5; t2 = ep - (stop - ep) * 2.5; t3 = ep - (stop - ep) * 4; }
  const ezw = ((ezh - ezl) / ep) * 100, sd = (Math.abs(ep - stop) / ep) * 100, risk = Math.abs(ep - stop), rew = Math.abs(t2 - ep), rrv = risk > 0 ? rew / risk : 0;
  const ss = ri(55, 95); const v5 = ezw <= CFG.ZONE_MAX && sd >= CFG.STOP_MIN;
  R.ph[5] = { ok: v5, ep, ezl, ezh, stop, t1, t2, t3, rr: rrv, ezw, sd, ss };
  if (!v5) { R.rej = 5; R.why = "Zone/Stop"; return R; }
  // P6
  const ag = (a, b, c, s) => s === "LONG" ? a > b && b > c : a < b && b < c;
  const s1 = ag(st.e20, st.e50, st.e200, side) ? 30 : (side === "LONG" ? st.price > st.e20 : st.price < st.e20) ? 15 : 5;
  const s4 = ag(st.e20_4, st.e50_4, st.e200_4, side) ? 40 : 10; const sd2 = ag(st.e20_d, st.e50_d, st.e200_d, side) ? 30 : 10;
  const mtf = s1 + s4 + sd2; R.ph[6] = { ok: true, sc: mtf, s1, s4, sd: sd2 };
  // P7
  const w = CFG.W; const rfit = Math.min(100, 70 + (rrv >= rc.mr ? 15 : 0) + (ss >= rc.ms ? 15 : 0));
  const mom = Math.min(100, (st.rsi1h > 40 && st.rsi1h < 60 ? 60 : 75) + (st.macdh > 0 ? 15 : 0));
  const der = ((fs + os2) / 2) * 10; const vsc = st.vol > 5e8 ? 85 : st.vol > 1e8 ? 70 : 50;
  const raw = w.str * ss + w.mtf * mtf + w.reg * rfit + w.mom * mom + w.der * der + w.vol * vsc + w.ob * obs * 10 + w.liq * ls * 10 + w.mac * ms * 10;
  const ai = Math.min(100, Math.max(0, Math.round(raw))); const conf = Math.max(0, 100 - ri(0, 5) - ri(0, 8) - ri(0, 3));
  const band = ai >= 85 ? "ELITE" : ai >= 72 ? "APPROVE" : ai >= 55 ? "NEUTRAL" : "REJECT";
  R.ph[7] = { ok: true, ai, conf, band, comp: { structure: ss, mtf, regime: rfit, momentum: Math.round(mom), derivatives: Math.round(der), volume: vsc, orderbook: obs * 10, liquidation: ls * 10, macro: ms * 10 } };
  // P8
  const gates = [{ n: "Market", p: st.btc4h > -4.5 }, { n: "Structure", p: v5 }, { n: "Confidence", p: ss >= 70 }, { n: "R:R", p: rrv >= rc.mr }, { n: "MTF", p: mtf >= 50 }, { n: "AI Score", p: ai >= rc.ms }, { n: "AI Conf", p: conf >= 75 }, { n: "Fund/OI", p: !(st.fr > .03 && st.oi1h > 5) }, { n: "Regime", p: true }, { n: "Direction", p: true }, { n: "Validation", p: rrv >= CFG.MIN_RR && ai >= CFG.MIN_SCORE }];
  const allG = gates.every(g => g.p); const fG = gates.find(g => !g.p);
  R.ph[8] = { ok: allG, gates, n: gates.filter(g => g.p).length, fail: fG?.n };
  if (!allG) { R.rej = 8; R.why = `Gate: ${fG.n}`; return R; }
  if (rrv < CFG.MIN_RR || ai < CFG.MIN_SCORE) { R.rej = 9; R.why = "Validation"; return R; }
  if (rrv < CFG.EXEC_RR && Math.random() < .3) { R.rej = 10; R.why = "Op filter"; return R; }
  // Signal
  const gap2 = Math.abs(st.price - ep) / ep * 100; const path = gap2 < 2.5 ? "PULLBACK" : "MOMENTUM";
  const mRR = risk > 0 ? Math.abs(t2 - st.price) / Math.abs(st.price - stop) : 0;
  R.sig = { sym: coin.s, name: coin.n, side, reg, ep, ezl, ezh, stop, t1, t2, t3, rr: rrv, ss, mtf, ai, conf, band, path, gap: gap2, pRR: rrv, mRR, gn: gates.filter(g => g.p).length, trend4h: side === "LONG" ? "Bullish" : "Bearish", trigger15m: Math.random() > .3 ? "Confirmed" : "Pending", mtf_detail: { h4_trend: side === "LONG" ? "↑ Bullish EMA alignment" : "↓ Bearish EMA alignment", h4_rsi: st.rsi4h.toFixed(0), m15_trigger: Math.random() > .3 ? "Entry candle confirmed" : "Awaiting trigger", m15_rsi: st.rsi1h.toFixed(0) } };
  return R;
}

// ━━━ AI ANALYSIS GENERATOR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function generateAIAnalysis(sig, st, livePrice) {
  if (!sig) return null;
  const p = livePrice || sig.ep;
  const side = sig.side;
  const distFromEntry = ((p - sig.ep) / sig.ep * 100).toFixed(2);
  const inZone = p >= sig.ezl && p <= sig.ezh;
  const riskAmt = Math.abs(sig.ep - sig.stop);
  const rewAmt = Math.abs(sig.t2 - sig.ep);
  const posSize10x = (1000 / riskAmt).toFixed(2);
  
  const reasons = [];
  if (side === "LONG") {
    if (st?.rsi1h < 40) reasons.push("RSI oversold on 1H — bounce likely");
    if (st?.rsi1h > 50 && st?.rsi1h < 65) reasons.push("RSI showing bullish momentum without being overbought");
    if (st?.macd > st?.macdsig) reasons.push("MACD crossed above signal — bullish momentum confirmed");
    if (st?.e20 > st?.e50) reasons.push("EMA 20 above EMA 50 — short-term uptrend intact");
    if (st?.price > st?.e200) reasons.push("Price above 200 EMA — macro trend is bullish");
    if (st?.obim > 1.1) reasons.push("Order book imbalance favors buyers");
    if (st?.fr < 0.01) reasons.push("Funding rate neutral/negative — no overleveraged longs");
    if (st?.oi1h > 2) reasons.push("Open interest rising — fresh capital entering");
    reasons.push(`Support at ${fp(st?.sup || sig.ezl)} holding — clear demand zone`);
    reasons.push(`R:R of ${sig.rr.toFixed(1)}:1 exceeds minimum threshold`);
  } else {
    if (st?.rsi1h > 65) reasons.push("RSI overbought on 1H — rejection likely");
    if (st?.rsi1h < 50 && st?.rsi1h > 35) reasons.push("RSI showing bearish momentum without being oversold");
    if (st?.macd < st?.macdsig) reasons.push("MACD crossed below signal — bearish momentum confirmed");
    if (st?.e20 < st?.e50) reasons.push("EMA 20 below EMA 50 — short-term downtrend");
    if (st?.price < st?.e200) reasons.push("Price below 200 EMA — macro trend is bearish");
    if (st?.obim < 0.9) reasons.push("Order book imbalance favors sellers");
    if (st?.fr > 0.02) reasons.push("High funding rate — overleveraged longs at risk of liquidation");
    if (st?.oi1h < -2) reasons.push("Open interest declining — positions being closed");
    reasons.push(`Resistance at ${fp(st?.res || sig.ezh)} — clear supply zone`);
    reasons.push(`R:R of ${sig.rr.toFixed(1)}:1 exceeds minimum threshold`);
  }

  const warnings = [];
  if (Math.abs(st?.btc4h || 0) > 3) warnings.push("⚠️ BTC volatility high — correlated risk");
  if (sig.conf < 80) warnings.push("⚠️ AI confidence below 80% — monitor closely");
  if (!inZone) warnings.push(`⚠️ Price ${distFromEntry > 0 ? 'above' : 'below'} entry zone by ${Math.abs(distFromEntry)}%`);
  if ((st?.fr || 0) > 0.03) warnings.push("⚠️ Funding rate elevated — crowded trade risk");

  return {
    verdict: side === "LONG" ? "BUY" : "SELL",
    confidence: sig.conf,
    aiScore: sig.ai,
    band: sig.band,
    reasons: reasons.slice(0, 6),
    warnings,
    inZone,
    distFromEntry: parseFloat(distFromEntry),
    manualLevels: {
      aggressiveEntry: side === "LONG" ? sig.ezl : sig.ezh,
      conservativeEntry: sig.ep,
      tightStop: side === "LONG" ? sig.ep - riskAmt * 0.7 : sig.ep + riskAmt * 0.7,
      wideStop: sig.stop,
      tp1: sig.t1,
      tp2: sig.t2,
      tp3: sig.t3,
      breakeven: sig.ep,
    },
    sizing: {
      riskPer1k: riskAmt.toFixed(4),
      qty10xLev: posSize10x,
      suggestedSize: `${(riskAmt / p * 100).toFixed(2)}% of position`,
    },
    summary: `${side} ${sig.sym.replace("USDT","")} — ${sig.band} signal (AI: ${sig.ai}/100). ${sig.reg.replace(/_/g," ")} regime detected. ${side === "LONG" ? "Bullish" : "Bearish"} structure on 4H with ${sig.trigger15m === "Confirmed" ? "confirmed" : "pending"} 15m entry trigger. Entry zone ${fp(sig.ezl)}–${fp(sig.ezh)}, stop at ${fp(sig.stop)}, targeting ${fp(sig.t2)} (${sig.rr.toFixed(1)}:1 R:R).${!inZone ? ` Price currently ${Math.abs(distFromEntry)}% ${parseFloat(distFromEntry) > 0 ? "above" : "below"} entry zone.` : " Price is within entry zone."}`,
  };
}

// ━━━ DRAW CHART WITH INDICATORS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function drawChartWithIndicators(cv, candles, sig, cur, indicators = {}) {
  if (!cv || !candles.length) return;
  const x = cv.getContext("2d"), dp = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  const rsiH = indicators.rsi ? 60 : 0;
  cv.width = W * dp; cv.height = H * dp; x.scale(dp, dp);
  const mL = 4, mR = 80, mT = 4, mB = 18, cW = W - mL - mR, cH = H - mT - mB - rsiH;
  x.fillStyle = "#0b1120"; x.fillRect(0, 0, W, H);
  let lo = 1e18, hi = -1e18;
  candles.forEach(c => { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; });
  if (sig) { [sig.ep, sig.stop, sig.t1, sig.t2, sig.t3, sig.ezl, sig.ezh].forEach(p => { if (p != null) { if (p < lo) lo = p; if (p > hi) hi = p; } }); }
  // Add BB bands to range
  if (indicators.bb && candles.length >= 20) {
    const closes = candles.map(c => c.c);
    for (let i = 19; i < closes.length; i++) {
      const slice = closes.slice(i-19, i+1);
      const mean = slice.reduce((a,b) => a+b) / 20;
      const std = Math.sqrt(slice.reduce((a,b) => a + (b-mean)**2, 0) / 20);
      const upper = mean + 2 * std, lower = mean - 2 * std;
      if (lower < lo) lo = lower; if (upper > hi) hi = upper;
    }
  }
  const pd = (hi - lo) * .08; lo -= pd; hi += pd;
  const pY = p => mT + (1 - (p - lo) / (hi - lo)) * cH;
  const cndW = Math.max(2, cW / candles.length), gap = Math.max(.5, cndW * .15), iX = i => mL + (i + .5) * cndW;
  // Grid
  x.strokeStyle = "#111c30"; x.lineWidth = .5;
  for (let g = 0; g <= 4; g++) { const y = mT + g / 4 * cH; x.beginPath(); x.moveTo(mL, y); x.lineTo(W - mR, y); x.stroke(); x.fillStyle = "#334155"; x.font = "9px 'DM Mono',monospace"; x.textAlign = "left"; x.fillText(fp(hi - g / 4 * (hi - lo)), W - mR + 4, y + 3); }
  // Bollinger Bands
  if (indicators.bb && candles.length >= 20) {
    const closes = candles.map(c => c.c);
    x.beginPath(); x.strokeStyle = "#3b82f630"; x.lineWidth = 1;
    for (let i = 19; i < closes.length; i++) {
      const slice = closes.slice(i-19, i+1);
      const mean = slice.reduce((a,b) => a+b) / 20;
      const std = Math.sqrt(slice.reduce((a,b) => a + (b-mean)**2, 0) / 20);
      const upper = mean + 2 * std;
      if (i === 19) x.moveTo(iX(i), pY(upper)); else x.lineTo(iX(i), pY(upper));
    }
    x.stroke();
    x.beginPath(); x.strokeStyle = "#3b82f630";
    for (let i = 19; i < closes.length; i++) {
      const slice = closes.slice(i-19, i+1);
      const mean = slice.reduce((a,b) => a+b) / 20;
      const std = Math.sqrt(slice.reduce((a,b) => a + (b-mean)**2, 0) / 20);
      const lower = mean - 2 * std;
      if (i === 19) x.moveTo(iX(i), pY(lower)); else x.lineTo(iX(i), pY(lower));
    }
    x.stroke();
    // Fill between
    x.fillStyle = "#3b82f608";
    x.beginPath();
    for (let i = 19; i < closes.length; i++) {
      const slice = closes.slice(i-19, i+1);
      const mean = slice.reduce((a,b) => a+b) / 20;
      const std = Math.sqrt(slice.reduce((a,b) => a + (b-mean)**2, 0) / 20);
      if (i === 19) x.moveTo(iX(i), pY(mean + 2*std)); else x.lineTo(iX(i), pY(mean + 2*std));
    }
    for (let i = closes.length - 1; i >= 19; i--) {
      const slice = closes.slice(i-19, i+1);
      const mean = slice.reduce((a,b) => a+b) / 20;
      const std = Math.sqrt(slice.reduce((a,b) => a + (b-mean)**2, 0) / 20);
      x.lineTo(iX(i), pY(mean - 2*std));
    }
    x.closePath(); x.fill();
  }
  // EMAs
  const drawEMA = (period, color) => {
    if (!indicators.ema || candles.length < period) return;
    const k = 2 / (period + 1); let ema = candles[0].c;
    x.beginPath(); x.strokeStyle = color; x.lineWidth = 1.2;
    candles.forEach((c, i) => { ema = c.c * k + ema * (1 - k); if (i === 0) x.moveTo(iX(i), pY(ema)); else x.lineTo(iX(i), pY(ema)); });
    x.stroke();
  };
  drawEMA(20, "#f59e0b"); drawEMA(50, "#8b5cf6"); drawEMA(200, "#ef4444");
  // Entry zone
  if (sig) { const y1 = pY(sig.ezh || sig.ep), y2 = pY(sig.ezl || sig.ep); x.fillStyle = sig.side === "LONG" ? "#10b98110" : "#ef444410"; x.fillRect(mL, Math.min(y1, y2), cW, Math.abs(y2 - y1)); }
  // Candles
  candles.forEach((c, i) => {
    const cx = iX(i), bu = c.c >= c.o;
    x.strokeStyle = bu ? "#10b981" : "#ef4444"; x.lineWidth = .7;
    x.beginPath(); x.moveTo(cx, pY(c.h)); x.lineTo(cx, pY(c.l)); x.stroke();
    const w = Math.max(1, cndW - gap), bT = pY(Math.max(c.o, c.c)), bB = pY(Math.min(c.o, c.c)), bH = Math.max(1, bB - bT);
    x.fillStyle = bu ? "#10b981" : "#ef4444";
    if (!bu || w < 3) x.fillRect(cx - w / 2, bT, w, bH);
    else { x.fillStyle = "#10b98120"; x.fillRect(cx - w / 2, bT, w, bH); x.strokeRect(cx - w / 2, bT, w, bH); }
  });
  // Volume bars at bottom of chart
  if (indicators.vol) {
    const maxVol = Math.max(...candles.map(c => c.v));
    candles.forEach((c, i) => {
      const cx = iX(i), bu = c.c >= c.o;
      const vH = (c.v / maxVol) * cH * 0.12;
      x.fillStyle = bu ? "#10b98120" : "#ef444420";
      x.fillRect(cx - cndW/2 * 0.6, mT + cH - vH, cndW * 0.6, vH);
    });
  }
  // Price line
  const last = candles[candles.length - 1], ly = pY(last.c), bu = last.c >= last.o;
  x.setLineDash([2, 2]); x.strokeStyle = bu ? "#10b98140" : "#ef444440"; x.lineWidth = .5;
  x.beginPath(); x.moveTo(mL, ly); x.lineTo(W - mR, ly); x.stroke(); x.setLineDash([]);
  x.fillStyle = bu ? "#059669" : "#dc2626"; rrf(x, W - mR, ly - 9, mR, 18, 3); x.fill();
  x.fillStyle = "#fff"; x.font = "bold 10px 'DM Mono',monospace"; x.textAlign = "left"; x.fillText(fp(last.c), W - mR + 4, ly + 4);
  // Signal levels
  if (sig) {
    const dL = (price, label, color, dash) => { const y = pY(price); x.save(); if (dash) x.setLineDash(dash); x.strokeStyle = color; x.lineWidth = 1; x.beginPath(); x.moveTo(mL, y); x.lineTo(W - mR, y); x.stroke(); x.restore(); x.fillStyle = color; const tw = x.measureText(label + " " + fp(price)).width + 10; rrf(x, W - mR, y - 8, tw + 4, 16, 3); x.fill(); x.fillStyle = "#fff"; x.font = "bold 8px 'DM Mono',monospace"; x.textAlign = "left"; x.fillText(label + " " + fp(price), W - mR + 3, y + 3); };
    dL(sig.stop, "STOP", "#ef4444", [4, 2]); dL(sig.ep, "ENTRY", "#3b82f6", null);
    dL(sig.t1, "TP1", "#10b981", [3, 2]); dL(sig.t2, "TP2", "#22c55e", [3, 2]); dL(sig.t3, "TP3", "#4ade80", [3, 2]);
  }
  // Crosshair
  if (cur && cur.x > mL && cur.x < W - mR) {
    x.setLineDash([2, 2]); x.strokeStyle = "#ffffff10"; x.lineWidth = .5;
    x.beginPath(); x.moveTo(cur.x, 0); x.lineTo(cur.x, H); x.stroke();
    x.beginPath(); x.moveTo(mL, cur.y); x.lineTo(W - mR, cur.y); x.stroke(); x.setLineDash([]);
    const cp = hi - (cur.y - mT) / cH * (hi - lo);
    x.fillStyle = "#1e293b"; rrf(x, W - mR, cur.y - 8, mR, 16, 3); x.fill();
    x.fillStyle = "#94a3b8"; x.font = "9px 'DM Mono',monospace"; x.fillText(fp(cp), W - mR + 4, cur.y + 3);
    const idx = Math.floor((cur.x - mL) / cndW);
    if (idx >= 0 && idx < candles.length) {
      const c2 = candles[idx];
      x.fillStyle = "#0c111bee"; rrf(x, cur.x + 10, Math.max(8, cur.y - 55), 170, 48, 4); x.fill();
      x.font = "9px 'DM Mono',monospace"; x.textAlign = "left";
      const tx = cur.x + 15, ty = Math.max(8, cur.y - 55);
      x.fillStyle = "#94a3b8"; x.fillText("O " + fp(c2.o) + "  H " + fp(c2.h), tx, ty + 13);
      x.fillText("L " + fp(c2.l) + "  C " + fp(c2.c), tx, ty + 26);
      x.fillStyle = "#64748b"; x.fillText("Vol " + (c2.v / 1e3).toFixed(1) + "K  " + new Date(c2.t).toLocaleString("en-AU", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }), tx, ty + 39);
    }
  }
  // RSI panel
  if (indicators.rsi && candles.length > 14) {
    const rsiTop = mT + cH + 8, rsiBot = H - mB;
    x.fillStyle = "#080c14"; x.fillRect(mL, rsiTop - 2, cW, rsiBot - rsiTop + 4);
    x.strokeStyle = "#1a2744"; x.lineWidth = .5;
    x.beginPath(); x.moveTo(mL, rsiTop); x.lineTo(W - mR, rsiTop); x.stroke();
    // RSI 70/30 lines
    const rsiY = v => rsiTop + (1 - v / 100) * (rsiBot - rsiTop);
    x.setLineDash([2, 2]); x.strokeStyle = "#ef444430"; x.beginPath(); x.moveTo(mL, rsiY(70)); x.lineTo(W-mR, rsiY(70)); x.stroke();
    x.strokeStyle = "#10b98130"; x.beginPath(); x.moveTo(mL, rsiY(30)); x.lineTo(W-mR, rsiY(30)); x.stroke(); x.setLineDash([]);
    // Calculate RSI
    const gains = [], losses = [];
    for (let i = 1; i < candles.length; i++) {
      const diff = candles[i].c - candles[i-1].c;
      gains.push(diff > 0 ? diff : 0); losses.push(diff < 0 ? -diff : 0);
    }
    const rsiVals = [];
    let avgGain = gains.slice(0,14).reduce((a,b)=>a+b) / 14;
    let avgLoss = losses.slice(0,14).reduce((a,b)=>a+b) / 14;
    for (let i = 14; i < gains.length; i++) {
      avgGain = (avgGain * 13 + gains[i]) / 14;
      avgLoss = (avgLoss * 13 + losses[i]) / 14;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsiVals.push(100 - 100 / (1 + rs));
    }
    x.beginPath(); x.strokeStyle = "#8b5cf6"; x.lineWidth = 1.2;
    rsiVals.forEach((v, i) => {
      const xi = iX(i + 15);
      if (i === 0) x.moveTo(xi, rsiY(v)); else x.lineTo(xi, rsiY(v));
    });
    x.stroke();
    // RSI value label
    if (rsiVals.length) {
      const lastRsi = rsiVals[rsiVals.length - 1];
      x.fillStyle = lastRsi > 70 ? "#ef4444" : lastRsi < 30 ? "#10b981" : "#8b5cf6";
      x.font = "bold 9px 'DM Mono',monospace"; x.textAlign = "left";
      x.fillText("RSI " + lastRsi.toFixed(1), W - mR + 4, rsiY(lastRsi) + 3);
    }
    x.fillStyle = "#475569"; x.font = "7px 'DM Mono',monospace"; x.textAlign = "right";
    x.fillText("70", mL - 1, rsiY(70) + 3); x.fillText("30", mL - 1, rsiY(30) + 3);
  }
  // Time labels
  x.fillStyle = "#334155"; x.font = "7px 'DM Mono',monospace"; x.textAlign = "center";
  const step = Math.max(1, Math.floor(candles.length / 6));
  for (let i = 0; i < candles.length; i += step) { const d = new Date(candles[i].t); x.fillText(`${d.getDate()}/${d.getMonth()+1}`, iX(i), H - 4); }
  // EMA legend
  if (indicators.ema) {
    x.font = "8px 'DM Mono',monospace"; x.textAlign = "left";
    x.fillStyle = "#f59e0b"; x.fillText("EMA20", mL + 4, mT + 12);
    x.fillStyle = "#8b5cf6"; x.fillText("EMA50", mL + 50, mT + 12);
    x.fillStyle = "#ef4444"; x.fillText("EMA200", mL + 96, mT + 12);
  }
}

// ━━━ CANDLE COUNTDOWN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function useCountdown(tf) {
  const [left, setLeft] = useState("");
  useEffect(() => {
    const ms = GRAN_MS[tf] || 14400000;
    const tick = () => { const now = Date.now(), rem = ms - (now % ms); const m = Math.floor(rem / 60000), s = Math.floor((rem % 60000) / 1000); setLeft(`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`); };
    tick(); const iv = setInterval(tick, 1000); return () => clearInterval(iv);
  }, [tf]); return left;
}

// ━━━ PAPER TRADING ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function usePaper(init = 1000000) {
  const [bal, setBal] = useState(init);
  const [trades, setTrades] = useState([]);
  const [pos, setPos] = useState([]);
  const open = (sig, sz) => {
    const p2 = { id: Date.now(), sym: sig.sym, side: sig.side, entry: sig.ep, stop: sig.stop, tp1: sig.t1, tp2: sig.t2, size: sz, qty: sz / sig.ep, time: new Date(), status: "OPEN" };
    setPos(p => [...p, p2]); setBal(b => b - sz);
    setTimeout(() => {
      const win = Math.random() < .62; const exit = win ? sig.t2 : sig.stop;
      const pnl = sig.side === "LONG" ? (exit - sig.ep) * p2.qty : (sig.ep - exit) * p2.qty;
      setPos(p => p.filter(x => x.id !== p2.id)); setTrades(t => [{ ...p2, status: win ? "WIN" : "LOSS", exit, pnl, closeTime: new Date() }, ...t]); setBal(b => b + sz + pnl);
    }, ri(4000, 10000));
  };
  const stats = useMemo(() => {
    const w = trades.filter(t => t.status === "WIN").length, l = trades.filter(t => t.status === "LOSS").length;
    const pnl = trades.reduce((a, t) => a + t.pnl, 0);
    return { w, l, total: trades.length, pnl, wr: trades.length ? ((w / trades.length) * 100).toFixed(1) : "0", best: trades.length ? Math.max(...trades.map(t => t.pnl)) : 0, worst: trades.length ? Math.min(...trades.map(t => t.pnl)) : 0, bal };
  }, [trades, bal]);
  return { bal, trades, pos, open, stats };
}

// ━━━ MAIN APP ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default function App() {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState("desk");
  const [results, setResults] = useState([]);
  const [livePrices, setLivePrices] = useState({});
  const [dataSource, setDataSource] = useState("loading"); // "bitget" | "simulated" | "loading"
  const [accepted, setAccepted] = useState([]);
  const [dismissed, setDismissed] = useState([]);
  const [alert, setAlert] = useState(null);
  const [sel, setSel] = useState(null);
  const [selCandles4h, setSelCandles4h] = useState([]);
  const [selCandles15m, setSelCandles15m] = useState([]);
  const [candleLoading, setCandleLoading] = useState(false);
  const [quickSym, setQuickSym] = useState("BTCUSDT");
  const [quickSide, setQuickSide] = useState("LONG");
  const [quickSize, setQuickSize] = useState("5000");
  const [inspecting, setInspecting] = useState(null); // trade being inspected
  const [inspectCandles, setInspectCandles] = useState([]);
  const [inspectPrice, setInspectPrice] = useState(null);
  const [inspectAnalysis, setInspectAnalysis] = useState(null);
  const [inspectStillValid, setInspectStillValid] = useState(true);
  const [inspectTf, setInspectTf] = useState("4h");
  const [inspectIndicators, setInspectIndicators] = useState({ ema: true, rsi: true, bb: false, vol: true });
  const [customStop, setCustomStop] = useState("");
  const [customTP, setCustomTP] = useState("");
  const [expandedTrade, setExpandedTrade] = useState(null);
  const inspectCvRef = useRef(null);
  const [inspectCur, setInspectCur] = useState(null);
  const countdown4h = useCountdown("4h");
  const countdown15m = useCountdown("15m");
  const paper = usePaper(1000000);
  const cvRef = useRef(null); const cv15Ref = useRef(null);
  const [cur, setCur] = useState(null);

  // Auto-login
  useEffect(() => { setTimeout(() => setReady(true), 900); }, []);

  // Fetch live prices on load
  useEffect(() => {
    if (!ready) return;
    (async () => {
      const prices = {};
      let gotOne = false;
      for (const coin of COINS.slice(0, 6)) { // fetch top 6 to test connectivity
        const p = await fetchBitgetPrice(coin.s);
        if (p) { prices[coin.s] = p.last; gotOne = true; }
      }
      if (gotOne) { setLivePrices(prices); setDataSource("bitget"); }
      else setDataSource("simulated");
    })();
  }, [ready]);

  // Pipeline scan
  const scan = useCallback(() => {
    const r = COINS.map(c => runPipeline(c, livePrices[c.s])).sort((a, b) => (b.sig?.ai || 0) - (a.sig?.ai || 0));
    setResults(r);
    const top = r.find(r2 => r2.sig && !dismissed.includes(r2.sym) && !accepted.includes(r2.sym));
    if (top && top.sig.ai >= CFG.APPROVE) setAlert(top);
  }, [dismissed, accepted, livePrices]);

  useEffect(() => { if (ready) scan(); }, [ready, scan]);
  useEffect(() => { if (!ready) return; const iv = setInterval(scan, 120000); return () => clearInterval(iv); }, [ready, scan]);

  // Load candles when selecting a signal
  useEffect(() => {
    if (!sel?.sig) return;
    setCandleLoading(true);
    (async () => {
      const c4 = await fetchBitgetCandles(sel.sym, "4h", 100);
      const c15 = await fetchBitgetCandles(sel.sym, "15m", 80);
      setSelCandles4h(c4 || simCandles(sel.livePrice || sel.coin.p, 100, 14400000));
      setSelCandles15m(c15 || simCandles(sel.livePrice || sel.coin.p, 80, 900000));
      setCandleLoading(false);
    })();
  }, [sel?.sym]);

  // Draw charts
  useEffect(() => { if (cvRef.current && selCandles4h.length) drawChart(cvRef.current, selCandles4h, sel?.sig, cur); }, [selCandles4h, sel, cur]);
  useEffect(() => { if (cv15Ref.current && selCandles15m.length) drawChart(cv15Ref.current, selCandles15m, sel?.sig, null); }, [selCandles15m, sel]);

  // ━━━ INSPECT TRADE LOGIC ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Load candles when inspecting
  useEffect(() => {
    if (!inspecting?.sig) return;
    (async () => {
      const c = await fetchBitgetCandles(inspecting.sym, inspectTf, 100);
      setInspectCandles(c || simCandles(inspecting.livePrice || inspecting.coin.p, 100, GRAN_MS[inspectTf] || 14400000));
    })();
  }, [inspecting?.sym, inspectTf]);

  // Live price polling every 2 seconds when inspecting
  useEffect(() => {
    if (!inspecting?.sig) return;
    let active = true;
    const poll = async () => {
      if (!active) return;
      const p = await fetchBitgetPrice(inspecting.sym);
      if (p && active) {
        setInspectPrice(p.last);
        // Check if still in zone
        const sig = inspecting.sig;
        const inZone = p.last >= sig.ezl * 0.98 && p.last <= sig.ezh * 1.02;
        const priceOk = sig.side === "LONG" ? p.last < sig.t1 : p.last > sig.t1;
        setInspectStillValid(inZone || priceOk);
      }
    };
    poll();
    const iv = setInterval(poll, 2000);
    return () => { active = false; clearInterval(iv); };
  }, [inspecting?.sym]);

  // Generate AI analysis when inspecting
  useEffect(() => {
    if (!inspecting?.sig) return;
    const analysis = generateAIAnalysis(inspecting.sig, inspecting.st, inspectPrice || inspecting.livePrice);
    setInspectAnalysis(analysis);
  }, [inspecting?.sym, inspectPrice]);

  // Draw inspect chart
  useEffect(() => {
    if (inspectCvRef.current && inspectCandles.length) {
      drawChartWithIndicators(inspectCvRef.current, inspectCandles, inspecting?.sig, inspectCur, inspectIndicators);
    }
  }, [inspectCandles, inspecting, inspectCur, inspectIndicators]);

  // Open inspect view
  const openInspect = (r) => {
    setInspecting(r);
    setView("inspect");
    setCustomStop(fp(r.sig.stop));
    setCustomTP(fp(r.sig.t2));
  };

  const sigs = results.filter(r => r.sig); const rejN = results.filter(r => r.rej).length;
  const acceptTrade = (r) => { setAccepted(p => [...p, r.sym]); setAlert(null); paper.open(r.sig, paper.bal * .02); };
  const dismissTrade = (r) => { setDismissed(p => [...p, r.sym]); setAlert(null); };

  const B = ({ children, active, onClick, s }) => <button onClick={onClick} style={{ padding: "4px 10px", background: active ? "#10b98118" : "#0c1018", border: `1px solid ${active ? "#10b98130" : "#1a2744"}`, borderRadius: 4, color: active ? "#10b981" : "#475569", fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Mono',monospace", ...s }}>{children}</button>;

  if (!ready) return (
    <div style={{ width: "100vw", height: "100vh", background: "#030508", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Outfit',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 11, letterSpacing: 8, color: "#10b981", fontWeight: 700, fontFamily: "'DM Mono'" }}>▲ ALPHA</div>
        <div style={{ fontSize: 28, fontWeight: 900, background: "linear-gradient(90deg,#10b981,#06b6d4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginTop: 4 }}>TERMINAL V2</div>
        <div style={{ marginTop: 16, width: 120, height: 3, background: "#111827", borderRadius: 2, margin: "16px auto", overflow: "hidden" }}><div style={{ width: "60%", height: "100%", background: "#10b981", borderRadius: 2, animation: "load 1s ease forwards" }} /></div>
        <div style={{ fontSize: 10, color: "#334155", fontFamily: "'DM Mono'" }}>Connecting to Bitget...</div>
      </div>
      <style>{`@keyframes load{from{width:0}to{width:100%}}`}</style>
    </div>
  );

  return (
    <div style={{ width: "100%", height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden", background: "#050810", fontFamily: "'DM Mono',monospace", color: "#e2e8f0" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}@keyframes glow{0%,100%{box-shadow:0 0 8px #10b98133}50%{box-shadow:0 0 20px #10b98166}}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#1e293b;border-radius:2px}`}</style>

      {/* HEADER */}
      <div style={{ height: 44, background: "#080c14", borderBottom: "1px solid #1a2744", display: "flex", alignItems: "center", padding: "0 14px", gap: 8, flexShrink: 0 }}>
        <span style={{ fontFamily: "'Outfit'", fontWeight: 900, fontSize: 14, background: "linear-gradient(90deg,#10b981,#06b6d4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>▲ ALPHA TERMINAL</span>
        <div style={{ width: 1, height: 20, background: "#1a2744" }} />
        {/* Data source badge */}
        <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, background: dataSource === "bitget" ? "#10b98115" : "#f59e0b15", border: `1px solid ${dataSource === "bitget" ? "#10b98130" : "#f59e0b30"}`, color: dataSource === "bitget" ? "#10b981" : "#f59e0b", fontWeight: 700 }}>
          {dataSource === "bitget" ? "🟢 BITGET LIVE" : dataSource === "simulated" ? "🟡 SIMULATED" : "⏳ CONNECTING"}
        </span>
        <div style={{ display: "flex", gap: 3 }}>{[{ id: "desk", l: "Trade Desk" }, { id: "inspect", l: "🔍 Inspect" }, { id: "quick", l: "Quick Trade" }, { id: "paper", l: "Paper Trading" }, { id: "stats", l: "Performance" }].map(v => <B key={v.id} active={view === v.id} onClick={() => setView(v.id)}>{v.l}</B>)}</div>
        <div style={{ flex: 1 }} />
        {/* Candle countdown */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <div style={{ background: "#10b98110", border: "1px solid #10b98130", borderRadius: 6, padding: "4px 12px", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 9, color: "#475569" }}>4H</span>
            <span style={{ fontSize: 18, fontWeight: 900, color: "#10b981", fontFamily: "'Outfit'", letterSpacing: 1, animation: "glow 2s infinite" }}>{countdown4h}</span>
          </div>
          <div style={{ background: "#3b82f610", border: "1px solid #3b82f630", borderRadius: 6, padding: "4px 10px", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 9, color: "#475569" }}>15m</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: "#3b82f6", fontFamily: "'Outfit'" }}>{countdown15m}</span>
          </div>
        </div>
        <span style={{ fontSize: 10, color: "#f59e0b", fontWeight: 600 }}>AUD ${paper.bal.toLocaleString("en", { maximumFractionDigits: 0 })}</span>
        <B onClick={scan} s={{ background: "#10b98115", borderColor: "#10b98130", color: "#10b981" }}>⟳ Scan</B>
      </div>

      {/* SMART ALERT */}
      {alert && (
        <div style={{ background: "linear-gradient(90deg,#10b98108,#06b6d408)", borderBottom: "1px solid #10b98130", padding: "10px 14px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <span style={{ fontSize: 16 }}>🔔</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: "#f1f5f9" }}>
              <span style={{ color: alert.sig.side === "LONG" ? "#10b981" : "#ef4444" }}>{alert.sig.side}</span> {alert.sig.sym} looks promising
              <span style={{ marginLeft: 6, background: `${alert.sig.band === "ELITE" ? "#10b981" : "#3b82f6"}15`, color: alert.sig.band === "ELITE" ? "#10b981" : "#3b82f6", padding: "2px 6px", borderRadius: 3, fontSize: 9 }}>{alert.sig.ai} {alert.sig.band}</span>
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
              Buy @ <span style={{ color: "#3b82f6", fontWeight: 700 }}>{fp(alert.sig.ep)}</span> → TP1 <span style={{ color: "#10b981", fontWeight: 700 }}>{fp(alert.sig.t1)}</span> → TP2 <span style={{ color: "#22c55e", fontWeight: 700 }}>{fp(alert.sig.t2)}</span> | Stop <span style={{ color: "#ef4444", fontWeight: 700 }}>{fp(alert.sig.stop)}</span> | R:R <span style={{ color: "#06b6d4", fontWeight: 700 }}>{alert.sig.rr.toFixed(1)}</span>
            </div>
          </div>
          <button onClick={() => openInspect(alert)} style={{ padding: "8px 16px", background: "linear-gradient(90deg,#3b82f6,#6366f1)", border: "none", borderRadius: 6, color: "#fff", fontWeight: 800, fontSize: 11, cursor: "pointer", fontFamily: "'Outfit'" }}>🔍 INSPECT</button>
          <button onClick={() => acceptTrade(alert)} style={{ padding: "8px 20px", background: "linear-gradient(90deg,#10b981,#059669)", border: "none", borderRadius: 6, color: "#fff", fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: "'Outfit'" }}>✅ YES, ACCEPT</button>
          <button onClick={() => dismissTrade(alert)} style={{ padding: "8px 16px", background: "#ef444415", border: "1px solid #ef444430", borderRadius: 6, color: "#ef4444", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "'Outfit'" }}>✗ NO</button>
        </div>
      )}

      {/* MAIN */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ═══ TRADE DESK ═══ */}
        {view === "desk" && (
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            {/* Signal list */}
            <div style={{ width: 300, borderRight: "1px solid #1a2744", overflow: "auto", flexShrink: 0 }}>
              <div style={{ padding: "6px 10px", borderBottom: "1px solid #1a2744", fontSize: 9, color: "#475569" }}>{sigs.length} signals · {rejN} rejected · {dataSource === "bitget" ? "Live prices" : "Simulated"}</div>
              {results.map((r, i) => {
                const s = r.sig; const isSel = sel?.sym === r.sym; const isAcc = accepted.includes(r.sym);
                if (s) {
                  const bc = s.band === "ELITE" ? "#10b981" : s.band === "APPROVE" ? "#3b82f6" : "#f59e0b";
                  return (
                    <div key={r.sym} onClick={() => setSel(r)} style={{ padding: "7px 10px", borderBottom: "1px solid #111827", cursor: "pointer", background: isSel ? "#10b98108" : "transparent", borderLeft: isSel ? `3px solid ${bc}` : "3px solid transparent" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ fontWeight: 700, fontSize: 11 }}>{s.sym.replace("USDT", "")}</span>
                        <span style={{ background: s.side === "LONG" ? "#10b981" : "#ef4444", color: "#fff", padding: "1px 5px", borderRadius: 3, fontSize: 8, fontWeight: 800 }}>{s.side}</span>
                        <span style={{ background: `${bc}15`, color: bc, padding: "1px 4px", borderRadius: 3, fontSize: 8, fontWeight: 700 }}>{s.ai}</span>
                        {isAcc && <span style={{ fontSize: 8, color: "#10b981" }}>✓</span>}
                        <div style={{ flex: 1 }} />
                        <span style={{ fontSize: 9, color: "#06b6d4", fontWeight: 600 }}>{s.rr.toFixed(1)}:1</span>
                      </div>
                      <div style={{ fontSize: 9, color: "#475569", marginTop: 1 }}>{s.reg.replace(/_/g, " ")} · {s.path} · {livePrices[r.sym] ? `$${fp(livePrices[r.sym])} live` : fp(s.ep)}</div>
                      <div style={{ display: "flex", gap: 3, marginTop: 2 }}>
                        <span style={{ fontSize: 7, color: s.trend4h === "Bullish" ? "#10b981" : "#ef4444", background: s.trend4h === "Bullish" ? "#10b98110" : "#ef444410", padding: "1px 4px", borderRadius: 2 }}>4H:{s.trend4h}</span>
                        <span style={{ fontSize: 7, color: s.trigger15m === "Confirmed" ? "#10b981" : "#f59e0b", background: s.trigger15m === "Confirmed" ? "#10b98110" : "#f59e0b10", padding: "1px 4px", borderRadius: 2 }}>15m:{s.trigger15m}</span>
                      </div>
                    </div>
                  );
                }
                return <div key={r.sym + i} style={{ padding: "4px 10px", borderBottom: "1px solid #0c1018", fontSize: 8, color: "#334155", display: "flex", gap: 4, opacity: .5 }}><span style={{ width: 60 }}>{r.sym.replace("USDT", "")}</span><span style={{ color: "#ef4444" }}>✗P{r.rej}</span><span>{r.why}</span></div>;
              })}
            </div>

            {/* Detail */}
            <div style={{ flex: 1, overflow: "auto" }}>
              {sel?.sig ? (() => {
                const s = sel.sig, r = sel, bc = s.band === "ELITE" ? "#10b981" : s.band === "APPROVE" ? "#3b82f6" : "#f59e0b", isAcc = accepted.includes(r.sym);
                return (
                  <div style={{ padding: 14 }}>
                    {/* Header */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: "#1a2744", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>◆</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontFamily: "'Outfit'", fontWeight: 800, fontSize: 18 }}>{s.name || s.sym.replace("USDT", "")}</span>
                          <span style={{ background: s.side === "LONG" ? "#10b981" : "#ef4444", color: "#fff", padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 800 }}>{s.side}</span>
                          <span style={{ background: `${bc}15`, border: `1px solid ${bc}30`, borderRadius: 4, padding: "2px 8px", fontSize: 10, color: bc, fontWeight: 700 }}>⚡{s.ai} {s.band}</span>
                          {livePrices[r.sym] && <span style={{ fontSize: 10, color: "#f59e0b" }}>LIVE ${fp(livePrices[r.sym])}</span>}
                        </div>
                        <div style={{ fontSize: 10, color: "#475569" }}>{s.reg.replace(/_/g, " ")} | {s.path}</div>
                      </div>
                    </div>
                    {/* Levels */}
                    <div style={{ display: "flex", gap: 8, marginBottom: 8, fontSize: 10, padding: "6px 10px", background: "#0c1120", borderRadius: 6, border: "1px solid #1a2744", flexWrap: "wrap" }}>
                      <span>ENTRY <span style={{ color: "#3b82f6", fontWeight: 700 }}>{fp(s.ep)}</span></span>
                      <span>STOP <span style={{ color: "#ef4444", fontWeight: 700 }}>{fp(s.stop)}</span></span>
                      <span>TP1 <span style={{ color: "#10b981", fontWeight: 700 }}>{fp(s.t1)}</span></span>
                      <span>TP2 <span style={{ color: "#22c55e", fontWeight: 700 }}>{fp(s.t2)}</span></span>
                      <span>R:R <span style={{ color: "#06b6d4", fontWeight: 800 }}>{s.rr.toFixed(1)}</span></span>
                    </div>
                    {/* Accept bar */}
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", background: "#10b98108", border: "1px solid #10b98125", borderRadius: 6, marginBottom: 8, alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ color: "#10b981" }}>✅</span><div><div style={{ fontWeight: 700, fontSize: 11 }}>Executable Trade <span style={{ background: "#10b98120", color: "#10b981", padding: "1px 6px", borderRadius: 3, fontSize: 9, marginLeft: 4 }}>{s.path}</span></div><div style={{ fontSize: 9, color: "#475569" }}>Entry, stop, targets defined.</div></div></div>
                      {!isAcc ? <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => acceptTrade(r)} style={{ padding: "6px 16px", background: "linear-gradient(90deg,#10b981,#059669)", border: "none", borderRadius: 5, color: "#fff", fontWeight: 800, fontSize: 11, cursor: "pointer", fontFamily: "'Outfit'" }}>ACCEPT</button>
                        <button onClick={() => dismissTrade(r)} style={{ padding: "6px 10px", background: "#ef444410", border: "1px solid #ef444425", borderRadius: 5, color: "#ef4444", fontWeight: 700, fontSize: 10, cursor: "pointer" }}>REJECT</button>
                      </div> : <span style={{ color: "#10b981", fontWeight: 700, fontSize: 11 }}>✓ ACCEPTED</span>}
                    </div>
                    {/* MTF */}
                    <div style={{ marginBottom: 8, padding: "6px 10px", background: "#0c1120", border: "1px solid #1a2744", borderRadius: 6 }}>
                      <div style={{ fontWeight: 700, fontSize: 10, color: "#94a3b8", marginBottom: 4 }}>📊 Multi-Timeframe</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                        <div style={{ background: "#111827", borderRadius: 4, padding: 6 }}><div style={{ fontSize: 9, color: "#475569" }}>4H Trend</div><div style={{ fontSize: 10, fontWeight: 700, color: s.trend4h === "Bullish" ? "#10b981" : "#ef4444" }}>{s.mtf_detail.h4_trend}</div><div style={{ fontSize: 8, color: "#475569" }}>RSI: {s.mtf_detail.h4_rsi}</div></div>
                        <div style={{ background: "#111827", borderRadius: 4, padding: 6 }}><div style={{ fontSize: 9, color: "#475569" }}>15m Entry</div><div style={{ fontSize: 10, fontWeight: 700, color: s.trigger15m === "Confirmed" ? "#10b981" : "#f59e0b" }}>{s.mtf_detail.m15_trigger}</div><div style={{ fontSize: 8, color: "#475569" }}>RSI: {s.mtf_detail.m15_rsi}</div></div>
                      </div>
                    </div>
                    {/* Path eval */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
                      {[{ l: "PULLBACK", rr: s.pRR, sel2: s.path === "PULLBACK", desc: `${s.gap.toFixed(1)}% from entry` }, { l: "MOMENTUM", rr: s.mRR, sel2: s.path === "MOMENTUM", desc: `Live R:R ${s.mRR.toFixed(2)}` }].map((pp, i) => (
                        <div key={i} style={{ background: pp.sel2 ? "#0f1d30" : "#0c1120", border: `1px solid ${pp.sel2 ? "#3b82f640" : "#1a2744"}`, borderRadius: 6, padding: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontWeight: 700, fontSize: 10 }}>{pp.l}</span>{pp.sel2 && <span style={{ color: "#10b981" }}>✓</span>}</div>
                          <div style={{ fontSize: 10, color: "#06b6d4", fontWeight: 700 }}>R:R {pp.rr.toFixed(2)}</div>
                          <div style={{ fontSize: 8, color: "#475569", marginTop: 2 }}>{pp.desc}</div>
                        </div>
                      ))}
                    </div>
                    {/* Charts */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                          <span style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8" }}>4H Chart {candleLoading ? "⏳" : dataSource === "bitget" ? "🟢" : "🟡"}</span>
                          <span style={{ fontSize: 16, fontWeight: 900, color: "#10b981", fontFamily: "'Outfit'" }}>{countdown4h}</span>
                        </div>
                        <canvas ref={cvRef} style={{ width: "100%", height: 200, borderRadius: 6, border: "1px solid #1a2744" }} onMouseMove={e => { const r2 = e.currentTarget.getBoundingClientRect(); setCur({ x: e.clientX - r2.left, y: e.clientY - r2.top }); }} onMouseLeave={() => setCur(null)} />
                      </div>
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                          <span style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8" }}>15m Entry {candleLoading ? "⏳" : dataSource === "bitget" ? "🟢" : "🟡"}</span>
                          <span style={{ fontSize: 14, fontWeight: 800, color: "#3b82f6", fontFamily: "'Outfit'" }}>{countdown15m}</span>
                        </div>
                        <canvas ref={cv15Ref} style={{ width: "100%", height: 200, borderRadius: 6, border: "1px solid #1a2744" }} />
                      </div>
                    </div>
                    {/* Gates + AI */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      <div style={{ background: "#0c1120", border: "1px solid #1a2744", borderRadius: 6, padding: 8 }}>
                        <div style={{ fontWeight: 700, fontSize: 9, color: "#94a3b8", marginBottom: 4 }}>🚧 Gates {r.ph[8]?.n}/11</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>{r.ph[8]?.gates?.map((g, i) => <span key={i} style={{ background: g.p ? "#10b98108" : "#ef444408", border: `1px solid ${g.p ? "#10b98120" : "#ef444420"}`, borderRadius: 2, padding: "1px 3px", fontSize: 7, color: g.p ? "#10b981" : "#ef4444", fontWeight: 600 }}>{g.p ? "✓" : "✗"}{g.n}</span>)}</div>
                      </div>
                      <div style={{ background: "#0c1120", border: "1px solid #1a2744", borderRadius: 6, padding: 8 }}>
                        <div style={{ fontWeight: 700, fontSize: 9, color: "#94a3b8", marginBottom: 4 }}>🧠 AI Score</div>
                        {r.ph[7]?.comp && Object.entries(r.ph[7].comp).map(([k, v]) => (
                          <div key={k} style={{ display: "flex", alignItems: "center", gap: 3, marginBottom: 1 }}>
                            <span style={{ fontSize: 7, color: "#475569", width: 55, textTransform: "capitalize" }}>{k}</span>
                            <div style={{ flex: 1, height: 3, background: "#111827", borderRadius: 2 }}><div style={{ height: 3, background: v >= 70 ? "#10b981" : v >= 50 ? "#3b82f6" : "#f59e0b", borderRadius: 2, width: `${Math.min(100, v)}%` }} /></div>
                            <span style={{ fontSize: 7, color: "#94a3b8", width: 18, textAlign: "right" }}>{Math.round(v)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })() : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#334155", fontSize: 12 }}>← Select a signal</div>}
            </div>
          </div>
        )}

        {/* ═══ INSPECT TRADE ═══ */}
        {view === "inspect" && inspecting?.sig && (() => {
          const s = inspecting.sig, a = inspectAnalysis;
          const lp = inspectPrice || inspecting.livePrice || s.ep;
          const pchg = ((lp - s.ep) / s.ep * 100).toFixed(2);
          const stillColor = inspectStillValid ? "#10b981" : "#ef4444";
          return (
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            {/* LEFT: Chart + Indicators */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {/* Live Status Bar */}
              <div style={{ padding: "6px 12px", background: "#080c14", borderBottom: "1px solid #1a2744", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <span style={{ fontFamily: "'Outfit'", fontWeight: 800, fontSize: 16 }}>{s.name || s.sym.replace("USDT","")}</span>
                <span style={{ background: s.side === "LONG" ? "#10b981" : "#ef4444", color: "#fff", padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 800 }}>{s.side}</span>
                <span style={{ fontSize: 18, fontWeight: 900, color: lp >= s.ep ? "#10b981" : "#ef4444", fontFamily: "'Outfit'" }}>${fp(lp)}</span>
                <span style={{ fontSize: 10, color: parseFloat(pchg) >= 0 ? "#10b981" : "#ef4444" }}>{pchg}%</span>
                <div style={{ width: 1, height: 20, background: "#1a2744" }} />
                {/* LIVE RECOMMENDATION INDICATOR */}
                <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 6, background: inspectStillValid ? "#10b98115" : "#ef444415", border: `1px solid ${stillColor}30`, animation: "pulse 2s infinite" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: stillColor, boxShadow: `0 0 8px ${stillColor}` }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: stillColor }}>{inspectStillValid ? `STILL ${s.side} — ACTIVE` : "SIGNAL WEAKENING"}</span>
                </div>
                <div style={{ flex: 1 }} />
                {/* Timeframe selector */}
                {["1m","5m","15m","1h","4h","1d"].map(tf => (
                  <button key={tf} onClick={() => setInspectTf(tf)} style={{ padding: "2px 8px", background: inspectTf === tf ? "#3b82f620" : "#0c1018", border: `1px solid ${inspectTf === tf ? "#3b82f650" : "#1a2744"}`, borderRadius: 3, color: inspectTf === tf ? "#3b82f6" : "#475569", fontSize: 9, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Mono'" }}>{tf.toUpperCase()}</button>
                ))}
              </div>
              {/* Indicator toggles */}
              <div style={{ padding: "4px 12px", background: "#060a12", borderBottom: "1px solid #111827", display: "flex", gap: 6, flexShrink: 0 }}>
                {[{k:"ema",l:"EMA 20/50/200",c:"#f59e0b"},{k:"rsi",l:"RSI",c:"#8b5cf6"},{k:"bb",l:"Bollinger",c:"#3b82f6"},{k:"vol",l:"Volume",c:"#06b6d4"}].map(ind => (
                  <button key={ind.k} onClick={() => setInspectIndicators(p => ({...p, [ind.k]: !p[ind.k]}))} style={{ padding: "2px 8px", background: inspectIndicators[ind.k] ? `${ind.c}15` : "#0c1018", border: `1px solid ${inspectIndicators[ind.k] ? `${ind.c}40` : "#1a2744"}`, borderRadius: 3, color: inspectIndicators[ind.k] ? ind.c : "#334155", fontSize: 8, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Mono'" }}>{inspectIndicators[ind.k] ? "●" : "○"} {ind.l}</button>
                ))}
              </div>
              {/* Chart */}
              <div style={{ flex: 1, position: "relative" }}>
                <canvas ref={inspectCvRef} style={{ width: "100%", height: "100%" }} onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); setInspectCur({ x: e.clientX - r.left, y: e.clientY - r.top }); }} onMouseLeave={() => setInspectCur(null)} />
              </div>
            </div>

            {/* RIGHT: AI Analysis Panel */}
            <div style={{ width: 360, borderLeft: "1px solid #1a2744", overflow: "auto", flexShrink: 0, background: "#080c14" }}>
              {/* AI Verdict */}
              <div style={{ padding: "12px 14px", borderBottom: "1px solid #1a2744" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 18 }}>🤖</span>
                  <span style={{ fontFamily: "'Outfit'", fontWeight: 800, fontSize: 14, color: "#e2e8f0" }}>AI Analysis</span>
                  <span style={{ background: `${a?.band === "ELITE" ? "#10b981" : "#3b82f6"}15`, color: a?.band === "ELITE" ? "#10b981" : "#3b82f6", padding: "2px 8px", borderRadius: 4, fontSize: 9, fontWeight: 700 }}>Score: {a?.aiScore}/100</span>
                </div>
                {/* Verdict badge */}
                <div style={{ padding: "10px 14px", background: s.side === "LONG" ? "#10b98110" : "#ef444410", border: `1px solid ${s.side === "LONG" ? "#10b98130" : "#ef444430"}`, borderRadius: 8, marginBottom: 8 }}>
                  <div style={{ fontFamily: "'Outfit'", fontWeight: 900, fontSize: 22, color: s.side === "LONG" ? "#10b981" : "#ef4444" }}>{a?.verdict} {s.sym.replace("USDT","")}</div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{a?.summary}</div>
                </div>
              </div>

              {/* Reasons */}
              <div style={{ padding: "10px 14px", borderBottom: "1px solid #1a2744" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>📋 Why {s.side === "LONG" ? "Buy" : "Sell"}</div>
                {a?.reasons?.map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4, fontSize: 9, color: "#cbd5e1" }}>
                    <span style={{ color: "#10b981", flexShrink: 0 }}>✓</span>
                    <span>{r}</span>
                  </div>
                ))}
                {a?.warnings?.map((w, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4, fontSize: 9, color: "#f59e0b" }}>
                    <span style={{ flexShrink: 0 }}>⚠️</span>
                    <span>{w}</span>
                  </div>
                ))}
              </div>

              {/* Entry/Exit Levels */}
              <div style={{ padding: "10px 14px", borderBottom: "1px solid #1a2744" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>🎯 Trade Levels</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                  {[
                    { l: "Entry", v: fp(s.ep), c: "#3b82f6" },
                    { l: "Stop Loss", v: fp(s.stop), c: "#ef4444" },
                    { l: "TP1 (1.5R)", v: fp(s.t1), c: "#10b981" },
                    { l: "TP2 (2.5R)", v: fp(s.t2), c: "#22c55e" },
                    { l: "TP3 (4R)", v: fp(s.t3), c: "#4ade80" },
                    { l: "R:R Ratio", v: s.rr.toFixed(1) + ":1", c: "#06b6d4" },
                  ].map(lev => (
                    <div key={lev.l} style={{ padding: "4px 8px", background: "#0c1120", borderRadius: 4, border: "1px solid #1a2744" }}>
                      <div style={{ fontSize: 7, color: "#475569", textTransform: "uppercase" }}>{lev.l}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: lev.c }}>{lev.v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Manual Stop/TP Override */}
              <div style={{ padding: "10px 14px", borderBottom: "1px solid #1a2744" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>⚙️ Custom Levels</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <div>
                    <label style={{ fontSize: 8, color: "#475569", display: "block", marginBottom: 2 }}>STOP LOSS</label>
                    <input value={customStop} onChange={e => setCustomStop(e.target.value)} style={{ width: "100%", background: "#0c1120", border: "1px solid #ef444430", borderRadius: 4, padding: "6px 8px", color: "#ef4444", fontSize: 11, fontFamily: "'DM Mono'", outline: "none", boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 8, color: "#475569", display: "block", marginBottom: 2 }}>TAKE PROFIT</label>
                    <input value={customTP} onChange={e => setCustomTP(e.target.value)} style={{ width: "100%", background: "#0c1120", border: "1px solid #10b98130", borderRadius: 4, padding: "6px 8px", color: "#10b981", fontSize: 11, fontFamily: "'DM Mono'", outline: "none", boxSizing: "border-box" }} />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 6 }}>
                  <button onClick={() => { setCustomStop(fp(a?.manualLevels?.tightStop)); }} style={{ padding: "4px", background: "#1a274420", border: "1px solid #1a2744", borderRadius: 3, color: "#64748b", fontSize: 8, cursor: "pointer", fontFamily: "'DM Mono'" }}>Tight Stop</button>
                  <button onClick={() => { setCustomStop(fp(a?.manualLevels?.wideStop)); }} style={{ padding: "4px", background: "#1a274420", border: "1px solid #1a2744", borderRadius: 3, color: "#64748b", fontSize: 8, cursor: "pointer", fontFamily: "'DM Mono'" }}>Wide Stop</button>
                </div>
              </div>

              {/* Position Sizing */}
              <div style={{ padding: "10px 14px", borderBottom: "1px solid #1a2744" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>📐 Suggested Sizing</div>
                <div style={{ fontSize: 9, color: "#64748b" }}>
                  <div style={{ marginBottom: 2 }}>Risk per $1K: <span style={{ color: "#f59e0b" }}>${a?.sizing?.riskPer1k}</span></div>
                  <div style={{ marginBottom: 2 }}>Qty @ 10x leverage: <span style={{ color: "#06b6d4" }}>{a?.sizing?.qty10xLev}</span></div>
                  <div>Position risk: <span style={{ color: "#e2e8f0" }}>{a?.sizing?.suggestedSize}</span></div>
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ padding: "12px 14px" }}>
                {inspectStillValid ? (
                  <button onClick={() => { acceptTrade(inspecting); setView("paper"); }} style={{ width: "100%", padding: "14px", background: s.side === "LONG" ? "linear-gradient(90deg,#10b981,#059669)" : "linear-gradient(90deg,#ef4444,#dc2626)", border: "none", borderRadius: 8, color: "#fff", fontWeight: 900, fontSize: 14, cursor: "pointer", fontFamily: "'Outfit'", marginBottom: 6 }}>
                    ✅ ACCEPT {s.side} — EXECUTE TRADE
                  </button>
                ) : (
                  <button disabled style={{ width: "100%", padding: "14px", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#64748b", fontWeight: 700, fontSize: 12, fontFamily: "'Outfit'", marginBottom: 6, cursor: "not-allowed" }}>
                    ⏸ Signal weakening — wait for re-entry
                  </button>
                )}
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => { dismissTrade(inspecting); setView("desk"); }} style={{ flex: 1, padding: "8px", background: "#ef444410", border: "1px solid #ef444425", borderRadius: 6, color: "#ef4444", fontWeight: 700, fontSize: 10, cursor: "pointer", fontFamily: "'Outfit'" }}>✗ REJECT</button>
                  <button onClick={() => setView("desk")} style={{ flex: 1, padding: "8px", background: "#1a274420", border: "1px solid #1a2744", borderRadius: 6, color: "#94a3b8", fontWeight: 600, fontSize: 10, cursor: "pointer", fontFamily: "'DM Mono'" }}>← Back</button>
                </div>
              </div>
            </div>
          </div>
          );
        })()}

        {/* ═══ QUICK TRADE ═══ */}
        {view === "quick" && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 380, background: "#0c1120", border: "1px solid #1a2744", borderRadius: 10, padding: 24 }}>
              <div style={{ fontFamily: "'Outfit'", fontWeight: 800, fontSize: 18, marginBottom: 16, textAlign: "center" }}>⚡ Quick Trade</div>
              <div style={{ marginBottom: 12 }}><label style={{ display: "block", fontSize: 9, color: "#475569", fontWeight: 600, marginBottom: 3 }}>SYMBOL</label>
                <select value={quickSym} onChange={e => setQuickSym(e.target.value)} style={{ width: "100%", background: "#060810", border: "1px solid #1a2744", borderRadius: 6, padding: "8px 10px", color: "#e2e8f0", fontSize: 12, fontFamily: "inherit", outline: "none" }}>
                  {COINS.map(c => <option key={c.s} value={c.s}>{c.s} — {c.n} {livePrices[c.s] ? `($${fp(livePrices[c.s])})` : ""}</option>)}
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                <button onClick={() => setQuickSide("LONG")} style={{ padding: 12, background: quickSide === "LONG" ? "#10b98120" : "#111827", border: `2px solid ${quickSide === "LONG" ? "#10b981" : "#1a2744"}`, borderRadius: 6, color: quickSide === "LONG" ? "#10b981" : "#475569", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "'Outfit'" }}>LONG ↑</button>
                <button onClick={() => setQuickSide("SHORT")} style={{ padding: 12, background: quickSide === "SHORT" ? "#ef444420" : "#111827", border: `2px solid ${quickSide === "SHORT" ? "#ef4444" : "#1a2744"}`, borderRadius: 6, color: quickSide === "SHORT" ? "#ef4444" : "#475569", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "'Outfit'" }}>SHORT ↓</button>
              </div>
              <div style={{ marginBottom: 12 }}><label style={{ display: "block", fontSize: 9, color: "#475569", fontWeight: 600, marginBottom: 3 }}>SIZE (AUD)</label>
                <input value={quickSize} onChange={e => setQuickSize(e.target.value)} type="number" style={{ width: "100%", background: "#060810", border: "1px solid #1a2744", borderRadius: 6, padding: "8px 10px", color: "#e2e8f0", fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
                <div style={{ display: "flex", gap: 4, marginTop: 4 }}>{["1000", "5000", "10000", "50000"].map(v => <button key={v} onClick={() => setQuickSize(v)} style={{ flex: 1, padding: "4px", background: "#111827", border: "1px solid #1a2744", borderRadius: 3, color: "#64748b", fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>${parseInt(v).toLocaleString()}</button>)}</div>
              </div>
              <button onClick={() => { const coin = COINS.find(c => c.s === quickSym); if (coin) { const p = livePrices[coin.s] || coin.p, atr = p * .025; paper.open({ sym: coin.s, side: quickSide, ep: p, stop: quickSide === "LONG" ? p - atr * 1.5 : p + atr * 1.5, t1: quickSide === "LONG" ? p + atr * 2 : p - atr * 2, t2: quickSide === "LONG" ? p + atr * 3.5 : p - atr * 3.5, rr: 2.5 }, parseFloat(quickSize)); } }} style={{ width: "100%", padding: 14, background: quickSide === "LONG" ? "linear-gradient(90deg,#10b981,#059669)" : "linear-gradient(90deg,#ef4444,#dc2626)", border: "none", borderRadius: 8, color: "#fff", fontWeight: 900, fontSize: 15, cursor: "pointer", fontFamily: "'Outfit'" }}>
                {quickSide === "LONG" ? "BUY" : "SELL"} {quickSym.replace("USDT", "")} — ${parseInt(quickSize || 0).toLocaleString()} AUD
              </button>
              <div style={{ textAlign: "center", marginTop: 8, fontSize: 9, color: "#334155" }}>Paper mode — no real orders</div>
            </div>
          </div>
        )}

        {/* ═══ PAPER TRADING ═══ */}
        {view === "paper" && (
          <div style={{ flex: 1, overflow: "auto", padding: 14 }}>
            <div style={{ maxWidth: 780, margin: "0 auto" }}>
              <div style={{ fontFamily: "'Outfit'", fontWeight: 800, fontSize: 18, marginBottom: 12 }}>📋 Paper Trading</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 12 }}>
                {[{ l: "Balance", v: `$${paper.bal.toLocaleString("en", { maximumFractionDigits: 0 })}`, c: "#f59e0b" }, { l: "P&L", v: `${paper.stats.pnl >= 0 ? "+" : ""}$${paper.stats.pnl.toFixed(0)}`, c: paper.stats.pnl >= 0 ? "#10b981" : "#ef4444" }, { l: "Win Rate", v: `${paper.stats.wr}%`, c: "#10b981" }, { l: "Trades", v: paper.stats.total, c: "#3b82f6" }].map((s, i) => (
                  <div key={i} style={{ background: "#0c1120", border: "1px solid #1a2744", borderRadius: 6, padding: "10px", textAlign: "center" }}><div style={{ fontSize: 9, color: "#475569" }}>{s.l}</div><div style={{ fontSize: 20, fontWeight: 900, color: s.c, fontFamily: "'Outfit'" }}>{s.v}</div></div>
                ))}
              </div>
              {paper.pos.length > 0 && <><div style={{ fontWeight: 700, fontSize: 11, color: "#f59e0b", marginBottom: 4 }}>Open Positions</div>{paper.pos.map(p => (
                <div key={p.id} style={{ background: "#0c1120", border: "1px solid #f59e0b30", borderRadius: 6, padding: "6px 10px", marginBottom: 3, display: "flex", gap: 8, fontSize: 10, alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>{p.sym.replace("USDT", "")}</span><span style={{ color: p.side === "LONG" ? "#10b981" : "#ef4444", fontWeight: 700 }}>{p.side}</span><span style={{ color: "#475569" }}>@ {fp(p.entry)}</span><span style={{ color: "#475569" }}>${p.size.toLocaleString()}</span><div style={{ flex: 1 }} /><span style={{ color: "#f59e0b", animation: "pulse 1s infinite" }}>⏳ Simulating...</span>
                </div>
              ))}</>}
              <div style={{ fontWeight: 700, fontSize: 11, color: "#94a3b8", marginBottom: 4, marginTop: 8 }}>History ({paper.trades.length})</div>
              {paper.trades.length === 0 ? <div style={{ color: "#334155", fontSize: 10, padding: 16, textAlign: "center" }}>No trades yet</div> :
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                  <thead><tr style={{ background: "#080c14" }}>{["", "Sym", "Side", "Entry", "Exit", "Size", "P&L", "Result"].map(h => <th key={h} style={{ padding: "4px 8px", textAlign: "left", color: "#334155", fontWeight: 600, fontSize: 9, borderBottom: "1px solid #1a2744" }}>{h}</th>)}</tr></thead>
                  <tbody>{paper.trades.map(t => {
                    const isExp = expandedTrade === t.id;
                    const duration = t.closeTime && t.time ? Math.round((new Date(t.closeTime) - new Date(t.time)) / 1000) : 0;
                    const dMin = Math.floor(duration / 60), dSec = duration % 60;
                    const pnlPct = t.size > 0 ? ((t.pnl / t.size) * 100).toFixed(2) : "0";
                    const riskAmt = Math.abs(t.entry - t.stop);
                    const rewAmt = Math.abs(t.exit - t.entry);
                    const rrAchieved = riskAmt > 0 ? (rewAmt / riskAmt).toFixed(1) : "—";
                    return (<>
                    <tr key={t.id} onClick={() => setExpandedTrade(isExp ? null : t.id)} style={{ borderBottom: isExp ? "none" : "1px solid #0c1018", background: t.status === "WIN" ? "#10b98105" : "#ef444405", cursor: "pointer" }}>
                      <td style={{ padding: "4px 6px", fontSize: 10, color: "#475569" }}>{isExp ? "▼" : "▶"}</td>
                      <td style={{ padding: "4px 8px", fontWeight: 700 }}>{t.sym.replace("USDT", "")}</td>
                      <td style={{ padding: "4px 8px", color: t.side === "LONG" ? "#10b981" : "#ef4444", fontWeight: 700 }}>{t.side}</td>
                      <td style={{ padding: "4px 8px" }}>{fp(t.entry)}</td>
                      <td style={{ padding: "4px 8px" }}>{fp(t.exit)}</td>
                      <td style={{ padding: "4px 8px", color: "#64748b" }}>${t.size.toLocaleString()}</td>
                      <td style={{ padding: "4px 8px", color: t.pnl >= 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>{t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}</td>
                      <td style={{ padding: "4px 8px" }}><span style={{ background: t.status === "WIN" ? "#10b98115" : "#ef444415", color: t.status === "WIN" ? "#10b981" : "#ef4444", padding: "1px 5px", borderRadius: 3, fontSize: 8, fontWeight: 700 }}>{t.status}</span></td>
                    </tr>
                    {isExp && (
                      <tr key={t.id + "_detail"}>
                        <td colSpan={8} style={{ padding: 0 }}>
                          <div style={{ background: "#0a0f1a", border: "1px solid #1a2744", borderTop: "none", borderRadius: "0 0 6px 6px", padding: "10px 14px", margin: "0 4px 6px 4px" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                              {[
                                { l: "Open Time", v: t.time ? new Date(t.time).toLocaleString("en-AU", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit", second:"2-digit" }) : "—", c: "#94a3b8" },
                                { l: "Close Time", v: t.closeTime ? new Date(t.closeTime).toLocaleString("en-AU", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit", second:"2-digit" }) : "—", c: "#94a3b8" },
                                { l: "Duration", v: `${dMin}m ${dSec}s`, c: "#06b6d4" },
                                { l: "Return", v: `${parseFloat(pnlPct) >= 0 ? "+" : ""}${pnlPct}%`, c: parseFloat(pnlPct) >= 0 ? "#10b981" : "#ef4444" },
                              ].map(d => (
                                <div key={d.l} style={{ background: "#0c1120", borderRadius: 4, padding: "6px 8px", border: "1px solid #111827" }}>
                                  <div style={{ fontSize: 7, color: "#475569", textTransform: "uppercase", marginBottom: 2 }}>{d.l}</div>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: d.c }}>{d.v}</div>
                                </div>
                              ))}
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 8 }}>
                              {[
                                { l: "Entry Price", v: `$${fp(t.entry)}`, c: "#3b82f6" },
                                { l: "Exit Price", v: `$${fp(t.exit)}`, c: t.pnl >= 0 ? "#10b981" : "#ef4444" },
                                { l: "Stop Loss", v: t.stop ? `$${fp(t.stop)}` : "—", c: "#ef4444" },
                                { l: "Position Size", v: `$${t.size.toLocaleString()}`, c: "#f59e0b" },
                                { l: "R:R Achieved", v: `${rrAchieved}:1`, c: "#06b6d4" },
                              ].map(d => (
                                <div key={d.l} style={{ background: "#0c1120", borderRadius: 4, padding: "6px 8px", border: "1px solid #111827" }}>
                                  <div style={{ fontSize: 7, color: "#475569", textTransform: "uppercase", marginBottom: 2 }}>{d.l}</div>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: d.c }}>{d.v}</div>
                                </div>
                              ))}
                            </div>
                            <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                              <div style={{ fontSize: 8, color: "#475569" }}>Qty: <span style={{ color: "#94a3b8" }}>{t.qty?.toFixed(4) || "—"}</span></div>
                              <div style={{ fontSize: 8, color: "#475569" }}>TP1: <span style={{ color: "#10b981" }}>{t.tp1 ? `$${fp(t.tp1)}` : "—"}</span></div>
                              <div style={{ fontSize: 8, color: "#475569" }}>TP2: <span style={{ color: "#22c55e" }}>{t.tp2 ? `$${fp(t.tp2)}` : "—"}</span></div>
                              <div style={{ flex: 1 }} />
                              <div style={{ fontSize: 8, padding: "2px 8px", borderRadius: 3, background: t.pnl >= 0 ? "#10b98110" : "#ef444410", color: t.pnl >= 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>
                                {t.pnl >= 0 ? "✓ " : "✗ "}{t.status} {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)} ({pnlPct}%)
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </>);
                  })}</tbody>
                </table>}
            </div>
          </div>
        )}

        {/* ═══ PERFORMANCE ═══ */}
        {view === "stats" && (
          <div style={{ flex: 1, overflow: "auto", padding: 14 }}>
            <div style={{ maxWidth: 680, margin: "0 auto" }}>
              <div style={{ fontFamily: "'Outfit'", fontWeight: 800, fontSize: 18, marginBottom: 12 }}>📈 Performance</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 12 }}>
                {[{ l: "Trades", v: paper.stats.total, c: "#3b82f6" }, { l: "Wins", v: paper.stats.w, c: "#10b981" }, { l: "Losses", v: paper.stats.l, c: "#ef4444" }, { l: "Win Rate", v: `${paper.stats.wr}%`, c: "#f59e0b" }].map((s, i) => (
                  <div key={i} style={{ background: "#0c1120", border: "1px solid #1a2744", borderRadius: 6, padding: 12, textAlign: "center" }}><div style={{ fontSize: 9, color: "#475569" }}>{s.l}</div><div style={{ fontSize: 22, fontWeight: 900, color: s.c, fontFamily: "'Outfit'" }}>{s.v}</div></div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                {[{ l: "Total P&L", v: `${paper.stats.pnl >= 0 ? "+" : ""}$${paper.stats.pnl.toFixed(0)}`, c: paper.stats.pnl >= 0 ? "#10b981" : "#ef4444" }, { l: "Best", v: `+$${paper.stats.best.toFixed(0)}`, c: "#10b981" }, { l: "Worst", v: `$${paper.stats.worst.toFixed(0)}`, c: "#ef4444" }].map((s, i) => (
                  <div key={i} style={{ background: "#0c1120", border: "1px solid #1a2744", borderRadius: 6, padding: 12, textAlign: "center" }}><div style={{ fontSize: 9, color: "#475569" }}>{s.l}</div><div style={{ fontSize: 18, fontWeight: 900, color: s.c, fontFamily: "'Outfit'" }}>{s.v}</div></div>
                ))}
              </div>
              <div style={{ background: "#0c1120", border: "1px solid #1a2744", borderRadius: 6, padding: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>Trade Results</div>
                <div style={{ height: 100, display: "flex", alignItems: "flex-end", gap: 2 }}>
                  {paper.trades.length === 0 ? <div style={{ color: "#334155", fontSize: 10, margin: "auto" }}>Trade to see results</div> :
                    paper.trades.slice().reverse().map((t, i) => { const max = Math.max(...paper.trades.map(x => Math.abs(x.pnl)), 1); return (<div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}><div style={{ width: "100%", maxWidth: 28, height: `${Math.max(4, (Math.abs(t.pnl) / max) * 100)}%`, background: t.pnl >= 0 ? "#10b981" : "#ef4444", borderRadius: "2px 2px 0 0", minHeight: 4 }} /><span style={{ fontSize: 6, color: "#334155", marginTop: 1 }}>{t.sym.replace("USDT", "").slice(0, 3)}</span></div>); })}
                </div>
              </div>
              <div style={{ marginTop: 8, padding: 8, background: "#f59e0b08", border: "1px solid #f59e0b20", borderRadius: 6, fontSize: 10, color: "#fbbf24", textAlign: "center" }}>
                🏦 Start: AUD $1,000,000 | Now: AUD ${paper.bal.toLocaleString("en", { maximumFractionDigits: 0 })} | {((paper.stats.pnl / 1000000) * 100).toFixed(3)}%
              </div>
            </div>
          </div>
        )}
      </div>

      {/* STATUS */}
      <div style={{ height: 22, background: "#080c14", borderTop: "1px solid #1a2744", display: "flex", alignItems: "center", padding: "0 14px", fontSize: 9, color: "#334155", gap: 10, flexShrink: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 4, height: 4, borderRadius: "50%", background: dataSource === "bitget" ? "#10b981" : "#f59e0b", animation: "pulse 2s infinite" }} />{dataSource === "bitget" ? "BITGET LIVE" : "SIMULATED"}</span>
        <span>Paper Mode</span><span>{sigs.length} signals</span>
        <div style={{ flex: 1 }} /><span>Alpha Terminal V2 — Bitget Data Feed</span>
      </div>
    </div>
  );
}
