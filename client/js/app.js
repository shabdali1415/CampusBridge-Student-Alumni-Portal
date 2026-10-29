(() => {
'use strict';
/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, ''); else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};
const clear = (el) => { el.replaceChildren(); return el; };
const fmt = (d) => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
const fmtDay = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const initials = (n) => n.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
const label = (s) => String(s).replace('_', ' ');
function startsIn(d) {
  const ms = new Date(d) - Date.now();
  if (ms <= 0) return 'started';
  const m = Math.floor(ms / 60000), days = Math.floor(m / 1440), hrs = Math.floor((m % 1440) / 60);
  return days ? `starts in ${days}d ${hrs}h` : hrs ? `starts in ${hrs}h ${m % 60}m` : `starts in ${m}m`;
}

/* ---------- toast + modal ---------- */
function toast(msg, type = 'ok') {
  let box = $('.toasts'); if (!box) { box = h('div', { class: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: `toast ${type === 'error' ? 'toast--error' : ''}`, role: 'status' }, h('span', {}, (type === 'error' ? '⚠ ' : '✓ ') + msg),
    h('button', { 'aria-label': 'Dismiss', onclick: () => t.remove() }, '×'));
  box.append(t); setTimeout(() => t.remove(), 5000);
}
function confirmBox(title, text, yes = 'Yes') {
  return new Promise((resolve) => {
    const done = (v) => { m.remove(); resolve(v); };
    const m = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'modal__box' }, h('h3', {}, title), h('p', {}, text),
        h('div', { class: 'modal__actions' }, h('button', { class: 'btn btn--outline btn--sm', onclick: () => done(false) }, 'Cancel'),
          h('button', { class: 'btn btn--danger btn--sm', onclick: () => done(true) }, yes))));
    document.body.append(m); m.querySelector('.btn--danger').focus();
  });
}
function infoBox(title, nodes) {
  const m = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'modal__box' }, h('h3', {}, title), nodes, h('div', { class: 'modal__actions' }, h('button', { class: 'btn btn--primary btn--sm', onclick: () => m.remove() }, 'Close'))));
  document.body.append(m);
}

/* ---------- API ---------- */
let token = null;
async function raw(method, url, body, form) {
  const headers = {}; if (token) headers.Authorization = `Bearer ${token}`;
  let b; if (body !== undefined) { if (form) b = body; else { headers['Content-Type'] = 'application/json'; b = JSON.stringify(body); } }
  const res = await fetch(`/api${url}`, { method, headers, body: b, credentials: 'same-origin' });
  let data = null; try { data = await res.json(); } catch { /* not json */ }
  return { res, data };
}
async function call(method, url, body, form) {
  let r = await raw(method, url, body, form);
  const code = r.data && r.data.error && r.data.error.code;
  if (r.res.status === 401 && !url.startsWith('/auth/') && /^TOKEN_(EXPIRED|INVALID)$/.test(code || '') && await Auth.refresh()) r = await raw(method, url, body, form);
  if (!r.res.ok) {
    const er = (r.data && r.data.error) || {};
    throw Object.assign(new Error(er.message || 'Something went wrong. Please try again.'), { status: r.res.status, code: er.code, details: er.details });
  }
  return r.data;
}
const Api = { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b === undefined ? {} : b), put: (u, b) => call('PUT', u, b),
  patch: (u, b) => call('PATCH', u, b), del: (u) => call('DELETE', u), upload: (u, f) => call('POST', u, f, true) };
const live = { seatHandlers: [], start() { if (!window.io) return; const socket = window.io({ auth: { token } }); socket.on('seats', (snap) => live.seatHandlers.forEach((fn) => fn(snap))); socket.on('notification', (n) => toast(n.message)); }, onSeats(fn) { live.seatHandlers.push(fn); } };
const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== '' && v != null) p.set(k, v); const s = p.toString(); return s ? `?${s}` : ''; };

/* ---------- auth ---------- */
const HOME = { student: '/student-dashboard.html', alumni: '/alumni-directory.html', admin: '/admin.html' };
const Auth = {
  user: null,
  async refresh() {
    const { res, data } = await raw('POST', '/auth/refresh', {});
    if (res.ok) { token = data.data.accessToken; Auth.user = data.data.user; return true; }
    token = null; Auth.user = null; return false;
  },
  async login(email, password) {
    const d = await Api.post('/auth/login', { email, password });
    token = d.data.accessToken; Auth.user = d.data.user; return d.data.user;
  },
  async logout() { try { await Api.post('/auth/logout'); } catch { /* ignore */ } token = null; location.href = '/index.html'; },
  async requireRole(roles) {
    if (!Auth.user) { location.href = '/login.html'; return null; }
    if (!roles.includes(Auth.user.role)) { location.href = HOME[Auth.user.role] || '/index.html'; return null; }
    return Auth.user;
  },
};

