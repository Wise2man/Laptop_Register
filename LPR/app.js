
/* ============ Firebase config ============ */
const firebaseConfig = {
  apiKey: "AIzaSyAYRo3_6E3ppV5pR87CUHekYeYixLDstGA",
  authDomain: "pc-register-88273.firebaseapp.com",
  projectId: "pc-register-88273",
  storageBucket: "pc-register-88273.firebasestorage.app",
  messagingSenderId: "244112160898",
  appId: "1:244112160898:web:4140402ef77329f85f5c9b"
};
/* ================================================================= */

const configured = firebaseConfig.projectId !== 'PASTE_HERE' && firebaseConfig.apiKey !== 'PASTE_HERE';
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = id => document.getElementById(id);
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dayName = s => DAYS[parse(s).getDay()];
const isWeekday = d => d.getDay() >= 1 && d.getDay() <= 5;
function mondayOf(s) { const d = parse(s), diff = (d.getDay() + 6) % 7; d.setDate(d.getDate() - diff); return d; }
async function hash(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/* ---------- Shared online data (Firebase Firestore) ---------- */
let fs = null, storage = null;
const C = { settings: { totalPCs: 41, admins: [], groups: [] }, users: [], records: [], reports: [], updates: [], zipReplies: [] };
const WEEK = 7 * 864e5;
const liveReports = () => C.reports.filter(x => Date.now() - x.created <= WEEK);
const loaded = { s: 0, u: 0, r: 0, p: 0 };
let updatesError = '', zipRepliesError = '', uploadBusy = false;
const ready = () => loaded.s && loaded.u && loaded.r && loaded.p;
function dedupeAttendance(list) {
  const byStudentDay = new Map();
  for (const record of list) {
    const eventTime = record.time || record.signedAt || record.id || '';
    const key = `${record.date || ''}_${record.sn || ''}_${eventTime}`, current = byStudentDay.get(key);
    const validPc = hasRecordedPc(record.pc);
    const currentPc = current && hasRecordedPc(current.pc);
    if (!current || (validPc && !currentPc) || (validPc === currentPc && (Number(record.signedAt) || Infinity) < (Number(current.signedAt) || Infinity)) || (validPc === currentPc && record.signedAt === current.signedAt && String(record.id) < String(current.id))) byStudentDay.set(key, record);
  }
  return [...byStudentDay.values()];
}
const hasRecordedPc = pc => pc !== null && pc !== undefined && String(pc).trim() !== '' && !['null', 'undefined'].includes(String(pc).trim().toLowerCase());
const settings = () => C.settings, users = () => C.users, records = () => dedupeAttendance(C.records);
const findAdmin = u => settings().admins.find(a => a.user === u.trim().toLowerCase());
const PERMISSIONS = { attendance: 'Manage attendance', students: 'Manage student accounts', groups: 'Manage groups', settings: 'Change lab and PC settings', reports: 'Review absence reports', updates: 'Publish updates and manage student files', staff: 'Create and manage staff roles' };
const isStaff = () => Boolean(session && ['admin', 'staff'].includes(session.role) && settings().admins.some(a => a.user === session.user));
const hasPermission = permission => {
  if (!isStaff()) return false;
  const account = settings().admins.find(a => a.user === session.user);
  if (!account) return false;
  if (session.role === 'admin') return account.role !== 'staff';
  return account.role === 'staff' && Array.isArray(account.permissions) && account.permissions.includes(permission);
};
const saveSettings = st => fs.doc('settings/main').set(st);
let session = null;
try { session = JSON.parse(localStorage.getItem('pcreg_session')); } catch {}
const keepSession = () => localStorage.setItem('pcreg_session', JSON.stringify(session));
let msg = '', tab = 'login', pick = null;
let signatureDrawn = false, signatureActive = false;
let signatureMessage = '';

function fail(e) {
  $('app').innerHTML = `<div class="card"><h2>Cannot reach the online database</h2>
  <p class="err">${esc(e.message || e)}</p>
  <p>Check your internet. Also check that the Firestore rules were published and the config in index.html is correct.</p></div>`;
}
function start() {
  if (!configured) {
    $('app').innerHTML = `<div class="card"><h2>One more step</h2>
    <p>Open <code>index.html</code>, find <code>firebaseConfig</code> at the top of the script, and paste your Firebase details there. Then upload the file to GitHub again.</p></div>`;
    return;
  }
  if (typeof firebase === 'undefined') return fail('Firebase could not load. Check your internet.');
  firebase.initializeApp(firebaseConfig); fs = firebase.firestore(); storage = firebase.storage();
  fs.doc('settings/main').onSnapshot(d => {
    if (d.exists) { C.settings = d.data(); C.settings.admins = C.settings.admins || []; C.settings.groups = C.settings.groups || []; }
    loaded.s = 1; refresh();
  }, fail);
  fs.collection('users').onSnapshot(q => { C.users = q.docs.map(d => d.data()); loaded.u = 1; refresh(); }, fail);
  fs.collection('records').onSnapshot(q => { C.records = q.docs.map(d => ({ ...d.data(), id: d.data().id || d.id })); loaded.r = 1; refresh(); }, fail);
  fs.collection('reports').onSnapshot(q => {
    C.reports = q.docs.map(d => d.data());
    C.reports.filter(x => Date.now() - x.created > WEEK).forEach(x => fs.collection('reports').doc(x.id).delete().catch(() => {}));
    loaded.p = 1; refresh();
  }, fail);
  fs.collection('updates').onSnapshot(q => { C.updates = q.docs.map(d => d.data()); updatesError = ''; refresh(); }, () => { updatesError = 'Updates are unavailable. Check Firestore rules.'; refresh(); });
  fs.collection('zipReplies').onSnapshot(q => { C.zipReplies = q.docs.map(d => d.data()); zipRepliesError = ''; refresh(); }, () => { zipRepliesError = 'ZIP replies are unavailable. Check Firestore rules.'; refresh(); });
}
function refresh() {
  if (!ready()) return;
  const a = document.activeElement;
  if (uploadBusy || signatureActive || signatureDrawn || a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return; // preserve active form input, signature drawing, and uploads
  render();
}

/* ---------- Views ---------- */
function render() {
  if (!ready()) return;
  if (session && ['admin', 'staff'].includes(session.role) && !settings().admins.some(a => a.user === session.user)) {
    logout();
    return;
  }
  $('who').innerHTML = session
    ? `${esc(session.name)} (${session.role}) <button class="alt sm" style="color:#fff;border-color:#fff" onclick="logout()">Log out</button>` : '';
  $('nav').innerHTML = '';
  if (!session) return authView();
  if (session.role === 'student' && !studentProfile().signature) return signatureSetupView();
  const staff = isStaff(), n = liveReports().filter(r => r.status === 'pending').length;
  $('nav').innerHTML = `<a href="#" class="${page() === 'register' ? 'on' : ''}">${staff ? 'Admin' : 'Register'}</a>` +
    (!staff || hasPermission('reports') ? `<a href="#reports" class="${page() === 'reports' ? 'on' : ''}">${staff ? 'Absence reports' + (n ? ` (${n} waiting)` : '') : 'Report absence'}</a>` : '') +
    `<a href="#updates" class="${page() === 'updates' ? 'on' : ''}">Updates</a>`;
  if (page() === 'updates') return updatesView(staff);
  if (page() === 'reports') return staff ? (hasPermission('reports') ? adminReports() : adminView()) : studentReports();
  staff ? adminView() : studentView();
}
const page = () => location.hash === '#reports' ? 'reports' : location.hash === '#updates' ? 'updates' : 'register';
window.addEventListener('hashchange', () => { msg = ''; render(); });
function authView() {
  const needAdmin = !settings().admins.length;
  if (!needAdmin && tab === 'admin') tab = 'login';
  signatureDrawn = false; signatureActive = false;
  $('app').innerHTML = `
  <div class="card">
    <div class="tabs">
      <button class="${tab === 'login' ? '' : 'alt'}" onclick="setTab('login')">Log in</button>
      <button class="${tab === 'signup' ? '' : 'alt'}" onclick="setTab('signup')">Student sign up</button>
      ${needAdmin ? `<button class="${tab === 'admin' ? '' : 'alt'}" onclick="setTab('admin')">Set up admin</button>` : ''}
    </div>
    ${tab === 'signup' ? `
      <label for="n">Full name</label><input id="n" autocomplete="name">
      <label for="s">Student number</label><input id="s" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="13" oninput="this.value=this.value.replace(/\\D/g,'').slice(0,13)">
      <label for="p">Password (at least 6 characters)</label><input id="p" type="password">
      <label for="signature">Write your signature</label><canvas id="signature" class="signature-pad" width="560" height="150" aria-label="Signature drawing area"></canvas>
      <button type="button" class="alt" onclick="clearSignature()">Clear signature</button>
      <button onclick="signup()">Create account</button>` :
    tab === 'login' ? `
      <label for="s">Student number or admin username</label><input id="s" autocapitalize="off">
      <label for="p">Password</label><input id="p" type="password">
      <button onclick="login()">Log in</button>` : `
      <p>First time here. Create the first admin account.</p>
      <label for="s">Admin username</label><input id="s" value="admin" autocapitalize="off">
      <label for="p">Admin password (at least 6 characters)</label><input id="p" type="password">
      <button onclick="setupAdmin()">Create admin and log in</button>`}
    <div class="msg err">${msg}</div>
  </div>`;
  if (tab === 'signup') initSignaturePad();
}
function initSignaturePad() {
  const canvas = $('signature'), context = canvas.getContext('2d');
  context.lineWidth = 3; context.lineCap = 'round'; context.lineJoin = 'round'; context.strokeStyle = '#17212b';
  const point = event => { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }; };
  canvas.addEventListener('pointerdown', event => { event.preventDefault(); canvas.setPointerCapture(event.pointerId); const p = point(event); context.beginPath(); context.moveTo(p.x, p.y); signatureActive = true; });
  canvas.addEventListener('pointermove', event => { if (!canvas.hasPointerCapture(event.pointerId)) return; const p = point(event); context.lineTo(p.x, p.y); context.stroke(); signatureDrawn = true; });
  canvas.addEventListener('pointerup', () => { signatureActive = false; });
  canvas.addEventListener('pointercancel', () => { signatureActive = false; });
}
function clearSignature() {
  const canvas = $('signature');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  signatureDrawn = false; signatureActive = false;
}
function signatureSetupView() {
  signatureDrawn = false; signatureActive = false;
  $('app').innerHTML = `<div class="card"><h2>Complete your signature</h2>
    <p>Write your signature once to finish setting up your attendance account.</p>
    <label for="signature">Write your signature</label><canvas id="signature" class="signature-pad" width="560" height="150" aria-label="Signature drawing area"></canvas>
    <button type="button" class="alt" onclick="clearSignature()">Clear signature</button>
    <button onclick="saveLoginSignature()">Save signature</button><div id="signatureMessage" class="msg err">${esc(signatureMessage)}</div></div>`;
  initSignaturePad();
}
async function saveLoginSignature() {
  if (!session || session.role !== 'student') return;
  const signature = signatureDrawn ? $('signature').toDataURL('image/png') : '';
  if (!signature) { $('signatureMessage').textContent = 'Please draw your signature first.'; return; }
  try {
    await fs.collection('users').doc(session.sn).update({ signature });
    const profile = users().find(u => u.sn === session.sn);
    if (profile) profile.signature = signature;
    signatureMessage = ''; signatureDrawn = false; render();
  } catch (e) { $('signatureMessage').textContent = 'Could not save your signature. Check your internet and try again.'; }
}
const setTab = t => { tab = t; msg = ''; render(); };
const say = (m, ok) => { msg = ok ? `<span class="good">${m}</span>` : m; render(); };

async function signup() {
  const name = $('n').value.trim(), sn = $('s').value.trim().toUpperCase(), p = $('p').value;
  const signature = signatureDrawn ? $('signature').toDataURL('image/png') : '';
  if (!name || !sn) return say('Please fill in your name and student number.');
  if (!/^\d{1,13}$/.test(sn)) return say('Student number must contain only digits and be no more than 13 digits.');
  if (!signature) return say('Please write your signature before creating the account.');
  if (findAdmin(sn)) return say('This student number is not allowed.');
  if (p.length < 6) return say('Password must have at least 6 characters.');
  try {
    const ref = fs.collection('users').doc(sn);
    const account = { name, sn, pw: await hash(sn + ':' + p), signature };
    let exists = false;
    await fs.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (current.exists) { exists = true; return; }
      tx.set(ref, account);
    });
    if (exists) return say('This student number already has an account. Please log in.');
    tab = 'login'; say('Account created. You can log in now.', true);
  } catch (e) { say('Could not save. Check your internet.'); }
}
async function login() {
  const raw = $('s').value.trim(), p = $('p').value, ad = findAdmin(raw);
  if (ad) {
    if (ad.pw !== await hash(ad.user + ':' + p)) return say('Wrong admin password.');
    session = { role: ad.role === 'staff' ? 'staff' : 'admin', name: ad.user, user: ad.user };
  } else {
    const sn = raw.toUpperCase(), u = users().find(x => x.sn === sn);
    if (!u || u.pw !== await hash(sn + ':' + p)) return say('Wrong username or password.');
    session = { role: 'student', sn, name: u.name };
  }
  myGroup = ''; myStudentType = ''; signatureMessage = ''; keepSession(); msg = ''; render();
}
async function setupAdmin() {
  if (settings().admins.length) return say('An admin already exists. Please log in.');
  const user = $('s').value.trim().toLowerCase(), p = $('p').value;
  if (!user) return say('Type an admin username.');
  if (users().some(x => x.sn.toLowerCase() === user)) return say('That name is used by a student. Choose another.');
  if (p.length < 6) return say('Password must have at least 6 characters.');
  await saveSettings({ ...settings(), admins: [{ user, pw: await hash(user + ':' + p), role: 'admin' }] });
  session = { role: 'admin', name: user, user }; keepSession(); msg = ''; render();
}
function logout() { session = null; localStorage.removeItem('pcreg_session'); pick = null; myGroup = ''; myStudentType = ''; signatureMessage = ''; render(); }

