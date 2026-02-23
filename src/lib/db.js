import { supabase } from './supabase'

// ── AUTH ──────────────────────────────────────────────────

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data.session
}
export async function signOut() { await supabase.auth.signOut() }
export async function getSession() { const { data } = await supabase.auth.getSession(); return data.session }

// ── CLIENTS ───────────────────────────────────────────────

export async function fetchClients() {
  const { data, error } = await supabase.from('clients').select('*').order('created_at', { ascending: true })
  if (error) throw error; return data
}
export async function fetchClientByToken(shareToken) {
  const { data, error } = await supabase.from('clients').select('*').eq('share_token', shareToken).single()
  if (error) throw error; return data
}
export async function createClient(clientData) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('clients').insert({ ...clientData, coach_id: user.id }).select().single()
  if (error) throw error; return data
}
export async function updateClient(id, changes) {
  const { error } = await supabase.from('clients').update(changes).eq('id', id)
  if (error) throw error
}
export async function deleteClient(id) {
  const { error } = await supabase.from('clients').delete().eq('id', id)
  if (error) throw error
}

// ── GOALS ─────────────────────────────────────────────────

export async function fetchGoals(clientId) {
  const { data, error } = await supabase.from('goals').select('*').eq('client_id', clientId).order('sort_order', { ascending: true })
  if (error) throw error; return data
}
export async function upsertGoals(clientId, goals) {
  await supabase.from('goals').delete().eq('client_id', clientId)
  if (!goals.length) return
  const { error } = await supabase.from('goals').insert(
    goals.map((g, i) => ({ client_id: clientId, goal: g.goal, deadline: g.deadline, progress: g.progress, action_items: g.action_items || [], sort_order: i }))
  )
  if (error) throw error
}

// ── PERMS ─────────────────────────────────────────────────

export async function fetchPERMS(clientId) {
  const { data, error } = await supabase.from('perms_history').select('*').eq('client_id', clientId).order('assessed_at', { ascending: true })
  if (error) throw error
  return data.map(r => ({ id: r.id, quarter: r.quarter, date: r.assessed_at, scores: { P: r.score_p, E: r.score_e, R: r.score_r, M: r.score_m, S: r.score_s } }))
}
export async function upsertPERMS(clientId, entry) {
  const { error } = await supabase.from('perms_history').upsert({
    client_id: clientId, quarter: entry.quarter, assessed_at: entry.date,
    score_p: entry.scores.P, score_e: entry.scores.E, score_r: entry.scores.R, score_m: entry.scores.M, score_s: entry.scores.S,
  }, { onConflict: 'client_id,quarter' })
  if (error) throw error
}
export async function deletePERMS(id) {
  const { error } = await supabase.from('perms_history').delete().eq('id', id)
  if (error) throw error
}

// ── WEEKLY POINTS ─────────────────────────────────────────

export async function fetchWeeklyPoints(clientId) {
  const { data, error } = await supabase.from('weekly_points').select('*').eq('client_id', clientId).order('week_iso', { ascending: true })
  if (error) throw error
  return data.map(r => ({ week: r.week_iso, label: r.week_label, move: r.pts_move, recover: r.pts_recover, fuel: r.pts_fuel, connect: r.pts_connect, breathe: r.pts_breathe, misc: r.pts_misc }))
}
export async function upsertWeeklyPoints(clientId, rows) {
  const { error } = await supabase.from('weekly_points').upsert(
    rows.map(r => ({ client_id: clientId, week_iso: r.week, week_label: r.label, pts_move: r.move, pts_recover: r.recover, pts_fuel: r.fuel, pts_connect: r.connect, pts_breathe: r.breathe, pts_misc: r.misc })),
    { onConflict: 'client_id,week_iso' }
  )
  if (error) throw error
}
export async function deleteWeeklyPoints(clientId, weekIso) {
  const { error } = await supabase.from('weekly_points').delete().eq('client_id', clientId).eq('week_iso', weekIso)
  if (error) throw error
}

// ── ASSIGNMENTS ───────────────────────────────────────────

export async function fetchAssignments(clientId, fromDate, toDate) {
  const { data, error } = await supabase.from('assignments').select('*').eq('client_id', clientId).gte('date', fromDate).lte('date', toDate).order('created_at', { ascending: true })
  if (error) throw error; return data
}
export async function createAssignment(clientId, dateKey, task) {
  const { data, error } = await supabase.from('assignments').insert({ client_id: clientId, date: dateKey, ...task }).select().single()
  if (error) throw error; return data
}
export async function updateAssignment(id, changes) {
  const { error } = await supabase.from('assignments').update(changes).eq('id', id)
  if (error) throw error
}
export async function deleteAssignment(id) {
  const { error } = await supabase.from('assignments').delete().eq('id', id)
  if (error) throw error
}

// ── EVENTS ────────────────────────────────────────────────

