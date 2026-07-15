// Sentinel v4 — Core Application Logic
;(function(){
'use strict';

var APP = window.SentinelApp = {
 positions: [],
 nextId: 1,
 priceCache: {},
 fundingCache: {},
 mmCache: {},
 inflightPairs: {},
 stressMode: 'cross',
 stressPosId: null
};
var $ = function(id){return document.getElementById(id);};
var S = function(s){return document.querySelector(s);};
var SA = function(s){return document.querySelectorAll(s);};

var KNOWN_PAIRS = {
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
 'EOS':'EOS-USDT-SWAP','LDO':'LDO-USDT-SWAP',
 'GMX':'GMX-USDT-SWAP','PENDLE':'PENDLE-USDT-SWAP',
 'STRK':'STRK-USDT-SWAP','BLUR':'BLUR-USDT-SWAP',
 'JUP':'JUP-USDT-SWAP','PYTH':'PYTH-USDT-SWAP',
 'ENA':'ENA-USDT-SWAP','ETHFI':'ETHFI-USDT-SWAP',
 'NOT':'NOT-USDT-SWAP','TURBO':'TURBO-USDT-SWAP',
 'W':'W-USDT-SWAP','TAO':'TAO-USDT-SWAP'
};

function resolvePair(sym){
 var s=sym.toUpperCase().trim();
 if(s.indexOf('-')>0) return s;
 if(s.indexOf('/')>0) return s.replace('/','-')+'-SWAP';
 if(KNOWN_PAIRS[s]) return KNOWN_PAIRS[s];
 if(s.indexOf('USDT')>=0) return s+'-SWAP';
 return s+'-USDT-SWAP';
}
function shortSym(pair){
 var s=pair.replace('-USDT-SWAP','').replace('-USD-SWAP','').replace('-USDT','');
 if(s.indexOf('1000')===0) return s.substring(4);
 if(s.indexOf('100')===0&&s.length>3) return s.substring(3);
 return s;
}
function fmtUSD(v){
 if(v===null||isNaN(v)) return '$0';
 if(Math.abs(v)>=1000000) return '$'+(v/1000000).toFixed(2)+'M';
 if(Math.abs(v)>=1000) return '$'+v.toFixed(0);
 return '$'+v.toFixed(2);
}
function calcLiq(side,entry,lev,mm){
 if(mm&&mm>0&&mm<99) return side==='long'?entry*(1-mm/100):entry*(1+mm/100);
 return side==='long'?entry*(1-1/lev):entry*(1+1/lev);
}
function calcFundingBurn(fr,notional){
 if(!fr||!notional) return 0;
 return notional*fr*3;
}
function calcHealth(distPct,fundingDrain,notional,worstDist){
 var score=100;
 var d=(typeof worstDist==='number')?worstDist:distPct;
 if(d<3)score-=50;else if(d<6)score-=30;else if(d<10)score-=18;else if(d<15)score-=10;else if(d<25)score-=5;
 var drainPct=notional>0?Math.abs(fundingDrain)/notional*100:0;
 if(drainPct>0.5)score-=20;else if(drainPct>0.2)score-=10;else if(drainPct>0.1)score-=5;
 if(score>0){
  var al=0,c=0;APP.positions.forEach(function(p){al+=p.leverage;c++;});
  al=c>0?al/c:0;
  if(al>50)score-=15;else if(al>25)score-=8;else if(al>10)score-=3;
 }
 return Math.max(0,Math.min(100,Math.round(score)));
}
function fmtPctClass(v,inv){
 if(inv){if(v>=15)return 'sa';if(v>=6)return 'wa';return 'da';}
 if(v>=70)return 'sa';if(v>=40)return 'wa';return 'da';
}

async function fetchTicker(pair){
 try{
  var r=await fetch('https://www.okx.com/api/v5/market/ticker?instId='+encodeURIComponent(pair));
  var j=await r.json();
  if(j.code==='0'&&j.data&&j.data[0]) return {last:parseFloat(j.data[0].last),chg:parseFloat(j.data[0].change24h)};
 }catch(e){}
 return null;
}
async function fetchFunding(pair){
 try{
  var r=await fetch('https://www.okx.com/api/v5/public/funding-rate?instId='+encodeURIComponent(pair));
  var j=await r.json();
  if(j.code==='0'&&j.data&&j.data[0]) return parseFloat(j.data[0].fundingRate);
 }catch(e){}
 return 0;
}

function switchTab(name){
 SA('.tab-content').forEach(function(e){e.classList.add('hd');});
 SA('.tb').forEach(function(e){e.classList.remove('ac');});
 var tc=$(name==='portfolio'?'tab-portfolio':name==='manual'?'tab-manual':name==='api'?'tab-api':name==='simulator'?'tab-simulator':name==='alerts'?'tab-alerts':'tab-about');
 if(tc)tc.classList.remove('hd');
 var m={'portfolio':'portfolio','manual':'add','api':'api','simulator':'simulator','alerts':'telegram','about':'about'};
 var mm=m[name]||name;
 SA('.tb').forEach(function(el){
  if(el.textContent.trim().toLowerCase().indexOf(mm)>=0) el.classList.add('ac');
 });
 if(name==='portfolio')recalcAll();
 if(name==='simulator')fetchSimPrice();
}

async function addManualPos(){
 var sym=$('mPair').value.trim();
 var pair=resolvePair(sym);
 var side=$('mSide').value;
 var size=parseFloat($('mSize').value);
 var lev=parseInt($('mLev').value);
 var entry=parseFloat($('mEntry').value);
 if(!size||size<1){$('mStatus').textContent='Size >= 1 USDT';$('mStatus').className='st er';return;}
 if(!entry||entry<0.01){$('mStatus').textContent='Valid entry needed';$('mStatus').className='st er';return;}
 $('mStatus').textContent='Fetching '+pair+'...';
 $('mStatus').className='st';
 var ticker=await fetchTicker(pair);
 var markPrice=ticker?ticker.last:0;
 var fr=await fetchFunding(pair);
 var mm=0;
 var liqPrice=calcLiq(side,entry,lev,mm||0);
 var distPct=markPrice>0?Math.abs((markPrice-liqPrice)/markPrice*100):0;
 var notional=size*lev;
 var fundingDrain=calcFundingBurn(fr,notional);
 var pnl=side==='long'?(markPrice-entry)/entry*notional:(entry-markPrice)/entry*notional;
 if(isNaN(pnl))pnl=0;
 var health=calcHealth(distPct,fundingDrain,notional);
 var pos={id:APP.nextId++,resolvedPair:pair,symbol:shortSym(pair),side:side,sizeUsdt:size,leverage:lev,entryPrice:entry,markPrice:markPrice||entry,liqPrice:liqPrice,distPct:distPct,fundingRate:fr,fundingDrain:fundingDrain,pnl:pnl,health:health,notional:notional,mm:mm||0,createdAt:Date.now(),updatedAt:Date.now()};
 APP.positions.push(pos);
 recalcAll();
 $('mStatus').textContent=pos.symbol+' '+side+' '+lev+'x | Liq at '+liqPrice.toFixed(2);
 $('mStatus').className='st ok';
 switchTab('portfolio');
}
function removePos(id){
 if(!confirm('Remove this position?'))return;
 APP.positions=APP.positions.filter(function(p){return p.id!==id;});
 recalcAll();
}
async function refreshPosition(pos){
 var t=await fetchTicker(pos.resolvedPair);
 if(!t)return;
 pos.markPrice=t.last;
 var fr=await fetchFunding(pos.resolvedPair);
 pos.fundingRate=fr;
 pos.notional=pos.sizeUsdt*pos.leverage;
 pos.fundingDrain=calcFundingBurn(fr,pos.notional);
 pos.liqPrice=calcLiq(pos.side,pos.entryPrice,pos.leverage,pos.mm||0);
 pos.distPct=t.last>0?Math.abs((t.last-pos.liqPrice)/t.last*100):0;
 pos.pnl=pos.side==='long'?(t.last-pos.entryPrice)/pos.entryPrice*pos.notional:(pos.entryPrice-t.last)/pos.entryPrice*pos.notional;
 if(isNaN(pos.pnl))pos.pnl=0;
 pos.updatedAt=Date.now();
}
async function refreshAllPositions(){
 for(var i=0;i<APP.positions.length;i++){await refreshPosition(APP.positions[i]);}
 recalcAll();
}

async function fetchSimPrice(){
 var sym=$('simSymbol').value.trim();
 var pair=resolvePair(sym);
 var dp=$('simPriceDisplay');
 dp.textContent='Fetching '+pair+'...';
 var ticker=await fetchTicker(pair);
 if(ticker){
  var c='';
  if(ticker.chg!==undefined&&!isNaN(ticker.chg)) c=ticker.chg>=0?' (+'+ticker.chg.toFixed(2)+'%)':' ('+ticker.chg.toFixed(2)+'%)';
  dp.innerHTML='<span style="font-size:16px;font-weight:600;color:var(--br)">$'+ticker.last.toFixed(2)+'</span><span style="color:var(--'+(ticker.chg>=0?'sa':'al')+')">'+c+'</span>';
  var me=$('simMark');
  if(me&&!me.value) me.value=ticker.last.toFixed(1);
 } else dp.textContent='Not found';
}

// Simulator
function simulate(){
 var sym=$('simSymbol').value.trim();
 var pair=resolvePair(sym);
 var side=$('simSide').value;
 var size=parseFloat($('simSize').value);
 var lev=parseInt($('simLev').value);
 var entry=parseFloat($('simEntry').value);
 var mark=parseFloat($('simMark').value)||entry;
 var res=$('simResults');
 if(!size||size<1||!lev||lev<1){res.innerHTML='<div class="nt er">Fill all fields.</div>';return;}
 var liqPrice=calcLiq(side,entry,lev,0);
 var distPct=Math.abs((mark-liqPrice)/mark*100);
 var notional=size*lev;
 var pnl=side==='long'?(mark-entry)/entry*notional:(entry-mark)/entry*notional;
 if(isNaN(pnl))pnl=0;
 var dc=fmtPctClass(distPct,true);
 res.innerHTML=
  '<div class="wc"><div class="wl">Liq Price</div><div class="wv '+dc+'">'+liqPrice.toFixed(2)+'</div></div>'+
  '<div class="wc"><div class="wl">Distance</div><div class="wv '+dc+'">'+distPct.toFixed(1)+'%</div></div>'+
  '<div class="wc"><div class="wl">Notional</div><div class="wv">'+fmtUSD(notional)+'</div></div>'+
  '<div class="wc"><div class="wl">P&amp;L</div><div class="wv '+(pnl>=0?'sa':'da')+'">'+(pnl>=0?'+':'')+fmtUSD(pnl)+'</div></div>'+
  '<div class="wc"><div class="wl">Pair</div><div class="wv" style="font-size:13px">'+pair+'</div></div>'+
  '<div class="wc"><div class="wl">Direction</div><div class="wv">'+side+'</div></div>';
 // show live slider
 var sliderWrap=$('simLevSlider');
 if(sliderWrap){
  sliderWrap.classList.remove('hd');
  var range=$('simLevRange');
  if(range)range.value=lev;
  updateSimLive();
 }
}

function updateSimLive(){
 var lev=parseInt($('simLevRange').value)||1;
 $('simLevDisplay').textContent=lev+'x';
 var sym=$('simSymbol').value.trim();
 var side=$('simSide').value;
 var size=parseFloat($('simSize').value)||0;
 var entry=parseFloat($('simEntry').value)||0;
 var mark=parseFloat($('simMark').value)||entry;
 if(!size||!entry||!mark)return;
 var liqPrice=calcLiq(side,entry,lev,0);
 var distPct=Math.abs((mark-liqPrice)/mark*100);
 var notional=size*lev;
 var pnl=side==='long'?(mark-entry)/entry*notional:(entry-mark)/entry*notional;
 if(isNaN(pnl))pnl=0;
 var dc=fmtPctClass(distPct,true);
 var live=$('simLiveResults');
 if(live){
  live.innerHTML=
   '<div class="wc"><div class="wl">Liq Price</div><div class="wv '+dc+'">'+liqPrice.toFixed(2)+'</div></div>'+
   '<div class="wc"><div class="wl">Distance</div><div class="wv '+dc+'">'+distPct.toFixed(1)+'%</div></div>'+
   '<div class="wc"><div class="wl">Notional</div><div class="wv">'+fmtUSD(notional)+'</div></div>'+
   '<div class="wc"><div class="wl">P&amp;L</div><div class="wv '+(pnl>=0?'sa':'da')+'">'+(pnl>=0?'+':'')+fmtUSD(pnl)+'</div></div>';
 }
}
function addSimToPortfolio(){
 var sym=$('simSymbol').value.trim();
 var pair=resolvePair(sym);
 var side=$('simSide').value;
 var size=parseFloat($('simSize').value);
 var lev=parseInt($('simLev').value);
 var entry=parseFloat($('simEntry').value);
 var mark=parseFloat($('simMark').value)||entry;
 if(!size||!entry){$('simStatus').textContent='Fill all fields.';$('simStatus').className='st er';return;}
 var liqPrice=calcLiq(side,entry,lev,0);
 var distPct=Math.abs((mark-liqPrice)/mark*100);
 var notional=size*lev;
 var pnl=side==='long'?(mark-entry)/entry*notional:(entry-mark)/entry*notional;
 if(isNaN(pnl))pnl=0;
 (async function(){
  var fr=await fetchFunding(pair);
  var fd=calcFundingBurn(fr,notional);
  var h=calcHealth(distPct,fd,notional);
  var pos={id:APP.nextId++,resolvedPair:pair,symbol:shortSym(pair),side:side,sizeUsdt:size,leverage:lev,entryPrice:entry,markPrice:mark,liqPrice:liqPrice,distPct:distPct,fundingRate:fr,fundingDrain:fd,pnl:pnl,health:h,notional:notional,mm:0,createdAt:Date.now(),updatedAt:Date.now()};
  APP.positions.push(pos);
  recalcAll();
  $('simStatus').textContent='Added: '+pos.symbol+' '+side+' '+lev+'x';
  $('simStatus').className='st ok';
 })();
}

// --- Stress Twin ---
function setStressMode(mode){
 APP.stressMode=mode;
 SA('#sctControl .sct-btn').forEach(function(b){b.classList.remove('ac');});
 SA('#sctControl .sct-btn').forEach(function(b){if(b.getAttribute('data-mode')===mode)b.classList.add('ac');});
 var wrap=$('stressIsolatedWrap');
 if(mode==='isolated'){
  wrap.style.display='';
  updateStressSelect();
 } else {
  wrap.style.display='none';
 }
 renderScenarios();
}
function updateStressSelect(){
 var sel=$('stressPosSelect');
 if(!sel)return;
 sel.innerHTML='<option value="">-- Select a position --</option>';
 APP.positions.forEach(function(p){
  var o=document.createElement('option');
  o.value=p.id;
  o.textContent=p.symbol+' '+p.side+' '+p.leverage+'x';
  sel.appendChild(o);
 });
 sel.onchange=function(){
  APP.stressPosId=this.value?parseInt(this.value):null;
  renderScenarios();
 };
}

function renderScenarios(){
 var ss=['2022 crash (-38%)','Flash crash (-23%)','Correction (-12%)','Black Thu (+10.10) (-48%)'];
 var mags=[0.38,0.23,0.12,0.48];
 var html='';
 if(APP.positions.length===0){
  $('scenarios').innerHTML='<div style="color:var(--mi);font-size:12px;text-align:center;padding:20px">Add positions to see stress test results.</div>';
  return;
 }
 for(var i=0;i<4;i++){
  var liq=false,md=100;
  var posList=[];
  if(APP.stressMode==='isolated'&&APP.stressPosId){
   var p=APP.positions.find(function(x){return x.id===APP.stressPosId;});
   if(p)posList=[p];
  } else {
   posList=APP.positions;
  }
  if(posList.length===0){
   html+='<div class="sc"><h4>'+ss[i]+'</h4><p style="color:var(--mi);font-size:11px;margin-top:6px">No position selected.</p></div>';
   continue;
  }
  posList.forEach(function(p){
   var sm=p.side==='long'?p.markPrice*(1-mags[i]):p.markPrice*(1+mags[i]);
   var lf=p.side==='long'?sm<=p.liqPrice:sm>=p.liqPrice;
   if(lf)liq=true;
   var nd=lf?0:Math.abs((sm-p.liqPrice)/sm*100);
   if(nd<md)md=nd;
  });
  var sl=Math.max(1,Math.floor(1/(mags[i]+0.05)));
  var hn=sl>1?'Safe leverage <= '+sl+'x':'Needs reduction';
  if(liq){
   html+='<div class="sc li"><h4>'+ss[i]+'</h4><div class="im">LIQUIDATED</div><p>One or more positions would be liquidated.</p><div class="h">'+hn+'</div></div>';
  } else if(md>5){
   html+='<div class="sc"><h4>'+ss[i]+'</h4><div class="im">'+md.toFixed(1)+'%</div><p>Survives with buffer.</p><div class="h">'+hn+'</div></div>';
  } else {
   html+='<div class="sc"><h4>'+ss[i]+'</h4><div class="im">'+md.toFixed(1)+'%</div><p>Barely survives.</p><div class="h">'+hn+'</div></div>';
  }
 }
 $('scenarios').innerHTML=html;
}

function recalcAll(){
 var tb=$('positionsBody');
 if(!tb)return;
 if(APP.positions.length===0){
  $('noPositions').style.display='';
  $('tableWrap').style.display='none';
  $('healthScoreVal').textContent='--';
  $('healthSub').textContent='Add positions to see your score';
  $('healthBreakdown').innerHTML='';
  renderScenarios();
  $('portfolioSummary').textContent='';
  var a=$('healthArc');
  if(a){a.setAttribute('stroke-dashoffset','188.5');a.setAttribute('stroke','#4B8B6F');}
  return;
 }
 $('noPositions').style.display='none';
 $('tableWrap').style.display='';
 var tn=0,tp=0,tf=0,ad=0,wd=100;
 APP.positions.forEach(function(p){tn+=p.notional;tp+=p.pnl;tf+=p.fundingDrain;ad+=p.distPct;if(p.distPct<wd)wd=p.distPct;});
 ad=ad/APP.positions.length;
 var hs=calcHealth(ad,tf,tn,wd);
 var rows='';
 APP.positions.forEach(function(p){
  var dc=fmtPctClass(p.distPct,true);
  var pc=p.pnl>=0?'sa':'da';
  var hc=fmtPctClass(p.health,false);
  rows+='<tr><td class="pos-name" onclick="removePos('+p.id+')" title="Click to remove">'+p.symbol+'</td><td>'+p.side+'</td><td>'+fmtUSD(p.sizeUsdt)+'</td><td>'+p.leverage+'x</td><td>'+p.entryPrice.toFixed(1)+'</td><td>'+(p.markPrice?p.markPrice.toFixed(1):'--')+'</td><td class="'+dc+'">'+p.liqPrice.toFixed(1)+'</td><td class="'+dc+'">'+p.distPct.toFixed(1)+'%</td><td>'+fmtUSD(p.fundingDrain)+'</td><td class="'+pc+'">'+(p.pnl>=0?'+':'')+fmtUSD(p.pnl)+'</td><td class="'+hc+'">'+p.health+'</td><td class="rm" onclick="removePos('+p.id+')" title="Remove">\u2716</td></tr>';
 });
 tb.innerHTML=rows;
 $('healthScoreVal').textContent=hs;
 var sub=hs>=70?'Healthy':hs>=40?'Caution':'CRITICAL';
 $('healthSub').textContent=sub;
 $('healthBreakdown').innerHTML='<span>Positions: '+APP.positions.length+'</span><span>Total Notional: '+fmtUSD(tn)+'</span><span>Total P&amp;L: <span class="'+(tp>=0?'sa':'da')+'">'+(tp>=0?'+':'')+fmtUSD(tp)+'</span></span><span>Funding/d: '+fmtUSD(tf)+'</span><span>Worst Dist: '+wd.toFixed(1)+'%</span>';
 $('portfolioSummary').textContent='Notional: '+fmtUSD(tn)+' | P&L: '+(tp>=0?'+':'')+fmtUSD(tp)+' | Funding: '+fmtUSD(tf);
 var a=$('healthArc');
 if(a){
  var d=188.5,o=d-(hs/100)*d;
  a.setAttribute('stroke-dashoffset',o);
  a.setAttribute('stroke',hs>=60?'#4B8B6F':hs>=30?'#C9A227':'#C1462F');
 }
 renderScenarios();
 if(APP.stressMode==='isolated')updateStressSelect();
}

// OKX API Import
async function fetchPositions(){
 var key=$('apiKey').value.trim();
 var secret=$('apiSecret').value.trim();
 var pass=$('apiPass').value.trim();
 var st=$('apiStatus');
 if(!key||!secret||!pass){st.textContent='Fill all fields.';st.className='st er';return;}
 st.textContent='Signing and calling OKX...';
 st.className='st';
 try{
  var ts=new Date().toISOString();
  var sign=CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(ts+'GET'+'/api/v5/account/positions',secret));
  var res=await fetch('https://www.okx.com/api/v5/account/positions',{
   method:'GET',headers:{
    'OK-ACCESS-KEY':key,
    'OK-ACCESS-SIGN':sign,
    'OK-ACCESS-TIMESTAMP':ts,
    'OK-ACCESS-PASSPHRASE':pass,
    'Content-Type':'application/json'
   }
  });
  var json=await res.json();
  if(json.code==='0'&&json.data){
   if(json.data.length===0){st.textContent='No open positions.';st.className='st ok';return;}
   var cnt=0;
   for(var i=0;i<json.data.length;i++){
    var p=json.data[i];
    var instId=p.instId,ps=p.posSide==='short'?'short':'long',lev=parseInt(p.lever)||1,
     sz=parseFloat(p.margin)||0,ep=parseFloat(p.avgPx)||0,mp=parseFloat(p.markPx)||0,
     lp=parseFloat(p.liqPx)||0,upl=parseFloat(p.upl)||0,nt=parseFloat(p.notionalUsd)||(sz*lev);
    if(sz<=0)sz=nt/lev;
    if(lp<=0)lp=calcLiq(ps,ep||mp,lev,0);
    var dist=mp>0?Math.abs((mp-lp)/mp*100):0;
    var fr=await fetchFunding(instId);
    var fd=calcFundingBurn(fr,nt);
    APP.positions.push({
     id:APP.nextId++,resolvedPair:instId,symbol:shortSym(instId),
     side:ps,sizeUsdt:sz,leverage:lev,entryPrice:ep||mp,
     markPrice:mp,liqPrice:lp,distPct:dist,
     fundingRate:fr,fundingDrain:fd,pnl:upl,
     health:calcHealth(dist,fd,nt),notional:nt,mm:0,
     createdAt:Date.now(),updatedAt:Date.now()
    });
    cnt++;
   }
   recalcAll();
   st.textContent=cnt+' position(s) imported.';
   st.className='st ok';
   switchTab('portfolio');
  } else {st.textContent='OKX error: '+(json.msg||'code '+json.code);st.className='st er';}
 }catch(e){st.textContent='CORS blocked. Use manual import.';st.className='st er';}
}

// Expose globals
window.switchTab=switchTab;
window.addManualPos=addManualPos;
window.removePos=removePos;
window.refreshAllPositions=refreshAllPositions;
window.fetchPositions=fetchPositions;
window.fetchSimPrice=fetchSimPrice;
window.simulate=simulate;
window.addSimToPortfolio=addSimToPortfolio;
window.updateSimLive=updateSimLive;
window.setStressMode=setStressMode;
window.recalcAll=recalcAll;

// Init
function init(){
 recalcAll();
 setStressMode('cross');
 setInterval(refreshAllPositions,60000);
}
init();
})();
