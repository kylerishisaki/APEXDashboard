import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "./lib/supabase";
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
import {
  signIn, signOut,
  fetchClients, createClient, updateClient,
  fetchClientByToken,
  fetchGoals, upsertGoals,
  fetchPERMS, upsertPERMS, deletePERMS,
  fetchWeeklyPoints, upsertWeeklyPoints, deleteWeeklyPoints,
  fetchAssignments, createAssignment, updateAssignment, deleteAssignment,
  fetchEvents, createEvent, deleteEvent,
  fetchCoachNotes, upsertCoachNote, deleteCoachNote,
  fetchWorkouts, uploadWorkout, deleteWorkout,
  parseBridgeCSV,
} from "./lib/db";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const PILLARS = [
  { id: "move",    label: "Move",    color: "#E8A020" },
  { id: "recover", label: "Recover", color: "#4ECDC4" },
  { id: "fuel",    label: "Fuel",    color: "#E84040" },
  { id: "connect", label: "Connect", color: "#8B7CF6" },
  { id: "breathe", label: "Breathe", color: "#60A5FA" },
  { id: "misc",    label: "Misc",    color: "#A0A8B0" },
];

const PILLAR_CATEGORIES = {
  move:    ["Strength","HIIT","Conditioning","Mobility/Correctives","General Activity"],
  recover: ["Sleep","Breathwork","Hot/Cold Exposure","Recovery Education"],
  fuel:    ["Nutrition Compliance","Supplements","Fuel Education","Behavioral Shift"],
  connect: ["Breathwork","Meditation","Journalling","Nature (Unplugged)","Family (Unplugged)","Friends (Unplugged)"],
  breathe: ["AM Protocol","PM Protocol","Box Breathing","Wim Hof","4-7-8"],
  misc:    ["Cognitive Performance","Challenge Sign-up","Challenge Complete"],
};

const PERMS_KEYS = [
  { key: "P", label: "Physical",   color: "#E8A020" },
  { key: "E", label: "Emotional",  color: "#4ECDC4" },
  { key: "R", label: "Relational", color: "#8B7CF6" },
  { key: "M", label: "Mental",     color: "#60A5FA" },
  { key: "S", label: "Spiritual",  color: "#E84040" },
];

const MACRO_PHASES = [
  { label: "Establish Baseline",  months: "Jan – Feb", color: "#4ECDC4" },
  { label: "Build Capacity",       months: "Mar – Apr", color: "#E8A020" },
  { label: "Performance Peak",     months: "May – Jun", color: "#E84040" },
  { label: "Maintenance & Growth", months: "Jul – Aug", color: "#8B7CF6" },
];

const EVENT_TYPES = [
  { id: "event",       label: "Major Event",  color: "#E8A020" },
  { id: "competition", label: "Competition",  color: "#E84040" },
  { id: "milestone",   label: "Milestone",    color: "#4ECDC4" },
  { id: "travel",      label: "Travel",       color: "#8B7CF6" },
  { id: "rest",        label: "Rest Day",     color: "#60A5FA" },
];

const DAYS_SHORT  = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
const MONTHS_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// ─── UTILITIES ────────────────────────────────────────────────────────────────

const getPillar   = id  => PILLARS.find(p => p.id === id) || PILLARS[0];
const getEventType= id  => EVENT_TYPES.find(e => e.id === id) || EVENT_TYPES[0];
const permsAvg    = s   => { const v=Object.values(s).filter(x=>x>0); return v.length?+(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1):0; };
const weekTotal   = w   => ["move","recover","fuel","connect","breathe","misc"].reduce((a,k)=>a+(w[k]||0),0);
const phaseColor  = p   => MACRO_PHASES[(p||1)-1]?.color||"#E8A020";
const toKey = d => {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
};
const todayKey    = ()  => toKey(new Date());
const uid         = ()  => Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const fmtDate     = s   => new Date(s+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"});
const permsColor  = v   => v>=4?"var(--teal)":v>=3?"var(--gold)":"var(--red)";

// ISO week key for a date
function getWeekISO(date) {
  const d = new Date(date); d.setHours(0,0,0,0);
  d.setDate(d.getDate()+4-(d.getDay()||7));
  const jan1 = new Date(d.getFullYear(),0,1);
  const wk = Math.ceil(((d-jan1)/86400000+1)/7);
  return `${d.getFullYear()}-W${String(wk).padStart(2,"0")}`;
}

function getWeekLabel(weekISO) {
  const [y,w]=weekISO.split("-W"); const year=parseInt(y),week=parseInt(w);
  const jan4=new Date(year,0,4); const mon=new Date(jan4);
  mon.setDate(jan4.getDate()-((jan4.getDay()+6)%7)+(week-1)*7);
  const sun=new Date(mon); sun.setDate(mon.getDate()+6);
  const f=d=>d.toLocaleDateString("en-US",{month:"short",day:"numeric"});
  return `${f(mon)} – ${f(sun)}`;
}

function parsePointsCSV(text) {
  const lines=text.trim().split("\n").filter(l=>l.trim());
  if(lines.length<2) throw new Error("CSV needs a header row and data rows.");
  const headers=lines[0].split(",").map(h=>h.trim().toLowerCase());
  const req=["week","label","move","recover","fuel","connect","breathe","misc"];
  for(const r of req) if(!headers.includes(r)) throw new Error(`Missing column: "${r}"`);
  return lines.slice(1).map((line,i)=>{
    const vals=line.split(",").map(v=>v.trim()); const row={};
    headers.forEach((h,idx)=>{row[h]=vals[idx]||"";});
    const p={week:row.week,label:row.label,move:parseInt(row.move)||0,recover:parseInt(row.recover)||0,fuel:parseInt(row.fuel)||0,connect:parseInt(row.connect)||0,breathe:parseInt(row.breathe)||0,misc:parseInt(row.misc)||0};
    if(!p.week) throw new Error(`Row ${i+2}: missing week value.`);
    return p;
  });
}

// Aggregate weekly points by period
function aggregatePoints(weeks,period) {
  if(period==="weekly") return weeks;
  const grouped={};
  weeks.forEach(w=>{
    const [yearStr,weekStr]=w.week.split("-W");
    const year=parseInt(yearStr),weekNum=parseInt(weekStr);
    let key;
    if(period==="monthly") { const m=Math.min(11,Math.floor((weekNum-1)/4.33)); key=`${year}-${String(m+1).padStart(2,"0")}`; }
    else if(period==="quarterly") { const q=Math.ceil(weekNum/13); key=`${year}-Q${q}`; }
    else { key=`${year}`; }
    if(!grouped[key]) grouped[key]={week:key,label:key,move:0,recover:0,fuel:0,connect:0,breathe:0,misc:0};
    ["move","recover","fuel","connect","breathe","misc"].forEach(k=>{grouped[key][k]+=(w[k]||0);});
  });
  return Object.values(grouped).sort((a,b)=>a.week.localeCompare(b.week));
}

// ─── MOMENTUM CALCULATOR ─────────────────────────────────────────────────────

function calcMomentum(weeklyPoints) {
  if(weeklyPoints.length<2) return null;
  const last4=weeklyPoints.slice(-4);
  const half=Math.ceil(last4.length/2);
  const older=last4.slice(0,half); const newer=last4.slice(half);
  const avgOld=older.reduce((a,w)=>a+weekTotal(w),0)/older.length;
  const avgNew=newer.reduce((a,w)=>a+weekTotal(w),0)/newer.length;
  if(avgOld===0) return null;
  const pct=Math.round(((avgNew-avgOld)/avgOld)*100);
  return { pct, up: pct>=0, weeks: last4.length };
}

// ─── COMPLIANCE CALCULATOR ───────────────────────────────────────────────────

function calcCompliance(assignments, startDate) {
  if(!Object.keys(assignments).length) return null;
  const start = startDate ? new Date(startDate+"T00:00:00") : null;
  const byWeek={};
  Object.entries(assignments).forEach(([date,tasks])=>{
    let wkLabel;
    if(start) {
      const d=new Date(date+"T00:00:00");
      const diffDays=Math.floor((d-start)/(1000*60*60*24));
      const weekNum=Math.floor(diffDays/7)+1;
      if(weekNum<1) return; // skip dates before start
      wkLabel=`Wk ${weekNum}`;
    } else {
      wkLabel=getWeekISO(new Date(date+"T00:00:00"));
    }
    if(!byWeek[wkLabel]) byWeek[wkLabel]={done:0,total:0,weekNum:start?parseInt(wkLabel.replace("Wk ","")):0};
    byWeek[wkLabel].total+=tasks.length;
    byWeek[wkLabel].done+=tasks.filter(t=>t.done).length;
  });
  const weeks=Object.entries(byWeek).sort((a,b)=>a[1].weekNum-b[1].weekNum);
  if(!weeks.length) return null;
  const totalDone=weeks.reduce((a,[,v])=>a+v.done,0);
  const totalAll=weeks.reduce((a,[,v])=>a+v.total,0);
  const overall=totalAll?Math.round(totalDone/totalAll*100):0;
  const last4=weeks.slice(-4);
  const recentRate=last4.length&&last4.reduce((a,[,v])=>a+v.total,0)>0
    ?Math.round(last4.reduce((a,[,v])=>a+v.done,0)/last4.reduce((a,[,v])=>a+v.total,0)*100):0;
  const weeklyRates=weeks.map(([wk,v])=>({week:wk,rate:v.total?Math.round(v.done/v.total*100):0,done:v.done,total:v.total}));
  return { overall, recentRate, weeklyRates };
}

// ─── STYLES ───────────────────────────────────────────────────────────────────

const S=`
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@300;400;500;600;700&family=JetBrains+Mono:wght@300;400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--gold:#E8A020;--teal:#4ECDC4;--red:#E84040;--purple:#8B7CF6;--blue:#60A5FA;--bg:#080A0E;--surface:#0D1017;--border:#1A1F2E;--text:#E8E4DC;--muted:#C8C4BC;--dim:#5A6070;--deep:#0F1420;}
body{background:var(--bg);color:var(--text);font-family:'Rajdhani',sans-serif}
.root{min-height:100vh;background:var(--bg)}
.sidebar{position:fixed;left:0;top:0;bottom:0;width:72px;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;align-items:center;padding:20px 0;gap:4px;z-index:100}
.sb-logo{font-family:'Bebas Neue',sans-serif;font-size:20px;color:var(--gold);letter-spacing:3px;margin-bottom:20px;writing-mode:vertical-rl;transform:rotate(180deg)}
.sb-div{width:32px;height:1px;background:var(--border);margin:6px 0}
.sb-btn{width:46px;height:46px;border:none;background:transparent;border-radius:6px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;transition:all .2s;position:relative;color:var(--dim)}
.sb-btn:hover{background:var(--border);color:var(--muted)}
.sb-btn.on{background:rgba(232,160,32,.1);color:var(--gold)}
.sb-btn.on::before{content:'';position:absolute;left:0;top:25%;bottom:25%;width:2px;background:var(--gold);border-radius:0 2px 2px 0}
.sb-icon{font-size:15px;line-height:1}.sb-lbl{font-size:7px;letter-spacing:.8px;font-family:'JetBrains Mono';text-transform:uppercase}
.main{margin-left:72px;padding:28px 32px}
.h1{font-family:'Bebas Neue',sans-serif;font-size:38px;letter-spacing:3px;line-height:1}
.h2{font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:2px;line-height:1}
.mono{font-family:'JetBrains Mono',monospace}.tiny{font-size:9px;letter-spacing:2px;text-transform:uppercase}
.card{background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:20px;position:relative;overflow:hidden}
.card-gold{border-color:rgba(232,160,32,.25);background:linear-gradient(135deg,var(--surface),rgba(232,160,32,.03))}
.card-teal{border-color:rgba(78,205,196,.25);background:linear-gradient(135deg,var(--surface),rgba(78,205,196,.03))}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:transparent;transition:background .3s}
.card:hover::before{background:linear-gradient(90deg,transparent,var(--gold) 50%,transparent)}
.sec{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--dim);margin-bottom:12px;display:flex;align-items:center;gap:12px}
.sec::after{content:'';flex:1;height:1px;background:var(--border)}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.g3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.g4{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.g5{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}
.g6{display:grid;grid-template-columns:repeat(6,1fr);gap:12px}
.gmain{display:grid;grid-template-columns:1fr 320px;gap:18px}
.mb8{margin-bottom:8px}.mb12{margin-bottom:12px}.mb16{margin-bottom:16px}.mb20{margin-bottom:20px}.mb24{margin-bottom:24px}.mb32{margin-bottom:32px}
.track{height:3px;background:var(--border);border-radius:2px;overflow:hidden;margin-top:8px}
.fill{height:100%;border-radius:2px;transition:width .8s ease}
.btn{display:inline-flex;align-items:center;gap:7px;padding:9px 16px;border-radius:3px;border:none;cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:1.5px;text-transform:uppercase;transition:all .2s;white-space:nowrap}
.btn-gold{background:var(--gold);color:#000;font-weight:700}.btn-gold:hover{background:#F4C050}
.btn-ghost{background:transparent;color:var(--dim);border:1px solid var(--border)}.btn-ghost:hover{background:var(--border);color:var(--muted)}
.btn-ghost.on{background:rgba(232,160,32,.1);color:var(--gold);border-color:rgba(232,160,32,.4)}
.btn-red{background:rgba(232,64,64,.12);color:var(--red);border:1px solid rgba(232,64,64,.25)}.btn-red:hover{background:rgba(232,64,64,.22)}
.btn-teal{background:rgba(78,205,196,.1);color:var(--teal);border:1px solid rgba(78,205,196,.25)}.btn-teal:hover{background:rgba(78,205,196,.18)}
.btn-sm{padding:5px 11px;font-size:8.5px}.btn:disabled{opacity:.4;cursor:not-allowed}
.page-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:22px;border-bottom:1px solid var(--border)}
.badge{display:inline-block;background:rgba(232,160,32,.1);border:1px solid rgba(232,160,32,.3);color:var(--gold);font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:3px;padding:5px 12px;border-radius:2px;text-transform:uppercase}
.tabs{display:flex;border:1px solid var(--border);border-radius:3px;overflow:hidden;width:fit-content;margin-bottom:24px}
.tab{padding:9px 18px;border:none;background:transparent;color:var(--dim);font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;cursor:pointer;border-right:1px solid var(--border);transition:all .2s}
.tab:last-child{border-right:none}.tab:hover{background:var(--border);color:var(--muted)}.tab.on{background:rgba(232,160,32,.1);color:var(--gold)}
.label{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--dim);margin-bottom:5px;display:block}
.input{width:100%;padding:9px 13px;background:var(--deep);border:1px solid var(--border);border-radius:3px;color:var(--text);font-family:'Rajdhani',sans-serif;font-size:14px;outline:none;transition:border .2s}
.input:focus{border-color:var(--gold)}.input-sm{padding:6px 10px;font-size:13px}.field{margin-bottom:14px}
.input-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}
.stat-lbl{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--dim);margin-bottom:6px}
.stat-val{font-family:'Bebas Neue',sans-serif;font-size:36px;letter-spacing:2px;line-height:1}
.stat-sub{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--dim);margin-top:4px}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}
.modal{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:28px;width:100%;max-width:560px;max-height:88vh;overflow-y:auto;position:relative}
.modal-wide{max-width:860px}
.modal-close{position:absolute;top:14px;right:14px;background:transparent;border:none;color:var(--dim);font-size:16px;cursor:pointer;padding:5px 8px;border-radius:3px}
.modal-close:hover{background:var(--border);color:var(--muted)}
.client-card{background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:18px;cursor:pointer;transition:all .25s;overflow:hidden}
.client-card:hover{border-color:rgba(232,160,32,.4);transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.4)}
.upload-zone{border:2px dashed var(--border);border-radius:4px;padding:28px 20px;text-align:center;cursor:pointer;transition:all .2s}
.upload-zone:hover,.upload-zone.drag{border-color:var(--gold);background:rgba(232,160,32,.04)}
.upload-zone input{display:none}
.code-block{background:var(--deep);border:1px solid var(--border);border-radius:3px;padding:12px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--teal);white-space:pre;overflow-x:auto;margin:10px 0}
.share-banner{background:rgba(78,205,196,.07);border:1px solid rgba(78,205,196,.2);border-radius:4px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:22px}
.workout-file{display:flex;align-items:center;gap:12px;padding:11px;background:var(--deep);border-radius:3px;border:1px solid var(--border);margin-bottom:7px;transition:all .2s}
.workout-file:hover{border-color:rgba(232,160,32,.3)}
.back-btn{display:inline-flex;align-items:center;gap:8px;color:var(--dim);font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;background:none;border:none;cursor:pointer;padding:6px 0;margin-bottom:18px;transition:color .2s}
.back-btn:hover{color:var(--gold)}
.pill{display:inline-block;padding:3px 9px;border-radius:20px;font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:1.5px;text-transform:uppercase}
.perm-card{background:var(--deep);border:1px solid var(--border);border-radius:4px;padding:14px;text-align:center;position:relative}
.perm-letter{font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:2px;line-height:1}
.perm-sub{font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:var(--dim);margin:3px 0 7px}
.pts-table{width:100%;border-collapse:collapse}
.pts-table th{font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--dim);padding:8px 0;text-align:left;border-bottom:1px solid var(--border)}
.pts-table td{padding:9px 0;border-bottom:1px solid var(--deep);font-size:13px}
.pts-table tr:last-child td{border-bottom:none}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);border-left:1px solid var(--border);border-top:1px solid var(--border)}
.cal-dow{font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:2px;text-transform:uppercase;color:var(--dim);padding:8px 10px;background:var(--deep);border-right:1px solid var(--border);border-bottom:1px solid var(--border);text-align:center}
.cal-cell{min-height:96px;border-right:1px solid var(--border);border-bottom:1px solid var(--border);padding:8px;cursor:pointer;transition:background .15s;position:relative;background:var(--bg)}
.cal-cell:hover{background:rgba(232,160,32,.04)}
.cal-cell.today-cell{background:rgba(232,160,32,.06)}
.cal-cell.today-cell .cal-day-num{background:var(--gold);color:#000;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-weight:700}
.cal-cell.other-month{opacity:.35}.cal-cell.selected-cell{background:rgba(139,124,246,.08);border-color:rgba(139,124,246,.4)}
.cal-day-num{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted);margin-bottom:4px;width:22px;height:22px;display:flex;align-items:center;justify-content:center}
.cal-dot-row{display:flex;gap:3px;flex-wrap:wrap;margin-top:3px}
.cal-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.cal-pts-badge{font-family:'Bebas Neue',sans-serif;font-size:12px;color:var(--gold);letter-spacing:.5px;margin-top:2px}
.cal-complete-bar{position:absolute;bottom:0;left:0;right:0;height:2px;background:var(--deep);overflow:hidden}
.cal-complete-fill{height:100%;background:var(--teal);transition:width .4s ease}
.cal-event-chip{font-size:9px;font-family:'JetBrains Mono',monospace;padding:2px 5px;border-radius:2px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.week-strip{display:flex;gap:0;margin-bottom:22px;border:1px solid var(--border);border-radius:4px;overflow:hidden}
.week-strip-day{flex:1;padding:10px 6px;border-right:1px solid var(--border);cursor:pointer;text-align:center;transition:all .15s}
.week-strip-day:last-child{border-right:none}.week-strip-day:hover{background:var(--border)}
.week-strip-day.wsd-active{background:rgba(232,160,32,.1);border-bottom:2px solid var(--gold)}
.week-strip-day.wsd-today{border-bottom:2px solid var(--teal)}
.day-panel{background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden}
.day-panel-hdr{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.day-task-row{display:flex;align-items:flex-start;gap:10px;padding:11px 0;border-bottom:1px solid var(--deep)}
.day-task-row:last-child{border-bottom:none}
.task-check{width:16px;height:16px;border:1.5px solid #2A3040;border-radius:2px;flex-shrink:0;margin-top:2px;display:flex;align-items:center;justify-content:center;font-size:9px;transition:all .2s;cursor:pointer}
.task-check.done{background:rgba(78,205,196,.15);border-color:var(--teal);color:var(--teal)}
.assignment-form{background:var(--deep);border:1px solid var(--border);border-radius:4px;padding:16px;margin-top:12px}
.event-banner{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:3px;margin-bottom:8px;border:1px solid}
.note-card{background:var(--deep);border:1px solid var(--border);border-radius:4px;padding:14px;margin-bottom:10px}
.toast{position:fixed;bottom:28px;right:28px;z-index:999;background:var(--surface);border:1px solid rgba(78,205,196,.4);border-radius:4px;padding:12px 18px;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--teal);display:flex;align-items:center;gap:8px;animation:slideIn .3s ease,fadeOut .3s ease 2.5s forwards}
@keyframes slideIn{from{transform:translateY(16px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes fadeOut{to{opacity:0;transform:translateY(8px)}}
.client-banner{background:linear-gradient(135deg,rgba(139,124,246,.08),rgba(96,165,250,.04));border:1px solid rgba(139,124,246,.25);border-radius:4px;padding:12px 16px;display:flex;align-items:center;gap:12px;margin-bottom:22px}
.loading-screen{min-height:100vh;background:var(--bg);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px}
.fade-in{animation:fadeUp .3s ease both}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.pulse{animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:var(--bg)}::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}
textarea.input{resize:vertical;min-height:80px}
.action-item-row{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--deep)}
.action-check{width:14px;height:14px;border:1.5px solid #2A3040;border-radius:2px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:8px;cursor:pointer;transition:all .2s}
.action-check.done{background:rgba(78,205,196,.15);border-color:var(--teal);color:var(--teal)}
.perms-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.compliance-bar-wrap{height:6px;background:var(--border);border-radius:3px;overflow:hidden}
.compliance-bar-fill{height:100%;border-radius:3px;transition:width .8s ease}
`;

// ─── SMALL COMPONENTS ─────────────────────────────────────────────────────────

function Toast({ msg, onDone }) {
  useEffect(()=>{const t=setTimeout(onDone,3000);return()=>clearTimeout(t);},[]);
  return <div className="toast">✓ {msg}</div>;
}
function ModalWrap({ onClose, children, wide }) {
  return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className={`modal fade-in${wide?" modal-wide":""}`}>
        <button className="modal-close" onClick={onClose}>✕</button>
        {children}
      </div>
    </div>
  );
}

