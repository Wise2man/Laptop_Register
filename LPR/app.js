
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
const PERMISSIONS = { attendance: 'Manage attendance', students: 'Manage student accounts', groups: 'Manage groups', settings: 'Change lab and PC settings', reports: 'Review absence reports', updates: 'Publish updates and manage student files', staff: 'Create and manage staff roles', redflags: 'View red flag and other absence lists', redflagsManage: 'Remove or restore red flags and remove students from the red flag list', redflagRules: 'Change red flag rules (absence limit, deduction, days off)' };
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
  startRecords();
  fs.collection('reports').onSnapshot(q => {
    C.reports = q.docs.map(d => d.data());
    C.reports.filter(x => Date.now() - x.created > WEEK).forEach(x => fs.collection('reports').doc(x.id).delete().catch(() => {}));
    loaded.p = 1; refresh();
  }, fail);
  fs.collection('updates').onSnapshot(q => { C.updates = q.docs.map(d => d.data()); updatesError = ''; refresh(); }, () => { updatesError = 'Updates are unavailable. Check Firestore rules.'; refresh(); });
  fs.collection('zipReplies').onSnapshot(q => { C.zipReplies = q.docs.map(d => d.data()); zipRepliesError = ''; refresh(); }, () => { zipRepliesError = 'ZIP replies are unavailable. Check Firestore rules.'; refresh(); });
}
/* Saves Firestore reads: a student only loads today's records and their own records. Admin and staff load everything. */
let recordUnsubs = [], recordParts = {};
function startRecords() {
  recordUnsubs.forEach(stop => stop()); recordUnsubs = []; recordParts = {};
  if (!fs) return;
  if (!session) { C.records = []; loaded.r = 1; return; }
  loaded.r = 0;
  const col = fs.collection('records');
  const merge = () => { const all = new Map(); Object.values(recordParts).flat().forEach(r => all.set(r.id, r)); C.records = [...all.values()]; loaded.r = 1; refresh(); };
  const grab = (key, query) => recordUnsubs.push(query.onSnapshot(q => { recordParts[key] = q.docs.map(d => ({ ...d.data(), id: d.data().id || d.id })); merge(); }, fail));
  if (session.role === 'student') { grab('today', col.where('date', '==', ymd(new Date()))); grab('mine', col.where('sn', '==', session.sn)); }
  else grab('all', col);
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
  const signedInAccount = session.role === 'student' ? studentProfile() : settings().admins.find(account => account.user === session.user);
  if (session.mustChangePassword || signedInAccount && signedInAccount.mustChangePassword) {
    session.mustChangePassword = true; keepSession();
    return forcedPasswordView();
  }
  if (session.role === 'student' && needsStudentProfileCompletion(studentProfile())) return studentProfileCompletionView();
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
      <label for="firstName">First name</label><input id="firstName" autocomplete="given-name">
      <label for="surname">Surname</label><input id="surname" autocomplete="family-name">
      <label for="s">Student number (exactly 13 digits)</label><input id="s" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="13" oninput="this.value=this.value.replace(/\\D/g,'').slice(0,13)">
      <label for="p">Password (at least 6 characters)</label><input id="p" type="password">
      <label for="signature">Write your signature</label><canvas id="signature" class="signature-pad" width="560" height="150" aria-label="Signature drawing area"></canvas>
      <button type="button" class="alt" onclick="clearSignature()">Clear signature</button>
      <button onclick="signup()">Create account</button>` :
    tab === 'login' ? `
      <label for="s">Student number (13 digits) or admin username (numeric admin IDs: 9 or 13 digits)</label><input id="s" autocapitalize="off">
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
  } catch (e) { $('signatureMessage').textContent = saveFail(e, 'save your signature'); }
}
const setTab = t => { tab = t; msg = ''; render(); };
/* Firestore daily limits reset at midnight Pacific time. This works out that moment in the user's own clock. */
function quotaResetInfo(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now).map(x => [x.type, x.value]));
  const secs = (Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  const reset = new Date(now.getTime() + (86400 - secs) * 1000), mins = Math.ceil((reset - now) / 60000);
  const clock = reset.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const day = reset.toDateString() === now.toDateString() ? 'today' : 'tomorrow';
  const wait = mins >= 60 ? `${Math.floor(mins / 60)} hour(s) ${mins % 60} minute(s)` : `${mins} minute(s)`;
  return { clock, day, wait };
}
function saveFail(e, what = 'save') {
  console.error('Save failed:', e);
  const code = (e && e.code) || '', text = (e && e.message) || '';
  if (code === 'resource-exhausted') { const r = quotaResetInfo(); return `Please try again at ${r.clock} ${r.day}.`; }
  if (code === 'permission-denied') return `Could not ${what}: the database refused it (permission-denied). This is not your internet. The admin must check the Firebase rules (Firestore Database > Rules), because they may have expired.`;
  if (code === 'unavailable' || code === 'deadline-exceeded') return `Could not ${what}: cannot reach the database right now (${code}). Check your internet and try again.`;
  if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') return `Could not ${what}: file storage refused the upload (${code}). This is not your internet. The admin must check the Firebase rules (Storage > Rules), because they may have expired.`;
  if (code === 'storage/quota-exceeded') return `Could not ${what}: the file storage is full (${code}). Please tell the admin.`;
  if (code === 'storage/retry-limit-exceeded' || code === 'storage/canceled') return `Could not ${what}: the upload took too long (${code}). Check your internet, or try a smaller file.`;
  if (code === 'storage/bucket-not-found' || code === 'storage/project-not-found' || code === 'storage/invalid-argument') return `Could not ${what}: file storage is not set up correctly (${code}). Please tell the admin.`;
  if (!code && /reading 'ref'|storage is (null|not)/i.test(text)) return `Could not ${what}: file storage did not load. Check your internet, refresh the page and try again.`;
  if (code === 'not-found') return `Could not ${what}: your account was not found in the database (not-found). Please ask an admin.`;
  return `Could not ${what} (${code || text || 'unknown error'}). If this keeps happening, send this message to the admin.`;
}
const say = (m, ok) => { msg = ok ? `<span class="good">${m}</span>` : m; render(); };

async function signup() {
  const firstName = $('firstName').value.trim(), surname = $('surname').value.trim(), name = `${firstName} ${surname}`.trim();
  const sn = $('s').value.trim(), p = $('p').value;
  const signature = signatureDrawn ? $('signature').toDataURL('image/png') : '';
  if (!firstName || !surname) return say('Please enter both your first name and surname.');
  if (!/^\d{13}$/.test(sn)) return say('Student number must contain exactly 13 digits.');
  if (!signature) return say('Please write your signature before creating the account.');
  if (findAdmin(sn)) return say('This student number is not allowed.');
  if (p.length < 6) return say('Password must have at least 6 characters.');
  try {
    const ref = fs.collection('users').doc(sn);
    const account = { name, firstName, surname, sn, pw: await hash(sn + ':' + p), signature };
    let exists = false;
    await fs.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (current.exists) { exists = true; return; }
      tx.set(ref, account);
    });
    if (exists) return say('This student number already has an account. Please log in.');
    tab = 'login'; say('Account created. You can log in now.', true);
  } catch (e) { say(saveFail(e, 'create the account')); }
}
async function login() {
  const raw = $('s').value.trim(), p = $('p').value, ad = findAdmin(raw);
  if (ad) {
    if (/^\d+$/.test(raw) && !/^(?:\d{9}|\d{13})$/.test(raw)) return say('Admin number must contain 9 or 13 digits.');
    if (ad.pw !== await hash(ad.user + ':' + p)) return say('Wrong admin password.');
    session = { role: ad.role === 'staff' ? 'staff' : 'admin', name: ad.user, user: ad.user, mustChangePassword: Boolean(ad.mustChangePassword) };
  } else {
    const sn = raw.toUpperCase(), u = users().find(x => x.sn === sn);
    if (!u) return say(/^\d+$/.test(sn) && sn.length !== 13 ? 'Student number must contain exactly 13 digits.' : 'Wrong username or password.');
    if (u.pw !== await hash(`${u.passwordKey || sn}:${p}`)) return say('Wrong username or password.');
    session = { role: 'student', sn, name: u.name, mustChangePassword: Boolean(u.mustChangePassword) };
  }
  myGroup = ''; myStudentType = ''; signatureMessage = ''; keepSession(); msg = ''; startRecords(); render();
}
function studentNameParts(profile) {
  const words = String(profile.name || '').trim().split(/\s+/).filter(Boolean);
  const storedFirst = String(profile.firstName || '').trim(), storedSurname = String(profile.surname || '').trim();
  let firstName = storedFirst, surname = storedSurname;
  if (!firstName && !surname) {
    firstName = words.length > 1 ? words.slice(0, -1).join(' ') : words[0] || '';
    surname = words.length > 1 ? words[words.length - 1] : '';
  } else if (firstName && !surname) {
    const firstWords = firstName.split(/\s+/);
    if (words.length > firstWords.length && firstWords.every((word, index) => word.toLowerCase() === words[index].toLowerCase())) surname = words.slice(firstWords.length).join(' ');
  } else if (!firstName && surname) {
    const surnameWords = surname.split(/\s+/), start = words.length - surnameWords.length;
    if (start > 0 && surnameWords.every((word, index) => word.toLowerCase() === words[start + index].toLowerCase())) firstName = words.slice(0, start).join(' ');
  }
  return { firstName, surname };
}
function needsStudentProfileCompletion(profile) {
  const parts = studentNameParts(profile);
  return !/^\d{13}$/.test(String(profile.sn || '')) || !parts.firstName || !parts.surname;
}
function studentProfileCompletionView() {
  const profile = studentProfile(), parts = studentNameParts(profile);
  $('nav').innerHTML = '';
  $('app').innerHTML = `<div class="card"><h2>Complete your student details</h2>
    <p>Student numbers must contain 13 digits. Enter your first name and surname separately.</p>
    <label for="profileStudentNumber">Student number (13 digits)</label><input id="profileStudentNumber" value="${esc(profile.sn)}" inputmode="numeric" maxlength="13" oninput="this.value=this.value.replace(/\\D/g,'').slice(0,13)">
    <label for="profileFirstName">First name</label><input id="profileFirstName" value="${esc(parts.firstName)}" autocomplete="given-name" ${parts.firstName ? 'readonly' : ''}>
    <label for="profileSurname">Surname</label><input id="profileSurname" value="${esc(parts.surname)}" autocomplete="family-name" ${parts.surname ? 'readonly' : ''}>
    <button onclick="completeStudentProfile()">Save student details</button><div class="msg err">${esc(msg)}</div></div>`;
}
async function completeStudentProfile() {
  if (!session || session.role !== 'student') return;
  const profile = studentProfile(), oldSn = profile.sn, sn = $('profileStudentNumber').value.trim();
  const { firstName, surname } = studentNameParts({ firstName: $('profileFirstName').value.trim(), surname: $('profileSurname').value.trim() });
  if (!/^\d{13}$/.test(sn)) return say('Student number must contain exactly 13 digits.');
  if (!firstName || !surname) return say('Please enter both your first name and surname.');
  if (findAdmin(sn)) return say('That student number is used by an admin account. Contact an admin.');
  if (users().some(user => user.sn === sn && user.sn !== oldSn)) return say('That student number is already in use. Contact an admin.');
  try {
    const updatedProfile = await migrateStudentIdentity(profile, sn, firstName, surname);
    session.sn = sn; session.name = updatedProfile.name; keepSession(); msg = ''; render();
  } catch (e) { say(e.message === 'duplicate' ? 'That student number already has an account.' : 'Could not update your student details. Contact an admin.'); }
}
async function migrateStudentIdentity(profile, newSn, firstName, surname) {
  const oldSn = profile.sn, name = `${firstName} ${surname}`.trim(), operations = [];
  const updateMatching = (collection, items) => items.filter(item => item.sn === oldSn && item.id)
    .forEach(item => operations.push({ kind: 'update', ref: fs.collection(collection).doc(item.id), data: { sn: newSn, name } }));
  updateMatching('records', C.records);
  updateMatching('reports', C.reports);
  updateMatching('zipReplies', C.zipReplies);

  if (oldSn !== newSn) {
    const dailyDocs = await fs.collection('studentDays').where('sn', '==', oldSn).get();
    for (const dailyDoc of dailyDocs.docs) {
      const data = dailyDoc.data(), newId = `${data.date}_${newSn}`, newRef = fs.collection('studentDays').doc(newId);
      if (newId !== dailyDoc.id) {
        if ((await newRef.get()).exists) throw new Error('duplicate');
        operations.push({ kind: 'set', ref: newRef, data: { ...data, sn: newSn } });
        operations.push({ kind: 'delete', ref: dailyDoc.ref });
      }
    }
    const oldLogRef = fs.collection('reportlog').doc(oldSn), newLogRef = fs.collection('reportlog').doc(newSn);
    const [oldLog, newLog] = await Promise.all([oldLogRef.get(), newLogRef.get()]);
    if (oldLog.exists) {
      const times = [...new Set([...(newLog.exists ? newLog.data().times || [] : []), ...(oldLog.data().times || [])])].sort((a, b) => a - b);
      operations.push({ kind: 'set', ref: newLogRef, data: { ...(newLog.exists ? newLog.data() : {}), ...oldLog.data(), sn: newSn, times } });
      operations.push({ kind: 'delete', ref: oldLogRef });
    }
  }

  for (let offset = 0; offset < operations.length; offset += 400) {
    const batch = fs.batch();
    for (const operation of operations.slice(offset, offset + 400)) {
      if (operation.kind === 'update') batch.update(operation.ref, operation.data);
      else if (operation.kind === 'set') batch.set(operation.ref, operation.data);
      else batch.delete(operation.ref);
    }
    await batch.commit();
  }

  const account = { ...profile, sn: newSn, name, firstName, surname };
  if (oldSn !== newSn) account.passwordKey = profile.passwordKey || oldSn;
  const accountBatch = fs.batch(), newAccountRef = fs.collection('users').doc(newSn);
  accountBatch.set(newAccountRef, account);
  if (oldSn !== newSn) accountBatch.delete(fs.collection('users').doc(oldSn));
  await accountBatch.commit();

  const updateIdentity = list => list.map(item => item.sn === oldSn ? { ...item, sn: newSn, name } : item);
  C.records = updateIdentity(C.records);
  C.reports = updateIdentity(C.reports);
  C.zipReplies = updateIdentity(C.zipReplies);
  C.users = [...C.users.filter(user => user.sn !== oldSn), account];
  return account;
}
function forcedPasswordView() {
  $('nav').innerHTML = '';
  $('app').innerHTML = `<div class="card"><h2>Create a new password</h2>
    <p>Your administrator reset your password. Choose a new one to continue.</p>
    <label for="requiredPassword">New password (at least 6 characters)</label><input id="requiredPassword" type="password" autocomplete="new-password">
    <label for="requiredPasswordAgain">Type it again</label><input id="requiredPasswordAgain" type="password" autocomplete="new-password">
    <button onclick="completeForcedPasswordChange()">Save new password</button><div id="passwordError" class="msg err">${esc(msg)}</div></div>`;
}
async function completeForcedPasswordChange() {
  if (!session || !session.mustChangePassword) return;
  const password = $('requiredPassword').value, confirmation = $('requiredPasswordAgain').value;
  if (password.length < 6) { $('passwordError').textContent = 'Password must have at least 6 characters.'; return; }
  if (password !== confirmation) { $('passwordError').textContent = 'The passwords do not match.'; return; }
  try {
    const pw = await hash(`${session.sn || session.user}:${password}`);
    if (session.role === 'student') {
      await fs.collection('users').doc(session.sn).update({ pw, mustChangePassword: false, passwordKey: null });
      const student = users().find(u => u.sn === session.sn);
      if (student) { student.pw = pw; student.mustChangePassword = false; student.passwordKey = null; }
    } else {
      const admins = settings().admins.map(account => account.user === session.user ? { ...account, pw, mustChangePassword: false } : account);
      const updatedSettings = { ...settings(), admins };
      await saveSettings(updatedSettings); C.settings = updatedSettings;
    }
    session.mustChangePassword = false; keepSession(); msg = ''; render();
  } catch (e) { $('passwordError').textContent = 'Could not save the new password. Check your connection and try again.'; }
}
async function setupAdmin() {
  if (settings().admins.length) return say('An admin already exists. Please log in.');
  const user = $('s').value.trim().toLowerCase(), p = $('p').value;
  if (!user) return say('Type an admin username.');
  if (/^\d+$/.test(user) && !/^(?:\d{9}|\d{13})$/.test(user)) return say('Numeric admin usernames must contain 9 or 13 digits.');
  if (users().some(x => x.sn.toLowerCase() === user)) return say('That name is used by a student. Choose another.');
  if (p.length < 6) return say('Password must have at least 6 characters.');
  await saveSettings({ ...settings(), admins: [{ user, pw: await hash(user + ':' + p), role: 'admin' }] });
  session = { role: 'admin', name: user, user }; keepSession(); msg = ''; startRecords(); render();
}
function logout() { session = null; localStorage.removeItem('pcreg_session'); startRecords(); pick = null; myGroup = ''; myStudentType = ''; myPersonalStudentType = ''; signatureMessage = ''; render(); }

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
let busy = false, myGroup = '', myStudentType = '', myPersonalStudentType = '';
const studentProfile = () => users().find(u => u.sn === session.sn) || {};
const assignedGroup = () => studentProfile().group || '';
const groupLocked = () => Boolean(studentProfile().group || studentProfile().groupLocked);
const LEGACY_PERSONAL_GROUP = 'Lab Personal PC';
const LAB_GROUP = 'LAB'; // group for people in a student type other than "Student" who sign in on a lab PC
const isLegacyPersonalGroup = group => {
  const value = String(group || '').trim().toLowerCase(), prefix = LEGACY_PERSONAL_GROUP.toLowerCase();
  return value === prefix || value.startsWith(prefix + ' ') || value.startsWith(prefix + '-') || value.startsWith(prefix + '(');
};
const STUDENT_CATEGORY = 'Student';
const DEFAULT_STUDENT_TYPES = ['Interns', 'Work Integrated Learning'];
const BUILT_IN_STUDENT_TYPES = [STUDENT_CATEGORY, ...DEFAULT_STUDENT_TYPES];
const studentTypes = () => {
  const saved = (settings().studentTypes || []).filter(type => type && type !== STUDENT_CATEGORY);
  const others = settings().studentTypesEdited ? saved : [...DEFAULT_STUDENT_TYPES, ...saved.filter(type => !DEFAULT_STUDENT_TYPES.includes(type))];
  return [STUDENT_CATEGORY, ...new Set(others)];
};
const attendanceTypeForProfile = profile => profile.studentType || (profile.group && !profile.personalPCProgram && !isLegacyPersonalGroup(profile.group) ? STUDENT_CATEGORY : '');
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
const isP = r => r.personal || r.pc === 'Personal' || r.excused; // excused records hold no PC
const noPcText = r => r.excused ? 'Excused (approved report)' : 'Personal PC';
const pcLabel = r => r.excused ? 'Excused' : !hasRecordedPc(r.pc) ? 'Not recorded' : r.pc === 'Personal' ? 'Personal' : r.personal ? `${r.pc} (personal)` : r.pc;
const attendanceStudentType = r => r.studentType || (isLegacyPersonalGroup(r.group) && (users().find(u => u.sn === r.sn) || {}).studentType) || (r.group && !isLegacyPersonalGroup(r.group) ? STUDENT_CATEGORY : '');
const attendanceCategory = r => isLegacyPersonalGroup(r.group) ? (attendanceStudentType(r) || 'Student type needed') : r.group === LAB_GROUP && r.studentType && r.studentType !== STUDENT_CATEGORY ? `${r.studentType} (${LAB_GROUP})` : r.group ? groupLabel(r.group, r.groupYear) : attendanceStudentType(r);

