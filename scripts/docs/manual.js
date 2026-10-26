(() => {
  const input = document.getElementById('manual-search'), clear = document.getElementById('clear-search'), status = document.getElementById('search-status');
  const sections = [...document.querySelectorAll('[data-document]')];
  const searchable = sections.map(section => ({ section, text: section.textContent.toLocaleLowerCase() }));
  const nav = [...document.querySelectorAll('[data-nav]')];
  function search() {
    const words = input.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    let count = 0;
    for (const { section, text } of searchable) {
      section.hidden = !words.every(word => text.includes(word));
      if (!section.hidden) count++;
      const link = nav.find(link => link.dataset.nav === section.id); if (link) link.hidden = section.hidden;
    }
    document.getElementById('cover').hidden = Boolean(words.length);
    document.getElementById('empty-results').hidden = count !== 0;
    clear.hidden = !input.value;
    status.textContent = words.length ? `找到 ${count} 个匹配章节` : `${sections.length} 章 · 支持离线搜索`;
    for (const group of document.querySelectorAll('.nav-group')) group.hidden = ![...group.querySelectorAll('a')].some(link => !link.hidden);
  }
  input.addEventListener('input', search);
  clear.addEventListener('click', () => { input.value = ''; search(); input.focus(); });
  const menu = document.getElementById('menu-toggle');
  function closeMenu() { document.body.classList.remove('menu-open'); menu.setAttribute('aria-expanded', 'false'); }
  menu.addEventListener('click', () => { const open = document.body.classList.toggle('menu-open'); menu.setAttribute('aria-expanded', String(open)); });
  document.addEventListener('click', event => { if (document.body.classList.contains('menu-open') && !event.target.closest('.sidebar, #menu-toggle')) closeMenu(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
  function navigate() {
    const id = decodeURIComponent(location.hash.slice(1)), target = document.getElementById(id);
    if (!target) return;
    if (input.value) { input.value = ''; search(); }
    const section = target.closest('[data-document]');
    for (const link of nav) { if (section?.id === link.dataset.nav) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current'); }
    closeMenu(); requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  }
  window.addEventListener('hashchange', navigate);
  if (location.hash) navigate();
  document.getElementById('print-manual').addEventListener('click', () => window.print());
  document.addEventListener('click', async event => {
    const button = event.target.closest('.copy-code'); if (!button) return;
    const text = button.closest('.code-block').querySelector('code').textContent;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {
      const previous = document.activeElement, area = document.createElement('textarea'); area.value = text;
      area.style.cssText = 'position:fixed;left:-10000px;top:0'; document.body.append(area); area.select();
      try { ok = document.execCommand('copy'); } finally { area.remove(); previous?.focus(); }
    }
    const toast = document.getElementById('copy-status'); toast.textContent = ok ? '代码已复制' : '请选中代码并复制'; toast.hidden = false;
    clearTimeout(window.manualToastTimer); window.manualToastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
  });
})();
