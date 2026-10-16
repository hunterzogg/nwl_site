// Shared across all pages: nav bar + manager color lookups.

const NWL_HOME = { href: 'index.html', label: 'Home' };
const NWL_LIVE_PAGE = { href: 'pages/season-2026.html', label: '2026 Hub' };
const NWL_MOCK_DRAFT_PAGE = { href: 'pages/mock-draft.html', label: 'Mock Draft' };
const NWL_PICKEM_PAGE = { href: 'pages/pickem.html', label: "Pick'em" };
const NWL_TRADE_TOOLS_PAGE = { href: 'pages/trade-tools.html', label: 'Trade Calculator' };
const NWL_TRADE_FINDER_PAGE = { href: 'pages/trade-finder.html', label: 'Trade Finder' };

// In-season pages (amber, grouped together) vs. league history / archive pages (grouped
// separately) - kept as two distinct arrays so renderNav can label and style each group.
// NWL_MOCK_DRAFT_PAGE is deliberately NOT in this list - the real 2026 draft is over, so the
// mock draft tool is archived (unlinked from nav/homepage) but the page/const itself is left
// intact and fully functional if visited directly, ready to resurface next preseason.
// The 2026 draft analysis moved into League History -> Draft as its "2026 Draft" tab group.
const NWL_IN_SEASON_PAGES = [NWL_LIVE_PAGE, NWL_PICKEM_PAGE, NWL_TRADE_TOOLS_PAGE, NWL_TRADE_FINDER_PAGE];

const NWL_PAGES = [
  { href: 'pages/hall-of-fame.html', label: 'Hall of Fame', desc: 'Records, rivalries and champions' },
  { href: 'pages/managers.html', label: 'Managers', desc: 'Career cards for every manager' },
  { href: 'pages/scorigami.html', label: 'Scorigami', desc: 'Every final score ever posted' },
  { href: 'pages/rankings.html', label: 'Team Rankings', desc: 'Every season, ranked all-time' },
  { href: 'pages/draft.html', label: 'Draft', desc: 'Every pick since 2013, graded' },
  { href: 'pages/transactions.html', label: 'Transactions', desc: 'Waivers, FAAB and trades' },
];

// Header: brand on the left (it links home, so there's no separate Home link); the In Season pages (amber pills) and a "League History"
// dropdown on the right. Under 900px everything collapses into a full-width grouped menu behind
// the hamburger. This is the only place nav markup is generated.
function renderNav(activeHref) {
  const inPages = isInPagesDir();
  const nav = document.createElement('header');
  nav.className = 'topnav';
  const homeHref = inPages ? '../index.html' : 'index.html';
  const resolveHref = (p) => {
    if (p.href === 'index.html') return homeHref;
    const filename = p.href.split('/').pop();
    return inPages ? filename : p.href;
  };
  const isActive = p => activeHref === p.label.toLowerCase();
  const activeHistory = NWL_PAGES.find(isActive);

  const liveLinks = NWL_IN_SEASON_PAGES.map(p => `<a href="${resolveHref(p)}" class="nav-pill nav-live${isActive(p) ? ' active' : ''}"${isActive(p) ? ' aria-current="page"' : ''}>${p === NWL_LIVE_PAGE ? '<span class="nav-live-dot"></span>' : ''}${p.label}</a>`).join('');
  const historyLinks = NWL_PAGES.map(p => `<a href="${resolveHref(p)}" class="nav-dd-item${isActive(p) ? ' active' : ''}"${isActive(p) ? ' aria-current="page"' : ''}><span class="t">${p.label}</span><span class="d">${p.desc}</span></a>`).join('');

  nav.innerHTML = `
    <div class="nav-inner">
      <a href="${homeHref}" class="brand" aria-label="NWL home">
        <img src="${inPages ? '../assets/img/nwl_logo.png' : 'assets/img/nwl_logo.png'}" alt="">
        <span class="brand-text"><b>NWL</b><small>National Wayzata League</small></span>
      </a>
      <button class="nav-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="navMain">
        <span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span>
      </button>
      <nav class="nav-main nav-links" id="navMain" aria-label="Main">
        <span class="nav-group-label">In Season</span>
        <div class="nav-group nav-group-live">${liveLinks}</div>
        <span class="nav-group-label nav-label-history">League History</span>
        <div class="nav-dd">
          <button class="nav-pill nav-dd-btn${activeHistory ? ' active' : ''}" type="button" aria-expanded="false" aria-haspopup="true">
            ${activeHistory ? `History <span class="nav-dd-cur">· ${activeHistory.label}</span>` : 'League History'}<span class="chev" aria-hidden="true">▾</span>
          </button>
          <div class="nav-dd-menu" role="menu">${historyLinks}</div>
        </div>
      </nav>
    </div>`;
  document.body.prepend(nav);

  const toggleBtn = nav.querySelector('.nav-toggle');
  const ddBtn = nav.querySelector('.nav-dd-btn');
  const closeAll = () => {
    nav.classList.remove('nav-open', 'dd-open');
    toggleBtn.setAttribute('aria-expanded', 'false');
    ddBtn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('nav-locked');
  };
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = nav.classList.toggle('nav-open');
    nav.querySelector('.nav-main').style.top = nav.getBoundingClientRect().bottom + 'px'; // drawer starts under the header
    toggleBtn.setAttribute('aria-expanded', String(open));
    toggleBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    document.body.classList.toggle('nav-locked', open);
  });
  ddBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = nav.classList.toggle('dd-open');
    ddBtn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => { if (!nav.contains(e.target)) closeAll(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
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