// ─── RADAR CHART ─────────────────────────────────────────────────────────────

function RadarChart({ weeklyPoints }) {
  const pillars = PILLARS.filter(p => ["move","recover","fuel","connect","misc"].includes(p.id));
  const n = pillars.length;
  const CX=140,CY=130,R=90;

  // Use average of last 4 weeks
  const last4 = weeklyPoints.slice(-4);
  const totals = pillars.map(p => last4.length ? last4.reduce((a,w)=>a+(w[p.id]||0),0)/last4.length : 0);
  const maxVal = Math.max(...totals, 1);
  const normalized = totals.map(v => v/maxVal);

  const angle = i => (Math.PI*2*(i/n)) - Math.PI/2;
  const point = (r,i) => ({
    x: CX + r * Math.cos(angle(i)),
    y: CY + r * Math.sin(angle(i)),
  });

  const labelPt = i => {
    const p = point(R+22, i);
    return { x: p.x, y: p.y };
  };

  // Grid rings
  const rings = [0.25,0.5,0.75,1.0];
  const ringPath = frac => {
    const pts = pillars.map((_,i)=>point(R*frac,i));
    return pts.map((p,i)=>`${i===0?"M":"L"}${p.x},${p.y}`).join(" ")+"Z";
  };

  // Data shape
  const dataPts = normalized.map((v,i)=>point(R*v,i));
  const dataPath = dataPts.map((p,i)=>`${i===0?"M":"L"}${p.x},${p.y}`).join(" ")+"Z";

  if (!weeklyPoints.length) return (
    <div style={{textAlign:"center",padding:"24px",color:"var(--dim)"}}>
      <div className="mono tiny">Import points data to see pillar balance</div>
    </div>
  );

  return (
    <svg viewBox={`0 0 280 260`} style={{width:"100%",maxWidth:280}}>
      {/* Grid rings */}
      {rings.map((f,i)=>(
        <path key={i} d={ringPath(f)} fill="none" stroke="#1A1F2E" strokeWidth={1}/>
      ))}
      {/* Axis lines */}
      {pillars.map((_,i)=>{
        const p=point(R,i);
        return <line key={i} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="#1A1F2E" strokeWidth={1}/>;
      })}
      {/* Data fill */}
      <path d={dataPath} fill="rgba(232,160,32,.12)" stroke="var(--gold)" strokeWidth={2} strokeLinejoin="round"/>
      {/* Data dots */}
      {dataPts.map((p,i)=>(
        <circle key={i} cx={p.x} cy={p.y} r={4} fill={pillars[i].color} stroke="var(--bg)" strokeWidth={1.5}/>
      ))}
      {/* Labels */}
      {pillars.map((pl,i)=>{
        const lp=labelPt(i);
        const anchor = lp.x < CX-5 ? "end" : lp.x > CX+5 ? "start" : "middle";
        return (
          <g key={i}>
            <text x={lp.x} y={lp.y+4} fill={pl.color} fontSize={9} textAnchor={anchor} fontFamily="JetBrains Mono" letterSpacing="1">{pl.label.toUpperCase()}</text>
          </g>
        );
      })}
      {/* Center */}
      <circle cx={CX} cy={CY} r={3} fill="var(--gold)"/>
    </svg>
  );
}

// ─── PERMS CHART ──────────────────────────────────────────────────────────────

function PERMSChart({ history }) {
  if(history.length<2) return (
    <div style={{textAlign:"center",padding:"24px",color:"var(--dim)"}}>
      <div className="mono tiny">Add at least 2 assessments to see the trend</div>
    </div>
  );
  const W=620,H=160,PAD={t:16,r:20,b:36,l:32};
  const iW=W-PAD.l-PAD.r,iH=H-PAD.t-PAD.b;
  const n=history.length;
  const xPos=i=>PAD.l+(n>1?i*iW/(n-1):iW/2);
  const yPos=v=>PAD.t+iH-((v/5)*iH);
  return(
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",overflow:"visible"}}>
      {[1,2,3,4,5].map(v=>(
        <g key={v}>
          <line x1={PAD.l} y1={yPos(v)} x2={W-PAD.r} y2={yPos(v)} stroke="#1A1F2E" strokeWidth={1}/>
          <text x={PAD.l-5} y={yPos(v)+4} fill="#5A6070" fontSize={8} textAnchor="end" fontFamily="JetBrains Mono">{v}</text>
        </g>
      ))}
      {PERMS_KEYS.map(pk=>{
        const pts=history.map((h,i)=>({x:xPos(i),y:yPos(h.scores[pk.key]||0)}));
        const path=pts.map((p,i)=>`${i===0?"M":"L"}${p.x},${p.y}`).join(" ");
        return(
          <g key={pk.key}>
            <path d={path} fill="none" stroke={pk.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"/>
            {pts.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={3.5} fill={pk.color} stroke="var(--bg)" strokeWidth={1.5}/>)}
          </g>
        );
      })}
      {history.map((h,i)=>(
        <text key={i} x={xPos(i)} y={H-2} fill="#5A6070" fontSize={8} textAnchor="middle" fontFamily="JetBrains Mono">{h.quarter}</text>
      ))}
    </svg>
  );
}

// ─── POINTS CHART ─────────────────────────────────────────────────────────────

function PointsChart({ data }) {
  if(!data.length) return null;
  const W=620,H=180,PAD={t:16,r:20,b:44,l:40};
  const iW=W-PAD.l-PAD.r,iH=H-PAD.t-PAD.b;
  const pillars=["move","recover","fuel","connect","breathe","misc"];
  const maxVal=Math.max(...data.flatMap(d=>pillars.map(k=>d[k]||0)),1);
  const n=data.length;
  const xStep=n>1?iW/(n-1):iW/2;
  const xPos=i=>PAD.l+i*xStep;
  const yPos=v=>PAD.t+iH-(v/maxVal)*iH;
  const yTicks=[0,Math.round(maxVal/4),Math.round(maxVal/2),Math.round(maxVal*3/4),maxVal];
  return(
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",overflow:"visible"}}>
      {yTicks.map(v=>(
        <g key={v}>
          <line x1={PAD.l} y1={yPos(v)} x2={W-PAD.r} y2={yPos(v)} stroke="#1A1F2E" strokeWidth={1}/>
          <text x={PAD.l-6} y={yPos(v)+4} fill="#5A6070" fontSize={8} textAnchor="end" fontFamily="JetBrains Mono">{v}</text>
        </g>
      ))}
      {pillars.map(k=>{
        const p=getPillar(k);
        const pts=data.map((d,i)=>({x:xPos(i),y:yPos(d[k]||0)}));
        const path=pts.map((pt,i)=>`${i===0?"M":"L"}${pt.x},${pt.y}`).join(" ");
        return(
          <g key={k}>
            <path d={path} fill="none" stroke={p.color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.8}/>
            {pts.map((pt,i)=><circle key={i} cx={pt.x} cy={pt.y} r={2.5} fill={p.color} stroke="var(--bg)" strokeWidth={1.5}/>)}
          </g>
        );
      })}
      {data.map((d,i)=>(
        <text key={i} x={xPos(i)} y={H-2} fill="#5A6070" fontSize={7} textAnchor="middle" fontFamily="JetBrains Mono">
          {(d.label||d.week||"").split("–")[0].trim().slice(0,7)}
        </text>
      ))}
    </svg>
  );
}

// ─── COMPLIANCE CHART ─────────────────────────────────────────────────────────

function ComplianceChart({ weeklyRates }) {
  if(!weeklyRates||weeklyRates.length<2) return null;
  const W=620,H=100,PAD={t:10,r:20,b:30,l:36};
  const iW=W-PAD.l-PAD.r,iH=H-PAD.t-PAD.b;
  const n=weeklyRates.length;
  const xPos=i=>PAD.l+(n>1?i*iW/(n-1):iW/2);
  const yPos=v=>PAD.t+iH-((v/100)*iH);
  const pts=weeklyRates.map((r,i)=>({x:xPos(i),y:yPos(r.rate)}));
  const path=pts.map((p,i)=>`${i===0?"M":"L"}${p.x},${p.y}`).join(" ");
  const areaPath=path+` L${pts[pts.length-1].x},${PAD.t+iH} L${pts[0].x},${PAD.t+iH} Z`;
  return(
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",overflow:"visible"}}>
      {[25,50,75,100].map(v=>(
        <g key={v}>
          <line x1={PAD.l} y1={yPos(v)} x2={W-PAD.r} y2={yPos(v)} stroke="#1A1F2E" strokeWidth={1}/>
          <text x={PAD.l-5} y={yPos(v)+4} fill="#5A6070" fontSize={7} textAnchor="end" fontFamily="JetBrains Mono">{v}%</text>
        </g>
      ))}
      <path d={areaPath} fill="rgba(78,205,196,.08)"/>
      <path d={path} fill="none" stroke="var(--teal)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"/>
      {pts.map((p,i)=>(
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={weeklyRates[i].rate>=75?"var(--teal)":weeklyRates[i].rate>=50?"var(--gold)":"var(--red)"} stroke="var(--bg)" strokeWidth={1.5}/>
      ))}
      {weeklyRates.map((r,i)=>(
        <text key={i} x={xPos(i)} y={H-2} fill="#5A6070" fontSize={7} textAnchor="middle" fontFamily="JetBrains Mono">{r.week.split("-W")[1]?`W${r.week.split("-W")[1]}`:r.week}</text>
      ))}
    </svg>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────

// ─── BRIDGE PDF PARSER ────────────────────────────────────────────────────────

const WORKOUT_PILLAR_MAP = [
  { match: /recovery|mobility|nature|family|rest/i,   pillar:"recover", category:"Recovery Education",     pts:1 },
  { match: /conditioning.*run|run/i,                  pillar:"move",    category:"Conditioning",           pts:1 },
  { match: /conditioning.*non.load|non.load/i,        pillar:"recover", category:"Breathwork",             pts:1 },
  { match: /kb happy hour|kettlebell/i,               pillar:"move",    category:"General Activity",       pts:1 },
  { match: /lower push|upper pull|upper push|lower pull|total body|strength|barbell|squat|deadlift|bench/i, pillar:"move", category:"Strength", pts:1 },
  { match: /swim|bike|cycle/i,                        pillar:"move",    category:"Conditioning",           pts:1 },
];

function mapWorkout(name, durationMin) {
  for (const rule of WORKOUT_PILLAR_MAP) {
    if (rule.match.test(name)) {
      const pts = Math.max(1, Math.round(durationMin / 60));
      return { pillar: rule.pillar, category: rule.category, points: pts };
    }
  }
  return { pillar: "move", category: "General Activity", points: Math.max(1, Math.round(durationMin / 60)) };
}

async function parsePDFSchedule(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => item.str).join(" "));
  }
  const fullText = pages.join(" ");

  // Match: "Day N Mon DD" then workout title then duration
  const dayRe = /Day\s+(\d+)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+([\w\s\/\(\)\-–]+?)\s+(\d+)\s+min/g;
  const results = [];
  let m;
  while ((m = dayRe.exec(fullText)) !== null) {
    const [,dayNum, mon, dayOfMonth, workoutRaw, durStr] = m;
    const workout = workoutRaw.trim().replace(/\s+/g, " ");
    const duration = parseInt(durStr) || 0;
    const monthMap = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    // Use current year; if month already passed use next year
    const now = new Date();
    let year = now.getFullYear();
    const mo = monthMap[mon];
    if (mo < now.getMonth() - 1) year++;
    const date = new Date(year, mo, parseInt(dayOfMonth));
    const dateKey = date.toISOString().split("T")[0];
    const mapped = mapWorkout(workout, duration);
    results.push({
      dayNum: parseInt(dayNum),
      dateKey,
      workout,
      duration,
      ...mapped,
      task: workout,
      notes: duration > 0 ? `${duration} min` : "",
    });
  }
  return results;
}

