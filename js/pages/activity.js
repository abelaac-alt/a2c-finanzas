import { state } from '../core/store.js';
import { money, esc } from '../core/ui.js';

export function renderActivity(){
  return `<section><div class="section-head"><div><h2>Actividad</h2><p class="muted">Busca tus transacciones</p></div></div>
    <form class="filters" id="activity-filter">
      <input name="q" placeholder="Concepto">
      <input name="from" type="date">
      <input name="to" type="date">
      <select name="kind"><option value="">Todos</option><option value="income">Ingreso</option><option value="expense">Gasto</option><option value="investment">Inversión</option></select>
    </form>
    <div class="list" id="activity-list">${rows(state.ledger)}</div>
  </section>`;
}
export function rows(list){
  return list.map(tx=>`<article class="row"><div><strong>${esc(tx.concept)}</strong><small>${esc(tx.occurred_on)} · ${esc(tx.kind)}</small></div><b>${money(tx.amount_cents)}</b></article>`).join('') || '<div class="empty">No hay movimientos.</div>';
}
