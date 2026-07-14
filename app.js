// Sentinel — Core Application Logic
;(function(){
'use strict';

var APP = window.SentinelApp = {
 positions: [],
 nextId: 1,
 tgRunning: false,
 tgInterval: null,
 tgLastSent: {},
 priceCache: {},
 fundingCache: {},
 mmCache: {},
 inflightPairs: {}
};

// ---- Helpers ----
function $(id){return document.getElementById(id);}
function qs(s){return document.querySelector(s);}
function qsa(s){return document.querySelectorAll(s);}

function switchTab(name){
 qsa('.tab-content').forEach(function(e){e.classList.add('hidden');});
 qsa('.tab').forEach(function(e){e.classList.remove('active');});
 var tc = $('tab-' + name);
 if(tc) tc.classList.remove('hidden');
 var matchKey = {'portfolio':'portfolio','manual':'add','api':'api','alerts':'telegram','about':'about'};
 var m = matchKey[name] || name;
 qsa('.tab').forEach(function(el){
  if(el.textContent.trim().toLowerCase().indexOf(m) >= 0) el.classList.add('active');
 });
 if(name === 'portfolio') recalcAll();
 if(name === 'manual' || name === 'portfolio') updateWISelect();
}

function resolvePair(sym){
 var s = sym.toUpperCase().trim();
 if(s.indexOf('-') > 0) return s;
 if(s.indexOf('/') > 0) return s.replace('/','-') + '-SWAP';
 var known = {
  'BTC':'BTC-USDT-SWAP','ETH':'ETH-USDT-SWAP','SOL':'SOL-USDT-SWAP',
  'DOGE':'DOGE-USDT-SWAP','XRP':'XRP-USDT-SWAP','ADA':'ADA-USDT-SWAP',
  'AVAX':'AVAX-USDT-SWAP','LINK':'LINK-USDT-SWAP','DOT':'DOT-USDT-SWAP',
  'BNB':'BNB-USDT-SWAP','ARB':'ARB-USDT-SWAP','OP':'OP-USDT-SWAP',
  'SUI':'SUI-USDT-SWAP','APT':'APT-USDT-SWAP','TIA':'TIA-USDT-SWAP',
  'WIF':'WIF-USDT-SWAP','NEAR':'NEAR-USDT-SWAP','ATOM':'ATOM-USDT-SWAP',
  'LTC':'LTC-USDT-SWAP','BCH':'BCH-USDT-SWAP','SEI':'SEI-USDT-SWAP',
  'INJ':'INJ-USDT-SWAP','RUNE':'RUNE-USDT-SWAP','PEPE':'PEPE-USDT-SWAP',
  'CRV':'CRV-USDT-SWAP','AAVE':'AAVE-USDT-SWAP','MKR':'MKR-USDT-SWAP',
  'SATS':'1000SATS-USDT-SWAP','BONK':'BONK-USDT-SWAP',
  'PEOPLE':'PEOPLE-USDT-SWAP','FIL':'FIL-USDT-SWAP','TRX':'TRX-USDT-SWAP',
  'ICP':'ICP-USDT-SWAP','APT':'APT-USDT-SWAP','SAND':'SAND-USDT-SWAP',
  'MANA':'MANA-USDT-SWAP','APE':'APE-USDT-SWAP','FTM':'FTM-USDT-SWAP',
  'MATIC':'MATIC-USDT-SWAP','ALGO':'ALGO-USDT-SWAP','EGLD':'EGLD-USDT-SWAP',
  'AAVE':'AAVE-USDT-SWAP','MKR':'MKR-USDT-SWAP','SNX':'SNX-USDT-SWAP',
  'COMP':'COMP-USDT-SWAP','UNI':'UNI-USDT-SWAP','ENS':'ENS-USDT-SWAP',
  'YFI':'YFI-USDT-SWAP','ZEC':'ZEC-USDT-SWAP','DASH':'DASH-USDT-SWAP',
  'EOS':'EOS-USDT-SWAP','TRB':'TRB-USDT-SWAP','LDO':'LDO-USDT-SWAP',
  'FXS':'FXS-USDT-SWAP','GMX':'GMX-USDT-SWAP','RPL':'RPL-USDT-SWAP',
  'PENDLE':'PENDLE-USDT-SWAP','STRK':'STRK-USDT-SWAP','BLUR':'BLUR-USDT-SWAP'
 };
 if(known[s]) return known[s];
 if(s.indexOf('USDT') >= 0) return s + '-SWAP';
 return s + '-USDT-SWAP';
}

function shortSym(pair){
 var s = pair.replace('-USDT-SWAP','').replace('-USD-SWAP','');
 if(s.indexOf('1000') === 0) return s.substring(4);
 if(s.indexOf('100') === 0 && s.length > 3) return s.substring(3);
 return s;
}

function calcLiq(side, entry, lev, mm){
 if(mm && mm > 0 && mm < 99){
  if(side === 'long') return entry * (1 - mm/100);
  return entry * (1 + mm/100);
 }
 if(side === 'long') return entry * (1 - 1/lev);
 return entry * (1 + 1/lev);
}

function fmtUSD(v){
 if(v === null || isNaN(v)) return '$0';
 if(Math.abs(v) >= 1000000) return '$' + (v/1000000).toFixed(2) + 'M';
 if(Math.abs(v) >= 1000) return '$' + v.toFixed(0);
 return '$' + v.toFixed(2);
}

function fmtPctClass(v, inv){
 if(inv){
  if(v >= 15) return 'safe';
  if(v >= 6) return 'warn';
  return 'danger';
 }
 if(v >= 70) return 'safe';
 if(v >= 40) return 'warn';
 return 'danger';
}

// ---- API calls ----
async function fetchTicker(pair){
 try{
  var res = await fetch('https://www.okx.com/api/v5/market/ticker?instId=' + encodeURIComponent(pair));
  var json = await res.json();
  if(json.code === '0' && json.data && json.data[0]){
   return {last: parseFloat(json.data[0].last)};
  }
 } catch(e){}
 return null;
}

async function fetchFunding(pair){
 try{
  var res = await fetch('https://www.okx.com/api/v5/public/funding-rate?instId=' + encodeURIComponent(pair));
  var json = await res.json();
  if(json.code === '0' && json.data && json.data[0]){
   return parseFloat(json.data[0].fundingRate);
  }
 } catch(e){}
 return 0;
}

async function fetchMM(pair, size, lev){
 var uly = pair.replace('-SWAP','').replace('-USDT','').replace('-USD','') + '-USD';
 try{
  var res = await fetch('https://www.okx.com/api/v5/public/position-tiers?instType=SWAP&tdMode=isolated&uly=' + encodeURIComponent(uly) + '&instId=' + encodeURIComponent(pair));
  var json = await res.json();
  if(json.code === '0' && json.data && json.data.length > 0){
   var tiers = json.data;
   for(var i = 0; i < tiers.length; i++){
    var t = tiers[i];
    var maxSz = parseFloat(t.maxSz);
    var minL = parseFloat(t.minLever);
    var maxL = parseFloat(t.maxLever);
    if(size <= maxSz && lev >= minL && lev <= maxL){
     return parseFloat(t.maintMarginRatio);
    }
   }
   if(tiers.length > 0) return parseFloat(tiers[tiers.length - 1].maintMarginRatio);
  }
 } catch(e){}
 return 0;
}

function calcFundingBurn(fr, notional){
 if(!fr || !notional) return 0;
 return notional * fr * 3; // ~3 funding periods per day
}

function calcHealth(distPct, fundingDrain, notional, worstDist, fundingScore){
 var score = 100;
 var d = (typeof worstDist === 'number') ? worstDist : distPct;
 if(d < 3) score -= 50;
 else if(d < 6) score -= 30;
 else if(d < 10) score -= 18;
 else if(d < 15) score -= 10;
 else if(d < 25) score -= 5;
 var drainPct = notional > 0 ? Math.abs(fundingDrain) / notional * 100 : 0;
 if(drainPct > 0.5) score -= 20;
 else if(drainPct > 0.2) score -= 10;
 else if(drainPct > 0.1) score -= 5;
 // penalise very high leverage
 if(score > 0){
  var avgLev = 0;
  var cnt = 0;
  APP.positions.forEach(function(p){ avgLev += p.leverage; cnt++; });
  avgLev = cnt > 0 ? avgLev/cnt : 0;
  if(avgLev > 50) score -= 15;
  else if(avgLev > 25) score -= 8;
  else if(avgLev > 10) score -= 3;
 }
 return Math.max(0, Math.min(100, Math.round(score)));
}

// ---- Core logic ----
async function addManualPos(){
 var sym = $('mPair').value.trim();
 var pair = resolvePair(sym);
 var side = $('mSide').value;
 var size = parseFloat($('mSize').value);
 var lev = parseInt($('mLev').value);
 var entry = parseFloat($('mEntry').value);
 if(!size || size < 1){ $('mStatus').textContent = 'Size must be at least 1 USDT.'; $('mStatus').className = 'status-line err'; return; }
 if(!entry || entry < 0.01){ $('mStatus').textContent = 'Enter a valid entry price.'; $('mStatus').className = 'status-line err'; return; }
 if(!lev || lev < 1){ $('mStatus').textContent = 'Leverage must be at least 1x.'; $('mStatus').className = 'status-line err'; return; }
 $('mStatus').textContent = 'Fetching market data for ' + pair + '...';
 $('mStatus').className = 'status-line';
 var ticker = await fetchTicker(pair);
 var markPrice = ticker ? ticker.last : 0;
 var fr = await fetchFunding(pair);
 var mm = await fetchMM(pair, size, lev);
 var liqPrice = calcLiq(side, entry, lev, mm || 0);
 var distPct = markPrice > 0 ? Math.abs((markPrice - liqPrice) / markPrice * 100) : 0;
 var notional = size * lev;
 var fundingDrain = calcFundingBurn(fr, notional);
 var pnl = side === 'long' ? (markPrice - entry) / entry * notional : (entry - markPrice) / entry * notional;
 if(isNaN(pnl)) pnl = 0;
 var health = calcHealth(distPct, fundingDrain, notional);
 var pos = {
  id: APP.nextId++,
  resolvedPair: pair,
  symbol: shortSym(pair),
  side: side,
  sizeUsdt: size,
  leverage: lev,
  entryPrice: entry,
  markPrice: markPrice || entry,
  liqPrice: liqPrice,
  distPct: distPct,
  fundingRate: fr,
  fundingDrain: fundingDrain,
  pnl: pnl,
  health: health,
  notional: notional,
  mm: mm || 0,
  createdAt: Date.now(),
  updatedAt: Date.now()
 };
 APP.positions.push(pos);
 recalcAll();
 updateWISelect();
 $('mStatus').textContent = 'Position added: ' + pos.symbol + ' ' + side + ' ' + lev + 'x | Liq at ' + liqPrice.toFixed(2);
 $('mStatus').className = 'status-line ok';
 switchTab('portfolio');
}

function removePos(id){
 if(!confirm('Remove this position?')) return;
 APP.positions = APP.positions.filter(function(p){ return p.id !== id; });
 recalcAll();
 updateWISelect();
}

async function refreshPosition(pos){
 var ticker = await fetchTicker(pos.resolvedPair);
 if(!ticker) return;
 pos.markPrice = ticker.last;
 var fr = await fetchFunding(pos.resolvedPair);
 pos.fundingRate = fr;
 pos.notional = pos.sizeUsdt * pos.leverage;
 pos.fundingDrain = calcFundingBurn(fr, pos.notional);
 var liqPrice = calcLiq(pos.side, pos.entryPrice, pos.leverage, pos.mm || 0);
 pos.liqPrice = liqPrice;
 pos.distPct = ticker.last > 0 ? Math.abs((ticker.last - liqPrice) / ticker.last * 100) : 0;
 pos.pnl = pos.side === 'long'
  ? (ticker.last - pos.entryPrice) / pos.entryPrice * pos.notional
  : (pos.entryPrice - ticker.last) / pos.entryPrice * pos.notional;
 if(isNaN(pos.pnl)) pos.pnl = 0;
 pos.updatedAt = Date.now();
}

async function refreshAllPositions(){
 for(var i = 0; i < APP.positions.length; i++){
  await refreshPosition(APP.positions[i]);
 }
 recalcAll();
 updateWISelect();
}

// ---- Rendering ----
function recalcAll(){
 var app = APP;
 var tbody = $('positionsBody');
 var noPos = $('noPositions');
 if(!tbody) return;
 if(app.positions.length === 0){
  $('noPositions').style.display = '';
  $('tableWrap').style.display = 'none';
  $('healthScoreVal').textContent = '--';
  $('healthSub').textContent = 'Add positions to see your score';
  $('healthBreakdown').innerHTML = '';
  $('scenarios').innerHTML =
   '<div style="color:var(--mist);font-size:12px;text-align:center;padding:20px">Add positions to see stress test results.</div>';
  $('portfolioSummary').textContent = '';
  var arc = document.getElementById('healthArc');
  if(arc){ arc.setAttribute('stroke-dashoffset', '188.5'); arc.setAttribute('stroke', '#4B8B6F'); }
  return;
 }
 $('noPositions').style.display = 'none';
 $('tableWrap').style.display = '';

 var totalNotional = 0, totalPnl = 0, totalFunding = 0, avgDist = 0, worstDist = 100;
 app.positions.forEach(function(p){
  totalNotional += p.notional;
  totalPnl += p.pnl;
  totalFunding += p.fundingDrain;
  avgDist += p.distPct;
  if(p.distPct < worstDist) worstDist = p.distPct;
 });
 avgDist = avgDist / app.positions.length;
 var healthScore = calcHealth(avgDist, totalFunding, totalNotional, worstDist, totalFunding);

 var rows = '';
 app.positions.forEach(function(p){
  var dc = fmtPctClass(p.distPct, true);
  var pc = p.pnl >= 0 ? 'safe' : 'danger';
  var hc = fmtPctClass(p.health, false);
  rows += '<tr>' +
   '<td class="pos-name" title="Click to remove">' + p.symbol + '</td>' +
   '<td>' + p.side + '</td>' +
   '<td>' + fmtUSD(p.sizeUsdt) + '</td>' +
   '<td>' + p.leverage + 'x</td>' +
   '<td>' + p.entryPrice.toFixed(1) + '</td>' +
   '<td>' + (p.markPrice ? p.markPrice.toFixed(1) : '--') + '</td>' +
   '<td class="' + dc + '">' + p.liqPrice.toFixed(1) + '</td>' +
   '<td class="' + dc + '">' + p.distPct.toFixed(1) + '%</td>' +
   '<td>' + fmtUSD(p.fundingDrain) + '</td>' +
   '<td class="' + pc + '">' + (p.pnl >= 0 ? '+' : '') + fmtUSD(p.pnl) + '</td>' +
   '<td class="' + hc + '">' + p.health + '</td>' +
   '<td class="remove-btn" onclick="removePos(' + p.id + ')" title="Remove">\u2716</td></tr>';
 });
 tbody.innerHTML = rows;

 $('healthScoreVal').textContent = healthScore;
 var sub = '';
 if(healthScore >= 70) sub = 'Healthy. Manageable risk across all positions.';
 else if(healthScore >= 40) sub = 'Caution. Consider reducing leverage on tightest positions.';
 else sub = 'CRITICAL. Positions dangerously close to liquidation.';
 $('healthSub').textContent = sub;

 $('healthBreakdown').innerHTML =
  '<span>Positions: ' + app.positions.length + '</span>' +
  '<span>Total Notional: ' + fmtUSD(totalNotional) + '</span>' +
  '<span>Total P&amp;L: <span class="' + (totalPnl >= 0 ? 'safe' : 'danger') + '">' +
  (totalPnl >= 0 ? '+' : '') + fmtUSD(totalPnl) + '</span></span>' +
  '<span>Funding/d: ' + fmtUSD(totalFunding) + '</span>' +
  '<span>Worst Dist: ' + worstDist.toFixed(1) + '%</span>';

 $('portfolioSummary').textContent = 'Total Notional: ' + fmtUSD(totalNotional) +
  ' | Total P&L: ' + (totalPnl >= 0 ? '+' : '') + fmtUSD(totalPnl) +
  ' | Daily Funding Burn: ' + fmtUSD(totalFunding);

 // Health ring
 var arc = document.getElementById('healthArc');
 if(arc){
  var dash = 188.5;
  var offset = dash - (healthScore / 100) * dash;
  arc.setAttribute('stroke-dashoffset', offset);
  if(healthScore >= 60) arc.setAttribute('stroke', '#4B8B6F');
  else if(healthScore >= 30) arc.setAttribute('stroke', '#C9A227');
  else arc.setAttribute('stroke', '#C1462F');
 }

 renderScenarios();
}

function renderScenarios(){
 if(APP.positions.length === 0){
  $('scenarios').innerHTML =
   '<div style="color:var(--mist);font-size:12px;text-align:center;padding:20px">Add positions to see stress test results.</div>';
  return;
 }
 var scenarios = [
  {name:'2022-style crash (-38%)', mag:0.38},
  {name:'Flash crash 15min (-23%)', mag:0.23},
  {name:'Correction (-12%)', mag:0.12},
  {name:'+10.10 Black Thursday (-48%)', mag:0.48}
 ];
 var html = '';
 scenarios.forEach(function(s){
  var liquidated = false;
  var minDist = 100;
  APP.positions.forEach(function(p){
   var shockMark = p.side === 'long' ? p.markPrice * (1 - s.mag) : p.markPrice * (1 + s.mag);
   var liq = p.liqPrice;
   var liqFlag = p.side === 'long' ? shockMark <= liq : shockMark >= liq;
   if(liqFlag) liquidated = true;
   var nd = liqFlag ? 0 : Math.abs((shockMark - liq) / shockMark * 100);
   if(nd < minDist) minDist = nd;
  });
  var safeLev = Math.max(1, Math.floor(1 / (s.mag + 0.05)));
  var hedgeNote = safeLev > 1 ? 'Survives if leverage <= ' + safeLev + 'x' : 'Requires position reduction';
  if(!liquidated && minDist > 5){
   html += '<div class="scenario"><h4>' + s.name + '</h4>' +
    '<div class="impact">' + minDist.toFixed(1) + '% buffer</div>' +
    '<p>Portfolio survives with buffer.</p>' +
    '<div class="hedge">' + hedgeNote + '</div></div>';
  } else if(!liquidated){
   html += '<div class="scenario"><h4>' + s.name + '</h4>' +
    '<div class="impact">' + minDist.toFixed(1) + '%</div>' +
    '<p>Barely survives. Tight buffer.</p>' +
    '<div class="hedge">' + hedgeNote + '</div></div>';
  } else {
   html += '<div class="scenario liquidated"><h4>' + s.name + '</h4>' +
    '<div class="impact">LIQUIDATED</div>' +
    '<p>One or more positions would be liquidated.</p>' +
    '<div class="hedge">' + hedgeNote + '</div></div>';
  }
 });
 $('scenarios').innerHTML = html;
}

// ---- What-If ----
function updateWISelect(){
 var sel = $('wiSelect');
 if(!sel) return;
 sel.innerHTML = '';
 if(APP.positions.length === 0){
  sel.innerHTML = '<option value="">-- Add a position first --</option>';
  return;
 }
 APP.positions.forEach(function(p){
  var opt = document.createElement('option');
  opt.value = p.id;
  opt.textContent = p.symbol + ' (' + p.side + ', ' + p.leverage + 'x)';
  sel.appendChild(opt);
 });
 setSliderForCurrent();
}

function setSliderForCurrent(){
 var sel = $('wiSelect');
 if(!sel || !sel.value){ $('wiResults').innerHTML = ''; return; }
 var pos = APP.positions.find(function(p){ return p.id == sel.value; });
 if(!pos) return;
 var slider = $('wiSlider');
 slider.value = pos.leverage;
 updateWhatIf();
}

function updateWhatIf(){
 var sel = $('wiSelect');
 if(!sel || !sel.value){ $('wiResults').innerHTML = ''; return; }
 var pos = APP.positions.find(function(p){ return p.id == sel.value; });
 if(!pos) return;
 var newLev = parseInt($('wiSlider').value);
 $('wiLevDisplay').textContent = newLev + 'x';
 var newLiq = calcLiq(pos.side, pos.entryPrice, newLev, pos.mm || 0);
 var newDist = pos.markPrice > 0 ? Math.abs((pos.markPrice - newLiq) / pos.markPrice * 100) : 0;
 var newNotional = pos.sizeUsdt * newLev;
 var newFundingDrain = calcFundingBurn(pos.fundingRate, newNotional);
 var health = calcHealth(newDist, newFundingDrain, newNotional);
 var dc = fmtPctClass(newDist, true);
 var delta = newLev - pos.leverage;
 $('wiResults').innerHTML =
  '<div>Current: ' + pos.leverage + 'x</div>' +
  '<div>New: ' + newLev + 'x ' + (delta > 0 ? '(+' + delta + ')' : delta < 0 ? '(' + delta + ')' : '') + '</div>' +
  '<div>Liq: <span class="' + dc + '">' + newLiq.toFixed(2) + '</span></div>' +
  '<div>Dist: <span class="' + dc + '">' + newDist.toFixed(1) + '%</span></div>' +
  '<div>Health: ' + health + '/100</div>' +
  '<div>Funding/d: ' + fmtUSD(newFundingDrain) + '</div>';
}

// ---- OKX API Import ----
async function fetchPositions(){
 var key = $('apiKey').value.trim();
 var secret = $('apiSecret').value.trim();
 var pass = $('apiPass').value.trim();
 var st = $('apiStatus');
 if(!key || !secret || !pass){
  st.textContent = 'Enter API key, secret and passphrase first.';
  st.className = 'status-line err';
  return;
 }
 st.textContent = 'Signing request and calling OKX...';
 st.className = 'status-line';
 try{
  var ts = new Date().toISOString();
  var method = 'GET';
  var requestPath = '/api/v5/account/positions';
  var body = '';
  var prehash = ts + method + requestPath + body;
  var sign = CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(prehash, secret));
  var res = await fetch('https://www.okx.com' + requestPath, {
   method: method,
   headers: {
    'OK-ACCESS-KEY': key,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': ts,
    'OK-ACCESS-PASSPHRASE': pass,
    'Content-Type': 'application/json'
   }
  });
  var json = await res.json();
  if(json.code === '0' && json.data){
   if(json.data.length === 0){
    st.textContent = 'No open positions found.';
    st.className = 'status-line ok';
    return;
   }
   var count = 0;
   for(var i = 0; i < json.data.length; i++){
    var p = json.data[i];
    var instId = p.instId;
    var posSide = p.posSide === 'short' ? 'short' : 'long';
    var lev = parseInt(p.lever) || 1;
    var sizeMargin = parseFloat(p.margin) || 0;
    var entryPx = parseFloat(p.avgPx) || 0;
    var markPx = parseFloat(p.markPx) || 0;
    var liqPx = parseFloat(p.liqPx) || 0;
    var upl = parseFloat(p.upl) || 0;
    var notional = parseFloat(p.notionalUsd) || (sizeMargin * lev);
    var sz = sizeMargin > 0 ? sizeMargin : notional / lev;
    if(liqPx <= 0) liqPx = calcLiq(posSide, entryPx || markPx, lev, 0);
    var dist = markPx > 0 ? Math.abs((markPx - liqPx) / markPx * 100) : 0;
    var fr = await fetchFunding(instId);
    var fundingDrain = calcFundingBurn(fr, notional);
    var posObj = {
     id: APP.nextId++,
     resolvedPair: instId,
     symbol: shortSym(instId),
     side: posSide,
     sizeUsdt: sz,
     leverage: lev,
     entryPrice: entryPx || markPx,
     markPrice: markPx,
     liqPrice: liqPx,
     distPct: dist,
     fundingRate: fr,
     fundingDrain: fundingDrain,
     pnl: upl,
     health: calcHealth(dist, fundingDrain, notional),
     notional: notional,
     mm: 0,
     createdAt: Date.now(),
     updatedAt: Date.now()
    };
    APP.positions.push(posObj);
    count++;
   }
   recalcAll();
   updateWISelect();
   st.textContent = count + ' position(s) imported.';
   st.className = 'status-line ok';
   switchTab('portfolio');
  } else {
   st.textContent = 'OKX error: ' + (json.msg || 'code ' + json.code);
   st.className = 'status-line err';
  }
 } catch(e){
  st.textContent = 'Browser blocked the call (CORS). Use manual import tab instead.';
  st.className = 'status-line err';
 }
}

// ---- Expose globals ----
window.switchTab = switchTab;
window.addManualPos = addManualPos;
window.removePos = removePos;
window.refreshAllPositions = refreshAllPositions;
window.fetchPositions = fetchPositions;
window.updateWhatIf = updateWhatIf;

// ---- Init ----
function init(){
 // wire slider
 $('wiSlider').addEventListener('input', updateWhatIf);
 $('wiSelect').addEventListener('change', setSliderForCurrent);
 recalcAll();
 updateWISelect();
 // auto-refresh every 60s
 setInterval(refreshAllPositions, 60000);
}
init();

})();
