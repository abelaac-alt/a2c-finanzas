import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg=window.A2C_CONFIG||{};
if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY){
  console.error('A2C privacidad: falta la configuración de Supabase.');
}else{
  const sb=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });

  let friends=[];
  let friendsLoaded=false;
  let currentResourceType=null;
  let currentResourceId=null;
  let resourceCache=new Map();

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const initials=p=>String(p?.display_name||p?.username||'U').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase();
  const toast=(message,bad=false)=>{
    const el=document.querySelector('#toast');
    if(!el)return;
    el.textContent=message;
    el.classList.toggle('bad',bad);
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer=setTimeout(()=>el.classList.remove('show'),3500);
  };
  const busy=(button,on)=>{
    if(!button)return;
    button.disabled=on;
    button.dataset.label??=button.textContent;
    button.textContent=on?'Procesando…':button.dataset.label;
  };

  async function loadFriends(force=false){
    if(friendsLoaded&&!force)return friends;
    const {data,error}=await sb.rpc('a2c_my_accepted_friends');
    if(error)throw error;
    friends=data||[];
    friendsLoaded=true;
    return friends;
  }

  async function loadResources(){
    const {data,error}=await sb.from('resources').select('id,type,name');
    if(error)throw error;
    resourceCache=new Map((data||[]).map(r=>[String(r.id),r]));
  }

  function friendStatus(userId){
    return friends.find(f=>String(f.friend_id)===String(userId));
  }

  function openPrivateSearch(){
    document.querySelector('#a2c-private-search')?.remove();
    const layer=document.createElement('div');
    layer.id='a2c-private-search';
    layer.className='a2c-private-layer';
    layer.innerHTML=`<section class="a2c-private-card" role="dialog" aria-modal="true" aria-labelledby="private-search-title">
      <div class="modal-head">
        <div>
          <span class="eyebrow">Privacidad</span>
          <h2 id="private-search-title">Buscar personas</h2>
          <p class="muted">Escribe al menos 3 caracteres. No se muestra ningún listado automático.</p>
        </div>
        <button type="button" class="close-btn" data-private-close>×</button>
      </div>
      <form id="private-people-form" class="private-search-form">
        <div class="field">
          <label>Nombre o @usuario</label>
          <div class="private-search-input">
            <input name="query" autocomplete="off" autocapitalize="none" spellcheck="false" minlength="3" required placeholder="@usuario o nombre">
            <button class="btn primary">Buscar</button>
          </div>
        </div>
      </form>
      <div id="private-people-results" class="private-people-results">
        <div class="private-search-empty">Los usuarios aparecerán únicamente después de realizar una búsqueda.</div>
      </div>
    </section>`;
    document.body.appendChild(layer);
    layer.querySelector('[data-private-close]').onclick=()=>layer.remove();
    layer.onclick=e=>{if(e.target===layer)layer.remove()};

    const form=layer.querySelector('#private-people-form');
    const results=layer.querySelector('#private-people-results');
    form.onsubmit=async e=>{
      e.preventDefault();
      const button=e.submitter;
      const query=String(new FormData(form).get('query')||'').trim();
      if(query.replace(/^@/,'').length<3)return toast('Escribe al menos 3 caracteres.',true);
      busy(button,true);
      results.innerHTML='<div class="private-search-empty">Buscando…</div>';
      try{
        await loadFriends();
        const {data,error}=await sb.rpc('a2c_search_people_private',{p_query:query});
        if(error)throw error;
        drawPeopleResults(results,data||[]);
      }catch(error){
        console.error(error);
        results.innerHTML='<div class="private-search-empty">No se pudo realizar la búsqueda.</div>';
        toast(error.message||'No se pudo buscar.',true);
      }finally{busy(button,false)}
    };
    setTimeout(()=>form.elements.query.focus(),50);
  }

  function drawPeopleResults(box,rows){
    if(!rows.length){
      box.innerHTML='<div class="private-search-empty">No se han encontrado coincidencias.</div>';
      return;
    }
    box.innerHTML=rows.map(p=>{
      const accepted=friendStatus(p.id);
      return `<article class="private-person-card">
        <span class="private-avatar">${esc(initials(p))}</span>
        <div class="private-person-copy">
          <strong>${esc(p.display_name||'Usuario')}</strong>
          <small>@${esc(p.username||'sin_usuario')}</small>
        </div>
        ${accepted
          ?'<span class="private-friend-status">Amigo</span>'
          :`<button type="button" class="btn" data-private-add-friend="${p.id}">Añadir amigo</button>`}
      </article>`;
    }).join('');

    box.querySelectorAll('[data-private-add-friend]').forEach(button=>{
      button.onclick=async()=>{
        busy(button,true);
        try{
          const {data:{user}}=await sb.auth.getUser();
          if(!user)throw new Error('Debes iniciar sesión.');
          const {error}=await sb.from('friendships').insert({
            requester_id:user.id,
            addressee_id:button.dataset.privateAddFriend,
            status:'pending'
          });
          if(error){
            if(/duplicate|unique|already/i.test(error.message||''))throw new Error('Ya existe una solicitud o amistad con esta persona.');
            throw error;
          }
          button.outerHTML='<span class="private-friend-status pending">Solicitud enviada</span>';
          toast('Solicitud de amistad enviada.');
        }catch(error){
          toast(error.message||'No se pudo enviar la solicitud.',true);
          busy(button,false);
        }
      };
    });
  }

  function friendsSelectorMarkup(selected=[]){
    if(!friends.length){
      return `<div class="friend-selector-empty">Todavía no tienes amigos aceptados. Añádelos desde la red social.</div>`;
    }
    return `<div class="friend-selector-list">${friends.map(f=>`
      <label class="friend-selector-item">
        <input type="checkbox" name="a2c_friend" value="${f.friend_id}" ${selected.includes(String(f.friend_id))?'checked':''}>
        <span class="private-avatar">${esc(initials(f))}</span>
        <span><strong>${esc(f.display_name||'Usuario')}</strong><small>@${esc(f.username||'usuario')}</small></span>
        <i>✓</i>
      </label>`).join('')}</div>`;
  }

  async function enhanceResourceForm(){
    const form=document.querySelector('#resource-form');
    if(!form||form.dataset.friendsEnhanced)return;
    form.dataset.friendsEnhanced='1';
    try{
      await loadFriends();
      const actions=form.querySelector('.actions');
      if(!actions)return;
      const block=document.createElement('div');
      block.className='resource-friends-field';
      block.innerHTML=`<div class="field">
        <label>Compartir con amigos</label>
        <p class="muted">Selecciona únicamente personas de tu lista de amigos.</p>
        ${friendsSelectorMarkup()}
      </div>`;
      actions.before(block);
    }catch(error){
      console.error('No se pudo cargar la lista de amigos.',error);
    }
  }

  function selectedFriendIds(form){
    return [...form.querySelectorAll('input[name="a2c_friend"]:checked')].map(x=>x.value);
  }

  async function saveResourceWithFriends(form,event){
    const friendIds=selectedFriendIds(form);
    if(!friendIds.length)return false;

    event.preventDefault();
    event.stopImmediatePropagation();

    const button=event.submitter;
    busy(button,true);
    try{
      const fd=new FormData(form);
      const heading=String(form.querySelector('h2')?.textContent||'').toLowerCase();
      let type=currentResourceType;
      if(!type){
        if(heading.includes('hucha'))type='piggy';
        else if(heading.includes('carpeta'))type='folder';
        else if(heading.includes('objetivo'))type='goal';
      }
      if(!type)throw new Error('No se pudo identificar el tipo de elemento.');

      const payload={
        name:String(fd.get('name')||'').trim(),
        description:String(fd.get('description')||''),
        is_shared:true
      };
      if(type==='goal'){
        let target=String(fd.get('target')||'').trim().replace(/\s|€/g,'');
        if(target.includes(','))target=target.replace(/\./g,'').replace(',','.');
        payload.target_cents=Math.round(Number(target)*100);
        payload.target_date=fd.get('target_date')||null;
      }
      if(!payload.name)throw new Error('Escribe un nombre.');

      let resourceId=currentResourceId;
      if(resourceId){
        const {error}=await sb.from('resources').update(payload).eq('id',resourceId);
        if(error)throw error;
      }else{
        const {data,error}=await sb.from('resources').insert({...payload,type}).select('id').single();
        if(error)throw error;
        resourceId=data.id;
      }

      const inviteResults=await Promise.allSettled(friendIds.map(friendId=>
        sb.rpc('a2c_invite_friend_to_resource',{
          p_resource_id:resourceId,
          p_friend_id:friendId
        }).then(result=>{if(result.error)throw result.error})
      ));
      const failed=inviteResults.filter(x=>x.status==='rejected');
      sessionStorage.setItem('a2c-friends-message',failed.length
        ?`Elemento guardado. ${friendIds.length-failed.length} invitaciones enviadas y ${failed.length} no se pudieron enviar.`
        :'Elemento guardado e invitaciones enviadas a tus amigos.');
      location.reload();
      return true;
    }catch(error){
      console.error(error);
      toast(error.message||'No se pudo guardar.',true);
      busy(button,false);
      return true;
    }
  }

  async function replaceSplitOptions(){
    const selects=[...document.querySelectorAll('#tx-form .split-user')];
    if(!selects.length)return;
    try{
      await loadFriends();
      for(const select of selects){
        if(select.dataset.friendsOnly)return;
        const old=select.value;
        select.innerHTML=`<option value="">Persona externa</option>${friends.map(f=>`<option value="${f.friend_id}">${esc(f.display_name||'Usuario')} · @${esc(f.username||'usuario')}</option>`).join('')}`;
        if([...select.options].some(o=>o.value===old))select.value=old;
        select.dataset.friendsOnly='1';
      }
    }catch(error){console.error(error)}
  }

  document.addEventListener('click',event=>{
    const find=event.target.closest('[data-find-people]');
    if(find){
      event.preventDefault();
      event.stopImmediatePropagation();
      openPrivateSearch();
      return;
    }

    const newResource=event.target.closest('[data-new-resource]');
    if(newResource){
      currentResourceType=newResource.dataset.newResource;
      currentResourceId=null;
    }

    const resourceMenu=event.target.closest('[data-resource]');
    if(resourceMenu){
      currentResourceId=resourceMenu.dataset.resource;
      currentResourceType=resourceCache.get(String(currentResourceId))?.type||null;
    }
  },true);

  document.addEventListener('submit',event=>{
    const form=event.target;
    if(form instanceof HTMLFormElement&&form.id==='resource-form'){
      saveResourceWithFriends(form,event);
    }
  },true);

  const observer=new MutationObserver(()=>{
    enhanceResourceForm();
    replaceSplitOptions();
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});

  (async()=>{
    try{
      await Promise.all([loadFriends(),loadResources()]);
    }catch(error){console.error(error)}
    enhanceResourceForm();
    replaceSplitOptions();
  })();

  const message=sessionStorage.getItem('a2c-friends-message');
  if(message){
    sessionStorage.removeItem('a2c-friends-message');
    setTimeout(()=>toast(message),600);
  }
}