function LoginScreen({ onLogin }) {
  const [email,setEmail]=useState("");
  const [pass,setPass]=useState("");
  const [err,setErr]=useState("");
  const [load,setLoad]=useState(false);
  const handle=async()=>{
    setLoad(true);setErr("");
    try{await signIn(email,pass);onLogin();}
    catch(e){setErr(e.message);}
    finally{setLoad(false);}
  };
  return(
    <div style={{minHeight:"100vh",background:"#080A0E",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{width:360,background:"#0D1017",border:"1px solid #1A1F2E",borderRadius:6,padding:36}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,color:"#E8A020",letterSpacing:3,marginBottom:4}}>APEX</div>
        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,letterSpacing:3,color:"#5A6070",textTransform:"uppercase",marginBottom:28}}>XPT · Coach Dashboard</div>
        <label className="label">Email</label>
        <input type="email" className="input" value={email} onChange={e=>setEmail(e.target.value)} style={{marginBottom:14}}/>
        <label className="label">Password</label>
        <input type="password" className="input" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handle()} style={{marginBottom:20}}/>
        {err&&<div style={{color:"#E84040",fontFamily:"'JetBrains Mono',monospace",fontSize:10,marginBottom:14}}>{err}</div>}
        <button className="btn btn-gold" style={{width:"100%",justifyContent:"center"}} onClick={handle} disabled={load}>{load?"Signing in…":"Sign In"}</button>
      </div>
    </div>
  );
}

// ─── TASK EDITOR ─────────────────────────────────────────────────────────────

function TaskEditor({ task, onSave, onCancel }) {
  const [form,setForm]=useState({pillar:task?.pillar||"move",category:task?.category||"",task:task?.task||"",points:task?.points??1,notes:task?.notes||""});
  const s=k=>e=>setForm(f=>({...f,[k]:k==="points"?parseInt(e.target.value)||0:e.target.value}));
  const cats=PILLAR_CATEGORIES[form.pillar]||[];
  return(
    <div className="assignment-form">
      <div className="input-row" style={{gridTemplateColumns:"1fr 1fr",gap:10}}>
        <div><label className="label">Pillar</label>
          <select className="input input-sm" value={form.pillar} onChange={e=>setForm(f=>({...f,pillar:e.target.value,category:""}))}>
            {PILLARS.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div><label className="label">Category</label>
          <select className="input input-sm" value={form.category} onChange={s("category")}>
            <option value="">— select —</option>
            {cats.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="field"><label className="label">Task</label><input className="input input-sm" value={form.task} onChange={s("task")} placeholder="e.g. Upper Body Power Block"/></div>
      <div className="input-row" style={{gridTemplateColumns:"60px 1fr",gap:10,marginBottom:10}}>
        <div><label className="label">Points</label><input className="input input-sm" type="number" min={1} max={30} value={form.points} onChange={s("points")}/></div>
        <div><label className="label">Coach Notes</label><input className="input input-sm" value={form.notes} onChange={s("notes")} placeholder="Cues, targets…"/></div>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button className="btn btn-gold btn-sm" onClick={()=>onSave(form)} disabled={!form.task.trim()}>{task?"Save":"Add Task"}</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ─── EVENT EDITOR ─────────────────────────────────────────────────────────────

function EventEditor({ event, onSave, onCancel }) {
  const [form,setForm]=useState({title:event?.title||"",event_type:event?.event_type||"event",notes:event?.notes||""});
  const s=k=>e=>setForm(f=>({...f,[k]:e.target.value}));
  const et=getEventType(form.event_type);
  return(
    <div className="assignment-form" style={{borderColor:`${et.color}33`}}>
      <div className="input-row" style={{gridTemplateColumns:"1fr 1fr",gap:10}}>
        <div><label className="label">Title</label><input className="input input-sm" value={form.title} onChange={s("title")} placeholder="e.g. Sprint Triathlon"/></div>
        <div><label className="label">Type</label>
          <select className="input input-sm" value={form.event_type} onChange={s("event_type")}>
            {EVENT_TYPES.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
      </div>
      <div className="field"><label className="label">Notes</label><input className="input input-sm" value={form.notes} onChange={s("notes")} placeholder="Details, location…"/></div>
      <div style={{display:"flex",gap:8}}>
        <button className="btn btn-gold btn-sm" onClick={()=>onSave(form)} disabled={!form.title.trim()}>{event?"Save":"Add Event"}</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ─── DAY PANEL ────────────────────────────────────────────────────────────────

function DayPanel({ dateKey, tasks, events, isClientView, onAddTask, onUpdateTask, onDeleteTask, onCopyWeek, onAddEvent, onDeleteEvent }) {
const [mode,setMode]=useState(null);
  const [editTaskObj,setEditTaskObj]=useState(null);
  const [confirmDelete,setConfirmDelete]=useState(null);
  const [selected,setSelected]=useState(new Set());
  const [moveTarget,setMoveTarget]=useState("");
  const [selectMode,setSelectMode]=useState(false);

  const toggleSelect=id=>setSelected(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});
  const selectAll=()=>setSelected(new Set(tasks.map(t=>t.id)));
  const clearSelect=()=>{setSelected(new Set());setSelectMode(false);setMoveTarget("");};
  const totalPts=tasks.reduce((a,t)=>a+t.points,0);
  const donePts=tasks.filter(t=>t.done).reduce((a,t)=>a+t.points,0);
  const pct=totalPts?Math.round(donePts/totalPts*100):0;
  const d=new Date(dateKey+"T00:00:00"),isToday=dateKey===todayKey();
  const grouped=PILLARS.reduce((acc,p)=>{const t=tasks.filter(x=>x.pillar===p.id);if(t.length)acc.push({pillar:p,tasks:t});return acc;},[]);
  return(
    <div className="day-panel">
      <div className="day-panel-hdr">
        <div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {isToday&&<div style={{width:7,height:7,borderRadius:"50%",background:"var(--teal)"}} className="pulse"/>}
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:"2px"}}>{d.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}</div>
          </div>
          <div style={{display:"flex",gap:16,marginTop:6,alignItems:"center"}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:"var(--gold)",letterSpacing:"1px"}}>{donePts}/{totalPts} pts</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"var(--dim)",letterSpacing:"1.5px"}}>{pct}% complete</div>
            <div style={{width:80,height:3,background:"var(--border)",borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,background:"var(--teal)",borderRadius:2}}/></div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
          {!selectMode?(
            <>
              {!isClientView&&<button className="btn btn-ghost btn-sm" onClick={onCopyWeek}>Copy → Next Week</button>}
              <button className="btn btn-ghost btn-sm" onClick={()=>{setSelectMode(true);setMode(null);}}>☑ Select</button>
              {!isClientView&&<button className="btn btn-ghost btn-sm" style={{borderColor:"rgba(232,160,32,.4)",color:"var(--gold)"}} onClick={()=>setMode(mode==="event"?null:"event")}>+ Event</button>}
              <button className="btn btn-gold btn-sm" onClick={()=>setMode(mode==="task"?null:"task")}>+ Task</button>
            </>
          ):(
            <>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"var(--dim)",alignSelf:"center"}}>{selected.size} selected</div>
              <button className="btn btn-ghost btn-sm" onClick={selectAll}>All</button>
              <button className="btn btn-ghost btn-sm" onClick={clearSelect}>Cancel</button>
              {selected.size>0&&(
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <input
                    type="date"
                    className="input input-sm"
                    style={{width:130,padding:"5px 8px"}}
                    value={moveTarget}
                    onChange={e=>setMoveTarget(e.target.value)}
                  />
                  <button
                    className="btn btn-teal btn-sm"
                    disabled={!moveTarget}
                    onClick={async()=>{
                      for(const id of selected) await onUpdateTask(id,{date:moveTarget});
                      clearSelect();
                    }}
                  >Move</button>
                </div>
              )}
              {selected.size>0&&!isClientView&&(
                <button className="btn btn-red btn-sm" onClick={async()=>{
                  if(!window.confirm(`Delete ${selected.size} task${selected.size!==1?"s":""}?`)) return;
                  for(const id of selected) await onDeleteTask(id);
                  clearSelect();
                }}>Delete {selected.size}</button>
              )}
            </>
          )}
        </div>
      </div>
      <div style={{padding:"16px 20px"}}>
        {events.length>0&&events.map(ev=>{const et=getEventType(ev.event_type);return(
          <div key={ev.id} className="event-banner" style={{background:`${et.color}12`,borderColor:`${et.color}44`,color:et.color}}>
            <div style={{fontSize:14}}>📍</div>
            <div style={{flex:1}}>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,letterSpacing:"1.5px",textTransform:"uppercase",opacity:.7}}>{et.label}</div>
              <div style={{fontSize:14,fontWeight:600}}>{ev.title}</div>
              {ev.notes&&<div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,opacity:.7,marginTop:2}}>{ev.notes}</div>}
            </div>
            {!isClientView&&<button className="btn btn-ghost btn-sm" style={{padding:"3px 7px"}} onClick={()=>onDeleteEvent(ev.id)}>✕</button>}
          </div>
        );})}
        {mode==="event"&&!isClientView&&<div style={{marginBottom:14}}><EventEditor onSave={form=>{onAddEvent(form);setMode(null);}} onCancel={()=>setMode(null)}/></div>}
        {mode==="task"&&!isClientView&&<div style={{marginBottom:16}}><TaskEditor onSave={form=>{onAddTask(form);setMode(null);}} onCancel={()=>setMode(null)}/></div>}
        {tasks.length===0&&!mode?(
          <div style={{textAlign:"center",padding:"28px 0",color:"var(--dim)"}}>
            <div style={{fontSize:26,marginBottom:8}}>📅</div>
            <div className="mono tiny">No assignments for this day</div>
            {!isClientView&&<div className="mono tiny" style={{marginTop:6}}>Use the buttons above to add tasks or events</div>}
          </div>
        ):(
          grouped.map(({pillar:p,tasks:pts_})=>(
            <div key={p.id} style={{marginBottom:16}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <div style={{width:7,height:7,borderRadius:"50%",background:p.color}}/>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,letterSpacing:"2px",color:p.color,textTransform:"uppercase"}}>{p.label}</div>
              </div>
              {pts_.map(task=>(
                <div key={task.id}>
                  <div className="day-task-row" style={{opacity:task.done?.7:1,background:selected.has(task.id)?"rgba(139,124,246,.08)":"transparent",borderRadius:3,transition:"background .15s"}}>
                    {selectMode?(
                      <div className={`action-check${selected.has(task.id)?" done":""}`} style={{cursor:"pointer",borderColor:selected.has(task.id)?"var(--purple)":"#2A3040",background:selected.has(task.id)?"rgba(139,124,246,.2)":"transparent"}} onClick={()=>toggleSelect(task.id)}>{selected.has(task.id)?"✓":""}</div>
                    ):(
                      <div className={`task-check${task.done?" done":""}`} onClick={()=>onUpdateTask(task.id,{done:!task.done})}>{task.done?"✓":""}</div>
                    )}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,letterSpacing:"1.5px",textTransform:"uppercase",color:p.color,marginBottom:2}}>{task.category}</div>
                      <div style={{fontSize:14,fontWeight:500,color:task.done?"#3A4050":"var(--muted)",textDecoration:task.done?"line-through":"none",lineHeight:1.3}}>{task.task}</div>
                      {task.notes&&<div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"var(--dim)",marginTop:3}}>{task.notes}</div>}
                      {editTaskObj?.id===task.id&&!isClientView&&<TaskEditor task={editTaskObj} onSave={form=>{onUpdateTask(task.id,form);setEditTaskObj(null);}} onCancel={()=>setEditTaskObj(null)}/>}
                    </div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:task.done?"var(--gold)":"#3A4050",letterSpacing:"1px",flexShrink:0}}>{task.points}</div>
                    {editTaskObj?.id!==task.id&&!selectMode&&(
                      <div style={{display:"flex",gap:5,flexShrink:0}}>
                        <button className="btn btn-ghost btn-sm" style={{padding:"4px 8px"}} onClick={()=>setEditTaskObj(task)}>✎</button>
                        {!isClientView&&<button className="btn btn-red btn-sm" style={{padding:"4px 8px"}} onClick={()=>setConfirmDelete(task.id)}>✕</button>}
                      </div>
                    )}
                  </div>
                  {confirmDelete===task.id&&(
                    <div style={{display:"flex",gap:8,padding:"8px 0 4px 36px",alignItems:"center"}}>
                      <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"var(--red)"}}>Remove this task?</div>
                      <button className="btn btn-red btn-sm" onClick={()=>{onDeleteTask(task.id);setConfirmDelete(null);}}>Yes</button>
                      <button className="btn btn-ghost btn-sm" onClick={()=>setConfirmDelete(null)}>Cancel</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── CALENDAR VIEW ────────────────────────────────────────────────────────────