/* ---------- chrome ---------- */
const PAGE = document.body.dataset.page;
const NAV = [['Home', '/index.html', 'home'], ['Events', '/events.html', 'events'], ['News', '/news.html', 'news'], ['Alumni', '/alumni-directory.html', 'alumni'], ['Jobs', '/jobs.html', 'jobs']];
const NAV_ACTIVE = { 'event-detail': 'events', 'my-registrations': 'events', 'student-dashboard': 'home', login: '', register: '' };
function chrome() {
  const u = Auth.user, active = NAV_ACTIVE[PAGE] !== undefined ? NAV_ACTIVE[PAGE] : PAGE;
  const right = u ? h('div', { class: 'userbar' }, h('span', { class: 'pill' }, u.role),
    h('a', { class: 'link', href: HOME[u.role] }, 'Dashboard'), h('a', { class: 'link', href: '/profile.html' }, 'Profile'),
    h('button', { class: 'btn btn--outline btn--sm', onclick: Auth.logout }, 'Sign out'))
    : h('div', { class: 'userbar' }, h('a', { class: 'btn btn--outline btn--sm', href: '/login.html' }, 'Sign in'), h('a', { class: 'btn btn--primary btn--sm', href: '/register.html' }, 'Create account'));
  $('#site-header').replaceChildren(h('div', { class: 'site-header__in container' },
    h('a', { class: 'brand', href: '/index.html' }, h('span', { class: 'brand__logo' }, '▣'), 'Campus Portal'),
    h('nav', { class: 'nav', 'aria-label': 'Main' }, NAV.map(([t, href, k]) => h('a', { href, class: k === active ? 'is-active' : '' }, t))), right));
  $('#site-header').className = 'site-header';
  const f = $('#site-footer');
  if (f) { const note = f.dataset.note || PAGE; f.replaceChildren(h('div', { class: 'container' }, h('span', {}, `Campus Portal · ${note}`), h('a', { href: f.dataset.link || '/index.html' }, f.dataset.linkText || 'Home'))); }
  if (u && !u.emailVerified) {
    const b = h('div', { class: 'banner' }, h('strong', {}, 'Confirm your email address'), 'Some features are locked until you click the verification link we emailed you.',
      h('button', { class: 'btn btn--outline btn--sm', onclick: async (e) => { e.target.disabled = true; try { const r = await Api.post('/auth/resend-verification'); toast(r.message); } catch (er) { toast(er.message, 'error'); } e.target.disabled = false; } }, 'Resend link'));
    $('#site-header').after(b);
  }
}
const empty = (title, text, action) => h('div', { class: 'empty card' }, h('div', { class: 'ico', style: 'margin:auto' }, '🎟'), h('h3', {}, title), h('p', {}, text), action || null);
const errorBox = (e) => h('div', { class: 'alert', role: 'alert' }, e.message);

/* ---------- shared renderers ---------- */
function seatsBlock(e) {
  const pct = Math.min(100, Math.round((e.confirmed / e.capacity) * 100)), full = e.seatsRemaining === 0;
  return [h('div', { class: `bar ${full ? 'full' : ''}` }, h('i', { style: `width:${pct}%` })), h('span', { class: 'meta' }, `${e.confirmed} of ${e.capacity} seats taken`),
    h('div', { class: 'seats' }, full ? h('span', { class: 'full' }, `● Full · ${e.waitlisted} waiting`) : h('span', { class: 'ok' }, `● ${e.seatsRemaining} seats left`),
      h('a', { href: `/event-detail.html?id=${e.id}`, class: 'meta' }, 'Details'))];
}
function eventCard(e) {
  const d = new Date(e.startsAt);
  return h('article', { class: 'card event-card', 'data-event-id': e.id },
    h('div', { class: `event-card__media cat-${e.category}` }, h('div', { class: 'datebadge' }, h('b', {}, String(d.getDate())), h('span', {}, d.toLocaleString('en-GB', { month: 'short' }))), h('span', { class: 'tag' }, e.category)),
    h('div', { class: 'event-card__body' }, h('h3', {}, e.title), h('p', {}, e.description), h('div', { class: 'meta' }, '🕒 ' + fmt(e.startsAt)), h('div', { class: 'meta' }, '📍 ' + e.venue),
      h('div', {}, h('span', { class: 'chip' }, '⏱ ' + startsIn(e.startsAt))), seatsBlock(e)));
}
const avatarEl = (name, src, cls = '') => h('div', { class: `avatar ${cls}` }, src ? h('img', { src, alt: '' }) : initials(name));
const badge = (s) => h('span', { class: `badge badge--${s}` }, s === 'confirmed' ? '✓ Confirmed' : s === 'cancelled' ? '✕ Cancelled' : s === 'waitlisted' ? '⏳ Waitlisted' : s);
const fieldErr = (form, err) => {
  form.querySelectorAll('.field-error').forEach((n) => n.remove());
  (err.details || []).forEach((d) => { const i = form.querySelector(`[name="${d.field}"]`); if (i) i.after(h('div', { class: 'field-error' }, d.message)); });
};

/* ---------- pages ---------- */
const pages = {};

pages.home = async () => {
  try {
    const { data } = await Api.get('/stats/public');
    const cells = [['events', 'Upcoming events'], ['alumni', 'Alumni network'], ['jobs', 'Open roles'], ['news', 'Campus news']];
    $('#live').replaceChildren(...cells.map(([k, t]) => h('div', { class: 'live__cell' }, h('b', {}, String(data[k])), h('span', {}, t))));
  } catch { /* stats are optional */ }
  if (Auth.user) { $('#cta-primary').textContent = 'Go to dashboard'; $('#cta-primary').href = HOME[Auth.user.role]; }
};

