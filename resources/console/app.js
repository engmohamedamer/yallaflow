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

  // Small, escaped Markdown subset. Never interpret raw HTML or image embeds.
  function richInline(value) {
    const pattern = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^\s)]+)\)/g;
    let html = '', at = 0;
    for (const m of String(value).matchAll(pattern)) {
      html += esc(value.slice(at, m.index));
      if (m[1] !== undefined) html += `<code dir="auto">${esc(m[1])}</code>`;
      else if (m[2] !== undefined) html += `<strong>${esc(m[2])}</strong>`;
      else if (/^https?:\/\//i.test(m[4])) html += `<a href="${esc(m[4])}" target="_blank" rel="noopener noreferrer">${esc(m[3])}</a>`;
      else html += esc(m[0]);
      at = m.index + m[0].length;
    }
    return html + esc(value.slice(at));
  }
  function richText(value) {
    const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
    const out = [], paragraph = [];
    const flush = () => { if (paragraph.length) out.push(`<p dir="auto">${paragraph.splice(0).map(richInline).join('<br>')}</p>`); };
    const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*```/.test(line)) {
        flush(); const code = [];
        while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
        out.push(`<pre dir="ltr"><code>${esc(code.join('\n'))}</code></pre>`); continue;
      }
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) { flush(); out.push(`<h${Math.min(heading[1].length + 2, 6)} dir="auto">${richInline(heading[2])}</h${Math.min(heading[1].length + 2, 6)}>`); continue; }
      if (line.includes('|') && i + 1 < lines.length && cells(lines[i + 1]).every((c) => /^:?-{3,}:?$/.test(c))) {
        flush(); const headers = cells(line); i++;
        const rows = [];
        while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim()) rows.push(cells(lines[++i]));
        out.push(`<div class="tablewrap"><table><thead><tr>${headers.map((c) => `<th dir="auto">${richInline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c) => `<td dir="auto">${richInline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`); continue;
      }
      const list = /^\s*(?:([-*+])|\d+[.)])\s+(.+)$/.exec(line);
      if (list) {
        flush(); const tag = list[1] ? 'ul' : 'ol', items = [list[2]];
        while (i + 1 < lines.length) {
          const next = /^\s*(?:([-*+])|\d+[.)])\s+(.+)$/.exec(lines[i + 1]);
          if (!next || Boolean(next[1]) !== Boolean(list[1])) break;
          items.push(next[2]); i++;
        }
        out.push(`<${tag}>${items.map((item) => `<li dir="auto">${richInline(item)}</li>`).join('')}</${tag}>`); continue;
      }
      if (/^>\s?/.test(line)) { flush(); out.push(`<blockquote dir="auto">${richInline(line.replace(/^>\s?/, ''))}</blockquote>`); continue; }
      if (!line.trim()) flush(); else paragraph.push(line);
    }
    flush(); return out.join('');
  }
  const overviewExpanded = new Set();
  function disclosure(key, summary, body, className = '') {
    return `<details class="disclosure ${className}" data-overview="${esc(key)}" ${overviewExpanded.has(key) ? 'open' : ''}><summary>${summary}<span class="more-label">${A('عرض المزيد', 'View more')}</span><span class="less-label">${A('عرض أقل', 'View less')}</span></summary>${body}</details>`;
  }

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
    fail: { ar: 'فيه مشكلة', en: 'failing' }, paused: { ar: 'دور الوكيل', en: "agent's turn" }, done: { ar: 'خلص', en: 'done' },
    todo: { ar: 'لسه', en: 'not yet' }, na: { ar: 'مش مطلوبة هنا', en: 'not needed here' },
    held: { ar: 'متوقفة مؤقتًا', en: 'on hold' }, closed: { ar: 'مقفولة من غير تسليم', en: 'closed, not delivered' }
  };
  const TYPE = { feature: { ar: 'ميزة', en: 'feature' }, bug: { ar: 'مشكلة', en: 'bug' }, investigation: { ar: 'بحث', en: 'investigation' }, change: { ar: 'تعديل', en: 'change' }, refactor: { ar: 'إعادة هيكلة', en: 'refactor' }, release: { ar: 'إصدار', en: 'release' } };
  const chip = (s) => `<span class="chip ${s === 'na' ? 'todo' : s === 'paused' ? 'idle' : s}">${s === 'na' ? '' : '<i></i>'}${L(STATE[s] ?? { ar: esc(s), en: esc(s) })}</span>`;
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
      failure.messageAr = body?.error?.messageAr ?? null;
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
  // The floating agent chat follows the page (PF-0067): a work item page is that item's chat;
  // the other project pages share one project chat, which is not tied to a work item.
  const PROJECT_CHAT_VIEWS = ['overview', 'map', 'lines', 'setup', 'team', 'insights'];
  const PROJECT_CHAT = Object.freeze({ id: null, project: true });
  function chatCtx(r = route()) {
    if (!snap) return null;
    if (r.v === 'item') return byId(r.id) ?? null;
    return PROJECT_CHAT_VIEWS.includes(r.v) ? PROJECT_CHAT : null;
  }
  const curIndex = (it) => (it.state === 'done' ? 5 : it.state === 'new' ? -1 : stIndex(it.currentStation));

  function topbar(r) {
    const logo = '<svg width="32" height="32" viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"' + (lang === 'ar' ? '' : ' transform="matrix(-1 0 0 1 64 0)"') + '><path d="M28.5 15.5 12.5 32 28.5 48.5" stroke="#0fae9d"/><path d="M50.5 15.5 34.5 32 50.5 48.5" stroke="#5961e8"/></g></svg>';
    const tab = (href, label, on) => `<a href="${href}" ${on ? 'aria-current="page"' : ''}>${label}</a>`;
    const picker = projects.length > 1
      ? `<select class="projsel" data-project aria-label="${A('المشروع', 'Project')}">${projects.map((p) => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`
      : `<b class="projname">${esc(snap?.project?.name ?? projects[0]?.name ?? '')}</b>`;
    const count = snap ? needs().length : 0;
    // PF-0123: Flow and Work are one Workspace (its page switches the view); Insights and
    // Worktrees sit under More. Every old route (#/map, #/lines, #/insights, #/team) still works.
    const moreOn = ['insights', 'team'].includes(r.v);
    const more = `<details class="navmore" data-navmore><summary ${moreOn ? 'aria-current="page"' : ''} aria-haspopup="menu">${moreOn ? (r.v === 'team' ? A('نسخ الشغل', 'Worktrees') : A('الأرقام', 'Insights')) : A('المزيد', 'More')} <span aria-hidden="true">▾</span></summary>
      <div class="navmenu" role="menu"><a role="menuitem" href="#/insights" ${r.v === 'insights' ? 'aria-current="page"' : ''}>${A('الأرقام', 'Insights')}</a><a role="menuitem" href="#/team" ${r.v === 'team' ? 'aria-current="page"' : ''}>${A('نسخ الشغل', 'Worktrees')}</a></div></details>`;
    return `<header class="top"><a class="brand" href="${workspaceHref()}">${logo} YallaFlow</a><div class="projpick">${picker}<a class="tiny muted" href="#/projects">${A('كل المشاريع', 'All projects')}</a></div>
      <nav class="tabs" aria-label="${A('الأقسام', 'Sections')}">${tab(workspaceHref(), A('مساحة الشغل', 'Workspace'), ['map', 'lines', 'item'].includes(r.v))}${tab('#/agents', A('الوكلاء', 'Agents') + (execView?.inbox?.length ? ` <b class="tabcount">${execView.inbox.length}</b>` : ''), r.v === 'agents')}${tab('#/setup', A('الإعداد والتشغيل', 'Setup & run'), r.v === 'setup')}${tab('#/overview', A('المشروع', 'Project'), r.v === 'overview')}${more}</nav>
      <span class="grow"></span>${!readOnly && projects.length ? `<button class="btn sm go create" data-create aria-label="${A('شغل جديد', 'Create work')}" ${createBlockedReason() ? `disabled title="${esc(createBlockedReason())}"` : ''}>＋<span class="lbl"> ${A('شغل جديد', 'Create work')}</span></button>` : ''}<span class="chip ${offline() ? 'fail' : 'active'}"><i></i>${offline() ? A('مفيش اتصال', 'offline') : A('مباشر', 'Live')}</span>
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
    // PF-0123: while the readiness card explains the next step, the empty state does not repeat it.
    const brownfieldNote = snap.project.kind === 'brownfield' && !createBlockedReason() ? `<p class="tiny muted" style="margin-top:6px">${A('في مشروع قايم بالفعل، YallaFlow بيطلب فهم المشروع والموافقة عليه الأول؛ الوكيل بيبدأه لوحده.', 'In an existing codebase, YallaFlow first asks for an approved project understanding; your agent starts it for you.')}</p>` : '';
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
    return `<section class="hero compact">${ring(pct, 80, 8)}<div><h1>${greet}</h1>
      <p>${A(`${open} ${open === 1 ? 'شغلانة مفتوحة' : 'شغلانات مفتوحة'} واصلة في المتوسط ${pct}%، و${you} ${you === 1 ? 'شغلانة مستنية' : 'شغلانات مستنية'} قرارك.`, `${open} open work item${open === 1 ? ' is' : 's are'} on average ${pct}% along, and ${you} item${you === 1 ? '' : 's'} wait${you === 1 ? 's' : ''} for your decision.`)}</p><details class="progress-help tiny muted"><summary>${A('النسبة بتتحسب إزاي؟', 'How is progress calculated?')}</summary><p>${A('النسبة للشغل المفتوح المسجّل بس.', 'The percentage covers open recorded work only.')} ${formula()}</p></details></div>
      ${stats}</section>`;
  }
  const createButton = () => (readOnly || createBlockedReason() ? '' : `<button class="btn go" data-create style="margin-top:12px">＋ ${A('ابدأ أول شغلانة', 'Create work')}</button>`);
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
  // PF-0123: project readiness (GET /api/p/<id>/readiness), derived by the server from Core state.
  let readiness = null; // { pid, data }
  function createBlockedReason() {
    const data = readiness?.pid === pid ? readiness.data : null;
    if (!data || data.allows?.createWork !== false) return null;
    const step = data.steps?.find((x) => x.blocks?.includes('createWork'));
    const text = step && READY_TEXT[step.id]?.[step.status];
    return text ? L({ ar: text[0], en: text[1] }) : A('المشروع لسه مش جاهز لشغل جديد.', 'The project is not ready for new work yet.');
  }
  async function loadReadiness() {
    if (!pid) return;
    const forPid = pid;
    try { readiness = { pid: forPid, data: await api(`/api/p/${forPid}/readiness`) }; } catch { if (readiness?.pid !== forPid) readiness = null; }
  }
  // What the project still needs, one line per step with its single next action. Shown only
  // while something required is missing, so an established project looks exactly as before.
  const READY_TEXT = {
    initialized: { done: ['YallaFlow متجهّز في المشروع', 'YallaFlow is set up in this project'], attention: ['YallaFlow مش قادر يقرا سجلات المشروع', 'YallaFlow cannot read this project\'s records'] },
    understanding: {
      done: ['فهم المشروع جاهز', 'Project understanding is in place'],
      required: ['ده مشروع قايم: الوكيل يجهّز فهم للمشروع وإنت توافق عليه قبل أي شغل جديد', 'This is an existing codebase: your agent prepares a project understanding and you approve it before new work'],
      'in-progress': ['الوكيل بيجهّز فهم المشروع', 'Your agent is preparing the project understanding'],
      'awaiting-review': ['مسودة فهم المشروع مستنية مراجعتك', 'The project-understanding draft is waiting for your review']
    },
    agent: { done: ['Codex جاهز', 'Codex is ready'], off: ['الوكلاء مقفولين في الكونسول ده', 'Agents are off in this console'], missing: ['Codex مش جاهز على الجهاز ده', 'Codex is not ready on this machine'] },
    runtime: { done: ['التطبيق شغّال', 'The app is running'], 'not-configured': ['تشغيل التطبيق من هنا (اختياري)', 'Run the app from here (optional)'], failed: ['خدمة من خدمات التطبيق واقفة', 'An app service has stopped'], stopped: ['التطبيق واقف', 'The app is stopped'] }
  };
  function readinessAction(st) {
    const btn = (attrs, label, go = false) => `<button type="button" class="btn sm ${go ? 'go' : ''}" ${attrs}>${label}</button>`;
    if (readOnly && st.status !== 'done') return st.next?.command ? `<code class="ltr tw:text-xs">${esc(st.next.command)}</code>` : '';
    if (st.id === 'initialized' && st.status === 'attention') return `<code class="ltr tw:text-xs">yallaflow doctor</code>`;
    if (st.id === 'understanding') {
      if (st.status === 'awaiting-review' && st.baselineId) return `<a class="btn sm go" href="#/item/${encodeURIComponent(st.baselineId)}">${A('راجع المسودة', 'Review the draft')}</a>`;
      if (st.status === 'required' || st.status === 'in-progress') {
        const ask = st.status === 'required' ? A('جهّز فهم للمشروع ده بأدلة من المستودع، وبعدها اعرضه عليّا عشان أوافق.', 'Establish project understanding for this repository, then show it to me for approval.') : A('كمّل تجهيز فهم المشروع.', 'Continue the project-understanding discovery.');
        const ready = agentsOn && readiness?.data?.allows?.agentSessions;
        return ready ? btn(`data-ready-chat="${esc(ask)}"`, st.status === 'required' ? A('ابدأ مع الوكيل', 'Start with the agent') : A('كمّل مع الوكيل', 'Continue with the agent'), true)
          : `<button type="button" class="btn sm" data-copy="${esc(ask)}" data-copy-what="text" title="${esc(ask)}">${A('انسخ الطلب لوكيلك', 'Copy the request for your agent')}</button>`;
      }
    }
    if (st.id === 'agent' && st.status === 'off' && agentsCanEnable) return btn('data-agents-enable', A('شغّل الوكلاء', 'Turn agents on'), true);
    if (st.id === 'agent' && st.status === 'missing') return `<a class="btn sm" href="#/setup" data-setup-jump="agents">${A('جهّز Codex', 'Set up Codex')}</a>`;
    if (st.id === 'runtime' && st.status !== 'done') return `<a class="btn sm ghost" href="#/setup">${st.status === 'not-configured' ? A('جهّز التشغيل', 'Set up running') : A('افتح التشغيل', 'Open Run')}</a>`;
    return '';
  }
  function readinessCard({ always = false } = {}) {
    const data = readiness?.pid === pid ? readiness.data : null;
    if (!data || (!always && data.level === 'ready')) return '';
    const shown = data.steps.filter((st) => st.status !== 'unknown' && st.status !== 'unsupported' && READY_TEXT[st.id]?.[st.status] && !(st.id === 'agent' && st.status === 'done' && data.level === 'ready'));
    const icon = (st) => (st.status === 'done' ? '<span class="tw:text-palm" aria-hidden="true">✓</span>' : st.optional ? '<span class="tw:text-muted" aria-hidden="true">○</span>' : st.status === 'attention' || st.status === 'failed' ? '<span class="tw:text-clay" aria-hidden="true">✕</span>' : '<span class="tw:text-amber" aria-hidden="true">◐</span>');
    const left = data.steps.filter((st) => !st.optional && !['done', 'unknown'].includes(st.status) && (st.id !== 'agent' || data.steps.find((x) => x.id === 'understanding')?.status !== 'done')).length;
    const title = data.level === 'ready' ? A('المشروع جاهز', 'The project is ready') : A(`فاضل ${left === 1 ? 'خطوة واحدة' : left === 2 ? 'خطوتين' : `${left} خطوات`} قبل الشغل الجديد`, `${left} step${left === 1 ? '' : 's'} left before new work`);
    return `<section class="panel tw:mb-4 tw:px-5 tw:py-4" aria-labelledby="ready-h" data-readiness="${esc(data.level)}">
      <div class="row"><span class="chip ${data.level === 'ready' ? 'done' : data.level === 'attention' ? 'fail' : 'wait'}"><i></i>${data.level === 'ready' ? A('جاهز', 'Ready') : data.level === 'attention' ? A('محتاج انتباه', 'Needs attention') : A('بيتجهّز', 'Getting ready')}</span><h2 id="ready-h" class="tw:text-lg tw:font-semibold">${title}</h2></div>
      <ol class="tw:mt-3 tw:grid tw:gap-1 tw:p-0 tw:list-none">${shown.map((st) => `<li class="tw:flex tw:flex-wrap tw:items-center tw:gap-3 tw:rounded-field tw:px-3 tw:py-2 ${st.status === 'done' ? '' : 'tw:bg-bg-2'}"><span class="tw:w-5 tw:text-center">${icon(st)}</span><span class="grow ${st.status === 'done' ? 'muted' : ''}">${L({ ar: READY_TEXT[st.id][st.status][0], en: READY_TEXT[st.id][st.status][1] })}${st.optional ? ` <span class="tiny muted">${A('· اختياري', '· optional')}</span>` : ''}</span>${st.status === 'done' ? '' : readinessAction(st)}</li>`).join('')}</ol>
      ${data.steps.some((st) => st.id === 'understanding' && st.status === 'awaiting-review') ? `<p class="tiny muted tw:mt-2">${A('بعد ما تراجعها، قول للوكيل «موافق» أو اللي عايز تغيّره. الموافقة قرارك إنت بس.', 'After reviewing it, tell your agent "Approve" or what to change. Approval is only your decision.')}</p>` : ''}</section>`;
  }
  // PF-0123: the New gate's ＋ is the same Create work action as the header button (keyboard
  // reachable, named in both languages). While the project is not ready it stays visible but
  // disabled, with the reason; a read-only console shows the plain icon.
  function newGateButton() {
    if (readOnly) return '<span class="st-ico" aria-hidden="true">＋</span>';
    const blocked = createBlockedReason();
    const label = A('شغل جديد', 'Create work');
    return `<button type="button" class="st-ico st-add tw:cursor-pointer tw:border-0 tw:text-xl tw:transition-colors tw:hover:bg-nile-soft tw:hover:text-nile-2 tw:disabled:cursor-not-allowed tw:disabled:opacity-50" data-create aria-label="${label}" title="${esc(blocked ?? label)}" ${blocked ? `disabled aria-describedby="newgate-why"` : ''}>＋</button>${blocked ? `<span id="newgate-why" class="tw:sr-only">${esc(blocked)}</span>` : ''}`;
  }
  // PF-0123: the Workspace's two views. The last one chosen is where the Workspace tab returns.
  const workspaceHref = () => (store.get('wsView', 'map') === 'lines' ? '#/lines' : '#/map');
  function viewSwitch() {
    const v = route().v;
    const seg = (href, key, label, icon) => `<a href="${href}" class="tw:inline-flex tw:items-center tw:gap-1.5 tw:rounded-chip tw:px-3.5 tw:py-1 tw:text-sm tw:font-medium tw:no-underline ${v === key ? 'tw:bg-card tw:text-ink tw:shadow-card' : 'tw:text-muted tw:hover:text-ink'}" ${v === key ? 'aria-current="page"' : ''}><span aria-hidden="true">${icon}</span>${label}</a>`;
    return `<nav class="tw:inline-flex tw:gap-0.5 tw:rounded-chip tw:bg-bg-2 tw:p-1" aria-label="${A('طريقة العرض', 'View')}">${seg('#/map', 'map', A('التدفق', 'Flow'), '⇄')}${seg('#/lines', 'lines', A('القايمة', 'List'), '☰')}</nav>`;
  }
  function filterBar() {
    const c = (v, label) => `<button class="fchip ${flt.st === v ? 'on' : ''}" data-f="${v}">${label}</button>`;
    const shown = items().filter(vis).length;
    return `<section class="fbar" aria-label="${A('فلترة', 'Filter')}">${viewSwitch()}<input type="search" data-q value="${esc(flt.q)}" placeholder="${A('دوّر بالاسم أو الرقم…', 'Search by title or ID…')}" aria-label="${A('بحث', 'Search')}">
      ${c('all', A('الكل', 'All'))}${c('you', '◆ ' + L(STATE.you))}${c('fail', '✕ ' + L(STATE.fail))}${c('active', '● ' + L(STATE.active))}${c('paused', L(STATE.paused))}
      <select data-ftype aria-label="${A('النوع', 'Type')}"><option value="all">${A('كل الأنواع', 'All types')}</option>${Object.keys(TYPE).map((k) => `<option value="${k}" ${flt.type === k ? 'selected' : ''}>${L(TYPE[k])}</option>`).join('')}</select>
      <span class="grow"></span>${agentsOn && !readOnly && route().v === 'lines' ? `<button class="fchip ${selecting ? 'on' : ''}" data-select-toggle>${A('اختار لطابور', 'Select for a queue')}</button>` : ''}<span class="tiny muted">${A(`${shown} من ${items().length}`, `${shown} of ${items().length}`)}</span></section>`;
  }

  function pchip(it) {
    const old = isOld(it);
    const ag = agentOnItem(it);
    const agLine = ag ? `<div class="pagent ${ag}">${ag === 'approval' ? `✋ ${A('الوكيل مستني إذنك', 'The agent needs your approval')}` : ag === 'reply' ? `💬 ${A('الوكيل خلّص ومستني ردّك', 'The agent finished; your turn')}` : `<i></i> ${A('الوكيل شغّال عليها', 'The agent is working on it')}`}</div>` : '';
    return `<article class="pchip ${it.state} ${old ? 'old' : ''} ${ag ? `agent-${ag}` : ''}" data-w="${esc(it.id)}" ${readOnly ? '' : 'draggable="true"'}><a class="pbody" href="#/item/${encodeURIComponent(it.id)}" draggable="false"><span class="pid ltr wid" title="${esc(it.id)}">${esc(it.id)}</span><div class="tt">${esc(it.title)}</div>${agLine}
      <div class="meta">${chip(it.state)}<span class="grow"></span><b>${it.completion}%</b></div><div class="mini"><i style="width:${it.completion}%"></i></div>
      <div class="badges">${it.lastActivityAt && it.state !== 'done' ? `<span class="bdg ${old ? 'old' : ''}">⏱ ${ago(it.lastActivityAt)}</span>` : ''}${it.sourceCount ? `<span class="bdg">📎 ${it.sourceCount}</span>` : ''}</div></a>
      <div class="pactions">${ag && !readOnly ? `<button type="button" class="pchat pstart ${ag}" data-chat-item="${esc(it.id)}" data-chat-draft=""><span>${ag === 'working' ? A('تابع', 'Watch') : A('شوف', 'Open')}</span></button>` : it.state === 'new' && !readOnly ? `<button type="button" class="pchat pstart" data-chat-item="${esc(it.id)}" aria-label="${A('ابدأ مع الوكيل على', 'Start with the agent on')} ${esc(it.id)}" title="${A('بيفتح الشات بالرسالة اللي بتطلب الشغل كله، وانت اللي بتبعت.', 'Opens the chat with the whole-job message; you send it.')}"><span aria-hidden="true">▶</span><span>${A('ابدأ', 'Start')}</span></button>` : `<button type="button" class="pchat" data-chat-item="${esc(it.id)}" aria-label="${A('افتح الشات للطلب', 'Open chat for')} ${esc(it.id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h6"/></svg><span>${A('الشات', 'Chat')}</span></button>`}${readOnly || !itemActions(it).length ? '' : `<button type="button" class="pmenu" data-menu="${esc(it.id)}" aria-label="${A('أفعال', 'Actions')} ${esc(it.id)}" title="${A('أفعال الطلب', 'Work item actions')}">⋯</button>`}</div></article>`;
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
    const firstRun = items().every((it) => it.state === 'new') ? `<section class="panel firstrun" style="margin-bottom:14px"><b>${A('شغلك لسه في البوابة', 'Your work is at the gate')}</b><p class="small">${A('كل شغلانة جديدة بتستنى قبل المحطات. لما وكيلك يصنّفها (نوعها وحجمها)، بتدخل «افهم» وتعدّي على «قرّر» و«نفّذ» و«اتحقّق» و«افتكر» حسب اللي محتاجاه. المحطات الفاضية دي مش مشكلة.', 'Each new work item waits before the stations. Once your agent classifies it (type and size), it enters Understand and passes Decide, Change, Verify and Remember as needed. Empty stations are not a problem.')}</p>${items().slice(0, 3).map((it) => `<a class="btn sm" href="#/item/${encodeURIComponent(it.id)}">${esc(it.title)} ${fwd()}</a>`).join(' ')}</section>` : '';
    return digestCard() + hero() + firstRun + integrityPanel() + filterBar() + `<section class="map" id="map" aria-label="${A('التدفق', 'Flow')}">
      <div class="station gate start" data-st="-1" style="--hue:var(--ink-2)"><div class="st-head">${newGateButton()}<div class="st-name">${A('جديد', 'New')}</div><span class="st-n">${entries.length}</span></div><div class="st-out">${A('الطلبات بتدخل من هنا', 'Requests enter here')}</div>
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
    return hero() + integrityPanel() + filterBar() + `<section class="lines ${selecting ? 'selecting' : ''}">${list.map((it) => `<a class="line ${selecting && selected.includes(it.id) ? 'sel' : ''} ${selecting && !selectable(it) ? 'nosel' : ''}" href="#/item/${encodeURIComponent(it.id)}" data-w="${esc(it.id)}" ${selecting && selectable(it) ? `data-sel="${esc(it.id)}" aria-pressed="${selected.includes(it.id)}"` : ''}>${selecting && selectable(it) ? `<span class="selbox" aria-hidden="true">${selected.includes(it.id) ? '☑' : '☐'}</span>` : ''}<div><div class="row tiny muted">${wid(it.id)}${attentionBadge(it)}<span>· ${L(TYPE[it.type] ?? { ar: '—', en: '—' })}</span>${it.stage ? `<span class="ltr">· ${esc(it.stage)}</span>` : ''}</div><div class="tt">${esc(it.title)}</div><div class="nx">${iso(nowText(it))}</div></div>${relay(it)}<div class="row">${chip(it.state)}${ring(it.completion, 62, 7)}</div></a>`).join('') || `<p class="muted">${A('مفيش شغل.', 'No work.')}</p>`}</section>` + selectionBar();
  }

  // PF-0112: where this item stands in a queue, if it is in one.
  function queueLine(it) {
    const q = it ? queueOf(it.id) : null;
    if (!q) return '';
    return `<p class="qline small">${A(`في طابور · ${q.position} من ${q.total}`, `In a queue · ${q.position} of ${q.total}`)} · <a href="#/agents">${A('شوف الطابور', 'See the queue')}</a></p>`;
  }
  function nowText(it) {
    if (it.state === 'done') return A('خلص واتأكد.', 'Done and verified.');
    if (it.routing === 'pending') return A('الوكيل هيصنّف الطلب ده (النوع والحجم) ويكمّل.', 'Your agent classifies this request (type and size) and takes it from there.');
    if (it.waitingFor) return it.waitingFor.kind === 'review' ? A(`مستني مراجعتك (${it.waitingFor.gate}).`, `Waiting for your review (${it.waitingFor.gate}).`) : A(`مستني إجابتك على ${it.waitingFor.questions.join('، ')}.`, `Waiting for your answer to ${it.waitingFor.questions.join(', ')}.`);
    if (it.blocker) return blockerText(it.blocker);
    // PF-0100: the stage is finished and Core's next step is to move on.
    if (/^yallaflow advance\b/.test(it.nextAction ?? '')) return A('المرحلة دي خلصت. قول للوكيل يكمّل للمرحلة الجاية.', 'This stage is finished. Tell the agent to continue to the next stage.');
    return it.nextAction ?? '';
  }
  // PF-0093: YallaFlow's blocker texts in plain Arabic (the English stays as it is).
  const SKILL_AR = { 'context-discovery': 'اكتشاف المشروع', 'requirement-clarification': 'توضيح المتطلبات', 'design-exploration': 'استكشاف التصميم', specification: 'المواصفات', 'implementation-planning': 'خطة التنفيذ', implementation: 'التنفيذ', verification: 'التحقق', 'delivery-convergence': 'مطابقة اللي اتسلّم بالمطلوب', 'code-review': 'مراجعة الكود', 'systematic-debugging': 'تتبّع سبب المشكلة' };
  function blockerText(text) {
    const t = String(text ?? '');
    if (lang !== 'ar' || !t) return t;
    let m = /^([a-z-]+) checkpoint is ([a-z_]+)/.exec(t);
    if (m) {
      const name = SKILL_AR[m[1]] ?? m[1];
      if (m[2] === 'pending') return `الوكيل لسه ما سجّلش «${name}». ابعتله في الشات يكمّل.`;
      if (m[2] === 'in_progress') return `الوكيل شغّال على «${name}» ولسه ما خلّصهاش.`;
      if (m[2] === 'blocked') return `«${name}» متعطّلة. اسأل الوكيل في الشات إيه اللي واقفها.`;
      return `«${name}»: ${m[2]}`;
    }
    m = /^([a-z-]+) review is ([a-z_]+)/.exec(t);
    if (m) return m[2] === 'changes_requested' ? `طلبت تعديلات في مراجعة «${m[1]}». الوكيل يعدّل ويرجعلك.` : `مستني مراجعتك («${m[1]}»): من «راجع وقرّر».`;
    if (/knowledge review is pending|knowledge candidate/.test(t)) return 'فاضل مراجعة المعرفة اللي اتعلمناها. الوكيل بيعملها قبل ما يقفل.';
    m = /impact (\S+) is pending/.exec(t);
    if (m) return `المطلوب اتغيّر بعد ما اتثبّت، والوكيل لازم يقيّم أثر التغيير (${m[1]}) قبل ما يكمّل.`;
    m = /^(Q-\d+): ([\s\S]+)$/.exec(t);
    if (m) return `فيه سؤال مفتوح لازم يتجاوب (${m[1]}): ${m[2]}`;
    if (/establish and approve project understanding/.test(t)) return 'فهم المشروع لازم يتعمل ويتعتمد الأول.';
    return t;
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
      <section class="ihead">${ring(it.completion, 132, 13)}<div><div class="row tiny muted"><span class="ltr">${esc(it.id)}</span><button type="button" class="ibtn" data-copy="${esc(it.id)}" data-copy-what="id" title="${A('انسخ رقم الشغلانة', 'Copy the work item ID')}" aria-label="${A('انسخ رقم الشغلانة', 'Copy the work item ID')}">⧉</button><span>· ${L(TYPE[it.type] ?? { ar: 'لسه متصنفش', en: 'unrouted' })}</span>${it.scope ? `<span class="ltr">· ${esc(it.scope)}</span>` : ''}${it.stage ? `<span class="ltr">· ${esc(it.stage)}</span>` : ''}</div><h1>${esc(it.title)}</h1><p style="font-size:18px;color:var(--ink-2);margin-top:4px">${headline}</p><p class="tiny muted" style="margin-top:4px">${formula()}</p></div>
</section>
      ${queueLine(it)}${nextCard(it)}
      ${actionBar(it)}
      ${agentsOn && !readOnly && it.state !== 'done' && !it.lifecycle ? '' : `<div class="row chatcue"><button class="btn sm" data-chat-toggle aria-controls="chatwin">💬 ${A('اشتغل على الشغلانة دي مع الوكيل', 'Work on this item with the agent')}</button></div>`}
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
  // PF-0112: every lane of every project in this console (the Agents view and its inbox).
  let execView = null;
  let execError = null;
  async function loadExecution() {
    if (!agentsOn) { execView = null; return; }
    try { execView = await api('/api/execution'); execError = null; await loadMerges(); } catch (e) { execError = e.message; }
  }
  // PF-0112 M1: choosing work for a queue (Work page) and the run sheet.
  let selecting = false;
  let selected = [];
  const selectable = (it) => it && !['done', 'closed', 'held'].includes(it.state);
  function queueOf(workId) {
    for (const lane of execView?.lanes ?? []) {
      if (lane.project !== pid) continue;
      for (const run of lane.runs) {
        if (run.mode === 'now' || ['finished', 'cancelled'].includes(run.state)) continue;
        const list = run.lanes[0].tasks;
        const index = list.findIndex((task) => task.workId === workId && !['done', 'failed', 'skipped', 'cancelled'].includes(task.state));
        if (index !== -1) return { run, task: list[index], position: index + 1, total: list.length };
      }
    }
    return null;
  }
  function selectionBar() {
    if (!selecting) return '';
    const n = selected.length;
    return `<div class="selbar" role="region" aria-label="${A('الشغل المختار', 'Selected work')}"><b>${A(`${n} مختار`, `${n} selected`)}</b><span class="tiny muted">${A('دوس على شغلانة عشان تختارها.', 'Click work items to select them.')}</span><span class="grow"></span>
      ${n >= 1 ? `<button class="btn sm go" data-queue-open>${n === 1 ? A('شغّلها في طابور', 'Run in a queue') : A(`طابور من ${n}`, `Queue ${n}`)}</button>` : ''}${n >= 1 && n <= 4 && projects.find((pr) => pr.id === pid)?.kind !== 'lane' ? `<button class="btn sm" data-parallel-open>${A(`توازي (${n})`, `Parallel (${n})`)}</button>` : ''}<button class="btn sm ghost" data-select-off>${A('إلغاء', 'Cancel')}</button></div>`;
  }
  function openQueueSheet() {
    let d = document.getElementById('queuedlg');
    if (!d) { d = document.createElement('dialog'); d.id = 'queuedlg'; d.className = 'panel'; document.body.appendChild(d); }
    const list = selected.map(byId).filter(Boolean);
    d.innerHTML = `<form method="dialog" data-queue-form class="wizform"><h2 style="font-size:18px">${A(`طابور من ${list.length}`, `Queue of ${list.length}`)}</h2>
      <p class="small">${A('الوكيل هيشتغل عليهم واحدة ورا التانية، كل واحدة في جلسة جديدة. المهمة اللي بعدها بتبدأ بس لما اللي قبلها تبقى DONE والجلسة تقفل. أي موافقة أو مراجعة أو سؤال بيوقف الطابور لحد ما ترد.', 'The agent works on them one after another, each in a new session. The next starts only when the previous one is DONE and its session has closed. Any approval, review or question stops the queue until you answer.')}</p>
      <ol class="qlist">${list.map((it, i) => `<li><span dir="auto">${esc(it.title)}</span> ${wid(it.id)}<span class="grow"></span><button type="button" class="ibtn" data-q-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="${A('لفوق', 'Up')}">↑</button><button type="button" class="ibtn" data-q-down="${i}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="${A('لتحت', 'Down')}">↓</button></li>`).join('')}</ol>
      <fieldset><legend class="small">${A('الوكيل', 'Agent')}</legend>
        <label class="small"><input type="radio" name="provider" value="codex" checked> Codex</label>
        ${execView?.lanes?.find((lane) => lane.project === pid)?.userSessions ? `<label class="small"><input type="radio" name="provider" value="claude"> Claude Code <span class="tiny muted">(${A('بمساعدتك: الكونسول مبيقدرش يشغّل Claude Code، فإنت بتبدأ كل مهمة فيه وتربطها. على حسابات Team/Enterprise رسايل الكونسول ممكن تكون مقفولة.', 'assisted: the console cannot start Claude Code, so you start and link each task there. On Team/Enterprise logins console messages may be off.')})</span></label>` : ''}</fieldset>
      <label class="small"><input type="checkbox" name="pauseBetween"> ${A('وقّف بعد كل مهمة لحد ما أقول كمّل', 'Pause after each task until I say continue')}</label>
      <p class="tiny muted">${A(`طلبات الموافقة بتستنى ${approvalMinutes()} دقيقة وبعدين بتترفض تلقائي (تقدر تغيّرها من «الإعداد والتشغيل»).`, `Approval requests wait ${approvalMinutes()} minutes, then are denied automatically (change it in Setup & run).`)}</p>
      <label class="small"><input type="checkbox" name="confirmed" data-queue-confirm> ${A('فاهم إن الوكيل هيشتغل عليهم بالترتيب ده', 'I understand the agent works through them in this order')}</label>
      <div class="row"><button type="button" class="btn ghost" data-queue-cancel>${A('إلغاء', 'Cancel')}</button><span class="grow"></span><button class="btn go" type="submit" data-queue-start disabled>${A('ابدأ الطابور', 'Start queue')}</button></div></form>`;
    if (!d.open) d.showModal();
  }
  const approvalMinutes = () => (agentSetup?.pid === pid ? agentSetup.data?.approvalWait?.minutes : null) ?? Math.round((agent?.permissionTimeoutMs ?? 300000) / 60000);
  async function startQueue(form) {
    const body = { workIds: selected, provider: form.elements.provider?.value ?? 'codex', pauseBetween: form.elements.pauseBetween.checked, confirmed: form.elements.confirmed.checked, lang, mode: 'workspace-write' };
    try {
      await post(`/api/p/${pid}/execution/run`, JSON.stringify(body), { 'Content-Type': 'application/json' });
      document.getElementById('queuedlg')?.close();
      selecting = false; selected = [];
      location.hash = '#/agents';
      await loadExecution();
      render();
    } catch (err) { toast(esc(why(err))); }
  }
  // PF-0112 M2: parallel lanes (S4), Shared Project Mode from the console, and Clean up.
  async function openParallelSheet() {
    let d = document.getElementById('paralleldlg');
    if (!d) { d = document.createElement('dialog'); d.id = 'paralleldlg'; d.className = 'panel'; document.body.appendChild(d); }
    d.innerHTML = `<p class="small">${A('بيحمّل…', 'Loading…')}</p>`;
    if (!d.open) d.showModal();
    let info;
    try { info = await api(`/api/p/${pid}/lanes`); } catch (err) { d.innerHTML = `<p class="small">${esc(why(err))}</p><button class="btn ghost" data-parallel-cancel>${A('قفل', 'Close')}</button>`; return; }
    const pre = info.preconditions ?? { blockers: [] };
    const needShared = pre.blockers.some((b) => b.code === 'SHARED_REQUIRED');
    let preview = null;
    if (needShared) { try { preview = await api(`/api/p/${pid}/shared/preview`); } catch { preview = null; } }
    const list = selected.map(byId).filter(Boolean);
    const ok = (good, text) => `<li>${good ? '✓' : '✗'} ${text}</li>`;
    d.innerHTML = `<form method="dialog" data-parallel-form class="wizform"><h2 style="font-size:18px">${A(`شغل متوازي: ${list.length} مسار`, `Parallel work: ${list.length} lane${list.length === 1 ? '' : 's'}`)}</h2>
      <p class="small">${A('كل مهمة بتاخد فولدر وbranch خاصين بيها (Git worktree)، ووكيل لوحدها. ملفاتك في المشروع الأساسي مبتتلمسش.', 'Each task gets its own folder and branch (a Git worktree) and its own agent. Your files in the main project are not touched.')}</p>
      <ul class="checklist small">
        ${ok(!pre.blockers.some((b) => b.code === 'GIT_UNVERIFIED_PLATFORM'), A(`Git متجرّب على الجهاز ده${pre.platform ? ` (${esc(pre.platform)})` : ''}`, `Git verified on this machine${pre.platform ? ` (${esc(pre.platform)})` : ''}`))}
        ${ok(!needShared, A('Shared Project Mode متفعّل ومتعمله commit', 'Shared Project Mode enabled and committed'))}
        ${ok(!pre.blockers.some((b) => b.code === 'NOT_ON_INTEGRATION_BRANCH'), A(`على فرع الدمج${pre.integrationBranch ? ` (${esc(pre.integrationBranch)})` : ''}${pre.base ? ` @ ${esc(pre.base.slice(0, 7))}` : ''}`, `On the integration branch${pre.integrationBranch ? ` (${esc(pre.integrationBranch)})` : ''}${pre.base ? ` @ ${esc(pre.base.slice(0, 7))}` : ''}`))}
        ${ok(!pre.blockers.some((b) => b.code === 'GIT_EXTERNAL_DRIVERS'), A('مفيش filters أو merge drivers خارجية في الريبو', 'No external Git filters or merge drivers'))}
      </ul>
      ${pre.blockers.filter((b) => b.code !== 'SHARED_REQUIRED').map((b) => `<p class="tiny fail"${trDir(b, 'message')}>${trHtml(b, 'message')}</p>`).join('')}
      ${needShared ? sharedPanel(preview, A('محتاج Shared Project Mode', 'Shared Project Mode is needed'), A('علشان أرقام الشغل متتكررش بين المسارات.', 'So work ids never collide between lanes.')) : ''}
      <p class="tiny muted">${A('فولدر المسارات', 'Lanes folder')}: <span class="ltr">${esc(pre.lanesRoot ?? '')}</span></p>
      <ol class="qlist">${list.map((it) => `<li><span dir="auto">${esc(it.title)}</span> ${wid(it.id)}</li>`).join('')}</ol>
      <label class="small">${A('أقصى عدد وكلاء في نفس الوقت', 'Most agents at once')} <select name="maxLanes"><option value="2">2</option><option value="3">3 (${A('تجريبي', 'experimental')})</option><option value="4">4 (${A('تجريبي', 'experimental')})</option></select></label>
      <p class="tiny muted">${A('كل مسار بيستخدم اشتراكك. الشغلانة لازم تكون متعملها commit في الفرع الأساسي.', 'Each lane uses your subscription. Each work item must already be committed on the integration branch.')}</p>
      <label class="small"><input type="checkbox" name="confirmed" data-parallel-confirm> ${A('أنشئ الفولدرات والفروع yf/… ليا وابدأ الوكلاء', 'Create the folders and yf/… branches for me and start the agents')}</label>
      <div class="row"><button type="button" class="btn ghost" data-parallel-cancel>${A('إلغاء', 'Cancel')}</button><span class="grow"></span><button class="btn go" type="submit" data-parallel-start disabled ${pre.ok || (needShared && pre.blockers.length === 1) ? '' : 'data-blocked'}>${A('ابدأ', 'Start')}</button></div></form>`;
  }
  async function startParallelRun(form) {
    try {
      await post(`/api/p/${pid}/execution/parallel`, JSON.stringify({ workIds: selected, maxLanes: Number(form.elements.maxLanes.value), confirmed: form.elements.confirmed.checked, lang }), { 'Content-Type': 'application/json' });
      document.getElementById('paralleldlg')?.close();
      selecting = false; selected = [];
      await reloadProjects().catch(() => {});
      location.hash = '#/agents';
      await loadExecution();
      render();
    } catch (err) { toast(esc(why(err))); }
  }
  // PF-0113: the one Shared Project Mode panel — the CLI's own dry-run preview, a confirmation, and
  // the existing enable endpoint (its guards stay on the server). Used by Parallel lanes and Overview.
  function sharedPanel(preview, title, reason) {
    return `<div class="panel sub" data-shared-panel><b class="small">${title}</b><p class="tiny muted">${reason} ${A('ده هيشغّل yallaflow shared enable؛ بعدها اعمل commit لـ .yallaflow/. أرقام الشغل والمصادر الموجودة مبتتغيرش؛ الجديدة بس بتاخد شكل PF-<tag>-####.', 'This runs yallaflow shared enable; then commit .yallaflow/. Existing work and source IDs never change; only new ones take the PF-<tag>-#### form.')}</p>${preview?.text ? `<pre class="pdetail" dir="ltr">${esc(preview.text)}</pre>` : preview?.error ? `<p class="tiny fail" dir="ltr">${esc(preview.error)}</p>` : ''}
        <label class="small"><input type="checkbox" data-shared-confirm> ${A('فاهم وموافق على التغيير ده', 'I understand and accept this change')}</label> <button type="button" class="btn sm" data-shared-enable disabled>${A('فعّل Shared Project Mode', 'Enable Shared Project Mode')}</button></div>`;
  }
  async function openSharedSheet() {
    let d = document.getElementById('shareddlg');
    if (!d) { d = document.createElement('dialog'); d.id = 'shareddlg'; d.className = 'panel'; document.body.appendChild(d); }
    d.innerHTML = `<p class="small">${A('بيحمّل…', 'Loading…')}</p>`;
    if (!d.open) d.showModal();
    let preview = null;
    try { preview = await api(`/api/p/${pid}/shared/preview`); } catch (err) { preview = { error: why(err) }; }
    d.innerHTML = `<div class="wizform"><h2 style="font-size:18px">Shared Project Mode</h2>${sharedPanel(preview, A('شغّل Shared Project Mode', 'Turn on Shared Project Mode'), A('علشان الشغل اللي بيتعمل على فروع مختلفة ميخدش نفس الرقم.', 'So work created on different branches never gets the same ID.'))}<div class="row"><span class="grow"></span><button type="button" class="btn ghost" data-shared-cancel>${A('إلغاء', 'Cancel')}</button></div></div>`;
  }
  async function enableSharedNow() {
    try {
      await post(`/api/p/${pid}/execution/shared-enable`, JSON.stringify({ confirmed: true }), { 'Content-Type': 'application/json' });
      const fromLanes = document.getElementById('paralleldlg')?.open;
      toast(fromLanes ? A('Shared Project Mode اتفعّل. اعمل commit لـ .yallaflow/ وبعدين ابدأ المسارات.', 'Shared Project Mode is on. Commit .yallaflow/, then start the lanes.') : A('Shared Project Mode اتفعّل. اعمل commit لـ .yallaflow/ علشان الفريق ياخده.', 'Shared Project Mode is on. Commit .yallaflow/ to share it with the team.'));
      if (fromLanes) { openParallelSheet(); return; }
      document.getElementById('shareddlg')?.close();
      document.querySelector('dialog.create [data-shared-hint]')?.replaceChildren();
      await loadProjectOverview();
      render();
    } catch (err) { toast(esc(why(err))); }
  }
  async function openCleanup(homePid, laneId) {
    let d = document.getElementById('cleanupdlg');
    if (!d) { d = document.createElement('dialog'); d.id = 'cleanupdlg'; d.className = 'panel'; document.body.appendChild(d); }
    let info;
    try { info = await api(`/api/p/${homePid}/lanes`); } catch (err) { toast(esc(why(err))); return; }
    const lane = info.lanes.find((l) => l.id === laneId);
    if (!lane) { toast(A('المسار ده مش موجود.', 'This lane no longer exists.')); return; }
    const c = lane.cleanup;
    d.innerHTML = `<form method="dialog" data-cleanup-form data-home="${esc(homePid)}" data-lane="${esc(laneId)}" class="wizform"><h2 style="font-size:18px">${A('تنظيف المسار', 'Clean up lane')} <span class="ltr">${esc(lane.slug)}</span></h2>
      <p class="tiny muted ltr">${esc(lane.path)} · ${esc(lane.branch)}</p>
      ${c.ok ? `<p class="small">${A('الفولدر هيتشال. الفرع', 'The folder will be removed. The branch')} <span class="ltr">${esc(lane.branch)}</span> ${A('هيفضل موجود. سجلات YallaFlow بتاعة المسار هتتنسخ للمشروع الأساسي الأول.', 'stays. The lane’s YallaFlow records are copied into the main project first.')}</p>
        <p class="small"><b>${A('اللي هيتمسح', 'What will be deleted')}:</b> ${c.deletions.length ? c.deletions.map((f) => `<code class="ltr">${esc(f)}</code>`).join(' ') : A('مفيش ملفات متجاهلة', 'no ignored files')}</p>
        <label class="small"><input type="checkbox" name="confirmed" data-cleanup-confirm> ${A('اتأكدت من القايمة دي', 'I checked this list')}</label>`
      : `<p class="small fail">${A('مينفعش ينضف دلوقتي', 'It cannot be cleaned up now')}:</p><ul class="small">${c.blockers.map((b) => `<li${trDir(b, 'message')}>${trHtml(b, 'message')}</li>`).join('')}</ul>`}
      <input type="hidden" name="deletions" value="${esc(JSON.stringify(c.deletions))}">
      <div class="row"><button type="button" class="btn ghost" data-cleanup-cancel>${A('إلغاء', 'Cancel')}</button><span class="grow"></span>${c.ok ? `<button class="btn go" type="submit" data-cleanup-start disabled>${A('نضّف', 'Clean up')}</button>` : ''}</div></form>`;
    if (!d.open) d.showModal();
  }
  async function runCleanup(form) {
    try {
      const result = await post(`/api/p/${form.dataset.home}/execution/lane-cleanup`, JSON.stringify({ laneId: form.dataset.lane, deletions: JSON.parse(form.elements.deletions.value), confirmed: form.elements.confirmed.checked }), { 'Content-Type': 'application/json' });
      document.getElementById('cleanupdlg')?.close();
      toast(A(`المسار اتشال. الفرع ${result.branch} لسه موجود.`, `Lane removed. The branch ${result.branch} stays.`));
      await reloadProjects().catch(() => {});
      await loadExecution();
      render();
    } catch (err) { toast(esc(why(err))); }
  }
  // PF-0112 M3: Review & Merge (S6 review, S9 progress, S10 outcomes) per lane.
  let mergesByHome = {};
  async function loadMerges() {
    const homes = [...new Set((execView?.lanes ?? []).filter((lane) => lane.kind === 'lane' && lane.parent).map((lane) => lane.parent))];
    const next = {};
    for (const home of homes) { try { next[home] = (await api(`/api/p/${home}/merges`)).merges; } catch { next[home] = []; } }
    mergesByHome = next;
  }
  const latestMerge = (lane) => (mergesByHome[lane.parent] ?? []).find((m) => m.lane?.id === lane.laneId) ?? null;
  const STEP_LABEL = {
    revalidate: { ar: 'إعادة فحص اللي وافقت عليه', en: 'Re-check what you approved' }, 'lane-commit': { ar: 'commit في المسار', en: 'Commit in the lane' },
    'merge-commit': { ar: 'تجهيز commit الدمج (في الذاكرة)', en: 'Prepare the merge commit (in memory)' }, 'lane-ff': { ar: 'نقل المسار للدمج', en: 'Move the lane to the merge' },
    checks: { ar: 'تشغيل الفحوص على النتيجة', en: 'Run the checks on the result' }, 'integration-preview': { ar: 'معاينة دمج المعرفة', en: 'Preview knowledge integration' },
    'target-ff': { ar: 'نقل الفرع الأساسي', en: 'Move the main branch' }, 'post-merge': { ar: 'فحص بعد الدمج', en: 'Check after the merge' },
    knowledge: { ar: 'دمج المعرفة', en: 'Integrate knowledge' }, record: { ar: 'تسجيل الدمج', en: 'Record the integration' }, 'knowledge-commit': { ar: 'commit المعرفة', en: 'Knowledge commit' }
  };
  const MERGE_STATE = {
    queued: { ar: 'في الدور', en: 'queued' }, merging: { ar: 'بيدمج…', en: 'merging…' }, merged: { ar: 'اتدمج، لسه بيتحقق', en: 'merged, verifying' },
    verified: { ar: 'MERGED & VERIFIED', en: 'MERGED & VERIFIED' }, blocked: { ar: 'واقف', en: 'blocked' }, failed: { ar: 'فشل', en: 'failed' },
    'needs-approval': { ar: 'محتاج موافقة جديدة', en: 'needs a fresh approval' }, 'merged-not-verified': { ar: 'اتدمج ومش متأكَّد', en: 'merged, not verified' },
    'knowledge-needs-approval': { ar: 'اتدمج · المعرفة محتاجة مراجعة', en: 'merged · knowledge needs review' }, interrupted: { ar: 'اتقطع', en: 'interrupted' }, abandoned: { ar: 'متساب', en: 'abandoned' }
  };
  function mergeBlock(lane) {
    const m = latestMerge(lane);
    const btn = (attr, label, cls = 'ghost') => `<button class="btn sm ${cls}" ${attr}>${label}</button>`;
    const review = btn(`data-review-open="${esc(lane.laneId)}" data-home="${esc(lane.parent)}"`, A('راجع وادمج', 'Review & merge'), 'go');
    if (!m || m.state === 'abandoned') return lane.session ? '' : `<div class="xmerge"><span class="chip"><i></i>${A('مش متدمج', 'Not merged')}</span>${review}</div>`;
    const tone = { verified: 'done', merging: 'active', queued: 'active', merged: 'active', blocked: 'fail', failed: 'fail', 'merged-not-verified': 'fail', 'knowledge-needs-approval': 'you', 'needs-approval': 'you', interrupted: 'paused' }[m.state] ?? '';
    const steps = ['merging', 'queued', 'merged', 'interrupted', 'failed', 'blocked', 'merged-not-verified', 'needs-approval', 'knowledge-needs-approval'].includes(m.state)
      ? `<ol class="xsteps">${m.steps.map((s) => `<li class="${s.state}">${{ done: '✓', running: '●', stopped: '⛔', todo: '○' }[s.state] ?? '○'} ${L(STEP_LABEL[s.name] ?? { ar: esc(s.name), en: esc(s.name) })}</li>`).join('')}</ol>` : '';
    const acts = [
      ['interrupted', 'failed', 'merged-not-verified'].includes(m.state) ? btn(`data-merge-act="continue" data-merge="${esc(m.id)}" data-home="${esc(lane.parent)}"`, A('كمّل الدمج', 'Continue merge'), 'go') : '',
      ['needs-approval', 'blocked'].includes(m.state) ? review : '',
      ['interrupted', 'failed', 'blocked', 'needs-approval', 'merged-not-verified', 'knowledge-needs-approval'].includes(m.state) ? btn(`data-merge-act="abandon" data-merge="${esc(m.id)}" data-home="${esc(lane.parent)}"`, A('سيبه زي ما هو', 'Abandon (change nothing)')) : ''
    ].join('');
    return `<div class="xmerge"><div class="row"><span class="chip ${tone}"><i></i>${L(MERGE_STATE[m.state] ?? { ar: esc(m.state), en: esc(m.state) })}</span>${m.state === 'verified' && m.merge ? `<span class="tiny muted ltr">${esc(m.target ?? '')} @ ${esc(m.merge.slice(0, 7))}</span>` : ''}</div>${steps}${m.reason ? `<p class="tiny"${trDir(m, 'reason')}>${trHtml(m, 'reason')}</p>` : ''}${m.undo ? `<p class="tiny muted ltr">${esc(m.undo)}</p>` : ''}${acts ? `<div class="row">${acts}</div>` : ''}</div>`;
  }
  // Arabic headings for the server's readiness checks (the detail stays as YallaFlow wrote it).
  const READY_AR = { task: 'المهمة', session: 'الوكيل', platform: 'المنصة', signing: 'التوقيع', drivers: 'filters وmerge drivers', config: 'إعدادات Git', busy: 'Git مشغول', target: 'الفرع الأساسي', changes: 'التغييرات', secrets: 'ملفات شكلها أسرار', conflicts: 'التعارضات', unticked: 'ملفات مش متعلّم عليها', ignored: 'ملفات Git متجاهلها', 'checks-safety': 'الدمج الآلي', home: 'ملفاتك في المشروع الأساسي', checks: 'الفحوص' };
  let reviewState = null;
  async function openReview(home, laneId, { exclude = [], include = [], checks = [] } = {}) {
    let d = document.getElementById('reviewdlg');
    if (!d) { d = document.createElement('dialog'); d.id = 'reviewdlg'; d.className = 'panel wide'; document.body.appendChild(d); }
    if (!d.open) { d.innerHTML = `<p class="small">${A('بيجهّز المراجعة… (بيحسب الدمج في الذاكرة من غير ما يلمس ملفاتك)', 'Preparing the review… (computing the merge in memory, without touching your files)')}</p>`; d.showModal(); }
    let r;
    try { r = await api(`/api/p/${home}/lanes/${laneId}/review?exclude=${encodeURIComponent(exclude.join('\n'))}&include=${encodeURIComponent(include.join('\n'))}&checks=${encodeURIComponent(checks.join('\n'))}`); } catch (err) { d.innerHTML = `<p class="small fail">${esc(why(err))}</p><button class="btn ghost" data-review-cancel>${A('قفل', 'Close')}</button>`; return; }
    reviewState = { home, laneId, exclude, include, checks, planHash: r.planHash, ok: r.ok };
    const mark = { ok: '✓', warn: '⚠', block: '✗' };
    // For a non-technical reader: the code first; YallaFlow's own records of the task folded into one line.
    const isRecord = (c) => c.path.startsWith('.yallaflow/');
    const uncommitted = r.changes.filter((c) => !c.committed && !isRecord(c));
    const records = r.changes.filter((c) => !c.committed && isRecord(c));
    // Review H1: a check is shown in full (program path and every argument), never shortened.
    const shown = (argv) => argv.map((part) => (/^[A-Za-z0-9_./=:@%+,-]+$/.test(part) ? part : JSON.stringify(part))).join(' ');
    const agentChecks = r.agentChecks ?? [];
    const committedList = r.changes.filter((c) => c.committed);
    const laneName = r.plan.lane.branch.replace(/^yf\//, '');
    d.innerHTML = `<form method="dialog" data-review-form class="wizform"><h2 style="font-size:18px">${A('مراجعة ودمج', 'Review & merge')}: <span dir="auto">${esc(laneName)}</span> ${lang === 'ar' ? '←' : '→'} <span class="ltr">${esc(r.plan.target.branch ?? '')}</span></h2>
      <p class="small"><b>${A('المهمة', 'Task')}:</b> ${r.plan.workIds.map((id) => `<span class="ltr">${esc(id)}</span>`).join(', ')} · ${A('DONE ✓ · التغييرات لسه متدمجتش', 'DONE ✓ · changes NOT MERGED yet')}</p>
      <h3 class="small">${A('الجاهزية', 'Readiness')}</h3><ul class="checklist small">${r.readiness.map((x) => `<li class="${x.level}">${mark[x.level]} ${lang === 'ar' && READY_AR[x.id] ? `<b>${READY_AR[x.id]}</b> <span class="tiny muted"${trDir(x)}>${trHtml(x)}</span>` : trHtml(x)}</li>`).join('')}</ul>
      ${r.conflicts?.length ? `<div class="panel sub conflictbox"><p class="small"><b>${A('فيه تعارض', 'There is a conflict')}:</b> ${r.conflicts.map((f) => `<code class="ltr">${esc(f)}</code>`).join(' ')}</p><p class="tiny muted">${A('YallaFlow مبيحلش التعارض بنفسه. رجّع المهمة لوكيلها: هيدمج الفرع الأساسي في المسار ويحل التعارض ويتحقق تاني، وبعدها تراجع وتوافق من جديد.', 'YallaFlow never resolves a conflict itself. Send the task back to its agent: it brings the main branch into the lane, resolves, and verifies again; then you review and approve afresh.')}</p><button type="button" class="btn sm go" data-sendback="${esc(laneId)}" data-home="${esc(home)}">${A('رجّعها لوكيلها', 'Send back to its agent')}</button></div>` : ''}
      <h3 class="small">${A('التغييرات', 'Changes')}</h3>
      <ul class="xfiles small">${uncommitted.map((c) => `<li><label><input type="checkbox" data-review-file="${esc(c.path)}" data-secret="${c.secret ? '1' : ''}" ${c.approved ? 'checked' : ''}> <code class="ltr">${esc(c.path)}</code></label>${c.secret ? ` <span class="tiny fail">⚠ ${A('شكله فيه أسرار؛ مش متضاف إلا لو علّمت عليه', 'looks like a secret; not included unless ticked')}</span>` : ''}${c.large ? ` <span class="tiny muted">${A('كبير', 'large')}</span>` : ''}${c.binary ? ` <span class="tiny muted">${A('ثنائي', 'binary')}</span>` : ''}${c.status === 'deleted' ? ` <span class="tiny muted">${A('اتمسح', 'deleted')}</span>` : ''}</li>`).join('') || `<li class="tiny muted">${A('مفيش تغييرات في الكود لسه متحفظتش', 'No unsaved code changes')}</li>`}${records.length ? `<li class="tiny muted">✓ ${A(`سجلات YallaFlow للمهمة (${records.length} ملف) — بتتحفظ مع الكود`, `YallaFlow’s records of the task (${records.length} files) — saved with the code`)}</li>` : ''}</ul>
      ${committedList.length ? `<p class="tiny muted">${A('متعملها commit في المسار بالفعل', 'Already committed in the lane')}: ${committedList.filter((c) => !c.secret).map((c) => `<code class="ltr">${esc(c.path)}</code>`).join(' ')}</p>` : ''}
      ${committedList.filter((c) => c.secret).map((c) => `<p class="small"><label><input type="checkbox" data-review-file="${esc(c.path)}" data-secret="1" ${c.secretAccepted ? 'checked' : ''}> <code class="ltr">${esc(c.path)}</code></label> <span class="tiny fail">⚠ ${A('الوكيل عمله commit وشكله فيه أسرار؛ مش هيتدمج إلا لو علّمت عليه', 'the agent committed it and it looks like a secret; it is not merged unless you tick it')}</span></p>`).join('')}
      ${(r.historySecrets ?? []).map((c) => `<p class="small"><label><input type="checkbox" data-review-file="${esc(c.path)}" data-secret="1" ${c.accepted ? 'checked' : ''}> <code class="ltr">${esc(c.path)}</code></label> <span class="tiny fail">⚠ ${A('commit في المسار ضاف حاجة شكلها سر واتشالت بعدين، بس هتفضل في تاريخ الفرع؛ مش هيتدمج إلا لو علّمت عليه', 'a lane commit added something that looks like a secret and later removed it, but it stays in the branch history; it is not merged unless you tick it')}</span></p>`).join('')}
      ${agentChecks.length ? `<details class="small"><summary>${A('أوامر شغّلها الوكيل في جلسته (YallaFlow مبيشغّلهاش)', 'Commands the agent ran in its own session (YallaFlow does not run them)')}</summary><ul class="xfiles small">${agentChecks.map((c) => `<li><code class="ltr" style="white-space:pre-wrap;word-break:break-all">${esc(c.shown)}</code></li>`).join('')}</ul></details>` : ''}
      ${!r.ok && r.manual?.length ? `<details class="small"${r.readiness.some((x) => x.id === 'checks-safety' && !x.ok) ? ' open' : ''}><summary>${A('ادمج بإيدك', 'Merge by hand')}</summary><p class="tiny muted">${A('أوامر Git عادية تشغّلها انت وتراجع كل خطوة. YallaFlow مبيشغّلش أي حاجة منها.', 'Ordinary Git commands you run, reviewing each step. YallaFlow runs none of them.')}</p><pre class="pdetail" dir="ltr">${r.manual.map(esc).join('\n')}</pre></details>` : ''}
      <h3 class="small">${A('الخطة', 'Plan')}</h3><ol class="small">
        <li>${A('commit في المسار', 'Commit in the lane')}: <code class="ltr">${esc(r.plan.laneMessage.split('\n')[0])}</code></li>
        <li>${A('commit دمج واحد في الذاكرة (من غير ما يلمس أي ملفات)', 'One merge commit, made in memory (no files touched)')}</li>
        <li>${A('تشغيل الفحوص على النتيجة في المسار', 'Run the checks on the result in the lane')}: ${r.plan.checks.map((c) => `<code class="ltr" style="white-space:pre-wrap;word-break:break-all">${esc(shown(c.argv))}</code>`).join(' ') || '—'}</li>
        <li>${A('نقل', 'Fast-forward')} <span class="ltr">${esc(r.plan.target.branch ?? '')}</span> · ${A('فحص · دمج المعرفة · تسجيل · commit المعرفة', 'verify · integrate knowledge · record · knowledge commit')}${r.plan.expectedKnowledge.length ? ` (${r.plan.expectedKnowledge.length})` : ''}</li>
        <li>${A('المسار بيفضل موجود؛ التنظيف خطوة منفصلة', 'The lane stays; Clean up is a separate step')}</li></ol>
      ${r.plan.hooks.length ? `<p class="tiny muted">${A('hooks/CI الخاصة بالمشروع مش هتشتغل مع الـ commit والدمج؛ الفحوص اللي فوق هي اللي هتشتغل.', 'The project’s hooks/CI will not run during the commit and merge; the checks above run instead.')} (${r.plan.hooks.map(esc).join(', ')})</p>` : ''}
      <label class="small"><input type="checkbox" name="confirmed" data-review-confirm ${r.ok ? '' : 'disabled'}> ${A(`موافق على commit لـ ${r.plan.approved.length} ملف في ${esc(r.plan.lane.branch)}، والدمج في ${esc(r.plan.target.branch ?? '')}، وتشغيل الفحوص دي، وتسجيل الدمج (المشروع هيتطلب YallaFlow 1.5.0 أو أحدث)`, `I approve committing ${r.plan.approved.length} file(s) to ${esc(r.plan.lane.branch)}, merging into ${esc(r.plan.target.branch ?? '')}, running these checks, and recording the integration (this project will require YallaFlow 1.5.0 or newer)`)}</label>
      <div class="row"><button type="button" class="btn ghost" data-review-cancel>${A('إلغاء', 'Cancel')}</button><span class="grow"></span><button class="btn go" type="submit" data-review-start disabled>${A('وافق وادمج', 'Approve & merge')}</button></div></form>`;
  }
  async function approveMerge() {
    const s = reviewState;
    try {
      await post(`/api/p/${s.home}/execution/merge-approve`, JSON.stringify({ laneId: s.laneId, planHash: s.planHash, exclude: s.exclude, include: s.include, checksInclude: s.checks, confirmed: true, acceptMinimumVersion: '1.5.0' }), { 'Content-Type': 'application/json' });
      document.getElementById('reviewdlg')?.close();
      await loadExecution(); await loadMerges(); render();
    } catch (err) {
      toast(esc(why(err)));
      if (err.code === 'PLAN_CHANGED') openReview(s.home, s.laneId, { exclude: s.exclude, include: s.include, checks: s.checks });
    }
  }
  async function execAct(projectId, action, body) {
    try {
      await post(`/api/p/${projectId}/execution/${action}`, JSON.stringify(body), { 'Content-Type': 'application/json' });
      scheduleExecution();
    } catch (err) { toast(esc(why(err))); }
  }
  let execTimer = null;
  function scheduleExecution() {
    if (!agentsOn) return;
    clearTimeout(execTimer);
    execTimer = setTimeout(async () => { await loadExecution(); if (route().v === 'agents' || bellOpen) render(); else renderBellCount(); }, 250);
  }
  function renderBellCount() {
    const bell = document.querySelector('[data-bell]');
    if (bell) { const n = snap ? needs().length : 0; bell.innerHTML = `🔔${n ? `<b>${n}</b>` : ''}`; }
  }
  async function loadAgent() {
    if (!agentsOn || !chatCtx()) return;
    try { agent = { pid, ...(await api(`/api/p/${pid}/agent`)) }; agentError = null; } catch (e) { agentError = e.message; }
  }
  function onAgentEvent(projectId, event) {
    if (projectId === pid && route().v === 'setup' && ['session.connected', 'session.disconnected', 'session.started', 'session.ended', 'mode.changed'].includes(event.type)) refreshAgentSetup();
    if (!agent || agent.pid !== projectId) return;
    agent.events.push(event);
    if (agent.events.length > 400) agent.events.splice(0, agent.events.length - 400);
    if (event.type === 'permission.requested') agent.pending.push(event);
    if (event.type === 'permission.resolved') agent.pending = agent.pending.filter((p) => p.requestId !== event.requestId);
    if (event.type === 'session.disconnected' && switchWanted) {
      // PF-0103: Claude Code closed; the chat continues with Codex and a prepared message.
      const it = byId(switchWanted);
      if (it && !agentDraft.trim()) agentDraft = suggestions(it).at(-1) ?? '';
      agentProvider = 'codex';
      switchWanted = null;
    }
    if (['session.started', 'session.ended', 'session.stopped', 'session.connected', 'session.disconnected', 'turn.started', 'turn.ended', 'mode.changed', 'work.activated', 'error'].includes(event.type)) {
      // PF-0106: the board and work list show the agent's call on the item's card.
      loadAgent().then(() => (['map', 'lines'].includes(route().v) ? render() : renderAgent()));
      return;
    }
    if (['permission.requested', 'permission.resolved'].includes(event.type) && ['map', 'lines'].includes(route().v)) { render(); return; }
    renderAgent(event.type === 'message.delta');
  }
  // The chat window body is what scrolls (PF-0070). It follows the newest message unless the
  // reader has scrolled up to read older ones; opening the chat or sending always goes to the end.
  let chatForceEnd = false;
  function chatAtEnd() {
    const body = document.querySelector('#chatwin .chatbody');
    return !body || body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  }
  function toChatEnd() {
    const body = document.querySelector('#chatwin .chatbody');
    if (body) body.scrollTop = body.scrollHeight;
  }
  // Re-render only the panel, keeping the composer text and focus.
  function renderAgent(streamOnly = false) {
    const host = document.getElementById('agent');
    const it = chatCtx();
    if (!host || !it) return;
    const focused = document.activeElement?.matches?.('[data-agent-input]');
    const stick = chatForceEnd || chatAtEnd();
    chatForceEnd = false;
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
    // PF-0095: the window's header status follows the session too (it stayed 'working' before).
    const head = document.querySelector('#chatwin .chatstate');
    if (head && !streamOnly) head.textContent = agentState(it).label;
    if (stick) toChatEnd();
    if (focused && !streamHost) { const box = document.querySelector('[data-agent-input]'); if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); } }
  }
  // PF-0096: while the agent is silent, the working line's minutes still move.
  setInterval(() => {
    const line = document.querySelector('#chatwin [data-working]');
    if (line && agent?.events) line.textContent = workingText(workingInfo(agent.events));
  }, 30000);
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
      else if (ev.type === 'delivery.unconfirmed') out.push({ kind: 'note', warn: true, text: A('Claude Code ما بدأش يشتغل على الرسالة دي، والغالب إنها ما وصلتلوش. لو حسابك Claude Team أو Enterprise، الرسايل من الكونسول بتتجاهل لحد ما admin المؤسسة يفعّل الـ channels. اكتب في ترمينال Claude Code بدلها؛ الكونسول هيفضل يعرض شغله.', ev.detail ?? 'Claude Code did not start on this message.') });
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
  // PF-0112: what the request touches, when the provider names it (files, the command).
  function permScope(p) {
    const cmd = p.command ? `<pre class="pdetail" dir="ltr" style="white-space:pre-wrap;word-break:break-all">$ ${esc(p.command)}</pre>${p.commandCut ? `<p class="tiny fail">${A(`⚠ الأمر أطول من كده بـ ${Number(p.commandCut)} حرف مش ظاهرين. ارفض لو مش متأكد.`, `⚠ The command continues for ${Number(p.commandCut)} more characters not shown. Deny if unsure.`)}</p>` : ''}` : '';
    const files = p.paths?.length ? `<div class="tiny pfiles" dir="ltr">${p.paths.map((f) => `<code>${esc(f)}</code>`).join(' ')}${p.morePaths ? ` <b>+${Number(p.morePaths)}</b>` : ''}</div>` : '';
    return cmd + files;
  }
  function permCard(p) {
    const open = !p.decision;
    const label = { allow: A('اتسمح', 'Allowed'), allow_session: A('اتسمح للجلسة', 'Allowed for this session'), deny: A('اترفض', 'Denied'), elsewhere: A('اتجاوب عليه في Claude Code', 'Answered in Claude Code') }[p.decision] ?? '';
    const by = p.by === 'timeout' ? A('(محدش ردّ، فاترفض تلقائي)', '(no answer, denied automatically)') : p.by && p.by !== 'user' && p.decision !== 'elsewhere' ? `(${esc(p.by)})` : '';
    const sentNote = p.provider === 'claude' && p.decision ? `<span class="tiny muted">${A('Claude Code بيطبّق أول رد يوصله (الكونسول أو الترمينال).', 'Claude Code applies the first answer it receives (console or terminal).')}</span>` : '';
    return `<div class="aperm ${open ? 'open' : ''}"><div class="row"><span class="ptag">${A('إذن للأداة', 'Tool permission')}</span><b class="grow">${esc(p.title)}</b></div>${permScope(p)}${p.detail ? `<pre class="pdetail" dir="ltr">${esc(p.detail)}</pre>` : ''}
      ${open ? `<div class="row">${p.decisions.map((d) => `<button class="btn sm ${d === 'deny' ? 'ghost' : 'go'}" data-agent-perm="${esc(p.requestId)}" data-decision="${d}">${{ allow: A('اسمح مرة', 'Allow once'), allow_session: A('اسمح للجلسة', 'Allow for session'), deny: A('ارفض', 'Deny') }[d]}</button>`).join('')}<span class="tiny muted">${A('لو محدش ردّ هيترفض تلقائي.', 'Unanswered requests are denied automatically.')}</span></div>` : `<div class="tiny ${p.overridden ? 'warn' : 'muted'}">${label} ${by}</div>${sentNote}`}</div>`;
  }
  // The agent chat as a floating window (owner choice, PF-0059): a corner button shows the
  // session state and opens the chat over the page. Open/closed is remembered per browser.
  let chatOpen = store.get('chatOpen', false);
  // PF-0116: an enlarged chat window for following long conversations (remembered per browser).
  let chatWide = store.get('chatWide', false);
  // PF-0106: what the agent waits for from the developer on a work item, seen from any page.
  function agentAttention() {
    if (!agentsOn || agent?.pid !== pid) return null;
    const s = agent.session;
    if (!s?.workId) return null;
    // PF-0110: a finished item asks nothing more, even if its session is still open.
    const held = byId(s.workId);
    if (held && (held.state === 'done' || held.lifecycle?.state === 'closed') && !(agent.pending ?? []).length) return null;
    if ((agent.pending ?? []).length) return { workId: s.workId, kind: 'approval', label: A(`${s.workId}: الوكيل مستني إذنك`, `${s.workId}: the agent needs your approval`) };
    const idle = s.provider === 'codex' ? s.status === 'idle' : s.connected && s.status !== 'working';
    if (idle && agentEntries(agent.events).at(-1)?.kind === 'agent') return { workId: s.workId, kind: 'reply', label: A(`${s.workId}: الوكيل خلّص ومستني ردّك`, `${s.workId}: the agent finished and waits for you`) };
    return null;
  }
  // PF-0108: the agent's relation to one item: working on it, or waiting for the developer.
  function agentOnItem(it) {
    const a = agentAttention();
    if (a && a.workId === it.id) return a.kind;
    const s = agentsOn && agent?.pid === pid ? agent.session : null;
    if (s?.workId === it.id && (s.status === 'working' || (s.provider === 'claude' && s.connected))) return 'working';
    return null;
  }
  const attentionBadge = (it) => { const a = agentAttention(); return a && a.workId === it.id ? `<span class="bdg att ${a.kind}">${a.kind === 'approval' ? '✋' : '💬'} ${a.kind === 'approval' ? A('الوكيل مستني إذنك', 'agent needs approval') : A('الوكيل مستني ردّك', 'agent waits for you')}</span>` : ''; };
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
      <section class="chatwin${chatWide ? ' wide' : ''}" id="chatwin" role="dialog" aria-modal="false" aria-label="${A('الوكيل', 'Agent')}" ${chatOpen ? '' : 'hidden'}>
        <div class="chathead"><b class="grow">${A('الوكيل', 'Agent')} · ${it.project ? A('المشروع', 'Project') : `<span class="ltr">${esc(it.id)}</span>`}</b><span class="tiny muted chatstate">${esc(st.label)}</span><button type="button" class="ibtn sm" data-chat-wide aria-pressed="${chatWide}" aria-label="${chatWide ? A('رجّعها لحجمها', 'Restore size') : A('كبّر الشات', 'Enlarge the chat')}" title="${chatWide ? A('رجّعها لحجمها', 'Restore size') : A('كبّر الشات', 'Enlarge the chat')}">${chatWide ? '⤡' : '⤢'}</button><button type="button" class="ibtn sm" data-chat-toggle aria-label="${A('صغّر', 'Minimize')}">—</button></div>
        <div class="chatbody">${chatOpen ? agentPanel(it) : ''}</div>
      </section>
      ${(() => { const a = agentAttention(); return a && a.workId !== it.id ? `<button type="button" class="chatcall" data-chat-item="${esc(a.workId)}" data-chat-draft="">${a.kind === 'approval' ? '✋' : '💬'} ${esc(a.label)}</button>` : ''; })()}
      <button type="button" class="chatfab ${st.tone}" ${(() => { const a = agentAttention(); return a && a.workId !== it.id ? `data-chat-item="${esc(a.workId)}" data-chat-draft=""` : 'data-chat-toggle'; })()} aria-controls="chatwin" aria-expanded="${chatOpen}" aria-label="${esc(st.label)}" title="${esc(st.label)}"><span aria-hidden="true">${chatOpen ? '✕' : '💬'}</span><i class="dot"></i>${st.badge ? `<b class="badge">${st.badge}</b>` : ''}</button>
    </div>`;
  }
  // Suggested requests for the item's current place in the flow (PF-0059). A suggestion only
  // fills the message box: the developer reads it and sends it, nothing runs on a click.
  function suggestions(it) {
    if (it.project) return [
      A('المشروع وصل لفين، وإيه الخطوة الجاية؟', 'Where does the project stand, and what is next?'),
      A('إيه اللي مستنيني أقرر فيه دلوقتي؟', 'What is waiting for a decision from me right now?'),
      A('أنهي شغلانات واقفة أو متأخرة، وليه؟', 'Which work items are stuck or slow, and why?')
    ];
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
    // PF-0100: follow the real stage. When Core's next action is to move on and nothing blocks,
    // the suggestion is to move on and keep working.
    else if (!it.blocker && /\badvance\b/.test(it.nextAction ?? '')) list.push(it.stage === 'SPECIFICATION' ? A(`كمّل: انقل ${id} لمرحلة الخطة وجهّز خطة التنفيذ للمراجعة.`, `Continue: move ${id} to the plan stage and prepare the implementation plan for my review.`) : it.stage === 'PLAN' ? A(`كمّل: ابدأ تنفيذ ${id} حسب الخطة اللي اعتمدتها.`, `Continue: start implementing ${id} following the approved plan.`) : A(`كمّل: انقل ${id} للمرحلة الجاية واشتغل عليها.`, `Continue: move ${id} to the next stage and work on it.`));
    else if (st === 'decide') list.push(it.stage === 'DESIGN' ? A(`كمّل تصميم ${id} وحضّر المواصفات علشان أراجعها.`, `Continue the design of ${id} and prepare the specification for my review.`) : it.stage === 'PLAN' ? A(`جهّز خطة تنفيذ ${id} علشان أراجعها.`, `Prepare the implementation plan of ${id} for my review.`) : A(`حضّرلي مواصفات ${id} علشان أراجعها.`, `Prepare the specification of ${id} for my review.`));
    else if (st === 'change') list.push(A(`كمّل تنفيذ ${id} وقولّي فاضل إيه.`, `Continue implementing ${id} and tell me what is left.`));
    else if (st === 'verify') list.push(A(`شغّل التحقق لـ ${id} واشرحلي النتيجة.`, `Run the verification for ${id} and explain the result.`));
    else if (st === 'remember') list.push(A(`راجع المعرفة اللي اتعلمناها من ${id} وقفلها.`, `Review what we learned from ${id} and finish it.`));
    return list;
  }
  // PF-0093: the chips read as suggestions (they fill the box; nothing is sent), and after the
  // agent's reply a line says it is the developer's turn.
  // PF-0095: one plain line in the chat says whose turn it is: working, waiting for an
  // approval, or waiting for the developer's reply.
  // PF-0096: how long the agent has worked on this turn, and its last step and when.
  function agoMin(iso) { const t = Date.parse(iso ?? ''); return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 60000)) : null; }
  const mins = (m) => (m < 1 ? A('أقل من دقيقة', 'under a minute') : A(`${m} د`, `${m} min`));
  function workingInfo(events = []) {
    let start = null;
    let last = null;
    for (const ev of events) {
      if (ev.type === 'message.sent') start = ev.at;
      else if (ev.type === 'turn.started' && !start) start = ev.at;
      if (ev.type === 'tool.started' || ev.type === 'tool.updated') last = { at: ev.at, what: ev.title || A('أداة', 'a tool') };
      else if (ev.type === 'message.delta') last = { at: ev.at, what: A('بيكتب الرد', 'writing the reply') };
      else if (ev.type === 'permission.resolved') last = { at: ev.at, what: A('اتردّ على طلب إذن', 'a permission answered') };
      else if (ev.type === 'message.sent') last = { at: ev.at, what: A('استلم رسالتك', 'received your message') };
    }
    return { since: agoMin(start), lastWhat: last?.what ?? null, lastAgo: agoMin(last?.at) };
  }
  function workingText(info) {
    const parts = [A('الوكيل شغّال', 'The agent is working')];
    if (info?.since !== null && info?.since !== undefined) parts[0] += A(` من ${mins(info.since)}`, ` for ${mins(info.since)}`);
    if (info?.lastWhat) parts.push(A(`آخر خطوة: ${info.lastWhat}، ${info.lastAgo < 1 ? 'دلوقتي' : `من ${info.lastAgo} د`}`, `last step: ${info.lastWhat}, ${info.lastAgo < 1 ? 'just now' : `${info.lastAgo} min ago`}`));
    return `⏳ ${parts.join(' · ')}. ${A('مش محتاج منك حاجة؛ استنى لحد ما يرد.', 'Nothing is needed from you; wait for its reply.')}`;
  }
  function turnLine(state, info = null) {
    if (state === 'working') return `<p class="aturn working" role="status" data-working>${esc(workingText(info))}</p>`;
    if (state === 'approval') return `<p class="aturn approval" role="status">✋ ${A('الوكيل مستني إذنك فوق قبل ما يكمّل.', 'The agent is waiting for your approval above before it continues.')}</p>`;
    if (state === 'reply') return `<p class="aturn" role="status">✓ ${A('الوكيل خلّص الجزء ده ومستني ردّك.', 'The agent finished this part and is waiting for your reply.')}</p>`;
    return '';
  }
  // PF-0105: consecutive agent steps read as one line that opens to the details.
  function groupSteps(entries) {
    const out = [];
    for (const e of entries) {
      const last = out.at(-1);
      if (e.kind === 'tool' && last?.kind === 'steps') last.steps.push(e);
      else if (e.kind === 'tool' && last?.kind === 'tool') out[out.length - 1] = { kind: 'steps', steps: [last, e] };
      else out.push(e);
    }
    return out;
  }
  function stepsLine(steps, line) {
    const running = steps.some((x) => x.status !== 'completed' && x.status !== 'failed');
    const failed = steps.filter((x) => x.status === 'failed').length;
    const names = [...new Set(steps.map((x) => String(x.title ?? '').split(/[:\s]/)[0]).filter(Boolean))].slice(0, 3).join('، ');
    return `<details class="atools"><summary><span>${running ? '●' : failed ? '✕' : '✓'}</span> ${A(`${steps.length} خطوات`, `${steps.length} steps`)}${failed ? ` · ${A(`${failed} فشلت`, `${failed} failed`)}` : ''} <span class="tiny muted ltr">${esc(names)}</span></summary>${steps.map(line).join('')}</details>`;
  }
  // PF-0105: the message that starts or continues an item asks for the whole job, stopping only
  // for a decision the developer alone can make.
  function goText(it) {
    return A(`اشتغل على ${it.id} لحد الآخر: صنّفها، افهمها، خطّط، نفّذ، اتحقق، وقفّلها بـ yallaflow finish. ما تقفش علشان تديني تقرير عن الحالة. اقف بس لما تحتاج قرار مقدرش غيري آخده (موافقة على مراجعة، أو سؤال بيزنس مش واضح من المشروع)، واسألني ساعتها.`,
      `Work on ${it.id} to the end: classify it, understand it, plan, implement, verify, and close it with yallaflow finish. Do not stop to give me a status update. Stop only when you need a decision only I can make (approving a review, or a business question the project does not answer), and ask me then.`);
  }
  const goOnText = (it) => A(`كمّل ${it.id} لحد الآخر، واقف بس لو محتاج قرار مني.`, `Continue ${it.id} to the end; stop only if you need a decision from me.`);
  // PF-0105: one action for what is needed from the developer now; other suggestions folded.
  function chatAction(it, turnState) {
    if (it.project || turnState === 'working' || turnState === 'approval') return '';
    const gateName = (g) => (typeof GATE_AR === 'object' && GATE_AR[g] ? L(GATE_AR[g]) : g);
    if (it.waitingFor?.kind === 'review') return `<div class="aaction"><p class="aturn approval" role="status">✋ ${A(`مستني مراجعتك: ${gateName(it.waitingFor.gate)}.`, `Waiting for your review: ${gateName(it.waitingFor.gate)}.`)}</p><button class="btn go" data-gate="${esc(it.waitingFor.gate)}" data-gate-item="${esc(it.id)}">${A(`راجع وقرّر: ${gateName(it.waitingFor.gate)}`, `Review and decide: ${gateName(it.waitingFor.gate)}`)}</button></div>`;
    if (it.waitingFor?.kind === 'question') return `<div class="aaction"><p class="aturn approval" role="status">✋ ${A('الوكيل سألك سؤال ومستني إجابتك.', 'The agent asked you a question and waits for your answer.')}</p><button class="btn go" data-act="answer" data-act-item="${esc(it.id)}">${A('جاوب السؤال', 'Answer the question')}</button></div>`;
    if (turnState === 'reply' && it.state !== 'done') return `<div class="aaction"><button class="btn go" data-agent-continue>${A('كمّل', 'Continue')}</button><span class="tiny muted">${A('بيبعت: «', 'Sends: “')}${esc(goOnText(it))}${A('»', '”')}</span></div>`;
    return '';
  }
  function suggestionChips(it, turnState = null) {
    const action = chatAction(it, turnState === true ? 'reply' : turnState);
    // With an action shown, its own line replaces the generic "waiting for your reply".
    const turn = action && (it.waitingFor || turnState === 'reply') ? '' : turnLine(turnState === true ? 'reply' : turnState || null, turnState === 'working' ? workingInfo(agent?.events) : null);
    return `${turn}${action}<details class="asugg-more"><summary class="tiny muted">${A('اقتراحات تانية', 'Other suggestions')}</summary><div class="asugg" role="group" aria-label="${A('اقتراحات', 'Suggestions')}"><span class="tiny muted">${A('اقتراحات (بتتكتب في الخانة، وانت اللي بتبعت):', 'Suggestions (they fill the box; you send):')}</span>${suggestions(it).map((text) => `<button type="button" class="sugg" data-suggest="${esc(text)}"><span aria-hidden="true">↳</span> ${esc(text)}</button>`).join('')}</div></details>`;
  }
  function useSuggestion(text) {
    agentDraft = text;
    const box = document.querySelector('[data-agent-input]');
    if (box) { box.value = text; box.focus(); box.setSelectionRange(text.length, text.length); }
  }
  // PF-0102: Claude Team/Enterprise accounts drop console messages unless channels are on.
  function claudeWarnings(p) {
    if (!p?.warnings?.length) return '';
    const team = /Team|Enterprise/.exec(p.warnings.join(' '))?.[0] ?? 'Team';
    return `<div class="awarn small" role="note">⚠ ${lang === 'ar' ? `Claude Code متسجّل بحساب Claude ${team}. الرسايل من الكونسول بتوصل لـ Claude Code بس لو admin المؤسسة مفعّل الـ channels، وده مقفول افتراضيًا والرسايل بتتجاهل من غير ما يظهر خطأ. لو مش متفعّل، اكتب في ترمينال Claude Code، والكونسول هيفضل يعرض شغله.` : esc(p.warnings.join(' '))}</div>`;
  }
  // PF-0103: one agent per checkout, switched from the item that needs it. An idle Codex
  // session is ended here; Claude Code closes only in its terminal (unlinking would leave it
  // able to edit files), and the chat continues with Codex once it has disconnected.
  let switchWanted = null; // work item id waiting for Claude Code to close
  function switchHere(it, s) {
    if (readOnly || it.project) return '';
    const codexReady = (agent?.providers ?? []).some((p) => p.id === 'codex' && p.ready);
    // PF-0109: when the other item waits for the developer, say so and lead there.
    const other = s.workId && s.workId !== it.id ? agentAttention() : null;
    if (other && other.workId === s.workId) return `<div class="aswitch"><p class="small"><b>${other.kind === 'approval' ? '✋' : '💬'} ${esc(other.label)}.</b> ${A(`علشان تبدأ ${it.id}، خلّص اللي ${s.workId} مستنياه الأول.`, `To start ${it.id}, first handle what ${s.workId} is waiting for.`)}</p><button class="btn sm go" data-chat-item="${esc(s.workId)}" data-chat-draft="">${A(`افتح ${s.workId}`, `Open ${s.workId}`)}</button></div>`;
    // PF-0110: the session's item is finished: one click ends it, starts Codex here and sends
    // the whole-job message shown on the button.
    const heldItem = s.workId && s.workId !== it.id ? byId(s.workId) : null;
    const heldDone = heldItem && (heldItem.state === 'done' || heldItem.lifecycle?.state === 'closed');
    if (heldDone && s.provider === 'codex' && s.status !== 'working' && !(agent.pending ?? []).length) {
      return `<div class="aswitch"><p class="small">✓ ${A(`${s.workId} خلصت، وجلستها لسه مفتوحة.`, `${s.workId} is finished; its session is still open.`)}</p><button class="btn go" data-agent-switch-start="${esc(it.id)}">${A(`ابدأ ${it.id} بـ Codex`, `Start ${it.id} with Codex`)}</button><span class="tiny muted">${A('بيقفل جلسة', 'Ends the')} ${esc(s.workId)} ${A('، يبدأ جلسة جديدة هنا، ويبعت:', ' session, starts a new one here and sends:')} «${esc(goText(it))}»</span></div>`;
    }
    if (s.provider === 'codex') {
      if (s.status === 'working') return `<div class="aswitch"><p class="small">⏳ ${A(`Codex شغّال دلوقتي على ${s.workId}. استنى لما يخلص، وبعدها تقدر تبدأ ${it.id}.`, `Codex is working on ${s.workId}. Wait for it to finish, then you can start ${it.id}.`)}</p><button class="btn sm ghost" data-chat-item="${esc(s.workId)}" data-chat-draft="">${A(`تابع ${s.workId}`, `Watch ${s.workId}`)}</button></div>`;
      return `<div class="aswitch"><p class="small">${A(`Codex واقف على ${s.workId}. تقدر تقفل جلسته (بتفضل في «الجلسات السابقة» وترجعلها بعدين) وتشتغل على ${it.id} هنا.`, `Codex is idle on ${s.workId}. You can end its session (it stays under earlier sessions to resume later) and work on ${it.id} here.`)}</p><button class="btn sm go" data-agent-switch-end>${A(`اقفل جلسة ${s.workId} واشتغل هنا`, `End the ${s.workId} session and work here`)}</button></div>`;
    }
    if (s.provider === 'claude' && codexReady) {
      if (s.status === 'working') return `<p class="tiny muted">⏳ ${A('Claude Code شغّال دلوقتي. استنى لما يخلص لو عايز تبدّل لـ Codex.', 'Claude Code is working. Wait for it to finish if you want to switch to Codex.')}</p>`;
      if (switchWanted === it.id) return `<div class="aswitch" role="status"><p class="small"><b>${A('مستني Claude Code يتقفل…', 'Waiting for Claude Code to close…')}</b> ${A('اكتب /exit في ترمينال Claude Code. أول ما يتقفل، الشات هنا هيتحوّل لـ Codex ومعاه رسالة أولى جاهزة.', 'Type /exit in the Claude Code terminal. As soon as it closes, this chat switches to Codex with a prepared first message.')}</p><button class="btn sm ghost" data-agent-switch-cancel>${A('إلغاء', 'Cancel')}</button></div>`;
      return `<div class="aswitch"><p class="small">${A(`عايز تشتغل على ${it.id} بـ Codex؟ وكيل واحد بس يشتغل في المشروع، فـ Claude Code لازم يتقفل الأول.`, `Want Codex on ${it.id}? Only one agent works in the project at a time, so Claude Code closes first.`)}</p><button class="btn sm" data-agent-switch-codex="${esc(it.id)}">${A('استخدم Codex للشغلانة دي', 'Use Codex for this item')}</button></div>`;
    }
    return '';
  }
  function toggleChat(force) {
    chatOpen = force ?? !chatOpen;
    store.set('chatOpen', chatOpen);
    chatForceEnd = chatOpen;
    render();
    if (chatOpen) { if (agentsOn && (!agent || agent.pid !== pid)) loadAgent().then(render); else if (!agentsOn && !agentInfo) loadAgentInfo().then(render); document.querySelector('#chatwin [data-agent-input], #chatwin button')?.focus(); }
    else document.querySelector('.chatfab')?.focus();
  }
  // ---------- continuing a stopped work item with another agent (PF-0066) ----------
  // The stop comes from Core's session records and this run's events; the console never
  // switches on its own, and the continue message is prepared, never sent for the developer.
  const STOP_LABEL = {
    usage_limit: { ar: 'وصل لحد الاستخدام في الاشتراك', en: 'reached its subscription usage limit' },
    error: { ar: 'وقف بسبب خطأ', en: 'stopped on an error' },
    crashed: { ar: 'وقف فجأة', en: 'stopped unexpectedly' },
    ended: { ar: 'جلسته اتقفلت', en: 'had its session ended' },
    disconnected: { ar: 'اتفصل', en: 'disconnected' },
    unlinked: { ar: 'اتفصل من YallaFlow', en: 'was unlinked from YallaFlow' }
  };
  const stopText = (reason) => L(STOP_LABEL[reason] ?? STOP_LABEL.error);
  function itemStop(it) {
    const s = agent?.session;
    if (s && s.workId === it.id) {
      // The latest stop of this run counts only if nothing was sent or started after it.
      const last = [...(agent.events ?? [])].reverse().find((e) => ['session.stopped', 'session.started', 'message.sent', 'turn.started', 'session.connected'].includes(e.type));
      if (last?.type === 'session.stopped' && last.stop && (s.provider === 'codex' ? s.status !== 'working' : !s.connected || ['usage_limit', 'error'].includes(last.stop.reason))) return { provider: last.provider ?? s.provider, ...last.stop, live: true };
      return null;
    }
    if (s) return null; // another item's session owns the checkout
    const rec = (agent?.history ?? []).find((h) => h.workId === it.id);
    return rec?.lastStop ? { provider: rec.provider, ...rec.lastStop, live: false } : null;
  }
  function continueText(it, stop) {
    const who = PROVIDER[stop.provider] ?? stop.provider;
    return A(`كمّل ${it.id}. الوكيل اللي قبلك (${who}) ${stopText(stop.reason)}. ابدأ بـ yallaflow handoff ${it.id} وكمّل من حالة الشغلانة المسجّلة.`,
      `Continue ${it.id}. The previous agent (${who}) ${stopText(stop.reason)}. Start with yallaflow handoff ${it.id} and continue from the recorded state of the work item.`);
  }
  function stopCard(it) {
    if (it.project) return '';
    const stop = itemStop(it);
    if (!stop || readOnly) return '';
    const who = PROVIDER[stop.provider] ?? esc(stop.provider);
    const others = (agent?.providers ?? []).filter((p) => p.ready && !(p.id === stop.provider && stop.live && stop.reason === 'usage_limit'));
    const retry = stop.reason === 'usage_limit' ? (stop.retryAt ? A(` تقدر تكمّل معاه تاني بعد ${esc(stop.retryAt)}.`, ` You can continue with it again after ${esc(stop.retryAt)}.`) : A(' تقدر تكمّل معاه تاني لما الحد يرجع.', ' You can continue with it again once the limit resets.')) : '';
    const text = continueText(it, stop);
    return `<div class="astop" role="status"><p class="small"><b>${who} ${esc(stopText(stop.reason))}.</b>${retry} ${A('الشغل محفوظ في الشغلانة، فأي وكيل يقدر يكمّله.', 'The work is saved in the work item, so any agent can continue it.')}</p>
      ${stop.detail && stop.reason !== 'ended' ? `<p class="tiny muted" dir="auto">${esc(stop.detail)}</p>` : ''}
      <div class="row">${others.map((p) => `<button class="btn sm go" data-agent-switch="${esc(p.id)}" ${agentBusy ? 'disabled' : ''}>${A(`كمّل بـ ${PROVIDER[p.id]}`, `Continue with ${PROVIDER[p.id]}`)}</button>`).join('')}<button class="btn sm ghost" data-copy="${esc(text)}">${A('انسخ رسالة التكملة للترمينال', 'Copy the continue message for a terminal')}</button></div>
      <p class="tiny muted">${A('الرسالة بتتجهّز في خانة الكتابة ومش بتتبعت غير لما تدوس ابعت.', 'The message is prepared in the message box and is sent only when you press Send.')}</p></div>`;
  }
  function sessionHistory(it) {
    if (it.project) return '';
    const rows = (agent?.history ?? []).filter((h) => h.workId === it.id).slice(0, 6);
    if (!rows.length) return '';
    const state = (h) => h.lastStop ? stopText(h.lastStop.reason) : h.status === 'running' ? A('شغّالة', 'running') : A('خلصت', 'ended');
    return `<details class="ahist"><summary class="tiny muted">${A('الجلسات على الشغلانة دي', 'Agent sessions on this item')} (${rows.length})</summary><ul class="tiny">${rows.map((h) => `<li><b>${esc(PROVIDER[h.provider] ?? h.provider)}</b> · ${ago(h.startedAt)}${h.endedAt ? ` → ${ago(h.endedAt)}` : ''} · ${esc(state(h))}</li>`).join('')}</ul></details>`;
  }
  async function switchAgent(to, it) {
    const stop = itemStop(it);
    if (!stop) return;
    const s = agent?.session;
    // The old session is ended (Codex) or unlinked (Claude) first: one session per checkout.
    if (s?.provider === 'codex' && !(await agentAction('end', {}))) return;
    if (s?.provider === 'claude' && !(await agentAction('disconnect', {}, () => { agentLaunch = null; }))) return;
    agentProvider = to;
    const ok = to === 'codex'
      ? await agentAction('start', { provider: 'codex', workId: it.id, mode: agentMode })
      : await agentAction('connect', { provider: 'claude', workId: it.id }, (r) => { agentLaunch = r.launch?.command ?? null; });
    if (ok) { agentDraft = continueText(it, stop); renderAgent(); }
  }

  // PF-0069: the picker points to Setup → Agents when an agent is off or not ready here.
  function setupHint() {
    const claudeOff = agentsClaudeAvailable && !(agent?.providers ?? []).some((p) => p.id === 'claude');
    const notReady = (agent?.providers ?? []).some((p) => !p.ready);
    if (!claudeOff && !notReady) return '';
    return `<p class="tiny muted">${claudeOff ? A('Claude Code (تجريبي) مقفول للمشروع ده.', 'Claude Code (experimental) is off for this project.') : A('فيه وكيل مش جاهز.', 'An agent is not ready.')} <a href="#/setup" data-setup-agents>${A('افتح الإعداد ← الوكلاء', 'Open Setup → Agents')}</a></p>`;
  }

  function agentPanel(it) {
    if (!agentsOn) return agentOffPanel(it);
    if (!agent || agent.pid !== pid) return `<section class="panel agent" id="agent"><p class="muted">${A('بيحمّل مساحة الوكيل…', 'Loading the agent workspace…')}</p></section>`;
    const s = agent.session;
    const provider = (id) => agent.providers.find((p) => p.id === id);
    const isActive = !it.project && snap?.project?.activeWork === it.id;
    const activation = it.project ? `<span class="tiny muted">${A('شات المشروع: مش مربوط بشغلانة. أي تعديل الوكيل هيفتحله شغلانة الأول.', 'Project chat: not tied to a work item. The agent routes any change to a work item first.')}</span>` : isActive ? `<span class="chip done"><i></i>${A('الشغلانة النشطة', 'Active work item')}</span>` : `<span class="tiny muted">${A('مش الشغلانة النشطة.', 'Not the active work item.')}</span> <button class="btn sm ghost" data-agent-activate="${esc(it.id)}">${A('خلّيها النشطة', 'Make it active')}</button>`;
    const head = `<div class="ahead"><h2>${A('الوكيل', 'Agent')}</h2><span class="grow"></span>${activation}</div>`;
    const err = agentError ? `<div class="errbar data small">${esc(agentError)}</div>` : '';
    if (!s && agent.lockedBy) return `<section class="panel agent" id="agent">${head}${err}<div class="awarn" role="status">${A('جلسات الوكيل في النسخة دي من المشروع تبع كونسول YallaFlow تاني شغّال. استخدمه، أو اقفله الأول.', 'Agent sessions in this checkout belong to another running YallaFlow console. Use that console, or stop it first.')}</div><p class="tiny muted" dir="ltr">${esc(agent.lockedBy.message)}</p></section>`;
    if (!s || (s.workId && s.workId !== it.id && (s.provider === 'codex' || it.project))) {
      if (s) return `<section class="panel agent" id="agent">${head}${err}<p class="small">${A(`فيه جلسة ${PROVIDER[s.provider]} شغّالة على`, `A ${PROVIDER[s.provider]} session is active for`)} <a href="#/item/${encodeURIComponent(s.workId)}" class="ltr">${esc(s.workId)}</a>. ${A('جلسة واحدة بس في كل نسخة من المشروع.', 'Only one agent session runs per checkout.')}</p>${switchHere(it, s)}</section>`;
      const choice = agentProvider ?? agent.providers.find((p) => p.ready)?.id ?? 'codex';
      const p = provider(choice);
      const picks = agent.providers.map((x) => `<label class="apick ${x.ready ? '' : 'off'}"><input type="radio" name="agentProvider" value="${x.id}" ${x.id === choice ? 'checked' : ''}><span><b>${PROVIDER[x.id]}</b>${x.experimental ? ` <i class="exp">${A('تجريبي', 'experimental')}</i>` : ''}<small>${x.ready ? (x.id === 'codex' ? A('اشتراك ChatGPT بتاعك', 'Your ChatGPT subscription') : A(`اشتراك Claude بتاعك${x.auth?.plan ? ` (${x.auth.plan})` : ''}`, `Your Claude subscription${x.auth?.plan ? ` (${x.auth.plan})` : ''}`)) : A('مش جاهز', 'Not ready')}</small></span></label>`).join('');
      const problems = (p && !p.ready ? `<ul class="aprob">${p.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '') + claudeWarnings(p);
      let action = '';
      if (p?.ready && p.capabilities.start) action = `<div class="row"><label class="small">${A('الصلاحيات', 'Permissions')} <select data-agent-mode>${p.capabilities.modes.map((m) => `<option value="${m}" ${m === agentMode ? 'selected' : ''}>${L(MODE_LABEL[m])}</option>`).join('')}</select></label><span class="grow"></span><button class="btn go" data-agent-start ${agentBusy ? 'disabled' : ''}>${A('ابدأ جلسة Codex', 'Start Codex session')}</button></div>${agent.resumable.length ? `<div class="tiny muted">${A('جلسات سابقة:', 'Earlier sessions:')} ${agent.resumable.map((r) => `<button class="linkbtn" data-agent-resume="${esc(r.id)}">${esc(r.workId ?? '—')} · ${ago(r.startedAt)}</button>`).join(' ')}</div>` : ''}`;
      else if (p?.ready && p.id === 'claude') action = `<div class="row"><span class="small grow">${A('Claude Code بيشتغل في الترمينال بتاعك باشتراكك. YallaFlow بيتوصّل بيه بس، مش بيشغّله.', 'Claude Code runs in your terminal with your subscription. YallaFlow connects to it; it never runs it.')}</span><button class="btn go" data-agent-connect ${agentBusy ? 'disabled' : ''}>${A('وصّل Claude Code', 'Connect Claude Code')}</button></div>`;
      // PF-0072: a prepared message (for example the runtime plan request) waits for a session.
      const waiting = agentDraft.trim() ? `<div class="anote" role="status" data-draft-waiting><b class="small">${A('فيه رسالة جاهزة مستنية', 'A prepared message is waiting')}</b><p class="tiny">${A('ابدأ جلسة أو وصّل Claude Code، وهتلاقيها في خانة الكتابة تراجعها وتبعتها بنفسك. مفيش حاجة اتبعتت.', 'Start a session or connect Claude Code and it will be in the message box for you to review and send. Nothing was sent.')}</p><details><summary class="tiny">${A('اعرض الرسالة', 'Show the message')}</summary><pre class="cli small" dir="ltr" style="white-space:pre-wrap">${esc(agentDraft)}</pre></details></div>` : '';
      return `<section class="panel agent" id="agent">${head}${err}${stopCard(it)}${waiting}<div class="apicks">${picks}</div>${problems}${action}${setupHint()}<p class="tiny muted">${A('الوكيل بيستخدم اشتراكك الموجود بس، من غير مفاتيح API. أذونات الأدوات مش موافقات YallaFlow.', 'Agents use only your existing subscription, never API keys. Tool permissions are not YallaFlow approvals.')}</p></section>`;
    }
    const cap = provider(s.provider)?.capabilities ?? {};
    const modeChip = s.mode ? `<span class="chip ${autoApproves(s.mode) ? 'wait' : 'todo'}" title="${esc(L(MODE_LABEL[s.mode] ?? { ar: esc(s.mode), en: esc(s.mode) }))}">${esc(s.mode)}</span>` : '';
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
    const toolLine = (e) => `<div class="atool ${e.status === 'failed' ? 'fail' : e.status === 'completed' ? 'done' : ''}"><span>${e.status === 'completed' ? '✓' : e.status === 'failed' ? '✕' : '●'}</span> ${esc(e.title)}</div>`;
    const entries = groupSteps(agentEntries(agent.events)).map((e) => e.kind === 'user' ? `<div class="amsg me"><p>${esc(e.text)}</p></div>` : e.kind === 'agent' ? `<div class="amsg richtext">${richText(e.text)}</div>` : e.kind === 'steps' ? stepsLine(e.steps, toolLine) : e.kind === 'tool' ? toolLine(e) : e.kind === 'perm' ? permCard(e) : `<div class="anote ${e.warn ? 'warn' : ''}">${esc(e.text)}</div>`).join('');
    const canSend = cap.send && (s.provider === 'codex' ? s.status === 'idle' : s.connected && !modePending);
    // PF-0105: before the first message on an item, the box holds the whole-job instruction.
    if (canSend && !it.project && it.state !== 'done' && !agentDraft && !agentEntries(agent.events).some((e) => e.kind === 'user')) agentDraft = goText(it);
    const modeHint = modePending ? `<div class="awarn" role="status">${A('Claude Code متوصّل، بس لسه ما بلّغش بوضع الأذونات بتاعه، فالرسايل مش هتتبعت لحد ما يبلّغ. بيبلّغ لما تكتب حاجة في Claude Code أو لما يستخدم أداة.', 'Claude Code is connected but has not reported its permission mode yet, so messages cannot be sent until it does. It reports it when you type in Claude Code or when it uses a tool.')}</div>` : '';
    return `<section class="panel agent" id="agent">${head}${err}
      <div class="abar"><b>${PROVIDER[s.provider]}</b>${s.provider === 'claude' ? ` <i class="exp">${A('تجريبي', 'experimental')}</i>` : ''}<span class="chip active"><i></i>${esc(state)}</span>${s.auth ? `<span class="chip todo">${esc(s.auth)}</span>` : ''}${modeChip}<span class="grow"></span>${controls}</div>
      ${!it.project && !s.workId ? `<p class="tiny muted">${A('دي جلسة شات المشروع، مش مربوطة بالشغلانة دي.', 'This is the project chat session; it is not tied to this work item.')}</p>` : ''}${s.provider === 'claude' && !it.project ? switchHere(it, s) : ''}${warn}${modeHint}${stopCard(it)}${launch}
      <div class="astream" aria-live="polite">${entries || `<p class="tiny muted">${it.project ? A('اسأل الوكيل عن المشروع، مثلاً: «إيه اللي مستنيني؟».', 'Ask the agent about the project, for example: "What is waiting for me?".') : A(`اكتب للوكيل، مثلاً: «كمّل ${it.id}».`, `Message the agent, for example: "Continue ${it.id}".`)}</p>`}</div>
      ${sessionHistory(it)}${suggestionChips(it, (agent.pending ?? []).length ? 'approval' : s.status === 'working' ? 'working' : canSend && agentEntries(agent.events).at(-1)?.kind === 'agent' ? 'reply' : null)}<form class="acompose" data-agent-form><textarea data-agent-input rows="2" maxlength="20000" placeholder="${A(`اكتب لـ ${PROVIDER[s.provider]}…`, `Message ${PROVIDER[s.provider]}…`)}" ${canSend ? '' : 'disabled'}>${esc(agentDraft)}</textarea><button class="btn go" type="submit" ${canSend && !agentBusy ? '' : 'disabled'}>${A('ابعت', 'Send')}</button></form>
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
    activate: { ar: 'خلّيها النشطة', en: 'Make it active' }, advance: { ar: 'انقلها للمرحلة الجاية', en: 'Move to the next stage' },
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
    // PF-0092: the main actions stay visible; editing, holding and closing sit under «More».
    const SECONDARY = ['revise', 'hold', 'close'];
    const button = (a) => {
      const off = a === 'advance' && blocked;
      return `<button class="btn sm ${a === 'close' ? 'ghost danger' : 'ghost'}" data-act="${a}" data-act-item="${esc(it.id)}" ${off ? `aria-disabled="true" title="${esc(it.blocker)}"` : ''}>${L(ACTION_LABEL[a])}</button>`;
    };
    // PF-0093: moving the stage only works once the current stage's work is recorded, so the
    // button is hidden until then; the why line says, in words, whose turn it is.
    const main = acts.filter((a) => (!SECONDARY.includes(a) || it.lifecycle) && !(a === 'advance' && blocked));
    const more = acts.filter((a) => SECONDARY.includes(a) && !it.lifecycle);
    return `<section class="actbar" aria-label="${A('أفعال الشغلانة', 'Work item actions')}">${gate}${main.map(button).join('')}${more.length ? `<details class="actmore"><summary class="btn sm ghost">⋯ ${A('المزيد', 'More')}</summary><div class="actmenu">${more.map(button).join('')}</div></details>` : ''}${blocked && blockerText(it.blocker) !== nowText(it) ? `<p class="tiny muted why">${A('ليه لسه في المرحلة دي:', 'Why it is still at this stage:')} ${iso(blockerText(it.blocker))}${lang === 'ar' ? '' : it.nextAction ? ` · <span class="ltr">${esc(it.nextAction)}</span>` : ''}</p>` : ''}${it.lifecycle ? `<p class="tiny muted why">${esc(it.blocker ?? '')}</p>` : ''}</section>`;
  }

  // One dialog for every action; fields follow the action. Core's refusal is shown as-is.
  function actionFields(kind, it, request = '') {
    const area = (name, label, required = true) => `<label class="fld">${label}<textarea name="${name}" rows="3" maxlength="10000" ${required ? 'required' : ''}></textarea></label>`;
    if (kind === 'hold') return area('reason', A('السبب', 'Reason'));
    if (kind === 'resume') return area('note', A('ملاحظة (اختياري)', 'Note (optional)'), false);
    if (kind === 'revise') return `<p class="small muted">${A('تقدر تعدّل الطلب طالما الشغل لسه ما بدأش. النسخة القديمة والمرفقات هيفضلوا محفوظين.', 'You can edit the request until work starts. Previous versions and attachments are kept.')}</p><label class="fld">${A('الطلب بعد التعديل', 'Revised request')}<textarea name="text" rows="6" maxlength="20000" required>${esc(request)}</textarea></label>${area('reason', A('السبب', 'Reason'))}${attachmentFields()}`;
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
      initRequestFiles(d.querySelector('form'));
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
    if (form.dataset.busy) return;
    const projectId = pid;
    const kind = form.dataset.actForm;
    const id = form.dataset.actItem;
    const body = {};
    for (const field of form.querySelectorAll('[name]')) if (field.value.trim()) body[field.name] = field.value.trim();
    if (form.querySelector('[name="confirmMinimumVersion"]')?.checked) body.confirmMinimumVersion = true;
    const err = form.querySelector('.errbar');
    err.hidden = true;
    requestBusy(form, true);
    try {
      const serialized = JSON.stringify(body);
      if (kind !== 'revise' || form._savedRevision !== serialized) {
        await post(`/api/p/${projectId}/work/${encodeURIComponent(id)}/actions/${kind}`, serialized, { 'Content-Type': 'application/json' });
        if (kind === 'revise') form._savedRevision = serialized;
      }
      if (kind === 'revise' && !await uploadRevisionFiles(form, projectId, id)) {
        err.hidden = false;
        err.textContent = A('نص الطلب اتحفظ، لكن بعض المرفقات ماترفعتش. جرّب الحفظ تاني لإعادة رفعها، أو احذفها.', 'The request text was saved, but some attachments failed. Save again to retry them, or remove them.');
        return;
      }
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
      requestBusy(form, false);
      if (kind === 'revise' && fileQueues.has(form)) renderPendingFiles(form);
    }
  }

  // ---------- review-gate decisions (Option B): a local-user decision, identity not verified ----------
  // PF-0097: gate names and the delivery status of criteria in plain words.
  const GATE_AR = { specification: { ar: 'المواصفات', en: 'specification' }, plan: { ar: 'خطة التنفيذ', en: 'plan' }, decomposition: { ar: 'تقسيم الشغل', en: 'decomposition' }, design: { ar: 'التصميم', en: 'design' }, discovery: { ar: 'الاكتشاف', en: 'discovery' }, clarification: { ar: 'توضيح المتطلبات', en: 'clarification' }, implementation: { ar: 'التنفيذ', en: 'implementation' }, verification: { ar: 'التحقق', en: 'verification' } };
  const CONV_AR = { satisfied: { ar: 'متحقق', en: 'satisfied', tone: 'done' }, partial: { ar: 'جزئي', en: 'partial', tone: 'wait' }, missing: { ar: 'ناقص', en: 'missing', tone: 'fail' }, contradicts: { ar: 'بيعارض المطلوب', en: 'contradicts', tone: 'fail' } };
  // PF-0097: the standard section headings of YallaFlow's work.md template, in Arabic.
  const HEADING_AR = { 'Specification': 'المواصفات', 'Design': 'التصميم', 'Implementation Plan': 'خطة التنفيذ', 'Goal and Scope': 'الهدف والنطاق', 'Actors and Permissions': 'المستخدمين والصلاحيات', 'Functional Requirements and Business Rules': 'المتطلبات وقواعد العمل', 'Workflows and Lifecycle': 'سير العمل', 'Data and Integrations': 'البيانات والتكاملات', 'Validation and Error Behavior': 'التحقق والأخطاء', 'Security and Privacy': 'الأمان والخصوصية', 'UI / Screens': 'الشاشات', 'Acceptance Criteria': 'معايير القبول', 'Unresolved Items': 'نقاط لسه مفتوحة', 'Architecture / Technical Decisions': 'المعمارية والقرارات التقنية', 'Discovery': 'الاكتشاف', 'Decisions / Rulings': 'القرارات', 'Verification Evidence': 'أدلة التحقق' };
  const headingAr = (h) => (lang === 'ar' && HEADING_AR[String(h).trim()]) || h;
  const gateMaterial = (text) => (lang === 'ar' ? String(text ?? '').replace(/^(#{1,6})\s+(.+)$/gm, (all, hashes, h) => `${hashes} ${headingAr(h)}`) : text);
  async function openGate(id, gate) {
    if (readOnly) return;
    document.querySelector('dialog.act')?.remove();
    const d = document.createElement('dialog');
    d.className = 'create act gate';
    if (store.get('gateWide', false)) d.classList.add('full');
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
      <div class="row gatehead"><h2 id="gate-h" class="grow">${A('راجع وقرّر', 'Review and decide')}: ${esc(L(GATE_AR[gate] ?? { ar: esc(gate), en: esc(gate) }))} <span class="ltr tiny muted">${esc(gate)}</span></h2><button type="button" class="btn ghost sm" data-gate-wide aria-pressed="${d.classList.contains('full')}">${d.classList.contains('full') ? A('⤡ صغّر', '⤡ Smaller') : A('⤢ كبّر', '⤢ Expand')}</button><button type="button" class="btn ghost sm" data-act-cancel>${A('إلغاء', 'Cancel')}</button></div>
      <p class="tiny muted"><span class="ltr">${esc(id)}</span> — ${esc(m.title)}</p>
      ${m.warnings.length ? `<div class="awarn small">${m.warnings.map((w) => `⚠ ${esc(w)}`).join('<br>')}</div>` : ''}
      <div class="gbody"><div class="gmain">
      ${m.sections.length > 1 ? `<nav class="gtoc small" aria-label="${A('المحتوى', 'Contents')}">${m.sections.map((s, i) => `<a href="#gsec-${i}" data-gate-jump="gsec-${i}">${esc(headingAr(s.heading))}</a>`).join('')}${m.criteria.length ? `<a href="#gsec-ac" data-gate-jump="gsec-ac">${A('معايير القبول', 'Acceptance criteria')}</a>` : ''}</nav>` : ''}
      ${m.sections.map((s, i) => `<section class="gsec" id="gsec-${i}"><h3>${esc(headingAr(s.heading))}</h3><div class="richtext gtext">${richText(gateMaterial(s.text))}</div></section>`).join('') || `<p class="muted small">${A('مفيش نص مكتوب للمرحلة دي في الشغلانة.', 'No written material for this gate in the work item.')}</p>`}
      ${m.criteria.length ? `<section class="gsec" id="gsec-ac"><h3>${A('معايير القبول', 'Acceptance criteria')} <span class="tiny muted">(${m.criteria.length})</span></h3><ol class="gcrit small">${m.criteria.map((c) => `<li><b class="ltr">${esc(c.id)}</b> <span dir="auto">${esc(c.statement)}</span>${CONV_AR[c.convergence] ? ` <span class="chip ${CONV_AR[c.convergence].tone}">${L(CONV_AR[c.convergence])}</span>` : ''}</li>`).join('')}</ol></section>` : ''}
      ${m.verification ? `<p class="small">${A('آخر تحقق', 'Latest verification')}: <span class="ltr">${esc(m.verification.id)}</span> ${m.verification.success ? A('نجح', 'passed') : A('فشل', 'failed')}</p>` : ''}
      </div><aside class="gside" aria-label="${A('القرار', 'Decision')}">
      <fieldset class="fld"><legend>${A('القرار', 'Decision')}</legend><label class="small"><input type="radio" name="decision" value="approve" checked> ${A('موافقة', 'Approve')}</label> <label class="small"><input type="radio" name="decision" value="request_changes"> ${A('محتاج تعديلات', 'Request changes')}</label></fieldset>
      <label class="fld">${A('ملاحظة القرار (مطلوبة)', 'Decision note (required)')}<textarea name="note" rows="3" maxlength="10000" required></textarea></label>
      <div class="row gnotes"><span class="tiny muted">${A('ملاحظة سريعة:', 'Quick note:')}</span><button type="button" class="sugg" data-gate-note="${esc(A(`موافق على ${L(GATE_AR[gate] ?? { ar: esc(gate), en: esc(gate) })} زي ما هي.`, `I approve the ${gate} as written.`))}">${A('موافق زي ما هي', 'Approve as written')}</button><button type="button" class="sugg" data-gate-note="${esc(A('محتاج تعديل: ', 'Changes needed: '))}" data-gate-changes>${A('محتاج تعديل…', 'Changes needed…')}</button></div>
      <label class="small optin"><input type="checkbox" name="confirmed"> <b>${A(`راجعت ${L(GATE_AR[gate] ?? { ar: esc(gate), en: esc(gate) })}، والقرار ده قراري أنا`, `I reviewed the ${gate}, and this is my decision`)}</b></label>
      <p class="tiny muted">${A('هيتسجّل كقرار من الكونسول: الهوية مش متحقق منها. ده قرار مستخدم محلي، مش توقيع موثّق.', 'Recorded as a console decision: identity not verified. This is a local-user decision, not a verified signature.')}</p>
      <div class="errbar small" role="alert" hidden></div>
      <div class="row"><span class="grow"></span><button class="btn go" type="submit" disabled>${A('سجّل القرار', 'Record decision')}</button></div></aside></div></form>`;
    // PF-0097: open at the top, on the material, not on the note at the bottom.
    d.scrollTop = 0;
    d.querySelector('#gate-h')?.setAttribute('tabindex', '-1');
    d.querySelector('#gate-h')?.focus({ preventScroll: true });
  }
  function gateReady(form) {
    const ok = form.querySelector('[name="confirmed"]').checked && form.querySelector('[name="note"]').value.trim();
    form.querySelector('button[type="submit"]').disabled = !ok;
  }
  async function submitGate(form) {
    const err = form.querySelector('.errbar');
    err.hidden = true;
    const body = { gate: form.dataset.gateName, decision: form.querySelector('[name="decision"]:checked').value, note: form.querySelector('[name="note"]').value, confirmed: form.querySelector('[name="confirmed"]').checked, requestedAt: form.dataset.requested || null, digest: form.dataset.digest, requestId: form.dataset.request };
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await post(`/api/p/${pid}/work/${encodeURIComponent(form.dataset.gateItem)}/gates/${encodeURIComponent(form.dataset.gateName)}/decision`, JSON.stringify(body), { 'Content-Type': 'application/json' });
      form.closest('dialog').close();
      toast(`✓ ${A('اتسجّل القرار (من الكونسول، الهوية مش متحقق منها)', 'Decision recorded (console, identity not verified)')}`);
      await refresh();
      // PF-0100: the agent ended its turn before this decision; open the chat with a ready
      // message so the developer tells it to go on. Nothing is sent until they press Send.
      if (agentsOn && !readOnly) {
        const gateName = L(GATE_AR[body.gate] ?? { ar: esc(body.gate), en: esc(body.gate) });
        agentDraft = body.decision === 'approve'
          ? A(`اعتمدت ${gateName}. كمّل لحد الآخر، واقف بس لو محتاج قرار مني.`, `I approved the ${body.gate}. Continue to the end; stop only if you need a decision from me.`)
          : A(`طلبت تعديلات في ${gateName}: ${body.note.trim()}\nعدّلها وارجعلي للمراجعة.`, `I requested changes to the ${body.gate}: ${body.note.trim()}\nRevise it and bring it back for review.`);
        toggleChat(true);
        const box = document.querySelector('[data-agent-input]');
        if (box) { box.value = agentDraft; box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
      }
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
    return `<section class="nextcard ${it.state}"><div class="grow"><span class="tiny muted">${A('الخطوة الجاية', 'Next step')} · ${who}</span><p class="nextline">${iso(nowText(it))}</p>${agentsOn && !readOnly && !it.lifecycle ? `<div class="row" style="margin-top:8px"><button class="btn go sm" data-chat-item="${esc(it.id)}">💬 ${A('كمّل مع الوكيل هنا', 'Continue with the agent here')}</button><span class="tiny muted">${A('أو من الترمينال:', 'or in a terminal:')} <b dir="ltr">continue ${esc(it.id)}</b></span></div>` : `<p class="tiny muted">${A('كمّل من Claude Code أو Codex: قول للوكيل', 'Continue in Claude Code or Codex: ask your agent to')} <b dir="ltr">continue ${esc(it.id)}</b></p>`}${it.blocker && !it.waitingFor && nowText(it) !== blockerText(it.blocker) ? `<p class="tiny muted">${A('العائق حسب YallaFlow:', 'Blocker per YallaFlow:')} ${iso(it.blocker)}</p>` : ''}</div><button class="btn ghost sm" data-dev>${A('الأمر', 'Command')}</button></section>`;
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

  // PF-0113: a work ID beside its title. The title leads; the canonical ID is shown whole and
  // never shortened into a second identifier — only clipped by width, with the full ID on hover.
  function wid(id) { return `<span class="ltr wid" title="${esc(id)}">${esc(id)}</span>`; }
  // PF-0123: copying says "copied" only after the browser confirms it. Order: the Clipboard API
  // (called inside the click, as Safari requires), then a selection copy, then a dialog with the
  // text selected so the developer copies it with the keyboard. `what` picks the message.
  function selectionCopy(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;inset-block-start:0;inset-inline-start:0;opacity:0;pointer-events:none';
    document.body.appendChild(area);
    const focused = document.activeElement;
    area.select();
    area.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    focused?.focus?.({ preventScroll: true });
    return ok;
  }
  function manualCopy(text) {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    document.getElementById('copydlg')?.remove();
    const d = document.createElement('dialog');
    d.id = 'copydlg';
    d.className = 'panel copydlg';
    d.setAttribute('aria-labelledby', 'copydlg-h');
    d.innerHTML = `<h2 id="copydlg-h" class="tw:text-lg tw:font-semibold">${A('مقدرناش ننسخ تلقائياً', 'Could not copy automatically')}</h2>
      <p class="small muted tw:mt-1">${A(`النص متحدد تحت — دوس ${mac ? '⌘C' : 'Ctrl+C'} عشان تنسخه.`, `The text is selected below — press ${mac ? '⌘C' : 'Ctrl+C'} to copy it.`)}</p>
      <textarea class="ltr copyarea" readonly rows="${Math.min(6, Math.max(2, text.split('\n').length))}">${esc(text)}</textarea>
      <div class="row end tw:mt-3"><button type="button" class="btn sm go" data-copydlg-close>${A('تمام', 'Done')}</button></div>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => d.remove());
    d.querySelector('[data-copydlg-close]').addEventListener('click', () => d.close());
    d.showModal();
    const area = d.querySelector('textarea');
    area.focus();
    area.select();
  }
  function copy(text, what = 'command') {
    const done = () => toast(what === 'id' ? A('اتنسخ رقم الشغلانة ✓', 'Work ID copied ✓') : what === 'text' ? A('اتنسخ ✓', 'Copied ✓') : A('اتنسخ الأمر ✓ شغّله في الترمينال أو ادّيه للوكيل.', 'Command copied ✓ Run it in your terminal or give it to your agent.'));
    const fallback = () => { if (selectionCopy(text)) done(); else manualCopy(text); };
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      let promise;
      try { promise = navigator.clipboard.writeText(text); } catch { promise = Promise.reject(); }
      promise.then(done, fallback);
    } else fallback();
  }
  function toast(html) { document.querySelector('.toast')?.remove(); const el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); el.innerHTML = html; document.body.appendChild(el); setTimeout(() => el.remove(), 4200); }
  function celebrate() { if (reduced) return; const c = document.createElement('div'); c.className = 'celebrate'; const cols = ['#3d8bfd', '#8a63e8', '#0fae9d', '#f1a131', '#1d9a5a']; c.innerHTML = Array.from({ length: 40 }, (_, k) => `<i style="left:${Math.random() * 100}%;background:${cols[k % 5]};animation-delay:${Math.random() * 0.4}s"></i>`).join(''); document.body.appendChild(c); setTimeout(() => c.remove(), 2200); }

  // ---------- attention: what needs a person (from Core's state; nothing is inferred) ----------
  const needs = () => [...(agent?.pid === pid ? agent.pending.map((p) => ({ it: byId(route().id) ?? { id: '', title: '' }, agentPerm: true, reason: A(`إذن للوكيل: ${p.title}`, `Agent permission: ${p.title}`) })) : []), ...(execView?.inbox ?? []).filter((p) => p.project !== pid || agent?.pid !== pid).map((p) => ({ it: { id: p.workId ?? '', title: p.name ?? '' }, agentPerm: true, elsewhere: true, reason: A(`إذن للوكيل: ${p.title}`, `Agent permission: ${p.title}`) })), ...items().filter((it) => it.state === 'you' || it.state === 'fail').map((it) => ({
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
      <ul>${list.map(({ it, reason, elsewhere }) => `<li class="unread"><span class="dg-ic">${it.state === 'fail' ? '✕' : '◆'}</span><a href="${elsewhere ? '#/agents' : `#/item/${encodeURIComponent(it.id)}`}"><span class="ltr">${esc(it.id)}</span> ${esc(it.title)}<br><span class="tiny muted">${esc(reason)}</span></a></li>`).join('') || `<li class="muted">${A('مفيش حاجة مستنياك دلوقتي.', 'Nothing needs you right now.')}</li>`}</ul>
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
  // PF-0113: where this checkout stands — branch, Shared Project Mode, integration branch.
  // PF-0118: shown as a card that says, in plain words, what team mode means and what to do.
  function gitLine(g) {
    if (!g) return '';
    const branch = g.branch ? `<span class="ltr" data-git-branch>⑂ ${esc(g.branch)}</span>` : `<span class="muted">${A('مش على فرع (detached HEAD أو مفيش Git)', 'Not on a branch (detached HEAD or no Git)')}</span>`;
    const mode = `<span class="chip ${g.sharedMode ? 'done' : ''}" data-shared-mode="${g.sharedMode ? 'on' : 'off'}"><i></i>${g.sharedMode ? A('شغّال', 'On') : A('مقفول', 'Off')}</span>`;
    const integration = g.integrationBranch ? `<span>${A('فرع الدمج', 'Integration branch')}: <span class="ltr">${esc(g.integrationBranch)}</span>${g.integrationBranchSource === 'detected' ? ` <span class="tiny muted">(${A('من إعدادات Git', 'from Git settings')})</span>` : ''}</span>` : '';
    const what = g.sharedMode
      ? A('أرقام الشغل مبتتكررش بين الفروع، ومعرفة المشروع بتتجمّع على فرع الدمج لما الشغل يتدمج.', 'Work IDs never collide across branches, and project knowledge is combined on the integration branch when work is merged.')
      : A('كل نسخة من المشروع بترقّم الشغل لوحدها. لو زمايلك شغالين على فروع تانية، الأرقام ممكن تتكرر ومعرفة المشروع متتجمّعش.', 'Each checkout numbers its work on its own. When teammates work on other branches, work IDs can collide and project knowledge is not combined.');
    const action = g.canEnableShared && !readOnly
      ? `<div class="row teamact"><button type="button" class="btn sm go" data-shared-open>${A('شغّل شغل الفريق…', 'Turn on team mode…')}</button><span class="tiny muted">${A('هتشوف اللي هيتغيّر وتأكد قبل أي حاجة.', 'You see what changes and confirm before anything happens.')}</span></div>`
      : !g.sharedMode && !g.lane ? `<p class="tiny muted teamact">${A('شغّله بـ', 'Turn it on with')} <code class="ltr">yallaflow shared enable</code></p>` : '';
    return `<section class="teamcard ${g.sharedMode ? 'on' : ''}" data-git-line>
      <div class="teamhead"><span class="teamicon" aria-hidden="true">👥</span><div class="grow"><b>${A('شغل الفريق', 'Team mode')} <span class="tiny muted ltr">Shared Project Mode</span></b><p class="small muted">${what}</p></div>${mode}</div>
      <div class="teamfacts small"><span>${A('الفرع الحالي', 'Current branch')}: ${branch}</span>${integration}</div>
      ${action}
    </section>`;
  }
  // New work on a feature branch without Shared Project Mode: recommend it. Only when the
  // integration branch is known — never a comparison against a guessed "main".
  function sharedHint() {
    const g = projectOverview?.pid === pid ? projectOverview.data?.git : null;
    if (!g || g.sharedMode || g.lane || !g.branch || !g.integrationBranch || g.branch === g.integrationBranch) return '';
    return `<div class="awarn" role="note"><p class="small">${A(`انت على <span class="ltr">${esc(g.branch)}</span> مش على فرع الدمج <span class="ltr">${esc(g.integrationBranch)}</span>. من غير Shared Project Mode، الشغلانة اللي تتعمل هنا ممكن تاخد نفس رقم شغلانة زميلك على فرع تاني.`, `You are on <span class="ltr">${esc(g.branch)}</span>, not the integration branch <span class="ltr">${esc(g.integrationBranch)}</span>. Without Shared Project Mode, work created here can get the same ID as a teammate's on another branch.`)}</p>${g.canEnableShared && !readOnly ? `<button type="button" class="btn sm ghost" data-shared-open>${A('شغّل Shared Project Mode…', 'Turn on Shared Project Mode…')}</button>` : `<p class="tiny">${A('شغّله بـ', 'Turn it on with')} <code class="ltr">yallaflow shared enable</code></p>`}</div>`;
  }
  function viewOverview() {
    if (!projectOverview || projectOverview.pid !== pid) return `<p class="muted" style="margin-top:30px">${A('بيقرا المشروع…', 'Reading the project…')}</p>`;
    if (projectOverview.error) return `<section class="errbar data" role="alert"><b>${A('مقدرناش نقرا نظرة المشروع', 'The project overview could not be read')}</b><p class="small">${esc(projectOverview.error)}</p></section>`;
    const o = projectOverview.data;
    if (o.project.kind === 'greenfield' && !(o.memory?.current > 0)) return readinessCard() + gitLine(o.git) + greenfieldOverview(o);
    const m = o.memory;
    const facts = (area) => (o.areas[area]?.facts ?? []);
    const factList = (area, empty) => {
      const list = facts(area);
      if (!list.length) return `<p class="small muted">${empty}</p>`;
      const more = (o.areas[area].total ?? 0) - list.length;
      const item = (f) => {
        const summary = String(f.summary ?? '');
        const preview = summary.replace(/\s+/g, ' ').slice(0, 180);
        const text = `<div class="richtext small">${richText(summary)}</div>`;
        return `<li>${summary.length > 220 ? disclosure(`${pid}:${f.id}`, `<span class="fact-preview" dir="auto">${esc(preview)}…</span>`, text, 'fact-detail') : text}<div class="fact-meta tiny muted"><span class="ltr">${esc(f.id)}</span> · ${esc(f.confidence ?? '')} · <span class="fresh-${esc(f.freshness)}">${L(FRESH_TEXT[f.freshness] ?? FRESH_TEXT.unknown)}</span>${f.state === 'disputed' ? ` · <b>${A('عليه خلاف', 'disputed')}</b>` : ''}</div></li>`;
      };
      return `<ul class="facts">${list.slice(0, 3).map(item).join('')}</ul>${list.length > 3 ? disclosure(`${pid}:${area}`, `<span>${A(`${list.length - 3} حقائق إضافية`, `${list.length - 3} more facts`)}</span>`, `<ul class="facts">${list.slice(3).map(item).join('')}</ul>`, 'area-more') : ''}${more > 0 ? `<p class="tiny muted">${A(`و ${more} كمان في ذاكرة المشروع.`, `+${more} more in project memory.`)}</p>` : ''}`;
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
    return readinessCard() + gitLine(o.git) + `<section class="pagehead"><h1 style="font-size:26px">${esc(o.project.name)}</h1><p class="muted">${A('نظرة على المشروع: إيه هو، معمول بإيه، وفهمه متسجّل لحد فين. القراءة بس — مفيش حاجة بتتغيّر من هنا.', 'The project at a glance: what it is, what it is built with, and how far its understanding is recorded. Read-only — nothing changes from here.')}</p></section>
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
    const start = startHere(first, services);
    const stack = main.length ? `<section class="panel wide"><h2>${A('اللي في الكود دلوقتي', 'What the code declares now')}</h2><p class="small">${main.map((e) => `<span class="tag">${esc(e.component)}${e.declared ? ` <span class="ltr">${esc(e.declared)}</span>` : ''}</span>`).join(' ')}</p><p class="tiny muted">${A('من ملفات المشروع؛ الكود المتولّد لسه ماتراجعش.', 'From the project files; generated code is not reviewed yet.')}</p></section>` : '';
    return `<section class="pagehead"><h1 style="font-size:26px">${esc(o.project.name)}</h1><p class="muted">${A('مشروع جديد. ده اللي اتعمل وده اللي فاضل — مفيش حاجة ناقصة هنا تعتبر خطأ.', 'A new project. This is what was created and what remains — nothing missing here is an error.')}</p></section>
      ${start}<section class="panel"><h2>${A('تجهيز المشروع', 'Project setup')}</h2><ol class="checklist">${checklist}</ol></section>
      <div class="ovgrid" style="margin-top:16px">${firstCard}${stack}</div>
      <p class="tiny muted" style="margin-top:12px">${A('المعمارية والوحدات وذاكرة المشروع بتظهر هنا لما تتسجّل بأدلة.', 'Architecture, modules and project memory appear here once they are recorded with evidence.')}</p>`;
  }
  // PF-0091: one clear next step for a new project, with one primary button.
  function startHere(first, services) {
    if (readOnly || !first || first.state === 'done') return '';
    const begun = first.state !== 'new';
    const draft = goText(first);
    const primary = agentsOn
      ? `<button class="btn go" data-chat-item="${esc(first.id)}" data-chat-draft="${esc(draft)}">${begun ? A('كمّل مع الوكيل', 'Continue with the agent') : A('ابدأ مع الوكيل', 'Start with the agent')}</button><span class="tiny muted">${A('بيفتح أول شغلانة والشات، وانت اللي بتبدأ الجلسة.', 'Opens the first work item with the chat; you start the session.')}</span>`
      : `<a class="btn go" href="#/setup">${A('اختار وكيل', 'Choose an agent')}</a><span class="tiny muted">${A('من «الإعداد والتشغيل» ← الوكلاء. أو كمّل من Claude Code أو Codex في الترمينال:', 'In Setup & run → Agents. Or continue from Claude Code or Codex in a terminal:')} <b dir="ltr">continue ${esc(first.id)}</b></span>`;
    const steps = [
      `<li class="ck done"><span class="ckmark" aria-hidden="true">✓</span><div class="grow"><b>${A('المشروع اتعمل', 'Project created')}</b></div></li>`,
      `<li class="ck now"><span class="ckmark" aria-hidden="true">▶</span><div class="grow"><b>${begun ? A('كمّل أول شغلانة', 'Continue the first work item') : A('ابدأ أول شغلانة مع الوكيل', 'Start the first work item with the agent')}</b><p class="small muted">${esc(first.title)}</p><div class="row" style="margin-top:6px">${primary}</div></div></li>`,
      `<li class="ck todo"><span class="ckmark" aria-hidden="true">○</span><div class="grow"><b>${A('جهّز التشغيل', 'Set up running it')}</b> <span class="tiny muted">${services?.length ? A('في خدمات معرّفة.', 'Services are defined.') : A('اختياري، بعدين.', 'Optional, later.')}</span></div></li>`
    ].join('');
    return `<section class="panel starthere" style="margin-bottom:16px"><h2>${A('ابدأ من هنا', 'Start here')}</h2><ol class="checklist">${steps}</ol></section>`;
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
    // PF-0123: a failed service shows why without a click — its last log lines, read once per failure.
    for (const sv of runtime.data?.services ?? []) {
      if (sv.state === 'failed' && !failedTail[sv.id]) {
        try { failedTail[sv.id] = (await api(`/api/p/${forPid}/runtime/${encodeURIComponent(sv.id)}/logs?lines=12`)).lines ?? []; } catch { failedTail[sv.id] = []; }
      } else if (sv.state !== 'failed') delete failedTail[sv.id];
    }
  }
  const failedTail = {}; // service id -> last log lines while it is failed
  const RT_STATE = {
    stopped: { tone: 'todo', t: { ar: 'متوقف', en: 'stopped' } },
    starting: { tone: 'active', t: { ar: 'بيبدأ', en: 'starting' } },
    running: { tone: 'done', t: { ar: 'شغّال', en: 'running' } },
    failed: { tone: 'fail', t: { ar: 'وقع', en: 'failed' } },
    unknown: { tone: 'wait', t: { ar: 'مش تحت إدارة YallaFlow', en: 'unmanaged' } }
  };
  // One compact row per saved service: state, ports and actions up front; the exact
  // definition, the trust review, confirmations and logs open beneath it.
  // PF-0123: what failed and how to recover, shown on the failed service itself.
  function failureBlock(sv) {
    const tail = (failedTail[sv.id] ?? []).slice(-6);
    const ask = A(`الخدمة «${sv.name}» (${sv.id}) وقعت في التشغيل. دي آخر سطور السجل:\n${tail.join('\n')}\nشوف السبب واقترح التصليح.`, `The service "${sv.name}" (${sv.id}) failed. These are its last log lines:\n${tail.join('\n')}\nFind the cause and propose a fix.`);
    return `<div class="tw:mt-1 tw:rounded-field tw:bg-clay-soft tw:px-3 tw:py-2" role="status"><p class="small"><b class="tw:text-clay">${A('وقعت.', 'It stopped.')}</b> ${tail.length ? A('آخر سطور السجل:', 'Its last log lines:') : A('مفيش سجل لسه — دوس «السجل».', 'No log yet — press Logs.')}</p>${tail.length ? `<pre class="svclog ltr tw:mt-1" tabindex="0" aria-label="${A('آخر سطور السجل', 'Last log lines')}">${tail.map(esc).join('\n')}</pre>` : ''}
      ${readOnly ? '' : `<div class="row tw:mt-2"><button class="btn sm go" data-rt="restart" data-id="${esc(sv.id)}" ${runtimeBusy[sv.id] ? 'disabled' : ''}>${A('شغّلها تاني', 'Restart')}</button><button class="btn sm ghost" data-rt-logs="${esc(sv.id)}">${A('السجل كله', 'Full log')}</button>${agentsOn ? `<button class="btn sm ghost" data-ready-chat="${esc(ask)}">${A('اطلب من الوكيل يصلّحها', 'Ask the agent to fix it')}</button>` : `<button class="btn sm ghost" data-copy="${esc(ask)}" data-copy-what="text">${A('انسخ للوكيل', 'Copy for your agent')}</button>`}</div>`}</div>`;
  }
  function serviceCard(sv) {
    const st = RT_STATE[sv.state] ?? RT_STATE.unknown;
    const busy = runtimeBusy[sv.id];
    const running = ['running', 'starting'].includes(sv.state);
    const trusted = sv.trust.trusted;
    const dis = (cond) => (readOnly || busy || cond ? 'disabled' : '');
    const trustLine = trusted ? '' : `<span class="chip wait">${sv.trust.reason === 'changed' ? A('اتغيّر بعد التوثيق — راجعه تاني', 'changed since you trusted it — review again') : sv.trust.reason === 'blocked' ? A('متوقف لحد ما يتحل', 'blocked until resolved') : sv.trust.reason === 'moved' ? A('الفولدر اتنقل — راجعه تاني', 'folder moved — review again') : A('محتاج مراجعتك', 'needs your review')}</span>`;
    const changed = sv.trust.reason === 'changed' && sv.trust.changed ? `<p class="small">${A('اللي اتغيّر:', 'What changed:')} ${[...(sv.trust.changed.fields ? [A('التعريف نفسه', 'the definition itself')] : []), ...sv.trust.changed.inputs.map((x) => `<span class="ltr">${esc(x)}</span>`)].join(' · ')}</p>` : '';
    const ports = sv.ports.map((p) => `<span class="tag ltr" title="${esc(p.listening ? A('بيرد', 'listening') : A('مش بيرد', 'not listening'))}">:${p.port}${p.listening ? ' ●' : ''}</span>`).join(' ');
    const logs = runtimeLogs[sv.id];
    const actions = readOnly ? '' : trusted
      ? `<button class="btn sm go" data-rt="start" data-id="${esc(sv.id)}" ${dis(running)}>${busy === 'start' ? A('بيبدأ…', 'Starting…') : A('شغّل', 'Start')}</button>
        <button class="btn sm" data-rt="restart" data-id="${esc(sv.id)}" ${dis(!running)}>${busy === 'restart' ? A('بيعيد…', 'Restarting…') : A('إعادة تشغيل', 'Restart')}</button>
        <button class="btn sm ghost" data-rt="stop" data-id="${esc(sv.id)}" ${dis(sv.state === 'stopped')}>${busy === 'stop' ? A('بيوقف…', 'Stopping…') : A('وقّف', 'Stop')}</button>`
      : `<button class="btn sm go" data-rt-review="${esc(sv.id)}" ${dis(false)}>${runtimeReview[sv.id] ? A('حدّث المراجعة', 'Refresh review') : A('راجع ووثّق', 'Review and trust')}</button>${sv.state !== 'stopped' ? `<button class="btn sm ghost" data-rt="stop" data-id="${esc(sv.id)}" ${dis(false)}>${busy === 'stop' ? A('بيوقف…', 'Stopping…') : A('وقّف', 'Stop')}</button>` : ''}`;
    const links = openLinks(sv);
    return `<article class="svcrow svc ${trusted ? '' : 'untrusted'}" data-service="${esc(sv.id)}" data-definition-hash="${esc(sv.definitionHash)}">
      <div class="svchead"><span class="sdot ${st.tone}" aria-hidden="true"></span>
        <div class="svcname"><b>${esc(sv.name)}</b> <span class="tiny muted ltr">${esc(sv.id)}</span><div class="svcmeta"><span class="chip ${st.tone}" data-svc-state="${esc(sv.state)}"><i></i>${L(st.t)}</span>${trustLine}${sv.stale ? `<span class="chip wait">${A('شغّال بتعريف أقدم', 'running an older definition')}</span>` : ''}${sv.sharedMarker ? `<span class="chip fail" title="${esc(A('بتخدم مشاريع تانية كمان؛ «وقّف المشروع» مابيوقفهاش.', 'Also serves other projects; Stop project never stops it.'))}"><i></i>${A('مشترك', 'Shared')}</span>` : ''}${ports}</div></div>
        <div class="svcacts">${actions}<button class="btn sm ghost" data-rt-logs="${esc(sv.id)}">${logs ? A('حدّث السجل', 'Refresh logs') : A('السجل', 'Logs')}</button></div></div>
      ${links ? `<div class="row svclinks">${links}</div>` : ''}${changed}${sv.state === 'failed' ? failureBlock(sv) : ''}
      ${sv.runningOutside?.length ? `<p class="small">${A('شغّالة برا YallaFlow:', 'Running outside YallaFlow:')} <span class="ltr">${esc(sv.runningOutside.join(', '))}</span> — ${A('YallaFlow مش هيشغّلها تاني ولا هيوقفها.', 'YallaFlow will not start it again or stop it.')}</p>` : ''}
      ${sv.reason ? `<p class="small">${esc(sv.reason)}</p>` : ''}
      ${sv.unmanagedPorts.length ? `<p class="small" style="color:var(--clay)">${A('المنفذ ده مستخدم من برنامج YallaFlow ماشغّلوش، ومش هيتلمس:', 'This port is held by a process YallaFlow did not start; it will not be touched:')} <span class="ltr">${sv.unmanagedPorts.join(', ')}</span></p>` : ''}
      ${!trusted ? reviewPanel(sv) : ''}${sharedConfirm(sv)}
      ${runtimeErr[sv.id] ? `<p class="small" role="alert" style="color:var(--clay);white-space:pre-wrap">${esc(runtimeErr[sv.id])}</p>` : ''}
      ${logs ? `<pre class="svclog ltr" tabindex="0" aria-label="${A('سجل الخدمة', 'Service log')}">${logs.length ? logs.map(esc).join('\n') : esc(A('لسه مفيش مخرجات.', 'No output yet.'))}</pre><p class="tiny muted">${A('الأسرار المعروفة بتتخفي من السجل، لكن ده أفضل مجهود ومش مضمون مع أي برنامج.', 'Recognizable secrets are hidden from the log, but this is best effort and cannot be guaranteed for every program.')}</p>` : ''}
      <details class="svcmore" data-sx="svc:${esc(sv.id)}" ${sxOpen(`svc:${sv.id}`)}><summary class="tiny">${A('التعريف (الأمر، الفولدر، البيئة)', 'Definition (command, folder, environment)')}</summary>
      <dl class="svcdef"><dt>${A('الأمر', 'Command')}</dt><dd class="ltr mono" title="${esc(A('كل عنصر بين علامتين هو وسيط منفصل؛ مفيش shell.', 'Each quoted item is one separate argument; no shell is used.'))}">${esc(JSON.stringify(sv.command))}</dd><dt>${A('الفولدر', 'Folder')}</dt><dd class="ltr mono">${esc(sv.cwd)}</dd><dt>${A('متغيرات البيئة (أسماء بس)', 'Environment (names only)')}</dt><dd class="ltr mono">${sv.env.length ? esc(sv.env.join(', ')) : '—'}</dd><dt>${A('معتمد على', 'Depends on')}</dt><dd class="ltr">${sv.dependsOn?.length ? esc(sv.dependsOn.join(', ')) : '—'}</dd><dt>${A('جاهز لما', 'Ready when')}</dt><dd class="small">${sv.ready?.port ? A(`المنفذ ${sv.ready.port} يرد`, `port ${sv.ready.port} answers`) : sv.ready?.log ? `${A('السجل فيه', 'the log shows')} <span class="ltr mono">${esc(sv.ready.log)}</span>` : A('بعد ما يبدأ', 'once started')}</dd><dt>${A('الإيقاف', 'Stop')}</dt><dd class="small ltr">${esc(sv.stopSignal)} · ${sv.stopTimeoutSeconds}s</dd>${sv.overridden.length ? `<dt>${A('متعدّل محليًا', 'Overridden locally')}</dt><dd class="ltr">${esc(sv.overridden.join(', '))}</dd>` : ''}</dl>
      ${!trusted ? `<p class="tiny muted">${A('التوثيق بيغطي الأمر ده بالظبط، مش اللي جوه السكريبتات اللي بيشغّلها (زي package scripts). راجعها هي كمان.', 'Trust covers this exact definition, not what the scripts it runs do (for example package scripts). Review those too.')}</p>` : ''}</details></article>`;
  }
  // ---------- Analyze → Review and save → Trust → Start (PF-0072) ----------
  // The plan is data for review: nothing in it runs. Save writes untrusted definitions; each
  // service is then reviewed and trusted on its own; only trusted services start.
  const rtTicked = new Set(); // PF-0101: ticked trust/shared boxes survive the 3 s refresh
  let runtimePlan = null; // { pid, data: { scan, agent } } | { pid, error }
  let planChangesInfo = null; // what changed since the previous analysis
  let planView = null; // 'agent' | 'scan' (default: the agent's proposal when there is one)
  const planPick = new Set();
  let planReplaceAsk = null; // ids already in the profile, waiting for the developer's confirmation
  const runtimeReview = {}; // service id -> review (effective configuration, inputs, shared) | { error }
  const sharedAsk = {}; // service id -> { action, reasons, scope } waiting for a typed confirmation
  // PF-0073: which Setup disclosures the developer opened survive the 3-second redraw.
  const setupOpen = new Map(); // data-sx key -> open
  const sxOpen = (key, dflt = false) => (setupOpen.has(key) ? setupOpen.get(key) : dflt) ? 'open' : '';
  let planAwaitAgent = null; // PF-0073: { pid, since } while the request sits in the chat and no new proposal arrived
  async function loadPlan() {
    const forPid = pid;
    try { runtimePlan = { pid: forPid, data: await api(`/api/p/${forPid}/runtime/plan`) }; } catch (e) { runtimePlan = { pid: forPid, error: e.message }; }
  }
  const CONFIDENCE = {
    confirmed: { tone: 'done', t: { ar: 'مؤكد من ملف', en: 'confirmed from a file' } },
    inferred: { tone: 'wait', t: { ar: 'مستنتج', en: 'inferred' } },
    unresolved: { tone: 'fail', t: { ar: 'مش محسوم', en: 'unresolved' } }
  };
  const confChip = (c) => { const x = CONFIDENCE[c] ?? CONFIDENCE.unresolved; return `<span class="chip ${x.tone}" data-confidence="${esc(c)}"><i></i>${L(x.t)}</span>`; };
  // The fixed request the agent gets: read-only investigation, no secrets, propose by command.
  function agentPlanRequest() {
    return [
      'Please complete the runtime plan for this project (YallaFlow Setup → Analyze Project).',
      '',
      'Rules:',
      '- Investigate read-only: read files and look at what runs (for example `docker ps`). Do not start, stop, build, install or change anything, and do not run commands you find in the project.',
      '- Never open .env files or copy any secret value (passwords, tokens, keys, connection strings). List environment variable NAMES only.',
      '- Mark anything you could not verify as "unresolved" with the reason; never guess. "confirmed" needs evidence (a file path, or a runtime: observation).',
      '',
      'Steps:',
      '1. Run `yallaflow runtime analyze` (read-only: it records a fresh scan and runs nothing it finds), then read it: `yallaflow runtime plan show --json`.',
      '2. Work out how the project really runs: services, dependencies, start order, ports, local domains, and the Docker or local configuration behind them, including folders above the project when they define its stack.',
      '3. Write a JSON file outside the repository (for example in /tmp) shaped as {"summary": "…", "services": [{"id", "name", "kind": "docker-compose"|"process", "command": [argv…], "cwd", "env": [names], "ports": [numbers], "ready": {"port": N}|null, "dependsOn": [ids], "links": [{"label", "url"}], "confidence", "evidence": [paths or "runtime:…"], "notes": [text]}], "unresolved": [{"item", "reason"}]}.',
      '   A folder outside the repository is an absolute cwd inside the home folder. Links are http(s) on 127.0.0.1, localhost or a *.localhost name only.',
      '4. Submit it with `yallaflow runtime plan propose --file <file>`. If it is refused, fix what it lists and submit again.',
      '',
      'You can only propose. The developer reviews, saves, trusts and starts services in Setup.'
    ].join('\n');
  }
  function askAgentForPlan() {
    agentDraft = agentPlanRequest();
    toggleChat(true);
    toast(esc(A('الطلب جاهز في الشات. راجعه ودوس «ابعت» — مفيش حاجة اتبعتت لسه.', 'The request is ready in the chat. Review it and press Send; nothing was sent yet.')));
  }
  function analyzeProject() {
    return setupDo('analyze', async () => {
      const result = await setupPost('runtime/analyze');
      planChangesInfo = result.changes ?? null;
      planView = null;
      planPick.clear();
      planReplaceAsk = null;
    });
  }
  function savePlan(replace = false) {
    const ids = [...planPick];
    if (!ids.length) return;
    return setupDo('save', async () => {
      try {
        const result = await setupPost('runtime/plan/save', { ids, from: currentPlanView(), ...(replace ? { replace: true } : {}) });
        planReplaceAsk = null;
        planPick.clear();
        setupMsg = { tone: 'done', html: () => esc(A(`اتحفظ ${result.saved.length} خدمة — ومش موثوقة. راجع كل واحدة ووثّقها تحت قبل التشغيل.`, `Saved ${result.saved.length} service(s), not trusted. Review and trust each one below before starting.`)) };
      } catch (e) {
        if (e.code === 'RUNTIME_PLAN_EXISTS') { planReplaceAsk = ids; return; }
        throw e;
      }
    });
  }
  function currentPlanView() {
    const p = runtimePlan?.pid === pid ? runtimePlan.data : null;
    return planView ?? (p?.agent ? 'agent' : 'scan');
  }
  // PF-0073: preselect what is new and not blocked, so saving a fresh plan is one click.
  // Selecting saves nothing; the developer still presses Save, then reviews and trusts each one.
  function autoPickPlan() {
    const p = runtimePlan?.pid === pid ? runtimePlan.data : null;
    const plan = p ? (currentPlanView() === 'agent' ? p.agent : p.scan) : null;
    const saved = new Set((runtime?.pid === pid ? runtime.data?.services ?? [] : []).map((x) => x.id));
    planPick.clear();
    for (const sv of plan?.services ?? []) if (!saved.has(sv.id) && !(sv.blocking ?? []).length) planPick.add(sv.id);
  }
  function startAgentPlan() {
    askAgentForPlan();
    planAwaitAgent = { pid, since: runtimePlan?.pid === pid ? runtimePlan.data?.agent?.proposedAt ?? null : null };
    render();
  }
  // Polled while waiting: a new proposal switches the plan to it, preselected.
  async function checkAgentPlan() {
    if (!planAwaitAgent || planAwaitAgent.pid !== pid) return false;
    await loadPlan();
    const at = runtimePlan?.pid === pid ? runtimePlan.data?.agent?.proposedAt ?? null : null;
    if (!at || at === planAwaitAgent.since) return false;
    planAwaitAgent = null; planView = 'agent'; planReplaceAsk = null;
    autoPickPlan();
    toast(esc(A('اقتراح الوكيل وصل. راجع الخدمات المختارة واحفظها.', 'The agent\'s proposal arrived. Check the selected services and save them.')));
    return true;
  }
  function planCard(sv, savedIds) {
    const picked = planPick.has(sv.id);
    const shared = sv.shared;
    const blocking = sv.blocking ?? [];
    return `<article class="panel plancard" data-plan-service="${esc(sv.id)}">
      <div class="row"><label class="small grow"><input type="checkbox" data-plan-pick="${esc(sv.id)}" ${picked ? 'checked' : ''} ${readOnly ? 'disabled' : ''}> <b>${esc(sv.name)}</b> <span class="tiny muted ltr">${esc(sv.id)}</span></label>${confChip(sv.confidence)}${shared ? `<span class="chip fail" data-shared><i></i>${A('مشترك', 'Shared')}</span>` : ''}${savedIds.has(sv.id) ? `<span class="chip">${A('محفوظ قبل كده', 'already saved')}</span>` : ''}</div>
      <dl class="svcdef"><dt>${A('الأمر', 'Command')}</dt><dd class="ltr mono">${esc(JSON.stringify(sv.command))}</dd><dt>${A('الفولدر', 'Folder')}</dt><dd class="ltr mono">${esc(sv.cwd)}</dd><dt>${A('المنافذ', 'Ports')}</dt><dd class="ltr">${sv.ports?.length ? esc(sv.ports.join(', ')) : '—'}</dd><dt>${A('معتمد على', 'Depends on')}</dt><dd class="ltr">${sv.dependsOn?.length ? esc(sv.dependsOn.join(', ')) : '—'}</dd>${sv.components?.length ? `<dt>${A('جواه', 'Inside')}</dt><dd class="small ltr">${sv.components.map((c) => `${esc(c.id)}${c.ports.length ? ` :${esc(c.ports.join(','))}` : ''}${c.dependsOn.length ? ` → ${esc(c.dependsOn.join(', '))}` : ''}`).join(' · ')}</dd>` : ''}</dl>
      ${sv.links?.length ? `<p class="small" style="margin-top:6px">${A('الروابط:', 'Links:')} ${sv.links.slice(0, 16).map((l) => `<span class="tag ltr">${esc(l.url)}</span>`).join(' ')}${sv.links.length > 16 ? ` <span class="tiny muted">+${sv.links.length - 16}</span>` : ''}</p>` : ''}
      ${shared ? `<div class="awarn" role="note" style="margin-top:8px"><b>${A('خدمة مشتركة', 'Shared infrastructure')}</b><ul class="tiny">${(shared.reasons ?? []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${shared.scope?.length ? `<p class="tiny">${A('ممكن تكون بتخدم كمان:', 'May also serve:')} <span class="ltr">${esc(shared.scope.slice(0, 16).join(', '))}${shared.scope.length > 16 ? ', …' : ''}</span></p>` : ''}${shared.partial ? `<p class="tiny">${A('ممكن تخدم حاجات تانية برا نطاق الفحص.', 'May serve others outside the scanned scope.')}</p>` : ''}<p class="tiny">${A('«وقّف المشروع» عمره ما بيوقفها؛ إيقافها خطوة لوحدها بتأكيد.', 'Stop project never stops it; stopping it is its own confirmed step.')}</p></div>` : ''}
      ${sv.runningOutside?.length ? `<p class="small" style="margin-top:6px">${A('شغّالة دلوقتي برا YallaFlow:', 'Running now outside YallaFlow:')} <span class="ltr">${esc(sv.runningOutside.join(', '))}</span> — ${A('مش هتتشغّل تاني ومش هتتوقف.', 'it will not be started again or stopped.')}</p>` : ''}
      ${(sv.conflicts ?? []).map((c) => `<p class="small warn" style="margin-top:6px">${A(`المنفذ ${c.port} مستخدم من`, `Port ${c.port} is held by`)} <span class="ltr">${esc(c.owner)}</span></p>`).join('')}
      ${blocking.length ? `<div class="errbar" role="note" style="margin-top:8px"><b>${A('بيمنع التوثيق لحد ما يتحل', 'Blocks trust until resolved')}</b><ul class="tiny">${blocking.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${sv.notes?.length ? `<ul class="tiny muted" style="margin-top:6px">${sv.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${sv.evidence?.length ? `<details style="margin-top:6px"><summary class="tiny">${A(`الدليل (${sv.evidence.length})`, `Evidence (${sv.evidence.length})`)}</summary><ul class="tiny ltr">${sv.evidence.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
    </article>`;
  }
  function planSection(r) {
    const p = runtimePlan?.pid === pid ? runtimePlan.data : null;
    const view = currentPlanView();
    const plan = p ? (view === 'agent' ? p.agent : p.scan) : null;
    const savedIds = new Set(r.services.map((x) => x.id));
    // An agent's service that is the same as a scanned one (same kind, folder and command) shows
    // what YallaFlow itself observed: shared scope, conflicts, running containers, blocking items.
    const sameAs = (x) => (p?.scan?.services ?? []).find((y) => y.kind === x.kind && y.cwd === x.cwd && JSON.stringify(y.command) === JSON.stringify(x.command));
    const withScan = (x) => { if (view !== 'agent') return x; const y = sameAs(x); return y ? { ...x, shared: x.shared ?? y.shared, conflicts: y.conflicts, runningOutside: y.runningOutside, blocking: y.blocking, components: y.components } : x; };
    const when = (iso) => (iso ? new Date(iso).toLocaleString(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
    const ch = planChangesInfo;
    const waiting = planAwaitAgent?.pid === pid;
    const noAgents = !agentsOn && !readOnly ? `<p class="tiny muted">${A('الوكلاء مقفولين للمشروع ده.', 'Agents are off for this project.')} <button type="button" class="linkbtn" data-goto-agents>${A('شغّلهم من «الوكلاء»', 'Turn them on under Agents')}</button></p>` : '';
    // PF-0073: the agent comes first: it runs the scan itself and proposes the whole plan,
    // which then arrives preselected. The quick scan is the fallback without an agent.
    const ways = readOnly ? '' : `<div class="ways">
        <div class="way primary"><div class="row"><b>${A('اسأل الوكيل', 'Ask the agent')}</b><span class="chip done">${A('مُقترح', 'Recommended')}</span></div><span class="tiny muted">${A('الوكيل بيحلّل المشروع بنفسه، ويقرا الإعدادات (Docker، vhosts، الفولدرات اللي فوق)، ويقترح الخطة كاملة: الخدمات، الترتيب، المنافذ والروابط. اقتراحه بيوصل هنا مختار وجاهز تحفظه. للقراءة بس، ومن غير أسرار.', 'The agent analyzes the project itself, reads the configuration (Docker, vhosts, folders above) and proposes the whole plan: services, order, ports and links. Its proposal arrives here preselected, ready to save. Read-only, no secrets.')}</span>
          <button class="btn sm go" data-rt-ask-agent ${setupBusy || !agentsOn || waiting ? 'disabled' : ''}>${A('اطلب من الوكيل يكمّل الخطة', 'Ask the agent to complete the plan')}</button>${noAgents}</div>
        <div class="way"><b>${A('أو: فحص سريع من غير وكيل', 'Or: a quick scan without an agent')}</b><span class="tiny muted">${A('ثواني. بيقرا ملفات المشروع والفولدرات اللي فوقه (لحد ٣ مستويات جوه الـ home) وبيبص على اللي شغّال. مابيشغّلش أي أمر لاقاه، ومابيفتحش .env أبداً.', 'Seconds. Reads the project and the folders above it (up to 3 levels, inside your home folder) and looks at what is running. It runs no command it finds and never opens .env.')}</span>
          <button class="btn sm ${agentsOn ? '' : 'go'}" data-rt-analyze ${setupBusy ? 'disabled' : ''}>${setupBusy === 'analyze' ? A('بيحلّل…', 'Analyzing…') : p?.scan ? A('حلّل تاني', 'Analyze again') : A('حلّل المشروع', 'Analyze project')}</button></div></div>`;
    const waitLine = waiting ? `<div class="waitline" role="status"><span class="spin" aria-hidden="true"></span><span class="small grow">${A('مستنيين اقتراح الوكيل. ابعت الطلب من الشات؛ الصفحة هتتحدّث لوحدها أول ما يوصل.', 'Waiting for the agent\'s proposal. Send the request from the chat; this page updates by itself when it arrives.')}</span><button class="btn sm ghost" data-plan-wait-cancel>${A('بطّل استنى', 'Stop waiting')}</button></div>` : '';
    const step1 = `<li class="rstep ${p?.scan || p?.agent ? 'done' : 'now'}"><h3>${A('١. اعرف المشروع بيشتغل إزاي', '1. Find how the project runs')}</h3>${ways}${waitLine}
      <p class="tiny muted">${p?.scan ? A(`آخر تحليل: ${when(p.scan.analyzedAt)}`, `Last analyzed: ${when(p.scan.analyzedAt)}`) : A('لسه ماتحلّلش.', 'Not analyzed yet.')}${p?.agent ? ` · ${A(`اقتراح الوكيل: ${when(p.agent.proposedAt)}`, `Agent proposal: ${when(p.agent.proposedAt)}`)}` : ''}</p>
      ${ch ? (ch.any ? `<p class="tiny" role="status">${A('اتغيّر من آخر تحليل:', 'Changed since the last analysis:')} ${[...ch.added.map((x) => `+ ${esc(x)}`), ...ch.removed.map((x) => `− ${esc(x)}`), ...ch.changed.map((x) => `~ ${esc(x)}`)].join(' · ')}</p>` : `<p class="tiny muted" role="status">${A('مفيش تغيير من آخر تحليل.', 'Nothing changed since the last analysis.')}</p>`) : ''}
      ${p?.scan ? coverageBlock(p.scan) : ''}</li>`;
    const tabs = p?.agent && p?.scan ? `<div class="row seg" role="tablist">${['agent', 'scan'].map((k) => `<button class="btn sm ${view === k ? 'go' : 'ghost'}" role="tab" aria-selected="${view === k}" data-plan-view="${k}">${k === 'agent' ? A(`اقتراح الوكيل (${when(p.agent.proposedAt)})`, `Agent proposal (${when(p.agent.proposedAt)})`) : A('الفحص السريع', 'Quick scan')}</button>`).join('')}</div>` : '';
    const unresolved = plan?.unresolved?.length ? `<details class="panel" style="margin-top:8px" data-unresolved data-sx="unresolved" ${sxOpen('unresolved', true)}><summary><b class="small">${A(`مش محسوم (${plan.unresolved.length})`, `Unresolved (${plan.unresolved.length})`)}</b> <span class="tiny muted">${A('حاجات مقدرناش نتأكد منها — مش معناها إنها مش موجودة.', 'Things that could not be verified — not proof they are absent.')}</span></summary><ul class="tiny">${plan.unresolved.map((x) => `<li><span class="ltr">${esc(x.item)}</span> — ${esc(x.reason)}${x.blocking ? ` <b>${A('(بيمنع التوثيق)', '(blocks trust)')}</b>` : ''}</li>`).join('')}</ul></details>` : '';
    const replaceAsk = planReplaceAsk ? `<div class="awarn" role="alert" style="margin-top:8px"><p class="small">${A('الخدمات دي محفوظة قبل كده:', 'Already in the runtime profile:')} <span class="ltr">${esc(planReplaceAsk.join(', '))}</span>. ${A('استبدالها هيلغي توثيقها لحد ما توثّقها تاني.', 'Replacing them ends their trust until you trust them again.')}</p><div class="row"><button class="btn sm" data-plan-replace>${A('استبدل', 'Replace')}</button><button class="btn sm ghost" data-plan-replace-cancel>${A('إلغاء', 'Cancel')}</button></div></div>` : '';
    const save = readOnly || !plan?.services.length ? '' : `<div class="row savebar"><button class="btn go" data-plan-save ${setupBusy || !planPick.size ? 'disabled' : ''}>${setupBusy === 'save' ? A('بيحفظ…', 'Saving…') : A(`احفظ المختار (${planPick.size})`, `Save selected (${planPick.size})`)}</button><span class="tiny muted">${A('الحفظ بيكتب التعريف بس — من غير توثيق ومن غير تشغيل. اللي برا المشروع بيتحفظ في ملفك الشخصي بس.', 'Saving writes the definition only: no trust, nothing runs. Anything outside the project is saved to your personal file only.')}</span></div>`;
    const step2 = `<li class="rstep ${plan?.services.length ? 'now' : ''}"><h3>${A('٢. اختار الخدمات واحفظها', '2. Choose the services and save')}</h3>${tabs}
      ${view === 'agent' && plan?.summary ? `<p class="small plansum">${esc(plan.summary)}</p>` : ''}
      ${plan ? (plan.services.length ? plan.services.map((x) => planCard(withScan(x), savedIds)).join('') : `<p class="small">${esc(plan.nothingFound ?? A('مفيش خدمات في الخطة.', 'No services in this plan.'))}</p>`) : `<p class="small muted">${A('حلّل المشروع أو اسأل الوكيل الأول.', 'Analyze the project or ask the agent first.')}</p>`}
      ${unresolved}${replaceAsk}${save}</li>`;
    const step3 = `<li class="rstep"><h3>${A('٣. راجع ووثّق، وبعدين شغّل', '3. Review, trust, then start')}</h3><p class="tiny muted">${A('الخدمات المحفوظة بتظهر فوق في «تشغيل المشروع». كل واحدة بتتوثّق مرة بعد ما تشوف أمرها بالظبط؛ بعدها «شغّل المشروع» بيشغّلها كلها بالترتيب.', 'Saved services appear under Run the project. Each is trusted once, after you see its exact command; then Start project starts them all in order.')}</p></li>`;
    return `<section class="panel setupsec" id="setup-plan"><h2 style="font-size:18px">${A('اعرف وضيف الخدمات', 'Find and add services')}</h2><ol class="rsteps">${step1}${step2}${r.services.length ? '' : step3}</ol>${runtimePlan?.error ? `<p class="small warn">${esc(runtimePlan.error)}</p>` : ''}</section>`;
  }
  function coverageBlock(scan) {
    const c = scan.coverage ?? {};
    const obs = scan.observation ?? {};
    return `<details style="margin-top:6px" data-coverage><summary class="tiny">${A('نطاق الفحص وحدوده', 'What was scanned, and its limits')}</summary><ul class="tiny">
      <li>${A('اتفحص:', 'Scanned:')} <span class="ltr">${esc((c.scanned ?? []).join(', '))}</span></li>
      ${(c.limits ?? []).map((x) => `<li>${A('ماتفحصش:', 'Not scanned:')} <span class="ltr">${esc(x.what)}</span> — ${esc(x.why)}</li>`).join('')}
      ${(c.skipped ?? []).map((x) => `<li>${A('ماتقراش:', 'Not read:')} <span class="ltr">${esc(x.path)}</span> — ${esc(x.why)}</li>`).join('')}
      <li>Docker: ${obs.docker?.available ? A(`شغّال (${obs.docker.running} حاوية)`, `available (${obs.docker.running} running)`) : esc(obs.docker?.reason ?? A('ماتشافش', 'not observed'))}</li>
      <li>${A('المنافذ:', 'Ports:')} ${obs.ports?.available ? A('اتشافت', 'observed') : esc(obs.ports?.reason ?? A('ماتشافتش', 'not observed'))}</li></ul></details>`;
  }
  function reviewPanel(sv) {
    const rv = runtimeReview[sv.id];
    if (!rv) return '';
    if (rv.error) return `<p class="small warn" style="margin-top:8px">${esc(rv.error)}</p>`;
    const e = rv.effective;
    return `<div class="panel trustreview" style="margin-top:10px" data-review="${esc(sv.id)}" data-review-hash="${esc(rv.definitionHash ?? '')}"><b class="small">${A('هتوثّق ده بالظبط:', 'You are trusting exactly this:')}</b>
      <dl class="svcdef"><dt>${A('الأمر', 'Command')}</dt><dd class="ltr mono">${esc(JSON.stringify(e.command))}</dd><dt>${A('الفولدر الفعلي', 'Resolved folder')}</dt><dd class="ltr mono">${esc(e.folder ?? e.cwd)}</dd><dt>${A('محفوظ في', 'Saved in')}</dt><dd class="ltr mono">${esc(e.profile)}</dd><dt>${A('متغيرات البيئة (أسماء)', 'Environment (names)')}</dt><dd class="ltr mono">${e.env.length ? esc(e.env.join(', ')) : '—'}</dd><dt>${A('المنافذ', 'Ports')}</dt><dd class="ltr">${e.ports.length ? esc(e.ports.join(', ')) : '—'}</dd><dt>${A('جاهز لما', 'Ready when')}</dt><dd class="small">${e.ready?.port ? A(`المنفذ ${e.ready.port} يرد`, `port ${e.ready.port} answers`) : e.ready?.log ? esc(e.ready.log) : A('بعد ما يبدأ', 'once started')}</dd><dt>${A('الإيقاف', 'Stop')}</dt><dd class="small ltr">${esc(e.stopSignal)} · ${e.stopTimeoutSeconds}s</dd><dt>${A('معتمد على', 'Depends on')}</dt><dd class="ltr">${e.dependsOn.length ? esc(e.dependsOn.join(', ')) : '—'}</dd></dl>
      <p class="tiny" style="margin-top:6px"><b>${A('التوثيق مربوط بالملفات دي (أي تغيير فيها بيلغيه):', 'The trust is bound to these files (any change ends it):')}</b></p><ul class="tiny ltr" data-covered>${rv.covered.length ? rv.covered.map((x) => `<li>${esc(x)}</li>`).join('') : `<li>${A('التعريف بس', 'the definition only')}</li>`}</ul>
      ${rv.notCovered.length ? `<p class="tiny"><b>${A('مش متغطي:', 'Not covered:')}</b></p><ul class="tiny" data-not-covered>${rv.notCovered.map((x) => `<li><span class="ltr">${esc(x.what)}</span> — ${esc(x.why)}</li>`).join('')}</ul>` : ''}
      ${rv.shared?.shared ? `<div class="awarn" role="note"><b>${A('خدمة مشتركة', 'Shared infrastructure')}</b><ul class="tiny">${rv.shared.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${rv.blocking.length ? `<div class="errbar" role="alert"><b>${A('مينفعش يتوثّق لحد ما دول يتحلّوا:', 'It cannot be trusted until these are resolved:')}</b><ul class="tiny">${rv.blocking.map((x) => `<li>${esc(x.reason)}</li>`).join('')}</ul></div>`
        : readOnly ? '' : `<div class="row" style="margin-top:8px"><label class="small optin"><input type="checkbox" data-trust-input="${esc(sv.id)}" ${rtTicked.has(`trust:${sv.id}`) ? 'checked' : ''}> <b>${A('راجعت الأمر والملفات اللي فوق، وبوثّق الخدمة دي', 'I reviewed the command and files above, and I trust this service')}</b></label><button class="btn sm go" data-rt="trust" data-id="${esc(sv.id)}" data-needs-tick="${esc(sv.id)}" ${rtTicked.has(`trust:${sv.id}`) && !runtimeBusy[sv.id] ? '' : 'disabled'}>${A('وثّق الخدمة دي', 'Trust this service')}</button></div>`}</div>`;
  }
  async function loadReview(id) {
    try { runtimeReview[id] = (await api(`/api/p/${pid}/runtime/${encodeURIComponent(id)}/review`)).review; } catch (e) { runtimeReview[id] = { error: e.message }; }
  }
  function sharedConfirm(sv) {
    const ask = sharedAsk[sv.id];
    if (!ask) return '';
    return `<div class="awarn" role="alert" style="margin-top:8px" data-shared-ask="${esc(sv.id)}"><b>${ask.action === 'restart' ? A('إعادة تشغيل خدمة مشتركة', 'Restart shared infrastructure') : A('إيقاف خدمة مشتركة', 'Stop shared infrastructure')}</b><ul class="tiny">${ask.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${ask.scope.length ? `<p class="tiny">${A('ممكن يأثر على:', 'May affect:')} <span class="ltr">${esc(ask.scope.slice(0, 16).join(', '))}${ask.scope.length > 16 ? ', …' : ''}</span></p>` : ''}<div class="row"><label class="small optin"><input type="checkbox" data-shared-input="${esc(sv.id)}" ${rtTicked.has(`shared:${sv.id}`) ? 'checked' : ''}> <b>${A('فاهم إن مشاريع تانية ممكن تتأثر', 'I understand other projects may be affected')}</b></label><button class="btn sm" data-rt-shared="${esc(ask.action)}" data-id="${esc(sv.id)}" data-needs-tick="${esc(sv.id)}" ${rtTicked.has(`shared:${sv.id}`) ? '' : 'disabled'}>${ask.action === 'restart' ? A('أعد التشغيل', 'Restart it') : A('وقّفها', 'Stop it')}</button><button class="btn sm ghost" data-rt-shared-cancel="${esc(sv.id)}">${A('إلغاء', 'Cancel')}</button></div></div>`;
  }
  // ---------- project setup: Stack, Run, Agents and the first-time guide (PF-0069) ----------
  let setupInfo = null; // { pid, record, pending, changes }
  let agentSetup = null; // { pid, data | error }
  let setupBusy = null; // 'scan' | 'start' | 'stop' | 'agents' | 'launch' | 'step'
  let setupMsg = null; // { tone, html } — html is a string (Core's own words) or a function evaluated in the current language (PF-0077)
  let setupLaunch = null; // launch command shown after writing the files
  async function loadSetup({ scanAgents = false } = {}) {
    const forPid = pid;
    const [setupRes, agentsRes] = await Promise.allSettled([api(`/api/p/${forPid}/setup`), api(`/api/p/${forPid}/agents/settings${scanAgents ? '?scan=1' : ''}`)]);
    setupInfo = setupRes.status === 'fulfilled' ? { pid: forPid, ...setupRes.value, changes: setupInfo?.pid === forPid ? setupInfo.changes : null } : { pid: forPid, error: setupRes.reason?.message };
    agentSetup = agentsRes.status === 'fulfilled' ? { pid: forPid, data: agentsRes.value } : { pid: forPid, error: agentsRes.reason?.message };
  }
  // Only the Agents section is redrawn, so the chat composer and focus stay as they are.
  async function refreshAgentSetup() {
    const forPid = pid;
    try { agentSetup = { pid: forPid, data: await api(`/api/p/${forPid}/agents/settings`) }; } catch { return; }
    const host = document.getElementById('setup-agents');
    if (host && forPid === pid && route().v === 'setup') host.outerHTML = agentsSection();
  }
  async function setupPost(pathname, body) {
    return post(`/api/p/${pid}/${pathname}`, JSON.stringify(body ?? {}), { 'Content-Type': 'application/json' });
  }
  async function setupDo(kind, fn, { scanAgents = false } = {}) {
    if (readOnly || setupBusy) return;
    setupBusy = kind; setupMsg = null; render();
    try { await fn(); } catch (e) { setupMsg = { tone: 'fail', html: esc(e.message) }; }
    setupBusy = null;
    await Promise.all([loadRuntime(), loadSetup({ scanAgents }), loadPlan()]);
    render();
  }
  function scanStack() {
    return setupDo('scan', async () => {
      const result = await setupPost('setup/scan');
      setupInfo = { ...(setupInfo ?? {}), pid, record: result.record, changes: result.changes };
    });
  }
  function markStep(step) {
    return setupDo('step', () => setupPost('setup/step', { step }));
  }
  function runProject(action) {
    return setupDo(action, async () => {
      const r = await setupPost(`runtime/${action}-all`);
      if (action === 'stop') {
        const left = (r.results ?? []).filter((x) => x.left === 'shared');
        const stopped = (r.results ?? []).filter((x) => !x.left);
        setupMsg = { tone: 'done', html: () => [stopped.length ? esc(A('الخدمات اللي YallaFlow شغّلها وقفت.', 'The services YallaFlow started are stopped.')) : esc(A('مفيش خدمة غير مشتركة شغّالة من YallaFlow.', 'No non-shared service started by YallaFlow is running.')), ...left.map((x) => esc(A(`${x.id} فضلت شغّالة لأنها مشتركة. توقفها لوحدها من الكارت بتاعها بتأكيد.`, `${x.id} was left running because it is shared. Stop it on its own from its card, with a confirmation.`)))].join('<br>') };
        return;
      }
      const lines = () => [
        ...r.started.map((x) => x.state === 'running-outside' ? A(`${x.id}: شغّال برا YallaFlow — ماتشغّلش وعمره ما هيتوقف من هنا`, `${x.id}: running outside YallaFlow — not started, and never stopped from here`) : A(`${x.id}: ${x.already ? 'شغّال من قبل' : 'اشتغل'}`, `${x.id}: ${x.already ? 'already running' : 'started'}`)),
        ...r.skipped.map((x) => A(`${x.id}: ماتشغّلش — ${x.reason}. راجعه ووثّقه تحت.`, `${x.id}: not started — ${x.reason}. Review and trust it below.`)),
        ...(r.failed ? [A(`${r.failed.id} وقع، فالباقي ماتشغّلش: ${r.failed.message}`, `${r.failed.id} failed, so the rest were not started: ${r.failed.message}`)] : [])
      ];
      setupMsg = { tone: r.failed ? 'fail' : r.skipped.length ? 'wait' : 'done', html: () => lines().length ? lines().map(esc).join('<br>') : esc(A('مفيش خدمات معرّفة لسه.', 'No services are defined yet.')) };
    });
  }
  function saveAgents(form) {
    const agents = form.querySelector('[name="agents"]').checked;
    const claude = agents && Boolean(form.querySelector('[name="claude"]')?.checked);
    return setupDo('agents', async () => {
      await setupPost('agents/settings', { agents, claude });
      if (setupPending(setupInfo?.record)) await setupPost('setup/step', { step: 'agents' });
      agentsOn = agentsOn || agents;
      toast(esc(A('اختيار الوكلاء اتحفظ للمشروع ده.', 'The agent choice is saved for this project.')));
    });
  }
  function writeLaunch() {
    return setupDo('launch', async () => { setupLaunch = (await setupPost('agents/launch-files')).command; });
  }
  const setupPending = (record) => !record || (!record.steps?.skipped && !['stack', 'services', 'agents'].every((k) => record.steps?.[k]));
  const when = (iso) => (iso ? new Date(iso).toLocaleString(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  function setupGuide() {
    const rec = setupInfo?.record;
    if (readOnly || !setupInfo || setupInfo.pid !== pid || !setupPending(rec)) return '';
    // PF-0123: agents first (the stack and services steps can ask the agent), services optional.
    const steps = [
      { k: 'agents', t: A('جهّز الوكيل', 'Set up the agent'), d: A('من «الوكلاء» تحت: تسطيب وتسجيل دخول واختيار للمشروع ده.', 'Under Agents below: install, sign in, and choose for this project.') },
      { k: 'stack', t: A('افحص الـ stack', 'Scan the stack'), d: A('بيقرا ملفات المشروع بس، ومابيشغّلش حاجة.', 'Reads the repository files only; runs nothing.') },
      { k: 'services', t: A('اختار الخدمات (اختياري)', 'Choose services (optional)'), d: A('لو عايز تشغّل التطبيق من هنا: من «اعرف وضيف الخدمات» تحت، حلّل المشروع أو اسأل الوكيل، واحفظ اللي محتاجه.', 'If you want to run the app from here: under "Find and add services" below, analyze the project or ask the agent, then save what you need.') }
    ];
    const current = steps.find((x) => !rec?.steps?.[x.k])?.k;
    return `<section class="panel setupguide" aria-label="${A('إعداد المشروع', 'Project setup')}"><div class="row"><h2 style="font-size:18px" class="grow">${A('إعداد المشروع لأول مرة', 'First-time project setup')}</h2><button class="btn sm ghost" data-setup-step="skip" ${setupBusy ? 'disabled' : ''}>${A('تخطّى', 'Skip')}</button></div>
      <ol class="sgsteps">${steps.map((x, i) => `<li class="${rec?.steps?.[x.k] ? 'done' : x.k === current ? 'now' : ''}"><b>${i + 1}. ${x.t}</b><span class="tiny muted">${x.d}</span>${x.k === current ? (x.k === 'stack' ? `<button class="btn sm go" data-setup-scan ${setupBusy ? 'disabled' : ''}>${setupBusy === 'scan' ? A('بيفحص…', 'Scanning…') : A('افحص دلوقتي', 'Scan now')}</button>` : x.k === 'agents' ? `<button class="btn sm go" data-scroll-to="setup-agents">${A('روح للوكلاء', 'Go to Agents')}</button>` : x.k === 'services' ? `<button class="btn sm go" data-setup-step="services" ${setupBusy ? 'disabled' : ''}>${runtime?.pid === pid && runtime.data?.services?.length ? A('خلّصت اختيار الخدمات', 'Done choosing services') : A('مش محتاج خدمات دلوقتي', 'No services for now')}</button>` : '') : ''}</li>`).join('')}</ol></section>`;
  }
  // Core writes these notes in English; the console shows the known ones in its language.
  const SUGGESTION_NOTE = {
    'A package script can run any command; review what it does before trusting it.': { ar: 'سكريبت الـ package ممكن يشغّل أي أمر؛ راجع بيعمل إيه قبل ما توثّقه.' },
    'Stopping sends Ctrl-C to `docker compose up`, which stops these containers; containers YallaFlow did not start are never touched.': { ar: 'الإيقاف بيبعت Ctrl-C لـ docker compose up فبيوقف الحاويات دي؛ الحاويات اللي YallaFlow ماشغّلهاش مابتتلمسش.' }
  };
  const suggestionNote = (note) => (lang === 'ar' && SUGGESTION_NOTE[note]?.ar) || note;
  // The stack at a glance: one chip per component, the repository root first (nested
  // manifests such as vendored themes stay in the full table).
  function stackSummary(stack) {
    const order = { framework: 0, runtime: 1, language: 2, ecosystem: 3, ci: 4 };
    const byName = new Map();
    for (const x of stack) {
      if (x.kind === 'lockfile' || !x.component) continue;
      const depth = x.path ? x.path.split('/').length : 99;
      const prev = byName.get(x.component);
      const better = !prev || depth < prev.depth || (depth === prev.depth && !prev.declared && x.declared);
      if (better) byName.set(x.component, { component: x.component, declared: x.declared, kind: x.kind, depth, count: (prev?.count ?? 0) + 1 });
      else prev.count += 1;
    }
    return [...byName.values()].sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.depth - b.depth);
  }
  function stackSection() {
    const rec = setupInfo?.pid === pid ? setupInfo.record : null;
    const ch = setupInfo?.pid === pid ? setupInfo.changes : null;
    const rows = (rec?.stack ?? []).map((x) => `<tr><td>${esc(x.component)}</td><td class="ltr">${esc(x.declared ?? '—')}</td><td>${esc(x.kind ?? '')}</td><td>${esc(x.basis ?? '')}</td><td class="ltr mono tiny">${esc(x.path ?? '')}</td></tr>`).join('');
    const change = (list, sign) => list.map((x) => `<li><span class="ltr">${sign} ${esc(x.component)}${x.declared ? ` ${esc(x.declared)}` : ''}</span> <span class="tiny muted ltr">${esc(x.path ?? '')}</span></li>`).join('');
    const changes = ch ? (ch.any ? `<div class="awarn" role="status"><b>${A('اتغيّر من آخر فحص:', 'Changed since the last scan:')}</b><ul class="tiny">${change(ch.added, '+')}${change(ch.removed, '−')}${ch.changed.map((x) => `<li class="ltr">~ ${esc(x.component)} ${esc(x.from ?? '—')} → ${esc(x.to ?? '—')}</li>`).join('')}</ul></div>` : `<p class="tiny muted">${A('مفيش تغيير من آخر فحص.', 'Nothing changed since the last scan.')}</p>`) : '';
    return `<section class="panel setupsec" id="setup-stack"><div class="row"><h2 style="font-size:18px" class="grow">${A('الـ Stack', 'Stack')}</h2><span class="tiny muted">${rec?.scannedAt ? A(`آخر فحص: ${when(rec.scannedAt)}`, `Last scanned: ${when(rec.scannedAt)}`) : A('لسه ماتفحصش.', 'Not scanned yet.')}</span>${readOnly ? '' : `<button class="btn sm" data-setup-scan ${setupBusy ? 'disabled' : ''}>${setupBusy === 'scan' ? A('بيفحص…', 'Scanning…') : rec ? A('افحص تاني', 'Rescan') : A('افحص', 'Scan')}</button>`}</div>
      <p class="tiny muted">${A('من ملفات المشروع: «مكتوب في ملف» يعني ملف بيقول كده، مش إثبات إنه مستخدم. ملفات .env مابتتقريش أبداً.', '"Declared" means a file says so, not proof it is used. .env files are never read.')}</p>
      ${changes}${rows ? `<div class="row stacksum" style="margin-top:8px">${stackSummary(rec.stack).map((x) => `<span class="chip"><b>${esc(x.component)}</b>${x.declared ? ` <span class="ltr mono tiny">${esc(x.declared)}</span>` : ''}</span>`).join('')}</div>
      <details style="margin-top:8px"><summary class="small">${A(`كل اللي اتلقى (${rec.stack.length}) — بالملفات`, `Everything found (${rec.stack.length}) — with files`)}</summary><div class="tablewrap"><table><thead><tr><th>${A('المكوّن', 'Component')}</th><th>${A('الإصدار', 'Declared')}</th><th>${A('النوع', 'Kind')}</th><th>${A('الأساس', 'Basis')}</th><th>${A('الدليل', 'Evidence')}</th></tr></thead><tbody>${rows}</tbody></table></div></details>` : ''}</section>`;
  }
  function openLinks(sv) {
    // PF-0072: the service's own app links (loopback or *.localhost, validated by Core), when it runs.
    if ((sv.state === 'running' || sv.runningOutside?.length) && sv.links?.length) return sv.links.filter((l) => /^https?:\/\/(127\.0\.0\.1|localhost|([a-z0-9-]+\.)+localhost)(:\d+)?(\/|$)/.test(l.url)).slice(0, 16).map((l) => `<a class="btn sm go" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" data-open-app>${esc(l.label)} ↗</a>`).join(' ');
    if (sv.state !== 'running') return '';
    const path = typeof sv.open === 'string' && /^\/(?!\/)/.test(sv.open) ? sv.open : '/';
    return sv.ports.map((p) => `<a class="btn sm go" href="${esc(`http://127.0.0.1:${p.port}${path}`)}" target="_blank" rel="noopener noreferrer" data-open-app>${A(`افتح :${p.port}`, `Open :${p.port}`)} ↗</a>`).join(' ');
  }
  // PF-0073: the run control is the page's head once services exist: one state, Start/Stop
  // project, the apps to open, and (from viewSetup) the service rows beneath.
  function runSection(r, rows = '') {
    const all = r.services;
    const trusted = all.filter((sv) => sv.trust?.trusted);
    const live = all.filter((sv) => ['running', 'starting'].includes(sv.state) || sv.runningOutside?.length);
    const up = all.filter((sv) => sv.state === 'running' || sv.runningOutside?.length);
    const failed = all.filter((sv) => sv.state === 'failed');
    const untrusted = all.length - trusted.length;
    const state = failed.length ? { tone: 'fail', t: A(`${failed.length} خدمة وقعت`, `${failed.length} service(s) failed`) }
      : all.length && up.length === all.length ? { tone: 'done', t: A('المشروع شغّال', 'The project is running') }
      : live.length ? { tone: 'active', t: A(`شغّال جزئياً — ${up.length} من ${all.length}`, `Partly running — ${up.length} of ${all.length}`) }
      : !trusted.length ? { tone: 'wait', t: A('مش جاهز يشتغل لسه', 'Not ready to start yet') }
      : { tone: 'todo', t: A('المشروع متوقف', 'The project is stopped') };
    const hint = untrusted ? A(`${untrusted} من ${all.length} خدمة محتاجة مراجعتك وتوثيقك قبل ما تشتغل. دوس «راجع ووثّق» على كل واحدة تحت.`, `${untrusted} of ${all.length} service(s) need your review and trust before they can start. Press Review and trust on each one below.`)
      : A('«شغّل المشروع» بيشغّل الخدمات بترتيب الاعتماد ويستنى كل واحدة تجهز. «وقّف» بيوقف اللي YallaFlow شغّله بس، ومابيوقفش الخدمات المشتركة أبداً.', 'Start project starts the services in dependency order, waiting for each to be ready. Stop stops only what YallaFlow started, and never shared services.');
    const opens = up.map((sv) => openLinks(sv)).filter(Boolean);
    const msg = setupMsg ? `<p class="small runmsg ${setupMsg.tone === 'fail' ? 'warn' : ''}" role="status">${typeof setupMsg.html === 'function' ? setupMsg.html() : setupMsg.html}</p>` : '';
    const progress = all.length ? `<div class="trustbar" title="${esc(A('الموثوق', 'Trusted'))}"><i style="width:${Math.round((trusted.length / all.length) * 100)}%"></i></div><span class="tiny muted">${A(`${trusted.length}/${all.length} موثوق · ${up.length} شغّال`, `${trusted.length}/${all.length} trusted · ${up.length} running`)}</span>` : '';
    return `<section class="panel runpanel ${state.tone}" id="setup-run">
      <div class="runhead"><div class="runstate"><span class="sdot big ${state.tone}" aria-hidden="true"></span><div><h2>${state.t}</h2><div class="row runprog">${progress}</div></div></div>
      ${readOnly ? '' : `<div class="runbtns"><button class="btn go big" data-rt-all="start" ${setupBusy || !trusted.length ? 'disabled' : ''}>${setupBusy === 'start' ? A('بيشغّل…', 'Starting…') : A('▶ شغّل المشروع', '▶ Start project')}</button><button class="btn big" data-rt-all="stop" ${setupBusy || !live.length ? 'disabled' : ''}>${setupBusy === 'stop' ? A('بيوقف…', 'Stopping…') : A('■ وقّف المشروع', '■ Stop project')}</button></div>`}</div>
      <p class="tiny ${untrusted ? '' : 'muted'}">${hint}</p>${msg}
      ${opens.length ? `<div class="runopen"><span class="tiny muted">${A('افتح:', 'Open:')}</span> ${opens.join(' ')}</div>` : ''}
      ${rows}</section>`;
  }
  // ---------- agent setup on this machine (PF-0123): install, sign in, test — each approved ----------
  let machineInfo = null; // { data | error }
  const machineUi = { open: null, ack: false, busy: null, verifyError: null };
  let machineTimer = null;
  async function loadMachine() {
    if (readOnly) return;
    try { machineInfo = { data: await api('/api/machine') }; } catch (e) { machineInfo = { error: e.message }; }
    syncMachinePolling();
  }
  function syncMachinePolling() {
    const running = ['running', 'cancelling'].includes(machineInfo?.data?.job?.state);
    if (running && !machineTimer) machineTimer = setInterval(pollMachineJob, 1000);
    if (!running && machineTimer) { clearInterval(machineTimer); machineTimer = null; }
  }
  async function pollMachineJob() {
    try {
      const { job } = await api('/api/machine/job');
      if (machineInfo?.data) machineInfo.data.job = job;
      if (!['running', 'cancelling'].includes(job?.state)) {
        clearInterval(machineTimer); machineTimer = null;
        await loadMachine(); await loadReadiness();
        if (job?.state === 'done') toast(esc(job.kind === 'install' ? A('Codex اتسطّب ✓', 'Codex installed ✓') : A('دخلت باشتراكك ✓', 'Signed in with your subscription ✓')));
        else if (job?.state === 'failed') toast(esc(A('الخطوة ماكملتش — شوف المخرجات', 'That step did not finish — see the output')));
      }
      render();
    } catch { /* the next poll retries */ }
  }
  async function machinePost(action, body) {
    machineUi.busy = action; machineUi.verifyError = null; render();
    try {
      const result = await post(`/api/machine/${action}`, JSON.stringify(body ?? {}), { 'Content-Type': 'application/json' });
      if (result.job && machineInfo?.data) machineInfo.data.job = result.job;
      if (result.verified) {
        await loadMachine(); await loadReadiness();
        toast(esc(result.verified.ok ? A('Codex رد ومتوصّل باشتراكك ✓', 'Codex answered on your subscription ✓') : A('الاتصال ماتمّش — شوف السبب', 'The connection test failed — see why')));
      }
      machineUi.open = null; machineUi.ack = false;
      syncMachinePolling();
    } catch (e) {
      if (e.data?.status && machineInfo) machineInfo.data = e.data.status;
      machineUi.verifyError = why(e);
    } finally { machineUi.busy = null; render(); }
  }
  function agentSetupCard() {
    if (readOnly) return '';
    if (!machineInfo) return `<div class="tw:mb-3 tw:rounded-card tw:bg-bg-2 tw:px-4 tw:py-3"><p class="small muted">${A('بيفحص الجهاز…', 'Checking this machine…')}</p></div>`;
    if (machineInfo.error) return `<p class="small warn">${esc(machineInfo.error)}</p>`;
    const m = machineInfo.data;
    const c = m.codex;
    const job = m.job;
    const running = job?.state === 'running';
    if (job?.state === 'cancelling') return `<div class="tw:mb-4" data-agent-setup><p class="small muted">${A('بيلغي الخطوة الحالية…', 'Cancelling the current step…')}</p></div>`;
    const row = (ok, label, detail) => `<li class="tw:flex tw:items-baseline tw:gap-2 tw:py-1"><span class="${ok === true ? 'tw:text-palm' : ok === false ? 'tw:text-clay' : 'tw:text-muted'}" aria-hidden="true">${ok === true ? '✓' : ok === false ? '✕' : '○'}</span><span class="tw:font-medium">${label}</span><span class="tiny muted grow">${detail}</span></li>`;
    const login = c.login;
    const loginText = !c.cli ? '—' : login.method === 'chatgpt' ? A('باشتراك ChatGPT', 'ChatGPT subscription') : login.method === 'api-key' ? A('بمفتاح API — مش مدعوم؛ ادخل باشتراك ChatGPT', 'with an API key — not supported; sign in with ChatGPT') : A('مش داخل', 'not signed in');
    const v = c.verified;
    const verifyText = v ? (v.ok ? `${A('رد', 'answered')} · ${esc(v.auth?.label ?? 'ChatGPT')} · ${ago(v.at)}` : esc(v.message ?? v.code)) : A('لسه ماتجرّبش', 'not tested yet');
    const plan = c.install;
    // One next step at a time, in order: install → sign in → test.
    let next = '';
    if (running && job.kind === 'install') {
      next = `<div class="tw:mt-3"><p class="small">⏳ ${A('بيسطّب…', 'Installing…')}</p><pre class="cli tw:mt-2" dir="ltr">${esc(job.tail.split('\n').slice(-8).join('\n'))}</pre><button type="button" class="btn sm ghost tw:mt-2" data-machine="job/cancel">${A('إلغاء', 'Cancel')}</button></div>`;
    } else if (running && job.kind === 'login') {
      next = `<div class="tw:mt-3 tw:rounded-field tw:bg-dusk-soft tw:px-4 tw:py-3"><p class="small"><b>${A('كمّل تسجيل الدخول في المتصفح:', 'Finish signing in in your browser:')}</b></p>${job.url ? `<p class="tw:mt-2"><a class="btn sm go" href="${esc(job.url)}" target="_blank" rel="noopener noreferrer">${A('افتح صفحة تسجيل الدخول', 'Open the sign-in page')} ↗</a></p>` : `<p class="small muted tw:mt-1">${A('بيجهّز الرابط…', 'Getting the link…')}</p>`}${job.code ? `<p class="small tw:mt-2">${A('واكتب الكود ده:', 'Then enter this code:')} <b class="ltr tw:text-lg">${esc(job.code)}</b> <button type="button" class="btn sm ghost" data-copy="${esc(job.code)}" data-copy-what="text">${A('انسخ', 'Copy')}</button></p>` : ''}<p class="tiny muted tw:mt-2">${A('ده تسجيل الدخول بتاع Codex نفسه. YallaFlow مابيشوفش كلمة السر ولا أي توكن.', 'This is Codex’s own sign-in. YallaFlow never sees your password or any token.')}</p><button type="button" class="btn sm ghost tw:mt-1" data-machine="job/cancel">${A('إلغاء', 'Cancel')}</button></div>`;
    } else if (plan) {
      next = machineUi.open === 'install'
        ? `<div class="tw:mt-3 tw:rounded-field tw:border tw:border-line tw:px-4 tw:py-3"><p class="small"><b>${A('YallaFlow هيشغّل الأمر ده في حسابك:', 'YallaFlow will run this command in your account:')}</b></p><div class="row tw:mt-2"><code class="cli grow" dir="ltr">${esc(plan.command)}</code><button type="button" class="btn sm ghost" data-copy="${esc(plan.command)}">${A('انسخ', 'Copy')}</button></div>
          ${plan.writable
            ? `<p class="tiny muted tw:mt-2">${A('من غير sudo — npm بيسطّب في فولدر متاح ليك:', 'No sudo — npm installs into a folder you can write:')} <span class="ltr">${esc(plan.prefix)}</span></p><label class="small tw:mt-2 tw:flex tw:items-center tw:gap-2"><input type="checkbox" data-machine-ack ${machineUi.ack ? 'checked' : ''}> ${A('راجعت الأمر', 'I reviewed this command')}</label><div class="row tw:mt-3"><button type="button" class="btn sm go" data-machine="codex/install" data-plan="${esc(plan.planHash)}" ${machineUi.ack && !machineUi.busy ? '' : 'disabled'}>${A('سطّب', 'Install')}</button><button type="button" class="btn sm ghost" data-machine-close>${A('إلغاء', 'Cancel')}</button></div>`
            : `<p class="small tw:mt-2 tw:text-amber">${A('npm بيسطّب في فولدر اليوزر ده مايقدرش يكتب فيه، وYallaFlow مابيستخدمش sudo:', 'npm installs into a folder this user cannot write, and YallaFlow never uses sudo:')} <span class="ltr">${esc(plan.prefix ?? '')}</span></p><p class="tiny muted tw:mt-1">${A('شغّل الأمر بنفسك بـ Node متسطّب لليوزر بتاعك (زي nvm)، أو حدد npm prefix جوه فولدر البيت، وبعدين دوس «افحص الجهاز تاني».', 'Run the command yourself with a Node.js installed for your user (for example nvm), or set an npm prefix in your home folder, then press Rescan this machine.')}</p>`}</div>`
        : `<button type="button" class="btn sm go tw:mt-3" data-machine-open="install">${A('سطّب Codex', 'Install Codex')}</button>`;
    } else if (c.cli && login.method !== 'chatgpt') {
      next = machineUi.open === 'login'
        ? `<div class="tw:mt-3 tw:rounded-field tw:border tw:border-line tw:px-4 tw:py-3"><p class="small">${A('هنبدأ تسجيل الدخول بتاع Codex نفسه: هيظهر لك رابط رسمي وكود تكتبه في المتصفح. اشتراكك بس — من غير مفاتيح API، وYallaFlow مابيشوفش أي بيانات دخول.', 'This starts Codex’s own sign-in: you get an official link and a code to enter in your browser. Your subscription only — no API keys, and YallaFlow never sees credentials.')}</p><div class="row tw:mt-3"><button type="button" class="btn sm go" data-machine="codex/login" ${machineUi.busy ? 'disabled' : ''}>${A('ابدأ تسجيل الدخول', 'Start sign-in')}</button><button type="button" class="btn sm ghost" data-machine-close>${A('إلغاء', 'Cancel')}</button></div></div>`
        : `<button type="button" class="btn sm go tw:mt-3" data-machine-open="login">${A('ادخل باشتراك ChatGPT', 'Sign in with ChatGPT')}</button>`;
    } else if (c.installed) {
      next = `<button type="button" class="btn sm ${v?.ok ? 'ghost' : 'go'} tw:mt-3" data-machine="codex/verify" ${machineUi.busy ? 'disabled' : ''}>${machineUi.busy === 'codex/verify' ? A('بيجرّب…', 'Testing…') : v?.ok ? A('جرّب تاني', 'Test again') : A('جرّب الاتصال', 'Test the connection')}</button>`;
    }
    const claude = m.claude;
    const state = c.ready && v?.ok ? ['done', A('جاهز ومتجرّب', 'Ready · tested')] : c.ready ? ['active', A('جاهز', 'Ready')] : ['wait', A('محتاج إعداد', 'Needs setup')];
    return `<div class="tw:mb-4" data-agent-setup>
      <h3 class="tw:text-base tw:font-semibold">${A('على الجهاز ده', 'On this machine')}</h3>
      ${m.supportedPlatform ? '' : `<p class="small tw:text-amber">${A('الإعداد ده مدعوم على Linux وmacOS.', 'This setup is supported on Linux and macOS.')}</p>`}
      <div class="tw:mt-2 tw:grid tw:gap-3 tw:md:grid-cols-2">
        <section class="tw:rounded-card tw:border tw:border-line tw:bg-card tw:px-4 tw:py-3" aria-label="Codex"><div class="row"><b class="grow">Codex</b><span class="chip ${state[0]}"><i></i>${state[1]}</span></div>
          <ul class="tw:mt-2 tw:list-none tw:p-0">${row(Boolean(c.cli), A('البرنامج', 'Codex CLI'), c.cli ? `<span class="ltr">codex ${esc(c.cli.version ?? '')}</span>` : A('مش متسطّب', 'not installed'))}${row(Boolean(c.adapter) && !c.problems.some((x) => /not supported/.test(x)), A('الوصلة', 'Adapter'), c.adapter ? `<span class="ltr">codex-acp ${esc(c.adapter.version ?? '')}</span>` : A('مش متسطّبة', 'not installed'))}${row(!c.cli ? null : login.method === 'chatgpt', A('تسجيل الدخول', 'Sign-in'), loginText)}${row(v ? v.ok : null, A('الاتصال', 'Connection'), verifyText)}</ul>
          ${c.tested ? `<p class="tiny muted tw:mt-2">${A('متجرّب مع', 'Tested with')} <span class="ltr">codex ${esc(c.tested.cli)} · codex-acp ${esc(c.tested.adapter)}</span>${c.installed && !c.matchesTested ? ` — ${A('النسخ المتسطّبة مختلفة؛ ممكن تشتغل، بس دي اللي اتجرّبت.', 'the installed versions differ; they may work, but these are the tested ones.')}` : ''}</p>` : ''}
          ${next}${machineUi.verifyError ? `<p class="small tw:mt-2 tw:text-clay" role="alert" dir="auto">${esc(machineUi.verifyError)}</p>` : ''}</section>
        <section class="tw:rounded-card tw:border tw:border-line tw:bg-card tw:px-4 tw:py-3" aria-label="Claude Code"><div class="row"><b class="grow">Claude Code</b><span class="chip wait">${A('تجريبي', 'Experimental')}</span></div>
          <ul class="tw:mt-2 tw:list-none tw:p-0">${row(claude.installed ? true : null, A('البرنامج', 'Claude Code CLI'), claude.installed ? `<span class="ltr">claude ${esc(claude.version ?? '')}</span>` : A('مش متسطّب', 'not installed'))}${claude.auth ? row(claude.auth.loggedIn && claude.auth.method === 'claude.ai', A('تسجيل الدخول', 'Sign-in'), claude.auth.loggedIn ? `<span class="ltr">${esc(claude.auth.method ?? '')}${claude.auth.plan ? ` (${esc(claude.auth.plan)})` : ''}</span>` : A('مش داخل', 'not signed in')) : ''}</ul>
          ${claude.connectionIncluded && claude.warnings?.length ? claudeWarnings({ warnings: claude.warnings }) : ''}<p class="tiny muted tw:mt-2">${claude.connectionIncluded ? A('التوصيل التجريبي موجود في النسخة دي (نسخة تطوير) — إعداده تحت.', 'The experimental connection is in this build (a development build) — set it up below.') : A('توصيل الكونسول بـ Claude Code تجريبي ومش جزء من النسخة دي. تقدر تستخدم Claude Code في الترمينال، وهو بيتبع YallaFlow من CLAUDE.md.', 'The console connection to Claude Code is experimental and not part of this release. You can use Claude Code in your terminal; it follows YallaFlow through CLAUDE.md.')}</p></section>
      </div>
      <p class="tiny muted tw:mt-2">${A('اشتراكك بس، من غير مفاتيح API. أي تسطيب أو تسجيل دخول بيستنى موافقتك، ومن غير sudo.', 'Your subscription only, never API keys. Every install or sign-in waits for your approval and never uses sudo.')}</p></div>`;
  }
  // First open: one quiet, dismissible line when Codex is not ready on this machine.
  function agentStrip() {
    const m = machineInfo?.data;
    if (readOnly || !m || m.codex.ready) return '';
    const key = `${m.codex.cli ? 1 : 0}${m.codex.adapter ? 1 : 0}${m.codex.login.method ?? 'none'}`;
    if (store.get('agentStripDismissed', '') === key) return '';
    const text = !m.codex.installed ? A('Codex مش متسطّب على الجهاز ده.', 'Codex is not installed on this machine.') : A('Codex محتاج تسجيل دخول باشتراكك.', 'Codex needs a sign-in with your subscription.');
    return `<div class="tw:mb-3 tw:flex tw:flex-wrap tw:items-center tw:gap-3 tw:rounded-field tw:bg-dusk-soft tw:px-4 tw:py-2" role="status"><span class="grow small">${text} ${A('الوكلاء محتاجينه عشان يشتغلوا من الكونسول.', 'Agents need it to work from the console.')}</span><a class="btn sm go" href="#/setup">${A('جهّز Codex', 'Set up Codex')}</a><button type="button" class="ibtn" data-agent-strip-dismiss="${esc(key)}" aria-label="${A('اقفل', 'Dismiss')}">✕</button></div>`;
  }
  function agentsSection() {
    if (!agentSetup || agentSetup.pid !== pid) return `<section class="panel setupsec" id="setup-agents"><p class="muted">${A('بيقرا الوكلاء…', 'Reading agents…')}</p></section>`;
    if (agentSetup.error) return `<section class="panel setupsec" id="setup-agents"><p class="small warn">${esc(agentSetup.error)}</p></section>`;
    const d = agentSetup.data;
    const tick = (ok, label, fix) => `<li class="${ok ? 'ok' : 'no'}"><span aria-hidden="true">${ok ? '✓' : '✗'}</span> ${label}${!ok && fix ? `<span class="tiny muted"> — ${fix}</span>` : ''}</li>`;
    const prov = (name, x) => x ? `<tr><td><b>${name}</b></td><td class="ltr">${esc(x.version ?? '—')}</td><td>${x.auth ? esc(x.auth.loggedIn ? `${x.auth.method ?? ''}${x.auth.plan ? ` (${x.auth.plan})` : ''}` : A('مش مسجّل دخول', 'not logged in')) : `<span class="tiny muted">${A('بيتأكد أول ما الجلسة تبدأ', 'checked when a session starts')}</span>`}</td><td>${x.ready ? `<span class="chip done"><i></i>${A('جاهز', 'ready')}</span>` : `<span class="chip wait">${A('مش جاهز', 'not ready')}</span>`}</td></tr>${x.problems?.length ? `<tr><td></td><td colspan="3"><ul class="aprob">${x.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></td></tr>` : ''}` : '';
    const c = d.checklist;
    const launch = setupLaunch ?? d.launchCommand ?? null;
    const modeOk = c?.modeState === 'allowed' || c?.modeState === 'auto-approves';
    const checklist = (d.claude ? claudeWarnings(d.claude) : '') + (c ? `<h3 style="font-size:15px;margin-top:12px">${A('اتصال Claude Code', 'Claude Code connection')}</h3><ul class="checklist small">
      ${tick(Boolean(d.claude?.ready), A('Claude Code جاهز (متثبّت، إصدار مناسب، تسجيل دخول بالاشتراك)', 'Claude Code ready (installed, recent enough, subscription login)'), A('شوف المشاكل فوق.', 'See the problems above.'))}
      ${tick(c.owner, A('الكونسول ده ماسك المشروع', 'This console owns the checkout'), esc(c.lockedBy ?? A('اقفل الكونسول التاني.', 'Close the other console.')))}
      ${tick(c.launchFiles, A('ملفات التشغيل مكتوبة', 'Launch files written'), A('دوس «اكتب ملفات التشغيل».', 'Press Write launch files.'))}
      ${tick(c.channelConnected, A('القناة متوصّلة', 'Channel connected'), c.launchFiles ? A('شغّل الأمر تحت في ترمينال في فولدر المشروع.', 'Run the command below in a terminal in the project folder.') : A('اكتب ملفات التشغيل الأول.', 'Write the launch files first.'))}
      ${tick(Boolean(c.lastHookAt), A('الـ hooks بتبلّغ', 'Hooks reporting'), A('بيحصل أول ما Claude Code يبدأ بالرسالة الأولى.', 'Happens as soon as Claude Code starts with its first message.'))}
      ${tick(modeOk, c.mode ? A(`وضع الأذونات: ${esc(c.mode)}${c.modeState === 'auto-approves' ? ' (بيوافق لوحده على أغلب الأفعال)' : ''}`, `Permission mode: ${esc(c.mode)}${c.modeState === 'auto-approves' ? ' (approves most actions itself)' : ''}`) : A('وضع الأذونات معروف', 'Permission mode known'), c.modeState === 'refused' ? A('وضع بيتخطّى كل الأذونات، غيّره في Claude Code.', 'A mode that skips every permission; change it in Claude Code.') : A('بيتعرف من أول رسالة.', 'Known from the first message.'))}
      </ul>${readOnly ? '' : `<div class="row" style="margin-top:8px"><button class="btn sm ${c.launchFiles ? 'ghost' : 'go'}" data-agents-launch ${setupBusy ? 'disabled' : ''}>${c.launchFiles ? A('اكتب ملفات التشغيل تاني', 'Rewrite launch files') : A('اكتب ملفات التشغيل', 'Write launch files')}</button></div>`}
      ${launch && !c.channelConnected ? `<p class="small" style="margin-top:8px">${A('شغّل الأمر ده في ترمينال جوه فولدر المشروع، ومتكتبش حاجة بعده:', 'Run this in a terminal inside the project folder, and type nothing after it:')}</p>` : ''}${launch ? `<pre class="cli" dir="ltr">${esc(launch)}</pre><button class="btn sm ghost" data-copy="${esc(launch)}">${A('انسخ', 'Copy')}</button>` : ''}` : '');
    const form = readOnly ? `<p class="small muted">${A('الكونسول ده للقراءة بس.', 'This console is read-only.')}</p>` : `<form class="wizform" data-agents-settings style="margin-top:8px">
      <label class="small"><input type="checkbox" name="agents" ${d.saved?.agents || (!d.saved?.chosen && d.applied?.agents) ? 'checked' : ''}> <b>${A('الوكلاء للمشروع ده (Codex)', 'Agents for this project (Codex)')}</b></label>
      ${d.claudeAvailable ? `<label class="small"><input type="checkbox" name="claude" ${d.saved?.claude || d.applied?.claude ? 'checked' : ''}> <b>${A('كمان Claude Code (تجريبي)', 'Also Claude Code (experimental)')}</b> <span class="tiny muted">${A('بتشغّله بنفسك في الترمينال؛ مفيش Stop من الكونسول؛ موافقة Anthropic المكتوبة لسه مستنيينها.', 'You start it yourself in a terminal; no Stop from the console; Anthropic\'s written answer is still pending.')}</span></label>` : ''}
      <div class="row"><button class="btn go sm" type="submit" ${setupBusy ? 'disabled' : ''}>${setupBusy === 'agents' ? A('بيحفظ…', 'Saving…') : A('احفظ للمشروع ده', 'Save for this project')}</button><span class="tiny muted">${A('بيتحفظ في .yallaflow/local (مش بيتعمله commit) وبيتطبّق كل ما الكونسول يفتح. قفل الوكلاء بيتطبّق من التشغيل الجاي للكونسول؛ قفل Claude Code بيتطبّق على طول.', 'Saved in .yallaflow/local (not committed) and applied whenever the console opens. Turning agents off applies from the next console start; turning Claude Code off applies at once.')}</span></div>
      ${d.saved?.error ? `<p class="tiny warn">${esc(d.saved.error)}</p>` : ''}</form>`;
    return `<section class="panel setupsec" id="setup-agents"><div class="row"><h2 style="font-size:18px" class="grow">${A('الوكلاء', 'Agents')}</h2><button class="btn sm ghost" data-agents-rescan ${setupBusy ? 'disabled' : ''}>${setupBusy === 'rescan' ? A('بيفحص…', 'Checking…') : A('افحص الجهاز تاني', 'Rescan this machine')}</button></div>
      ${readOnly || !machineInfo?.data ? `<div class="tablewrap"><table><thead><tr><th>${A('الوكيل', 'Agent')}</th><th>${A('الإصدار', 'Version')}</th><th>${A('تسجيل الدخول', 'Login')}</th><th>${A('الحالة', 'State')}</th></tr></thead><tbody>${prov('Codex', d.codex)}${d.claude ? prov(A('Claude Code (تجريبي)', 'Claude Code (experimental)'), d.claude) : d.claudeAvailable ? `<tr><td><b>${A('Claude Code (تجريبي)', 'Claude Code (experimental)')}</b></td><td colspan="3" class="tiny muted">${A('ماتفحصش لسه. دوس «افحص الجهاز تاني» أو اختاره تحت.', 'Not checked yet. Press Rescan this machine, or choose it below.')}</td></tr>` : ''}</tbody></table></div>` : agentSetupCard()}
      ${readOnly || !machineInfo?.data ? `<p class="tiny muted">${A('اشتراكك بس، من غير مفاتيح API. YallaFlow مابيقراش أي بيانات دخول.', 'Your subscription only, never API keys. YallaFlow reads no credentials.')}</p>` : `<h3 class="tw:text-base tw:font-semibold tw:mt-2">${A('للمشروع ده', 'For this project')}</h3>`}${form}${approvalWaitForm(d)}${checklist}</section>`;
  }
  // PF-0112 D15: how long an agent's approval request waits for you in this project.
  function approvalWaitForm(d) {
    if (readOnly || !d.approvalWait) return '';
    const current = d.approvalWait.minutes;
    return `<div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap"><label class="small">${A('طلب الموافقة يستنى', 'An approval request waits')} <select data-approval-wait>${[5, 15, 30, 60].map((m) => `<option value="${m}" ${m === current ? 'selected' : ''}>${A(`${m} دقيقة`, `${m} minutes`)}</option>`).join('')}</select></label><span class="tiny muted">${A('بعدها بيترفض تلقائي، عمره ما بيتوافق عليه لوحده.', 'Then it is denied automatically — never approved on its own.')}</span>${d.approvalWait.error ? `<span class="tiny warn">${esc(d.approvalWait.error)}</span>` : ''}</div>`;
  }

  function viewSetup() {
    if (!runtime || runtime.pid !== pid) return `<p class="muted" style="margin-top:30px">${A('بيقرا خدمات التشغيل…', 'Reading runtime services…')}</p>`;
    if (runtime.error) return `<section class="errbar data" role="alert"><b>${A('مقدرناش نقرا خدمات التشغيل', 'Runtime services could not be read')}</b><p class="small">${esc(runtime.error)}</p></section>`;
    const r = runtime.data;
    const configured = r.services.length > 0;
    const head = `<section class="pagehead"><h1 style="font-size:26px">${A('الإعداد والتشغيل', 'Setup & run')}</h1><p class="muted">${configured ? A('شغّل ووقّف المشروع وافتح تطبيقاته. الإعدادات (الخدمات، الـ stack، الوكلاء) تحت في «الإعدادات».', 'Start and stop the project and open its apps. Configuration (services, stack, agents) is below under Configuration.') : A('جهّز الوكيل الأول. تشغيل التطبيق من هنا اختياري: اعرف خدماته، احفظها ووثّقها، وبعدها شغّل ووقّف من هنا. مفيش حاجة بتشتغل لوحدها، وYallaFlow بيوقف بس اللي هو شغّله.', 'Set up the agent first. Running the app from here is optional: find its services, save and trust them, then start and stop it here. Nothing runs on its own, and YallaFlow stops only what it started.')}</p></section>`;
    if (!r.supported) return head + setupGuide() + stackSection() + `<section class="panel"><p>${A('مدير التشغيل مدعوم على Linux وmacOS بس.', 'The runtime manager supports Linux and macOS only.')}</p></section>` + agentsSection();
    const profileErr = r.profile.error ? `<section class="errbar data" role="alert"><b>${A('ملف التشغيل فيه مشكلة', 'The runtime profile is invalid')}</b><p class="small">${esc(r.profile.error)}</p></section>` : '';
    const add = readOnly ? '' : `<details class="panel setupsec" data-sx="add" ${sxOpen('add', false)}><summary><b>${A('ضيف خدمة بنفسك', 'Add a service yourself')}</b></summary>
      <form class="wizform" data-rt-form data-keep="rt-${esc(pid)}" style="margin-top:10px">
        <div class="twocol"><label>${A('الاسم', 'Name')}<input name="name" required maxlength="60" placeholder="Web"></label><label>${A('المعرّف', 'Id')} <span class="tiny muted">(a-z 0-9 -)</span><input class="ltr" name="id" required pattern="[a-z][a-z0-9-]{0,31}" placeholder="web"></label></div>
        <div class="twocol"><label>${A('النوع', 'Kind')}<select name="kind"><option value="process">${A('أمر (process)', 'Command (process)')}</option><option value="docker-compose">Docker Compose</option></select></label><label>${A('فولدر التشغيل (جوه المشروع)', 'Working folder (inside the project)')}<input class="ltr" name="cwd" value="."></label></div>
        <label>${A('الأمر', 'Command')} <span class="tiny muted">${A('(البرنامج والوسائط، من غير shell)', '(program and arguments, no shell)')}</span><input class="ltr mono" name="command" required placeholder="npm run dev"></label>
        <div class="twocol"><label>${A('المنافذ', 'Ports')} <span class="tiny muted">${A('(مفصولة بفاصلة)', '(comma separated)')}</span><input class="ltr" name="ports" placeholder="5173"></label><label>${A('أسماء متغيرات البيئة', 'Environment variable names')} <span class="tiny muted">${A('(أسماء بس، القيم بتفضل عندك)', '(names only; values stay with you)')}</span><input class="ltr" name="env" placeholder="API_URL"></label></div>
        <label class="small"><input type="checkbox" name="local"> ${A('على الجهاز ده بس (مش متشاركة في المستودع)', 'This machine only (not shared in the repository)')}</label>
        <div class="row"><button class="btn go sm" type="submit">${A('ضيف الخدمة', 'Add the service')}</button><span class="tiny muted">${A('الإضافة مابتشغّلش حاجة.', 'Adding runs nothing.')}</span></div>
        ${runtimeErr.__add ? `<p class="small" role="alert" style="color:var(--clay);white-space:pre-wrap">${esc(runtimeErr.__add)}</p>` : ''}</form></details>`;
    const sugg = r.suggestions.length ? `<details class="panel setupsec" data-sx="sugg" ${sxOpen('sugg')}><summary><b>${A(`اقتراحات تانية من ملفات المشروع (${r.suggestions.length})`, `Other suggestions from repository files (${r.suggestions.length})`)}</b></summary><p class="tiny muted">${A('الاقتراحات مابتشتغلش. ضيفها، راجعها، ووثّقها — التشغيل خطوة منفصلة.', 'Suggestions never run. Add one, review it, then trust it — starting is a separate step.')}</p><ul class="modules">${r.suggestions.map((x) => `<li><b>${esc(x.name)}</b> <span class="ltr mono small">${esc(x.command.join(' '))}</span> <span class="tiny muted">${A('من', 'from')} <span class="ltr">${esc(x.evidence.join(', '))}</span></span>${x.note ? `<p class="tiny muted">${esc(suggestionNote(x.note))}</p>` : ''}${readOnly ? '' : `<div class="row" style="margin-top:6px"><button class="btn sm" data-rt-suggest="${esc(x.id)}">${A('ضيف الخدمة دي', 'Add this service')}</button></div>`}</li>`).join('')}</ul></details>` : '';
    const dev = devPanel(A('أوامر التشغيل', 'Runtime commands'), ['yallaflow runtime analyze', 'yallaflow runtime plan show', 'yallaflow runtime plan save <id>...', 'yallaflow runtime review <id>', 'yallaflow runtime status', 'yallaflow runtime suggest', 'yallaflow runtime add <id> --cwd DIR --port N -- <executable> [args...]', 'yallaflow runtime trust <id>', 'yallaflow runtime start|stop|restart <id>', 'yallaflow runtime start --all', 'yallaflow runtime stop --all', 'yallaflow runtime logs <id>']);
    // PF-0123: agents first while the app is not set up (the plan can ask the agent); the manual
    // add form and the stack table are advanced and stay folded.
    const config = configured ? planSection(r) + sugg + add + stackSection() + agentsSection() : agentsSection() + planSection(r) + sugg + add + stackSection();
    // Not configured yet: the guided flow is the page. Configured: Run first, the rest folded away.
    if (!configured) return head + profileErr + setupGuide() + config + dev;
    const rows = `<div class="svcrows">${r.services.map(serviceCard).join('')}</div>`;
    return head + profileErr + runSection(r, rows) + setupGuide()
      + `<details class="cfgwrap" id="setup-config" data-sx="configure" ${sxOpen('configure')}><summary><span class="grow"><b>${A('الإعدادات', 'Configuration')}</b> <span class="tiny muted">${A('اعرف وضيف خدمات، الـ stack، الوكلاء', 'find and add services, stack, agents')}</span></span></summary>${config}</details>` + dev;
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
      // Trust is bound to the exact configuration shown in the review (PF-0072); a change in
      // between is refused by Core, and nothing is trusted without the review on screen.
      const panel = document.querySelector(`[data-review="${CSS.escape(id)}"]`);
      body = { confirmed: Boolean(panel?.querySelector('[data-trust-input]')?.checked), definitionHash: panel?.dataset.reviewHash ?? '' };
    }
    if (action === 'shared-stop' || action === 'shared-restart') {
      body = { confirmedShared: Boolean(document.querySelector(`[data-shared-input="${CSS.escape(id)}"]`)?.checked) };
      action = action === 'shared-stop' ? 'stop' : 'restart';
    }
    runtimeBusy[id] = action; runtimeErr[id] = null; render();
    try {
      await post(`/api/p/${pid}/runtime/${encodeURIComponent(id)}/${action}`, JSON.stringify(body), { 'Content-Type': 'application/json' });
      if (action === 'trust') delete runtimeReview[id];
      delete sharedAsk[id];
    } catch (e) {
      if (e.code === 'RUNTIME_SHARED' && e.data?.shared) sharedAsk[id] = { action, reasons: e.data.shared.reasons ?? [], scope: e.data.shared.scope ?? [] };
      else runtimeErr[id] = e.message;
      if (action === 'trust') await loadReview(id);
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
    if (want && !runtimeTimer) runtimeTimer = setInterval(async () => { if (Object.values(runtimeBusy).some(Boolean)) return; await Promise.all([loadRuntime(), checkAgentPlan()]); if (route().v === 'setup' && !document.activeElement?.matches?.('[data-trust-input], [data-shared-input], [data-plan-pick]') && !rtFormBusy()) render(); }, 3000);
    if (!want && runtimeTimer) { clearInterval(runtimeTimer); runtimeTimer = null; }
  }

  // ---------- new project (1.4.0, PF-0057): a four-step stepper ----------
  // 1 Idea → 2 Stack → 3 Environment → 4 Review & create. The plan is created when step 4
  // opens and is immutable; Create sends its full hash (a changed plan is refused). A plan
  // that installs dependencies also needs one explicit acknowledgement (PF-0085). Attachments are listed in
  // the plan by size and SHA-256 and uploaded to the first work item after creation. The
  // server registers the new project in the console; the page then switches to it.
  let wiz = { step: 1, catalog: null, tools: null, form: null, files: [], plan: null, error: null, busy: false, progress: null, acknowledged: false, attach: null, registration: null, ready: null };
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
  // PF-0087: the catalog's descriptions in Arabic (the catalog itself stays English for the CLI).
  const STACK_AR = {
    laravel: { fit: 'Full-stack بـ PHP: الراوتنج وقاعدة البيانات (Eloquent) واختيارات تسجيل الدخول والـ queues وصفحات Blade، كله في فريمورك واحد.', tradeoffs: 'محتاج PHP 8.3 أو أحدث وComposer على جهازك (أو Docker بعدين). بيسطّب مكتباته وهو بيتعمل، فالإنشاء بياخد وقت أطول ومحتاج إنترنت.' },
    'react-vite': { fit: 'تطبيق React صفحة واحدة بـ TypeScript وسيرفر تطوير سريع. الخادم بتختاره لوحده.', tradeoffs: 'واجهة بس: مفيش خادم ولا قاعدة بيانات ولا تسجيل دخول. تسطيب المكتبات خطوة منفصلة واختيارية.' },
    'vue-vite': { fit: 'تطبيق Vue صفحة واحدة بـ TypeScript وسيرفر تطوير سريع. الخادم بتختاره لوحده.', tradeoffs: 'واجهة بس: مفيش خادم ولا قاعدة بيانات ولا تسجيل دخول. تسطيب المكتبات خطوة منفصلة واختيارية.' },
    nextjs: { fit: 'React مع رندر على السيرفر وAPI routes والـ App Router في مشروع Node.js واحد.', tradeoffs: 'Full-stack بـ JavaScript/TypeScript. قاعدة البيانات وتسجيل الدخول بيتضافوا بعدين. تسطيب المكتبات خطوة منفصلة واختيارية.' },
    nestjs: { fit: 'خادم API منظّم بـ Node.js، فيه modules وdependency injection والاختبارات جاهزة.', tradeoffs: 'خادم بس: محتاج واجهة معاه. قاعدة البيانات بتتضاف بعدين. تسطيب المكتبات خطوة منفصلة واختيارية.' },
    empty: { fit: 'فولدر فاضي وفيه YallaFlow: اوصف المنتج الأول، واختار الـ stack مع وكيلك بعدين.', tradeoffs: 'مفيش كود ومفيش أوامر بتشتغل. الـ stack بتضيفه بعدين.' }
  };
  const stackText = (c, key) => (lang === 'ar' && STACK_AR[c.id]?.[key]) || c[key];
  const ENV = {
    docker: { t: { ar: 'Docker', en: 'Docker' }, d: { ar: 'هنسجّل إنك عايز تشتغل بـDocker. مفيش ملفات Docker بتتعمل دلوقتي، وهتضبطها بعدين من «التشغيل».', en: 'Records that you want to develop with Docker. No Docker files are created now; you set them up later in Setup.' }, tools: ['docker', 'docker-compose'] },
    local: { t: { ar: 'أدوات على جهازك', en: 'Local tools' }, d: { ar: 'هتشغّل المشروع بالأدوات المتسطّبة عندك. بعد الإنشاء، «التشغيل» بيقترح أوامر من ملفات المشروع وانت بتراجعها.', en: 'Run the project with tools installed on this machine. After creation, Setup suggests commands from the project files for you to review.' }, tools: ['node', 'npm', 'php', 'composer'] },
    later: { t: { ar: 'أقرر بعدين', en: 'Decide later' }, d: { ar: 'مفيش حاجة بتتسجّل للبيئة دلوقتي. تقدر تضبطها في أي وقت.', en: 'Nothing about the environment is recorded now. You can configure it at any time.' }, tools: [] }
  };
  const wizForm = () => (wiz.form ??= { name: '', description: '', requirements: '', parent: parentGuess(), stack: 'empty', environment: 'later', git: true, install: false, allowNested: false, agent: 'none' });
  // PF-0086: the agent for the new project. Personal to this machine, so it is not part of the
  // plan; it is saved for the project right after creation. No session starts on its own.
  const AGENT_CHOICE = {
    none: { t: { ar: 'من غير وكيل دلوقتي', en: 'No agent for now' }, d: { ar: 'تقدر تختاره بعدين من «التشغيل».', en: 'You can choose one later in Setup.' } },
    codex: { t: { ar: 'Codex', en: 'Codex' }, d: { ar: 'باشتراك ChatGPT بتاعك، من غير مفاتيح API. بتبدأ الجلسة من صفحة أول شغلانة.', en: 'On your ChatGPT subscription, never API keys. You start the session from the first work item.' } },
    claude: { t: { ar: 'Claude Code (تجريبي)', en: 'Claude Code (experimental)' }, d: { ar: 'باشتراكك في Claude. بتشغّله في الترمينال بالأمر اللي هيظهر، وبعدها الشات بيشتغل من الكونسول.', en: 'On your Claude subscription. You start it in a terminal with the command shown; then the chat works from the console.' } }
  };
  const agentChoices = () => ['none', 'codex', ...(agentsClaudeAvailable ? ['claude'] : [])];
  function agentReady(k) {
    if (k === 'none' || !agentInfo) return '';
    const p = k === 'codex' ? agentInfo.codex : agentInfo.claudeCode;
    if (!p) return '';
    return p.ready ? `<span class="chip done"><i></i>${A('جاهز على الجهاز ده', 'ready on this machine')}</span>` : `<span class="chip wait" data-tip="${esc((p.problems ?? []).join(' · '))}">${A('مش جاهز — هتلاقي الحل في الإعداد', 'not ready — Setup shows how to fix it')}</span>`;
  }
  // Same rule as the server: installing dependencies or running package scripts needs an explicit
  // acknowledgement (PF-0085: one checkbox).
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
        const picked = (id) => (f.customStack ? id === 'custom' : f.stack === id);
        const custom = cat === 'blank' ? `<label class="stackcard ${picked('custom') ? 'on' : ''}"><input type="radio" name="wiz-stack" value="custom" ${picked('custom') ? 'checked' : ''}><b>${A('حاجة تانية', 'Something else')}</b><span class="tiny muted">${A('اكتب الـ stack اللي عايزه', 'name the stack you want')}</span><span class="small">${A('مثلاً Flutter أو Django أو FastAPI. المشروع بيتعمل فاضي، ووكيلك بيجهّز الـ stack في أول شغلانة بعد ما توافق على طريقته.', 'For example Flutter, Django or FastAPI. The project starts empty, and your agent sets the stack up in the first work item after you approve how.')}</span><input class="ltr" name="customStack" maxlength="120" placeholder="Flutter" value="${esc(f.customStack ?? '')}" aria-label="${A('الـ stack اللي عايزه', 'The stack you want')}"><span class="tiny muted">⚖ ${A('مفيش أوامر بتشتغل وقت الإنشاء.', 'No command runs at creation.')}</span></label>` : '';
        return `<fieldset class="stackgroup"><legend>${L(CAT[cat])}</legend><div class="stackgrid">${list.map((c) => `<label class="stackcard ${picked(c.id) ? 'on' : ''}"><input type="radio" name="wiz-stack" value="${esc(c.id)}" ${picked(c.id) ? 'checked' : ''}><b>${esc(c.label)}</b><span class="tiny muted">${esc(c.stack.join(' · ') || A('من غير كود', 'no code'))}</span>${c.fit ? `<span class="small">${esc(stackText(c, 'fit'))}</span>` : ''}${c.tradeoffs ? `<span class="tiny muted">⚖ ${esc(stackText(c, 'tradeoffs'))}</span>` : ''}<span class="row tiny">${c.network ? `<span class="chip wait">${A('محتاج إنترنت', 'needs network')}</span>` : ''}</span></label>`).join('')}${custom}</div></fieldset>`;
      }).join('');
      return head + stepper() + err + `<form class="panel wizform" data-wiz-step="2" data-keep="wiz-2">
        <p class="small">${A('اختار التقنية بنفسك. تقدر تغيّرها لحد ما تأكد الإنشاء.', 'Choose the stack yourself. You can change it until you confirm creation.')}</p>${groups}
        <p class="tiny muted" style="margin-top:8px">ⓘ ${A('مش متأكد؟ اختار «مشروع فاضي»، واختار وكيل في خطوة البيئة، واسأله بعد الإنشاء.', 'Not sure? Choose the empty project, pick an agent in the Environment step, and ask it after creation.')}</p>
        ${navRow(true)}</form>`;
    }
    if (wiz.step === 3) {
      loadTools();
      if (!agentInfo && !wiz.agentsLoading) { wiz.agentsLoading = true; loadAgentInfo().then(() => { if (route().v === 'new') render(); }); }
      const st = stackOf(f.stack);
      const tool = (id) => wiz.tools?.tools.find((t) => t.id === id);
      const toolChips = (ids) => ids.map((id) => { const t = tool(id); return !wiz.tools ? `<span class="tag">${esc(id)} …</span>` : `<span class="chip ${t?.found ? 'done' : 'wait'}" title="${esc(t?.version ?? '')}"><i></i>${esc(id)} ${t?.found ? `<span class="ltr tiny">${esc((/\d+(?:\.\d+){1,2}/.exec(t.version) ?? [A('موجود', 'found')])[0])}</span>` : A('مش موجود', 'not found')}</span>`; }).join(' ');
      const envs = ['docker', 'local', 'later'].map((k) => `<label class="stackcard ${f.environment === k ? 'on' : ''}"><input type="radio" name="wiz-env" value="${k}" ${f.environment === k ? 'checked' : ''}><b>${L(ENV[k].t)}</b><span class="small">${L(ENV[k].d)}</span>${ENV[k].tools.length ? `<span class="row tiny">${toolChips(ENV[k].tools)}</span>` : ''}</label>`).join('');
      return head + stepper() + err + `<form class="panel wizform" data-wiz-step="3" data-keep="wiz-3">
        <fieldset><legend>${A('بيئة التطوير', 'Development environment')}</legend><div class="stackgrid">${envs}</div><p class="tiny muted">${A('YallaFlow بيفحص الأدوات بس، مابيسطّبش ولا بيشغّل حاجة.', 'YallaFlow only checks for tools; it installs and runs nothing.')}</p></fieldset>
        <fieldset><legend>Git</legend><label class="small"><input type="checkbox" name="git" ${f.git ? 'checked' : ''}> ${A('اعمل Git repository محلي', 'Initialize a local Git repository')} ${toolChips(['git'])}</label>
          <p class="tiny muted">${A('بيعمل git init بس: من غير remote ولا commit ولا push. ربطه بـGitHub أو غيره خطوة منفصلة بتعملها انت.', 'Runs git init only: no remote, no commit, no push. Connecting it to GitHub or another remote is a separate step you take yourself.')}</p></fieldset>
        ${st?.install ? `<fieldset><legend>${A('المكتبات', 'Dependencies')}</legend><label class="small"><input type="checkbox" name="install" ${f.install ? 'checked' : ''}> ${A('سطّب المكتبات بعد الإنشاء', 'Install dependencies after creation')} <span class="ltr tiny mono">${esc(st.install.join(' '))}</span></label><p class="tiny muted">${A('بيحتاج إنترنت وبيشغّل سكريبتات الحزم، فهتأكد عليه قبل الإنشاء.', 'Needs the network and runs package scripts, so you will confirm it before creation.')}</p></fieldset>` : ''}
        <fieldset><legend>${A('الوكيل', 'Agent')}</legend><div class="stackgrid">${agentChoices().map((k) => `<label class="stackcard ${f.agent === k ? 'on' : ''}"><input type="radio" name="wiz-agent" value="${k}" ${f.agent === k ? 'checked' : ''}><b>${L(AGENT_CHOICE[k].t)}</b><span class="small">${L(AGENT_CHOICE[k].d)}</span><span class="row tiny">${agentReady(k)}</span></label>`).join('')}</div><p class="tiny muted">${A('الاختيار بيتحفظ للمشروع ده على الجهاز ده بس. الوكيل بيتربط، ومفيش جلسة بتبدأ لوحدها.', 'The choice is saved for this project on this machine only. The agent is connected; no session starts on its own.')}</p></fieldset>
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
    const wont = [A('مفيش حاجة موجودة بتتكتب فوقها', 'Nothing existing is overwritten'), A('مفيش remote ولا commit ولا push', 'No remote, commit or push'), (wizForm().agent ?? 'none') === 'none' ? A('مفيش خدمات بتشتغل ولا وكيل بيبدأ', 'No services run and no agent starts') : A('مفيش خدمات بتشتغل، والوكيل بيتربط بس ومابيبدأش جلسة لوحده', 'No services run; the agent is connected but starts no session on its own'), ...(b.environment === 'docker' ? [A('مفيش ملفات Docker لسه', 'No Docker files yet')] : [])];
    const steps = b.steps.map((st) => st.argv ? `<li><span class="ltr mono">${esc(JSON.stringify(st.argv))}</span> ${st.network ? `<span class="chip wait">${A('إنترنت', 'network')}</span>` : ''}${st.installsDependencies ? `<span class="chip wait">${A('بيسطّب مكتبات', 'installs dependencies')}</span>` : ''}${st.runsPackageScripts ? `<span class="chip wait">${A('بيشغّل سكريبتات', 'runs scripts')}</span>` : ''}</li>` : `<li class="muted">${esc(st.note ?? st.id)}</li>`).join('');
    const prereq = b.prerequisites.map((p) => `<li>${esc(p.name)}: ${p.found ? `<span class="ltr">${esc(p.version || 'found')}</span>` : `<b style="color:var(--clay)">${A('مش موجود — سطّبه الأول', 'not found — install it first')}</b>`}</li>`).join('');
    const summary = `<section class="panel"><h2 style="font-size:18px">${A('ملخص', 'Summary')}</h2>
      <dl class="svcdef"><dt>${A('المشروع', 'Project')}</dt><dd class="ltr">${esc(b.name)}</dd>
      <dt>${A('الهدف', 'Purpose')}</dt><dd>${b.intent?.description ? esc(b.intent.description) : `<span class="muted">${A('لسه مااتوصفش — هتحدده مع وكيلك', 'not described yet — you will define it with your agent')}</span>`}</dd>
      <dt>${A('المكان', 'Location')}</dt><dd class="ltr mono">${esc(b.destination)}</dd>
      <dt>${A('التقنية', 'Stack')}</dt><dd>${esc(b.stackLabel)}</dd>
      <dt>${A('البيئة', 'Environment')}</dt><dd>${envText}${b.environment === 'docker' ? ` <span class="tiny muted">(${A('مخططة', 'planned')})</span>` : ''}</dd>
      <dt>Git</dt><dd>${b.git ? A('repository محلي جديد', 'a new local repository') : A('لأ', 'no')}</dd>
      <dt>${A('الوكيل', 'Agent')}</dt><dd>${L(AGENT_CHOICE[wizForm().agent ?? 'none'].t)}</dd>
      ${b.intent?.requirements ? `<dt>${A('المتطلبات', 'Requirements')}</dt><dd><div class="brief clamp3"><p>${esc(b.intent.requirements)}</p></div></dd>` : ''}
      ${b.attachments?.length ? `<dt>${A('المرفقات', 'Attachments')}</dt><dd>${b.attachments.map((a) => `<span class="ltr tag">${esc(a.name)}</span>`).join(' ')}</dd>` : ''}</dl>
      <div class="twocol" style="margin-top:12px"><div><h3 style="font-size:15px">${A('هيتعمل', 'Will be created')}</h3><ul class="small">${will.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div><div><h3 style="font-size:15px">${A('مش هيحصل', 'Will not happen')}</h3><ul class="small">${wont.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>
      ${prereq && b.prerequisites.some((p) => !p.found) ? `<p class="small" style="margin-top:8px;color:var(--clay)">${A('في أدوات ناقصة، الإنشاء هيفشل غالباً:', 'Some tools are missing; creation will likely fail:')}</p><ul class="small">${prereq}</ul>` : ''}
      <details style="margin-top:12px"><summary class="small">${A('تفاصيل تقنية', 'Technical details')}</summary><ol class="wizsteps">${steps}</ol>${prereq ? `<ul class="small">${prereq}</ul>` : ''}<p class="tiny muted ltr">plan ${esc(plan.id)} · sha256 ${esc(plan.hash)}</p></details></section>`;
    if (wiz.step === 4) {
      return head + stepper() + err + summary + `<form class="panel" data-wiz-create data-keep="wiz-4" style="margin-top:12px">
        ${typedName(b) ? `<label class="small optin"><input type="checkbox" name="acknowledgeScripts" required ${wiz.acknowledged ? 'checked' : ''}> <b>${A('فاهم إن الخطة دي هتنزّل مكتبات وتشغّل سكريبتات على جهازي', 'I understand this plan downloads dependencies and runs scripts on this machine')}</b></label><p class="tiny muted">${esc(scriptTools(b))}</p>` : `<p class="small">${A('لما تدوس «أنشئ المشروع»، YallaFlow بينفّذ الخطة اللي فوق دي بالظبط. لو اتغيّرت، الإنشاء بيترفض.', 'When you press Create the project, YallaFlow carries out exactly the plan above. If it changed, creation is refused.')}</p>`}
        <div class="row wiznav"><button class="btn ghost" type="button" data-wiz-prev>${A('رجوع', 'Back')}</button><span class="grow"></span><button class="btn go" type="submit" data-wiz-create-btn ${wiz.busy || (typedName(b) && !wiz.acknowledged) ? 'disabled' : ''}>${A('أنشئ المشروع', 'Create the project')}</button></div></form>`;
    }
    // Progress and outcome.
    const pr = wiz.progress;
    const stepState = (id) => pr?.plan?.progress?.steps?.[id]?.status ?? 'pending';
    const LABEL = { generate: b.generator ? A('توليد المشروع', 'Generate the project') : A('تجهيز الفولدر', 'Prepare the folder'), promote: b.generator ? A('نقله للمكان النهائي', 'Move it into place') : A('إنشاء فولدر المشروع', 'Create the project folder'), install: A('تسطيب المكتبات', 'Install dependencies'), init: A('تهيئة YallaFlow', 'Initialize YallaFlow'), 'git-init': A('إنشاء Git repository', 'Initialize Git'), 'first-work': A('أول شغلانة', 'First work item') };
    const outcome = pr?.outcome;
    // PF-0090: a progress bar with each step's state. The console's own finishing steps
    // (adding the project, connecting the agent) follow the plan's steps.
    const tracked = b.steps.filter((st) => LABEL[st.id]).map((st) => ({ id: st.id, label: LABEL[st.id], state: stepState(st.id), at: pr?.plan?.progress?.steps?.[st.id]?.at ?? null, slow: st.installsDependencies }));
    const planDone = Boolean(outcome?.ok);
    const regState = !planDone ? 'pending' : (wiz.registration ?? outcome.registration)?.ok ? 'done' : 'failed';
    tracked.push({ id: 'register', label: A('إضافته للكونسول وفحص الـ stack', 'Add it to the console and scan the stack'), state: outcome?.error ? 'pending' : regState });
    if ((wizForm().agent ?? 'none') !== 'none') tracked.push({ id: 'agent', label: A('ربط الوكيل', 'Connect the agent'), state: wiz.ready ? (wiz.ready.agentSaved ? 'done' : 'failed') : 'pending' });
    const doneN = tracked.filter((t) => t.state === 'done').length;
    const pct = Math.round((doneN / tracked.length) * 100);
    const failed = Boolean(outcome?.error) || tracked.some((t) => t.state === 'failed');
    const lastLog = String(pr?.log ?? '').split('\n').map((x) => x.trim()).filter(Boolean).at(-1) ?? '';
    const mark = { done: '✓', running: '◐', failed: '✕', pending: '○' };
    const list = tracked.map((t) => `<li data-wiz-step="${t.id}" data-state="${esc(t.state)}"><span class="wsm" aria-hidden="true">${mark[t.state] ?? '○'}</span><span class="grow">${esc(t.label)}${t.state === 'running' && t.slow ? ` <span class="tiny muted">${A('— دي ممكن تاخد كام دقيقة', '— this can take a few minutes')}</span>` : ''}${t.state === 'running' && t.at ? ` <span class="tiny muted">(${A('بدأت', 'started')} ${ago(t.at)})</span>` : ''}</span><span class="tiny muted">${{ done: A('خلصت', 'done'), running: A('شغّالة', 'running'), failed: A('وقفت', 'stopped'), pending: A('لسه', 'waiting') }[t.state] ?? ''}</span></li>`).join('');
    const bar = `<div class="wizbar ${failed ? 'fail' : doneN === tracked.length ? 'ok' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="${tracked.length}" aria-valuenow="${doneN}" aria-label="${A('تقدّم الإنشاء', 'Creation progress')}"><i style="width:${pct}%"></i></div><p class="small row"><b>${A(`${doneN} من ${tracked.length} خطوات`, `${doneN} of ${tracked.length} steps`)}</b><span class="muted">${pct}%</span>${!failed && doneN < tracked.length ? `<span class="muted">${A(`فاضل ${tracked.length - doneN}`, `${tracked.length - doneN} left`)}</span>` : ''}</p>${lastLog && !planDone && !failed ? `<p class="tiny muted ltr mono wizlast">${esc(lastLog.slice(0, 200))}</p>` : ''}`;
    let result = '';
    if (outcome?.ok) {
      const attachLine = wiz.attach ? `<ul class="small">${wiz.attach.map((x) => `<li>${x.ok ? '✓' : '⚠'} <span class="ltr">${esc(x.name)}</span>${x.ok ? '' : ` — ${esc(x.error)}`}</li>`).join('')}</ul>${wiz.attach.some((x) => !x.ok) ? `<button class="btn sm" data-wiz-reattach>${A('ارفع المرفقات تاني', 'Retry attachments')}</button> <span class="tiny muted">${A('أو اختارهم تاني:', 'or pick them again:')}</span> <input type="file" multiple accept="${ACCEPT}" data-wiz-refiles>` : ''}` : '';
      const reg = wiz.registration ?? outcome.registration;
      const agentName = { codex: 'Codex', claude: 'Claude Code' }[wizForm().agent] ?? null;
      const made = [
        A(`الفولدر: ${outcome.destination}`, `Folder: ${outcome.destination}`),
        A(`التقنية: ${b.stackLabel}`, `Stack: ${b.stackLabel}`),
        ...(outcome.workId ? [A(`أول شغلانة: ${outcome.workId} بوصفك`, `First work item: ${outcome.workId} with your description`)] : []),
        ...(agentName && wiz.ready?.agentSaved ? [A(`الوكيل: ${agentName} متربط (مفيش جلسة بدأت)`, `Agent: ${agentName} connected (no session started)`)] : [])
      ];
      result = `<section class="panel wizready" data-wiz-done style="margin-top:12px"><h2 style="font-size:20px">${A('المشروع جاهز ✓', 'The project is ready ✓')}</h2><ul class="small">${made.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${attachLine}
        ${reg?.ok ? (wiz.ready ? `<p class="small">${A('الخطوة الجاية: افتح المشروع، وهتلاقي «ابدأ من هنا» فوق.', 'Next: open the project; «Start here» is at the top.')}</p><div class="row"><button class="btn go" data-wiz-open="${esc(reg.id)}">${A('افتح المشروع وابدأ', 'Open the project and start')}</button></div>` : `<p class="small muted">${A('بيكمّل آخر خطوات…', 'Finishing the last steps…')}</p>`)
          : `<div class="errbar data" role="alert"><b>${A('المشروع اتعمل، بس مااتضافش للكونسول', 'The project exists, but it was not added to the console')}</b><p class="small">${esc(reg?.message ?? '')}</p><button class="btn sm" data-wiz-register>${A('ضيفه للكونسول', 'Add it to the console')}</button><p class="tiny muted">${A('ده بيسجّله بس، عمره ما بيعمل مشروع تاني.', 'This only registers it; it never creates a second project.')}</p></div>`}</section>`;
    } else if (outcome?.error) {
      result = `<section class="errbar" role="alert" data-wiz-failed style="margin-top:12px"><b>${A('الإنشاء وقف — مفيش حاجة اتكتب فوقها', 'Creation stopped — nothing was overwritten')}</b><p class="small" style="white-space:pre-wrap">${esc(outcome.error.message)}</p><div class="row"><button class="btn sm" data-wiz-retry>${A('حاول تاني', 'Retry')}</button><span class="tiny muted">${A('المحاولة بتكمّل من آخر خطوة خلصت، ومابتعملش مشروع تاني.', 'Retrying continues from the last finished step and never creates a second project.')}</span></div>
        <details class="small"><summary>${A('تفاصيل تقنية', 'Technical details')}</summary><code class="ltr">yallaflow new discard ${esc(plan.id)}</code></details></section>`;
    }
    return head + stepper() + (wiz.ready ? '' : summary) + `<section class="panel" style="margin-top:12px"><h2 style="font-size:18px">${A('التقدّم', 'Progress')}</h2>${bar}<ol class="wizsteps wizprog">${list}</ol>${pr?.log ? `<details><summary class="small">${A('السجل', 'Log')}</summary><pre class="svclog ltr" tabindex="0">${esc(pr.log)}</pre></details>` : ''}</section>` + result;
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
      const choice = String(data.get('wiz-stack') ?? (f.customStack ? 'custom' : f.stack));
      if (choice === 'custom') { f.stack = 'empty'; f.customStack = String(data.get('customStack') ?? '').trim(); if (!f.customStack) f.customStack = ' '; }
      else { f.stack = choice; f.customStack = ''; }
      if (!stackOf(f.stack)?.install) f.install = false;
    } else if (form.dataset.wizStep === '3') {
      f.environment = String(data.get('wiz-env') ?? f.environment);
      f.git = data.get('git') === 'on';
      f.install = data.get('install') === 'on';
      f.allowNested = data.get('allowNested') === 'on';
      f.agent = String(data.get('wiz-agent') ?? f.agent);
      if (!agentChoices().includes(f.agent)) f.agent = 'none';
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
    if (wiz.step === 2) {
      if (f.customStack && !f.customStack.trim()) { f.customStack = ' '; wiz.error = A('اكتب الـ stack اللي عايزه، أو اختار واحد من اللي فوق.', 'Name the stack you want, or choose one above.'); return render(); }
      wiz.step = 3; return render();
    }
    if (wiz.step === 3) {
      wiz.busy = true; wiz.plan = null; render();
      try {
        wiz.plan = await post('/api/new/plan', JSON.stringify({ name: f.name, parent: f.parent, stack: f.stack, install: f.install, allowNested: f.allowNested, description: f.description.trim() || null, requirements: f.requirements.trim() || null, environment: f.environment, git: f.git, ...(f.customStack?.trim() ? { customStack: f.customStack.trim() } : {}), files: wiz.files.map(({ name, size: s, sha256 }) => ({ name, size: s, sha256 })) }), { 'Content-Type': 'application/json' });
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
  // Which tools the plan runs, in plain words, under the acknowledgement checkbox.
  function scriptTools(b) {
    const tools = [...new Set(b.steps.filter((st) => st.argv && (st.installsDependencies || st.runsPackageScripts)).map((st) => st.argv[0]))];
    if (b.install) tools.push('npm install');
    return A(`بيشغّل: ${tools.join('، ')}. الأوامر كاملة في «تفاصيل تقنية» فوق.`, `Runs: ${tools.join(', ')}. The full commands are under Technical details above.`);
  }
  async function wizardCreate(form) {
    if (form) wiz.acknowledged = Boolean(form.querySelector('[name="acknowledgeScripts"]')?.checked);
    wiz.busy = true; wiz.error = null; render();
    try {
      await post('/api/new/create', JSON.stringify({ planId: wiz.plan.id, confirm: wiz.plan.hash, ...(typedName(wiz.plan.body) ? { acknowledgeScripts: wiz.acknowledged === true } : {}) }), { 'Content-Type': 'application/json' });
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
    // PF-0086: save and apply the agent chosen in the wizard; the Setup agents step is then done.
    const agent = wizForm().agent ?? 'none';
    let agentSaved = false;
    if (reg?.ok && agent !== 'none') {
      try {
        await post(`/api/p/${reg.id}/agents/settings`, JSON.stringify({ agents: true, claude: agent === 'claude' }), { 'Content-Type': 'application/json' });
        await post(`/api/p/${reg.id}/setup/step`, JSON.stringify({ step: 'agents' }), { 'Content-Type': 'application/json' });
        agentsOn = true; agentSaved = true;
        await loadAgentInfo();
      } catch (e) { toast(esc(A(`المشروع اتعمل، بس اختيار الوكيل مااتحفظش: ${e.message}. اختاره من «التشغيل».`, `The project was created, but the agent choice was not saved: ${e.message}. Choose it in Setup.`))); }
    }
    // PF-0090: stay on the page and show «The project is ready»; the developer opens it.
    if (reg?.ok) wiz.ready = { id: reg.id, workId: outcome.workId ?? null, agentSaved };
  }
  function resetWizard() { wiz = { ...wiz, step: 1, form: null, files: [], plan: null, error: null, busy: false, progress: null, acknowledged: false, attach: null, registration: null, ready: null }; }
  async function wizardRegister() {
    try {
      const reg = await post('/api/projects', JSON.stringify({ planId: wiz.plan.id }), { 'Content-Type': 'application/json' });
      wiz.registration = { ok: true, ...reg };
      await reloadProjects();
    } catch (e) { wiz.registration = { ok: false, message: e.message }; }
    render();
  }

  // ---------- folder chooser (1.4.0, PF-0057; redesigned in 1.5.2, PF-0123) ----------
  // One picker wherever the console asks for a project folder: 'existing' (add or connect a
  // project) and 'parent' (where the New Project Wizard creates its new folder). Browsing stays
  // inside the home folder, hidden folders stay out, and every path — typed or clicked — is
  // checked by the server. Folder kinds come from file names only.
  let folder = null; // { mode, data, error, busy, preview, previewError, previewBusy, ack, creating }
  const RECENT_KEY = 'recentFolders';
  const STACK_NAME = { laravel: 'Laravel', php: 'PHP', node: 'Node.js', python: 'Python', go: 'Go', ruby: 'Ruby', java: 'Java', rust: 'Rust', dotnet: '.NET' };
  const FOLDER_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';
  const CODE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/></svg>';
  const YF_SVG = '<svg viewBox="0 0 64 64" width="18" height="18" aria-hidden="true" fill="none" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><path d="M28.5 15.5 12.5 32 28.5 48.5" stroke="#0fae9d"/><path d="M50.5 15.5 34.5 32 50.5 48.5" stroke="#5961e8"/></svg>';
  function folderKind(f) {
    if (!f) return { icon: FOLDER_SVG, label: '', tone: 'tw:text-muted' };
    if (f.kind === 'yallaflow' || f.yallaflow) return { icon: YF_SVG, label: A('مشروع YallaFlow', 'YallaFlow project'), tone: '' };
    if (f.kind === 'code') return { icon: CODE_SVG, label: f.stack ? STACK_NAME[f.stack] ?? f.stack : A('كود موجود', 'Existing code'), tone: 'tw:text-dusk' };
    if (f.kind === 'empty' || f.empty) return { icon: FOLDER_SVG, label: A('فاضي', 'Empty'), tone: 'tw:text-muted' };
    return { icon: FOLDER_SVG, label: '', tone: 'tw:text-muted' };
  }
  // Paths inside home are shown as ~/…: short, and the folder's own name is never cut off.
  const tildePath = (p, home = folder?.data?.home) => (home && p && (p === home || p.startsWith(`${home}/`)) ? `~${p.slice(home.length)}` : p ?? '');
  const recentFolders = () => { const list = store.get(RECENT_KEY, []); return Array.isArray(list) ? list.filter((x) => typeof x === 'string').slice(0, 6) : []; };
  const rememberFolder = (dir) => { if (dir) store.set(RECENT_KEY, [dir, ...recentFolders().filter((x) => x !== dir)].slice(0, 6)); };
  async function openFolder(mode, at) {
    const fresh = !folder || folder.mode !== mode;
    folder = { mode, data: fresh ? null : folder.data, error: null, busy: true, preview: null, previewError: null, previewBusy: false, ack: false, creating: false };
    let d = document.getElementById('folderdlg');
    if (!d) {
      d = document.createElement('dialog'); d.id = 'folderdlg'; d.className = 'panel folderdlg';
      d.addEventListener('close', () => { folder = null; });
      d.addEventListener('input', onFolderInput);
      d.addEventListener('keydown', onFolderKey);
      d.addEventListener('submit', (e) => {
        if (e.target.matches('[data-folder-pathform]')) { e.preventDefault(); const v = typedPath(e.target.path.value); if (v && folder) openFolder(folder.mode, v); }
        else if (e.target.matches('[data-folder-newform]')) { e.preventDefault(); newFolder(e.target); }
      });
      d.addEventListener('change', (e) => { if (e.target.matches('[data-folder-ack]') && folder) { folder.ack = e.target.checked; const b = d.querySelector('[data-folder-connect]'); if (b) b.disabled = !folder.ack || folder.previewBusy; } });
      document.body.appendChild(d);
    }
    renderFolder();
    if (!d.open) d.showModal();
    const start = at ?? (mode === 'parent' ? wizForm().parent : '') ?? '';
    try { folder.data = await api(`/api/fs/dirs?path=${encodeURIComponent(start)}`); } catch (e) {
      try { folder.data = await api('/api/fs/dirs'); folder.error = e.message; } catch (e2) { folder.error = e2.message; }
    }
    folder.busy = false; renderFolder();
    (d.querySelector('.fpick-list [data-folder-go]') ?? d.querySelector('[data-folder-filter]'))?.focus();
  }
  function crumbs(x) {
    if (!x) return '';
    const rel = x.path === x.home ? [] : x.path.slice(x.home.length + 1).split('/');
    const parts = [{ label: A('البيت', 'Home'), path: x.home }, ...rel.map((name, i) => ({ label: name, path: `${x.home}/${rel.slice(0, i + 1).join('/')}` }))];
    return `<nav class="fpick-crumbs" aria-label="${A('المسار', 'Path')}"><ol>${parts.map((c, i) => `<li>${i === parts.length - 1 ? `<span aria-current="location">${i === 0 ? '⌂ ' : ''}${esc(c.label)}</span>` : `<button type="button" data-folder-go="${esc(c.path)}">${i === 0 ? '⌂ ' : ''}${esc(c.label)}</button>`}</li>`).join('')}</ol></nav>`;
  }
  function folderFooter(x) {
    const here = x?.here;
    const k = folderKind(here);
    const atHome = x && !x.parent;
    let action = '';
    if (folder.mode === 'parent') {
      const name = wizForm().name;
      action = `<button type="button" class="btn go" data-folder-choose ${x ? '' : 'disabled'}>${A('أنشئ المشروع هنا', 'Create the project here')}</button>`;
      return `<div class="fpick-foot"><div class="grow tw:min-w-0"><div class="tiny muted">${A('المشروع الجديد هيتعمل في فولدر جديد جوه:', 'The new project gets a new folder inside:')}</div><div class="ltr fpick-path" title="${esc(x?.path ?? '')}">${esc(tildePath(x?.path))}${name ? `/<b>${esc(name)}</b>` : ''}</div>${here?.yallaflow ? `<div class="tiny tw:text-amber">${A('ده مشروع YallaFlow — غالباً عايز تختار فولدر برّاه.', 'This is a YallaFlow project — you probably want a folder outside it.')}</div>` : ''}</div>${action}</div>`;
    }
    if (!x || atHome) action = `<button type="button" class="btn go" disabled>${A('اختار فولدر المشروع', 'Choose the project folder')}</button>`;
    else if (here?.yallaflow) action = `<button type="button" class="btn go" data-folder-choose>${A('افتح المشروع', 'Open this project')}</button>`;
    else action = `<button type="button" class="btn go" data-folder-preview>${here?.empty ? A('ابدأ مشروع جديد هنا', 'Start a new project here') : A('جهّز YallaFlow هنا', 'Set up YallaFlow here')}</button>`;
    return `<div class="fpick-foot"><span class="fpick-ico ${k.tone}">${k.icon}</span><div class="grow tw:min-w-0"><div class="ltr fpick-path" title="${esc(x?.path ?? '')}">${esc(tildePath(x?.path))}</div>${k.label ? `<div class="tiny muted">${esc(k.label)}</div>` : ''}</div>${action}</div>`;
  }
  function previewPanel() {
    const p = folder.preview;
    const opText = { create: A('ملف جديد', 'new file'), 'append-block': A('بيتضاف بلوك YallaFlow صغير في الآخر؛ كلامك فاضل زي ما هو', 'a short YallaFlow block is added at the end; your text stays as it is'), 'update-block': A('بلوك YallaFlow بيتحدّث', 'the YallaFlow block is updated'), unchanged: A('مفيش تغيير', 'no change') };
    const opSign = { create: '+', 'append-block': '~', 'update-block': '~', unchanged: '=' };
    const notes = { '.yallaflow/': A('سجلات المشروع', 'project records'), 'CLAUDE.md': '', 'AGENTS.md': A('بيوجّه Codex لـ YallaFlow', 'points Codex to YallaFlow') };
    const existing = p.kind === 'existing-code';
    return `<section class="fpick-preview" aria-labelledby="fpv-h">
      <h3 id="fpv-h" class="tw:text-lg tw:font-semibold">${existing ? A(`جهّز YallaFlow في «${esc(p.name)}»`, `Set up YallaFlow in “${esc(p.name)}”`) : A(`مشروع جديد في «${esc(p.name)}»`, `A new project in “${esc(p.name)}”`)}</h3>
      <p class="small tw:mt-1">${existing ? `${A('كود موجود', 'Existing codebase')}${p.stack?.length ? ` · <span class="ltr">${esc(p.stack.join(' · '))}</span>` : ''}${p.sourceFiles ? ` · ${A(`${p.sourceFiles} ملف كود`, `${p.sourceFiles} source files`)}` : ''}` : A('فولدر فاضي — المشروع هيبدأ من فكرتك ومتطلباتك.', 'An empty folder — the project starts from your idea and requirements.')}</p>
      ${p.git ? `<p class="small tw:mt-1">✓ ${A('أي تغييرات عندك مش متعملها commit مش هتتلمس، ومفيش commit هيتعمل.', 'Any uncommitted changes you have stay untouched, and nothing is committed.')}</p>` : ''}
      ${p.problems.length ? `<div class="tw:mt-3 tw:rounded-field tw:bg-clay-soft tw:px-3 tw:py-2" role="alert"><b class="tw:text-clay">${A('مش هينفع نجهّزه دلوقتي — ومفيش حاجة اتغيّرت:', 'This folder cannot be set up right now — nothing was changed:')}</b><ul class="small tw:mt-1 tw:ps-5">${p.problems.map((x) => `<li dir="auto">${esc(x.message)}</li>`).join('')}</ul></div>` : `
      <p class="small tw:mt-3"><b>${A('YallaFlow هيعمل بالظبط:', 'YallaFlow will make exactly these changes:')}</b></p>
      <ul class="fpick-plan">${p.plan.filter((x) => x.op !== 'unchanged').map((x) => `<li><span class="fpick-op ${x.op === 'create' ? 'add' : 'mod'}" aria-hidden="true">${opSign[x.op]}</span><span class="ltr">${esc(x.path)}</span><span class="tiny muted">${esc(notes[x.path] || opText[x.op])}${notes[x.path] && x.op !== 'create' ? ` · ${esc(opText[x.op])}` : ''}</span></li>`).join('')}</ul>
      <p class="tiny muted tw:mt-2">${A('مفيش كود تطبيق هيتغيّر، ومفيش commit، ومفيش تغيير في Git.', 'No application code changes, no commit, no Git changes.')}${existing ? ` ${A('بعدها وكيلك بيجهّز فهم للمشروع وإنت توافق عليه.', 'Next, your agent prepares a project understanding for you to approve.')}` : ''}</p>
      <label class="small tw:mt-3 tw:flex tw:items-center tw:gap-2"><input type="checkbox" data-folder-ack ${folder.ack ? 'checked' : ''}> ${A('راجعت التغييرات دي', 'I reviewed these changes')}</label>`}
      ${folder.previewError ? `<p class="small tw:mt-2 tw:text-clay" role="alert" dir="auto" style="white-space:pre-wrap">${esc(folder.previewError)}</p>` : ''}
      <div class="row tw:mt-4"><button type="button" class="btn ghost" data-folder-back>${A('رجوع', 'Back')}</button><span class="grow"></span>${p.problems.length ? '' : `<button type="button" class="btn go" data-folder-connect ${folder.ack && !folder.previewBusy ? '' : 'disabled'}>${folder.previewBusy ? A('بيجهّز…', 'Setting up…') : existing ? A('جهّز YallaFlow', 'Set up YallaFlow') : A('ابدأ المشروع', 'Start the project')}</button>`}</div></section>`;
  }
  function renderFolder() {
    const d = document.getElementById('folderdlg');
    if (!d || !folder) return;
    const x = folder.data;
    const title = folder.mode === 'parent' ? A('فين نعمل المشروع الجديد؟', 'Where should the new project go?') : A('اختار فولدر المشروع', 'Choose the project folder');
    d.setAttribute('aria-labelledby', 'fpick-h');
    const head = `<div class="row"><h2 id="fpick-h" class="grow tw:text-lg tw:font-semibold">${title}</h2><button type="button" class="ibtn" data-folder-close aria-label="${A('اقفل', 'Close')}">✕</button></div>`;
    if (folder.preview) { d.innerHTML = head + previewPanel(); d.querySelector('[data-folder-ack], [data-folder-back]')?.focus(); return; }
    const recents = [...new Set([...(folder.mode === 'existing' ? projects.map((p) => p.root) : []), ...recentFolders()])].filter((p) => x && p.startsWith(x.home) && p !== x.path).slice(0, 6);
    const label = (p) => projects.find((q) => q.root === p)?.name ?? p.split('/').pop();
    const rows = x?.folders ?? [];
    d.innerHTML = `${head}
      <div class="fpick-bar">${x?.parent ? `<button type="button" class="ibtn fpick-up" data-folder-go="${esc(x.parent)}" aria-label="${A('الفولدر الأعلى', 'Up one folder')}" title="${A('الفولدر الأعلى (Backspace)', 'Up one folder (Backspace)')}">↑</button>` : ''}${crumbs(x)}</div>
      <form class="fpick-pathform" data-folder-pathform><label class="tw:sr-only" for="fpick-path">${A('المسار', 'Path')}</label><input id="fpick-path" class="ltr" name="path" value="${esc(tildePath(x?.path))}" spellcheck="false" autocomplete="off" placeholder="~/code/my-project"><button type="submit" class="btn sm">${A('روح', 'Go')}</button></form>
      ${recents.length ? `<div class="fpick-recent"><span class="tiny muted">${A('أخيراً:', 'Recent:')}</span>${recents.map((p) => `<button type="button" class="fchip" data-folder-go="${esc(p)}" title="${esc(tildePath(p))}">${esc(label(p))}</button>`).join('')}</div>` : ''}
      <div class="fpick-tools"><input type="search" data-folder-filter placeholder="${A('دوّر في الفولدرات…', 'Filter folders…')}" aria-label="${A('دوّر في الفولدرات', 'Filter folders')}" autocomplete="off">${folder.mode === 'parent' && x ? (folder.creating ? `<form class="fpick-new" data-folder-newform><input name="name" maxlength="80" placeholder="${A('اسم الفولدر', 'Folder name')}" aria-label="${A('اسم الفولدر الجديد', 'New folder name')}" required><button type="submit" class="btn sm go">${A('اعمل', 'Create')}</button><button type="button" class="btn sm ghost" data-folder-newcancel>${A('إلغاء', 'Cancel')}</button></form>` : `<button type="button" class="btn sm" data-folder-new>＋ ${A('فولدر جديد', 'New folder')}</button>`) : ''}</div>
      ${folder.error ? `<p class="small tw:text-clay" role="alert" dir="auto">${esc(folder.error)}</p>` : ''}
      ${folder.busy ? `<p class="muted small fpick-list">${A('بيقرا…', 'Reading…')}</p>` : x ? `<ul class="fpick-list" role="list" aria-label="${A('الفولدرات', 'Folders')}">${rows.map((f) => { const k = folderKind(f); return `<li data-name="${esc(f.name.toLowerCase())}"><button type="button" class="fpick-row" data-folder-go="${esc(f.path)}"><span class="fpick-ico ${k.tone}">${k.icon}</span><span class="grow ltr fpick-name">${esc(f.name)}</span>${k.label ? `<span class="fpick-kind ${f.kind === 'yallaflow' ? 'yf' : f.kind === 'code' ? 'code' : ''}">${esc(k.label)}</span>` : ''}<span class="fpick-go" aria-hidden="true">›</span></button></li>`; }).join('') || `<li class="muted small fpick-empty">${A('مفيش فولدرات هنا.', 'No folders here.')}</li>`}<li class="muted small fpick-empty" data-folder-nomatch hidden>${A('مفيش فولدر بالاسم ده.', 'No folder matches.')}</li></ul>${x.truncated ? `<p class="tiny muted">${A('أول 500 فولدر بس.', 'First 500 folders only.')}</p>` : ''}` : ''}
      ${folderFooter(x)}
      <p class="tiny muted tw:mt-2">${A('فولدرات جوه فولدر البيت بس؛ المخفية مابتظهرش.', 'Folders inside your home folder only; hidden folders are not shown.')}</p>`;
  }
  // Filtering hides rows in place (no redraw, so typing keeps its focus and caret).
  function onFolderInput(e) {
    if (!e.target.matches('[data-folder-filter]')) return;
    const q = e.target.value.trim().toLowerCase();
    let shown = 0;
    for (const li of document.querySelectorAll('#folderdlg .fpick-list li[data-name]')) { const hit = !q || li.dataset.name.includes(q); li.hidden = !hit; if (hit) shown++; }
    const none = document.querySelector('#folderdlg [data-folder-nomatch]');
    if (none) none.hidden = shown > 0 || !q;
  }
  function onFolderKey(e) {
    const d = document.getElementById('folderdlg');
    if (!folder || folder.preview) return;
    const rows = [...d.querySelectorAll('.fpick-list li:not([hidden]) .fpick-row')];
    const inField = e.target.matches('input');
    const at = rows.indexOf(e.target);
    if (e.key === 'ArrowDown' && (at >= 0 || e.target.matches('[data-folder-filter]'))) { e.preventDefault(); rows[Math.min(at + 1, rows.length - 1)]?.focus(); return; }
    if (e.key === 'ArrowUp' && at >= 0) { e.preventDefault(); (at === 0 ? d.querySelector('[data-folder-filter]') : rows[at - 1])?.focus(); return; }
    if (e.key === 'Enter' && e.target.matches('[data-folder-filter]')) { e.preventDefault(); rows[0]?.click(); return; }
    if ((e.key === 'Backspace' && !inField) || (e.key === 'ArrowUp' && e.altKey)) { e.preventDefault(); if (folder.data?.parent) openFolder(folder.mode, folder.data.parent); return; }
    // Typing on a row starts filtering.
    if (!inField && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /\S/.test(e.key)) { const f = d.querySelector('[data-folder-filter]'); if (f) { f.focus(); f.value += e.key; onFolderInput({ target: f }); e.preventDefault(); } }
  }
  // A typed path: "~" means the home folder; the server checks everything else.
  function typedPath(value) {
    const v = String(value ?? '').trim();
    const home = folder?.data?.home ?? '';
    if (v === '~') return home;
    if (v.startsWith('~/')) return `${home}/${v.slice(2)}`;
    return v;
  }
  async function previewFolder() {
    const x = folder?.data;
    if (!x) return;
    folder.previewBusy = true;
    try { folder.preview = await api(`/api/fs/connect-preview?path=${encodeURIComponent(x.path)}`); folder.previewError = null; } catch (e) { folder.error = e.message; }
    folder.previewBusy = false; folder.ack = false; renderFolder();
  }
  async function connectFolder() {
    const p = folder?.preview;
    if (!p || !folder.ack) return;
    folder.previewBusy = true; folder.previewError = null; renderFolder();
    try {
      const reg = await post('/api/projects/connect', JSON.stringify({ root: p.path, planHash: p.planHash, confirm: true }), { 'Content-Type': 'application/json' });
      rememberFolder(p.path.split('/').slice(0, -1).join('/'));
      document.getElementById('folderdlg')?.close();
      await reloadProjects();
      toast(esc(A(`«${p.name}» بقى مشروع YallaFlow ✓`, `“${p.name}” is now a YallaFlow project ✓`)));
      await switchProject(reg.id, 'map');
    } catch (e) {
      if (e.data?.preview) { folder.preview = e.data.preview; folder.ack = false; }
      folder.previewBusy = false; folder.previewError = why(e); renderFolder();
    }
  }
  async function newFolder(form) {
    const name = form.name.value.trim();
    if (!name || !folder?.data) return;
    try {
      const data = await post('/api/fs/mkdir', JSON.stringify({ parent: folder.data.path, name }), { 'Content-Type': 'application/json' });
      folder.data = data; folder.creating = false; folder.error = null; renderFolder();
      document.querySelector('#folderdlg [data-folder-choose]')?.focus();
    } catch (e) { folder.error = why(e); renderFolder(); document.querySelector('#folderdlg [data-folder-newform] input')?.focus(); }
  }
  async function chooseFolder() {
    const x = folder?.data;
    if (!x) return;
    if (folder.mode === 'parent') {
      wizForm().parent = x.path;
      rememberFolder(x.path);
      const typed = document.querySelector('[data-wiz-step="1"] input[name="parent"]');
      if (typed) { typed.value = x.path; typed.defaultValue = x.path; }
      document.getElementById('folderdlg')?.close();
      folder = null; render(); return;
    }
    folder.busy = true; renderFolder();
    try {
      const reg = await post('/api/projects', JSON.stringify({ root: x.path }), { 'Content-Type': 'application/json' });
      rememberFolder(x.path.split('/').slice(0, -1).join('/'));
      document.getElementById('folderdlg')?.close();
      folder = null;
      await reloadProjects();
      // PF-0069: a project without a finished setup opens on its first-time setup.
      let firstTime = false;
      try { firstTime = Boolean((await api(`/api/p/${reg.id}/setup`)).pending); } catch { firstTime = false; }
      await switchProject(reg.id, firstTime ? 'setup' : 'overview');
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
      if (chatCtx()) await loadAgent();
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
      <p class="small">${it.project ? A('اسأل الوكيل عن المشروع من هنا. مساحة الوكيل مقفولة في الكونسول ده لحد ما تفعّلها.', 'Ask the agent about the project from here. The Agent Workspace is off in this console until you enable it.') : A(`اشتغل على ${it.id} مع Codex من هنا. مساحة الوكيل مقفولة في الكونسول ده لحد ما تفعّلها.`, `Work on ${it.id} with Codex from here. The Agent Workspace is off in this console until you enable it.`)}</p>${status}
      ${agentsCanEnable ? `<button class="btn go sm" data-agents-enable>${A('فعّل الوكلاء للجلسة دي', 'Enable agents for this session')}</button>` : ''}${explain}</section>`;
  }

  // ---------- projects ----------
  let overview = null; // [{ project, snap | error }]
  async function loadOverview() {
    overview = await Promise.all(projects.map(async (project) => {
      // PF-0082: each card's memory health comes from the project's own overview (read-only).
      // A failure there leaves the card as it was.
      const health = api(`/api/p/${project.id}/overview`).then((o) => ({ memory: o.memory ?? null, understanding: o.understanding?.state ?? null, kind: o.project?.kind ?? null, origin: o.project?.origin ?? null })).catch(() => null);
      try { return { project, snap: await api(`/api/p/${project.id}/snapshot`), health: await health }; } catch (e) { return { project, error: e.message, health: await health }; }
    }));
  }
  // PF-0081: take a project off the console (and the saved list). Its files stay as they are.
  function projRemoveBtn(project) {
    if (readOnly) return '';
    return `<button type="button" class="btn ghost sm projrm" data-remove-project="${project.id}" aria-label="${esc(A(`شيل ${project.name} من الكونسول`, `Remove ${project.name} from the console`))}" title="${esc(A('شيل من الكونسول', 'Remove from the console'))}">✕</button>`;
  }
  let removing = null; // { id?, root?, name }
  function askRemoveProject(target) {
    removing = target;
    let d = document.getElementById('rmprojdlg');
    if (!d) { d = document.createElement('dialog'); d.id = 'rmprojdlg'; d.className = 'panel'; document.body.appendChild(d); }
    d.innerHTML = `<form method="dialog" data-remove-project-form class="wizform"><h2 style="font-size:18px">${A('تشيل المشروع من الكونسول؟', 'Remove this project from the console?')}</h2>
      <p class="small"><b dir="auto">${esc(target.name)}</b></p>
      <p class="small">${A('هيختفي من قايمة المشاريع هنا ومن القايمة المحفوظة. ملفات المشروع وسجلات .yallaflow بتاعته مش هتتلمس، وتقدر ترجّعه بعدين من «ضيف مشروع موجود».', 'It leaves the project list here and the saved list. The project\'s files and its .yallaflow records are not touched; you can add it back later with Add an existing project.')}</p>
      ${target.id ? `<p class="tiny muted">${A('لو فيه وكيل شغّال في المشروع ده، وقّفه الأول. لو الكونسول بيشتغل من جوه فولدر المشروع، هيرجع يظهر المرة الجاية.', 'If an agent is running in this project, end it first. If you start the console from inside this project folder, it shows again next time.')}</p>` : ''}
      <div class="row"><button type="button" class="btn ghost" data-remove-project-cancel>${A('إلغاء', 'Cancel')}</button><span class="grow"></span><button class="btn go" type="submit">${A('شيله', 'Remove')}</button></div></form>`;
    d.showModal();
    d.querySelector('[data-remove-project-cancel]').focus();
  }
  async function confirmRemoveProject() {
    const target = removing;
    removing = null;
    document.getElementById('rmprojdlg')?.close();
    if (!target) return;
    try {
      await post('/api/projects/remove', JSON.stringify(target.id ? { id: target.id } : { root: target.root }), { 'Content-Type': 'application/json' });
      await reloadProjects();
      toast(esc(A(`${target.name} اتشال من الكونسول. ملفاته زي ما هي.`, `${target.name} was removed from the console. Its files are unchanged.`)));
      await leaveRemovedProject();
      await loadOverview();
    } catch (e) {
      toast(esc(e.code === 'SESSION_ACTIVE' ? A('فيه وكيل شغّال في المشروع ده. وقّف الجلسة الأول وبعدين شيله.', 'An agent session is running in this project. End it first, then remove the project.') : e.message));
    }
    render();
  }
  // The open project was removed (here or in another tab): move to the next one, if any.
  async function leaveRemovedProject() {
    if (projects.some((p) => p.id === pid)) return;
    pid = projects[0]?.id ?? null;
    store.set('project', pid);
    snap = null; detail = null; team = null; digest = null; projectOverview = null; runtime = null;
    await load();
    if (pid) await buildDigest();
  }
  // PF-0082: what the project's memory holds and what in it needs care, from its own records.
  function memoryHealth(h) {
    if (!h) return '';
    const label = `<b>${A('ذاكرة المشروع:', 'Project memory:')}</b>`;
    const m = h.memory;
    if (!m?.available) return `<div class="memh tiny muted">${label} ${A('مش قادر يقراها.', 'could not be read.')}</div>`;
    if (!m.current && h.origin?.createdBy === 'yallaflow new') {
      // PF-0084: what was chosen in the wizard, until the first work item records it in memory.
      const env = { docker: 'Docker', local: A('أدوات على الجهاز', 'local tools') }[h.origin.environment];
      const chosen = [(h.origin.stack ?? []).join(' · ') || A('مشروع فاضي', 'empty project'), env ? `${env}${h.origin.environment === 'docker' ? ` (${A('مخطّط', 'planned')})` : ''}` : null].filter(Boolean).join(' · ');
      return `<div class="memh tiny">${label} <span class="muted">${A('لسه فاضية.', 'empty so far.')}</span></div><div class="tiny"><b>${A('اتختار وقت الإنشاء:', 'Chosen at creation:')}</b> <span class="ltr">${esc(chosen)}</span> <span class="muted">${A('— بيدخل الذاكرة مع أول شغلانة.', '— it enters memory with the first work item.')}</span></div>`;
    }
    if (!m.current) {
      const why = h.kind === 'greenfield'
        ? A('لسه فاضية. بتتكوّن من قراراتك والشغل.', 'empty so far. It grows from your decisions and the work.')
        : L((UNDERSTANDING_TEXT[h.understanding] ?? UNDERSTANDING_TEXT.PROJECT_UNDERSTANDING_REQUIRED).title);
      return `<div class="memh tiny">${label} <span class="muted">${esc(why)}</span></div>`;
    }
    const stale = (m.mayBeStale ?? 0) + (m.staleEvidence ?? 0);
    const parts = [];
    if (stale) parts.push(`<span class="chip wait" data-tip="${esc(A('الملفات اللي بتثبتها اتغيّرت أو اتشالت. الوكيل بيراجعها لما الشغل يلمسها.', 'The files that back them changed or are gone. The agent rechecks them when work touches them.'))}">${A(`${stale} محتاجة مراجعة`, `${stale} to revalidate`)}</span>`);
    if (m.disputed) parts.push(`<span class="chip fail">${A(`${m.disputed} عليها خلاف`, `${m.disputed} disputed`)}</span>`);
    if (m.unresolved) parts.push(`<span class="chip todo">${A(`${m.unresolved} مش محسومة`, `${m.unresolved} unresolved`)}</span>`);
    if (!parts.length) parts.push(`<span class="chip done"><i></i>${A('مفيش حاجة محتاجة مراجعة', 'nothing needs care')}</span>`);
    return `<div class="memh row tiny">${label} <span>${A(`${m.current} معلومة`, `${m.current} facts`)}</span>${parts.join('')}</div>`;
  }
  function viewProjects() {
    if (!overview) return `<p class="muted" style="margin-top:30px">${A('بيحمّل المشاريع…', 'Loading projects…')}</p>`;
    const cards = overview.map(({ project, snap: s, error: e, health }) => {
      if (e) return `<div class="projwrap"><article class="proj panel"><div class="grow"><h2 style="font-size:20px">${esc(project.name)}</h2><p class="small" style="color:var(--clay)">${A('YallaFlow مش قادر يقرا سجلات المشروع ده:', 'YallaFlow cannot read this project\'s records:')} ${esc(e)}</p>${memoryHealth(health)}</div></article>${projRemoveBtn(project)}</div>`;
      const openN = s.items.filter((it) => it.state !== 'done').length;
      const badge = !s.items.length ? `<span class="hico sm" aria-hidden="true">＋</span>` : openN ? ring(s.openCompletion ?? 0, 92, 9) : `<span class="hico sm done" aria-hidden="true">✓</span>`;
      const dist = ST.map((_, i) => s.items.filter((it) => curIndex(it) === i).length);
      const last = s.items.map((it) => it.lastActivityAt).filter(Boolean).sort().at(-1);
      return `<div class="projwrap"><a class="proj panel ${project.id === pid ? 'here' : ''}" href="#/map" data-open-project="${project.id}">${badge}<div class="grow"><h2 style="font-size:20px">${esc(project.name)}</h2>
        <div class="row tiny" style="margin-top:4px">${s.counts.you ? `<span class="chip you"><i></i>${s.counts.you} ${L(STATE.you)}</span>` : ''}${s.counts.fail ? `<span class="chip fail"><i></i>${s.counts.fail} ${L(STATE.fail)}</span>` : ''}<span class="chip todo">${s.counts.active + s.counts.paused + s.counts.new} ${A('مفتوح', 'open')}</span><span class="chip done"><i></i>${s.counts.done} ${L(STATE.done)}</span>${s.invalid?.length ? `<span class="chip wait">⚠ ${s.invalid.length} ${A('سجلات مش سليمة', 'invalid')}</span>` : ''}</div>
        ${!s.items.length ? `<p class="small muted">${A('لسه مفيش شغل مسجّل.', 'No work recorded yet.')}</p>` : !openN ? `<p class="small muted">${A('كل الشغل المسجّل خلص.', 'All recorded work is done.')}</p>` : ''}
        ${memoryHealth(health)}
        <div class="pflow">${dist.map((n, i) => `<span style="--hue:${ST[i].hue}" data-tip="${esc(L(ST[i].name))}: ${n}"><i style="height:${6 + n * 10}px"></i><b>${n}</b></span>`).join('')}</div>
        <div class="tiny muted">${last ? A(`آخر نشاط مسجّل ${ago(last)}`, `last recorded activity ${ago(last)}`) : ''}</div></div></a>${projRemoveBtn(project)}</div>`;
    }).join('');
    return `<section class="pagehead"><div class="row"><h1 style="font-size:26px">${A('المشاريع', 'Projects')}</h1>${readOnly ? '' : `<button class="btn sm" data-folder-open="existing" style="margin-inline-start:auto">${A('ضيف مشروع موجود', 'Add an existing project')}</button><a class="btn sm go" href="#/new">＋ ${A('مشروع جديد', 'New project')}</a>`}</div><p class="muted">${A('كل مشروع ليه مجلد .yallaflow خاص بيه، والكونسول بيقرا كل واحد لوحده.', 'Each project has its own .yallaflow; the console reads each one separately.')}</p></section>
      ${overview.length ? `<section class="projects">${cards}</section>` : `<section class="panel"><h2 style="font-size:20px">${A('أهلاً في YallaFlow', 'Welcome to YallaFlow')}</h2><p class="small">${A('لسه مفيش مشاريع في الكونسول. ابدأ مشروع جديد، أو ضيف مشروع YallaFlow موجود.', 'There are no projects in the console yet. Start a new project, or add an existing YallaFlow project.')}</p>${readOnly ? '' : `<div class="row" style="margin-top:8px"><a class="btn go" href="#/new">＋ ${A('مشروع جديد', 'New project')}</a><button class="btn" data-folder-open="existing">${A('ضيف مشروع موجود', 'Add an existing project')}</button></div>`}</section>`}
      ${unavailable.length ? `<p class="small" style="margin-top:14px">${A('مش متاحة (الفولدر اتنقل أو اتمسح):', 'Unavailable (folder moved or deleted):')} ${unavailable.map((u) => `<span class="ltr tag">${esc(u)}${readOnly ? '' : ` <button type="button" class="tagx" data-remove-project-root="${esc(u)}" aria-label="${esc(A(`شيل ${u} من الكونسول`, `Remove ${u} from the console`))}">✕</button>`}</span>`).join(' ')}</p>` : ''}
      ${devPanel(A('إدارة قائمة المشاريع', 'Manage the project list'), ['yallaflow console add <folder>', 'yallaflow console remove <folder>', 'yallaflow console list'])}`;
  }

  // ---------- team: Git worktrees (checkouts), never presented as agent sessions ----------
  let team = null;
  async function loadTeam() {
    try { team = await api(`/api/p/${pid}/worktrees`); } catch (e) { team = { error: e.message }; }
  }
  const baseName = (p) => String(p).split(/[\\/]/).filter(Boolean).at(-1) ?? p;
  // PF-0112: the Agents view — every lane across this console's projects, one inbox of open
  // requests, and the session controls. Every button calls the same endpoint as the chat.
  const TASK_LABEL = {
    queued: { ar: 'في الطابور', en: 'Queued' }, starting: { ar: 'بيبدأ', en: 'Starting' }, working: { ar: 'شغّال', en: 'Working' },
    'needs-you': { ar: 'محتاجك', en: 'Needs you' }, paused: { ar: 'واقف', en: 'Paused' }, interrupted: { ar: 'اتقطع', en: 'Interrupted' },
    done: { ar: 'خلص', en: 'Done' }, failed: { ar: 'فشل', en: 'Failed' }, skipped: { ar: 'اتخطّى', en: 'Skipped' }, cancelled: { ar: 'اتلغى', en: 'Cancelled' }
  };
  const REASON_LABEL = {
    approval: { ar: 'مستني موافقتك على أداة', en: 'waiting for your approval' }, review: { ar: 'مستني مراجعتك', en: 'waiting for your review' },
    question: { ar: 'مستني إجابتك', en: 'waiting for your answer' }, reply: { ar: 'مستني ردك', en: 'waiting for your reply' },
    'usage-limit': { ar: 'وصل لحد الاستخدام', en: 'usage limit reached' }, 'agent-config': { ar: 'إعدادات الوكيل في المشروع (.codex/) اتغيرت؛ بص عليها وابدأها بنفسك', en: 'the project’s agent settings (.codex/) changed; look at them and start it yourself' }, 'session-ended': { ar: 'الجلسة خلصت قبل ما الشغل يخلص', en: 'the session ended before the work was done' },
    'console-restart': { ar: 'الكونسول اتقفل وهو شغّال', en: 'the console stopped while it worked' }, cleanup: { ar: 'فيه عمليات للوكيل لسه شغّالة', en: 'agent processes are still running' },
    crashed: { ar: 'الوكيل وقع', en: 'the agent crashed' }, developer: { ar: 'إنت وقفته', en: 'you stopped it' }
  };
  const taskTone = (s) => ({ working: 'active', starting: 'active', 'needs-you': 'you', done: 'done', failed: 'fail', interrupted: 'paused', paused: 'paused', queued: 'todo', skipped: 'closed', cancelled: 'closed' }[s] ?? '');
  function xPermCard(p) {
    const left = p.expiresAt ? Math.max(0, Math.round((Date.parse(p.expiresAt) - Date.now()) / 60000)) : null;
    return `<div class="aperm open xperm"><div class="row"><span class="ptag">${esc(p.name ?? '')}${p.workId ? ` · <span class="ltr">${esc(p.workId)}</span>` : ''}</span><b class="grow">${esc(p.title)}</b>${left !== null ? `<span class="tiny muted">${A(`فاضل ${left} د`, `${left} min left`)}</span>` : ''}</div>${permScope(p)}${p.detail ? `<pre class="pdetail" dir="ltr">${esc(p.detail)}</pre>` : ''}
      <div class="row">${(p.decisions ?? []).map((d) => `<button class="btn sm ${d === 'deny' ? 'ghost' : 'go'}" data-x-perm="${esc(p.requestId)}" data-x-pid="${esc(p.project)}" data-decision="${d}">${{ allow: A('اسمح مرة', 'Allow once'), allow_session: A('اسمح للجلسة', 'Allow for session'), deny: A('ارفض', 'Deny') }[d]}</button>`).join('')}${p.workId ? `<button class="btn sm ghost" data-x-open="${esc(p.project)}" data-x-work="${esc(p.workId)}">${A('افتح الشات', 'Open chat')}</button>` : ''}<span class="tiny muted">${A('لو محدش ردّ هيترفض تلقائي.', 'Unanswered requests are denied automatically.')}</span></div></div>`;
  }
  function xLane(lane) {
    const s = lane.session;
    const prov = s ? (s.provider === 'claude' ? 'Claude Code' : 'Codex') : '';
    const status = !s ? A('مفيش وكيل شغّال', 'No agent running') : lane.pending.length ? A('محتاج موافقتك', 'needs your approval') : s.status === 'working' ? A('شغّال', 'working') : s.status === 'starting' ? A('بيبدأ', 'starting') : s.status === 'connected' ? A('متوصّل', 'connected') : A('مستنيك', 'idle, waiting for you');
    const workedMin = lane.workingSince ? Math.floor((Date.now() - Date.parse(lane.workingSince)) / 60000) : null;
    const since = workedMin !== null ? ` · ${A(`بقاله ${mins(workedMin)}`, `for ${mins(workedMin)}`)}` : '';
    const step = lane.lastStep ? `<div class="tiny muted">${A('آخر خطوة', 'Last step')}: ${esc(lane.lastStep.title)}</div>` : '';
    const nowTasks = lane.runs.filter((run) => run.mode === 'now').flatMap((run) => run.lanes[0].tasks).slice(0, 3);
    const queues = lane.runs.filter((run) => run.mode !== 'now').slice(0, 3);
    const tasks = nowTasks;
    const controls = s && s.provider === 'codex' ? `${s.status === 'working' ? `<button class="btn sm ghost" data-x-act="cancel" data-x-pid="${esc(lane.project)}">${A('وقّف الدور', 'Stop turn')}</button>` : ''}<button class="btn sm ghost" data-x-act="end" data-x-pid="${esc(lane.project)}">${A('أنهِ الجلسة', 'End session')}</button>` : '';
    const laneBits = lane.kind === 'lane' ? `<span class="chip"><i></i>${A('مسار', 'Lane')}</span>` : '';
    const cleanupBtn = lane.kind === 'lane' && !s && latestMerge(lane)?.state === 'verified' ? `<button class="btn sm ghost" data-cleanup-open="${esc(lane.laneId ?? '')}" data-home="${esc(lane.parent ?? '')}">${A('تنظيف', 'Clean up')}</button>` : '';
    return `<section class="panel xlane ${lane.kind === 'lane' ? 'islane' : ''}"><div class="row"><b class="grow">${esc(lane.name)}</b>${laneBits}${s ? `<span class="chip ${lane.pending.length ? 'you' : s.status === 'working' ? 'active' : 'wait'}"><i></i>${esc(prov)} · ${status}</span>` : `<span class="chip"><i></i>${status}</span>`}</div>
      ${lane.lockedBy ? `<p class="tiny muted">${esc(lane.lockedBy)}</p>` : ''}${lane.store === 'unreadable' ? `<p class="tiny fail">${A('ملف التشغيل مش مقروء ومش هيتكتب فوقه', 'The runs file is unreadable and will not be overwritten')}: <span${trDir(lane, 'storeError')}>${trHtml(lane, 'storeError')}</span></p>` : lane.storeError ? `<p class="tiny fail"${trDir(lane, 'storeError')}>${trHtml(lane, 'storeError')}</p>` : ''}
      ${s?.workId ? `<div class="small">${A('على', 'On')} <a href="#" data-x-open="${esc(lane.project)}" data-x-work="${esc(s.workId)}" class="ltr">${esc(s.workId)}</a>${since}</div>` : ''}${step}
      ${tasks.length ? `<ul class="xtasks">${tasks.map((task) => `<li><span class="chip ${taskTone(task.state)}"><i></i>${L(TASK_LABEL[task.state] ?? { ar: esc(task.state), en: esc(task.state) })}</span> <a href="#" data-x-open="${esc(lane.project)}" data-x-work="${esc(task.workId)}" class="ltr">${esc(task.workId)}</a>${task.reason && REASON_LABEL[task.reason] ? ` <span class="tiny muted">${L(REASON_LABEL[task.reason])}${task.retryAt ? ` · ${A('يرجع', 'retry')} ${esc(task.retryAt)}` : ''}</span>` : ''}${task.itemDone && task.state !== 'done' ? ` <span class="tiny muted">${A('الشغل خلص؛ الجلسة لسه مفتوحة', 'work DONE; the session is still open')}</span>` : ''}</li>`).join('')}</ul>` : ''}
      ${queues.map((run) => xRun(lane, run)).join('')}
      ${lane.kind === 'lane' ? mergeBlock(lane) : ''}
      ${controls || cleanupBtn ? `<div class="row">${controls}${cleanupBtn}</div>` : ''}</section>`;
  }
  const RUN_LABEL = { running: { ar: 'شغّال', en: 'running' }, paused: { ar: 'واقف', en: 'paused' }, finished: { ar: 'خلص', en: 'finished' }, cancelled: { ar: 'اتلغى', en: 'cancelled' } };
  function xRun(lane, run) {
    const list = run.lanes[0].tasks;
    const live = ['finished', 'cancelled'].includes(run.state) ? false : true;
    const btn = (act, label, extra = '', cls = 'ghost') => `<button class="btn sm ${cls}" data-run-act="${act}" data-x-pid="${esc(lane.project)}" data-run="${esc(run.id)}" ${extra}>${label}</button>`;
    const queuedIds = list.filter((task) => task.state === 'queued').map((task) => task.id);
    const head = list.find((task) => task.state === 'queued');
    const assisted = live && head && head.provider === 'claude' && !list.some((task) => ['starting', 'working', 'needs-you'].includes(task.state));
    return `<div class="xrun"><div class="row"><b>${A('طابور', 'Queue')}</b><span class="chip ${run.state === 'running' ? 'active' : run.state === 'finished' ? 'done' : run.state === 'cancelled' ? 'closed' : 'paused'}"><i></i>${L(RUN_LABEL[run.state] ?? { ar: esc(run.state), en: esc(run.state) })}</span>${run.awaitNext ? `<span class="tiny muted">${A('مستني «كمّل»', 'waiting for Continue')}</span>` : ''}${run.held ? `<span class="tiny muted">${A('موقوف مؤقتاً', 'paused by you')}</span>` : ''}${run.cancelAfter ? `<span class="tiny muted">${A('هيتلغى بعد المهمة الحالية', 'cancels after the current task')}</span>` : ''}</div>
      <ol class="xtasks">${list.map((task) => {
        const qi = queuedIds.indexOf(task.id);
        const acts = [
          ['interrupted', 'paused'].includes(task.state) && task.provider === 'codex' ? btn('resume', A('كمّل', 'Resume'), `data-task="${esc(task.id)}"`, 'go') : '',
          ['failed', 'paused', 'interrupted'].includes(task.state) ? btn('retry', A('من الأول', 'Retry'), `data-task="${esc(task.id)}"`) : '',
          ['queued', 'paused', 'failed', 'interrupted'].includes(task.state) ? btn('skip', A('تخطّى', 'Skip'), `data-task="${esc(task.id)}"`) : '',
          qi > 0 ? btn('up', '↑', `data-task="${esc(task.id)}" aria-label="${A('لفوق', 'Up')}"`) : '',
          qi !== -1 && qi < queuedIds.length - 1 ? btn('down', '↓', `data-task="${esc(task.id)}" aria-label="${A('لتحت', 'Down')}"`) : ''
        ].join('');
        return `<li><span class="chip ${taskTone(task.state)}"><i></i>${L(TASK_LABEL[task.state] ?? { ar: esc(task.state), en: esc(task.state) })}</span> <a href="#" data-x-open="${esc(lane.project)}" data-x-work="${esc(task.workId)}" class="ltr">${esc(task.workId)}</a>${task.provider === 'claude' ? ' <span class="tiny muted">Claude Code</span>' : ''}${task.reason && REASON_LABEL[task.reason] ? ` <span class="tiny muted">${L(REASON_LABEL[task.reason])}${task.retryAt ? ` · ${A('يرجع', 'retry')} ${esc(task.retryAt)}` : ''}</span>` : ''}${acts ? `<span class="xacts">${acts}</span>` : ''}</li>`;
      }).join('')}</ol>
      ${assisted ? `<p class="tiny">${A(`ابدأ ${esc(head.workId)} في Claude Code واربطه من الشات. الكونسول مبيقدرش يشغّل Claude Code بنفسه.`, `Start ${esc(head.workId)} in Claude Code and link it from the chat. The console cannot start Claude Code itself.`)}</p>` : ''}
      ${live ? `<div class="row">${run.held || run.awaitNext ? btn('next', A('كمّل الطابور', 'Continue queue'), '', 'go') : btn('pause', A('وقّف بعد الحالية', 'Pause after current'))}${run.cancelAfter ? '' : btn('cancel-after', A('ألغي بعد الحالية', 'Cancel after current'))}${btn('cancel-now', A('ألغي دلوقتي', 'Cancel now'))}${run.options?.provider !== 'claude' && lane.userSessions ? btn('switch', A('كمّل الباقي بـ Claude Code', 'Continue the rest with Claude Code'), 'data-provider="claude"') : ''}${run.options?.provider === 'claude' ? btn('switch', A('كمّل الباقي بـ Codex', 'Continue the rest with Codex'), 'data-provider="codex"') : ''}</div>` : ''}</div>`;
  }
  function viewAgents() {
    if (!agentsOn) return `<section class="hero calm"><span class="hico" aria-hidden="true">◎</span><div><h1>${A('الوكلاء', 'Agents')}</h1><p class="small">${A('الوكلاء مش مفعّلين في الكونسول ده. فعّلهم من «الإعداد والتشغيل».', 'Agents are not enabled in this console. Turn them on in Setup & run.')}</p></div></section>`;
    if (!execView) return `<p class="muted" style="margin-top:40px;text-align:center">${execError ? esc(execError) : A('بيحمّل…', 'Loading…')}</p>`;
    const inbox = execView.inbox ?? [];
    return `<section class="hero calm"><span class="hico" aria-hidden="true">◎</span><div><h1>${A('الوكلاء', 'Agents')}</h1><p class="small">${A('كل الوكلاء في المشاريع المفتوحة هنا، واللي محتاجك في مكان واحد. كل زرار هنا بيعمل نفس اللي في الشات.', 'Every agent in this console’s projects, and everything that needs you, in one place. Each button here does the same as in the chat.')}</p></div></section>
      ${(execView.limits ?? []).map((limit) => `<section class="errbar" role="status"><b>${A(`${limit.provider === 'codex' ? 'Codex' : 'Claude Code'} وصل لحد الاستخدام${limit.retryAt ? ` (يرجع ${esc(limit.retryAt)})` : ''}. الطوابير اللي عليه واقفة.`, `${limit.provider === 'codex' ? 'Codex' : 'Claude Code'} reached its usage limit${limit.retryAt ? ` (try again at ${esc(limit.retryAt)})` : ''}. Queues on it are paused.`)}</b><p class="small">${A('كمّل المهمة الواقفة لما الحد يرجع، أو كمّل الباقي بالوكيل التاني من كارت الطابور.', 'Resume the paused task when the limit resets, or continue the rest with the other agent from the queue card.')}</p></section>`).join('')}
      <section class="panel"><b>${A('محتاجينك', 'Needs you')}${inbox.length ? ` (${inbox.length})` : ''}</b>${inbox.length ? inbox.map(xPermCard).join('') : `<p class="tiny muted">${A('مفيش طلبات مستنية دلوقتي.', 'Nothing is waiting for you right now.')}</p>`}</section>
      <div class="xlanes">${(execView.lanes ?? []).filter((lane) => lane.kind !== 'lane').map((home) => xLane(home) + (execView.lanes ?? []).filter((lane) => lane.kind === 'lane' && lane.parent === home.project).map(xLane).join('')).join('')}${(execView.lanes ?? []).filter((lane) => lane.kind === 'lane' && !(execView.lanes ?? []).some((h) => h.project === lane.parent)).map(xLane).join('')}</div>`;
  }

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
    if (!response.ok) throw Object.assign(new Error(data?.error?.message ?? `HTTP ${response.status}`), { status: response.status, code: data?.error?.code, data, messageAr: data?.error?.messageAr ?? null });
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
    return known[e.code] ?? (lang === 'ar' && e.messageAr ? e.messageAr : e.message);
  }
  // PF-0112 Phase 2: the server's Arabic copy of an execution message, in the Arabic console.
  const tr = (item, key = 'text') => (lang === 'ar' && item?.[`${key}Ar`] ? item[`${key}Ar`] : item?.[key] ?? '');
  const trDir = (item, key = 'text') => (lang === 'ar' && !item?.[`${key}Ar`] ? ' dir="ltr"' : '');
  // Escaped HTML of a message; in an Arabic sentence, each run of Latin text (a path, a command,
  // a branch) is isolated left-to-right, so it is never reordered by the Arabic around it.
  const trHtml = (item, key = 'text') => {
    const html = esc(tr(item, key));
    return lang === 'ar' && item?.[`${key}Ar`] ? html.replace(/[A-Za-z0-9_\/.\-"'@:=(),%+&;#~*[\]{}<>!?]+(?:\s+[A-Za-z0-9_\/.\-"'@:=(),%+&;#~*[\]{}<>!?]+)*/g, (run) => `<bdi dir="ltr">${run}</bdi>`) : html;
  };
  const retryable = (e) => !e.status || e.status === 503;
  const fileQueues = new WeakMap();
  function attachmentFields() {
    return `<section class="request-files"><label class="fld"><span>${A('مرفقات (اختياري)', 'Attachments (optional)')}</span><input type="file" data-request-files multiple accept="${ACCEPT}"></label><p class="tiny muted">${A('اختار ملفات أو الصق صورة بـ Ctrl+V داخل الطلب · لحد 50 MB للملف.', 'Choose files or paste a screenshot with Ctrl+V inside the request · up to 50 MB each.')}</p><ul class="pending-files" data-pending-files></ul><p class="tiny" data-file-note role="status" aria-live="polite"></p></section>`;
  }
  function renderPendingFiles(form) {
    const state = fileQueues.get(form);
    form.querySelector('[data-pending-files]').innerHTML = state.entries.map((entry, i) => `<li>${entry.url ? `<img src="${esc(entry.url)}" alt="" width="56" height="44">` : '<span aria-hidden="true">📎</span>'}<span class="grow"><b dir="auto">${esc(entry.file.name)}</b><small class="muted">${size(entry.file.size)}${entry.uploaded ? ` · ✓ ${A('اتضاف', 'Attached')}` : ''}</small>${entry.error ? `<small class="file-error">${esc(entry.error)}</small>` : ''}</span>${entry.uploaded ? '' : `<button type="button" class="ibtn" data-remove-file="${i}" aria-label="${esc(A(`احذف ${entry.file.name}`, `Remove ${entry.file.name}`))}" ${form.dataset.busy ? 'disabled' : ''}>✕</button>`}</li>`).join('');
  }
  function addRequestFiles(form, files, pasted = false) {
    const state = fileQueues.get(form);
    if (!state || form.dataset.busy) return;
    const problems = [];
    for (let file of files) {
      if (pasted) {
        const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[file.type];
        if (!ext) { problems.push(A('نوع الصورة مش مدعوم. اختار PNG أو JPG أو GIF أو WebP.', 'Use a PNG, JPG, GIF or WebP image.')); continue; }
        file = new File([file], `screenshot-${Date.now()}-${++state.sequence}.${ext}`, { type: file.type });
      }
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      const code = !ACCEPT.split(',').includes(ext) ? 'UNSUPPORTED_FILE' : !file.size ? 'EMPTY_FILE' : file.size > 50 * 1024 * 1024 ? 'TOO_LARGE' : null;
      if (code) { problems.push(why({ status: 422, code }, file)); continue; }
      state.entries.push({ file, url: /^image\/(png|jpeg|gif|webp)$/.test(file.type) ? URL.createObjectURL(file) : null, uploaded: false, error: null });
    }
    renderPendingFiles(form);
    form.querySelector('[data-file-note]').textContent = problems.join(' ') || A(`${state.entries.length} مرفق جاهز.`, `${state.entries.length} attachment(s) ready.`);
  }
  function initRequestFiles(form) {
    fileQueues.set(form, { entries: [], sequence: 0, requestId: newRequestId() });
    form.addEventListener('paste', (event) => {
      if (form.dataset.busy) return;
      const files = [...(event.clipboardData?.items ?? [])].filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter(Boolean);
      if (!files.length) files.push(...(event.clipboardData?.files ?? []));
      if (!files.length) return; // ordinary text paste remains native
      event.preventDefault(); addRequestFiles(form, files, true);
    });
    form.querySelector('[data-request-files]').addEventListener('change', (event) => {
      addRequestFiles(form, [...event.target.files]); event.target.value = '';
    });
    form.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-file]');
      if (!button || form.dataset.busy) return;
      const state = fileQueues.get(form), index = Number(button.dataset.removeFile);
      const entry = state.entries[index];
      if (!entry || entry.uploaded) return;
      if (entry.url) URL.revokeObjectURL(entry.url);
      state.entries.splice(index, 1); renderPendingFiles(form);
      form.querySelector('[data-file-note]').textContent = A('المرفق اتشال من الطلب.', 'Attachment removed from the request.');
      form.querySelector('[data-request-files]').focus();
    });
    const dialog = form.closest('dialog');
    dialog.addEventListener('cancel', (event) => { if (form.dataset.busy) event.preventDefault(); });
    dialog.addEventListener('close', () => { for (const entry of fileQueues.get(form)?.entries ?? []) if (entry.url) URL.revokeObjectURL(entry.url); fileQueues.delete(form); });
  }
  function requestBusy(form, busy) {
    if (busy) {
      form.dataset.busy = 'true';
      form._enabledControls = [...form.querySelectorAll('input,textarea,select,button')].filter((el) => !el.disabled);
      for (const el of form._enabledControls) el.disabled = true;
    } else {
      delete form.dataset.busy;
      for (const el of form._enabledControls ?? []) el.disabled = false;
      delete form._enabledControls;
    }
  }
  async function uploadRevisionFiles(form, projectId, id) {
    const state = fileQueues.get(form);
    for (const entry of state.entries.filter((entry) => !entry.uploaded)) {
      entry.error = null;
      try {
        await post(`/api/p/${projectId}/work/${encodeURIComponent(id)}/revision-sources`, entry.file, { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(entry.file.name), 'X-Request-Id': state.requestId });
        entry.uploaded = true;
      } catch (error) { entry.error = why(error, entry.file); }
    }
    renderPendingFiles(form);
    return state.entries.every((entry) => entry.uploaded);
  }

  function openCreate() {
    if (readOnly) return;
    const blocked = createBlockedReason();
    if (blocked) { toast(esc(blocked)); return; }
    cw = { requestId: newRequestId(), pid, created: null, files: [], failed: [], attached: [] };
    document.querySelector('dialog.create')?.remove();
    const d = document.createElement('dialog');
    d.className = 'create';
    d.setAttribute('aria-labelledby', 'cw-h');
    d.innerHTML = createForm();
    document.body.appendChild(d);
    initRequestFiles(d.querySelector('form'));
    d.addEventListener('close', () => { d.remove(); });
    d.showModal();
    d.querySelector('textarea').focus();
    if (projectOverview?.pid !== pid) loadProjectOverview().then(() => { const h = d.querySelector('[data-shared-hint]'); if (h && d.isConnected && cw.pid === pid) h.innerHTML = sharedHint(); });
  }
  function createForm() {
    const pick = projects.length > 1 ? `<label class="fld"><span>${A('المشروع', 'Project')}</span><select name="project">${projects.map((p) => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : '';
    return `<form data-create-form novalidate><div class="row"><h2 id="cw-h" class="grow">＋ ${A('شغل جديد', 'Create work')}</h2><button type="button" class="ibtn" data-cw-cancel aria-label="${A('إغلاق', 'Close')}">✕</button></div>
      ${pick}
      <div data-shared-hint>${sharedHint()}</div>
      <label class="fld"><span>${A('محتاج إيه؟', 'What do you need?')}</span><textarea name="request" rows="5" maxlength="20000" required placeholder="${A('مثلاً: العملاء يقدروا يصدّروا طلباتهم CSV من صفحة الطلبات…', 'For example: customers can export their orders to CSV from the orders page…')}"></textarea></label>
      <fieldset class="seg"><legend>${A('نوع الشغل', 'What kind of work?')}</legend>${KINDS.map(([v, l], i) => `<label><input type="radio" name="type" value="${v}" ${i === 0 ? 'checked' : ''}><span>${L(l)}</span></label>`).join('')}</fieldset>
      <fieldset class="seg" data-size hidden><legend>${A('الحجم', 'Size')}</legend>${SIZES.map(([v, l, tech]) => `<label><input type="radio" name="scope" value="${v}"><span>${L(l)} <i class="ltr">${tech}</i></span></label>`).join('')}</fieldset>
      ${attachmentFields()}
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
      <div class="row end">${cw.failed.some((f) => f.retry) ? `<button type="button" class="btn ghost" data-cw-retry>${A('جرّب الملفات تاني', 'Try the files again')}</button>` : ''}<button type="button" class="btn ghost" data-cw-close>${A('اقفل', 'Close')}</button><button type="button" class="btn go" data-cw-open>${A('افتح الشغلانة', 'Open the work item')}</button></div>`;
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
    if (form.dataset.busy) return;
    const d = form.closest('dialog');
    const err = form.querySelector('.formerr');
    const request = form.request.value.trim();
    const type = form.querySelector('input[name="type"]:checked')?.value || null;
    const scope = type ? form.querySelector('input[name="scope"]:checked')?.value ?? null : null;
    if (!request) { err.textContent = A('اكتب المطلوب في سطر أو اتنين.', 'Describe what you need in a line or two.'); form.request.focus(); return; }
    if (type && !scope) { err.textContent = A('اختار الحجم للنوع ده.', 'Choose a size for this kind of work.'); form.querySelector('input[name="scope"]').focus(); return; }
    cw.pid = form.project?.value ?? pid;
    const files = fileQueues.get(form).entries.map((entry) => entry.file);
    requestBusy(form, true);
    err.textContent = A('بيسجّل…', 'Creating…');
    try {
      const result = await post(`/api/p/${cw.pid}/work`, JSON.stringify({ requestId: cw.requestId, request, type, scope }), { 'Content-Type': 'application/json' });
      cw.created = result;
      cw.classifyError = result.classifyError ?? null;
    } catch (e) {
      // Nothing was created (or a retry will return it: the same request ID is reused).
      if (e.data?.readiness) { readiness = { pid: cw.pid, data: e.data.readiness }; render(); }
      err.textContent = e.code === 'PROJECT_UNDERSTANDING_REQUIRED' ? (createBlockedReason() ?? why(e)) : why(e);
      requestBusy(form, false);
      return;
    }
    cw.failed = await uploadAll(d, files);
    requestBusy(form, false);
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
  // PF-0123: a redraw never lands under a pressed pointer (the press would be lost: its click
  // target is replaced before the button is released) and an identical page is never rebuilt.
  // Deferral lasts only while the button is physically held (a safety limit covers a release the
  // page never saw), so permission requests, failures and live agent states still appear promptly.
  const POINTER_DEFER_MS = 4000;
  let pointerDownAt = 0;
  let deferredRender = null;
  let lastHtml = null;
  const pointerPressed = () => pointerDownAt && Date.now() - pointerDownAt < POINTER_DEFER_MS;
  function flushDeferredRender() {
    if (!deferredRender) return;
    clearTimeout(deferredRender);
    deferredRender = null;
    render();
  }
  document.addEventListener('pointerdown', (e) => { if (e.button === 0 && e.target.closest?.('#app')) pointerDownAt = Date.now(); }, true);
  window.addEventListener('blur', () => { pointerDownAt = 0; setTimeout(flushDeferredRender, 0); });
  for (const type of ['pointerup', 'pointercancel', 'dragstart']) document.addEventListener(type, () => { pointerDownAt = 0; setTimeout(flushDeferredRender, 0); }, true);
  // Scrollable regions inside the page keep their position across a redraw.
  const SCROLL_KEEP = '.map, .chain, .svclog, .tablewrap, .astream, .logpre, .folders';
  // The identical-page skip is only safe when nothing changed the page since it was drawn: some
  // actions change it directly (a button disabled while its request runs, a streamed chat line)
  // and rely on the next redraw. Any such change marks the page dirty, so the next redraw rebuilds
  // it as before. The Flow connectors are measured decoration and do not count.
  let domDirty = true;
  const noteMutations = (records) => { if (records.some((rec) => !(rec.target.closest ? rec.target.closest('.connectors') : rec.target.parentElement?.closest('.connectors')))) domDirty = true; };
  const domWatch = new MutationObserver(noteMutations);
  // Typed values, ticks and selections are properties the observer cannot see: they mark the page
  // dirty too, so a redraw meant to reset a field (a prepared message, a refused choice) is never skipped.
  for (const type of ['input', 'change']) document.addEventListener(type, (e) => { if (e.target.closest?.('#app')) domDirty = true; }, true);
  function render() {
    if (pointerPressed()) {
      if (!deferredRender) deferredRender = setTimeout(() => { deferredRender = null; pointerDownAt = 0; render(); }, Math.max(0, POINTER_DEFER_MS - (Date.now() - pointerDownAt)));
      return;
    }
    if (deferredRender) { clearTimeout(deferredRender); deferredRender = null; }
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
    const r = route();
    if (r.v === 'map' || r.v === 'lines') store.set('wsView', r.v);
    const hadQ = document.activeElement?.matches?.('[data-q]');
    const hadAgent = document.activeElement?.matches?.('[data-agent-input]');
    const chatBody = document.querySelector('#chatwin .chatbody');
    const chatEnd = chatForceEnd || chatAtEnd(); const chatTop = chatBody?.scrollTop ?? 0;
    chatForceEnd = false;
    document.title = (snap?.counts?.you ? `(${snap.counts.you}) ` : '') + 'YallaFlow' + (snap?.project?.name ? ` · ${snap.project.name}` : '');
    if (!projects.length && snap && !['new', 'projects'].includes(r.v)) { location.hash = '#/projects'; return; }
    const views = { new: viewNew, setup: viewSetup, overview: viewOverview, item: () => viewItem(r.id), lines: viewLines, agents: viewAgents, team: viewTeam, insights: viewInsights, projects: viewProjects, map: viewMap };
    const body = !snap ? `<p class="muted" style="margin-top:40px;text-align:center">${error ? '' : A('بيحمّل…', 'Loading…')}</p>` : (views[r.v] ?? viewMap)();
    // Forms marked data-keep survive a redraw: typed values and focus are carried over (PF-0057).
    const kept = [...document.querySelectorAll('form[data-keep]')].map((form) => ({ key: form.dataset.keep, values: [...form.elements].filter((el) => el.name && el.type !== 'file' && (el.type === 'checkbox' || el.type === 'radio' ? el.checked !== el.defaultChecked : el.value !== el.defaultValue)).map((el) => [el.name, el.type === 'checkbox' || el.type === 'radio' ? (el.type === 'radio' ? (el.checked ? el.value : null) : el.checked) : el.value, el.type]), focus: form.contains(document.activeElement) ? document.activeElement.name : null, caret: document.activeElement?.selectionStart ?? null }));
    const html = topbar(r) + `<main>${banner()}${snap && ['map', 'lines'].includes(r.v) ? agentStrip() + (readiness?.pid === pid ? readinessCard() : understandingStrip()) : ''}${body}</main>` + (chatCtx(r) ? agentDock(chatCtx(r)) : '');
    const appEl = document.getElementById('app');
    // Nothing changed: keep the live DOM (focus, selection, open menus, hover, a click in progress).
    noteMutations(domWatch.takeRecords());
    if (html === lastHtml && appEl.childElementCount && !domDirty) return;
    lastHtml = html;
    const scrolls = [...appEl.querySelectorAll(SCROLL_KEEP)].map((el, i) => [i, el.scrollTop, el.scrollLeft]);
    const pageY = window.scrollY;
    appEl.innerHTML = html;
    if (scrolls.length) { const now = [...appEl.querySelectorAll(SCROLL_KEEP)]; for (const [i, top, left] of scrolls) if (now[i]) { now[i].scrollTop = top; now[i].scrollLeft = left; } }
    if (window.scrollY !== pageY) window.scrollTo(window.scrollX, pageY);
    domWatch.observe(appEl, { childList: true, subtree: true, attributes: true, characterData: true });
    domWatch.takeRecords();
    domDirty = false;
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
    if (chatEnd) toChatEnd(); else { const body = document.querySelector('#chatwin .chatbody'); if (body) body.scrollTop = chatTop; }
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
  // PF-0112: the queue sheet's confirmation tick and submit.
  document.addEventListener('change', (e) => { if (e.target.matches('[data-machine-ack]')) { machineUi.ack = e.target.checked; const b = document.querySelector('[data-machine="codex/install"]'); if (b) b.disabled = !machineUi.ack || Boolean(machineUi.busy); } });
  document.addEventListener('change', (e) => {
    if (e.target.matches?.('[data-approval-wait]')) {
      setupPost('agents/approval-wait', { minutes: Number(e.target.value) }).then(() => toast(A('اتحفظ. بيتطبّق على الطلبات الجاية.', 'Saved. It applies to new requests.'))).catch((err) => toast(esc(why(err))));
      return;
    }
    if (e.target.matches?.('[data-queue-confirm]')) { const b = document.querySelector('[data-queue-start]'); if (b) b.disabled = !e.target.checked; }
    if (e.target.matches?.('[data-parallel-confirm]')) { const b = document.querySelector('[data-parallel-start]'); if (b) b.disabled = !e.target.checked || b.hasAttribute('data-blocked'); }
    if (e.target.matches?.('[data-shared-confirm]')) { const b = e.target.closest('[data-shared-panel]')?.querySelector('[data-shared-enable]'); if (b) b.disabled = !e.target.checked; }
    if (e.target.matches?.('[data-cleanup-confirm]')) { const b = document.querySelector('[data-cleanup-start]'); if (b) b.disabled = !e.target.checked; }
    if (e.target.matches?.('[data-review-confirm]')) { const b = document.querySelector('[data-review-start]'); if (b) b.disabled = !e.target.checked || !reviewState?.ok; }
    if (e.target.matches?.('[data-review-file],[data-review-check]') && reviewState) {
      // A changed tick changes what would be committed or run: the review (and its plan hash) is prepared again.
      const files = [...document.querySelectorAll('[data-review-file]')];
      const exclude = files.filter((box) => !box.checked && !box.dataset.secret).map((box) => box.dataset.reviewFile);
      const include = files.filter((box) => box.checked && box.dataset.secret).map((box) => box.dataset.reviewFile);
      const checks = [...document.querySelectorAll('[data-review-check]')].filter((box) => box.checked).map((box) => box.dataset.reviewCheck);
      openReview(reviewState.home, reviewState.laneId, { exclude, include, checks });
    }
  });
  document.addEventListener('submit', (e) => {
    if (e.target.matches?.('[data-queue-form]')) { e.preventDefault(); startQueue(e.target); }
    if (e.target.matches?.('[data-parallel-form]')) { e.preventDefault(); startParallelRun(e.target); }
    if (e.target.matches?.('[data-cleanup-form]')) { e.preventDefault(); runCleanup(e.target); }
    if (e.target.matches?.('[data-review-form]')) { e.preventDefault(); approveMerge(); }
  });

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
    if (pid && (['map', 'lines', 'overview', 'setup'].includes(v) || readiness?.pid !== pid)) await loadReadiness();
    if (!readOnly && (v === 'setup' || !machineInfo)) await loadMachine();
    // Project pages load the agent state only while the chat is open (PF-0067).
    if (v === 'item' || ((chatOpen || ['map', 'lines'].includes(v)) && PROJECT_CHAT_VIEWS.includes(v))) { if (agentsOn) await loadAgent(); else await loadAgentInfo(); }
    if (agentsOn && (v === 'agents' || !execView)) await loadExecution();
    if (v === 'team') await loadTeam();
    else if (v === 'projects') await loadOverview();
    else if (pid && (v === 'overview' || ((v === 'map' || v === 'lines') && projectOverview?.pid !== pid))) { await loadProjectOverview(); if (v === 'overview' && projectOverview?.data?.project?.kind === 'greenfield') { await loadRuntime(); if (!agentsOn) await loadAgentInfo(); } }
    else if (v === 'setup') await Promise.all([loadRuntime(), loadSetup(), loadPlan()]);
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
            else if (event.type === 'agent') { onAgentEvent(event.project, event.event); if (['permission.requested', 'permission.resolved', 'session.started', 'session.ended', 'session.stopped', 'turn.started', 'turn.ended', 'session.connected', 'session.disconnected'].includes(event.event?.type)) scheduleExecution(); }
            else if (event.type === 'execution') scheduleExecution();
            // 1.4.0 (PF-0057): a project was added, or agents were enabled, in this console.
            else if (event.type === 'projects') { await reloadProjects().catch(() => {}); await leaveRemovedProject().catch(() => {}); if (route().v === 'projects') await loadOverview(); render(); }
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
    closeDrawer(); bellOpen = false; dtab = null; const v = route().v; if (v === 'item') { detail = null; render(); await load(); await loadForView(); } else if (['team', 'projects', 'overview', 'map', 'lines', 'setup', 'new', 'agents'].includes(v)) { render(); await loadForView(); } else syncRuntimePolling(); render(); scrollTo(0, 0); });
  document.addEventListener('submit', (e) => {
    const step = e.target.closest('[data-wiz-step]');
    if (step) { e.preventDefault(); wizardNext(step); return; }
    const create = e.target.closest('[data-wiz-create]');
    if (create) { e.preventDefault(); wizardCreate(create); }
  });
  document.addEventListener('change', (e) => {
    if (e.target.matches?.('[data-plan-pick]')) { if (e.target.checked) planPick.add(e.target.dataset.planPick); else planPick.delete(e.target.dataset.planPick); const btn = document.querySelector('[data-plan-save]'); if (btn) { btn.disabled = !planPick.size || Boolean(setupBusy); btn.textContent = A(`احفظ المختار (${planPick.size})`, `Save selected (${planPick.size})`); } return; }
    if (e.target.matches?.('input[name="wiz-stack"], input[name="wiz-env"], input[name="wiz-agent"]') && wiz.form) {
      const f = wiz.form;
      if (e.target.name === 'wiz-stack') { if (e.target.value === 'custom') { f.stack = 'empty'; f.customStack = f.customStack?.trim() ? f.customStack : ' '; } else { f.stack = e.target.value; f.customStack = ''; } }
      else if (e.target.name === 'wiz-env') f.environment = e.target.value;
      else f.agent = e.target.value;
      // Every card of the same choice, across its groups (PF-0087 fix: groups are separate fieldsets).
      for (const radio of e.target.closest('form').querySelectorAll(`input[name="${e.target.name}"]`)) radio.closest('.stackcard')?.classList.toggle('on', radio.checked);
    }
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
    if (e.target.closest('[data-folder-preview]')) { previewFolder(); return; }
    if (e.target.closest('[data-folder-connect]')) { connectFolder(); return; }
    if (e.target.closest('[data-folder-back]') && folder) { folder.preview = null; folder.previewError = null; renderFolder(); return; }
    if (e.target.closest('[data-folder-new]') && folder) { folder.creating = true; renderFolder(); document.querySelector('#folderdlg [data-folder-newform] input')?.focus(); return; }
    if (e.target.closest('[data-folder-newcancel]') && folder) { folder.creating = false; renderFolder(); return; }
    const wo = e.target.closest('[data-wiz-open]');
    if (wo) { const id = wo.dataset.wizOpen; resetWizard(); switchProject(id, 'overview'); return; }
    if (e.target.closest('[data-folder-close]')) { document.getElementById('folderdlg')?.close(); folder = null; return; }
    if (e.target.closest('[data-agents-enable]')) { enableAgents(); return; }
    if (e.target.closest('[data-agents-cancel]')) { document.getElementById('agentsdlg')?.close(); return; }
    const rmp = e.target.closest('[data-remove-project]');
    if (rmp) { const p = projects.find((x) => x.id === rmp.dataset.removeProject); if (p) askRemoveProject({ id: p.id, name: p.name }); return; }
    const rmr = e.target.closest('[data-remove-project-root]');
    if (rmr) { askRemoveProject({ root: rmr.dataset.removeProjectRoot, name: rmr.dataset.removeProjectRoot }); return; }
    if (e.target.closest('[data-remove-project-cancel]')) { removing = null; document.getElementById('rmprojdlg')?.close(); return; }
    if (e.target.closest('[data-chat-toggle]')) { toggleChat(); return; }
    // PF-0123: readiness → the project chat opens with the prepared request; the developer sends it.
    const readyChat = e.target.closest('[data-ready-chat]');
    if (readyChat) { agentDraft = readyChat.dataset.readyChat; toggleChat(true); return; }
    const sugg = e.target.closest('[data-suggest]');
    if (sugg) { useSuggestion(sugg.dataset.suggest); return; }
    const ask = e.target.closest('[data-chat-item]');
    if (ask) {
      // From a card: open the item with the chat and a question about where it stands.
      e.preventDefault(); e.stopPropagation();
      const id = ask.dataset.chatItem;
      // PF-0105: open with the whole job, not a status question.
      // An explicit empty draft (a call-out, 'See what it needs') keeps the box as it is.
      agentDraft = ask.hasAttribute('data-chat-draft') ? (ask.dataset.chatDraft || agentDraft) : goText(byId(id) ?? { id });
      const target = `#/item/${encodeURIComponent(id)}`;
      // Already on that item (the next-step button, PF-0092): open the chat in place.
      if (location.hash === target) { toggleChat(true); return; }
      chatOpen = true; store.set('chatOpen', true);
      location.hash = target;
      return;
    }
    if (e.target.closest('[data-git-init]')) { gitInitAction(); return; }
    // PF-0069: project setup.
    if (e.target.closest('[data-setup-scan]')) { scanStack(); return; }
    const sst = e.target.closest('[data-setup-step]');
    if (sst) { markStep(sst.dataset.setupStep); return; }
    const rta = e.target.closest('[data-rt-all]');
    if (rta) { runProject(rta.dataset.rtAll); return; }
    // PF-0072: Analyze → Review and save → Trust → Start.
    if (e.target.closest('[data-rt-analyze]')) { analyzeProject()?.then(() => { autoPickPlan(); render(); }); return; }
    if (e.target.closest('[data-rt-ask-agent]')) { startAgentPlan(); return; }
    // PF-0073: waiting for the agent's proposal, and the way to the Agents settings.
    if (e.target.closest('[data-plan-wait-cancel]')) { planAwaitAgent = null; render(); return; }
    if (e.target.closest('[data-goto-agents]')) { setupOpen.set('configure', true); render(); document.getElementById('setup-agents')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const pv = e.target.closest('[data-plan-view]');
    if (pv) { planView = pv.dataset.planView; autoPickPlan(); planReplaceAsk = null; render(); return; }
    if (e.target.closest('[data-plan-save]')) { savePlan(false); return; }
    if (e.target.closest('[data-plan-replace]')) { savePlan(true); return; }
    if (e.target.closest('[data-plan-replace-cancel]')) { planReplaceAsk = null; render(); return; }
    const rvw = e.target.closest('[data-rt-review]');
    if (rvw) { const id = rvw.dataset.rtReview; loadReview(id).then(() => { render(); document.querySelector(`[data-review="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }); return; }
    const rsh = e.target.closest('[data-rt-shared]');
    if (rsh) { runtimeAction(`shared-${rsh.dataset.rtShared}`, rsh.dataset.id); return; }
    const rshc = e.target.closest('[data-rt-shared-cancel]');
    if (rshc) { delete sharedAsk[rshc.dataset.rtSharedCancel]; render(); return; }
    if (e.target.closest('[data-agents-launch]')) { writeLaunch(); return; }
    if (e.target.closest('[data-agents-rescan]')) { setupDo('rescan', async () => { await loadMachine(); }, { scanAgents: true }); return; }
    const scrollTo2 = e.target.closest('[data-scroll-to]');
    if (scrollTo2) { const el = document.getElementById(scrollTo2.dataset.scrollTo); if (el) { if (el.tagName === 'DETAILS') el.open = true; el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); el.querySelector('button, a, input')?.focus({ preventScroll: true }); } return; }
    // PF-0123: agent setup on this machine.
    const mo = e.target.closest('[data-machine-open]');
    if (mo) { machineUi.open = mo.dataset.machineOpen; machineUi.ack = false; machineUi.verifyError = null; render(); return; }
    if (e.target.closest('[data-machine-close]')) { machineUi.open = null; machineUi.ack = false; render(); return; }
    const machineBtn = e.target.closest('[data-machine]');
    if (machineBtn) { const action = machineBtn.dataset.machine; machinePost(action, action === 'codex/install' ? { confirm: true, planHash: machineBtn.dataset.plan } : action === 'codex/login' ? { confirm: true } : {}); return; }
    const sd = e.target.closest('[data-agent-strip-dismiss]');
    if (sd) { store.set('agentStripDismissed', sd.dataset.agentStripDismiss); render(); return; }
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
    // PF-0105: one click sends the continue message; the developer pressed it.
    if (e.target.closest('[data-agent-continue]')) { const it = chatCtx(); if (it && !it.project) { chatForceEnd = true; agentAction('message', { text: goOnText(it) }); } return; }
    // PF-0110: end the finished item's session, start Codex here, send the whole-job message.
    const startHere = e.target.closest('[data-agent-switch-start]');
    if (startHere) {
      const it = byId(startHere.dataset.agentSwitchStart);
      if (!it) return;
      (async () => {
        if (!(await agentAction('end', {}))) return;
        if (!(await agentAction('start', { provider: 'codex', workId: it.id, mode: agentMode }))) return;
        chatForceEnd = true;
        await agentAction('message', { text: goText(it) });
      })();
      return;
    }
    // PF-0103: switching the project's one agent slot.
    if (e.target.closest('[data-agent-switch-end]')) { agentProvider = null; agentAction('end', {}); return; }
    const toCodex = e.target.closest('[data-agent-switch-codex]');
    if (toCodex) { switchWanted = toCodex.dataset.agentSwitchCodex; agentProvider = 'codex'; renderAgent(); return; }
    if (e.target.closest('[data-agent-switch-cancel]')) { switchWanted = null; agentProvider = null; renderAgent(); return; }
    const sw = e.target.closest('[data-agent-switch]');
    if (sw) { const it = byId(route().id); if (it) switchAgent(sw.dataset.agentSwitch, it); return; }
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
    const cwx = e.target.closest('[data-create],[data-cw-cancel],[data-cw-open],[data-cw-retry],[data-cw-close]');
    if (cwx) {
      if (cwx.hasAttribute('data-create')) openCreate();
      // PF-0106: close the "Created" dialog and stay on this page, refreshed.
      else if (cwx.hasAttribute('data-cw-close')) { cwx.closest('dialog')?.close(); refresh(); }
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
    const ma = e.target.closest('[data-review-open],[data-review-cancel],[data-merge-act],[data-sendback]');
    if (ma) {
      e.preventDefault();
      if (ma.dataset.sendback) {
        if (!confirm(A('ترجّع المهمة لوكيلها؟ هتتفتح تاني والوكيل هيبدأ يدمج الفرع الأساسي في المسار ويحل التعارض.', 'Send the task back to its agent? It is reopened and the agent starts bringing the main branch into the lane to resolve the conflict.'))) return;
        post(`/api/p/${ma.dataset.home}/execution/merge-sendback`, JSON.stringify({ laneId: ma.dataset.sendback, lang, confirmed: true }), { 'Content-Type': 'application/json' })
          .then(() => { document.getElementById('reviewdlg')?.close(); toast(A('المهمة رجعت لوكيلها.', 'The task went back to its agent.')); scheduleExecution(); })
          .catch((err) => { const box = document.querySelector('#reviewdlg .conflictbox'); if (box) box.insertAdjacentHTML('beforeend', `<p class="small fail" role="alert">${esc(why(err))}</p>`); else toast(esc(why(err))); });
        return;
      }
      if (ma.dataset.reviewOpen) openReview(ma.dataset.home, ma.dataset.reviewOpen);
      else if (ma.dataset.reviewCancel !== undefined) document.getElementById('reviewdlg')?.close();
      else if (ma.dataset.mergeAct) {
        if (ma.dataset.mergeAct === 'abandon' && !confirm(A('تسيب الدمج ده زي ما هو؟ مفيش حاجة هتترجع لورا؛ اللي اتعمل هيفضل.', 'Abandon this merge as it is? Nothing is undone; what was done stays.'))) return;
        post(`/api/p/${ma.dataset.home}/execution/merge-${ma.dataset.mergeAct}`, JSON.stringify({ mergeId: ma.dataset.merge }), { 'Content-Type': 'application/json' }).then(() => scheduleExecution()).catch((err) => toast(esc(why(err))));
      }
      return;
    }
    const pa = e.target.closest('[data-parallel-open],[data-parallel-cancel],[data-shared-enable],[data-shared-open],[data-shared-cancel],[data-cleanup-open],[data-cleanup-cancel]');
    if (pa) {
      e.preventDefault();
      if (pa.dataset.parallelOpen !== undefined) openParallelSheet();
      else if (pa.dataset.parallelCancel !== undefined) document.getElementById('paralleldlg')?.close();
      else if (pa.dataset.sharedEnable !== undefined) enableSharedNow();
      else if (pa.dataset.sharedOpen !== undefined) openSharedSheet();
      else if (pa.dataset.sharedCancel !== undefined) document.getElementById('shareddlg')?.close();
      else if (pa.dataset.cleanupOpen !== undefined) openCleanup(pa.dataset.home, pa.dataset.cleanupOpen);
      else if (pa.dataset.cleanupCancel !== undefined) document.getElementById('cleanupdlg')?.close();
      return;
    }
    const qa = e.target.closest('[data-select-toggle],[data-select-off],[data-sel],[data-queue-open],[data-queue-cancel],[data-q-up],[data-q-down],[data-run-act]');
    if (qa) {
      e.preventDefault();
      if (qa.dataset.selectToggle !== undefined) { selecting = !selecting; selected = []; render(); return; }
      if (qa.dataset.selectOff !== undefined) { selecting = false; selected = []; render(); return; }
      if (qa.dataset.sel) { const id = qa.dataset.sel; selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]; render(); return; }
      if (qa.dataset.queueOpen !== undefined) { openQueueSheet(); return; }
      if (qa.dataset.queueCancel !== undefined) { document.getElementById('queuedlg')?.close(); return; }
      if (qa.dataset.qUp !== undefined || qa.dataset.qDown !== undefined) {
        const i = Number(qa.dataset.qUp ?? qa.dataset.qDown); const j = qa.dataset.qUp !== undefined ? i - 1 : i + 1;
        [selected[i], selected[j]] = [selected[j], selected[i]]; openQueueSheet(); return;
      }
      if (qa.dataset.runAct) {
        const act = qa.dataset.runAct;
        if (act === 'cancel-now' && !confirm(A('توقف الطابور دلوقتي؟ الجلسة الحالية هتقفل، والشغل اللي اتعمل هيفضل زي ما هو.', 'Stop the queue now? The current session ends; work already done stays as it is.'))) return;
        const body = { runId: qa.dataset.run, taskId: qa.dataset.task, provider: qa.dataset.provider, ...(act === 'cancel-now' ? { scope: 'now', confirmed: true } : act === 'cancel-after' ? { scope: 'after-current' } : {}) };
        if (act === 'up' || act === 'down') {
          const run = execView.lanes.find((l) => l.project === qa.dataset.xPid)?.runs.find((r) => r.id === qa.dataset.run);
          const queued = run.lanes[0].tasks.filter((task) => task.state === 'queued').map((task) => task.id);
          const i = queued.indexOf(qa.dataset.task); const j = act === 'up' ? i - 1 : i + 1;
          if (j < 0 || j >= queued.length) return;
          [queued[i], queued[j]] = [queued[j], queued[i]];
          execAct(qa.dataset.xPid, 'reorder', { runId: qa.dataset.run, taskIds: queued });
          return;
        }
        execAct(qa.dataset.xPid, act.startsWith('cancel') ? 'cancel' : act, body);
      }
      return;
    }
    const xa = e.target.closest('[data-x-perm],[data-x-act],[data-x-open]');
    if (xa) {
      e.preventDefault();
      const xpid = xa.dataset.xPid ?? xa.dataset.xOpen;
      if (xa.dataset.xOpen) { const target = `item/${encodeURIComponent(xa.dataset.xWork)}`; if (xpid === pid) location.hash = `#/${target}`; else switchProject(xpid, target); return; }
      xa.disabled = true;
      const body = xa.dataset.xPerm ? { requestId: xa.dataset.xPerm, decision: xa.dataset.decision } : {};
      post(`/api/p/${xpid}/agent/${xa.dataset.xPerm ? 'permission' : xa.dataset.xAct}`, JSON.stringify(body), { 'Content-Type': 'application/json' })
        .then(() => scheduleExecution())
        .catch((err) => { toast(esc(why(err))); xa.disabled = false; });
      return;
    }
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
    else if (x.dataset.copy) copy(x.dataset.copy, x.dataset.copyWhat);
  });
  document.addEventListener('toggle', (e) => { const key = e.target.dataset?.overview; if (key && e.target.isConnected) { if (e.target.open) overviewExpanded.add(key); else overviewExpanded.delete(key); } const sx = e.target.dataset?.sx; if (sx && e.target.isConnected) setupOpen.set(sx, e.target.open); }, true);
  document.addEventListener('input', (e) => { if (e.target.closest('[data-gate-form]')) gateReady(e.target.closest('[data-gate-form]')); });
  document.addEventListener('change', (e) => { if (e.target.matches?.('[data-gate-form] [name="confirmed"], [data-gate-form] [name="decision"]')) gateReady(e.target.closest('[data-gate-form]')); });
  // PF-0101: a trust or shared-service button waits for its box to be ticked.
  document.addEventListener('change', (e) => {
    const box = e.target.closest?.('[data-trust-input], [data-shared-input]');
    if (!box) return;
    const id = box.dataset.trustInput ?? box.dataset.sharedInput;
    const key = `${box.dataset.trustInput !== undefined ? 'trust' : 'shared'}:${id}`;
    if (box.checked) rtTicked.add(key); else rtTicked.delete(key);
    const scope = box.closest('[data-review], [data-shared-ask]') ?? document;
    for (const btn of scope.querySelectorAll(`[data-needs-tick="${CSS.escape(id)}"]`)) btn.disabled = !box.checked || Boolean(runtimeBusy[id]);
  });
  // PF-0097: expand the review dialog, quick notes, and the contents links.
  document.addEventListener('click', (e) => {
    const wide = e.target.closest('[data-gate-wide]');
    if (wide) { const d = wide.closest('dialog'); const on = d.classList.toggle('full'); store.set('gateWide', on); wide.setAttribute('aria-pressed', String(on)); wide.textContent = on ? A('⤡ صغّر', '⤡ Smaller') : A('⤢ كبّر', '⤢ Expand'); return; }
    const note = e.target.closest('[data-gate-note]');
    if (note) {
      const form = note.closest('[data-gate-form]');
      const box = form.querySelector('[name="note"]');
      box.value = note.dataset.gateNote; box.focus(); box.setSelectionRange(box.value.length, box.value.length);
      const decision = form.querySelector(`[name="decision"][value="${note.hasAttribute('data-gate-changes') ? 'request_changes' : 'approve'}"]`);
      if (decision) decision.checked = true;
      gateReady(form); return;
    }
    const jump = e.target.closest('[data-gate-jump]');
    if (jump) { e.preventDefault(); document.getElementById(jump.dataset.gateJump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  // PF-0087: typing a stack of your own selects «Something else».
  const pickCustom = (e) => { if (e.target.matches?.('[name="customStack"]')) { const r = e.target.closest('label')?.querySelector('input[type="radio"]'); if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); } } };
  document.addEventListener('input', pickCustom);
  document.addEventListener('focusin', pickCustom);
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
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('[data-chat-wide]')) return;
    e.preventDefault();
    chatWide = !chatWide;
    store.set('chatWide', chatWide);
    const win = document.getElementById('chatwin');
    win?.classList.toggle('wide', chatWide);
    const button = e.target.closest('[data-chat-wide]');
    const label = chatWide ? A('رجّعها لحجمها', 'Restore size') : A('كبّر الشات', 'Enlarge the chat');
    button.setAttribute('aria-pressed', String(chatWide));
    button.setAttribute('aria-label', label);
    button.title = label;
    button.textContent = chatWide ? '⤡' : '⤢';
    win?.querySelector('.chatbody')?.lastElementChild?.scrollIntoView?.({ block: 'end' });
  });
  // PF-0123: the header's More menu closes with Esc (focus back on it) or a click elsewhere.
  document.addEventListener('keydown', (e) => { const menu = document.querySelector('[data-navmore][open]'); if (e.key === 'Escape' && menu) { menu.open = false; menu.querySelector('summary')?.focus(); } });
  document.addEventListener('click', (e) => { const menu = document.querySelector('[data-navmore][open]'); if (menu && !menu.contains(e.target)) menu.open = false; }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && chatOpen && document.getElementById('chatwin')?.contains(e.target) && !document.querySelector('dialog[open]')) { e.preventDefault(); toggleChat(false); } });
  document.addEventListener('keydown', (e) => { if (e.target.matches?.('[data-agent-input]') && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.target.form.requestSubmit(); } });
  document.addEventListener('submit', (e) => {
    if (e.target.matches('[data-act-form]')) { e.preventDefault(); submitAction(e.target); return; }
    if (e.target.matches('[data-gate-form]')) { e.preventDefault(); submitGate(e.target); return; }
    if (e.target.matches('[data-rt-form]')) { e.preventDefault(); submitService(e.target); return; }
    if (e.target.matches('[data-agents-settings]')) { e.preventDefault(); saveAgents(e.target); return; }
    if (e.target.matches('[data-agents-form]')) { e.preventDefault(); confirmAgents(e.target); return; }
    if (e.target.matches('[data-remove-project-form]')) { e.preventDefault(); confirmRemoveProject(); return; }
    if (e.target.matches('[data-create-form]')) { e.preventDefault(); submitCreate(e.target); }
    else if (e.target.matches('[data-agent-form]')) { e.preventDefault(); const text = agentDraft.trim(); if (!text) return; agentDraft = ''; chatForceEnd = true; agentAction('message', { text }).then((sent) => { if (!sent && !agentDraft) { agentDraft = text; renderAgent(); } }); }
  });
  document.addEventListener('change', async (e) => {
    if (e.target.matches('[name="acknowledgeScripts"]')) { wiz.acknowledged = e.target.checked; const go = document.querySelector('[data-wiz-create-btn]'); if (go) go.disabled = wiz.busy || !wiz.acknowledged; return; }
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
