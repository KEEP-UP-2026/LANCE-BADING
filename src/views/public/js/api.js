// KEEP UP System - Frontend API Utility

let csrfTokenCache = null;

function getCsrfFromCookie() {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function ensureCsrfToken(forceRefresh = false) {
  if (!forceRefresh) {
    const cookieToken = getCsrfFromCookie();
    if (cookieToken) {
      csrfTokenCache = cookieToken;
      return cookieToken;
    }
    if (csrfTokenCache) return csrfTokenCache;
  }

  try {
    const url = `/api/auth/csrf-token${forceRefresh ? '?refresh=true' : ''}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data && data.success && data.csrfToken) {
      csrfTokenCache = data.csrfToken;
      return csrfTokenCache;
    }
  } catch (err) {
    console.warn('Could not fetch new CSRF token via API:', err);
  }

  const cookieFallback = getCsrfFromCookie();
  if (cookieFallback) {
    csrfTokenCache = cookieFallback;
    return cookieFallback;
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
    return { ...extra, 'X-CSRF-Token': token, 'x-csrf-token': token };
  },

  async fetchJson(url, options = {}) {
    try {
      const method = (options.method || 'GET').toUpperCase();
      let headers = buildHeaders(options, true);

      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        headers = { ...headers, ...(await this.getCsrfHeaders()) };
      }

      let response = await fetch(url, {
        ...options,
        headers
      });

      // Automatically retry once if CSRF token is expired or out of sync
      if (response.status === 403) {
        let clonedRes = response.clone();
        try {
          const errData = await clonedRes.json();
          if (errData && errData.message && errData.message.toLowerCase().includes('csrf')) {
            console.warn('CSRF token out of sync, refreshing token and retrying request...');
            const freshToken = await ensureCsrfToken(true);
            headers['X-CSRF-Token'] = freshToken;
            headers['x-csrf-token'] = freshToken;
            response = await fetch(url, {
              ...options,
              headers
            });
          }
        } catch (_) {}
      }

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

  async postJson(url, bodyData, options = {}) {
    return this.fetchJson(url, {
      ...options,
      method: 'POST',
      body: JSON.stringify(bodyData)
    });
  },

  async putJson(url, bodyData, options = {}) {
    return this.fetchJson(url, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(bodyData)
    });
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

  async postForm(url, formData) {
    let csrfHeaders = await this.getCsrfHeaders();
    let response = await fetch(url, {
      method: 'POST',
      headers: csrfHeaders,
      body: formData
    });

    if (response.status === 403) {
      let clonedRes = response.clone();
      try {
        const errData = await clonedRes.json();
        if (errData && errData.message && errData.message.toLowerCase().includes('csrf')) {
          console.warn('CSRF token out of sync in form upload, refreshing token and retrying...');
          const freshToken = await ensureCsrfToken(true);
          response = await fetch(url, {
            method: 'POST',
            headers: { 'X-CSRF-Token': freshToken, 'x-csrf-token': freshToken },
            body: formData
          });
        }
      } catch (_) {}
    }

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

let currentUserProfileCache = null;

function applyUserProfileToDOM(user) {
  if (!user) return;
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

  // Mobile initials if present on page
  const mobileInitials = document.getElementById('mobile-user-initials');
  if (mobileInitials && user.full_name) {
    mobileInitials.textContent = user.full_name
      .split(' ')
      .map(n => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  }

  // Automatically inject consistent sidebar navigation links for user role if empty, else update active indicator
  const navContainer = document.getElementById('layout-nav-links');
  if (navContainer && navContainer.children.length === 0 && user && user.role) {
    injectSidebarLinks(user.role);
  } else if (navContainer && user && user.role) {
    updateSidebarActiveLink(window.location.pathname);
  }
}

async function loadUserProfile(forceRefresh = false) {
  if (currentUserProfileCache && !forceRefresh) {
    applyUserProfileToDOM(currentUserProfileCache);
    return currentUserProfileCache;
  }
  try {
    await ensureCsrfToken();
    const data = await API.getProfile();
    if (!data || !data.success) {
      window.location.href = '/login';
      return null;
    }

    const user = data.user;
    currentUserProfileCache = user;
    applyUserProfileToDOM(user);
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

function updateSidebarActiveLink(targetPath) {
  const currentPath = (targetPath || window.location.pathname).toLowerCase();
  const navContainer = document.getElementById('layout-nav-links');
  if (!navContainer) return;

  const links = Array.from(navContainer.querySelectorAll('a.nav-link'));
  if (links.length === 0) return;

  let bestMatch = null;

  links.forEach(a => {
    const href = (a.getAttribute('href') || '').toLowerCase();
    if (!href) return;
    if (href === currentPath) {
      bestMatch = a;
    } else if (href !== '/dashboard' && href !== '/dashboard/admin' && currentPath.startsWith(href + '/')) {
      if (!bestMatch || href.length > (bestMatch.getAttribute('href') || '').length) {
        bestMatch = a;
      }
    }
  });

  links.forEach(a => {
    const isActive = (a === bestMatch);
    if (isActive) {
      a.classList.add('active');
    } else {
      a.classList.remove('active');
    }
    const badge = a.querySelector('span[style*="border-radius"]');
    if (badge) {
      badge.style.background = isActive ? '#fee2e2' : '#f1f5f9';
      badge.style.color = isActive ? '#dc2626' : '#64748b';
    }
  });
}

// Global Centralized Sidebar Injection
function injectSidebarLinks(role) {
  const navContainer = document.getElementById('layout-nav-links');
  if (!navContainer) return;

  const currentPath = window.location.pathname.toLowerCase();

  let links = [];

  if (role === 'RHU_ADMINISTRATOR') {
    links = [
      { href: '/dashboard/admin', label: 'System Monitoring', icon: '<path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8v-10h-8v10zm0-18v6h8V3h-8z"/>' },
      { href: '/dashboard/admin/users', label: 'User Accounts', icon: '<path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>' },
      { href: '/dashboard/admin/audit', label: 'Audit Log Review', icon: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>' }
    ];
  } else if (role === 'RECORDS_STAFF') {
    links = [
      { href: '/dashboard/records', label: 'Dashboard Overview', icon: '<path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>' },
      { href: '/dashboard/patients', label: 'Patient Directory', icon: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>' },
      { section: 'Document Binders' },
      { href: '/dashboard/documents/itr', label: 'Individual Treatment Record', icon: '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>', badge: 'ITR' },
      { href: '/dashboard/documents/consultations', label: 'Consultation Records', icon: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>', badge: 'Consult' },
      { href: '/dashboard/documents/immunizations', label: 'Immunizations', icon: '<path d="M19 3h-4V1h-2v2H9V1H7v2H3v18h16V3zm-2 16H5V8h12v11z"/>', badge: 'Vax' },
      { href: '/dashboard/documents/medcert', label: 'Medical Certificates', icon: '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 9h-2V9h2v2zm0 4h-2v-2h2v2zm3-6V3.5L18.5 9H16z"/>', badge: 'MedCert' },
      { href: '/dashboard/documents/maternal', label: 'Maternal Records', icon: '<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>', badge: 'Maternal' },
      { section: 'Management & Tools' },
      { href: '/dashboard/search', label: 'Unified Search', icon: '<path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>' },
      { href: '/dashboard/duplicates', label: 'Duplicate Warnings', icon: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>' },
      { href: '/dashboard/archives', label: 'Archives Directory', icon: '<path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM6.24 5h11.52l.83 1H5.41l.83-1zM5 19V8h14v11H5zm11-5.5l-4 4-4-4 1.41-1.41L11 13.67V10h2v3.67l1.59-1.58L16 13.5z"/>' }
    ];
  } else if (role === 'HEALTHCARE_PERSONNEL') {
    links = [
      { href: '/dashboard/healthcare', label: 'Healthcare Overview', icon: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/>' },
      { section: 'Search & Retrieval' },
      { href: '/dashboard/search', label: 'Search & Retrieve Records', icon: '<path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>' },
      { section: 'Permitted Patient Info' },
      { href: '/dashboard/patients', label: 'Patient Directory', icon: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>' },
      { section: 'Permitted Clinical Binders' },
      { href: '/dashboard/documents/itr', label: 'Individual Treatment Record', icon: '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>' },
      { href: '/dashboard/documents/consultations', label: 'Consultation Records', icon: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>' },
      { href: '/dashboard/documents/immunizations', label: 'Immunizations', icon: '<path d="M19 3h-4V1h-2v2H9V1H7v2H3v18h16V3zm-2 16H5V8h12v11z"/>' },
      { href: '/dashboard/documents/medcert', label: 'Medical Certificates', icon: '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 9h-2V9h2v2zm0 4h-2v-2h2v2zm3-6V3.5L18.5 9H16z"/>' },
      { href: '/dashboard/documents/maternal', label: 'Maternal Records', icon: '<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>' }
    ];
  } else if (role === 'ADMINISTRATIVE_STAFF') {
    links = [
      { href: '/dashboard/reports', label: 'Analytics & Reports', icon: '<path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8zM4 21h16v-2H4v2z"/>' },
      { href: '/dashboard/records', label: 'Dashboard Overview', icon: '<path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>' },
      { href: '/dashboard/patients', label: 'Patient Directory', icon: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>' },
      { section: 'Document Binders' },
      { href: '/dashboard/documents/itr', label: 'Individual Treatment Record', icon: '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>', badge: 'ITR' },
      { href: '/dashboard/documents/consultations', label: 'Consultation Records', icon: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>', badge: 'Consult' },
      { href: '/dashboard/documents/immunizations', label: 'Immunizations', icon: '<path d="M19 3h-4V1h-2v2H9V1H7v2H3v18h16V3zm-2 16H5V8h12v11z"/>', badge: 'Vax' },
      { href: '/dashboard/documents/medcert', label: 'Medical Certificates', icon: '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 9h-2V9h2v2zm0 4h-2v-2h2v2zm3-6V3.5L18.5 9H16z"/>', badge: 'MedCert' },
      { href: '/dashboard/documents/maternal', label: 'Maternal Records', icon: '<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>', badge: 'Maternal' },
      { section: 'Management & Tools' },
      { href: '/dashboard/search', label: 'Unified Search', icon: '<path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>' },
      { href: '/dashboard/duplicates', label: 'Duplicate Warnings', icon: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>' },
      { href: '/dashboard/archives', label: 'Archives Directory', icon: '<path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM6.24 5h11.52l.83 1H5.41l.83-1zM5 19V8h14v11H5zm11-5.5l-4 4-4-4 1.41-1.41L11 13.67V10h2v3.67l1.59-1.58L16 13.5z"/>' }
    ];
  } else {
    links = [
      { href: '/dashboard/patients', label: 'Patient Directory', icon: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>' },
      { section: 'Document Binders' },
      { href: '/dashboard/documents/itr', label: 'Individual Treatment Record', icon: '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>' },
      { href: '/dashboard/documents/consultations', label: 'Consultation Records', icon: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>' },
      { href: '/dashboard/documents/immunizations', label: 'Immunizations', icon: '<path d="M19 3h-4V1h-2v2H9V1H7v2H3v18h16V3zm-2 16H5V8h12v11z"/>' },
      { href: '/dashboard/documents/medcert', label: 'Medical Certificates', icon: '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 9h-2V9h2v2zm0 4h-2v-2h2v2zm3-6V3.5L18.5 9H16z"/>' },
      { href: '/dashboard/documents/maternal', label: 'Maternal Records', icon: '<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>' },
      { section: 'Search' },
      { href: '/dashboard/search', label: 'Unified Search', icon: '<path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>' }
    ];
  }

  const exactMatch = links.find(item => item.href && item.href.toLowerCase() === currentPath);

  navContainer.innerHTML = links.map(item => {
    if (item.section) {
      return `
        <li class="sidebar-section-header" style="font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.08em; padding: 10px 14px 4px; list-style: none;">
          ${item.section}
        </li>
      `;
    }

    let isActive = false;
    if (exactMatch) {
      isActive = (item === exactMatch);
    } else if (item.href) {
      const itemHref = item.href.toLowerCase();
      if (itemHref !== '/dashboard' && itemHref !== '/dashboard/admin' && currentPath.startsWith(itemHref + '/')) {
        isActive = true;
      }
    }

    const activeClass = isActive ? 'active' : '';
    const badgeHtml = item.badge ? `<span style="margin-left: auto; font-size: 9.5px; font-weight: 800; padding: 2px 7px; border-radius: 12px; background: ${isActive ? '#fee2e2' : '#f1f5f9'}; color: ${isActive ? '#dc2626' : '#64748b'};">${item.badge}</span>` : '';

    return `
      <li>
        <a href="${item.href}" class="nav-link ${activeClass}">
          <svg viewBox="0 0 24 24">${item.icon}</svg>
          <span style="flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.label}</span>
          ${badgeHtml}
        </a>
      </li>
    `;
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// SPA Dynamic Router & View Swapper (Seamless Persistent Layout)
// ─────────────────────────────────────────────────────────────────────────────

// Ensure dynamically injected scripts attaching DOMContentLoaded run immediately if document is already ready
const _nativeAddEventListener = document.addEventListener.bind(document);
document.addEventListener = function(type, listener, options) {
  if (type === 'DOMContentLoaded' && (document.readyState === 'complete' || document.readyState === 'interactive')) {
    setTimeout(() => {
      try {
        listener(new Event('DOMContentLoaded'));
      } catch (err) {
        console.error('Error executing dynamic DOMContentLoaded listener:', err);
      }
    }, 1);
    return;
  }
  return _nativeAddEventListener(type, listener, options);
};

// ─── GLOBAL LOGOUT MODAL IMPLEMENTATION ───
function ensureLogoutModal() {
  if (document.getElementById('global-logout-modal')) return;

  const modalHtml = `
    <div id="global-logout-modal" style="display: none; position: fixed; inset: 0; z-index: 999999; align-items: center; justify-content: center; padding: 20px;">
      <div id="global-logout-backdrop" style="position: absolute; inset: 0; background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(4px); transition: opacity 0.2s;"></div>
      <div style="position: relative; background: #FFFFFF; border: 1.5px solid #E2E8F0; border-radius: 20px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25); max-width: 400px; width: 100%; padding: 26px 24px; text-align: center;">
        <div style="width: 52px; height: 52px; border-radius: 50%; background: #FEF2F2; color: #DC2626; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; border: 2px solid #FEE2E2;">
          <svg style="width: 26px; height: 26px; fill: currentColor;" viewBox="0 0 24 24">
            <path d="M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42C17.99 7.86 19 9.81 19 12c0 3.87-3.13 7-7 7s-7-3.13-7-7c0-2.19 1.01-4.14 2.58-5.42L6.17 5.17C4.23 6.82 3 9.26 3 12c0 4.97 4.03 9 9 9s9-4.03 9-9c0-2.74-1.23-5.18-3.17-6.83z"/>
          </svg>
        </div>
        <h3 style="font-size: 18px; font-weight: 800; color: #0F172A; margin: 0 0 8px;">Sign Out of System?</h3>
        <p style="font-size: 13.5px; color: #64748B; margin: 0 0 22px; line-height: 1.5;">Sigurado ka ba na nais mong mag-sign out sa KEEP UP Health System?</p>
        <div style="display: flex; gap: 10px; justify-content: center;">
          <button type="button" id="btn-cancel-logout" style="flex: 1; padding: 11px 18px; border: 1.5px solid #CBD5E1; background: #FFFFFF; color: #334155; font-size: 13.5px; font-weight: 700; border-radius: 10px; cursor: pointer; transition: all 0.15s;">
            Cancel
          </button>
          <button type="button" id="btn-confirm-logout" style="flex: 1; padding: 11px 18px; border: none; background: #DC2626; color: #FFFFFF; font-size: 13.5px; font-weight: 700; border-radius: 10px; cursor: pointer; transition: all 0.15s; box-shadow: 0 4px 12px rgba(220, 38, 38, 0.3);">
            Sign Out
          </button>
        </div>
      </div>
    </div>
  `;

  const container = document.createElement('div');
  container.innerHTML = modalHtml;
  document.body.appendChild(container.firstElementChild);

  document.getElementById('btn-cancel-logout').addEventListener('click', closeLogoutModal);
  document.getElementById('global-logout-backdrop').addEventListener('click', closeLogoutModal);
  document.getElementById('btn-confirm-logout').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirm-logout');
    btn.disabled = true;
    btn.textContent = 'Signing Out...';
    btn.style.opacity = '0.7';
    await API.logout();
  });
}

function openLogoutModal() {
  ensureLogoutModal();
  const modal = document.getElementById('global-logout-modal');
  if (modal) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
}

function closeLogoutModal() {
  const modal = document.getElementById('global-logout-modal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

window.openLogoutModal = openLogoutModal;
window.closeLogoutModal = closeLogoutModal;

const SpaRouter = {
  isNavigating: false,

  init() {
    this.createProgressBar();
    this.setupLinkInterception();
    this.setupHistoryListener();
    this.setupGlobalHandlers();
  },

  createProgressBar() {
    if (!document.getElementById('spa-progress-bar')) {
      const bar = document.createElement('div');
      bar.id = 'spa-progress-bar';
      document.body.appendChild(bar);
    }
  },

  setProgressBar(percent) {
    const bar = document.getElementById('spa-progress-bar');
    if (!bar) return;
    if (percent === 0) {
      bar.style.width = '0%';
      bar.classList.remove('active');
    } else {
      bar.classList.add('active');
      bar.style.width = `${percent}%`;
    }
  },

  async navigate(url, pushState = true) {
    if (this.isNavigating) return;
    
    // Normalize target URL
    const targetUrl = new URL(url, window.location.origin);
    const targetPath = targetUrl.pathname;
    const currentPath = window.location.pathname;

    // If identical full URL, scroll to top
    if (targetUrl.href === window.location.href) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // Do not intercept external, api, or auth endpoints
    if (targetUrl.origin !== window.location.origin || targetPath.startsWith('/api/') || targetPath === '/login' || targetPath === '/api/auth/logout') {
      window.location.href = url;
      return;
    }

    try {
      this.isNavigating = true;
      this.setProgressBar(25);

      const response = await fetch(targetUrl.href, {
        headers: { 'X-Requested-With': 'SPA-Router' }
      });

      // Handle redirect to login or error
      if (response.redirected && response.url.includes('/login')) {
        window.location.href = response.url;
        return;
      }

      if (!response.ok) {
        window.location.href = targetUrl.href;
        return;
      }

      this.setProgressBar(60);
      const htmlText = await response.text();
      const parser = new DOMParser();
      const newDoc = parser.parseFromString(htmlText, 'text/html');

      const newMain = newDoc.querySelector('.main-content');
      const currentMain = document.querySelector('.main-content');

      if (!newMain || !currentMain) {
        window.location.href = targetUrl.href;
        return;
      }

      // 1. Update Document Title
      if (newDoc.title) {
        document.title = newDoc.title;
      }

      // 2. Update page-specific stylesheets & <style> tags
      document.querySelectorAll('[data-spa-dynamic="true"]').forEach(el => el.remove());
      
      // Page <style> elements from <head>
      newDoc.querySelectorAll('head > style').forEach(styleEl => {
        const clonedStyle = document.createElement('style');
        clonedStyle.setAttribute('data-spa-dynamic', 'true');
        clonedStyle.textContent = styleEl.textContent;
        document.head.appendChild(clonedStyle);
      });

      // Page <link rel="stylesheet"> elements that aren't global
      newDoc.querySelectorAll('head > link[rel="stylesheet"]').forEach(linkEl => {
        const href = linkEl.getAttribute('href');
        if (href && !href.includes('/css/style.css')) {
          const existing = document.querySelector(`link[href="${href}"]`);
          if (!existing) {
            const clonedLink = document.createElement('link');
            clonedLink.rel = 'stylesheet';
            clonedLink.href = href;
            clonedLink.setAttribute('data-spa-dynamic', 'true');
            document.head.appendChild(clonedLink);
          }
        }
      });

      // 3. Swap main content
      currentMain.innerHTML = newMain.innerHTML;
      currentMain.className = newMain.className;
      currentMain.classList.remove('spa-view-fade-in');
      void currentMain.offsetWidth; // Trigger reflow for smooth animation
      currentMain.classList.add('spa-view-fade-in');

      // 4. Swap page-level modals located outside .main-content
      document.querySelectorAll('[data-spa-modal="true"]').forEach(el => el.remove());
      document.querySelectorAll('.app-container > .modal-overlay, .app-container > .modal-backdrop, body > .modal-overlay, body > .modal-backdrop').forEach(el => {
        if (!currentMain.contains(el)) el.remove();
      });

      const targetAppContainer = document.querySelector('.app-container') || document.body;
      newDoc.querySelectorAll('.modal-overlay, .modal-backdrop').forEach(modal => {
        if (!newMain.contains(modal)) {
          const clonedModal = modal.cloneNode(true);
          clonedModal.setAttribute('data-spa-modal', 'true');
          targetAppContainer.appendChild(clonedModal);
        }
      });

      // 5. Update browser history
      if (pushState) {
        window.history.pushState({ spa: true, url: targetUrl.href }, document.title, targetUrl.href);
      }

      // 6. Update sidebar active indicator smoothly
      updateSidebarActiveLink(targetPath);

      // 7. Close mobile sidebar if open
      const sidebar = document.getElementById('sidebar');
      const sidebarOverlay = document.getElementById('sidebar-overlay');
      if (sidebar) sidebar.classList.remove('active');
      if (sidebarOverlay) sidebarOverlay.classList.remove('active');

      // 8. Scroll view to top
      window.scrollTo(0, 0);

      this.setProgressBar(85);

      // 9. Execute new scripts
      await this.executeScripts(newDoc);

      this.setProgressBar(100);
      setTimeout(() => this.setProgressBar(0), 300);

    } catch (error) {
      console.error('SPA Navigation Error:', error);
      window.location.href = url;
    } finally {
      this.isNavigating = false;
    }
  },

  async executeScripts(newDoc) {
    const scripts = Array.from(newDoc.querySelectorAll('script'));

    for (const s of scripts) {
      const src = s.getAttribute('src');
      if (src) {
        // Skip global scripts already loaded
        if (src.includes('/js/api.js') || src.includes('/js/toast.js')) {
          continue;
        }
        // Load external script if not already in document
        if (!document.querySelector(`script[src="${src}"]`)) {
          await new Promise((resolve) => {
            const scriptTag = document.createElement('script');
            scriptTag.src = src;
            scriptTag.onload = resolve;
            scriptTag.onerror = resolve;
            document.head.appendChild(scriptTag);
          });
        }
      } else if (s.textContent.trim()) {
        try {
          const rawCode = s.textContent;
          // Find all declared top-level functions to expose them on window for inline HTML onclick handlers
          const funcNames = new Set();
          const funcRegex = /(?:^|\n)\s*(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(/g;
          let match;
          while ((match = funcRegex.exec(rawCode)) !== null) {
            funcNames.add(match[1]);
          }

          let exportsCode = '';
          funcNames.forEach(fn => {
            exportsCode += `\ntry { if (typeof ${fn} !== 'undefined') window['${fn}'] = ${fn}; } catch(e) {}\n`;
          });

          // Wrap in an async IIFE so let/const declarations are cleanly scoped and never conflict with global scope
          const wrappedCode = `(async function() {\n${rawCode}\n${exportsCode}\n})();`;
          (0, eval)(wrappedCode);
        } catch (err) {
          console.error('Error executing inline script:', err);
        }
      }
    }
  },

  setupLinkInterception() {
    document.addEventListener('click', (e) => {
      // 1. Check anchor tag
      const anchor = e.target.closest('a');
      if (anchor) {
        const href = anchor.getAttribute('href');
        if (href && (href.startsWith('/dashboard') || href.startsWith('/records') || href.startsWith('/patients') || href.startsWith('/search') || href.startsWith('/archives') || href.startsWith('/duplicates') || href.startsWith('/reports'))) {
          if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && anchor.target !== '_blank' && !anchor.hasAttribute('download') && !anchor.hasAttribute('data-no-spa')) {
            e.preventDefault();
            this.navigate(anchor.href, true);
            return;
          }
        }
      }

      // 2. Check cards or elements with data-href or role-link
      const card = e.target.closest('[data-spa-href], [data-href]');
      if (card) {
        const href = card.getAttribute('data-spa-href') || card.getAttribute('data-href');
        if (href && (href.startsWith('/dashboard') || href.startsWith('/records') || href.startsWith('/patients'))) {
          e.preventDefault();
          this.navigate(href, true);
        }
      }
    });
  },

  setupHistoryListener() {
    window.addEventListener('popstate', () => {
      this.navigate(window.location.href, false);
    });
  },

  setupGlobalHandlers() {
    // Global Logout button handler (ensures no duplicate confirmation dialogs)
    document.addEventListener('click', async (e) => {
      const logoutBtn = e.target.closest('#logout-btn');
      if (logoutBtn) {
        e.preventDefault();
        openLogoutModal();
      }
    });
  }
};

window.navigateTo = function(url) {
  return SpaRouter.navigate(url);
};

document.addEventListener('DOMContentLoaded', () => {
  SpaRouter.init();

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
