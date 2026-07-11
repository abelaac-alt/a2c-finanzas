import { state } from '../core/store.js';
import { esc, modal, closeModal, toast } from '../core/ui.js';
import { sb } from '../core/supabase.js';

export function openNotifications(onRefresh) {
  modal(`<div class="modal-head">
      <div><h2>Notificaciones</h2><p class="muted">Invitaciones y avisos compartidos</p></div>
      <button class="close-btn" data-close>×</button>
    </div>
    <div class="list">
      ${state.notifications.map(n => `<article class="notification ${n.read_at ? 'read' : ''}">
        <div>
          <strong>${esc(n.title || 'Aviso')}</strong>
          <p>${esc(n.body || '')}</p>
          <small>${new Date(n.created_at).toLocaleString('es-ES')}</small>
        </div>
        <div class="notification-actions">
          ${!n.read_at ? `<button class="btn" data-read-notification="${n.id}">Leída</button>` : ''}
          <button class="btn danger" data-delete-notification="${n.id}">Borrar</button>
        </div>
      </article>`).join('') || '<div class="empty">No tienes notificaciones.</div>'}
    </div>`, true);

  document.querySelectorAll('[data-read-notification]').forEach(button => {
    button.addEventListener('click', async () => {
      const { error } = await sb.rpc('mark_notification_read', {
        p_notification_id: button.dataset.readNotification
      });
      if (error) return toast(error.message, true);
      await onRefresh();
      openNotifications(onRefresh);
    });
  });

  document.querySelectorAll('[data-delete-notification]').forEach(button => {
    button.addEventListener('click', async () => {
      const { error } = await sb.rpc('delete_notification_secure', {
        p_notification_id: button.dataset.deleteNotification
      });
      if (error) return toast(error.message, true);
      await onRefresh();
      openNotifications(onRefresh);
    });
  });
}