/* ---------- Student ---------- */
let useLabGroup = true;
const taken = (date, pc) => records().find(r => r.date === date && r.pc === pc && !r.returnedAt);
function studentView() {
  const today = ymd(new Date()), total = settings().totalPCs, profile = studentProfile();
  const mine = records().find(r => r.date === today && r.sn === session.sn && !r.excused);
  const excusedToday = records().find(r => r.date === today && r.sn === session.sn && r.excused);
  let top;
  if (!isWeekday(new Date())) top = `<p>The register is open Monday to Friday only. Today is ${dayName(today)}.</p>`;
    else if (mine) top = `<p>${mine.returnedAt ? 'Attendance recorded; PC returned' : 'Today you are holding'}</p><div class="big">${isP(mine) ? 'Personal PC' + (mine.pc === 'Personal' ? '' : ' ' + mine.pc) : `PC ${pcLabel(mine)}`}</div>
      <p>${isP(mine) ? 'You are using your own PC today. Only the admin can change this.' : `Signed at ${mine.time}${mine.returnedAt ? `; returned at ${new Date(mine.returnedAt).toLocaleTimeString()}` : ''}. You cannot sign in again today.`}${mine.studentType ? ' Student type: ' + esc(mine.studentType) + '.' + (mine.group === LAB_GROUP ? ' Group: ' + LAB_GROUP + '.' : '') : mine.group ? ' Group: ' + esc(groupLabel(mine.group, mine.groupYear)) + '.' : ''}</p>`;
  else {
    let cells = '';
    for (let i = 1; i <= total; i++) cells += `<button class="pc ${pick === i ? 'sel' : ''}" ${taken(today, i) ? 'disabled' : ''} onclick="choose(${i})">${i}</button>`;
    const pcells = personalNums().map(n => `<button class="pc ${pick === n ? 'sel' : ''}" ${taken(today, n) ? 'disabled' : ''} onclick="choose(${n})">${n}</button>`).join('');
    const personalPick = personalNums().includes(pick);
    const profileCategory = attendanceTypeForProfile(profile), category = personalPick ? myPersonalStudentType : myStudentType || profileCategory;
    const categoryControl = `<label for="studentType">${personalPick ? 'Student type for this personal PC sign-in' : 'Student type'}</label><select id="studentType" onchange="${personalPick ? 'myPersonalStudentType' : 'myStudentType'}=this.value; render()"><option value="">Choose a type</option>${studentTypes().map(type => `<option value="${esc(type)}" ${type === category ? 'selected' : ''}>${esc(type)}</option>`).join('')}</select>`;
    const groupControl = category === STUDENT_CATEGORY
      ? assignedGroup() ? `<p>Your group: <b>${esc(groupLabel(assignedGroup()))}</b> (ask an admin to change it)</p>`
        : groupLocked() ? '<p class="err">Your group has not been assigned. Please ask an admin.</p>'
          : (settings().groups || []).some(group => !isLegacyPersonalGroup(group)) ? `<label for="grp">Your group</label><select id="grp" onchange="myGroup=this.value"><option value="">Choose your group</option>${settings().groups.filter(group => !isLegacyPersonalGroup(group)).map(group => `<option value="${esc(group)}" ${group === myGroup ? 'selected' : ''}>${esc(groupLabel(group))}</option>`).join('')}</select>` : '<p class="err">The admin has not added groups yet.</p>'
      : category && !personalPick ? `<label for="labGroup">Group</label><select id="labGroup" onchange="useLabGroup = this.value === 'LAB'"><option value="LAB" ${useLabGroup ? 'selected' : ''}>LAB</option><option value="" ${useLabGroup ? '' : 'selected'}>No group</option></select>` : '';
    top = `<p>Pick the PC you are taking. Once you sign, only the admin can change it. You must be at the lab to sign, so allow location when the browser asks.</p>
      <div class="grid">${cells}</div>
      ${pcells ? `<p>Using your own PC? Pick a personal PC number:</p><div class="grid">${pcells}</div>` : ''}
      ${categoryControl}${groupControl}
      <button ${pick ? '' : 'disabled'} onclick="sign()">${pick ? (personalNums().includes(pick) ? 'Sign for personal PC ' : 'Sign for PC ') + pick : 'Choose a PC first'}</button>`;
  }
  const hist = records().filter(r => r.sn === session.sn).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  $('app').innerHTML = `
  <div class="card"><h2>${dayName(today)}, ${today}</h2>${excusedToday ? `<p class="good"><b>Your ${esc(excusedToday.reportType || 'absence')} report for today was approved. You are marked as attended.</b></p>` : ''}${top}${studentGroupJoinLink(assignedGroup() || myGroup)}<div class="msg err">${msg}</div></div>
  <div class="card"><h2>My last sign-ins</h2><div class="wrap">${table(hist, false)}</div></div>`;
}
const choose = i => { if (pick !== i) myPersonalStudentType = ''; pick = i; render(); };
async function sign() {
  const today = ymd(new Date()); msg = '';
  if (!isWeekday(new Date())) return say('Register is closed on weekends.');
  if (records().some(x => x.date === today && x.sn === session.sn && !x.excused)) return say('You already have an attendance record today and cannot sign in again.');
  const personalPick = personalNums().includes(pick);
  const studentType = personalPick ? myPersonalStudentType : myStudentType || attendanceTypeForProfile(studentProfile());
  if (personalPick && !studentType) return say('Choose a student type for the personal PC sign-in.');
  const grp = studentType === STUDENT_CATEGORY ? assignedGroup() || (groupLocked() ? '' : myGroup) : (!personalPick && useLabGroup ? LAB_GROUP : '');
  if (!studentType) return say('Please choose your student type.');
  if (studentType === STUDENT_CATEGORY && !grp) return say(groupLocked() ? 'Your group has not been assigned. Please ask an admin.' : 'Please choose your group.');
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
      tx.update(userRef, studentType === STUDENT_CATEGORY
        ? { group: grp, studentType, personalPCProgram: false, groupLocked: true }
        : { group: '', studentType, personalPCProgram: true, groupLocked: true });
    });
    pick = null; myPersonalStudentType = ''; render();
  } catch (e) { pick = null; say(e.message === 'taken' ? 'This student already has an attendance record today, or that PC is taken.' : saveFail(e, 'sign in')); }
}

