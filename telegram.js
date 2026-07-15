// Sentinel - Telegram Alerts v4
;(function(){
'use strict';

var APP = window.SentinelApp;
if(!APP){console.error('SentinelApp not found');return;}

var RUNNING = false;
var INTERVAL = null;
var SNOOZE_UNTIL = 0;
var RECOVERY_SENT = {};

function el(id){return document.getElementById(id);}
function addLog(msg){
 var l = el('alertsLog');
 if(!l)return;
 if(l.textContent === 'No alerts yet.') l.innerHTML = '';
 l.innerHTML = '<div>'+msg+'</div>'+l.innerHTML;
}
function clearLog(){
 var l = el('alertsLog');
 if(l) l.innerHTML = '';
}

function startAlerts(){
 var token = el('tgToken').value.trim();
 var chat = el('tgChat').value.trim();
 var st = el('tgStatus');
 if(!token || !chat){ st.textContent = 'Enter bot token and chat ID.'; st.className = 'st er'; return; }
 if(RUNNING){ st.textContent = 'Already running.'; st.className = 'st ok'; return; }

 APP.tgToken = token;
 APP.tgChat = chat;
 APP.tgThreshold = parseFloat(el('tgThreshold').value);
 APP.tgRepeatMs = parseInt(el('tgRepeat').value) * 60 * 1000;
 APP.tgRecovery = el('tgRecovery').checked;

 var intervalSec = parseInt(el('tgIntervalSetting').value);
 RUNNING = true;
 SNOOZE_UNTIL = 0;
 RECOVERY_SENT = {};
 if(!APP.tgLastSent) APP.tgLastSent = {};

 st.textContent = 'Monitoring ' + APP.positions.length + ' position(s)';
 st.className = 'st ok';
 el('tgSnoozeStatus').textContent = '';
 addLog('Monitor started | threshold: '+APP.tgThreshold+'% | interval: '+intervalSec+'s');

 if(INTERVAL) clearInterval(INTERVAL);
 INTERVAL = setInterval(tgCheck, intervalSec * 1000);

 if(APP.positions.length > 0) tgCheck();
}

function stopAlerts(){
 RUNNING = false;
 if(INTERVAL){ clearInterval(INTERVAL); INTERVAL = null; }
 el('tgStatus').textContent = 'Monitor stopped.';
 el('tgStatus').className = 'st';
 addLog('Monitor stopped.');
}

function snoozeAlerts(hours){
 if(!RUNNING){ el('tgStatus').textContent = 'Start the monitor first.'; el('tgStatus').className = 'st er'; return; }
 SNOOZE_UNTIL = Date.now() + hours * 3600000;
 el('tgSnoozeStatus').textContent = 'Snoozed '+hours+'h (until '+new Date(SNOOZE_UNTIL).toLocaleTimeString()+')';
 addLog('Snoozed for '+hours+' hours.');
}

async function tgCheck(){
 if(!RUNNING || APP.positions.length === 0) return;

 var now = Date.now();
 var snoozed = now < SNOOZE_UNTIL;
 var threshold = APP.tgThreshold;
 var repeatMs = APP.tgRepeatMs;
 var recovery = APP.tgRecovery;
 var token = APP.tgToken;
 var chat = APP.tgChat;

 if(!token || !chat){ return; }

 for(var i = 0; i < APP.positions.length; i++){
  var p = APP.positions[i];
  if(!p || !p.resolvedPair) continue;

  // Check if this pair has an in-flight request
  var pairKey = p.resolvedPair;
  if(APP.inflightPairs && APP.inflightPairs[pairKey]) continue;
  if(APP.inflightPairs) APP.inflightPairs[pairKey] = true;

  try{
   var r = await fetch('https://www.okx.com/api/v5/market/ticker?instId=' + encodeURIComponent(p.resolvedPair));
   var j = await r.json();
   if(j.code !== '0' || !j.data || !j.data[0]){
    if(APP.inflightPairs) delete APP.inflightPairs[pairKey];
    continue;
   }

   var mark = parseFloat(j.data[0].last);
   if(isNaN(mark) || mark <= 0){
    if(APP.inflightPairs) delete APP.inflightPairs[pairKey];
    continue;
   }

   p.markPrice = mark;
   var mm = p.mm || 0;
   var liq = p.side === 'long'
    ? p.entryPrice * (1 - (mm > 0 ? mm/100 : 1/p.leverage))
    : p.entryPrice * (1 + (mm > 0 ? mm/100 : 1/p.leverage));
   p.liqPrice = liq;
   p.distPct = Math.abs((mark - liq) / mark * 100);
   p.pnl = p.side === 'long'
    ? (mark - p.entryPrice) / p.entryPrice * p.notional
    : (p.entryPrice - mark) / p.entryPrice * p.notional;
   if(isNaN(p.pnl)) p.pnl = 0;

   var triggered = p.distPct <= threshold;
   var pnlStr = (p.pnl >= 0 ? '+' : '') + p.pnl.toFixed(2) + ' USDT';
   var sideEmoji = p.side === 'long' ? '\\u{1F7E2}' : '\\u{1F534}';
   var distEmoji = p.distPct <= 3 ? '\\u{1F534}' : p.distPct <= 6 ? '\\u{1F7E1}' : p.distPct <= 10 ? '\\u{1F7E0}' : '\\u{1F7E2}';

   // Recovery notification
   if(recovery && !triggered && RECOVERY_SENT[p.id] && now - RECOVERY_SENT[p.id].sentAt > 60000){
    var wasTriggered = RECOVERY_SENT[p.id] && RECOVERY_SENT[p.id].triggered;
    if(wasTriggered){
     delete RECOVERY_SENT[p.id];
     var fundStr = p.fundingRate !== undefined ? 'Funding: ' + (p.fundingRate*100).toFixed(4) + '% | ' + (p.fundingDrain >= 0 ? '+' : '') + p.fundingDrain.toFixed(2) + ' USDT/d' : '';
     var rmsg = '\\u{1F504} SENTINEL RECOVERY NOTIFICATION \\u{1F504}\\n' +
      '```\\n' +
      'Position: ' + p.symbol + ' ' + sideEmoji + ' ' + p.side + ' | ' + p.leverage + 'x\\n' +
      'Distance: ' + p.distPct.toFixed(1) + '%\\n' +
      'Liq at:  $' + liq.toFixed(2) + '\\n' +
      'Mark:    $' + mark.toFixed(2) + '\\n' +
      'P&L:     ' + pnlStr + '\\n' +
      fundStr + '\\n' +
      '```';

     try{
      var rr = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
       method: 'POST',
       headers: {'Content-Type': 'application/json'},
       body: JSON.stringify({
        chat_id: chat,
        text: rmsg,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[
         {text:'Snooze 1h', callback_data:'snooze_1'},
         {text:'Snooze 4h', callback_data:'snooze_4'},
         {text:'Continue', callback_data:'continue'},
         {text:'Stop', callback_data:'stop'}
        ]]}
       })
      });
      var rj = await rr.json();
      if(rj.ok) addLog('Recovery sent for ' + p.symbol);
      else addLog('Recovery error: '+(rj.description||'unknown'));
     }catch(e){ addLog('Recovery fail: '+e.message); }
    }
   }

   // Liquidation alert
   if(triggered && !snoozed){
    var lastSent = APP.tgLastSent[p.id] || 0;
    var shouldSend = (now - lastSent >= repeatMs);
    if(repeatMs === 0 && lastSent > 0) shouldSend = false;

    if(shouldSend){
     var fundStr2 = p.fundingRate !== undefined ? 'Funding: ' + (p.fundingRate*100).toFixed(4) + '% | ' + (p.fundingDrain >= 0 ? '+' : '') + p.fundingDrain.toFixed(2) + ' USDT/d' : '';
     var msg = '\\u{1F6A8} SENTINEL LIQUIDATION ALERT \\u{1F6A8}\\n' +
      '```\\n' +
      'Position: ' + p.symbol + ' ' + sideEmoji + ' ' + p.side + ' | ' + p.leverage + 'x\\n' +
      'Size:     ' + p.sizeUsdt.toFixed(0) + ' USDT\\n' +
      'Entry:    $' + p.entryPrice.toFixed(2) + '\\n' +
      'Mark:     $' + mark.toFixed(2) + '\\n' +
      'Liq at:   $' + liq.toFixed(2) + '\\n' +
      'Dist:     ' + p.distPct.toFixed(1) + '% ' + distEmoji + '\\n' +
      'P&L:      ' + pnlStr + '\\n' +
      fundStr2 + '\\n' +
      'Time:     ' + new Date().toLocaleString() + '\\n' +
      '```';

     try{
      var up = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
       method: 'POST',
       headers: {'Content-Type': 'application/json'},
       body: JSON.stringify({
        chat_id: chat,
        text: msg,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[
         {text:'Snooze 1h', callback_data:'snooze_1'},
         {text:'Snooze 4h', callback_data:'snooze_4'},
         {text:'Continue', callback_data:'continue'},
         {text:'Stop', callback_data:'stop'}
        ]]}
       })
      });
      var uj = await up.json();
      if(uj.ok){
       APP.tgLastSent[p.id] = now;
       RECOVERY_SENT[p.id] = { triggered: true, sentAt: now };
       addLog('Alert sent for ' + p.symbol + ' (dist: ' + p.distPct.toFixed(1) + '%)');
      } else {
       addLog('TG error: ' + (uj.description || 'unknown'));
      }
     }catch(e){ addLog('Alert fail: '+e.message); }
    }
   }

  }catch(e){ /* skip failed fetch */ }

  if(APP.inflightPairs) delete APP.inflightPairs[pairKey];
 }

 window.recalcAll();
}

window.startAlerts = startAlerts;
window.stopAlerts = stopAlerts;
window.snoozeAlerts = snoozeAlerts;
window.clearLog = clearLog;

})();
