/* YallaFlow console (v1.2.0): a local view of the Flow with one write, Create Work.
 * Data: GET /api/p/<project>/snapshot (yallaflow snapshot --json) and /work/<id>
 * (yallaflow work show --json). Stations, states and completion come from Core; this file
 * only renders them. Create Work posts to the server, which runs Core's own start/route/
 * intake add; every other action shows the exact CLI command instead.
 * Live: a streamed /api/events tells the page to re-read; differences animate. */
(function () {
  'use strict';
  const store = {
    get(k, d) { try { const v = localStorage.getItem('yfc.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('yfc.' + k, JSON.stringify(v)); } catch { /* unavailable */ } }
  };
  let lang = store.get('lang', 'ar');
  let theme = store.get('theme', null);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // POSIX single-quoted argument for a command shown to copy (spaces, quotes, Unicode).
  const shq = (v) => (/^[A-Za-z0-9_./:@%+=,-]+$/.test(String(v)) ? String(v) : `'${String(v).replace(/'/g, `'\\''`)}'`);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // IDs such as AC-002 inside Arabic text: isolate as LTR, never break at the hyphen.
  const iso = (s) => esc(s).replace(/\b([A-Z][A-Za-z]*)-(\d+)\b/g, '⁦$1‑$2⁩');
  const A = (ar, en) => (lang === 'ar' ? ar : en);

  // ---------- token: from the link printed by `yallaflow console` ----------
  let token = null;
  try { token = sessionStorage.getItem('yfc.token'); } catch { /* unavailable */ }
  const hashToken = /^#token=([0-9a-f]+)/.exec(location.hash);
  if (hashToken) {
    token = hashToken[1];
    try { sessionStorage.setItem('yfc.token', token); } catch { /* unavailable */ }
    history.replaceState(null, '', location.pathname + '#/map');
  }

  // ---------- stations ----------
  const ICON = {
    understand: '<path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z"/><path d="m20 20-4.2-4.2"/>',
    decide: '<path d="M12 3v4M5.6 7.6l2.8 2.8M3 14h4M17 14h4M15.6 10.4l2.8-2.8"/><path d="M8 21h8M12 17v4M9 17a3 3 0 1 1 6 0"/>',
    change: '<path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/>',
    verify: '<path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    remember: '<path d="M12 3 4 7l8 4 8-4-8-4Z"/><path d="m4 12 8 4 8-4"/><path d="m4 17 8 4 8-4"/>'
  };
  const ST = [
    { k: 'understand', hue: 'var(--s1)', name: { ar: 'افهم', en: 'Understand' }, gives: { ar: 'الفهم والأدلة', en: 'understanding & evidence' } },
    { k: 'decide', hue: 'var(--s2)', name: { ar: 'قرّر', en: 'Decide' }, gives: { ar: 'القرار والمواصفات', en: 'decision & spec' } },
    { k: 'change', hue: 'var(--s3)', name: { ar: 'نفّذ', en: 'Change' }, gives: { ar: 'التغيير', en: 'the change' } },
    { k: 'verify', hue: 'var(--s4)', name: { ar: 'اتحقّق', en: 'Verify' }, gives: { ar: 'الدليل', en: 'the proof' } },
    { k: 'remember', hue: 'var(--s5)', name: { ar: 'افتكر', en: 'Remember' }, gives: { ar: 'المعرفة', en: 'knowledge' } }
  ];
  const stIndex = (key) => ST.findIndex((s) => s.k === key);
  const L = (o) => (o == null ? '' : typeof o === 'string' ? o : o[lang] ?? o.en);
  const stName = (i) => (i >= 5 ? A('خلص', 'Done') : i < 0 ? A('جديد', 'New') : L(ST[i].name));
  const stHue = (i) => (i >= 5 ? 'var(--palm)' : i < 0 ? 'var(--ink-2)' : ST[i].hue);
  const STATE = {
    new: { ar: 'جديد', en: 'new' }, active: { ar: 'شغّال', en: 'working' }, you: { ar: 'مستنيك', en: 'waiting for you' },
    fail: { ar: 'فيه مشكلة', en: 'failing' }, paused: { ar: 'متوقف', en: 'idle' }, done: { ar: 'خلص', en: 'done' },
    todo: { ar: 'لسه', en: 'not yet' }, na: { ar: 'مش مطلوبة هنا', en: 'not needed here' },
    held: { ar: 'متوقفة مؤقتًا', en: 'on hold' }, closed: { ar: 'مقفولة من غير تسليم', en: 'closed, not delivered' }
  };
  const TYPE = { feature: { ar: 'ميزة', en: 'feature' }, bug: { ar: 'مشكلة', en: 'bug' }, investigation: { ar: 'بحث', en: 'investigation' }, change: { ar: 'تعديل', en: 'change' }, refactor: { ar: 'إعادة هيكلة', en: 'refactor' }, release: { ar: 'إصدار', en: 'release' } };
  const chip = (s) => `<span class="chip ${s === 'na' ? 'todo' : s === 'paused' ? 'idle' : s}">${s === 'na' ? '' : '<i></i>'}${L(STATE[s] ?? { ar: s, en: s })}</span>`;
  const fwd = () => (lang === 'ar' ? '←' : '→');
  const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
  const ago = (iso8601) => {
    if (!iso8601) return '';
    const m = Math.max(0, Math.round((Date.now() - Date.parse(iso8601)) / 60000));
    if (lang === 'en') return m < 1 ? 'now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
    if (m < 1) return 'دلوقتي';
    if (m < 60) return `من ${m} د`;
    if (m < 1440) return `من ${Math.round(m / 60)} س`;
    const d = Math.round(m / 1440);
    return d === 1 ? 'من يوم' : d === 2 ? 'من يومين' : `من ${d} أيام`;
  };
  const minutesSince = (iso8601) => (iso8601 ? (Date.now() - Date.parse(iso8601)) / 60000 : 0);
  // Only work waiting on a person or failing is flagged as waiting long; idle work is not a problem.
  const isOld = (it) => ['you', 'fail'].includes(it.state) && minutesSince(it.lastActivityAt) >= 180;
  const formula = () => A('كل محطة = 20%. المحطة الحالية بتتحسب بخطواتها اللي خلصت، والخطوة الجارية بنصها.', 'Each station = 20%. The current station counts its finished steps, plus half of the one in progress.');
  const ring = (p, size = 120, stroke = 12) => { const r = (size - stroke) / 2, c = 2 * Math.PI * r; return `<div class="ring" style="width:${size}px;height:${size}px" title="${esc(formula())}" role="img" aria-label="${p}%"><svg width="${size}" height="${size}" aria-hidden="true"><defs><linearGradient id="ringg" x1="0" x2="1"><stop offset="0" stop-color="#3d8bfd"/><stop offset=".5" stop-color="#0fae9d"/><stop offset="1" stop-color="#1d9a5a"/></linearGradient></defs><circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/><circle class="fill" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p / 100)}"/></svg><span class="num" style="font-size:${size / 4.2}px">${p}%</span></div>`; };

  // ---------- data ----------
  let projects = [];
  let unavailable = [];
  let readOnly = true; // until the server says creation is allowed
  let pid = store.get('project', null);
  let snap = null;
  let detail = null; // work show of the open item
  let error = null;

  async function api(pathname, as = 'json') {
    const response = await fetch(pathname, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!response.ok) {
      let body = null;
      try { body = await response.json(); } catch { /* not json */ }
      const failure = new Error(body?.error?.message ?? `HTTP ${response.status}`);
      failure.status = response.status;
      failure.command = body?.error?.command;
      throw failure;
    }
    return as === 'blob' ? response.blob() : as === 'text' ? response.text() : response.json();
  }

  async function load() {
    try {
      if (!projects.length) {
        const listed = await api('/api/projects');
        projects = listed.projects;
        unavailable = listed.unavailable ?? [];
        readOnly = listed.readOnly !== false;
        agentsOn = Boolean(listed.agents?.enabled);
        agentsCanEnable = Boolean(listed.agents?.canEnable);
        agentsClaudeAvailable = Boolean(listed.agents?.claudeAvailable);
        if (!projects.some((p) => p.id === pid)) pid = projects[0]?.id ?? null;
      }
      // No project yet (1.4.0): an empty console starts on project creation.
      if (!projects.length) {
        error = null;
        snap = { project: { name: '' }, items: [], invalid: [], counts: { new: 0, active: 0, you: 0, fail: 0, paused: 0, done: 0, held: 0, closed: 0 } };
        detail = null;
        return snap;
      }
      const next = await api(`/api/p/${pid}/snapshot`);
      const r = route();
      const nextDetail = r.v === 'item' ? await api(`/api/p/${pid}/work/${encodeURIComponent(r.id)}`).catch((e) => { if (e.status === 404 || e.status === 500) return null; throw e; }) : null;
      error = null;
      const previous = snap;
      snap = next;
      detail = nextDetail;
      return previous;
    } catch (e) {
      error = e;
      return snap;
    }
  }

  // ---------- views ----------
  const route = () => { const h = location.hash.replace(/^#\/?/, '').split('/'); return { v: h[0] || 'map', id: h[1] ? decodeURIComponent(h[1]) : null }; };
  const items = () => (snap?.items ?? []);
  const byId = (id) => items().find((it) => it.id === id);
  const curIndex = (it) => (it.state === 'done' ? 5 : it.state === 'new' ? -1 : stIndex(it.currentStation));

  function topbar(r) {
    const logo = '<svg width="32" height="32" viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"' + (lang === 'ar' ? '' : ' transform="matrix(-1 0 0 1 64 0)"') + '><path d="M28.5 15.5 12.5 32 28.5 48.5" stroke="#0fae9d"/><path d="M50.5 15.5 34.5 32 50.5 48.5" stroke="#5961e8"/></g></svg>';
    const tab = (href, label, on) => `<a href="${href}" ${on ? 'aria-current="page"' : ''}>${label}</a>`;
    const picker = projects.length > 1
      ? `<select class="projsel" data-project aria-label="${A('المشروع', 'Project')}">${projects.map((p) => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`
      : `<b class="projname">${esc(snap?.project?.name ?? projects[0]?.name ?? '')}</b>`;
    const count = snap ? needs().length : 0;
    return `<header class="top"><a class="brand" href="#/map">${logo} YallaFlow</a><div class="projpick">${picker}<a class="tiny muted" href="#/projects">${A('كل المشاريع', 'All projects')}</a></div>
      <nav class="tabs" aria-label="views">${tab('#/overview', A('المشروع', 'Overview'), r.v === 'overview')}${tab('#/map', A('التدفق', 'Flow'), r.v === 'map')}${tab('#/lines', A('الشغل', 'Work'), r.v === 'lines' || r.v === 'item')}${tab('#/setup', A('التشغيل', 'Setup'), r.v === 'setup')}${tab('#/team', A('نسخ الشغل', 'Worktrees'), r.v === 'team')}${tab('#/insights', A('الأرقام', 'Insights'), r.v === 'insights')}</nav>
      <span class="grow"></span>${!readOnly && projects.length ? `<button class="btn sm go create" data-create aria-label="${A('شغل جديد', 'Create work')}">＋<span class="lbl"> ${A('شغل جديد', 'Create work')}</span></button>` : ''}<span class="chip ${offline() ? 'fail' : 'active'}"><i></i>${offline() ? A('مفيش اتصال', 'offline') : A('مباشر', 'Live')}</span>
      <button class="ibtn bell" data-bell aria-expanded="${bellOpen}" aria-label="${A('محتاج انتباهك', 'Needs your attention')}">🔔${count ? `<b>${count}</b>` : ''}</button>
      <button class="ibtn" data-lang aria-label="language">${lang === 'ar' ? 'EN' : 'ع'}</button><button class="ibtn" data-theme-toggle aria-label="theme">◐</button>${bellOpen ? notesPanel() : ''}</header>`;
  }

  // Three different failures, never confused: the console itself is unreachable (offline),
  // the link lacks its token, or YallaFlow reported a problem in this project's records.
  const offline = () => Boolean(error) && !error.status;
  function banner() {
    if (!error) return '';
    if (error.status === 401) return `<section class="errbar" role="alert"><b>${A('الرابط ده محتاج التوكن', 'This link needs its token')}</b><p class="small">${A('افتح الرابط اللي طبعه الأمر yallaflow console في الترمينال.', 'Open the link printed by yallaflow console in your terminal.')}</p></section>`;
    if (offline()) return `<section class="errbar" role="alert"><b>${A('الكونسول مش متاح', 'The console is not reachable')}</b><p class="small">${A('اتأكد إن yallaflow console لسه شغّال في الترمينال. الصفحة هتحاول تاني لوحدها.', 'Check that yallaflow console is still running in your terminal. This page retries on its own.')}</p></section>`;
    return `<section class="errbar data" role="alert"><b>${A('YallaFlow مش قادر يقرا سجلات المشروع ده', 'YallaFlow cannot read this project\'s records')}</b><p class="small">${esc(error.message)}</p><p class="tiny muted">${A('الكونسول شغّال؛ المشكلة في بيانات المشروع. شغّل yallaflow doctor في فولدر المشروع للتفاصيل.', 'The console is running; the problem is in the project data. Run yallaflow doctor in the project folder for details.')}</p></section>`;
  }

  const openCount = () => items().filter((it) => it.state !== 'done').length;
  // No work recorded yet: a welcome, never an empty board with 0%.
  function onboarding() {
    const brownfieldNote = snap.project.kind === 'brownfield' ? `<p class="tiny muted" style="margin-top:6px">${A('في مشروع قايم بالفعل، YallaFlow بيطلب فهم المشروع والموافقة عليه الأول؛ الوكيل بيبدأه لوحده.', 'In an existing codebase, YallaFlow first asks for an approved project understanding; your agent starts it for you.')}</p>` : '';
    return `<section class="hero calm"><span class="hico" aria-hidden="true">＋</span><div><h1>${A('لسه مفيش شغل مسجّل', 'No work recorded yet')}</h1>
      <p>${A('اوصف للوكيل (Claude Code أو Codex) الميزة أو المشكلة أو التعديل. الشغلانة هتتسجّل في YallaFlow وتظهر هنا في بوابة «جديد».', 'Describe a feature, bug or change to your agent (Claude Code or Codex). The work item is recorded in YallaFlow and appears here in the New gate.')}</p>${brownfieldNote}${createButton()}</div></section>`;
  }
  function hero() {
    const c = snap.counts;
    const you = c.you;
    const open = openCount();
    const h = new Date().getHours();
    const greet = `${A(h < 12 ? 'صباح الخير' : 'مساء الخير', h < 12 ? 'Good morning' : 'Good evening')} 👋`;
    const stats = `<div class="stats"><div class="stat you"><b>${c.you}</b><span>◆ ${L(STATE.you)}</span></div><div class="stat active"><b>${c.new + c.active + c.paused}</b><span>● ${A('شغل مفتوح', 'open work')}</span></div><div class="stat fail"><b>${c.fail}</b><span>✕ ${L(STATE.fail)}</span></div><div class="stat done"><b>${c.done}</b><span>✓ ${L(STATE.done)}</span></div></div>`;
    // All recorded work is done: that is the recorded work, not the whole software project.
    if (!open) return `<section class="hero calm"><span class="hico done" aria-hidden="true">✓</span><div><h1>${A(`كل الشغل المسجّل خلص (${c.done})`, `All ${c.done} recorded work item${c.done === 1 ? ' is' : 's are'} done`)}</h1>
      <p>${A('ده الشغل المسجّل في YallaFlow، مش المشروع كله. الشغل الجديد بيدخل من بوابة «جديد».', 'This is the work recorded in YallaFlow, not the whole software project. New work enters through the New gate.')}</p>${createButton()}</div>${stats}</section>`;
    const pct = snap.openCompletion ?? 0;
    return `<section class="hero">${ring(pct, 128, 13)}<div><h1>${greet}</h1>
      <p>${A(`${open} ${open === 1 ? 'شغلانة مفتوحة' : 'شغلانات مفتوحة'} واصلة في المتوسط ${pct}%، و${you} ${you === 1 ? 'شغلانة مستنية' : 'شغلانات مستنية'} قرارك.`, `${open} open work item${open === 1 ? ' is' : 's are'} on average ${pct}% along, and ${you} item${you === 1 ? '' : 's'} wait${you === 1 ? 's' : ''} for your decision.`)}</p><p class="tiny muted" style="margin-top:6px">${A('النسبة للشغل المفتوح المسجّل بس.', 'The percentage covers open recorded work only.')} ${formula()}</p></div>
      ${stats}</section>`;
  }
  const createButton = () => (readOnly ? '' : `<button class="btn go" data-create style="margin-top:12px">＋ ${A('ابدأ أول شغلانة', 'Create work')}</button>`);
  // Work items YallaFlow cannot validate: visible, never counted as open, done or proven.
  function integrityPanel() {
    const bad = snap?.invalid ?? [];
    if (!bad.length) return '';
    return `<details class="panel integ"><summary><b>⚠ ${A(`${bad.length} ${bad.length === 1 ? 'شغلانة سجلاتها مش سليمة' : 'شغلانات سجلاتها مش سليمة'}، ومش محسوبة`, `${bad.length} work item${bad.length === 1 ? ' has' : 's have'} records YallaFlow cannot validate — not counted`)}</b></summary>
      <p class="small" style="margin-top:8px">${A('معروضة للشفافية بس: مش محسوبة كشغل مفتوح ولا خلص ولا متحقق منه، وسجلاتها ماتغيّرتش. شغّل yallaflow doctor في فولدر المشروع للتشخيص.', 'Shown for transparency only: not counted as open, done or proven work, and their records were not changed. Run yallaflow doctor in the project folder for the diagnosis.')}</p>
      <ul class="aclist" style="margin-top:8px">${bad.map((b) => `<li><span class="ltr tag">${esc(b.id)}</span><span class="grow">${b.title ? `<b>${esc(b.title)}</b><br>` : ''}<span class="tiny muted" dir="ltr">${esc(b.message)}</span></span></li>`).join('')}</ul></details>`;
  }

  // filters
  const flt = { q: '', st: 'all', type: 'all' };
  const openSt = new Set();
  const CAP = 4;
  const vis = (it) => (!flt.q || (it.title + ' ' + it.id).toLowerCase().includes(flt.q.toLowerCase())) && (flt.st === 'all' || it.state === flt.st) && (flt.type === 'all' || it.type === flt.type);
  function filterBar() {
    const c = (v, label) => `<button class="fchip ${flt.st === v ? 'on' : ''}" data-f="${v}">${label}</button>`;
    const shown = items().filter(vis).length;
    return `<section class="fbar" aria-label="${A('فلترة', 'Filter')}"><input type="search" data-q value="${esc(flt.q)}" placeholder="${A('دوّر بالاسم أو الرقم…', 'Search by title or ID…')}" aria-label="${A('بحث', 'Search')}">
      ${c('all', A('الكل', 'All'))}${c('you', '◆ ' + L(STATE.you))}${c('fail', '✕ ' + L(STATE.fail))}${c('active', '● ' + L(STATE.active))}${c('paused', L(STATE.paused))}
      <select data-ftype aria-label="${A('النوع', 'Type')}"><option value="all">${A('كل الأنواع', 'All types')}</option>${Object.keys(TYPE).map((k) => `<option value="${k}" ${flt.type === k ? 'selected' : ''}>${L(TYPE[k])}</option>`).join('')}</select>
      <span class="grow"></span><span class="tiny muted">${A(`${shown} من ${items().length}`, `${shown} of ${items().length}`)}</span></section>`;
  }

  function pchip(it) {
    const old = isOld(it);
    return `<article class="pchip ${it.state} ${old ? 'old' : ''}" data-w="${esc(it.id)}" ${readOnly ? '' : 'draggable="true"'}><a class="pbody" href="#/item/${encodeURIComponent(it.id)}" draggable="false"><span class="pid ltr">${esc(it.id)}</span><div class="tt">${esc(it.title)}</div>
      <div class="meta">${chip(it.state)}<span class="grow"></span><b>${it.completion}%</b></div><div class="mini"><i style="width:${it.completion}%"></i></div>
      <div class="badges">${it.lastActivityAt && it.state !== 'done' ? `<span class="bdg ${old ? 'old' : ''}">⏱ ${ago(it.lastActivityAt)}</span>` : ''}${it.sourceCount ? `<span class="bdg">📎 ${it.sourceCount}</span>` : ''}</div></a>
      <div class="pactions"><button type="button" class="pchat" data-chat-item="${esc(it.id)}" aria-label="${A('افتح الشات للطلب', 'Open chat for')} ${esc(it.id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h6"/></svg><span>${A('الشات', 'Chat')}</span></button>${readOnly || !itemActions(it).length ? '' : `<button type="button" class="pmenu" data-menu="${esc(it.id)}" aria-label="${A('أفعال', 'Actions')} ${esc(it.id)}" title="${A('أفعال الطلب', 'Work item actions')}">⋯</button>`}</div></article>`;
  }

  function viewMap() {
    const live = items().filter(vis);
    const recent = (x, y) => String(y.lastActivityAt ?? y.updatedAt ?? '').localeCompare(String(x.lastActivityAt ?? x.updatedAt ?? '')) || y.id.localeCompare(x.id);
    const at = (i) => live.filter((it) => curIndex(it) === i).sort(recent);
    // Bottleneck: the station where the most work waits on a person.
    const weight = ST.map((_, i) => at(i).filter((it) => it.state === 'you').length);
    const neck = Math.max(...weight) > 0 ? weight.indexOf(Math.max(...weight)) : -1;
    const entries = at(-1);
    const done = at(5);
    const empty = `<p class="tiny muted" style="text-align:center;margin-top:20px">—</p>`;
    const capped = (list, i) => `${(openSt.has(i) ? list : list.slice(0, CAP)).map(pchip).join('') || empty}${list.length > CAP ? `<button class="more" data-more-st="${i}">${openSt.has(i) ? A('أقل ↑', 'Less ↑') : A(`+${list.length - CAP} كمان`, `+${list.length - CAP} more`)}</button>` : ''}`;
    if (!items().length) return onboarding() + integrityPanel();
    const firstRun = items().every((it) => it.state === 'new') ? `<section class="panel firstrun" style="margin-bottom:14px"><b>${A('شغلك لسه في البوابة', 'Your work is at the gate')}</b><p class="small">${A('كل شغلانة جديدة بتستنى قبل المحطات. لما وكيلك يصنّفها (نوعها وحجمها)، بتدخل «افهم» وتعدّي على «قرّر» و«نفّذ» و«اتحقّق» و«افتكر» حسب اللي محتاجاه. المحطات الفاضية دي مش مشكلة.', 'Each new work item waits before the stations. Once your agent classifies it (type and size), it enters Understand and passes Decide, Change, Verify and Remember as needed. Empty stations are not a problem.')}</p>${items().slice(0, 3).map((it) => `<a class="btn sm" href="#/item/${encodeURIComponent(it.id)}">${esc(it.title)} →</a>`).join(' ')}</section>` : '';
    return digestCard() + hero() + firstRun + integrityPanel() + filterBar() + `<section class="map" id="map" aria-label="${A('التدفق', 'Flow')}">
      <div class="station gate start" data-st="-1" style="--hue:var(--ink-2)"><div class="st-head"><span class="st-ico" aria-hidden="true">＋</span><div class="st-name">${A('جديد', 'New')}</div><span class="st-n">${entries.length}</span></div><div class="st-out">${A('الطلبات بتدخل من هنا', 'Requests enter here')}</div>
        ${capped(entries, -1)}</div>
      ${ST.map((st, i) => `<div class="station ${i === neck ? 'neck' : ''}" data-st="${i}" style="--hue:${st.hue}"><div class="st-head"><span class="st-ico">${icon(st.k)}</span><div class="st-name">${L(st.name)}</div><span class="st-n">${at(i).length}</span></div><div class="st-out">${A('بيسلّم', 'hands off')} <b>${L(st.gives)}</b></div>
        ${i === neck ? `<span class="neckbadge">◆ ${A('عنق الزجاجة: هنا الشغل مستني', 'Bottleneck: work waits here')}</span>` : ''}${capped(at(i), i)}</div>`).join('')}
      <div class="station gate finish" data-st="5" style="--hue:var(--palm)"><div class="st-head"><span class="st-ico" aria-hidden="true">✓</span><div class="st-name">${A('خلص', 'Done')}</div><span class="st-n">${done.length}</span></div><div class="st-out">${A('اتسلّم واتأكد واتحفظ', 'Delivered, proven, remembered')}</div>${capped(done, 5)}</div>
      <div class="connectors" aria-hidden="true"></div></section>`;
  }

  function relay(it) {
    return `<div class="relay">${it.stations.map((s0, i) => { const s = it.routing === 'pending' && s0.status === 'na' ? { ...s0, status: 'todo' } : s0; const steps = s.steps.length || 1; const fill = s.status === 'done' || s.status === 'na' ? 1 : s.status === 'todo' ? 0 : (s.steps.filter((x) => x.status === 'done').length + 0.5 * s.steps.filter((x) => x.status === 'now').length) / steps; return `<div class="leg ${s.status}" style="--hue:${ST[i].hue}" title="${esc(L(ST[i].name))}: ${Math.round(fill * 100)}%"><div class="bar"><i style="width:${fill * 100}%"></i></div><div class="lbl">${s.status === 'done' ? '✓' : s.status === 'na' ? '–' : s.status === 'you' ? '◆' : s.status === 'fail' ? '✕' : s.status === 'todo' ? '' : '●'} ${L(ST[i].name)}</div></div>`; }).join('')}</div>`;
  }

  function viewLines() {
    const order = { you: 0, fail: 1, active: 2, paused: 3, held: 4, new: 5, done: 6, closed: 7 };
    const list = items().filter(vis).sort((a, b) => order[a.state] - order[b.state] || b.id.localeCompare(a.id));
    if (!items().length) return onboarding() + integrityPanel();
    return hero() + integrityPanel() + filterBar() + `<section class="lines">${list.map((it) => `<a class="line" href="#/item/${encodeURIComponent(it.id)}" data-w="${esc(it.id)}"><div><div class="row tiny muted"><span class="ltr">${esc(it.id)}</span><span>· ${L(TYPE[it.type] ?? { ar: '—', en: '—' })}</span>${it.stage ? `<span class="ltr">· ${esc(it.stage)}</span>` : ''}</div><div class="tt">${esc(it.title)}</div><div class="nx">${iso(nowText(it))}</div></div>${relay(it)}<div class="row">${chip(it.state)}${ring(it.completion, 62, 7)}</div></a>`).join('') || `<p class="muted">${A('مفيش شغل.', 'No work.')}</p>`}</section>`;
  }

  function nowText(it) {
    if (it.state === 'done') return A('خلص واتأكد.', 'Done and verified.');
    if (it.routing === 'pending') return A('الوكيل هيصنّف الطلب ده (النوع والحجم) ويكمّل.', 'Your agent classifies this request (type and size) and takes it from there.');
    if (it.waitingFor) return it.waitingFor.kind === 'review' ? A(`مستني مراجعتك (${it.waitingFor.gate}).`, `Waiting for your review (${it.waitingFor.gate}).`) : A(`مستني إجابتك على ${it.waitingFor.questions.join('، ')}.`, `Waiting for your answer to ${it.waitingFor.questions.join(', ')}.`);
    if (it.blocker) return it.blocker;
    return it.nextAction ?? '';
  }

  // ---------- item ----------
  let dtab = null; // null: Request for unclassified work, Delivery otherwise
  function viewItem(id) {
    const it = byId(id);
    const broken = (snap?.invalid ?? []).find((b) => b.id === id);
    if (!it && broken) return `<section class="errbar data" role="alert" style="margin-top:20px"><b><span class="ltr">${esc(id)}</span> — ${A('سجلات الشغلانة دي مش سليمة', 'This work item\'s records cannot be validated')}</b><p class="small ltr">${esc(broken.message)}</p><p class="tiny muted">${A('مش محسوبة في التدفق، وسجلاتها ماتغيّرتش. شغّل yallaflow doctor في فولدر المشروع للتشخيص.', 'It is not counted in the Flow and its records were not changed. Run yallaflow doctor in the project folder for the diagnosis.')}</p></section><a href="#/lines">${A('كل الشغل', 'All work')}</a>`;
    if (!it) return `<p class="muted" style="margin-top:30px">${A('الشغلانة دي مش موجودة.', 'This work item does not exist.')} <a href="#/lines">${A('كل الشغل', 'All work')}</a></p>`;
    const d = detail && detail.item.id === id ? detail : null;
    const i0 = curIndex(it);
    const headline = it.state === 'new' ? A('الطلب لسه داخل من البوابة', 'The request is entering the flow') : it.state === 'done' ? A('خلصت كل المحطات واتحفظت المعرفة ✓', 'Every station finished and knowledge saved ✓') : `${stName(i0)} · ${L(STATE[it.state])}`;
    const outFor = (key) => (d?.checkpoints ?? []).filter((c) => c.station === key && c.status === 'completed' && c.summary).sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt))).at(-1) ?? null;
    const knowledgeOut = () => { const k = d?.knowledge; if (!k) return null; const promoted = k.candidates.filter((c) => c.status === 'promoted'); return k.reviewStatus === 'reviewed' ? { summary: promoted.length ? A(`${promoted.length} معرفة اتحفظت للمشروع`, `${promoted.length} fact(s) saved to project memory`) : A('اتراجع ومفيش معرفة جديدة', 'Reviewed; no new knowledge'), completedAt: null } : null; };
    const actionCmd = it.waitingFor?.action ?? it.nextAction;
    return `<div class="row" style="margin-bottom:14px"><a class="btn ghost sm" href="#/lines">${lang === 'ar' ? '→' : '←'} ${A('كل الشغل', 'All work')}</a></div>
      <section class="ihead">${ring(it.completion, 132, 13)}<div><div class="row tiny muted"><span class="ltr">${esc(it.id)}</span><span>· ${L(TYPE[it.type] ?? { ar: 'لسه متصنفش', en: 'unrouted' })}</span>${it.scope ? `<span class="ltr">· ${esc(it.scope)}</span>` : ''}${it.stage ? `<span class="ltr">· ${esc(it.stage)}</span>` : ''}</div><h1>${esc(it.title)}</h1><p style="font-size:18px;color:var(--ink-2);margin-top:4px">${headline}</p><p class="tiny muted" style="margin-top:4px">${formula()}</p></div>
</section>
      ${nextCard(it)}
      ${actionBar(it)}
      <div class="row chatcue"><button class="btn sm" data-chat-toggle aria-controls="chatwin">💬 ${A('اشتغل على الشغلانة دي مع الوكيل', 'Work on this item with the agent')}</button></div>
      <section class="chain" id="chain"><article class="node start ${it.state === 'new' ? 'active' : 'done'}" data-st="-1" style="--hue:var(--ink-2)"><div class="st-head"><span class="st-ico" aria-hidden="true">＋</span><div class="st-name">${A('الطلب', 'Request')}</div></div><div class="st-out">${it.state === 'new' ? A('جديد', 'new') : A('اتسلّم لـ «افهم»', 'handed to Understand')}</div>
          <p class="small clamp3">${esc(d?.request?.raw ?? it.title)}</p>${(d?.sources ?? []).map((s) => `<button class="flink" data-file="${esc(s.id)}">${fileIcon(s)} <span class="ltr">${esc(s.name)}</span></button>`).join('')}<button class="flink more2" data-dtab="req" data-jump>${A('الطلب كامل ↓', 'Full request ↓')}</button>
          <div class="handoff"><span class="k">${A('اتعمل', 'Created')}</span>${ago(it.createdAt)}</div></article>${it.stations.map((s0, i) => {
        // An unclassified request has no workflow yet: its stations are "not yet", not "not needed".
        const s = it.routing === 'pending' && s0.status === 'na' ? { ...s0, status: 'todo' } : s0;
        const out = i === 4 ? knowledgeOut() : outFor(s.k ?? s.key);
        const nodeClass = s.status === 'paused' ? 'idle' : s.status === 'na' ? 'todo' : s.status;
        return `<article class="node ${nodeClass}" data-st="${i}" style="--hue:${ST[i].hue}"><div class="st-head"><span class="st-ico">${icon(ST[i].k)}</span><div class="st-name">${L(ST[i].name)}</div></div><div class="st-out">${A('بيسلّم', 'hands off')} ${L(ST[i].gives)}</div>
          ${chip(s.status)}${s.status !== 'done' && s.status !== 'todo' && s.status !== 'na' ? `<div class="prog"><i style="width:${Math.max(6, stationFill(s) * 100)}%"></i></div>` : ''}
          <ul class="subs">${s.steps.map((x) => `<li class="${x.status === 'done' ? 'done' : x.status === 'now' ? 'now' : ''}"><span class="ltr">${esc(x.id)}</span></li>`).join('')}</ul>
          ${i === i0 && it.state !== 'done' ? `<p class="small">${iso(nowText(it))}</p>` : ''}
          <div class="handoff">${s.status === 'na' ? `<span class="muted small">${A('البحث للقراءة بس، مفيش تغيير في الكود.', 'Investigations are read-only; no code changes.')}</span>` : out ? `<span class="k">${A('سلّم', 'handed off')} ${fwd()} ${stName(i + 1)}</span><button class="artlink" data-art="${i}" title="${A('افتح اللي اتسلّم', 'Open what was handed off')}">${iso(out.summary.length > 140 ? out.summary.slice(0, 140) + '…' : out.summary)} <span aria-hidden="true">↗</span></button>` : `<span class="k">${A('بيسلّم', 'hands off')}</span><span class="muted">${L(ST[i].gives)}…</span>`}</div></article>`;
      }).join('')}<article class="node finish ${it.state === 'done' ? 'done' : 'todo'}" data-st="5" style="--hue:var(--palm)"><div class="st-head"><span class="st-ico" aria-hidden="true">✓</span><div class="st-name">${A('خلص', 'Done')}</div></div><div class="st-out">${A('اتسلّم واتأكد واتحفظ', 'Delivered, proven, remembered')}</div>
          ${it.state === 'done' ? `<span class="chip done"><i></i>100%</span>${it.latestVerification ? `<p class="small"><span class="ltr">${esc(it.latestVerification.id)}</span> ${it.latestVerification.success ? A('نجح', 'passed') : A('فشل', 'failed')}</p>` : ''}` : `<p class="small muted">${A(`فاضل ${100 - it.completion}%`, `${100 - it.completion}% to go`)}</p>`}</article><div class="connectors" aria-hidden="true"></div></section>
      ${d ? detailsSection(it, d) : `<p class="muted" style="margin-top:20px">${A('بيحمّل التفاصيل…', 'Loading details…')}</p>`}
      <section class="panel" style="margin-top:20px"><h2 style="font-size:18px">${A('سجل التسليمات', 'Handoff history')}</h2><ul class="tl">${historyItems(d).join('') || `<li><span class="d"></span>${A('لسه مفيش تسليمات.', 'No handoffs yet.')}</li>`}</ul></section>
      ${devPanel(A('أوامر الشغلانة دي', 'Commands for this item'), [...(actionCmd ? [actionCmd] : []), `yallaflow guide ${it.id}`, `yallaflow work show ${it.id} --json`])}`;
  }

  // ---------- Agent Workspace (v1.3.0, opt-in): one panel for every provider ----------
  // Controls come only from the provider's capability record; the bridge never claims more.
  let agentsOn = false;
  let agent = null; // { pid, status, events: [] }
  let agentDraft = '';
  let agentBusy = false;
  let agentError = null;
  let agentProvider = null;
  let agentMode = 'workspace-write';
  let agentLaunch = null;
  const PROVIDER = { codex: 'Codex', claude: 'Claude Code' };
  const MODE_LABEL = {
    'read-only': { ar: 'قراءة بس، كل تغيير بيستأذن', en: 'Read-only: every change asks first' },
    'workspace-write': { ar: 'يعدّل ملفات المشروع من غير ما يسأل', en: 'Edits project files without asking' },
    default: { ar: 'يدوي: بيستأذن قبل الأفعال', en: 'Manual: asks before actions' },
    manual: { ar: 'يدوي: بيستأذن قبل الأفعال', en: 'Manual: asks before actions' },
    auto: { ar: 'تلقائي: Claude Code بيوافق على أغلب الأفعال بنفسه', en: 'Auto: Claude Code approves most actions itself' },
    acceptEdits: { ar: 'بيقبل التعديلات من غير ما يسأل', en: 'Accepts edits without asking' },
    plan: { ar: 'تخطيط بس', en: 'Plan only' },
    dontAsk: { ar: 'بيرفض أي حاجة محتاجة إذن', en: 'Denies anything that needs approval' },
    bypassPermissions: { ar: 'متخطي كل الأذونات: YallaFlow مش هيبعت رسايل للجلسة دي', en: 'Skips every permission: YallaFlow will not send messages to this session' }
  };
  const isForbidden = (mode) => /full-access|bypass|dangerous|yolo|skip/i.test(String(mode ?? ''));
  const autoApproves = (mode) => ['workspace-write', 'auto', 'acceptEdits'].includes(mode);
  async function agentPost(action, body) {
    return post(`/api/p/${pid}/agent/${action}`, JSON.stringify(body ?? {}), { 'Content-Type': 'application/json' });
  }
  async function loadAgent() {
    if (!agentsOn || route().v !== 'item') return;
    try { agent = { pid, ...(await api(`/api/p/${pid}/agent`)) }; agentError = null; } catch (e) { agentError = e.message; }
  }
  function onAgentEvent(projectId, event) {
    if (!agent || agent.pid !== projectId) return;
    agent.events.push(event);
    if (agent.events.length > 400) agent.events.splice(0, agent.events.length - 400);
    if (event.type === 'permission.requested') agent.pending.push(event);
    if (event.type === 'permission.resolved') agent.pending = agent.pending.filter((p) => p.requestId !== event.requestId);
    if (['session.started', 'session.ended', 'session.connected', 'session.disconnected', 'turn.started', 'turn.ended', 'mode.changed', 'work.activated', 'error'].includes(event.type)) {
      loadAgent().then(renderAgent);
      return;
    }
    renderAgent(event.type === 'message.delta');
  }
  // Re-render only the panel, keeping the composer text and focus.
  function renderAgent(streamOnly = false) {
    const host = document.getElementById('agent');
    const it = byId(route().id);
    if (!host || !it) return;
    const focused = document.activeElement?.matches?.('[data-agent-input]');
    const streamHost = streamOnly && host.querySelector('.astream');
    if (streamHost) {
      // Keep Stop/End and the composer in the DOM while message chunks arrive.
      // Replacing them every chunk can discard a pointer or keyboard interaction.
      const template = document.createElement('template');
      template.innerHTML = agentPanel(it);
      const nextStream = template.content.querySelector('.astream');
      if (nextStream) streamHost.innerHTML = nextStream.innerHTML;
      else host.outerHTML = agentPanel(it);
    } else host.outerHTML = agentPanel(it);
    // The floating button follows the session state (working, needs approval, ready).
    const fab = document.querySelector('.chatfab');
    if (fab && !streamOnly) { const t = document.createElement('template'); t.innerHTML = agentDock(it); const next = t.content.querySelector('.chatfab'); if (next) fab.replaceWith(next); }
    const stream = document.querySelector('#agent .astream');
    if (stream) stream.scrollTop = stream.scrollHeight;
    if (focused && !streamHost) { const box = document.querySelector('[data-agent-input]'); if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); } }
  }
  // Turn the event list into readable entries: message deltas join into one bubble.
  function agentEntries(events) {
    const out = [];
    let bubble = null;
    let repliedThisTurn = false;
    for (const ev of events) {
      if (ev.type === 'message.delta') { if (!bubble) { bubble = { kind: 'agent', text: '' }; out.push(bubble); } bubble.text += ev.text; continue; }
      bubble = null;
      if (ev.type === 'message.sent') { out.push({ kind: 'user', text: ev.text }); repliedThisTurn = false; }
      else if (ev.type === 'message.done') { out.push({ kind: 'agent', text: ev.text }); repliedThisTurn = true; }
      else if (ev.type === 'tool.started') out.push({ kind: 'tool', id: ev.toolCallId, title: ev.title, status: ev.status });
      else if (ev.type === 'tool.updated') { const t = [...out].reverse().find((x) => x.kind === 'tool' && x.id === ev.toolCallId); if (t) t.status = ev.status ?? t.status; }
      else if (ev.type === 'permission.requested') out.push({ ...ev, toolKind: ev.kind, kind: 'perm' });
      else if (ev.type === 'permission.resolved') { const p = out.find((x) => x.kind === 'perm' && x.requestId === ev.requestId); if (p) { p.decision = ev.decision; p.by = ev.by; } }
      else if (ev.type === 'permission.overridden') { const p = out.find((x) => x.kind === 'perm' && x.requestId === ev.requestId); out.push({ kind: 'note', warn: true, text: ev.detail }); if (p) p.overridden = true; }
      else if (ev.type === 'turn.ended') { if (ev.finalMessage && !repliedThisTurn) out.push({ kind: 'agent', text: ev.finalMessage }); if (ev.stopReason === 'cancelled') out.push({ kind: 'note', text: A('اتوقف.', 'Stopped.') }); }
      else if (ev.type === 'session.started') out.push({ kind: 'note', text: ev.resumed ? A('الجلسة رجعت.', 'Session resumed.') : A('الجلسة بدأت.', 'Session started.') });
      else if (ev.type === 'session.ended') {
        // Never a plain "ended" when processes the agent started could not be stopped.
        const left = ev.cleanup && ev.cleanup.complete === false ? ev.cleanup.survivors ?? [] : null;
        const base = ev.reason === 'crashed' ? A('الجلسة وقفت فجأة. تقدر ترجّعها.', 'The session stopped unexpectedly. You can resume it.') : A('الجلسة خلصت.', 'Session ended.');
        const c = ev.cleanup;
        const tail = left && left.length ? A(`بس فيه عمليات بدأها الوكيل لسه شغّالة وYallaFlow ماقدرش يوقفها: ${left.join('، ')}. اتأكد منها بنفسك.`, `But processes the agent started are still running and YallaFlow could not stop them: ${left.join(', ')}. Check them yourself.`)
          : c && c.verified === false ? A('YallaFlow وقّف الوكيل بس، وماقدرش يتأكد إن العمليات اللي بدأها وقفت. اتأكد بنفسك.', 'YallaFlow stopped the agent itself but could not check the processes it started. Check them yourself.')
          : c && (c.coverage === 'group' || ev.reason === 'crashed') ? A('العمليات اللي فصلت نفسها عن الجلسة مش بتتتبّع.', 'Processes that detached themselves from the session are not tracked.')
          : '';
        out.push({ kind: 'note', warn: ev.reason === 'crashed' || Boolean(left), text: tail ? `${base} ${tail}` : base });
      }
      else if (ev.type === 'session.connected') out.push({ kind: 'note', text: A('Claude Code متوصّل.', 'Claude Code connected.') });
      else if (ev.type === 'session.disconnected') out.push({ kind: 'note', warn: true, text: A('Claude Code اتفصل (الجلسة أو القناة وقفت).', 'Claude Code disconnected (the session or its channel stopped).') });
      else if (ev.type === 'work.activated') out.push({ kind: 'note', text: A(`${ev.workId} بقت الشغلانة النشطة.`, `${ev.workId} is now the active work item.`) });
      else if (ev.type === 'error') {
        // Plain words first; the provider's own text stays as a detail (PF-0059).
        const said = out.slice(-4).some((x) => x.kind === 'agent' && /usage limit|rate limit|try again at/i.test(x.text ?? ''));
        const text = said
          ? A('الوكيل وقف الرد ده: وصلت لحد الاستخدام في اشتراكك. جرّب تاني في الميعاد اللي فوق، أو اقفل الجلسة.', 'The agent stopped this reply: your subscription reached its usage limit. Try again at the time shown above, or end the session.')
          : A('الوكيل وقف الرد ده بسبب خطأ. تقدر تبعت رسالة تانية أو تقفل الجلسة.', 'The agent stopped this reply because of an error. You can send another message or end the session.');
        out.push({ kind: 'note', warn: true, text: `${text} \u2068(${ev.message})\u2069` });
      }
    }
    return out.slice(-80);
  }
  function permCard(p) {
    const open = !p.decision;
    const label = { allow: A('اتسمح', 'Allowed'), allow_session: A('اتسمح للجلسة', 'Allowed for this session'), deny: A('اترفض', 'Denied'), elsewhere: A('اتجاوب عليه في Claude Code', 'Answered in Claude Code') }[p.decision] ?? '';
    const by = p.by === 'timeout' ? A('(محدش ردّ، فاترفض تلقائي)', '(no answer, denied automatically)') : p.by && p.by !== 'user' && p.decision !== 'elsewhere' ? `(${esc(p.by)})` : '';
    const sentNote = p.provider === 'claude' && p.decision ? `<span class="tiny muted">${A('Claude Code بيطبّق أول رد يوصله (الكونسول أو الترمينال).', 'Claude Code applies the first answer it receives (console or terminal).')}</span>` : '';
    return `<div class="aperm ${open ? 'open' : ''}"><div class="row"><span class="ptag">${A('إذن للأداة', 'Tool permission')}</span><b class="grow">${esc(p.title)}</b></div>${p.detail ? `<pre class="pdetail" dir="ltr">${esc(p.detail)}</pre>` : ''}
      ${open ? `<div class="row">${p.decisions.map((d) => `<button class="btn sm ${d === 'deny' ? 'ghost' : 'go'}" data-agent-perm="${esc(p.requestId)}" data-decision="${d}">${{ allow: A('اسمح مرة', 'Allow once'), allow_session: A('اسمح للجلسة', 'Allow for session'), deny: A('ارفض', 'Deny') }[d]}</button>`).join('')}<span class="tiny muted">${A('لو محدش ردّ هيترفض تلقائي.', 'Unanswered requests are denied automatically.')}</span></div>` : `<div class="tiny ${p.overridden ? 'warn' : 'muted'}">${label} ${by}</div>${sentNote}`}</div>`;
  }
  // The agent chat as a floating window (owner choice, PF-0059): a corner button shows the
  // session state and opens the chat over the page. Open/closed is remembered per browser.
  let chatOpen = store.get('chatOpen', false);
  function agentState(it) {
    if (!agentsOn) return { tone: 'off', label: A('الوكيل مقفول', 'Agent off') };
    const s = agent?.pid === pid ? agent.session : null;
    const waiting = agent?.pid === pid ? (agent.pending ?? []).length : 0;
    if (waiting) return { tone: 'you', label: A(`الوكيل مستني إذنك (${waiting})`, `The agent needs your approval (${waiting})`), badge: waiting };
    if (!s) return { tone: 'idle', label: A('مفيش جلسة', 'No session') };
    if (s.workId && s.workId !== it.id) return { tone: 'idle', label: A(`جلسة على ${s.workId}`, `Session on ${s.workId}`) };
    if (s.status === 'working') return { tone: 'active', label: A('الوكيل شغّال…', 'The agent is working…') };
    return { tone: 'done', label: A('الوكيل جاهز', 'The agent is ready') };
  }
  function agentDock(it) {
    const st = agentState(it);
    return `<div class="chatdock ${chatOpen ? 'open' : ''}">
      <section class="chatwin" id="chatwin" role="dialog" aria-modal="false" aria-label="${A('الوكيل', 'Agent')}" ${chatOpen ? '' : 'hidden'}>
        <div class="chathead"><b class="grow">${A('الوكيل', 'Agent')} · <span class="ltr">${esc(it.id)}</span></b><span class="tiny muted">${esc(st.label)}</span><button type="button" class="ibtn sm" data-chat-toggle aria-label="${A('صغّر', 'Minimize')}">—</button></div>
        <div class="chatbody">${chatOpen ? agentPanel(it) : ''}</div>
      </section>
      <button type="button" class="chatfab ${st.tone}" data-chat-toggle aria-controls="chatwin" aria-expanded="${chatOpen}" aria-label="${esc(st.label)}" title="${esc(st.label)}"><span aria-hidden="true">${chatOpen ? '✕' : '💬'}</span><i class="dot"></i>${st.badge ? `<b class="badge">${st.badge}</b>` : ''}</button>
    </div>`;
  }
  // Suggested requests for the item's current place in the flow (PF-0059). A suggestion only
  // fills the message box: the developer reads it and sends it, nothing runs on a click.
  function suggestions(it) {
    const id = it.id;
    const list = [A(`${id} وصلت لفين، وإيه الخطوة الجاية؟`, `Where is ${id} now, and what is the next step?`)];
    const st = it.currentStation;
    if (it.state === 'held') list.push(A(`ليه ${id} متوقفة مؤقتاً، وإيه اللي محتاجه علشان نكمّل؟`, `Why is ${id} on hold, and what is needed to resume it?`));
    else if (it.state === 'closed') list.push(A(`لخّصلي ليه ${id} اتقفلت من غير تسليم.`, `Summarize why ${id} was closed without delivery.`));
    else if (it.state === 'done') list.push(A(`لخّصلي ${id} سلّمت إيه واتحققت إزاي.`, `Summarize what ${id} delivered and how it was verified.`));
    else if (it.state === 'new' || it.routing === 'pending') list.push(A(`صنّف ${id} (النوع والحجم) وقولّي ليه، قبل ما تبدأ.`, `Classify ${id} (type and size) and tell me why before you start.`));
    else if (it.waitingFor) list.push(A(`${id} مستنياني أقرر إيه؟ لخّصلي اللي محتاج أراجعه.`, `What decision is ${id} waiting for from me? Summarize what I need to review.`));
    else if (it.state === 'fail') list.push(A(`التحقق في ${id} فشل: اشرحلي السبب واقترح التصليح.`, `Verification failed on ${id}: explain why and propose a fix.`));
    else if (st === 'understand') list.push(A(`كمّل اكتشاف ${id} وقولّي لقيت إيه.`, `Continue discovery on ${id} and tell me what you found.`));
    else if (st === 'decide') list.push(A(`حضّرلي مواصفات ${id} علشان أراجعها.`, `Prepare the specification of ${id} for my review.`));
    else if (st === 'change') list.push(A(`كمّل تنفيذ ${id} وقولّي فاضل إيه.`, `Continue implementing ${id} and tell me what is left.`));
    else if (st === 'verify') list.push(A(`شغّل التحقق لـ ${id} واشرحلي النتيجة.`, `Run the verification for ${id} and explain the result.`));
    else if (st === 'remember') list.push(A(`راجع المعرفة اللي اتعلمناها من ${id} وقفلها.`, `Review what we learned from ${id} and finish it.`));
    return list;
  }
  function suggestionChips(it) {
    return `<div class="asugg" role="group" aria-label="${A('اقتراحات', 'Suggestions')}">${suggestions(it).map((text) => `<button type="button" class="sugg" data-suggest="${esc(text)}">${esc(text)}</button>`).join('')}</div>`;
  }
  function useSuggestion(text) {
    agentDraft = text;
    const box = document.querySelector('[data-agent-input]');
    if (box) { box.value = text; box.focus(); box.setSelectionRange(text.length, text.length); }
  }
  function toggleChat(force) {
    chatOpen = force ?? !chatOpen;
    store.set('chatOpen', chatOpen);
    render();
    if (chatOpen) { if (agentsOn && (!agent || agent.pid !== pid)) loadAgent().then(render); document.querySelector('#chatwin [data-agent-input], #chatwin button')?.focus(); }
    else document.querySelector('.chatfab')?.focus();
  }
  function agentPanel(it) {
    if (!agentsOn) return agentOffPanel(it);
    if (!agent || agent.pid !== pid) return `<section class="panel agent" id="agent"><p class="muted">${A('بيحمّل مساحة الوكيل…', 'Loading the agent workspace…')}</p></section>`;
    const s = agent.session;
    const provider = (id) => agent.providers.find((p) => p.id === id);
    const isActive = snap?.project?.activeWork === it.id;
    const activation = isActive ? `<span class="chip done"><i></i>${A('الشغلانة النشطة', 'Active work item')}</span>` : `<span class="tiny muted">${A('مش الشغلانة النشطة.', 'Not the active work item.')}</span> <button class="btn sm ghost" data-agent-activate="${esc(it.id)}">${A('خلّيها النشطة', 'Make it active')}</button>`;
    const head = `<div class="ahead"><h2>${A('الوكيل', 'Agent')}</h2><span class="grow"></span>${activation}</div>`;
    const err = agentError ? `<div class="errbar data small">${esc(agentError)}</div>` : '';
    if (!s && agent.lockedBy) return `<section class="panel agent" id="agent">${head}${err}<div class="awarn" role="status">${A('جلسات الوكيل في النسخة دي من المشروع تبع كونسول YallaFlow تاني شغّال. استخدمه، أو اقفله الأول.', 'Agent sessions in this checkout belong to another running YallaFlow console. Use that console, or stop it first.')}</div><p class="tiny muted" dir="ltr">${esc(agent.lockedBy.message)}</p></section>`;
    if (!s || (s.workId && s.workId !== it.id && s.provider === 'codex')) {
      if (s) return `<section class="panel agent" id="agent">${head}${err}<p class="small">${A(`فيه جلسة ${PROVIDER[s.provider]} شغّالة على`, `A ${PROVIDER[s.provider]} session is active for`)} <a href="#/item/${encodeURIComponent(s.workId)}" class="ltr">${esc(s.workId)}</a>. ${A('جلسة واحدة بس في كل نسخة من المشروع.', 'Only one agent session runs per checkout.')}</p></section>`;
      const choice = agentProvider ?? agent.providers.find((p) => p.ready)?.id ?? 'codex';
      const p = provider(choice);
      const picks = agent.providers.map((x) => `<label class="apick ${x.ready ? '' : 'off'}"><input type="radio" name="agentProvider" value="${x.id}" ${x.id === choice ? 'checked' : ''}><span><b>${PROVIDER[x.id]}</b>${x.experimental ? ` <i class="exp">${A('تجريبي', 'experimental')}</i>` : ''}<small>${x.ready ? (x.id === 'codex' ? A('اشتراك ChatGPT بتاعك', 'Your ChatGPT subscription') : A(`اشتراك Claude بتاعك${x.auth?.plan ? ` (${x.auth.plan})` : ''}`, `Your Claude subscription${x.auth?.plan ? ` (${x.auth.plan})` : ''}`)) : A('مش جاهز', 'Not ready')}</small></span></label>`).join('');
      const problems = p && !p.ready ? `<ul class="aprob">${p.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
      let action = '';
      if (p?.ready && p.capabilities.start) action = `<div class="row"><label class="small">${A('الصلاحيات', 'Permissions')} <select data-agent-mode>${p.capabilities.modes.map((m) => `<option value="${m}" ${m === agentMode ? 'selected' : ''}>${L(MODE_LABEL[m])}</option>`).join('')}</select></label><span class="grow"></span><button class="btn go" data-agent-start ${agentBusy ? 'disabled' : ''}>${A('ابدأ جلسة Codex', 'Start Codex session')}</button></div>${agent.resumable.length ? `<div class="tiny muted">${A('جلسات سابقة:', 'Earlier sessions:')} ${agent.resumable.map((r) => `<button class="linkbtn" data-agent-resume="${esc(r.id)}">${esc(r.workId ?? '—')} · ${ago(r.startedAt)}</button>`).join(' ')}</div>` : ''}`;
      else if (p?.ready && p.id === 'claude') action = `<div class="row"><span class="small grow">${A('Claude Code بيشتغل في الترمينال بتاعك باشتراكك. YallaFlow بيتوصّل بيه بس، مش بيشغّله.', 'Claude Code runs in your terminal with your subscription. YallaFlow connects to it; it never runs it.')}</span><button class="btn go" data-agent-connect ${agentBusy ? 'disabled' : ''}>${A('وصّل Claude Code', 'Connect Claude Code')}</button></div>`;
      return `<section class="panel agent" id="agent">${head}${err}<div class="apicks">${picks}</div>${problems}${action}<p class="tiny muted">${A('الوكيل بيستخدم اشتراكك الموجود بس، من غير مفاتيح API. أذونات الأدوات مش موافقات YallaFlow.', 'Agents use only your existing subscription, never API keys. Tool permissions are not YallaFlow approvals.')}</p></section>`;
    }
    const cap = provider(s.provider)?.capabilities ?? {};
    const modeChip = s.mode ? `<span class="chip ${autoApproves(s.mode) ? 'wait' : 'todo'}" title="${esc(L(MODE_LABEL[s.mode] ?? { ar: s.mode, en: s.mode }))}">${esc(s.mode)}</span>` : '';
    const warn = isForbidden(s.mode) ? `<div class="awarn" role="alert">⛔ ${esc(L(MODE_LABEL.bypassPermissions))}. ${A('غيّر الوضع من Claude Code.', 'Change the mode in Claude Code.')}</div>` : autoApproves(s.mode) ? `<div class="awarn">⚠ ${esc(L(MODE_LABEL[s.mode]))}. ${A('مش كل فعل هيظهر هنا كطلب إذن.', 'Not every action will appear here as a permission request.')}</div>` : '';
    // Claude Code takes messages only once a hook has reported its permission mode (PF-0065).
    const modePending = s.provider === 'claude' && s.connected && !s.mode;
    const state = s.provider === 'claude' && !s.connected ? A('مستني Claude Code', 'Waiting for Claude Code') : modePending ? A('مستني وضع الأذونات', 'Waiting for the permission mode') : s.status === 'working' ? A('شغّال…', 'Working…') : s.status === 'starting' ? A('بيبدأ…', 'Starting…') : A('جاهز', 'Ready');
    const controls = [
      cap.stop && s.status === 'working' ? `<button class="btn sm ghost" data-agent-cancel>${A('وقّف', 'Stop')}</button>` : '',
      cap.end ? `<button class="btn sm ghost" data-agent-end>${A('اقفل الجلسة', 'End session')}</button>` : '',
      s.provider === 'claude' ? `<button class="btn sm ghost" data-agent-disconnect>${A('افصل من YallaFlow', 'Unlink')}</button>` : ''
    ].join('');
    const launch = s.provider === 'claude' && !s.connected && agentLaunch ? `<div class="alaunch"><p class="small">${A('شغّل Claude Code بنفسك في فولدر المشروع بالأمر ده. Claude Code هيعرض تحذير القناة التجريبية والقرار ليك.', 'Start Claude Code yourself in the project folder with this command. Claude Code shows its own development-channel warning; the decision is yours.')}</p><pre class="cli" dir="ltr">${esc(agentLaunch)}</pre><button class="btn sm ghost" data-copy="${esc(agentLaunch)}">${A('انسخ', 'Copy')}</button></div>` : '';
    const entries = agentEntries(agent.events).map((e) => e.kind === 'user' ? `<div class="amsg me"><p>${esc(e.text)}</p></div>` : e.kind === 'agent' ? `<div class="amsg"><p>${esc(e.text)}</p></div>` : e.kind === 'tool' ? `<div class="atool ${e.status === 'failed' ? 'fail' : e.status === 'completed' ? 'done' : ''}"><span>${e.status === 'completed' ? '✓' : e.status === 'failed' ? '✕' : '●'}</span> ${esc(e.title)}</div>` : e.kind === 'perm' ? permCard(e) : `<div class="anote ${e.warn ? 'warn' : ''}">${esc(e.text)}</div>`).join('');
    const canSend = cap.send && (s.provider === 'codex' ? s.status === 'idle' : s.connected && !modePending);
    const modeHint = modePending ? `<div class="awarn" role="status">${A('Claude Code متوصّل، بس لسه ما بلّغش بوضع الأذونات بتاعه، فالرسايل مش هتتبعت لحد ما يبلّغ. بيبلّغ لما تكتب حاجة في Claude Code أو لما يستخدم أداة.', 'Claude Code is connected but has not reported its permission mode yet, so messages cannot be sent until it does. It reports it when you type in Claude Code or when it uses a tool.')}</div>` : '';
    return `<section class="panel agent" id="agent">${head}${err}
      <div class="abar"><b>${PROVIDER[s.provider]}</b>${s.provider === 'claude' ? ` <i class="exp">${A('تجريبي', 'experimental')}</i>` : ''}<span class="chip active"><i></i>${esc(state)}</span>${s.auth ? `<span class="chip todo">${esc(s.auth)}</span>` : ''}${modeChip}<span class="grow"></span>${controls}</div>
      ${warn}${modeHint}${launch}
      <div class="astream" aria-live="polite">${entries || `<p class="tiny muted">${A(`اكتب للوكيل، مثلاً: «كمّل ${it.id}».`, `Message the agent, for example: "Continue ${it.id}".`)}</p>`}</div>
      ${suggestionChips(it)}<form class="acompose" data-agent-form><textarea data-agent-input rows="2" maxlength="20000" placeholder="${A(`اكتب لـ ${PROVIDER[s.provider]}…`, `Message ${PROVIDER[s.provider]}…`)}" ${canSend ? '' : 'disabled'}>${esc(agentDraft)}</textarea><button class="btn go" type="submit" ${canSend && !agentBusy ? '' : 'disabled'}>${A('ابعت', 'Send')}</button></form>
      ${s.provider === 'claude' ? `<p class="tiny muted">${A('الإيقاف والإنهاء بيتعملوا من Claude Code نفسه (Esc). الردود بتوصل كرسايل كاملة.', 'Stop and end happen in Claude Code itself (Esc). Replies arrive as whole messages.')}</p>` : ''}</section>`;
  }
  // Returns false when the action failed. Its error survives the state reload that follows
  // (loadAgent clears agentError on success), so a refused send is never silent (PF-0065).
  async function agentAction(action, body, after) {
    agentBusy = true; agentError = null; renderAgent();
    let failed = null;
    try { const result = await agentPost(action, body); await after?.(result); } catch (e) { failed = e.message; }
    agentBusy = false;
    await loadAgent();
    if (failed) agentError = failed;
    renderAgent();
    return !failed;
  }

  // The one thing to do next, in plain words, from Core's verdict (never computed here).
  // ---------- work management (1.4.0): every action is Core's own command ----------
  // The console never decides a move: it asks Core (through the server) and shows Core's answer.
  const ACTION_LABEL = {
    activate: { ar: 'خلّيها النشطة', en: 'Make it active' }, advance: { ar: 'كمّل للمرحلة الجاية', en: 'Advance' },
    hold: { ar: 'وقّفها مؤقتًا…', en: 'Put on hold…' }, resume: { ar: 'كمّل الشغل عليها', en: 'Resume' },
    close: { ar: 'اقفلها من غير تسليم…', en: 'Close without delivery…' }, reopen: { ar: 'افتحها تاني…', en: 'Reopen…' },
    revise: { ar: 'عدّل الطلب…', en: 'Edit request…' }, answer: { ar: 'جاوب…', en: 'Answer…' }
  };
  function itemActions(it) {
    if (readOnly) return [];
    const lifecycle = it.lifecycle?.state;
    if (lifecycle === 'on_hold') return ['resume', 'close'];
    if (lifecycle === 'closed') return ['reopen'];
    if (it.state === 'done') return ['reopen'];
    const list = [];
    if (snap?.project?.activeWork !== it.id) list.push('activate');
    if (it.requestEditable) list.push('revise');
    if (it.routing !== 'pending') list.push('advance');
    if (it.waitingFor?.kind === 'question') list.push('answer');
    list.push('hold', 'close');
    return list;
  }
  function actionBar(it) {
    const acts = itemActions(it);
    if (!acts.length && !(it.waitingFor?.kind === 'review' && !readOnly)) return '';
    const blocked = it.blocker && it.state !== 'done' && !it.lifecycle;
    const gate = it.waitingFor?.kind === 'review' && !readOnly ? `<button class="btn sm go" data-gate="${esc(it.waitingFor.gate)}" data-gate-item="${esc(it.id)}">${A(`راجع وقرّر (${it.waitingFor.gate})`, `Review and decide (${it.waitingFor.gate})`)}</button>` : '';
    return `<section class="actbar" aria-label="${A('أفعال الشغلانة', 'Work item actions')}">${gate}${acts.map((a) => {
      const off = a === 'advance' && blocked;
      return `<button class="btn sm ${a === 'close' ? 'ghost danger' : 'ghost'}" data-act="${a}" data-act-item="${esc(it.id)}" ${off ? `aria-disabled="true" title="${esc(it.blocker)}"` : ''}>${L(ACTION_LABEL[a])}</button>`;
    }).join('')}${blocked ? `<p class="tiny muted why">${A('ليه مش هتكمّل دلوقتي:', 'Why it can\'t advance yet:')} ${iso(it.blocker)}${it.nextAction ? ` · <span class="ltr">${esc(it.nextAction)}</span>` : ''}</p>` : ''}${it.lifecycle ? `<p class="tiny muted why">${esc(it.blocker ?? '')}</p>` : ''}</section>`;
  }

  // One dialog for every action; fields follow the action. Core's refusal is shown as-is.
  function actionFields(kind, it, request = '') {
    const area = (name, label, required = true) => `<label class="fld">${label}<textarea name="${name}" rows="3" maxlength="10000" ${required ? 'required' : ''}></textarea></label>`;
    if (kind === 'hold') return area('reason', A('السبب', 'Reason'));
    if (kind === 'resume') return area('note', A('ملاحظة (اختياري)', 'Note (optional)'), false);
    if (kind === 'revise') return `<p class="small muted">${A('تقدر تعدّل الطلب طالما الشغل لسه ما بدأش. النسخة القديمة والمرفقات هيفضلوا محفوظين.', 'You can edit the request until work starts. Previous versions and attachments are kept.')}</p><label class="fld">${A('الطلب بعد التعديل', 'Revised request')}<textarea name="text" rows="6" maxlength="20000" required>${esc(request)}</textarea></label>${area('reason', A('السبب', 'Reason'))}`;
    if (kind === 'answer') return `<label class="fld">${A('السؤال', 'Question')}<select name="question">${(it.waitingFor?.questions ?? []).map((q) => `<option>${esc(q)}</option>`).join('')}</select></label>${area('answer', A('الإجابة', 'Answer'))}`;
    if (kind === 'close') return `<label class="fld">${A('النتيجة', 'Outcome')}<select name="outcome"><option value="cancelled">${A('اتلغت', 'Cancelled')}</option><option value="superseded">${A('اتبدّلت بشغلانة تانية', 'Superseded by another item')}</option><option value="duplicate">${A('مكررة', 'Duplicate of another item')}</option></select></label><label class="fld">${A('الشغلانة البديلة (للمستبدلة أو المكررة)', 'The other item (for superseded or duplicate)')}<input name="by" class="ltr" placeholder="PF-0000" pattern="PF-[A-Za-z0-9-]+"></label>${area('reason', A('السبب', 'Reason'))}<p class="tiny muted">${A('الشغل المقفول عمره ما بيتحسب متسلّم ولا متحقق منه.', 'Closed work is never counted as delivered or verified.')}</p>`;
    if (kind === 'reopen') return `${it.state === 'done' ? `<label class="fld">${A('افتحها على', 'Reopen to')}<select name="to"><option value="implementation">${A('التنفيذ', 'Implementation')}</option><option value="verification">${A('التحقق', 'Verification')}</option><option value="review">${A('المراجعة', 'Review')}</option></select></label>` : ''}${area('reason', A('السبب', 'Reason'))}`;
    return `<p>${A('YallaFlow هيشغّل الأمر ده دلوقتي.', 'YallaFlow runs this command now.')}</p>`;
  }
  function openAction(kind, id, preset = {}) {
    const it = byId(id);
    if (!it || readOnly) return;
    document.querySelector('dialog.act')?.remove();
    const d = document.createElement('dialog');
    d.className = 'create act';
    d.setAttribute('aria-labelledby', 'act-h');
    d.innerHTML = `<form data-act-form="${esc(kind)}" data-act-item="${esc(id)}" novalidate><div class="row"><h2 id="act-h" class="grow">${L(ACTION_LABEL[kind])}</h2><button type="button" class="btn ghost sm" data-act-cancel>${A('إلغاء', 'Cancel')}</button></div><p class="tiny muted ltr">${esc(id)} — ${esc(it.title)}</p>${actionFields(kind, it)}<div class="confirm" hidden></div><div class="errbar small" role="alert" hidden></div><div class="row"><span class="grow"></span><button class="btn go" type="submit">${L(ACTION_LABEL[kind]).replace('…', '')}</button></div></form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => d.remove());
    if (kind === 'revise') {
      const field = d.querySelector('[name="text"]');
      const submit = d.querySelector('button[type="submit"]');
      field.disabled = true;
      submit.disabled = true;
      field.placeholder = A('بيحمّل الطلب كامل…', 'Loading the full request…');
      const projectId = pid;
      api(`/api/p/${projectId}/work/${encodeURIComponent(id)}`).then((current) => {
        if (!d.isConnected) return;
        if (pid !== projectId) { d.close(); return; }
        if (!current.item.requestEditable) throw new Error(A('الشغل بدأ أو الطلب مش متاح للتعديل دلوقتي. حدّث الصفحة.', 'Work has started or this request is no longer editable. Refresh the page.'));
        field.value = current.request.raw ?? '';
        field.placeholder = '';
        field.disabled = false;
        submit.disabled = false;
        field.focus();
      }).catch((e) => {
        if (!d.isConnected) return;
        const err = d.querySelector('.errbar');
        err.hidden = false;
        err.textContent = why(e);
      });
    }
    for (const [name, value] of Object.entries(preset)) { const field = d.querySelector(`[name="${name}"]`); if (field) field.value = value; }
    d.showModal();
    d.querySelector('textarea, select, button[type="submit"]')?.focus();
  }
  async function submitAction(form) {
    const kind = form.dataset.actForm;
    const id = form.dataset.actItem;
    const body = {};
    for (const field of form.querySelectorAll('[name]')) if (field.value.trim()) body[field.name] = field.value.trim();
    if (form.querySelector('[name="confirmMinimumVersion"]')?.checked) body.confirmMinimumVersion = true;
    const err = form.querySelector('.errbar');
    err.hidden = true;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await post(`/api/p/${pid}/work/${encodeURIComponent(id)}/actions/${kind}`, JSON.stringify(body), { 'Content-Type': 'application/json' });
      form.closest('dialog').close();
      toast(`✓ ${esc(L(ACTION_LABEL[kind]).replace('…', ''))} · <span class="ltr">${esc(id)}</span>`);
      await refresh();
    } catch (e) {
      if (e.code === 'CONFIRM_MINIMUM_VERSION') {
        const box = form.querySelector('.confirm');
        box.hidden = false;
        box.innerHTML = `<pre class="warn small">${esc(e.message)}</pre><label class="small"><input type="checkbox" name="confirmMinimumVersion"> ${A('موافق: المشروع هيحتاج YallaFlow 1.4.0 أو أحدث.', 'I confirm: this project will require YallaFlow 1.4.0 or newer.')}</label>`;
      } else {
        err.hidden = false;
        err.innerHTML = `<pre>${esc(why(e))}</pre>`;
      }
    } finally {
      submit.disabled = false;
    }
  }

  // ---------- review-gate decisions (Option B): a local-user decision, identity not verified ----------
  async function openGate(id, gate) {
    if (readOnly) return;
    document.querySelector('dialog.act')?.remove();
    const d = document.createElement('dialog');
    d.className = 'create act gate';
    d.setAttribute('aria-labelledby', 'gate-h');
    d.innerHTML = `<p class="muted">${A('بيحمّل المراجعة…', 'Loading the review…')}</p>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => d.remove());
    d.showModal();
    let m;
    try {
      m = await api(`/api/p/${pid}/work/${encodeURIComponent(id)}/gates/${encodeURIComponent(gate)}`);
    } catch (e) {
      d.innerHTML = `<div class="errbar" role="alert">${esc(why(e))}</div><button class="btn" data-act-cancel>${A('اقفل', 'Close')}</button>`;
      return;
    }
    d.innerHTML = `<form data-gate-form data-gate-item="${esc(id)}" data-gate-name="${esc(gate)}" data-requested="${esc(m.requestedAt ?? '')}" data-digest="${esc(m.digest)}" data-request="${esc(newRequestId())}" novalidate>
      <div class="row"><h2 id="gate-h" class="grow">${A('راجع وقرّر', 'Review and decide')}: <span class="ltr">${esc(gate)}</span></h2><button type="button" class="btn ghost sm" data-act-cancel>${A('إلغاء', 'Cancel')}</button></div>
      <p class="tiny muted ltr">${esc(id)} — ${esc(m.title)} · ${esc(m.gateStatus ?? '')}</p>
      ${m.warnings.length ? `<div class="awarn small">${m.warnings.map((w) => `⚠ ${esc(w)}`).join('<br>')}</div>` : ''}
      ${m.sections.map((s) => `<section class="gsec"><h3>${esc(s.heading)}</h3><pre class="gtext">${esc(s.text)}</pre></section>`).join('') || `<p class="muted small">${A('مفيش نص مكتوب للمرحلة دي في الشغلانة.', 'No written material for this gate in the work item.')}</p>`}
      ${m.criteria.length ? `<section class="gsec"><h3>${A('معايير القبول', 'Acceptance criteria')}</h3><ul class="small">${m.criteria.map((c) => `<li><b class="ltr">${esc(c.id)}</b> ${esc(c.statement)} <span class="tiny muted">(${esc(c.convergence)})</span></li>`).join('')}</ul></section>` : ''}
      ${m.verification ? `<p class="small">${A('آخر تحقق', 'Latest verification')}: <span class="ltr">${esc(m.verification.id)}</span> ${m.verification.success ? A('نجح', 'passed') : A('فشل', 'failed')}</p>` : ''}
      <fieldset class="fld"><legend>${A('القرار', 'Decision')}</legend><label class="small"><input type="radio" name="decision" value="approve" checked> ${A('موافقة', 'Approve')}</label> <label class="small"><input type="radio" name="decision" value="request_changes"> ${A('محتاج تعديلات', 'Request changes')}</label></fieldset>
      <label class="fld">${A('ملاحظة القرار (مطلوبة)', 'Decision note (required)')}<textarea name="note" rows="3" maxlength="10000" required></textarea></label>
      <label class="fld">${A(`اكتب اسم المرحلة بالظبط للتأكيد: ${gate}`, `Type the gate name exactly to confirm: ${gate}`)}<input name="confirmGate" class="ltr" autocomplete="off" spellcheck="false"></label>
      <p class="tiny muted">${A('هيتسجّل كقرار من الكونسول: الهوية مش متحقق منها. ده قرار مستخدم محلي، مش توقيع موثّق.', 'Recorded as a console decision: identity not verified. This is a local-user decision, not a verified signature.')}</p>
      <div class="errbar small" role="alert" hidden></div>
      <div class="row"><span class="grow"></span><button class="btn go" type="submit" disabled>${A('سجّل القرار', 'Record decision')}</button></div></form>`;
    d.querySelector('textarea').focus();
  }
  function gateReady(form) {
    const ok = form.querySelector('[name="confirmGate"]').value === form.dataset.gateName && form.querySelector('[name="note"]').value.trim();
    form.querySelector('button[type="submit"]').disabled = !ok;
  }
  async function submitGate(form) {
    const err = form.querySelector('.errbar');
    err.hidden = true;
    const body = { decision: form.querySelector('[name="decision"]:checked').value, note: form.querySelector('[name="note"]').value, confirmGate: form.querySelector('[name="confirmGate"]').value, requestedAt: form.dataset.requested || null, digest: form.dataset.digest, requestId: form.dataset.request };
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await post(`/api/p/${pid}/work/${encodeURIComponent(form.dataset.gateItem)}/gates/${encodeURIComponent(form.dataset.gateName)}/decision`, JSON.stringify(body), { 'Content-Type': 'application/json' });
      form.closest('dialog').close();
      toast(`✓ ${A('اتسجّل القرار (من الكونسول، الهوية مش متحقق منها)', 'Decision recorded (console, identity not verified)')}`);
      await refresh();
    } catch (e) {
      err.hidden = false;
      err.innerHTML = `<pre>${esc(why(e))}</pre>${e.code === 'STALE' ? `<button type="button" class="btn sm" data-gate="${esc(form.dataset.gateName)}" data-gate-item="${esc(form.dataset.gateItem)}">${A('حمّل المراجعة تاني', 'Reload the review')}</button>` : ''}`;
      gateReady(form);
    }
  }

  // ---------- board: drag proposes, Core decides ----------
  const REOPEN_AT = { 2: 'implementation', 3: 'verification', 4: 'review' };
  function dropVerdict(it, target) {
    if (!it || readOnly) return { ok: false };
    if (it.lifecycle) return { ok: false, why: it.blocker ?? '' };
    const from = curIndex(it);
    if (it.state === 'done' && REOPEN_AT[target]) return { ok: true, kind: 'reopen', to: REOPEN_AT[target] };
    if (it.state !== 'done' && it.routing !== 'pending' && target === from + 1) return { ok: true, kind: 'advance' };
    return { ok: false, why: it.state === 'done' ? A('الشغل المتسلّم بيتفتح بس على التنفيذ أو التحقق أو المراجعة.', 'Delivered work reopens only to implementation, verification or review.') : A('الشغل بيتحرك محطة واحدة لقدام بس، وYallaFlow هو اللي بيقرّر.', 'Work moves one station forward at a time, and YallaFlow decides.') };
  }
  let dragged = null;
  async function dropOn(target) {
    const it = byId(dragged);
    dragged = null;
    document.querySelectorAll('.station').forEach((s) => s.classList.remove('drop-ok', 'drop-no'));
    const verdict = dropVerdict(it, target);
    if (!verdict.ok) { if (it && verdict.why) toast(`⛔ ${esc(verdict.why)}`); return; }
    if (verdict.kind === 'reopen') return openAction('reopen', it.id, { to: verdict.to });
    try {
      await post(`/api/p/${pid}/work/${encodeURIComponent(it.id)}/actions/advance`, '{}', { 'Content-Type': 'application/json' });
      toast(`✓ ${A('اتحرّكت', 'Moved')} · <span class="ltr">${esc(it.id)}</span>`);
      await refresh();
    } catch (e) {
      toast(`⛔ ${esc(why(e))}`);
    }
  }

  function nextCard(it) {
    if (it.state === 'done') return `<section class="nextcard done"><b>✓ ${A('خلصت', 'Done')}</b><p>${A('اتحققت واتقفلت في YallaFlow.', 'Verified and closed in YallaFlow.')}${it.latestVerification ? ` <span class="ltr tag">${esc(it.latestVerification.id)}</span>` : ''}</p></section>`;
    const who = it.waitingFor ? A('مستنيك إنت', 'Waiting for you') : it.state === 'fail' ? A('محتاج تصليح', 'Needs a fix') : A('على الوكيل', 'For the agent');
    return `<section class="nextcard ${it.state}"><div class="grow"><span class="tiny muted">${A('الخطوة الجاية', 'Next step')} · ${who}</span><p class="nextline">${iso(nowText(it))}</p><p class="tiny muted">${A('كمّل من Claude Code أو Codex: قول للوكيل', 'Continue in Claude Code or Codex: ask your agent to')} <b dir="ltr">continue ${esc(it.id)}</b></p>${it.blocker && !it.waitingFor && nowText(it) !== it.blocker ? `<p class="tiny muted">${A('العائق حسب YallaFlow:', 'Blocker per YallaFlow:')} ${iso(it.blocker)}</p>` : ''}</div><button class="btn ghost sm" data-dev>${A('الأمر', 'Command')}</button></section>`;
  }

  function stationFill(s) {
    const steps = s.steps.length || 1;
    return (s.steps.filter((x) => x.status === 'done').length + 0.5 * s.steps.filter((x) => x.status === 'now').length) / steps;
  }

  function historyItems(d) {
    if (!d) return [];
    const rows = [];
    for (const c of d.checkpoints) if (c.completedAt) rows.push({ at: c.completedAt, hue: c.station ? ST[stIndex(c.station)].hue : 'var(--nile)', html: `<b>${c.station ? L(ST[stIndex(c.station)].name) : esc(c.skill)}</b> · <span class="ltr">${esc(c.skill)}</span>${c.summary ? ` — ${iso(c.summary.length > 220 ? c.summary.slice(0, 220) + '…' : c.summary)}` : ''}` });
    for (const h of d.history) if (h.kind === 'revision' && h.at) rows.push({ at: h.at, hue: 'var(--clay)', html: `↩ <b>${A('رجوع', 'Handed back')}</b> · <span class="ltr">${esc(h.skill)}</span> ${esc(h.from)} → ${esc(h.to)}: ${iso(h.reason)}` });
    for (const h of d.history) if (h.kind === 'reopen' && h.at) rows.push({ at: h.at, hue: 'var(--clay)', html: `↩ <b>${A('اتفتح تاني', 'Reopened')}</b>: ${iso(h.reason)}` });
    for (const v of d.verification) if (v.at) rows.push({ at: v.at, hue: v.success ? 'var(--palm)' : 'var(--clay)', html: `${v.success ? '✓' : '✕'} <span class="ltr">${esc(v.id)}</span> ${v.success ? A('نجح', 'passed') : A('فشل', 'failed')}${v.command ? ` · <span class="ltr">${esc(v.command.length > 80 ? v.command.slice(0, 80) + '…' : v.command)}</span>` : ''}` });
    rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return rows.slice(0, 40).map((row) => `<li style="--hue:${row.hue}"><span class="d"></span><div class="when">${ago(row.at)}</div><div>${row.html}</div></li>`);
  }

  function fileIcon(s) {
    const f = (s.format ?? '').toLowerCase();
    return f === 'pdf' ? '📄' : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'image'].includes(f) ? '🖼️' : ['xlsx', 'xls', 'csv'].includes(f) ? '📊' : ['ticket', 'json'].includes(f) ? '🎫' : ['docx', 'doc', 'md', 'txt'].includes(f) ? '📝' : '📎';
  }
  const size = (b) => (b == null ? '' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');

  function detailsSection(it, d) {
    const conv = { satisfied: ['done', A('متحقق', 'satisfied')], partial: ['paused', A('جزئي', 'partial')], missing: ['fail', A('ناقص', 'missing')], contradicts: ['fail', A('بيعارض', 'contradicts')], 'not-assessed': ['todo', A('لسه', 'not yet')] };
    const satisfied = d.criteria.filter((c) => c.convergence === 'satisfied' && !c.stale).length;
    const tabs = [['delivery', `${A('التسليم', 'Delivery')} <b>${satisfied}/${d.criteria.length}</b>`], ['req', A('الطلب', 'Request')], ['files', `${A('المرفقات', 'Attachments')} <b>${d.sources.length}</b>`], ['q', `${A('الأسئلة والقرارات', 'Questions & decisions')} <b>${d.questions.length}</b>`]];
    const evidence = (c) => (c.evidence ?? []).filter((e) => e && e.ref).map((e) => `<span class="ltr tag" title="${esc(e.text)}">${esc(e.ref.split('/').pop())}</span>`).join(' ');
    const panel = {
      delivery: `${d.criteria.length ? `<ul class="aclist">${d.criteria.map((c) => `<li><span class="ltr tag">${esc(c.id)}</span><span class="grow">${esc(c.statement)} <span class="tiny muted">· <span class="ltr">${esc(c.requirement)}</span></span></span>${evidence(c)}${c.stale ? `<span class="chip paused">${A('محتاج إعادة تقييم', 'stale')}</span>` : ''}<span class="chip ${(conv[c.convergence] ?? conv['not-assessed'])[0]}"><i></i>${(conv[c.convergence] ?? conv['not-assessed'])[1]}</span></li>`).join('')}</ul>` : `<p class="muted">${A('مفيش معايير قبول لسه.', 'No acceptance criteria yet.')}</p>`}
        <h3 style="font-size:16px;margin-top:16px">${A('تشغيلات التحقق', 'Verification runs')}</h3>${d.verification.length ? `<ul class="aclist" style="margin-top:8px">${d.verification.slice(-8).reverse().map((v) => `<li><span class="ltr tag">${esc(v.id)}</span><span class="grow ltr small">${esc(v.command ?? '')}</span><span class="tiny muted">${ago(v.at)}</span><span class="chip ${v.success ? 'done' : 'fail'}"><i></i>${v.success ? A('نجح', 'passed') : A('فشل', 'failed')}</span></li>`).join('')}</ul>` : `<p class="muted small">${A('لسه مفيش تحقق مسجّل.', 'No verification recorded yet.')}</p>`}`,
      req: `${(d.request.raw ?? '').length > 600 ? `<div class="brief clamp"><p>${esc(d.request.raw)}</p></div><button class="btn ghost sm" data-more>${A('اقرأ الطلب كله ↓', 'Read the whole request ↓')}</button>` : `<div class="brief"><p>${esc(d.request.raw ?? it.title)}</p></div>`}
        ${d.requirements.length ? `<h3 style="font-size:16px;margin-top:14px">${A('المتطلبات', 'Requirements')}</h3><ul class="aclist" style="margin-top:8px">${d.requirements.map((r) => `<li><span class="ltr tag">${esc(r.id)}</span><span class="grow">${esc(r.statement)}</span></li>`).join('')}</ul>` : ''}
        <div class="kv"><span>${A('النوع', 'Type')}</span><b>${L(TYPE[it.type] ?? { ar: '—', en: '—' })}</b><span>${A('الحجم', 'Scope')}</span><b class="ltr">${esc(it.scope ?? '—')}</b><span>${A('اتعمل', 'Created')}</span><b>${ago(it.createdAt)}</b></div>`,
      files: d.sources.length ? `<div class="files">${d.sources.map((s) => `<button class="fcard" data-file="${esc(s.id)}"><span class="fic">${fileIcon(s)}</span><span class="grow"><b class="ltr fname">${esc(s.name)}</b><span class="tiny muted"><span class="ltr">${size(s.sizeBytes)}</span> · <span class="ltr">${esc(s.id)}</span>${s.capturedAt ? ` · ${ago(s.capturedAt)}` : ''}</span>${availChip(s.contentAvailability, s.availabilityNote)}${s.availabilityNote && s.contentAvailability === 'original-only' ? `<span class="tiny muted">${esc(s.availabilityNote)}</span>` : ''}</span><span class="tiny open">${A('افتح ↗', 'Open ↗')}</span></button>`).join('')}</div><p class="tiny muted" style="margin-top:10px">${A('الأصل محفوظ في المشروع ومايتعدّلش.', 'Originals are preserved and never edited.')}</p>` : `<p class="muted">${A('مفيش مرفقات.', 'No attachments.')}</p>`,
      q: d.questions.length ? `<ul class="qlist">${d.questions.map((q) => `<li><div class="row"><span class="ltr tag">${esc(q.id)}</span><b class="grow">${esc(q.question)}</b>${q.answer ? `<span class="chip done"><i></i>${A('اتجاوب', 'answered')}</span>` : `<span class="chip you"><i></i>${L(STATE.you)}</span>`}</div>${q.answer ? `<p class="small" style="margin-top:4px">↳ ${esc(q.answer)}</p>` : ''}</li>`).join('')}</ul>` : `<p class="muted">${A('مفيش أسئلة.', 'No questions.')}</p>`
    };
    // 1.4.0 (PF-0057): unclassified work opens on its request, with the Request tab first.
    const unrouted = it.routing === 'pending';
    const tab = dtab ?? (unrouted ? 'req' : 'delivery');
    const ordered = unrouted ? [...tabs.filter(([k]) => k === 'req'), ...tabs.filter(([k]) => k !== 'req')] : tabs;
    return `<section class="panel details" id="details"><div class="dtabs" role="tablist">${ordered.map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-dtab="${k}">${l}</button>`).join('')}</div><div class="dpanel">${panel[tab] ?? panel.delivery}${unrouted && tab === 'delivery' && !d.criteria.length ? `<p class="small muted">${A('لسه مفيش معايير قبول: بتتسجّل لما وكيلك يصنّف الشغلانة ويتفق معاك على المطلوب.', 'No acceptance criteria yet: they are recorded once your agent classifies this work and agrees the scope with you.')}</p>` : ''}</div></section>`;
  }

  // ---------- drawer: attachment previews and handoffs ----------
  let blobUrl = null;
  function drawer(html) {
    closeDrawer();
    const el = document.createElement('aside');
    el.className = 'drawer';
    el.setAttribute('role', 'dialog');
    el.innerHTML = `<div class="hd"><span class="grow"></span><button class="ibtn" data-dclose aria-label="close">✕</button></div><div class="bd">${html}</div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('open'));
    el.querySelector('[data-dclose]').onclick = closeDrawer;
    el.onkeydown = (e) => { if (e.key === 'Escape') closeDrawer(); };
    el.querySelector('[data-dclose]').focus();
    return el;
  }
  function closeDrawer() {
    document.querySelector('.drawer')?.remove();
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
  }
  async function openFile(sourceId) {
    const s = detail?.sources.find((x) => x.id === sourceId);
    if (!s) return;
    const el = drawer(`<div class="row"><span class="fic big">${fileIcon(s)}</span><div class="grow"><h2 class="ltr fname" style="font-size:18px">${esc(s.name)}</h2><div class="tiny muted"><span class="ltr">${size(s.sizeBytes)}</span> · <span class="ltr">${esc(s.id)}</span></div></div></div><div class="pv"><p class="muted">${A('بيحمّل…', 'Loading…')}</p></div>`);
    const pv = el.querySelector('.pv');
    try {
      const blob = await api(`/api/p/${pid}/sources/${encodeURIComponent(s.id)}/original`, 'blob');
      blobUrl = URL.createObjectURL(blob);
      if (blob.type.startsWith('image/')) pv.innerHTML = `<img class="shot" src="${blobUrl}" alt="${esc(s.name)}">`;
      else if (blob.type === 'application/pdf') pv.innerHTML = `<iframe class="pdf" src="${blobUrl}" title="${esc(s.name)}"></iframe>`;
      else pv.innerHTML = `<pre class="cli logpre" dir="auto">${esc(await blob.text())}</pre>`;
    } catch (e) {
      try {
        const text = await api(`/api/p/${pid}/sources/${encodeURIComponent(s.id)}/text`, 'text');
        pv.innerHTML = `<p class="tiny muted">${A('النص المستخرج من الملف:', 'Extracted text:')}</p><pre class="cli logpre" dir="auto">${esc(text)}</pre>`;
      } catch {
        pv.innerHTML = `<p class="muted">${A('الملف ده محفوظ زي ما هو من غير معاينة.', 'This file is preserved as-is, without a preview.')} ${esc(e.message)}</p>`;
      }
    }
  }
  function openArtifact(index) {
    const it = byId(route().id);
    if (!it || !detail) return;
    const key = ST[index].k;
    const list = index === 4
      ? (detail.knowledge?.candidates ?? []).map((c) => ({ title: `${c.id} · ${c.status}`, body: c.summary ?? '', at: null }))
      : detail.checkpoints.filter((c) => c.station === key && c.status === 'completed').map((c) => ({ title: c.skill, body: c.summary ?? '', at: c.completedAt, evidence: c.evidence }));
    drawer(`<div class="row"><span class="st-ico" style="--hue:${ST[index].hue}">${icon(key)}</span><div class="grow"><div class="tiny muted">${L(ST[index].name)} ${fwd()} ${stName(index + 1)}</div><h2 style="font-size:19px">${A('اللي اتسلّم', 'What was handed off')}</h2></div></div>
      <ul class="aclist" style="margin-top:14px">${list.map((x) => `<li style="display:block"><div class="row"><span class="ltr tag">${esc(x.title)}</span>${x.at ? `<span class="tiny muted">${ago(x.at)}</span>` : ''}</div><p class="small" style="margin-top:6px">${iso(x.body)}</p>${x.evidence?.length ? `<div class="tiny muted">${x.evidence.map((e) => `<span class="ltr tag">${esc(e)}</span>`).join(' ')}</div>` : ''}</li>`).join('') || `<li>${A('لسه مفيش.', 'Nothing yet.')}</li>`}</ul>
      <p class="tiny muted" style="margin-top:10px">${A('من ملخصات الـ checkpoints والأدلة المسجلة.', 'From checkpoint summaries and recorded evidence.')}</p>`);
  }

  function copy(text) {
    const done = () => toast(A('اتنسخ ✓ شغّله في الترمينال أو ادّيه للوكيل.', 'Copied ✓ Run it in your terminal or give it to your agent.'));
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => toast(esc(text)));
    else toast(esc(text));
  }
  function toast(html) { document.querySelector('.toast')?.remove(); const el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); el.innerHTML = html; document.body.appendChild(el); setTimeout(() => el.remove(), 4200); }
  function celebrate() { if (reduced) return; const c = document.createElement('div'); c.className = 'celebrate'; const cols = ['#3d8bfd', '#8a63e8', '#0fae9d', '#f1a131', '#1d9a5a']; c.innerHTML = Array.from({ length: 40 }, (_, k) => `<i style="left:${Math.random() * 100}%;background:${cols[k % 5]};animation-delay:${Math.random() * 0.4}s"></i>`).join(''); document.body.appendChild(c); setTimeout(() => c.remove(), 2200); }

  // ---------- attention: what needs a person (from Core's state; nothing is inferred) ----------
  const needs = () => [...(agent?.pid === pid ? agent.pending.map((p) => ({ it: byId(route().id) ?? { id: '', title: '' }, agentPerm: true, reason: A(`إذن للوكيل: ${p.title}`, `Agent permission: ${p.title}`) })) : []), ...items().filter((it) => it.state === 'you' || it.state === 'fail').map((it) => ({
    it,
    reason: it.state === 'fail'
      ? A('آخر تحقق فشل', 'the latest verification failed')
      : it.waitingFor?.kind === 'review'
        ? A(`مستني مراجعتك (${it.waitingFor.gate})`, `waiting for your review (${it.waitingFor.gate})`)
        : A(`مستني إجابتك على ${(it.waitingFor?.questions ?? []).join('، ')}`, `waiting for your answer to ${(it.waitingFor?.questions ?? []).join(', ')}`)
  }))];
  let bellOpen = false;
  let browserAlerts = store.get('alerts', false);
  function notesPanel() {
    const list = needs();
    return `<div class="notes" role="dialog" aria-label="${A('محتاج انتباهك', 'Needs your attention')}"><b>${A('محتاج انتباهك', 'Needs your attention')}</b>
      <ul>${list.map(({ it, reason }) => `<li class="unread"><span class="dg-ic">${it.state === 'fail' ? '✕' : '◆'}</span><a href="#/item/${encodeURIComponent(it.id)}"><span class="ltr">${esc(it.id)}</span> ${esc(it.title)}<br><span class="tiny muted">${esc(reason)}</span></a></li>`).join('') || `<li class="muted">${A('مفيش حاجة مستنياك دلوقتي.', 'Nothing needs you right now.')}</li>`}</ul>
      <label class="tiny"><input type="checkbox" data-alerts ${browserAlerts ? 'checked' : ''}> ${A('نبّهني من المتصفح لما حاجة جديدة تستناني', 'Alert me in the browser when something new needs me')}</label></div>`;
  }
  function alertNew(previous) {
    if (!previous || !browserAlerts || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const before = new Set(previous.items.filter((it) => it.state === 'you' || it.state === 'fail').map((it) => it.id));
    for (const { it, reason } of needs()) {
      if (before.has(it.id)) continue;
      const note = new Notification(`YallaFlow · ${it.id}`, { body: `${it.title}\n${reason}`, tag: `yf-${it.id}` });
      note.onclick = () => { window.focus(); location.hash = `#/item/${encodeURIComponent(it.id)}`; note.close(); };
    }
  }

  // ---------- since you were away (each line from a recorded entry) ----------
  let digest = null; // { since, lines }
  const seenKey = () => `seen.${pid}`;
  async function buildDigest() {
    const since = store.get(seenKey(), null);
    if (!since) { store.set(seenKey(), new Date().toISOString()); digest = null; return; }
    const changed = items().filter((it) => it.lastActivityAt && it.lastActivityAt > since).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)).slice(0, 6);
    const lines = [];
    for (const it of changed) {
      if (!it.lastActivityAt) continue;
      let d = null;
      try { d = await api(`/api/p/${pid}/work/${encodeURIComponent(it.id)}`); } catch { continue; }
      const events = [];
      if (it.completedAt && it.completedAt > since) events.push({ at: it.completedAt, ic: '✓', text: A('وصل «خلص»', 'reached Done'), ref: 'DONE' });
      for (const c of d.checkpoints) if (c.completedAt && c.completedAt > since) events.push({ at: c.completedAt, ic: '●', text: A(`خلّص ${c.station ? `«${L(ST[stIndex(c.station)].name)}»` : ''}`, `completed ${c.station ? L(ST[stIndex(c.station)].name) : ''}`), ref: c.skill });
      for (const v of d.verification) if (v.at && v.at > since) events.push({ at: v.at, ic: v.success ? '✓' : '✕', text: v.success ? A('تحقق نجح', 'verification passed') : A('تحقق فشل', 'verification failed'), ref: v.id });
      for (const h of d.history) if (h.at && h.at > since && (h.kind === 'revision' || h.kind === 'reopen')) events.push({ at: h.at, ic: '↩', text: A('رجع خطوة', 'went back a step'), ref: h.skill ?? h.kind });
      events.sort((a, b) => b.at.localeCompare(a.at));
      if (events.length) lines.push({ it, events: events.slice(0, 3) });
    }
    digest = lines.length ? { since, lines } : null;
  }
  function digestCard() {
    if (!digest) return '';
    return `<section class="digest"><div class="grow"><b>🌙 ${A('من آخر مرة كنت هنا', 'Since you were last here')}</b> <span class="tiny muted">${ago(digest.since)}</span>
      <ul>${digest.lines.map(({ it, events }) => `<li><a href="#/item/${encodeURIComponent(it.id)}"><span class="ltr">${esc(it.id)}</span> ${esc(it.title)}</a><span class="tiny"> — ${events.map((e) => `${e.ic} ${e.text} <span class="ltr muted">${esc(e.ref)}</span>`).join(' · ')}</span></li>`).join('')}</ul>
      <div class="tiny muted">${A('كل سطر من سجل مسجّل في المشروع.', 'Every line comes from a recorded entry.')}</div></div><button class="btn sm" data-digest>${A('تمام', 'Got it')}</button></section>`;
  }

  // ---------- overview (1.4.0): the project itself — read-only ----------
  // Data: GET /api/p/<project>/overview (yallaflow overview --json). Stack entries are
  // repository evidence with a basis (declared / detected / inferred); facts come from
  // approved project memory with mechanical freshness. Nothing here starts, drafts or
  // approves project understanding: the developer asks the agent, and approval stays a
  // human decision recorded through YallaFlow.
  let projectOverview = null; // { pid, data | error }
  async function loadProjectOverview() {
    const forPid = pid;
    try { projectOverview = { pid: forPid, data: await api(`/api/p/${forPid}/overview`) }; } catch (e) { projectOverview = { pid: forPid, error: e.message }; }
  }
  const UNDERSTANDING_TEXT = {
    PROJECT_UNDERSTANDING_REQUIRED: { tone: 'wait', title: { ar: 'فهم المشروع مطلوب', en: 'Project understanding needed' }, body: { ar: 'ده مشروع قايم. قبل أي شغل هندسي، الوكيل بيكتشف المشروع بأدلة، وانت بتراجع المسودة وتعتمدها.', en: 'This is an existing project. Before engineering work, your agent discovers it with evidence, then you review and approve the draft.' } },
    PROJECT_UNDERSTANDING_IN_PROGRESS: { tone: 'active', title: { ar: 'اكتشاف المشروع جاري', en: 'Project discovery in progress' }, body: { ar: 'الوكيل بيجمع فهم المشروع وأدلته. المسودة هتحتاج مراجعتك قبل ما تتعتمد.', en: 'Your agent is collecting project understanding and evidence. The draft will need your review before it is approved.' } },
    PROJECT_UNDERSTANDING_AWAITING_REVIEW: { tone: 'you', title: { ar: 'فهم المشروع مستني مراجعتك', en: 'Project understanding awaits your review' }, body: { ar: 'راجع الحقايق والأدلة والحاجات غير المعروفة مع وكيلك، وبعدها اعتمدها أو اطلب تعديل. عرضها هنا مش موافقة.', en: 'Review the facts, evidence and unknowns with your agent, then approve or request changes. Viewing it here is not an approval.' } },
    PROJECT_UNDERSTANDING_ESTABLISHED: { tone: 'done', title: { ar: 'فهم المشروع معتمد', en: 'Project understanding established' }, body: { ar: 'الوكيل بيقرا الذاكرة المعتمدة وبيراجع بس الأدلة اللي اتغيرت والمتعلقة بالشغل.', en: 'Your agent reads the approved memory and rechecks only changed evidence relevant to each task.' } },
    GREENFIELD_UNDERSTANDING_FROM_INTENT: { tone: 'active', title: { ar: 'مشروع جديد: الفهم من هدفك', en: 'New project: understanding from your intent' }, body: { ar: 'مفيش كود قديم يتفحص. اوصف هدف المنتج ومتطلباته، والفهم بيتكوّن من قراراتك والشغل.', en: 'There is no existing code to scan. Describe the product goal and requirements; understanding grows from your decisions and the work.' } },
    PROJECT_UNDERSTANDING_UNAVAILABLE: { tone: 'fail', title: { ar: 'حالة فهم المشروع مش متاحة', en: 'Project understanding unavailable' }, body: { ar: 'YallaFlow مقدرش يقرا السجلات دي. شغّل yallaflow doctor في فولدر المشروع.', en: 'YallaFlow could not read these records. Run yallaflow doctor in the project folder.' } }
  };
  const ASK_AR = {
    PROJECT_UNDERSTANDING_REQUIRED: 'اعمل فهم للمشروع ده بأدلة من المستودع.',
    PROJECT_UNDERSTANDING_IN_PROGRESS: 'كمّل اكتشاف فهم المشروع.',
    PROJECT_UNDERSTANDING_AWAITING_REVIEW: 'ورّيني مسودة فهم المشروع علشان أراجعها.',
    GREENFIELD_UNDERSTANDING_FROM_INTENT: 'ده اللي هنبنيه: <هدف المنتج وأول المتطلبات>.',
    PROJECT_UNDERSTANDING_UNAVAILABLE: 'افحص سجلات المشروع بـ yallaflow doctor.'
  };
  const FRESH_TEXT = { fresh: { ar: 'حديث', en: 'fresh' }, 'may-be-stale': { ar: 'ممكن يكون قديم', en: 'may be stale' }, 'stale-evidence': { ar: 'دليله اتشال', en: 'evidence missing' }, unknown: { ar: 'مش معروف', en: 'unknown' }, historical: { ar: 'تاريخي', en: 'historical' } };
  const BASIS_TEXT = { declared: { ar: 'مُعلن في ملف', en: 'declared in a file' }, detected: { ar: 'موجود كملف', en: 'detected (file present)' }, inferred: { ar: 'مستنتج من العدد', en: 'inferred from counts' } };
  function understandingCard(u, compact = false) {
    const t = UNDERSTANDING_TEXT[u.state] ?? UNDERSTANDING_TEXT.PROJECT_UNDERSTANDING_UNAVAILABLE;
    const baseline = u.baselineId && byId(u.baselineId);
    const askText = u.ask ? (lang === 'ar' && ASK_AR[u.state] ? ASK_AR[u.state] : u.ask) : '';
    const ask = askText ? `<p class="small" style="margin-top:8px"><b>${A('اطلب من وكيلك:', 'Ask your agent:')}</b> <q>${esc(askText)}</q></p>` : '';
    return `<section class="panel understanding" data-understanding="${esc(u.state)}" style="margin-bottom:16px"><div class="row"><span class="chip ${t.tone}"><i></i>${L(t.title)}</span>${u.facts ? `<span class="tiny muted">${A(`${u.facts} حقيقة حالية`, `${u.facts} current facts`)}</span>` : ''}${compact ? `<a class="tiny" href="#/overview" style="margin-inline-start:auto">${A('نظرة على المشروع', 'Project overview')}</a>` : ''}</div>
      <p class="small muted" style="margin-top:6px">${L(t.body)}</p>${compact ? '' : ask}${baseline ? `<a class="btn ghost sm" style="margin-top:8px" href="#/item/${encodeURIComponent(baseline.id)}">${A('افتح سجل فهم المشروع', 'Open the project-understanding record')} <span class="ltr">${esc(baseline.id)}</span></a>` : ''}</section>`;
  }
  // Flow and Work: only when onboarding needs attention; an established project shows nothing extra.
  function understandingStrip() {
    const u = projectOverview?.pid === pid ? projectOverview.data?.understanding : null;
    if (!u || u.state === 'PROJECT_UNDERSTANDING_ESTABLISHED') return '';
    return understandingCard(u, true);
  }
  function viewOverview() {
    if (!projectOverview || projectOverview.pid !== pid) return `<p class="muted" style="margin-top:30px">${A('بيقرا المشروع…', 'Reading the project…')}</p>`;
    if (projectOverview.error) return `<section class="errbar data" role="alert"><b>${A('مقدرناش نقرا نظرة المشروع', 'The project overview could not be read')}</b><p class="small">${esc(projectOverview.error)}</p></section>`;
    const o = projectOverview.data;
    if (o.project.kind === 'greenfield' && !(o.memory?.current > 0)) return greenfieldOverview(o);
    const m = o.memory;
    const facts = (area) => (o.areas[area]?.facts ?? []);
    const factList = (area, empty) => {
      const list = facts(area);
      if (!list.length) return `<p class="small muted">${empty}</p>`;
      const more = (o.areas[area].total ?? 0) - list.length;
      return `<ul class="facts">${list.map((f) => `<li><p class="small">${esc(f.summary)}</p><span class="tiny muted"><span class="ltr">${esc(f.id)}</span> · ${esc(f.confidence ?? '')} · <span class="fresh-${esc(f.freshness)}">${L(FRESH_TEXT[f.freshness] ?? FRESH_TEXT.unknown)}</span>${f.state === 'disputed' ? ` · <b>${A('عليه خلاف', 'disputed')}</b>` : ''}</span></li>`).join('')}</ul>${more > 0 ? `<p class="tiny muted">${A(`و ${more} كمان في ذاكرة المشروع.`, `+${more} more in project memory.`)}</p>` : ''}`;
    };
    const main = o.stack.entries.filter((e) => e.kind !== 'language' && e.kind !== 'lockfile' && e.kind !== 'ecosystem' && e.kind !== 'ci');
    const langs = o.stack.entries.filter((e) => e.kind === 'language');
    const row = (e) => `<tr><td>${esc(e.component)}</td><td class="ltr">${esc(e.declared ?? '—')}</td><td>${esc(e.kind)}</td><td><span class="tag basis-${esc(e.basis)}">${L(BASIS_TEXT[e.basis])}</span></td><td class="ltr tiny">${esc(e.path ?? '')}${e.locator ? ` · ${esc(e.locator)}` : ''}</td></tr>`;
    const stackTable = main.length
      ? `<div class="tablewrap"><table class="stack"><thead><tr><th>${A('المكوّن', 'Component')}</th><th>${A('الإصدار المُعلن', 'Declared')}</th><th>${A('النوع', 'Kind')}</th><th>${A('الأساس', 'Basis')}</th><th>${A('الدليل', 'Evidence')}</th></tr></thead><tbody>${main.map(row).join('')}</tbody></table></div>`
      : `<p class="small muted">${A('مفيش إطار عمل أو خدمة معلنة في الملفات اللي اتقرت.', 'No framework or service is declared in the files that were read.')}</p>`;
    const memLine = m.available
      ? `<div class="row tiny" style="margin-top:6px"><span class="chip done"><i></i>${m.fresh} ${A('حديث', 'fresh')}</span><span class="chip wait">${m.mayBeStale + m.staleEvidence} ${A('محتاج مراجعة', 'to revalidate')}</span><span class="chip todo">${m.unknown} ${A('من غير نقطة تحقق', 'no check point')}</span>${m.disputed ? `<span class="chip fail"><i></i>${m.disputed} ${A('عليه خلاف', 'disputed')}</span>` : ''}${m.unresolved ? `<span class="chip you">${m.unresolved} ${A('مش محسوم', 'unresolved')}</span>` : ''}</div><p class="tiny muted" style="margin-top:6px">${A('«ممكن يكون قديم» معناه إن ملف الدليل اتغيّر، مش إن الحقيقة غلط.', '"May be stale" means an evidence file changed, not that the fact is wrong.')}</p>`
      : `<p class="small" style="color:var(--clay)">${A('ذاكرة المشروع مش متاحة:', 'Project memory unavailable:')} ${esc(m.error ?? '')}</p>`;
    const modules = o.modules.length
      ? `<ul class="modules">${o.modules.map((mod) => `<li><b class="ltr">${mod.path === '.' ? A('(الجذر)', '(root)') : esc(mod.path)}</b> <span class="small">${esc(mod.ecosystems.join(', ') || '—')}${mod.frameworks.length ? ` · ${esc(mod.frameworks.join(', '))}` : ''}</span>${mod.lockfiles.length ? `<span class="tiny muted ltr"> · ${esc(mod.lockfiles.join(', '))}</span>` : ''}${mod.conflicts.map((c) => `<p class="tiny" style="color:var(--clay)">⚠ ${esc(c)}</p>`).join('')}</li>`).join('')}</ul>`
      : `<p class="small muted">${A('مفيش ملفات تعريف (manifests) معروفة.', 'No recognized manifests.')}</p>`;
    const cov = o.coverage;
    const coverage = cov.available
      ? `${A(`اتقرا ${cov.scannedEntries} عنصر · ${cov.sourceFiles} ملف كود · ${cov.manifests} ملف تعريف`, `${cov.scannedEntries} entries scanned · ${cov.sourceFiles} source files · ${cov.manifests} manifests`)}${cov.truncated ? ` · <b>${A('الفحص اتقطع عند الحد', 'scan truncated at its limit')}</b>` : ''}`
      : `${A('الجرد مش متاح:', 'Inventory unavailable:')} ${esc(cov.error ?? '')}`;
    const unread = o.stack.unread.length ? `<p class="tiny" style="margin-top:6px">${A('ماتقراش:', 'Not read:')} ${o.stack.unread.map((u) => `<span class="ltr">${esc(u.path)}</span> (${esc(u.reason)})`).join(' · ')}</p>` : '';
    const cmds = [o.understanding.command, 'yallaflow overview', 'yallaflow context status', 'yallaflow inspect'].filter(Boolean);
    return `<section class="pagehead"><h1 style="font-size:26px">${esc(o.project.name)}</h1><p class="muted">${A('نظرة على المشروع: إيه هو، معمول بإيه، وفهمه متسجّل لحد فين. القراءة بس — مفيش حاجة بتتغيّر من هنا.', 'The project at a glance: what it is, what it is built with, and how far its understanding is recorded. Read-only — nothing changes from here.')}</p></section>
      ${understandingCard(o.understanding)}
      <div class="ovgrid">
        <section class="panel"><h2>${A('المشروع', 'Purpose')}</h2>${factList('project', A('لسه مفيش وصف معتمد للمشروع.', 'No approved project description yet.'))}</section>
        <section class="panel"><h2>${A('ذاكرة المشروع', 'Project memory')}</h2><p class="small">${m.available ? A(`${m.current} حقيقة حالية`, `${m.current} current facts`) : ''}</p>${memLine}</section>
        <section class="panel wide"><h2>${A('التقنيات من أدلة المستودع', 'Stack from repository evidence')}</h2><p class="tiny muted">${A('«مُعلن» معناه إن ملف بيقول كده، مش إثبات إن الكود بيستخدمه. ملفات .env مابتتقراش.', '"Declared" means a file says so, not proof the code uses it. .env files are never read.')}</p>${stackTable}${langs.length ? `<p class="small" style="margin-top:8px">${A('اللغات (مستنتجة من عدد الملفات):', 'Languages (inferred from file counts):')} ${langs.map((l) => `${esc(l.component)} <span class="muted">(${l.count})</span>`).join(' · ')}</p>` : ''}${unread}</section>
        <section class="panel"><h2>${A('الوحدات', 'Modules')}</h2>${modules}</section>
        <section class="panel"><h2>${A('المعمارية', 'Architecture')}</h2>${factList('architecture', A('لسه مفيش معمارية معتمدة في الذاكرة.', 'No approved architecture in memory yet.'))}</section>
        ${facts('tech-stack').length ? `<section class="panel"><h2>${A('التقنيات في الذاكرة المعتمدة', 'Stack in approved memory')}</h2>${factList('tech-stack', '')}</section>` : ''}
        ${facts('database').length || facts('integration').length ? `<section class="panel"><h2>${A('البيانات والتكاملات', 'Data and integrations')}</h2>${factList('database', '')}${factList('integration', '')}</section>` : ''}
      </div>
      <p class="tiny muted" style="margin-top:12px">${coverage}</p>
      ${devPanel(A('أوامر نظرة المشروع', 'Overview commands'), cmds)}`;
  }

  // ---------- new-project Overview (1.4.0, PF-0057): a setup checklist from canonical data ----------
  // Every line is read from records (snapshot, overview, runtime, agent state); nothing is
  // computed as done that YallaFlow did not record. A project with approved memory gets the
  // evidence-based Overview instead.
  function greenfieldOverview(o) {
    const origin = o.project.origin ?? {};
    const all = items();
    const first = [...all].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0] ?? null;
    const goalSet = first && !/^Set up \S+$/.test(first.title);
    const services = runtime?.pid === pid && runtime.data ? runtime.data.services ?? [] : null;
    const gitOn = Boolean(o.coverage?.git);
    const envName = { docker: 'Docker', local: A('أدوات محلية', 'local tools'), later: null }[origin.environment] ?? null;
    const row = (state, title, body, action = '') => `<li class="ck ${state}"><span class="ckmark" aria-hidden="true">${state === 'done' ? '✓' : state === 'now' ? '●' : '○'}</span><div class="grow"><b>${title}</b>${body ? `<p class="small muted">${body}</p>` : ''}</div>${action}</li>`;
    const firstLink = first ? `<a class="btn sm" href="#/item/${encodeURIComponent(first.id)}">${A('افتح أول شغلانة', 'Open the first work item')}</a>` : '';
    const checklist = [
      row('done', A('المشروع اتعمل', 'Project created'), origin.createdAt ? A(`بمعالج المشروع الجديد ${ago(origin.createdAt)}.`, `By the New Project Wizard ${ago(origin.createdAt)}.`) : A('مشروع جديد (Greenfield).', 'A new (Greenfield) project.')),
      row(goalSet ? 'done' : 'now', A('الهدف', 'Goal'), goalSet ? esc(first.title.replace(/^[^:]+:\s*/, '')) : A('لسه مااتوصفش. اوصف اللي هتبنيه في أول شغلانة.', 'Not described yet. Describe what you are building in the first work item.'), goalSet ? '' : firstLink),
      row(first && first.state !== 'new' ? 'done' : 'now', A('المتطلبات', 'Requirements'), first && first.state !== 'new' ? A('وكيلك صنّف الشغلانة وبدأ يشتغل عليها.', 'Your agent classified the work and started on it.') : A('اتفق مع وكيلك على أول متطلبات. المتطلبات والمرفقات اللي كتبتها محفوظة في أول شغلانة.', 'Agree the first requirements with your agent. The requirements and attachments you gave are kept on the first work item.'), firstLink),
      row(origin.stack?.length ? 'done' : 'todo', A('التقنية', 'Stack'), origin.stack?.length ? esc(origin.stack.join(' · ')) : A('مفيش تقنية لسه (مشروع فاضي). اختارها مع وكيلك.', 'No stack yet (an empty project). Choose it with your agent.')),
      row(services?.length ? 'done' : envName ? 'now' : 'todo', A('بيئة التطوير', 'Development environment'), services?.length ? A(`${services.length} خدمة معرّفة.`, `${services.length} service(s) defined.`) : envName ? A(`${envName} — مخطّطة، لسه مفيش خدمات معرّفة.`, `${envName} — planned; no services defined yet.`) : A('لسه متحددتش.', 'Not decided yet.'), readOnly ? '' : `<a class="btn sm" href="#/setup">${A('اضبط التشغيل', 'Configure runtime')}</a>`),
      row(gitOn ? 'done' : 'todo', 'Git', gitOn ? A('فيه Git repository.', 'A Git repository exists.') : A('مفيش Git repository لسه.', 'No Git repository yet.'), gitOn || readOnly ? '' : `<button class="btn sm" data-git-init>${A('اعمل Git repository', 'Initialize Git')}</button>`),
      row(agentsOn ? 'done' : 'todo', A('الوكيل', 'Agent'), agentsOn ? A('مساحة الوكيل مفعّلة: افتح أي شغلانة وابدأ جلسة Codex.', 'The Agent Workspace is on: open a work item and start a Codex session.') : agentInfo?.codex && !agentInfo.codex.ready ? A('Codex مش جاهز على الجهاز ده.', 'Codex is not ready on this machine.') : A('مساحة الوكيل مقفولة. تقدر تشتغل من الوكيل في الترمينال كمان.', 'The Agent Workspace is off. You can also work from your agent in a terminal.'), !agentsOn && agentsCanEnable ? `<button class="btn sm" data-agents-enable>${A('فعّل الوكلاء للجلسة دي', 'Enable agents for this session')}</button>` : '')
    ].join('');
    const firstCard = first ? `<section class="panel"><h2>${A('أول شغلانة', 'First work item')}</h2><p><a href="#/item/${encodeURIComponent(first.id)}"><span class="ltr tag">${esc(first.id)}</span> ${esc(first.title)}</a></p><p class="small">${chip(first.state === 'new' ? 'todo' : first.state)} ${iso(nowText(first))}</p></section>` : '';
    const main = o.stack.entries.filter((e) => !['language', 'lockfile', 'ecosystem', 'ci'].includes(e.kind));
    const stack = main.length ? `<section class="panel wide"><h2>${A('اللي في الكود دلوقتي', 'What the code declares now')}</h2><p class="small">${main.map((e) => `<span class="tag">${esc(e.component)}${e.declared ? ` <span class="ltr">${esc(e.declared)}</span>` : ''}</span>`).join(' ')}</p><p class="tiny muted">${A('من ملفات المشروع؛ الكود المتولّد لسه ماتراجعش.', 'From the project files; generated code is not reviewed yet.')}</p></section>` : '';
    return `<section class="pagehead"><h1 style="font-size:26px">${esc(o.project.name)}</h1><p class="muted">${A('مشروع جديد. ده اللي اتعمل وده اللي فاضل — مفيش حاجة ناقصة هنا تعتبر خطأ.', 'A new project. This is what was created and what remains — nothing missing here is an error.')}</p></section>
      <section class="panel"><h2>${A('تجهيز المشروع', 'Project setup')}</h2><ol class="checklist">${checklist}</ol></section>
      <div class="ovgrid" style="margin-top:16px">${firstCard}${stack}</div>
      <p class="tiny muted" style="margin-top:12px">${A('المعمارية والوحدات وذاكرة المشروع بتظهر هنا لما تتسجّل بأدلة.', 'Architecture, modules and project memory appear here once they are recorded with evidence.')}</p>`;
  }
  async function gitInitAction() {
    if (readOnly || !confirm(A('تعمل Git repository محلي في المشروع ده؟ من غير remote ولا commit.', 'Initialize a local Git repository in this project? No remote and no commit.'))) return;
    try {
      await post(`/api/p/${pid}/git/init`, JSON.stringify({ confirm: true }), { 'Content-Type': 'application/json' });
      toast(A('اتعمل Git repository.', 'Git repository initialized.'));
    } catch (e) { toast(esc(e.message)); }
    team = null; await loadProjectOverview(); await loadForView(); render();
  }

  // ---------- setup (1.4.0): reviewed, trusted local development services ----------
  // Data: GET /api/p/<project>/runtime (yallaflow runtime status --json), logs on demand.
  // Opening this view never starts anything. Trust requires typing the service id after
  // reviewing the exact command; Start/Stop/Restart run the reviewed profile, never a
  // command from the page. Only processes YallaFlow can positively identify are stopped.
  let runtime = null; // { pid, data | error }
  let runtimeBusy = {}; // service id -> action
  let runtimeErr = {}; // service id -> message
  let runtimeLogs = {}; // service id -> lines
  let runtimeTimer = null;
  async function loadRuntime() {
    const forPid = pid;
    try { runtime = { pid: forPid, data: await api(`/api/p/${forPid}/runtime`) }; } catch (e) { runtime = { pid: forPid, error: e.message }; }
  }
  const RT_STATE = {
    stopped: { tone: 'todo', t: { ar: 'متوقف', en: 'stopped' } },
    starting: { tone: 'active', t: { ar: 'بيبدأ', en: 'starting' } },
    running: { tone: 'done', t: { ar: 'شغّال', en: 'running' } },
    failed: { tone: 'fail', t: { ar: 'وقع', en: 'failed' } },
    unknown: { tone: 'wait', t: { ar: 'مش تحت إدارة YallaFlow', en: 'unmanaged' } }
  };
  function serviceCard(sv) {
    const st = RT_STATE[sv.state] ?? RT_STATE.unknown;
    const busy = runtimeBusy[sv.id];
    const running = ['running', 'starting'].includes(sv.state);
    const dis = (cond) => (readOnly || busy || cond ? 'disabled' : '');
    const trustLine = sv.trust.trusted
      ? `<span class="chip done"><i></i>${A('موثوق على الجهاز ده', 'trusted on this machine')}</span>`
      : `<span class="chip wait">${sv.trust.reason === 'changed' ? A('اتغيّر بعد التوثيق — راجعه تاني', 'changed since you trusted it — review again') : sv.trust.reason === 'moved' ? A('الفولدر اتنقل — راجعه تاني', 'folder moved — review again') : A('لسه مش موثوق', 'not trusted yet')}</span>`;
    const ports = sv.ports.map((p) => `<span class="tag ltr">${p.port}${p.listening ? ' ●' : ''}</span>`).join(' ');
    const logs = runtimeLogs[sv.id];
    return `<article class="panel svc" data-service="${esc(sv.id)}" data-definition-hash="${esc(sv.definitionHash)}"><div class="row"><h3 style="font-size:17px">${esc(sv.name)}</h3><span class="tiny muted ltr">${esc(sv.id)}</span><span class="chip ${st.tone}" data-svc-state="${esc(sv.state)}"><i></i>${L(st.t)}</span>${sv.stale ? `<span class="chip wait">${A('شغّال بتعريف أقدم', 'running an older definition')}</span>` : ''}${trustLine}</div>
      ${sv.reason ? `<p class="small" style="margin-top:6px">${esc(sv.reason)}</p>` : ''}
      ${sv.unmanagedPorts.length ? `<p class="small" style="margin-top:6px;color:var(--clay)">${A('المنفذ ده مستخدم من برنامج YallaFlow ماشغّلوش، ومش هيتلمس:', 'This port is held by a process YallaFlow did not start; it will not be touched:')} <span class="ltr">${sv.unmanagedPorts.join(', ')}</span></p>` : ''}
      <dl class="svcdef"><dt>${A('الأمر', 'Command')}</dt><dd class="ltr mono" title="${esc(A('كل عنصر بين علامتين هو وسيط منفصل؛ مفيش shell.', 'Each quoted item is one separate argument; no shell is used.'))}">${esc(JSON.stringify(sv.command))}</dd><dt>${A('الفولدر', 'Folder')}</dt><dd class="ltr mono">${esc(sv.cwd)}</dd><dt>${A('متغيرات البيئة (أسماء بس)', 'Environment (names only)')}</dt><dd class="ltr mono">${sv.env.length ? esc(sv.env.join(', ')) : '—'}</dd><dt>${A('المنافذ', 'Ports')}</dt><dd>${ports || '—'}</dd><dt>${A('جاهز لما', 'Ready when')}</dt><dd class="small">${sv.ready?.port ? A(`المنفذ ${sv.ready.port} يرد`, `port ${sv.ready.port} answers`) : sv.ready?.log ? `${A('السجل فيه', 'the log shows')} <span class="ltr mono">${esc(sv.ready.log)}</span>` : A('بعد ما يبدأ', 'once started')}</dd><dt>${A('الإيقاف', 'Stop')}</dt><dd class="small ltr">${esc(sv.stopSignal)} · ${sv.stopTimeoutSeconds}s</dd>${sv.overridden.length ? `<dt>${A('متعدّل محليًا', 'Overridden locally')}</dt><dd class="ltr">${esc(sv.overridden.join(', '))}</dd>` : ''}</dl>
      <div class="row" style="margin-top:10px">
        ${!sv.trust.trusted ? `<label class="small">${A('اكتب اسم الخدمة علشان توثّق الأمر ده:', 'Type the service id to trust this command:')} <input class="ltr" data-trust-input="${esc(sv.id)}" size="12" autocomplete="off" ${readOnly ? 'disabled' : ''}></label><button class="btn sm" data-rt="trust" data-id="${esc(sv.id)}" ${dis(false)}>${A('وثّق', 'Trust')}</button>` : ''}
        <button class="btn sm go" data-rt="start" data-id="${esc(sv.id)}" ${dis(running || !sv.trust.trusted)}>${busy === 'start' ? A('بيبدأ…', 'Starting…') : A('شغّل', 'Start')}</button>
        <button class="btn sm" data-rt="restart" data-id="${esc(sv.id)}" ${dis(!running || !sv.trust.trusted)}>${busy === 'restart' ? A('بيعيد…', 'Restarting…') : A('إعادة تشغيل', 'Restart')}</button>
        <button class="btn sm ghost" data-rt="stop" data-id="${esc(sv.id)}" ${dis(sv.state === 'stopped')}>${busy === 'stop' ? A('بيوقف…', 'Stopping…') : A('وقّف', 'Stop')}</button>
        <button class="btn sm ghost" data-rt-logs="${esc(sv.id)}">${logs ? A('حدّث السجل', 'Refresh logs') : A('السجل', 'Logs')}</button>
      </div>
      ${runtimeErr[sv.id] ? `<p class="small" role="alert" style="margin-top:8px;color:var(--clay);white-space:pre-wrap">${esc(runtimeErr[sv.id])}</p>` : ''}
      ${logs ? `<pre class="svclog ltr" tabindex="0" aria-label="${A('سجل الخدمة', 'Service log')}">${logs.length ? logs.map(esc).join('\n') : esc(A('لسه مفيش مخرجات.', 'No output yet.'))}</pre><p class="tiny muted">${A('الأسرار المعروفة بتتخفي من السجل، لكن ده أفضل مجهود ومش مضمون مع أي برنامج.', 'Recognizable secrets are hidden from the log, but this is best effort and cannot be guaranteed for every program.')}</p>` : ''}
      ${!sv.trust.trusted ? `<p class="tiny muted" style="margin-top:8px">${A('التوثيق بيغطي الأمر ده بالظبط، مش اللي جوه السكريبتات اللي بيشغّلها (زي package scripts). راجعها هي كمان.', 'Trust covers this exact definition, not what the scripts it runs do (for example package scripts). Review those too.')}</p>` : ''}</article>`;
  }
  function viewSetup() {
    if (!runtime || runtime.pid !== pid) return `<p class="muted" style="margin-top:30px">${A('بيقرا خدمات التشغيل…', 'Reading runtime services…')}</p>`;
    if (runtime.error) return `<section class="errbar data" role="alert"><b>${A('مقدرناش نقرا خدمات التشغيل', 'Runtime services could not be read')}</b><p class="small">${esc(runtime.error)}</p></section>`;
    const r = runtime.data;
    const head = `<section class="pagehead"><h1 style="font-size:26px">${A('تشغيل بيئة التطوير', 'Development runtime')}</h1><p class="muted">${A('خدمات محددة ومراجَعة في .yallaflow/runtime.yaml. مفيش حاجة بتشتغل لوحدها: بتوثّق الأمر مرة، وتشغّل وتوقف بنفسك. YallaFlow بيوقف بس البرامج اللي هو شغّلها وقادر يتعرّف عليها.', 'Reviewed services from .yallaflow/runtime.yaml. Nothing runs on its own: you trust a command once, then start and stop it yourself. YallaFlow stops only processes it started and can positively identify.')}</p></section>`;
    if (!r.supported) return head + `<section class="panel"><p>${A('مدير التشغيل مدعوم على Linux وmacOS بس.', 'The runtime manager supports Linux and macOS only.')}</p></section>`;
    const profileErr = r.profile.error ? `<section class="errbar data" role="alert"><b>${A('ملف التشغيل فيه مشكلة', 'The runtime profile is invalid')}</b><p class="small">${esc(r.profile.error)}</p></section>` : '';
    const services = r.services.length ? `<section class="svcs">${r.services.map(serviceCard).join('')}</section>` : `<section class="panel"><p class="small">${A('لسه مفيش خدمات معرّفة. ضيف خدمة من الاقتراحات تحت أو بنفسك، وبعدين وثّقها وشغّلها لما تكون جاهز.', 'No services are defined yet. Add one from the suggestions below or yourself, then trust and start it when you are ready.')}</p></section>`;
    const configure = readOnly ? '' : `<details class="panel" style="margin-top:16px" ${r.services.length || r.suggestions.length ? '' : 'open'}><summary><b>${A('ضيف خدمة بنفسك', 'Add a service yourself')}</b></summary>
      <form class="wizform" data-rt-form data-keep="rt-${esc(pid)}" style="margin-top:10px">
        <div class="twocol"><label>${A('الاسم', 'Name')}<input name="name" required maxlength="60" placeholder="Web"></label><label>${A('المعرّف', 'Id')} <span class="tiny muted">(a-z 0-9 -)</span><input class="ltr" name="id" required pattern="[a-z][a-z0-9-]{0,31}" placeholder="web"></label></div>
        <div class="twocol"><label>${A('النوع', 'Kind')}<select name="kind"><option value="process">${A('أمر (process)', 'Command (process)')}</option><option value="docker-compose">Docker Compose</option></select></label><label>${A('فولدر التشغيل (جوه المشروع)', 'Working folder (inside the project)')}<input class="ltr" name="cwd" value="."></label></div>
        <label>${A('الأمر', 'Command')} <span class="tiny muted">${A('(البرنامج والوسائط، من غير shell)', '(program and arguments, no shell)')}</span><input class="ltr mono" name="command" required placeholder="npm run dev"></label>
        <div class="twocol"><label>${A('المنافذ', 'Ports')} <span class="tiny muted">${A('(مفصولة بفاصلة)', '(comma separated)')}</span><input class="ltr" name="ports" placeholder="5173"></label><label>${A('أسماء متغيرات البيئة', 'Environment variable names')} <span class="tiny muted">${A('(أسماء بس، القيم بتفضل عندك)', '(names only; values stay with you)')}</span><input class="ltr" name="env" placeholder="API_URL"></label></div>
        <label class="small"><input type="checkbox" name="local"> ${A('على الجهاز ده بس (مش متشاركة في المستودع)', 'This machine only (not shared in the repository)')}</label>
        <div class="row"><button class="btn go sm" type="submit">${A('ضيف الخدمة', 'Add the service')}</button><span class="tiny muted">${A('الإضافة مابتشغّلش حاجة.', 'Adding runs nothing.')}</span></div>
        ${runtimeErr.__add ? `<p class="small" role="alert" style="color:var(--clay);white-space:pre-wrap">${esc(runtimeErr.__add)}</p>` : ''}</form></details>`;
    const sugg = r.suggestions.length ? `<section class="panel" style="margin-top:16px"><h2 style="font-size:17px">${A('اقتراحات من ملفات المشروع', 'Suggestions from repository files')}</h2><p class="tiny muted">${A('الاقتراحات مابتشتغلش. ضيفها، راجعها، ووثّقها — التشغيل خطوة منفصلة.', 'Suggestions never run. Add one, review it, then trust it — starting is a separate step.')}</p><ul class="modules">${r.suggestions.map((x) => `<li><b>${esc(x.name)}</b> <span class="ltr mono small">${esc(x.command.join(' '))}</span> <span class="tiny muted">${A('من', 'from')} <span class="ltr">${esc(x.evidence.join(', '))}</span></span>${x.note ? `<p class="tiny muted">${esc(x.note)}</p>` : ''}${readOnly ? '' : `<div class="row" style="margin-top:6px"><button class="btn sm" data-rt-suggest="${esc(x.id)}">${A('ضيف الخدمة دي', 'Add this service')}</button></div>`}</li>`).join('')}</ul></section>` : '';
    return head + profileErr + services + sugg + configure + devPanel(A('أوامر التشغيل', 'Runtime commands'), ['yallaflow runtime status', 'yallaflow runtime suggest', 'yallaflow runtime add <id> --cwd DIR --port N -- <executable> [args...]', 'yallaflow runtime trust <id>', 'yallaflow runtime start|stop|restart <id>', 'yallaflow runtime logs <id>', 'yallaflow runtime stop --all']);
  }
  // The add-service form is never redrawn while the developer is using it (PF-0057).
  const rtFormBusy = () => { const form = document.querySelector('[data-rt-form]'); return Boolean(form && (form.contains(document.activeElement) || [...form.querySelectorAll('input:not([type=checkbox])')].some((x) => x.value !== x.defaultValue))); };
  // Splits a typed command into argv (quotes group words; no shell features).
  function argvOf(text) {
    const out = []; let cur = ''; let quote = null; let any = false;
    for (const ch of String(text)) {
      if (quote) { if (ch === quote) quote = null; else cur += ch; }
      else if (ch === '"' || ch === "'") { quote = ch; any = true; }
      else if (/\s/.test(ch)) { if (cur || any) out.push(cur); cur = ''; any = false; }
      else cur += ch;
    }
    if (cur || any) out.push(cur);
    return out;
  }
  async function addService(body) {
    runtimeErr.__add = null;
    try {
      await post(`/api/p/${pid}/runtime/services`, JSON.stringify(body), { 'Content-Type': 'application/json' });
      document.querySelector('[data-rt-form]')?.reset();
      toast(A('الخدمة اتضافت. راجعها ووثّقها قبل التشغيل.', 'Service added. Review and trust it before starting.'));
    } catch (e) { runtimeErr.__add = e.message; toast(esc(e.message)); }
    await loadRuntime(); render();
  }
  function submitService(form) {
    const d = new FormData(form);
    const list = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    addService({ id: String(d.get('id') ?? '').trim(), name: String(d.get('name') ?? '').trim(), kind: String(d.get('kind')), cwd: String(d.get('cwd') ?? '.').trim() || '.', ports: list(d.get('ports')).map(Number), env: list(d.get('env')), local: d.get('local') === 'on', argv: argvOf(d.get('command')) });
  }
  async function runtimeAction(action, id) {
    if (readOnly || runtimeBusy[id]) return;
    let body = {};
    if (action === 'trust') {
      // Trust is bound to the exact definition shown on this card; a changed profile is refused.
      // The hash of the definition rendered on the card the user reviewed, not of newer data.
      const card = document.querySelector(`[data-service="${CSS.escape(id)}"]`);
      body = { confirm: card?.querySelector('[data-trust-input]')?.value.trim() ?? '', definitionHash: card?.dataset.definitionHash ?? '' };
    }
    runtimeBusy[id] = action; runtimeErr[id] = null; render();
    try {
      await post(`/api/p/${pid}/runtime/${encodeURIComponent(id)}/${action}`, JSON.stringify(body), { 'Content-Type': 'application/json' });
    } catch (e) {
      runtimeErr[id] = e.message;
    }
    runtimeBusy[id] = null;
    await loadRuntime();
    if (runtimeLogs[id]) await loadServiceLogs(id);
    render();
  }
  async function loadServiceLogs(id) {
    try { runtimeLogs[id] = (await api(`/api/p/${pid}/runtime/${encodeURIComponent(id)}/logs?lines=200`)).lines; } catch (e) { runtimeErr[id] = e.message; }
  }
  // While Setup is open, state is re-read every few seconds (a service can crash at any time).
  function syncRuntimePolling() {
    const want = route().v === 'setup';
    if (want && !runtimeTimer) runtimeTimer = setInterval(async () => { if (Object.values(runtimeBusy).some(Boolean)) return; await loadRuntime(); if (route().v === 'setup' && !document.activeElement?.matches?.('[data-trust-input]') && !rtFormBusy()) render(); }, 3000);
    if (!want && runtimeTimer) { clearInterval(runtimeTimer); runtimeTimer = null; }
  }

  // ---------- new project (1.4.0, PF-0057): a four-step stepper ----------
  // 1 Idea → 2 Stack → 3 Environment → 4 Review & create. The plan is created when step 4
  // opens and is immutable; Create sends its full hash (a changed plan is refused). A plan
  // that installs dependencies also needs the project name typed. Attachments are listed in
  // the plan by size and SHA-256 and uploaded to the first work item after creation. The
  // server registers the new project in the console; the page then switches to it.
  let wiz = { step: 1, catalog: null, tools: null, form: null, files: [], plan: null, error: null, busy: false, progress: null, confirmName: '', attach: null, registration: null };
  let wizTimer = null;
  async function loadWizard() {
    if (!wiz.catalog) { try { wiz.catalog = await api('/api/new/catalog'); } catch (e) { wiz.error = e.message; } }
  }
  async function loadTools() {
    if (wiz.tools) return;
    try { wiz.tools = await api('/api/new/tools'); } catch { wiz.tools = { tools: [] }; }
    if (route().v === 'new') render();
  }
  const parentGuess = () => { const root = projects.find((p) => p.id === pid)?.root ?? projects[0]?.root ?? ''; return root.replace(/[\\/][^\\/]+[\\/]?$/, '') || root; };
  const CAT = { fullstack: { ar: 'Full-stack: واجهة وخادم في مشروع واحد', en: 'Full-stack: frontend and server in one project' }, frontend: { ar: 'واجهة بس (Frontend)', en: 'Frontend only' }, backend: { ar: 'خادم بس (Backend / API)', en: 'Backend only (API)' }, blank: { ar: 'فاضي', en: 'Blank' } };
  const ENV = {
    docker: { t: { ar: 'Docker', en: 'Docker' }, d: { ar: 'هنسجّل إنك عايز تشتغل بـDocker. مفيش ملفات Docker بتتعمل دلوقتي، وهتضبطها بعدين من «التشغيل».', en: 'Records that you want to develop with Docker. No Docker files are created now; you set them up later in Setup.' }, tools: ['docker', 'docker-compose'] },
    local: { t: { ar: 'أدوات على جهازك', en: 'Local tools' }, d: { ar: 'هتشغّل المشروع بالأدوات المتسطّبة عندك. بعد الإنشاء، «التشغيل» بيقترح أوامر من ملفات المشروع وانت بتراجعها.', en: 'Run the project with tools installed on this machine. After creation, Setup suggests commands from the project files for you to review.' }, tools: ['node', 'npm', 'php', 'composer'] },
    later: { t: { ar: 'أقرر بعدين', en: 'Decide later' }, d: { ar: 'مفيش حاجة بتتسجّل للبيئة دلوقتي. تقدر تضبطها في أي وقت.', en: 'Nothing about the environment is recorded now. You can configure it at any time.' }, tools: [] }
  };
  const wizForm = () => (wiz.form ??= { name: '', description: '', requirements: '', parent: parentGuess(), stack: 'empty', environment: 'later', git: true, install: false, allowNested: false });
  // Same rule as the server: installing dependencies or running package scripts needs the name typed.
  const typedName = (b) => Boolean(b.install) || b.steps.some((st) => st.installsDependencies || st.runsPackageScripts);
  const stackOf = (id) => wiz.catalog?.catalog.find((c) => c.id === id);
  function stepper() {
    const names = [A('الفكرة', 'Idea'), A('التقنية', 'Stack'), A('البيئة', 'Environment'), A('راجع وأنشئ', 'Review & create')];
    const at = typeof wiz.step === 'number' ? wiz.step : 5;
    return `<ol class="stepper">${names.map((n, i) => `<li class="${i + 1 < at ? 'done' : i + 1 === at ? 'now' : ''}" ${i + 1 === at ? 'aria-current="step"' : ''}><span class="sn">${i + 1 < at ? '✓' : i + 1}</span>${n}</li>`).join('')}</ol>`;
  }
  const navRow = (next, { back = true, nextLabel = A('التالي', 'Next') } = {}) => `<div class="row wiznav">${back ? `<button class="btn ghost" type="button" data-wiz-prev>${A('رجوع', 'Back')}</button>` : ''}<span class="grow"></span>${next ? `<button class="btn go" type="submit" ${wiz.busy ? 'disabled' : ''}>${nextLabel}</button>` : ''}</div>`;
  function viewNew() {
    const head = `<section class="pagehead"><h1 style="font-size:26px">${A('مشروع جديد', 'New project')}</h1><p class="muted">${A('اوصف اللي هتبنيه، اختار التقنية والبيئة، راجع، وبعدين أنشئ. YallaFlow بيعمل فولدر جديد بس، عمره ما بيكتب فوق حاجة موجودة.', 'Describe what you are building, choose the stack and environment, review, then create. YallaFlow only creates a new folder; it never overwrites anything.')}</p></section>`;
    if (readOnly) return head + `<section class="panel"><p>${A('الكونسول ده للقراءة بس.', 'This console is read-only.')}</p></section>`;
    if (!wiz.catalog) return head + (wiz.error ? `<section class="errbar" role="alert"><p>${esc(wiz.error)}</p></section>` : `<p class="muted">${A('بيحمّل…', 'Loading…')}</p>`);
    const err = wiz.error ? `<section class="errbar" role="alert" style="margin-bottom:12px"><p class="small" style="white-space:pre-wrap">${esc(wiz.error)}</p></section>` : '';
    const f = wizForm();
    if (wiz.step === 1) {
      const files = wiz.files.map((x, i) => `<li><span class="ltr">${esc(x.name)}</span> <span class="tiny muted">${size(x.size)}</span> <button type="button" class="btn ghost sm" data-wiz-unfile="${i}" aria-label="${A('شيل', 'Remove')} ${esc(x.name)}">✕</button></li>`).join('');
      return head + stepper() + err + `<form class="panel wizform" data-wiz-step="1" data-keep="wiz-1" novalidate>
        <label>${A('اسم المشروع', 'Project name')} <span class="tiny muted">${A('(حروف إنجليزي وأرقام و . _ -)', '(letters, digits, . _ -)')}</span><input class="ltr" name="name" required pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,63}" value="${esc(f.name)}" autocomplete="off"></label>
        <label>${A('عايز تبني إيه؟', 'What do you want to build?')}<textarea name="description" rows="3" maxlength="4000" placeholder="${A('مثلاً: نوت بوك مشترك للفرق الصغيرة يحفظ محاضر الاجتماعات.', 'For example: a shared notebook for small teams to keep meeting notes.')}">${esc(f.description)}</textarea></label>
        <details ${f.requirements ? 'open' : ''}><summary class="small">${A('متطلبات وسياق (اختياري)', 'Requirements and context (optional)')}</summary><textarea name="requirements" rows="5" maxlength="16000" placeholder="${A('المزايا المطلوبة، المستخدمين، القيود…', 'Features, users, constraints…')}">${esc(f.requirements)}</textarea></details>
        <fieldset><legend>${A('مرفقات (اختياري)', 'Attachments (optional)')}</legend><p class="tiny muted">${A('BRD أو Word أو PDF أو صور. بتترفق بأول شغلانة بعد الإنشاء، وبتتطابق مع اللي راجعته.', 'A BRD, Word, PDF or screenshots. They are attached to the first work item after creation, matched to what you reviewed.')}</p>
          <input type="file" multiple accept="${ACCEPT}" data-wiz-files>${files ? `<ul class="wizfiles">${files}</ul>` : ''}</fieldset>
        <fieldset><legend>${A('المكان', 'Location')}</legend><div class="row"><span class="ltr mono grow wizpath">${esc(f.parent || A('لسه مااخترتش', 'not chosen yet'))}</span><button class="btn sm" type="button" data-folder-open="parent">${A('اختار فولدر', 'Choose folder')}</button></div>
          <p class="tiny muted">${A('المشروع هيتعمل في:', 'The project will be created at:')} <span class="ltr mono">${esc(f.parent && f.name ? `${f.parent.replace(/[\\/]$/, '')}/${f.name}` : '—')}</span></p>
          <details class="small"><summary>${A('اكتب المسار بنفسك (متقدم)', 'Type the path yourself (advanced)')}</summary><input class="ltr" name="parent" value="${esc(f.parent)}" autocomplete="off" aria-label="${A('الفولدر الأب', 'Parent folder')}"></details></fieldset>
        ${navRow(true, { back: false })}</form>`;
    }
    if (wiz.step === 2) {
      const groups = ['fullstack', 'frontend', 'backend', 'blank'].map((cat) => {
        const list = wiz.catalog.catalog.filter((c) => (c.category ?? 'blank') === cat);
        if (!list.length) return '';
        return `<fieldset class="stackgroup"><legend>${L(CAT[cat])}</legend><div class="stackgrid">${list.map((c) => `<label class="stackcard ${f.stack === c.id ? 'on' : ''}"><input type="radio" name="wiz-stack" value="${esc(c.id)}" ${f.stack === c.id ? 'checked' : ''}><b>${esc(c.label)}</b><span class="tiny muted">${esc(c.stack.join(' · ') || A('من غير كود', 'no code'))}</span>${c.fit ? `<span class="small">${esc(c.fit)}</span>` : ''}${c.tradeoffs ? `<span class="tiny muted">⚖ ${esc(c.tradeoffs)}</span>` : ''}<span class="row tiny">${c.network ? `<span class="chip wait">${A('محتاج إنترنت', 'needs network')}</span>` : ''}</span></label>`).join('')}</div></fieldset>`;
      }).join('');
      return head + stepper() + err + `<form class="panel wizform" data-wiz-step="2" data-keep="wiz-2">
        <p class="small">${A('اختار التقنية بنفسك. تقدر تغيّرها لحد ما تأكد الإنشاء.', 'Choose the stack yourself. You can change it until you confirm creation.')}</p>${groups}
        <p class="tiny muted" style="margin-top:8px">ⓘ ${A('اقتراح التقنية من وكيلك لسه مش متاح هنا. لو مش متأكد، اختار «مشروع فاضي» واسأل وكيلك بعد الإنشاء.', 'A stack recommendation from your agent is not available here yet. If you are unsure, choose the empty project and ask your agent after creation.')}</p>
        ${navRow(true)}</form>`;
    }
    if (wiz.step === 3) {
      loadTools();
      const st = stackOf(f.stack);
      const tool = (id) => wiz.tools?.tools.find((t) => t.id === id);
      const toolChips = (ids) => ids.map((id) => { const t = tool(id); return !wiz.tools ? `<span class="tag">${esc(id)} …</span>` : `<span class="chip ${t?.found ? 'done' : 'wait'}" title="${esc(t?.version ?? '')}"><i></i>${esc(id)} ${t?.found ? `<span class="ltr tiny">${esc((/\d+(?:\.\d+){1,2}/.exec(t.version) ?? [A('موجود', 'found')])[0])}</span>` : A('مش موجود', 'not found')}</span>`; }).join(' ');
      const envs = ['docker', 'local', 'later'].map((k) => `<label class="stackcard ${f.environment === k ? 'on' : ''}"><input type="radio" name="wiz-env" value="${k}" ${f.environment === k ? 'checked' : ''}><b>${L(ENV[k].t)}</b><span class="small">${L(ENV[k].d)}</span>${ENV[k].tools.length ? `<span class="row tiny">${toolChips(ENV[k].tools)}</span>` : ''}</label>`).join('');
      return head + stepper() + err + `<form class="panel wizform" data-wiz-step="3" data-keep="wiz-3">
        <fieldset><legend>${A('بيئة التطوير', 'Development environment')}</legend><div class="stackgrid">${envs}</div><p class="tiny muted">${A('YallaFlow بيفحص الأدوات بس، مابيسطّبش ولا بيشغّل حاجة.', 'YallaFlow only checks for tools; it installs and runs nothing.')}</p></fieldset>
        <fieldset><legend>Git</legend><label class="small"><input type="checkbox" name="git" ${f.git ? 'checked' : ''}> ${A('اعمل Git repository محلي', 'Initialize a local Git repository')} ${toolChips(['git'])}</label>
          <p class="tiny muted">${A('بيعمل git init بس: من غير remote ولا commit ولا push. ربطه بـGitHub أو غيره خطوة منفصلة بتعملها انت.', 'Runs git init only: no remote, no commit, no push. Connecting it to GitHub or another remote is a separate step you take yourself.')}</p></fieldset>
        ${st?.install ? `<fieldset><legend>${A('المكتبات', 'Dependencies')}</legend><label class="small"><input type="checkbox" name="install" ${f.install ? 'checked' : ''}> ${A('سطّب المكتبات بعد الإنشاء', 'Install dependencies after creation')} <span class="ltr tiny mono">${esc(st.install.join(' '))}</span></label><p class="tiny muted">${A('بيحتاج إنترنت وبيشغّل سكريبتات الحزم، فهتكتب اسم المشروع علشان تأكد.', 'Needs the network and runs package scripts, so you will type the project name to confirm.')}</p></fieldset>` : ''}
        <details class="small"><summary>${A('متقدم', 'Advanced')}</summary><label><input type="checkbox" name="allowNested" ${f.allowNested ? 'checked' : ''}> ${A('اسمح بمشروع جوه مستودع موجود', 'Allow a project inside an existing repository')}</label></details>
        ${navRow(true, { nextLabel: wiz.busy ? A('بيجهّز الخطة…', 'Preparing the plan…') : A('راجع', 'Review') })}</form>`;
    }
    const plan = wiz.plan;
    if (!plan) return head + stepper() + err + `<section class="panel"><p class="muted">${A('بيجهّز الخطة…', 'Preparing the plan…')}</p>${navRow(false)}</section>`;
    const b = plan.body;
    const envText = b.environment ? L(ENV[b.environment].t) : L(ENV.later.t);
    const will = [
      A(`فولدر جديد: ${b.destination}`, `A new folder: ${b.destination}`),
      b.generator ? A(`كود مبدئي من ${b.generator.package}@${b.generator.version}`, `Starter code from ${b.generator.package}@${b.generator.version}`) : A('من غير كود (مشروع فاضي)', 'No code (an empty project)'),
      ...(b.install ? [A('تسطيب المكتبات', 'Dependency install')] : []),
      A('سجلات YallaFlow للمشروع كمشروع جديد', 'YallaFlow records for the project, as a new project'),
      ...(b.git ? [A('Git repository محلي (من غير commit)', 'A local Git repository (no commit)')] : []),
      A('أول شغلانة بوصفك، مش متفعّلة', 'A first work item with your description, not activated'),
      ...(b.attachments?.length ? [A(`${b.attachments.length} مرفق على أول شغلانة`, `${b.attachments.length} attachment(s) on the first work item`)] : [])
    ];
    const wont = [A('مفيش حاجة موجودة بتتكتب فوقها', 'Nothing existing is overwritten'), A('مفيش remote ولا commit ولا push', 'No remote, commit or push'), A('مفيش خدمات بتشتغل ولا وكيل بيبدأ', 'No services run and no agent starts'), ...(b.environment === 'docker' ? [A('مفيش ملفات Docker لسه', 'No Docker files yet')] : [])];
    const steps = b.steps.map((st) => st.argv ? `<li><span class="ltr mono">${esc(JSON.stringify(st.argv))}</span> ${st.network ? `<span class="chip wait">${A('إنترنت', 'network')}</span>` : ''}${st.installsDependencies ? `<span class="chip wait">${A('بيسطّب مكتبات', 'installs dependencies')}</span>` : ''}${st.runsPackageScripts ? `<span class="chip wait">${A('بيشغّل سكريبتات', 'runs scripts')}</span>` : ''}</li>` : `<li class="muted">${esc(st.note ?? st.id)}</li>`).join('');
    const prereq = b.prerequisites.map((p) => `<li>${esc(p.name)}: ${p.found ? `<span class="ltr">${esc(p.version || 'found')}</span>` : `<b style="color:var(--clay)">${A('مش موجود — سطّبه الأول', 'not found — install it first')}</b>`}</li>`).join('');
    const summary = `<section class="panel"><h2 style="font-size:18px">${A('ملخص', 'Summary')}</h2>
      <dl class="svcdef"><dt>${A('المشروع', 'Project')}</dt><dd class="ltr">${esc(b.name)}</dd>
      <dt>${A('الهدف', 'Purpose')}</dt><dd>${b.intent?.description ? esc(b.intent.description) : `<span class="muted">${A('لسه مااتوصفش — هتحدده مع وكيلك', 'not described yet — you will define it with your agent')}</span>`}</dd>
      <dt>${A('المكان', 'Location')}</dt><dd class="ltr mono">${esc(b.destination)}</dd>
      <dt>${A('التقنية', 'Stack')}</dt><dd>${esc(b.stackLabel)}</dd>
      <dt>${A('البيئة', 'Environment')}</dt><dd>${envText}${b.environment === 'docker' ? ` <span class="tiny muted">(${A('مخططة', 'planned')})</span>` : ''}</dd>
      <dt>Git</dt><dd>${b.git ? A('repository محلي جديد', 'a new local repository') : A('لأ', 'no')}</dd>
      ${b.intent?.requirements ? `<dt>${A('المتطلبات', 'Requirements')}</dt><dd><div class="brief clamp3"><p>${esc(b.intent.requirements)}</p></div></dd>` : ''}
      ${b.attachments?.length ? `<dt>${A('المرفقات', 'Attachments')}</dt><dd>${b.attachments.map((a) => `<span class="ltr tag">${esc(a.name)}</span>`).join(' ')}</dd>` : ''}</dl>
      <div class="twocol" style="margin-top:12px"><div><h3 style="font-size:15px">${A('هيتعمل', 'Will be created')}</h3><ul class="small">${will.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div><div><h3 style="font-size:15px">${A('مش هيحصل', 'Will not happen')}</h3><ul class="small">${wont.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>
      ${prereq && b.prerequisites.some((p) => !p.found) ? `<p class="small" style="margin-top:8px;color:var(--clay)">${A('في أدوات ناقصة، الإنشاء هيفشل غالباً:', 'Some tools are missing; creation will likely fail:')}</p><ul class="small">${prereq}</ul>` : ''}
      <details style="margin-top:12px"><summary class="small">${A('تفاصيل تقنية', 'Technical details')}</summary><ol class="wizsteps">${steps}</ol>${prereq ? `<ul class="small">${prereq}</ul>` : ''}<p class="tiny muted ltr">plan ${esc(plan.id)} · sha256 ${esc(plan.hash)}</p></details></section>`;
    if (wiz.step === 4) {
      return head + stepper() + err + summary + `<form class="panel" data-wiz-create data-keep="wiz-4" style="margin-top:12px">
        ${typedName(b) ? `<label class="small">${A('الخطة دي بتسطّب مكتبات أو بتشغّل سكريبتات. اكتب اسم المشروع علشان تأكد:', 'This plan installs dependencies or runs scripts. Type the project name to confirm:')} <b class="ltr">${esc(b.name)}</b> <input class="ltr" name="confirmName" size="16" autocomplete="off" required value="${esc(wiz.confirmName)}"></label>` : `<p class="small">${A('لما تدوس «أنشئ المشروع»، YallaFlow بينفّذ الخطة اللي فوق دي بالظبط. لو اتغيّرت، الإنشاء بيترفض.', 'When you press Create the project, YallaFlow carries out exactly the plan above. If it changed, creation is refused.')}</p>`}
        <div class="row wiznav"><button class="btn ghost" type="button" data-wiz-prev>${A('رجوع', 'Back')}</button><span class="grow"></span><button class="btn go" type="submit" ${wiz.busy ? 'disabled' : ''}>${A('أنشئ المشروع', 'Create the project')}</button></div></form>`;
    }
    // Progress and outcome.
    const pr = wiz.progress;
    const stepState = (id) => pr?.plan?.progress?.steps?.[id]?.status ?? 'pending';
    const LABEL = { generate: b.generator ? A('توليد المشروع', 'Generate the project') : A('تجهيز الفولدر', 'Prepare the folder'), promote: b.generator ? A('نقله للمكان النهائي', 'Move it into place') : A('إنشاء فولدر المشروع', 'Create the project folder'), install: A('تسطيب المكتبات', 'Install dependencies'), init: A('تهيئة YallaFlow', 'Initialize YallaFlow'), 'git-init': A('إنشاء Git repository', 'Initialize Git'), 'first-work': A('أول شغلانة', 'First work item') };
    const list = b.steps.filter((st) => LABEL[st.id]).map((st) => `<li data-wiz-step="${st.id}" data-state="${esc(stepState(st.id))}">${esc(LABEL[st.id])}</li>`).join('');
    const outcome = pr?.outcome;
    let result = '';
    if (outcome?.ok) {
      const attachLine = wiz.attach ? `<ul class="small">${wiz.attach.map((x) => `<li>${x.ok ? '✓' : '⚠'} <span class="ltr">${esc(x.name)}</span>${x.ok ? '' : ` — ${esc(x.error)}`}</li>`).join('')}</ul>${wiz.attach.some((x) => !x.ok) ? `<button class="btn sm" data-wiz-reattach>${A('ارفع المرفقات تاني', 'Retry attachments')}</button> <span class="tiny muted">${A('أو اختارهم تاني:', 'or pick them again:')}</span> <input type="file" multiple accept="${ACCEPT}" data-wiz-refiles>` : ''}` : '';
      const reg = wiz.registration ?? outcome.registration;
      result = `<section class="panel" data-wiz-done style="margin-top:12px"><h2 style="font-size:18px">${A('المشروع اتعمل ✓', 'The project was created ✓')}</h2><p class="small ltr mono">${esc(outcome.destination)}</p>${attachLine}
        ${reg?.ok ? `<p class="small">${A('اتضاف للكونسول.', 'Added to the console.')}</p><a class="btn go" href="#/overview" data-open-project="${esc(reg.id)}" data-open-view="overview">${A('افتح المشروع', 'Open the project')}</a>`
          : `<div class="errbar data" role="alert"><b>${A('المشروع اتعمل، بس مااتضافش للكونسول', 'The project exists, but it was not added to the console')}</b><p class="small">${esc(reg?.message ?? '')}</p><button class="btn sm" data-wiz-register>${A('ضيفه للكونسول', 'Add it to the console')}</button><p class="tiny muted">${A('ده بيسجّله بس، عمره ما بيعمل مشروع تاني.', 'This only registers it; it never creates a second project.')}</p></div>`}</section>`;
    } else if (outcome?.error) {
      result = `<section class="errbar" role="alert" data-wiz-failed style="margin-top:12px"><b>${A('الإنشاء وقف — مفيش حاجة اتكتب فوقها', 'Creation stopped — nothing was overwritten')}</b><p class="small" style="white-space:pre-wrap">${esc(outcome.error.message)}</p><div class="row"><button class="btn sm" data-wiz-retry>${A('حاول تاني', 'Retry')}</button><span class="tiny muted">${A('المحاولة بتكمّل من آخر خطوة خلصت، ومابتعملش مشروع تاني.', 'Retrying continues from the last finished step and never creates a second project.')}</span></div>
        <details class="small"><summary>${A('تفاصيل تقنية', 'Technical details')}</summary><code class="ltr">yallaflow new discard ${esc(plan.id)}</code></details></section>`;
    }
    return head + stepper() + summary + `<section class="panel" style="margin-top:12px"><h2 style="font-size:18px">${A('التقدّم', 'Progress')}</h2><ol class="wizsteps">${list}</ol>${pr?.log ? `<details><summary class="small">${A('السجل', 'Log')}</summary><pre class="svclog ltr" tabindex="0">${esc(pr.log)}</pre></details>` : ''}</section>` + result;
  }
  function readStep(form) {
    const f = wizForm();
    const data = new FormData(form);
    if (form.dataset.wizStep === '1') {
      f.name = String(data.get('name') ?? '').trim();
      f.description = String(data.get('description') ?? '');
      f.requirements = String(data.get('requirements') ?? '');
      f.parent = String(data.get('parent') ?? f.parent).trim();
    } else if (form.dataset.wizStep === '2') {
      f.stack = String(data.get('wiz-stack') ?? f.stack);
      if (!stackOf(f.stack)?.install) f.install = false;
    } else if (form.dataset.wizStep === '3') {
      f.environment = String(data.get('wiz-env') ?? f.environment);
      f.git = data.get('git') === 'on';
      f.install = data.get('install') === 'on';
      f.allowNested = data.get('allowNested') === 'on';
    }
  }
  async function wizardNext(form) {
    readStep(form);
    const f = wizForm();
    wiz.error = null;
    if (wiz.step === 1) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(f.name)) { wiz.error = A('اسم المشروع لازم يبدأ بحرف أو رقم، ومن غير مسافات (حروف إنجليزي وأرقام و . _ -).', 'The project name must start with a letter or digit, without spaces (letters, digits, . _ -).'); return render(); }
      if (!f.parent.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(f.parent)) { wiz.error = A('اختار الفولدر اللي هيتعمل جواه المشروع.', 'Choose the folder the project will be created in.'); return render(); }
      wiz.step = 2; return render();
    }
    if (wiz.step === 2) { wiz.step = 3; return render(); }
    if (wiz.step === 3) {
      wiz.busy = true; wiz.plan = null; render();
      try {
        wiz.plan = await post('/api/new/plan', JSON.stringify({ name: f.name, parent: f.parent, stack: f.stack, install: f.install, allowNested: f.allowNested, description: f.description.trim() || null, requirements: f.requirements.trim() || null, environment: f.environment, git: f.git, files: wiz.files.map(({ name, size: s, sha256 }) => ({ name, size: s, sha256 })) }), { 'Content-Type': 'application/json' });
        wiz.step = 4;
      } catch (e) {
        wiz.error = e.message;
        if (e.code === 'NEW_PROJECT_NESTED' || e.code === 'NEW_PROJECT_EXISTS' || e.code === 'NEW_PROJECT_PARENT') wiz.step = e.code === 'NEW_PROJECT_NESTED' ? 3 : 1;
      }
      wiz.busy = false; render();
    }
  }
  async function hashFile(file) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
  }
  async function addWizardFiles(list) {
    for (const file of list) {
      if (wiz.files.length >= 10) { wiz.error = A('أقصى حد 10 مرفقات.', 'At most 10 attachments.'); break; }
      const sha256 = await hashFile(file);
      if (wiz.files.some((x) => x.sha256 === sha256)) continue;
      wiz.files.push({ file, name: file.name, size: file.size, sha256 });
    }
    render();
  }
  async function pollWizard() {
    if (!wiz.plan) return;
    try { wiz.progress = await api(`/api/new/plans/${wiz.plan.id}`); } catch (e) { wiz.error = e.message; }
    if (wiz.progress?.outcome && wizTimer) {
      clearInterval(wizTimer); wizTimer = null;
      if (wiz.progress.outcome.ok) await afterCreate(wiz.progress.outcome);
    }
    if (route().v === 'new') render();
  }
  async function wizardCreate(form) {
    const confirmName = form ? String(new FormData(form).get('confirmName') ?? '').trim() : wiz.confirmName;
    wiz.confirmName = confirmName;
    wiz.busy = true; wiz.error = null; render();
    try {
      await post('/api/new/create', JSON.stringify({ planId: wiz.plan.id, confirm: wiz.plan.hash, ...(typedName(wiz.plan.body) ? { confirmName } : {}) }), { 'Content-Type': 'application/json' });
      wiz.step = 'progress'; wiz.progress = null; wiz.attach = null; wiz.registration = null;
      if (!wizTimer) wizTimer = setInterval(pollWizard, 1200);
      await pollWizard();
    } catch (e) { wiz.error = e.message; }
    wiz.busy = false; render();
  }
  async function uploadPlanned() {
    if (!wiz.plan.body.attachments?.length) return;
    const results = [];
    for (const planned of wiz.plan.body.attachments) {
      const picked = wiz.files.find((x) => x.sha256 === planned.sha256);
      if (!picked) { results.push({ name: planned.name, ok: false, error: A('الملف مش متاح في الصفحة دي — اختاره تاني.', 'The file is not available in this page — pick it again.') }); continue; }
      try {
        await post(`/api/new/plans/${wiz.plan.id}/files`, picked.file, { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(picked.name) });
        results.push({ name: planned.name, ok: true });
      } catch (e) { results.push({ name: planned.name, ok: false, error: e.message }); }
    }
    wiz.attach = results;
  }
  async function reloadProjects() {
    const listed = await api('/api/projects');
    projects = listed.projects;
    unavailable = listed.unavailable ?? [];
    agentsOn = Boolean(listed.agents?.enabled);
    agentsCanEnable = Boolean(listed.agents?.canEnable);
    agentsClaudeAvailable = Boolean(listed.agents?.claudeAvailable);
  }
  async function afterCreate(outcome) {
    await uploadPlanned();
    try { await reloadProjects(); } catch { /* shown on the next load */ }
    const reg = outcome.registration;
    // Everything worked: open the new project's Overview.
    if (reg?.ok && !(wiz.attach ?? []).some((x) => !x.ok)) {
      const id = reg.id;
      resetWizard();
      await switchProject(id, 'overview');
    }
  }
  function resetWizard() { wiz = { ...wiz, step: 1, form: null, files: [], plan: null, error: null, busy: false, progress: null, confirmName: '', attach: null, registration: null }; }
  async function wizardRegister() {
    try {
      const reg = await post('/api/projects', JSON.stringify({ planId: wiz.plan.id }), { 'Content-Type': 'application/json' });
      wiz.registration = { ok: true, ...reg };
      await reloadProjects();
    } catch (e) { wiz.registration = { ok: false, message: e.message }; }
    render();
  }

  // ---------- folder chooser (1.4.0, PF-0057): folders inside the home folder only ----------
  let folder = null; // { mode: 'parent'|'existing', data, error, busy }
  async function openFolder(mode, at) {
    folder = { mode, data: folder?.data ?? null, error: null, busy: true };
    let d = document.getElementById('folderdlg');
    if (!d) { d = document.createElement('dialog'); d.id = 'folderdlg'; d.className = 'panel folderdlg'; document.body.appendChild(d); }
    renderFolder();
    if (!d.open) d.showModal();
    try { folder.data = await api(`/api/fs/dirs?path=${encodeURIComponent(at ?? (mode === 'parent' ? wizForm().parent : '') ?? '')}`); } catch (e) {
      try { folder.data = await api('/api/fs/dirs'); folder.error = e.message; } catch (e2) { folder.error = e2.message; }
    }
    folder.busy = false; renderFolder();
    d.querySelector('[data-folder-go]')?.focus();
  }
  function renderFolder() {
    const d = document.getElementById('folderdlg');
    if (!d || !folder) return;
    const x = folder.data;
    const mark = (f) => `${f.yallaflow ? `<span class="chip done"><i></i>YallaFlow</span>` : ''}${f.git ? '<span class="chip todo">Git</span>' : ''}${f.empty ? `<span class="tag">${A('فاضي', 'empty')}</span>` : ''}`;
    const here = x ? x.here : null;
    const chooseLabel = folder.mode === 'parent' ? A('أنشئ المشروع جوه الفولدر ده', 'Create the project in this folder') : A('ضيف المشروع ده', 'Add this project');
    const canChoose = x && (folder.mode === 'parent' || here?.yallaflow);
    d.setAttribute('aria-label', folder.mode === 'parent' ? A('اختار فولدر', 'Choose a folder') : A('ضيف مشروع موجود', 'Add an existing project'));
    d.innerHTML = `<div class="row"><b class="grow">${folder.mode === 'parent' ? A('اختار الفولدر اللي هيتعمل جواه المشروع', 'Choose where to create the project') : A('اختار فولدر مشروع YallaFlow موجود', 'Choose an existing YallaFlow project folder')}</b><button type="button" class="btn ghost sm" data-folder-close>${A('اقفل', 'Close')}</button></div>
      ${x ? `<div class="row small" style="margin:8px 0">${x.parent ? `<button type="button" class="btn ghost sm" data-folder-go="${esc(x.parent)}" aria-label="${A('الفولدر الأعلى', 'Parent folder')}">↑</button>` : ''}<span class="ltr mono grow wizpath">${esc(x.path)}</span>${here ? mark(here) : ''}</div>` : ''}
      ${folder.error ? `<p class="small" role="alert" style="color:var(--clay)">${esc(folder.error)}</p>` : ''}
      ${folder.busy ? `<p class="muted small">${A('بيقرا…', 'Reading…')}</p>` : x ? `<ul class="folders" role="list">${x.folders.map((f) => `<li><button type="button" class="flink" data-folder-go="${esc(f.path)}"><span aria-hidden="true">📁</span> <span class="ltr">${esc(f.name)}</span></button>${mark(f)}</li>`).join('') || `<li class="muted small">${A('مفيش فولدرات هنا.', 'No folders here.')}</li>`}</ul>${x.truncated ? `<p class="tiny muted">${A('أول 500 فولدر بس.', 'First 500 folders only.')}</p>` : ''}` : ''}
      ${folder.mode === 'existing' && x && !here?.yallaflow ? `<p class="tiny muted">${A('الفولدر ده مفيهوش YallaFlow. المشروع الموجود من غير YallaFlow بيتجهز بفهم المشروع (Brownfield) كخطوة منفصلة.', 'This folder has no YallaFlow workspace. An existing repository without YallaFlow is set up through project onboarding (Brownfield), a separate step.')}</p>` : ''}
      <p class="tiny muted">${A('الفولدرات اللي جوه فولدر البيت بس، والمخفية مابتظهرش. مفيش ملفات بتتقري.', 'Only folders inside your home folder; hidden ones are not shown. No file is read.')}</p>
      <div class="row" style="margin-top:8px"><span class="grow"></span><button type="button" class="btn go" data-folder-choose ${canChoose ? '' : 'disabled'}>${chooseLabel}</button></div>`;
  }
  async function chooseFolder() {
    const x = folder?.data;
    if (!x) return;
    if (folder.mode === 'parent') {
      wizForm().parent = x.path;
      const typed = document.querySelector('[data-wiz-step="1"] input[name="parent"]');
      if (typed) { typed.value = x.path; typed.defaultValue = x.path; }
      document.getElementById('folderdlg')?.close();
      folder = null; render(); return;
    }
    folder.busy = true; renderFolder();
    try {
      const reg = await post('/api/projects', JSON.stringify({ root: x.path }), { 'Content-Type': 'application/json' });
      document.getElementById('folderdlg')?.close();
      folder = null;
      await reloadProjects();
      await switchProject(reg.id, 'overview');
    } catch (e) { folder.busy = false; folder.error = e.message; renderFolder(); }
  }

  // ---------- agents (1.4.0, PF-0057): off / unavailable / on, enabled for this run ----------
  let agentsCanEnable = false;
  let agentsClaudeAvailable = false;
  let agentInfo = null;
  async function loadAgentInfo() { try { agentInfo = await api('/api/agents'); agentsCanEnable = agentInfo.canEnable; } catch { agentInfo = null; } }
  // Enabling agents for this run (PF-0059/PF-0060): Codex, and Claude Code only if the
  // developer ticks its separate, unchecked, clearly experimental choice.
  function enableAgents() {
    let d = document.getElementById('agentsdlg');
    if (!d) { d = document.createElement('dialog'); d.id = 'agentsdlg'; d.className = 'panel'; document.body.appendChild(d); }
    const claudeChoice = agentsClaudeAvailable ? `<label class="small optin"><input type="checkbox" name="claude"> <b>${A('اسمح كمان بـ Claude Code (تجريبي)', 'Also allow Claude Code (experimental)')}</b></label>
      <ul class="tiny muted"><li>${A('بتشغّل Claude Code بنفسك في الترمينال بالأمر اللي هيظهر، وبعدها الشات بيشتغل في الاتجاهين.', 'You start Claude Code yourself in a terminal with the command shown; then the chat works both ways.')}</li><li>${A('بيحتاج --dangerously-load-development-channels، وClaude هيعرض تحذير قناة تطوير.', 'It needs --dangerously-load-development-channels, and Claude shows a development-channel warning.')}</li><li>${A('مفيش «وقّف» من الكونسول، والردود بتوصل كرسالة كاملة.', 'No Stop from the console; replies arrive as whole messages.')}</li><li>${A('رد Anthropic المكتوب على توزيع القناة لسه مستنيينه.', "Anthropic's written answer on distributing the channel is still pending.")}</li><li>${A('بيكتب ملف اتصال في .yallaflow/local (متجاهَل من git) في كل مشروع مفتوح.', 'It writes a connection file in .yallaflow/local (ignored by Git) in each open project.')}</li></ul>` : '';
    d.innerHTML = `<form method="dialog" data-agents-form class="wizform"><h2 style="font-size:18px">${A('تفعيل الوكلاء للجلسة دي', 'Enable agents for this session')}</h2>
      <p class="small">${A('Codex بيشتغل باشتراك ChatGPT بتاعك، من غير مفاتيح API. مفيش جلسة بتبدأ ومفيش شغلانة بتتفعّل لوحدها. ده بيخلص لما الكونسول يقفل.', 'Codex runs on your ChatGPT subscription, never API keys. No session starts and no work item is activated on its own. This ends when the console stops.')}</p>
      ${claudeChoice}
      <div class="row"><button type="button" class="btn ghost" data-agents-cancel>${A('إلغاء', 'Cancel')}</button><span class="grow"></span><button class="btn go" type="submit">${A('فعّل', 'Enable')}</button></div></form>`;
    d.showModal();
    d.querySelector('button[type="submit"]').focus();
  }
  async function confirmAgents(form) {
    const claude = Boolean(form.querySelector('input[name="claude"]')?.checked);
    document.getElementById('agentsdlg')?.close();
    try {
      const result = await post('/api/agents/enable', JSON.stringify({ confirm: true, ...(claude ? { claude: true } : {}) }), { 'Content-Type': 'application/json' });
      if (claude && !result?.claude) toast(esc(A('الوكلاء اتفعّلوا، بس Claude Code مااتفعّلش في الجلسة دي (اتفعّلت قبل كده من غيره). أعد تشغيل الكونسول علشان تختاره.', 'Agents are on, but Claude Code was not turned on for this session (it was enabled earlier without it). Restart the console to choose it.')));
      agentsOn = true; agentsCanEnable = false;
      await loadAgentInfo();
      if (route().v === 'item') await loadAgent();
    } catch (e) { toast(esc(e.message)); }
    render();
  }
  // The work item page while agents are off: say so plainly, and how to turn them on.
  function agentOffPanel(it) {
    const explain = `<p class="tiny muted">${A('«فعّل الشغلانة» بيخليها الشغلانة النشطة في YallaFlow. «ابدأ جلسة» بيفتح Codex عليها. ولا واحدة فيهم بتحصل لوحدها.', 'Activating makes this the active work item in YallaFlow. Starting a session opens Codex on it. Neither happens on its own.')}</p>`;
    if (readOnly) return `<section class="panel agent" id="agent"><h2>${A('الوكيل', 'Agent')}</h2><p class="small">${A('الكونسول ده للقراءة بس، فمساحة الوكيل مقفولة.', 'This console is read-only, so the Agent Workspace is off.')}</p></section>`;
    const codex = agentInfo?.codex;
    const status = codex && !codex.ready ? `<p class="small">${A('Codex مش جاهز على الجهاز ده:', 'Codex is not ready on this machine:')}</p><ul class="aprob">${codex.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '';
    return `<section class="panel agent" id="agent"><div class="ahead"><h2>${A('الوكيل', 'Agent')}</h2><span class="grow"></span><span class="chip todo">${A('مقفول', 'off')}</span></div>
      <p class="small">${A(`اشتغل على ${it.id} مع Codex من هنا. مساحة الوكيل مقفولة في الكونسول ده لحد ما تفعّلها.`, `Work on ${it.id} with Codex from here. The Agent Workspace is off in this console until you enable it.`)}</p>${status}
      ${agentsCanEnable ? `<button class="btn go sm" data-agents-enable>${A('فعّل الوكلاء للجلسة دي', 'Enable agents for this session')}</button>` : ''}${explain}</section>`;
  }

  // ---------- projects ----------
  let overview = null; // [{ project, snap | error }]
  async function loadOverview() {
    overview = await Promise.all(projects.map(async (project) => {
      try { return { project, snap: await api(`/api/p/${project.id}/snapshot`) }; } catch (e) { return { project, error: e.message }; }
    }));
  }
  function viewProjects() {
    if (!overview) return `<p class="muted" style="margin-top:30px">${A('بيحمّل المشاريع…', 'Loading projects…')}</p>`;
    const cards = overview.map(({ project, snap: s, error: e }) => {
      if (e) return `<article class="proj panel"><div class="grow"><h2 style="font-size:20px">${esc(project.name)}</h2><p class="small" style="color:var(--clay)">${A('YallaFlow مش قادر يقرا سجلات المشروع ده:', 'YallaFlow cannot read this project\'s records:')} ${esc(e)}</p></div></article>`;
      const openN = s.items.filter((it) => it.state !== 'done').length;
      const badge = !s.items.length ? `<span class="hico sm" aria-hidden="true">＋</span>` : openN ? ring(s.openCompletion ?? 0, 92, 9) : `<span class="hico sm done" aria-hidden="true">✓</span>`;
      const dist = ST.map((_, i) => s.items.filter((it) => curIndex(it) === i).length);
      const last = s.items.map((it) => it.lastActivityAt).filter(Boolean).sort().at(-1);
      return `<a class="proj panel ${project.id === pid ? 'here' : ''}" href="#/map" data-open-project="${project.id}">${badge}<div class="grow"><h2 style="font-size:20px">${esc(project.name)}</h2>
        <div class="row tiny" style="margin-top:4px">${s.counts.you ? `<span class="chip you"><i></i>${s.counts.you} ${L(STATE.you)}</span>` : ''}${s.counts.fail ? `<span class="chip fail"><i></i>${s.counts.fail} ${L(STATE.fail)}</span>` : ''}<span class="chip todo">${s.counts.active + s.counts.paused + s.counts.new} ${A('مفتوح', 'open')}</span><span class="chip done"><i></i>${s.counts.done} ${L(STATE.done)}</span>${s.invalid?.length ? `<span class="chip wait">⚠ ${s.invalid.length} ${A('سجلات مش سليمة', 'invalid')}</span>` : ''}</div>
        ${!s.items.length ? `<p class="small muted">${A('لسه مفيش شغل مسجّل.', 'No work recorded yet.')}</p>` : !openN ? `<p class="small muted">${A('كل الشغل المسجّل خلص.', 'All recorded work is done.')}</p>` : ''}
        <div class="pflow">${dist.map((n, i) => `<span style="--hue:${ST[i].hue}" data-tip="${esc(L(ST[i].name))}: ${n}"><i style="height:${6 + n * 10}px"></i><b>${n}</b></span>`).join('')}</div>
        <div class="tiny muted">${last ? A(`آخر نشاط مسجّل ${ago(last)}`, `last recorded activity ${ago(last)}`) : ''}</div></div></a>`;
    }).join('');
    return `<section class="pagehead"><div class="row"><h1 style="font-size:26px">${A('المشاريع', 'Projects')}</h1>${readOnly ? '' : `<button class="btn sm" data-folder-open="existing" style="margin-inline-start:auto">${A('ضيف مشروع موجود', 'Add an existing project')}</button><a class="btn sm go" href="#/new">＋ ${A('مشروع جديد', 'New project')}</a>`}</div><p class="muted">${A('كل مشروع ليه مجلد .yallaflow خاص بيه، والكونسول بيقرا كل واحد لوحده.', 'Each project has its own .yallaflow; the console reads each one separately.')}</p></section>
      ${overview.length ? `<section class="projects">${cards}</section>` : `<section class="panel"><h2 style="font-size:20px">${A('أهلاً في YallaFlow', 'Welcome to YallaFlow')}</h2><p class="small">${A('لسه مفيش مشاريع في الكونسول. ابدأ مشروع جديد، أو ضيف مشروع YallaFlow موجود.', 'There are no projects in the console yet. Start a new project, or add an existing YallaFlow project.')}</p>${readOnly ? '' : `<div class="row" style="margin-top:8px"><a class="btn go" href="#/new">＋ ${A('مشروع جديد', 'New project')}</a><button class="btn" data-folder-open="existing">${A('ضيف مشروع موجود', 'Add an existing project')}</button></div>`}</section>`}
      ${unavailable.length ? `<p class="small" style="margin-top:14px">${A('مش متاحة (الفولدر اتنقل أو اتمسح):', 'Unavailable (folder moved or deleted):')} ${unavailable.map((u) => `<span class="ltr tag">${esc(u)}</span>`).join(' ')}</p>` : ''}
      ${devPanel(A('إدارة قائمة المشاريع', 'Manage the project list'), ['yallaflow console add <folder>', 'yallaflow console remove <folder>', 'yallaflow console list'])}`;
  }

  // ---------- team: Git worktrees (checkouts), never presented as agent sessions ----------
  let team = null;
  async function loadTeam() {
    try { team = await api(`/api/p/${pid}/worktrees`); } catch (e) { team = { error: e.message }; }
  }
  const baseName = (p) => String(p).split(/[\\/]/).filter(Boolean).at(-1) ?? p;
  function viewTeam() {
    if (!team) return `<p class="muted" style="margin-top:30px">${A('بيحمّل…', 'Loading…')}</p>`;
    if (team.error) return `<section class="errbar">${esc(team.error)}</section>`;
    if (!team.git) return `<section class="pagehead"><h1 style="font-size:26px">${A('نسخ الشغل', 'Worktrees')}</h1><p class="muted">${A('المشروع ده مش جوه Git repository لسه.', 'This project is not in a Git repository yet.')}</p></section><section class="panel"><p class="small">${A('نسخ الشغل (git worktrees) بتخليك تشغّل أكتر من وكيل على شغلانات مختلفة في نفس الوقت من غير ما يتداخلوا. محتاجة Git الأول.', 'Worktrees (git worktrees) let you run several agents on different work items at the same time without collisions. They need Git first.')}</p>${readOnly ? '' : `<button class="btn sm go" data-git-init style="margin-top:8px">${A('اعمل Git repository', 'Initialize Git')}</button><p class="tiny muted">${A('git init بس: من غير remote ولا commit ولا push.', 'git init only: no remote, commit or push.')}</p>`}</section>`;
    const lane = (w) => {
      const a = w.activeWork;
      const at = a ? (a.state === 'done' ? 5 : a.state === 'new' ? -1 : stIndex(a.currentStation)) : null;
      const track = a ? `<div class="track" aria-hidden="true">${ST.map((s, i) => `<span class="tk ${at > i || at === 5 ? 'done' : at === i ? `now ${a.state}` : ''}" style="--hue:${s.hue}" data-tip="${esc(L(s.name))}"><i></i></span>`).join('')}<span class="tk end ${at === 5 ? 'done' : ''}" style="--hue:var(--palm)"><i>✓</i></span></div>` : '';
      const changed = w.changed ?? [];
      const hot = new Set((team.overlaps ?? []).map((o) => o.path));
      return `<article class="lane panel ${a ? a.state : ''}"><div class="lh"><div class="grow"><b class="ltr">⑂ ${esc(w.branch ?? '—')}</b>${w.main ? ` <span class="tag">${A('الأساسية', 'main checkout')}</span>` : ''}<div class="tiny muted ltr" title="${esc(w.path)}">📁 ${esc(baseName(w.path))}</div></div></div>
        <div class="lm">${w.unverified ? `<p class="muted">${A('git مسجّل النسخة دي بس الفولدر مش بيرجعلها، فاتجاهلت.', 'Git lists this worktree, but its folder does not point back to it, so it is ignored.')}</p>` : !w.exists ? `<p class="muted">${A('الفولدر ده مش موجود على الجهاز.', 'This folder is not on disk.')}</p>` : !w.yallaflow ? `<p class="muted">${A('مفيش حالة YallaFlow في النسخة دي.', 'No YallaFlow state in this checkout.')}</p>` : a ? `<a href="#/item/${encodeURIComponent(a.id)}" class="lt"><span class="ltr tiny muted">${esc(a.id)}</span> ${esc(a.title)}</a>${track}<div class="row tiny" style="margin-top:6px">${chip(a.state)}<b>${a.completion}%</b>${w.lastRecordedActivity ? `<span class="muted">${A(`آخر نشاط مسجّل ${ago(w.lastRecordedActivity)}`, `last recorded activity ${ago(w.lastRecordedActivity)}`)}</span>` : ''}</div>` : `<p class="muted">${A('مفيش شغل نشط مسجّل هنا.', 'No active work recorded here.')}</p>`}</div>
        <div class="lf">${changed.length ? `<details><summary class="small">${A(`${changed.length} ملف متغيّر`, `${changed.length} changed file(s)`)}${changed.some((f) => hot.has(f.path)) ? ` <span class="chip fail">${A('فيه تداخل', 'overlap')}</span>` : ''}</summary><div class="fl">${changed.slice(0, 60).map((f) => `<span class="fpath ltr ${hot.has(f.path) ? 'hot' : ''}">${esc(f.path)}</span>`).join('')}</div></details>` : `<span class="tiny muted">${w.changed === null ? A('مش قادر أقرا التغييرات', 'changes unavailable') : A('مفيش تغييرات', 'no changes')}</span>`}</div></article>`;
    };
    return `<section class="pagehead"><h1 style="font-size:26px">${A('نسخ الشغل', 'Worktrees')}</h1><p class="muted">${A('كل نسخة شغل (git worktree) من المشروع، وحالة YallaFlow المسجّلة فيها والملفات اللي اتغيّرت. الكونسول مايعرفش مين شغّال جوه كل نسخة، ومش بيعرضها كجلسات وكلاء.', 'Every Git worktree of this project, its recorded YallaFlow state and its changed files. The console cannot tell who is working in a checkout and does not present them as agent sessions.')}</p></section>
      ${(team.overlaps ?? []).map((o) => `<section class="conflict"><b>⚠ ${A('نفس الملف متغيّر في أكتر من نسخة', 'The same file is changed in more than one worktree')}:</b> <span class="ltr">${esc(o.path)}</span><div class="tiny muted ltr">${o.worktrees.map((w) => `📁 ${esc(baseName(w))}`).join(' · ')}</div></section>`).join('')}
      <section class="lanes">${team.worktrees.map(lane).join('')}</section>
      ${team.worktrees.length === 1 ? devPanel(A('شغّل أكتر من وكيل بأمان', 'Run more agents safely'), ['git worktree add ../<folder> -b <branch>', 'cd ../<folder>   # open your agent here, on a different work item']) : ''}`;
  }

  // ---------- insights: only what YallaFlow records ----------
  function viewInsights() {
    const all = items();
    const doneItems = all.filter((it) => it.state === 'done' && it.completedAt);
    const day = 86400000;
    const now = Date.now();
    const last30 = doneItems.filter((it) => now - Date.parse(it.completedAt) <= 30 * day).length;
    const cycles = doneItems.filter((it) => it.createdAt).map((it) => (Date.parse(it.completedAt) - Date.parse(it.createdAt)) / day).filter((x) => x >= 0).sort((a, b) => a - b);
    const median = cycles.length ? cycles[Math.floor((cycles.length - 1) / 2)] : null;
    const runs = all.reduce((acc, it) => ({ total: acc.total + (it.verificationRuns?.total ?? 0), passed: acc.passed + (it.verificationRuns?.passed ?? 0) }), { total: 0, passed: 0 });
    const weeks = Array.from({ length: 8 }, (_, k) => { const end = now - (7 - k) * 7 * day; const start = end - 7 * day; return { start, end, n: doneItems.filter((it) => { const t = Date.parse(it.completedAt); return t > start && t <= end; }).length }; });
    const wmax = Math.max(1, ...weeks.map((w) => w.n));
    const live = all.filter((it) => it.state !== 'done' && it.state !== 'closed');
    const fresh = live.filter((it) => it.state === 'new').length;
    const open = ST.map((_, i) => live.filter((it) => it.state !== 'new' && curIndex(it) === i).length);
    const omax = Math.max(1, fresh, ...open);
    const fmtDays = (x) => (x == null ? '—' : x < 1 ? A(`${Math.round(x * 24)} ساعة`, `${Math.round(x * 24)} h`) : A(`${x.toFixed(1)} يوم`, `${x.toFixed(1)} days`));
    const wlabel = (w) => new Date(w.end).toLocaleDateString(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short' });
    return `<section class="pagehead"><h1 style="font-size:26px">${A('الأرقام', 'Insights')}</h1><p class="muted">${A('من السجلات بس: أوقات الإنشاء والإنجاز وتشغيلات التحقق.', 'From records only: creation and completion times and verification runs.')}</p></section>
      <section class="kpis"><div class="kpi panel"><span class="tiny muted">${A('خلص آخر 30 يوم', 'Done in the last 30 days')}</span><b>${last30}</b></div><div class="kpi panel"><span class="tiny muted">${A('متوسط المدة من الطلب لـ«خلص» (الوسيط)', 'Median time from request to Done')}</span><b>${fmtDays(median)}</b><span class="tiny muted">${A(`من ${cycles.length} شغلانة`, `over ${cycles.length} items`)}</span></div><div class="kpi panel"><span class="tiny muted">${A('تشغيلات تحقق نجحت', 'Verification runs passed')}</span>${runs.total ? `<b>${Math.round((runs.passed / runs.total) * 100)}%</b><span class="tiny muted">${runs.passed} / ${runs.total}</span>` : `<b class="kpi-empty">—</b><span class="tiny muted">${A('لسه مفيش تشغيلات تحقق', 'No verification runs yet')}</span>`}</div><div class="kpi panel"><span class="tiny muted">${A('شغل مفتوح', 'Open work')}</span><b>${live.length}</b></div></section>
      <section class="charts"><article class="panel"><h2 style="font-size:18px">${A('اللي وصل «خلص» كل أسبوع', 'Reached Done per week')} <span class="tiny muted">${A('(آخر 8 أسابيع)', '(last 8 weeks)')}</span></h2>
        ${doneItems.length ? `<div class="cols">${weeks.map((w) => `<span class="col" data-tip="${esc(wlabel(w))}: ${w.n}"><i style="height:${(w.n / wmax) * 100}%"></i></span>`).join('')}</div><div class="row tiny muted cols-x"><span>${esc(wlabel(weeks[0]))}</span><span class="grow"></span><span>${esc(wlabel(weeks[7]))}</span></div>
        <details style="margin-top:10px"><summary class="tiny muted">${A('اعرض كجدول', 'Show as a table')}</summary><div class="tablewrap"><table><tr><th>${A('الأسبوع المنتهي', 'Week ending')}</th><th>${A('خلص', 'Done')}</th></tr>${weeks.map((w) => `<tr><td>${esc(wlabel(w))}</td><td>${w.n}</td></tr>`).join('')}</table></div></details>` : `<p class="small muted">${A('لسه مفيش شغل وصل «خلص». الرسم ده هيظهر أول ما شغلانة تخلص بتحقق.', 'Nothing has reached Done yet. This chart appears once a work item is finished with verification.')}</p>`}</article>
      <article class="panel"><h2 style="font-size:18px">${A('الشغل المفتوح في كل محطة', 'Open work by station')}</h2>${live.length ? `<div class="hbars">${fresh ? `<div class="hb" data-tip="${A('جديد (لسه متصنّفش)', 'New (not classified yet)')}: ${fresh}"><span class="lab">${A('جديد', 'New')}</span><span class="track"><i style="width:${(fresh / omax) * 100}%;--hue:var(--muted)"></i></span><b>${fresh}</b></div>` : ''}${open.map((n, i) => `<div class="hb" data-tip="${esc(L(ST[i].name))}: ${n}"><span class="lab">${L(ST[i].name)}</span><span class="track"><i style="width:${(n / omax) * 100}%;--hue:${ST[i].hue}"></i></span><b>${n}</b></div>`).join('')}</div>${fresh ? `<p class="tiny muted" style="margin-top:8px">${A('الشغل الجديد بيدخل محطة لما وكيلك يصنّفه.', 'New work enters a station once your agent classifies it.')}</p>` : ''}` : `<p class="small muted">${A('مفيش شغل مفتوح دلوقتي.', 'No open work right now.')}</p>`}</article></section>
      <p class="tiny muted" style="margin-top:14px">${A('YallaFlow مش بيسجّل وقت كل محطة ولا وقت الانتظار، فمش بنعرضهم.', 'YallaFlow does not record time per station or waiting time, so they are not shown.')}</p>`;
  }

  // ---------- Create Work: the console's only write (Core's start/route/intake add) ----------
  const ACCEPT = '.md,.txt,.rst,.pdf,.docx,.pptx,.xlsx,.rtf,.odt,.ods,.odp,.csv,.json,.yaml,.yml,.png,.jpg,.jpeg,.gif,.webp';
  const KINDS = [['', { ar: 'خلّي الوكيل يحدد', en: 'Let my agent decide' }], ['feature', TYPE.feature], ['bug', TYPE.bug], ['change', TYPE.change], ['investigation', TYPE.investigation]];
  const SIZES = [['bounded', { ar: 'صغير', en: 'Small' }, 'bounded'], ['architectural', { ar: 'كبير', en: 'Large' }, 'architectural'], ['spike', { ar: 'استكشافي', en: 'Exploratory' }, 'spike']];
  let cw = null; // { requestId, pid, created, files, failed }
  const newRequestId = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));
  async function post(pathname, body, headers) {
    const response = await fetch(pathname, { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...headers }, body, cache: 'no-store' });
    let data = null;
    try { data = await response.json(); } catch { /* not json */ }
    if (!response.ok) throw Object.assign(new Error(data?.error?.message ?? `HTTP ${response.status}`), { status: response.status, code: data?.error?.code });
    return data;
  }
  // The server's reason in the reader's language for the common cases; Core's own text otherwise.
  function why(e, file) {
    const name = file ? `«${file.name}»` : '';
    const known = {
      UNSUPPORTED_FILE: A(`نوع الملف ${name} مش مدعوم هنا. المدعوم: PDF وWord وExcel وPowerPoint والنصوص والصور.`, `${file?.name ?? 'This file'} is not a supported type here. Supported: PDF, Word, Excel, PowerPoint, text and images.`),
      TOO_LARGE: A(`الملف ${name} أكبر من 50 MB، أقصى حجم YallaFlow يقدر يقرا نصه.`, `${file?.name ?? 'The file'} is larger than 50 MB, the most YallaFlow can still read as text.`),
      EMPTY_FILE: A(`الملف ${name} فاضي.`, `${file?.name ?? 'The file'} is empty.`),
      WORKSPACE_BUSY: A('أمر YallaFlow تاني شغّال في المشروع دلوقتي. جرّب تاني بعد شوية.', 'Another YallaFlow command is busy in this project. Try again in a moment.')
    };
    if (!e.status) return A('الكونسول مش متاح. اتأكد إنه لسه شغّال وجرّب تاني.', 'The console is not reachable. Check that it is still running and try again.');
    return known[e.code] ?? e.message;
  }
  const retryable = (e) => !e.status || e.status === 503;
  function openCreate() {
    if (readOnly) return;
    cw = { requestId: newRequestId(), pid, created: null, files: [], failed: [], attached: [] };
    document.querySelector('dialog.create')?.remove();
    const d = document.createElement('dialog');
    d.className = 'create';
    d.setAttribute('aria-labelledby', 'cw-h');
    d.innerHTML = createForm();
    document.body.appendChild(d);
    d.addEventListener('close', () => { d.remove(); });
    d.showModal();
    d.querySelector('textarea').focus();
  }
  function createForm() {
    const pick = projects.length > 1 ? `<label class="fld"><span>${A('المشروع', 'Project')}</span><select name="project">${projects.map((p) => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : '';
    return `<form data-create-form novalidate><div class="row"><h2 id="cw-h" class="grow">＋ ${A('شغل جديد', 'Create work')}</h2><button type="button" class="ibtn" data-cw-cancel aria-label="${A('إغلاق', 'Close')}">✕</button></div>
      ${pick}
      <label class="fld"><span>${A('محتاج إيه؟', 'What do you need?')}</span><textarea name="request" rows="5" maxlength="20000" required placeholder="${A('مثلاً: العملاء يقدروا يصدّروا طلباتهم CSV من صفحة الطلبات…', 'For example: customers can export their orders to CSV from the orders page…')}"></textarea></label>
      <fieldset class="seg"><legend>${A('نوع الشغل', 'What kind of work?')}</legend>${KINDS.map(([v, l], i) => `<label><input type="radio" name="type" value="${v}" ${i === 0 ? 'checked' : ''}><span>${L(l)}</span></label>`).join('')}</fieldset>
      <fieldset class="seg" data-size hidden><legend>${A('الحجم', 'Size')}</legend>${SIZES.map(([v, l, tech]) => `<label><input type="radio" name="scope" value="${v}"><span>${L(l)} <i class="ltr">${tech}</i></span></label>`).join('')}</fieldset>
      <label class="fld"><span>${A('ملفات (اختياري)', 'Files (optional)')}</span><input type="file" name="files" multiple accept="${ACCEPT}"><small class="muted">${A('BRD أو PDF أو Word أو Excel أو صور · لحد 50 MB للملف', 'BRD, PDF, Word, Excel or images · up to 50 MB each')}</small></label>
      <p class="tiny muted">${A('YallaFlow بيسجّل الشغلانة بس، ومفيش وكيل بيشتغل لوحده. بعدها كمّل من Claude Code أو Codex.', 'YallaFlow records the work item; no agent starts on its own. Then continue in Claude Code or Codex.')}</p>
      <div class="formerr" role="alert" aria-live="assertive"></div>
      <div class="row end"><button type="button" class="btn ghost" data-cw-cancel>${A('إلغاء', 'Cancel')}</button><button type="submit" class="btn go" data-cw-submit>${A('إنشاء', 'Create')}</button></div></form>`;
  }
  // What YallaFlow could do with an attached file, from its stored source record.
  const AVAIL = {
    'native-text': ['done', { ar: 'نص مقروء', en: 'text readable' }],
    extracted: ['done', { ar: 'النص اتستخرج', en: 'text extracted' }],
    'original-only': ['wait', { ar: 'الأصل محفوظ، من غير نص', en: 'original kept, no text' }]
  };
  const availChip = (value, note) => (AVAIL[value] ? `<span class="chip ${AVAIL[value][0]}" ${note ? `title="${esc(note)}"` : ''}>${AVAIL[value][0] === 'done' ? '<i></i>' : '⚠ '}${L(AVAIL[value][1])}</span>` : '');
  function partialView(d) {
    const it = cw.created;
    const problem = cw.failed.length || cw.classifyError;
    d.innerHTML = `<div class="row"><h2 id="cw-h" class="grow">${problem ? A('اتعملت، بس فيه حاجات محتاجة انتباهك', 'Created — some things need your attention') : A('اتعملت', 'Created')}</h2></div>
      <p class="okline">✓ <b class="ltr">${esc(it.id)}</b> ${A('اتسجّلت في YallaFlow.', 'is recorded in YallaFlow.')}</p>
      <p class="small muted">${it.keptActive ? A(`مش هتبقى الشغلانة النشطة؛ ${esc(it.keptActive)} لسه النشطة في النسخة دي.`, `It is not the active work item; ${esc(it.keptActive)} stays active in this checkout.`) : A('مش هتبقى الشغلانة النشطة. الوكيل يقدر يشتغل عليها برقمها أو يفعّلها.', 'It is not made the active work item. Your agent can work on it by its ID or activate it.')}</p>
      ${cw.classifyError ? `<p class="small">⚠ ${A('التصنيف اترفض، والوكيل يقدر يصنّفها:', 'The classification was refused; your agent can classify it:')} <span class="muted">${esc(cw.classifyError)}</span></p>` : ''}
      <ul class="aclist">${cw.attached.map((f) => `<li><span class="ltr tag">${esc(f.file.name)}</span><span class="grow small">${f.duplicate ? A('كان متضاف قبل كده', 'was already attached') : A('اتضاف', 'attached')} <span class="ltr muted">${esc(f.source ?? '')}</span>${f.availabilityNote ? `<br><span class="tiny muted">${esc(f.availabilityNote)}</span>` : ''}</span>${availChip(f.contentAvailability, f.availabilityNote)}</li>`).join('')}${cw.failed.map((f) => `<li><span class="ltr tag">${esc(f.file.name)}</span><span class="grow small">${esc(f.message)}</span><span class="chip fail"><i></i>${A('ماتضافش', 'not attached')}</span></li>`).join('')}</ul>
      <div class="formerr" role="alert"></div>
      <div class="row end">${cw.failed.some((f) => f.retry) ? `<button type="button" class="btn ghost" data-cw-retry>${A('جرّب الملفات تاني', 'Try the files again')}</button>` : ''}<button type="button" class="btn go" data-cw-open>${A('افتح الشغلانة', 'Open the work item')}</button></div>`;
    d.querySelector('[data-cw-open]').focus();
  }
  async function uploadAll(d, files) {
    const failed = [];
    cw.attached = cw.attached ?? [];
    for (const file of files) {
      const status = d.querySelector('.formerr');
      if (status) status.textContent = A(`بيضيف ${file.name}…`, `Attaching ${file.name}…`);
      try {
        const result = await post(`/api/p/${cw.pid}/work/${encodeURIComponent(cw.created.id)}/sources`, file, { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-Request-Id': cw.requestId });
        cw.attached.push({ file, ...result });
      } catch (e) {
        failed.push({ file, message: why(e, file), retry: retryable(e) });
      }
    }
    return failed;
  }
  async function submitCreate(form) {
    const d = form.closest('dialog');
    const err = form.querySelector('.formerr');
    const request = form.request.value.trim();
    const type = form.querySelector('input[name="type"]:checked')?.value || null;
    const scope = type ? form.querySelector('input[name="scope"]:checked')?.value ?? null : null;
    if (!request) { err.textContent = A('اكتب المطلوب في سطر أو اتنين.', 'Describe what you need in a line or two.'); form.request.focus(); return; }
    if (type && !scope) { err.textContent = A('اختار الحجم للنوع ده.', 'Choose a size for this kind of work.'); form.querySelector('input[name="scope"]').focus(); return; }
    cw.pid = form.project?.value ?? pid;
    const files = [...(form.files.files ?? [])];
    const button = form.querySelector('[data-cw-submit]');
    button.disabled = true;
    err.textContent = A('بيسجّل…', 'Creating…');
    try {
      const result = await post(`/api/p/${cw.pid}/work`, JSON.stringify({ requestId: cw.requestId, request, type, scope }), { 'Content-Type': 'application/json' });
      cw.created = result;
      cw.classifyError = result.classifyError ?? null;
    } catch (e) {
      // Nothing was created (or a retry will return it: the same request ID is reused).
      err.textContent = why(e);
      button.disabled = false;
      return;
    }
    cw.failed = await uploadAll(d, files);
    // With files, always show what happened to each one; otherwise go straight to the item.
    if (files.length || cw.classifyError) return partialView(d);
    finishCreate(d);
  }
  async function finishCreate(d) {
    const it = cw.created;
    d.close();
    if (cw.pid !== pid) { pid = cw.pid; store.set('project', pid); snap = null; }
    toast(`＋ ${A(`«${esc(it.item.title)}» اتسجّلت`, `"${esc(it.item.title)}" was created`)} <span class="ltr">${esc(it.id)}</span><br><span class="tiny">${it.keptActive ? A(`${esc(it.keptActive)} لسه الشغلانة النشطة.`, `${esc(it.keptActive)} stays the active work item.`) : A('مش هتبقى النشطة إلا لما تتفعّل.', 'Not made active; activation stays explicit.')}</span>`);
    location.hash = `#/item/${encodeURIComponent(it.id)}`;
    await load();
    await loadForView();
    render();
  }

  // ---------- developer commands: one optional place ----------
  function devPanel(title, commands) {
    return `<details class="panel devpanel" id="dev"><summary>${A('للمطوّرين', 'For developers')} · ${esc(title)}</summary><div class="cli" dir="ltr">${commands.map(esc).join('\n')}</div><button class="btn ghost sm" data-copy="${esc(commands[0])}">${A('انسخ أول أمر', 'Copy the first command')}</button></details>`;
  }

  // ---------- render ----------
  function render() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
    const r = route();
    const hadQ = document.activeElement?.matches?.('[data-q]');
    const hadAgent = document.activeElement?.matches?.('[data-agent-input]');
    document.title = (snap?.counts?.you ? `(${snap.counts.you}) ` : '') + 'YallaFlow' + (snap?.project?.name ? ` · ${snap.project.name}` : '');
    if (!projects.length && snap && !['new', 'projects'].includes(r.v)) { location.hash = '#/projects'; return; }
    const views = { new: viewNew, setup: viewSetup, overview: viewOverview, item: () => viewItem(r.id), lines: viewLines, team: viewTeam, insights: viewInsights, projects: viewProjects, map: viewMap };
    const body = !snap ? `<p class="muted" style="margin-top:40px;text-align:center">${error ? '' : A('بيحمّل…', 'Loading…')}</p>` : (views[r.v] ?? viewMap)();
    // Forms marked data-keep survive a redraw: typed values and focus are carried over (PF-0057).
    const kept = [...document.querySelectorAll('form[data-keep]')].map((form) => ({ key: form.dataset.keep, values: [...form.elements].filter((el) => el.name && el.type !== 'file' && (el.type === 'checkbox' || el.type === 'radio' ? el.checked !== el.defaultChecked : el.value !== el.defaultValue)).map((el) => [el.name, el.type === 'checkbox' || el.type === 'radio' ? (el.type === 'radio' ? (el.checked ? el.value : null) : el.checked) : el.value, el.type]), focus: form.contains(document.activeElement) ? document.activeElement.name : null, caret: document.activeElement?.selectionStart ?? null }));
    document.getElementById('app').innerHTML = topbar(r) + `<main>${banner()}${snap && ['map', 'lines'].includes(r.v) ? understandingStrip() : ''}${body}</main>` + (snap && r.v === 'item' && byId(r.id) ? agentDock(byId(r.id)) : '');
    for (const k of kept) {
      const form = document.querySelector(`form[data-keep="${CSS.escape(k.key)}"]`);
      if (!form) continue;
      for (const [name, value, type] of k.values) {
        const els = [...form.elements].filter((el) => el.name === name);
        if (type === 'radio') { if (value !== null) els.forEach((el) => { el.checked = el.value === value; }); }
        else if (type === 'checkbox') els.forEach((el) => { el.checked = value; });
        else els.forEach((el) => { el.value = value; });
      }
      if (k.focus) { const el = form.elements.namedItem(k.focus); if (el?.focus) { el.focus(); if (k.caret !== null && el.setSelectionRange) try { el.setSelectionRange(k.caret, k.caret); } catch { /* not a text field */ } } }
    }
    requestAnimationFrame(placeConnectors);
    if (hadQ) { const q = document.querySelector('[data-q]'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
    if (hadAgent) { const box = document.querySelector('[data-agent-input]'); if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); } }
    const stream = document.querySelector('#agent .astream'); if (stream) stream.scrollTop = stream.scrollHeight;
  }

  // Pipes between consecutive stations, measured from the layout (RTL and LTR).
  function placeConnectors() {
    for (const host of document.querySelectorAll('.map, .chain')) {
      const box = host.querySelector('.connectors');
      if (!box) continue;
      const nodes = [...host.querySelectorAll(':scope > .station, :scope > .node')];
      const hb = host.getBoundingClientRect();
      const rtl = document.documentElement.dir === 'rtl';
      let html = '';
      for (let k = 0; k < nodes.length - 1; k++) {
        const a = nodes[k].getBoundingClientRect(), b = nodes[k + 1].getBoundingClientRect();
        const x1 = rtl ? b.right : a.right, x2 = rtl ? a.left : b.left;
        if (x2 - x1 < 6 || a.top - hb.top > 200 || b.top - hb.top > 200) continue;
        const st = +nodes[k + 1].dataset.st;
        const passed = nodes[k].classList.contains('done') || (nodes[k].classList.contains('start') && !nodes[k].classList.contains('active'));
        const live = passed && !nodes[k + 1].classList.contains('done') && !nodes[k + 1].classList.contains('todo');
        html += `<div class="pipe2 ${host.classList.contains('chain') ? (passed ? 'passed' : '') + (live ? ' live' : '') : 'flowing'}" style="left:${x1 - hb.left}px;width:${x2 - x1}px;top:${host.classList.contains('chain') ? 118 : 150}px;--hue:${stHue(st)}"><span></span></div>`;
      }
      box.innerHTML = html;
    }
  }
  addEventListener('resize', () => requestAnimationFrame(placeConnectors));

  // ---------- live: re-read on change, animate what moved ----------
  async function refresh() {
    const before = new Map([...document.querySelectorAll('.pchip')].map((c) => [c.dataset.w, c.getBoundingClientRect()]));
    const previous = await load();
    alertNew(previous);
    await loadForView();
    const moves = previous ? diff(previous, snap) : [];
    const flights = moves.filter((m) => m.kind !== 'new');
    if (flights.length && !reduced && route().v === 'map') await Promise.all(flights.slice(0, 3).map(fly));
    render();
    for (const c of document.querySelectorAll('.pchip')) {
      const a = before.get(c.dataset.w);
      if (!a) { if (moves.some((m) => m.id === c.dataset.w && m.kind === 'new')) c.classList.add('arrive'); continue; }
      const b = c.getBoundingClientRect();
      const dx = a.left - b.left, dy = a.top - b.top;
      if ((dx || dy) && !reduced) c.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 700, easing: 'cubic-bezier(.2,.9,.3,1.15)' });
    }
    for (const m of moves) {
      const target = document.querySelector(`.station[data-st="${m.to}"], .node[data-st="${m.to}"]`);
      if (target && m.kind !== 'new') target.classList.add(m.kind === 'back' ? 'receive-back' : 'receive');
    }
    const first = moves[0];
    if (first) {
      const it = byId(first.id);
      const title = it ? it.title : first.id;
      toast(first.kind === 'new'
        ? `＋ ${A(`«${esc(title)}» دخل من «جديد»`, `"${esc(title)}" entered through New`)}`
        : first.kind === 'back'
          ? `↩ ${A(`«${esc(title)}» رجع من «${stName(first.from)}» لـ«${stName(first.to)}»`, `"${esc(title)}" went back from ${stName(first.from)} to ${stName(first.to)}`)}`
          : `✓ ${A(`«${esc(title)}» اتسلّم من «${stName(first.from)}» لـ«${stName(first.to)}»`, `"${esc(title)}" handed from ${stName(first.from)} to ${stName(first.to)}`)}`);
    }
    if (moves.some((m) => m.to === 5 && m.kind === 'forward')) celebrate();
  }

  async function loadForView() {
    const v = route().v;
    if (!pid && !['new', 'projects'].includes(v)) return;
    if (v === 'item') { if (agentsOn) await loadAgent(); else await loadAgentInfo(); }
    if (v === 'team') await loadTeam();
    else if (v === 'projects') await loadOverview();
    else if (pid && (v === 'overview' || ((v === 'map' || v === 'lines') && projectOverview?.pid !== pid))) { await loadProjectOverview(); if (v === 'overview' && projectOverview?.data?.project?.kind === 'greenfield') { await loadRuntime(); if (!agentsOn) await loadAgentInfo(); } }
    else if (v === 'setup') await loadRuntime();
    else if (v === 'new') await loadWizard();
    syncRuntimePolling();
  }

  function diff(prev, next) {
    const old = new Map(prev.items.map((it) => [it.id, it]));
    const moves = [];
    for (const it of next.items) {
      const was = old.get(it.id);
      if (!was) { moves.push({ id: it.id, kind: 'new', from: -1, to: curIndex(it) }); continue; }
      const a = curIndex(was), b = curIndex(it);
      if (b > a) moves.push({ id: it.id, kind: 'forward', from: a, to: b });
      else if (b < a) moves.push({ id: it.id, kind: 'back', from: a, to: b });
    }
    return moves;
  }

  function fly(move) {
    return new Promise((resolve) => {
      const from = document.querySelector(`.station[data-st="${move.from}"]`);
      const to = document.querySelector(`.station[data-st="${move.to}"]`);
      if (!from || !to) return resolve();
      const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
      const back = move.kind === 'back';
      const bt = document.createElement('div');
      bt.className = 'baton' + (back ? ' back' : '');
      bt.style.setProperty('--hue', back ? 'var(--clay)' : stHue(move.to));
      const lb = document.createElement('div');
      lb.className = 'baton-label' + (back ? ' back' : '');
      lb.textContent = (back ? '↩ ' : '') + (byId(move.id)?.title ?? move.id).slice(0, 44);
      document.body.append(bt, lb);
      const ax = a.left + a.width / 2, ay = a.top + 150, bx = b.left + b.width / 2, by = b.top + 150;
      const mid = back ? Math.max(ay, by) + 90 : Math.min(ay, by) - 70;
      const kf = [{ left: ax + 'px', top: ay + 'px', transform: 'scale(.6)' }, { left: (ax + bx) / 2 + 'px', top: mid + 'px', transform: 'scale(1.2)' }, { left: bx + 'px', top: by + 'px', transform: 'scale(.8)' }];
      bt.animate(kf, { duration: 1100, easing: 'cubic-bezier(.3,.7,.3,1)' });
      lb.animate(kf, { duration: 1100, easing: 'cubic-bezier(.3,.7,.3,1)' });
      setTimeout(() => { bt.remove(); lb.remove(); resolve(); }, 1080);
    });
  }

  // A streamed /api/events (fetch, so the token travels in a header). Reconnects.
  let listening = false;
  async function listen() {
    if (listening) return;
    listening = true;
    for (;;) {
      try {
        const response = await fetch('/api/events', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        // A wrong or expired token (the console was restarted): stop retrying and ask for
        // the new link; opening it restarts the stream (see the hashchange handler).
        if (response.status === 401) { error = Object.assign(new Error('unauthorized'), { status: 401 }); listening = false; render(); return; }
        if (!response.ok || !response.body) throw new Error(String(response.status));
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let cut;
          while ((cut = buffer.indexOf('\n\n')) >= 0) {
            const chunk = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            const line = chunk.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            const event = JSON.parse(line.slice(6));
            if (event.type === 'change' && event.project === pid) await refresh();
            else if (event.type === 'agent') onAgentEvent(event.project, event.event);
            // 1.4.0 (PF-0057): a project was added, or agents were enabled, in this console.
            else if (event.type === 'projects') { await reloadProjects().catch(() => {}); if (route().v === 'projects') await loadOverview(); render(); }
            else if (event.type === 'agents') { agentsOn = true; agentsCanEnable = false; render(); }
          }
        }
      } catch { /* retry below */ }
      if (error) render();
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await refresh();
    }
  }

  // ---------- events ----------
  window.addEventListener('hashchange', async () => {
    // A new console link opened in this tab: adopt its token and start over.
    const fresh = /^#token=([0-9a-f]+)/.exec(location.hash);
    if (fresh) {
      token = fresh[1];
      try { sessionStorage.setItem('yfc.token', token); } catch { /* unavailable */ }
      history.replaceState(null, '', location.pathname + '#/map');
      projects = []; snap = null; detail = null; error = null;
      render(); await load(); await buildDigest(); render(); listen();
      return;
    }
    closeDrawer(); bellOpen = false; dtab = null; const v = route().v; if (v === 'item') { detail = null; render(); await load(); await loadForView(); } else if (['team', 'projects', 'overview', 'map', 'lines', 'setup', 'new'].includes(v)) { render(); await loadForView(); } else syncRuntimePolling(); render(); scrollTo(0, 0); });
  document.addEventListener('submit', (e) => {
    const step = e.target.closest('[data-wiz-step]');
    if (step) { e.preventDefault(); wizardNext(step); return; }
    const create = e.target.closest('[data-wiz-create]');
    if (create) { e.preventDefault(); wizardCreate(create); }
  });
  document.addEventListener('change', (e) => {
    if (e.target.matches?.('input[name="wiz-stack"], input[name="wiz-env"]') && wiz.form) { if (e.target.name === 'wiz-stack') wiz.form.stack = e.target.value; else wiz.form.environment = e.target.value; for (const card of e.target.closest('fieldset, form').querySelectorAll('.stackcard')) card.classList.toggle('on', card.contains(e.target)); }
    if (e.target.matches?.('[data-wiz-files]')) { const form = e.target.closest('form'); if (form) readStep(form); addWizardFiles([...e.target.files]); }
    if (e.target.matches?.('[data-wiz-refiles]')) { (async () => { for (const file of e.target.files) { const sha256 = await hashFile(file); if (!wiz.files.some((x) => x.sha256 === sha256)) wiz.files.push({ file, name: file.name, size: file.size, sha256 }); } await uploadPlanned(); render(); })(); }
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-wiz-prev]')) { const form = e.target.closest('form'); if (form?.dataset.wizStep) readStep(form); if (wiz.step === 4) wiz.plan = null; wiz.step = Math.max(1, (typeof wiz.step === 'number' ? wiz.step : 4) - 1); wiz.error = null; render(); return; }
    if (e.target.closest('[data-wiz-retry]')) { wizardCreate(null); return; }
    if (e.target.closest('[data-wiz-register]')) { wizardRegister(); return; }
    if (e.target.closest('[data-wiz-reattach]')) { uploadPlanned().then(render); return; }
    const unfile = e.target.closest('[data-wiz-unfile]');
    if (unfile) { const form = unfile.closest('form'); if (form) readStep(form); wiz.files.splice(Number(unfile.dataset.wizUnfile), 1); render(); return; }
    const fo = e.target.closest('[data-folder-open]');
    if (fo) { const form = fo.closest('form'); if (form?.dataset.wizStep) readStep(form); openFolder(fo.dataset.folderOpen); return; }
    const fg = e.target.closest('[data-folder-go]');
    if (fg && folder) { openFolder(folder.mode, fg.dataset.folderGo); return; }
    if (e.target.closest('[data-folder-choose]')) { chooseFolder(); return; }
    if (e.target.closest('[data-folder-close]')) { document.getElementById('folderdlg')?.close(); folder = null; return; }
    if (e.target.closest('[data-agents-enable]')) { enableAgents(); return; }
    if (e.target.closest('[data-agents-cancel]')) { document.getElementById('agentsdlg')?.close(); return; }
    if (e.target.closest('[data-chat-toggle]')) { toggleChat(); return; }
    const sugg = e.target.closest('[data-suggest]');
    if (sugg) { useSuggestion(sugg.dataset.suggest); return; }
    const ask = e.target.closest('[data-chat-item]');
    if (ask) {
      // From a card: open the item with the chat and a question about where it stands.
      e.preventDefault(); e.stopPropagation();
      const id = ask.dataset.chatItem;
      agentDraft = A(`${id} وصلت لفين، وإيه الخطوة الجاية؟`, `Where is ${id} now, and what is the next step?`);
      chatOpen = true; store.set('chatOpen', true);
      location.hash = `#/item/${encodeURIComponent(id)}`;
      return;
    }
    if (e.target.closest('[data-git-init]')) { gitInitAction(); return; }
    const sg = e.target.closest('[data-rt-suggest]');
    if (sg) { addService({ fromSuggestion: sg.dataset.rtSuggest }); return; }
    const rt = e.target.closest('[data-rt]');
    if (rt) { runtimeAction(rt.dataset.rt, rt.dataset.id); return; }
    const rtl = e.target.closest('[data-rt-logs]');
    if (rtl) { loadServiceLogs(rtl.dataset.rtLogs).then(render); return; }
    // 1.4.0 work management: actions, gate review, the card menu.
    const wm = e.target.closest('[data-act],[data-gate],[data-menu],[data-act-cancel]');
    if (wm) {
      e.preventDefault();
      if (wm.hasAttribute('data-act-cancel')) { wm.closest('dialog')?.close(); return; }
      if (wm.hasAttribute('data-gate')) { openGate(wm.dataset.gateItem, wm.dataset.gate); return; }
      if (wm.hasAttribute('data-menu')) {
        const it = byId(wm.dataset.menu);
        document.querySelector('dialog.act')?.remove();
        const d = document.createElement('dialog');
        d.className = 'create act';
        d.setAttribute('aria-label', `${A('أفعال', 'Actions')} ${wm.dataset.menu}`);
        d.innerHTML = `<div class="row"><b class="grow ltr">${esc(it.id)}</b><button type="button" class="btn ghost sm" data-act-cancel>${A('اقفل', 'Close')}</button></div><p class="small">${esc(it.title)}</p>${actionBar(it)}`;
        document.body.appendChild(d);
        d.addEventListener('close', () => d.remove());
        d.showModal();
        return;
      }
      const kind = wm.dataset.act;
      const id = wm.dataset.actItem;
      wm.closest('dialog')?.close();
      if (wm.getAttribute('aria-disabled') === 'true') { toast(`⛔ ${esc(byId(id)?.blocker ?? '')}`); return; }
      if (kind === 'activate' || kind === 'advance') {
        post(`/api/p/${pid}/work/${encodeURIComponent(id)}/actions/${kind}`, '{}', { 'Content-Type': 'application/json' })
          .then(async () => { toast(`✓ ${esc(L(ACTION_LABEL[kind]))} · <span class="ltr">${esc(id)}</span>`); await refresh(); })
          .catch((err) => toast(`⛔ ${esc(why(err))}`));
        return;
      }
      openAction(kind, id);
      return;
    }
    const ag = e.target.closest('[data-agent-start],[data-agent-connect],[data-agent-cancel],[data-agent-end],[data-agent-disconnect],[data-agent-perm],[data-agent-activate],[data-agent-resume]');
    if (ag) {
      const workId = route().id;
      if (ag.hasAttribute('data-agent-start')) agentAction('start', { provider: 'codex', workId, mode: agentMode });
      else if (ag.hasAttribute('data-agent-connect')) agentAction('connect', { provider: 'claude', workId }, (r) => { agentLaunch = r.launch?.command ?? null; });
      else if (ag.hasAttribute('data-agent-cancel')) agentAction('cancel', {});
      else if (ag.hasAttribute('data-agent-end')) agentAction('end', {});
      else if (ag.hasAttribute('data-agent-disconnect')) agentAction('disconnect', {}, () => { agentLaunch = null; });
      else if (ag.dataset.agentPerm) agentAction('permission', { requestId: ag.dataset.agentPerm, decision: ag.dataset.decision });
      else if (ag.dataset.agentActivate) agentAction('activate', { workId: ag.dataset.agentActivate }, () => refresh());
      else if (ag.dataset.agentResume) agentAction('resume', { recordId: ag.dataset.agentResume, mode: agentMode });
      return;
    }
    const cwx = e.target.closest('[data-create],[data-cw-cancel],[data-cw-open],[data-cw-retry]');
    if (cwx) {
      if (cwx.hasAttribute('data-create')) openCreate();
      else if (cwx.hasAttribute('data-cw-cancel')) cwx.closest('dialog')?.close();
      else if (cwx.hasAttribute('data-cw-open')) finishCreate(cwx.closest('dialog'));
      else if (cwx.hasAttribute('data-cw-retry')) {
        const d = cwx.closest('dialog');
        cwx.disabled = true;
        const again = cw.failed.filter((f) => f.retry);
        uploadAll(d, again.map((f) => f.file)).then((failed) => { cw.failed = [...cw.failed.filter((f) => !f.retry), ...failed]; partialView(d); });
      }
      return;
    }
    // data-theme-toggle, not data-theme: <html data-theme> holds the chosen theme, and
    // closest() would match it for every click on the page.
    const x = e.target.closest('[data-lang],[data-theme-toggle],[data-bell],[data-digest],[data-open-project],[data-dev],[data-f],[data-more-st],[data-dtab],[data-file],[data-art],[data-more],[data-copy]');
    if (!x) { if (bellOpen && !e.target.closest('.notes')) { bellOpen = false; render(); } return; }
    if (x.hasAttribute('data-lang')) { lang = lang === 'ar' ? 'en' : 'ar'; store.set('lang', lang); render(); }
    else if (x.hasAttribute('data-theme-toggle')) { const dark = theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; theme = dark ? 'light' : 'dark'; store.set('theme', theme); render(); }
    else if (x.hasAttribute('data-bell')) { bellOpen = !bellOpen; render(); }
    else if (x.hasAttribute('data-digest')) { store.set(seenKey(), new Date().toISOString()); digest = null; render(); }
    else if (x.dataset.openProject) { e.preventDefault(); switchProject(x.dataset.openProject, x.dataset.openView ?? 'map'); }
    else if (x.hasAttribute('data-dev')) { const dev = document.getElementById('dev'); if (dev) { dev.open = true; dev.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' }); } }
    else if (x.dataset.f) { flt.st = flt.st === x.dataset.f ? 'all' : x.dataset.f; render(); }
    else if (x.dataset.moreSt) { const i = +x.dataset.moreSt; if (openSt.has(i)) openSt.delete(i); else openSt.add(i); render(); }
    else if (x.dataset.dtab) { dtab = x.dataset.dtab; render(); if (x.hasAttribute('data-jump')) document.getElementById('details')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); }
    else if (x.dataset.file) openFile(x.dataset.file);
    else if (x.dataset.art) openArtifact(+x.dataset.art);
    else if (x.hasAttribute('data-more')) { const b = x.previousElementSibling; b.classList.toggle('clamp'); x.textContent = b.classList.contains('clamp') ? A('اقرأ الطلب كله ↓', 'Read the whole request ↓') : A('أقل ↑', 'Less ↑'); }
    else if (x.dataset.copy) copy(x.dataset.copy);
  });
  document.addEventListener('input', (e) => { if (e.target.closest('[data-gate-form]')) gateReady(e.target.closest('[data-gate-form]')); });
  // Board drag and drop: dragging proposes a move; Core decides (see dropOn).
  document.addEventListener('dragstart', (e) => {
    const card = e.target.closest?.('.pchip[data-w]');
    if (!card || readOnly) return;
    dragged = card.dataset.w;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragged);
    const it = byId(dragged);
    document.querySelectorAll('.station[data-st]').forEach((st) => st.classList.add(dropVerdict(it, Number(st.dataset.st)).ok ? 'drop-ok' : 'drop-no'));
  });
  document.addEventListener('dragend', () => { document.querySelectorAll('.station').forEach((st) => st.classList.remove('drop-ok', 'drop-no')); });
  document.addEventListener('dragover', (e) => { const st = e.target.closest?.('.station.drop-ok'); if (st) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
  document.addEventListener('drop', (e) => { const st = e.target.closest?.('.station[data-st]'); if (st && dragged) { e.preventDefault(); dropOn(Number(st.dataset.st)); } });
  document.addEventListener('input', (e) => { if (e.target.matches('[data-q]')) { flt.q = e.target.value; render(); } else if (e.target.matches('[data-agent-input]')) agentDraft = e.target.value; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && chatOpen && document.getElementById('chatwin')?.contains(e.target) && !document.querySelector('dialog[open]')) { e.preventDefault(); toggleChat(false); } });
  document.addEventListener('keydown', (e) => { if (e.target.matches?.('[data-agent-input]') && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.target.form.requestSubmit(); } });
  document.addEventListener('submit', (e) => {
    if (e.target.matches('[data-act-form]')) { e.preventDefault(); submitAction(e.target); return; }
    if (e.target.matches('[data-gate-form]')) { e.preventDefault(); submitGate(e.target); return; }
    if (e.target.matches('[data-rt-form]')) { e.preventDefault(); submitService(e.target); return; }
    if (e.target.matches('[data-agents-form]')) { e.preventDefault(); confirmAgents(e.target); return; }
    if (e.target.matches('[data-create-form]')) { e.preventDefault(); submitCreate(e.target); }
    else if (e.target.matches('[data-agent-form]')) { e.preventDefault(); const text = agentDraft.trim(); if (!text) return; agentDraft = ''; agentAction('message', { text }).then((sent) => { if (!sent && !agentDraft) { agentDraft = text; renderAgent(); } }); }
  });
  document.addEventListener('change', async (e) => {
    if (e.target.matches('[data-agent-mode]')) { agentMode = e.target.value; return; }
    if (e.target.matches('input[name="agentProvider"]')) { agentProvider = e.target.value; renderAgent(); return; }
    if (e.target.matches('dialog.create input[name="type"]')) {
      const size = e.target.form.querySelector('[data-size]');
      size.hidden = !e.target.value;
      if (!e.target.value) for (const r of size.querySelectorAll('input')) r.checked = false;
      e.target.form.querySelector('.formerr').textContent = '';
    }
    else if (e.target.matches('[data-ftype]')) { flt.type = e.target.value; render(); }
    else if (e.target.matches('[data-project]')) switchProject(e.target.value);
    else if (e.target.matches('[data-alerts]')) {
      browserAlerts = e.target.checked;
      if (browserAlerts && typeof Notification !== 'undefined' && Notification.permission === 'default') browserAlerts = (await Notification.requestPermission()) === 'granted';
      store.set('alerts', browserAlerts);
      render();
    }
  });

  async function switchProject(next, view = 'map') {
    pid = next;
    store.set('project', pid);
    snap = null; detail = null; team = null; digest = null; projectOverview = null; runtime = null;
    location.hash = `#/${view}`;
    render();
    await load();
    await buildDigest();
    await loadForView();
    render();
  }

  (async () => {
    if (!token) { error = Object.assign(new Error('no token'), { status: 401 }); render(); return; }
    render();
    await load();
    await buildDigest();
    await loadForView();
    render();
    listen();
  })();
})();
