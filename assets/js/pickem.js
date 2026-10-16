let managers = [];
let currentManager = null; // logged-in manager name, or null
let questions = [];
let myPicks = {};    // question_id -> choice, last saved to the server
let draftPicks = {};  // question_id -> choice, local working copy (may include unsaved edits)
let pageMode = 'editing'; // 'editing' (buttons live, Submit shown) | 'saved' (read-only, Edit shown)
let archivedWeeks = []; // week numbers whose questions are all locked, oldest-first - built once in buildTabs()

// Every batch of questions gets a `week` bucket - 0 is Draft Day, -1 is the original season-long
// "Season I" props (locks after the draft but before Week 1), -2 is "Season II" (a second
// season-long batch added once real Week 1-3 results existed to inform better lines - locks
// after Week 3, before Week 4), 1+ are real weekly props. Display order is fixed (Draft, Season I,
// Season II, then Week 1/2/3/...) rather than sorted by actual lock time - Season II locks well
// into the season but reads better grouped with Season I than interleaved into the weekly
// archive - so weekSortKey encodes that fixed order directly instead of the raw week number.
function weekLabel(week) {
  if (week === 0) return 'Draft';
  if (week === -1) return 'Season I';
  if (week === -2) return 'Season II';
  return `Week ${week}`;
}
function weekSortKey(week) {
  if (week === 0) return -3;
  if (week === -1) return -2;
  if (week === -2) return -1;
  return week;
}

// Stowe is a former manager (2013-2016), still kept in data/managers.json for the historical
// archive, but he doesn't draft/play in the live season - exclude him from every pick'em
// manager-choice surface (login, pick-a-manager options) without touching the shared data file.
const PICKEM_INACTIVE_MANAGERS = ['Stowe'];
function activeManagers() {
  return managers.filter(m => !PICKEM_INACTIVE_MANAGERS.includes(m.manager));
}

function emptyState(headline, sub) {
  return `<div class="empty-state"><div class="headline">${headline}</div><p style="margin:0;">${sub}</p></div>`;
}