function CalendarView({ clientId, isClientView, onAssignmentsUpdate }) {
  const today=new Date(),todayStr=toKey(today);
  const [calMode,setCalMode]=useState("day");
  const [viewDate,setViewDate]=useState(new Date(today));
  const [selectedDate,setSelectedDate]=useState(todayStr);
  const [assignments,setAssignments]=useState({});
  const [events,setEvents]=useState({});

  const loadRange=useCallback(async()=>{
    try{
      const from=new Date(viewDate.getFullYear(),viewDate.getMonth()-1,1);
      const to=new Date(viewDate.getFullYear(),viewDate.getMonth()+2,0);
      const [rows,evRows]=await Promise.all([fetchAssignments(clientId,toKey(from),toKey(to)),fetchEvents(clientId,toKey(from),toKey(to))]);
      const ga={},ge={};
      rows.forEach(r=>{if(!ga[r.date])ga[r.date]=[];ga[r.date].push(r);});
      evRows.forEach(r=>{if(!ge[r.date])ge[r.date]=[];ge[r.date].push(r);});
      setAssignments(ga);setEvents(ge);
      if(onAssignmentsUpdate) onAssignmentsUpdate(ga);
    }catch(e){console.error(e);}
  },[clientId,viewDate]);

  useEffect(()=>{loadRange();},[loadRange]);

  const getTasks=k=>assignments[k]||[];
  const getEvts=k=>events[k]||[];
  const totalPts=k=>getTasks(k).reduce((a,t)=>a+t.points,0);
  const completePct=k=>{const t=getTasks(k);return t.length?Math.round(t.filter(x=>x.done).length/t.length*100):0;};

  const notifyUpdate=newA=>{if(onAssignmentsUpdate)onAssignmentsUpdate(newA);};

  const handleAddTask=async form=>{try{const row=await createAssignment(clientId,selectedDate,form);const newA={...assignments,[selectedDate]:[...(assignments[selectedDate]||[]),row]};setAssignments(newA);notifyUpdate(newA);}catch(e){console.error(e);}};
  const handleUpdateTask=async(id,changes)=>{try{await updateAssignment(id,changes);const newA={...assignments};Object.keys(newA).forEach(k=>{newA[k]=newA[k].map(t=>t.id===id?{...t,...changes}:t);});setAssignments(newA);notifyUpdate(newA);}catch(e){console.error(e);}};
  const handleDeleteTask=async id=>{try{await deleteAssignment(id);const newA={...assignments};Object.keys(newA).forEach(k=>{newA[k]=newA[k].filter(t=>t.id!==id);});setAssignments(newA);notifyUpdate(newA);}catch(e){console.error(e);}};
  const handleCopy=async()=>{const from=new Date(selectedDate+"T00:00:00");from.setDate(from.getDate()+7);const dk=toKey(from);for(const t of getTasks(selectedDate)){try{const row=await createAssignment(clientId,dk,{pillar:t.pillar,category:t.category,task:t.task,points:t.points,notes:t.notes});setAssignments(p=>{const n={...p,[dk]:[...(p[dk]||[]),row]};notifyUpdate(n);return n;});}catch(e){console.error(e);}}};
  const handleAddEvent=async form=>{try{const row=await createEvent(clientId,selectedDate,form);setEvents(p=>({...p,[selectedDate]:[...(p[selectedDate]||[]),row]}));}catch(e){console.error(e);}};
  const handleDeleteEvent=async id=>{try{await deleteEvent(id);setEvents(p=>{const n={...p};Object.keys(n).forEach(k=>{n[k]=n[k].filter(e=>e.id!==id);});return n;});}catch(e){console.error(e);}};

  const y=viewDate.getFullYear(),m=viewDate.getMonth();
  const firstDay=new Date(y,m,1).getDay(),daysInMonth=new Date(y,m+1,0).getDate();
  const cells=[];
  for(let i=0;i<firstDay;i++){const d=new Date(y,m,1-firstDay+i);cells.push({date:d,cur:false});}
  for(let i=1;i<=daysInMonth;i++)cells.push({date:new Date(y,m,i),cur:true});
  const rem=7-(cells.length%7);if(rem<7)for(let i=1;i<=rem;i++)cells.push({date:new Date(y,m+1,i),cur:false});

  const getWeekDates=anchor=>{const d=new Date(anchor+"T00:00:00"),sun=new Date(d);sun.setDate(d.getDate()-d.getDay());return Array.from({length:7},(_,i)=>{const x=new Date(sun);x.setDate(sun.getDate()+i);return toKey(x);});};
  const weekDates=getWeekDates(selectedDate||todayStr);

  const Panel=()=><DayPanel dateKey={selectedDate} tasks={getTasks(selectedDate)} events={getEvts(selectedDate)} isClientView={isClientView} onAddTask={handleAddTask} onUpdateTask={handleUpdateTask} onDeleteTask={handleDeleteTask} onCopyWeek={handleCopy} onAddEvent={handleAddEvent} onDeleteEvent={handleDeleteEvent}/>;

  return(
    <div className="fade-in">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          <div className="tabs" style={{marginBottom:0}}>
            {["day","week","month"].map(mode=><button key={mode} className={`tab${calMode===mode?" on":""}`} onClick={()=>setCalMode(mode)} style={{padding:"7px 16px"}}>{mode}</button>)}
          </div>
          {calMode==="month"&&(
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <button className="btn btn-ghost btn-sm" onClick={()=>setViewDate(d=>{const n=new Date(d);n.setMonth(n.getMonth()-1);return n;})}>‹</button>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,letterSpacing:"2px"}}>{MONTHS_LONG[m]} {y}</div>
              <button className="btn btn-ghost btn-sm" onClick={()=>setViewDate(d=>{const n=new Date(d);n.setMonth(n.getMonth()+1);return n;})}>›</button>
            </div>
          )}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={()=>{setSelectedDate(todayStr);setViewDate(new Date());}}>Today</button>
      </div>

      {calMode==="day"&&(
        <>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
            <button className="btn btn-ghost btn-sm" onClick={()=>{const d=new Date(selectedDate+"T00:00:00");d.setDate(d.getDate()-1);setSelectedDate(toKey(d));}}>‹</button>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:"2px"}}>{new Date(selectedDate+"T00:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</div>
            <button className="btn btn-ghost btn-sm" onClick={()=>{const d=new Date(selectedDate+"T00:00:00");d.setDate(d.getDate()+1);setSelectedDate(toKey(d));}}>›</button>
          </div>
          <Panel/>
        </>
      )}

      {calMode==="week"&&(
        <>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
            <button className="btn btn-ghost btn-sm" onClick={()=>{const d=new Date(selectedDate+"T00:00:00");d.setDate(d.getDate()-7);setSelectedDate(toKey(d));}}>‹ Prev</button>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"var(--muted)"}}>{fmtDate(weekDates[0])} – {fmtDate(weekDates[6])}</div>
            <button className="btn btn-ghost btn-sm" onClick={()=>{const d=new Date(selectedDate+"T00:00:00");d.setDate(d.getDate()+7);setSelectedDate(toKey(d));}}>Next ›</button>
          </div>
          <div className="week-strip">
            {weekDates.map(dk=>{const tasks=getTasks(dk),evts=getEvts(dk),isToday=dk===todayStr,isSel=dk===selectedDate,d=new Date(dk+"T00:00:00");return(
              <div key={dk} className={`week-strip-day${isSel?" wsd-active":""}${isToday?" wsd-today":""}`} onClick={()=>setSelectedDate(dk)}>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,letterSpacing:"2px",color:isToday?"var(--teal)":isSel?"var(--gold)":"var(--dim)",textTransform:"uppercase"}}>{DAYS_SHORT[d.getDay()]}</div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:isSel?"var(--gold)":"var(--muted)",marginTop:3}}>{d.getDate()}</div>
                {evts.length>0&&<div style={{width:6,height:6,borderRadius:"50%",background:"var(--gold)",margin:"3px auto 0"}}/>}
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:"var(--gold)",letterSpacing:"1px",marginTop:2}}>{tasks.length>0?totalPts(dk)+"pts":""}</div>
                <div style={{display:"flex",gap:2,justifyContent:"center",marginTop:3}}>{[...new Set(tasks.map(t=>t.pillar))].slice(0,4).map(pid=><div key={pid} style={{width:5,height:5,borderRadius:"50%",background:getPillar(pid).color}}/>)}</div>
              </div>
            );})}
          </div>
          <Panel/>
        </>
      )}

      {calMode==="month"&&(
        <>
          <div className="cal-grid mb20" style={{borderRadius:4,overflow:"hidden"}}>
            {DAYS_SHORT.map(d=><div key={d} className="cal-dow">{d}</div>)}
            {cells.map((cell,i)=>{const key=toKey(cell.date),tasks=getTasks(key),evts=getEvts(key),pct=completePct(key),pts=totalPts(key),isToday=key===todayStr,isSel=key===selectedDate;const pillars=[...new Set(tasks.map(t=>t.pillar))];return(
              <div key={i} className={`cal-cell${!cell.cur?" other-month":""}${isToday?" today-cell":""}${isSel?" selected-cell":""}`} onClick={()=>setSelectedDate(key)}>
                <div className="cal-day-num" style={{color:isSel?"var(--purple)":undefined}}>{cell.date.getDate()}</div>
                {evts.map(ev=>{const et=getEventType(ev.event_type);return(<div key={ev.id} className="cal-event-chip" style={{background:`${et.color}18`,color:et.color,border:`1px solid ${et.color}44`}}>📍 {ev.title}</div>);})}
                {tasks.length>0&&<><div className="cal-dot-row">{pillars.map(pid=><div key={pid} className="cal-dot" style={{background:getPillar(pid).color}}/>)}</div><div className="cal-pts-badge">{pts}pts</div></>}
                <div className="cal-complete-bar"><div className="cal-complete-fill" style={{width:`${pct}%`}}/></div>
              </div>
            );})}
          </div>
          {selectedDate&&<Panel/>}
        </>
      )}
    </div>
  );
}

// ─── MODALS ───────────────────────────────────────────────────────────────────

function AddClientModal({ onSave, onClose }) {
  const [form,setForm]=useState({name:"",title:"",startDate:"",phase:"1",coachNote:""});
  const [loading,setLoading]=useState(false);
  const s=k=>e=>setForm(f=>({...f,[k]:e.target.value}));
  const save=async()=>{if(!form.name.trim())return;setLoading(true);try{const token="apex-"+form.name.toLowerCase().replace(/\s+/g,"-").slice(0,8)+"-"+uid();await onSave({name:form.name.trim(),title:form.title.trim(),phase:parseInt(form.phase)||1,program_day:1,start_date:form.startDate||new Date().toISOString().split("T")[0],share_token:token,coach_note:form.coachNote});}finally{setLoading(false);}};
  return(
    <ModalWrap onClose={onClose}>
      <div className="h2" style={{color:"var(--gold)",marginBottom:22}}>New Client</div>
      <div className="input-row"><div><label className="label">Full Name *</label><input className="input" value={form.name} onChange={s("name")}/></div><div><label className="label">Title / Company</label><input className="input" value={form.title} onChange={s("title")}/></div></div>
      <div className="input-row"><div><label className="label">Start Date</label><input className="input" type="date" value={form.startDate} onChange={s("startDate")}/></div><div><label className="label">Phase</label><select className="input" value={form.phase} onChange={s("phase")}>{[1,2,3,4].map(p=><option key={p} value={p}>Phase {p} — {MACRO_PHASES[p-1].label}</option>)}</select></div></div>
      <div className="field"><label className="label">Coach Note</label><textarea className="input" rows={3} value={form.coachNote} onChange={s("coachNote")}/></div>
      <div style={{display:"flex",gap:10,marginTop:6}}><button className="btn btn-gold" onClick={save} disabled={loading||!form.name.trim()}>{loading?"Creating…":"Create Client"}</button><button className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
    </ModalWrap>
  );
}

function EditClientModal({ client, onSave, onClose }) {
  const [form,setForm]=useState({name:client.name,title:client.title||"",phase:client.phase,program_day:client.program_day,start_date:client.start_date,coach_note:client.coach_note||""});
  const s=k=>e=>setForm(f=>({...f,[k]:e.target.value}));
  return(
    <ModalWrap onClose={onClose}>
      <div className="h2" style={{color:"var(--gold)",marginBottom:22}}>Edit Profile</div>
      <div className="input-row"><div><label className="label">Name</label><input className="input" value={form.name} onChange={s("name")}/></div><div><label className="label">Title</label><input className="input" value={form.title} onChange={s("title")}/></div></div>
      <div className="input-row"><div><label className="label">Start Date</label><input className="input" type="date" value={form.start_date} onChange={s("start_date")}/></div><div><label className="label">Phase</label><select className="input" value={form.phase} onChange={s("phase")}>{[1,2,3,4].map(p=><option key={p} value={p}>Phase {p} — {MACRO_PHASES[p-1].label}</option>)}</select></div></div>
      <div className="field"><label className="label">Coach Note</label><textarea className="input" rows={3} value={form.coach_note} onChange={s("coach_note")}/></div>
      <div style={{display:"flex",gap:10,marginTop:6}}><button className="btn btn-gold" onClick={()=>onSave({name:form.name,title:form.title,phase:parseInt(form.phase),program_day:parseInt(form.program_day)||1,start_date:form.start_date,coach_note:form.coach_note})}>Save</button><button className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
    </ModalWrap>
  );
}

function PERMSModal({ client, permsHistory, onSave, onClose, editing }) {
  const [scores,setScores]=useState(editing?.scores?{...editing.scores}:{P:0,E:0,R:0,M:0,S:0});
  const [quarter,setQuarter]=useState(editing?.quarter||"");
  const [date,setDate]=useState(editing?.date||new Date().toISOString().split("T")[0]);
  const latest=permsHistory[permsHistory.length-1];
  const avg=permsAvg(scores);
  const prev=editing?null:latest;
  const StarInput=({value,onChange})=>(
    <div style={{display:"flex",gap:4,justifyContent:"center",marginTop:6}}>
      {[1,2,3,4,5].map(n=><div key={n} onClick={()=>onChange(n)} style={{width:26,height:26,borderRadius:3,border:`1.5px solid ${n<=value?permsColor(value):"#2A3040"}`,background:n<=value?`${permsColor(value)}22`:"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:n<=value?permsColor(value):"#3A4050",transition:"all .15s"}}>{n}</div>)}
    </div>
  );
  return(
    <ModalWrap onClose={onClose}>
      <div className="h2" style={{color:"var(--gold)",marginBottom:4}}>{editing?"Edit":"New"} P.E.R.M.S Assessment</div>
      <div className="mono tiny" style={{color:"var(--dim)",marginBottom:18}}>{client.name} · 1 = worst · 5 = best</div>
      <div className="input-row" style={{marginBottom:18}}>
        <div><label className="label">Quarter *</label><input className="input" placeholder="Q2 2026" value={quarter} onChange={e=>setQuarter(e.target.value)}/></div>
        <div><label className="label">Date</label><input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)}/></div>
      </div>
      <div className="sec">Scores</div>
      <div className="g5" style={{marginBottom:18}}>
        {PERMS_KEYS.map(pk=>{const v=scores[pk.key]||0,c=permsColor(v);return(
          <div className="perm-card" key={pk.key}>
            <div className="perm-letter" style={{color:c}}>{pk.key}</div>
            <div className="perm-sub">{pk.label}</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:c,letterSpacing:"2px",marginTop:4}}>{v||"—"}</div>
            <StarInput value={v} onChange={n=>setScores(s=>({...s,[pk.key]:n}))}/>
            <div style={{height:2,background:"var(--border)",borderRadius:1,marginTop:8,overflow:"hidden"}}><div style={{height:"100%",width:`${(v/5)*100}%`,background:c,borderRadius:1}}/></div>
          </div>
        );})}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:14,padding:"11px 14px",background:"var(--deep)",borderRadius:3,border:"1px solid var(--border)",marginBottom:18}}>
        <div className="mono tiny" style={{color:"var(--dim)"}}>Composite Avg</div>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"var(--gold)",letterSpacing:"2px"}}>{avg} / 5</div>
        {prev&&avg>0&&<div className="mono tiny" style={{color:avg>=permsAvg(prev.scores)?"var(--teal)":"var(--red)"}}>{avg>=permsAvg(prev.scores)?"▲":"▼"} {Math.abs(+(avg-permsAvg(prev.scores)).toFixed(1))} vs {prev.quarter}</div>}
      </div>
      <div style={{display:"flex",gap:10}}>
        <button className="btn btn-gold" disabled={!quarter.trim()||!Object.values(scores).some(v=>v>0)} onClick={()=>onSave({quarter:quarter.trim(),date,scores:{...scores}})}>Save Assessment</button>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </ModalWrap>
  );
}

