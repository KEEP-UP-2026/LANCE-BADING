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

  async getCurrentUser() {
    const res = await this.getProfile();
    return res && res.success ? res.user : null;
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

  async postForm(url, formData) {
    const csrfHeaders = await this.getCsrfHeaders();
    const response = await fetch(url, {
      method: 'POST',
      headers: csrfHeaders,
      body: formData
    });

    const data = await response.json();

    if (response.status === 401 && !url.includes('/api/auth/login')) {
      window.location.href = '/login';
      return null;
    }

    if (!response.ok) {
      throw new Error(data.message || `HTTP error! status: ${response.status}`);
    }

    return data;
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

    // Automatically inject consistent sidebar navigation links for user role
    if (user && user.role) {
      injectSidebarLinks(user.role);
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

// Global Centralized Sidebar Injection
function injectSidebarLinks(role) {
  const navContainer = document.getElementById('layout-nav-links');
  if (!navContainer) return;

  const currentPath = window.location.pathname;

  let links = [];

  if (role === 'RHU_ADMINISTRATOR') {
    links = [
      { href: '/dashboard/admin', label: 'Admin Overview', icon: '<path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8v-10h-8v10zm0-18v6h8V3h-8z"/>' },
      { href: '/dashboard/admin/users', label: 'User Accounts', icon: '<path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>' },
      { href: '/dashboard/patients', label: 'Patient Directory', icon: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>' },
      { href: '/dashboard/search', label: 'Unified Search', icon: '<path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5 5 7.01 7.01 5 9.5 5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5z"/>' },
      { href: '/dashboard/duplicates', label: 'Duplicate Warnings', icon: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>' },
      { href: '/dashboard/archives', label: 'Archives Directory', icon: '<path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM6.24 5h11.52l.83 1H5.41l.83-1zM5 19V8h14v11H5zm11-5.5l-4 4-4-4 1.41-1.41L11 13.67V10h2v3.67l1.59-1.58L16 13.5z"/>' },
      { href: '/dashboard/reports', label: 'Reports Dashboard', icon: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h10v2zm0-4H7V7h10v2z"/>' }
    ];
  } else if (role === 'RECORDS_STAFF') {
    links = [
      { href: '/dashboard/records', label: 'Dashboard Overview', icon: '<path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>' },
      { href: '/dashboard/patients', label: 'Patient Directory', icon: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>' },
      { href: '/dashboard/search', label: 'Unified Search', icon: '<path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5 5 7.01 7.01 5 9.5 5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5z"/>' },
      { href: '/dashboard/duplicates', label: 'Duplicate Warnings', icon: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>' },
      { href: '/dashboard/archives', label: 'Archives Directory', icon: '<path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM6.24 5h11.52l.83 1H5.41l.83-1zM5 19V8h14v11H5zm11-5.5l-4 4-4-4 1.41-1.41L11 13.67V10h2v3.67l1.59-1.58L16 13.5z"/>' },
      { href: '/dashboard/reports', label: 'Reports Dashboard', icon: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h10v2zm0-4H7V7h10v2z"/>' }
    ];
  } else if (role === 'HEALTHCARE_PERSONNEL') {
    links = [
      { href: '/dashboard/healthcare', label: 'Healthcare Overview', icon: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/>' },
      { href: '/dashboard/patients', label: 'Patient Directory', icon: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>' },
      { href: '/dashboard/search', label: 'Unified Search', icon: '<path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5 5 7.01 7.01 5 9.5 5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5z"/>' }
    ];
  } else {
    links = [
      { href: '/dashboard/reports', label: 'Reports Dashboard', icon: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h10v2zm0-4H7V7h10v2z"/>' },
      { href: '/dashboard/patients', label: 'Patient Directory', icon: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>' },
      { href: '/dashboard/search', label: 'Unified Search', icon: '<path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5 5 7.01 7.01 5 9.5 5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5z"/>' }
    ];
  }

  navContainer.innerHTML = links.map(item => {
    let isActive = false;
    if (currentPath === item.href) {
      isActive = true;
    } else if (item.href !== '/dashboard' && currentPath.startsWith(item.href) && (currentPath.length === item.href.length || currentPath[item.href.length] === '/')) {
      isActive = true;
    }

    const activeClass = isActive ? 'active' : '';
    return `
      <li>
        <a href="${item.href}" class="nav-link ${activeClass}">
          <svg viewBox="0 0 24 24">${item.icon}</svg>
          ${item.label}
        </a>
      </li>
    `;
  }).join('');
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

