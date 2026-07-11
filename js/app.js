import { configured, sb } from './core/supabase.js';
import { state } from './core/store.js';
import { app, fatal, modal, closeModal, cents, today, toast, esc, money, setBusy } from './core/ui.js';
import { renderLogin, loadIdentity, signOut, isAdmin } from './core/auth.js';
import { loadAll } from './core/data.js';
import { renderHome } from './pages/home.js';
import { renderPiggies } from './pages/piggies.js';
import { renderFolders } from './pages/folders.js';
import { renderGoals } from './pages/goals.js';
import { renderActivity, rows, filterTransactions } from './pages/activity.js';
import { openAdmin } from './pages/admin.js';
import { openNotifications } from './pages/notifications.js';

const pages = {
  home: renderHome,
  piggies: renderPiggies,
  folders: renderFolders,
  goals: renderGoals,
  activity: renderActivity
};

window.addEventListener('error', event => console.error(event.error || event.message));
window.addEventListener('unhandledrejection', event => fatal(event.reason));

if (!configured) {
  fatal(new Error('Configura SUPABASE_URL y SUPABASE_ANON_KEY en config.js'));
} else {
  boot().catch(fatal);
}

async function boot() {
  const authenticated = await loadIdentity();

  if (authenticated) {
    await enter();
  } else {
    renderLogin();
  }

  sb.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    state.user = session?.user || null;

    if (state.user) {
      await loadIdentity();
      await enter();
    } else {
      renderLogin();
    }
  });
}

async function enter() {
  await loadAll();
  renderShell();
}

async function refresh(render = true) {
  await loadAll();
  if (render) renderShell();
}

function renderShell() {
  const unread = state.notifications.filter(n => !n.read_at).length;
  const adminButton = isAdmin() ? '<button class="icon-btn" id="admin-btn" title="Administración">⚙</button>' : '';

  app.innerHTML = `<div class="app-shell">
    <header class="topbar">
      <div class="top-brand">
        <div class="brand-mark">A2C</div>
        <div>
          <strong>A2C Finanzas</strong>
          <small class="muted">${esc(state.profile?.display_name || state.profile?.email)}</small>
        </div>
      </div>
      <div class="top-actions">
        <button class="icon-btn notification-button" id="notifications-btn" title="Notificaciones">
          🔔${unread ? `<i>${unread}</i>` : ''}
        </button>
        ${adminButton}
        <button class="icon-btn" id="logout-btn">Salir</button>
      </div>
    </header>

    <main class="view" id="view">${pages[state.tab]()}</main>

    <div class="floating-quick">
      <button data-quick-kind="income" class="floating-income">＋</button>
      <button data-quick-kind="expense" class="floating-expense">−</button>
    </div>

    <nav class="bottom-nav">
      ${nav('home', 'Inicio')}
      ${nav('piggies', 'Huchas')}
      ${nav('folders', 'Carpetas')}
      ${nav('goals', 'Objetivos')}
      ${nav('activity', 'Actividad')}
    </nav>
  </div>`;

  bind();
}

function nav(tab, label) {
  return `<button class="nav-btn ${state.tab === tab ? 'active' : ''}" data-tab="${tab}">${label}</button>`;
}