/* ---------- Admin ---------- */
let range = (() => { const m = mondayOf(ymd(new Date())), f = new Date(m); f.setDate(m.getDate() + 4); return { from: ymd(m), to: ymd(f), scope: '' }; })();
let selectedRecordId = '', selectedStudentSn = '', selectedGroup = '', selectedType = '', selectedStaffUser = '', adminTab = 'register';
let studentSearch = { field: 'all', query: '' };
function rangeBounds() {
  let from = range.from || ymd(new Date()), to = range.to || from;
  if (to < from) [from, to] = [to, from];
  return { from, to };
}
/* Sorting: lists of sign-ins and the people in registers can each be sorted several ways. */
let listSort = 'pc', rosterSort = 'surname';
const SORT_OPTIONS = [['pc', 'PC number (1, 2, 3...)'], ['name', 'Name (A to Z)'], ['surname', 'Surname (A to Z)'], ['sn', 'Student number'], ['time', 'Time signed in']];
const ROSTER_SORT_OPTIONS = [['surname', 'Surname (A to Z)'], ['name', 'First name (A to Z)'], ['sn', 'Student number']];
const cmpNum = (x, y) => x === y ? 0 : x < y ? -1 : 1;
const cmpText = (x, y) => String(x || '').localeCompare(String(y || ''), undefined, { numeric: true, sensitivity: 'base' });
const lastWord = value => String(value || '').trim().split(/\s+/).pop();
const pcSortValue = r => { const n = Number(r.pc); return r.excused || !hasRecordedPc(r.pc) || Number.isNaN(n) ? Infinity : n; };
const RECORD_SORTERS = {
  pc: (a, b) => cmpNum(pcSortValue(a), pcSortValue(b)) || cmpText(a.name, b.name),
  name: (a, b) => cmpText(a.name, b.name) || cmpNum(pcSortValue(a), pcSortValue(b)),
  surname: (a, b) => cmpText(lastWord(a.name), lastWord(b.name)) || cmpText(a.name, b.name),
  sn: (a, b) => cmpText(a.sn, b.sn),
  time: (a, b) => cmpNum(Number(a.signedAt) || 0, Number(b.signedAt) || 0) || cmpText(a.time, b.time)
};
const recordCmp = () => RECORD_SORTERS[listSort] || RECORD_SORTERS.pc;
const sortRecords = list => [...list].sort(recordCmp());
const sortOptionsHtml = (options, selected) => options.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
function setListSort(value) { listSort = RECORD_SORTERS[value] ? value : 'pc'; render(); }
function setRosterSort(value) { rosterSort = ['surname', 'name', 'sn'].includes(value) ? value : 'surname'; render(); }
function sortPeople(list) {
  const surname = p => lastWord(p.surname || p.name);
  const by = { surname: (a, b) => cmpText(surname(a), surname(b)) || cmpText(a.name, b.name), name: (a, b) => cmpText(a.name, b.name), sn: (a, b) => cmpText(a.sn, b.sn) };
  return [...list].sort(by[rosterSort] || by.surname);
}
function inRange() {
  const b = rangeBounds(), cmp = recordCmp();
  return records().filter(r => r.date >= b.from && r.date <= b.to)
    .sort((a, c) => a.date.localeCompare(c.date) || cmp(a, c));
}
/* Scope = which group / student type an export covers. '' = everyone, 'g:<group>', 't:<student type>', 'none'. */
function recordInScope(scope, r) {
  if (!scope) return true;
  if (scope === 'none') return (!r.group || isLegacyPersonalGroup(r.group)) && !attendanceStudentType(r);
  if (scope.startsWith('g:')) return r.group === scope.slice(2);
  if (scope.startsWith('t:')) return attendanceStudentType(r) === scope.slice(2);
  return true;
}
function userInScope(scope, u) {
  if (!scope) return true;
  const type = attendanceTypeForProfile(u);
  if (scope === 'none') return !u.group && !type;
  if (scope.startsWith('g:')) return u.group === scope.slice(2);
  if (scope.startsWith('t:')) return type === scope.slice(2);
  return true;
}
function scopeEntries(extra = []) {
  const groups = (settings().groups || []).filter(g => !isLegacyPersonalGroup(g));
  extra.forEach(r => { if (r.group && !isLegacyPersonalGroup(r.group) && !groups.includes(r.group)) groups.push(r.group); });
  if (!groups.includes(LAB_GROUP)) groups.push(LAB_GROUP);
  const types = studentTypes();
  extra.forEach(r => { const t = attendanceStudentType(r); if (t && !types.includes(t)) types.push(t); });
  return [
    ...groups.map(g => ({ id: 'g:' + g, label: groupLabel(g), kind: 'group' })),
    ...types.map(t => t === STUDENT_CATEGORY
      ? { id: 't:' + t, label: 'All regular students (every group)', kind: 'type', aggregate: true }
      : { id: 't:' + t, label: t, kind: 'type' })
  ];
}
function scopeLabel(scope) {
  if (!scope) return 'Everyone';
  if (scope === 'none') return 'No group / student type';
  const e = scopeEntries(records()).find(x => x.id === scope);
  return e ? e.label : scope.slice(2);
}
const scopedRecords = () => inRange().filter(r => recordInScope(range.scope, r));
/* Splits a list so each sign-in lands in exactly one bucket (group, then student type, then none). */
function scopeBuckets(list) {
  const entries = [...scopeEntries(list).filter(e => !e.aggregate), { id: 'none', label: 'No group / student type' }];
  const buckets = new Map(entries.map(e => [e.id, { id: e.id, label: e.label, list: [] }]));
  list.forEach(r => { const e = entries.find(x => recordInScope(x.id, r)); if (e) buckets.get(e.id).list.push(r); });
  return [...buckets.values()];
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
    if (f.status === 'personal' && (!isP(r) || r.excused)) return false;
    if (f.status === 'excused' && !r.excused) return false;
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || recordCmp()(a, b));
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
    <div><label for="attendanceStatus">Return status</label><select id="attendanceStatus"><option value="">All statuses</option><option value="out" ${f.status === 'out' ? 'selected' : ''}>Not returned</option><option value="returned" ${f.status === 'returned' ? 'selected' : ''}>Returned</option><option value="personal" ${f.status === 'personal' ? 'selected' : ''}>Personal PC</option><option value="excused" ${f.status === 'excused' ? 'selected' : ''}>Excused (approved report)</option></select></div>
    <div><label for="attendanceSort">Sort by</label><select id="attendanceSort" onchange="listSort = this.value; applyAttendanceFilters()">${sortOptionsHtml(SORT_OPTIONS, listSort)}</select></div></div>
    <button onclick="applyAttendanceFilters()">Search</button><button class="alt" onclick="clearAttendanceFilters()">Clear</button>
    <p>${list.length} match(es)${list.length > display.length ? `; showing the latest ${display.length}` : ''}.</p>${table(display, true)}</div>`;
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
  adminTab = 'register';
  render();
  $('recordDetails')?.scrollIntoView({ block: 'nearest' });
}
function viewStudent(sn) {
  selectedStudentSn = sn;
  adminTab = 'students';
  render();
  $('studentDetails')?.scrollIntoView({ block: 'nearest' });
}
function viewType(type) {
  selectedType = type; selectedGroup = '';
  adminTab = 'groups';
  render();
  $('typeDetails')?.scrollIntoView({ block: 'nearest' });
}
function viewGroup(group) {
  selectedGroup = group; selectedType = '';
  adminTab = 'groups';
  render();
  $('groupDetails')?.scrollIntoView({ block: 'nearest' });
}
function viewStaff(user) {
  if (!hasPermission('staff')) return;
  selectedStaffUser = user;
  adminTab = 'staff';
  render();
  $('staffDetails')?.scrollIntoView({ block: 'nearest' });
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
    ${registerLogosCard(logoKeyFor(STUDENT_CATEGORY, selectedGroup))}
    ${registerGridCard(STUDENT_CATEGORY, selectedGroup)}
    <button class="sm" onclick="composeUpdate(this.dataset.target)" data-target="g:${esc(selectedGroup)}">Send an update to this group</button>
    <button class="sm alt" onclick="removeGroup(${i})">Remove group</button>
    <button class="sm alt" onclick="selectedGroup = ''; render()">Close details</button></div>`;
}
/* ---------- Register logos (top of the Word attendance register) ---------- */
const logoKeyFor = (type, group) => group ? 'g:' + group : 't:' + type;
const registerLogos = key => (settings().registerLogos || {})[key] || {};
function readLogoFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpe?g|gif|webp)$/i.test(file.type)) return reject(new Error('type'));
    if (file.size > 5 * 1024 * 1024) return reject(new Error('size'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const sizes = [[300, 110], [220, 80], [160, 60]];
      for (let i = 0; i < sizes.length; i++) {
        const scale = Math.min(1, sizes[i][0] / img.width, sizes[i][1] / img.height);
        const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const data = canvas.toDataURL('image/png');
        if (data.length <= 70000 || i === sizes.length - 1) return resolve({ data, w, h });
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('read')); };
    img.src = url;
  });
}
async function persistLogos(all) {
  const next = { ...settings(), registerLogos: all };
  if (JSON.stringify(next).length > 900000) throw new Error('full');
  await saveSettings(next);
}
const logoError = e => ({ type: 'Choose a PNG, JPG, GIF or WebP image.', size: 'That image is too big. Use one under 5 MB.', full: 'There is no room for more logos. Remove a logo from another group first.', read: 'That image could not be read.' }[e && e.message] || 'Could not save the logo.');
async function setRegisterLogo(key, slot, input) {
  if (!hasPermission('groups')) return;
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const logo = await readLogoFile(file), all = { ...(settings().registerLogos || {}) };
    all[key] = { ...(all[key] || {}), [slot]: logo };
    await persistLogos(all);
    say('Logo saved.', true);
  } catch (e) { say(logoError(e)); }
  input.value = '';
}
async function removeRegisterLogo(key, slot) {
  if (!hasPermission('groups')) return;
  const all = { ...(settings().registerLogos || {}) }, mine = { ...(all[key] || {}) };
  delete mine[slot];
  if (Object.keys(mine).some(k => k === 'sasseta' || k === 'company')) all[key] = mine; else delete all[key];
  try { await persistLogos(all); say('Logo removed.', true); } catch (e) { say(logoError(e)); }
}
async function setLogoSide(key, value) {
  if (!hasPermission('groups')) return;
  const all = { ...(settings().registerLogos || {}) };
  all[key] = { ...(all[key] || {}), swap: value === 'swap' };
  try { await persistLogos(all); say('Logo positions saved.', true); } catch (e) { say(logoError(e)); }
}
async function copySassetaLogoToAll(key) {
  if (!hasPermission('groups')) return;
  const logo = registerLogos(key).sasseta;
  if (!logo) return say('Add the SASSETA logo here first.');
  if (!confirm('Use this SASSETA logo for every group and student type? Their own SASSETA logos will be replaced.')) return;
  const keys = [...(settings().groups || []).filter(g => !isLegacyPersonalGroup(g)).map(g => logoKeyFor(STUDENT_CATEGORY, g)), logoKeyFor(STUDENT_CATEGORY, LAB_GROUP), ...studentTypes().filter(t => t !== STUDENT_CATEGORY).map(t => logoKeyFor(t, ''))];
  const all = { ...(settings().registerLogos || {}) };
  keys.forEach(k => { all[k] = { ...(all[k] || {}), sasseta: logo }; });
  try { await persistLogos(all); say('SASSETA logo set for every group and student type.', true); } catch (e) { say(logoError(e)); }
}
function registerLogosCard(key) {
  if (!hasPermission('groups')) return '';
  const l = registerLogos(key), attr = `data-key="${esc(key)}"`;
  const slot = (id, label) => `<div><label for="logo-${id}">${label}</label>
    ${l[id] ? `<div><img src="${esc(l[id].data)}" alt="${label}" style="max-height:60px;max-width:200px;background:#fff;border:1px solid var(--line);padding:4px"></div>` : '<p>No logo yet.</p>'}
    <input id="logo-${id}" type="file" accept="image/png,image/jpeg,image/gif,image/webp" ${attr} onchange="setRegisterLogo(this.dataset.key, '${id}', this)">
    ${l[id] ? `<button class="sm alt" ${attr} onclick="removeRegisterLogo(this.dataset.key, '${id}')">Remove</button>` : ''}
    ${id === 'sasseta' && l[id] ? `<button class="sm alt" ${attr} onclick="copySassetaLogoToAll(this.dataset.key)">Use for every group</button>` : ''}</div>`;
  return `<h3>Logos for the Word register</h3>
    <p>These two logos go at the top of this group's Word attendance register, one on each side.</p>
    <div class="row">${slot('sasseta', 'SASSETA logo')}${slot('company', 'Company logo')}
    <div><label for="logoSide">Positions</label><select id="logoSide" ${attr} onchange="setLogoSide(this.dataset.key, this.value)"><option value="normal" ${l.swap ? '' : 'selected'}>SASSETA on the left, company on the right</option><option value="swap" ${l.swap ? 'selected' : ''}>SASSETA on the right, company on the left</option></select></div></div>`;
}
function wordLogoImage(logo) {
  if (!logo || !logo.data || !logo.data.startsWith('data:image/png;base64,') || !logo.w || !logo.h) return null;
  const data = Uint8Array.from(atob(logo.data.split(',')[1]), character => character.charCodeAt(0));
  let h = Math.min(60, logo.h), w = Math.round(h * logo.w / logo.h);
  if (w > 200) { w = 200; h = Math.round(w * logo.h / logo.w); }
  return new docx.ImageRun({ data, transformation: { width: w, height: h } });
}
function wordLogoHeader(key) {
  const l = registerLogos(key), left = wordLogoImage(l.swap ? l.company : l.sasseta), right = wordLogoImage(l.swap ? l.sasseta : l.company);
  if (!left && !right) return null;
  const none = { style: docx.BorderStyle.NONE, size: 0, color: 'FFFFFF' }, borders = { top: none, bottom: none, left: none, right: none };
  const cell = (image, alignment) => new docx.TableCell({ width: { size: 7420, type: docx.WidthType.DXA }, borders, children: [new docx.Paragraph({ alignment, children: image ? [image] : [] })] });
  return new docx.Table({
    width: { size: 14840, type: docx.WidthType.DXA }, columnWidths: [7420, 7420],
    borders: { ...borders, insideHorizontal: none, insideVertical: none },
    rows: [new docx.TableRow({ children: [cell(left, docx.AlignmentType.LEFT), cell(right, docx.AlignmentType.RIGHT)] })]
  });
}
function labDetails() {
  return `<div class="card" id="typeDetails"><h2>${LAB_GROUP}</h2>
    <p>The group for people in a student type other than "Student" (for example interns) who sign in on a lab PC. It is built in, so it cannot be renamed or removed.</p>
    ${registerLogosCard(logoKeyFor(STUDENT_CATEGORY, LAB_GROUP))}
    ${registerGridCard(STUDENT_CATEGORY, LAB_GROUP)}
    <button class="sm alt" onclick="selectedType = ''; render()">Close details</button></div>`;
}
function otherGroupsCard() {
  const types = studentTypes().filter(t => t !== STUDENT_CATEGORY);
  return `<div class="card"><h2>Other groups (student types)</h2>
    <p>People who are not in a regular group, such as interns. Open one to see its people and register, change its name, or send it an update.</p>
    <ul class="link-list"><li><a href="#typeDetails" onclick="viewType(this.dataset.type); return false" data-type="${LAB_GROUP}">${LAB_GROUP}</a><span>${new Set(records().filter(r => r.group === LAB_GROUP).map(r => r.sn)).size} people have signed in as LAB</span></li></ul>
    ${types.length ? `<ul class="link-list">${types.map(t => `<li><a href="#typeDetails" onclick="viewType(this.dataset.type); return false" data-type="${esc(t)}">${esc(t)}</a><span>${users().filter(u => attendanceTypeForProfile(u) === t).length} people</span></li>`).join('')}</ul>` : '<p>None yet.</p>'}
    <label for="newStudentType">New other group / student type</label><input id="newStudentType" maxlength="50">
    <button onclick="addStudentType()">Add</button></div>`;
}
function adminTypeDetails() {
  const type = selectedType;
  if (type === LAB_GROUP) return labDetails();
  if (!type || type === STUDENT_CATEGORY || !studentTypes().includes(type)) return '';
  const members = users().filter(u => attendanceTypeForProfile(u) === type);
  const history = hasPermission('attendance') ? records().filter(r => attendanceStudentType(r) === type)
    .sort((a, b) => b.date.localeCompare(a.date) || (Number(b.signedAt) || 0) - (Number(a.signedAt) || 0)) : [];
  return `<div class="card" id="typeDetails"><h2>${esc(type)}</h2>
    <p>${members.length} ${members.length === 1 ? 'person' : 'people'}${hasPermission('attendance') ? ` · ${history.length} attendance record(s)` : ''}</p>
    <div class="row"><div><label for="typeName">Name of this group</label><input id="typeName" maxlength="50" value="${esc(type)}"></div></div>
    <button class="sm" onclick="renameStudentType()">Save name</button>
    <p class="download-progress">Renaming also updates the people and old sign-ins that use this name.</p>
    <h3>People</h3>${members.length ? `<ul>${members.map(u => `<li>${hasPermission('students') ? `<a href="#studentDetails" onclick="viewStudent(this.dataset.sn); return false" data-sn="${esc(u.sn)}">${esc(u.name)} (${esc(u.sn)})</a>` : `${esc(u.name)} (${esc(u.sn)})`}</li>`).join('')}</ul>` : '<p>Nobody is in this group yet.</p>'}
    ${registerLogosCard(logoKeyFor(type, ''))}
    ${registerGridCard(type, '')}
    ${hasPermission('attendance') ? `<h3>Attendance history</h3>${table(history.slice(0, 100), true)}${history.length > 100 ? `<p>Showing the latest 100 of ${history.length}.</p>` : ''}` : ''}
    <button class="sm" onclick="composeUpdate(this.dataset.target)" data-target="t:${esc(type)}">Send an update to this group</button>
    <button class="sm alt" onclick="removeStudentType()">Remove this group</button>
    <button class="sm alt" onclick="selectedType = ''; render()">Close details</button></div>`;
}
/* One row per person for the whole group; each day a person signs, their signature goes on their own row. */
let registerWeek = ymd(mondayOf(ymd(new Date())));
function setRegisterWeek(value) { if (value) registerWeek = ymd(mondayOf(value)); render(); }
function shiftRegisterWeek(n) { const d = parse(registerWeek); d.setDate(d.getDate() + 7 * n); registerWeek = ymd(d); render(); }
function registerGridCard(type, group) {
  const monday = parse(registerWeek), days = [0, 1, 2, 3, 4].map(i => { const d = new Date(monday); d.setDate(monday.getDate() + i); return ymd(d); });
  const weekRecords = records().filter(r => r.date >= days[0] && r.date <= days[4] && matchesWordRegister(r, type, group));
  const roster = wordRegisterRoster(type, group, weekRecords);
  const cell = (person, date) => {
    const r = weekRecords.find(x => x.sn === person.sn && x.date === date);
    if (!r) return '';
    if (r.excused) return '<small>Excused</small>';
    const sig = r.signature && r.signature.startsWith('data:image/') ? `<img src="${esc(r.signature)}" alt="Signature" style="height:26px;max-width:80px">` : '&#10003;';
    return `${sig}<br><small>PC ${esc(pcLabel(r))}</small>`;
  };
  const signedCount = new Set(weekRecords.map(r => r.sn)).size;
  return `<h3>Attendance register</h3>
    <div class="row"><div><label for="registerWeekInput">Week (pick any day)</label><input id="registerWeekInput" type="date" value="${esc(registerWeek)}" onchange="setRegisterWeek(this.value)"></div>
    <div><label for="registerPeopleSort">Sort people by</label><select id="registerPeopleSort" onchange="setRosterSort(this.value)">${sortOptionsHtml(ROSTER_SORT_OPTIONS, rosterSort)}</select></div></div>
    <button type="button" class="sm alt" onclick="shiftRegisterWeek(-1)">Previous week</button><button type="button" class="sm alt" onclick="shiftRegisterWeek(1)">Next week</button>
    <p><b>${roster.length} ${roster.length === 1 ? 'person' : 'people'}</b> in this register · ${signedCount} signed this week (${days[0]} to ${days[4]}).</p>
    ${roster.length ? `<div class="wrap"><table><tr><th>#</th><th>Name</th><th>Student no.</th>${days.map(d => `<th>${dayName(d).slice(0, 3)}<br><small>${d.slice(5)}</small></th>`).join('')}</tr>${roster.map((person, i) => `<tr><td>${i + 1}</td><td>${esc(person.name || '')}</td><td>${esc(person.sn)}</td>${days.map(d => `<td>${cell(person, d)}</td>`).join('')}</tr>`).join('')}</table></div>` : '<p>Nobody is in this register yet. People are added the first time they choose this group and sign in.</p>'}`;
}
function adminRecordDetails() {
  const rec = records().find(r => r.id === selectedRecordId);
  if (!rec) return '';
  return `<div class="card" id="recordDetails"><h2>Sign-in details</h2>
    <p><b>${esc(rec.name)}</b> (${esc(rec.sn)})</p>
    <p>${rec.date} (${dayName(rec.date)}) · ${esc(attendanceCategory(rec))} · ${pcLabel(rec)}</p>
    <p>Signed in: ${esc(rec.time || 'Not recorded')}<br>Returned: ${rec.returnedAt ? `${esc(new Date(rec.returnedAt).toLocaleString())} · marked by ${esc(rec.returnedBy || 'Staff not recorded')}` : isP(rec) ? noPcText(rec) : 'Not returned'}</p>
    <p>Signature: ${rec.signature ? `<img src="${esc(rec.signature)}" alt="Signature of ${esc(rec.name)}" style="width:180px;height:64px;object-fit:contain">` : 'Not captured'}</p>
    ${isP(rec) ? '' : `<button class="sm" onclick="returnPc('${esc(rec.id)}')">Record return</button>`}${rec.excused ? '' : `<button class="sm" onclick="editPc('${esc(rec.id)}')">Change PC</button>`}
    <button class="sm alt" onclick="removeRec('${esc(rec.id)}')">Remove sign-in</button>
    <button class="sm alt" onclick="selectedRecordId = ''; render()">Close details</button></div>`;
}
function adminStudentDetails() {
  const studentList = users(), user = studentList.find(u => u.sn === selectedStudentSn);
  if (!user) return '';
  const i = studentList.indexOf(user), category = attendanceTypeForProfile(user);
  return `<div class="card" id="studentDetails"><h3>${esc(user.name)}</h3>
    <p>Student number: ${esc(user.sn)}<br>Group: ${esc(user.group ? groupLabel(user.group) : 'None')}<br>Student type: ${esc(user.studentType || 'None')}</p>
    <div class="row"><div><label for="studentGroup">Group</label><select id="studentGroup" onchange="assignGroup(${i}, this.value)"><option value="" ${(!user.group || isLegacyPersonalGroup(user.group)) ? 'selected' : ''}>${isLegacyPersonalGroup(user.group) ? 'Lab Personal PC (choose type)' : '(none)'}</option>${groupOpts(user.group)}</select></div>
    <div><label for="studentType">Student type</label><select id="studentType" onchange="assignStudentType(${i}, this.value)"><option value="">(none)</option>${studentTypes().map(type => `<option value="${esc(type)}" ${category === type ? 'selected' : ''}>${esc(type)}</option>`).join('')}</select></div></div>
    <button class="sm" onclick="composeUpdate('p:${esc(user.sn)}')">Send a message</button>
    <button class="sm" onclick="resetStudent(${i})">Reset password</button>
    <button class="sm alt" onclick="deleteStudent('${esc(user.sn)}')">Delete login and profile</button>
    <button class="sm alt" onclick="selectedStudentSn = ''; render()">Close details</button></div>`;
}
function matchingStudents() {
  const query = studentSearch.query.trim().toLowerCase();
  return users().filter(user => {
    if (!query) return true;
    const fields = {
      name: user.name || '',
      number: user.sn || '',
      group: user.group && !isLegacyPersonalGroup(user.group) ? groupLabel(user.group) : '',
      type: attendanceTypeForProfile(user) || ''
    };
    const value = studentSearch.field === 'all' ? Object.values(fields).join(' ') : fields[studentSearch.field];
    return String(value || '').toLowerCase().includes(query);
  });
}
function applyStudentSearch() {
  studentSearch = { field: $('studentSearchField').value, query: $('studentSearchQuery').value.trim() };
  render();
}
function clearStudentSearch() {
  studentSearch = { field: 'all', query: '' };
  render();
}
function adminStaffDetails() {
  const account = settings().admins.find(item => item.user === selectedStaffUser);
  if (!account) return '';
  const fullAdmin = account.role !== 'staff';
  return `<div class="card" id="staffDetails"><h3>${esc(account.user)}</h3>
    <p>${fullAdmin ? 'Full admin · all rights' : `Staff · ${(account.permissions || []).map(key => esc(PERMISSIONS[key] || key)).join(', ') || 'No rights granted'}`}</p>
    ${account.user !== session.user ? `<button class="sm" onclick="resetStaffPassword(this.dataset.user)" data-user="${esc(account.user)}">Reset password</button>` : '<p>This is your account. Use the Password tab to change your own password.</p>'}
    ${account.role === 'staff' && account.user !== session.user ? `<button class="sm alt" onclick="removeStaff(this.dataset.user)" data-user="${esc(account.user)}">Remove staff account</button>` : ''}
    <button class="sm alt" onclick="selectedStaffUser = ''; render()">Close details</button></div>`;
}
/* ---------- Red flags: too many absences in a month ---------- */
const RF_DEFAULTS = { maxAbsent: 3, deductPercent: 10, stipend: 0, offDays: [] };
const rfSettings = () => ({ ...RF_DEFAULTS, ...(settings().redFlag || {}) });
let rfMonth = ymd(new Date()).slice(0, 7);
const canManageFlags = () => hasPermission('redflagsManage'); // full admins always; staff only when granted
const waiverKey = month => 'm' + month.replace('-', '_');
function absenceReport(month, kind = 'students') {
  const cfg = rfSettings(), [y, m] = month.split('-').map(Number), today = ymd(new Date());
  const all = records(), off = new Set(cfg.offDays || []), out = [];
  const lastDay = new Date(y, m, 0).getDate();
  for (const u of users()) {
    const isStudent = attendanceTypeForProfile(u) === STUDENT_CATEGORY;
    if ((kind === 'students') !== isStudent) continue;
    if (kind === 'students' && u.redFlagExcluded) continue; // removed from the list by a full admin
    const mine = all.filter(r => r.sn === u.sn);
    if (!mine.length) continue; // never signed in: start date unknown, so not counted
    const first = mine.map(r => r.date).sort()[0], present = new Set(mine.map(r => r.date));
    const excused = new Set(u.excusedDates || []);
    const absent = [], excusedList = [];
    for (let d = 1; d <= lastDay; d++) {
      const day = ymd(new Date(y, m - 1, d));
      if (day >= today || day < first || !isWeekday(parse(day)) || off.has(day) || present.has(day)) continue;
      (excused.has(day) ? excusedList : absent).push(day);
    }
    const over = Math.max(0, absent.length - cfg.maxAbsent), waiver = (u.redFlagWaivers || {})[waiverKey(month)];
    const wasFlagged = absent.length > cfg.maxAbsent, flagged = wasFlagged && !waiver;
    out.push({ user: u, absent, excused: excusedList, over, flagged, waiver: wasFlagged ? waiver : null,
      percent: flagged ? Math.min(100, over * cfg.deductPercent) : 0, amount: flagged && cfg.stipend ? Math.min(100, over * cfg.deductPercent) / 100 * cfg.stipend : 0 });
  }
  return out.filter(x => x.absent.length || x.excused.length).sort((a, b) => b.absent.length - a.absent.length || a.user.name.localeCompare(b.user.name));
}
function redFlagCard() {
  const cfg = rfSettings(), rows = absenceReport(rfMonth), flagged = rows.filter(r => r.flagged);
  const money = n => `R${n.toFixed(2)}`;
  const line = r => `<tr style="${r.flagged ? 'background:color-mix(in srgb,var(--bad) 12%,transparent)' : ''}"><td><a href="#studentDetails" onclick="viewStudent(this.dataset.sn); return false" data-sn="${esc(r.user.sn)}">${esc(r.user.name)}</a><br><small>${esc(r.user.sn)}</small></td>
    <td>${r.flagged ? '<b class="err">&#9873; RED FLAG</b>' : r.waiver ? `<b class="good">Flag removed</b><br><small>by ${esc(r.waiver.by || 'admin')}</small>` : 'OK'}</td><td>${r.absent.length}</td><td>${r.excused.length}</td><td>${r.over}</td>
    <td>${r.flagged ? `${r.percent}%${cfg.stipend ? ` (about ${money(r.amount)})` : ''}` : '-'}</td>
    <td style="white-space:normal;min-width:180px">${r.absent.map(d => `${d.slice(8)}/${d.slice(5, 7)}`).join(', ') || '-'}</td>
    <td style="min-width:150px">${!canManageFlags() ? '' : (r.flagged ? `<button class="sm alt" onclick="removeRedFlag(this.dataset.sn)" data-sn="${esc(r.user.sn)}">Remove flag (this month)</button>` : r.waiver ? `<button class="sm alt" onclick="restoreRedFlag(this.dataset.sn)" data-sn="${esc(r.user.sn)}">Restore flag</button>` : '') + `<button class="sm alt" onclick="excludeFromRedFlags(this.dataset.sn)" data-sn="${esc(r.user.sn)}">Remove from list</button>`}</td></tr>`;
  return `<div class="card"><h2>&#9873; Red flags: too many absences</h2>
    <p>This list is only for users whose type is <b>Student</b>. Interns, Work Integrated Learning and other types are listed in the <b>Other absences</b> tab. A student is flagged when they are absent for more than <b>${cfg.maxAbsent} day(s)</b> in one month. Each day above the limit takes <b>${cfg.deductPercent}%</b> off the stipend${cfg.stipend ? ` (stipend: ${money(cfg.stipend)})` : ''}. Weekdays only. Days with an approved absence report do not count. Today and future days are not counted.</p>
    <div class="row"><div><label for="rfMonth">Month</label><input id="rfMonth" type="month" value="${esc(rfMonth)}" onchange="rfMonth = this.value || rfMonth; render()"></div></div>
    <p><b>${flagged.length}</b> student(s) flagged this month${rows.some(r => r.waiver) ? `, ${rows.filter(r => r.waiver).length} removed by an admin` : ''}. <b>Remove flag</b> only applies to the month shown. <b>Remove from list</b> takes the student off this list for every month until you restore them.${canManageFlags() ? '' : ' You do not have the right to remove or restore flags.'}</p>
    ${rows.length ? `<div class="wrap"><table><tr><th>Student</th><th>Status</th><th>Absent days</th><th>Excused</th><th>Days over limit</th><th>Likely deduction</th><th>Absent dates (dd/mm)</th><th></th></tr>${rows.map(line).join('')}</table></div>` : '<p>No absences found for this month.</p>'}
    ${excludedSection()}
    <button onclick="exportRedFlags()" ${rows.length ? '' : 'disabled'}>Download red flag list (Excel)</button>
    ${hasPermission('redflagRules') ? `<details><summary>Red flag rules</summary>
      <div class="row"><div><label for="rfMax">Most absent days allowed per month</label><input id="rfMax" type="number" min="0" value="${cfg.maxAbsent}"></div>
      <div><label for="rfPct">Deduction per extra day (% of stipend)</label><input id="rfPct" type="number" min="0" max="100" step="0.5" value="${cfg.deductPercent}"></div>
      <div><label for="rfStipend">Monthly stipend in Rand (optional, shows the amount)</label><input id="rfStipend" type="number" min="0" value="${cfg.stipend || ''}"></div></div>
      <label for="rfOff">Days off such as public holidays (dates like 2026-10-12, separated by commas)</label><input id="rfOff" value="${esc((cfg.offDays || []).join(', '))}">
      <button onclick="saveRedFlagRules()">Save rules</button></details>` : ''}</div>`;
}
function otherAbsencesCard() {
  const rows = absenceReport(rfMonth, 'others'), cfg = rfSettings();
  return `<div class="card"><h2>Other absences (not students)</h2>
    <p>Interns, Work Integrated Learning and other types are listed here. They do not get a red flag. Weekdays only, with approved absences and days off left out, the same as the student list.</p>
    <div class="row"><div><label for="rfMonthOther">Month</label><input id="rfMonthOther" type="month" value="${esc(rfMonth)}" onchange="rfMonth = this.value || rfMonth; render()"></div></div>
    ${rows.length ? `<div class="wrap"><table><tr><th>Name</th><th>Type</th><th>Absent days</th><th>Excused</th><th>Absent dates (dd/mm)</th></tr>${rows.map(r => `<tr><td><a href="#studentDetails" onclick="viewStudent(this.dataset.sn); return false" data-sn="${esc(r.user.sn)}">${esc(r.user.name)}</a><br><small>${esc(r.user.sn)}</small></td><td>${esc(attendanceTypeForProfile(r.user) || 'No type')}</td><td>${r.absent.length}</td><td>${r.excused.length}</td><td style="white-space:normal;min-width:180px">${r.absent.map(d => `${d.slice(8)}/${d.slice(5, 7)}`).join(', ') || '-'}</td></tr>`).join('')}</table></div>` : '<p>No absences found for this month.</p>'}</div>`;
}
async function removeRedFlag(sn) {
  if (!canManageFlags()) return;
  const u = users().find(x => x.sn === sn);
  if (!u || !confirm(`Remove the red flag for ${u.name} for ${rfMonth}? No stipend deduction will be shown for them this month.`)) return;
  try { await fs.collection('users').doc(sn).update({ [`redFlagWaivers.${waiverKey(rfMonth)}`]: { by: session.user, at: Date.now() } }); }
  catch (e) { say(saveFail(e, 'remove the flag')); }
}
const excludedStudents = () => users().filter(u => u.redFlagExcluded && attendanceTypeForProfile(u) === STUDENT_CATEGORY).sort((a, b) => String(a.name).localeCompare(String(b.name)));
function excludedSection() {
  const list = excludedStudents();
  if (!list.length || !canManageFlags()) return '';
  return `<h3>Removed from the list (${list.length})</h3><div class="wrap"><table><tr><th>Student</th><th>Removed by</th><th></th></tr>${list.map(u => `<tr><td>${esc(u.name)}<br><small>${esc(u.sn)}</small></td><td>${esc(u.redFlagExcludedBy || 'admin')}</td><td><button class="sm alt" onclick="restoreToRedFlagList(this.dataset.sn)" data-sn="${esc(u.sn)}">Put back on list</button></td></tr>`).join('')}</table></div>`;
}
async function excludeFromRedFlags(sn) {
  if (!canManageFlags()) return;
  const u = users().find(x => x.sn === sn);
  if (!u || !confirm(`Remove ${u.name} from the red flag list for all months? You can put them back later.`)) return;
  try { await fs.collection('users').doc(sn).update({ redFlagExcluded: true, redFlagExcludedBy: session.user }); }
  catch (e) { say(saveFail(e, 'remove the student')); }
}
async function restoreToRedFlagList(sn) {
  if (!canManageFlags()) return;
  try { const del = firebase.firestore.FieldValue.delete(); await fs.collection('users').doc(sn).update({ redFlagExcluded: del, redFlagExcludedBy: del }); }
  catch (e) { say(saveFail(e, 'put the student back')); }
}
async function restoreRedFlag(sn) {
  if (!canManageFlags()) return;
  try { await fs.collection('users').doc(sn).update({ [`redFlagWaivers.${waiverKey(rfMonth)}`]: firebase.firestore.FieldValue.delete() }); }
  catch (e) { say(saveFail(e, 'restore the flag')); }
}
async function saveRedFlagRules() {
  if (!hasPermission('redflagRules')) return;
  const offDays = $('rfOff').value.split(/[,\s]+/).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
  const redFlag = { maxAbsent: Math.max(0, Number($('rfMax').value) || 0), deductPercent: Math.min(100, Math.max(0, Number($('rfPct').value) || 0)), stipend: Math.max(0, Number($('rfStipend').value) || 0), offDays };
  try { await saveSettings({ ...settings(), redFlag }); C.settings.redFlag = redFlag; say('Red flag rules saved.', true); }
  catch (e) { say(saveFail(e, 'save the rules')); }
}
function exportRedFlags() {
  const cfg = rfSettings(), rows = absenceReport(rfMonth);
  const data = [['Student no.', 'Name', 'Status', 'Absent days', 'Excused days', 'Days over limit', 'Deduction %', 'Estimated deduction (R)', 'Absent dates']]
    .concat(rows.map(r => [r.user.sn, r.user.name, r.flagged ? 'RED FLAG' : r.waiver ? 'FLAG REMOVED' : 'OK', r.absent.length, r.excused.length, r.over, r.flagged ? r.percent : 0, r.flagged && cfg.stipend ? Number(r.amount.toFixed(2)) : '', r.absent.join(', ')]));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'Red flags');
  XLSX.writeFile(wb, `WM-LPR-red-flags-${rfMonth}.xlsx`);
}

