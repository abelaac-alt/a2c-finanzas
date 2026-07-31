(function(){
  'use strict';
  const A=window.A2C;
  const D=A.dashboard={selectedKind:'expense'};
  D.chartValues=()=>{const totals=A.monthTotals();return [
    {key:'income',label:'Ingresos',value:totals.income,color:'#0A5BFF',icon:'income'},
    {key:'expense',label:'Gastos',value:totals.expense,color:'#101828',icon:'expense'},
    {key:'saving',label:'Ahorro',value:totals.saving,color:'#4B83FF',icon:'saving'},
    {key:'investment',label:'Inversión',value:totals.investment,color:'#A9C4FF',icon:'investment'}
  ];};
  D.chartMarkup=()=>{
    const values=D.chartValues();const donut=A.donutSegments(values);let selected=values.find(row=>row.key===D.selectedKind)||values[1];
    if(selected.value===0){selected=values.find(row=>row.value>0)||selected;D.selectedKind=selected.key;}
    const paths=donut.segments.length?donut.segments.map(row=>`<path d="${row.path}" fill="none" stroke="${row.color}" stroke-width="12" class="donut-segment ${row.key===D.selectedKind?'active':''}" data-action="dashboard-chart-select" data-kind="${row.key}" tabindex="0"><title>${row.label}: ${A.money(row.value)}</title></path>`).join(''):`<circle cx="50" cy="50" r="42" fill="none" stroke="#E8EDF5" stroke-width="12"/>`;
    return `${A.ui.sectionTitle('Distribución del mes','Pulsa una sección para consultar su importe')}
      <div class="finance-chart-layout">
        <div class="interactive-donut">
          <svg viewBox="0 0 100 100" role="img" aria-label="Distribución financiera mensual">${paths}</svg>
          <div class="donut-data"><span>${A.icon(selected.icon,22)}</span><small>${selected.label}</small><strong>${A.money(selected.value)}</strong></div>
        </div>
        <div class="chart-legend">${values.map(row=>`<button class="chart-legend-row ${row.key===D.selectedKind?'active':''}" data-action="dashboard-chart-select" data-kind="${row.key}"><i style="--segment:${row.color}"></i><span>${A.icon(row.icon,18)}<b>${row.label}</b></span><strong>${A.money(row.value)}</strong></button>`).join('')}</div>
      </div>`;
  };
  D.render=()=>{
    const balance=A.balance();const owed=A.pendingOwed();const receivable=A.pendingReceivable();const savingPiggies=A.savingPiggyBalance();const liquidityPiggies=A.liquidityPiggyBalance();
    const latest=A.timeline().slice(0,10);const scheduled=A.pendingScheduled().slice(0,8);
    const budgets=A.state.budgets.filter(row=>row.active&&row.period_month===A.monthKey()).slice(0,5);const goals=A.state.goals.filter(row=>row.status==='active').slice(0,3);
    return `<section class="home-balance">
        <div class="balance-heading"><span>${A.icon('wallet',24)}</span><small>Saldo disponible</small></div>
        <strong>${A.money(balance)}</strong>
        <div class="home-quick-actions">
          <button data-action="new-transaction">${A.icon('plus',18)}<span>Movimiento</span></button>
          <button data-action="new-fuel">${A.icon('fuel',18)}<span>Combustible</span></button>
          <button data-nav="activity">${A.icon('activity',18)}<span>Actividad</span></button>
        </div>
        <div class="balance-reserves"><span>${A.icon('saving',16)}Ahorro en huchas <b>${A.money(savingPiggies)}</b></span><span>${A.icon('piggy',16)}Liquidez en huchas <b>${A.money(liquidityPiggies)}</b></span></div>${(owed||receivable)?`<div class="balance-debts">${owed?`<span>${A.icon('expense',16)}Debes <b>${A.money(owed)}</b></span>`:''}${receivable?`<span>${A.icon('income',16)}Te deben <b>${A.money(receivable)}</b></span>`:''}</div>`:''}
      </section>
      <section class="card dashboard-chart" id="dashboard-chart-card">${D.chartMarkup()}</section>
      ${goals.length?`<section class="card dashboard-section compact-goals">${A.ui.sectionTitle('Objetivos activos','Progreso de tus metas','<button class="text-button" data-action="open-tool" data-tool="goals">Ver objetivos</button>')}<div class="goal-mini-list">${goals.map(goal=>`<button data-action="open-goal" data-id="${goal.id}"><span>${A.icon('target',18)}</span><div><b>${A.escape(goal.name)}</b><div class="progress-track"><i style="width:${A.goals.progress(goal)}%"></i></div></div><strong>${Math.round(A.goals.progress(goal))}%</strong></button>`).join('')}</div></section>`:''}
      <section class="card dashboard-section">
        ${A.ui.sectionTitle('Últimos movimientos','Los 10 movimientos más recientes','<button class="text-button" data-nav="activity">Ver todos</button>')}
        ${latest.length?`<div class="movement-list">${latest.map(A.transactions.rowMarkup).join('')}</div>`:A.ui.empty('Aún no hay movimientos','Registra tu primer movimiento desde el botón superior.')}
      </section>
      <section class="card dashboard-section">
        ${A.ui.sectionTitle('Movimientos pendientes','Gastos y traspasos programados','<button class="btn small primary" data-action="new-scheduled">'+A.icon('plus',16)+' Programar</button>')}
        ${scheduled.length?`<div class="scheduled-list">${scheduled.map(A.scheduled.rowMarkup).join('')}</div>`:A.ui.empty('No hay movimientos pendientes','Puedes programar un gasto o un traspaso entre huchas.')}
      </section>
      <section class="card dashboard-section">
        ${A.ui.sectionTitle('Presupuestos activos','Seguimiento del mes actual','<button class="text-button" data-action="open-tool" data-tool="budgets">Gestionar</button>')}
        ${budgets.length?`<div class="budget-list">${budgets.map(A.budgets.rowMarkup).join('')}</div>`:A.ui.empty('No hay presupuestos activos','Crea límites por categoría para controlar el gasto.')}
      </section>`;
  };
  A.ui.action('dashboard-chart-select',({data})=>{D.selectedKind=data.kind;const card=document.querySelector('#dashboard-chart-card');if(card)card.innerHTML=D.chartMarkup();});
  A.ui.action('new-transaction',()=>A.transactions.openForm());
  A.ui.action('new-fuel',()=>A.transactions.openForm(null,{fuel:true,kind:'expense',concept:'Combustible'}));
  A.ui.action('new-scheduled',()=>A.scheduled.openForm());
  A.ui.action('open-tool',({data})=>{A.state.page='tools';A.state.tool=data.tool||'statistics';history.replaceState(null,'','#tools');A.ui.render();});
  A.ui.registerPage('home',D.render);
})();