function bind() {
  document.querySelectorAll('[data-tab]').forEach(button => {
    button.addEventListener('click', () => {
      state.tab = button.dataset.tab;
      renderShell();
    });
  });

  document.querySelector('#logout-btn')?.addEventListener('click', signOut);
  document.querySelector('#admin-btn')?.addEventListener('click', openAdmin);
  document.querySelector('#notifications-btn')?.addEventListener('click', () => openNotifications(refresh));

  document.querySelectorAll('[data-quick-kind]').forEach(button => {
    button.addEventListener('click', () => openMovement({ kind: button.dataset.quickKind }));
  });

  document.querySelectorAll('[data-new-movement]').forEach(button => {
    button.addEventListener('click', () => openMovement());
  });

  document.querySelector('[data-new-piggy]')?.addEventListener('click', openPiggy);
  document.querySelector('[data-new-folder]')?.addEventListener('click', openFolder);
  document.querySelector('[data-new-goal]')?.addEventListener('click', openGoal);

  document.querySelectorAll('[data-edit-ledger]').forEach(button => {
    button.addEventListener('click', () => {
      const tx = state.ledger.find(item => item.id === button.dataset.editLedger);
      if (tx) openMovement(tx);
    });
  });

  document.querySelectorAll('[data-piggy-menu]').forEach(button => {
    button.addEventListener('click', () => openPiggyMenu(button.dataset.piggyMenu));
  });

  document.querySelectorAll('[data-goal-menu]').forEach(button => {
    button.addEventListener('click', () => openGoalMenu(button.dataset.goalMenu));
  });

  document.querySelectorAll('[data-folder-view]').forEach(button => {
    button.addEventListener('click', () => {
      state.activityFilter.folderId = button.dataset.folderView;
      state.tab = 'activity';
      renderShell();
    });
  });

  const filterForm = document.querySelector('#activity-filter');
  if (filterForm) {
    filterForm.addEventListener('input', () => {
      const fd = new FormData(filterForm);
      state.activityFilter.query = String(fd.get('query') || '');
      state.activityFilter.from = String(fd.get('from') || '');
      state.activityFilter.to = String(fd.get('to') || '');
      state.activityFilter.kind = String(fd.get('kind') || '');
      document.querySelector('#activity-list').innerHTML = rows(filterTransactions());
      bind();
    });
  }

  document.querySelector('#clear-folder-filter')?.addEventListener('click', () => {
    state.activityFilter.folderId = '';
    renderShell();
  });
}

function folderOptions(selectedId = '') {
  return `<option value="">Sin carpeta</option>${state.folders.map(folder =>
    `<option value="${folder.id}" ${folder.id === selectedId ? 'selected' : ''}>${esc(folder.name)}</option>`
  ).join('')}`;
}

function piggyOptions(selectedId = '') {
  return `<option value="">Cuenta principal</option>${state.piggies.map(piggy =>
    `<option value="${piggy.id}" ${piggy.id === selectedId ? 'selected' : ''}>Hucha: ${esc(piggy.name)}</option>`
  ).join('')}`;
}

