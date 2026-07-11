import { state } from '../core/store.js';
import { esc, modal, closeModal, toast } from '../core/ui.js';
import { sb } from '../core/supabase.js';

export function openAdmin(){
  modal(`<div class="modal-head"><div><h2>Administración</h2><p class="muted">Usuarios y contraseñas</p></div><button class="close-btn" data-close>×</button></div>
  <div class="admin-grid">${state.users.map(u=>`<article class="row"><div><strong>${esc(u.display_name||u.email)}</strong><small>${esc(u.email)} · ${esc(u.role)}</small></div><button class="btn" data-password-user="${u.id}">Contraseña</button></article>`).join('') || '<div class="empty">No hay usuarios.</div>'}</div>`);
  document.querySelectorAll('[data-password-user]').forEach(btn => btn.onclick = () => openPassword(btn.dataset.passwordUser));
}

function openPassword(userId){
  closeModal();
  modal(`<form id="password-form"><div class="modal-head"><div><h2>Cambiar contraseña</h2></div><button type="button" class="close-btn" data-close>×</button></div>
  <div class="field"><label>Nueva contraseña</label><input name="password" type="password" minlength="10" required></div>
  <div class="actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Cambiar</button></div></form>`);
  document.querySelector('#password-form').onsubmit = async e => {
    e.preventDefault();
    const password = new FormData(e.currentTarget).get('password');
    const { data, error } = await sb.functions.invoke('admin-change-password',{body:{user_id:userId,password}});
    if(error || !data?.ok) return toast(data?.error || error?.message || 'No se pudo cambiar', true);
    closeModal(); toast('Contraseña actualizada');
  };
}
