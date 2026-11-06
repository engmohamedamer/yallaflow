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
    todo: { ar: 'لسه', en: 'not yet' }, na: { ar: 'مش مطلوبة هنا', en: 'not needed here' }
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
        if (!projects.some((p) => p.id === pid)) pid = projects[0]?.id ?? null;
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
      <nav class="tabs" aria-label="views">${tab('#/map', A('التدفق', 'Flow'), r.v === 'map')}${tab('#/lines', A('الشغل', 'Work'), r.v === 'lines' || r.v === 'item')}${tab('#/team', A('نسخ الشغل', 'Worktrees'), r.v === 'team')}${tab('#/insights', A('الأرقام', 'Insights'), r.v === 'insights')}</nav>
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
    return `<a class="pchip ${it.state} ${old ? 'old' : ''}" href="#/item/${encodeURIComponent(it.id)}" data-w="${esc(it.id)}"><div class="tt">${esc(it.title)}</div>
      <div class="meta">${chip(it.state)}<span class="grow"></span><b>${it.completion}%</b></div><div class="mini"><i style="width:${it.completion}%"></i></div>
      <div class="badges"><span class="bdg ltr">${esc(it.id)}</span>${it.lastActivityAt && it.state !== 'done' ? `<span class="bdg ${old ? 'old' : ''}">⏱ ${ago(it.lastActivityAt)}</span>` : ''}${it.sourceCount ? `<span class="bdg">📎 ${it.sourceCount}</span>` : ''}</div></a>`;
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
    return digestCard() + hero() + integrityPanel() + filterBar() + `<section class="map" id="map" aria-label="${A('التدفق', 'Flow')}">
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
    const order = { you: 0, fail: 1, active: 2, paused: 3, new: 4, done: 5 };
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
  let dtab = 'delivery';
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
      ${agentPanel(it)}
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
    if (['session.started', 'session.ended', 'session.connected', 'session.disconnected', 'turn.started', 'turn.ended', 'mode.changed', 'work.activated'].includes(event.type)) {
      loadAgent().then(renderAgent);
      return;
    }
    renderAgent();
  }
  // Re-render only the panel, keeping the composer text and focus.
  function renderAgent() {
    const host = document.getElementById('agent');
    const it = byId(route().id);
    if (!host || !it) return;
    const focused = document.activeElement?.matches?.('[data-agent-input]');
    host.outerHTML = agentPanel(it);
    const stream = document.querySelector('#agent .astream');
    if (stream) stream.scrollTop = stream.scrollHeight;
    if (focused) { const box = document.querySelector('[data-agent-input]'); if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); } }
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
      else if (ev.type === 'error') out.push({ kind: 'note', warn: true, text: ev.message });
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
  function agentPanel(it) {
    if (!agentsOn) return '';
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
    const state = s.provider === 'claude' && !s.connected ? A('مستني Claude Code', 'Waiting for Claude Code') : s.status === 'working' ? A('شغّال…', 'Working…') : s.status === 'starting' ? A('بيبدأ…', 'Starting…') : A('جاهز', 'Ready');
    const controls = [
      cap.stop && s.status === 'working' ? `<button class="btn sm ghost" data-agent-cancel>${A('وقّف', 'Stop')}</button>` : '',
      cap.end ? `<button class="btn sm ghost" data-agent-end>${A('اقفل الجلسة', 'End session')}</button>` : '',
      s.provider === 'claude' ? `<button class="btn sm ghost" data-agent-disconnect>${A('افصل من YallaFlow', 'Unlink')}</button>` : ''
    ].join('');
    const launch = s.provider === 'claude' && !s.connected && agentLaunch ? `<div class="alaunch"><p class="small">${A('شغّل Claude Code بنفسك في فولدر المشروع بالأمر ده. Claude Code هيعرض تحذير القناة التجريبية والقرار ليك.', 'Start Claude Code yourself in the project folder with this command. Claude Code shows its own development-channel warning; the decision is yours.')}</p><pre class="cli" dir="ltr">${esc(agentLaunch)}</pre><button class="btn sm ghost" data-copy="${esc(agentLaunch)}">${A('انسخ', 'Copy')}</button></div>` : '';
    const entries = agentEntries(agent.events).map((e) => e.kind === 'user' ? `<div class="amsg me"><p>${esc(e.text)}</p></div>` : e.kind === 'agent' ? `<div class="amsg"><p>${esc(e.text)}</p></div>` : e.kind === 'tool' ? `<div class="atool ${e.status === 'failed' ? 'fail' : e.status === 'completed' ? 'done' : ''}"><span>${e.status === 'completed' ? '✓' : e.status === 'failed' ? '✕' : '●'}</span> ${esc(e.title)}</div>` : e.kind === 'perm' ? permCard(e) : `<div class="anote ${e.warn ? 'warn' : ''}">${esc(e.text)}</div>`).join('');
    const canSend = cap.send && (s.provider === 'codex' ? s.status === 'idle' : s.connected);
    return `<section class="panel agent" id="agent">${head}${err}
      <div class="abar"><b>${PROVIDER[s.provider]}</b>${s.provider === 'claude' ? ` <i class="exp">${A('تجريبي', 'experimental')}</i>` : ''}<span class="chip active"><i></i>${esc(state)}</span>${s.auth ? `<span class="chip todo">${esc(s.auth)}</span>` : ''}${modeChip}<span class="grow"></span>${controls}</div>
      ${warn}${launch}
      <div class="astream" aria-live="polite">${entries || `<p class="tiny muted">${A(`اكتب للوكيل، مثلاً: «كمّل ${it.id}».`, `Message the agent, for example: "Continue ${it.id}".`)}</p>`}</div>
      <form class="acompose" data-agent-form><textarea data-agent-input rows="2" maxlength="20000" placeholder="${A(`اكتب لـ ${PROVIDER[s.provider]}…`, `Message ${PROVIDER[s.provider]}…`)}" ${canSend ? '' : 'disabled'}>${esc(agentDraft)}</textarea><button class="btn go" type="submit" ${canSend && !agentBusy ? '' : 'disabled'}>${A('ابعت', 'Send')}</button></form>
      ${s.provider === 'claude' ? `<p class="tiny muted">${A('الإيقاف والإنهاء بيتعملوا من Claude Code نفسه (Esc). الردود بتوصل كرسايل كاملة.', 'Stop and end happen in Claude Code itself (Esc). Replies arrive as whole messages.')}</p>` : ''}</section>`;
  }
  async function agentAction(action, body, after) {
    agentBusy = true; agentError = null; renderAgent();
    try { const result = await agentPost(action, body); after?.(result); } catch (e) { agentError = e.message; }
    agentBusy = false;
    await loadAgent();
    renderAgent();
  }

  // The one thing to do next, in plain words, from Core's verdict (never computed here).
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
    return `<section class="panel details" id="details"><div class="dtabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${dtab === k}" data-dtab="${k}">${l}</button>`).join('')}</div><div class="dpanel">${panel[dtab] ?? panel.delivery}</div></section>`;
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
    return `<section class="pagehead"><h1 style="font-size:26px">${A('المشاريع', 'Projects')}</h1><p class="muted">${A('كل مشروع ليه مجلد .yallaflow خاص بيه، والكونسول بيقرا كل واحد لوحده.', 'Each project has its own .yallaflow; the console reads each one separately.')}</p></section>
      <section class="projects">${cards}</section>
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
    if (!team.git) return `<section class="pagehead"><h1 style="font-size:26px">${A('نسخ الشغل', 'Worktrees')}</h1><p class="muted">${A('المشروع ده مش جوه git repository.', 'This project is not inside a Git repository.')}</p></section>`;
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
    const open = ST.map((_, i) => all.filter((it) => curIndex(it) === i).length);
    const omax = Math.max(1, ...open);
    const fmtDays = (x) => (x == null ? '—' : x < 1 ? A(`${Math.round(x * 24)} ساعة`, `${Math.round(x * 24)} h`) : A(`${x.toFixed(1)} يوم`, `${x.toFixed(1)} days`));
    const wlabel = (w) => new Date(w.end).toLocaleDateString(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short' });
    return `<section class="pagehead"><h1 style="font-size:26px">${A('الأرقام', 'Insights')}</h1><p class="muted">${A('من السجلات بس: أوقات الإنشاء والإنجاز وتشغيلات التحقق.', 'From records only: creation and completion times and verification runs.')}</p></section>
      <section class="kpis"><div class="kpi panel"><span class="tiny muted">${A('خلص آخر 30 يوم', 'Done in the last 30 days')}</span><b>${last30}</b></div><div class="kpi panel"><span class="tiny muted">${A('متوسط المدة من الطلب لـ«خلص» (الوسيط)', 'Median time from request to Done')}</span><b>${fmtDays(median)}</b><span class="tiny muted">${A(`من ${cycles.length} شغلانة`, `over ${cycles.length} items`)}</span></div><div class="kpi panel"><span class="tiny muted">${A('تشغيلات تحقق نجحت', 'Verification runs passed')}</span><b>${runs.total ? Math.round((runs.passed / runs.total) * 100) : 0}%</b><span class="tiny muted">${runs.passed} / ${runs.total}</span></div><div class="kpi panel"><span class="tiny muted">${A('شغل مفتوح', 'Open work')}</span><b>${all.filter((it) => it.state !== 'done').length}</b></div></section>
      <section class="charts"><article class="panel"><h2 style="font-size:18px">${A('اللي وصل «خلص» كل أسبوع', 'Reached Done per week')} <span class="tiny muted">${A('(آخر 8 أسابيع)', '(last 8 weeks)')}</span></h2>
        <div class="cols">${weeks.map((w) => `<span class="col" data-tip="${esc(wlabel(w))}: ${w.n}"><i style="height:${(w.n / wmax) * 100}%"></i></span>`).join('')}</div><div class="row tiny muted cols-x"><span>${esc(wlabel(weeks[0]))}</span><span class="grow"></span><span>${esc(wlabel(weeks[7]))}</span></div>
        <details style="margin-top:10px"><summary class="tiny muted">${A('اعرض كجدول', 'Show as a table')}</summary><div class="tablewrap"><table><tr><th>${A('الأسبوع المنتهي', 'Week ending')}</th><th>${A('خلص', 'Done')}</th></tr>${weeks.map((w) => `<tr><td>${esc(wlabel(w))}</td><td>${w.n}</td></tr>`).join('')}</table></div></details></article>
      <article class="panel"><h2 style="font-size:18px">${A('الشغل المفتوح في كل محطة', 'Open work by station')}</h2><div class="hbars">${open.map((n, i) => `<div class="hb" data-tip="${esc(L(ST[i].name))}: ${n}"><span class="lab">${L(ST[i].name)}</span><span class="track"><i style="width:${(n / omax) * 100}%;--hue:${ST[i].hue}"></i></span><b>${n}</b></div>`).join('')}</div></article></section>
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
    const views = { item: () => viewItem(r.id), lines: viewLines, team: viewTeam, insights: viewInsights, projects: viewProjects, map: viewMap };
    const body = !snap ? `<p class="muted" style="margin-top:40px;text-align:center">${error ? '' : A('بيحمّل…', 'Loading…')}</p>` : (views[r.v] ?? viewMap)();
    document.getElementById('app').innerHTML = topbar(r) + `<main>${banner()}${body}</main>`;
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
    if (v === 'item') await loadAgent();
    if (v === 'team') await loadTeam();
    else if (v === 'projects') await loadOverview();
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
    closeDrawer(); bellOpen = false; dtab = 'delivery'; const v = route().v; if (v === 'item') { detail = null; render(); await load(); } else if (v === 'team' || v === 'projects') { render(); await loadForView(); } render(); scrollTo(0, 0); });
  document.addEventListener('click', (e) => {
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
    else if (x.dataset.openProject) { e.preventDefault(); switchProject(x.dataset.openProject); }
    else if (x.hasAttribute('data-dev')) { const dev = document.getElementById('dev'); if (dev) { dev.open = true; dev.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' }); } }
    else if (x.dataset.f) { flt.st = flt.st === x.dataset.f ? 'all' : x.dataset.f; render(); }
    else if (x.dataset.moreSt) { const i = +x.dataset.moreSt; if (openSt.has(i)) openSt.delete(i); else openSt.add(i); render(); }
    else if (x.dataset.dtab) { dtab = x.dataset.dtab; render(); if (x.hasAttribute('data-jump')) document.getElementById('details')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); }
    else if (x.dataset.file) openFile(x.dataset.file);
    else if (x.dataset.art) openArtifact(+x.dataset.art);
    else if (x.hasAttribute('data-more')) { const b = x.previousElementSibling; b.classList.toggle('clamp'); x.textContent = b.classList.contains('clamp') ? A('اقرأ الطلب كله ↓', 'Read the whole request ↓') : A('أقل ↑', 'Less ↑'); }
    else if (x.dataset.copy) copy(x.dataset.copy);
  });
  document.addEventListener('input', (e) => { if (e.target.matches('[data-q]')) { flt.q = e.target.value; render(); } else if (e.target.matches('[data-agent-input]')) agentDraft = e.target.value; });
  document.addEventListener('keydown', (e) => { if (e.target.matches?.('[data-agent-input]') && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.target.form.requestSubmit(); } });
  document.addEventListener('submit', (e) => {
    if (e.target.matches('[data-create-form]')) { e.preventDefault(); submitCreate(e.target); }
    else if (e.target.matches('[data-agent-form]')) { e.preventDefault(); const text = agentDraft.trim(); if (!text) return; agentDraft = ''; agentAction('message', { text }); }
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

  async function switchProject(next) {
    pid = next;
    store.set('project', pid);
    snap = null; detail = null; team = null; digest = null;
    location.hash = '#/map';
    render();
    await load();
    await buildDigest();
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
