import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.A2C_CONFIG || {};
if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
  console.error('A2C transferencias: falta la configuración pública de Supabase.');
} else {
  const client = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  let lastResourceId = null;
  let injecting = false;

  const toast = (message, bad = false) => {
    const element = document.querySelector('#toast');
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('bad', bad);
    element.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove('show'), 3600);
  };

  const cents = value => {
    let text = String(value ?? '').trim().replace(/\s|€/g, '');
    if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
    const number = Number(text);
    return Number.isFinite(number) ? Math.round(number * 100) : 0;
  };

  const escapeHtml = value => String(value ?? '').replace(
    /[&<>"']/g,
    character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character])
  );

  const closeModal = () => document.querySelector('#modal')?.remove();

  const reloadWithMessage = message => {
    sessionStorage.setItem('a2c-resource-transfer-message', message);
    location.reload();
  };

  const showStoredMessage = () => {
    const message = sessionStorage.getItem('a2c-resource-transfer-message');
    if (!message) return;
    sessionStorage.removeItem('a2c-resource-transfer-message');
    setTimeout(() => toast(message), 500);
  };

  async function getResource(resourceId) {
    const { data, error } = await client
      .from('resources')
      .select('id,name,type')
      .eq('id', resourceId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  function transferForm(resource, direction) {
    const isIn = direction === 'in';
    const title = isIn ? 'Ingresar desde cuenta principal' : 'Retirar a cuenta principal';
    const description = isIn
      ? `El dinero saldrá de tu cuenta principal y entrará en ${resource.name}.`
      : `El dinero saldrá de ${resource.name} y volverá a tu cuenta principal.`;
    const defaultConcept = isIn
      ? `Aportación a ${resource.name}`
      : `Retirada de ${resource.name}`;

    return `<form id="resource-money-form">
      <div class="modal-head">
        <div>
          <h2>${escapeHtml(title)}</h2>
          <p class="muted">${escapeHtml(description)}</p>
        </div>
        <button type="button" class="close-btn" data-close>×</button>
      </div>

      <div class="field">
        <label>Importe (€)</label>
        <input name="amount" inputmode="decimal" required placeholder="0,00">
      </div>

      <div class="field">
        <label>Concepto</label>
        <input name="concept" required maxlength="140" value="${escapeHtml(defaultConcept)}">
      </div>

      <div class="field">
        <label>Fecha</label>
        <input name="date" type="date" required value="${new Date().toISOString().slice(0, 10)}">
      </div>

      <div class="field">
        <label>Notas</label>
        <textarea name="notes" maxlength="500" placeholder="Opcional"></textarea>
      </div>

      <div class="auth-notice">
        <strong>${isIn ? 'Origen: cuenta principal' : `Origen: ${escapeHtml(resource.name)}`}</strong>
        <span>${isIn ? `Destino: ${escapeHtml(resource.name)}` : 'Destino: cuenta principal'}</span>
      </div>

      <div class="actions">
        <button type="button" class="btn" data-close>Cancelar</button>
        <button class="btn primary">${isIn ? 'Ingresar dinero' : 'Retirar dinero'}</button>
      </div>
    </form>`;
  }

  function openTransferDialog(resource, direction) {
    if (direction === 'out' && resource.type !== 'piggy') {
      toast('Las retiradas a la cuenta principal solo están disponibles en huchas.', true);
      return;
    }

    const modalCard = document.querySelector('#modal .modal-card');
    if (!modalCard) return;

    modalCard.innerHTML = transferForm(resource, direction);
    modalCard.querySelectorAll('[data-close]').forEach(button => {
      button.addEventListener('click', closeModal);
    });

    const form = modalCard.querySelector('#resource-money-form');
    form.addEventListener('submit', async event => {
      event.preventDefault();

      const button = event.submitter;
      const formData = new FormData(form);
      const amountCents = cents(formData.get('amount'));

      if (amountCents <= 0) {
        toast('El importe debe ser mayor que cero.', true);
        return;
      }

      button.disabled = true;
      const originalText = button.textContent;
      button.textContent = 'Procesando…';

      try {
        const { error } = await client.rpc('a2c_move_money_between_main_and_resource', {
          p_resource_id: resource.id,
          p_direction: direction,
          p_amount_cents: amountCents,
          p_concept: String(formData.get('concept') || '').trim(),
          p_occurred_on: String(formData.get('date') || ''),
          p_notes: String(formData.get('notes') || '').trim()
        });

        if (error) throw error;

        reloadWithMessage(
          direction === 'in'
            ? 'Dinero ingresado desde la cuenta principal.'
            : 'Dinero retirado a la cuenta principal.'
        );
      } catch (error) {
        console.error('A2C transferencias:', error);
        toast(error?.message || 'No se pudo completar el movimiento.', true);
        button.disabled = false;
        button.textContent = originalText;
      }
    });
  }

  async function injectResourceMoneyActions() {
    if (injecting || !lastResourceId) return;

    const stack = document.querySelector('#modal .menu-stack');
    if (!stack || stack.dataset.moneyActions === 'ready') return;
    if (!stack.querySelector('#resource-edit')) return;

    injecting = true;

    try {
      const resource = await getResource(lastResourceId);
      if (!resource || !document.body.contains(stack)) return;

      stack.dataset.moneyActions = 'ready';

      const actions = document.createElement('div');
      actions.className = 'resource-money-actions';
      actions.innerHTML = `
        <button class="btn primary" type="button" data-money-direction="in">
          ＋ Ingresar desde cuenta principal
        </button>
        ${resource.type === 'piggy' ? `
          <button class="btn" type="button" data-money-direction="out">
            ↩ Retirar a cuenta principal
          </button>
        ` : ''}
      `;

      stack.prepend(actions);

      actions.querySelector('[data-money-direction="in"]')
        ?.addEventListener('click', () => openTransferDialog(resource, 'in'));

      actions.querySelector('[data-money-direction="out"]')
        ?.addEventListener('click', () => openTransferDialog(resource, 'out'));
    } catch (error) {
      console.error('A2C transferencias: no se pudieron cargar las acciones.', error);
    } finally {
      injecting = false;
    }
  }

  /*
   * Garantiza que todo ingreso o ahorro nuevo destinado a una hucha,
   * carpeta u objetivo se registre como salida de la cuenta principal.
   * Se ejecuta antes que el manejador original de app.js.
   */
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== 'tx-form') return;

    // No modifica la edición de movimientos ya existentes.
    if (form.querySelector('#delete-tx')) return;

    const kind = String(form.elements.kind?.value || '');
    if (kind !== 'income' && kind !== 'saving') return;

    const goalId = String(form.elements.saving_goal_id?.value || '');
    const rawResourceId = String(form.elements.resource_id?.value || '');
    const resourceId = kind === 'saving' && goalId ? goalId : rawResourceId;

    if (!resourceId || resourceId.startsWith('crypto:')) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const amountCents = cents(form.elements.amount?.value);
    if (amountCents <= 0) {
      toast('El importe debe ser mayor que cero.', true);
      return;
    }

    const submitButton = event.submitter;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.dataset.originalLabel ||= submitButton.textContent;
      submitButton.textContent = 'Procesando…';
    }

    try {
      const resource = await getResource(resourceId);
      if (!resource) throw new Error('No se ha encontrado la hucha, carpeta u objetivo.');

      const { error } = await client.rpc('a2c_move_money_between_main_and_resource', {
        p_resource_id: resourceId,
        p_direction: 'in',
        p_amount_cents: amountCents,
        p_concept: String(form.elements.concept?.value || `Aportación a ${resource.name}`).trim(),
        p_occurred_on: String(form.elements.date?.value || new Date().toISOString().slice(0, 10)),
        p_notes: String(form.elements.notes?.value || '').trim()
      });

      if (error) throw error;

      reloadWithMessage('Ingreso realizado desde la cuenta principal.');
    } catch (error) {
      console.error('A2C transferencias:', error);
      toast(error?.message || 'No se pudo realizar el ingreso.', true);

      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = submitButton.dataset.originalLabel || 'Guardar';
      }
    }
  }, true);

  document.addEventListener('click', event => {
    const resourceButton = event.target.closest('[data-resource]');
    if (resourceButton) {
      lastResourceId = resourceButton.dataset.resource || null;
      setTimeout(injectResourceMoneyActions, 0);
    }
  }, true);

  const observer = new MutationObserver(injectResourceMoneyActions);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  showStoredMessage();
}
