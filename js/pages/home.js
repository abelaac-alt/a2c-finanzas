import { state } from '../core/store.js';
import { money, esc } from '../core/ui.js';

const balance = () => state.ledger.reduce((sum, tx) =>
  sum + (tx.kind === 'income' ? Number(tx.amount_cents) : -Number(tx.amount_cents)), 0);

export function renderHome(){
  const income = state.ledger.filter(x=>x.kind==='income').reduce((s,x)=>s+Number(x.amount_cents),0);
  const expense = state.ledger.filter(x=>x.kind==='expense').reduce((s,x)=>s+Number(x.amount_cents),0);
  const investment = state.ledger.filter(x=>x.kind==='investment').reduce((s,x)=>s+Number(x.amount_cents),0);
  return `<section>
    <article class="hero"><span>Cuenta principal</span><strong>${money(balance())}</strong><small>Saldo calculado a partir de tus movimientos</small></article>
    <div class="grid three">
      <article class="card"><h3>Ingresos</h3><div class="metric positive">${money(income)}</div></article>
      <article class="card"><h3>Gastos</h3><div class="metric negative">${money(expense)}</div></article>
      <article class="card"><h3>Inversión</h3><div class="metric investment">${money(investment)}</div></article>
    </div>
    <div class="section-head"><div><h2>Movimientos recientes</h2><p class="muted">Cuenta principal</p></div><button class="btn primary" data-new-movement>Nuevo</button></div>
    <div class="list">${state.ledger.slice(0,8).map(tx=>`<article class="row"><div><strong>${esc(tx.concept)}</strong><small>${esc(tx.occurred_on)}</small></div><b class="${tx.kind==='income'?'positive':'negative'}">${tx.kind==='income'?'+':'-'}${money(tx.amount_cents)}</b></article>`).join('') || '<div class="empty">No hay movimientos.</div>'}</div>
  </section>`;
}