const pw = {
  rules: [['At least 8 characters', (v) => v.length >= 8], ['One uppercase letter', (v) => /[A-Z]/.test(v)], ['A lowercase letter or symbol', (v) => /[a-z!-\/:-@\[-`{-~]/.test(v)], ['At least one number', (v) => /[0-9]/.test(v)]],
  bind(input, meter, list) {
    const upd = () => { const ok = pw.rules.map(([, f]) => f(input.value)); meter.querySelectorAll('i').forEach((i, n) => i.classList.toggle('on', ok.filter(Boolean).length > n));
      list.querySelectorAll('li').forEach((li, n) => li.classList.toggle('ok', ok[n])); };
    input.addEventListener('input', upd); upd();
  },
};

pages.register = () => {
  if (Auth.user) { location.href = HOME[Auth.user.role]; return; }
  const form = $('#register-form'), msg = $('#form-msg');
  pw.bind($('#password'), $('.meter'), $('.rules'));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault(); msg.className = 'alert'; msg.textContent = ''; const f = new FormData(form);
    const body = Object.fromEntries(f.entries());
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    try { const r = await Api.post('/auth/register', body); form.reset(); pw.bind($('#password'), $('.meter'), $('.rules'));
      msg.className = 'alert alert--ok'; msg.replaceChildren(h('strong', {}, 'Account created. '), r.message); }
    catch (e) { msg.textContent = e.message; fieldErr(form, e); }
    btn.disabled = false;
  });
};

pages.login = () => {
  if (Auth.user) { location.href = HOME[Auth.user.role]; return; }
  const p = new URLSearchParams(location.search), err = $('#login-error');
  if (p.get('verified') === '1') { err.className = 'alert alert--ok'; err.textContent = 'Email confirmed. You can sign in now.'; }
  if (p.get('verified') === 'invalid') err.textContent = 'That verification link is invalid or has expired. Sign in and choose "Resend link".';
  $('#login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault(); err.className = 'alert'; err.textContent = '';
    const btn = ev.target.querySelector('button[type=submit]'); btn.disabled = true;
    try { const u = await Auth.login($('#email').value.trim(), $('#password').value); location.href = HOME[u.role]; }
    catch (e) { err.textContent = e.message; toast(e.message, 'error'); btn.disabled = false; }
  });
};

pages.forgot = () => $('#forgot-form').addEventListener('submit', async (ev) => {
  ev.preventDefault(); const m = $('#form-msg');
  try { const r = await Api.post('/auth/forgot-password', { email: $('#email').value.trim() }); m.className = 'alert alert--ok'; m.textContent = r.message; }
  catch (e) { m.className = 'alert'; m.textContent = e.message; }
});
pages.reset = () => {
  pw.bind($('#password'), $('.meter'), $('.rules'));
  $('#reset-form').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const m = $('#form-msg');
    try { const r = await Api.post('/auth/reset-password', { token: new URLSearchParams(location.search).get('token') || '', password: $('#password').value });
      m.className = 'alert alert--ok'; m.textContent = r.message; setTimeout(() => (location.href = '/login.html'), 1500); }
    catch (e) { m.className = 'alert'; m.textContent = e.message; }
  });
};

pages['student-dashboard'] = async () => {
  const u = await Auth.requireRole(['student']); if (!u) return;
  $('#welcome').textContent = `Welcome back, ${u.name.split(' ')[0]}`;
  const [sum, regs, news] = await Promise.all([Api.get('/events/me/summary'), Api.get('/events/me/registrations?filter=upcoming'), Api.get('/news?pageSize=3')]);
  const tiles = [['Active registrations', sum.data.confirmed + sum.data.waitlisted, 'Confirmed + waitlisted'], ['Upcoming events', sum.data.upcoming, 'Still ahead of you'], ['On waitlists', sum.data.waitlisted, 'Automatically promoted if a seat frees']];
  $('#stats').replaceChildren(...tiles.map(([t, v, s]) => h('div', { class: 'card stat' }, h('small', {}, t), h('b', {}, String(v)), h('span', {}, s))));
  const next = $('#next-events'); clear(next);
  if (!regs.data.length) next.append(empty('No upcoming events', 'You are not registered for anything yet. Find something you like and grab a seat.', h('a', { class: 'btn btn--primary btn--sm', href: '/events.html' }, 'Browse events')));
  else regs.data.slice(0, 4).forEach((e) => next.append(h('div', { class: 'row', style: 'padding:.6rem 0;border-top:1px solid var(--line)' },
    h('div', {}, h('a', { href: `/event-detail.html?id=${e.id}`, style: 'font-weight:700' }, e.title), h('div', { class: 'meta' }, fmt(e.startsAt))), badge(e.status))));
  const nl = $('#news-list'); clear(nl);
  news.data.items.forEach((n) => nl.append(h('div', { style: 'padding:.4rem 0' }, h('a', { class: 'item', href: '/news.html' }, n.title), h('div', { class: 'muted' }, `${fmt(n.createdAt)} · ${n.author}`))));
};

pages.events = async () => {
  const form = $('#events-filters'), grid = $('#events-grid'), pager = $('#pager'); let page = 1;
  try { (await Api.get('/events/categories')).data.forEach((c) => $('#category').append(h('option', { value: c }, c[0].toUpperCase() + c.slice(1)))); } catch { /* optional */ }
  const params = new URLSearchParams(location.search);
  for (const k of ['q', 'category', 'from', 'to']) if (params.get(k)) form.elements[k].value = params.get(k);
  async function load() {
    clear(grid); grid.append(h('p', { class: 'muted' }, 'Loading events…'));
    try {
      const f = Object.fromEntries(new FormData(form).entries());
      const { data } = await Api.get(`/events${qs({ ...f, page, pageSize: 9 })}`); clear(grid);
      if (!data.items.length) grid.append(empty('No events match', 'Try a different search or clear the filters.')); data.items.forEach((e) => grid.append(eventCard(e)));
      clear(pager); if (data.totalPages > 1) pager.append(h('button', { class: 'btn btn--outline btn--sm', disabled: page <= 1, onclick: () => { page--; load(); } }, 'Previous'),
        h('span', { class: 'muted' }, `Page ${data.page} of ${data.totalPages}`), h('button', { class: 'btn btn--outline btn--sm', disabled: page >= data.totalPages, onclick: () => { page++; load(); } }, 'Next'));
    } catch (e) { clear(grid); grid.append(errorBox(e)); }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); page = 1; load(); });
  $('#filters-clear').addEventListener('click', () => { form.reset(); page = 1; load(); });
  load();
};

pages['event-detail'] = async () => {
  const id = new URLSearchParams(location.search).get('id'), root = $('#detail');
  async function render() {
    clear(root);
    try {
      const { data: e } = await Api.get(`/events/${encodeURIComponent(id)}`); document.title = `${e.title} · Campus Portal`;
      const mine = e.myRegistration && e.myRegistration.status !== 'cancelled' ? e.myRegistration : null, actions = h('div', {});
      const doReg = async (btn) => { btn.disabled = true; try { const r = await Api.post(`/events/${e.id}/register`); toast(r.message); render(); } catch (er) { toast(er.message, 'error'); btn.disabled = false; } };
      if (!Auth.user) actions.append(h('a', { class: 'btn btn--pink btn--block', href: '/login.html' }, 'Sign in to register'));
      else if (Auth.user.role !== 'student') actions.append(h('p', { class: 'muted' }, 'Only student accounts can register for events.'));
      else if (mine) actions.append(h('p', {}, badge(mine.status), mine.status === 'waitlisted' ? ` Position ${mine.waitlistPosition} on the waitlist` : ''),
        mine.status === 'confirmed' ? h('button', { class: 'btn btn--outline btn--block', style: 'margin-bottom:.6rem', onclick: async () => { try { const { data: t } = await Api.get(`/events/${e.id}/ticket`); infoBox('Your event ticket', [h('p', { class: 'muted' }, `${t.title} · ${fmt(t.startsAt)} · ${t.venue}`), h('img', { src: t.qr, alt: 'Check-in QR code', style: 'display:block;margin:0 auto;max-width:100%' }), h('p', { style: 'text-align:center;word-break:break-all' }, t.checkedInAt ? `Checked in ${fmt(t.checkedInAt)}` : `Code: ${t.code}`)]); } catch (er) { toast(er.message, 'error'); } } }, 'Show my ticket (QR)') : null,
        h('button', { class: 'btn btn--danger btn--block', onclick: async () => {
          if (!(await confirmBox('Cancel your registration?', `Your place at "${e.title}" will be released. If you are later re-registered you may lose your waitlist position.`, 'Yes, cancel it'))) return;
          try { const r = await Api.del(`/events/${e.id}/register`); toast(r.message); render(); } catch (er) { toast(er.message, 'error'); } } }, 'Cancel my registration'));
      else { actions.append(h('button', { class: 'btn btn--pink btn--block', onclick: (ev) => doReg(ev.target) }, e.seatsRemaining ? 'Register for this event' : 'Join the waitlist'));
        if (e.myRegistration) actions.append(h('p', { class: 'muted', style: 'margin-top:.5rem' }, 'You had previously cancelled your place for this event.')); }
      const pct = Math.round((e.confirmed / e.capacity) * 100);
      root.append(h('a', { href: '/events.html', class: 'muted' }, '← Back to all events'), h('div', { class: 'grid grid--detail', style: 'margin-top:1rem' },
        h('div', { class: 'card' }, h('div', { class: 'row' }, h('span', { class: 'tag tag--soft' }, e.category), h('span', { class: 'chip' }, '⏱ ' + startsIn(e.startsAt))), h('h1', { style: 'margin-top:.8rem' }, e.title),
          h('div', { class: 'meta' }, '🕒 ' + fmt(e.startsAt)), h('div', { class: 'meta' }, '📍 ' + e.venue), h('div', { class: 'quote' }, e.description)),
        h('div', { class: 'grid' }, h('div', { class: 'card' }, h('h3', {}, 'Availability'), h('div', { class: `bar ${e.seatsRemaining ? '' : 'full'}` }, h('i', { style: `width:${pct}%` })),
          h('div', { class: 'meta' }, `${e.confirmed} of ${e.capacity} seats taken`), h('div', { class: 'seats' }, e.seatsRemaining ? h('span', { class: 'ok' }, `● ${e.seatsRemaining} seats left`) : h('span', { class: 'full' }, `● Full · ${e.waitlisted} waiting`))),
          h('div', { class: 'card' }, h('h3', {}, 'Actions'), actions))));
    } catch (er) { root.append(errorBox(er), h('a', { href: '/events.html' }, '← Back to all events')); }
  }
  render();
  live.onSeats((snap) => { if (String(snap.id) === String(id)) render(); });
};

pages['my-registrations'] = async () => {
  if (!(await Auth.requireRole(['student']))) return;
  const list = $('#reg-list'); let filter = 'active';
  const tabs = $('#reg-tabs'); tabs.replaceChildren(...['active', 'upcoming', 'past', 'all'].map((f) => h('button', { class: 'tab', role: 'tab', 'aria-selected': String(f === filter), onclick: () => { filter = f; tabs.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.f === f))); load(); }, 'data-f': f }, f[0].toUpperCase() + f.slice(1))));
  async function load() {
    clear(list);
    try {
      const { data } = await Api.get(`/events/me/registrations?filter=${filter}`);
      if (!data.length) return list.append(empty('Nothing here yet', 'Registrations you make will show up in this list.', h('a', { class: 'btn btn--primary btn--sm', href: '/events.html' }, 'Browse events')));
      data.forEach((e) => list.append(h('div', { class: 'card reg-item' }, h('div', {}, h('h3', {}, e.title), h('div', { class: 'meta' }, '🕒 ' + fmt(e.startsAt)), h('div', { class: 'meta' }, '📍 ' + e.venue), h('p', { class: 'seats' }, h('span', { class: 'ok' }, `● ${e.seatsRemaining} seats remaining`))),
        h('div', { style: 'text-align:right' }, badge(e.status), h('div', { class: 'muted', style: 'margin:.3rem 0' }, `Registered ${fmt(e.registeredAt)}`),
          h('div', { class: 'cell-actions', style: 'justify-content:flex-end' }, e.status !== 'cancelled' && new Date(e.startsAt) > new Date() ? h('button', { class: 'btn btn--ghost btn--sm', onclick: async () => {
            if (!(await confirmBox('Cancel your registration?', `Your place at "${e.title}" will be released.`, 'Yes, cancel it'))) return;
            try { toast((await Api.del(`/events/${e.id}/register`)).message); load(); } catch (er) { toast(er.message, 'error'); } } }, 'Cancel') : null,
            h('a', { class: 'btn btn--ghost btn--sm', href: `/event-detail.html?id=${e.id}` }, 'View'))))));
    } catch (e) { list.append(errorBox(e)); }
  }
  load();
};

pages.news = async () => {
  const list = $('#news-list'); let page = 1;
  async function load() {
    clear(list);
    try { const { data } = await Api.get(`/news?page=${page}&pageSize=8`);
      data.items.forEach((n) => list.append(h('article', { class: 'card', style: 'margin-bottom:.8rem' }, h('h3', {}, n.title), h('div', { class: 'muted' }, `${fmt(n.createdAt)} · ${n.author}`), h('p', { style: 'margin-top:.6rem' }, n.body))));
      if (!data.items.length) list.append(empty('No announcements yet', 'Check back soon.'));
      if (data.totalPages > 1) list.append(h('div', { class: 'pager' }, h('button', { class: 'btn btn--outline btn--sm', disabled: page <= 1, onclick: () => { page--; load(); } }, 'Newer'), h('button', { class: 'btn btn--outline btn--sm', disabled: page >= data.totalPages, onclick: () => { page++; load(); } }, 'Older')));
    } catch (e) { list.append(errorBox(e)); }
  }
  load();
};

pages['alumni-directory'] = async () => {
  const form = $('#alumni-filters'), grid = $('#alumni-grid');
  try { const { data } = await Api.get('/alumni/directory/filters');
    data.years.forEach((y) => $('#graduationYear').append(h('option', { value: y }, String(y)))); data.degrees.forEach((d) => $('#degree').append(h('option', { value: d }, d))); data.companies.forEach((c) => $('#company').append(h('option', { value: c }, c))); } catch { /* optional */ }
  async function load() {
    clear(grid);
    try {
      const { data } = await Api.get(`/alumni/directory${qs(Object.fromEntries(new FormData(form).entries()))}`);
      if (!data.items.length) return grid.append(empty('No alumni found', 'Try widening your filters.'));
      data.items.forEach((a) => { const btn = h('button', { class: 'btn btn--outline btn--sm', disabled: a.connected, onclick: async () => {
        if (!Auth.user) { location.href = '/login.html'; return; }
        try { toast((await Api.post(`/alumni/connect/${a.userId}`)).message); btn.disabled = true; btn.textContent = 'Requested'; } catch (er) { toast(er.message, 'error'); } } }, a.connected ? 'Requested' : 'Connect');
        grid.append(h('article', { class: 'card person' }, h('div', { class: 'person__top' }, avatarEl(a.name, a.avatar), h('div', {}, h('h3', { style: 'margin:0' }, a.name), h('div', { class: 'meta' }, `${a.jobTitle || 'Alumnus'}${a.company ? ' at ' + a.company : ''}`))),
          h('div', { class: 'tags' }, a.graduationYear ? h('span', { class: 'chip' }, `Class of ${a.graduationYear}`) : null, a.degree ? h('span', { class: 'chip' }, a.degree) : null, a.company ? h('span', { class: 'chip' }, a.company) : null, h('span', { class: 'chip' }, a.emailMasked)),
          h('p', { class: 'meta', style: 'margin:0' }, a.bio || ''), h('div', {}, btn))); });
    } catch (e) { grid.append(errorBox(e)); }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); load(); });
  $('#filters-clear').addEventListener('click', () => { form.reset(); load(); });
  load();
};

pages.jobs = async () => {
  const form = $('#jobs-filters'), list = $('#jobs-list');
  if (Auth.user && Auth.user.role === 'alumni') {
    $('#post-job').hidden = false;
    $('#job-form').addEventListener('submit', async (ev) => { ev.preventDefault(); const f = ev.target, m = $('#job-msg'); m.className = 'alert'; m.textContent = '';
      try { await Api.post('/jobs', Object.fromEntries(new FormData(f).entries())); f.reset(); toast('Job posted.'); load(); } catch (e) { m.textContent = e.message; } });
  }
  async function load() {
    clear(list);
    try {
      const { data } = await Api.get(`/jobs${qs(Object.fromEntries(new FormData(form).entries()))}`);
      if (!data.items.length) return list.append(empty('No open roles match', 'Try another search or job type.'));
      data.items.forEach((j) => list.append(h('article', { class: 'card job' }, h('div', {}, h('h3', {}, j.title), h('div', { class: 'meta' }, `🏢 ${j.company} · ${j.location}`), h('div', { class: 'muted', style: 'margin-top:.5rem' }, `Posted by ${j.postedBy}`)),
        h('div', { class: 'actions' }, h('span', { class: 'chip' }, label(j.jobType)), j.deadline ? h('span', { class: 'badge badge--cancelled' }, `Deadline: ${fmtDay(j.deadline)}`) : null,
          h('button', { class: 'btn btn--ghost btn--sm', onclick: () => infoBox(j.title, [h('p', { class: 'meta' }, `${j.company} · ${j.location}`), h('p', {}, j.description)]) }, 'Details'),
          h('button', { class: 'btn btn--primary btn--sm', onclick: async () => {
            if (!Auth.user) { location.href = '/login.html'; return; }
            try { toast((await Api.post(`/jobs/${j.id}/apply`)).message); } catch (er) { toast(er.message, 'error'); } } }, 'Apply'))))); 
    } catch (e) { list.append(errorBox(e)); }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); load(); });
  load();
};

pages.profile = async () => {
  if (!Auth.user) { location.href = '/login.html'; return; }
  const form = $('#profile-form'), msg = $('#form-msg');
  async function fill() {
    const { data: p } = await Api.get('/users/me');
    form.name.value = p.name; form.email.value = p.email; form.collegeId.value = p.collegeId || '';
    $('#avatar-slot').replaceChildren(avatarEl(p.name, p.avatar, 'avatar--lg'));
    $('#alumni-profile-fields').hidden = !p.alumni;
    if (p.alumni) { form.graduationYear.value = p.alumni.graduationYear || ''; form.degree.value = p.alumni.degree || ''; form.company.value = p.alumni.company || ''; form.jobTitle.value = p.alumni.jobTitle || ''; form.bio.value = p.alumni.bio || '';
      $('#approval-note').textContent = p.alumni.approved ? 'Your alumni profile is approved and visible in the directory.' : 'Your alumni profile is waiting for administrator approval.'; }
    $('#verify-note').hidden = p.emailVerified;
  }
  form.addEventListener('submit', async (ev) => { ev.preventDefault(); msg.className = 'alert'; msg.textContent = ''; const b = Object.fromEntries(new FormData(form).entries()); delete b.email;
    try { const r = await Api.put('/users/me', b); toast(r.message); fieldErr(form, { details: [] }); } catch (e) { msg.textContent = e.message; fieldErr(form, e); } });
  $('#avatar-form').addEventListener('submit', async (ev) => { ev.preventDefault(); const f = $('#avatar').files[0]; if (!f) return toast('Choose an image first.', 'error');
    const fd = new FormData(); fd.append('avatar', f); try { toast((await Api.upload('/users/me/avatar', fd)).message); fill(); } catch (e) { toast(e.message, 'error'); } });
  $('#resend').addEventListener('click', async () => { try { toast((await Api.post('/auth/resend-verification')).message); } catch (e) { toast(e.message, 'error'); } });
  fill();
};

/* ---------- admin ---------- */
pages.admin = async () => {
  if (!(await Auth.requireRole(['admin']))) return;
  const sections = ['events', 'users', 'alumni', 'reports', 'news', 'checkin', 'analytics'];
  const tabs = $('#admin-tabs');
  tabs.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { tabs.querySelectorAll('.tab').forEach((x) => x.setAttribute('aria-selected', String(x === t))); sections.forEach((s) => { const el = $(`#tab-${s}`); if (el) el.hidden = s !== t.dataset.target; }); if (t.dataset.target === 'checkin') loadAttendance(); if (t.dataset.target === 'analytics') loadAnalytics(); }));
  tabs.querySelector('.tab').setAttribute('aria-selected', 'true');
  const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, 'error'); } };

  const loadStats = guard(async () => {
    const s = (await Api.get('/admin/stats')).data;
    const tiles = [['Total users', s.users.total, `${s.users.students} students · ${s.users.alumni} alumni`], ['Total events', s.events.total, `${s.events.upcoming} upcoming`],
      ['Confirmed registrations', s.registrations.confirmed, `${s.registrations.waitlisted} waitlisted`], ['Approved alumni', s.alumni.approved, `${s.alumni.pending} awaiting approval`],
      ['Active jobs', s.jobs.active, `${s.jobs.total} posted in total`], ['Suspended accounts', s.users.suspended, `${s.users.admins} administrator`]];
    $('#admin-stats').replaceChildren(...tiles.map(([t, v, sub]) => h('div', { class: 'card stat' }, h('small', {}, t), h('b', {}, String(v)), h('span', {}, sub))));
  });
  let allEvents = [];
  const loadEvents = guard(async () => {
    allEvents = (await Api.get('/admin/events')).data;
    const ce = $('#checkin-event'); if (ce) { const cur = ce.value; ce.replaceChildren(...allEvents.map((e) => h('option', { value: e.id }, `${e.title} (${fmtDay(e.startsAt)})`))); if (cur) ce.value = cur; }
    const upcoming = allEvents.filter((e) => new Date(e.startsAt) >= new Date()).slice(0, 8);
    $('#upcoming-events').replaceChildren(h('div', { class: 'card', style: 'margin-top:1rem' }, h('h3', {}, 'Upcoming events at a glance'), h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Event', 'Date', 'Capacity', 'Confirmed', 'Waitlist', 'Seats left'].map((t) => h('th', {}, t)))),
      h('tbody', {}, upcoming.map((e) => h('tr', {}, h('td', {}, e.title), h('td', {}, fmt(e.startsAt)), h('td', {}, e.capacity), h('td', {}, e.confirmed), h('td', {}, e.waitlisted), h('td', {}, h('b', { style: `color:var(--${e.seatsRemaining ? 'ok' : 'pink-d'})` }, `● ${e.seatsRemaining}`)))))))));
    const tb = $('#events-table'); clear(tb);
    allEvents.forEach((e) => tb.append(h('tr', {}, h('td', {}, h('a', { href: `/event-detail.html?id=${e.id}` }, e.title)), h('td', {}, fmt(e.startsAt)), h('td', {}, e.category), h('td', {}, e.capacity), h('td', {}, e.confirmed), h('td', {}, `● ${e.seatsRemaining}`),
      h('td', {}, h('div', { class: 'cell-actions' }, h('button', { class: 'btn btn--outline btn--sm', onclick: () => editEvent(e) }, 'Edit'),
        h('button', { class: 'btn btn--outline btn--sm', onclick: guard(async () => { const m = prompt(`Message to everyone registered for "${e.title}":`); if (m) toast((await Api.post(`/admin/events/${e.id}/notify`, { message: m })).message); }) }, 'Notify'),
        h('button', { class: 'btn btn--danger btn--sm', onclick: guard(async () => { if (await confirmBox('Delete this event?', `"${e.title}" and all its registrations will be removed.`, 'Delete')) { await Api.del(`/admin/events/${e.id}`); toast('Event deleted.'); refresh(); } }) }, 'Delete'))))));
    const f = $('#event-filter'); const cur = f.value; f.replaceChildren(h('option', { value: '' }, 'All events'), ...allEvents.map((e) => h('option', { value: e.id }, e.title))); f.value = cur;
  });
  const ef = $('#event-form'); let editing = null;
  function editEvent(e) { editing = e.id; ef.title.value = e.title; ef.description.value = e.description; ef.category.value = e.category; ef.venue.value = e.venue; ef.capacity.value = e.capacity;
    const d = new Date(e.startsAt); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); ef.startsAt.value = d.toISOString().slice(0, 16);
    $('#event-form-title').textContent = 'Edit event'; $('#event-cancel').hidden = false; ef.scrollIntoView({ behavior: 'smooth' }); }
  const resetForm = () => { editing = null; ef.reset(); $('#event-form-title').textContent = 'Create a new event'; $('#event-cancel').hidden = true; $('#event-msg').textContent = ''; };
  $('#event-cancel').addEventListener('click', resetForm);
  ef.addEventListener('submit', async (ev) => { ev.preventDefault(); const m = $('#event-msg'); m.textContent = '';
    try { const b = Object.fromEntries(new FormData(ef).entries()); b.startsAt = new Date(b.startsAt).toISOString();
      const r = editing ? await Api.put(`/admin/events/${editing}`, b) : await Api.post('/admin/events', b); toast(r.message); resetForm(); refresh(); } catch (e) { m.textContent = e.message; } });

  const uf = $('#user-filters');
  const loadUsers = guard(async () => {
    const rows = (await Api.get(`/admin/users${qs(Object.fromEntries(new FormData(uf).entries()))}`)).data, tb = $('#users-table'); clear(tb);
    rows.forEach((u) => { const me = u.id === Auth.user.id;
      const sel = h('select', { class: 'select', disabled: me, 'aria-label': `Role for ${u.name}`, onchange: guard(async () => { await Api.patch(`/admin/users/${u.id}`, { role: sel.value }); toast('Role updated.'); refresh(); }) },
        ['student', 'alumni', 'admin'].map((r) => h('option', { value: r, selected: r === u.role }, r)));
      tb.append(h('tr', {}, h('td', {}, h('b', {}, u.name), h('div', { class: 'muted' }, u.collegeId || '')), h('td', {}, u.email), h('td', {}, sel),
        h('td', {}, h('span', { class: `badge badge--${u.verified ? 'yes' : 'no'}` }, u.verified ? 'Yes' : 'No')), h('td', {}, h('span', { class: `badge badge--${u.active ? 'active' : 'suspended'}` }, u.active ? 'Active' : 'Suspended')),
        h('td', {}, me ? '' : h('button', { class: `btn btn--sm ${u.active ? 'btn--danger' : 'btn--ok'}`, onclick: guard(async () => { await Api.patch(`/admin/users/${u.id}`, { active: !u.active }); toast(u.active ? 'User suspended.' : 'User reactivated.'); refresh(); }) }, u.active ? 'Suspend' : 'Reactivate')))); });
  });
  uf.addEventListener('submit', (e) => { e.preventDefault(); loadUsers(); }); $('#user-clear').addEventListener('click', () => { uf.reset(); loadUsers(); });

  const loadPending = guard(async () => {
    const rows = (await Api.get('/admin/alumni/pending')).data, box = $('#alumni-queue'); clear(box);
    if (!rows.length) return box.append(h('p', { class: 'muted' }, 'No profiles are waiting for review.'));
    const act = (u, a) => guard(async () => { toast((await Api.post(`/admin/alumni/${u.userId}/${a}`)).message); refresh(); });
    rows.forEach((u) => box.append(h('div', { class: 'card row', style: 'margin-bottom:.7rem' }, h('div', {}, h('h3', { style: 'margin:0' }, u.name), h('div', { class: 'meta' }, '✉ ' + u.email), h('div', { class: 'meta' }, `🎓 ${u.graduationYear || '?'} · ${u.degree || 'Degree not set'}`),
      h('div', { class: 'meta' }, `💼 ${u.company || 'Company not set'}${u.jobTitle ? ' · ' + u.jobTitle : ''}`), h('p', { class: 'meta' }, u.bio || '')),
      h('div', { class: 'cell-actions' }, h('span', { class: `badge badge--${u.verified ? 'yes' : 'no'}` }, u.verified ? 'Email verified' : 'Email not verified'), h('button', { class: 'btn btn--ok btn--sm', onclick: act(u, 'approve') }, 'Approve'), h('button', { class: 'btn btn--danger btn--sm', onclick: act(u, 'reject') }, 'Reject')))));
  });

  const rf = $('#report-filters');
  const loadReport = guard(async () => {
    const rows = (await Api.get(`/admin/registrations${qs(Object.fromEntries(new FormData(rf).entries()))}`)).data, tb = $('#report-table'); clear(tb);
    rows.forEach((r) => tb.append(h('tr', {}, h('td', {}, h('b', {}, r.student), h('div', { class: 'muted' }, r.collegeId || '')), h('td', {}, r.email), h('td', {}, r.event, h('div', { class: 'muted' }, fmtDay(r.eventDate))), h('td', {}, badge(r.status)), h('td', {}, fmt(r.registeredAt)))));
  });
  rf.addEventListener('submit', (e) => { e.preventDefault(); loadReport(); }); $('#report-clear').addEventListener('click', () => { rf.reset(); loadReport(); });
  $('#export-csv').addEventListener('click', guard(async () => {
    const q = qs(Object.fromEntries(new FormData(rf).entries())); const res = await fetch(`/api/admin/registrations.csv${q}`, { headers: { Authorization: `Bearer ${await tokenNow()}` } });
    if (!res.ok) throw new Error('Could not export the report.'); const url = URL.createObjectURL(await res.blob()); const a = h('a', { href: url, download: 'registrations.csv' }); document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url); }));
  async function tokenNow() { await Auth.refresh(); return token; }

  const loadNews = guard(async () => {
    const box = $('#news-admin'); clear(box); const rows = (await Api.get('/news?pageSize=20')).data.items;
    rows.forEach((n) => box.append(h('div', { class: 'row card', style: 'margin-top:.6rem' }, h('div', {}, h('b', {}, n.title), h('div', { class: 'muted' }, fmt(n.createdAt))), h('button', { class: 'btn btn--danger btn--sm', onclick: guard(async () => { await Api.del(`/admin/news/${n.id}`); toast('Announcement deleted.'); loadNews(); }) }, 'Delete'))));
  });
  $('#news-form').addEventListener('submit', async (ev) => { ev.preventDefault(); const m = $('#news-msg'); m.textContent = '';
    try { toast((await Api.post('/admin/news', Object.fromEntries(new FormData(ev.target).entries()))).message); ev.target.reset(); loadNews(); } catch (e) { m.textContent = e.message; } });

  const loadAttendance = guard(async () => {
    const evId = $('#checkin-event').value; if (!evId) return;
    const rows = (await Api.get(`/admin/events/${evId}/attendance`)).data, tb = $('#attendance-table'); clear(tb);
    $('#attendance-count').textContent = `${rows.filter(r => r.checkedInAt).length} of ${rows.length} checked in`;
    rows.forEach(r => tb.append(h('tr', {}, h('td', {}, r.name), h('td', {}, r.collegeId || ''), h('td', {}, badge(r.status)), h('td', {}, r.checkedInAt ? fmt(r.checkedInAt) : '-'))));
  });
  async function submitTicket(code) { const box=$('#checkin-result'); try { const r=await Api.post('/admin/checkin',{token:code.trim(),eventId:Number($('#checkin-event').value)||undefined}); box.className='alert alert--ok'; box.textContent=r.message; $('#checkin-code').value=''; loadAttendance(); } catch(e) { box.className='alert'; box.textContent=e.message; } }
  $('#checkin-event').addEventListener('change', loadAttendance);
  $('#checkin-submit').addEventListener('click', () => { const c=$('#checkin-code').value; if(c.trim()) submitTicket(c); });
  let cameraStream=null, scanning=false, lastScan='';
  async function startScanner() { if(!window.jsQR) throw new Error('QR scanner library is missing. Run npm install.'); const video=$('#scan-video'), canvas=document.createElement('canvas'), ctx=canvas.getContext('2d',{willReadFrequently:true}); cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}}); video.srcObject=cameraStream; await video.play(); video.hidden=false; scanning=true; $('#scan-toggle').textContent='Stop camera'; const tick=async()=>{if(!scanning)return;if(video.readyState===video.HAVE_ENOUGH_DATA){canvas.width=video.videoWidth;canvas.height=video.videoHeight;ctx.drawImage(video,0,0);const img=ctx.getImageData(0,0,canvas.width,canvas.height);const hit=window.jsQR(img.data,img.width,img.height);if(hit&&hit.data!==lastScan){lastScan=hit.data;await submitTicket(hit.data);setTimeout(()=>{lastScan='';},3000);}}if(scanning)requestAnimationFrame(tick);};tick(); }
  function stopScanner(){scanning=false;if(cameraStream)cameraStream.getTracks().forEach(t=>t.stop());$('#scan-video').hidden=true;$('#scan-toggle').textContent='Start camera';}
  $('#scan-toggle').addEventListener('click',guard(async()=>scanning?stopScanner():startScanner()));
  const loadAnalytics = guard(async()=>{const d=(await Api.get('/admin/analytics')).data;const sum=d.summary;$('#analytics-kpis').replaceChildren(...[['Registrations',sum.total_registrations],['Confirmed',sum.confirmed],['Waitlisted',sum.waitlisted],['Cancelled',sum.cancelled],['Checked in',sum.checked_in]].map(([t,v])=>h('div',{class:'card stat'},h('small',{},t),h('b',{},String(v)))));if(window.Chart){if(window._monthlyChart)window._monthlyChart.destroy();if(window._eventChart)window._eventChart.destroy();window._monthlyChart=new Chart($('#monthly-chart'),{type:'line',data:{labels:d.byMonth.map(x=>x.month),datasets:[{label:'Registrations',data:d.byMonth.map(x=>x.registrations),tension:.25}]},options:{responsive:true}});window._eventChart=new Chart($('#event-chart'),{type:'bar',data:{labels:d.byEvent.map(x=>x.title),datasets:[{label:'Registrations',data:d.byEvent.map(x=>x.registrations)}]},options:{responsive:true,indexAxis:'y'}});}});
  $('#analytics-refresh').addEventListener('click',loadAnalytics);
  $('#run-reminders').addEventListener('click',guard(async()=>{toast((await Api.post('/admin/reminders/run')).message);}));
  live.onSeats((snap)=>{const card=document.querySelector(`[data-event-id="${snap.id}"]`);if(card){Api.get(`/events/${snap.id}`).then(({data})=>card.replaceWith(eventCard(data))).catch(()=>{});}});
  function refresh() { loadStats(); loadEvents(); loadUsers(); loadPending(); loadReport(); loadNews(); }
  refresh();
};

/* ---------- boot ---------- */
(async () => {
  await Auth.refresh();           // restores the session from the refresh cookie (401 for visitors is expected)
  chrome();
  live.start();
  try { if (pages[PAGE]) await pages[PAGE](); } catch (e) { console.error(e); toast(e.message || 'Something went wrong.', 'error'); }
})();
})();
