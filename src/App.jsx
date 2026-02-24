fontFamily:"'JetBrains Mono',monospace",fontSize:10}}>{r.week}</div><div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:8,color:"var(--dim)"}}>{r.label}</div></td><td style={{color:"#E8A020"}}>{r.move}</td><td style={{color:"#4ECDC4"}}>{r.recover}</td><td style={{color:"#E84040"}}>{r.fuel}</td><td style={{color:"#8B7CF6"}}>{r.connect}</td><td style={{color:"#60A5FA"}}>{r.breathe}</td><td>{r.misc}</td><td style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:"var(--gold)"}}>{weekTotal(r)}</td></tr>)}</tbody>
          </table>
          <div style={{display:"flex",gap:10,marginTop:18}}><button className="btn btn-gold" onClick={()=>onSave(rows)}>Import {rows.length} Week{rows.length!==1?"s":""}</button><button className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
        </div>
      )}
    </ModalWrap>
  );
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
        {[{id:"overview",label:"Overview"},{id:"schedule",label:"Schedule"},{id:"tasklist",label:"Task List"},{id:"points",label:"Points"},{id:"workouts",label:"Workouts"}].map(t=>(
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
                <button key={v} className={`tab${ptsPeriod===v?" on":""}`} onClick={()=>setPtsPeriod(v)}>{l}</button>
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
              <div className="card mb20">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div className="mono tiny" style={{color:"var(--dim)"}}>Points Trend</div>
                  <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                    {PILLARS.map(p=><div key={p.id} style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:8,height:8,borderRadius:"50%",background:p.color}}/><div className="mono tiny" style={{color:"var(--dim)"}}>{p.label}</div></div>)}
                  </div>
                </div>
                <PointsChart data={aggPoints}/>
              </div>
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