/* ---------- Location ---------- */
function distance(a, b, c, d) {
  const R = 6371000, r = x => x * Math.PI / 180, dLa = r(c - a), dLo = r(d - b);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const getPos = () => new Promise((ok, no) => {
  if (!navigator.geolocation) return no({ code: 0 });
  navigator.geolocation.getCurrentPosition(ok, no, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
});
const geoMsg = e => e.code === 1 ? 'Location is blocked. Allow location for this page in your browser settings, then try again.'
  : e.code === 3 ? 'Finding your location took too long. Go near a window, switch on GPS, and try again.'
  : 'Could not find your location. Switch on location and try again.';
let busy = false, myGroup = '', myStudentType = '';
const studentProfile = () => users().find(u => u.sn === session.sn) || {};
const assignedGroup = () => studentProfile().group || '';
const groupLocked = () => Boolean(studentProfile().group || studentProfile().groupLocked);
const LEGACY_PERSONAL_GROUP = 'Lab Personal PC';
const isLegacyPersonalGroup = group => {
  const value = String(group || '').trim().toLowerCase(), prefix = LEGACY_PERSONAL_GROUP.toLowerCase();
  return value === prefix || value.startsWith(prefix + ' ') || value.startsWith(prefix + '-') || value.startsWith(prefix + '(');
};
const DEFAULT_STUDENT_TYPES = ['Interns', 'Work Integrated Learning'];
const studentTypes = () => settings().studentTypes || DEFAULT_STUDENT_TYPES;
const usesStudentType = () => Boolean(studentProfile().personalPCProgram || isLegacyPersonalGroup(assignedGroup()));
function groupYearFor(group) { return (settings().groupYears || {})[group] || ''; }
function groupLabel(group, year) {
  const labelYear = year === undefined ? groupYearFor(group) : year;
  return `${group || ''}${labelYear ? ` - ${labelYear}` : ''}`;
}
function groupWhatsAppUrl(group) {
  const link = group ? (settings().groupWhatsAppLinks || {})[group] || '' : '';
  try {
    const parsed = new URL(link);
    return parsed.protocol === 'https:' && parsed.hostname.toLowerCase() === 'chat.whatsapp.com' ? parsed.href : '';
  } catch { return ''; }
}
function studentGroupJoinLink(group) {
  const link = groupWhatsAppUrl(group);
  return link ? `<p class="group-link">${esc(groupLabel(group))}: <a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Join the WhatsApp group</a></p>` : '';
}
const personalNums = () => [...(settings().personalPCs || [])].sort((a, b) => a - b);
const isP = r => r.personal || r.pc === 'Personal';
const pcLabel = r => !hasRecordedPc(r.pc) ? 'Not recorded' : r.pc === 'Personal' ? 'Personal' : r.personal ? `${r.pc} (personal)` : r.pc;
const attendanceStudentType = r => r.studentType || (isLegacyPersonalGroup(r.group) && (users().find(u => u.sn === r.sn) || {}).studentType) || '';
const attendanceCategory = r => isLegacyPersonalGroup(r.group) ? (attendanceStudentType(r) || 'Student type needed') : r.group ? groupLabel(r.group, r.groupYear) : attendanceStudentType(r);

/* ---------- Student ---------- */
const taken = (date, pc) => records().find(r => r.date === date && r.pc === pc && !r.returnedAt);
function studentView() {
  const today = ymd(new Date()), total = settings().totalPCs;
  const mine = records().find(r => r.date === today && r.sn === session.sn);
  let top;
  if (!isWeekday(new Date())) top = `<p>The register is open Monday to Friday only. Today is ${dayName(today)}.</p>`;
    else if (mine) top = `<p>${mine.returnedAt ? 'Attendance recorded; PC returned' : 'Today you are holding'}</p><div class="big">${isP(mine) ? 'Personal PC' + (mine.pc === 'Personal' ? '' : ' ' + mine.pc) : `PC ${pcLabel(mine)}`}</div>
      <p>${isP(mine) ? 'You are using your own PC today. Only the admin can change this.' : `Signed at ${mine.time}${mine.returnedAt ? `; returned at ${new Date(mine.returnedAt).toLocaleTimeString()}` : ''}. You cannot sign in again today.`}${mine.studentType ? ' Student type: ' + esc(mine.studentType) + '.' : mine.group ? ' Group: ' + esc(groupLabel(mine.group, mine.groupYear)) + '.' : ''}</p>`;
  else {
    let cells = '';
    for (let i = 1; i <= total; i++) cells += `<button class="pc ${pick === i ? 'sel' : ''}" ${taken(today, i) ? 'disabled' : ''} onclick="choose(${i})">${i}</button>`;
    const pcells = personalNums().map(n => `<button class="pc ${pick === n ? 'sel' : ''}" ${taken(today, n) ? 'disabled' : ''} onclick="choose(${n})">${n}</button>`).join('');
    top = `<p>Pick the PC you are taking. Once you sign, only the admin can change it. You must be at the lab to sign, so allow location when the browser asks.</p>
      <div class="grid">${cells}</div>
      ${pcells ? `<p>Using your own PC? Pick a personal PC number:</p><div class="grid">${pcells}</div>` : ''}
      ${usesStudentType() ? (studentProfile().studentType ? `<p>Your student type: <b>${esc(studentProfile().studentType)}</b> (ask an admin to change it)</p>` : `<label for="studentType">Choose your student type</label><select id="studentType" onchange="myStudentType=this.value"><option value="">Choose a type</option>${studentTypes().map(x => `<option value="${esc(x)}" ${x === myStudentType ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`) : assignedGroup() ? `<p>Your group: <b>${esc(groupLabel(assignedGroup()))}</b> (ask an admin to change it)</p>` : groupLocked() ? '<p class="err">Your group has not been assigned. Please ask an admin.</p>' : (settings().groups || []).some(g => !isLegacyPersonalGroup(g)) ? `<label for="grp">Your group</label><select id="grp" onchange="myGroup=this.value; render()"><option value="">Choose your group</option>${settings().groups.filter(g => !isLegacyPersonalGroup(g)).map(g => `<option value="${esc(g)}" ${g === myGroup ? 'selected' : ''}>${esc(groupLabel(g))}</option>`).join('')}</select>` : '<p class="err">The admin has not added groups yet.</p>'}
      <button ${pick ? '' : 'disabled'} onclick="sign()">${pick ? (personalNums().includes(pick) ? 'Sign for personal PC ' : 'Sign for PC ') + pick : 'Choose a PC first'}</button>`;
  }
  const hist = records().filter(r => r.sn === session.sn).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  $('app').innerHTML = `
  <div class="card"><h2>${dayName(today)}, ${today}</h2>${top}${studentGroupJoinLink(assignedGroup() || myGroup)}<div class="msg err">${msg}</div></div>
  <div class="card"><h2>My last sign-ins</h2><div class="wrap">${table(hist, false)}</div></div>`;
}
const choose = i => { pick = i; render(); };
async function sign() {
  const today = ymd(new Date()); msg = '';
  if (!isWeekday(new Date())) return say('Register is closed on weekends.');
  if (records().some(x => x.date === today && x.sn === session.sn)) return say('You already have an attendance record today and cannot sign in again.');
  const studentType = usesStudentType() ? studentProfile().studentType || myStudentType : '';
  const grp = usesStudentType() ? '' : assignedGroup() || (groupLocked() ? '' : myGroup);
  if (usesStudentType() && !studentType) return say('Please choose your student type.');
  if (!usesStudentType() && !grp) return say(groupLocked() ? 'Your group has not been assigned. Please ask an admin.' : 'Please choose your group.');
  const lab = settings().lab;
  if (!lab) return say('The admin has not set the lab location yet. Please tell the admin.');
  if (busy) return;
  busy = true;
  try {
    const pos = await getPos(), d = distance(pos.coords.latitude, pos.coords.longitude, lab.lat, lab.lng);
    if (d > lab.radius) { busy = false; return say(`You are about ${Math.round(d)} m from the lab. You must be within ${lab.radius} m to sign.`); }
  } catch (e) { busy = false; return say(geoMsg(e)); }
  busy = false;
  const t = new Date(), slotId = `${today}_pc${pick}`;
  const rec = { id: `${slotId}_${session.sn}_${t.getTime()}`, date: today, sn: session.sn, name: session.name, group: grp, groupYear: groupYearFor(grp), studentType, signature: studentProfile().signature || '', signedAt: t.getTime(), pc: pick, personal: personalNums().includes(pick), time: `${pad(t.getHours())}:${pad(t.getMinutes())}` };
  const ref = fs.collection('records').doc(rec.id), slotRef = fs.collection('slots').doc(slotId), legacyRef = fs.collection('records').doc(slotId), studentDayRef = fs.collection('studentDays').doc(`${today}_${session.sn}`);
  try {
    const userRef = fs.collection('users').doc(session.sn);
    await fs.runTransaction(async tx => {
      const existing = await tx.get(ref), user = await tx.get(userRef), slot = await tx.get(slotRef), legacy = await tx.get(legacyRef), studentDay = await tx.get(studentDayRef);
      if (existing.exists || slot.exists || studentDay.exists || (legacy.exists && !legacy.data().returnedAt)) throw new Error('taken');
      tx.set(ref, rec);
      tx.set(slotRef, { recordId: rec.id });
      tx.set(studentDayRef, { sn: session.sn, date: today, recordId: rec.id });
      const profile = user.data() || {};
      if (usesStudentType()) tx.update(userRef, { group: '', studentType, personalPCProgram: true, groupLocked: true });
      else if (!profile.group && !profile.groupLocked) tx.update(userRef, { group: grp, groupLocked: true });
    });
    pick = null; render();
  } catch (e) { pick = null; say(e.message === 'taken' ? 'This student already has an attendance record today, or that PC is taken.' : 'Could not save. Check your internet and try again.'); }
}

/* ---------- Admin ---------- */
let range = { type: 'week', value: ymd(new Date()) };
let selectedRecordId = '', selectedStudentSn = '', selectedGroup = '', adminTab = 'attendance';
function inRange() {
  let list = records();
  if (range.type === 'week') {
    const m = mondayOf(range.value), f = new Date(m); f.setDate(m.getDate() + 4);
    list = list.filter(r => r.date >= ymd(m) && r.date <= ymd(f));
  } else list = list.filter(r => r.date.startsWith(range.value.slice(0, 7)));
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || String(a.pc).localeCompare(String(b.pc), undefined, { numeric: true }));
}
let attendanceFilters = { query: '', from: '', to: '', group: '', type: '', pc: '', status: '' };
function filteredAttendance() {
  const f = attendanceFilters, query = f.query.trim().toLowerCase();
  return records().filter(r => {
    const searchable = `${r.name || ''} ${r.sn || ''}`.toLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (f.from && r.date < f.from || f.to && r.date > f.to) return false;
    if (f.group && r.group !== f.group) return false;
    if (f.type && attendanceStudentType(r) !== f.type) return false;
    if (f.pc && String(r.pc || '').toLowerCase() !== f.pc.toLowerCase()) return false;
    if (f.status === 'returned' && !r.returnedAt) return false;
    if (f.status === 'out' && (r.returnedAt || isP(r))) return false;
    if (f.status === 'personal' && !isP(r)) return false;
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || (Number(b.signedAt) || 0) - (Number(a.signedAt) || 0));
}
function attendanceSearchCard() {
  const f = attendanceFilters, list = filteredAttendance(), display = list.slice(0, 100);
  return `<div class="card"><h2>Search attendance</h2>
    <div class="row"><div><label for="attendanceQuery">Student name, surname, or number</label><input id="attendanceQuery" value="${esc(f.query)}" placeholder="Search students"></div>
    <div><label for="attendanceFrom">From date</label><input id="attendanceFrom" type="date" value="${esc(f.from)}"></div>
    <div><label for="attendanceTo">To date</label><input id="attendanceTo" type="date" value="${esc(f.to)}"></div></div>
    <div class="row"><div><label for="attendanceGroup">Group</label><select id="attendanceGroup"><option value="">All groups</option>${(settings().groups || []).filter(g => !isLegacyPersonalGroup(g)).map(g => `<option value="${esc(g)}" ${f.group === g ? 'selected' : ''}>${esc(groupLabel(g))}</option>`).join('')}</select></div>
    <div><label for="attendanceType">Student type</label><select id="attendanceType"><option value="">All types</option>${studentTypes().map(type => `<option value="${esc(type)}" ${f.type === type ? 'selected' : ''}>${esc(type)}</option>`).join('')}</select></div>
    <div><label for="attendancePc">PC number</label><input id="attendancePc" value="${esc(f.pc)}" inputmode="numeric" placeholder="Any PC"></div>
    <div><label for="attendanceStatus">Return status</label><select id="attendanceStatus"><option value="">All statuses</option><option value="out" ${f.status === 'out' ? 'selected' : ''}>Not returned</option><option value="returned" ${f.status === 'returned' ? 'selected' : ''}>Returned</option><option value="personal" ${f.status === 'personal' ? 'selected' : ''}>Personal PC</option></select></div></div>
    <button onclick="applyAttendanceFilters()">Search</button><button class="alt" onclick="clearAttendanceFilters()">Clear</button>
    <p>${list.length} match(es)${list.length > display.length ? `; showing the latest ${display.length}` : ''}.</p><div class="wrap">${table(display, true)}</div></div>`;
}
function applyAttendanceFilters() {
  attendanceFilters = { query: $('attendanceQuery').value, from: $('attendanceFrom').value, to: $('attendanceTo').value, group: $('attendanceGroup').value, type: $('attendanceType').value, pc: $('attendancePc').value.trim(), status: $('attendanceStatus').value };
  render();
}
function clearAttendanceFilters() {
  attendanceFilters = { query: '', from: '', to: '', group: '', type: '', pc: '', status: '' };
  render();
}
function viewRecord(id) {
  selectedRecordId = id;
  adminTab = 'attendance';
  render();
  $('recordDetails')?.scrollIntoView({ block: 'nearest' });
}
function viewStudent(sn) {
  selectedStudentSn = sn;
  adminTab = 'students';
  render();
  $('studentDetails')?.scrollIntoView({ block: 'nearest' });
}
function viewGroup(group) {
  selectedGroup = group;
  adminTab = 'groups';
  render();
  $('groupDetails')?.scrollIntoView({ block: 'nearest' });
}
function adminGroupDetails() {
  const groups = settings().groups || [], i = groups.indexOf(selectedGroup);
  if (i < 0 || isLegacyPersonalGroup(selectedGroup)) return '';
  const members = users().filter(u => u.group === selectedGroup);
  const history = hasPermission('attendance') ? records().filter(r => r.group === selectedGroup)
    .sort((a, b) => b.date.localeCompare(a.date) || (Number(b.signedAt) || 0) - (Number(a.signedAt) || 0))
    : [];
  return `<div class="card" id="groupDetails"><h2>${esc(groupLabel(selectedGroup))}</h2>
    <p>${members.length} student(s)${hasPermission('attendance') ? ` · ${history.length} attendance record(s)` : ''}</p>
    <div class="row"><div><label for="groupYearDetail">Year</label><input id="groupYearDetail" maxlength="24" value="${esc(groupYearFor(selectedGroup))}" onchange="setGroupYear(${i}, this.value)"></div>
    <div><label for="groupWhatsAppDetail">WhatsApp invite link</label><input id="groupWhatsAppDetail" type="url" placeholder="https://chat.whatsapp.com/..." value="${esc(groupWhatsAppUrl(selectedGroup))}" onchange="setGroupWhatsAppLink(${i}, this.value)"></div></div>
    <h3>Students</h3>${members.length ? `<ul>${members.map(u => `<li>${hasPermission('students') ? `<a href="#studentDetails" onclick="viewStudent(this.dataset.sn); return false" data-sn="${esc(u.sn)}">${esc(u.name)} (${esc(u.sn)})</a>` : `${esc(u.name)} (${esc(u.sn)})`}</li>`).join('')}</ul>` : '<p>No students are assigned to this group.</p>'}
    ${hasPermission('attendance') ? `<h3>Attendance history</h3>${table(history, true)}` : ''}
    <button class="sm alt" onclick="removeGroup(${i})">Remove group</button>
    <button class="sm alt" onclick="selectedGroup = ''; render()">Close details</button></div>`;
}
function adminRecordDetails() {
  const rec = records().find(r => r.id === selectedRecordId);
  if (!rec) return '';
  return `<div class="card" id="recordDetails"><h2>Sign-in details</h2>
    <p><b>${esc(rec.name)}</b> (${esc(rec.sn)})</p>
    <p>${rec.date} (${dayName(rec.date)}) · ${esc(attendanceCategory(rec))} · ${pcLabel(rec)}</p>
    <p>Signed in: ${esc(rec.time || 'Not recorded')}<br>Returned: ${rec.returnedAt ? esc(new Date(rec.returnedAt).toLocaleString()) : isP(rec) ? 'Personal PC' : 'Not returned'}</p>
    <p>Signature: ${rec.signature ? `<img src="${esc(rec.signature)}" alt="Signature of ${esc(rec.name)}" style="width:180px;height:64px;object-fit:contain">` : 'Not captured'}</p>
    ${isP(rec) ? '' : `<button class="sm" onclick="returnPc('${esc(rec.id)}')">Record return</button><button class="sm" onclick="editPc('${esc(rec.id)}')">Change PC</button>`}
    <button class="sm alt" onclick="removeRec('${esc(rec.id)}')">Remove sign-in</button>
    <button class="sm alt" onclick="selectedRecordId = ''; render()">Close details</button></div>`;
}
function adminStudentDetails() {
  const studentList = users(), user = studentList.find(u => u.sn === selectedStudentSn);
  if (!user) return '';
  const i = studentList.indexOf(user);
  return `<div class="card" id="studentDetails"><h3>${esc(user.name)}</h3>
    <p>Student number: ${esc(user.sn)}<br>Group: ${esc(user.group ? groupLabel(user.group) : 'None')}<br>Student type: ${esc(user.studentType || 'None')}</p>
    <div class="row"><div><label for="studentGroup">Group</label><select id="studentGroup" onchange="assignGroup(${i}, this.value)"><option value="" ${(!user.group || isLegacyPersonalGroup(user.group)) ? 'selected' : ''}>${isLegacyPersonalGroup(user.group) ? 'Lab Personal PC (choose type)' : '(none)'}</option>${groupOpts(user.group)}</select></div>
    <div><label for="studentType">Student type</label><select id="studentType" onchange="assignStudentType(${i}, this.value)"><option value="">(none)</option>${studentTypes().map(type => `<option value="${esc(type)}" ${user.studentType === type ? 'selected' : ''}>${esc(type)}</option>`).join('')}</select></div></div>
    <button class="sm" onclick="resetStudent(${i})">Reset password</button>
    <button class="sm alt" onclick="deleteStudent('${esc(user.sn)}')">Delete login and profile</button>
    <button class="sm alt" onclick="selectedStudentSn = ''; render()">Close details</button></div>`;
}
function adminView() {
  const list = inRange(), st = settings(), groups = (st.groups || []).filter(g => !isLegacyPersonalGroup(g));
  const sections = [
    { id: 'attendance', label: 'Attendance', permission: 'attendance' },
    { id: 'settings', label: 'Settings', permission: 'settings' },
    { id: 'groups', label: 'Groups', permission: 'groups' },
    { id: 'pc-tools', label: 'Personal PC', permission: 'attendance' },
    { id: 'students', label: 'Students', permission: 'students' },
    { id: 'staff', label: 'Staff & account' },
    { id: 'exports', label: 'Exports', permission: 'attendance' }
  ].filter(section => !section.permission || hasPermission(section.permission));
  if (!sections.some(section => section.id === adminTab)) adminTab = sections[0].id;
  const panel = id => `admin-panel${adminTab === id ? ' active' : ''}`;
  const wk = mondayOf(ymd(new Date())), fri = new Date(wk); fri.setDate(wk.getDate() + 4);
  const personal = records().filter(r => isP(r) && r.date >= ymd(wk) && r.date <= ymd(fri))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  $('app').innerHTML = `
  <div class="msg err">${msg}</div>
  <div class="admin-tabs" role="tablist" aria-label="Admin sections">${sections.map(section => `<button type="button" role="tab" aria-selected="${adminTab === section.id}" class="${adminTab === section.id ? '' : 'alt'}" onclick="setAdminTab('${section.id}')">${section.label}</button>`).join('')}</div>
  ${hasPermission('attendance') ? `<section class="${panel('attendance')}" role="tabpanel">${dayCard()}${attendanceSearchCard()}${adminRecordDetails()}</section>` : ''}
  ${hasPermission('settings') ? `<section class="${panel('settings')}" role="tabpanel"><div class="card"><h2>Settings</h2>
    <div class="row"><div><label for="tp">Number of PCs</label><input id="tp" type="number" min="1" value="${st.totalPCs}"></div></div>
    <button onclick="saveTotal()">Save number of PCs</button></div>
  <div class="card"><h2>Lab location</h2>
    <p>${st.lab ? `Saved: ${st.lab.lat.toFixed(5)}, ${st.lab.lng.toFixed(5)}. Students must be within ${st.lab.radius} m.` : '<span class="err">Not set yet. Students cannot sign until you set it.</span>'}</p>
    <p>Stand in the lab with this device and click the button. A phone with GPS is more exact than a desktop PC.</p>
    <div class="row"><div><label for="rad">Allowed distance in metres</label><input id="rad" type="number" min="20" value="${st.lab ? st.lab.radius : 100}"></div></div>
    <button onclick="setLab()">Use this device's location as the lab</button>
    ${st.lab ? '<button class="alt" onclick="saveRadius()">Save distance only</button>' : ''}</div></section>` : ''}
  ${hasPermission('groups') ? `<section class="${panel('groups')}" role="tabpanel"><div class="card"><h2>Groups</h2>
    ${groups.length ? `<ul class="link-list">${groups.map(g => `<li><a href="#groupDetails" onclick="viewGroup(this.dataset.group); return false" data-group="${esc(g)}">${esc(groupLabel(g))}</a><span>${users().filter(u => u.group === g).length} students</span></li>`).join('')}</ul>` : '<p class="err">No groups yet. Students cannot sign until you add one.</p>'}
    ${(st.groups || []).some(isLegacyPersonalGroup) ? `<p>“${LEGACY_PERSONAL_GROUP}” is treated as a student type category, not a group.</p><button class="sm alt" onclick="removeLegacyPersonalGroup()">Remove legacy group entry</button>` : ''}
    <label for="gn">New group name</label><input id="gn">
    <button onclick="addGroup()">Add group</button></div>
  ${adminGroupDetails()}
  <div class="card"><h2>Student types</h2><p>For students formerly listed under ${LEGACY_PERSONAL_GROUP}; these are separate from groups.</p>
    <div class="wrap"><table>${studentTypes().map((type, i) => `<tr><td>${esc(type)}</td><td>${users().filter(u => u.studentType === type).length} students</td><td><button class="sm alt" onclick="removeStudentType(${i})">Remove</button></td></tr>`).join('')}</table></div>
    <label for="newStudentType">New student type</label><input id="newStudentType" maxlength="50">
    <button onclick="addStudentType()">Add student type</button></div></section>` : ''}
  ${hasPermission('settings') ? `<section class="${panel('settings')}" role="tabpanel"><div class="card"><h2>Personal PC numbers</h2>
    <p>These numbers start at 200. Students who use their own PC pick one of them when they sign.</p>
    ${personalNums().length ? personalNums().map(n => `<span style="margin-right:14px;white-space:nowrap">${n} <button class="sm alt" onclick="removePersonalNum(${n})">Remove</button></span>`).join('') : '<p class="err">No personal numbers yet.</p>'}
    <div class="row"><div><label for="pnc">How many numbers to add</label><input id="pnc" type="number" min="1" max="50" value="5"></div>
    <div><label for="pnn">Or one exact number (200 or more)</label><input id="pnn" type="number" min="200"></div></div>
    <button onclick="addPersonalNums()">Add numbers</button></div></section>` : ''}
  ${hasPermission('attendance') ? `<section class="${panel('pc-tools')}" role="tabpanel"><div class="card"><h2>Personal PC</h2>
    <p>Mark a student who is using their own PC. They will not pick a lab PC on that day.</p>
    <div class="row"><div><label for="pp">Student</label><select id="pp">${users().map(u => `<option value="${esc(u.sn)}">${esc(u.name)} (${esc(u.sn)})</option>`).join('')}</select></div>
    <div><label for="pd">Date</label><input id="pd" type="date" value="${ymd(new Date())}"></div>
    <div><label for="pg">Group</label><select id="pg"><option value="">(none)</option>${groups.map(g => `<option value="${esc(g)}">${esc(groupLabel(g))}</option>`).join('')}</select></div>
    <div><label for="pn">Personal PC number</label><select id="pn"><option value="">No number</option>${personalNums().map(n => `<option>${n}</option>`).join('')}</select></div></div>
    <button onclick="markPersonal()">Mark as personal PC</button>
    <h2 style="margin-top:20px">Using a personal PC this week</h2>
    ${personal.length ? `<div class="wrap"><table><tr><th>Date</th><th>Student</th><th>PC</th><th></th></tr>${personal.map(r =>
        `<tr><td>${r.date}</td><td>${esc(r.name)} (${esc(r.sn)})</td><td>${pcLabel(r)}</td><td><a href="#recordDetails" onclick="viewRecord(this.dataset.id); return false" data-id="${esc(r.id)}">View details</a></td></tr>`).join('')}</table></div>` : '<p>Nobody is marked this week.</p>'}</div></section>` : ''}
      <section class="${panel('staff')}" role="tabpanel">
      ${hasPermission('staff') ? `<div class="card"><h2>Staff roles</h2>
    <ul class="link-list">${st.admins.map(a => `<li data-user="${esc(a.user)}"><span><b>${esc(a.user)}</b> · ${a.role === 'staff' ? 'Staff' : 'Full admin'}</span><span>${a.role === 'staff' ? (a.permissions || []).map(key => esc(PERMISSIONS[key] || key)).join(', ') || 'No rights granted' : 'All rights'}${a.role === 'staff' && a.user !== session.user ? `<details><summary>Edit rights</summary>${Object.entries(PERMISSIONS).map(([key, label]) => `<label class="check"><input type="checkbox" name="editStaffPermission" value="${key}" ${(a.permissions || []).includes(key) ? 'checked' : ''}>${label}</label>`).join('')}<button class="sm" onclick="saveStaffPermissions(this)">Save rights</button></details><button class="sm alt" onclick="removeStaff('${esc(a.user)}')">Remove</button>` : ''}</span></li>`).join('')}</ul>
    <div class="row"><div><label for="staffUser">Username</label><input id="staffUser" autocapitalize="off"></div><div><label for="staffPassword">Temporary password (at least 6 characters)</label><input id="staffPassword" type="password"></div></div>
    <fieldset><legend>Granted rights</legend>${Object.entries(PERMISSIONS).filter(([key]) => key !== 'staff' || hasPermission('staff')).map(([key, label]) => `<label class="check"><input type="checkbox" name="staffPermission" value="${key}">${label}</label>`).join('')}</fieldset>
    <button onclick="addAdmin()">Add staff account</button></div>` : ''}
  <div class="card"><h2>Change my password</h2>
    <div class="row"><div><label for="np">New password (at least 6 characters)</label><input id="np" type="password"></div>
    <div><label for="np2">Type it again</label><input id="np2" type="password"></div></div>
    <button onclick="changeAdminPw()">Change password</button></div></section>
  ${hasPermission('students') ? `<section class="${panel('students')}" role="tabpanel"><div class="card"><h2>Students</h2>
    <p>Assign regular groups or, for Lab Personal PC students, a separate student type.</p>
    ${users().length ? `<ul>${users().map(u => `<li><a href="#studentDetails" onclick="viewStudent(this.dataset.sn); return false" data-sn="${esc(u.sn)}">${esc(u.name)} (${esc(u.sn)})</a> · ${esc(u.group ? groupLabel(u.group) : u.studentType || 'No group or type')}</li>`).join('')}</ul>${adminStudentDetails()}` : '<p>No students have signed up yet.</p>'}</div></section>` : ''}
  ${hasPermission('attendance') ? `<section class="${panel('exports')}" role="tabpanel"><div class="card"><h2>Exports</h2>
    <div class="row">
      <div><label for="rt">Report type</label><select id="rt" onchange="setRange()">
        <option value="week" ${range.type === 'week' ? 'selected' : ''}>Week (Mon to Fri)</option>
        <option value="month" ${range.type === 'month' ? 'selected' : ''}>Month</option></select></div>
      <div><label for="rv">${range.type === 'week' ? 'Any day in the week' : 'Month'}</label>
        <input id="rv" type="${range.type === 'week' ? 'date' : 'month'}" value="${range.type === 'week' ? range.value : range.value.slice(0, 7)}" onchange="setRange()"></div>
    </div>
    <button onclick="exportXlsx()">Download Excel</button><button onclick="exportPdf()">Download PDF</button>
    <p>${list.length} sign-in(s) in this ${range.type}. The download has the full list.</p>
    <h3>Group attendance register</h3>
    <div class="row"><div><label for="groupExport">Group</label><select id="groupExport">${groups.map(g => `<option value="${esc(g)}">${esc(groupLabel(g))}</option>`).join('')}</select></div></div>
    <button onclick="exportGroupPdf()" ${groups.length ? '' : 'disabled'}>Download group register PDF</button></div></section>` : ''}`;
}
  function setAdminTab(tabId) { adminTab = tabId; render(); }
let dayView = { date: ymd(new Date()), mode: 'group' };
function dayCard() {
  const recs = records().filter(r => r.date === dayView.date)
    .sort((a, b) => String(a.pc).localeCompare(String(b.pc), undefined, { numeric: true }));
  const pers = recs.filter(isP).length, names = (settings().groups || []).filter(g => !isLegacyPersonalGroup(g));
  recs.forEach(r => { if (r.group && !isLegacyPersonalGroup(r.group) && !names.includes(r.group)) names.push(r.group); });
  const cnt = g => recs.filter(r => r.group === g).length, nog = recs.filter(r => (!r.group || isLegacyPersonalGroup(r.group)) && !attendanceStudentType(r)), typed = recs.filter(r => attendanceStudentType(r));
  let body;
  if (dayView.mode === 'all') {
    body = `<h3>Group totals</h3><div class="wrap"><table><tr><th>Group</th><th>Signed in</th></tr>${names.map(g => `<tr><td>${esc(groupLabel(g))}</td><td>${cnt(g)}</td></tr>`).join('')}${nog.length ? `<tr><td>No group / student type</td><td>${nog.length}</td></tr>` : ''}<tr><th>All students</th><th>${recs.length}</th></tr></table></div>${typed.length ? `<h3>Student type totals</h3><div class="wrap"><table>${studentTypes().map(type => `<tr><td>${esc(type)}</td><td>${typed.filter(r => attendanceStudentType(r) === type).length}</td></tr>`).join('')}</table></div>` : ''}<h3>Whole list</h3>${table(recs, true)}`;
  } else if (!names.length) body = table(recs, true);
  else body = names.map(g => `<h3>${esc(groupLabel(g))} (${cnt(g)})</h3>${cnt(g) ? table(recs.filter(r => r.group === g), true) : '<p>Nobody yet.</p>'}`).join('') + studentTypes().filter(type => typed.some(r => attendanceStudentType(r) === type)).map(type => { const list = typed.filter(r => attendanceStudentType(r) === type); return `<h3>Student type: ${esc(type)} (${list.length})</h3>${table(list, true)}`; }).join('') + (nog.length ? `<h3>No group / student type (${nog.length})</h3>${table(nog.filter(r => !attendanceStudentType(r)), true)}` : '');
  return `<div class="card"><h2>Register for a day</h2>
    <div class="row"><div><label for="dd">Date</label><input id="dd" type="date" value="${dayView.date}" onchange="setDay()"></div>
    <div><label for="dm">View</label><select id="dm" onchange="setDay()"><option value="group" ${dayView.mode === 'group' ? 'selected' : ''}>By group</option><option value="all" ${dayView.mode === 'all' ? 'selected' : ''}>Whole list (with totals)</option></select></div></div>
    <button class="alt" onclick="dayToday()">Go to today</button>
    <p><b>${dayName(dayView.date)}, ${dayView.date}</b>: ${recs.length} signed in (${recs.length - pers} lab PCs, ${pers} personal PCs).${isWeekday(parse(dayView.date)) ? '' : ' The register is closed on weekends.'}</p>
    ${body}</div>`;
}
function setDay() { dayView.date = $('dd').value || ymd(new Date()); dayView.mode = $('dm').value; render(); }
function dayToday() { dayView.date = ymd(new Date()); render(); }
function setRange() {
  range.type = $('rt').value;
  const v = $('rv').value;
  range.value = v ? (v.length === 7 ? v + '-01' : v) : ymd(new Date());
  render();
}
const isAdmin = () => isStaff();
function saveTotal() {
  if (!hasPermission('settings')) return;
  const n = parseInt($('tp').value, 10), maxUsed = Math.max(0, ...records().filter(r => !isP(r)).map(r => +r.pc || 0));
  if (!n || n < 1) return say('Enter a valid number.');
  if (n >= 200) return say('Lab PCs must be under 200. Numbers from 200 are for personal PCs.');
  if (n < maxUsed) return say(`PC ${maxUsed} is already in the records. Number cannot be lower.`);
  saveSettings({ ...settings(), totalPCs: n }).then(() => say('Saved.', true), () => say('Could not save.'));
}
async function setLab() {
  if (!hasPermission('settings')) return;
  const radius = parseInt($('rad').value, 10);
  if (!radius || radius < 20) return say('Distance must be at least 20 metres.');
  try {
    const pos = await getPos();
    await saveSettings({ ...settings(), lab: { lat: pos.coords.latitude, lng: pos.coords.longitude, radius } });
    say(`Lab location saved (this device is accurate to about ${Math.round(pos.coords.accuracy)} m).`, true);
  } catch (e) { say(e.code ? geoMsg(e) : 'Could not save.'); }
}
function saveRadius() {
  if (!hasPermission('settings') || !settings().lab) return;
  const radius = parseInt($('rad').value, 10);
  if (!radius || radius < 20) return say('Distance must be at least 20 metres.');
  saveSettings({ ...settings(), lab: { ...settings().lab, radius } }).then(() => say('Distance saved.', true), () => say('Could not save.'));
}
const groupOpts = cur => {
  const g = (settings().groups || []).filter(x => !isLegacyPersonalGroup(x)), all = cur && !isLegacyPersonalGroup(cur) && !g.includes(cur) ? [...g, cur] : g;
  return all.map(x => `<option value="${esc(x)}" ${x === cur ? 'selected' : ''}>${esc(groupLabel(x))}</option>`).join('');
};
function assignGroup(i, group) {
  if (!hasPermission('students')) return;
  const u = users()[i];
  const personalPCProgram = !group && Boolean(u.personalPCProgram || isLegacyPersonalGroup(u.group));
  fs.collection('users').doc(u.sn).update({ group, groupLocked: true, personalPCProgram, studentType: group ? '' : (u.studentType || '') }).then(() => say(group ? `${esc(u.name)} is now in group ${esc(group)}.` : `${esc(u.name)} has no group now.`, true), () => say('Could not save.'));
}
function assignStudentType(i, type) {
  if (!hasPermission('students')) return;
  const u = users()[i], personalPCProgram = Boolean(type || u.personalPCProgram || isLegacyPersonalGroup(u.group));
  const group = personalPCProgram ? '' : (u.group || '');
  fs.collection('users').doc(u.sn).update({ group, studentType: type, personalPCProgram, groupLocked: true })
    .then(() => say(type ? `${esc(u.name)} is now classified as ${esc(type)}.` : `${esc(u.name)} student type cleared.`, true), () => say('Could not save.'));
}
function setGroupYear(i, year) {
  if (!hasPermission('groups')) return;
  const group = settings().groups[i], value = year.trim();
  if (value.length > 24) return say('Group year must be 24 characters or fewer.');
  const groupYears = { ...(settings().groupYears || {}) };
  if (value) groupYears[group] = value; else delete groupYears[group];
  saveSettings({ ...settings(), groupYears }).then(() => say(`Updated ${esc(groupLabel(group))}.`, true), () => say('Could not save group year.'));
}
function setGroupWhatsAppLink(i, value) {
  if (!hasPermission('groups')) return;
  const group = settings().groups[i], link = value.trim(), groupWhatsAppLinks = { ...(settings().groupWhatsAppLinks || {}) };
  if (link) {
    let parsed;
    try { parsed = new URL(link); } catch { return say('Enter a valid WhatsApp group invite link.'); }
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'chat.whatsapp.com') return say('Use a secure https://chat.whatsapp.com/ group invite link.');
    groupWhatsAppLinks[group] = parsed.href;
  } else delete groupWhatsAppLinks[group];
  saveSettings({ ...settings(), groupWhatsAppLinks }).then(() => say(link ? `WhatsApp link saved for ${esc(groupLabel(group))}.` : `WhatsApp link cleared for ${esc(groupLabel(group))}.`, true), () => say('Could not save WhatsApp link.'));
}
function addPersonalNums() {
  if (!hasPermission('settings')) return;
  const cur = personalNums(), one = parseInt($('pnn').value, 10), cnt = parseInt($('pnc').value, 10);
  let add = [];
  if ($('pnn').value) {
    if (!one || one < 200) return say('A personal number must be 200 or more.');
    if (cur.includes(one)) return say(`${one} is already in the list.`);
    add = [one];
  } else {
    if (!cnt || cnt < 1 || cnt > 50) return say('Add between 1 and 50 numbers.');
    const start = Math.max(199, ...cur) + 1;
    add = Array.from({ length: cnt }, (_, k) => start + k);
  }
  saveSettings({ ...settings(), personalPCs: [...cur, ...add] }).then(() => say(`Added: ${add.join(', ')}.`, true), () => say('Could not save.'));
}
function removePersonalNum(n) {
  if (!hasPermission('settings') || !confirm(`Remove personal number ${n}? Old sign-ins keep it.`)) return;
  saveSettings({ ...settings(), personalPCs: personalNums().filter(x => x !== n) }).then(() => render());
}
function addGroup() {
  if (!hasPermission('groups')) return;
  const g = $('gn').value.trim(), gr = settings().groups || [];
  if (!g) return say('Type a group name.');
  if (isLegacyPersonalGroup(g)) return say('Lab Personal PC is a student type category, not a group.');
  if (gr.some(x => x.toLowerCase() === g.toLowerCase())) return say('That group already exists.');
  saveSettings({ ...settings(), groups: [...gr, g] }).then(() => say('Group added.', true), () => say('Could not save.'));
}
function removeGroup(i) {
  if (!hasPermission('groups')) return;
  const gr = [...(settings().groups || [])];
  if (!confirm(`Remove group ${gr[i]}? Students and old sign-ins keep this name.`)) return;
  const groupYears = { ...(settings().groupYears || {}) };
  const groupWhatsAppLinks = { ...(settings().groupWhatsAppLinks || {}) };
  delete groupYears[gr[i]];
  delete groupWhatsAppLinks[gr[i]];
  gr.splice(i, 1); saveSettings({ ...settings(), groups: gr, groupYears, groupWhatsAppLinks }).then(() => render());
}
function removeLegacyPersonalGroup() {
  if (!hasPermission('groups')) return;
  const gr = (settings().groups || []).filter(g => !isLegacyPersonalGroup(g));
  const groupYears = { ...(settings().groupYears || {}) }, groupWhatsAppLinks = { ...(settings().groupWhatsAppLinks || {}) };
  Object.keys(groupYears).filter(isLegacyPersonalGroup).forEach(g => delete groupYears[g]);
  Object.keys(groupWhatsAppLinks).filter(isLegacyPersonalGroup).forEach(g => delete groupWhatsAppLinks[g]);
  saveSettings({ ...settings(), groups: gr, groupYears, groupWhatsAppLinks }).then(() => say('Lab Personal PC removed from the group list. Existing students will choose a student type.', true), () => say('Could not update groups.'));
}
function addStudentType() {
  if (!hasPermission('groups')) return;
  const type = $('newStudentType').value.trim(), types = studentTypes();
  if (!type) return say('Type a student type.');
  if (types.some(x => x.toLowerCase() === type.toLowerCase())) return say('That student type already exists.');
  saveSettings({ ...settings(), studentTypes: [...types, type] }).then(() => say('Student type added.', true), () => say('Could not save student type.'));
}
function removeStudentType(i) {
  if (!hasPermission('groups')) return;
  const type = studentTypes()[i];
  if (!type) return;
  if (studentTypes().length < 2) return say('Keep at least one student type.');
  if (users().some(u => u.studentType === type)) return say('Reassign students before removing this type.');
  saveSettings({ ...settings(), studentTypes: studentTypes().filter((_, index) => index !== i) }).then(() => say('Student type removed.', true), () => say('Could not remove student type.'));
}
async function markPersonal() {
  if (!hasPermission('attendance')) return;
  const sn = $('pp').value, date = $('pd').value, u = users().find(x => x.sn === sn);
  if (!u) return say('Choose a student.');
  const personalPCProgram = Boolean(u.personalPCProgram || isLegacyPersonalGroup(u.group)), group = personalPCProgram ? '' : $('pg').value || u.group || '', studentType = personalPCProgram ? u.studentType || '' : '';
  if (personalPCProgram && !studentType) return say('Assign a student type before marking this student present.');
  if (!date || !isWeekday(parse(date))) return say('Choose a day from Monday to Friday.');
  if (records().some(r => r.date === date && r.sn === sn)) return say('This student already has an attendance record on that day.');
  const num = parseInt($('pn').value, 10) || 0;
  if (num && taken(date, num)) return say(`Personal PC ${num} is already taken on that day.`);
  const t = new Date(), slotId = num ? `${date}_pc${num}` : '', rec = { id: `${slotId || `${date}_personal_${sn}`}_${t.getTime()}`, date, sn, name: u.name, group, groupYear: groupYearFor(group), studentType, signature: u.signature || '', signedAt: t.getTime(), pc: num || 'Personal', personal: true, time: `${pad(t.getHours())}:${pad(t.getMinutes())}` };
  const ref = fs.collection('records').doc(rec.id), studentDayRef = fs.collection('studentDays').doc(`${date}_${sn}`);
  try {
    const slotRef = num ? fs.collection('slots').doc(slotId) : null, legacyRef = num ? fs.collection('records').doc(slotId) : null;
    await fs.runTransaction(async tx => {
      const existing = await tx.get(ref), studentDay = await tx.get(studentDayRef);
      const slot = slotRef ? await tx.get(slotRef) : null, legacy = legacyRef ? await tx.get(legacyRef) : null;
      if (existing.exists || studentDay.exists || (slot && slot.exists) || (legacy && legacy.exists && !legacy.data().returnedAt)) throw new Error('taken');
      tx.set(ref, rec); tx.set(studentDayRef, { sn, date, recordId: rec.id });
      if (slotRef) tx.set(slotRef, { recordId: rec.id });
    });
    say(`${esc(u.name)} is marked as using a personal PC on ${date}.`, true);
  } catch (e) { say(e.message === 'taken' ? `Personal PC ${num} is already taken on that day.` : 'Could not save.'); }
}
async function addAdmin() {
  if (!hasPermission('staff')) return;
  const st = settings();
  const user = $('staffUser').value.trim().toLowerCase(), p = $('staffPassword').value;
  const permissions = [...document.querySelectorAll('input[name="staffPermission"]:checked')].map(input => input.value);
  if (!user) return say('Type a username for the staff account.');
  if (findAdmin(user) || users().some(x => x.sn.toLowerCase() === user)) return say('That username is already used.');
  if (p.length < 6) return say('Password must have at least 6 characters.');
  await saveSettings({ ...st, admins: [...st.admins, { user, pw: await hash(user + ':' + p), role: 'staff', permissions }] }); say('Staff account added.', true);
}
async function changeAdminPw() {
  if (!isStaff()) return;
  const a = $('np').value, b = $('np2').value, st = settings();
  if (a.length < 6) return say('Password must have at least 6 characters.');
  if (a !== b) return say('The two passwords do not match.');
  const admins = st.admins.map(x => x.user === session.user ? { ...x, pw: null } : x);
  const me = admins.find(x => x.user === session.user); me.pw = await hash(me.user + ':' + a);
  await saveSettings({ ...st, admins }); say('Admin password changed.', true);
}
async function resetStudent(i) {
  if (!hasPermission('students')) return;
  const x = users()[i];
  const v = prompt(`Type a new password for ${x.name} (${x.sn}), at least 6 characters. Then give it to the student:`);
  if (v === null) return;
  if (v.length < 6) return say('Password must have at least 6 characters.');
  await fs.collection('users').doc(x.sn).update({ pw: await hash(x.sn + ':' + v) }); say(`Password reset for ${esc(x.name)}.`, true);
}
async function deleteStudent(sn) {
  if (!hasPermission('students')) return;
  const student = users().find(u => u.sn === sn);
  if (!student || !confirm(`Delete ${student.name} (${student.sn})'s login and profile? Historical attendance records will be kept.`)) return;
  try {
    await fs.collection('users').doc(sn).delete();
    C.users = users().filter(u => u.sn !== sn);
    selectedStudentSn = '';
    say(`${esc(student.name)}'s login and profile were deleted. Attendance history was kept.`, true);
  } catch (e) { say('Could not delete the student profile.'); }
}
async function removeStaff(user) {
  if (!hasPermission('staff')) return;
  const target = settings().admins.find(a => a.user === user);
  if (!target || target.role !== 'staff' || user === session.user || !confirm(`Remove staff account ${user}?`)) return;
  await saveSettings({ ...settings(), admins: settings().admins.filter(a => a.user !== user) });
  say('Staff account removed.', true);
}
async function saveStaffPermissions(button) {
  if (!hasPermission('staff')) return;
  const item = button.closest('li'), user = item && item.dataset.user;
  if (!user || user === session.user) return;
  const permissions = [...item.querySelectorAll('input[name="editStaffPermission"]:checked')].map(input => input.value);
  const admins = settings().admins.map(account => account.user === user && account.role === 'staff' ? { ...account, permissions } : account);
  await saveSettings({ ...settings(), admins });
  say(`Updated rights for ${esc(user)}.`, true);
}
function table(list, admin) {
  if (!list.length) return '<p>No sign-ins yet.</p>';
  if (admin) return `<table><tr><th>Date</th><th>Student</th><th>Group / type</th><th>PC</th><th>Status</th><th></th></tr>` +
    list.map(r => `<tr><td>${r.date}</td><td>${esc(r.name)} (${esc(r.sn)})</td><td>${esc(attendanceCategory(r))}</td><td>${pcLabel(r)}</td><td>${r.returnedAt ? 'Returned' : isP(r) ? 'Personal PC' : 'Not returned'}</td><td><a href="#recordDetails" onclick="viewRecord(this.dataset.id); return false" data-id="${esc(r.id)}">View details</a></td></tr>`).join('') + '</table>';
  return `<table><tr><th>Date</th><th>Day</th><th>Student no.</th><th>Name</th><th>Group / type</th><th>PC</th><th>Signed in</th><th>Returned at</th><th>Signature</th>${admin ? '<th>Actions</th>' : ''}</tr>` +
    list.map(r => `<tr><td>${r.date}</td><td>${dayName(r.date)}</td><td>${esc(r.sn)}</td><td>${esc(r.name)}</td><td>${esc(attendanceCategory(r))}</td><td>${pcLabel(r)}</td><td>${r.time}</td><td>${r.returnedAt ? new Date(r.returnedAt).toLocaleString() : isP(r) ? 'Personal PC' : admin ? `<button class="sm" onclick="returnPc('${r.id}')">Record return</button>` : 'Checked out'}</td><td>${r.signature ? `<img src="${esc(r.signature)}" alt="Signature of ${esc(r.name)}" style="width:100px;height:36px;object-fit:contain">` : 'Not captured'}</td>` +
      (admin ? `<td>${isP(r) ? '' : `<button class="sm" onclick="editPc('${r.id}')">Change PC</button>`}<button class="sm alt" onclick="removeRec('${r.id}')">Remove</button></td>` : '') + '</tr>').join('') + '</table>';
}
async function returnPc(id) {
  if (!hasPermission('attendance')) return;
  const rec = records().find(x => x.id === id);
  if (!rec || rec.returnedAt || isP(rec) || !confirm(`Record that ${rec.name} returned PC ${rec.pc}?`)) return;
  const returnedAt = Date.now(), recRef = fs.collection('records').doc(id), slotRef = fs.collection('slots').doc(`${rec.date}_pc${rec.pc}`);
  try {
    await fs.runTransaction(async tx => {
      const record = await tx.get(recRef), slot = await tx.get(slotRef);
      if (!record.exists || record.data().returnedAt) throw new Error('returned');
      tx.update(recRef, { returnedAt, returnedBy: session.user });
      if (slot.exists && slot.data().recordId === id) tx.delete(slotRef);
    });
    say(`Return recorded at ${new Date(returnedAt).toLocaleTimeString()}.`, true);
  } catch (e) { say(e.message === 'returned' ? 'This PC has already been returned.' : 'Could not record the return.'); }
}
async function editPc(id) {
  if (!hasPermission('attendance')) return;
  const rec = records().find(x => x.id === id); if (!rec) return;
  const v = prompt(`New PC number for ${rec.name} (1 to ${settings().totalPCs}):`, rec.pc);
  if (v === null) return;
  const n = parseInt(v, 10);
  if (!n || n < 1 || n > settings().totalPCs) return say('That PC number does not exist.');
  if (n === rec.pc) return;
  const oref = fs.collection('records').doc(rec.id), oldSlot = fs.collection('slots').doc(`${rec.date}_pc${rec.pc}`), newSlot = fs.collection('slots').doc(`${rec.date}_pc${n}`), legacyRef = fs.collection('records').doc(`${rec.date}_pc${n}`);
  try {
    await fs.runTransaction(async tx => {
      const current = await tx.get(oref), targetSlot = await tx.get(newSlot), legacy = await tx.get(legacyRef), sourceSlot = await tx.get(oldSlot);
      if (!current.exists || targetSlot.exists && targetSlot.data().recordId !== id || legacy.exists && legacy.id !== id && !legacy.data().returnedAt) throw new Error('taken');
      tx.update(oref, { pc: n });
      if (!rec.returnedAt) {
        if (sourceSlot.exists && sourceSlot.data().recordId === id) tx.delete(oldSlot);
        tx.set(newSlot, { recordId: id });
      }
    });
    say('PC number changed.', true);
  } catch (e) { say(e.message === 'taken' ? `PC ${n} is already taken on that day.` : 'Could not save.'); }
}
async function removeRec(id) {
  if (!hasPermission('attendance') || !confirm('Remove this sign-in? The student will be able to pick a PC again.')) return;
  const rec = records().find(x => x.id === id);
  if (!rec) return;
  const recRef = fs.collection('records').doc(id), slotRef = fs.collection('slots').doc(`${rec.date}_pc${rec.pc}`), studentDayRef = fs.collection('studentDays').doc(`${rec.date}_${rec.sn}`);
  await fs.runTransaction(async tx => {
    const record = await tx.get(recRef), slot = await tx.get(slotRef), studentDay = await tx.get(studentDayRef);
    if (record.exists) tx.delete(recRef);
    if (slot.exists && slot.data().recordId === id) tx.delete(slotRef);
    if (studentDay.exists && studentDay.data().recordId === id) tx.delete(studentDayRef);
  });
  render();
}

/* ---------- Absence reports ---------- */
const STATUS = { pending: 'Waiting for the admin', approved: 'Approved', rejected: 'Rejected' };
function reportCard(r, admin) {
  const left = Math.max(1, Math.ceil((r.created + WEEK - Date.now()) / 864e5));
  const attachments = (r.attachments || []).map(f => `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a>${f.type && f.type.startsWith('image/') ? ` <img src="${esc(f.url)}" alt="${esc(f.name)}" style="display:block;max-width:220px;max-height:180px;margin-top:6px">` : ''}`).join('<br>');
  return `<div class="rep ${r.status}"><b>${esc(r.name)}</b> (${esc(r.sn)}): ${esc(r.type)} on ${r.date} (${dayName(r.date)})<br>${esc(r.reason)}<br>
    ${attachments ? `<p>Supporting documents:<br>${attachments}</p>` : ''}
    <small>Sent ${new Date(r.created).toLocaleString()}. Disappears in ${left} day(s).</small><br>
    <b>${STATUS[r.status]}</b>${r.note ? `. Admin note: ${esc(r.note)}` : ''}
    ${admin ? `<br><button class="sm" onclick="decide('${r.id}','approved')">Approve</button><button class="sm alt" onclick="decide('${r.id}','rejected')">Reject</button><button class="sm alt" onclick="delReport('${r.id}')">Delete</button>` : ''}</div>`;
}
function studentReports() {
  const mine = liveReports().filter(r => r.sn === session.sn).sort((a, b) => b.created - a.created);
  $('app').innerHTML = `
  <div class="card"><h2>Report absence</h2>
    <p>Tell the admin if you will be absent, late, or leaving early. Your report disappears after 7 days. You can send at most 2 reports a week (Monday to Sunday) and 3 a month.</p>
    <p id="quota"></p>
    <div class="row"><div><label for="rk">Type</label><select id="rk"><option>Absent</option><option>Late</option><option>Leaving early</option><option>Other</option></select></div>
    <div><label for="rd">Date</label><input id="rd" type="date" value="${ymd(new Date())}"></div></div>
    <label for="rr">Reason</label><textarea id="rr" rows="4" maxlength="500"></textarea>
    <label for="rf">Supporting documents (optional; images, PDF, or Word documents, up to 10 MB each)</label><input id="rf" type="file" accept="image/*,.pdf,.doc,.docx" multiple>
    <button onclick="sendReport()">Send report</button><div class="msg err">${msg}</div></div>
  <div class="card"><h2>My reports</h2>${mine.length ? mine.map(r => reportCard(r, false)).join('') : '<p>You have no reports.</p>'}</div>`;
  showQuota();
}
async function sendReport() {
  const type = $('rk').value, date = $('rd').value, reason = $('rr').value.trim();
  const files = [...$('rf').files];
  if (!date || !isWeekday(parse(date))) return say('Choose a day from Monday to Friday.');
  if (reason.length < 5) return say('Please write a reason (at least 5 characters).');
  if (files.some(file => !validUpload(file))) return say('Choose images, PDFs, or Word documents no larger than 10 MB each.');
  const now = Date.now(), id = `${session.sn}_${now}`;
  const logRef = fs.collection('reportlog').doc(session.sn), repRef = fs.collection('reports').doc(id);
  let attachments = [];
  try {
    for (const file of files) attachments.push(await uploadFile(`reports/${session.sn}/${id}`, file));
    await fs.runTransaction(async tx => {
      const d = await tx.get(logRef), times = d.exists ? d.data().times : [], u = usage(times, now);
      if (u.w >= LIMIT_WEEK) throw new Error('week');
      if (u.m >= LIMIT_MONTH) throw new Error('month');
      tx.set(logRef, { sn: session.sn, times: [...times.filter(x => x > now - 40 * 864e5), now] });
      tx.set(repRef, { id, sn: session.sn, name: session.name, type, date, reason, attachments, created: now, status: 'pending', note: '' });
    });
    say('Report sent. The admin will approve or reject it.', true);
  } catch (e) {
    await Promise.all(attachments.map(f => storage.ref(f.path).delete().catch(() => {})));
    say(e.message === 'week' ? `You already sent ${LIMIT_WEEK} reports this week. You can send again from next Monday.`
      : e.message === 'month' ? `You already sent ${LIMIT_MONTH} reports this month. You can send again next month.`
      : 'Could not send. Check your internet.');
  }
}
const LIMIT_WEEK = 2, LIMIT_MONTH = 3;
const weekStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); };
const monthStart = t => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };
const usage = (times, now) => ({ w: times.filter(x => x >= weekStart(now)).length, m: times.filter(x => x >= monthStart(now)).length });
async function showQuota() {
  try {
    const d = await fs.collection('reportlog').doc(session.sn).get(), u = usage(d.exists ? d.data().times : [], Date.now()), el = $('quota');
    if (el) el.textContent = `Reports sent this week: ${u.w} of ${LIMIT_WEEK}. This month: ${u.m} of ${LIMIT_MONTH}.`;
  } catch (e) {}
}
function adminReports() {
  const list = [...liveReports()].sort((a, b) => b.created - a.created);
  const files = studentSubmittedFiles().filter(file => hasPermission('updates') || file.kind === 'Absence report');
  $('app').innerHTML = `<div class="msg err">${msg}</div><div class="card"><h2>Absence reports</h2>
    <p>Reports disappear by themselves 7 days after they are sent. Approve or reject each one based on the reason.</p>
    ${list.length ? list.map(r => reportCard(r, true)).join('') : '<p>No reports.</p>'}</div>
    <div class="card"><h2>Files submitted by students</h2>
      <p>${files.length} file(s), including absence-report documents and ZIP replies.</p>
      ${hasPermission('updates') ? `<button id="downloadAllStudentFiles" onclick="downloadAllStudentFiles()" ${files.length && !uploadBusy ? '' : 'disabled'}>Download all as ZIP</button>` : ''}
      <div id="studentFilesProgress" class="download-progress" aria-live="polite"></div>
      ${files.length ? files.map(file => `<div class="rep"><b>${esc(file.studentName)}</b> (${esc(file.sn)}) · ${esc(file.kind)} · ${esc(file.date)}<br><a href="${esc(file.url)}" target="_blank" rel="noopener noreferrer">Open / download ${esc(file.name)}</a>${file.size ? ` (${(file.size / 1048576).toFixed(1)} MB)` : ''}</div>`).join('') : '<p>No student files submitted.</p>'}
    </div>`;
}
function studentSubmittedFiles() {
  const reports = C.reports.flatMap(report => (report.attachments || []).map((file, index) => ({
    id: `${report.id}_attachment_${index}`, name: file.name, url: file.url, path: file.path, size: file.size || 0,
    studentName: report.name, sn: report.sn, date: report.date || ymd(new Date(report.created)), kind: 'Absence report'
  })));
  const replies = C.zipReplies.map(reply => ({
    id: reply.id, name: reply.file.name, url: reply.file.url, path: reply.file.path, size: reply.file.size || 0,
    studentName: reply.name, sn: reply.sn, date: ymd(new Date(reply.created)), kind: 'Student ZIP'
  }));
  return [...reports, ...replies].filter(file => file.url);
}
const archiveName = value => String(value || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 100);
async function downloadAllStudentFiles() {
  if (!hasPermission('updates') || uploadBusy) return;
  const files = studentSubmittedFiles(), status = $('studentFilesProgress'), button = $('downloadAllStudentFiles');
  if (!files.length) { status.textContent = 'No student files to download.'; return; }
  if (typeof JSZip === 'undefined') { status.textContent = 'The ZIP library did not load. Check your internet and try again.'; return; }
  const zip = new JSZip();
  uploadBusy = true; button.disabled = true;
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      status.textContent = `Downloading ${i + 1} of ${files.length}: ${file.name}`;
      const response = await fetch(file.url);
      if (!response.ok) throw new Error(`Download failed for ${file.name}`);
      const folder = `${archiveName(file.kind)}/${archiveName(`${file.studentName}_${file.sn}`)}`;
      zip.file(`${folder}/${archiveName(`${file.date}_${file.id}_${file.name}`)}`, await response.blob());
    }
    status.textContent = 'Building the combined ZIP archive...';
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, update => {
      status.textContent = `Building archive: ${Math.round(update.percent)}%`;
    });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `student-submissions-${ymd(new Date())}.zip`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    status.textContent = `Downloaded ${files.length} student file(s).`;
  } catch (e) {
    status.textContent = 'Could not package files. Check Firebase Storage access and CORS settings, then use the individual download links.';
  } finally { uploadBusy = false; button.disabled = false; }
}

