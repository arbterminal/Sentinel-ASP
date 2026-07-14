// Sentinel — Core Application Logic v3
;(function(){
'use strict';

var APP = window.SentinelApp = {
 positions: [],
 nextId: 1,
 priceCache: {},
 fundingCache: {},
 mmCache: {},
 inflightPairs: {}
};

var $ = function(id){return document.getElementById(id);};

// --- Pair resolution ---
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
  'PEOPLE':'PEOPLE-USDT-SWAP','FIL':'FIL-USDT-SWAP',
  'TRX':'TRX-USDT-SWAP','ICP':'ICP-USDT-SWAP',
  'SAND':'SAND-USDT-SWAP','MANA':'MANA-USDT-SWAP',
  'APE':'APE-USDT-SWAP','FTM':'FTM-USDT-SWAP',
  'MATIC':'MATIC-USDT-SWAP','ALGO':'ALGO-USDT-SWAP',
  'EGLD':'EGLD-USDT-SWAP','SNX':'SNX-USDT-SWAP',
  'COMP':'COMP-USDT-SWAP','UNI':'UNI-USDT-SWAP',
  'ENS':'ENS-USDT-SWAP','YFI':'YFI-USDT-SWAP',
  'ZEC':'ZEC-USDT-SWAP','DASH':'DASH-USDT-SWAP',
  'EOS':'EOS-USDT-SWAP','TRB':'TRB-USDT-SWAP',
  'LDO':'LDO-USDT-SWAP','FXS':'FXS-USDT-SWAP',
  'GMX':'GMX-USDT-SWAP','RPL':'RPL-USDT-SWAP',
  'PENDLE':'PENDLE-USDT-SWAP','STRK':'STRK-USDT-SWAP',
  'BLUR':'BLUR-USDT-SWAP','JUP':'JUP-USDT-SWAP',
  'PYTH':'PYTH-USDT-SWAP','JTO':'JTO-USDT-SWAP',
  'TNSR':'TNSR-USDT-SWAP','ENA':'ENA-USDT-SWAP',
  'ETHFI':'ETHFI-USDT-SWAP','ALT':'ALT-USDT-SWAP',
  'REZ':'REZ-USDT-SWAP','BB':'BB-USDT-SWAP',
  'NOT':'NOT-USDT-SWAP','TURBO':'TURBO-USDT-SWAP'
 };
 if(known[s]) return known[s];
 if(s.indexOf('USDT') >= 0) return s + '-SWAP';
 return s + '-USDT-SWAP';
}

function shortSym(pair){
 var s = pair.replace('-USDT-SWAP','').replace('-USD-SWAP','').replace('-USDT','');
 if(s.indexOf('1000') === 0) return s.substring(4);
 if(s.indexOf('100') === 0 && s.length > 3) return s.substring(3);
 return s;
}

// --- Formatters ---
function fmtUSD(v){
 if(v === null || isNaN(v)) return '$0';
 if(Math.abs(v) >= 1000000) return '$' + (v/1000000).toFixed(2) + 'M';
 if(Math.abs(v) >= 1000) return '$' + v.toFixed(0);
 return '$' + v.toFixed(2);
}

// --- Calculations ---
function calcLiq(side, entry, lev, mm){
 if(mm && mm > 0 && mm < 99)
  return side === 'long' ? entry * (1 - mm/100) : entry * (1 + mm/100);
 return side === 'long' ? entry * (1 - 1/lev) : entry * (1 + 1/lev);
}

function calcFundingBurn(fr, notional){
 if(!fr || !notional) return 0;
 return notional * fr * 3;
}

