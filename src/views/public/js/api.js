// KEEP UP System - Frontend API Utility

let csrfTokenCache = null;

async function ensureCsrfToken() {
  if (csrfTokenCache) return csrfTokenCache;
  const response = await fetch('/api/auth/csrf-token');
  const data = await response.json();
  if (data && data.success && data.csrfToken) {
    csrfTokenCache = data.csrfToken;
    return csrfTokenCache;
  }
  throw new Error('Failed to obtain CSRF token.');
}

function buildHeaders(options = {}, includeJson = true) {
  const headers = { ...(options.headers || {}) };
  if (includeJson && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

const API = {
  ensureCsrfToken,

  async getCsrfHeaders(extra = {}) {
    const token = await ensureCsrfToken();
    return { ...extra, 'X-CSRF-Token': token };
  },

  async fetchJson(url, options = {}) {
    try {
      const method = (options.method || 'GET').toUpperCase();
      let headers = buildHeaders(options, true);

      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        headers = { ...headers, ...(await this.getCsrfHeaders()) };
      }

      const response = await fetch(url, {
        ...options,
        headers
      });

      const data = await response.json();

      if (response.status === 401 && !url.includes('/api/auth/login')) {
        window.location.href = '/login';
        return null;
      }

      if (response.status === 403 && data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return null;
      }

      if (!response.ok) {
        throw new Error(data.message || `HTTP error! status: ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error('Fetch error:', error);
      throw error;
    }
  },

  async login(email, password) {
    return this.fetchJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
  },

  async logout() {
    try {
      const data = await this.fetchJson('/api/auth/logout', { method: 'POST' });
      csrfTokenCache = null;
      if (data && data.redirectUrl) {
        window.location.href = data.redirectUrl;
      }
    } catch (e) {
      window.location.href = '/login';
    }
  },

  async getProfile() {
    return this.fetchJson('/api/auth/me');
  },

  async getUsers() {
    return this.fetchJson('/api/users');
  },

  async createUser(userData) {
    return this.fetchJson('/api/users', {
      method: 'POST',
      body: JSON.stringify(userData)
    });
  },

  async updateUser(id, updates) {
    return this.fetchJson(`/api/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
  },

  async postJson(url, body) {
    return this.fetchJson(url, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },

  async logReportExport(payload) {
    return this.postJson('/api/reports/audit-export', payload);
  }
};

async function loadUserProfile() {
  try {
    await ensureCsrfToken();
    const data = await API.getProfile();
    if (!data || !data.success) {
      window.location.href = '/login';
      return null;
    }

    const user = data.user;
    const userNameElement = document.getElementById('layout-user-name');
    const userInitialsElement = document.getElementById('layout-user-initials');
    const userRoleElement = document.getElementById('layout-user-role');
    const welcomeNameElement = document.getElementById('welcome-user-name');

    if (userNameElement) userNameElement.textContent = user.full_name;
    if (userRoleElement) {
      userRoleElement.textContent = formatRole(user.role);
      userRoleElement.className = `user-role-badge ${getRoleClass(user.role)}`;
    }
    if (welcomeNameElement) welcomeNameElement.textContent = user.full_name;

    if (userInitialsElement) {
      const initials = user.full_name
        .split(' ')
        .map(n => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase();
      userInitialsElement.textContent = initials || 'US';
    }

    return user;
  } catch (error) {
    console.error('Failed to load user profile:', error);
    window.location.href = '/login';
  }
}

function formatRole(role) {
  switch (role) {
    case 'RHU_ADMINISTRATOR': return 'RHU Administrator';
    case 'RECORDS_STAFF': return 'Records Staff';
    case 'HEALTHCARE_PERSONNEL': return 'Healthcare Personnel';
    case 'ADMINISTRATIVE_STAFF': return 'Administrative Staff';
    default: return role;
  }
}

function getRoleClass(role) {
  switch (role) {
    case 'RHU_ADMINISTRATOR': return 'role-admin';
    case 'RECORDS_STAFF': return 'role-records';
    case 'HEALTHCARE_PERSONNEL': return 'role-healthcare';
    case 'ADMINISTRATIVE_STAFF': return 'role-staff';
    default: return '';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const menuToggle = document.getElementById('menu-toggle');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');

  if (menuToggle && sidebar && sidebarOverlay) {
    const toggleMenu = () => {
      sidebar.classList.toggle('active');
      sidebarOverlay.classList.toggle('active');
    };

    menuToggle.addEventListener('click', toggleMenu);
    sidebarOverlay.addEventListener('click', toggleMenu);
  }

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('error') === 'unauthorized') {
    if (window.showToast) {
      window.showToast('Access Denied: You do not have permission to view that section.', 'error');
    }
    window.history.replaceState({}, document.title, window.location.pathname);
  }
});
