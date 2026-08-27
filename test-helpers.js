// Shared helpers for KEEP UP automated test suites

const TEST_CSRF_HEADER = 'x-csrf-token';

async function getCsrfToken(baseUrl) {
  const res = await fetch(`${baseUrl}/api/auth/csrf-token`);
  const data = await res.json();
  const cookieHeader = res.headers.get('set-cookie') || '';
  const match = cookieHeader.match(/csrf_token=([^;]+)/);
  if (!data.success || !match) {
    throw new Error('Failed to obtain CSRF token for tests.');
  }
  return { token: data.csrfToken, cookie: `csrf_token=${match[1]}` };
}

async function getCookieForUser(baseUrl, email, password, withCsrf = false) {
  let csrfCookie = '';
  let csrfToken = '';
  if (withCsrf) {
    const csrf = await getCsrfToken(baseUrl);
    csrfCookie = csrf.cookie;
    csrfToken = csrf.token;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (withCsrf) {
    headers[TEST_CSRF_HEADER] = csrfToken;
    headers['Cookie'] = csrfCookie;
  }

  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(`Login failed for ${email}: ${data.message}`);
  }
  const cookieHeader = res.headers.get('set-cookie') || '';
  const match = cookieHeader.match(/token=([^;]+)/);
  if (!match) throw new Error(`No auth cookie for ${email}`);
  const authCookie = `token=${match[1]}`;
  return {
    authCookie,
    cookieHeader: withCsrf ? `${authCookie}; ${csrfCookie}` : authCookie,
    csrfToken
  };
}

async function authFetch(baseUrl, path, { method = 'GET', authCookie, csrfToken, body, headers = {} } = {}) {
  const reqHeaders = { ...headers };
  if (body && !reqHeaders['Content-Type']) {
    reqHeaders['Content-Type'] = 'application/json';
  }
  if (csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) {
    reqHeaders[TEST_CSRF_HEADER] = csrfToken;
  }
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Cookie: authCookie,
      ...reqHeaders
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

function testServerEnv(port, extra = {}) {
  return {
    ...process.env,
    PORT: String(port),
    KEEPUP_TEST_MODE: 'true',
    ...extra
  };
}

module.exports = {
  TEST_CSRF_HEADER,
  getCsrfToken,
  getCookieForUser,
  authFetch,
  testServerEnv
};