async function api(path, opts) {
  const res = await fetch('/api/' + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Request failed');
  return body;
}

function renderLogin() {
  const el = document.getElementById('loginArea');
  if (currentManager) {
    el.innerHTML = `
      <div class="login-card logged-in">
        <span>Logged in as ${managerTag(managers, currentManager)}</span>
        <button class="btn btn-ghost" id="logoutBtn">Log out</button>
      </div>
    `;
    document.getElementById('logoutBtn').onclick = async () => {
      await api('logout', { method: 'POST' });
      currentManager = null;
      myPicks = {};
      draftPicks = {};
      pageMode = 'editing';
      renderLogin();
      renderPicks();
    };
    return;
  }

  const options = activeManagers().map(m => `<option value="${m.manager}">${m.manager}</option>`).join('');
  el.innerHTML = `
    <div class="login-card">
      <div class="field">
        <label>Manager</label>
        <select id="loginManager">${options}</select>
      </div>
      <div class="field">
        <label>Password</label>
        <input type="password" id="loginPassword" placeholder="Password">
      </div>
      <button class="btn" id="loginBtn">Log In</button>
      <span class="login-error" id="loginError"></span>
    </div>
    <p class="login-hint">First time? Just pick your name and enter any password &mdash; that becomes your password going forward.</p>
  `;
  document.getElementById('loginBtn').onclick = async () => {
    const manager = document.getElementById('loginManager').value;
    const password = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    try {
      const body = await api('login', { method: 'POST', body: JSON.stringify({ manager, password }) });
      currentManager = body.manager;
      renderLogin();
      await loadPicks();
      renderPicks();
    } catch (e) {
      errEl.textContent = e.message;
    }
  };
}

// pageMode only cares about the CURRENTLY OPEN batch ("This Week"), not a manager's picks
// history overall - a manager who already submitted the (now-archived) Draft questions but
// hasn't touched this week's new batch yet should land straight in the open, editable view, not
// a "saved" view with nothing actually saved for what's in front of them. Only submitting the
// current batch should flip it to 'saved' - that's what "only have to hit edit after your first
// submission" means in practice.
function computePageMode() {
  if (!currentManager) return 'editing';
  const now = new Date();
  const openIds = questions.filter(q => new Date(q.lock_at) > now).map(q => q.id);
  const hasSubmittedOpenBatch = openIds.some(id => myPicks[id] !== undefined);
  return hasSubmittedOpenBatch ? 'saved' : 'editing';
}

async function loadPicks() {
  myPicks = {};
  if (!currentManager) { draftPicks = {}; pageMode = 'editing'; return; }
  const rows = await api('picks').catch(() => []);
  rows.forEach(r => { myPicks[r.question_id] = r.choice; });
  draftPicks = { ...myPicks };
  // Managers who already submitted picks for the currently open batch land in a read-only
  // "saved" view by default - Edit Picks is what puts the buttons back into a clickable state.
  pageMode = computePageMode();
}

function selectDraft(questionId, choice) {
  draftPicks[questionId] = choice;
  renderPicks();
}

function editPicks() {
  pageMode = 'editing';
  renderPicks();
}

async function submitAllPicks() {
  const errEl = document.getElementById('submitError');
  if (errEl) errEl.textContent = '';
  const now = new Date();
  const toSubmit = questions.filter(q => new Date(q.lock_at) > now && draftPicks[q.id] !== undefined && draftPicks[q.id] !== '');
  try {
    for (const q of toSubmit) {
      await api('picks', { method: 'POST', body: JSON.stringify({ question_id: q.id, choice: draftPicks[q.id] }) });
      myPicks[q.id] = draftPicks[q.id];
    }
    pageMode = 'saved';
    renderPicks();
  } catch (e) {
    if (errEl) errEl.textContent = e.message;
  }
}

function renderGuessBody(q, mine, graded, disabled) {
  const withinRange = graded && mine !== undefined && Math.abs(Number(mine) - Number(q.correct_option)) <= 2;
  return `
    <div class="guess-row">
      <input type="number" class="guess-input" id="guess-${q.id}" data-qid="${q.id}" value="${mine !== undefined ? mine : ''}" placeholder="Your guess" ${disabled ? 'disabled' : ''}>
    </div>
    ${graded ? `<div class="guess-result ${mine !== undefined ? (withinRange ? 'correct' : 'incorrect') : ''}">
        Actual: ${q.correct_option}${mine !== undefined ? ` &middot; Your guess: ${mine} (${withinRange ? 'within ±2 — point!' : 'no point'})` : ''}
      </div>` : ''}
  `;
}

function questionCardHTML(q, idx) {
  const now = new Date();
  const locked = new Date(q.lock_at) <= now;
  const graded = q.correct_option !== null;
  const mine = draftPicks[q.id];
  const disabled = !currentManager || locked || pageMode === 'saved';

  let body;
  if (q.type === 'number_guess') {
    body = renderGuessBody(q, mine, graded, disabled);
  } else {
    const optClass = (opt) => {
      let cls = 'option-btn';
      if (mine === opt) cls += ' selected';
      if (graded) cls += (q.correct_option === opt) ? ' correct' : (mine === opt ? ' incorrect' : '');
      return cls;
    };
    const options = q.type === 'pick_manager'
      ? activeManagers().map(m => `<button class="${optClass(m.manager)}" ${disabled ? 'disabled' : ''} data-qid="${q.id}" data-choice="${m.manager}">${m.manager}</button>`).join('')
      : `<button class="${optClass('a')}" ${disabled ? 'disabled' : ''} data-qid="${q.id}" data-choice="a">${q.option_a}</button>
         <button class="${optClass('b')}" ${disabled ? 'disabled' : ''} data-qid="${q.id}" data-choice="b">${q.option_b}</button>`;
    body = `<div class="option-row${q.type === 'pick_manager' ? ' manager-grid' : ''}">${options}</div>`;
  }

  const submittedClass = currentManager && pageMode === 'saved' && !graded ? ' submitted' : '';
  // Status pill: graded (right/wrong for the logged-in manager), locked, or open with its lock time
  let status;
  if (graded && mine !== undefined && mine !== '') {
    const right = q.type === 'number_guess' ? Math.abs(Number(mine) - Number(q.correct_option)) <= 2 : mine === q.correct_option;
    status = `<span class="q-status ${right ? 'right' : 'wrong'}">${right ? '✓ Correct' : '✗ Missed'}</span>`;
  } else if (graded) status = '<span class="q-status locked">Graded</span>';
  else if (locked) status = '<span class="q-status locked">🔒 Locked</span>';
  else status = `<span class="q-status open">Open · locks ${new Date(q.lock_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>`;
  return `
    <div class="question-card${submittedClass}">
      <div class="q-head"><div class="q-num">${(idx ?? 0) + 1}</div><div class="q-main">
        <div class="question-prompt">${q.prompt}</div>
        <div class="question-meta">${status}<span>${weekLabel(q.week)}</span><span>· ${q.points} pt${q.points === 1 ? '' : 's'}</span></div>
      </div></div>
      ${body}
      ${!currentManager ? '<div class="locked-note">Log in above to submit a pick.</div>' : ''}
      ${currentManager && locked && !graded ? '<div class="locked-note">Picks are locked for this question.</div>' : ''}
    </div>
  `;
}

// Renders one panel's worth of question cards into containerId. showActionBar is only true for
// the "This Week" panel - archive panels are always fully locked already (every card in them
// disables itself via questionCardHTML's own locked check), so there's nothing to submit/edit.
function renderQuestionsPanel(containerId, questionsList, showActionBar) {
  const el = document.getElementById(containerId);
  if (!questionsList.length) {
    el.innerHTML = emptyState('No picks here yet', 'Check back once this batch of prop questions is published.');
    return;
  }
  const now = new Date();
  const cardsHtml = questionsList.map(questionCardHTML).join('');

  // The first-time Submit bar stays at the bottom (below the questions you're actively
  // answering), but once picks are saved, the Edit bar moves to the top - a returning manager
  // wants "am I already locked in, and how do I change that" before scrolling back through
  // every card, not after.
  let topBar = '';
  let bottomBar = '';
  if (showActionBar) {
    const anyUnlocked = questionsList.some(q => new Date(q.lock_at) > now);
    if (currentManager && anyUnlocked) {
      if (pageMode === 'saved') {
        topBar = `
          <div class="picks-actionbar saved">
            <span class="picks-confirm">&#10003; Your picks are saved.</span>
            <button class="btn btn-ghost" id="editPicksBtn">Edit Picks</button>
          </div>`;
      } else {
        const unlockedQs = questionsList.filter(q => new Date(q.lock_at) > now);
        const answered = unlockedQs.filter(q => draftPicks[q.id] !== undefined && draftPicks[q.id] !== '').length;
        bottomBar = `
          <div class="picks-actionbar sticky">
            <div class="picks-progress"><span>${answered} of ${unlockedQs.length} answered</span><div class="bar"><span style="width:${unlockedQs.length ? (answered / unlockedQs.length * 100).toFixed(0) : 0}%"></span></div></div>
            <button class="btn" id="submitPicksBtn" ${answered === 0 ? 'disabled' : ''}>Submit Picks</button>
            <span class="login-error" id="submitError"></span>
          </div>`;
      }
    }
  }

  el.innerHTML = topBar + cardsHtml + bottomBar;

  el.querySelectorAll('.option-btn:not(:disabled)').forEach(btn => {
    btn.addEventListener('click', () => selectDraft(Number(btn.dataset.qid), btn.dataset.choice));
  });
  el.querySelectorAll('.guess-input:not(:disabled)').forEach(input => {
    input.addEventListener('input', () => {
      draftPicks[Number(input.dataset.qid)] = input.value;
      const btn = document.getElementById('submitPicksBtn');
      if (btn) btn.disabled = false;
      const progress = el.querySelector('.picks-progress');
      if (progress) {
        const unlockedQs = questionsList.filter(q => new Date(q.lock_at) > new Date());
        const answered = unlockedQs.filter(q => draftPicks[q.id] !== undefined && draftPicks[q.id] !== '').length;
        progress.textContent = `${answered} of ${unlockedQs.length} answered`;
      }
    });
  });
  const submitBtn = document.getElementById('submitPicksBtn');
  if (submitBtn) submitBtn.addEventListener('click', submitAllPicks);
  const editBtn = document.getElementById('editPicksBtn');
  if (editBtn) editBtn.addEventListener('click', editPicks);
}

// Builds the tab row + one panel per tab (This Week, Leaderboard, then one archive tab per week
// that's fully locked) - called once at init, since which weeks exist/are locked doesn't change
// within a session. "This Week" pools every not-yet-locked question regardless of its week bucket
// (in practice there's only ever one open batch at a time, but nothing breaks if two overlap).
//
// Archived (fully-locked) batches render in a visually separate row from This Week/Leaderboard,
// under a small "Past Batches" label, per explicit request - they're historical, not part of the
// live/current pick'em the way the first two tabs are, and mixing them into one row implied they
// were all equally "current." Display order within that row is fixed (Draft, Season I, Season II,
// then Week 1/2/3/... - see weekSortKey), not sorted by actual lock time.
function buildTabs() {
  const now = new Date();
  const weeksPresent = [...new Set(questions.map(q => q.week))];
  archivedWeeks = weeksPresent
    .filter(week => questions.filter(q => q.week === week).every(q => new Date(q.lock_at) <= now))
    .sort((a, b) => weekSortKey(a) - weekSortKey(b));

  const tabButtons = [
    '<button class="tab-btn active" data-tab="this-week">This Week</button>',
    '<button class="tab-btn" data-tab="leaderboard">Leaderboard</button>',
  ];
  document.getElementById('tabRow').innerHTML = tabButtons.join('');

  const archiveSection = document.getElementById('archiveTabSection');
  if (archivedWeeks.length) {
    archiveSection.innerHTML = `
      <div class="tab-row-label">Past Batches</div>
      <div class="tab-row live">
        ${archivedWeeks.map(week => `<button class="tab-btn" data-tab="week-${week}">${weekLabel(week)}</button>`).join('')}
      </div>
    `;
  } else {
    archiveSection.innerHTML = '';
  }

  const panels = [
    '<div class="panel active" id="panel-this-week"><div id="picksContent"></div></div>',
    '<div class="panel" id="panel-leaderboard"><div id="leaderboardContent"></div></div>',
    ...archivedWeeks.map(week => `<div class="panel" id="panel-week-${week}"><div id="archiveContent-${week}"></div></div>`),
  ];
  document.getElementById('panelsContainer').innerHTML = panels.join('');

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
    });
  });
}

