(() => {
  try {
    document.querySelectorAll('#a2c-v46-layer,#a2c-notification-button').forEach(node => node.remove());
    const key = 'a2c-v46-5-cleanup';
    if (!sessionStorage.getItem(key) && 'serviceWorker' in navigator) {
      sessionStorage.setItem(key, '1');
      navigator.serviceWorker.getRegistrations()
        .then(registrations => Promise.all(registrations.map(registration => registration.update())))
        .catch(console.error);
    }
  } catch (error) {
    console.error('A2C cleanup:', error);
  }
})();