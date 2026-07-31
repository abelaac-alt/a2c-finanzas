(function(){
  'use strict';
  const A=window.A2C;
  const S=A.statistics={preset:'month',from:A.startOfMonth(),to:A.endOfMonth(),loading:false,data:null,requestId:0};
  S.rangeForPreset=preset=>{
    const now=new Date();let from,to;
    if(preset==='previous'){const d=new Date(now.getFullYear(),now.getMonth()-1,1);from=A.startOfMonth(d);to=A.endOfMonth(d);}
    else if(preset==='3m'){const d=new Date(now.getFullYear(),now.getMonth()-2,1);from=A.startOfMonth(d);to=A.today();}
    else if(preset==='6m'){const d=new Date(now.getFullYear(),now.getMonth()-5,1);from=A.startOfMonth(d);to=A.today();}
    else if(preset==='year'){from=`${now.getFullYear()}-01-01`;to=A.today();}
    else{from=A.startOfMonth(now);to=A.endOfMonth(now);}
    return {from,to};
  };
  S.render=()=>`<section class="statistics-shell">
    <form class="statistics-filter" id="statistics-filter">
      <div class="filter-pills">${[['month','Este mes'],['previous','Mes anterior'],['3m','3 meses'],['6m','6 meses'],['year','Este año'],['custom','Personalizado']].map(([key,label])=>`<button type="button" class="filter-pill ${S.preset===key?'active':''}" data-stats-preset="${key}">${label}</button>`).join('')}</div>
      <div class="custom-range ${S.preset==='custom'?'':'hidden'}" id="statistics-custom-range"><div class="field"><label>Desde</label><input name="from" type="date" value="${S.from}"></div><div class="field"><label>Hasta</label><input name="to" type="date" value="${S.to}"></div><button class="btn primary">Aplicar</button></div>
    </form>
    <div id="statistics-content">${S.data?S.contentMarkup(S.data):S.loadingMarkup()}</div>
  </section>`;
  S.loadingMarkup=()=>`<div class="stats-loading"><div></div><div></div><div></div><div></div></div>`;
  S.changeLabel=value=>{const number=Number(value||0);if(!Number.isFinite(number))return '';return `<span class="comparison ${number>0?'up':number<0?'down':'flat'}">${number>0?'+':''}${A.number(number,1)}% vs. periodo anterior</span>`;};
  S.contentMarkup=data=>{
    const totals=data.totals||{};const previous=data.comparison||{};const monthly=data.monthly||[];const categories=data.categories||[];const fuel=data.fuel||{};const fuelSeries=data.fuel_series||[];const top=data.top_expenses||[];
    const monthlyMax=Math.max(1,...monthly.flatMap(row=>[Number(row.income_cents||0),Number(row.expense_cents||0),Number(row.saving_cents||0),Number(row.investment_cents||0)]));
    const categoryMax=Math.max(1,...categories.map(row=>Number(row.amount_cents||0)));
    return `<section class="stats-kpis">
      <article class="stat-card featured"><span>${A.icon('chart',20)}</span><small>Resultado disponible</small><strong>${A.money(totals.net_available_cents)}</strong>${S.changeLabel(previous.net_change_pct)}</article>
      <article class="stat-card"><span>${A.icon('income',19)}</span><small>Ingresos</small><strong>${A.money(totals.income_cents)}</strong>${S.changeLabel(previous.income_change_pct)}</article>
      <article class="stat-card"><span>${A.icon('expense',19)}</span><small>Gastos</small><strong>${A.money(totals.expense_cents)}</strong>${S.changeLabel(previous.expense_change_pct)}</article>
      <article class="stat-card"><span>${A.icon('saving',19)}</span><small>Ahorro</small><strong>${A.money(totals.saving_cents)}</strong></article>
      <article class="stat-card"><span>${A.icon('investment',19)}</span><small>Inversión</small><strong>${A.money(totals.investment_cents)}</strong></article>
      <article class="stat-card"><span>${A.icon('calendar',19)}</span><small>Gasto medio diario</small><strong>${A.money(totals.average_daily_expense_cents)}</strong></article>
      <article class="stat-card"><span>${A.icon('activity',19)}</span><small>Movimientos</small><strong>${A.number(totals.transaction_count,0)}</strong><em>${A.number(totals.transfer_count,0)} traspasos internos</em></article>
      <article class="stat-card"><span>${A.icon('expense',19)}</span><small>Mayor gasto</small><strong>${A.money(totals.largest_expense_cents)}</strong></article>
    </section>
    <section class="card statistics-card">
      ${A.ui.sectionTitle('Resumen mensual','Evolución de ingresos, gastos, ahorro e inversión')}
      ${monthly.length?`<div class="monthly-chart">${monthly.map(row=>`<div class="month-column"><div class="month-bars"><i class="income" style="height:${Math.max(2,Number(row.income_cents||0)/monthlyMax*100)}%" title="Ingresos ${A.money(row.income_cents)}"></i><i class="expense" style="height:${Math.max(2,Number(row.expense_cents||0)/monthlyMax*100)}%" title="Gastos ${A.money(row.expense_cents)}"></i><i class="saving" style="height:${Math.max(2,Number(row.saving_cents||0)/monthlyMax*100)}%" title="Ahorro ${A.money(row.saving_cents)}"></i><i class="investment" style="height:${Math.max(2,Number(row.investment_cents||0)/monthlyMax*100)}%" title="Inversión ${A.money(row.investment_cents)}"></i></div><small>${A.escape(row.label||row.month)}</small></div>`).join('')}</div><div class="chart-key"><span><i class="income"></i>Ingresos</span><span><i class="expense"></i>Gastos</span><span><i class="saving"></i>Ahorro</span><span><i class="investment"></i>Inversión</span></div>`:A.ui.empty('No hay datos mensuales')}
    </section>
    <div class="stats-grid">
      <section class="card statistics-card">
        ${A.ui.sectionTitle('Gastos por categoría','Dónde se concentra el gasto')}
        ${categories.length?`<div class="category-stats">${categories.map(row=>{const definition=A.categoryDefinitions[row.category_key]||A.categoryDefinitions.other;return `<div class="category-stat"><span class="category-icon">${A.icon(definition.icon,18)}</span><div><div><b>${A.escape(definition.name)}</b><strong>${A.money(row.amount_cents)}</strong></div><div class="progress-track"><i style="width:${Number(row.amount_cents||0)/categoryMax*100}%"></i></div><small>${A.number(row.percentage,1)}% · ${A.number(row.count,0)} movimientos</small></div></div>`;}).join('')}</div>`:A.ui.empty('No hay gastos en este periodo')}
      </section>
      <section class="card statistics-card">
        ${A.ui.sectionTitle('Mayores gastos','Movimientos con mayor importe')}
        ${top.length?`<div class="top-expenses">${top.map((row,index)=>`<button data-action="open-transaction" data-id="${row.id}"><span>${String(index+1).padStart(2,'0')}</span><div><b>${A.escape(row.concept||'Gasto')}</b><small>${A.formatDate(row.occurred_on)}</small></div><strong>${A.money(row.amount_cents)}</strong></button>`).join('')}</div>`:A.ui.empty('No hay gastos en este periodo')}
      </section>
    </div>
    <section class="card statistics-card fuel-statistics">
      ${A.ui.sectionTitle('Combustible por fechas','Coste, litros, precio y consumo del periodo seleccionado')}
      <div class="fuel-kpis"><div><small>Repostajes</small><b>${A.number(fuel.refuels,0)}</b></div><div><small>Gasto total</small><b>${A.money(fuel.total_cents)}</b></div><div><small>Litros</small><b>${A.number(fuel.liters,2)} L</b></div><div><small>Precio medio</small><b>${A.number(Number(fuel.average_price_milli||0)/1000,3)} €/L</b></div><div><small>Consumo medio</small><b>${fuel.average_consumption_l100km?`${A.number(fuel.average_consumption_l100km,2)} L/100 km`:'—'}</b></div><div><small>Kilómetros</small><b>${A.number(fuel.total_km,0)} km</b></div></div>
      ${fuelSeries.length?`<div class="fuel-table"><div class="fuel-table-head"><span>Mes</span><span>Repostajes</span><span>Litros</span><span>Gasto</span><span>Precio medio</span></div>${fuelSeries.map(row=>`<div><span>${A.escape(row.label||row.month)}</span><span>${A.number(row.refuels,0)}</span><span>${A.number(row.liters,2)} L</span><span>${A.money(row.total_cents)}</span><span>${A.number(Number(row.average_price_milli||0)/1000,3)} €/L</span></div>`).join('')}</div>`:''}
    </section>`;
  };
  S.load=async({force=false}={})=>{
    const request=++S.requestId;S.loading=true;const container=document.querySelector('#statistics-content');if(container)container.innerHTML=S.loadingMarkup();
    try{const data=await A.store.statistics(S.from,S.to,{force});if(request!==S.requestId)return;S.data=data;S.loading=false;if(container)container.innerHTML=S.contentMarkup(data);}
    catch(error){S.loading=false;if(container)container.innerHTML=`<div class="error-panel"><strong>No se pudieron cargar las estadísticas</strong><p>${A.escape(error.message)}</p><button class="btn secondary" data-action="reload-statistics">Reintentar</button></div>`;}
  };
  S.afterRender=()=>{
    const form=document.querySelector('#statistics-filter');if(!form)return;
    form.querySelectorAll('[data-stats-preset]').forEach(button=>button.addEventListener('click',()=>{
      S.preset=button.dataset.statsPreset;
      form.querySelectorAll('[data-stats-preset]').forEach(item=>item.classList.toggle('active',item===button));
      const custom=document.querySelector('#statistics-custom-range');
      custom.classList.toggle('hidden',S.preset!=='custom');
      if(S.preset!=='custom'){
        const range=S.rangeForPreset(S.preset);S.from=range.from;S.to=range.to;
        form.elements.from.value=S.from;form.elements.to.value=S.to;
        S.data=null;S.load();
      }else{
        form.elements.from.value=S.from;form.elements.to.value=S.to;
      }
    }));
    form.addEventListener('submit',event=>{event.preventDefault();S.from=form.elements.from.value;S.to=form.elements.to.value;if(!S.from||!S.to||S.from>S.to){A.toast('Selecciona un intervalo de fechas válido.',true);return;}S.data=null;S.load({force:true});});
    if(!S.data&&!S.loading)S.load();
  };
  A.ui.action('reload-statistics',()=>S.load({force:true}));
})();
