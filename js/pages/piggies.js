import { state } from '../core/store.js';
import { money, esc } from '../core/ui.js';

export function renderPiggies(){
  return `<section><div class="section-head"><div><h2>Huchas</h2><p class="muted">Personales y conjuntas</p></div><button class="btn primary" data-new-piggy>Nueva</button></div>
  <div class="grid two">${state.piggies.map(p=>{
    const tx = state.piggyTx.filter(t=>t.piggy_id===p.id);
    const total = tx.reduce((s,t)=>s+(t.kind==='income'?Number(t.amount_cents):-Number(t.amount_cents)),0);
    return `<article class="card"><h3>${esc(p.name)}</h3><p class="muted">${p.is_shared?'Conjunta':'Personal'}</p><div class="metric">${money(total)}</div></article>`;
  }).join('') || '<div class="empty">No hay huchas.</div>'}</div></section>`;
}
