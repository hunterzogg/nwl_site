let managers = [];
let currentManager = null; // logged-in manager name, or null
let questions = [];
let myPicks = {}; // question_id -> 'a'|'b'

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
  if (!currentManager) return;
  const rows = await api('picks').catch(() => []);
  rows.forEach(r => { myPicks[r.question_id] = r.choice; });
}

async function submitPick(questionId, choice) {
  await api('picks', { method: 'POST', body: JSON.stringify({ question_id: questionId, choice }) });
  myPicks[questionId] = choice;
  renderPicks();
}

function renderGuessBody(q, mine, graded, disabled) {
  const withinRange = graded && mine !== undefined && Math.abs(Number(mine) - Number(q.correct_option)) <= 2;
  return `
    <div class="guess-row">
      <input type="number" class="guess-input" id="guess-${q.id}" value="${mine !== undefined ? mine : ''}" placeholder="Your guess" ${disabled ? 'disabled' : ''}>
      ${!disabled ? `<button class="btn" data-guess-submit="${q.id}">Submit Guess</button>` : ''}
    </div>
    ${graded ? `<div class="guess-result ${mine !== undefined ? (withinRange ? 'correct' : 'incorrect') : ''}">
        Actual: ${q.correct_option}${mine !== undefined ? ` &middot; Your guess: ${mine} (${withinRange ? 'within ±2 — point!' : 'no point'})` : ''}
      </div>` : ''}
  `;
}

function renderPicks() {
  const el = document.getElementById('picksContent');
  if (!questions.length) {
    el.innerHTML = emptyState('No picks open yet', 'Check back once this week\'s prop questions are published.');
    return;
  }
  el.innerHTML = questions.map(q => {
    const locked = new Date(q.lock_at) <= new Date();
    const graded = q.correct_option !== null;
    const mine = myPicks[q.id];
    const disabled = !currentManager || locked;

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

    return `
      <div class="question-card">
        <div class="question-prompt">${q.prompt}</div>
        <div class="question-meta">Week ${q.week} &middot; ${q.points} pt${q.points === 1 ? '' : 's'} &middot; ${locked ? 'Locked' : 'Locks ' + new Date(q.lock_at).toLocaleString()}</div>
        ${body}
        ${!currentManager ? '<div class="locked-note">Log in above to submit a pick.</div>' : ''}
        ${currentManager && locked && !graded ? '<div class="locked-note">Picks are locked for this question.</div>' : ''}
      </div>
    `;
  }).join('');

  el.querySelectorAll('.option-btn:not(:disabled)').forEach(btn => {
    btn.addEventListener('click', () => submitPick(Number(btn.dataset.qid), btn.dataset.choice));
  });
  el.querySelectorAll('[data-guess-submit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const qid = Number(btn.dataset.guessSubmit);
      const input = document.getElementById(`guess-${qid}`);
      if (input.value === '') return;
      submitPick(qid, input.value);
    });
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
  renderPicks();
  renderLeaderboard();

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
    });
  });
}

renderNav('pick\'em');
init();