function CSVModal({ clientName, onSave, onClose }) {
  const [dragging,setDragging]=useState(false);
  const [rows,setRows]=useState(null);
  const [error,setError]=useState("");
  const [isBridge,setIsBridge]=useState(false);
  const fileRef=useRef();
  const process=text=>{try{const bridge=text.includes("Form Name")||text.includes("Form ID");setIsBridge(bridge);setRows(bridge?parseBridgeCSV(text):parsePointsCSV(text));setError("");}catch(e){setError(e.message);setRows(null);}};
  const onFile=e=>{const f=e.target.files[0];if(f){const r=new FileReader();r.onload=ev=>process(ev.target.result);r.readAsText(f);}};
  const onDrop=e=>{e.preventDefault();setDragging(false);const f=e.dataTransfer.files[0];if(f){const r=new FileReader();r.onload=ev=>process(ev.target.result);r.readAsText(f);}};
  return(
    <ModalWrap onClose={onClose} wide>
      <div className="h2" style={{color:"var(--gold)",marginBottom:6}}>Import Weekly Points</div>
      <div className="mono tiny" style={{color:"var(--dim)",marginBottom:18}}>{clientName} · Bridge Athletic CSV or APEX format</div>
      <div className={`upload-zone${dragging?" drag":""}`} style={{marginBottom:14}} onClick={()=>fileRef.current.click()} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={onDrop}>
        <input ref={fileRef} type="file" accept=".csv,.txt" onChange={onFile}/>
        <div style={{fontSize:26,marginBottom:6}}>📄</div>
        <div className="mono tiny" style={{color:"var(--muted)"}}>Drop CSV here or click to browse</div>
      </div>
      {error&&<div style={{color:"var(--red)",fontFamily:"'JetBrains Mono',monospace",fontSize:11,marginTop:10,padding:"10px 14px",background:"rgba(232,64,64,.08)",borderRadius:3}}>{error}</div>}
      {rows&&(
        <div style={{marginTop:18}}>
          {isBridge&&<div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"var(--teal)",marginBottom:10,padding:"7px 12px",background:"rgba(78,205,196,.08)",borderRadius:3}}>✓ Bridge Athletic format — {rows.length} week{rows.length!==1?"s":""} calculated</div>}
          <div className="sec">{rows.length} week{rows.length!==1?"s":""}</div>
          <table className="pts-table">
            <thead><tr><th>Week</th><th style={{color:"#E8A020"}}>Move</th><th style={{color:"#4ECDC4"}}>Recover</th><th style={{color:"#E84040"}}>Fuel</th><th style={{color:"#8B7CF6"}}>Connect</th><th style={{color:"#60A5FA"}}>Breathe</th><th>Misc</th><th>Total</th></tr></thead>
            <tbody>{rows.map((r,i)=><tr key={i}><td><div style={{fontSize:13,color:"var(--muted)"}}>{r.label}</div><div className="mono tiny" style={{color:"var(--dim)"}}>{r.week}</div></td>{["move","recover","fuel","connect","breathe","misc"].map(k=><td key={k}><span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:getPillar(k)?.color||"var(--gold)"}}>{r[k]}</span></td>)}<td><span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:19,color:"var(--gold)"}}>{weekTotal(r)}</span></td></tr>)}</tbody>
          </table>
          <div style={{display:"flex",gap:10,marginTop:18}}><button className="btn btn-gold" onClick={()=>onSave(rows)}>Import {rows.length} Week{rows.length!==1?"s":""}</button><button className="btn btn-ghost" onClick={()=>setRows(null)}>Clear</button></div>
        </div>
      )}
    </ModalWrap>
  );
}

function WorkoutModal({ client, onSave, onClose, onScheduleParsed }) {
  const [files,setFiles]=useState([]);
  const [lbl,setLbl]=useState(""),wk=useState("")[0],setWk=useState("")[1];
  const [loading,setLoading]=useState(false),[dragging,setDragging]=useState(false);
  const [parsing,setParsing]=useState(false);
  const [preview,setPreview]=useState(null); // parsed schedule days
  const [parseError,setParseError]=useState("");
  const fileRef=useRef();
  const addFiles=fList=>setFiles(p=>[...p,...Array.from(fList).filter(f=>f.name.endsWith(".pdf"))]);

  const handleParse = async () => {
    if (!files.length) return;
    setParsing(true); setParseError(""); setPreview(null);
    try {
      const days = await parsePDFSchedule(files[0]);
      if (!days.length) { setParseError("No schedule found. Make sure this is a Bridge Athletic PDF."); }
      else setPreview(days);
    } catch(e) { setParseError(e.message); }
    finally { setParsing(false); }
  };

  const handleConfirmSchedule = async () => {
    if (!preview) return;
    setLoading(true);
    try {
      for (const day of preview) {
        await onScheduleParsed(day.dateKey, {
          pillar: day.pillar, category: day.category,
          task: day.task, points: day.points, notes: day.notes,
        });
      }
      // also upload the PDF
      if (files[0]) await onSave(files[0], lbl || files[0].name, wk);
      onClose();
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  };

  return(
    <ModalWrap onClose={onClose} wide>
      <div className="h2" style={{color:"var(--gold)",marginBottom:6}}>Upload Workout PDF</div>
      <div className="mono tiny" style={{color:"var(--dim)",marginBottom:22}}>{client.name}</div>
      <div className="input-row">
        <div><label className="label">Label</label><input className="input" placeholder="Phase 2 — Week 5" value={lbl} onChange={e=>setLbl(e.target.value)}/></div>
        <div><label className="label">Week</label><input className="input" placeholder="2026-W08" value={wk} onChange={e=>setWk(e.target.value)}/></div>
      </div>
      <div className={`upload-zone${dragging?" drag":""}`} style={{marginBottom:14}} onClick={()=>fileRef.current.click()} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);addFiles(e.dataTransfer.files);}}>
        <input ref={fileRef} type="file" accept=".pdf" multiple onChange={e=>addFiles(e.target.files)}/>
        <div style={{fontSize:26,marginBottom:6}}>📋</div>
        <div className="mono tiny" style={{color:"var(--muted)"}}>Drop Bridge Athletic PDF or click to browse</div>
      </div>
      {files.map((f,i)=><div key={i} className="workout-file"><span>📄</span><div style={{flex:1}}><div style={{fontSize:13,color:"var(--muted)"}}>{f.name}</div><div className="mono tiny" style={{color:"var(--dim)"}}>{(f.size/1024).toFixed(1)} KB</div></div><button className="btn btn-red btn-sm" onClick={()=>{setFiles(p=>p.filter((_,j)=>j!==i));setPreview(null);}}>✕</button></div>)}

      {files.length>0&&!preview&&(
        <div style={{display:"flex",gap:10,marginTop:14}}>
          <button className="btn btn-gold" disabled={parsing} onClick={handleParse}>{parsing?"Parsing PDF…":"📅 Parse & Preview Schedule"}</button>
          <button className="btn btn-ghost" disabled={loading} onClick={async()=>{setLoading(true);try{for(const f of files)await onSave(f,lbl,wk);onClose();}catch(e){console.error(e);}finally{setLoading(false);}}}>Upload Only</button>
        </div>
      )}

      {parseError&&<div style={{color:"var(--red)",fontFamily:"'JetBrains Mono',monospace",fontSize:11,marginTop:10,padding:"10px 14px",background:"rgba(232,64,64,.08)",borderRadius:3}}>{parseError}</div>}

      {preview&&(
        <div style={{marginTop:18}}>
          <div className="sec">{preview.length} workout days found</div>
          <div style={{maxHeight:320,overflowY:"auto",marginBottom:14}}>
            {preview.map((d,i)=>{const p=getPillar(d.pillar);return(
              <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 0",borderBottom:"1px solid var(--deep)"}}>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"var(--dim)",minWidth:72}}>{d.dateKey}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,color:"var(--muted)",fontWeight:600}}>{d.task}</div>
                  <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,color:p.color,marginTop:2,textTransform:"uppercase"}}>{p.label} · {d.category}{d.notes?" · "+d.notes:""}</div>
                </div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:"var(--gold)"}}>{d.points}pts</div>
              </div>
            );})}
          </div>
          <div style={{display:"flex",gap:10}}>
            <button className="btn btn-gold" disabled={loading} onClick={handleConfirmSchedule}>{loading?"Scheduling…":"✓ Add to Schedule"}</button>
            <button className="btn btn-ghost" onClick={()=>setPreview(null)}>Re-parse</button>
          </div>
        </div>
      )}
    </ModalWrap>
  );
}