/* ---------- Announcements and group documents ---------- */
const MAX_UPLOAD = 10 * 1024 * 1024;
const MAX_ZIP_UPLOAD = 300 * 1024 * 1024;
async function isZipUpload(file) {
  if (!file || file.size > MAX_ZIP_UPLOAD || !file.name.toLowerCase().endsWith('.zip')) return false;
  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return bytes.length === 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2]) && [0x04, 0x06, 0x08].includes(bytes[3]);
}
async function uploadZipFile(path, file, onProgress) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const ref = storage.ref(`${path}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`);
  const task = ref.put(file);
  await new Promise((resolve, reject) => task.on('state_changed', snap => onProgress(snap.bytesTransferred, snap.totalBytes), reject, resolve));
  return { name: file.name, type: 'application/zip', path: ref.fullPath, url: await ref.getDownloadURL(), size: file.size };
}
function validUpload(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  return file.size <= MAX_UPLOAD && (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'heif', 'pdf', 'doc', 'docx'].includes(ext));
}
async function validUpdateFile(file) {
  return file.name.toLowerCase().endsWith('.zip') ? isZipUpload(file) : validUpload(file);
}
async function uploadFile(path, file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const ref = storage.ref(`${path}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`);
  await ref.put(file);
  return { name: file.name, type: file.type || '', path: ref.fullPath, url: await ref.getDownloadURL(), size: file.size };
}
function updateCard(item, admin) {
  const fileLinks = (item.files || []).map(f => `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a>${f.size ? ` (${(f.size / 1048576).toFixed(1)} MB)` : ''}`).join('<br>');
  return `<div class="rep"><b>${esc(item.title)}</b> <small>${esc(item.group ? groupLabel(item.group) : 'All students')} · ${new Date(item.created).toLocaleString()}</small>
    ${item.message ? `<p>${esc(item.message).replace(/\n/g, '<br>')}</p>` : ''}${fileLinks ? `<p>${fileLinks}</p>` : ''}
    ${admin ? `<button class="sm alt" onclick="deleteUpdate('${item.id}')">Delete</button>` : ''}</div>`;
}
function zipReplyCard(reply) {
  const groupText = reply.studentType ? `Student type: ${reply.studentType}` : reply.group ? groupLabel(reply.group, reply.groupYear) : 'No group assigned';
  return `<div class="rep"><b>${esc(reply.name)}</b> (${esc(reply.sn)}) · ${esc(groupText)}<br>
    <a href="${esc(reply.file.url)}" target="_blank" rel="noopener">${esc(reply.file.name)}</a> (${(reply.file.size / 1048576).toFixed(1)} MB)<br>
    <small>Received ${new Date(reply.created).toLocaleString()}</small>${hasPermission('updates') ? `<br><button class="sm alt" onclick="deleteZipReply('${reply.id}')">Delete</button>` : ''}</div>`;
}
function updatesView(staff) {
  const canManage = staff && hasPermission('updates');
  const group = assignedGroup();
  const replies = C.zipReplies.slice().sort((a, b) => b.created - a.created);
  const visible = C.updates.filter(x => staff || !x.group || x.group === 'All students' || x.group === group)
    .sort((a, b) => b.created - a.created);
  $('app').innerHTML = `${canManage ? `<div class="card"><h2>Share with students</h2>
    <label for="ut">Title</label><input id="ut" maxlength="120">
    <label for="um">Announcement</label><textarea id="um" rows="4" maxlength="2000"></textarea>
    <label for="ug">Send to</label><select id="ug"><option value="All students">All students (every group)</option>${(settings().groups || []).filter(g => !isLegacyPersonalGroup(g)).map(g => `<option value="${esc(g)}">${esc(groupLabel(g))}</option>`).join('')}</select>
    <label for="uf">Attach files (images/documents up to 10 MB each, or ZIP up to 300 MB)</label><input id="uf" type="file" accept="image/*,.pdf,.doc,.docx,.zip,application/zip,application/x-zip-compressed" multiple>
    <button id="publishUpdateBtn" onclick="publishUpdate()">Publish</button><div id="uploadStatus" class="msg"></div><div class="msg err">${msg}</div></div>` : `<div class="card"><h2>Send a ZIP to the admin</h2>
    <p>Send one ZIP file, up to 300 MB. The admin will see your name and group or student type.</p>
    <label for="studentZip">ZIP file</label><input id="studentZip" type="file" accept=".zip,application/zip,application/x-zip-compressed">
    <button id="sendZipBtn" onclick="sendZipReply()">Send ZIP</button><div id="uploadStatus" class="msg"></div><div class="msg err">${msg}</div></div>`}
    <div class="card"><h2>${staff ? 'Published updates' : 'Announcements and documents'}</h2>${updatesError ? `<p class="err">${esc(updatesError)}</p>` : ''}${visible.length ? visible.map(x => updateCard(x, canManage)).join('') : '<p>No updates yet.</p>'}</div>`;
  if (canManage) $('app').insertAdjacentHTML('beforeend', `<div class="card"><h2>ZIP files from students</h2>${zipRepliesError ? `<p class="err">${esc(zipRepliesError)}</p>` : ''}${replies.length ? replies.map(zipReplyCard).join('') : '<p>No ZIP files received.</p>'}</div>`);
}
async function publishUpdate() {
  if (!hasPermission('updates') || uploadBusy) return;
  const title = $('ut').value.trim(), message = $('um').value.trim(), group = $('ug').value, filesToUpload = [...$('uf').files];
  if (!title) return say('Add a title.');
  if (!message && !filesToUpload.length) return say('Add an announcement or attach a document.');
  if (!(await Promise.all(filesToUpload.map(validUpdateFile))).every(Boolean)) return say('Choose valid images/documents up to 10 MB or ZIP files up to 300 MB.');
  const id = `update_${Date.now()}`;
  const files = [];
  uploadBusy = true;
  $('publishUpdateBtn').disabled = true;
  const status = $('uploadStatus');
  try {
    for (const file of filesToUpload) {
      if (file.name.toLowerCase().endsWith('.zip')) {
        files.push(await uploadZipFile(`updates/${id}`, file, (sent, total) => { status.textContent = `Uploading ${file.name}: ${Math.round(sent * 100 / total)}%`; }));
      } else files.push(await uploadFile(`updates/${id}`, file));
    }
    await fs.collection('updates').doc(id).set({ id, title, message, group, files, created: Date.now(), createdBy: session.user });
    msg = ''; render();
  } catch (e) {
    await Promise.all(files.map(f => storage.ref(f.path).delete().catch(() => {})));
    say('Could not publish. Check Firebase Storage is enabled and try again.');
  } finally { uploadBusy = false; }
}
async function sendZipReply() {
  if (!session || session.role !== 'student' || uploadBusy) return;
  const file = $('studentZip').files[0], status = $('uploadStatus');
  if (!file) return say('Choose a ZIP file first.');
  if (!(await isZipUpload(file))) return say('Choose a valid ZIP file no larger than 300 MB.');
  const profile = studentProfile(), id = `${session.sn}_${Date.now()}`;
  let uploaded = null;
  uploadBusy = true;
  $('sendZipBtn').disabled = true;
  try {
    uploaded = await uploadZipFile(`zipReplies/${id}`, file, (sent, total) => { status.textContent = `Uploading ${file.name}: ${Math.round(sent * 100 / total)}%`; });
    const reply = { id, sn: session.sn, name: session.name, group: isLegacyPersonalGroup(profile.group) ? '' : (profile.group || ''), groupYear: groupYearFor(profile.group), studentType: profile.studentType || '', personalPCProgram: Boolean(profile.personalPCProgram || isLegacyPersonalGroup(profile.group)), file: uploaded, created: Date.now() };
    await fs.collection('zipReplies').doc(id).set(reply);
    msg = ''; render();
  } catch (e) {
    if (uploaded) await storage.ref(uploaded.path).delete().catch(() => {});
    say('Could not send the ZIP. Check Firebase Storage and Firestore rules, then try again.');
  } finally { uploadBusy = false; }
}
async function deleteZipReply(id) {
  if (!hasPermission('updates') || !confirm('Delete this student ZIP and its stored file?')) return;
  const reply = C.zipReplies.find(x => x.id === id);
  try {
    await fs.collection('zipReplies').doc(id).delete();
    if (reply && reply.file && reply.file.path) await storage.ref(reply.file.path).delete().catch(() => {});
  } catch (e) { say('Could not delete the ZIP reply.'); }
  render();
}
async function deleteUpdate(id) {
  if (!hasPermission('updates') || !confirm('Delete this update?')) return;
  const item = C.updates.find(x => x.id === id);
  try {
    await fs.collection('updates').doc(id).delete();
    await Promise.all((item && item.files || []).map(f => storage.ref(f.path).delete().catch(() => {})));
  } catch (e) { say('Could not delete the update.'); }
}
async function decide(id, status) {
  if (!hasPermission('reports')) return;
  const note = prompt(status === 'approved' ? 'Note for the student (optional):' : 'Why is it rejected? (optional note for the student):', '');
  if (note === null) return;
  await fs.collection('reports').doc(id).update({ status, note: note.trim(), decidedBy: session.user });
}
async function delReport(id) {
  if (!hasPermission('reports') || !confirm('Delete this report?')) return;
  await fs.collection('reports').doc(id).delete();
}

