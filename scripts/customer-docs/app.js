(() => {
  const nav = document.getElementById('navigation');
  const menu = document.getElementById('menu-toggle');
  const toast = document.getElementById('toast');
  const dialog = document.getElementById('figure-dialog');
  const diagram = document.getElementById('figure-image');
  let toastTimer;
  const notify = (text) => { clearTimeout(toastTimer); toast.textContent = text; toast.classList.add('visible'); toastTimer = setTimeout(() => toast.classList.remove('visible'), 2500); };
  document.getElementById('print').addEventListener('click', () => window.print());
  menu.addEventListener('click', () => { const open = nav.classList.toggle('open'); menu.setAttribute('aria-expanded', String(open)); });
  document.querySelectorAll('.nav-link').forEach((link) => link.addEventListener('click', () => { nav.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); }));
  document.addEventListener('click', (event) => { if (!nav.contains(event.target) && !menu.contains(event.target)) { nav.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); } });
  const links = [...document.querySelectorAll('.nav-link')];
  const chapters = [...document.querySelectorAll('.document')];
  const selectChapter = () => {
    let current = '';
    for (const chapter of chapters) { if (chapter.getBoundingClientRect().top <= 160) current = chapter.id; else break; }
    links.forEach((link) => { const active = link.hash === '#' + current; link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current'); });
  };
  let ticking = false;
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { selectChapter(); ticking = false; }); } }, { passive: true });
  selectChapter();
  document.querySelectorAll('.copy-code').forEach((button) => button.addEventListener('click', async () => {
    const text = button.closest('.code-block').querySelector('code').textContent;
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const field = document.createElement('textarea'); field.value = text; field.setAttribute('readonly', ''); field.style.position = 'fixed'; field.style.left = '-9999px'; document.body.append(field); field.select(); const copied = document.execCommand('copy'); field.remove(); button.focus(); if (!copied) throw new Error('copy unavailable');
      }
      button.textContent = '已复制'; notify('代码已复制'); setTimeout(() => { button.textContent = '复制'; }, 1800);
    } catch { notify('浏览器未允许复制，请选中代码后手动复制'); }
  }));
  document.querySelectorAll('.figure-open').forEach((button) => button.addEventListener('click', () => {
    const image = button.querySelector('img'); diagram.src = image.src; diagram.alt = image.alt;
    document.getElementById('figure-caption').textContent = image.alt;
    const download = document.getElementById('figure-download'); download.href = image.src; download.download = image.alt.includes('系统') ? 'system-architecture.svg' : 'component-modules.svg';
    dialog.showModal();
  }));
  document.getElementById('figure-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
})();
