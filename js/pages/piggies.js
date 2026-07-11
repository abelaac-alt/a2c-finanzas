import { state } from '../core/store.js';
import { money, esc } from '../core/ui.js';

function stats(id) {
  return state.piggyTx
    .filter(tx => tx.piggy_id === id)
    .reduce((acc, tx) => {
      const amount = Number(tx.amount_cents) || 0;
      if (tx.kind === 'income') acc.income += amount;
      if (tx.kind === 'expense') acc.expense += amount;
      return acc;
    }, { income: 0, expense: 0 });
}

export function renderPiggies() {
  return `<section>
    <div class="section-head">
      <div><h2>Huchas</h2><p class="muted">Personales y conjuntas</p></div>
      <button class="btn primary" data-new-piggy>Nueva hucha</button>
    </div>

    <div class="grid two">
      ${state.piggies.map(piggy => {
        const s = stats(piggy.id);
        const members = piggy.piggy_members || [];
        return `<article class="card">
          <div class="entity-header">
            <div><h3>${esc(piggy.name)}</h3><p class="muted">${piggy.is_shared ? `Conjunta · ${members.length} miembros` : 'Personal'}</p></div>
            <button class="icon-btn" data-piggy-menu="${piggy.id}">•••</button>
          </div>
          <div class="metric">${money(s.income - s.expense)}</div>
          <div class="mini-grid">
            <span>Ingresos <b class="positive">${money(s.income)}</b></span>
            <span>Gastos <b class="negative">${money(s.expense)}</b></span>
          </div>
        </article>`;
      }).join('') || '<div class="empty">No hay huchas.</div>'}
    </div>
  </section>`;
}