function renderPicks() {
  const now = new Date();
  const archivedWeekSet = new Set(archivedWeeks);
  const openQuestions = questions.filter(q => !archivedWeekSet.has(q.week));
  renderQuestionsPanel('picksContent', openQuestions, true);
  archivedWeeks.forEach(week => {
    renderQuestionsPanel(`archiveContent-${week}`, questions.filter(q => q.week === week), false);
  });
}

async function renderLeaderboard() {
  const el = document.getElementById('leaderboardContent');
  const data = await api('leaderboard').catch(() => ({ season: [], this_week: [], latest_week: null }));
  if (!data.season.length) {
    el.innerHTML = emptyState('No graded picks yet', 'The leaderboard fills in once the first week is graded.');
    return;
  }
  const thisWeekMap = Object.fromEntries((data.this_week || []).map(r => [r.manager, r.points]));
  // Competition ranking: tied points share a rank (1, 2, 2, 4)
  const rows = data.season.map(r => ({ ...r, points: Number(r.points) }));
  rows.forEach((r, i) => { r.rank = i && r.points === rows[i - 1].points ? rows[i - 1].rank : i + 1; });
  const max = Math.max(1, ...rows.map(r => r.points));
  const color = m => managerColor(managers, m);
  const wk = m => Number(thisWeekMap[m]) || 0; // API returns SUMs as strings
  const pod = rows.slice(0, 3), order = pod.length === 3 ? [pod[1], pod[0], pod[2]] : pod;
  el.innerHTML = `
    ${data.latest_week ? `<p class="updated-note" style="color:var(--text-muted);font-size:0.78rem;margin-bottom:14px;">Season standings through week ${data.latest_week}</p>` : ''}
    <div class="hx-podium">${order.map(r => `<div class="hx-pod p${Math.min(r.rank, 3)}" style="--accent:${color(r.manager)}"><div class="medal">${['', '🥇 1st', '🥈 2nd', '🥉 3rd'][Math.min(r.rank, 3)]}${rows.filter(x => x.rank === r.rank).length > 1 ? ' (tie)' : ''}</div><div class="val">${r.points} pts</div><div class="who">${managerTag(managers, r.manager)}</div><div class="sub">+${wk(r.manager)} in week ${data.latest_week || '—'}</div></div>`).join('')}</div>
    <div class="hx-card lb-list">${rows.slice(3).map(r => `
      <div class="hx-bar-row" style="--accent:${color(r.manager)}"><span class="rk">${r.rank}</span>
        <div class="hx-bar-main"><div class="hx-bar-label">${managerTag(managers, r.manager)}${wk(r.manager) ? `<span class="hx-pill up">+${wk(r.manager)} this week</span>` : ''}</div>
          <div class="hx-bar-track"><div class="hx-bar-fill" style="width:${(r.points / max * 100).toFixed(1)}%"></div></div></div>
        <span class="hx-bar-val">${r.points}<small>pts</small></span></div>`).join('') || '<p class="hx-muted" style="margin:10px 0">Everyone is on the podium so far.</p>'}</div>
  `;
}

async function init() {
  managers = await getManagers();

  const me = await api('me').catch(() => ({ manager: null }));
  currentManager = me.manager;
  renderLogin();

  questions = await api('questions').catch(() => []);
  await loadPicks();
  buildTabs();
  renderPicks();
  renderLeaderboard();
}

renderNav('pick\'em');
init();