function calcHealth(distPct, fundingDrain, notional, worstDist){
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
 if(score > 0){
  var avgLev = 0, cnt = 0;
  APP.positions.forEach(function(p){ avgLev += p.leverage; cnt++; });
  avgLev = cnt > 0 ? avgLev/cnt : 0;
  if(avgLev > 50) score -= 15;
  else if(avgLev > 25) score -= 8;
  else if(avgLev > 10) score -= 3;
 }
 return Math.max(0, Math.min(100, Math.round(score)));
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

// --- OKX API calls ---
async function fetchTicker(pair){
 try{
  var res = await fetch('https://www.okx.com/api/v5/market/ticker?instId=' + encodeURIComponent(pair));
  var json = await res.json();
  if(json.code === '0' && json.data && json.data[0]){
   return {last: parseFloat(json.data[0].last), chg: parseFloat(json.data[0].change24h)};
  }
 } catch(e){}
 return null;
}

async function fetchFunding(pair){
 try{
  var res = await fetch('https://www.okx.com/api/v5/public/funding-rate?instId=' + encodeURIComponent(pair));
  var json = await res.json();
  if(json.code === '0' && json.data && json.data[0])
   return parseFloat(json.data[0].fundingRate);
 } catch(e){}
 return 0;
}

async function fetchMM(pair, size, lev){
 var uly = pair.replace('-SWAP','').replace('-USDT','').replace('-USD','') + '-USD';
 try{
  var res = await fetch('https://www.okx.com/api/v5/public/position-tiers?instType=SWAP&tdMode=isolated&uly=' + encodeURIComponent(uly) + '&instId=' + encodeURIComponent(pair));
  var json = await res.json();
  if(json.code === '0' && json.data && json.data.length > 0){
   for(var i=0;i<json.data.length;i++){
    var t = json.data[i];
    if(size <= parseFloat(t.maxSz) && lev >= parseFloat(t.minLever) && lev <= parseFloat(t.maxLever))
     return parseFloat(t.maintMarginRatio);
   }
   return parseFloat(json.data[json.data.length-1].maintMarginRatio);
  }
 } catch(e){}
 return 0;
}

// --- Tab switching ---
function switchTab(name){
 document.querySelectorAll('.tab-content').forEach(function(e){e.classList.add('hidden');});
 document.querySelectorAll('.tab').forEach(function(e){e.classList.remove('active');});
 var tc = document.getElementById('tab-' + name);
 if(tc) tc.classList.remove('hidden');
 var map = {'portfolio':'portfolio','manual':'add','api':'api','simulator':'simulator','alerts':'telegram','about':'about'};
 var m = map[name] || name;
 document.querySelectorAll('.tab').forEach(function(el){
  if(el.textContent.trim().toLowerCase().indexOf(m) >= 0) el.classList.add('active');
 });
 if(name === 'portfolio') recalcAll();
 if(name === 'simulator'){
  fetchSimPrice();
 }
}

// --- Add manual position ---
async function addManualPos(){
 var sym = $('mPair').value.trim();
 var pair = resolvePair(sym);
 var side = $('mSide').value;
 var size = parseFloat($('mSize').value);
 var lev = parseInt($('mLev').value);
 var entry = parseFloat($('mEntry').value);
 if(!size||size<1){$('mStatus').textContent='Size >= 1 USDT';$('mStatus').className='status-line err';return;}
 if(!entry||entry<0.01){$('mStatus').textContent='Valid entry needed';$('mStatus').className='status-line err';return;}
 $('mStatus').textContent='Fetching ' + pair + '...';
 $('mStatus').className='status-line';
 var ticker = await fetchTicker(pair);
 var markPrice = ticker ? ticker.last : 0;
 var fr = await fetchFunding(pair);
 var mm = await fetchMM(pair, size, lev);
 var liqPrice = calcLiq(side, entry, lev, mm || 0);
 var distPct = markPrice > 0 ? Math.abs((markPrice - liqPrice) / markPrice * 100) : 0;
 var notional = size * lev;
 var fundingDrain = calcFundingBurn(fr, notional);
 var pnl = side === 'long'
  ? (markPrice - entry) / entry * notional
  : (entry - markPrice) / entry * notional;
 if(isNaN(pnl)) pnl = 0;
 var health = calcHealth(distPct, fundingDrain, notional);
 var pos = {
  id: APP.nextId++, resolvedPair: pair, symbol: shortSym(pair),
  side: side, sizeUsdt: size, leverage: lev,
  entryPrice: entry, markPrice: markPrice || entry,
  liqPrice: liqPrice, distPct: distPct,
  fundingRate: fr, fundingDrain: fundingDrain,
  pnl: pnl, health: health, notional: notional,
  mm: mm || 0, createdAt: Date.now(), updatedAt: Date.now()
 };
 APP.positions.push(pos);
 recalcAll();
 $('mStatus').textContent = pos.symbol + ' ' + side + ' ' + lev + 'x | Liq at ' + liqPrice.toFixed(2);
 $('mStatus').className = 'status-line ok';
 switchTab('portfolio');
}

function removePos(id){
 if(!confirm('Remove this position?')) return;
 APP.positions = APP.positions.filter(function(p){return p.id !== id;});
 recalcAll();
}

// --- Refresh single position ---
async function refreshPosition(pos){
 var ticker = await fetchTicker(pos.resolvedPair);
 if(!ticker) return;
 pos.markPrice = ticker.last;
 var fr = await fetchFunding(pos.resolvedPair);
 pos.fundingRate = fr;
 pos.notional = pos.sizeUsdt * pos.leverage;
 pos.fundingDrain = calcFundingBurn(fr, pos.notional);
 pos.liqPrice = calcLiq(pos.side, pos.entryPrice, pos.leverage, pos.mm || 0);
 pos.distPct = ticker.last > 0 ? Math.abs((ticker.last - pos.liqPrice) / ticker.last * 100) : 0;
 pos.pnl = pos.side === 'long'
  ? (ticker.last - pos.entryPrice) / pos.entryPrice * pos.notional
  : (pos.entryPrice - ticker.last) / pos.entryPrice * pos.notional;
 if(isNaN(pos.pnl)) pos.pnl = 0;
 pos.updatedAt = Date.now();
}

async function refreshAllPositions(){
 for(var i=0;i<APP.positions.length;i++){
  await refreshPosition(APP.positions[i]);
 }
 recalcAll();
}

// --- Price ticker ---
async function fetchSimPrice(){
 var sym = $('simPair').value.trim();
 var pair = resolvePair(sym);
 var display = $('simPriceDisplay');
 display.textContent = 'Fetching ' + pair + '...';
 var ticker = await fetchTicker(pair);
 if(ticker){
  var chgStr = '';
  if(ticker.chg !== undefined && !isNaN(ticker.chg)){
   chgStr = ticker.chg >= 0 ? ' (+' + ticker.chg.toFixed(2) + '%)' : ' (' + ticker.chg.toFixed(2) + '%)';
  }
  display.innerHTML = '<span style="font-size:16px;font-weight:600;color:var(--brass)">$' + ticker.last.toFixed(2) + '</span><span style="color:var(--' + (ticker.chg >= 0 ? 'safe' : 'alert') + ')">' + chgStr + '</span>';
  var markEl = $('simMark');
  if(markEl && !markEl.value) markEl.value = ticker.last.toFixed(1);
 } else {
  display.textContent = 'Price not found for ' + pair;
 }
}

// --- Simulator ---
function simulate(){
 var sym = $('simSymbol').value.trim();
 var pair = resolvePair(sym);
 var side = $('simSide').value;
 var size = parseFloat($('simSize').value);
 var lev = parseInt($('simLev').value);
 var entry = parseFloat($('simEntry').value);
 var mark = parseFloat($('simMark').value) || entry;
 var res = $('simResults');
 if(!size||size<1||!lev||lev<1){res.innerHTML='<div class="note err">Enter size and leverage.</div>';return;}
 var mm = 0; // simplified for simulator
 var liqPrice = calcLiq(side, entry, lev, mm);
 var distPct = Math.abs((mark - liqPrice) / mark * 100);
 var notional = size * lev;
 var pnl = side === 'long'
  ? (mark - entry) / entry * notional
  : (entry - mark) / entry * notional;
 if(isNaN(pnl)) pnl = 0;
 var dc = fmtPctClass(distPct, true);
 res.innerHTML =
  '<div class="what-if-card"><div class="wi-label">Liquidation Price</div><div class="wi-value ' + dc + '">' + liqPrice.toFixed(2) + '</div></div>' +
  '<div class="what-if-card"><div class="wi-label">Distance to Liq</div><div class="wi-value ' + dc + '">' + distPct.toFixed(1) + '%</div></div>' +
  '<div class="what-if-card"><div class="wi-label">Notional</div><div class="wi-value">' + fmtUSD(notional) + '</div></div>' +
  '<div class="what-if-card"><div class="wi-label">Unrealized P&amp;L</div><div class="wi-value ' + (pnl>=0?'safe':'danger') + '">' + (pnl>=0?'+':'') + fmtUSD(pnl) + '</div></div>' +
  '<div class="what-if-card"><div class="wi-label">Pair</div><div class="wi-value" style="font-size:13px">' + pair + '</div></div>' +
  '<div class="what-if-card"><div class="wi-label">Direction</div><div class="wi-value">' + side + '</div></div>';
}

function addSimToPortfolio(){
 var sym = $('simSymbol').value.trim();
 var pair = resolvePair(sym);
 var side = $('simSide').value;
 var size = parseFloat($('simSize').value);
 var lev = parseInt($('simLev').value);
 var entry = parseFloat($('simEntry').value);
 var mark = parseFloat($('simMark').value) || entry;
 if(!size||!entry){$('simStatus').textContent='Fill all fields first.';$('simStatus').className='status-line err';return;}
 var liqPrice = calcLiq(side, entry, lev, 0);
 var distPct = Math.abs((mark - liqPrice) / mark * 100);
 var notional = size * lev;
 var pnl = side === 'long' ? (mark-entry)/entry*notional : (entry-mark)/entry*notional;
 if(isNaN(pnl)) pnl = 0;
 var fr = 0;
 (async function(){
  fr = await fetchFunding(pair);
  var fundingDrain = calcFundingBurn(fr, notional);
  var health = calcHealth(distPct, fundingDrain, notional);
  var pos = {
   id:APP.nextId++, resolvedPair:pair, symbol:shortSym(pair),
   side:side, sizeUsdt:size, leverage:lev,
   entryPrice:entry, markPrice:mark, liqPrice:liqPrice,
   distPct:distPct, fundingRate:fr, fundingDrain:fundingDrain,
   pnl:pnl, health:health, notional:notional, mm:0,
   createdAt:Date.now(), updatedAt:Date.now()
  };
  APP.positions.push(pos);
  recalcAll();
  $('simStatus').textContent = 'Added: ' + pos.symbol + ' ' + side + ' ' + lev + 'x';
  $('simStatus').className = 'status-line ok';
 })();
}

// --- Rendering ---
function recalcAll(){
 var tbody = $('positionsBody');
 if(!tbody) return;
 var noPos = $('noPositions');
 if(APP.positions.length === 0){
  noPos.style.display = '';
  $('tableWrap').style.display = 'none';
  $('healthScoreVal').textContent = '--';
  $('healthSub').textContent = 'Add positions to see your score';
  $('healthBreakdown').innerHTML = '';
  $('scenarios').innerHTML = '<div style="color:var(--mist);font-size:12px;text-align:center;padding:20px">Add positions to see stress test results.</div>';
  $('portfolioSummary').textContent = '';
  var arc = document.getElementById('healthArc');
  if(arc){arc.setAttribute('stroke-dashoffset','188.5');arc.setAttribute('stroke','#4B8B6F');}
  return;
 }
 noPos.style.display = 'none';
 $('tableWrap').style.display = '';
 var tn=0,tp=0,tf=0,ad=0,wd=100;
 APP.positions.forEach(function(p){
  tn+=p.notional;tp+=p.pnl;tf+=p.fundingDrain;ad+=p.distPct;
  if(p.distPct<wd)wd=p.distPct;
 });
 ad = ad/APP.positions.length;
 var hs = calcHealth(ad,tf,tn,wd);
 var rows = '';
 APP.positions.forEach(function(p){
  var dc = fmtPctClass(p.distPct,true);
  var pc = p.pnl>=0?'safe':'danger';
  var hc = fmtPctClass(p.health,false);
  rows += '<tr><td class="pos-name" title="Click to remove" onclick="removePos('+p.id+')">'+p.symbol+'</td>'+
   '<td>'+p.side+'</td><td>'+fmtUSD(p.sizeUsdt)+'</td><td>'+p.leverage+'x</td>'+
   '<td>'+p.entryPrice.toFixed(1)+'</td><td>'+(p.markPrice?p.markPrice.toFixed(1):'--')+'</td>'+
   '<td class="'+dc+'">'+p.liqPrice.toFixed(1)+'</td><td class="'+dc+'">'+p.distPct.toFixed(1)+'%</td>'+
   '<td>'+fmtUSD(p.fundingDrain)+'</td><td class="'+pc+'">'+(p.pnl>=0?'+':'')+fmtUSD(p.pnl)+'</td>'+
   '<td class="'+hc+'">'+p.health+'</td>'+
   '<td class="remove-btn" onclick="removePos('+p.id+')" title="Remove">\u2716</td></tr>';
 });
 tbody.innerHTML = rows;
 $('healthScoreVal').textContent = hs;
 var sub = hs>=70?'Healthy. Manageable risk across all positions.':hs>=40?'Caution. Consider reducing leverage on tightest positions.':'CRITICAL. Positions dangerously close to liquidation.';
 $('healthSub').textContent = sub;
 $('healthBreakdown').innerHTML =
  '<span>Positions: '+APP.positions.length+'</span>'+
  '<span>Total Notional: '+fmtUSD(tn)+'</span>'+
  '<span>Total P&amp;L: <span class="'+(tp>=0?'safe':'danger')+'">'+(tp>=0?'+':'')+fmtUSD(tp)+'</span></span>'+
  '<span>Funding/d: '+fmtUSD(tf)+'</span>'+
  '<span>Worst Dist: '+wd.toFixed(1)+'%</span>';
 $('portfolioSummary').textContent = 'Total Notional: '+fmtUSD(tn)+' | P&L: '+(tp>=0?'+':'')+fmtUSD(tp)+' | Funding: '+fmtUSD(tf);
 var arc = document.getElementById('healthArc');
 if(arc){
  var d = 188.5, o = d-(hs/100)*d;
  arc.setAttribute('stroke-dashoffset',o);
  arc.setAttribute('stroke',hs>=60?'#4B8B6F':hs>=30?'#C9A227':'#C1462F');
 }
 renderScenarios();
}

function renderScenarios(){
 if(APP.positions.length===0){
  $('scenarios').innerHTML='<div style="color:var(--mist);font-size:12px;text-align:center;padding:20px">Add positions to see stress test results.</div>';
  return;
 }
 var scenarios=[
  {name:'2022-style crash (-38%)',mag:0.38},
  {name:'Flash crash 15min (-23%)',mag:0.23},
  {name:'Correction (-12%)',mag:0.12},
  {name:'+10.10 Black Thursday (-48%)',mag:0.48}
 ];
 var html='';
 scenarios.forEach(function(s){
  var liq=false,md=100;
  APP.positions.forEach(function(p){
   var sm = p.side==='long'?p.markPrice*(1-s.mag):p.markPrice*(1+s.mag);
   var li = p.liqPrice;
   var lf = p.side==='long'?sm<=li:sm>=li;
   if(lf)liq=true;
   var nd = lf?0:Math.abs((sm-li)/sm*100);
   if(nd<md)md=nd;
  });
  var sl = Math.max(1,Math.floor(1/(s.mag+0.05)));
  var hn = sl>1?'Survives if leverage <= '+sl+'x':'Needs position reduction';
  if(!liq&&md>5){
   html+='<div class="scenario"><h4>'+s.name+'</h4><div class="impact">'+md.toFixed(1)+'% buffer</div><p>Survives.</p><div class="hedge">'+hn+'</div></div>';
  }else if(!liq){
   html+='<div class="scenario"><h4>'+s.name+'</h4><div class="impact">'+md.toFixed(1)+'%</div><p>Barely.</p><div class="hedge">'+hn+'</div></div>';
  }else{
   html+='<div class="scenario liquidated"><h4>'+s.name+'</h4><div class="impact">LIQUIDATED</div><p>One or more positions liquidated.</p><div class="hedge">'+hn+'</div></div>';
  }
 });
 $('scenarios').innerHTML=html;
}

// --- OKX API Import ---
async function fetchPositions(){
 var key=$('apiKey').value.trim();
 var secret=$('apiSecret').value.trim();
 var pass=$('apiPass').value.trim();
 var st=$('apiStatus');
 if(!key||!secret||!pass){st.textContent='Fill all fields.';st.className='status-line err';return;}
 st.textContent='Signing and calling OKX...';
 st.className='status-line';
 try{
  var ts=new Date().toISOString();
  var prehash=ts+'GET'+'/api/v5/account/positions';
  var sign=CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(prehash,secret));
  var res=await fetch('https://www.okx.com/api/v5/account/positions',{
   method:'GET',
   headers:{
    'OK-ACCESS-KEY':key,
    'OK-ACCESS-SIGN':sign,
    'OK-ACCESS-TIMESTAMP':ts,
    'OK-ACCESS-PASSPHRASE':pass,
    'Content-Type':'application/json'
   }
  });
  var json=await res.json();
  if(json.code==='0'&&json.data){
   if(json.data.length===0){st.textContent='No open positions.';st.className='status-line ok';return;}
   var cnt=0;
   for(var i=0;i<json.data.length;i++){
    var p=json.data[i];
    var instId=p.instId;
    var ps=p.posSide==='short'?'short':'long';
    var lev=parseInt(p.lever)||1;
    var sz=parseFloat(p.margin)||0;
    var ep=parseFloat(p.avgPx)||0;
    var mp=parseFloat(p.markPx)||0;
    var lp=parseFloat(p.liqPx)||0;
    var upl=parseFloat(p.upl)||0;
    var notional=parseFloat(p.notionalUsd)||(sz*lev);
    if(sz<=0)sz=notional/lev;
    if(lp<=0)lp=calcLiq(ps,ep||mp,lev,0);
    var dist=mp>0?Math.abs((mp-lp)/mp*100):0;
    var fr=await fetchFunding(instId);
    var fd=calcFundingBurn(fr,notional);
    var h=calcHealth(dist,fd,notional);
    APP.positions.push({
     id:APP.nextId++,resolvedPair:instId,symbol:shortSym(instId),
     side:ps,sizeUsdt:sz,leverage:lev,entryPrice:ep||mp,
     markPrice:mp,liqPrice:lp,distPct:dist,
     fundingRate:fr,fundingDrain:fd,pnl:upl,
     health:h,notional:notional,mm:0,
     createdAt:Date.now(),updatedAt:Date.now()
    });
    cnt++;
   }
   recalcAll();
   st.textContent=cnt+' position(s) imported.';
   st.className='status-line ok';
   switchTab('portfolio');
  } else {
   st.textContent='OKX error: '+(json.msg||'code '+json.code);
   st.className='status-line err';
  }
 }catch(e){
  st.textContent='CORS blocked the call. Use manual import tab.';
  st.className='status-line err';
 }
}

// --- Expose globals ---
window.switchTab=switchTab;
window.addManualPos=addManualPos;
window.removePos=removePos;
window.refreshAllPositions=refreshAllPositions;
window.fetchPositions=fetchPositions;
window.fetchSimPrice=fetchSimPrice;
window.simulate=simulate;
window.addSimToPortfolio=addSimToPortfolio;

// --- Init ---
function init(){
 recalcAll();
 // Auto-refresh every 60s
 setInterval(refreshAllPositions, 60000);
}
init();

})();