function openMovement(prefill = {}) {
  const editing = Boolean(prefill.id);
  const currentSource = prefill.piggy_id || '';

  modal(`<form id="movement-form">
    <div class="modal-head">
      <div><h2>${editing ? 'Editar' : 'Nuevo'} movimiento</h2><p class="muted">Todos tus movimientos se pueden editar y borrar.</p></div>
      <button type="button" class="close-btn" data-close>×</button>
    </div>

    <div class="field">
      <label>Tipo</label>
      <select name="kind">
        <option value="expense" ${prefill.kind === 'expense' ? 'selected' : ''}>Gasto</option>
        <option value="income" ${prefill.kind === 'income' ? 'selected' : ''}>Ingreso</option>
        <option value="investment" ${prefill.kind === 'investment' ? 'selected' : ''}>Inversión</option>
      </select>
    </div>

    <div class="field">
      <label>Origen / destino</label>
      <select name="piggy_id" ${editing ? 'disabled' : ''}>${piggyOptions(currentSource)}</select>
      ${editing ? '<small class="muted">El origen no se cambia al editar.</small>' : ''}
    </div>

    <div class="field"><label>Importe (€)</label><input name="amount" inputmode="decimal" required value="${prefill.amount_cents ? Number(prefill.amount_cents) / 100 : ''}"></div>
    <div class="field"><label>Concepto</label><input name="concept" maxlength="160" required value="${esc(prefill.concept || '')}"></div>
    <div class="field"><label>Fecha</label><input name="date" type="date" required value="${prefill.occurred_on || today()}"></div>
    <div class="field"><label>Carpeta</label><select name="folder_id">${folderOptions(prefill.folder_id)}</select></div>

    <div class="field" id="receipt-field">
      <label>Foto del gasto</label>
      <input name="receipt" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif">
      ${prefill.receipt_path ? '<small class="positive">Ya hay una foto guardada.</small>' : ''}
    </div>

    <label class="checkbox-row" id="split-toggle-row">
      <input name="split_enabled" type="checkbox">
      Dividir el gasto entre varias personas
    </label>

    <div id="split-area" class="hidden"></div>

    <div class="actions">
      ${editing ? '<button type="button" class="btn danger" id="delete-movement">Borrar</button>' : ''}
      <button type="button" class="btn" data-close>Cancelar</button>
      <button class="btn primary">Guardar</button>
    </div>
  </form>`, true);

  const form = document.querySelector('#movement-form');
  const kindSelect = form.querySelector('[name="kind"]');
  const receiptField = document.querySelector('#receipt-field');
  const splitToggle = form.querySelector('[name="split_enabled"]');
  const splitRow = document.querySelector('#split-toggle-row');
  const splitArea = document.querySelector('#split-area');

  const updateExpenseFields = () => {
    const isExpense = kindSelect.value === 'expense';
    receiptField.classList.toggle('hidden', !isExpense);
    splitRow.classList.toggle('hidden', !isExpense || editing);
    if (!isExpense) {
      splitToggle.checked = false;
      splitArea.classList.add('hidden');
    }
  };

  kindSelect.addEventListener('change', updateExpenseFields);
  updateExpenseFields();

  splitToggle.addEventListener('change', () => {
    splitArea.classList.toggle('hidden', !splitToggle.checked);
    if (splitToggle.checked) renderSplitBuilder(splitArea);
  });

  form.addEventListener('submit', event => saveMovement(event, prefill));

  document.querySelector('#delete-movement')?.addEventListener('click', async () => {
    if (!confirm('¿Seguro que quieres borrar este movimiento?')) return;
    const { error } = await sb.rpc('delete_transaction_secure', {
      p_transaction_id: prefill.id,
      p_source: prefill.piggy_id ? 'piggy' : 'ledger'
    });
    if (error) return toast(error.message, true);
    closeModal();
    await refresh();
    toast('Movimiento eliminado');
  });
}

function availablePeople() {
  const map = new Map();
  for (const piggy of state.piggies) {
    for (const member of piggy.piggy_members || []) {
      if (member.user_id !== state.user.id && member.profile) {
        map.set(member.user_id, member.profile);
      }
    }
  }
  return [...map.values()];
}

function renderSplitBuilder(container) {
  const people = availablePeople();

  container.innerHTML = `<div class="split-builder">
    <div class="field">
      <label>Modo de reparto</label>
      <select id="split-mode">
        <option value="equal">Partes iguales</option>
        <option value="custom">Importes diferentes</option>
      </select>
    </div>
    <div class="field">
      <label>Número total de personas</label>
      <input id="split-count" type="number" min="2" max="50" value="2">
      <small class="muted">Incluye a la persona que pagó.</small>
    </div>
    <div class="field">
      <label>Usuarios relacionados</label>
      <div class="people-list">
        ${people.map(profile => `<label class="checkbox-row">
          <input type="checkbox" name="split_user" value="${profile.id}">
          ${esc(profile.display_name || profile.email)}
          <input class="custom-share hidden" data-share-for="${profile.id}" placeholder="€" inputmode="decimal">
        </label>`).join('') || '<small class="muted">No hay miembros de huchas conjuntas disponibles.</small>'}
      </div>
    </div>
  </div>`;

  const mode = document.querySelector('#split-mode');
  mode.addEventListener('change', () => {
    document.querySelectorAll('.custom-share').forEach(input => {
      input.classList.toggle('hidden', mode.value !== 'custom');
    });
  });
}