function adminView() {
  const list = inRange(), st = settings(), groups = (st.groups || []).filter(g => !isLegacyPersonalGroup(g));
  const visibleStudents = matchingStudents();
  const sections = [
    { id: 'register', label: 'Today', permission: 'attendance' },
    { id: 'search', label: 'Search attendance', permission: 'attendance' },
    { id: 'settings', label: 'PC settings', permission: 'settings' },
    { id: 'location', label: 'Lab location', permission: 'settings' },
    { id: 'groups', label: 'Groups', permission: 'groups' },
    { id: 'personal-pcs', label: 'PC numbers', permission: 'settings' },
    { id: 'mark-personal', label: 'Mark personal PC', permission: 'attendance' },
    { id: 'personal-week', label: 'Personal PC this week', permission: 'attendance' },
    { id: 'redflags', label: '&#9873; Red flags', permission: 'redflags' },
    { id: 'otherabsences', label: 'Other absences', permission: 'redflags' },
    { id: 'students', label: 'Students', permission: 'students' },
    { id: 'staff', label: 'Staff', permission: 'staff' },
    { id: 'password', label: 'Password' },
    { id: 'exports', label: 'Exports', permission: 'attendance' }
  ].filter(section => !section.permission || hasPermission(section.permission));
  if (!sections.some(section => section.id === adminTab)) adminTab = sections[0].id;
  const panel = id => `admin-panel${adminTab === id ? ' active' : ''}`;
  const wk = mondayOf(ymd(new Date())), fri = new Date(wk); fri.setDate(wk.getDate() + 4);
  const onExports = adminTab === 'exports', exportBounds = rangeBounds(), exportList = onExports ? scopedRecords() : [], exportBuckets = onExports && !range.scope ? scopeBuckets(exportList).filter(x => x.list.length) : [];
  const personal = records().filter(r => isP(r) && !r.excused && r.date >= ymd(wk) && r.date <= ymd(fri))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  $('app').innerHTML = `
  <div class="msg err">${msg}</div>
  <div class="admin-tabs" role="tablist" aria-label="Admin sections">${sections.map(section => `<button type="button" role="tab" aria-selected="${adminTab === section.id}" class="${adminTab === section.id ? '' : 'alt'}" onclick="setAdminTab('${section.id}')">${section.label}</button>`).join('')}</div>
  ${hasPermission('attendance') ? `<section class="${panel('register')}" role="tabpanel">${dayCard()}${adminRecordDetails()}</section>` : ''}
  ${hasPermission('attendance') ? `<section class="${panel('search')}" role="tabpanel">${attendanceSearchCard()}</section>` : ''}
  ${hasPermission('redflags') ? `<section class="${panel('redflags')}" role="tabpanel">${adminTab === 'redflags' ? redFlagCard() : ''}</section>` : ''}
  ${hasPermission('redflags') ? `<section class="${panel('otherabsences')}" role="tabpanel">${adminTab === 'otherabsences' ? otherAbsencesCard() : ''}</section>` : ''}
  ${hasPermission('settings') ? `<section class="${panel('settings')}" role="tabpanel"><div class="card"><h2>Settings</h2>
    <div class="row"><div><label for="tp">Number of PCs</label><input id="tp" type="number" min="1" value="${st.totalPCs}"></div></div>
    <button onclick="saveTotal()">Save number of PCs</button></div></section>` : ''}
  ${hasPermission('settings') ? `<section class="${panel('location')}" role="tabpanel"><div class="card"><h2>Lab location</h2>
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
  ${otherGroupsCard()}${adminGroupDetails()}${adminTypeDetails()}</section>` : ''}
  ${hasPermission('settings') ? `<section class="${panel('personal-pcs')}" role="tabpanel"><div class="card"><h2>Personal PC numbers</h2>
    <p>These numbers start at 200. Students who use their own PC pick one of them when they sign.</p>
    ${personalNums().length ? personalNums().map(n => `<span style="margin-right:14px;white-space:nowrap">${n} <button class="sm alt" onclick="removePersonalNum(${n})">Remove</button></span>`).join('') : '<p class="err">No personal numbers yet.</p>'}
    <div class="row"><div><label for="pnc">How many numbers to add</label><input id="pnc" type="number" min="1" max="50" value="5"></div>
    <div><label for="pnn">Or one exact number (200 or more)</label><input id="pnn" type="number" min="200"></div></div>
    <button onclick="addPersonalNums()">Add numbers</button></div></section>` : ''}
  ${hasPermission('attendance') ? `<section class="${panel('mark-personal')}" role="tabpanel"><div class="card"><h2>Mark personal PC</h2>
    <p>Mark a student who is using their own PC. They will not pick a lab PC on that day.</p>
    <div class="row"><div><label for="pp">Student</label><select id="pp">${users().map(u => `<option value="${esc(u.sn)}">${esc(u.name)} (${esc(u.sn)})</option>`).join('')}</select></div>
    <div><label for="pd">Date</label><input id="pd" type="date" value="${ymd(new Date())}" onchange="refreshPersonalPcOptions()"></div>
    <div><label for="personalType">Student type</label><select id="personalType"><option value="">Choose a type</option>${studentTypes().map(type => `<option value="${esc(type)}">${esc(type)}</option>`).join('')}</select></div>
    <div><label for="pg">Group</label><select id="pg"><option value="">(none)</option>${groups.map(g => `<option value="${esc(g)}">${esc(groupLabel(g))}</option>`).join('')}</select></div>
    <div><label for="pn">Personal PC number</label><select id="pn"><option value="">No number</option>${personalNums().map(n => taken(ymd(new Date()), n) ? `<option value="${n}" disabled>${n} (taken)</option>` : `<option>${n}</option>`).join('')}</select></div></div>
    <button onclick="markPersonal()">Mark as personal PC</button></div></section>` : ''}
  ${hasPermission('attendance') ? `<section class="${panel('personal-week')}" role="tabpanel"><div class="card"><h2>Using a personal PC this week</h2>
    ${personal.length ? `<div class="wrap"><table><tr><th>Date</th><th>Student</th><th>PC</th><th></th></tr>${personal.map(r =>
        `<tr><td>${r.date}</td><td>${esc(r.name)} (${esc(r.sn)})</td><td>${pcLabel(r)}</td><td><a href="#recordDetails" onclick="viewRecord(this.dataset.id); return false" data-id="${esc(r.id)}">View details</a></td></tr>`).join('')}</table></div>` : '<p>Nobody is marked this week.</p>'}</div></section>` : ''}
      ${hasPermission('staff') ? `<section class="${panel('staff')}" role="tabpanel"><div class="card"><h2>Staff roles</h2>
    <ul class="link-list">${st.admins.map(a => `<li data-user="${esc(a.user)}"><span><a href="#staffDetails" onclick="viewStaff(this.dataset.user); return false" data-user="${esc(a.user)}"><b>${esc(a.user)}</b></a> · ${a.role === 'staff' ? 'Staff' : 'Full admin'}</span><span>${a.role === 'staff' ? (a.permissions || []).map(key => esc(PERMISSIONS[key] || key)).join(', ') || 'No rights granted' : 'All rights'}${a.role === 'staff' && a.user !== session.user ? `<details><summary>Edit rights</summary>${Object.entries(PERMISSIONS).map(([key, label]) => `<label class="check"><input type="checkbox" name="editStaffPermission" value="${key}" ${(a.permissions || []).includes(key) ? 'checked' : ''}>${label}</label>`).join('')}<button class="sm" onclick="saveStaffPermissions(this)">Save rights</button></details>` : ''}</span></li>`).join('')}</ul>
    ${adminStaffDetails()}
    <div class="row"><div><label for="staffUser">Username</label><input id="staffUser" autocapitalize="off"></div><div><label for="staffPassword">Temporary password (at least 6 characters)</label><input id="staffPassword" type="password"></div></div>
    <fieldset><legend>Granted rights</legend>${Object.entries(PERMISSIONS).filter(([key]) => key !== 'staff' || hasPermission('staff')).map(([key, label]) => `<label class="check"><input type="checkbox" name="staffPermission" value="${key}">${label}</label>`).join('')}</fieldset>
    <button onclick="addAdmin()">Add staff account</button></div></section>` : ''}
  <section class="${panel('password')}" role="tabpanel"><div class="card"><h2>Change my password</h2>
    <div class="row"><div><label for="np">New password (at least 6 characters)</label><input id="np" type="password"></div>
    <div><label for="np2">Type it again</label><input id="np2" type="password"></div></div>
    <button onclick="changeAdminPw()">Change password</button></div></section>
  ${hasPermission('students') ? `<section class="${panel('students')}" role="tabpanel"><div class="card"><h2>Students</h2>
    <p>Assign regular groups or, for Lab Personal PC students, a separate student type.</p>
    <div class="row"><div><label for="studentSearchField">Search by</label><select id="studentSearchField"><option value="all" ${studentSearch.field === 'all' ? 'selected' : ''}>All fields</option><option value="name" ${studentSearch.field === 'name' ? 'selected' : ''}>Name</option><option value="number" ${studentSearch.field === 'number' ? 'selected' : ''}>Student number</option><option value="group" ${studentSearch.field === 'group' ? 'selected' : ''}>Group</option><option value="type" ${studentSearch.field === 'type' ? 'selected' : ''}>Student type</option></select></div>
    <div><label for="studentSearchQuery">Find student</label><input id="studentSearchQuery" value="${esc(studentSearch.query)}" placeholder="Enter a name, number, group, or type"></div></div>
    <button onclick="applyStudentSearch()">Search</button><button class="alt" onclick="clearStudentSearch()">Clear</button>
    ${visibleStudents.length ? `<p>${visibleStudents.length} student(s) found.</p><ul>${visibleStudents.map(u => `<li><a href="#studentDetails" onclick="viewStudent(this.dataset.sn); return false" data-sn="${esc(u.sn)}">${esc(u.name)} (${esc(u.sn)})</a> · ${esc(u.group ? groupLabel(u.group) : u.studentType || 'No group or type')}</li>`).join('')}</ul>${adminStudentDetails()}` : '<p>No students match that search.</p>'}</div></section>` : ''}
  ${hasPermission('attendance') ? `<section class="${panel('exports')}" role="tabpanel">${onExports ? exportsCard(exportBounds, exportList, exportBuckets) : ''}</section>` : ''}
  ${pcEditModal()}`;
}
function scopeOptionsHtml() {
  const entries = scopeEntries(records()), opt = e => `<option value="${esc(e.id)}" ${range.scope === e.id ? 'selected' : ''}>${esc(e.label)}</option>`;
  const gs = entries.filter(e => e.kind === 'group'), ts = entries.filter(e => e.kind === 'type');
  return `<option value="" ${range.scope ? '' : 'selected'}>Everyone (all groups and student types)</option>
    ${gs.length ? `<optgroup label="Groups">${gs.map(opt).join('')}</optgroup>` : ''}
    <optgroup label="Student types (not in a group)">${ts.map(opt).join('')}</optgroup>
    <option value="none" ${range.scope === 'none' ? 'selected' : ''}>No group / student type</option>`;
}
function exportsCard(b, list, buckets) {
  const people = new Set(list.map(r => r.sn)).size, days = new Set(list.map(r => r.date)).size;
  return `<div class="card"><h2>Exports</h2>
    <p>Choose the dates and who to include. Every download below uses these choices.</p>
    <div class="row">
      <div><label for="rf">From date</label><input id="rf" type="date" value="${esc(b.from)}" onchange="setRange()"></div>
      <div><label for="rto">To date</label><input id="rto" type="date" value="${esc(b.to)}" onchange="setRange()"></div>
      <div><label for="rscope">Group / student type</label><select id="rscope" onchange="setRange()">${scopeOptionsHtml()}</select></div>
      <div><label for="rsort">Sort lists by</label><select id="rsort" onchange="setListSort(this.value)">${sortOptionsHtml(SORT_OPTIONS, listSort)}</select></div>
      <div><label for="rpsort">Sort people in registers by</label><select id="rpsort" onchange="setRosterSort(this.value)">${sortOptionsHtml(ROSTER_SORT_OPTIONS, rosterSort)}</select></div>
    </div>
    <div>${[['today', 'Today'], ['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'], ['lastmonth', 'Last month'], ['last30', 'Last 30 days']].map(([k, label]) => `<button type="button" class="sm alt" onclick="setPreset('${k}')">${label}</button>`).join('')}</div>
    <p><b>${dayName(b.from)} ${esc(b.from)} to ${dayName(b.to)} ${esc(b.to)}</b> &middot; ${esc(scopeLabel(range.scope))}: ${list.length} sign-in(s), ${people} ${people === 1 ? 'person' : 'people'}, ${days} day(s) with sign-ins.</p>
    ${buckets.length ? `<div class="wrap"><table><tr><th>Group / type</th><th>Sign-ins</th><th>People</th><th>Lab PCs</th><th>Personal PCs</th><th>Excused</th></tr>${buckets.map(x => `<tr><td>${esc(x.label)}</td><td>${x.list.length}</td><td>${new Set(x.list.map(r => r.sn)).size}</td><td>${x.list.filter(r => !isP(r)).length}</td><td>${x.list.filter(r => isP(r) && !r.excused).length}</td><td>${x.list.filter(r => r.excused).length}</td></tr>`).join('')}<tr><th>Total</th><th>${list.length}</th><th>${people}</th><th></th><th></th><th></th></tr></table></div>` : ''}
    <h3>Lists</h3>
    <button onclick="exportXlsx()">Download list (Excel)</button><button onclick="exportPdf()">Download list (PDF)</button>
    <p class="download-progress">${range.scope ? 'Excel has a Register sheet and a By person sheet (one row per person, one column per day).' : 'Excel has a Summary sheet, the full Register, a By person sheet, and one sheet for every group and student type. The PDF is split by group and student type.'}</p>
    <h3>Registers</h3>
    <button onclick="exportWordRegister()">Download Word attendance register</button><button onclick="exportGroupPdf()">Download signature register (PDF)</button><button class="alt" onclick="exportAllWordRegisters()">Download all Word registers (ZIP)</button>
    <p class="download-progress">The Word register has one table per week (Monday to Friday) with signatures and no PC numbers. Pick one group or student type above for a single register, or use the ZIP to get every group and student type at once.</p>
    <div id="exportStatus" class="download-progress" aria-live="polite"></div></div>`;
}
  function setAdminTab(tabId) { adminTab = tabId; render(); }
