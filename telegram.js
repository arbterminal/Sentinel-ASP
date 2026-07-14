// Sentinel — Telegram Alerts v4
;(function(){
'use strict';

var APP = window.SentinelApp;
if(!APP){console.error('SentinelApp not found');return;}

var RUNNING=false;
var INTERVAL=null;
var SNOOZE_UNTIL=0;
var RECOVERY_SENT={};

function el(id){return document.getElementById(id);}
function addLog(msg){
 var l=el('alertsLog');
 if(!l)return;
 if(l.textContent==='No alerts yet.')l.innerHTML='';
 l.innerHTML='<div>'+msg+'</div>'+l.innerHTML;
}
function clearLog(){var l=el('alertsLog');if(l)l.innerHTML='';}

function startAlerts(){
 var token=el('tgToken').value.trim();
 var chat=el('tgChat').value.trim();
 var st=el('tgStatus');
 if(!token||!chat){st.textContent='Enter bot token and chat ID.';st.className='st er';return;}
 if(RUNNING){st.textContent='Already running.';st.className='st ok';return;}
 APP.tgToken=token;
 APP.tgChat=chat;
 APP.tgThreshold=parseFloat(el('tgThreshold').value);
 APP.tgRepeatMs=parseInt(el('tgRepeat').value)*60*1000;
 APP.tgRecovery=el('tgRecovery').checked;
 var intervalSec=parseInt(el('tgIntervalSetting').value);
 RUNNING=true;
 SNOOZE_UNTIL=0;
 RECOVERY_SENT={};
 st.textContent='Monitor started.';
 st.className='st ok';
 el('tgSnoozeStatus').textContent='';
 addLog('\u{1F6F0} Monitor started | threshold: '+APP.tgThreshold+'% | interval: '+intervalSec+'s'+(APP.tgRepeatMs>0?' | repeat: '+(APP.tgRepeatMs/60000)+'min':' | no repeat'));
 INTERVAL=setInterval(tgCheck,intervalSec*1000);
 tgCheck();
}
function stopAlerts(){
 RUNNING=false;
 if(INTERVAL){clearInterval(INTERVAL);INTERVAL=null;}
 var st=el('tgStatus');
 st.textContent='Monitor stopped.';
 st.className='st';
 addLog('\u{1F6D1} Monitor stopped.');
}
function snoozeAlerts(hours){
 if(!RUNNING){el('tgStatus').textContent='Start the monitor first.';el('tgStatus').className='st er';return;}
 SNOOZE_UNTIL=Date.now()+hours*3600*1000;
 el('tgSnoozeStatus').textContent='Snoozed '+hours+'h (until '+new Date(SNOOZE_UNTIL).toLocaleTimeString()+')';
 addLog('\u{23F0} Alerts snoozed for '+hours+' hours.');
}

async function tgCheck(){
 if(!RUNNING||APP.positions.length===0)return;
 var now=Date.now();
 var snoozed=now<SNOOZE_UNTIL;
 var threshold=APP.tgThreshold;
 var repeatMs=APP.tgRepeatMs;
 var recovery=APP.tgRecovery;

 for(var i=0;i<APP.positions.length;i++){
  var p=APP.positions[i];
  var fk=p.resolvedPair+'_tg';
  if(APP.inflightPairs&&APP.inflightPairs[fk])continue;
  if(APP.inflightPairs)APP.inflightPairs[fk]=true;
  try{
   var r=await fetch('https://www.okx.com/api/v5/market/ticker?instId='+encodeURIComponent(p.resolvedPair));
   var j=await r.json();
   if(j.code!=='0'||!j.data||!j.data[0]){if(APP.inflightPairs)delete APP.inflightPairs[fk];continue;}
   var tl=parseFloat(j.data[0].last);
   p.markPrice=tl;
   var liq=p.side==='long'
    ?p.entryPrice*(1-(p.mm&&p.mm>0?p.mm/100:1/p.leverage))
    :p.entryPrice*(1+(p.mm&&p.mm>0?p.mm/100:1/p.leverage));
   p.liqPrice=liq;
   p.distPct=tl>0?Math.abs((tl-liq)/tl*100):0;
   p.pnl=p.side==='long'?(tl-p.entryPrice)/p.entryPrice*p.notional:(p.entryPrice-tl)/p.entryPrice*p.notional;
   if(isNaN(p.pnl))p.pnl=0;

   var trig=p.distPct<=threshold;
   var pnlStr=(p.pnl>=0?'+':'')+p.pnl.toFixed(2)+' USDT';
   var se=p.side==='long'?'\u{1F7E2}':' \u{1F534}';
   var de=p.distPct<=3?'\u{1F534}':p.distPct<=6?'\u{1F7E1}':p.distPct<=10?'\u{1F7E0}':'\u{1F7E2}';

   // Recovery check
   var was=RECOVERY_SENT[p.id]&&RECOVERY_SENT[p.id].triggered;
   if(recovery&&!trig&&was&&RECOVERY_SENT[p.id]&&now-RECOVERY_SENT[p.id].sentAt>60000){
    delete RECOVERY_SENT[p.id];
    var rmsg='\u{1F504} SENTINEL RECOVERY NOTIFICATION \u{1F504}\n'+
     '```\n'+
     'Position: '+p.symbol+' '+se+' '+p.side+' | '+p.leverage+'x\n'+
     'Distance: '+p.distPct.toFixed(1)+'%\n'+
     'Liq at:  $'+liq.toFixed(2)+'\n'+
     'Mark:    $'+tl.toFixed(2)+'\n'+
     'P&L:     '+pnlStr+'\n'+
     '```';
    if(APP.tgToken&&APP.tgChat&&!snoozed){
     try{
      var rr=await fetch('https://api.telegram.org/bot'+APP.tgToken+'/sendMessage',{
       method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({chat_id:APP.tgChat,text:rmsg,parse_mode:'Markdown',
        reply_markup:JSON.stringify({inline_keyboard:[[{text:'Snooze 1h',callback_data:'snooze_1'},{text:'Snooze 4h',callback_data:'snooze_4'},{text:'Continue',callback_data:'continue'},{text:'Stop',callback_data:'stop'}]]})})
      });
      var rj=await rr.json();
      if(rj.ok)addLog('\u{1F504} Recovery sent for '+p.symbol);
     }catch(e){addLog('Recovery fail: '+e.message);}
    }
   }

   // Alert
   if(trig&&!snoozed){
    var last=APP.tgLastSent?APP.tgLastSent[p.id]:0;
    var sendp=!last||(now-last>=repeatMs);
    if(repeatMs===0&&last)sendp=false;
    if(sendp){
     var msg='\u{1F6A8} SENTINEL LIQUIDATION ALERT \u{1F6A8}\n'+
      '```\n'+
      'Position: '+p.symbol+' '+se+' '+p.side+' | '+p.leverage+'x\n'+
      'Size:     '+p.sizeUsdt.toFixed(0)+' USDT\n'+
      'Entry:    $'+p.entryPrice.toFixed(2)+'\n'+
      'Mark:     $'+tl.toFixed(2)+'\n'+
      'Liq at:   $'+liq.toFixed(2)+'\n'+
      'Dist:     '+p.distPct.toFixed(1)+'% '+de+'\n'+
      'P&L:      '+pnlStr+'\n'+
      'Time:     '+new Date().toLocaleString()+'\n'+
      '```';
     try{
      var up=await fetch('https://api.telegram.org/bot'+APP.tgToken+'/sendMessage',{
       method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({chat_id:APP.tgChat,text:msg,parse_mode:'Markdown',
        reply_markup:JSON.stringify({inline_keyboard:[[{text:'Snooze 1h',callback_data:'snooze_1'},{text:'Snooze 4h',callback_data:'snooze_4'},{text:'Continue',callback_data:'continue'},{text:'Stop',callback_data:'stop'}]]})})
      });
      var uj=await up.json();
      if(uj.ok){
       if(!APP.tgLastSent)APP.tgLastSent={};
       APP.tgLastSent[p.id]=now;
       RECOVERY_SENT[p.id]={triggered:true,sentAt:now};
       addLog('\u{1F6A8} Alert sent for '+p.symbol+' (dist: '+p.distPct.toFixed(1)+'%)');
      } else addLog('TG error: '+(uj.description||'unknown'));
     }catch(e){addLog('Alert fail: '+e.message);}
    }
   }
  }catch(e){}
  if(APP.inflightPairs)delete APP.inflightPairs[fk];
 }
 if(typeof recalcAll==='function')recalcAll();
}

window.startAlerts=startAlerts;
window.stopAlerts=stopAlerts;
window.snoozeAlerts=snoozeAlerts;
window.clearLog=clearLog;

})();
