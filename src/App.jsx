import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "./lib/supabase";
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
  fetchJournalEntries, createJournalEntry, updateJournalEntry, deleteJournalEntry,
  fetchWorkouts, uploadWorkout, deleteWorkout,
  parseBridgeCSV,
} from "./lib/db";
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

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

const getPillar   = id  => PILLARS.find(p => p.id === id) || PILLARS[0];
const getEventType= id  => EVENT_TYPES.find(e => e.id === id) || EVENT_TYPES[0];
const permsAvg    = s   => { const v=Object.values(s).filter(x=>x>0); return v.length?+(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1):0; };
const weekTotal   = w   => ["move","recover","fuel","connect","breathe","misc"].reduce((a,k)=>a+(w[k]||0),0);
const phaseColor  = p   => MACRO_PHASES[(p||1)-1]?.color||"#E8A020";
const toKey       = d   => { const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${day}`; };
const todayKey    = ()  => toKey(new Date());
const uid         = ()  => Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const fmtDate     = s   => new Date(s+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"});
const permsColor  = v   => v>=4?"var(--teal)":v>=3?"var(--gold)":"var(--red)";

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
function aggregatePoints(weeks,period) {
  if(period==="weekly") return weeks;
  const grouped={};
  weeks.forEach(w=>{
    const [yearStr,weekStr]=w.week.split("-W");
    const year=parseInt(yearStr),weekNum=parseInt(weekStr);
    let key;
    if(period==="monthly"){const m=Math.min(11,Math.floor((weekNum-1)/4.33));key=`${year}-${String(m+1).padStart(2,"0")}`;}
    else if(period==="quarterly"){const q=Math.ceil(weekNum/13);key=`${year}-Q${q}`;}
    else{key=`${year}`;}
    if(!grouped[key])grouped[key]={week:key,label:key,move:0,recover:0,fuel:0,connect:0,breathe:0,misc:0};
    ["move","recover","fuel","connect","breathe","misc"].forEach(k=>{grouped[key][k]+=(w[k]||0);});
  });
  return Object.values(grouped).sort((a,b)=>a.week.localeCompare(b.week));
}
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
function calcCompliance(assignments, startDate) {
  if(!Object.keys(assignments).length) return null;
  const start = startDate ? new Date(startDate+"T00:00:00") : null;
  const byWeek={};
  Object.entries(assignments).forEach(([date,tasks])=>{
    let wkLabel;
    if(start){
      const d=new Date(date+"T00:00:00");
      const diffDays=Math.floor((d-start)/(1000*60*60*24));
      const weekNum=Math.floor(diffDays/7)+1;
      if(weekNum<1) return;
      wkLabel=`Wk ${weekNum}`;
    } else {
      wkLabel=getWeekISO(new Date(date+"T00:00:00"));
    }
    if(!byWeek[wkLabel])byWeek[wkLabel]={done:0,total:0,weekNum:start?parseInt(wkLabel.replace("Wk ","")):0};
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

const WORKOUT_PILLAR_MAP = [
  { match: /recovery|mobility|nature|family|rest/i,   pillar:"recover", category:"Recovery Education" },
  { match: /conditioning.*run|run/i,                  pillar:"move",    category:"Conditioning" },
  { match: /conditioning.*non.load|non.load/i,        pillar:"recover", category:"Breathwork" },
  { match: /kb happy hour|kettlebell/i,               pillar:"move",    category:"General Activity" },
  { match: /lower push|upper pull|upper push|lower pull|total body|strength|barbell|squat|deadlift|bench/i, pillar:"move", category:"Strength" },
  { match: /swim|bike|cycle/i,                        pillar:"move",    category:"Conditioning" },
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
  const dayRe = /Day\s+(\d+)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+([\w\s\/\(\)\-]+?)\s+(\d+)\s+min/g;
  const results = [];
  let m;
  while ((m = dayRe.exec(fullText)) !== null) {
    const [,, mon, dayOfMonth, workoutRaw, durStr] = m;
    const workout = workoutRaw.trim().replace(/\s+/g, " ");
    const duration = parseInt(durStr) || 0;
    const monthMap = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    const now = new Date(); let year = now.getFullYear();
    const mo = monthMap[mon];
    if (mo < now.getMonth() - 1) year++;
    const date = new Date(year, mo, parseInt(dayOfMonth));
    const dateKey = toKey(date);
    const mapped = mapWorkout(workout, duration);
    results.push({ dateKey, workout, duration, ...mapped, task: workout, notes: duration > 0 ? `${duration} min` : "" });
  }
  return results;
}

function toICSDate(dateStr){return dateStr.replace(/-/g,"")+"T080000Z";}
function toICSDateEnd(dateStr){return dateStr.replace(/-/g,"")+"T090000Z";}
function escapeICS(str){return (str||"").replace(/[\\;,]/g,"\\$&").replace(/\n/g,"\\n");}
function generateICS(assignments){
  const events=[];
  Object.entries(assignments).forEach(([date,tasks])=>{
    tasks.forEach(task=>{
      const p=getPillar(task.pillar);
      events.push(["BEGIN:VEVENT",`UID:${task.id}@apex`,`DTSTART:${toICSDate(date)}`,`DTEND:${toICSDateEnd(date)}`,`SUMMARY:${escapeICS("["+p.label.toUpperCase()+"] "+task.task)}`,`DESCRIPTION:${escapeICS(task.category+(task.notes?" — "+task.notes:"")+" · "+task.points+" pts")}`, "END:VEVENT"].join("\r\n"));
    });
  });
  return ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//APEX//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH",...events,"END:VCALENDAR"].join("\r\n");
}
function googleCalLink(date,task){
  const p=getPillar(task.pillar);
  const start=date.replace(/-/g,"")+"T080000Z",end=date.replace(/-/g,"")+"T090000Z";
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent("["+p.label+"] "+task.task)}&dates=${start}/${end}&details=${encodeURIComponent(task.category+(task.notes?" — "+task.notes:"")+" · "+task.points+" pts")}`;
}