let dayView = { date: ymd(new Date()), mode: 'all' };
function dayCard() {
  const recs = sortRecords(records().filter(r => r.date === dayView.date));
  const pers = recs.filter(r => isP(r) && !r.excused).length, exc = recs.filter(r => r.excused).length, names = (settings().groups || []).filter(g => !isLegacyPersonalGroup(g));
  recs.forEach(r => { if (r.group && !isLegacyPersonalGroup(r.group) && !names.includes(r.group)) names.push(r.group); });
  const cnt = g => recs.filter(r => r.group === g).length, nog = recs.filter(r => (!r.group || isLegacyPersonalGroup(r.group)) && !attendanceStudentType(r)), typed = recs.filter(r => attendanceStudentType(r));
  let body;
  if (dayView.mode === 'all') {
    body = `<h3>Group totals</h3><div class="wrap"><table><tr><th>Group</th><th>Signed in</th></tr>${names.map(g => `<tr><td>${esc(groupLabel(g))}</td><td>${cnt(g)}</td></tr>`).join('')}${nog.length ? `<tr><td>No group / student type</td><td>${nog.length}</td></tr>` : ''}<tr><th>All students</th><th>${recs.length}</th></tr></table></div>${typed.length ? `<h3>Student type totals</h3><div class="wrap"><table>${studentTypes().map(type => `<tr><td>${esc(type)}</td><td>${typed.filter(r => attendanceStudentType(r) === type).length}</td></tr>`).join('')}</table></div>` : ''}<h3>Whole list</h3>${table(recs, true)}`;
  } else if (!names.length) body = table(recs, true);
  else body = names.map(g => `<h3>${esc(groupLabel(g))} (${cnt(g)})</h3>${cnt(g) ? table(recs.filter(r => r.group === g), true) : '<p>Nobody yet.</p>'}`).join('') + studentTypes().filter(type => typed.some(r => attendanceStudentType(r) === type)).map(type => { const list = typed.filter(r => attendanceStudentType(r) === type); return `<h3>Student type: ${esc(type)} (${list.length})</h3>${table(list, true)}`; }).join('') + (nog.length ? `<h3>No group / student type (${nog.length})</h3>${table(nog.filter(r => !attendanceStudentType(r)), true)}` : '');
  return `<div class="card"><h2>Register for a day</h2>
    <div class="row"><div><label for="dd">Date</label><input id="dd" type="date" value="${dayView.date}" onchange="setDay()"></div>
    <div><label for="dm">View</label><select id="dm" onchange="setDay()"><option value="group" ${dayView.mode === 'group' ? 'selected' : ''}>By group</option><option value="all" ${dayView.mode === 'all' ? 'selected' : ''}>Whole list (with totals)</option></select></div>
    <div><label for="ds">Sort by</label><select id="ds" onchange="setListSort(this.value)">${sortOptionsHtml(SORT_OPTIONS, listSort)}</select></div></div>
    <button class="alt" onclick="dayToday()">Go to today</button>
    <p><b>${dayName(dayView.date)}, ${dayView.date}</b>: ${recs.length} signed in (${recs.length - pers - exc} lab PCs, ${pers} personal PCs${exc ? `, ${exc} excused` : ''}).${isWeekday(parse(dayView.date)) ? '' : ' The register is closed on weekends.'}</p>
    ${body}</div>`;
}
function setDay() { dayView.date = $('dd').value || ymd(new Date()); dayView.mode = $('dm').value; render(); }
function dayToday() { dayView.date = ymd(new Date()); dayView.mode = 'all'; render(); }
function setRange() {
  range.from = $('rf').value || range.from; range.to = $('rto').value || range.to;
  if (range.to < range.from) [range.from, range.to] = [range.to, range.from];
  range.scope = $('rscope').value;
  render();
}
function setPreset(kind) {
  const today = new Date(), mon = mondayOf(ymd(today)), at = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  let f = today, t = today;
  if (kind === 'week') { f = mon; t = at(mon, 4); }
  else if (kind === 'lastweek') { f = at(mon, -7); t = at(mon, -3); }
  else if (kind === 'month') { f = new Date(today.getFullYear(), today.getMonth(), 1); t = new Date(today.getFullYear(), today.getMonth() + 1, 0); }
  else if (kind === 'lastmonth') { f = new Date(today.getFullYear(), today.getMonth() - 1, 1); t = new Date(today.getFullYear(), today.getMonth(), 0); }
  else if (kind === 'last30') { f = at(today, -29); }
  range.from = ymd(f); range.to = ymd(t);
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
  fs.collection('users').doc(u.sn).update({ group, groupLocked: true, personalPCProgram, studentType: group ? STUDENT_CATEGORY : (u.studentType || '') }).then(() => say(group ? `${esc(u.name)} is now in group ${esc(group)}.` : `${esc(u.name)} has no group now.`, true), () => say('Could not save.'));
}
function assignStudentType(i, type) {
  if (!hasPermission('students')) return;
  const u = users()[i], student = type === STUDENT_CATEGORY;
  const personalPCProgram = student ? false : Boolean(type || u.personalPCProgram || isLegacyPersonalGroup(u.group));
  const group = student ? (u.group && !isLegacyPersonalGroup(u.group) ? u.group : '') : personalPCProgram ? '' : (u.group || '');
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
  if (g.toLowerCase() === LAB_GROUP.toLowerCase()) return say('LAB is built in. It is the group for people in other student types who sign in on a lab PC.');
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
const saveTypes = list => saveSettings({ ...settings(), studentTypes: list.filter(type => type && type !== STUDENT_CATEGORY), studentTypesEdited: true });
const otherTypes = () => studentTypes().filter(type => type !== STUDENT_CATEGORY);
function addStudentType() {
  if (!hasPermission('groups')) return;
  const type = $('newStudentType').value.trim(), types = studentTypes();
  if (!type) return say('Type a name.');
  if (types.some(x => x.toLowerCase() === type.toLowerCase())) return say('That name already exists.');
  saveTypes([...otherTypes(), type]).then(() => say('Added.', true), () => say('Could not save.'));
}
function removeStudentType() {
  if (!hasPermission('groups')) return;
  const type = selectedType;
  if (!type || type === STUDENT_CATEGORY) return say('The "Student" type holds the regular groups and cannot be removed.');
  if (users().some(u => attendanceTypeForProfile(u) === type)) return say('Move the people in this group to another group or type first.');
  if (!confirm(`Remove "${type}"? Old sign-ins keep this name.`)) return;
  saveTypes(otherTypes().filter(t => t !== type)).then(() => { selectedType = ''; say('Removed.', true); }, () => say('Could not remove.'));
}
async function renameStudentType() {
  if (!hasPermission('groups')) return;
  const old = selectedType, name = $('typeName').value.trim();
  if (!old || old === STUDENT_CATEGORY) return say('The "Student" type holds the regular groups and cannot be renamed.');
  if (!name) return say('Type a name.');
  if (name === old) return say('That is already its name.');
  if (studentTypes().some(t => t.toLowerCase() === name.toLowerCase() && t !== old)) return say('That name already exists.');
  if (!confirm(`Rename "${old}" to "${name}"? This also updates the people, old sign-ins and updates that use it.`)) return;
  const ops = [];
  C.users.filter(u => u.studentType === old).forEach(u => ops.push({ ref: fs.collection('users').doc(u.sn), data: { studentType: name } }));
  C.records.filter(r => r.studentType === old && r.id).forEach(r => ops.push({ ref: fs.collection('records').doc(r.id), data: { studentType: name } }));
  C.zipReplies.filter(r => r.studentType === old && r.id).forEach(r => ops.push({ ref: fs.collection('zipReplies').doc(r.id), data: { studentType: name } }));
  C.updates.filter(x => x.audience === 't:' + old && x.id).forEach(x => ops.push({ ref: fs.collection('updates').doc(x.id), data: { audience: 't:' + name } }));
  try {
    for (let offset = 0; offset < ops.length; offset += 400) {
      const batch = fs.batch();
      ops.slice(offset, offset + 400).forEach(op => batch.update(op.ref, op.data));
      await batch.commit();
    }
    await saveTypes(otherTypes().map(t => t === old ? name : t));
    selectedType = name;
    say(`Renamed to "${name}".`, true);
  } catch (e) { say('Could not finish renaming. Nothing was lost; try again.'); }
}
function refreshPersonalPcOptions() {
  const date = $('pd') && $('pd').value, select = $('pn');
  if (!select) return;
  [...select.options].forEach(option => {
    const n = parseInt(option.value, 10);
    if (!n) return;
    option.disabled = !!(date && taken(date, n));
    option.textContent = option.disabled ? `${n} (taken)` : String(n);
    if (option.disabled && select.value === option.value) select.value = '';
  });
}
async function markPersonal() {
  if (!hasPermission('attendance')) return;
  const sn = $('pp').value, date = $('pd').value, u = users().find(x => x.sn === sn);
  if (!u) return say('Choose a student.');
  const studentType = $('personalType').value, personalPCProgram = studentType !== STUDENT_CATEGORY;
  const group = personalPCProgram ? '' : $('pg').value || (u.group && !isLegacyPersonalGroup(u.group) ? u.group : '');
  if (!studentType) return say('Choose a student type for the personal-PC attendance record.');
  if (studentType === STUDENT_CATEGORY && !group) return say('Choose a group for this student.');
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
  if (/^\d+$/.test(user) && !/^(?:\d{9}|\d{13})$/.test(user)) return say('Numeric admin usernames must contain 9 or 13 digits.');
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
function temporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(14)), value => alphabet[value % alphabet.length]).join('');
}
async function resetStudent(i) {
  if (!hasPermission('students')) return;
  const student = users()[i];
  if (!student || !confirm(`Reset ${student.name}'s password? They will need to create a new password at next login.`)) return;
  const temporary = temporaryPassword();
  try {
    const pw = await hash(student.sn + ':' + temporary);
    await fs.collection('users').doc(student.sn).update({ pw, mustChangePassword: true, passwordKey: null });
    student.pw = pw; student.mustChangePassword = true; student.passwordKey = null;
    alert(`Temporary password for ${student.name}: ${temporary}\nGive it to them privately. They will be asked to create a new password when they log in.`);
    say(`Password reset for ${esc(student.name)}.`, true);
  } catch (e) { say('Could not reset the student password.'); }
}
async function resetStaffPassword(user) {
  if (!hasPermission('staff')) return;
  const target = settings().admins.find(account => account.user === user);
  if (!target || user === session.user || !confirm(`Reset ${user}'s password? They will need to create a new password at next login.`)) return;
  const temporary = temporaryPassword();
  try {
    const pw = await hash(user + ':' + temporary);
    const admins = settings().admins.map(account => account.user === user
      ? { ...account, pw, mustChangePassword: true }
      : account);
    const updatedSettings = { ...settings(), admins };
    await saveSettings(updatedSettings); C.settings = updatedSettings;
    alert(`Temporary password for ${user}: ${temporary}\nGive it to them privately. They will be asked to create a new password when they log in.`);
    say(`Password reset for ${esc(user)}.`, true);
  } catch (e) { say('Could not reset the staff password.'); }
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
  if (admin) return `<div class="wrap"><table><tr><th>Date</th><th>Student</th><th>Group / type</th><th>PC</th><th>Status</th><th></th></tr>` +
    list.map(r => `<tr><td>${r.date}</td><td>${esc(r.name)} (${esc(r.sn)})</td><td>${esc(attendanceCategory(r))}</td><td>${pcLabel(r)}</td><td>${r.returnedAt ? `Returned${r.returnedBy ? `<br><small>Marked by ${esc(r.returnedBy)}</small>` : '<br><small>Staff not recorded</small>'}` : isP(r) ? noPcText(r) : 'Not returned'}</td><td><a href="#recordDetails" onclick="viewRecord(this.dataset.id); return false" data-id="${esc(r.id)}">View details</a></td></tr>`).join('') + '</table></div>';
  return `<table><tr><th>Date</th><th>Day</th><th>Student no.</th><th>Name</th><th>Group / type</th><th>PC</th><th>Signed in</th><th>Returned at</th><th>Signature</th>${admin ? '<th>Actions</th>' : ''}</tr>` +
    list.map(r => `<tr><td>${r.date}</td><td>${dayName(r.date)}</td><td>${esc(r.sn)}</td><td>${esc(r.name)}</td><td>${esc(attendanceCategory(r))}</td><td>${pcLabel(r)}</td><td>${r.time}</td><td>${r.returnedAt ? `${esc(new Date(r.returnedAt).toLocaleString())}${r.returnedBy ? `<br><small>Marked by ${esc(r.returnedBy)}</small>` : '<br><small>Staff not recorded</small>'}` : isP(r) ? noPcText(r) : admin ? `<button class="sm" onclick="returnPc('${r.id}')">Record return</button>` : 'Checked out'}</td><td>${r.signature ? `<img src="${esc(r.signature)}" alt="Signature of ${esc(r.name)}" style="width:100px;height:36px;object-fit:contain">` : 'Not captured'}</td>` +
      (admin ? `<td>${r.excused ? '' : `<button class="sm" onclick="editPc('${r.id}')">Change PC</button>`}<button class="sm alt" onclick="removeRec('${r.id}')">Remove</button></td>` : '') + '</tr>').join('') + '</table>';
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
let pcEditId = '';
function editPc(id) {
  if (!hasPermission('attendance')) return;
  const rec = records().find(x => x.id === id);
  if (!rec || rec.excused) return;
  pcEditId = id; render();
}
function pcEditModal() {
  const rec = pcEditId && records().find(r => r.id === pcEditId);
  if (!rec || rec.excused || !hasPermission('attendance')) return '';
  const personal = isP(rec), nums = personal ? personalNums() : Array.from({ length: settings().totalPCs }, (_, i) => i + 1);
  const cells = nums.map(n => {
    const current = String(rec.pc) === String(n), busy = !current && !!taken(rec.date, n);
    return `<button class="pc ${current ? 'sel' : ''}" ${busy ? 'disabled title="Taken on this day"' : ''} onclick="setPcNumber('${esc(rec.id)}', ${n})">${n}</button>`;
  }).join('');
  return `<div class="modal-back" role="dialog" aria-modal="true" aria-label="Change PC number"><div class="modal card">
    <h2>Change ${personal ? 'personal ' : ''}PC number</h2>
    <p><b>${esc(rec.name)}</b> · ${esc(rec.date)} · now ${esc(pcLabel(rec))}</p>
    <p>${personal ? 'Personal PC numbers' : 'Lab PCs'} that are taken on that day are greyed out.</p>
    ${nums.length ? `<div class="grid">${cells}</div>` : '<p>There are no numbers to choose from.</p>'}
    ${personal && rec.pc !== 'Personal' ? `<button class="sm" onclick="setPcNumber('${esc(rec.id)}', 'Personal')">No number (own PC)</button>` : ''}
    <button class="sm alt" onclick="pcEditId = ''; render()">Cancel</button></div></div>`;
}
async function setPcNumber(id, value) {
  if (!hasPermission('attendance')) return;
  const rec = records().find(x => x.id === id);
  if (!rec || rec.excused) return;
  const personal = isP(rec), noNumber = value === 'Personal', n = noNumber ? 'Personal' : parseInt(value, 10);
  if (noNumber ? !personal : !n || (personal ? !personalNums().includes(n) : n < 1 || n > settings().totalPCs)) return say('That PC number does not exist.');
  if (String(n) === String(rec.pc)) { pcEditId = ''; return render(); }
  if (!noNumber && taken(rec.date, n)) return say(`PC ${n} is already taken on that day.`);
  const oref = fs.collection('records').doc(rec.id);
  const oldSlot = hasRecordedPc(rec.pc) && rec.pc !== 'Personal' ? fs.collection('slots').doc(`${rec.date}_pc${rec.pc}`) : null;
  const newSlot = noNumber ? null : fs.collection('slots').doc(`${rec.date}_pc${n}`), legacyRef = noNumber ? null : fs.collection('records').doc(`${rec.date}_pc${n}`);
  try {
    await fs.runTransaction(async tx => {
      const current = await tx.get(oref), targetSlot = newSlot ? await tx.get(newSlot) : null, legacy = legacyRef ? await tx.get(legacyRef) : null, sourceSlot = oldSlot ? await tx.get(oldSlot) : null;
      if (!current.exists || (targetSlot && targetSlot.exists && targetSlot.data().recordId !== id) || (legacy && legacy.exists && legacy.id !== id && !legacy.data().returnedAt)) throw new Error('taken');
      tx.update(oref, { pc: n });
      if (!rec.returnedAt) {
        if (sourceSlot && sourceSlot.exists && sourceSlot.data().recordId === id) tx.delete(oldSlot);
        if (newSlot) tx.set(newSlot, { recordId: id });
      }
    });
    pcEditId = '';
    say(noNumber ? 'Number removed. This is now an own-PC sign-in.' : 'PC number changed.', true);
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
    <button id="sendReportBtn" onclick="sendReport()">Send report</button><div id="reportStatus" class="msg err" aria-live="polite">${msg}</div></div>
  <div class="card"><h2>My reports</h2>${mine.length ? mine.map(r => reportCard(r, false)).join('') : '<p>You have no reports.</p>'}</div>`;
  showQuota();
}
let reportSending = false;
function reportStatus(html, ok) {
  msg = ok ? `<span class="good">${html}</span>` : html;
  const el = $('reportStatus');
  if (el) el.innerHTML = msg; // update in place so the student keeps what they typed and the files they chose
}
async function sendReport() {
  if (reportSending) return;
  const type = $('rk').value, date = $('rd').value;
  let reason = $('rr').value.trim();
  const files = [...$('rf').files], button = $('sendReportBtn');
  if (!date || !isWeekday(parse(date))) return reportStatus('Choose a day from Monday to Friday.');
  if (reason.length < 5) return reportStatus('Please write a reason (at least 5 characters).');
  if (files.some(file => !validUpload(file))) return reportStatus('Choose images, PDFs, or Word documents no larger than 10 MB each.');
  if (files.length && !storage) return reportStatus('File upload did not load. Check your internet, refresh the page and try again.');
  const now = Date.now(), id = `${session.sn}_${now}`;
  const logRef = fs.collection('reportlog').doc(session.sn), repRef = fs.collection('reports').doc(id);
  let attachments = [];
  reportSending = true; if (button) button.disabled = true;
  try {
    try {
      for (let n = 0; n < files.length; n++) {
        reportStatus(`Uploading ${n + 1} of ${files.length}: ${esc(files[n].name)}. Please wait...`, true);
        attachments.push(await uploadFile(`reports/${session.sn}/${id}`, files[n]));
      }
    } catch (e) {
      await Promise.all(attachments.map(f => storage.ref(f.path).delete().catch(() => {})));
      attachments = [];
      const why = saveFail(e, 'upload the attachment');
      if (!confirm(`${why}\n\nDo you want to send the report without the attachment${files.length > 1 ? 's' : ''}?`)) { reportStatus(esc(why)); return; }
      reason = `${reason} (The student tried to attach ${files.length} file${files.length > 1 ? 's' : ''}, but the upload failed.)`;
    }
    reportStatus('Sending your report...', true);
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
    reportStatus(esc(e.message === 'week' ? `You already sent ${LIMIT_WEEK} reports this week. You can send again from next Monday.`
      : e.message === 'month' ? `You already sent ${LIMIT_MONTH} reports this month. You can send again next month.`
      : saveFail(e, 'send the report')));
  } finally { reportSending = false; const b = $('sendReportBtn'); if (b) b.disabled = false; }
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
    <p>Reports disappear by themselves 7 days after they are sent. Approve or reject each one based on the reason. An approved report marks the student as attended in the register for that date.</p>
    <button class="alt" onclick="addApprovedToRegister()">Add reports approved earlier to the register</button>
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
  return `<div class="rep"><b>${esc(item.title)}</b> <small>${esc(updateAudienceLabel(item))} · ${new Date(item.created).toLocaleString()}</small>
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
  const profile = staff ? {} : studentProfile();
  const replies = C.zipReplies.slice().sort((a, b) => b.created - a.created);
  const visible = C.updates.filter(x => staff || updateVisibleTo(x, profile))
    .sort((a, b) => b.created - a.created);
  $('app').innerHTML = `${canManage ? `<div class="card"><h2>Send an update or message</h2>
    <label for="ut">Title</label><input id="ut" maxlength="120">
    <label for="um">Announcement</label><textarea id="um" rows="4" maxlength="2000"></textarea>
    <label for="ug">Send to</label><select id="ug" onchange="$('upersonWrap').hidden = this.value !== 'person'">${updateTargetOptions()}</select>
    <div id="upersonWrap" ${updateTarget.startsWith('p:') ? '' : 'hidden'}><label for="uperson">Person (type a name or student number)</label><input id="uperson" list="upeople" autocomplete="off" value="${esc(updatePersonText())}"><datalist id="upeople">${users().slice().sort((a, b) => cmpText(a.name, b.name)).map(u => `<option value="${esc(u.name)} (${esc(u.sn)})"></option>`).join('')}</datalist></div>
    <label for="uf">Attach files (images/documents up to 10 MB each, or ZIP up to 300 MB)</label><input id="uf" type="file" accept="image/*,.pdf,.doc,.docx,.zip,application/zip,application/x-zip-compressed" multiple>
    <button id="publishUpdateBtn" onclick="publishUpdate()">Publish</button><div id="uploadStatus" class="msg"></div><div class="msg err">${msg}</div></div>` : `<div class="card"><h2>Send a ZIP to the admin</h2>
    <p>Send one ZIP file, up to 300 MB. The admin will see your name and group or student type.</p>
    <label for="studentZip">ZIP file</label><input id="studentZip" type="file" accept=".zip,application/zip,application/x-zip-compressed">
    <button id="sendZipBtn" onclick="sendZipReply()">Send ZIP</button><div id="uploadStatus" class="msg"></div><div class="msg err">${msg}</div></div>`}
    <div class="card"><h2>${staff ? 'Published updates' : 'Announcements and documents'}</h2>${updatesError ? `<p class="err">${esc(updatesError)}</p>` : ''}${visible.length ? visible.map(x => updateCard(x, canManage)).join('') : '<p>No updates yet.</p>'}</div>`;
  if (canManage) $('app').insertAdjacentHTML('beforeend', `<div class="card"><h2>ZIP files from students</h2>${zipRepliesError ? `<p class="err">${esc(zipRepliesError)}</p>` : ''}${replies.length ? replies.map(zipReplyCard).join('') : '<p>No ZIP files received.</p>'}</div>`);
}
let updateTarget = '';
function composeUpdate(target) { updateTarget = target || ''; if (location.hash === '#updates') render(); else location.hash = '#updates'; }
function updateAudience(x) {
  if (x.audience) return x.audience;
  return !x.group || x.group === 'All students' ? 'all' : 'g:' + x.group;
}
function updateAudienceLabel(x) {
  const a = updateAudience(x);
  if (a === 'all') return 'All students';
  if (a.startsWith('g:')) return groupLabel(a.slice(2));
  if (a.startsWith('t:')) return a.slice(2);
  if (a.startsWith('p:')) return 'Only ' + (x.recipientName || a.slice(2));
  return 'All students';
}
function updateVisibleTo(x, profile) {
  const a = updateAudience(x);
  if (a === 'all') return true;
  if (!session) return false;
  if (a.startsWith('p:')) return a.slice(2) === session.sn;
  if (a.startsWith('t:')) return attendanceTypeForProfile(profile) === a.slice(2);
  if (a.startsWith('g:')) return a.slice(2) === (assignedGroup() || myGroup);
  return false;
}
function updateTargetOptions() {
  const sel = updateTarget.startsWith('p:') ? 'person' : updateTarget, opt = (value, label) => `<option value="${esc(value)}" ${sel === value ? 'selected' : ''}>${esc(label)}</option>`;
  const groups = (settings().groups || []).filter(g => !isLegacyPersonalGroup(g)), types = studentTypes().filter(t => t !== STUDENT_CATEGORY);
  return opt('all', 'Everyone (all groups and student types)') +
    (groups.length ? `<optgroup label="Groups">${groups.map(g => opt('g:' + g, groupLabel(g))).join('')}</optgroup>` : '') +
    (types.length ? `<optgroup label="Other groups (student types)">${types.map(t => opt('t:' + t, t)).join('')}</optgroup>` : '') +
    opt('person', 'One person only...');
}
function updatePersonText() {
  const u = updateTarget.startsWith('p:') ? users().find(x => x.sn === updateTarget.slice(2)) : null;
  return u ? `${u.name} (${u.sn})` : '';
}
async function publishUpdate() {
  if (!hasPermission('updates') || uploadBusy) return;
  const title = $('ut').value.trim(), message = $('um').value.trim(), target = $('ug').value, filesToUpload = [...$('uf').files];
  let audience = target || 'all', recipientName = '';
  if (target === 'person') {
    const typed = $('uperson').value.trim().toLowerCase();
    const person = typed && users().find(x => `${x.name} (${x.sn})`.toLowerCase() === typed || String(x.sn).toLowerCase() === typed);
    if (!person) return say('Choose a person from the list, or type their student number.');
    audience = 'p:' + person.sn; recipientName = person.name;
  }
  const group = audience === 'all' ? 'All students' : audience.startsWith('g:') ? audience.slice(2) : '__targeted__'; // old app copies hide anything they cannot place
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
    await fs.collection('updates').doc(id).set({ id, title, message, group, audience, recipientName, files, created: Date.now(), createdBy: session.user });
    msg = ''; updateTarget = ''; render();
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
    say(esc(saveFail(e, 'send the ZIP')));
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
  const report = C.reports.find(x => x.id === id);
  if (report) { try { await syncExcusedAttendance(report, status); } catch (e) { say('The report was saved, but the register could not be updated. ' + saveFail(e, 'update the register')); } }
}
// An approved report puts the student in the register as attended (with signature, group and type). Rejecting it removes that entry.
async function syncExcusedAttendance(report, status) {
  const recId = `${report.date}_excused_${report.sn}`, ref = fs.collection('records').doc(recId);
  if (status !== 'approved') { await ref.delete(); return; }
  if (records().some(r => r.date === report.date && r.sn === report.sn && !r.excused)) return; // already signed in that day
  const u = users().find(x => x.sn === report.sn) || {}, studentType = attendanceTypeForProfile(u) || '';
  const group = studentType === STUDENT_CATEGORY && u.group && !isLegacyPersonalGroup(u.group) ? u.group : '';
  await ref.set({ id: recId, date: report.date, sn: report.sn, name: u.name || report.name, group, groupYear: groupYearFor(group), studentType,
    signature: u.signature || '', signedAt: Date.now(), pc: 'Excused', personal: false, excused: true, time: 'Approved report',
    reportId: report.id, reportType: report.type || '', reason: report.reason || '', approvedBy: session.user });
}
async function addApprovedToRegister() {
  if (!hasPermission('reports')) return;
  const list = liveReports().filter(r => r.status === 'approved');
  try { for (const r of list) await syncExcusedAttendance(r, 'approved'); say(`${list.length} approved report(s) checked and added to the register.`, true); }
  catch (e) { say(saveFail(e, 'update the register')); }
}
async function delReport(id) {
  if (!hasPermission('reports') || !confirm('Delete this report?')) return;
  await fs.collection('reports').doc(id).delete();
}

/* ---------- Downloads ---------- */
const safeName = value => String(value || 'file').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
const setExportStatus = text => { const el = $('exportStatus'); if (el) el.textContent = text; };
function reportName() {
  const b = rangeBounds();
  return b.from === b.to ? `WM-LPR-${b.from}` : `WM-LPR-${b.from}-to-${b.to}`;
}
const exportBase = () => reportName() + (range.scope ? '-' + safeName(scopeLabel(range.scope)) : '');
const periodLabel = () => { const b = rangeBounds(); return b.from === b.to ? b.from : `${b.from} to ${b.to}`; };
const rowsFor = list => list.map(r => [r.date, dayName(r.date), r.sn, r.name, attendanceCategory(r), pcLabel(r), r.time, r.returnedAt ? `${new Date(r.returnedAt).toLocaleString()}${r.returnedBy ? `; marked by ${r.returnedBy}` : '; staff not recorded'}` : (isP(r) ? noPcText(r) : 'Not returned'), r.signature ? 'Captured' : 'Not captured']);
const HEAD = ['Date', 'Day', 'Student no.', 'Name', 'Group / type', 'PC', 'Signed in', 'Returned at / staff', 'Signature'];
const HEAD_WIDTHS = [12, 11, 14, 26, 20, 12, 12, 22, 16];
function pcListSummary(list) {
  const assigned = list.filter(record => hasRecordedPc(record.pc) && !record.excused);
  const labAssignments = assigned.filter(record => !isP(record));
  const uniqueLabPcs = new Set(labAssignments.map(record => String(record.pc))).size;
  const personalAssignments = assigned.length - labAssignments.length;
  return `PC assignments: ${assigned.length} | Unique lab PCs: ${uniqueLabPcs} | Personal PC assignments: ${personalAssignments}`;
}
function safeSheet(name, used) {
  const base = String(name).replace(/[\\/?*\[\]:]/g, '-').trim().slice(0, 28) || 'Sheet';
  let n = base, i = 2;
  while (used.has(n.toLowerCase())) n = base.slice(0, 26) + ' ' + i++;
  used.add(n.toLowerCase());
  return n;
}
/* One row per person, one column per day, so a week or month reads as a single grid. */
function personMatrix(list) {
  const b = rangeBounds(), set = new Set();
  for (let d = parse(b.from); ymd(d) <= b.to && set.size < 400; d.setDate(d.getDate() + 1)) if (isWeekday(d)) set.add(ymd(d));
  list.forEach(r => set.add(r.date));
  const dates = [...set].sort(), people = new Map();
  users().filter(u => userInScope(range.scope, u)).forEach(u => people.set(u.sn, { sn: u.sn, name: u.name, category: u.group ? groupLabel(u.group) : (attendanceTypeForProfile(u) || '') }));
  list.forEach(r => { if (!people.has(r.sn)) people.set(r.sn, { sn: r.sn, name: r.name, category: attendanceCategory(r) }); });
  const head = ['Student no.', 'Name', 'Group / type', 'Days signed in', ...dates.map(d => `${dayName(d).slice(0, 3)} ${d}`)];
  const body = [...people.values()].sort((a, c) => String(a.name).localeCompare(String(c.name))).map(p => {
    const byDate = new Map(list.filter(r => r.sn === p.sn).map(r => [r.date, r]));
    return [p.sn, p.name, p.category, byDate.size, ...dates.map(d => byDate.has(d) ? pcLabel(byDate.get(d)) : '')];
  });
  return [head, ...body];
}
function exportXlsx() {
  if (!hasPermission('attendance')) return;
  const list = scopedRecords();
  if (!list.length) return setExportStatus('There are no sign-ins for those dates and that group / type.');
  const wb = XLSX.utils.book_new(), used = new Set();
  const add = (name, aoa, widths) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (widths) ws['!cols'] = widths.map(wch => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, safeSheet(name, used));
  };
  const buckets = range.scope ? [] : scopeBuckets(list).filter(x => x.list.length);
  if (buckets.length) {
    add('Summary', [
      ['Period', periodLabel()], [],
      ['Group / type', 'Sign-ins', 'People', 'Lab PCs', 'Personal PCs', 'Excused'],
      ...buckets.map(x => [x.label, x.list.length, new Set(x.list.map(r => r.sn)).size, x.list.filter(r => !isP(r)).length, x.list.filter(r => isP(r) && !r.excused).length, x.list.filter(r => r.excused).length]),
      ['Total', list.length, new Set(list.map(r => r.sn)).size, list.filter(r => !isP(r)).length, list.filter(r => isP(r) && !r.excused).length, list.filter(r => r.excused).length]
    ], [30, 12, 10, 10, 14, 10]);
  }
  add('Register', [HEAD, ...rowsFor(list)], HEAD_WIDTHS);
  add('By person', personMatrix(list), [14, 26, 20, 14]);
  buckets.forEach(x => add(x.label, [HEAD, ...rowsFor(x.list)], HEAD_WIDTHS));
  XLSX.writeFile(wb, exportBase() + '.xlsx');
  setExportStatus('Excel file downloaded.');
}
function exportPdf() {
  if (!hasPermission('attendance')) return;
  const list = scopedRecords();
  if (!list.length) return setExportStatus('There are no sign-ins for those dates and that group / type.');
  const doc = new jspdf.jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14); doc.text(`WM-LPR: ${scopeLabel(range.scope)}, ${periodLabel()}`, 14, 14);
  doc.setFontSize(9); doc.text(pcListSummary(list), 14, 20);
  const parts = range.scope ? [{ label: '', list }] : scopeBuckets(list).filter(x => x.list.length);
  let y = 25;
  parts.forEach(part => {
    if (part.label) {
      if (y > 175) { doc.addPage(); y = 15; }
      doc.setFontSize(11); doc.text(`${part.label} (${part.list.length})`, 14, y + 4); y += 7;
    }
    doc.autoTable({ head: [HEAD], body: rowsFor(part.list), startY: y, styles: { fontSize: 9 } });
    y = doc.lastAutoTable.finalY + 10;
  });
  doc.save(exportBase() + '.pdf');
  setExportStatus('PDF downloaded.');
}
let docxLoadPromise = null;
async function ensureDocxLibrary() {
  if (globalThis.docx && globalThis.docx.Packer && typeof globalThis.docx.Packer.toBlob === 'function') return globalThis.docx;
  if (!docxLoadPromise) docxLoadPromise = (async () => {
    let lastError;
    for (const src of [
      'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js',
      'https://unpkg.com/docx@8.5.0/build/index.umd.js'
    ]) {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      try {
        await new Promise((resolve, reject) => {
          script.addEventListener('load', resolve, { once: true });
          script.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
          document.head.appendChild(script);
        });
        if (globalThis.docx && globalThis.docx.Packer && typeof globalThis.docx.Packer.toBlob === 'function') return globalThis.docx;
        lastError = new Error('The DOCX library did not expose its browser API.');
      } catch (error) { lastError = error; }
      script.remove();
    }
    docxLoadPromise = null;
    throw lastError || new Error('Could not load the DOCX library.');
  })();
  return docxLoadPromise;
}
function wordCategoryForUser(user) {
  return attendanceTypeForProfile(user);
}
function wordCategoryForRecord(record) {
  if (record.studentType) return record.studentType;
  if (record.group && !isLegacyPersonalGroup(record.group)) return STUDENT_CATEGORY;
  const profile = users().find(user => user.sn === record.sn);
  return profile ? wordCategoryForUser(profile) : '';
}
const isLabRegister = (type, group) => type === STUDENT_CATEGORY && group === LAB_GROUP;
function matchesWordRegister(record, type, group) {
  if (isLabRegister(type, group)) return record.group === LAB_GROUP;
  return wordCategoryForRecord(record) === type && (type !== STUDENT_CATEGORY || !group || record.group === group);
}
function wordRegisterRoster(type, group, registerRecords) {
  const roster = new Map();
  users().filter(user => !isLabRegister(type, group) && wordCategoryForUser(user) === type && (type !== STUDENT_CATEGORY || !group || user.group === group))
    .forEach(user => roster.set(user.sn, user));
  registerRecords.filter(record => matchesWordRegister(record, type, group)).forEach(record => {
    if (!roster.has(record.sn)) roster.set(record.sn, { sn: record.sn, name: record.name });
  });
  return sortPeople([...roster.values()]);
}
function wordNameParts(person) {
  const names = String(person.name || '').trim().split(/\s+/).filter(Boolean);
  const surname = person.surname || names.pop() || '';
  return { firstNames: person.firstName || names.join(' '), surname };
}
function wordSignatureParagraph(record) {
  if (!record || !record.signature || !record.signature.startsWith('data:image/png;base64,')) return new docx.Paragraph({ children: [] });
  const data = Uint8Array.from(atob(record.signature.split(',')[1]), character => character.charCodeAt(0));
  return new docx.Paragraph({
    alignment: docx.AlignmentType.CENTER,
    children: [new docx.ImageRun({ data, transformation: { width: 72, height: 28 } })]
  });
}
function wordCell(text, width, header = false, alignment = docx.AlignmentType.LEFT) {
  return new docx.TableCell({
    width: { size: width, type: docx.WidthType.DXA },
    verticalAlign: docx.VerticalAlign.CENTER,
    margins: { top: 55, bottom: 55, left: 60, right: 60 },
    children: [new docx.Paragraph({
      alignment,
      children: [new docx.TextRun({ text: String(text || ''), bold: header, size: 16 })]
    })]
  });
}
function wordSignatureCell(record, width) {
  return new docx.TableCell({
    width: { size: width, type: docx.WidthType.DXA },
    verticalAlign: docx.VerticalAlign.CENTER,
    margins: { top: 35, bottom: 35, left: 35, right: 35 },
    children: [wordSignatureParagraph(record)]
  });
}
function buildWordRegisterTable(roster, recordsForRange, weekStartDate) {
  const columnWidths = [420, 2500, 2200, 2300, 1484, 1484, 1484, 1484, 1484];
  const header = ['#', 'NAMES OF THE LEARNER', 'SURNAME OF THE LEARNER', 'ID NUMBER OF THE LEARNER', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
  const rows = [new docx.TableRow({ tableHeader: true, children: header.map((label, i) => wordCell(label, columnWidths[i], true, docx.AlignmentType.CENTER)) })];
  roster.forEach((person, index) => {
    const parts = wordNameParts(person);
    const cells = [
      wordCell(index + 1, columnWidths[0], false, docx.AlignmentType.CENTER),
      wordCell(parts.firstNames, columnWidths[1]),
      wordCell(parts.surname, columnWidths[2]),
      wordCell(person.sn, columnWidths[3])
    ];
    for (let day = 0; day < 5; day++) {
      const date = new Date(weekStartDate); date.setDate(date.getDate() + day);
      const dateKey = ymd(date), record = recordsForRange.find(item => item.sn === person.sn && item.date === dateKey);
      cells.push(wordSignatureCell(record, columnWidths[4 + day]));
    }
    rows.push(new docx.TableRow({ cantSplit: true, children: cells }));
  });
  return new docx.Table({
    width: { size: 14840, type: docx.WidthType.DXA },
    columnWidths,
    rows,
    borders: {
      top: { style: docx.BorderStyle.SINGLE, size: 4, color: '333333' },
      bottom: { style: docx.BorderStyle.SINGLE, size: 4, color: '333333' },
      left: { style: docx.BorderStyle.SINGLE, size: 4, color: '333333' },
      right: { style: docx.BorderStyle.SINGLE, size: 4, color: '333333' },
      insideHorizontal: { style: docx.BorderStyle.SINGLE, size: 4, color: '777777' },
      insideVertical: { style: docx.BorderStyle.SINGLE, size: 4, color: '777777' }
    }
  });
}
async function buildWordRegister(type, group) {
  const registerRecords = inRange().filter(record => matchesWordRegister(record, type, group));
  const roster = wordRegisterRoster(type, group, registerRecords);
  const b = rangeBounds(), start = mondayOf(b.from), end = parse(b.to);
  const title = type === STUDENT_CATEGORY ? (group ? groupLabel(group) : 'All students') : type;
  const logoHeader = wordLogoHeader(logoKeyFor(type, group));
  const children = [
    ...(logoHeader ? [logoHeader] : []),
    new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, children: [new docx.TextRun({ text: `${title.toUpperCase()} ATTENDANCE REGISTER`, bold: true, size: 28 })] }),
    new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, children: [new docx.TextRun({ text: periodLabel(), bold: true, size: 22 })] }),
    new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, children: [new docx.TextRun({ text: `${roster.length} ${roster.length === 1 ? 'learner' : 'learners'} in this register`, size: 20 })] })
  ];
  let week = new Date(start), weekNumber = 1;
  while (week <= end) {
    const weekDate = ymd(week), friday = new Date(week); friday.setDate(friday.getDate() + 4);
    const weekRecords = registerRecords.filter(record => record.date >= weekDate && record.date <= ymd(friday));
    children.push(new docx.Paragraph({
      spacing: { before: 180, after: 80 },
      children: [new docx.TextRun({ text: `WEEK ${['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'][weekNumber - 1] || weekNumber} (${weekDate} - ${ymd(friday)})`, bold: true, size: 20 })]
    }));
    children.push(buildWordRegisterTable(roster, weekRecords, week));
    week.setDate(week.getDate() + 7); weekNumber++;
  }
  const document = new docx.Document({
    sections: [{
      properties: { page: { size: { orientation: docx.PageOrientation.LANDSCAPE }, margin: { top: 500, right: 500, bottom: 500, left: 500 } } },
      children
    }]
  });
  return docx.Packer.toBlob(document);
}
function scopeToWord(scope) {
  if (scope && scope.startsWith('g:')) return { type: STUDENT_CATEGORY, group: scope.slice(2) };
  if (scope && scope.startsWith('t:')) return { type: scope.slice(2), group: '' };
  return null;
}
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}
async function exportWordRegister() {
  if (!hasPermission('attendance')) return;
  const target = scopeToWord(range.scope);
  if (!target) { setExportStatus(range.scope === 'none' ? 'People without a group or student type have no register. Choose a group or student type.' : 'Choose a group or student type above, or use "Download all Word registers (ZIP)".'); return; }
  setExportStatus('Preparing the attendance register...');
  try {
    await ensureDocxLibrary();
    const blob = await buildWordRegister(target.type, target.group);
    saveBlob(blob, `${safeName(scopeLabel(range.scope))}-${safeName(periodLabel())}-WM-LPR.docx`);
    setExportStatus('Word attendance register downloaded.');
  } catch (e) { setExportStatus('Could not load the Word library or create the register. Check your connection and try again.'); }
}
async function exportAllWordRegisters() {
  if (!hasPermission('attendance')) return;
  setExportStatus('Preparing all attendance registers...');
  try {
    await ensureDocxLibrary();
    const zip = new JSZip(), inDates = inRange();
    let count = 0;
    for (const entry of scopeEntries(inDates).filter(e => !e.aggregate)) {
      const target = scopeToWord(entry.id), matching = inDates.filter(r => matchesWordRegister(r, target.type, target.group));
      if (!wordRegisterRoster(target.type, target.group, matching).length) continue;
      zip.file(`${safeName(entry.label)}-${safeName(periodLabel())}-WM-LPR.docx`, await buildWordRegister(target.type, target.group));
      count++;
    }
    if (!count) { setExportStatus('There are no groups or student types with people to put in a register.'); return; }
    saveBlob(await zip.generateAsync({ type: 'blob' }), `WM-LPR-all-registers-${safeName(periodLabel())}.zip`);
    setExportStatus(`Downloaded ${count} register(s) in one ZIP file.`);
  } catch (e) { setExportStatus('Could not create the registers. Check your connection and try again.'); }
}
function exportGroupPdf() {
  if (!hasPermission('attendance')) return;
  if (range.scope === 'none') return setExportStatus('People without a group or student type have no register. Choose a group or student type.');
  const inDates = inRange(), b = rangeBounds();
  const targets = range.scope
    ? [{ ...scopeToWord(range.scope), label: scopeLabel(range.scope) }]
    : scopeEntries(inDates).filter(e => !e.aggregate).map(e => ({ ...scopeToWord(e.id), label: e.label }));
  const doc = new jspdf.jsPDF({ orientation: 'landscape' });
  let pages = 0;
  targets.forEach(target => {
    const registerRecords = inDates.filter(r => matchesWordRegister(r, target.type, target.group));
    const roster = wordRegisterRoster(target.type, target.group, registerRecords);
    if (!roster.length) return;
    for (const week = mondayOf(b.from); week <= parse(b.to); week.setDate(week.getDate() + 7)) {
      const days = [0, 1, 2, 3, 4].map(i => { const d = new Date(week); d.setDate(week.getDate() + i); return ymd(d); });
      const weekRecords = registerRecords.filter(r => r.date >= days[0] && r.date <= days[4]);
      if (pages++) doc.addPage();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(`${target.label} attendance register`, 14, 14);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(`Week ${days[0]} to ${days[4]}  |  ${roster.length} ${roster.length === 1 ? 'person' : 'people'} in this register`, 14, 20);
      doc.autoTable({
        head: [['#', 'Names', 'Surname', 'ID number', ...['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((n, i) => `${n} ${days[i].slice(5)}`)]],
        body: roster.map((person, i) => {
          const parts = wordNameParts(person);
          return [i + 1, parts.firstNames, parts.surname, person.sn, ...days.map(d => { const r = weekRecords.find(x => x.sn === person.sn && x.date === d); return r && r.excused ? 'Excused' : ''; })];
        }),
        startY: 25,
        styles: { fontSize: 8, minCellHeight: 14, valign: 'middle' },
        columnStyles: { 0: { cellWidth: 8 }, 4: { cellWidth: 30 }, 5: { cellWidth: 30 }, 6: { cellWidth: 30 }, 7: { cellWidth: 30 }, 8: { cellWidth: 30 } },
        didDrawCell(data) {
          if (data.section !== 'body' || data.column.index < 4) return;
          const person = roster[data.row.index], r = weekRecords.find(x => x.sn === person.sn && x.date === days[data.column.index - 4]);
          if (r && r.signature && r.signature.startsWith('data:image/')) { try { doc.addImage(r.signature, 'PNG', data.cell.x + 2, data.cell.y + 2, 26, 10); } catch (e) { /* skip unreadable signature */ } }
        }
      });
    }
  });
  if (!pages) return setExportStatus('There are no people to put in a register for those dates and that group / type.');
  doc.save(`${exportBase()}-register.pdf`);
  setExportStatus('Signature register downloaded.');
}

start();

/* Version label: if you do not see this at the bottom of the page, your browser is still using an old copy */
(() => { const v = document.createElement('div'); v.textContent = 'Version 2026-10-06-i'; v.style.cssText = 'text-align:center;font-size:11px;opacity:.5;padding:8px'; document.body.appendChild(v); })();
