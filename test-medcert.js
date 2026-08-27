const { spawn } = require('child_process');
const { getCookieForUser, authFetch } = require('./test-helpers');

const TEST_PORT = 3009;
const BASE_URL = `http://localhost:${TEST_PORT}`;

async function runTests() {
  console.log('🧪 Starting Medical Certificate Test Suite on port ' + TEST_PORT + '...');
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

    // 3. Fetch patients
    console.log('\n2. Fetching patients list...');
    const patRes = await authFetch(BASE_URL, '/api/patients?limit=5', {
      authCookie: recordsAuth.cookieHeader
    });
    const patJson = await patRes.json();
    assert(patRes.status === 200 && patJson.success, 'Patients fetched successfully');
    const patients = patJson.patients || patJson.data || [];
    const testPatient = patients[0] || { id: 'patient-test-id', first_name: 'Juan', last_name: 'Dela Cruz' };
    console.log(`   Using patient: ${testPatient.first_name} ${testPatient.last_name} (${testPatient.id})`);

    // 4. Create Medical Certificate for LINKED patient
    console.log('\n3. Creating Medical Certificate for LINKED patient...');
    const linkedPayload = {
      patient_id: testPatient.id,
      record_type: 'MEDICAL_CERTIFICATE',
      file_name: `MedCert_Linked_${Date.now()}.pdf`,
      structured_json: {
        header: {
          facility: 'PAETE RURAL HEALTH UNIT',
          form_title: 'Medical Certificate (Sertipikong Medikal)'
        },
        patient_demographics: {
          name: `${testPatient.first_name} ${testPatient.last_name}`,
          age: 29,
          gender: 'Male',
          address: 'Paete, Laguna'
        },
        clinical_findings: {
          examination_date: '2026-08-27',
          diagnosis: 'Acute Upper Respiratory Tract Infection (URTI)',
          symptoms: 'Fever (38.5C), productive cough, sore throat'
        },
        medical_opinion: {
          fitness_status: 'Needs Rest / Sick Leave',
          sick_leave_days: 3,
          resume_date: '2026-08-30',
          restrictions: 'Avoid heavy lifting, rest indoors',
          remarks: 'Complete prescribed antibiotic course and increase fluid intake'
        },
        physician_details: {
          physician_name: 'Dr. Maria Santos, MD',
          prc_license_number: 'PRC-0098765',
          ptr_number: 'PTR-1234567',
          facility_name: 'PAETE RURAL HEALTH UNIT'
        }
      }
    };

    const linkedRes = await authFetch(BASE_URL, '/api/records/manual-create', {
      method: 'POST',
      authCookie: recordsAuth.cookieHeader,
      csrfToken: recordsAuth.csrfToken,
      body: linkedPayload
    });
    const linkedJson = await linkedRes.json();
    assert(linkedRes.status === 201 && linkedJson.success, 'Linked Medical Certificate created successfully');
    assert(linkedJson.record && linkedJson.record.record_type === 'MEDICAL_CERTIFICATE', 'Record type is MEDICAL_CERTIFICATE');

    // 5. Create Medical Certificate for WALK-IN patient (no patient_id provided)
    console.log('\n4. Creating Medical Certificate for WALK-IN patient (no patient_id)...');
    const walkinPayload = {
      record_type: 'MEDICAL_CERTIFICATE',
      patient_name: 'Rosa Delos Santos',
      file_name: `MedCert_Rosa_${Date.now()}.pdf`,
      structured_json: {
        header: {
          facility: 'PAETE RURAL HEALTH UNIT',
          form_title: 'Medical Certificate (Sertipikong Medikal)'
        },
        patient_demographics: {
          name: 'Rosa Delos Santos',
          age: 34,
          gender: 'Female',
          address: 'Brgy. Quinale, Paete, Laguna',
          contact_number: '09187654321'
        },
        clinical_findings: {
          examination_date: '2026-08-27',
          diagnosis: 'Acute Bronchitis & Physical Exhaustion',
          symptoms: 'Persistent cough, mild chest discomfort, fatigue'
        },
        medical_opinion: {
          fitness_status: 'Fit to Resume Normal Activities',
          sick_leave_days: 2,
          resume_date: '2026-08-29',
          restrictions: 'Avoid dusty environment',
          remarks: 'Adequate hydration and oral bronchodilator'
        },
        physician_details: {
          physician_name: 'Dr. Juan Reyes, MD',
          prc_license_number: 'PRC-0054321',
          ptr_number: 'PTR-7654321',
          facility_name: 'PAETE RURAL HEALTH UNIT'
        }
      }
    };

    const walkinRes = await authFetch(BASE_URL, '/api/records/manual-create', {
      method: 'POST',
      authCookie: recordsAuth.cookieHeader,
      csrfToken: recordsAuth.csrfToken,
      body: walkinPayload
    });
    const walkinJson = await walkinRes.json();
    assert(walkinRes.status === 201 && walkinJson.success, 'Walk-in Medical Certificate created without prior patient_id');
    assert(walkinJson.record && walkinJson.record.patient_id, 'Walk-in record was linked/assigned a valid patient ID');

    // 6. Test GET /api/records/by-category?category=MEDICAL_CERTIFICATE
    console.log('\n5. Testing GET /api/records/by-category for MEDICAL_CERTIFICATE...');
    const catRes = await authFetch(BASE_URL, '/api/records/by-category?category=MEDICAL_CERTIFICATE', {
      authCookie: recordsAuth.cookieHeader
    });
    const catJson = await catRes.json();
    assert(catRes.status === 200 && catJson.success, 'GET by-category MEDICAL_CERTIFICATE returned 200 OK');
    assert(catJson.category_label === 'Medical Certificate', `Category label is "Medical Certificate" (got "${catJson.category_label}")`);
    assert(catJson.stats && catJson.stats.total_records >= 2, `Total medical certificates >= 2 (got ${catJson.stats ? catJson.stats.total_records : 0})`);

    // 7. Test category alias 'medcert'
    console.log('\n6. Testing category alias "medcert"...');
    const aliasRes = await authFetch(BASE_URL, '/api/records/by-category?category=medcert', {
      authCookie: recordsAuth.cookieHeader
    });
    const aliasJson = await aliasRes.json();
    assert(aliasRes.status === 200 && aliasJson.category_label === 'Medical Certificate', 'Category alias "medcert" normalized to Medical Certificate');

    // 8. Test Search for created MedCert
    console.log('\n7. Testing search within MEDICAL_CERTIFICATE category...');
    const searchRes = await authFetch(BASE_URL, '/api/records/by-category?category=MEDICAL_CERTIFICATE&search=Bronchitis', {
      authCookie: recordsAuth.cookieHeader
    });
    const searchJson = await searchRes.json();
    assert(searchRes.status === 200 && searchJson.records.length > 0, `Search for "Bronchitis" returned results (got ${searchJson.records.length})`);
    assert(searchJson.records.some(r => r.extracted_text_preview.includes('Bronchitis') || (r.patient_name && r.patient_name.includes('Rosa'))), 'Extracted text preview contains matching keywords');

    // 9. Cleanup test records
    if (linkedJson && linkedJson.record && linkedJson.record.id) {
      await authFetch(BASE_URL, `/api/records/${linkedJson.record.id}`, {
        method: 'DELETE',
        authCookie: recordsAuth.cookieHeader,
        csrfToken: recordsAuth.csrfToken
      });
    }
    if (walkinJson && walkinJson.record && walkinJson.record.id) {
      await authFetch(BASE_URL, `/api/records/${walkinJson.record.id}`, {
        method: 'DELETE',
        authCookie: recordsAuth.cookieHeader,
        csrfToken: recordsAuth.csrfToken
      });
      if (walkinJson.record.patient_id) {
        await authFetch(BASE_URL, `/api/patients/${walkinJson.record.patient_id}`, {
          method: 'DELETE',
          authCookie: recordsAuth.cookieHeader,
          csrfToken: recordsAuth.csrfToken
        });
      }
    }

    console.log(`\n========================================`);
    console.log(`📊 Test Results: ${passCount} Passed, ${failCount} Failed`);
    console.log(`========================================`);

    if (failCount > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('❌ Test suite encountered error:', err);
    process.exitCode = 1;
  } finally {
    serverProcess.kill('SIGTERM');
  }
}

runTests();
