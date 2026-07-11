import { state } from '../core/store.js';
import { money, esc } from '../core/ui.js';

export function renderGoals() {
  return `<section>
    <div class="section-head">
      <div><h2>Objetivos</h2><p class="muted">Personales y conjuntos</p></div>
      <button class="btn primary" data-new-goal>Nuevo objetivo</button>
    </div>

    <div class="grid two">
      ${state.goals.map(goal => {
        const saved = state.contributions
          .filter(c => c.goal_id === goal.id)
          .reduce((sum, c) => sum + Number(c.amount_cents), 0);
        const target = Number(goal.target_cents) || 1;
        const pct = Math.min(100, Math.round(saved / target * 100));
        const members = goal.goal_members || [];

        return `<article class="card">
          <div class="entity-header">
            <div><h3>${esc(goal.name)}</h3><p class="muted">${goal.is_shared ? `Conjunto · ${members.length} miembros` : 'Personal'}</p></div>
            <button class="icon-btn" data-goal-menu="${goal.id}">•••</button>
          </div>
          <div class="metric">${money(saved)}</div>
          <div class="progress"><i style="width:${pct}%"></i></div>
          <small>${pct}% de ${money(goal.target_cents)}</small>
        </article>`;
      }).join('') || '<div class="empty">No hay objetivos.</div>'}
    </div>
  </section>`;
}