function GoalsModal({ client, goals, onSave, onClose }) {
  const [list,setList]=useState(goals.map(g=>({...g,action_items:g.action_items||[]})));
  const addGoal=()=>setList(g=>[...g,{goal:"",deadline:"Ongoing",progress:0,action_items:[]}]);
  const rmGoal=i=>setList(g=>g.filter((_,x)=>x!==i));
  const sg=(i,k)=>e=>setList(g=>{const n=[...g];n[i]={...n[i],[k]:k==="progress"?Math.min(100,Math.max(0,parseInt(e.target.value)||0)):e.target.value};return n;});
  const addAction=i=>setList(g=>{const n=[...g];if((n[i].action_items||[]).length<5)n[i]={...n[i],action_items:[...(n[i].action_items||[]),{text:"",done:false}]};return n;});
  const updateAction=(i,j,k,v)=>setList(g=>{const n=[...g];const ai=[...(n[i].action_items||[])];ai[j]={...ai[j],[k]:v};n[i]={...n[i],action_items:ai};return n;});
  const rmAction=(i,j)=>setList(g=>{const n=[...g];n[i]={...n[i],action_items:(n[i].action_items||[]).filter((_,x)=>x!==j)};return n;});
  return(
    <ModalWrap onClose={onClose} wide>
      <div className="h2" style={{color:"var(--gold)",marginBottom:22}}>Edit Goals — {client.name}</div>
      {list.map((g,i)=>(
        <div key={i} style={{background:"var(--deep)",border:"1px solid var(--border)",borderRadius:4,padding:16,marginBottom:12}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 110px 72px 36px",gap:10,marginBottom:10,alignItems:"center"}}>
            <input className="input input-sm" placeholder="Goal description" value={g.goal} onChange={sg(i,"goal")}/>
            <input className="input input-sm" placeholder="Deadline" value={g.deadline} onChange={sg(i,"deadline")}/>
            <input className="input input-sm" type="number" min={0} max={100} value={g.progress} onChange={sg(i,"progress")} title="Progress %"/>
            <button className="btn btn-red btn-sm" style={{padding:"7px 8px"}} onClick={()=>rmGoal(i)}>✕</button>
          </div>
          <div style={{paddingLeft:8}}>
            <div className="mono tiny" style={{color:"var(--dim)",marginBottom:6}}>Action Items ({(g.action_items||[]).length}/5)</div>
            {(g.action_items||[]).map((ai,j)=>(
              <div key={j} className="action-item-row">
                <div className={`action-check${ai.done?" done":""}`} onClick={()=>updateAction(i,j,"done",!ai.done)}>{ai.done?"✓":""}</div>
                <input className="input input-sm" style={{flex:1}} placeholder="Action item…" value={ai.text} onChange={e=>updateAction(i,j,"text",e.target.value)}/>
                <button className="btn btn-red btn-sm" style={{padding:"3px 7px"}} onClick={()=>rmAction(i,j)}>✕</button>
              </div>
            ))}
            {(g.action_items||[]).length<5&&<button className="btn btn-ghost btn-sm" style={{marginTop:6,fontSize:"8px"}} onClick={()=>addAction(i)}>+ Add Action Item</button>}
          </div>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={addGoal} style={{marginTop:4}}>+ Add Goal</button>
      <div style={{display:"flex",gap:10,marginTop:18}}><button className="btn btn-gold" onClick={()=>onSave(list)}>Save Goals</button><button className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
    </ModalWrap>
  );
}

// ─── CLIENT DASHBOARD ─────────────────────────────────────────────────────────

// ─── TASK LIST VIEW ───────────────────────────────────────────────────────────

function TaskListView({ clientId, isClientView }) {
  const [allTasks, setAllTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [moveTarget, setMoveTarget] = useState("");
  const [filterPillar, setFilterPillar] = useState("all");
  const [filterDone, setFilterDone] = useState("all");
  const [sortBy, setSortBy] = useState("date");
  const [sortDir, setSortDir] = useState("asc");

  const load = async () => {
    setLoading(true);
    try {
      // fetch a wide range — 1 year back to 1 year forward
      const from = new Date(); from.setFullYear(from.getFullYear() - 1);
      const to = new Date(); to.setFullYear(to.getFullYear() + 1);
      const rows = await fetchAssignments(clientId, toKey(from), toKey(to));
      setAllTasks(rows);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [clientId]);

  const toggleSelect = id => setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = () => setSelected(new Set(filtered.map(t => t.id)));
  const clearSelect = () => { setSelected(new Set()); setMoveTarget(""); };

  const filtered = allTasks
    .filter(t => filterPillar === "all" || t.pillar === filterPillar)
    .filter(t => filterDone === "all" ? true : filterDone === "done" ? t.done : !t.done)
    .sort((a, b) => {
      let va = a[sortBy] || "", vb = b[sortBy] || "";
      if (sortBy === "points") { va = a.points || 0; vb = b.points || 0; }
      const cmp = typeof va === "number" ? va - vb : va.localeCompare(vb);
      return sortDir === "asc" ? cmp : -cmp;
    });

  const handleSort = col => {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
  };

  const handleMassMove = async () => {
    if (!moveTarget || !selected.size) return;
    for (const id of selected) await updateAssignment(id, { date: moveTarget });
    await load(); clearSelect();
  };

  const handleMassDelete = async () => {
    if (!selected.size) return;
    if (!window.confirm(`Delete ${selected.size} task${selected.size !== 1 ? "s" : ""}?`)) return;
    for (const id of selected) await deleteAssignment(id);
    await load(); clearSelect();
  };

  const handleToggleDone = async (id, done) => {
    await updateAssignment(id, { done: !done });
    setAllTasks(p => p.map(t => t.id === id ? { ...t, done: !done } : t));
  };

  const SortArrow = ({ col }) => sortBy === col
    ? <span style={{ color: "var(--gold)", marginLeft: 4 }}>{sortDir === "asc" ? "↑" : "↓"}</span>
    : <span style={{ color: "var(--border)", marginLeft: 4 }}>↕</span>;

  const allSelected = filtered.length > 0 && filtered.every(t => selected.has(t.id));

  if (loading) return <div style={{ textAlign: "center", padding: "48px", color: "var(--dim)" }}><div className="mono tiny">Loading tasks…</div></div>;

  return (
    <div className="fade-in">
      {/* ── TOOLBAR ── */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
        {/* Pillar filter */}
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={`tab${filterPillar === "all" ? " on" : ""}`} onClick={() => setFilterPillar("all")}>All</button>
          {PILLARS.map(p => (
            <button key={p.id} className={`tab${filterPillar === p.id ? " on" : ""}`}
              style={{ color: filterPillar === p.id ? p.color : undefined, borderBottom: filterPillar === p.id ? `2px solid ${p.color}` : undefined }}
              onClick={() => setFilterPillar(p.id)}>{p.label}</button>
          ))}
        </div>
        {/* Done filter */}
        <div className="tabs" style={{ marginBottom: 0 }}>
          {[["all","All"],["done","Done"],["pending","Pending"]].map(([v,l]) => (
            <button key={v} className={`tab${filterDone === v ? " on" : ""}`} onClick={() => setFilterDone(v)}>{l}</button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: "var(--dim)" }}>
          {filtered.length} task{filtered.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* ── SELECTION ACTION BAR ── */}
      {selected.size > 0 && !isClientView && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "12px 16px", background: "rgba(139,124,246,.08)", border: "1px solid rgba(139,124,246,.25)", borderRadius: 4, marginBottom: 14 }}>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: "var(--purple)", fontWeight: 700 }}>{selected.size} selected</div>
          <button className="btn btn-ghost btn-sm" onClick={clearSelect}>Clear</button>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: 8 }}>
            <input type="date" className="input input-sm" style={{ width: 140 }} value={moveTarget} onChange={e => setMoveTarget(e.target.value)} />
            <button className="btn btn-teal btn-sm" disabled={!moveTarget} onClick={handleMassMove}>Move to Date</button>
          </div>
          <button className="btn btn-red btn-sm" onClick={handleMassDelete}>Delete {selected.size}</button>
        </div>
      )}

      {/* ── TABLE ── */}
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "48px" }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
          <div className="mono tiny" style={{ color: "var(--dim)" }}>No tasks match this filter</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="pts-table" style={{ width: "100%" }}>
            <thead>
              <tr style={{ background: "var(--deep)" }}>
                {!isClientView && (
                  <th style={{ padding: "10px 14px", width: 36 }}>
                    <div className={`action-check${allSelected ? " done" : ""}`}
                      style={{ cursor: "pointer", margin: "0 auto" }}
                      onClick={() => allSelected ? clearSelect() : selectAll()}>
                      {allSelected ? "✓" : ""}
                    </div>
                  </th>
                )}
                <th style={{ padding: "10px 8px", cursor: "pointer" }} onClick={() => handleSort("date")}>Date <SortArrow col="date"/></th>
                <th style={{ padding: "10px 8px", cursor: "pointer" }} onClick={() => handleSort("pillar")}>Pillar <SortArrow col="pillar"/></th>
                <th style={{ padding: "10px 8px", cursor: "pointer" }} onClick={() => handleSort("task")}>Task <SortArrow col="task"/></th>
                <th style={{ padding: "10px 8px" }}>Category</th>
                <th style={{ padding: "10px 8px", cursor: "pointer" }} onClick={() => handleSort("points")}>Pts <SortArrow col="points"/></th>
                <th style={{ padding: "10px 8px", cursor: "pointer" }} onClick={() => handleSort("done")}>Status <SortArrow col="done"/></th>
                {!isClientView && <th style={{ padding: "10px 8px" }}/>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((task, i) => {
                const p = getPillar(task.pillar);
                const isSel = selected.has(task.id);
                return (
                  <tr key={task.id} style={{ background: isSel ? "rgba(139,124,246,.06)" : i % 2 === 0 ? "transparent" : "rgba(255,255,255,.01)", transition: "background .15s" }}>
                    {!isClientView && (
                      <td style={{ padding: "10px 14px" }}>
                        <div className={`action-check${isSel ? " done" : ""}`}
                          style={{ cursor: "pointer", margin: "0 auto", borderColor: isSel ? "var(--purple)" : undefined, background: isSel ? "rgba(139,124,246,.2)" : undefined }}
                          onClick={() => toggleSelect(task.id)}>{isSel ? "✓" : ""}</div>
                      </td>
                    )}
                    <td style={{ padding: "10px 8px" }}>
                      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: task.date === todayKey() ? "var(--teal)" : "var(--muted)" }}>{fmtDate(task.date)}</div>
                      <div className="mono tiny" style={{ color: "var(--dim)", marginTop: 2 }}>{task.date}</div>
                    </td>
                    <td style={{ padding: "10px 8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: p.color, flexShrink: 0 }} />
                        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: p.color, textTransform: "uppercase" }}>{p.label}</div>
                      </div>
                    </td>
                    <td style={{ padding: "10px 8px" }}>
                      <div style={{ fontSize: 13, color: task.done ? "#3A4050" : "var(--muted)", textDecoration: task.done ? "line-through" : "none", fontWeight: 500 }}>{task.task}</div>
                      {task.notes && <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: "var(--dim)", marginTop: 2 }}>{task.notes}</div>}
                    </td>
                    <td style={{ padding: "10px 8px" }}>
                      <div className="mono tiny" style={{ color: "var(--dim)" }}>{task.category}</div>
                    </td>
                    <td style={{ padding: "10px 8px" }}>
                      <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, color: "var(--gold)" }}>{task.points}</div>
                    </td>
                    <td style={{ padding: "10px 8px" }}>
                      <div className={`pill`} style={{
                        background: task.done ? "rgba(78,205,196,.1)" : "rgba(90,96,112,.1)",
                        color: task.done ? "var(--teal)" : "var(--dim)",
                        border: `1px solid ${task.done ? "rgba(78,205,196,.3)" : "rgba(90,96,112,.2)"}`,
                        cursor: "pointer"
                      }} onClick={() => handleToggleDone(task.id, task.done)}>
                        {task.done ? "Done" : "Pending"}
                      </div>
                    </td>
                    {!isClientView && (
                      <td style={{ padding: "10px 8px" }}>
                        <button className="btn btn-red btn-sm" style={{ padding: "4px 8px" }} onClick={async () => {
                          if (!window.confirm("Delete this task?")) return;
                          await deleteAssignment(task.id);
                          setAllTasks(p => p.filter(t => t.id !== task.id));
                        }}>✕</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── CALENDAR EXPORT ─────────────────────────────────────────────────────────

function toICSDate(dateStr) {
  return dateStr.replace(/-/g,"")+"T080000Z";
}
function toICSDateEnd(dateStr) {
  return dateStr.replace(/-/g,"")+"T090000Z";
}
function escapeICS(str) {
  return (str||"").replace(/[\\;,]/g,"\\$&").replace(/\n/g,"\\n");
}

function generateICS(assignments) {
  const events = [];
  Object.entries(assignments).forEach(([date, tasks]) => {
    tasks.forEach(task => {
      const p = getPillar(task.pillar);
      events.push([
        "BEGIN:VEVENT",
        `UID:${task.id}@apex-platform`,
        `DTSTART:${toICSDate(date)}`,
        `DTEND:${toICSDateEnd(date)}`,
        `SUMMARY:${escapeICS(`[${p.label.toUpperCase()}] ${task.task}`)}`,
        `DESCRIPTION:${escapeICS(`${task.category}${task.notes?" — "+task.notes:""} · ${task.points} pts`)}`,
        "END:VEVENT"
      ].join("\r\n"));
    });
  });
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//APEX Platform//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events,
    "END:VCALENDAR"
  ].join("\r\n");
}

function googleCalLink(date, task) {
  const p = getPillar(task.pillar);
  const start = date.replace(/-/g,"")+"T080000Z";
  const end   = date.replace(/-/g,"")+"T090000Z";
  const title = encodeURIComponent(`[${p.label}] ${task.task}`);
  const details = encodeURIComponent(`${task.category}${task.notes?" — "+task.notes:""} · ${task.points} pts`);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}`;
}

function CalendarExportModal({ clientId, clientName, onClose }) {
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState({});
  const [mode, setMode] = useState("ics"); // "ics" | "google"
  const [dateRange, setDateRange] = useState("month");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const now = new Date();
        let from, to;
        if (dateRange === "week") {
          from = new Date(now); from.setDate(now.getDate() - now.getDay());
          to   = new Date(from); to.setDate(from.getDate() + 6);
        } else if (dateRange === "month") {
          from = new Date(now.getFullYear(), now.getMonth(), 1);
          to   = new Date(now.getFullYear(), now.getMonth()+1, 0);
        } else {
          from = new Date(now.getFullYear(), 0, 1);
          to   = new Date(now.getFullYear(), 11, 31);
        }
        const rows = await fetchAssignments(clientId, toKey(from), toKey(to));
        const ga = {};
        rows.forEach(r => { if(!ga[r.date]) ga[r.date]=[]; ga[r.date].push(r); });
        setAssignments(ga);
      } catch(e) { console.error(e); }
      finally { setLoading(false); }
    };
    load();
  }, [clientId, dateRange]);

  const totalTasks = Object.values(assignments).reduce((a,v)=>a+v.length,0);

  const downloadICS = () => {
    const ics = generateICS(assignments);
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${clientName.replace(/\s+/g,"-")}-schedule.ics`;
    a.click(); URL.revokeObjectURL(url);
  };

  const allDates = Object.keys(assignments).sort();

  return (
    <ModalWrap onClose={onClose} wide>
      <div className="h2" style={{color:"var(--gold)",marginBottom:6}}>Add to Calendar</div>
      <div className="mono tiny" style={{color:"var(--dim)",marginBottom:20}}>{clientName} · {totalTasks} tasks</div>

      {/* Range selector */}
      <div className="sec" style={{marginBottom:12}}>Date Range</div>
      <div className="tabs" style={{marginBottom:20}}>
        {[["week","This Week"],["month","This Month"],["year","Full Year"]].map(([v,l])=>(
          <button key={v} className={`tab${dateRange===v?" on":""}`} onClick={()=>setDateRange(v)}>{l}</button>
        ))}
      </div>

      {/* Method selector */}
      <div className="sec" style={{marginBottom:12}}>Export Method</div>
      <div style={{display:"flex",gap:12,marginBottom:20}}>
        <div onClick={()=>setMode("ics")} style={{flex:1,padding:"14px 16px",background:mode==="ics"?"rgba(232,160,32,.08)":"var(--deep)",border:`1px solid ${mode==="ics"?"rgba(232,160,32,.4)":"var(--border)"}`,borderRadius:4,cursor:"pointer",transition:"all .2s"}}>
          <div style={{fontSize:22,marginBottom:6}}>📅</div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:mode==="ics"?"var(--gold)":"var(--muted)",fontWeight:700,marginBottom:4}}>Download ICS File</div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,color:"var(--dim)"}}>Apple Calendar · Outlook · Any calendar app</div>
        </div>
        <div onClick={()=>setMode("google")} style={{flex:1,padding:"14px 16px",background:mode==="google"?"rgba(78,205,196,.08)":"var(--deep)",border:`1px solid ${mode==="google"?"rgba(78,205,196,.4)":"var(--border)"}`,borderRadius:4,cursor:"pointer",transition:"all .2s"}}>
          <div style={{fontSize:22,marginBottom:6}}>🔗</div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:mode==="google"?"var(--teal)":"var(--muted)",fontWeight:700,marginBottom:4}}>Google Calendar Links</div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,color:"var(--dim)"}}>Click to add individual events</div>
        </div>
      </div>

      {loading ? (
        <div style={{textAlign:"center",padding:"24px",color:"var(--dim)"}}><div className="mono tiny">Loading schedule…</div></div>
      ) : totalTasks === 0 ? (
        <div style={{textAlign:"center",padding:"24px",color:"var(--dim)"}}><div className="mono tiny">No tasks in this range</div></div>
      ) : mode === "ics" ? (
        <div>
          <div style={{padding:"12px 16px",background:"rgba(78,205,196,.06)",border:"1px solid rgba(78,205,196,.2)",borderRadius:4,marginBottom:16}}>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"var(--teal)",marginBottom:4}}>How to import:</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,color:"var(--dim)",lineHeight:1.8}}>
              <div><span style={{color:"var(--muted)"}}>Apple:</span> Double-click the downloaded file</div>
              <div><span style={{color:"var(--muted)"}}>Outlook:</span> File → Open & Export → Import/Export</div>
              <div><span style={{color:"var(--muted)"}}>Google:</span> calendar.google.com → Settings → Import</div>
            </div>
          </div>
          <button className="btn btn-gold" onClick={downloadICS}>↓ Download {totalTasks} Events (.ics)</button>
        </div>
      ) : (
        <div style={{maxHeight:340,overflowY:"auto"}}>
          {allDates.map(date => (
            <div key={date} style={{marginBottom:10}}>
              <div className="mono tiny" style={{color:"var(--dim)",marginBottom:5}}>{fmtDate(date)}</div>
              {assignments[date].map(task => {
                const p = getPillar(task.pillar);
                return (
                  <div key={task.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid var(--deep)"}}>
                    <div style={{width:7,height:7,borderRadius:"50%",background:p.color,flexShrink:0}}/>
                    <div style={{flex:1,fontSize:13,color:"var(--muted)"}}>{task.task}</div>
                    <a href={googleCalLink(date,task)} target="_blank" rel="noreferrer"
                      style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,color:"var(--teal)",border:"1px solid rgba(78,205,196,.3)",padding:"4px 8px",borderRadius:3,textDecoration:"none",whiteSpace:"nowrap"}}>
                      + Google Cal
                    </a>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </ModalWrap>
  );
}
function ComplianceSection({ compliance, compliancePage, setCompliancePage }) {
  const PAGE = 12;
  const total = compliance.weeklyRates.length;
  const totalPages = Math.ceil(total / PAGE);
  const safeP = compliancePage === null
    ? totalPages - 1
    : Math.max(0, Math.min(compliancePage, totalPages - 1));
  const pageRates = compliance.weeklyRates.slice(safeP * PAGE, safeP * PAGE + PAGE);
  const startWk = pageRates[0]?.week;
  const endWk = pageRates[pageRates.length - 1]?.week;

  return (
    <div className="card mb24">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div className="mono tiny" style={{color:"var(--dim)"}}>Task Compliance Trend</div>
          {total > PAGE && <div className="mono tiny" style={{color:"var(--dim)"}}>{startWk} — {endWk}</div>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{display:"flex",gap:12}}>
            {[["≥75%","var(--teal)"],["≥50%","var(--gold)"],["<50%","var(--red)"]].map(([l,c])=>(
              <div key={l} style={{display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:c}}/>
                <div className="mono tiny" style={{color:"var(--dim)"}}>{l}</div>
              </div>
            ))}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6,marginLeft:8}}>
            <button className="btn btn-ghost btn-sm" style={{padding:"4px 10px"}} disabled={safeP===0} onClick={()=>setCompliancePage(safeP-1)}>‹</button>
            <div className="mono tiny" style={{color:"var(--dim)",minWidth:44,textAlign:"center"}}>{safeP+1} / {totalPages}</div>
            <button className="btn btn-ghost btn-sm" style={{padding:"4px 10px"}} disabled={safeP===totalPages-1} onClick={()=>setCompliancePage(safeP+1)}>›</button>
            {compliancePage!==null && (
              <button className="btn btn-ghost btn-sm" style={{padding:"4px 8px",fontSize:"8px"}} onClick={()=>setCompliancePage(null)}>Latest</button>
            )}
          </div>
        </div>
      </div>
      <ComplianceChart weeklyRates={pageRates}/>
      <div style={{display:"flex",justifyContent:"center",gap:5,marginTop:10,flexWrap:"wrap"}}>
        {Array.from({length:totalPages},(_,i)=>(
          <div key={i} onClick={()=>setCompliancePage(i)}
            style={{width:22,height:5,borderRadius:3,background:i===safeP?"var(--teal)":"var(--border)",cursor:"pointer",transition:"background .2s"}}/>
        ))}
      </div>
    </div>
  );
}

function ClientDashboard({ client, onBack, onRefresh, isClientView }) {
function ClientDashboard({ client, onBack, onRefresh, isClientView }) {
  const [tab,setTab]=useState("overview");
  const [modal,setModal]=useState(null);
  const [toast,setToast]=useState(null);
  const [goals,setGoals]=useState([]);
  const [permsHistory,setPermsHistory]=useState([]);
  const [weeklyPoints,setWeeklyPoints]=useState([]);
  const [workouts,setWorkouts]=useState([]);
  const [coachNotes,setCoachNotes]=useState([]);
  const [loading,setLoading]=useState(true);
  const [ptsPeriod,setPtsPeriod]=useState("weekly");
  const [editingPerms,setEditingPerms]=useState(null);
  const [calAssignments,setCalAssignments]=useState({});
  const [allAssignments,setAllAssignments]=useState({});
  const [newNote,setNewNote]=useState({week:"",label:"",text:""});
  const [addingNote,setAddingNote]=useState(false);
  const [compliancePage,setCompliancePage]=useState(null); // null = show latest
  const [calExport,setCalExport]=useState(false);
  const show=msg=>{setToast(msg);setModal(null);};

  useEffect(()=>{
    const load=async()=>{
      setLoading(true);
      try{
      const[g,p,w,wo,cn]=await Promise.all([fetchGoals(client.id),fetchPERMS(client.id),fetchWeeklyPoints(client.id),fetchWorkouts(client.id),fetchCoachNotes(client.id)]);
      setGoals(g);setPermsHistory(p);setWeeklyPoints(w);setWorkouts(wo);setCoachNotes(cn);
      // load full assignment history for compliance
      const from=new Date(); from.setFullYear(from.getFullYear()-1);
      const to=new Date(); to.setFullYear(to.getFullYear()+1);
      const rows=await fetchAssignments(client.id,toKey(from),toKey(to));
      const ga={};
      rows.forEach(r=>{if(!ga[r.date])ga[r.date]=[];ga[r.date].push(r);});
      setAllAssignments(ga);
    }
      catch(e){console.error(e);}finally{setLoading(false);}
    };load();
  },[client.id]);

  const shareUrl=`${window.location.origin}${window.location.pathname}?view=${client.share_token}`;
  const latest=permsHistory[permsHistory.length-1];
  const prev=permsHistory[permsHistory.length-2];
  const totalPts=weeklyPoints.reduce((a,w)=>a+weekTotal(w),0);
  const lastWeek=weeklyPoints[weeklyPoints.length-1];
  const aggregated=aggregatePoints(weeklyPoints,ptsPeriod);
  const momentum=calcMomentum(weeklyPoints);
  const compliance=calcCompliance(allAssignments, client.start_date);

  const currentWeekISO=getWeekISO(new Date());
  const currentWeekLabel=getWeekLabel(currentWeekISO);

  if(loading) return <div style={{textAlign:"center",padding:"60px",color:"var(--dim)"}}><div className="mono tiny">Loading…</div></div>;

  return(
    <div className="fade-in">
      {!isClientView&&<button className="back-btn" onClick={onBack}>← All Clients</button>}
      {isClientView&&<div className="client-banner"><span style={{fontSize:16}}>👤</span><div><div className="mono tiny" style={{color:"var(--purple)"}}>XPT · APEX — Client Portal</div><div style={{fontSize:13,color:"var(--muted)",marginTop:2}}>Welcome back, {client.name}.</div></div><button className="btn btn-ghost btn-sm" style={{marginLeft:"auto"}} onClick={()=>setCalExport(true)}>📅 Add to Calendar</button></div>}

      <div className="page-header">
        <div>
          <div style={{height:3,width:70,borderRadius:2,marginBottom:5,background:`linear-gradient(90deg,${phaseColor(client.phase)},transparent)`}}/>
          <div className="h1">{client.name}</div>
          <div className="mono tiny" style={{color:"var(--dim)",marginTop:3}}>{client.title}</div>
        </div>
        <div style={{textAlign:"right",display:"flex",flexDirection:"column",gap:9,alignItems:"flex-end"}}>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>
            <div className="badge">XPT · APEX</div>
            <div className="pill" style={{background:`${phaseColor(client.phase)}18`,color:phaseColor(client.phase),border:`1px solid ${phaseColor(client.phase)}44`,fontSize:9,padding:"4px 10px"}}>Phase {client.phase}</div>
          </div>
          <div className="mono tiny" style={{color:"var(--dim)"}}>Day {client.program_day} · Started {new Date(client.start_date+"T00:00:00").toLocaleDateString()}</div>
          {!isClientView&&(
            <div style={{display:"flex",gap:7,flexWrap:"wrap",justifyContent:"flex-end"}}>
              <button className="btn btn-ghost btn-sm" onClick={()=>setModal("editclient")}>✎ Edit Profile</button>
              <button className="btn btn-ghost btn-sm" onClick={()=>{setEditingPerms(null);setModal("perms");}}>Update PERMS</button>
              <button className="btn btn-ghost btn-sm" onClick={()=>setModal("goals")}>Edit Goals</button>
              <button className="btn btn-ghost btn-sm" onClick={()=>setModal("workout")}>Upload Workouts</button>
              <button className="btn btn-gold btn-sm" onClick={()=>setModal("csv")}>Import Points CSV</button>
            </div>
          )}
        </div>
      </div>

      {!isClientView&&(
        <div className="share-banner mb24">
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{color:"var(--teal)",fontSize:14}}>🔗</span>
            <div><div className="mono tiny" style={{color:"var(--teal)"}}>Client Share Link</div><div className="mono" style={{fontSize:9,color:"var(--dim)",marginTop:2,wordBreak:"break-all"}}>{shareUrl}</div></div>
          </div>
          <button className="btn btn-teal btn-sm" onClick={()=>{navigator.clipboard?.writeText(shareUrl);show("Link copied");}}>Copy Link</button>
        </div>
      )}

      <div className="tabs">
        {[{id:"overview",label:"Overview"},{id:"schedule",label:"Schedule"},{id:"tasklist",label:"Task List"},{id:"points",label:"Points"},{id:"workouts",label:"Workouts"}].map(t=>(
          <button key={t.id} className={`tab${tab===t.id?" on":""}`} onClick={()=>setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab==="schedule"&&<CalendarView clientId={client.id} isClientView={isClientView} onAssignmentsUpdate={setCalAssignments}/>}
      {tab==="tasklist"&&<TaskListView clientId={client.id} isClientView={isClientView}/>}

      {tab==="overview"&&(
        <div className="fade-in">
          {/* ── TOP STATS ROW ── */}
          <div className="g6 mb24" style={{gridTemplateColumns:"repeat(5,1fr)"}}>
            <div className="card"><div className="stat-lbl">Total Points</div><div className="stat-val" style={{fontSize:28}}>{totalPts.toLocaleString()}</div><div className="stat-sub">{weeklyPoints.length}w tracked</div></div>
            <div className="card"><div className="stat-lbl">Last Week</div><div className="stat-val" style={{fontSize:28}}>{lastWeek?weekTotal(lastWeek):"—"}</div><div className="stat-sub">{lastWeek?.label?.split("–")[0]||"—"}</div></div>
            <div className="card"><div className="stat-lbl">PERMS Avg</div><div className="stat-val" style={{fontSize:28}}>{latest?permsAvg(latest.scores):"—"}<span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"var(--dim)"}}>/5</span></div><div className="stat-sub">{latest?.quarter||"—"}</div></div>

            {/* Momentum */}
            <div className={`card${momentum?" card-"+(momentum.up?"teal":""):""}` } style={{borderColor:momentum?(momentum.up?"rgba(78,205,196,.3)":"rgba(232,64,64,.3)"):""}}>
              <div className="stat-lbl">Momentum</div>
              {momentum?(
                <>
                  <div style={{display:"flex",alignItems:"baseline",gap:6}}>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:momentum.up?"var(--teal)":"var(--red)",letterSpacing:"2px"}}>{momentum.up?"+":""}{momentum.pct}%</div>
                    <div style={{fontSize:16}}>{momentum.up?"▲":"▼"}</div>
                  </div>
                  <div className="stat-sub">vs prev {momentum.weeks} wks</div>
                </>
              ):<div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"var(--dim)",marginTop:8}}>Need 2+ weeks</div>}
            </div>

            {/* Compliance */}
            <div className="card">
              <div className="stat-lbl">Compliance</div>
              {compliance?(
                <>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:compliance.recentRate>=75?"var(--teal)":compliance.recentRate>=50?"var(--gold)":"var(--red)",letterSpacing:"2px"}}>{compliance.recentRate}%</div>
                  <div className="stat-sub">{compliance.overall}% all-time</div>
                  <div className="compliance-bar-wrap" style={{marginTop:8}}><div className="compliance-bar-fill" style={{width:`${compliance.recentRate}%`,background:compliance.recentRate>=75?"var(--teal)":compliance.recentRate>=50?"var(--gold)":"var(--red)"}}/></div>
                </>
              ):<div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"var(--dim)",marginTop:8}}>No tasks logged</div>}
            </div>
          </div>

          {/* ── COMPLIANCE TREND ── */}
          {compliance&&compliance.weeklyRates.length>=2&&(
        <ComplianceSection compliance={compliance} compliancePage={compliancePage} setCompliancePage={setCompliancePage}/>
      )}
            const PAGE=12; // weeks per page
            const total=compliance.weeklyRates.length;
            const totalPages=Math.ceil(total/PAGE);
            const currentPage=compliancePage===null?totalPages-1:compliancePage;
            const safeP=Math.max(0,Math.min(currentPage,totalPages-1));
            const start=safeP*PAGE;
            const pageRates=compliance.weeklyRates.slice(start,start+PAGE);
            const startWk=pageRates[0]?.week;
            const endWk=pageRates[pageRates.length-1]?.week;
            return(
              <div className="card mb24">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div style={{display:"flex",alignItems:"center",gap:12}}>
                    <div className="mono tiny" style={{color:"var(--dim)"}}>Task Compliance Trend</div>
                    {total>PAGE&&<div className="mono tiny" style={{color:"var(--dim)"}}>{startWk} — {endWk}</div>}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{display:"flex",gap:12}}>
                      {[["≥75%","var(--teal)"],["≥50%","var(--gold)"],["<50%","var(--red)"]].map(([l,c])=>(
                        <div key={l} style={{display:"flex",alignItems:"center",gap:5}}>
                          <div style={{width:8,height:8,borderRadius:"50%",background:c}}/>
                          <div className="mono tiny" style={{color:"var(--dim)"}}>{l}</div>
                        </div>
                      ))}
                    </div>
                    {total>PAGE&&(
                      <div style={{display:"flex",alignItems:"center",gap:6,marginLeft:8}}>
                        <button className="btn btn-ghost btn-sm" style={{padding:"4px 8px"}} disabled={safeP===0} onClick={()=>setCompliancePage(safeP-1)}>‹</button>
                        <div className="mono tiny" style={{color:"var(--dim)",minWidth:40,textAlign:"center"}}>{safeP+1}/{totalPages}</div>
                        <button className="btn btn-ghost btn-sm" style={{padding:"4px 8px"}} disabled={safeP===totalPages-1} onClick={()=>setCompliancePage(safeP+1)}>›</button>
                        {compliancePage!==null&&<button className="btn btn-ghost btn-sm" style={{padding:"4px 8px",fontSize:"8px"}} onClick={()=>setCompliancePage(null)}>Latest</button>}
                      </div>
                    )}
                  </div>
                </div>
                <ComplianceChart weeklyRates={pageRates}/>
                {total>PAGE&&(
                  <div style={{display:"flex",justifyContent:"center",gap:6,marginTop:10,flexWrap:"wrap"}}>
                    {Array.from({length:totalPages},(_,i)=>(
                      <div key={i} onClick={()=>setCompliancePage(i)} style={{width:24,height:6,borderRadius:3,background:i===safeP?"var(--teal)":"var(--border)",cursor:"pointer",transition:"background .2s"}}/>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── PERMS + RADAR row ── */}
          <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:18,alignItems:"start",marginBottom:24}}>
            <div>
              <div className="sec">P.E.R.M.S History
                {!isClientView&&<button className="btn btn-ghost btn-sm" style={{marginLeft:"auto",marginRight:0}} onClick={()=>{setEditingPerms(null);setModal("perms");}}>+ New</button>}
              </div>
              {permsHistory.length===0?(
                <div className="card" style={{textAlign:"center",padding:"28px"}}><div style={{fontSize:26,marginBottom:8}}>📊</div><div className="mono tiny" style={{color:"var(--dim)"}}>No PERMS assessment on file yet</div></div>
              ):(
                <>
                  <div className="g5 mb12">
                    {PERMS_KEYS.map(pk=>{const v=latest.scores[pk.key]||0,pv=prev?.scores[pk.key]||0,c=permsColor(v);return(
                      <div className="perm-card" key={pk.key}>
                        <div className="perm-letter" style={{color:c}}>{pk.key}</div>
                        <div className="perm-sub">{pk.label}</div>
                        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:c}}>{v}<span style={{fontSize:12,color:"var(--dim)"}}>/5</span></div>
                        <div style={{display:"flex",gap:3,justifyContent:"center",marginTop:5}}>{[1,2,3,4,5].map(n=><div key={n} style={{width:9,height:9,borderRadius:2,background:n<=v?c:"#1A1F2E"}}/>)}</div>
                        {prev&&<div style={{fontSize:9,fontFamily:"'JetBrains Mono',monospace",color:v>=pv?"var(--teal)":"var(--red)",marginTop:4}}>{v>=pv?"▲":"▼"}{Math.abs(v-pv)} vs {prev.quarter}</div>}
                      </div>
                    );})}
                  </div>
                  {/* All assessments list */}
                  <div className="card mb12">
                    <div className="mono tiny" style={{color:"var(--dim)",marginBottom:10}}>All Assessments</div>
                    {[...permsHistory].reverse().map((entry,i)=>(
                      <div key={entry.id||i} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:"1px solid var(--deep)"}}>
                        <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:"var(--muted)"}}>{entry.quarter}</div><div className="mono tiny" style={{color:"var(--dim)",marginTop:1}}>{entry.date}</div></div>
                        {PERMS_KEYS.map(pk=>{const v=entry.scores[pk.key]||0,c=permsColor(v);return(<div key={pk.key} style={{textAlign:"center",minWidth:28}}><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:7,color:"var(--dim)",textTransform:"uppercase"}}>{pk.key}</div><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:c}}>{v}</div></div>);})}
                        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:19,color:"var(--gold)",minWidth:36,textAlign:"right"}}>{permsAvg(entry.scores)}</div>
                        {!isClientView&&(
                          <div style={{display:"flex",gap:5}}>
                            <button className="btn btn-ghost btn-sm" style={{padding:"4px 7px"}} onClick={()=>{setEditingPerms(entry);setModal("perms");}}>✎</button>
                            <button className="btn btn-red btn-sm" style={{padding:"4px 7px"}} onClick={async()=>{if(!window.confirm(`Delete ${entry.quarter}?`))return;await deletePERMS(entry.id);setPermsHistory(await fetchPERMS(client.id));show("Deleted");}}>✕</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {/* PERMS Trend chart */}
                  {permsHistory.length>=2&&(
                    <div className="card">
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                        <div className="mono tiny" style={{color:"var(--dim)"}}>PERMS Trend</div>
                        <div style={{display:"flex",gap:10}}>{PERMS_KEYS.map(pk=><div key={pk.key} style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:8,height:8,borderRadius:"50%",background:pk.color}}/><div className="mono tiny" style={{color:"var(--dim)"}}>{pk.key}</div></div>)}</div>
                      </div>
                      <PERMSChart history={permsHistory}/>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Radar chart */}
            <div style={{width:300}}>
              <div className="sec" style={{marginBottom:12}}>Pillar Balance</div>
              <div className="card" style={{padding:16}}>
                <div className="mono tiny" style={{color:"var(--dim)",marginBottom:8}}>Avg last 4 weeks</div>
                <div style={{display:"flex",justifyContent:"center"}}>
                  <RadarChart weeklyPoints={weeklyPoints}/>
                </div>
              </div>
            </div>
          </div>

          {/* ── GOALS + COACH NOTES + PHASE ── */}
          <div className="gmain">
            <div>
              <div className="sec">Goals{!isClientView&&<button className="btn btn-ghost btn-sm" style={{marginLeft:"auto",marginRight:0}} onClick={()=>setModal("goals")}>✎ Edit</button>}</div>
              <div className="card mb24">
                {goals.length===0?<div style={{textAlign:"center",padding:"20px",color:"var(--dim)",fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>No goals set yet</div>:(
                  goals.map((g,i)=>(
                    <div key={i} style={{padding:"12px 0",borderBottom:"1px solid var(--deep)"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                        <div style={{fontSize:14,fontWeight:600,color:"var(--muted)"}}>{g.goal}</div>
                        <div style={{display:"flex",gap:12,alignItems:"center"}}>
                          <div className="mono tiny" style={{color:"var(--dim)"}}>{g.deadline}</div>
                          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:19,color:"var(--gold)"}}>{g.progress}%</div>
                        </div>
                      </div>
                      <div className="track" style={{marginTop:0,marginBottom:8}}><div className="fill" style={{width:`${g.progress}%`,background:g.progress>=80?"var(--teal)":g.progress>=50?"var(--gold)":"var(--purple)"}}/></div>
                      {(g.action_items||[]).length>0&&(
                        <div style={{paddingLeft:4}}>
                          {(g.action_items||[]).map((ai,j)=>(
                            <div key={j} className="action-item-row" style={{opacity:ai.done?.6:1}}>
                              <div className={`action-check${ai.done?" done":""}`} onClick={async()=>{const updated=goals.map((gl,gi)=>gi!==i?gl:{...gl,action_items:(gl.action_items||[]).map((a,aj)=>aj!==j?a:{...a,done:!a.done})});setGoals(updated);await upsertGoals(client.id,updated);}}>
                                {ai.done?"✓":""}
                              </div>
                              <div style={{fontSize:12,color:ai.done?"#3A4050":"var(--dim)",textDecoration:ai.done?"line-through":"none"}}>{ai.text}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* ── COACH NOTES ── */}
              <div className="sec">Weekly Coach Notes
                {!isClientView&&<button className="btn btn-ghost btn-sm" style={{marginLeft:"auto",marginRight:0}} onClick={()=>{setNewNote({week:currentWeekISO,label:currentWeekLabel,text:""});setAddingNote(true);}}>+ Add Note</button>}
              </div>
              {addingNote&&!isClientView&&(
                <div className="note-card mb12" style={{borderColor:"rgba(232,160,32,.3)"}}>
                  <div className="input-row" style={{marginBottom:10}}>
                    <div><label className="label">Week ISO</label><input className="input input-sm" value={newNote.week} onChange={e=>setNewNote(n=>({...n,week:e.target.value}))}/></div>
                    <div><label className="label">Label</label><input className="input input-sm" value={newNote.label} onChange={e=>setNewNote(n=>({...n,label:e.target.value}))}/></div>
                  </div>
                  <label className="label">Note</label>
                  <textarea className="input" rows={4} placeholder="Observations, adjustments, focus areas…" value={newNote.text} onChange={e=>setNewNote(n=>({...n,text:e.target.value}))} style={{marginBottom:10}}/>
                  <div style={{display:"flex",gap:8}}>
                    <button className="btn btn-gold btn-sm" disabled={!newNote.text.trim()||!newNote.week.trim()} onClick={async()=>{await upsertCoachNote(client.id,newNote.week,newNote.label,newNote.text);setCoachNotes(await fetchCoachNotes(client.id));setAddingNote(false);show("Note saved");}}>Save Note</button>
                    <button className="btn btn-ghost btn-sm" onClick={()=>setAddingNote(false)}>Cancel</button>
                  </div>
                </div>
              )}
              {coachNotes.length===0&&!addingNote?(
                <div className="card mb24" style={{textAlign:"center",padding:"20px"}}><div className="mono tiny" style={{color:"var(--dim)"}}>No coach notes yet</div></div>
              ):(
                <div className="mb24">
                  {coachNotes.map((note,i)=>(
                    <div key={note.id||i} className="note-card">
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                        <div>
                          <div style={{fontSize:13,fontWeight:600,color:"var(--muted)"}}>{note.week_label||note.week_iso}</div>
                          <div className="mono tiny" style={{color:"var(--dim)",marginTop:2}}>{note.week_iso}</div>
                        </div>
                        {!isClientView&&(
                          <button className="btn btn-red btn-sm" style={{padding:"4px 8px"}} onClick={async()=>{await deleteCoachNote(note.id);setCoachNotes(await fetchCoachNotes(client.id));show("Note deleted");}}>✕</button>
                        )}
                      </div>
                      <div style={{fontSize:14,color:"var(--muted)",lineHeight:1.6,whiteSpace:"pre-wrap"}}>{note.note}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              {(client.coach_note||!isClientView)&&(
                <div className="card card-gold">
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div className="mono tiny" style={{color:"var(--dim)"}}>Coach Note</div>
                    {!isClientView&&<button className="btn btn-ghost btn-sm" onClick={()=>setModal("editclient")}>✎</button>}
                  </div>
                  <div style={{fontSize:14,color:"var(--muted)",lineHeight:1.6}}>{client.coach_note||<span style={{color:"var(--dim)",fontStyle:"italic"}}>No note yet</span>}</div>
                </div>
              )}
              <div className="card">
                <div className="mono tiny" style={{color:"var(--dim)",marginBottom:12}}>Program Phases</div>
                {MACRO_PHASES.map((ph,i)=>{const n=i+1,isA=n===client.phase,isDone=n<client.phase;return(
                  <div key={i} style={{padding:"9px 0",borderBottom:"1px solid var(--deep)",opacity:n>client.phase?.5:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{width:7,height:7,borderRadius:"50%",background:isA?ph.color:isDone?"var(--teal)":"var(--border)",flexShrink:0}}/>
                      <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:isA?ph.color:isDone?"var(--teal)":"var(--dim)"}}>{ph.label}</div><div className="mono tiny" style={{color:"var(--dim)"}}>{ph.months}</div></div>
                      {isA&&<div className="pill" style={{background:"rgba(232,160,32,.1)",color:"var(--gold)",border:"1px solid rgba(232,160,32,.3)"}}>Active</div>}
                      {isDone&&<div className="pill" style={{background:"rgba(78,205,196,.1)",color:"var(--teal)",border:"1px solid rgba(78,205,196,.3)"}}>Done</div>}
                    </div>
                  </div>
                );})}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab==="points"&&(
        <div className="fade-in">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
            <div style={{display:"flex",gap:6}}>
              {["weekly","monthly","quarterly","annual"].map(p=>(
                <button key={p} className={`btn btn-ghost btn-sm${ptsPeriod===p?" on":""}`} onClick={()=>setPtsPeriod(p)}>{p.charAt(0).toUpperCase()+p.slice(1)}</button>
              ))}
            </div>
            {!isClientView&&<button className="btn btn-gold btn-sm" onClick={()=>setModal("csv")}>+ Import CSV</button>}
          </div>
          {weeklyPoints.length===0?(
            <div className="card" style={{textAlign:"center",padding:"48px"}}><div style={{fontSize:34,marginBottom:10}}>📊</div><div className="mono tiny" style={{color:"var(--dim)"}}>No weekly points imported yet</div></div>
          ):(
            <>
              <div className="g4 mb24">
                {["move","recover","fuel","connect"].map(k=>{const p=getPillar(k),total=aggregated.reduce((a,w)=>a+(w[k]||0),0),avg=aggregated.length?Math.round(total/aggregated.length):0;return(
                  <div className="card" key={k}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}><div style={{width:7,height:7,borderRadius:"50%",background:p.color}}/><div className="mono tiny" style={{color:"var(--dim)"}}>{p.label}</div></div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,color:p.color,letterSpacing:"2px"}}>{total}</div>
                    <div className="mono tiny" style={{color:"var(--dim)"}}>{avg} avg / period</div>
                  </div>
                );})}
              </div>
              <div className="sec">Points by Pillar — {ptsPeriod}</div>
              <div className="card mb24" style={{padding:"20px 20px 8px"}}>
                <div style={{display:"flex",gap:14,marginBottom:14,flexWrap:"wrap"}}>
                  {PILLARS.map(p=><div key={p.id} style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:10,height:2,background:p.color,borderRadius:1}}/><div className="mono tiny" style={{color:"var(--dim)"}}>{p.label}</div></div>)}
                </div>
                <PointsChart data={aggregated}/>
              </div>
              <div className="sec">Breakdown</div>
              <div className="card">
                <table className="pts-table">
                  <thead><tr><th>Period</th><th style={{color:"#E8A020"}}>Move</th><th style={{color:"#4ECDC4"}}>Recover</th><th style={{color:"#E84040"}}>Fuel</th><th style={{color:"#8B7CF6"}}>Connect</th><th style={{color:"#60A5FA"}}>Breathe</th><th>Misc</th><th>Total</th>{!isClientView&&ptsPeriod==="weekly"&&<th/>}</tr></thead>
                  <tbody>{aggregated.map((w,i)=>(
                    <tr key={i}>
                      <td><div style={{fontSize:13,color:"var(--muted)"}}>{w.label||w.week}</div></td>
                      {["move","recover","fuel","connect","breathe","misc"].map(k=><td key={k}><span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:getPillar(k)?.color||"var(--gold)"}}>{w[k]||0}</span></td>)}
                      <td><span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:19,color:"var(--gold)"}}>{weekTotal(w)}</span></td>
                      {!isClientView&&ptsPeriod==="weekly"&&<td><button className="btn btn-red btn-sm" onClick={async()=>{await deleteWeeklyPoints(client.id,w.week);setWeeklyPoints(await fetchWeeklyPoints(client.id));}}>✕</button></td>}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {tab==="workouts"&&(
        <div className="fade-in">
          {!isClientView&&<div style={{display:"flex",justifyContent:"flex-end",marginBottom:16}}><button className="btn btn-gold btn-sm" onClick={()=>setModal("workout")}>+ Upload PDF</button></div>}
          {workouts.length===0?<div className="card" style={{textAlign:"center",padding:"48px"}}><div style={{fontSize:34,marginBottom:10}}>📋</div><div className="mono tiny" style={{color:"var(--dim)"}}>No workouts uploaded yet</div></div>:(
            Object.entries(workouts.reduce((acc,w)=>{const k=w.week||"Unassigned";if(!acc[k])acc[k]=[];acc[k].push(w);return acc;},{})).map(([week,wouts])=>(
              <div key={week} style={{marginBottom:22}}>
                <div className="sec">{week}</div>
                {wouts.map(w=><div key={w.id} className="workout-file"><span style={{fontSize:20}}>📄</span><div style={{flex:1}}><div style={{fontSize:14,fontWeight:500,color:"var(--muted)"}}>{w.name}</div><div className="mono tiny" style={{color:"var(--dim)"}}>{new Date(w.uploaded_at).toLocaleDateString()} · {((w.size_bytes||0)/1024).toFixed(1)} KB</div></div>{w.signedUrl&&<a href={w.signedUrl} target="_blank" rel="noreferrer" className="btn btn-teal btn-sm" style={{textDecoration:"none"}}>↓ Download</a>}{!isClientView&&<button className="btn btn-red btn-sm" onClick={async()=>{await deleteWorkout(w.id,w.storage_path);setWorkouts(await fetchWorkouts(client.id));}}>Remove</button>}</div>)}
              </div>
            ))
          )}
        </div>
      )}

      {modal==="editclient"&&<EditClientModal client={client} onSave={async c=>{await updateClient(client.id,c);await onRefresh();show("Profile updated");}} onClose={()=>setModal(null)}/>}
      {modal==="perms"&&<PERMSModal client={client} permsHistory={permsHistory} editing={editingPerms} onSave={async e=>{await upsertPERMS(client.id,e);setPermsHistory(await fetchPERMS(client.id));show("PERMS saved");setEditingPerms(null);}} onClose={()=>{setModal(null);setEditingPerms(null);}}/>}
      {modal==="goals"&&<GoalsModal client={client} goals={goals} onSave={async g=>{await upsertGoals(client.id,g);setGoals(await fetchGoals(client.id));show("Goals updated");setModal(null);}} onClose={()=>setModal(null)}/>}
      {modal==="workout"&&<WorkoutModal client={client}
  onSave={async(f,l,w)=>{await uploadWorkout(client.id,f,l,w);setWorkouts(await fetchWorkouts(client.id));show("Uploaded");}}
  onScheduleParsed={async(dateKey,task)=>{await createAssignment(client.id,dateKey,task);show("Schedule imported");}}
  onClose={()=>setModal(null)}/>}
      {modal==="csv"&&<CSVModal clientName={client.name} onSave={async rows=>{await upsertWeeklyPoints(client.id,rows);setWeeklyPoints(await fetchWeeklyPoints(client.id));show(`${rows.length} week(s) imported`);}} onClose={()=>setModal(null)}/>}
      {calExport&&<CalendarExportModal clientId={client.id} clientName={client.name} onClose={()=>setCalExport(false)}/>}
      {toast&&<Toast msg={toast} onDone={()=>setToast(null)}/>}
    </div>
  );
}

// ─── ROSTER ───────────────────────────────────────────────────────────────────

function Roster({ clients, onSelect, onAdd }) {
  return(
    <div className="fade-in">
      <div className="page-header">
        <div><div className="h1">Client Roster</div><div className="mono tiny" style={{color:"var(--dim)",marginTop:4}}>XPT APEX Program · Coach Dashboard</div></div>
        <button className="btn btn-gold" onClick={onAdd}>+ New Client</button>
      </div>
      <div className="sec">{clients.length} Active Client{clients.length!==1?"s":""}</div>
      <div className="g3">
        {clients.map(c=>{const pc=phaseColor(c.phase);return(
          <div className="client-card" key={c.id} onClick={()=>onSelect(c.id)}>
            <div style={{height:3,background:`linear-gradient(90deg,${pc},transparent)`,marginBottom:10,borderRadius:2}}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
              <div><div style={{fontSize:17,fontWeight:700,color:"var(--text)"}}>{c.name}</div><div className="mono tiny" style={{color:"var(--dim)",marginTop:2}}>{c.title}</div></div>
              <div className="pill" style={{background:`${pc}18`,color:pc,border:`1px solid ${pc}44`}}>P{c.phase}</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div>
                <div className="mono tiny" style={{color:"var(--dim)"}}>PERMS</div>
                {c.latestPerms
                  ? <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:permsColor(c.latestPerms),letterSpacing:"1px"}}>{c.latestPerms}<span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"var(--dim)"}}>/5</span></div>
                  : <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"var(--dim)",marginTop:4}}>No data</div>
                }
              </div>
              <div><div className="mono tiny" style={{color:"var(--dim)"}}>Phase</div><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:15,color:pc,letterSpacing:"1px"}}>{MACRO_PHASES[(c.phase||1)-1]?.label}</div></div>
            </div>
          </div>
        );})}
      </div>
    </div>
  );
}

// ─── SHARED VIEW ──────────────────────────────────────────────────────────────

function SharedClientView({ token }) {
  const [client,setClient]=useState(null);
  const [notFound,setNotFound]=useState(false);
  useEffect(()=>{fetchClientByToken(token).then(setClient).catch(()=>setNotFound(true));},[token]);
  if(notFound) return <div style={{minHeight:"100vh",background:"#080A0E",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{textAlign:"center"}}><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,color:"#E8A020",letterSpacing:3,marginBottom:8}}>APEX</div><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"#5A6070",letterSpacing:2}}>Client view not found</div></div></div>;
  if(!client) return <div className="loading-screen"><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:"#E8A020",letterSpacing:3}}>APEX</div><div className="mono tiny" style={{color:"#5A6070"}}>Loading…</div></div>;
  return <div className="root"><div className="main" style={{marginLeft:0,maxWidth:1200,margin:"0 auto"}}><ClientDashboard client={client} isClientView onBack={()=>{}} onRefresh={async()=>{}}/></div></div>;
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────

