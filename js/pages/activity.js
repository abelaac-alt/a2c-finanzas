import { state } from '../core/store.js';
import { money, esc } from '../core/ui.js';

export function filterTransactions() {
  const filter = state.activityFilter;
  return state.ledger.filter(tx => {
    if (filter.query && !String(tx.concept || '').toLowerCase().includes(filter.query.toLowerCase())) return false;
    if (filter.kind && tx.kind !== filter.kind) return false;
    if (filter.from && tx.occurred_on < filter.from) return false;
    if (filter.to && tx.occurred_on > filter.to) return false;
    if (filter.folderId && tx.folder_id !== filter.folderId) return false;
    return true;
  });
}

export function rows(list) {
  return list.map(tx => `<article class="row clickable" data-edit-ledger="${tx.id}">
    <div>
      <strong>${esc(tx.concept)}</strong>
      <small>${esc(tx.occurred_on)} · ${esc(tx.kind)}${tx.folder?.name ? ` · ${esc(tx.folder.name)}` : ''}</small>
    </div>
    <b class="${tx.kind === 'income' ? 'positive' : tx.kind === 'investment' ? 'investment' : 'negative'}">
      ${tx.kind === 'income' ? '+' : '-'}${money(tx.amount_cents)}
    </b>
  </article>`).join('') || '<div class="empty">No hay movimientos.</div>';
}

export function renderActivity() {
  const filtered = filterTransactions();
  return `<section>
    <div class="section-head">
      <div><h2>Actividad</h2><p class="muted">Busca, edita y elimina tus movimientos</p></div>
      <button class="btn primary" data-new-movement>Nuevo</button>
    </div>

    <form class="filters" id="activity-filter">
      <input name="query" placeholder="Concepto" value="${esc(state.activityFilter.query)}">
      <input name="from" type="date" value="${esc(state.activityFilter.from)}">
      <input name="to" type="date" value="${esc(state.activityFilter.to)}">
      <select name="kind">
        <option value="">Todos</option>
        <option value="income" ${state.activityFilter.kind === 'income' ? 'selected' : ''}>Ingreso</option>
        <option value="expense" ${state.activityFilter.kind === 'expense' ? 'selected' : ''}>Gasto</option>
        <option value="investment" ${state.activityFilter.kind === 'investment' ? 'selected' : ''}>Inversión</option>
      </select>
    </form>

    ${state.activityFilter.folderId ? '<button class="btn" id="clear-folder-filter">Quitar filtro de carpeta</button>' : ''}
    <div class="results-count">${filtered.length} movimientos</div>
    <div class="list" id="activity-list">${rows(filtered)}</div>
  </section>`;
}
