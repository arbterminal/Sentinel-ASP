// Sentinel — Telegram Alerts v3
;(function(){
'use strict';

var APP = window.SentinelApp;
if(!APP){console.error('SentinelApp not found');return;}

var RUNNING = false;
var INTERVAL_ID = null;
var SNOOZE_UNTIL = 0;
var RECOVERY_SENT = {};

function addLog(msg){
 var el = document.getElementById('alertsLog');
 if(!el) return;
 if(el.textContent === 'No alerts yet.') el.innerHTML = '';
 el.innerHTML = '<div>' + msg + '</div>' + el.innerHTML;
}

function clearLog(){
 var el = document.getElementById('alertsLog');
 if(el) el.innerHTML = '';
}

function startAlerts(){
 var token = document.getElementById('tgToken').value.trim();
 var chat = document.getElementById('tgChat').value.trim();
 var st = document.getElementById('tgStatus');
 if(!token || !chat){
  st.textContent = 'Enter bot token and chat ID.';
  st.className = 'status-line err';
  return;
 }
 if(RUNNING){
  st.textContent = 'Already running.';
  st.className = 'status-line ok';
  return;
 }
 APP.tgToken = token;
 APP.tgChat = chat;
 APP.tgThreshold = parseFloat(document.getElementById('tgThreshold').value);
 APP.tgRepeatMs = parseInt(document.getElementById('tgRepeat').value) * 60 * 1000;
 APP.tgRecovery = document.getElementById('tgRecovery').checked;
 var intervalSec = parseInt(document.getElementById('tgIntervalSetting').value);
 RUNNING = true;
 SNOOZE_UNTIL = 0;
 RECOVERY_SENT = {};
 st.textContent = 'Monitor started.';
 st.className = 'status-line ok';
 document.getElementById('tgSnoozeStatus').textContent = '';
 addLog('\u{1F6F0} Monitor started | threshold: ' + APP.tgThreshold + '% | interval: ' + intervalSec + 's' + (APP.tgRepeatMs > 0 ? ' | repeat: ' + (APP.tgRepeatMs/60000) + 'min' : ' | no repeat'));
 INTERVAL_ID = setInterval(tgCheck, intervalSec * 1000);
 tgCheck();
}

function stopAlerts(){
 RUNNING = false;
 if(INTERVAL_ID){clearInterval(INTERVAL_ID);INTERVAL_ID=null;}
 var st = document.getElementById('tgStatus');
 st.textContent = 'Monitor stopped.';
 st.className = 'status-line';
 addLog('\u{1F6D1} Monitor stopped.');
}

function snoozeAlerts(hours){
 if(!RUNNING){
  document.getElementById('tgStatus').textContent = 'Start the monitor first.';
  document.getElementById('tgStatus').className = 'status-line err';
  return;
 }
 SNOOZE_UNTIL = Date.now() + hours * 3600 * 1000;
 document.getElementById('tgSnoozeStatus').textContent = 'Snoozed ' + hours + 'h (until ' + new Date(SNOOZE_UNTIL).toLocaleTimeString() + ')';
 addLog('\u{23F0} Alerts snoozed for ' + hours + ' hours.');
}

async function tgCheck(){
 if(!RUNNING || APP.positions.length === 0) return;
 var now = Date.now();
 var snoozed = now < SNOOZE_UNTIL;
 var threshold = APP.tgThreshold;
 var repeatMs = APP.tgRepeatMs;
 var recovery = APP.tgRecovery;

 for(var i=0;i<APP.positions.length;i++){
  var p = APP.positions[i];
  var inflightKey = p.resolvedPair + '_tg';
  if(APP.inflightPairs && APP.inflightPairs[inflightKey]) continue;
  if(APP.inflightPairs) APP.inflightPairs[inflightKey] = true;
  try{
   var res = await fetch('https://www.okx.com/api/v5/market/ticker?instId=' + encodeURIComponent(p.resolvedPair));
   var json = await res.json();
   if(json.code !== '0' || !json.data || !json.data[0]){ if(APP.inflightPairs) delete APP.inflightPairs[inflightKey]; continue; }
   var tickerLast = parseFloat(json.data[0].last);
   p.markPrice = tickerLast;
   var liq = p.side === 'long'
    ? p.entryPrice * (1 - (p.mm && p.mm > 0 ? p.mm/100 : 1/p.leverage))
    : p.entryPrice * (1 + (p.mm && p.mm > 0 ? p.mm/100 : 1/p.leverage));
   p.liqPrice = liq;
   p.distPct = tickerLast > 0 ? Math.abs((tickerLast - liq) / tickerLast * 100) : 0;
   p.pnl = p.side === 'long'
    ? (tickerLast - p.entryPrice) / p.entryPrice * p.notional
    : (p.entryPrice - tickerLast) / p.entryPrice * p.notional;
   if(isNaN(p.pnl)) p.pnl = 0;

   var isTriggered = p.distPct <= threshold;
   var pnlStr = (p.pnl >= 0 ? '+' : '') + p.pnl.toFixed(2) + ' USDT';
   var pnlEmoji = p.pnl >= 0 ? '\u{1F4C8}' : '\u{1F4C9}';
   var distEmoji = p.distPct <= 3 ? '\u{1F534}' : p.distPct <= 6 ? '\u{1F7E1}' : p.distPct <= 10 ? '\u{1F7E0}' : '\u{1F7E2}';
   var emoji = isTriggered ? '\u{1F6A8}' : '\u{2705}';
   var sideEmoji = p.side === 'long' ? '\u{1F7E2}' : '\u{1F534}';

   // Recovery check
   var wasTriggered = RECOVERY_SENT[p.id] && RECOVERY_SENT[p.id].triggered;
   if(recovery && !isTriggered && wasTriggered && RECOVERY_SENT[p.id] && now - RECOVERY_SENT[p.id].sentAt > 60000){
    delete RECOVERY_SENT[p.id];
    var rmsg = '\u{1F504} *POSITION RECOVERED* \u{1F504}\n' +
     '\u{1F539} ' + p.symbol + ' ' + sideEmoji + ' ' + p.side + ' | ' + p.leverage + 'x\n' +
     '\u{1F4CD} Distance to liq: ' + p.distPct.toFixed(1) + '% ' + distEmoji + '\n' +
     '\u{1F4B0} P&L: ' + pnlEmoji + ' ' + pnlStr + '\n' +
     '\u{1F4F0} Mark: $' + tickerLast.toFixed(2);
    if(APP.tgToken && APP.tgChat && !snoozed){
     try{
      var r = await fetch('https://api.telegram.org/bot' + APP.tgToken + '/sendMessage', {
       method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({
        chat_id:APP.tgChat,
        text:rmsg,
        parse_mode:'Markdown',
        reply_markup:JSON.stringify({inline_keyboard:[[{text:'\u{1F534} Snooze 1h',callback_data:'snooze_1'},{text:'\u{25B6} Continue',callback_data:'continue'},{text:'\u{1F6D1} Stop',callback_data:'stop'}]]})
       })
      });
      var rj = await r.json();
      if(rj.ok) addLog('\u{1F504} Recovery sent for ' + p.symbol);
     } catch(e){addLog('Recovery send failed: '+e.message);}
    }
   }

   // Trigger alert
   if(isTriggered && !snoozed){
    var last = APP.tgLastSent ? APP.tgLastSent[p.id] : 0;
    var shouldSend = !last || (now - last >= repeatMs);
    if(repeatMs === 0 && last) shouldSend = false;
    if(shouldSend){
     var msg = emoji + ' *SENTINEL LIQUIDATION ALERT* ' + emoji + '\n' +
      '\u{1F539} ' + p.symbol + ' ' + sideEmoji + ' ' + p.side + ' | ' + p.leverage + 'x\n' +
      '\u{1F4CB} Size: ' + p.sizeUsdt.toFixed(0) + ' USDT\n' +
      '\u{1F4C5} Entry: $' + p.entryPrice.toFixed(2) + ' | Mark: $' + tickerLast.toFixed(2) + '\n' +
      '\u{26A0} *Distance to liq: ' + p.distPct.toFixed(1) + '%* ' + distEmoji + '\n' +
      '\u{1F4A5} Liquidation at: $' + liq.toFixed(2) + '\n' +
      '\u{1F4B0} P&L: ' + pnlEmoji + ' ' + pnlStr + '\n' +
      '\u{23F0} ' + new Date().toLocaleString();
     try{
      var up = await fetch('https://api.telegram.org/bot' + APP.tgToken + '/sendMessage', {
       method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({
        chat_id:APP.tgChat,
        text:msg,
        parse_mode:'Markdown',
        reply_markup:JSON.stringify({inline_keyboard:[[{text:'\u{1F534} Snooze 1h',callback_data:'snooze_1'},{text:'\u{1F534} Snooze 4h',callback_data:'snooze_4'},{text:'\u{25B6} Continue',callback_data:'continue'},{text:'\u{1F6D1} Stop',callback_data:'stop'}]]})
       })
      });
      var uj = await up.json();
      if(uj.ok){
       if(APP.tgLastSent === undefined) APP.tgLastSent = {};
       APP.tgLastSent[p.id] = now;
       RECOVERY_SENT[p.id] = {triggered:true, sentAt: now};
       addLog('\u{1F6A8} Alert sent for ' + p.symbol + ' (dist: ' + p.distPct.toFixed(1) + '%)');
      } else {
       addLog('TG error: '+ (uj.description||'unknown'));
      }
     } catch(e){addLog('Alert send failed: '+e.message);}
    }
   }
  } catch(e){}
  if(APP.inflightPairs) delete APP.inflightPairs[inflightKey];
 }
 if(typeof recalcAll === 'function') recalcAll();
}

// --- Expose globals ---
window.startAlerts = startAlerts;
window.stopAlerts = stopAlerts;
window.snoozeAlerts = snoozeAlerts;
window.clearLog = clearLog;

})();
