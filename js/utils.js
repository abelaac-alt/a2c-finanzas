export const esc = value =>
  String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

export const money = value =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })
    .format((Number(value) || 0) / 100);

export const cents = value => {
  let text = String(value || '0').trim().replace(/\s|€/g, '');
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  return Math.round(Number(text) * 100);
};

export const today = () => new Date().toISOString().slice(0, 10);

export const dateFmt = value =>
  value
    ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' })
        .format(new Date(`${value}T12:00:00`))
    : '';

export const kindLabel = kind => ({
  income: 'Ingreso', expense: 'Gasto', investment: 'Inversión', transfer: 'Traspaso'
})[kind] || kind;

export const kindIcon = kind => ({
  income: '＋', expense: '−', investment: '↗', transfer: '⇄'
})[kind] || '•';

export function toast(message, bad = false) {
  const element = document.querySelector('#toast');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('bad', bad);
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2800);
}

export function showError(error) {
  console.error(error);
  toast(error?.message || 'Ha ocurrido un error', true);
}

export function loading(button, on = true) {
  if (!button) return;
  button.disabled = on;
  button.dataset.label ??= button.textContent;
  button.textContent = on ? 'Procesando…' : button.dataset.label;
}
