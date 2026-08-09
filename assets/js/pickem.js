let managers = [];
let currentManager = null; // logged-in manager name, or null
let questions = [];
let myPicks = {};    // question_id -> choice, last saved to the server
let draftPicks = {};  // question_id -> choice, local working copy (may include unsaved edits)
let pageMode = 'editing'; // 'editing' (buttons live, Submit shown) | 'saved' (read-only, Edit shown)
let archivedWeeks = []; // week numbers whose questions are all locked, oldest-first - built once in buildTabs()

// Every batch of questions gets a `week` bucket - 0 is Draft Day, -1 is the season-long
// "Preseason" props (locks after the draft but before Week 1), 1+ are real weekly props. Numeric
// week order doesn't match chronological order (-1 sorts before 0), so label/sort are separate
// helpers rather than using the raw number directly.
function weekLabel(week) {
  if (week === 0) return 'Draft';
  if (week === -1) return 'Preseason';
  return `Week ${week}`;
}
function weekSortKey(week) {
  if (week === 0) return -2;
  if (week === -1) return -1;
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

async function loadPicks() {
  myPicks = {};
  if (!currentManager) { draftPicks = {}; pageMode = 'editing'; return; }
  const rows = await api('picks').catch(() => []);
  rows.forEach(r => { myPicks[r.question_id] = r.choice; });
  draftPicks = { ...myPicks };
  // Managers who already have saved picks land in a read-only "saved" view by default -
  // Edit Picks is what puts the buttons back into a clickable state.
  pageMode = Object.keys(myPicks).length ? 'saved' : 'editing';
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

function questionCardHTML(q) {
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
  return `
    <div class="question-card${submittedClass}">
      <div class="question-prompt">${q.prompt}</div>
      <div class="question-meta">${weekLabel(q.week)} &middot; ${q.points} pt${q.points === 1 ? '' : 's'} &middot; ${locked ? 'Locked' : 'Locks ' + new Date(q.lock_at).toLocaleString()}</div>
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
          <div class="picks-actionbar">
            <span class="picks-progress">${answered} of ${unlockedQs.length} answered</span>
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
function buildTabs() {
  const now = new Date();
  const weeksPresent = [...new Set(questions.map(q => q.week))];
  archivedWeeks = weeksPresent
    .filter(week => questions.filter(q => q.week === week).every(q => new Date(q.lock_at) <= now))
    .sort((a, b) => weekSortKey(a) - weekSortKey(b));

  const tabButtons = [
    '<button class="tab-btn active" data-tab="this-week">This Week</button>',
    '<button class="tab-btn" data-tab="leaderboard">Leaderboard</button>',
    ...archivedWeeks.map(week => `<button class="tab-btn" data-tab="week-${week}">${weekLabel(week)}</button>`),
  ];
  document.getElementById('tabRow').innerHTML = tabButtons.join('');

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
  el.innerHTML = `
    ${data.latest_week ? `<p class="updated-note" style="color:var(--text-muted);font-size:0.78rem;margin-bottom:16px;">Through week ${data.latest_week}</p>` : ''}
    <div class="table-wide" style="overflow-x:auto;">
    <table>
      <thead><tr><th>Rank</th><th>Manager</th><th class="num">Season Points</th><th class="num">This Week</th></tr></thead>
      <tbody>
        ${data.season.map((r, i) => `
          <tr>
            <td class="rank-num">${i + 1}</td>
            <td>${managerTag(managers, r.manager)}</td>
            <td class="num mono">${r.points}</td>
            <td class="num mono">${thisWeekMap[r.manager] || 0}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    </div>
    <div class="table-cards">
      ${data.season.map((r, i) => `
        <div class="table-card">
          <div class="table-card-top">
            <span class="rank-num">${i + 1}</span>
            <span class="grow">${managerTag(managers, r.manager)}</span>
            <span class="mono">${r.points} pts</span>
          </div>
          <div class="table-card-sub">This week: ${thisWeekMap[r.manager] || 0} pts</div>
        </div>
      `).join('')}
    </div>
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
