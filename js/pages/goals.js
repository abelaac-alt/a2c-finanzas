import { state } from '../core/store.js';
import { money, esc } from '../core/ui.js';

export function renderGoals(){
  return `<section><div class="section-head"><div><h2>Objetivos</h2><p class="muted">Metas personales y compartidas</p></div><button class="btn primary" data-new-goal>Nuevo</button></div>
  <div class="grid two">${state.goals.map(g=>{
    const saved = state.contributions.filter(c=>c.goal_id===g.id).reduce((s,c)=>s+Number(c.amount_cents),0);
    const pct = Math.min(100, Math.round(saved/Number(g.target_cents||1)*100));
    return `<article class="card"><h3>${esc(g.name)}</h3><p class="muted">${g.is_shared?'Compartido':'Personal'} · ${pct}%</p><div class="metric">${money(saved)}</div><small>Meta: ${money(g.target_cents)}</small></article>`;
  }).join('') || '<div class="empty">No hay objetivos.</div>'}</div></section>`;
}
