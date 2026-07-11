import { state } from '../core/store.js';
import { money, esc } from '../core/ui.js';

function totals() {
  return state.ledger.reduce((acc, tx) => {
    const amount = Number(tx.amount_cents) || 0;
    if (tx.kind === 'income') acc.income += amount;
    if (tx.kind === 'expense') acc.expense += amount;
    if (tx.kind === 'investment') acc.investment += amount;
    return acc;
  }, { income: 0, expense: 0, investment: 0 });
}

function mainBalance() {
  return state.ledger.reduce((sum, tx) => {
    const amount = Number(tx.amount_cents) || 0;
    return sum + (tx.kind === 'income' ? amount : -amount);
  }, 0);
}

function txRow(tx) {
  const positive = tx.kind === 'income';
  return `<article class="row clickable" data-edit-ledger="${tx.id}">
    <div>
      <strong>${esc(tx.concept)}</strong>
      <small>${esc(tx.occurred_on)} · ${esc(tx.kind)}</small>
    </div>
    <b class="${positive ? 'positive' : tx.kind === 'investment' ? 'investment' : 'negative'}">
      ${positive ? '+' : '-'}${money(tx.amount_cents)}
    </b>
  </article>`;
}

export function renderHome() {
  const t = totals();
  const max = Math.max(1, t.income + t.expense + t.investment);
  const incomePct = Math.round((t.income / max) * 100);
  const expensePct = Math.round((t.expense / max) * 100);
  const expenseEnd = Math.min(100, incomePct + expensePct);

  return `<section>
    <article class="hero">
      <span>Cuenta principal</span>
      <strong>${money(mainBalance())}</strong>
      <small>Saldo disponible calculado a partir de tus movimientos</small>
      <div class="quick-actions">
        <button class="quick-action income" data-quick-kind="income">＋ Ingreso</button>
        <button class="quick-action expense" data-quick-kind="expense">− Gasto</button>
      </div>
    </article>

    <div class="grid three">
      <article class="card"><h3>Ingresos</h3><div class="metric positive">${money(t.income)}</div></article>
      <article class="card"><h3>Gastos</h3><div class="metric negative">${money(t.expense)}</div></article>
      <article class="card"><h3>Inversiones</h3><div class="metric investment">${money(t.investment)}</div></article>
    </div>

    <article class="card pie-card">
      <div>
        <h2>Distribución</h2>
        <p class="muted">Ingresos, gastos e inversiones</p>
      </div>
      <div class="pie-layout">
        <div class="pie-chart" style="--income:${incomePct}%;--expense:${expenseEnd}%"></div>
        <div class="pie-legend">
          <span><i class="legend-dot income"></i>Ingresos <b>${money(t.income)}</b></span>
          <span><i class="legend-dot expense"></i>Gastos <b>${money(t.expense)}</b></span>
          <span><i class="legend-dot investment"></i>Inversiones <b>${money(t.investment)}</b></span>
        </div>
      </div>
    </article>

    <div class="section-head">
      <div><h2>Movimientos recientes</h2><p class="muted">Pulsa para editar o borrar</p></div>
      <button class="btn primary" data-new-movement>Nuevo movimiento</button>
    </div>
    <div class="list">${state.ledger.slice(0, 10).map(txRow).join('') || '<div class="empty">No hay movimientos.</div>'}</div>
  </section>`;
}
