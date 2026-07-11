export const app = document.querySelector('#app');

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);

export const money = cents => new Intl.NumberFormat('es-ES', {
  style: 'currency', currency: 'EUR'
}).format((Number(cents) || 0) / 100);

export const cents = value => {
  const normalized = String(value || '0').trim().replace(/\./g,'').replace(',','.');
  return Math.round(Number(normalized) * 100);
};

export const today = () => new Date().toISOString().slice(0,10);

export function toast(message, bad=false){
  const el = document.querySelector('#toast');
  if(!el) return;
  el.textContent = message;
  el.classList.toggle('bad', bad);
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

export function modal(content){
  document.body.insertAdjacentHTML('beforeend',
    `<div class="modal" id="modal"><div class="modal-card">${content}</div></div>`);
  document.querySelector('#modal').addEventListener('click', e => {
    if(e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal();
  });
}
export function closeModal(){ document.querySelector('#modal')?.remove(); }

export function fatal(error){
  console.error(error);
  app.innerHTML = `<section class="auth-shell"><div class="auth-card">
    <h1>No se pudo cargar A2C Finanzas</h1>
    <p class="muted">${esc(error?.message || 'Error desconocido')}</p>
    <button class="btn primary full" id="retry">Reintentar</button>
  </div></section>`;
  document.querySelector('#retry').onclick = () => location.reload();
}
