export const app = document.querySelector('#app');

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);

export const money = cents => new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR'
}).format((Number(cents) || 0) / 100);

export const cents = value => {
  let normalized = String(value ?? '0').trim().replace(/\s|€/g, '');
  if (normalized.includes(',')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
};

export const today = () => new Date().toISOString().slice(0, 10);

export function toast(message, bad = false) {
  const el = document.querySelector('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('bad', bad);
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2800);
}

export function modal(content, wide = false) {
  closeModal();
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="modal" id="modal">
      <div class="modal-card ${wide ? 'wide' : ''}">${content}</div>
    </div>`
  );
  document.querySelector('#modal')?.addEventListener('click', event => {
    if (event.target.id === 'modal' || event.target.closest('[data-close]')) {
      closeModal();
    }
  });
}

export function closeModal() {
  document.querySelector('#modal')?.remove();
}

export function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.dataset.originalText ??= button.textContent;
  button.textContent = busy ? 'Procesando…' : button.dataset.originalText;
}

export function fatal(error) {
  console.error(error);
  app.innerHTML = `<section class="auth-shell"><div class="auth-card">
    <h1>No se pudo cargar A2C Finanzas</h1>
    <p class="muted">${esc(error?.message || 'Error desconocido')}</p>
    <button class="btn primary full" id="retry">Reintentar</button>
  </div></section>`;
  document.querySelector('#retry')?.addEventListener('click', () => location.reload());
}