export async function fetchEvents(clientId, fromDate, toDate) {
  const { data, error } = await supabase.from('events').select('*').eq('client_id', clientId).gte('date', fromDate).lte('date', toDate).order('date', { ascending: true })
  if (error) throw error; return data
}
export async function createEvent(clientId, dateKey, eventData) {
  const { data, error } = await supabase.from('events').insert({ client_id: clientId, date: dateKey, ...eventData }).select().single()
  if (error) throw error; return data
}
export async function updateEvent(id, changes) {
  const { error } = await supabase.from('events').update(changes).eq('id', id)
  if (error) throw error
}
export async function deleteEvent(id) {
  const { error } = await supabase.from('events').delete().eq('id', id)
  if (error) throw error
}

// ── COACH NOTES ───────────────────────────────────────────

export async function fetchCoachNotes(clientId) {
  const { data, error } = await supabase.from('coach_notes').select('*').eq('client_id', clientId).order('week_iso', { ascending: false })
  if (error) throw error; return data
}
export async function upsertCoachNote(clientId, weekIso, weekLabel, note) {
  const { error } = await supabase.from('coach_notes').upsert(
    { client_id: clientId, week_iso: weekIso, week_label: weekLabel, note },
    { onConflict: 'client_id,week_iso' }
  )
  if (error) throw error
}
export async function deleteCoachNote(id) {
  const { error } = await supabase.from('coach_notes').delete().eq('id', id)
  if (error) throw error
}

// ── WORKOUTS (PDFs) ───────────────────────────────────────

export async function fetchWorkouts(clientId) {
  const { data, error } = await supabase.from('workouts').select('*').eq('client_id', clientId).order('uploaded_at', { ascending: true })
  if (error) throw error
  return Promise.all(data.map(async w => {
    const { data: urlData } = await supabase.storage.from('workouts').createSignedUrl(w.storage_path, 3600)
    return { ...w, signedUrl: urlData?.signedUrl }
  }))
}
export async function uploadWorkout(clientId, file, label, week) {
  const path = `${clientId}/${Date.now()}-${file.name}`
  const { error: storageError } = await supabase.storage.from('workouts').upload(path, file)
  if (storageError) throw storageError
  const { data, error: dbError } = await supabase.from('workouts').insert({
    client_id: clientId, name: label || file.name, week: week || 'Unassigned',
    storage_path: path, filename: file.name, size_bytes: file.size,
  }).select().single()
  if (dbError) throw dbError; return data
}
export async function deleteWorkout(workoutId, storagePath) {
  await supabase.storage.from('workouts').remove([storagePath])
  const { error } = await supabase.from('workouts').delete().eq('id', workoutId)
  if (error) throw error
}

// ── BRIDGE ATHLETIC CSV PARSER ────────────────────────────

export function parseBridgeCSV(text) {
  const lines = text.trim().split("\n").filter(l => l.trim())
  if (lines.length < 2) throw new Error("No data rows found.")
  const rows = lines.slice(1).map(line => {
    const cols = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|^(?=,)|(?<=,)$)/g) || line.split(",")
    const c = cols.map(v => v?.replace(/^"|"$/g, "").trim() || "")
    const rawDate = c[3]; const parts = rawDate.split("/")
    const month = parseInt(parts[0]), day = parseInt(parts[1]), year = 2000 + parseInt(parts[2])
    const date = new Date(year, month - 1, day)
    const jan4 = new Date(date.getFullYear(), 0, 4)
    const startOfWeek1 = new Date(jan4)
    startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7))
    const weekNum = Math.floor((date - startOfWeek1) / (7 * 24 * 60 * 60 * 1000)) + 1
    const weekISO = `${year}-W${String(weekNum).padStart(2, "0")}`
    const num = i => { const v = parseFloat(c[i]); return isNaN(v) ? 0 : v }
    return { date, weekISO, year, move: num(8)+num(9)+num(10)+num(11), recover: num(13)+num(14)+num(15)+num(16), fuel: num(18)+num(19)+num(20)+num(21), connect: num(23)+num(24)+num(25)+num(26)+num(27), breathe: num(23), misc: num(29)+num(30) }
  })
  const byWeek = {}
  rows.forEach(r => {
    if (!byWeek[r.weekISO]) {
      const weekStart = new Date(r.date); weekStart.setDate(r.date.getDate() - ((r.date.getDay() + 6) % 7))
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6)
      const fmt = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      byWeek[r.weekISO] = { week: r.weekISO, label: `${fmt(weekStart)} – ${fmt(weekEnd)}`, move: 0, recover: 0, fuel: 0, connect: 0, breathe: 0, misc: 0 }
    }
    byWeek[r.weekISO].move += r.move; byWeek[r.weekISO].recover += r.recover; byWeek[r.weekISO].fuel += r.fuel
    byWeek[r.weekISO].connect += r.connect; byWeek[r.weekISO].breathe += r.breathe; byWeek[r.weekISO].misc += r.misc
  })
  return Object.values(byWeek).sort((a, b) => a.week.localeCompare(b.week))
    .map(w => ({ ...w, move: Math.round(w.move), recover: Math.round(w.recover), fuel: Math.round(w.fuel), connect: Math.round(w.connect), breathe: Math.round(w.breathe), misc: Math.round(w.misc) }))
}