async function uploadReceipt(file, transactionId) {
  if (!file || file.size === 0) return null;
  if (file.size > 10 * 1024 * 1024) throw new Error('La foto supera el límite de 10 MB.');

  const extension = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${state.user.id}/${transactionId}/${crypto.randomUUID()}.${extension}`;

  const { error } = await sb.storage.from('receipts').upload(path, file, {
    contentType: file.type || 'image/jpeg',
    upsert: false
  });

  if (error) throw error;
  return path;
}

async function saveMovement(event, prefill) {
  event.preventDefault();
  const button = event.submitter;
  const fd = new FormData(event.currentTarget);
  const amount = cents(fd.get('amount'));

  if (amount <= 0) return toast('El importe no es válido.', true);

  const payload = {
    kind: fd.get('kind'),
    amount_cents: amount,
    concept: String(fd.get('concept') || '').trim(),
    occurred_on: fd.get('date'),
    folder_id: fd.get('folder_id') || null
  };

  setBusy(button, true);

  try {
    let transactionId = prefill.id;
    let source = prefill.piggy_id ? 'piggy' : 'ledger';
    const piggyId = prefill.id ? prefill.piggy_id : (fd.get('piggy_id') || null);

    if (prefill.id) {
      const { error } = await sb.rpc('update_transaction_secure', {
        p_transaction_id: prefill.id,
        p_source: source,
        p_kind: payload.kind,
        p_amount_cents: payload.amount_cents,
        p_concept: payload.concept,
        p_occurred_on: payload.occurred_on,
        p_folder_id: payload.folder_id
      });
      if (error) throw error;
    } else if (piggyId) {
      const { data, error } = await sb.from('piggy_transactions')
        .insert({ ...payload, piggy_id: piggyId, user_id: state.user.id, creator_id: state.user.id })
        .select('id')
        .single();
      if (error) throw error;
      transactionId = data.id;
      source = 'piggy';
    } else {
      const { data, error } = await sb.from('ledger_transactions')
        .insert({ ...payload, owner_id: state.user.id, creator_id: state.user.id })
        .select('id')
        .single();
      if (error) throw error;
      transactionId = data.id;
      source = 'ledger';
    }

    const file = fd.get('receipt');
    if (payload.kind === 'expense' && file instanceof File && file.size) {
      const receiptPath = await uploadReceipt(file, transactionId);
      const table = source === 'piggy' ? 'piggy_transactions' : 'ledger_transactions';
      const { error } = await sb.from(table).update({ receipt_path: receiptPath }).eq('id', transactionId);
      if (error) throw error;
    }

    if (!prefill.id && payload.kind === 'expense' && fd.get('split_enabled') === 'on') {
      const mode = document.querySelector('#split-mode')?.value || 'equal';
      const count = Number(document.querySelector('#split-count')?.value || 2);
      const checked = [...document.querySelectorAll('[name="split_user"]:checked')];

      const members = checked.map(input => ({
        user_id: input.value,
        amount_cents: mode === 'custom'
          ? cents(document.querySelector(`[data-share-for="${input.value}"]`)?.value)
          : null
      }));

      const { error } = await sb.rpc('create_expense_split', {
        p_source: source,
        p_transaction_id: transactionId,
        p_total_people: count,
        p_mode: mode,
        p_members: members
      });

      if (error) throw error;
    }

    closeModal();
    await refresh();
    toast(prefill.id ? 'Movimiento actualizado' : 'Movimiento guardado');
  } catch (error) {
    toast(error.message || 'No se pudo guardar.', true);
  } finally {
    setBusy(button, false);
  }
}

function openPiggy() {
  modal(`<form id="piggy-form">
    <div class="modal-head"><h2>Nueva hucha</h2><button type="button" class="close-btn" data-close>×</button></div>
    <div class="field"><label>Nombre</label><input name="name" required></div>
    <label class="checkbox-row"><input name="shared" type="checkbox"> Hucha conjunta</label>
    <div class="field hidden" id="piggy-email-field"><label>Email del usuario</label><input name="email" type="email"></div>
    <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Crear</button></div>
  </form>`);

  const form = document.querySelector('#piggy-form');
  form.querySelector('[name="shared"]').addEventListener('change', event => {
    document.querySelector('#piggy-email-field').classList.toggle('hidden', !event.target.checked);
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.submitter;
    const fd = new FormData(form);
    const shared = fd.get('shared') === 'on';
    setBusy(button, true);

    try {
      const { data, error } = await sb.from('piggy_banks')
        .insert({
          name: fd.get('name'),
          is_shared: shared,
          owner_id: state.user.id
        })
        .select('id')
        .single();
      if (error) throw error;

      if (shared && fd.get('email')) {
        const { error: inviteError } = await sb.rpc('invite_shared_resource', {
          p_email: String(fd.get('email')).trim().toLowerCase(),
          p_resource_type: 'piggy',
          p_resource_id: data.id
        });
        if (inviteError) throw inviteError;
      }

      closeModal();
      await refresh();
      toast('Hucha creada');
    } catch (error) {
      toast(error.message, true);
    } finally {
      setBusy(button, false);
    }
  });
}

function openPiggyMenu(id) {
  const piggy = state.piggies.find(item => item.id === id);
  if (!piggy) return;

  modal(`<div class="modal-head">
      <div><h2>${esc(piggy.name)}</h2><p class="muted">${piggy.is_shared ? 'Hucha conjunta' : 'Hucha personal'}</p></div>
      <button class="close-btn" data-close>×</button>
    </div>
    <div class="menu-stack">
      <button class="btn" data-piggy-income>＋ Añadir ingreso</button>
      <button class="btn" data-piggy-expense>− Añadir gasto</button>
      ${piggy.is_shared ? '<button class="btn" data-invite-piggy>Invitar miembro</button>' : ''}
      <button class="btn" data-piggy-history>Ver movimientos</button>
      <button class="btn danger" data-delete-piggy>Eliminar hucha</button>
    </div>`);

  document.querySelector('[data-piggy-income]').onclick = () => openMovement({ kind: 'income', piggy_id: id });
  document.querySelector('[data-piggy-expense]').onclick = () => openMovement({ kind: 'expense', piggy_id: id });
  document.querySelector('[data-invite-piggy]')?.addEventListener('click', () => openInvite('piggy', id));
  document.querySelector('[data-piggy-history]').onclick = () => openPiggyHistory(id);
  document.querySelector('[data-delete-piggy]').onclick = async () => {
    if (!confirm('¿Eliminar esta hucha y sus movimientos?')) return;
    const { error } = await sb.rpc('delete_piggy_secure', { p_piggy_id: id });
    if (error) return toast(error.message, true);
    closeModal();
    await refresh();
    toast('Hucha eliminada');
  };
}

function openPiggyHistory(id) {
  const list = state.piggyTx.filter(tx => tx.piggy_id === id);
  modal(`<div class="modal-head"><h2>Movimientos de la hucha</h2><button class="close-btn" data-close>×</button></div>
    <div class="list">${list.map(tx => `<article class="row clickable" data-edit-piggy-tx="${tx.id}">
      <div><strong>${esc(tx.concept)}</strong><small>${esc(tx.occurred_on)}</small></div>
      <b>${tx.kind === 'income' ? '+' : '-'}${money(tx.amount_cents)}</b>
    </article>`).join('') || '<div class="empty">No hay movimientos.</div>'}</div>`, true);

  document.querySelectorAll('[data-edit-piggy-tx]').forEach(row => {
    row.onclick = () => {
      const tx = state.piggyTx.find(item => item.id === row.dataset.editPiggyTx);
      if (tx) openMovement(tx);
    };
  });
}

function openGoal() {
  modal(`<form id="goal-form">
    <div class="modal-head"><h2>Nuevo objetivo</h2><button type="button" class="close-btn" data-close>×</button></div>
    <div class="field"><label>Nombre</label><input name="name" required></div>
    <div class="field"><label>Meta (€)</label><input name="target" required></div>
    <label class="checkbox-row"><input name="shared" type="checkbox"> Objetivo conjunto</label>
    <div class="field hidden" id="goal-email-field"><label>Email del usuario</label><input name="email" type="email"></div>
    <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Crear</button></div>
  </form>`);

  const form = document.querySelector('#goal-form');
  form.querySelector('[name="shared"]').onchange = event => {
    document.querySelector('#goal-email-field').classList.toggle('hidden', !event.target.checked);
  };

  form.onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter;
    const fd = new FormData(form);
    const shared = fd.get('shared') === 'on';
    setBusy(button, true);

    try {
      const { data, error } = await sb.from('goals')
        .insert({
          name: fd.get('name'),
          target_cents: cents(fd.get('target')),
          is_shared: shared,
          owner_id: state.user.id
        })
        .select('id')
        .single();
      if (error) throw error;

      if (shared && fd.get('email')) {
        const { error: inviteError } = await sb.rpc('invite_shared_resource', {
          p_email: String(fd.get('email')).trim().toLowerCase(),
          p_resource_type: 'goal',
          p_resource_id: data.id
        });
        if (inviteError) throw inviteError;
      }

      closeModal();
      await refresh();
      toast('Objetivo creado');
    } catch (error) {
      toast(error.message, true);
    } finally {
      setBusy(button, false);
    }
  };
}

function openGoalMenu(id) {
  const goal = state.goals.find(item => item.id === id);
  if (!goal) return;

  modal(`<div class="modal-head">
      <div><h2>${esc(goal.name)}</h2><p class="muted">${goal.is_shared ? 'Objetivo conjunto' : 'Objetivo personal'}</p></div>
      <button class="close-btn" data-close>×</button>
    </div>
    <div class="menu-stack">
      <button class="btn" data-add-contribution>Añadir aporte</button>
      ${goal.is_shared ? '<button class="btn" data-invite-goal>Invitar miembro</button>' : ''}
    </div>`);

  document.querySelector('[data-invite-goal]')?.addEventListener('click', () => openInvite('goal', id));
  document.querySelector('[data-add-contribution]').onclick = () => {
    closeModal();
    modal(`<form id="contribution-form">
      <div class="modal-head"><h2>Nuevo aporte</h2><button type="button" class="close-btn" data-close>×</button></div>
      <div class="field"><label>Importe (€)</label><input name="amount" required></div>
      <div class="field"><label>Nota</label><input name="note" value="Aporte"></div>
      <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Guardar</button></div>
    </form>`);
    document.querySelector('#contribution-form').onsubmit = async event => {
      event.preventDefault();
      const fd = new FormData(event.currentTarget);
      const { error } = await sb.from('goal_contributions').insert({
        goal_id: id,
        amount_cents: cents(fd.get('amount')),
        note: fd.get('note'),
        user_id: state.user.id
      });
      if (error) return toast(error.message, true);
      closeModal();
      await refresh();
      toast('Aporte guardado');
    };
  };
}

function openInvite(type, resourceId) {
  closeModal();
  modal(`<form id="invite-form">
    <div class="modal-head"><h2>Invitar usuario</h2><button type="button" class="close-btn" data-close>×</button></div>
    <div class="field"><label>Email</label><input name="email" type="email" required></div>
    <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Enviar invitación</button></div>
  </form>`);

  document.querySelector('#invite-form').onsubmit = async event => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const { error } = await sb.rpc('invite_shared_resource', {
      p_email: String(fd.get('email')).trim().toLowerCase(),
      p_resource_type: type,
      p_resource_id: resourceId
    });
    if (error) return toast(error.message, true);
    closeModal();
    await refresh();
    toast('Invitación enviada');
  };
}

function openFolder() {
  modal(`<form id="folder-form">
    <div class="modal-head"><h2>Nueva carpeta</h2><button type="button" class="close-btn" data-close>×</button></div>
    <div class="field"><label>Nombre</label><input name="name" required></div>
    <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Crear</button></div>
  </form>`);
  document.querySelector('#folder-form').onsubmit = async event => {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get('name');
    const { error } = await sb.from('folders').insert({ name, owner_id: state.user.id });
    if (error) return toast(error.message, true);
    closeModal();
    await refresh();
  };
}
