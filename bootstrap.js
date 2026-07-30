(() => {
  const BOOT_LIMIT = 22000;
  const app = document.querySelector('#app');

  function showFailure(message) {
    if (window.__A2C_BOOT_STATUS === 'ready') return;
    if (!app) return;
    app.innerHTML = `
      <section class="auth-shell">
        <div class="auth-card">
          <h1>No se pudo iniciar A2C Finanzas</h1>
          <p class="muted">${String(message || 'Comprueba tu conexión e inténtalo de nuevo.')}</p>
          <button type="button" class="btn primary full" id="a2c-retry-start">Reintentar</button>
        </div>
      </section>`;
    document.querySelector('#a2c-retry-start')?.addEventListener('click', () => location.reload());
  }

  window.addEventListener('a2c:ready', () => clearTimeout(window.__A2C_BOOT_TIMER));
  window.__A2C_BOOT_TIMER = setTimeout(() => {
    showFailure('La aplicación ha tardado demasiado en responder.');
  }, BOOT_LIMIT);

  const vendor = document.createElement('script');
  vendor.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  vendor.async = false;
  vendor.onload = () => {
    const runtime = document.createElement('script');
    runtime.src = './app.bundle.js?v=58';
    runtime.async = false;
    runtime.onerror = () => showFailure('No se pudo cargar el núcleo de la aplicación.');
    document.body.appendChild(runtime);
  };
  vendor.onerror = () => showFailure('No se pudo conectar con el servicio de sincronización.');
  document.body.appendChild(vendor);
})();
