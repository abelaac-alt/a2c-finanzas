import { state } from '../core/store.js';
import { money, esc } from '../core/ui.js';

export function renderFolders(){
  return `<section><div class="section-head"><div><h2>Carpetas</h2><p class="muted">Organiza tus movimientos</p></div><button class="btn primary" data-new-folder>Nueva</button></div>
  <div class="grid two">${state.folders.map(f=>{
    const list = state.ledger.filter(t=>t.folder_id===f.id);
    const total = list.reduce((s,t)=>s+(t.kind==='income'?Number(t.amount_cents):-Number(t.amount_cents)),0);
    return `<article class="card"><h3>${esc(f.name)}</h3><p class="muted">${list.length} movimientos</p><div class="metric">${money(total)}</div><button class="btn" data-folder-view="${f.id}">Ver movimientos</button></article>`;
  }).join('') || '<div class="empty">No hay carpetas.</div>'}</div></section>`;
}
