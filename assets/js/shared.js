// Shared across all pages: nav bar + manager color lookups.

const NWL_HOME = { href: 'index.html', label: 'Home' };
const NWL_LIVE_PAGE = { href: 'pages/season-2026.html', label: '2026 Season' };
const NWL_MOCK_DRAFT_PAGE = { href: 'pages/mock-draft.html', label: 'Mock Draft' };

const NWL_FEEDBACK_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdlRcbl_1SBWOAbBbGUIxTdhPbcd68vc0Dz3ZQoTouUNaoCNQ/viewform';

const NWL_PAGES = [
  { href: 'pages/hall-of-fame.html', label: 'Hall of Fame' },
  { href: 'pages/managers.html', label: 'Managers' },
  { href: 'pages/scorigami.html', label: 'Scorigami' },
  { href: 'pages/rankings.html', label: 'Team Rankings' },
  { href: 'pages/draft.html', label: 'Draft' },
  { href: 'pages/transactions.html', label: 'Transactions' },
];

function renderNav(activeHref) {
  const inPages = isInPagesDir();
  const nav = document.createElement('div');
  nav.className = 'topnav';
  const homeHref = inPages ? '../index.html' : 'index.html';

  const resolveHref = (p) => {
    if (p.href === 'index.html') return homeHref;
    const filename = p.href.split('/').pop();
    return inPages ? filename : p.href;
  };

  const homeActive = activeHref === NWL_HOME.label.toLowerCase();
  const homeLink = `<a href="${homeHref}" class="${homeActive ? 'active' : ''}">${NWL_HOME.label}</a>`;

  const liveActive = activeHref === NWL_LIVE_PAGE.label.toLowerCase();
  const liveLink = `<a href="${resolveHref(NWL_LIVE_PAGE)}" class="nav-live ${liveActive ? 'active' : ''}"><span class="nav-live-dot"></span>${NWL_LIVE_PAGE.label}</a>`;

  const mockDraftActive = activeHref === NWL_MOCK_DRAFT_PAGE.label.toLowerCase();
  const mockDraftLink = `<a href="${resolveHref(NWL_MOCK_DRAFT_PAGE)}" class="${mockDraftActive ? 'active' : ''}">${NWL_MOCK_DRAFT_PAGE.label}</a>`;

  nav.innerHTML = `
    <div class="nav-top-row">
      <a href="${homeHref}" class="brand">
        <img src="${inPages ? '../assets/img/nwl_logo.png' : 'assets/img/nwl_logo.png'}" alt="NWL" style="height:24px;"> NWL
      </a>
      <button class="nav-toggle" type="button" aria-label="Toggle navigation" aria-expanded="false">
        <span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span>
      </button>
    </div>
    <div class="nav-links">
      ${homeLink}
      <span class="nav-divider"></span>
      ${liveLink}
      ${mockDraftLink}
      <span class="nav-divider"></span>
      ${NWL_PAGES.map(p => {
        const isActive = activeHref === p.label.toLowerCase();
        return `<a href="${resolveHref(p)}" class="${isActive ? 'active' : ''}">${p.label}</a>`;
      }).join('')}
      <span class="nav-divider"></span>
      <a href="${NWL_FEEDBACK_URL}" target="_blank" rel="noopener" class="nav-feedback">Feedback</a>
    </div>
  `;
  document.body.prepend(nav);

  // Mobile-only hamburger toggle - on desktop the toggle button is hidden via CSS and
  // .nav-links is always visible, so this listener is harmless dead weight there.
  const toggleBtn = nav.querySelector('.nav-toggle');
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = nav.classList.toggle('nav-open');
    toggleBtn.setAttribute('aria-expanded', String(isOpen));
  });
  document.addEventListener('click', (e) => {
    if (nav.classList.contains('nav-open') && !nav.contains(e.target)) {
      nav.classList.remove('nav-open');
      toggleBtn.setAttribute('aria-expanded', 'false');
    }
  });
}

function isInPagesDir() {
  return window.location.pathname.includes('/pages/');
}

let _managerCache = null;
async function getManagers() {
  if (_managerCache) return _managerCache;
  const base = isInPagesDir() ? '../data/managers.json' : 'data/managers.json';
  const res = await fetch(base);
  _managerCache = await res.json();
  return _managerCache;
}

function managerColor(managers, name) {
  const m = managers.find(x => x.manager === name);
  return m ? m.color : '#7C8798';
}

function managerTag(managers, name) {
  const color = managerColor(managers, name);
  return `<span class="manager-tag"><span class="manager-dot" style="background:${color}"></span>${name}</span>`;
}

async function loadData(name) {
  const base = isInPagesDir() ? '../data/' : 'data/';
  const res = await fetch(base + name + '.json');
  return res.json();
}

// Like loadData, but returns fallback instead of throwing if the file doesn't exist yet -
// used for in-season data (season_2026/*) that isn't generated until the fetch script runs.
async function loadDataSafe(path, fallback) {
  const base = isInPagesDir() ? '../data/' : 'data/';
  try {
    const res = await fetch(base + path + '.json');
    if (!res.ok) return fallback;
    return await res.json();
  } catch (e) {
    return fallback;
  }
}

function posTag(position) {
  if (!position) return '';
  const normalized = position.toUpperCase().replace(/[^A-Z]/g, ''); // D/ST -> DST
  return `<span class="pos-tag pos-${normalized}">${position}</span>`;
}