export default function APEXPlatform() {
  const [session,setSession]=useState(undefined);
  const [clients,setClients]=useState([]);
  const [selectedId,setSelectedId]=useState(null);
  const [addModal,setAddModal]=useState(false);

  const params=new URLSearchParams(window.location.search);
  const shareToken=params.get("view");
  if(shareToken) return <><style>{S}</style><SharedClientView token={shareToken}/></>;

  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>setSession(session));
    const{data:{subscription}}=supabase.auth.onAuthStateChange((_,s)=>setSession(s));
    return()=>subscription.unsubscribe();
  },[]);

  const loadClients=useCallback(async()=>{
    try{
      const list=await fetchClients();
      const withPerms=await Promise.all(list.map(async c=>{
        try{
          const p=await fetchPERMS(c.id);
          const latest=p[p.length-1];
          return{...c,latestPerms:latest?permsAvg(latest.scores):null};
        }catch{return c;}
      }));
      setClients(withPerms);
    }catch(e){console.error(e);}
  },[]);
  useEffect(()=>{if(session)loadClients();},[session,loadClients]);

  const handleAdd=async data=>{const c=await createClient(data);await loadClients();setAddModal(false);setSelectedId(c.id);};
  const handleSignOut=async()=>{await signOut();setClients([]);setSelectedId(null);};

  if(session===undefined) return <><style>{S}</style><div className="loading-screen"><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,color:"#E8A020",letterSpacing:3}}>APEX</div><div className="mono tiny" style={{color:"#5A6070"}}>Loading…</div></div></>;
  if(!session) return <><style>{S}</style><LoginScreen onLogin={loadClients}/></>;

  const selected=clients.find(c=>c.id===selectedId);
  return(
    <>
      <style>{S}</style>
      <div className="root">
        <div className="sidebar">
          <div className="sb-logo">XPT</div>
          <div className="sb-div"/>
          <button className={`sb-btn${!selectedId?" on":""}`} onClick={()=>setSelectedId(null)}><span className="sb-icon">⊞</span><span className="sb-lbl">Roster</span></button>
          <div className="sb-div"/>
          {clients.map(c=>(
            <button key={c.id} className={`sb-btn${selectedId===c.id?" on":""}`} onClick={()=>setSelectedId(c.id)} title={c.name}>
              <div style={{width:30,height:30,borderRadius:"50%",background:`${phaseColor(c.phase)}20`,border:`1.5px solid ${phaseColor(c.phase)}55`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Bebas Neue',sans-serif",fontSize:11,color:phaseColor(c.phase),letterSpacing:"1px"}}>
                {c.name.split(" ").map(n=>n[0]).join("").slice(0,2)}
              </div>
            </button>
          ))}
          <div style={{flex:1}}/>
          <div className="sb-div"/>
          <button className="sb-btn" onClick={handleSignOut} title="Sign out"><span className="sb-icon" style={{fontSize:13}}>⏻</span><span className="sb-lbl">Out</span></button>
          <div style={{height:8}}/>
        </div>
        <div className="main">
          {!selectedId&&<Roster clients={clients} onSelect={setSelectedId} onAdd={()=>setAddModal(true)}/>}
          {selectedId&&selected&&<ClientDashboard key={selectedId} client={selected} isClientView={false} onBack={()=>setSelectedId(null)} onRefresh={loadClients}/>}
        </div>
        {addModal&&<AddClientModal onSave={handleAdd} onClose={()=>setAddModal(false)}/>}
      </div>
    </>
  );
}
