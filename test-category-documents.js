const { spawn } = require('child_process');
const { getCookieForUser, authFetch } = require('./test-helpers');

const TEST_PORT = 3008;
const BASE_URL = `http://localhost:${TEST_PORT}`;

async function runTests() {
  console.log('🧪 Starting Category Documents Test Suite on port ' + TEST_PORT + '...');
  let passCount = 0;
  let failCount = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passCount++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failCount++;
    }
  }

  // 1. Spawn test server
  const serverProcess = spawn('node', ['server.js'], {
    env: { ...process.env, PORT: String(TEST_PORT), KEEPUP_TEST_MODE: 'true' },
    stdio: 'pipe'
  });

  serverProcess.stderr.on('data', d => console.error(`[SERVER ERR] ${d}`));

  // Wait for server to start
  await new Promise((resolve) => {
    serverProcess.stdout.on('data', (d) => {
      if (d.toString().includes('running on port')) {
        resolve();
      }
    });
    setTimeout(resolve, 3000);
  });

  try {
    // 2. Authenticate as Records Staff
    console.log('\n1. Logging in as Records Staff...');
    const recordsAuth = await getCookieForUser(BASE_URL, 'records@keepup.com', 'Records123!', true);
    assert(!!recordsAuth.authCookie, 'Successfully logged in as Records Staff');

    // 3. Test Category API - Individual Treatment Record (PATIENT_INFORMATION_SHEET)
    console.log('\n2. Testing GET /api/records/by-category for ITR...');
    const itrRes = await authFetch(BASE_URL, '/api/records/by-category?category=PATIENT_INFORMATION_SHEET', {
      authCookie: recordsAuth.cookieHeader
    });
    const itrData = await itrRes.json();
    assert(itrRes.status === 200, `Status is 200 (got ${itrRes.status})`);
    assert(itrData.success === true, 'Response success is true');
    assert(itrData.category === 'PATIENT_INFORMATION_SHEET', 'Category normalized correctly');
    assert(typeof itrData.stats.total_records === 'number', 'Stats total_records is number');
    assert(Array.isArray(itrData.records), 'Records is an array');
    console.log(`   Found ${itrData.records.length} ITR records (total stats: ${itrData.stats.total_records})`);

    // 4. Test Category API - Consultation Records
    console.log('\n3. Testing GET /api/records/by-category for CONSULTATION_RECORD...');
    const consultRes = await authFetch(BASE_URL, '/api/records/by-category?category=CONSULTATION_RECORD', {
      authCookie: recordsAuth.cookieHeader
    });
    const consultData = await consultRes.json();
    assert(consultRes.status === 200, `Status is 200 (got ${consultRes.status})`);
    assert(consultData.success === true, 'Response success is true');
    assert(consultData.category === 'CONSULTATION_RECORD', 'Category is CONSULTATION_RECORD');
    console.log(`   Found ${consultData.records.length} consultation records`);

    // 5. Test Category API - Immunizations
    console.log('\n4. Testing GET /api/records/by-category for IMMUNIZATION_RECORD...');
    const immRes = await authFetch(BASE_URL, '/api/records/by-category?category=IMMUNIZATION_RECORD', {
      authCookie: recordsAuth.cookieHeader
    });
    const immData = await immRes.json();
    assert(immRes.status === 200, `Status is 200 (got ${immRes.status})`);
    assert(immData.success === true, 'Response success is true');
    assert(immData.category === 'IMMUNIZATION_RECORD', 'Category is IMMUNIZATION_RECORD');
    console.log(`   Found ${immData.records.length} immunization records`);

    // 6. Test Search & Filter on Category Documents API
    console.log('\n5. Testing Search and Filter on /api/records/by-category...');
    const searchRes = await authFetch(BASE_URL, '/api/records/by-category?category=ALL&search=a', {
      authCookie: recordsAuth.cookieHeader
    });
    const searchData = await searchRes.json();
    assert(searchRes.status === 200, 'Search request succeeded');
    assert(searchData.success === true, 'Search returned success true');
    assert(Array.isArray(searchData.records), 'Search records is array');

    // 7. Test HTML Routes for Document Binders
    console.log('\n6. Testing HTML Routes for Document Binders...');
    const routes = [
      '/dashboard/documents',
      '/dashboard/documents/itr',
      '/dashboard/documents/consultations',
      '/dashboard/documents/immunizations'
    ];

    for (const route of routes) {
      const pageRes = await authFetch(BASE_URL, route, {
        authCookie: recordsAuth.cookieHeader
      });
      const pageText = await pageRes.text();
      assert(pageRes.status === 200, `Route ${route} returned status 200`);
      assert(pageText.includes('Document Binders') || pageText.includes('KEEP UP'), `Route ${route} served document view HTML`);
    }

    console.log(`\n========================================`);
    console.log(`Test Summary: ${passCount} passed, ${failCount} failed.`);
    console.log(`========================================`);

  } finally {
    serverProcess.kill('SIGTERM');
  }

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests();
