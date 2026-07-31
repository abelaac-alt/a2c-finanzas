(function(){
  'use strict';
  const A=window.A2C;
  const R=A.resources={};

  R.toolTabs=[
    ['statistics','chart','Estadísticas'],
    ['resources','piggy','Huchas'],
    ['goals','target','Objetivos'],
    ['scheduled','calendar','Pendientes'],
    ['budgets','budget','Presupuestos']
  ];

  R.renderTools=()=>`${A.ui.header('Herramientas','Control y planificación','Analiza tus datos y organiza tus finanzas')}
    <div class="tool-tabs">${R.toolTabs.map(([key,icon,label])=>`<button class="tool-tab ${A.state.tool===key?'active':''}" data-action="select-tool" data-tool="${key}">${A.icon(icon,18)}<span>${label}</span></button>`).join('')}</div>
    <section class="tool-content">${A.state.tool==='statistics'?A.statistics.render():A.state.tool==='resources'?R.render():A.state.tool==='goals'?A.goals.render():A.state.tool==='scheduled'?A.scheduled.render():A.budgets.render()}</section>`;
  R.afterTools=()=>{if(A.state.tool==='statistics')A.statistics.afterRender();};

  R.visibleRows=()=>A.state.resources.filter(row=>row.type!=='goal'&&!row.archived_at);
  R.modeLabel=row=>row.type==='piggy'?(row.piggy_mode==='liquidity'?'Liquidez':'Ahorro'):'Carpeta';
  R.modeDescription=row=>row.type==='piggy'?(row.piggy_mode==='liquidity'?'Saldo separado para pagar directamente desde la hucha.':'Dinero reservado que forma parte de tu ahorro.'):'Espacio organizativo';
  R.accountName=id=>id?A.store.resourceById(id)?.name||'Hucha':'Cuenta principal';
  R.owner=row=>A.isResourceOwner(row);
  R.members=id=>A.store.membersForResource(id);
  R.memberAvatars=id=>{
    const members=R.members(id);
    if(members.length<=1)return '';
    return `<span class="resource-members" title="${members.length} participantes">${members.slice(0,3).map(member=>A.avatar(member)).join('')}${members.length>3?`<i>+${members.length-3}</i>`:''}</span>`;
  };

  R.render=()=>{
    const rows=R.visibleRows();
    const saving=A.savingPiggyBalance();
    const liquidity=A.liquidityPiggyBalance();
    return `${A.ui.sectionTitle('Huchas','Dinero separado de tu saldo disponible','<div class="section-actions"><button class="btn small secondary" data-action="new-transfer">'+A.icon('transfer',15)+' Mover dinero</button><button class="btn small primary" data-action="new-resource">'+A.icon('plus',15)+' Crear hucha</button></div>')}
      <div class="piggy-summary">
        <article><span>${A.icon('saving',20)}</span><small>Ahorro en huchas</small><strong>${A.money(saving)}</strong></article>
        <article><span>${A.icon('wallet',20)}</span><small>Liquidez en huchas</small><strong>${A.money(liquidity)}</strong></article>
      </div>
      ${rows.length?`<div class="resource-grid">${rows.map(R.cardMarkup).join('')}</div>`:A.ui.empty('No hay huchas','Crea una hucha de ahorro o liquidez y mueve dinero desde tu cuenta principal.')}`;
  };

  R.cardMarkup=row=>{
    const balance=A.resourceBalance(row.id);
    const members=R.members(row.id);
    const shared=members.length>1||row.is_shared;
    const tone=row.piggy_mode==='liquidity'?'liquidity':'saving';
    return `<button class="resource-card ${tone}" data-action="open-resource" data-id="${row.id}">
      <span class="resource-icon">${A.icon(row.type==='folder'?'folder':'piggy',24)}</span>
      <span class="resource-main"><small>${A.escape(R.modeLabel(row))}${shared?' · Compartida':''}</small><strong>${A.escape(row.name)}</strong><em>${A.escape(row.description||R.modeDescription(row))}</em>${R.memberAvatars(row.id)}</span>
      <span class="resource-balance"><b>${A.money(balance)}</b><small>${balance<0?'Saldo negativo':'Disponible en hucha'}</small></span>
    </button>`;
  };

  R.selectedMemberIds=resource=>new Set(R.members(resource?.id).filter(row=>row.role!=='owner').map(row=>String(row.user_id)));
  R.friendChoices=resource=>{
    const selected=R.selectedMemberIds(resource);
    if(!A.state.friends.length)return '<p class="muted-note">Añade amigos desde Mensajes para compartir esta hucha.</p>';
    return `<div class="member-picker">${A.state.friends.map(friend=>`<label><input type="checkbox" name="member_ids" value="${friend.id}" ${selected.has(String(friend.id))?'checked':''}><span>${A.avatar(friend)}<b>${A.escape(friend.display_name||friend.username)}</b><small>@${A.escape(friend.username||'usuario')}</small></span></label>`).join('')}</div>`;
  };

  R.openForm=resource=>{
    const editing=Boolean(resource?.id);
    const owner=!editing||R.owner(resource);
    if(editing&&!owner){A.toast('Solo el propietario puede modificar esta hucha.',true);return;}
    const type=resource?.type==='folder'?'folder':'piggy';
    const mode=resource?.piggy_mode||'saving';
    A.ui.modal(`<form id="resource-form" class="stack-form">
      <div class="modal-head"><div><h2>${editing?'Editar hucha':'Nueva hucha'}</h2><p>Separa dinero de tu saldo principal y decide si cuenta como ahorro o liquidez.</p></div><button type="button" class="modal-close" data-close>${A.icon('close',21)}</button></div>
      <div class="form-grid two"><div class="field"><label>Tipo de espacio</label><select name="type"><option value="piggy" ${type==='piggy'?'selected':''}>Hucha</option><option value="folder" ${type==='folder'?'selected':''}>Carpeta</option></select></div><div class="field" id="piggy-mode-field"><label>Clasificación</label><select name="piggy_mode"><option value="saving" ${mode==='saving'?'selected':''}>Ahorro</option><option value="liquidity" ${mode==='liquidity'?'selected':''}>Liquidez</option></select></div></div>
      <div class="mode-explanation" id="mode-explanation"></div>
      <div class="field"><label>Nombre</label><input name="name" required maxlength="80" value="${A.escape(resource?.name||'')}"></div>
      <div class="field"><label>Descripción</label><textarea name="description" maxlength="240">${A.escape(resource?.description||'')}</textarea></div>
      <section class="subpanel"><div class="section-title"><div><h3>Usuarios compartidos</h3><p>Los miembros podrán ver la hucha y registrar sus propios movimientos.</p></div></div>${R.friendChoices(resource)}</section>
      <div class="actions">${editing?`<button type="button" class="btn danger" id="delete-resource">${A.icon('trash',16)} Eliminar</button>`:''}<button type="button" class="btn secondary" data-close>Cancelar</button><button class="btn primary">Guardar</button></div>
    </form>`,{wide:true});
    const form=A.modalRoot.querySelector('#resource-form');
    const syncMode=()=>{
      const isPiggy=form.elements.type.value==='piggy';
      A.modalRoot.querySelector('#piggy-mode-field').classList.toggle('hidden',!isPiggy);
      const modeValue=isPiggy?form.elements.piggy_mode.value:'liquidity';
      A.modalRoot.querySelector('#mode-explanation').innerHTML=modeValue==='saving'
        ?`${A.icon('saving',20)}<div><b>Hucha de ahorro</b><small>Las aportaciones reducen el saldo disponible y se muestran como ahorro. Los gastos se pagan únicamente con el saldo de la hucha.</small></div>`
        :`${A.icon('wallet',20)}<div><b>Hucha de liquidez</b><small>El dinero queda fuera del saldo principal y del ahorro. Puedes pagar desde la hucha sin alterar ninguno de los dos.</small></div>`;
    };
    form.elements.type.addEventListener('change',syncMode);
    form.elements.piggy_mode.addEventListener('change',syncMode);
    syncMode();
    form.addEventListener('submit',async event=>{
      event.preventDefault();const button=event.submitter;A.setBusy(button,true);
      try{
        const memberIds=[...form.querySelectorAll('input[name="member_ids"]:checked')].map(input=>input.value);
        const id=await A.rpc('a2c_v82_save_resource',{
          p_resource_id:resource?.id||null,
          p_type:form.elements.type.value,
          p_name:String(form.elements.name.value||'').trim(),
          p_description:String(form.elements.description.value||'').trim(),
          p_piggy_mode:form.elements.type.value==='piggy'?form.elements.piggy_mode.value:'liquidity',
          p_member_ids:memberIds
        });
        await A.store.load({force:true});A.closeModal();A.ui.render({preserveScroll:true});A.toast(editing?'Hucha actualizada.':'Hucha creada.');
        if(!editing&&id)R.openDetail(id);
      }catch(error){A.toast(error.message,true);A.setBusy(button,false);}
    });
    A.modalRoot.querySelector('#delete-resource')?.addEventListener('click',()=>{A.closeModal();R.delete(resource.id);});
  };

  R.delete=id=>A.ui.confirm({
    title:'Eliminar hucha',
    message:'Solo se puede eliminar cuando su saldo sea cero. El historial se conservará archivado.',
    confirmLabel:'Eliminar',danger:true,
    onConfirm:async()=>{await A.rpc('a2c_v82_delete_resource',{p_resource_id:id});await A.store.load({force:true});A.ui.render({preserveScroll:true});A.toast('Hucha eliminada.');}
  });

  R.movementMarkup=(item,resourceId)=>{
    const creator=A.store.profileById(item.creator_id||item.created_by);
    const actor=String(item.creator_id||item.created_by||'')===String(A.state.user?.id)?'Tú':(creator?.display_name||creator?.username||'Usuario');
    if(item.item_type==='transfer'||item.kind==='transfer'){
      const incoming=String(item.target_resource_id||'')===String(resourceId);
      const otherId=incoming?item.source_resource_id:item.target_resource_id;
      const other=otherId?A.store.resourceById(otherId)?.name||'Otra hucha':'Cuenta principal';
      return `<button class="movement-row" data-action="open-transfer" data-id="${item.id}"><span class="movement-icon ${incoming?'positive':'negative'}">${A.icon(incoming?'income':'expense',20)}</span><span class="movement-main"><strong>${A.escape(item.concept||'Movimiento de hucha')}</strong><small>${A.formatDate(item.occurred_on)} · ${incoming?'Desde':'Hacia'} ${A.escape(other)} · ${A.escape(actor)}</small></span><span class="movement-value ${incoming?'income':'expense'}"><b>${incoming?'+':'−'}${A.money(item.amount_cents)}</b><small>${incoming?'Entrada':'Salida'}</small></span></button>`;
    }
    const incoming=['income','saving'].includes(item.kind);
    const meta=A.kindMeta[item.kind]||A.kindMeta.expense;
    return `<button class="movement-row" data-action="open-transaction" data-id="${item.id}"><span class="movement-icon ${incoming?'positive':'negative'}">${A.icon(meta.icon,20)}</span><span class="movement-main"><strong>${A.escape(item.concept||item.merchant||meta.label)}</strong><small>${A.formatDate(item.occurred_on)} · ${A.escape(actor)}</small></span><span class="movement-value ${incoming?'income':'expense'}"><b>${incoming?'+':'−'}${A.money(item.amount_cents)}</b><small>${incoming?(item.kind==='saving'?'Aportación':'Entrada'):'Gasto'}</small></span></button>`;
  };

  R.openDetail=id=>{
    const row=A.store.resourceById(id);if(!row)return;
    const movements=A.resourceTimeline(id);
    const members=R.members(id);
    const owner=R.owner(row);
    const balance=A.resourceBalance(id);
    const tone=row.piggy_mode==='liquidity'?'liquidity':'saving';
    A.ui.modal(`<div class="modal-head"><div><h2>${A.escape(row.name)}</h2><p>${A.escape(R.modeLabel(row))}${members.length>1?` · ${members.length} participantes`:''}</p></div><button class="modal-close" data-close>${A.icon('close',21)}</button></div>
      <section class="resource-hero ${tone}"><span>${A.icon(row.type==='folder'?'folder':'piggy',28)}</span><div><small>Saldo dentro de la hucha</small><strong>${A.money(balance)}</strong><em>${A.escape(R.modeDescription(row))}</em></div></section>
      ${members.length>1?`<div class="resource-member-list">${members.map(member=>`<span>${A.avatar(member)}<b>${A.escape(member.display_name||member.username)}</b><small>${member.role==='owner'?'Propietario':'Miembro'}</small></span>`).join('')}</div>`:''}
      <div class="resource-detail-actions">
        <button class="btn secondary" data-action="resource-deposit" data-id="${id}">${A.icon('income',16)} Meter dinero</button>
        <button class="btn secondary" data-action="resource-withdraw" data-id="${id}">${A.icon('expense',16)} Sacar dinero</button>
        <button class="btn primary" data-action="resource-spend" data-id="${id}">${A.icon('wallet',16)} Pagar desde hucha</button>
        ${owner?`<button class="btn secondary" data-action="edit-resource" data-id="${id}">${A.icon('edit',16)} Editar</button>`:''}
      </div>
      <section class="card nested-card resource-history">${A.ui.sectionTitle('Todos los movimientos','Solo puede editar o borrar cada operación quien la registró')}${movements.length?`<div class="movement-list">${movements.map(item=>R.movementMarkup(item,id)).join('')}</div>`:A.ui.empty('Sin movimientos','Mueve dinero desde la cuenta principal o registra un gasto desde esta hucha.')}</section>`,{wide:true});
  };

  R.accountOptions=(selected,exclude=null)=>{
    const rows=[{id:'',name:'Cuenta principal',balance:A.balance(),main:true},...R.visibleRows().map(row=>({id:row.id,name:row.name,balance:A.resourceBalance(row.id),row}))];
    return rows.filter(item=>String(item.id)!==String(exclude??'__none__')).map(item=>`<option value="${item.id}" ${String(selected??'')===String(item.id)?'selected':''}>${A.escape(item.name)} · ${A.money(item.balance)}</option>`).join('');
  };

  R.openTransferForm=(preset={},transfer=null)=>{
    const editing=Boolean(transfer?.id);
    if(editing&&String(transfer.created_by)!==String(A.state.user.id)){A.toast('Solo puedes editar los movimientos que has registrado.',true);return;}
    const initialSource=editing?(transfer.source_resource_id||''):(preset.source??'');
    const initialTarget=editing?(transfer.target_resource_id||''):(preset.target??'');
    A.ui.modal(`<form id="transfer-form" class="stack-form"><div class="modal-head"><div><h2>${editing?'Editar movimiento':'Mover dinero'}</h2><p>La cuenta principal y las huchas se actualizan automáticamente.</p></div><button type="button" class="modal-close" data-close>${A.icon('close',21)}</button></div>
      <div class="form-grid two"><div class="field"><label>Origen</label><select name="source">${R.accountOptions(initialSource)}</select></div><div class="field"><label>Destino</label><select name="target">${R.accountOptions(initialTarget)}</select></div></div>
      <div class="transfer-impact" id="transfer-impact"></div>
      <div class="field"><label>Importe (€)</label><input name="amount" inputmode="decimal" required value="${editing?(Number(transfer.amount_cents)/100).toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2}):''}"></div>
      <div class="field"><label>Concepto</label><input name="concept" required maxlength="140" value="${A.escape(transfer?.concept||preset.concept||'Movimiento de hucha')}"></div>
      <div class="field"><label>Fecha</label><input name="date" type="date" required value="${A.escape(transfer?.occurred_on||A.today())}"></div>
      <div class="actions">${editing?`<button type="button" class="btn danger" id="delete-transfer">${A.icon('trash',16)} Eliminar</button>`:''}<button type="button" class="btn secondary" data-close>Cancelar</button><button class="btn primary">${editing?'Guardar cambios':'Mover dinero'}</button></div></form>`,{wide:true});
    const form=A.modalRoot.querySelector('#transfer-form');
    const sync=()=>{
      if(form.elements.source.value===form.elements.target.value){
        const other=[...form.elements.target.options].find(option=>option.value!==form.elements.source.value);if(other)form.elements.target.value=other.value;
      }
      const source=A.store.resourceById(form.elements.source.value);
      const target=A.store.resourceById(form.elements.target.value);
      let text='Movimiento interno entre saldos separados.';
      if(!form.elements.source.value&&target?.piggy_mode==='saving')text='Se descontará del saldo disponible y se contabilizará como ahorro.';
      else if(!form.elements.source.value&&target?.piggy_mode==='liquidity')text='Se descontará del saldo disponible y quedará únicamente como liquidez de la hucha.';
      else if(source&&!form.elements.target.value)text='El importe volverá a tu saldo disponible.';
      else if(source?.piggy_mode==='saving'&&target?.piggy_mode!=='saving')text='El importe dejará de formar parte del ahorro.';
      else if(source?.piggy_mode!=='saving'&&target?.piggy_mode==='saving')text='El importe pasará a formar parte del ahorro.';
      A.modalRoot.querySelector('#transfer-impact').innerHTML=`${A.icon('transfer',18)}<span>${A.escape(text)}</span>`;
    };
    form.elements.source.addEventListener('change',sync);form.elements.target.addEventListener('change',sync);sync();
    form.addEventListener('submit',async event=>{
      event.preventDefault();const button=event.submitter;A.setBusy(button,true);
      try{
        const source=form.elements.source.value||null;const target=form.elements.target.value||null;const amount=A.toCents(form.elements.amount.value);
        if(source===target)throw new Error('Selecciona un origen y destino diferentes.');if(amount<=0)throw new Error('Indica un importe válido.');
        const params={p_source_resource_id:source,p_target_resource_id:target,p_amount_cents:amount,p_concept:String(form.elements.concept.value||'').trim(),p_occurred_on:form.elements.date.value};
        if(editing)await A.rpc('a2c_v82_update_transfer',{p_transfer_id:transfer.id,...params});else await A.rpc('a2c_v82_create_transfer',params);
        A.store.clearStatistics();await A.store.load({force:true});A.closeModal();A.ui.render({preserveScroll:true});A.toast(editing?'Movimiento actualizado.':'Dinero movido correctamente.');
      }catch(error){A.toast(error.message,true);A.setBusy(button,false);}
    });
    A.modalRoot.querySelector('#delete-transfer')?.addEventListener('click',()=>{A.closeModal();R.deleteTransfer(transfer);});
  };

  R.deleteTransfer=transfer=>A.ui.confirm({title:'Eliminar movimiento',message:'El saldo de las cuentas y huchas se recalculará automáticamente.',confirmLabel:'Eliminar',danger:true,onConfirm:async()=>{await A.rpc('a2c_v82_delete_transfer',{p_transfer_id:transfer.id});A.store.clearStatistics();await A.store.load({force:true});A.ui.render({preserveScroll:true});A.toast('Movimiento eliminado.');}});

  A.ui.action('select-tool',({data})=>{A.state.tool=data.tool;A.ui.render({preserveScroll:false});});
  A.ui.action('new-resource',()=>R.openForm());
  A.ui.action('open-resource',({data})=>R.openDetail(data.id));
  A.ui.action('edit-resource',({data})=>{const row=A.store.resourceById(data.id);A.closeModal();R.openForm(row);});
  A.ui.action('resource-deposit',({data})=>{A.closeModal();R.openTransferForm({source:'',target:data.id,concept:`Aportación a ${A.store.resourceById(data.id)?.name||'hucha'}`});});
  A.ui.action('resource-withdraw',({data})=>{A.closeModal();R.openTransferForm({source:data.id,target:'',concept:`Retirada de ${A.store.resourceById(data.id)?.name||'hucha'}`});});
  A.ui.action('resource-spend',({data})=>{A.closeModal();A.transactions.openForm(null,{kind:'expense',resourceId:data.id,concept:''});});
  A.ui.action('new-transfer',({data})=>R.openTransferForm({source:data.source??'',target:data.target??''}));
  A.ui.action('edit-transfer',({data})=>{const row=A.store.transferById(data.id);A.closeModal();R.openTransferForm({},row);});
  A.ui.action('delete-transfer',({data})=>{const row=A.store.transferById(data.id);A.closeModal();R.deleteTransfer(row);});
  A.ui.registerPage('tools',R.renderTools,R.afterTools);
})();