function CalendarExportModal({clientId,clientName,onClose}){
  const [loading,setLoading]=useState(true);
  const [assignments,setAssignments]=useState({});
  const [mode,setMode]=useState("ics");
  const [dateRange,setDateRange]=useState("month");
  useEffect(()=>{
    const load=async()=>{
      setLoading(true);
      try{
        const now=new Date(); let from,to;
        if(dateRange==="week"){from=new Date(now);from.setDate(now.getDate()-now.getDay());to=new Date(from);to.setDate(from.getDate()+6);}
        else if(dateRange==="month"){from=new Date(now.getFullYear(),now.getMonth(),1);to=new Date(now.getFullYear(),now.getMonth()+1,0);}
        else{from=new Date(now.getFullYear(),0,1);to=new Date(now.getFullYear(),11,31);}
        const rows=await fetchAssignments(clientId,toKey(from),toKey(to));
        const ga={};rows.forEach(r=>{if(!ga[r.date])ga[r.date]=[];ga[r.date].push(r);});setAssignments(ga);
      }catch(e){console.error(e);}finally{setLoading(false);}
    };load();
  },[clientId,dateRange]);
  const totalTasks=Object.values(assignments).reduce((a,v)=>a+v.length,0);
  const allDates=Object.keys(assignments).sort();
  const downloadICS=()=>{
    const blob=new Blob([generateICS(assignments)],{type:"text/calendar;charset=utf-8"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`${clientName.replace(/\s+/g,"-")}-schedule.ics`;a.click();URL.revokeObjectURL(url);
  };
  return(
    <ModalWrap onClose={onClose} wide>
      <div className="h2" style={{color:"var(--gold)",marginBottom:6}}>Add to Calendar</div>
      <div className="mono tiny" style={{color:"var(--dim)",marginBottom:20}}>{clientName} · {totalTasks} tasks</div>
      <div className="sec" style={{marginBottom:12}}>Date Range</div>
      <div className="tabs" style={{marginBottom:20}}>
        {[["week","This Week"],["month","This Month"],["year","Full Year"]].map(([v,l])=>(
          <button key={v} className={`tab${dateRange===v?" on":""}`} onClick={()=>setDateRange(v)}>{l}</button>
        ))}
      </div>
      <div className="sec" style={{marginBottom:12}}>Export Method</div>
      <div style={{display:"flex",gap:12,marginBottom:20}}>
        {[["ics","📅","Download ICS File","Apple · Outlook · Any app","var(--gold)","rgba(232,160,32,.08)","rgba(232,160,32,.4)"],
          ["google","🔗","Google Calendar Links","Add individual events","var(--teal)","rgba(78,205,196,.08)","rgba(78,205,196,.4)"]].map(([v,icon,title,sub,col,bg,border])=>(
          <div key={v} onClick={()=>setMode(v)} style={{flex:1,padding:"14px 16px",background:mode===v?bg:"var(--deep)",border:`1px solid ${mode===v?border:"var(--border)"}`,borderRadius:4,cursor:"pointer"}}>
            <div style={{fontSize:22,marginBottom:6}}>{icon}</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:mode===v?col:"var(--muted)",fontWeight:700,marginBottom:4}}>{title}</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,color:"var(--dim)"}}>{sub}</div>
          </div>
        ))}
      </div>
      {loading?<div style={{textAlign:"center",padding:"24px",color:"var(--dim)"}}><div className="mono tiny">Loading…</div></div>
      :totalTasks===0?<div style={{textAlign:"center",padding:"24px"}}><div className="mono tiny" style={{color:"var(--dim)"}}>No tasks in this range</div></div>
      :mode==="ics"?(
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
      ):(
        <div style={{maxHeight:340,overflowY:"auto"}}>
          {allDates.map(date=>(
            <div key={date} style={{marginBottom:10}}>
              <div className="mono tiny" style={{color:"var(--dim)",marginBottom:5}}>{fmtDate(date)}</div>
              {assignments[date].map(task=>{const p=getPillar(task.pillar);return(
                <div key={task.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid var(--deep)"}}>
                  <div style={{width:7,height:7,borderRadius:"50%",background:p.color,flexShrink:0}}/>
                  <div style={{flex:1,fontSize:13,color:"var(--muted)"}}>{task.task}</div>
                  <a href={googleCalLink(date,task)} target="_blank" rel="noreferrer" style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,color:"var(--teal)",border:"1px solid rgba(78,205,196,.3)",padding:"4px 8px",borderRadius:3,textDecoration:"none",whiteSpace:"nowrap"}}>+ Google Cal</a>
                </div>
              );})}
            </div>
          ))}
        </div>
      )}
    </ModalWrap>
  );
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
.compliance-bar-wrap{height:6px;background:var(--border);border-radius:3px;overflow:hidden}
.compliance-bar-fill{height:100%;border-radius:3px;transition:width .8s ease}
`;

function Toast({msg,onDone}){useEffect(()=>{const t=setTimeout(onDone,3000);return()=>clearTimeout(t);},[]);return <div className="toast">✓ {msg}</div>;}
function ModalWrap({onClose,children,wide}){return(<div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}><div className={`modal fade-in${wide?" modal-wide":""}`}><button className="modal-close" onClick={onClose}>✕</button>{children}</div></div>);}

function RadarChart({weeklyPoints}){
  const pillars=PILLARS.filter(p=>["move","recover","fuel","connect","misc"].includes(p.id));
  const n=pillars.length,CX=140,CY=130,R=90;
  const last4=weeklyPoints.slice(-4);
  const totals=pillars.map(p=>last4.length?last4.reduce((a,w)=>a+(w[p.id]||0),0)/last4.length:0);
  const maxVal=Math.max(...totals,1);
  const normalized=totals.map(v=>v/maxVal);
  const angle=i=>(Math.PI*2*(i/n))-Math.PI/2;
  const point=(r,i)=>({x:CX+r*Math.cos(angle(i)),y:CY+r*Math.sin(angle(i))});
  const rings=[0.25,0.5,0.75,1.0];
  const ringPath=frac=>{const pts=pillars.map((_,i)=>point(R*frac,i));return pts.map((p,i)=>`${i===0?"M":"L"}${p.x},${p.y}`).join(" ")+"Z";};
  const dataPts=normalized.map((v,i)=>point(R*v,i));
  const dataPath=dataPts.map((p,i)=>`${i===0?"M":"L"}${p.x},${p.y}`).join(" ")+"Z";
  if(!weeklyPoints.length) return <div style={{textAlign:"center",padding:"24px",color:"var(--dim)"}}><div className="mono tiny">Import points data to see pillar balance</div></div>;
  return(<svg viewBox="0 0 280 260" style={{width:"100%",maxWidth:280}}>{rings.map((f,i)=><path key={i} d={ringPath(f)} fill="none" stroke="#1A1F2E" strokeWidth={1}/>)}{pillars.map((_,i)=>{const p=point(R,i);return <line key={i} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="#1A1F2E" strokeWidth={1}/>;})}<path d={dataPath} fill="rgba(232,160,32,.12)" stroke="var(--gold)" strokeWidth={2} strokeLinejoin="round"/>{dataPts.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={4} fill={pillars[i].color} stroke="var(--bg)" strokeWidth={1.5}/>)}{pillars.map((pl,i)=>{const lp={x:point(R+22,i).x,y:point(R+22,i).y};const anchor=lp.x<CX-5?"end":lp.x>CX+5?"start":"middle";return <text key={i} x={lp.x} y={lp.y+4} fill={pl.color} fontSize={9} textAnchor={anchor} fontFamily="JetBrains Mono" letterSpacing="1">{pl.label.toUpperCase()}</text>;})}<circle cx={CX} cy={CY} r={3} fill="var(--gold)"/></svg>);
}

function PERMSChart({history}){
  if(history.length<2) return <div style={{textAlign:"center",padding:"24px",color:"var(--dim)"}}><div className="mono tiny">Add at least 2 assessments to see trend</div></div>;
  const W=620,H=160,PAD={t:16,r:20,b:36,l:32},iW=W-PAD.l-PAD.r,iH=H-PAD.t-PAD.b,n=history.length;
  const xPos=i=>PAD.l+(n>1?i*iW/(n-1):iW/2);
  const yPos=v=>PAD.t+iH-((v/5)*iH);
  return(<svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",overflow:"visible"}}>{[1,2,3,4,5].map(v=>(<g key={v}><line x1={PAD.l} y1={yPos(v)} x2={W-PAD.r} y2={yPos(v)} stroke="#1A1F2E" strokeWidth={1}/><text x={PAD.l-5} y={yPos(v)+4} fill="#5A6070" fontSize={8} textAnchor="end" fontFamily="JetBrains Mono">{v}</text></g>))}{PERMS_KEYS.map(pk=>{const pts=history.map((h,i)=>({x:xPos(i),y:yPos(h.scores[pk.key]||0)}));const path=pts.map((p,i)=>`${i===0?"M":"L"}${p.x},${p.y}`).join(" ");return(<g key={pk.key}><path d={path} fill="none" stroke={pk.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"/>{pts.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={3.5} fill={pk.color} stroke="var(--bg)" strokeWidth={1.5}/>)}</g>);})}{history.map((h,i)=><text key={i} x={xPos(i)} y={H-2} fill="#5A6070" fontSize={8} textAnchor="middle" fontFamily="JetBrains Mono">{h.quarter}</text>)}</svg>);
}

function PointsChart({data}){
  if(!data.length) return null;
  const W=620,H=180,PAD={t:16,r:20,b:44,l:40},iW=W-PAD.l-PAD.r,iH=H-PAD.t-PAD.b;
  const pillars=["move","recover","fuel","connect","breathe","misc"];
  const maxVal=Math.max(...data.flatMap(d=>pillars.map(k=>d[k]||0)),1),n=data.length;
  const xPos=i=>PAD.l+(n>1?i*iW/(n-1):iW/2);
  const yPos=v=>PAD.t+iH-(v/maxVal)*iH;
  const yTicks=[0,Math.round(maxVal/4),Math.round(maxVal/2),Math.round(maxVal*3/4),maxVal];
  return(<svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",overflow:"visible"}}>{yTicks.map(v=>(<g key={v}><line x1={PAD.l} y1={yPos(v)} x2={W-PAD.r} y2={yPos(v)} stroke="#1A1F2E" strokeWidth={1}/><text x={PAD.l-6} y={yPos(v)+4} fill="#5A6070" fontSize={8} textAnchor="end" fontFamily="JetBrains Mono">{v}</text></g>))}{pillars.map(k=>{const p=getPillar(k);const pts=data.map((d,i)=>({x:xPos(i),y:yPos(d[k]||0)}));const path=pts.map((pt,i)=>`${i===0?"M":"L"}${pt.x},${pt.y}`).join(" ");return(<g key={k}><path d={path} fill="none" stroke={p.color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.8}/>{pts.map((pt,i)=><circle key={i} cx={pt.x} cy={pt.y} r={2.5} fill={p.color} stroke="var(--bg)" strokeWidth={1.5}/>)}</g>);})}{data.map((d,i)=><text key={i} x={xPos(i)} y={H-2} fill="#5A6070" fontSize={7} textAnchor="middle" fontFamily="JetBrains Mono">{(d.label||d.week||"").split("–")[0].trim().slice(0,7)}</text>)}</svg>);
}

function ComplianceChart({weeklyRates}){
  if(!weeklyRates||weeklyRates.length<2) return null;
  const W=620,H=100,PAD={t:10,r:20,b:30,l:36},iW=W-PAD.l-PAD.r,iH=H-PAD.t-PAD.b,n=weeklyRates.length;
  const xPos=i=>PAD.l+(n>1?i*iW/(n-1):iW/2);
  const yPos=v=>PAD.t+iH-((v/100)*iH);
  const pts=weeklyRates.map((r,i)=>({x:xPos(i),y:yPos(r.rate)}));
  const path=pts.map((p,i)=>`${i===0?"M":"L"}${p.x},${p.y}`).join(" ");
  const areaPath=path+` L${pts[pts.length-1].x},${PAD.t+iH} L${pts[0].x},${PAD.t+iH} Z`;
  return(<svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",overflow:"visible"}}>{[25,50,75,100].map(v=>(<g key={v}><line x1={PAD.l} y1={yPos(v)} x2={W-PAD.r} y2={yPos(v)} stroke="#1A1F2E" strokeWidth={1}/><text x={PAD.l-5} y={yPos(v)+4} fill="#5A6070" fontSize={7} textAnchor="end" fontFamily="JetBrains Mono">{v}%</text></g>))}<path d={areaPath} fill="rgba(78,205,196,.08)"/><path d={path} fill="none" stroke="var(--teal)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"/>{pts.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={3} fill={weeklyRates[i].rate>=75?"var(--teal)":weeklyRates[i].rate>=50?"var(--gold)":"var(--red)"} stroke="var(--bg)" strokeWidth={1.5}/>)}{weeklyRates.map((r,i)=><text key={i} x={xPos(i)} y={H-2} fill="#5A6070" fontSize={7} textAnchor="middle" fontFamily="JetBrains Mono">{r.week}</text>)}</svg>);
}

function ComplianceSection({compliance,compliancePage,setCompliancePage}){
  const WIN=6,total=compliance.weeklyRates.length;
  const maxStart=Math.max(0,total-WIN);
  const startIdx=compliancePage===null?maxStart:Math.max(0,Math.min(compliancePage,maxStart));
  const pageRates=compliance.weeklyRates.slice(startIdx,startIdx+WIN);
  const atStart=startIdx===0,atEnd=startIdx>=maxStart;
  return(<div className="card mb24"><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><div style={{display:"flex",alignItems:"center",gap:12}}><div className="mono tiny" style={{color:"var(--dim)"}}>Task Compliance Trend</div><div className="mono tiny" style={{color:"var(--dim)"}}>{pageRates[0]?.week} — {pageRates[pageRates.length-1]?.week}</div></div><div style={{display:"flex",alignItems:"center",gap:10}}><div style={{display:"flex",gap:12}}>{[["≥75%","var(--teal)"],["≥50%","var(--gold)"],["<50%","var(--red)"]].map(([l,c])=>(<div key={l} style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:8,height:8,borderRadius:"50%",background:c}}/><div className="mono tiny" style={{color:"var(--dim)"}}>{l}</div></div>))}</div><div style={{display:"flex",alignItems:"center",gap:6,marginLeft:8}}><button className="btn btn-ghost btn-sm" style={{padding:"4px 10px"}} disabled={atStart} onClick={()=>setCompliancePage(startIdx-1)}>‹</button><div className="mono tiny" style={{color:"var(--dim)",minWidth:60,textAlign:"center"}}>{startIdx+1}–{Math.min(startIdx+WIN,total)} / {total}</div><button className="btn btn-ghost btn-sm" style={{padding:"4px 10px"}} disabled={atEnd} onClick={()=>setCompliancePage(startIdx+1)}>›</button>{!atEnd&&<button className="btn btn-ghost btn-sm" style={{padding:"4px 8px",fontSize:"8px"}} onClick={()=>setCompliancePage(null)}>Latest</button>}</div></div></div><ComplianceChart weeklyRates={pageRates}/><div style={{height:4,background:"var(--border)",borderRadius:2,marginTop:10,overflow:"hidden"}}><div style={{height:"100%",background:"var(--teal)",borderRadius:2,transition:"all .3s",width:`${(WIN/total)*100}%`,marginLeft:`${(startIdx/total)*100}%`}}/></div></div>);
}

function LoginScreen({onLogin}){
  const [email,setEmail]=useState(""),[pass,setPass]=useState(""),[ err,setErr]=useState(""),[ load,setLoad]=useState(false);
  const handle=async()=>{setLoad(true);setErr("");try{await signIn(email,pass);onLogin();}catch(e){setErr(e.message);}finally{setLoad(false);}};
  return(<div style={{minHeight:"100vh",background:"#080A0E",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:360,background:"#0D1017",border:"1px solid #1A1F2E",borderRadius:6,padding:36}}><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,color:"#E8A020",letterSpacing:3,marginBottom:4}}>APEX</div><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,letterSpacing:3,color:"#5A6070",textTransform:"uppercase",marginBottom:28}}>XPT · Coach Dashboard</div><label className="label">Email</label><input type="email" className="input" value={email} onChange={e=>setEmail(e.target.value)} style={{marginBottom:14}}/><label className="label">Password</label><input type="password" className="input" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handle()} style={{marginBottom:20}}/>{err&&<div style={{color:"#E84040",fontFamily:"'JetBrains Mono',monospace",fontSize:10,marginBottom:14}}>{err}</div>}<button className="btn btn-gold" style={{width:"100%",justifyContent:"center"}} onClick={handle} disabled={load}>{load?"Signing in…":"Sign In"}</button></div></div>);
}

function TaskEditor({task,onSave,onCancel}){
  const [form,setForm]=useState({pillar:task?.pillar||"move",category:task?.category||"",task:task?.task||"",points:task?.points??1,notes:task?.notes||""});
  const s=k=>e=>setForm(f=>({...f,[k]:k==="points"?parseInt(e.target.value)||0:e.target.value}));
  const cats=PILLAR_CATEGORIES[form.pillar]||[];
  return(<div className="assignment-form"><div className="input-row" style={{gridTemplateColumns:"1fr 1fr",gap:10}}><div><label className="label">Pillar</label><select className="input input-sm" value={form.pillar} onChange={e=>setForm(f=>({...f,pillar:e.target.value,category:""}))}>{ PILLARS.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></div><div><label className="label">Category</label><select className="input input-sm" value={form.category} onChange={s("category")}><option value="">— select —</option>{cats.map(c=><option key={c} value={c}>{c}</option>)}</select></div></div><div className="field"><label className="label">Task</label><input className="input input-sm" value={form.task} onChange={s("task")} placeholder="e.g. Upper Body Power Block"/></div><div className="input-row" style={{gridTemplateColumns:"60px 1fr",gap:10,marginBottom:10}}><div><label className="label">Points</label><input className="input input-sm" type="number" min={1} max={30} value={form.points} onChange={s("points")}/></div><div><label className="label">Coach Notes</label><input className="input input-sm" value={form.notes} onChange={s("notes")} placeholder="Cues, targets…"/></div></div><div style={{display:"flex",gap:8}}><button className="btn btn-gold btn-sm" onClick={()=>onSave(form)} disabled={!form.task.trim()}>{task?"Save":"Add Task"}</button><button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button></div></div>);
}

function EventEditor({event,onSave,onCancel}){
  const [form,setForm]=useState({title:event?.title||"",event_type:event?.event_type||"event",notes:event?.notes||""});
  const s=k=>e=>setForm(f=>({...f,[k]:e.target.value}));
  const et=getEventType(form.event_type);
  return(<div className="assignment-form" style={{borderColor:`${et.color}33`}}><div className="input-row" style={{gridTemplateColumns:"1fr 1fr",gap:10}}><div><label className="label">Title</label><input className="input input-sm" value={form.title} onChange={s("title")} placeholder="e.g. Sprint Triathlon"/></div><div><label className="label">Type</label><select className="input input-sm" value={form.event_type} onChange={s("event_type")}>{EVENT_TYPES.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></div></div><div className="field"><label className="label">Notes</label><input className="input input-sm" value={form.notes} onChange={s("notes")} placeholder="Details, location…"/></div><div style={{display:"flex",gap:8}}><button className="btn btn-gold btn-sm" onClick={()=>onSave(form)} disabled={!form.title.trim()}>{event?"Save":"Add Event"}</button><button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button></div></div>);
}

function DayPanel({dateKey,tasks,events,isClientView,onAddTask,onUpdateTask,onDeleteTask,onCopyWeek,onAddEvent,onDeleteEvent}){
  const [mode,setMode]=useState(null),[editTaskObj,setEditTaskObj]=useState(null),[confirmDelete,setConfirmDelete]=useState(null);
  const [selected,setSelected]=useState(new Set()),[moveTarget,setMoveTarget]=useState(""),[selectMode,setSelectMode]=useState(false);
  const toggleSelect=id=>setSelected(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});
  const selectAll=()=>setSelected(new Set(tasks.map(t=>t.id)));
  const clearSelect=()=>{setSelected(new Set());setSelectMode(false);setMoveTarget("");};
  const totalPts=tasks.reduce((a,t)=>a+t.points,0),donePts=tasks.filter(t=>t.done).reduce((a,t)=>a+t.points,0),pct=totalPts?Math.round(donePts/totalPts*100):0;
  const d=new Date(dateKey+"T00:00:00"),isToday=dateKey===todayKey();
  const grouped=PILLARS.reduce((acc,p)=>{const t=tasks.filter(x=>x.pillar===p.id);if(t.length)acc.push({pillar:p,tasks:t});return acc;},[]);
  return(<div className="day-panel"><div className="day-panel-hdr"><div><div style={{display:"flex",alignItems:"center",gap:10}}>{isToday&&<div style={{width:7,height:7,borderRadius:"50%",background:"var(--teal)"}} className="pulse"/>}<div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:"2px"}}>{d.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}</div></div><div style={{display:"flex",gap:16,marginTop:6,alignItems:"center"}}><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:"var(--gold)",letterSpacing:"1px"}}>{donePts}/{totalPts} pts</div><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"var(--dim)",letterSpacing:"1.5px"}}>{pct}% complete</div><div style={{width:80,height:3,background:"var(--border)",borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,background:"var(--teal)",borderRadius:2}}/></div></div></div><div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>{!selectMode?(<>{!isClientView&&<button className="btn btn-ghost btn-sm" onClick={onCopyWeek}>Copy → Next Week</button>}<button className="btn btn-ghost btn-sm" onClick={()=>{setSelectMode(true);setMode(null);}}>☑ Select</button>{!isClientView&&<button className="btn btn-ghost btn-sm" style={{borderColor:"rgba(232,160,32,.4)",color:"var(--gold)"}} onClick={()=>setMode(mode==="event"?null:"event")}>+ Event</button>}<button className="btn btn-gold btn-sm" onClick={()=>setMode(mode==="task"?null:"task")}>+ Task</button></>):(<><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"var(--dim)",alignSelf:"center"}}>{selected.size} selected</div><button className="btn btn-ghost btn-sm" onClick={selectAll}>All</button><button className="btn btn-ghost btn-sm" onClick={clearSelect}>Cancel</button>{selected.size>0&&(<div style={{display:"flex",gap:6,alignItems:"center"}}><input type="date" className="input input-sm" style={{width:130,padding:"5px 8px"}} value={moveTarget} onChange={e=>setMoveTarget(e.target.value)}/><button className="btn btn-teal btn-sm" disabled={!moveTarget} onClick={async()=>{for(const id of selected)await onUpdateTask(id,{date:moveTarget});clearSelect();}}>Move</button></div>)}{selected.size>0&&!isClientView&&<button className="btn btn-red btn-sm" onClick={async()=>{if(!window.confirm(`Delete ${selected.size} task${selected.size!==1?"s":""}?`))return;for(const id of selected)await onDeleteTask(id);clearSelect();}}>Delete {selected.size}</button>}</>)}</div></div><div style={{padding:"16px 20px"}}>{events.length>0&&events.map(ev=>{const et=getEventType(ev.event_type);return(<div key={ev.id} className="event-banner" style={{background:`${et.color}12`,borderColor:`${et.color}44`,color:et.color}}><div style={{fontSize:14}}>📍</div><div style={{flex:1}}><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,letterSpacing:"1.5px",textTransform:"uppercase",opacity:.7}}>{et.label}</div><div style={{fontSize:14,fontWeight:600}}>{ev.title}</div>{ev.notes&&<div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,opacity:.7,marginTop:2}}>{ev.notes}</div>}</div>{!isClientView&&<button className="btn btn-ghost btn-sm" style={{padding:"3px 7px"}} onClick={()=>onDeleteEvent(ev.id)}>✕</button>}</div>);})}{mode==="event"&&!isClientView&&<div style={{marginBottom:14}}><EventEditor onSave={form=>{onAddEvent(form);setMode(null);}} onCancel={()=>setMode(null)}/></div>}{mode==="task"&&<div style={{marginBottom:16}}><TaskEditor onSave={form=>{onAddTask(form);setMode(null);}} onCancel={()=>setMode(null)}/></div>}{tasks.length===0&&!mode?(<div style={{textAlign:"center",padding:"28px 0",color:"var(--dim)"}}><div style={{fontSize:26,marginBottom:8}}>📅</div><div className="mono tiny">No assignments for this day</div><div className="mono tiny" style={{marginTop:6}}>Use the buttons above to add tasks</div></div>):(grouped.map(({pillar:p,tasks:pts_})=>(<div key={p.id} style={{marginBottom:16}}><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}><div style={{width:7,height:7,borderRadius:"50%",background:p.color}}/><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,letterSpacing:"2px",color:p.color,textTransform:"uppercase"}}>{p.label}</div></div>{pts_.map(task=>(<div key={task.id}><div className="day-task-row" style={{opacity:task.done?.7:1,background:selected.has(task.id)?"rgba(139,124,246,.08)":"transparent",borderRadius:3,transition:"background .15s"}}>{selectMode?(<div className={`action-check${selected.has(task.id)?" done":""}`} style={{cursor:"pointer",borderColor:selected.has(task.id)?"var(--purple)":"#2A3040",background:selected.has(task.id)?"rgba(139,124,246,.2)":"transparent"}} onClick={()=>toggleSelect(task.id)}>{selected.has(task.id)?"✓":""}</div>):(<div className={`task-check${task.done?" done":""}`} onClick={()=>onUpdateTask(task.id,{done:!task.done})}>{task.done?"✓":""}</div>)}<div style={{flex:1,minWidth:0}}><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,letterSpacing:"1.5px",textTransform:"uppercase",color:p.color,marginBottom:2}}>{task.category}</div><div style={{fontSize:14,fontWeight:500,color:task.done?"#3A4050":"var(--muted)",textDecoration:task.done?"line-through":"none",lineHeight:1.3}}>{task.task}</div>{task.notes&&<div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"var(--dim)",marginTop:3}}>{task.notes}</div>}{editTaskObj?.id===task.id&&<TaskEditor task={editTaskObj} onSave={form=>{onUpdateTask(task.id,form);setEditTaskObj(null);}} onCancel={()=>setEditTaskObj(null)}/>}</div><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:task.done?"var(--gold)":"#3A4050",letterSpacing:"1px",flexShrink:0}}>{task.points}</div>{editTaskObj?.id!==task.id&&!selectMode&&(<div style={{display:"flex",gap:5,flexShrink:0}}><button className="btn btn-ghost btn-sm" style={{padding:"4px 8px"}} onClick={()=>setEditTaskObj(task)}>✎</button>{!isClientView&&<button className="btn btn-red btn-sm" style={{padding:"4px 8px"}} onClick={()=>setConfirmDelete(task.id)}>✕</button>}</div>)}</div>{confirmDelete===task.id&&(<div style={{display:"flex",gap:8,padding:"8px 0 4px 36px",alignItems:"center"}}><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"var(--red)"}}>Remove this task?</div><button className="btn btn-red btn-sm" onClick={()=>{onDeleteTask(task.id);setConfirmDelete(null);}}>Yes</button><button className="btn btn-ghost btn-sm" onClick={()=>setConfirmDelete(null)}>Cancel</button></div>)}</div>))}</div>)))}</div></div>);
}

function CalendarView({clientId,isClientView,onAssignmentsUpdate}){
  const today=new Date(),todayStr=toKey(today);
  const [calMode,setCalMode]=useState("day"),[viewDate,setViewDate]=useState(new Date(today));
  const [selectedDate,setSelectedDate]=useState(todayStr),[assignments,setAssignments]=useState({}),[events,setEvents]=useState({});
  const loadRange=useCallback(async()=>{try{const from=new Date(viewDate.getFullYear(),viewDate.getMonth()-1,1),to=new Date(viewDate.getFullYear(),viewDate.getMonth()+2,0);const [rows,evRows]=await Promise.all([fetchAssignments(clientId,toKey(from),toKey(to)),fetchEvents(clientId,toKey(from),toKey(to))]);const ga={},ge={};rows.forEach(r=>{if(!ga[r.date])ga[r.date]=[];ga[r.date].push(r);});evRows.forEach(r=>{if(!ge[r.date])ge[r.date]=[];ge[r.date].push(r);});setAssignments(ga);setEvents(ge);if(onAssignmentsUpdate)onAssignmentsUpdate(ga);}catch(e){console.error(e);}},[clientId,viewDate]);
  useEffect(()=>{loadRange();},[loadRange]);
  const getTasks=k=>assignments[k]||[],getEvts=k=>events[k]||[];
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
  return(<div className="fade-in"><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}><div style={{display:"flex",alignItems:"center",gap:16}}><div className="tabs" style={{marginBottom:0}}>{["day","week","month"].map(mode=><button key={mode} className={`tab${calMode===mode?" on":""}`} onClick={()=>setCalMode(mode)} style={{padding:"7px 16px"}}>{mode}</button>)}</div>{calMode==="month"&&(<div style={{display:"flex",alignItems:"center",gap:12}}><button className="btn btn-ghost btn-sm" onClick={()=>setViewDate(d=>{const n=new Date(d);n.setMonth(n.getMonth()-1);return n;})}>‹</button><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,letterSpacing:"2px"}}>{MONTHS_LONG[m]} {y}</div><button className="btn btn-ghost btn-sm" onClick={()=>setViewDate(d=>{const n=new Date(d);n.setMonth(n.getMonth()+1);return n;})}>›</button></div>)}</div><button className="btn btn-ghost btn-sm" onClick={()=>{setSelectedDate(todayStr);setViewDate(new Date());}}>Today</button></div>{calMode==="day"&&(<><div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}><button className="btn btn-ghost btn-sm" onClick={()=>{const d=new Date(selectedDate+"T00:00:00");d.setDate(d.getDate()-1);setSelectedDate(toKey(d));}}>‹</button><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:"2px"}}>{new Date(selectedDate+"T00:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</div><button className="btn btn-ghost btn-sm" onClick={()=>{const d=new Date(selectedDate+"T00:00:00");d.setDate(d.getDate()+1);setSelectedDate(toKey(d));}}>›</button></div><Panel/></>)}{calMode==="week"&&(<><div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}><button className="btn btn-ghost btn-sm" onClick={()=>{const d=new Date(selectedDate+"T00:00:00");d.setDate(d.getDate()-7);setSelectedDate(toKey(d));}}>‹ Prev</button><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"var(--muted)"}}>{fmtDate(weekDates[0])} – {fmtDate(weekDates[6])}</div><button className="btn btn-ghost btn-sm" onClick={()=>{const d=new Date(selectedDate+"T00:00:00");d.setDate(d.getDate()+7);setSelectedDate(toKey(d));}}>Next ›</button></div><div className="week-strip">{weekDates.map(dk=>{const tasks=getTasks(dk),evts=getEvts(dk),isToday=dk===todayStr,isSel=dk===selectedDate,d=new Date(dk+"T00:00:00");return(<div key={dk} className={`week-strip-day${isSel?" wsd-active":""}${isToday?" wsd-today":""}`} onClick={()=>setSelectedDate(dk)}><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,letterSpacing:"2px",color:isToday?"var(--teal)":isSel?"var(--gold)":"var(--dim)",textTransform:"uppercase"}}>{DAYS_SHORT[d.getDay()]}</div><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:isSel?"var(--gold)":"var(--muted)",marginTop:3}}>{d.getDate()}</div>{evts.length>0&&<div style={{width:6,height:6,borderRadius:"50%",background:"var(--gold)",margin:"3px auto 0"}}/>}<div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:"var(--gold)",letterSpacing:"1px",marginTop:2}}>{tasks.length>0?totalPts(dk)+"pts":""}</div><div style={{display:"flex",gap:2,justifyContent:"center",marginTop:3}}>{[...new Set(tasks.map(t=>t.pillar))].slice(0,4).map(pid=><div key={pid} style={{width:5,height:5,borderRadius:"50%",background:getPillar(pid).color}}/>)}</div></div>);})} </div><Panel/></>)}{calMode==="month"&&(<><div className="cal-grid mb20" style={{borderRadius:4,overflow:"hidden"}}>{DAYS_SHORT.map(d=><div key={d} className="cal-dow">{d}</div>)}{cells.map((cell,i)=>{const key=toKey(cell.date),tasks=getTasks(key),evts=getEvts(key),pct=completePct(key),pts=totalPts(key),isToday=key===todayStr,isSel=key===selectedDate;const pillars=[...new Set(tasks.map(t=>t.pillar))];return(<div key={i} className={`cal-cell${!cell.cur?" other-month":""}${isToday?" today-cell":""}${isSel?" selected-cell":""}`} onClick={()=>setSelectedDate(key)}><div className="cal-day-num" style={{color:isSel?"var(--purple)":undefined}}>{cell.date.getDate()}</div>{evts.map(ev=>{const et=getEventType(ev.event_type);return(<div key={ev.id} className="cal-event-chip" style={{background:`${et.color}18`,color:et.color,border:`1px solid ${et.color}44`}}>📍 {ev.title}</div>);})}{tasks.length>0&&<><div className="cal-dot-row">{pillars.map(pid=><div key={pid} className="cal-dot" style={{background:getPillar(pid).color}}/>)}</div><div className="cal-pts-badge">{pts}pts</div></>}<div className="cal-complete-bar"><div className="cal-complete-fill" style={{width:`${pct}%`}}/></div></div>);})} </div>{selectedDate&&<Panel/>}</>)}</div>);
}

function AddClientModal({onSave,onClose}){
  const [form,setForm]=useState({name:"",title:"",startDate:"",phase:"1",coachNote:""}),[loading,setLoading]=useState(false);
  const s=k=>e=>setForm(f=>({...f,[k]:e.target.value}));
  const save=async()=>{if(!form.name.trim())return;setLoading(true);try{const token="apex-"+form.name.toLowerCase().replace(/\s+/g,"-").slice(0,8)+"-"+uid();await onSave({name:form.name.trim(),title:form.title.trim(),phase:parseInt(form.phase)||1,program_day:1,start_date:form.startDate||new Date().toISOString().split("T")[0],share_token:token,coach_note:form.coachNote});}finally{setLoading(false);}};
  return(<ModalWrap onClose={onClose}><div className="h2" style={{color:"var(--gold)",marginBottom:22}}>New Client</div><div className="input-row"><div><label className="label">Full Name *</label><input className="input" value={form.name} onChange={s("name")}/></div><div><label className="label">Title / Company</label><input className="input" value={form.title} onChange={s("title")}/></div></div><div className="input-row"><div><label className="label">Start Date</label><input className="input" type="date" value={form.startDate} onChange={s("startDate")}/></div><div><label className="label">Phase</label><select className="input" value={form.phase} onChange={s("phase")}>{[1,2,3,4].map(p=><option key={p} value={p}>Phase {p} — {MACRO_PHASES[p-1].label}</option>)}</select></div></div><div className="field"><label className="label">Coach Note</label><textarea className="input" rows={3} value={form.coachNote} onChange={s("coachNote")}/></div><div style={{display:"flex",gap:10,marginTop:6}}><button className="btn btn-gold" onClick={save} disabled={loading||!form.name.trim()}>{loading?"Creating…":"Create Client"}</button><button className="btn btn-ghost" onClick={onClose}>Cancel</button></div></ModalWrap>);
}

function EditClientModal({client,onSave,onClose}){
  const [form,setForm]=useState({name:client.name,title:client.title||"",phase:client.phase,start_date:client.start_date,coach_note:client.coach_note||""});
  const s=k=>e=>setForm(f=>({...f,[k]:e.target.value}));
  return(<ModalWrap onClose={onClose}><div className="h2" style={{color:"var(--gold)",marginBottom:22}}>Edit Profile</div><div className="input-row"><div><label className="label">Name</label><input className="input" value={form.name} onChange={s("name")}/></div><div><label className="label">Title</label><input className="input" value={form.title} onChange={s("title")}/></div></div><div className="input-row"><div><label className="label">Start Date</label><input className="input" type="date" value={form.start_date} onChange={s("start_date")}/></div><div><label className="label">Phase</label><select className="input" value={form.phase} onChange={s("phase")}>{[1,2,3,4].map(p=><option key={p} value={p}>Phase {p} — {MACRO_PHASES[p-1].label}</option>)}</select></div></div><div className="field"><label className="label">Coach Note</label><textarea className="input" rows={3} value={form.coach_note} onChange={s("coach_note")}/></div><div style={{display:"flex",gap:10,marginTop:6}}><button className="btn btn-gold" onClick={()=>onSave({name:form.name,title:form.title,phase:parseInt(form.phase),start_date:form.start_date,coach_note:form.coach_note})}>Save</button><button className="btn btn-ghost" onClick={onClose}>Cancel</button></div></ModalWrap>);
}

function PERMSModal({client,permsHistory,onSave,onClose,editing}){
  const [scores,setScores]=useState(editing?.scores?{...editing.scores}:{P:0,E:0,R:0,M:0,S:0}),[quarter,setQuarter]=useState(editing?.quarter||""),[date,setDate]=useState(editing?.date||new Date().toISOString().split("T")[0]);
  const latest=permsHistory[permsHistory.length-1],avg=permsAvg(scores),prev=editing?null:latest;
  const StarInput=({value,onChange})=>(<div style={{display:"flex",gap:4,justifyContent:"center",marginTop:6}}>{[1,2,3,4,5].map(n=><div key={n} onClick={()=>onChange(n)} style={{width:26,height:26,borderRadius:3,border:`1.5px solid ${n<=value?permsColor(value):"#2A3040"}`,background:n<=value?`${permsColor(value)}22`:"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:n<=value?permsColor(value):"#3A4050",transition:"all .15s"}}>{n}</div>)}</div>);
  return(<ModalWrap onClose={onClose}><div className="h2" style={{color:"var(--gold)",marginBottom:4}}>{editing?"Edit":"New"} P.E.R.M.S Assessment</div><div className="mono tiny" style={{color:"var(--dim)",marginBottom:18}}>{client.name} · 1 = worst · 5 = best</div><div className="input-row" style={{marginBottom:18}}><div><label className="label">Quarter *</label><input className="input" placeholder="Q2 2026" value={quarter} onChange={e=>setQuarter(e.target.value)}/></div><div><label className="label">Date</label><input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)}/></div></div><div className="sec">Scores</div><div className="g5" style={{marginBottom:18}}>{PERMS_KEYS.map(pk=>{const v=scores[pk.key]||0,c=permsColor(v);return(<div className="perm-card" key={pk.key}><div className="perm-letter" style={{color:c}}>{pk.key}</div><div className="perm-sub">{pk.label}</div><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:c,letterSpacing:"2px",marginTop:4}}>{v||"—"}</div><StarInput value={v} onChange={n=>setScores(s=>({...s,[pk.key]:n}))}/><div style={{height:2,background:"var(--border)",borderRadius:1,marginTop:8,overflow:"hidden"}}><div style={{height:"100%",width:`${(v/5)*100}%`,background:c,borderRadius:1}}/></div></div>);})}</div><div style={{display:"flex",alignItems:"center",gap:14,padding:"11px 14px",background:"var(--deep)",borderRadius:3,border:"1px solid var(--border)",marginBottom:18}}><div className="mono tiny" style={{color:"var(--dim)"}}>Composite Avg</div><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:"var(--gold)",letterSpacing:"2px"}}>{avg} / 5</div>{prev&&avg>0&&<div className="mono tiny" style={{color:avg>=permsAvg(prev.scores)?"var(--teal)":"var(--red)"}}>{avg>=permsAvg(prev.scores)?"▲":"▼"} {Math.abs(+(avg-permsAvg(prev.scores)).toFixed(1))} vs {prev.quarter}</div>}</div><div style={{display:"flex",gap:10}}><button className="btn btn-gold" disabled={!quarter.trim()||!Object.values(scores).some(v=>v>0)} onClick={()=>onSave({quarter:quarter.trim(),date,scores:{...scores}})}>Save Assessment</button><button className="btn btn-ghost" onClick={onClose}>Cancel</button></div></ModalWrap>);
}

function CSVModal({clientName,onSave,onClose}){
  const [dragging,setDragging]=useState(false),[rows,setRows]=useState(null),[error,setError]=useState(""),[isBridge,setIsBridge]=useState(false);
  const fileRef=useRef();
  const process=text=>{try{const bridge=text.includes("Form Name")||text.includes("Form ID");setIsBridge(bridge);setRows(bridge?parseBridgeCSV(text):parsePointsCSV(text));setError("");}catch(e){setError(e.message);setRows(null);}};
  const onFile=e=>{const f=e.target.files[0];if(f){const r=new FileReader();r.onload=ev=>process(ev.target.result);r.readAsText(f);}};
  const onDrop=e=>{e.preventDefault();setDragging(false);const f=e.dataTransfer.files[0];if(f){const r=new FileReader();r.onload=ev=>process(ev.target.result);r.readAsText(f);}};
  return(<ModalWrap onClose={onClose} wide><div className="h2" style={{color:"var(--gold)",marginBottom:6}}>Import Weekly Points</div><div className="mono tiny" style={{color:"var(--dim)",marginBottom:18}}>{clientName} · Bridge Athletic CSV or APEX format</div><div className={`upload-zone${dragging?" drag":""}`} style={{marginBottom:14}} onClick={()=>fileRef.current.click()} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={onDrop}><input ref={fileRef} type="file" accept=".csv,.txt" onChange={onFile}/><div style={{fontSize:26,marginBottom:6}}>📄</div><div className="mono tiny" style={{color:"var(--muted)"}}>Drop CSV here or click to browse</div></div>{error&&<div style={{color:"var(--red)",fontFamily:"'JetBrains Mono',monospace",fontSize:11,marginTop:10,padding:"10px 14px",background:"rgba(232,64,64,.08)",borderRadius:3}}>{error}</div>}{rows&&(<div style={{marginTop:18}}>{isBridge&&<div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"var(--teal)",marginBottom:10,padding:"7px 12px",background:"rgba(78,205,196,.08)",borderRadius:3}}>✓ Bridge Athletic format — {rows.length} week{rows.length!==1?"s":""} calculated</div>}<div className="sec">{rows.length} week{rows.length!==1?"s":""}</div><table className="pts-table"><thead><tr><th>Week</th><th style={{color:"#E8A020"}}>Move</th><th style={{color:"#4ECDC4"}}>Recover</th><th style={{color:"#E84040"}}>Fuel</th><th style={{color:"#8B7CF6"}}>Connect</th><th style={{color:"#60A5FA"}}>Breathe</th><th>Misc</th><th>Total</th></tr></thead><tbody>{rows.map((r,i)=><tr key={i}><td><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10}}>{r.week}</div><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,color:"var(--dim)"}}>{r.label}</div></td><td style={{color:"#E8A020"}}>{r.move}</td><td style={{color:"#4ECDC4"}}>{r.recover}</td><td style={{color:"#E84040"}}>{r.fuel}</td><td style={{color:"#8B7CF6"}}>{r.connect}</td><td style={{color:"#60A5FA"}}>{r.breathe}</td><td>{r.misc}</td><td style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:"var(--gold)"}}>{weekTotal(r)}</td></tr>)}</tbody></table><div style={{display:"flex",gap:10,marginTop:18}}><button className="btn btn-gold" onClick={()=>onSave(rows)}>Import {rows.length} Week{rows.length!==1?"s":""}</button><button className="btn btn-ghost" onClick={onClose}>Cancel</button></div></div>)}</ModalWrap>);
}

function WorkoutModal({ client, onSave, onClose, onScheduleParsed }) {
  const [files,setFiles]=useState([]);
  const [lbl,setLbl]=useState("");
  const [wk,setWk]=useState("");
  const [loading,setLoading]=useState(false);
  const [dragging,setDragging]=useState(false);
  const [parsing,setParsing]=useState(false);
  const [preview,setPreview]=useState(null);
  const [parseError,setParseError]=useState("");
  const fileRef=useRef();
  const addFiles=fList=>setFiles(p=>[...p,...Array.from(fList).filter(f=>f.name.endsWith(".pdf"))]);
  const handleParse=async()=>{if(!files.length)return;setParsing(true);setParseError("");setPreview(null);try{const days=await parsePDFSchedule(files[0]);if(!days.length){setParseError("No schedule found. Make sure this is a Bridge Athletic PDF.");}else setPreview(days);}catch(e){setParseError(e.message);}finally{setParsing(false);}};
  const handleConfirmSchedule=async()=>{if(!preview)return;setLoading(true);try{for(const day of preview){await onScheduleParsed(day.dateKey,{pillar:day.pillar,category:day.category,task:day.task,points:day.points,notes:day.notes});}if(files[0])await onSave(files[0],lbl||files[0].name,wk);onClose();}catch(e){console.error(e);}finally{setLoading(false);}};
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
      {files.map((f,i)=>(
        <div key={i} className="workout-file">
          <span>📄</span>
          <div style={{flex:1}}><div style={{fontSize:13,color:"var(--muted)"}}>{f.name}</div><div className="mono tiny" style={{color:"var(--dim)"}}>{(f.size/1024).toFixed(1)} KB</div></div>
          <button className="btn btn-red btn-sm" onClick={()=>{setFiles(p=>p.filter((_,j)=>j!==i));setPreview(null);}}>✕</button>
        </div>
      ))}
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

// ─── TASK LIST VIEW ───────────────────────────────────────────────────────────

function TaskListView({ clientId, isClientView }) {
  const [allTasks,setAllTasks]=useState([]);
  const [loading,setLoading]=useState(true);
  const [selected,setSelected]=useState(new Set());
  const [moveTarget,setMoveTarget]=useState("");
  const [filterPillar,setFilterPillar]=useState("all");
  const [filterDone,setFilterDone]=useState("all");
  const [sortBy,setSortBy]=useState("date");
  const [sortDir,setSortDir]=useState("asc");

  const load=async()=>{setLoading(true);try{const from=new Date();from.setFullYear(from.getFullYear()-1);const to=new Date();to.setFullYear(to.getFullYear()+1);const rows=await fetchAssignments(clientId,toKey(from),toKey(to));setAllTasks(rows);}catch(e){console.error(e);}finally{setLoading(false);}};
  useEffect(()=>{load();},[clientId]);

  const toggleSelect=id=>setSelected(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});
  const clearSelect=()=>{setSelected(new Set());setMoveTarget("");};

  const filtered=allTasks
    .filter(t=>filterPillar==="all"||t.pillar===filterPillar)
    .filter(t=>filterDone==="all"?true:filterDone==="done"?t.done:!t.done)
    .sort((a,b)=>{
      let va=a[sortBy]||"",vb=b[sortBy]||"";
      if(sortBy==="points"){va=a.points||0;vb=b.points||0;}
      const cmp=typeof va==="number"?va-vb:va.localeCompare(vb);
      return sortDir==="asc"?cmp:-cmp;
    });

  const handleSort=col=>{if(sortBy===col)setSortDir(d=>d==="asc"?"desc":"asc");else{setSortBy(col);setSortDir("asc");}};
  const handleMassMove=async()=>{if(!moveTarget||!selected.size)return;for(const id of selected)await updateAssignment(id,{date:moveTarget});await load();clearSelect();};
  const handleMassDelete=async()=>{if(!selected.size)return;if(!window.confirm(`Delete ${selected.size} task${selected.size!==1?"s":""}?`))return;for(const id of selected)await deleteAssignment(id);await load();clearSelect();};
  const handleToggleDone=async(id,done)=>{await updateAssignment(id,{done:!done});setAllTasks(p=>p.map(t=>t.id===id?{...t,done:!done}:t));};

  const SortArrow=({col})=>sortBy===col?<span style={{color:"var(--gold)",marginLeft:4}}>{sortDir==="asc"?"↑":"↓"}</span>:<span style={{color:"var(--border)",marginLeft:4}}>↕</span>;
  const allSelected=filtered.length>0&&filtered.every(t=>selected.has(t.id));

  if(loading) return <div style={{textAlign:"center",padding:"48px",color:"var(--dim)"}}><div className="mono tiny">Loading tasks…</div></div>;

  return(
    <div className="fade-in">
      <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:18}}>
        <div className="tabs" style={{marginBottom:0}}>
          <button className={`tab${filterPillar==="all"?" on":""}`} onClick={()=>setFilterPillar("all")}>All</button>
          {PILLARS.map(p=>(
            <button key={p.id} className={`tab${filterPillar===p.id?" on":""}`} style={{color:filterPillar===p.id?p.color:undefined,borderBottom:filterPillar===p.id?`2px solid ${p.color}`:undefined}} onClick={()=>setFilterPillar(p.id)}>{p.label}</button>
          ))}
        </div>
        <div className="tabs" style={{marginBottom:0}}>
          {[["all","All"],["done","Done"],["pending","Pending"]].map(([v,l])=>(
            <button key={v} className={`tab${filterDone===v?" on":""}`} onClick={()=>setFilterDone(v)}>{l}</button>
          ))}
        </div>
        <div style={{marginLeft:"auto",fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"var(--dim)"}}>{filtered.length} task{filtered.length!==1?"s":""}</div>
      </div>

      {selected.size>0&&!isClientView&&(
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",padding:"12px 16px",background:"rgba(139,124,246,.08)",border:"1px solid rgba(139,124,246,.25)",borderRadius:4,marginBottom:14}}>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"var(--purple)",fontWeight:700}}>{selected.size} selected</div>
          <button className="btn btn-ghost btn-sm" onClick={clearSelect}>Clear</button>
          <div style={{display:"flex",gap:6,alignItems:"center",marginLeft:8}}>
            <input type="date" className="input input-sm" style={{width:140}} value={moveTarget} onChange={e=>setMoveTarget(e.target.value)}/>
            <button className="btn btn-teal btn-sm" disabled={!moveTarget} onClick={handleMassMove}>Move to Date</button>
          </div>
          <button className="btn btn-red btn-sm" onClick={handleMassDelete}>Delete {selected.size}</button>
        </div>
      )}

      {filtered.length===0?(
        <div className="card" style={{textAlign:"center",padding:"48px"}}>
          <div style={{fontSize:32,marginBottom:10}}>📋</div>
          <div className="mono tiny" style={{color:"var(--dim)"}}>No tasks match this filter</div>
        </div>
      ):(
        <div className="card" style={{padding:0,overflow:"hidden"}}>
          <table className="pts-table" style={{width:"100%"}}>
            <thead>
              <tr style={{background:"var(--deep)"}}>
                {!isClientView&&(
                  <th style={{padding:"10px 14px",width:36}}>
                    <div className={`action-check${allSelected?" done":""}`} style={{cursor:"pointer",margin:"0 auto"}} onClick={()=>allSelected?clearSelect():setSelected(new Set(filtered.map(t=>t.id)))}>{allSelected?"✓":""}</div>
                  </th>
                )}
                <th style={{padding:"10px 8px",cursor:"pointer"}} onClick={()=>handleSort("date")}>Date <SortArrow col="date"/></th>
                <th style={{padding:"10px 8px",cursor:"pointer"}} onClick={()=>handleSort("pillar")}>Pillar <SortArrow col="pillar"/></th>
                <th style={{padding:"10px 8px",cursor:"pointer"}} onClick={()=>handleSort("task")}>Task <SortArrow col="task"/></th>
                <th style={{padding:"10px 8px"}}>Category</th>
                <th style={{padding:"10px 8px",cursor:"pointer"}} onClick={()=>handleSort("points")}>Pts <SortArrow col="points"/></th>
                <th style={{padding:"10px 8px",cursor:"pointer"}} onClick={()=>handleSort("done")}>Status <SortArrow col="done"/></th>
                {!isClientView&&<th style={{padding:"10px 8px"}}/>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((task,i)=>{
                const p=getPillar(task.pillar);
                const isSel=selected.has(task.id);
                return(
                  <tr key={task.id} style={{background:isSel?"rgba(139,124,246,.06)":i%2===0?"transparent":"rgba(255,255,255,.01)",transition:"background .15s"}}>
                    {!isClientView&&(
                      <td style={{padding:"10px 14px"}}>
                        <div className={`action-check${isSel?" done":""}`} style={{cursor:"pointer",margin:"0 auto",borderColor:isSel?"var(--purple)":undefined,background:isSel?"rgba(139,124,246,.2)":undefined}} onClick={()=>toggleSelect(task.id)}>{isSel?"✓":""}</div>
                      </td>
                    )}
                    <td style={{padding:"10px 8px"}}>
                      <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:task.date===todayKey()?"var(--teal)":"var(--muted)"}}>{fmtDate(task.date)}</div>
                      <div className="mono tiny" style={{color:"var(--dim)",marginTop:2}}>{task.date}</div>
                    </td>
                    <td style={{padding:"10px 8px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <div style={{width:7,height:7,borderRadius:"50%",background:p.color,flexShrink:0}}/>
                        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:p.color,textTransform:"uppercase"}}>{p.label}</div>
                      </div>
                    </td>
                    <td style={{padding:"10px 8px"}}>
                      <div style={{fontSize:13,color:task.done?"#3A4050":"var(--muted)",textDecoration:task.done?"line-through":"none",fontWeight:500}}>{task.task}</div>
                      {task.notes&&<div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"var(--dim)",marginTop:2}}>{task.notes}</div>}
                    </td>
                    <td style={{padding:"10px 8px"}}><div className="mono tiny" style={{color:"var(--dim)"}}>{task.category}</div></td>
                    <td style={{padding:"10px 8px"}}><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:"var(--gold)"}}>{task.points}</div></td>
                    <td style={{padding:"10px 8px"}}>
                      <div className="pill" style={{background:task.done?"rgba(78,205,196,.1)":"rgba(90,96,112,.1)",color:task.done?"var(--teal)":"var(--dim)",border:`1px solid ${task.done?"rgba(78,205,196,.3)":"rgba(90,96,112,.2)"}`,cursor:"pointer"}} onClick={()=>handleToggleDone(task.id,task.done)}>{task.done?"Done":"Pending"}</div>
                    </td>
                    {!isClientView&&(
                      <td style={{padding:"10px 8px"}}>
                        <button className="btn btn-red btn-sm" style={{padding:"4px 8px"}} onClick={async()=>{if(!window.confirm("Delete this task?"))return;await deleteAssignment(task.id);setAllTasks(p=>p.filter(t=>t.id!==task.id));}}>✕</button>
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

// ─── CLIENT DASHBOARD ─────────────────────────────────────────────────────────

function JournalView({ clientId, isClientView }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newContent, setNewContent] = useState("");
  const [newDate, setNewDate] = useState(todayKey());
  const [replyTo, setReplyTo] = useState(null);
  const [replyContent, setReplyContent] = useState("");
  const [editId, setEditId] = useState(null);
  const [editContent, setEditContent] = useState("");
  const [filterDate, setFilterDate] = useState("");

  const load = async () => {
    setLoading(true);
    try { setEntries(await fetchJournalEntries(clientId)); }
    catch(e) { console.error(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [clientId]);

  const topLevel = entries.filter(e => !e.parent_id);
  const replies = id => entries.filter(e => e.parent_id === id);
  const filtered = filterDate
    ? topLevel.filter(e => e.date === filterDate)
    : topLevel;

  const handleAdd = async () => {
    if (!newContent.trim()) return;
    await createJournalEntry(clientId, newDate, newContent.trim(), isClientView ? "client" : "coach");
    setNewContent(""); await load();
  };
  const handleReply = async (parentId, parentDate) => {
    if (!replyContent.trim()) return;
    await createJournalEntry(clientId, parentDate, replyContent.trim(), isClientView ? "client" : "coach", parentId);
    setReplyContent(""); setReplyTo(null); await load();
  };
  const handleEdit = async (id) => {
    if (!editContent.trim()) return;
    await updateJournalEntry(id, editContent.trim());
    setEditId(null); await load();
  };
  const handleDelete = async (id) => {
    if (!window.confirm("Delete this entry?")) return;
    await deleteJournalEntry(id); await load();
  };

  const EntryCard = ({ entry, isReply }) => {
    const isCoach = entry.author === "coach";
    const entryReplies = replies(entry.id);
    return (
      <div style={{ marginBottom: isReply ? 0 : 16 }}>
        <div style={{
          background: isCoach ? "rgba(232,160,32,.06)" : "var(--deep)",
          border: `1px solid ${isCoach ? "rgba(232,160,32,.25)" : "var(--border)"}`,
          borderRadius: 4, padding: "14px 16px",
          marginLeft: isReply ? 32 : 0,
          borderLeft: isReply ? `3px solid ${isCoach ? "var(--gold)" : "var(--purple)"}` : undefined
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: isCoach ? "var(--gold)" : "var(--purple)" }} />
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: isCoach ? "var(--gold)" : "var(--purple)", textTransform: "uppercase", letterSpacing: "1.5px" }}>
                {isCoach ? "Coach" : "Client"}
              </div>
              {!isReply && <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: "var(--dim)" }}>{fmtDate(entry.date)}</div>}
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 8, color: "var(--dim)" }}>
                {new Date(entry.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-ghost btn-sm" style={{ padding: "3px 8px" }} onClick={() => { setEditId(entry.id); setEditContent(entry.content); }}>✎</button>
              <button className="btn btn-red btn-sm" style={{ padding: "3px 8px" }} onClick={() => handleDelete(entry.id)}>✕</button>
            </div>
          </div>
          {editId === entry.id ? (
            <div>
              <textarea className="input" rows={3} value={editContent} onChange={e => setEditContent(e.target.value)} style={{ marginBottom: 8 }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-gold btn-sm" onClick={() => handleEdit(entry.id)}>Save</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditId(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{entry.content}</div>
          )}
          {!isReply && editId !== entry.id && (
            <div style={{ marginTop: 10 }}>
              {replyTo === entry.id ? (
                <div style={{ marginTop: 8 }}>
                  <textarea className="input" rows={2} placeholder={isClientView ? "Add a note…" : "Add a coach comment…"} value={replyContent} onChange={e => setReplyContent(e.target.value)} style={{ marginBottom: 8 }} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-gold btn-sm" onClick={() => handleReply(entry.id, entry.date)}>Post</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setReplyTo(null); setReplyContent(""); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button className="btn btn-ghost btn-sm" style={{ fontSize: "8px" }} onClick={() => { setReplyTo(entry.id); setReplyContent(""); }}>
                  {isClientView ? "+ Add Note" : "+ Coach Comment"}
                </button>
              )}
            </div>
          )}
        </div>
        {entryReplies.length > 0 && (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
            {entryReplies.map(r => <EntryCard key={r.id} entry={r} isReply />)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="mono tiny" style={{ color: "var(--dim)", marginBottom: 4 }}>Daily Journal</div>
          <div style={{ fontSize: 13, color: "var(--dim)" }}>{isClientView ? "Log your daily notes and track your progress" : "Client journal — add comments and coaching notes"}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div className="mono tiny" style={{ color: "var(--dim)" }}>Filter by date:</div>
          <input type="date" className="input input-sm" style={{ width: 140 }} value={filterDate} onChange={e => setFilterDate(e.target.value)} />
          {filterDate && <button className="btn btn-ghost btn-sm" onClick={() => setFilterDate("")}>Clear</button>}
        </div>
      </div>

      <div className="card mb20" style={{ borderColor: "rgba(139,124,246,.25)", background: "rgba(139,124,246,.04)" }}>
        <div className="mono tiny" style={{ color: "var(--purple)", marginBottom: 12 }}>{isClientView ? "New Journal Entry" : "New Coach Entry"}</div>
        <div style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "center" }}>
          <label className="label" style={{ margin: 0, whiteSpace: "nowrap" }}>Date</label>
          <input type="date" className="input input-sm" style={{ width: 150 }} value={newDate} onChange={e => setNewDate(e.target.value)} />
        </div>
        <textarea className="input" rows={3} placeholder={isClientView ? "How are you feeling today? What did you do? Any wins or challenges?" : "Add a coaching note, observation, or program update…"} value={newContent} onChange={e => setNewContent(e.target.value)} style={{ marginBottom: 10 }} />
        <button className="btn btn-gold" disabled={!newContent.trim()} onClick={handleAdd}>Post Entry</button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "32px", color: "var(--dim)" }}><div className="mono tiny">Loading journal…</div></div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "48px" }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📓</div>
          <div className="mono tiny" style={{ color: "var(--dim)" }}>{filterDate ? "No entries for this date" : "No journal entries yet"}</div>
        </div>
      ) : (
        filtered.map(entry => <EntryCard key={entry.id} entry={entry} isReply={false} />)
      )}
    </div>
  );
}

function PointsSection({data,pointsPage,setPointsPage,period}){
  const WIN=period==="quarterly"?12:period==="monthly"?4:2;
  const total=data.length;
  if(!total) return null;
  const maxStart=Math.max(0,total-WIN);
  const startIdx=pointsPage===null?maxStart:Math.max(0,Math.min(pointsPage,maxStart));
  const pageData=data.slice(startIdx,startIdx+WIN);
  const atStart=startIdx===0,atEnd=startIdx>=maxStart;
  return(
    <div className="card mb20">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div className="mono tiny" style={{color:"var(--dim)"}}>Points Trend</div>
          {total>WIN&&<div className="mono tiny" style={{color:"var(--dim)"}}>{pageData[0]?.label||pageData[0]?.week} — {pageData[pageData.length-1]?.label||pageData[pageData.length-1]?.week}</div>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
            {PILLARS.map(p=><div key={p.id} style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:8,height:8,borderRadius:"50%",background:p.color}}/><div className="mono tiny" style={{color:"var(--dim)"}}>{p.label}</div></div>)}
          </div>
          {total>WIN&&(
            <div style={{display:"flex",alignItems:"center",gap:6,marginLeft:8}}>
              <button className="btn btn-ghost btn-sm" style={{padding:"4px 10px"}} disabled={atStart} onClick={()=>setPointsPage(startIdx-1)}>‹</button>
              <div className="mono tiny" style={{color:"var(--dim)",minWidth:60,textAlign:"center"}}>{startIdx+1}–{Math.min(startIdx+WIN,total)} / {total}</div>
              <button className="btn btn-ghost btn-sm" style={{padding:"4px 10px"}} disabled={atEnd} onClick={()=>setPointsPage(startIdx+1)}>›</button>
              {!atEnd&&<button className="btn btn-ghost btn-sm" style={{padding:"4px 8px",fontSize:"8px"}} onClick={()=>setPointsPage(null)}>Latest</button>}
            </div>
          )}
        </div>
      </div>
      <PointsChart data={pageData}/>
      {total>WIN&&(
        <div style={{height:4,background:"var(--border)",borderRadius:2,marginTop:10,overflow:"hidden"}}>
          <div style={{height:"100%",background:"var(--gold)",borderRadius:2,transition:"all .3s",width:`${(WIN/total)*100}%`,marginLeft:`${(startIdx/total)*100}%`}}/>
        </div>
      )}
    </div>
  );
}

function ClientDashboard({ client, onBack, onRefresh, isClientView }) {
  const [tab,setTab]=useState("overview");
  const [modal,setModal]=useState(null);
  const [editingPerms,setEditingPerms]=useState(null);
  const [goals,setGoals]=useState([]);
  const [permsHistory,setPermsHistory]=useState([]);
  const [weeklyPoints,setWeeklyPoints]=useState([]);
  const [workouts,setWorkouts]=useState([]);
  const [coachNotes,setCoachNotes]=useState([]);
  const [toast,setToast]=useState(null);
  const [ptsPeriod,setPtsPeriod]=useState("weekly");
  const [calAssignments,setCalAssignments]=useState({});
  const [allAssignments,setAllAssignments]=useState({});
  const [addingNote,setAddingNote]=useState(false);
  const [calExport,setCalExport]=useState(false);
  const [compliancePage,setCompliancePage]=useState(null);
  const [pointsPage,setPointsPage]=useState(null);
  const [noteForm,setNoteForm]=useState({week_iso:"",week_label:"",note:""});
  const show=msg=>setToast(msg);

  useEffect(()=>{
    const loadAll=async()=>{
      try{
        const[g,p,w,wo,cn]=await Promise.all([fetchGoals(client.id),fetchPERMS(client.id),fetchWeeklyPoints(client.id),fetchWorkouts(client.id),fetchCoachNotes(client.id)]);
        setGoals(g);setPermsHistory(p);setWeeklyPoints(w);setWorkouts(wo);setCoachNotes(cn);
        const from=new Date();from.setFullYear(from.getFullYear()-1);
        const to=new Date();to.setFullYear(to.getFullYear()+1);
        const rows=await fetchAssignments(client.id,toKey(from),toKey(to));
        const ga={};rows.forEach(r=>{if(!ga[r.date])ga[r.date]=[];ga[r.date].push(r);});
        setAllAssignments(ga);
      }catch(e){console.error(e);}
    };loadAll();
  },[client.id]);

  const compliance=calcCompliance(allAssignments,client.start_date);
  const momentum=calcMomentum(weeklyPoints);
  const aggPoints=aggregatePoints(weeklyPoints,ptsPeriod);
  const shareUrl=`${window.location.origin}${window.location.pathname}?view=${client.share_token}`;

  const latestPerms=permsHistory.length?permsHistory[permsHistory.length-1]:null;
  const latestAvg=latestPerms?permsAvg(latestPerms.scores):null;
  const prevPerms=permsHistory.length>1?permsHistory[permsHistory.length-2]:null;
  const permsDelta=latestAvg&&prevPerms?+(latestAvg-permsAvg(prevPerms.scores)).toFixed(1):null;

  const totalAllTime=weeklyPoints.reduce((a,w)=>a+weekTotal(w),0);
  const last4Pts=weeklyPoints.slice(-4).reduce((a,w)=>a+weekTotal(w),0);

  return(
    <div className="fade-in">
      {isClientView&&(
        <div className="client-banner">
          <span style={{fontSize:16}}>👤</span>
          <div>
            <div className="mono tiny" style={{color:"var(--purple)"}}>XPT · APEX — Client Portal</div>
            <div style={{fontSize:13,color:"var(--muted)",marginTop:2}}>Welcome back, {client.name}.</div>
          </div>
          <button className="btn btn-ghost btn-sm" style={{marginLeft:"auto"}} onClick={()=>setCalExport(true)}>📅 Add to Calendar</button>
        </div>
      )}

      {!isClientView&&(
        <div className="share-banner">
          <div style={{flex:1}}>
            <div className="mono tiny" style={{color:"var(--teal)",marginBottom:4}}>Client Share Link</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"var(--dim)",wordBreak:"break-all"}}>{shareUrl}</div>
          </div>
          <button className="btn btn-teal btn-sm" onClick={()=>{navigator.clipboard?.writeText(shareUrl);show("Link copied");}}>Copy Link</button>
        </div>
      )}

      <div className="page-header" style={{marginBottom:20}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:16}}>
          {!isClientView&&<button className="back-btn" onClick={onBack}>← Roster</button>}
          <div>
            <div className="h1">{client.name}</div>
            <div className="mono tiny" style={{color:"var(--dim)",marginTop:4}}>{client.title}</div>
            {client.coach_note&&<div style={{marginTop:8,fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"var(--muted)",background:"var(--deep)",padding:"6px 10px",borderRadius:3,borderLeft:"2px solid var(--gold)"}}>{client.coach_note}</div>}
          </div>
        </div>
        {!isClientView&&<button className="btn btn-ghost btn-sm" onClick={()=>setModal("editclient")}>✎ Edit Profile</button>}
      </div>

      <div className="tabs">
        {[{id:"overview",label:"Overview"},{id:"schedule",label:"Schedule"},{id:"tasklist",label:"Task List"},{id:"points",label:"Points"},{id:"journal",label:"Journal"},{id:"workouts",label:"Workouts"}].map(t=>(
          <button key={t.id} className={`tab${tab===t.id?" on":""}`} onClick={()=>setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab==="overview"&&(
        <div className="fade-in">
          <div className="g5 mb24">
            <div className="card card-gold">
              <div className="stat-lbl">PERMS Score</div>
              <div className="stat-val" style={{color:latestAvg?permsColor(latestAvg):"var(--dim)",fontSize:28}}>{latestAvg||"—"}<span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"var(--dim)"}}>{latestAvg?"/5":""}</span></div>
              <div className="stat-sub">{permsDelta!==null?`${permsDelta>=0?"▲":"▼"} ${Math.abs(permsDelta)} vs prev`:latestPerms?latestPerms.quarter:"No assessments"}</div>
            </div>
            <div className="card">
              <div className="stat-lbl">All-Time Points</div>
              <div className="stat-val" style={{color:"var(--gold)",fontSize:28}}>{totalAllTime}</div>
              <div className="stat-sub">across {weeklyPoints.length} weeks</div>
            </div>
            <div className="card">
              <div className="stat-lbl">Last 4 Weeks</div>
              <div className="stat-val" style={{color:"var(--teal)",fontSize:28}}>{last4Pts}</div>
              <div className="stat-sub">recent activity</div>
            </div>
            <div className="card">
              <div className="stat-lbl">Momentum</div>
              {momentum?(
                <>
                  <div className="stat-val" style={{color:momentum.up?"var(--teal)":"var(--red)",fontSize:28}}>{momentum.up?"▲":"▼"} {Math.abs(momentum.pct)}%</div>
                  <div className="stat-sub">4-week trend</div>
                </>
              ):(
                <><div className="stat-val" style={{color:"var(--dim)",fontSize:28}}>—</div><div className="stat-sub">need 2+ weeks</div></>
              )}
            </div>
            <div className="card">
              <div className="stat-lbl">Compliance</div>
              {compliance?(
                <>
                  <div className="stat-val" style={{color:compliance.overall>=75?"var(--teal)":compliance.overall>=50?"var(--gold)":"var(--red)",fontSize:28}}>{compliance.overall}%</div>
                  <div className="stat-sub">recent: {compliance.recentRate}%</div>
                </>
              ):(
                <><div className="stat-val" style={{color:"var(--dim)",fontSize:28}}>—</div><div className="stat-sub">no task data</div></>
              )}
            </div>
          </div>

          {compliance&&compliance.weeklyRates.length>=2&&(
            <ComplianceSection compliance={compliance} compliancePage={compliancePage} setCompliancePage={setCompliancePage}/>
          )}

          <div className="gmain">
            <div>
              {goals.length>0&&(
                <div className="mb24">
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <div className="sec" style={{marginBottom:0}}>Goals & Action Items</div>
                    {!isClientView&&<button className="btn btn-ghost btn-sm" onClick={()=>setModal("goals")}>✎ Edit Goals</button>}
                  </div>
                  {goals.map((g,gi)=>{
                    const p=getPillar(g.pillar);const done=g.action_items?.filter(a=>a.done).length||0;const total=g.action_items?.length||0;
                    return(
                      <div key={gi} className="card mb12" style={{borderColor:`${p.color}33`}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:total?10:0}}>
                          <div style={{flex:1}}>
                            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                              <div style={{width:7,height:7,borderRadius:"50%",background:p.color}}/>
                              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,letterSpacing:"2px",color:p.color,textTransform:"uppercase"}}>{p.label}</div>
                            </div>
                            <div style={{fontSize:15,fontWeight:600,color:"var(--muted)"}}>{g.goal}</div>
                            {g.target_date&&<div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"var(--dim)",marginTop:3}}>Target: {g.target_date}</div>}
                          </div>
                          {total>0&&<div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:"var(--dim)",marginLeft:12}}>{done}/{total}</div>}
                        </div>
                        {g.action_items?.map((item,ai)=>(
                          <div key={ai} className="action-item-row">
                            <div className={`action-check${item.done?" done":""}`} onClick={async()=>{const updated=goals.map((gg,ggi)=>ggi!==gi?gg:{...gg,action_items:gg.action_items.map((it,iti)=>iti!==ai?it:{...it,done:!it.done})});setGoals(updated);await upsertGoals(client.id,updated);}}>{item.done?"✓":""}</div>
                            <div style={{flex:1,fontSize:13,color:item.done?"#3A4050":"var(--muted)",textDecoration:item.done?"line-through":"none"}}>{item.text}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  {!isClientView&&<button className="btn btn-ghost btn-sm" style={{width:"100%",justifyContent:"center"}} onClick={()=>setModal("goals")}>+ Add Goal</button>}
                </div>
              )}
              {goals.length===0&&!isClientView&&(
                <div className="card mb24" style={{textAlign:"center",padding:"32px"}}>
                  <div style={{fontSize:28,marginBottom:8}}>🎯</div>
                  <div className="mono tiny" style={{color:"var(--dim)",marginBottom:12}}>No goals set</div>
                  <button className="btn btn-gold btn-sm" onClick={()=>setModal("goals")}>Set Goals</button>
                </div>
              )}

              <div className="mb24">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                  <div className="sec" style={{marginBottom:0}}>Weekly Coach Notes</div>
                  {!isClientView&&<button className="btn btn-ghost btn-sm" onClick={()=>{const now=new Date();const iso=getWeekISO(now);setNoteForm({week_iso:iso,week_label:getWeekLabel(iso),note:""});setAddingNote(true);}}>+ Add Note</button>}
                </div>
                {addingNote&&!isClientView&&(
                  <div className="card mb12" style={{borderColor:"rgba(232,160,32,.3)"}}>
                    <div className="input-row"><div><label className="label">Week ISO</label><input className="input input-sm" value={noteForm.week_iso} onChange={e=>setNoteForm(f=>({...f,week_iso:e.target.value}))}/></div><div><label className="label">Week Label</label><input className="input input-sm" value={noteForm.week_label} onChange={e=>setNoteForm(f=>({...f,week_label:e.target.value}))}/></div></div>
                    <div className="field"><label className="label">Note</label><textarea className="input" rows={3} value={noteForm.note} onChange={e=>setNoteForm(f=>({...f,note:e.target.value}))}/></div>
                    <div style={{display:"flex",gap:8}}><button className="btn btn-gold btn-sm" disabled={!noteForm.note.trim()||!noteForm.week_iso.trim()} onClick={async()=>{await upsertCoachNote(client.id,noteForm.week_iso,noteForm.week_label,noteForm.note);setCoachNotes(await fetchCoachNotes(client.id));setAddingNote(false);show("Note saved");}}>Save Note</button><button className="btn btn-ghost btn-sm" onClick={()=>setAddingNote(false)}>Cancel</button></div>
                  </div>
                )}
                {coachNotes.length===0&&!addingNote&&<div className="mono tiny" style={{color:"var(--dim)",padding:"12px 0"}}>No coach notes yet.</div>}
                {coachNotes.map(n=>(
                  <div key={n.id} className="note-card">
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                      <div><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:"var(--gold)",letterSpacing:"1px"}}>{n.week_label||n.week_iso}</div><div className="mono tiny" style={{color:"var(--dim)"}}>{n.week_iso}</div></div>
                      {!isClientView&&<button className="btn btn-red btn-sm" style={{padding:"3px 7px"}} onClick={async()=>{await deleteCoachNote(n.id);setCoachNotes(p=>p.filter(x=>x.id!==n.id));}}>✕</button>}
                    </div>
                    <div style={{fontSize:13,color:"var(--muted)",lineHeight:1.6}}>{n.note}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              {permsHistory.length>0&&(
                <div className="card mb16">
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <div className="mono tiny" style={{color:"var(--dim)"}}>P.E.R.M.S History</div>
                    {!isClientView&&<button className="btn btn-ghost btn-sm" onClick={()=>setModal("perms")}>+ Assessment</button>}
                  </div>
                  <PERMSChart history={permsHistory}/>
                  <div style={{marginTop:12,display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center"}}>
                    {PERMS_KEYS.map(pk=><div key={pk.key} style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:8,height:8,borderRadius:"50%",background:pk.color}}/><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,color:"var(--dim)"}}>{pk.key}</div></div>)}
                  </div>
                  {permsHistory.length>0&&(
                    <div style={{marginTop:14,maxHeight:180,overflowY:"auto"}}>
                      {[...permsHistory].reverse().map((h,i)=>{const avg=permsAvg(h.scores);return(
                        <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:"1px solid var(--deep)"}}>
                          <div style={{flex:1}}><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:"var(--muted)",letterSpacing:"1px"}}>{h.quarter}</div><div className="mono tiny" style={{color:"var(--dim)"}}>{h.date}</div></div>
                          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:permsColor(avg),letterSpacing:"1px"}}>{avg}</div>
                          {!isClientView&&<div style={{display:"flex",gap:5}}><button className="btn btn-ghost btn-sm" style={{padding:"3px 7px"}} onClick={()=>{setEditingPerms(h);setModal("perms");}}>✎</button><button className="btn btn-red btn-sm" style={{padding:"3px 7px"}} onClick={async()=>{await deletePERMS(h.id);setPermsHistory(await fetchPERMS(client.id));}}>✕</button></div>}
                        </div>
                      );})}
                    </div>
                  )}
                </div>
              )}
              {permsHistory.length===0&&!isClientView&&(
                <div className="card mb16" style={{textAlign:"center",padding:"28px"}}>
                  <div style={{fontSize:26,marginBottom:8}}>📊</div>
                  <div className="mono tiny" style={{color:"var(--dim)",marginBottom:10}}>No PERMS assessments</div>
                  <button className="btn btn-gold btn-sm" onClick={()=>setModal("perms")}>+ Assessment</button>
                </div>
              )}

              <div className="card mb16">
                <div className="mono tiny" style={{color:"var(--dim)",marginBottom:12}}>Pillar Balance (Last 4 Weeks)</div>
                <RadarChart weeklyPoints={weeklyPoints}/>
              </div>

              {weeklyPoints.length>0&&(
                <div className="card mb16">
                  <div className="mono tiny" style={{color:"var(--dim)",marginBottom:8}}>Phase</div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:phaseColor(client.phase),letterSpacing:"1px"}}>{MACRO_PHASES[(client.phase||1)-1]?.label}</div>
                  <div className="mono tiny" style={{color:"var(--dim)",marginTop:4}}>{MACRO_PHASES[(client.phase||1)-1]?.months}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab==="schedule"&&<CalendarView clientId={client.id} isClientView={isClientView} onAssignmentsUpdate={setCalAssignments}/>}
      {tab==="tasklist"&&<TaskListView clientId={client.id} isClientView={isClientView}/>}

      {tab==="points"&&(
        <div className="fade-in">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
            <div className="tabs" style={{marginBottom:0}}>
              {[["weekly","Weekly"],["monthly","Monthly"],["quarterly","Quarterly"],["annual","Annual"]].map(([v,l])=>(
                <button key={v} className={`tab${ptsPeriod===v?" on":""}`} onClick={()=>{setPtsPeriod(v);setPointsPage(null);}}>{l}</button>
              ))}
            </div>
            {!isClientView&&(
              <div style={{display:"flex",gap:8}}>
                <button className="btn btn-ghost btn-sm" onClick={()=>setModal("csv")}>↑ Import CSV</button>
                <button className="btn btn-gold btn-sm" onClick={()=>setModal("addpoints")}>+ Add Week</button>
              </div>
            )}
          </div>
          {aggPoints.length>0?(
            <>
              <PointsSection data={weeklyPoints} pointsPage={pointsPage} setPointsPage={setPointsPage} period={ptsPeriod}/>
              <div className="card" style={{padding:0,overflow:"hidden"}}>
                <table className="pts-table" style={{width:"100%"}}>
                  <thead><tr style={{background:"var(--deep)"}}><th style={{padding:"10px 16px"}}>Period</th>{PILLARS.map(p=><th key={p.id} style={{padding:"10px 8px",color:p.color}}>{p.label}</th>)}<th style={{padding:"10px 8px"}}>Total</th>{!isClientView&&ptsPeriod==="weekly"&&<th/>}</tr></thead>
                  <tbody>{aggPoints.map((w,i)=><tr key={i} style={{background:i%2===0?"transparent":"rgba(255,255,255,.01)"}}><td style={{padding:"10px 16px"}}><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"var(--muted)"}}>{w.week}</div><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,color:"var(--dim)",marginTop:2}}>{w.label}</div></td>{PILLARS.map(p=><td key={p.id} style={{padding:"10px 8px",color:p.color,fontFamily:"'Bebas Neue',sans-serif",fontSize:18}}>{w[p.id]||0}</td>)}<td style={{padding:"10px 8px",fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"var(--gold)"}}>{weekTotal(w)}</td>{!isClientView&&ptsPeriod==="weekly"&&<td><button className="btn btn-red btn-sm" onClick={async()=>{await deleteWeeklyPoints(client.id,w.week);setWeeklyPoints(await fetchWeeklyPoints(client.id));}}>✕</button></td>}</tr>)}</tbody>
                </table>
              </div>
            </>
          ):(
            <div className="card" style={{textAlign:"center",padding:"48px"}}>
              <div style={{fontSize:34,marginBottom:10}}>📈</div>
              <div className="mono tiny" style={{color:"var(--dim)",marginBottom:14}}>No points data yet</div>
              {!isClientView&&<button className="btn btn-gold btn-sm" onClick={()=>setModal("csv")}>Import CSV</button>}
            </div>
          )}
        </div>
      )}

      {tab==="journal"&&<JournalView clientId={client.id} isClientView={isClientView}/>}

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

      {modal==="editclient"&&<EditClientModal client={client} onSave={async c=>{await updateClient(client.id,c);await onRefresh();show("Profile updated");setModal(null);}} onClose={()=>setModal(null)}/>}
      {modal==="perms"&&<PERMSModal client={client} permsHistory={permsHistory} editing={editingPerms} onSave={async e=>{await upsertPERMS(client.id,e);setPermsHistory(await fetchPERMS(client.id));show("PERMS saved");setEditingPerms(null);setModal(null);}} onClose={()=>{setModal(null);setEditingPerms(null);}}/>}
      {modal==="goals"&&<GoalsModal client={client} goals={goals} onSave={async g=>{await upsertGoals(client.id,g);setGoals(await fetchGoals(client.id));show("Goals updated");setModal(null);}} onClose={()=>setModal(null)}/>}
      {modal==="workout"&&<WorkoutModal client={client} onSave={async(f,l,w)=>{await uploadWorkout(client.id,f,l,w);setWorkouts(await fetchWorkouts(client.id));show("Uploaded");}} onScheduleParsed={async(dateKey,task)=>{await createAssignment(client.id,dateKey,task);show("Schedule imported");}} onClose={()=>setModal(null)}/>}
      {modal==="csv"&&<CSVModal clientName={client.name} onSave={async rows=>{await upsertWeeklyPoints(client.id,rows);setWeeklyPoints(await fetchWeeklyPoints(client.id));show(`${rows.length} week(s) imported`);setModal(null);}} onClose={()=>setModal(null)}/>}
      {modal==="addpoints"&&<AddPointsModal clientName={client.name} onSave={async row=>{await upsertWeeklyPoints(client.id,[row]);setWeeklyPoints(await fetchWeeklyPoints(client.id));show("Week added");setModal(null);}} onClose={()=>setModal(null)}/>}
      {calExport&&<CalendarExportModal clientId={client.id} clientName={client.name} onClose={()=>setCalExport(false)}/>}
      {toast&&<Toast msg={toast} onDone={()=>setToast(null)}/>}
    </div>
  );
}

// ─── GOALS MODAL ──────────────────────────────────────────────────────────────

function GoalsModal({ client, goals, onSave, onClose }) {
  const [items,setItems]=useState(goals.length?goals.map(g=>({...g,action_items:g.action_items||[]})):[{pillar:"move",goal:"",target_date:"",action_items:[]}]);
  const addGoal=()=>setItems(p=>[...p,{pillar:"move",goal:"",target_date:"",action_items:[]}]);
  const removeGoal=i=>setItems(p=>p.filter((_,j)=>j!==i));
  const update=(i,k,v)=>setItems(p=>p.map((g,j)=>j!==i?g:{...g,[k]:v}));
  const addAction=i=>setItems(p=>p.map((g,j)=>j!==i?g:{...g,action_items:[...(g.action_items||[]),{text:"",done:false}]}));
  const updateAction=(gi,ai,v)=>setItems(p=>p.map((g,j)=>j!==gi?g:{...g,action_items:g.action_items.map((a,k)=>k!==ai?a:{...a,text:v})}));
  const removeAction=(gi,ai)=>setItems(p=>p.map((g,j)=>j!==gi?g:{...g,action_items:g.action_items.filter((_,k)=>k!==ai)}));
  return(
    <ModalWrap onClose={onClose} wide>
      <div className="h2" style={{color:"var(--gold)",marginBottom:4}}>Goals</div>
      <div className="mono tiny" style={{color:"var(--dim)",marginBottom:18}}>{client.name}</div>
      {items.map((g,gi)=>{const p=getPillar(g.pillar);return(
        <div key={gi} className="card mb12" style={{borderColor:`${p.color}33`}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,letterSpacing:"2px",color:p.color,textTransform:"uppercase"}}>Goal {gi+1}</div>
            <button className="btn btn-red btn-sm" style={{padding:"3px 8px"}} onClick={()=>removeGoal(gi)}>Remove</button>
          </div>
          <div className="input-row">
            <div><label className="label">Pillar</label><select className="input input-sm" value={g.pillar} onChange={e=>update(gi,"pillar",e.target.value)}>{PILLARS.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
            <div><label className="label">Target Date</label><input className="input input-sm" type="date" value={g.target_date||""} onChange={e=>update(gi,"target_date",e.target.value)}/></div>
          </div>
          <div className="field"><label className="label">Goal Statement</label><input className="input input-sm" value={g.goal} onChange={e=>update(gi,"goal",e.target.value)} placeholder="e.g. Complete first open water swim"/></div>
          <div className="sec" style={{marginBottom:8}}>Action Items <span style={{color:"var(--dim)",fontSize:8}}>({(g.action_items||[]).length}/5)</span></div>
          {(g.action_items||[]).map((a,ai)=>(
            <div key={ai} className="action-item-row">
              <input className="input input-sm" style={{flex:1}} value={a.text} onChange={e=>updateAction(gi,ai,e.target.value)} placeholder={`Action ${ai+1}`}/>
              <button className="btn btn-red btn-sm" style={{padding:"3px 7px"}} onClick={()=>removeAction(gi,ai)}>✕</button>
            </div>
          ))}
          {(g.action_items||[]).length<5&&<button className="btn btn-ghost btn-sm" style={{marginTop:8}} onClick={()=>addAction(gi)}>+ Action Item</button>}
        </div>
      );})}
      <button className="btn btn-ghost btn-sm" style={{width:"100%",justifyContent:"center",marginBottom:18}} onClick={addGoal}>+ Add Goal</button>
      <div style={{display:"flex",gap:10}}><button className="btn btn-gold" onClick={()=>onSave(items)}>Save Goals</button><button className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
    </ModalWrap>
  );
}

// ─── ADD POINTS MODAL ────────────────────────────────────────────────────────

function AddPointsModal({ clientName, onSave, onClose }) {
  const now=new Date();
  const [form,setForm]=useState({week:getWeekISO(now),label:getWeekLabel(getWeekISO(now)),move:0,recover:0,fuel:0,connect:0,breathe:0,misc:0});
  const s=k=>e=>setForm(f=>({...f,[k]:k==="week"||k==="label"?e.target.value:parseInt(e.target.value)||0}));
  return(
    <ModalWrap onClose={onClose}>
      <div className="h2" style={{color:"var(--gold)",marginBottom:4}}>Add Week</div>
      <div className="mono tiny" style={{color:"var(--dim)",marginBottom:18}}>{clientName}</div>
      <div className="input-row"><div><label className="label">Week ISO *</label><input className="input" value={form.week} onChange={s("week")}/></div><div><label className="label">Label</label><input className="input" value={form.label} onChange={s("label")}/></div></div>
      <div className="g3" style={{marginBottom:14}}>
        {PILLARS.map(p=><div key={p.id}><label className="label" style={{color:p.color}}>{p.label}</label><input className="input input-sm" type="number" min={0} value={form[p.id]} onChange={s(p.id)}/></div>)}
      </div>
      <div style={{display:"flex",gap:10}}><button className="btn btn-gold" onClick={()=>onSave(form)} disabled={!form.week.trim()}>Add</button><button className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
    </ModalWrap>
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
  return <div className="root"><style>{S}</style><div className="main" style={{marginLeft:0,maxWidth:1200,margin:"0 auto"}}><ClientDashboard client={client} isClientView onBack={()=>{}} onRefresh={async()=>{}}/></div></div>;
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
        try{const p=await fetchPERMS(c.id);const latest=p[p.length-1];return{...c,latestPerms:latest?permsAvg(latest.scores):null};}
        catch{return c;}
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
