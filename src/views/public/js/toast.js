// Shared Toast Notification Component

function createToastContainer() {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

window.showToast = function(message, type = 'info') {
  const container = createToastContainer();
  
  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast glass-panel toast-${type}`;
  
  // Icon selector
  let iconSvg = '';
  if (type === 'success') {
    iconSvg = `<svg class="toast-icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`;
  } else if (type === 'error') {
    iconSvg = `<svg class="toast-icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
  } else if (type === 'warning') {
    iconSvg = `<svg class="toast-icon" viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`;
  } else {
    // Info
    iconSvg = `<svg class="toast-icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`;
  }

  toast.innerHTML = `
    ${iconSvg}
    <div class="toast-content">${message}</div>
    <button class="toast-close" onclick="this.parentElement.remove()">
      <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
    </button>
  `;
  
  container.appendChild(toast);
  
  // Trigger animation frame to show
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });
  
  // Auto-remove after 4.5 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    // Wait for transition to finish before removing from DOM
    toast.addEventListener('transitionend', () => {
      toast.remove();
    });
  }, 4500);
};