/* ---------- Downloads ---------- */
function reportName() {
  if (range.type === 'week') { const m = mondayOf(range.value), f = new Date(m); f.setDate(m.getDate() + 4); return `WM-LPR-week-${ymd(m)}-to-${ymd(f)}`; }
  return `WM-LPR-month-${range.value.slice(0, 7)}`;
}
const rows = () => inRange().map(r => [r.date, dayName(r.date), r.sn, r.name, attendanceCategory(r), pcLabel(r), r.time, r.returnedAt ? new Date(r.returnedAt).toLocaleString() : (isP(r) ? 'Personal PC' : 'Not returned'), r.signature ? 'Captured' : 'Not captured']);
const HEAD = ['Date', 'Day', 'Student no.', 'Name', 'Group / type', 'PC', 'Signed in', 'Returned at', 'Signature'];
function exportXlsx() {
  if (!hasPermission('attendance')) return;
  const ws = XLSX.utils.aoa_to_sheet([HEAD, ...rows()]);
  ws['!cols'] = [{wch:12},{wch:11},{wch:14},{wch:26},{wch:20},{wch:12},{wch:12},{wch:22},{wch:16}];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Register');
  XLSX.writeFile(wb, reportName() + '.xlsx');
}
function exportPdf() {
  if (!hasPermission('attendance')) return;
  const doc = new jspdf.jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14); doc.text('WM-LPR: ' + reportName().replace('WM-LPR-', ''), 14, 16);
  doc.autoTable({ head: [HEAD], body: rows(), startY: 22, styles: { fontSize: 9 } });
  doc.save(reportName() + '.pdf');
}
function exportGroupPdf() {
  if (!hasPermission('attendance')) return;
  const group = $('groupExport').value, groupRows = inRange().filter(r => r.group === group);
  const doc = new jspdf.jsPDF({ orientation: 'landscape' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(groupLabel(group), 14, 15);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text('Attendance register: ' + reportName().replace('WM-LPR-', ''), 14, 22);
  doc.autoTable({
    head: [['Date', 'Day', 'Student no.', 'Name', 'PC', 'Signed in', 'Returned at', 'Signature']],
    body: groupRows.map(r => [r.date, dayName(r.date), r.sn, r.name, pcLabel(r), r.time, r.returnedAt ? new Date(r.returnedAt).toLocaleString() : (isP(r) ? 'Personal PC' : 'Not returned'), '']),
    startY: 28,
    styles: { fontSize: 8, minCellHeight: 18 },
    columnStyles: { 7: { cellWidth: 40 } },
    didDrawCell(data) {
      if (data.section !== 'body' || data.column.index !== 7) return;
      const signature = groupRows[data.row.index].signature;
      if (signature) doc.addImage(signature, 'PNG', data.cell.x + 1, data.cell.y + 2, 34, 13);
    }
  });
  const filename = groupLabel(group).replace(/[^a-z0-9_-]+/gi, '-');
  doc.save(`${filename}-${reportName()}.pdf`);
}

start();
