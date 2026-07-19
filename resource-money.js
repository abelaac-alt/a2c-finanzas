import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg=window.A2C_CONFIG||{};
if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY){
  console.error('A2C: falta la configuración de Supabase.');
}else{
  const sb=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });

  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cents=value=>{let t=String(value??'').trim().replace(/\s|€/g,'');if(t.includes(','))t=t.replace(/\./g,'').replace(',','.');const n=Number(t);return Number.isFinite(n)?Math.round(n*100):0};
  const toast=(message,bad=false)=>{const el=document.querySelector('#toast');if(!el)return;el.textContent=message;el.classList.toggle('bad',bad);el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),3400)};
  const closeModal=()=>document.querySelector('#modal')?.remove();

  let resourcesCache=new Map();
  let loadingResources=false;

  async function loadResources(){
    if(loadingResources)return;
    loadingResources=true;
    try{
      const {data,error}=await sb.from('resources').select('id,name,type');
      if(error)throw error;
      resourcesCache=new Map((data||[]).map(r=>[String(r.id),r]));
    }catch(error){
      console.error('A2C recursos:',error);
    }finally{
      loadingResources=false;
    }
  }

  function modalMarkup(resource,direction){
    const incoming=direction==='in';
    return `<form id="resource-money-form" class="resource-money-form">
      <div class="modal-head">
        <div>
          <span class="eyebrow">${incoming?'Transferencia entrante':'Transferencia saliente'}</span>
          <h2>${incoming?'Añadir dinero':'Retirar dinero'}</h2>
          <p class="muted">${incoming
            ?`Cuenta principal → ${esc(resource.name)}`
            :`${esc(resource.name)} → Cuenta principal`}</p>
        </div>
        <button type="button" class="close-btn" data-close>×</button>
      </div>

      <div class="resource-transfer-route">
        <div><span>Origen</span><strong>${incoming?'Cuenta principal':esc(resource.name)}</strong></div>
        <span class="resource-transfer-arrow">→</span>
        <div><span>Destino</span><strong>${incoming?esc(resource.name):'Cuenta principal'}</strong></div>
      </div>

      <div class="field">
        <label>Importe</label>
        <div class="money-input"><input name="amount" inputmode="decimal" required placeholder="0,00"><span>€</span></div>
      </div>
      <div class="field"><label>Concepto</label><input name="concept" maxlength="140" required value="${esc(incoming?`Aportación a ${resource.name}`:`Retirada de ${resource.name}`)}"></div>
      <div class="field"><label>Fecha</label><input name="date" type="date" required value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="field"><label>Notas</label><textarea name="notes" maxlength="500" placeholder="Opcional"></textarea></div>

      <div class="actions">
        <button type="button" class="btn" data-close>Cancelar</button>
        <button class="btn primary">${incoming?'Añadir dinero':'Retirar dinero'}</button>
      </div>
    </form>`;
  }

  function openMoneyModal(resource,direction){
    if(direction==='out'&&resource.type!=='piggy')return toast('Solo las huchas permiten retirar dinero.',true);
    const layer=document.querySelector('#modal');
    if(!layer)return;
    const card=layer.querySelector('.modal-card');
    if(!card)return;
    card.innerHTML=modalMarkup(resource,direction);
    card.querySelectorAll('[data-close]').forEach(b=>b.onclick=closeModal);
    const form=card.querySelector('#resource-money-form');
    form.onsubmit=async event=>{
      event.preventDefault();
      const button=event.submitter,fd=new FormData(form),amount=cents(fd.get('amount'));
      if(amount<=0)return toast('Introduce un importe válido.',true);
      button.disabled=true;button.dataset.label=button.textContent;button.textContent='Procesando…';
      try{
        const {error}=await sb.rpc('a2c_move_money_between_main_and_resource',{
          p_resource_id:resource.id,
          p_direction:direction,
          p_amount_cents:amount,
          p_concept:String(fd.get('concept')||'').trim(),
          p_occurred_on:String(fd.get('date')||''),
          p_notes:String(fd.get('notes')||'').trim()
        });
        if(error)throw error;
        sessionStorage.setItem('a2c-transfer-ok',direction==='in'?'Dinero añadido desde la cuenta principal.':'Dinero retirado a la cuenta principal.');
        location.reload();
      }catch(error){
        console.error('A2C transferencia:',error);
        toast(error?.message||'No se pudo completar el movimiento.',true);
        button.disabled=false;button.textContent=button.dataset.label;
      }
    };
  }

  function createActions(resource){
    const wrap=document.createElement('div');
    wrap.className='resource-inline-actions';
    wrap.innerHTML=`
      <button type="button" class="resource-money-btn primary" data-resource-money="in">
        <span>＋</span><b>Añadir dinero</b><small>Desde cuenta principal</small>
      </button>
      ${resource.type==='piggy'?`
      <button type="button" class="resource-money-btn" data-resource-money="out">
        <span>↩</span><b>Retirar</b><small>A cuenta principal</small>
      </button>`:''}
    `;
    wrap.querySelector('[data-resource-money="in"]').onclick=event=>{
      event.preventDefault();event.stopPropagation();
      const menuButton=event.currentTarget.closest('.card')?.querySelector('[data-resource]');
      menuButton?.click();
      requestAnimationFrame(()=>openMoneyModal(resource,'in'));
    };
    wrap.querySelector('[data-resource-money="out"]')?.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();
      const menuButton=event.currentTarget.closest('.card')?.querySelector('[data-resource]');
      menuButton?.click();
      requestAnimationFrame(()=>openMoneyModal(resource,'out'));
    });
    return wrap;
  }

  async function integrateButtons(){
    const buttons=[...document.querySelectorAll('.card [data-resource]')];
    if(!buttons.length)return;
    if(!resourcesCache.size)await loadResources();

    for(const menuButton of buttons){
      const card=menuButton.closest('.card');
      if(!card||card.querySelector('.resource-inline-actions'))continue;
      const resource=resourcesCache.get(String(menuButton.dataset.resource));
      if(!resource)continue;
      card.appendChild(createActions(resource));
    }
  }

  /*
   * Cualquier ingreso o ahorro nuevo asignado a hucha, carpeta u objetivo
   * se convierte en transferencia desde la cuenta principal.
   */
  document.addEventListener('submit',async event=>{
    const form=event.target;
    if(!(form instanceof HTMLFormElement)||form.id!=='tx-form')return;
    if(form.querySelector('#delete-tx'))return;

    const kind=String(form.elements.kind?.value||'');
    if(!['income','saving'].includes(kind))return;

    const goalId=String(form.elements.saving_goal_id?.value||'');
    const rawId=String(form.elements.resource_id?.value||'');
    const resourceId=kind==='saving'&&goalId?goalId:rawId;
    if(!resourceId||resourceId.startsWith('crypto:'))return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const amount=cents(form.elements.amount?.value);
    if(amount<=0)return toast('Introduce un importe válido.',true);

    const button=event.submitter;
    if(button){button.disabled=true;button.dataset.label=button.textContent;button.textContent='Procesando…'}

    try{
      if(!resourcesCache.size)await loadResources();
      const resource=resourcesCache.get(String(resourceId));
      if(!resource)throw new Error('No se encontró el destino.');

      const {error}=await sb.rpc('a2c_move_money_between_main_and_resource',{
        p_resource_id:resourceId,
        p_direction:'in',
        p_amount_cents:amount,
        p_concept:String(form.elements.concept?.value||`Aportación a ${resource.name}`).trim(),
        p_occurred_on:String(form.elements.date?.value||new Date().toISOString().slice(0,10)),
        p_notes:String(form.elements.notes?.value||'').trim()
      });
      if(error)throw error;
      sessionStorage.setItem('a2c-transfer-ok','Ingreso realizado desde la cuenta principal.');
      location.reload();
    }catch(error){
      console.error('A2C transferencia:',error);
      toast(error?.message||'No se pudo completar el ingreso.',true);
      if(button){button.disabled=false;button.textContent=button.dataset.label||'Guardar'}
    }
  },true);

  const observer=new MutationObserver(()=>integrateButtons());
  observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('load',integrateButtons);
  setTimeout(integrateButtons,300);
  setTimeout(integrateButtons,1000);

  const message=sessionStorage.getItem('a2c-transfer-ok');
  if(message){
    sessionStorage.removeItem('a2c-transfer-ok');
    setTimeout(()=>toast(message),650);
  }
}
