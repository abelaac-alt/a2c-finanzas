(() => {
  const GROUP_ICON = '👥';

  function clickGroups() {
    const existing = document.querySelector('[data-v47-groups],[data-v49-groups]');
    if (existing && existing !== event?.currentTarget) {
      existing.click();
      return;
    }

    const page = document.querySelector('.hub-page');
    if (!page) return;

    page.querySelectorAll('.section-tabs button').forEach(button => button.classList.remove('active'));
    document.querySelector('[data-v49-groups]')?.classList.add('active');

    const old = page.querySelector('.v47-groups-page,.v49-groups-page');
    if (old) old.remove();

    const section = document.createElement('section');
    section.className = 'v47-groups-page v49-groups-page';
    section.innerHTML = `
      <div class="section-head">
        <div>
          <h2>Grupos</h2>
          <p class="muted">Viajes, vacaciones y gastos compartidos con amigos.</p>
        </div>
        <button class="btn primary" type="button" data-v49-new-group>Nuevo grupo</button>
      </div>
      <div class="empty">Cargando grupos…</div>
    `;
    [...page.children]
      .filter(node => !node.classList.contains('dashboard-head') && !node.classList.contains('section-tabs') && node !== section)
      .forEach(node => node.remove());
    page.appendChild(section);

    const originalGroups = document.querySelector('[data-v47-groups]');
    if (originalGroups && originalGroups !== document.querySelector('[data-v49-groups]')) {
      originalGroups.click();
    }
  }

  function ensureGroupsTab() {
    const tabs = document.querySelector('.hub-page .section-tabs');
    if (!tabs) return;

    tabs.classList.add('v47-tools-tabs');

    let button = tabs.querySelector('[data-v47-groups],[data-v49-groups]');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.dataset.v49Groups = '1';
      button.className = 'v47-tool-tab';
      button.textContent = 'Grupos';
      tabs.appendChild(button);
    }

    button.dataset.v47Icon = GROUP_ICON;
    button.dataset.v47Label = 'Grupos';
    button.setAttribute('aria-label', 'Grupos');
    button.title = 'Grupos';

    if (!button.dataset.v491Bound) {
      button.dataset.v491Bound = '1';
      button.addEventListener('click', clickGroups);
    }
  }

  const observer = new MutationObserver(ensureGroupsTab);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('click', event => {
    if (event.target.closest('[data-tab="tools"]')) {
      setTimeout(ensureGroupsTab, 30);
      setTimeout(ensureGroupsTab, 180);
    }
  });

  ensureGroupsTab();
})();
