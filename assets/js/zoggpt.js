// ZogGPT: floating chat widget that asks /api/zoggpt league-history questions.
(function () {
  if (/github\.io$/.test(location.hostname)) return; // the API only exists on the Vercel deploy
  const history = [];
  let busy = false;

  const root = document.createElement('div');
  root.className = 'zg';
  root.innerHTML = `
    <button class="zg-fab" type="button" aria-label="Open ZogGPT">ZogGPT</button>
    <section class="zg-panel" hidden aria-label="ZogGPT chat">
      <header class="zg-head"><strong>ZogGPT</strong><span>Ask about NWL history</span><button type="button" class="zg-close" aria-label="Close">&times;</button></header>
      <div class="zg-log" role="log" aria-live="polite"></div>
      <div class="zg-chips"></div>
      <form class="zg-form"><input class="zg-input" type="text" maxlength="500" placeholder="Who has the most titles?" autocomplete="off"><button type="submit">Send</button></form>
    </section>`;
  document.body.appendChild(root);

  const panel = root.querySelector('.zg-panel'), log = root.querySelector('.zg-log'), input = root.querySelector('.zg-input');
  const chips = root.querySelector('.zg-chips');
  ['Highest score ever?', 'Most wins all-time?', 'Closest games ever?'].forEach((q) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = q;
    b.onclick = () => send(q); chips.appendChild(b);
  });

  const add = (cls, text) => { const d = document.createElement('div'); d.className = 'zg-msg ' + cls; d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; };
  add('bot', 'Hey, I’m ZogGPT. Ask me anything about NWL history, like records, matchups, drafts or trades.');

  async function send(q) {
    q = (q || '').trim();
    if (!q || busy) return;
    busy = true; chips.hidden = true; input.value = '';
    add('me', q); history.push({ role: 'user', content: q });
    const wait = add('bot zg-wait', 'Looking that up…');
    try {
      const r = await fetch('/api/zoggpt', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ messages: history }) });
      const j = await r.json().catch(() => ({}));
      wait.remove();
      if (!r.ok) { add('bot err', j.error || 'Something went wrong.'); history.pop(); }
      else { add('bot', j.answer); history.push({ role: 'assistant', content: j.answer }); }
    } catch (e) { wait.remove(); add('bot err', 'Couldn’t reach ZogGPT.'); history.pop(); }
    busy = false; input.focus();
  }

  root.querySelector('.zg-form').addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
  const toggle = (open) => { panel.hidden = !open; root.querySelector('.zg-fab').hidden = open; if (open) input.focus(); };
  root.querySelector('.zg-fab').onclick = () => toggle(true);
  root.querySelector('.zg-close').onclick = () => toggle(false);
})();
