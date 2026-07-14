// Sentinel — Telegram Alerts Module
;(function(){
'use strict';

var APP = window.SentinelApp;
if(!APP){ console.error('SentinelApp not loaded'); return; }

var logEl = null;

function clearLog(){
 logEl = document.getElementById('alertsLog');
 if(logEl) logEl.innerHTML = '';
}

function addLog(msg){
 var el = document.getElementById('alertsLog');
 if(!el) return;
 if(el.textContent === 'No alerts yet.') el.innerHTML = '';
 el.innerHTML = '<div>[' + new Date().toLocaleTimeString() + '] ' + msg + '</div>' + el.innerHTML;
}

function startAlerts(){
 var token = document.getElementById('tgToken').value.trim();
 var chat = document.getElementById('tgChat').value.trim();
 var st = document.getElementById('tgStatus');
 if(!token || !chat){
  st.textContent = 'Enter bot token and chat ID first.';
  st.className = 'status-line err';
  return;
 }
 if(APP.tgRunning){
  st.textContent = 'Alert monitor already running.';
  st.className = 'status-line ok';
  return;
 }
 APP.tgToken = token;
 APP.tgChat = chat;
 APP.tgThreshold = parseFloat(document.getElementById('tgThreshold').value);
 APP.tgRunning = true;
 APP.tgLastSent = {};
 st.textContent = 'Monitor started. Checking every 30 seconds.';
 st.className = 'status-line ok';
 addLog('Monitor started (threshold: ' + APP.tgThreshold + '%)');
 APP.tgInterval = setInterval(tgCheck, 30000);
 tgCheck();
}

function stopAlerts(){
 APP.tgRunning = false;
 if(APP.tgInterval){
  clearInterval(APP.tgInterval);
  APP.tgInterval = null;
 }
 var st = document.getElementById('tgStatus');
 st.textContent = 'Monitor stopped.';
 st.className = 'status-line';
 addLog('Monitor stopped.');
}

async function tgCheck(){
 if(!APP.tgRunning || APP.positions.length === 0) return;
 for(var i = 0; i < APP.positions.length; i++){
  var p = APP.positions[i];
  if(APP.inflightPairs && APP.inflightPairs[p.resolvedPair + '_tg']) continue;
  if(APP.inflightPairs) APP.inflightPairs[p.resolvedPair + '_tg'] = true;
  try{
   var res = await fetch('https://www.okx.com/api/v5/market/ticker?instId=' + encodeURIComponent(p.resolvedPair));
   var json = await res.json();
   var ticker = null;
   if(json.code === '0' && json.data && json.data[0]) ticker = {last: parseFloat(json.data[0].last)};
   if(!ticker){ if(APP.inflightPairs) delete APP.inflightPairs[p.resolvedPair + '_tg']; continue; }
   p.markPrice = ticker.last;
   var liq = p.side === 'long'
    ? p.entryPrice * (1 - (p.mm && p.mm > 0 ? p.mm/100 : 1/p.leverage))
    : p.entryPrice * (1 + (p.mm && p.mm > 0 ? p.mm/100 : 1/p.leverage));
   p.liqPrice = liq;
   p.distPct = ticker.last > 0 ? Math.abs((ticker.last - liq) / ticker.last * 100) : 0;
   p.pnl = p.side === 'long'
    ? (ticker.last - p.entryPrice) / p.entryPrice * p.notional
    : (p.entryPrice - ticker.last) / p.entryPrice * p.notional;
   if(isNaN(p.pnl)) p.pnl = 0;
   if(p.distPct <= APP.tgThreshold){
    var last = APP.tgLastSent[p.id];
    if(!last || (Date.now() - last) > 300000){
     var msg = 'SENTINEL ALERT\n' + p.symbol + ' ' + p.side + ' ' + p.leverage + 'x (size: ' + p.sizeUsdt + ' USDT)\nDistance to liquidation: ' + p.distPct.toFixed(1) + '%\nLiquidation at: ' + liq.toFixed(2) + '\nCurrent mark: ' + ticker.last.toFixed(1) + '\nP&L: ' + (p.pnl >= 0 ? '+' : '') + p.pnl.toFixed(2) + ' USDT';
     try{
      var tgRes = await fetch('https://api.telegram.org/bot' + APP.tgToken + '/sendMessage', {
       method: 'POST',
       headers: {'Content-Type': 'application/json'},
       body: JSON.stringify({chat_id: APP.tgChat, text: msg})
      });
      var tgJson = await tgRes.json();
      if(tgJson.ok){
       APP.tgLastSent[p.id] = Date.now();
       addLog('Alert sent for ' + p.symbol + ' (dist: ' + p.distPct.toFixed(1) + '%)');
      } else {
       addLog('Telegram error: ' + (tgJson.description || 'unknown'));
      }
     } catch(e){
      addLog('Failed to send alert: ' + e.message);
     }
    }
   }
  } catch(e){}
  if(APP.inflightPairs) delete APP.inflightPairs[p.resolvedPair + '_tg'];
 }
 if(typeof window.SentinelApp_recalc === 'function'){
  window.SentinelApp_recalc();
 } else if(typeof recalcAll === 'function'){
  recalcAll();
 }
}

// ---- Expose ----
window.startAlerts = startAlerts;
window.stopAlerts = stopAlerts;
window.clearLog = clearLog;

})();
