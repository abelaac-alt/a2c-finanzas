(function(){
  'use strict';
  const A=window.A2C;
  const T=A.transactions={};

  T.rowMarkup=item=>{
    if(item.item_type==='transfer'||item.kind==='transfer'){
      const source=item.source?.name||A.store.resourceById(item.source_resource_id)?.name||'Origen';
      const target=item.target?.name||A.store.resourceById(item.target_resource_id)?.name||'Destino';
      return `<button class="movement-row" data-action="open-transfer" data-id="${item.id}"><span class="movement-icon neutral">${A.icon('transfer',20)}</span><span class="movement-main"><strong>${A.escape(item.concept||'Traspaso entre huchas')}</strong><small>${A.formatDate(item.occurred_on)} · ${A.escape(source)} → ${A.escape(target)}</small></span><span class="movement-value"><b>${A.money(item.amount_cents)}</b><small>Traspaso</small></span></button>`;
    }
    const meta=A.kindMeta[item.kind]||A.kindMeta.expense;const shares=A.store.activeSharesForTransaction(item.id);
    const pending=shares.filter(row=>row.status==='pending').reduce((sum,row)=>sum+Number(row.amount_cents||0),0);
    return `<button class="movement-row" data-action="open-transaction" data-id="${item.id}"><span class="movement-icon ${meta.tone}">${A.icon(meta.icon,20)}</span><span class="movement-main"><strong>${A.escape(item.concept||item.merchant||meta.label)}</strong><small>${A.formatDate(item.occurred_on)} · ${A.escape(A.store.resourceById(item.resource_id)?.name||'Cuenta principal')}</small>${shares.length?`<em>${pending?`Compartido · ${A.money(pending)} pendiente`:'Compartido · liquidado'}</em>`:''}</span><span class="movement-value ${item.kind}"><b>${item.kind==='income'?'+':'−'}${A.money(item.amount_cents)}</b><small>${meta.label}</small></span></button>`;
  };

  T.filteredRows=()=>{const query=A.state.filters.query.trim().toLowerCase();const kind=A.state.filters.kind;return A.timeline().filter(row=>(!kind||row.kind===kind)&&(!query||String(row.concept||row.merchant||row.source?.name||row.target?.name||'').toLowerCase().includes(query)));};
  T.listMarkup=()=>{const rows=T.filteredRows();return rows.length?rows.map(T.rowMarkup).join(''):A.ui.empty('No hay resultados','Prueba con otro concepto o tipo de movimiento.');};
  T.render=()=>`${A.ui.header('Actividad','Movimientos','Consulta y edita toda tu actividad','<button class="btn primary" data-action="new-transaction">'+A.icon('plus',17)+' Nuevo</button>')}
    <section class="filter-card"><label class="search-field">${A.icon('search',18)}<input id="transaction-search" value="${A.escape(A.state.filters.query)}" placeholder="Buscar por concepto"></label><select id="transaction-kind"><option value="">Todos los tipos</option>${Object.entries(A.kindMeta).map(([key,item])=>`<option value="${key}" ${A.state.filters.kind===key?'selected':''}>${item.label}</option>`).join('')}</select></section>
    <section class="card activity-card"><div class="movement-list" id="activity-list">${T.listMarkup()}</div></section>`;
  T.afterRender=()=>{
    const search=document.querySelector('#transaction-search');const kind=document.querySelector('#transaction-kind');
    const update=()=>{const list=document.querySelector('#activity-list');if(list)list.innerHTML=T.listMarkup();};
    search?.addEventListener('input',A.debounce(event=>{A.state.filters.query=event.target.value;update();},160));
    kind?.addEventListener('change',event=>{A.state.filters.kind=event.target.value;update();});
  };

  T.openForm=(transaction=null,preset={})=>{
    const editing=Boolean(transaction?.id);const tx=transaction||{};const activeShares=editing?A.store.activeSharesForTransaction(tx.id):[];
    const selectedKind=preset.kind||tx.kind||'expense';const isFuel=Boolean(preset.fuel||tx.fuel_liters);
    A.ui.modal(`<form id="transaction-form" class="stack-form">
      <div class="modal-head"><div><h2>${editing?'Editar movimiento':'Nuevo movimiento'}</h2><p>${editing?'Actualiza los datos del movimiento.':'Registra un gasto, ingreso, ahorro o inversión.'}</p></div><button type="button" class="modal-close" data-close>${A.icon('close',21)}</button></div>
      <div class="form-grid two"><div class="field"><label>Tipo</label><select name="kind">${Object.entries(A.kindMeta).filter(([key])=>key!=='transfer').map(([key,item])=>`<option value="${key}" ${selectedKind===key?'selected':''}>${item.label}</option>`).join('')}</select></div><div class="field"><label>Fecha</label><input name="date" type="date" required value="${A.escape(tx.occurred_on||A.today())}"></div></div>
      <div class="field"><label>Concepto</label><input name="concept" maxlength="140" required value="${A.escape(preset.concept||tx.concept||tx.merchant||'')}" placeholder="Ej. Supermercado, nómina o combustible"></div>
      <div class="form-grid two"><div class="field"><label>Importe (€)</label><input name="amount" inputmode="decimal" required value="${tx.amount_cents?(Number(tx.amount_cents)/100).toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2}):''}"></div><div class="field"><label>Cuenta o hucha</label><select name="resource"><option value="">Cuenta principal</option>${A.state.resources.map(resource=>`<option value="${resource.id}" ${String(preset.resourceId||tx.resource_id||'')===String(resource.id)?'selected':''}>${A.escape(resource.name)}</option>`).join('')}</select></div></div>
      <div class="field"><label>Método</label><select name="payment_method"><option value="bank">Banco / tarjeta</option><option value="cash" ${tx.payment_method==='cash'?'selected':''}>Efectivo</option><option value="crypto" ${tx.payment_method==='crypto'?'selected':''}>Cripto</option></select></div>
      <label class="option-card" id="fuel-toggle-row"><input type="checkbox" name="fuel_enabled" ${isFuel?'checked':''}><span class="option-icon">${A.icon('fuel',21)}</span><span><b>Registrar como combustible</b><small>Guarda litros, precio por litro, kilómetros y consumo.</small></span></label>
      <section id="fuel-fields" class="subpanel ${isFuel?'':'hidden'}"><div class="form-grid two"><div class="field"><label>Precio por litro (€)</label><input name="fuel_price" inputmode="decimal" value="${tx.fuel_price_per_liter_milli?Number(tx.fuel_price_per_liter_milli)/1000:''}"></div><div class="field"><label>Litros</label><input name="fuel_liters" inputmode="decimal" value="${tx.fuel_liters||''}"></div></div><div class="field"><label>Kilómetros desde el último repostaje</label><input name="fuel_km" inputmode="decimal" value="${tx.fuel_km||''}" placeholder="Opcional"></div><div class="info-strip" id="fuel-preview">Completa precio y litros para calcular el total.</div></section>
      ${activeShares.length?`<section class="subpanel">${A.ui.sectionTitle('Gasto compartido','El reparto se gestiona desde el detalle')}<span class="status-pill">${activeShares.length} participante${activeShares.length===1?'':'s'}</span></section>`:`<label class="option-card ${selectedKind==='expense'?'':'hidden'}" id="share-toggle-row"><input type="checkbox" name="share_enabled"><span class="option-icon">${A.icon('transfer',21)}</span><span><b>Dividir este gasto</b><small>Asigna importes a amigos o personas externas.</small></span></label><section id="share-fields" class="subpanel hidden"><div class="section-title"><div><h3>Participantes</h3><p>Tu parte será la diferencia restante.</p></div><button type="button" class="btn small secondary" id="add-participant">${A.icon('plus',15)} Añadir</button></div><div id="participant-list"></div><div class="info-strip" id="share-summary">Añade al menos una persona.</div></section>`}
      <div class="field"><label>Notas</label><textarea name="notes" maxlength="800">${A.escape(tx.notes||'')}</textarea></div>
      <div class="field"><label>Justificante</label><input name="receipt" type="file" accept="image/*,application/pdf"><small>Opcional. Imagen o PDF.</small></div>
      <div class="actions">${editing?'<button type="button" class="btn danger" id="delete-transaction">'+A.icon('trash',16)+' Eliminar</button>':''}<button type="button" class="btn secondary" data-close>Cancelar</button><button type="submit" class="btn primary">${editing?'Guardar cambios':'Registrar movimiento'}</button></div>
    </form>`,{wide:true});
    const form=A.modalRoot.querySelector('#transaction-form');const kind=form.elements.kind;const amount=form.elements.amount;const fuelToggle=form.elements.fuel_enabled;
    const fuelFields=A.modalRoot.querySelector('#fuel-fields');const preview=A.modalRoot.querySelector('#fuel-preview');const shareToggle=form.elements.share_enabled;const shareFields=A.modalRoot.querySelector('#share-fields');const participantList=A.modalRoot.querySelector('#participant-list');
    const syncKind=()=>{const expense=kind.value==='expense';A.modalRoot.querySelector('#fuel-toggle-row').classList.toggle('hidden',!expense);A.modalRoot.querySelector('#share-toggle-row')?.classList.toggle('hidden',!expense);if(!expense){fuelToggle.checked=false;fuelFields.classList.add('hidden');if(shareToggle){shareToggle.checked=false;shareFields.classList.add('hidden');}}};
    const syncFuel=()=>{fuelFields.classList.toggle('hidden',!fuelToggle.checked);T.updateFuelCalculation(form,preview);};
    kind.addEventListener('change',syncKind);fuelToggle.addEventListener('change',syncFuel);
    ['fuel_price','fuel_liters','fuel_km'].forEach(name=>form.elements[name]?.addEventListener('input',()=>T.updateFuelCalculation(form,preview)));
    amount.addEventListener('input',()=>T.updateShareSummary(form));
    shareToggle?.addEventListener('change',()=>{shareFields.classList.toggle('hidden',!shareToggle.checked);if(shareToggle.checked&&!participantList.children.length)T.addParticipantRow(participantList,form);T.updateShareSummary(form);});
    A.modalRoot.querySelector('#add-participant')?.addEventListener('click',()=>T.addParticipantRow(participantList,form));
    form.addEventListener('submit',event=>T.save(event,tx,activeShares));
    A.modalRoot.querySelector('#delete-transaction')?.addEventListener('click',()=>T.delete(tx));
    syncKind();syncFuel();
  };

  T.updateFuelCalculation=(form,preview)=>{
    if(!form.elements.fuel_enabled.checked)return;
    const price=A.parseNumber(form.elements.fuel_price.value);const liters=A.parseNumber(form.elements.fuel_liters.value);const km=A.parseNumber(form.elements.fuel_km.value);
    if(price>0&&liters>0){const total=price*liters;form.elements.amount.value=total.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2});preview.innerHTML=`<b>${A.number(liters,2)} L × ${A.number(price,3)} €/L = ${A.money(Math.round(total*100))}</b>${km>0?`<span>Consumo estimado: ${A.number(liters/km*100,2)} L/100 km</span>`:''}`;}
    else preview.textContent='Completa precio y litros para calcular el total.';
  };

  T.friendOptions=()=>`<option value="">Persona externa</option>${A.state.friends.map(friend=>`<option value="${friend.id}">${A.escape(friend.display_name||friend.username)} · @${A.escape(friend.username||'usuario')}</option>`).join('')}`;
  T.addParticipantRow=(container,form)=>{
    container.insertAdjacentHTML('beforeend',`<div class="participant-row"><select class="participant-select">${T.friendOptions()}</select><input class="participant-name" placeholder="Nombre de persona externa"><input class="participant-amount" inputmode="decimal" placeholder="Importe"><button type="button" class="remove-participant" aria-label="Eliminar">${A.icon('close',18)}</button></div>`);
    const row=container.lastElementChild;const select=row.querySelector('.participant-select');const name=row.querySelector('.participant-name');
    const sync=()=>{const friend=Boolean(select.value);name.disabled=friend;if(friend)name.value='';name.placeholder=friend?'Amigo seleccionado':'Nombre de persona externa';T.updateShareSummary(form);};
    select.addEventListener('change',sync);name.addEventListener('input',()=>T.updateShareSummary(form));row.querySelector('.participant-amount').addEventListener('input',()=>T.updateShareSummary(form));row.querySelector('.remove-participant').addEventListener('click',()=>{row.remove();T.updateShareSummary(form);});sync();
  };
  T.participantPayload=()=>[...A.modalRoot.querySelectorAll('.participant-row')].map(row=>{const userId=row.querySelector('.participant-select').value;return {user_id:userId||null,name:userId?null:String(row.querySelector('.participant-name').value||'').trim()||null,amount_cents:A.toCents(row.querySelector('.participant-amount').value)};}).filter(row=>row.amount_cents>0);
  T.updateShareSummary=form=>{const summary=A.modalRoot.querySelector('#share-summary');if(!summary)return;const rows=T.participantPayload();const assigned=rows.reduce((sum,row)=>sum+row.amount_cents,0);const total=A.toCents(form.elements.amount.value);const remaining=total-assigned;summary.innerHTML=rows.length?`<b>Asignado: ${A.money(assigned)}</b><span>Tu parte: ${A.money(Math.max(0,remaining))}</span>`:'Añade al menos una persona.';summary.classList.toggle('error',remaining<0);};

  T.save=async(event,tx,activeShares)=>{
    event.preventDefault();const form=event.currentTarget;if(form.dataset.saving==='1')return;form.dataset.saving='1';const button=event.submitter||form.querySelector('[type="submit"]');A.setBusy(button,true);
    try{
      const kind=form.elements.kind.value;const amountCents=A.toCents(form.elements.amount.value);const concept=String(form.elements.concept.value||'').trim();
      if(!concept||amountCents<=0)throw new Error('Indica un concepto y un importe válidos.');
      const fuelEnabled=kind==='expense'&&form.elements.fuel_enabled.checked;const fuelPrice=A.parseNumber(form.elements.fuel_price.value);const fuelLiters=A.parseNumber(form.elements.fuel_liters.value);const fuelKm=A.parseNumber(form.elements.fuel_km.value);
      if(fuelEnabled&&(!(fuelPrice>0)||!(fuelLiters>0)))throw new Error('Indica el precio por litro y los litros repostados.');
      const payload={creator_id:A.state.user.id,kind,resource_id:form.elements.resource.value||null,category_id:null,merchant:'',payment_method:form.elements.payment_method.value,amount_cents:amountCents,concept,occurred_on:form.elements.date.value,notes:String(form.elements.notes.value||''),budget_category:kind==='expense'?A.classify(concept):null,fuel_liters:fuelEnabled?fuelLiters:null,fuel_price_per_liter_milli:fuelEnabled?Math.round(fuelPrice*1000):null,fuel_km:fuelEnabled&&fuelKm>0?fuelKm:null,fuel_consumption_l100km:fuelEnabled&&fuelKm>0?Number((fuelLiters/fuelKm*100).toFixed(2)):null};
      let id=tx.id;
      if(id){const result=await A.sb.from('finance_transactions').update(payload).eq('id',id).eq('creator_id',A.state.user.id).select('id').single();if(result.error)throw result.error;}
      else{const result=await A.sb.from('finance_transactions').insert(payload).select('id').single();if(result.error)throw result.error;id=result.data.id;}
      const receipt=form.elements.receipt.files?.[0];
      if(receipt){const path=`${A.state.user.id}/${id}/${Date.now()}-${receipt.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;const upload=await A.sb.storage.from('receipts').upload(path,receipt,{upsert:true});if(upload.error)throw upload.error;const update=await A.sb.from('finance_transactions').update({receipt_path:path}).eq('id',id);if(update.error)throw update.error;}
      if(kind==='expense'&&form.elements.share_enabled?.checked&&!activeShares.length){const participants=T.participantPayload();if(!participants.length)throw new Error('Añade al menos un participante.');if(participants.some(row=>!row.user_id&&!row.name))throw new Error('Indica el nombre de las personas externas.');if(participants.reduce((sum,row)=>sum+row.amount_cents,0)>amountCents)throw new Error('Los importes compartidos superan el gasto.');await A.rpc('a2c_v7_create_shared_expenses',{p_transaction_id:id,p_participants:participants});}
      A.store.clearStatistics();await A.store.load({force:true});await A.messages.load({force:true});A.closeModal();A.ui.render({preserveScroll:true});A.toast(tx.id?'Movimiento actualizado.':fuelEnabled?'Repostaje guardado.':'Movimiento registrado.');
    }catch(error){A.toast(error.message||'No se pudo guardar.',true);A.setBusy(button,false);form.dataset.saving='0';}
  };

  T.delete=tx=>A.ui.confirm({title:'Eliminar movimiento',message:'Se eliminará el movimiento y los repartos pendientes asociados.',confirmLabel:'Eliminar',danger:true,onConfirm:async()=>{const shares=A.store.activeSharesForTransaction(tx.id);if(shares.some(row=>['paid','settled'].includes(row.status)))throw new Error('No se puede borrar un gasto con partes ya liquidadas.');const result=await A.sb.from('finance_transactions').delete().eq('id',tx.id).eq('creator_id',A.state.user.id);if(result.error)throw result.error;A.store.clearStatistics();await A.store.load({force:true});A.ui.render({preserveScroll:true});A.toast('Movimiento eliminado.');}});

  T.openDetail=id=>{
    const tx=A.store.transactionById(id);if(!tx)return;const meta=A.kindMeta[tx.kind]||A.kindMeta.expense;const shares=A.state.shares.filter(row=>String(row.transaction_id)===String(id));
    A.ui.modal(`<div class="modal-head"><div><h2>${A.escape(tx.concept||meta.label)}</h2><p>${A.formatDate(tx.occurred_on)} · ${A.escape(A.store.resourceById(tx.resource_id)?.name||'Cuenta principal')}</p></div><button class="modal-close" data-close>${A.icon('close',21)}</button></div>
      <div class="detail-amount"><span class="movement-icon ${meta.tone}">${A.icon(meta.icon,23)}</span><div><small>${meta.label}</small><strong>${A.money(tx.amount_cents)}</strong></div></div>
      ${tx.fuel_liters?`<div class="detail-grid"><div><small>Litros</small><b>${A.number(tx.fuel_liters,2)} L</b></div><div><small>Precio/L</small><b>${A.number(Number(tx.fuel_price_per_liter_milli)/1000,3)} €</b></div><div><small>Consumo</small><b>${tx.fuel_consumption_l100km?`${A.number(tx.fuel_consumption_l100km,2)} L/100 km`:'—'}</b></div></div>`:''}
      ${tx.notes?`<div class="detail-note">${A.escape(tx.notes)}</div>`:''}${shares.length?T.sharedPanel(shares):''}
      <div class="actions"><button class="btn danger" data-action="delete-transaction" data-id="${tx.id}">${A.icon('trash',16)} Eliminar</button><button class="btn secondary" data-close>Cerrar</button><button class="btn primary" data-action="edit-transaction" data-id="${tx.id}">${A.icon('edit',16)} Editar</button></div>`,{wide:true});
  };
  T.openTransfer=id=>{const row=A.store.transferById(id);if(!row)return;A.ui.modal(`<div class="modal-head"><div><h2>${A.escape(row.concept||'Traspaso entre huchas')}</h2><p>${A.formatDate(row.occurred_on)}</p></div><button class="modal-close" data-close>${A.icon('close',21)}</button></div><div class="detail-amount"><span class="movement-icon neutral">${A.icon('transfer',23)}</span><div><small>Traspaso interno</small><strong>${A.money(row.amount_cents)}</strong></div></div><div class="transfer-route"><div><small>Origen</small><b>${A.escape(row.source?.name||A.store.resourceById(row.source_resource_id)?.name||'—')}</b></div>${A.icon('chevron',22)}<div><small>Destino</small><b>${A.escape(row.target?.name||A.store.resourceById(row.target_resource_id)?.name||'—')}</b></div></div><div class="actions"><button class="btn danger" data-action="delete-transfer" data-id="${row.id}">${A.icon('trash',16)} Eliminar</button><button class="btn secondary" data-close>Cerrar</button></div>`);};
  T.sharedPanel=shares=>`<section class="shared-panel"><div class="section-title"><div><h3>Gasto compartido</h3><p>Personas, estados e importes</p></div></div>${shares.map(share=>{const person=share.participant?.display_name||share.participant?.username||share.participant_name||'Persona';const status={pending:'Pendiente',paid:'Pagado',settled:'Liquidado',cancelled:'Cancelado',superseded:'Versión anterior'}[share.status]||share.status;return `<div class="shared-person ${['cancelled','superseded'].includes(share.status)?'inactive':''}"><div><strong>${A.escape(person)}</strong><small>Versión ${share.version} · ${status}</small></div><b>${A.money(share.amount_cents)}</b>${share.status==='pending'?`<div class="shared-actions"><button class="btn tiny secondary" data-action="edit-share" data-id="${share.id}">Editar</button><button class="btn tiny primary" data-action="settle-share" data-id="${share.id}">Liquidar</button><button class="btn tiny danger" data-action="cancel-share" data-id="${share.id}">Cancelar</button></div>`:''}</div>`;}).join('')}</section>`;

  T.editShare=id=>{const share=A.store.currentShare(id);if(!share)return;A.ui.modal(`<form id="share-edit-form"><div class="modal-head"><div><h2>Editar parte</h2><p>La versión anterior quedará bloqueada.</p></div><button type="button" class="modal-close" data-close>${A.icon('close',21)}</button></div><div class="field"><label>Nuevo importe (€)</label><input name="amount" inputmode="decimal" required value="${Number(share.amount_cents)/100}"></div><div class="actions"><button type="button" class="btn secondary" data-close>Cancelar</button><button class="btn primary">Actualizar</button></div></form>`);A.modalRoot.querySelector('#share-edit-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.submitter;A.setBusy(button,true);try{await A.rpc('a2c_v7_update_shared_expense',{p_share_id:id,p_amount_cents:A.toCents(event.currentTarget.elements.amount.value)});await A.store.load({force:true});await A.messages.load({force:true});A.closeModal();A.ui.render({preserveScroll:true});A.toast('Reparto actualizado.');}catch(error){A.toast(error.message,true);A.setBusy(button,false);}});};
  T.settleShare=id=>A.ui.confirm({title:'Liquidar manualmente',message:'Aumentará tu saldo sin descontar dinero al otro usuario.',confirmLabel:'Liquidar',onConfirm:async()=>{await A.rpc('a2c_v7_settle_shared_expense',{p_share_id:id});await A.store.load({force:true});await A.messages.load({force:true});A.ui.render({preserveScroll:true});A.toast('Parte liquidada.');}});
  T.cancelShare=id=>A.ui.confirm({title:'Cancelar reparto',message:'La deuda dejará de estar activa.',confirmLabel:'Cancelar reparto',danger:true,onConfirm:async()=>{await A.rpc('a2c_v7_cancel_shared_expense',{p_share_id:id});await A.store.load({force:true});await A.messages.load({force:true});A.ui.render({preserveScroll:true});A.toast('Reparto cancelado.');}});

  A.ui.action('open-transaction',({data})=>T.openDetail(data.id));
  A.ui.action('open-transfer',({data})=>T.openTransfer(data.id));
  A.ui.action('edit-transaction',({data})=>{const tx=A.store.transactionById(data.id);A.closeModal();T.openForm(tx);});
  A.ui.action('delete-transaction',({data})=>{const tx=A.store.transactionById(data.id);A.closeModal();T.delete(tx);});
  A.ui.action('delete-transfer',({data})=>A.ui.confirm({title:'Eliminar traspaso',message:'Se revertirá el movimiento entre las dos huchas.',confirmLabel:'Eliminar',danger:true,onConfirm:async()=>{const result=await A.sb.from('a2c_resource_transfers_v8').delete().eq('id',data.id).eq('owner_id',A.state.user.id);if(result.error)throw result.error;await A.store.load({force:true});A.ui.render({preserveScroll:true});}}));
  A.ui.action('edit-share',({data})=>T.editShare(data.id));A.ui.action('settle-share',({data})=>T.settleShare(data.id));A.ui.action('cancel-share',({data})=>T.cancelShare(data.id));
  A.ui.registerPage('activity',T.render,T.afterRender);
})();
