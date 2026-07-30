(function(){
  'use strict';
  const A=window.A2C;
  A.dashboard={
    render(){
      const totals=A.monthTotals();const balance=A.balance();const owed=A.pendingOwed();const receivable=A.pendingReceivable();
      const values=[
        {key:'income',label:'Ingresos',value:totals.income,color:'#12845f'},
        {key:'expense',label:'Gastos',value:totals.expense,color:'#c33d49'},
        {key:'saving',label:'Ahorro',value:totals.saving,color:'#2d63c8'},
        {key:'investment',label:'Inversión',value:totals.investment,color:'#7a4cb7'}
      ];
      if(owed>0)values.push({key:'owed',label:'Debes',value:owed,color:'#b66d0d'});
      const chartTotal=values.reduce((sum,row)=>sum+row.value,0)||1;let cursor=0;
      const segments=values.map(row=>{const start=cursor;cursor+=row.value/chartTotal*100;return `${row.color} ${start}% ${cursor}%`;}).join(',');
      const latest=A.state.transactions.filter(row=>row.kind==='expense').slice(0,5);
      const scheduled=A.state.scheduled.filter(row=>row.active).slice(0,3);
      const currentBudgets=A.state.budgets.filter(row=>row.active&&row.period_month===A.monthKey()).slice(0,3);
      return `${A.ui.header('Resumen','Tu centro financiero','Todo lo importante de este mes')}
        <section class="card balance-card">
          <small>Saldo disponible</small><div class="big-number">${A.money(balance)}</div>
          <div class="balance-actions"><button class="btn" id="dashboard-add">＋ Movimiento</button><button class="btn" id="dashboard-fuel">⛽ Combustible</button><button class="btn" data-nav="activity">Ver actividad</button></div>
        </section>
        <section class="card" style="margin-top:12px"><div class="metrics">
          <div class="metric-card income"><small>INGRESOS</small><b>${A.money(totals.income)}</b></div>
          <div class="metric-card expense"><small>GASTOS</small><b>${A.money(totals.expense)}</b></div>
          <div class="metric-card saving"><small>AHORRO</small><b>${A.money(totals.saving)}</b></div>
          <div class="metric-card investment"><small>INVERSIÓN</small><b>${A.money(totals.investment)}</b></div>
        </div>${owed||receivable?`<div class="metrics" style="margin-top:8px">${owed?`<div class="metric-card expense"><small>DEBES</small><b>${A.money(owed)}</b></div>`:''}${receivable?`<div class="metric-card income"><small>TE DEBEN</small><b>${A.money(receivable)}</b></div>`:''}</div>`:''}</section>
        <section class="grid grid-2" style="margin-top:12px">
          <article class="card"><div class="card-title"><div><h2>Distribución mensual</h2><p>Ingresos, gastos y planificación</p></div></div><div class="chart-wrap"><div class="donut" style="background:conic-gradient(${segments})"><div class="donut-center"><div><b>${A.money(totals.expense)}</b><small>gastado</small></div></div></div><div class="legend">${values.map(row=>`<div class="legend-row"><i style="background:${row.color}"></i><span>${row.label}</span><b>${A.money(row.value)}</b></div>`).join('')}</div></div></article>
          <article class="card"><div class="card-title"><div><h2>Próximos movimientos</h2><p>Programaciones activas</p></div><button class="btn small" id="dashboard-scheduled">Gestionar</button></div>${scheduled.length?`<div class="list">${scheduled.map(row=>`<div class="list-row"><span class="kind-icon expense">↻</span><div class="list-row-main"><strong>${A.escape(row.concept)}</strong><small>${A.escape(row.next_run||'')} · ${A.escape(row.frequency||'Mensual')}</small></div><div class="list-row-value"><b>${A.money(row.amount_cents)}</b></div></div>`).join('')}</div>`:A.ui.empty('No hay movimientos programados.')}</article>
        </section>
        <section class="grid grid-2" style="margin-top:12px">
          <article class="card"><div class="card-title"><div><h2>Últimos gastos</h2><p>Movimientos recientes</p></div><button class="btn small" data-nav="activity">Todos</button></div>${latest.length?`<div class="list">${latest.map(A.transactions.rowMarkup).join('')}</div>`:A.ui.empty('Todavía no hay gastos.')}</article>
          <article class="card"><div class="card-title"><div><h2>Presupuestos activos</h2><p>Límites del mes</p></div><button class="btn small" id="dashboard-budgets">Gestionar</button></div>${currentBudgets.length?currentBudgets.map(A.budgets.rowMarkup).join(''):A.ui.empty('No hay presupuestos para este mes.')}</article>
        </section>`;
    },
    bind(){
      if(A.state.page!=='home')return;
      A.root.querySelectorAll('[data-nav]').forEach(button=>button.addEventListener('click',()=>A.navigate(button.dataset.nav)));
      A.root.querySelector('#dashboard-add')?.addEventListener('click',()=>A.transactions.openForm());
      A.root.querySelector('#dashboard-fuel')?.addEventListener('click',()=>A.transactions.openFuelForm());
      A.root.querySelector('#dashboard-scheduled')?.addEventListener('click',()=>{A.state.page='tools';A.state.tool='scheduled';A.ui.render();});
      A.root.querySelector('#dashboard-budgets')?.addEventListener('click',()=>{A.state.page='tools';A.state.tool='budgets';A.ui.render();});
      A.root.querySelectorAll('[data-transaction]').forEach(row=>row.addEventListener('click',()=>A.transactions.openDetail(row.dataset.transaction)));
    }
  };
  A.ui.registerPage('home',A.dashboard.render);
})();
