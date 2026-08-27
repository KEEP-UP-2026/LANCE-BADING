const { spawn } = require('child_process');
const { getCookieForUser, authFetch } = require('./test-helpers');

const TEST_PORT = 3009;
const BASE_URL = `http://localhost:${TEST_PORT}`;

async function runTests() {
  console.log('🧪 Starting Manual ITR Creation Test Suite on port ' + TEST_PORT + '...\n');
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
    console.log('1. Logging in as Records Staff...');
    const recordsAuth = await getCookieForUser(BASE_URL, 'records@keepup.com', 'Records123!', true);
    assert(!!recordsAuth.authCookie, 'Successfully logged in as Records Staff');

    // 3. Fetch patients list
    console.log('\n2. Fetching patients list...');
    const patientsRes = await authFetch(BASE_URL, '/api/patients?limit=5', {
      authCookie: recordsAuth.cookieHeader
    });
    const patientsData = await patientsRes.json();
    assert(patientsRes.status === 200, 'Patients API responded with 200');
    assert(Array.isArray(patientsData.patients) && patientsData.patients.length > 0, 'Found registered patients in database');

    const testPatient = patientsData.patients[0];
    console.log(`   Using patient: ${testPatient.first_name} ${testPatient.last_name} (ID: ${testPatient.id})`);

    // 4. Create Manual ITR Record
    console.log('\n3. Creating Manual ITR Document via POST /api/records/manual-create...');
    const mockStructuredData = {
      header: {
        country: 'Republic of the Philippines',
        province: 'Province of Laguna',
        municipality: 'Municipality of Paete',
        facility: 'PAETE RURAL HEALTH UNIT',
        facility_address: '2436 F. Sano Street, Brgy. Mayloong, Paete, Laguna',
        form_title: 'Individual Treatment Record',
        age_group: '20 Years old and above'
      },
      patient_demographics: {
        name: `${testPatient.first_name} ${testPatient.last_name}`,
        philhealth_no: '12-345678901-2',
        address: testPatient.address || 'Brgy. Maytoong, Paete, Laguna',
        civil_status: 'Married',
        birthday: '1990-05-15',
        age: 36,
        cp_no: '09123456789',
        educational_attainment: 'College',
        bhw: 'Maria Santos'
      },
      smoking_cessation_profile: {
        current: false,
        passive: true,
        never: false,
        stopped_gt_1_year: true,
        brand_of_cigarette: 'Marlboro',
        sticks_per_day: 5,
        years_smoking: 4,
        reason_for_smoking: 'Stress relief'
      },
      family_history: {
        hypertension: true,
        dm: true,
        asthma: false,
        cancer: false,
        kidney_disease: false
      },
      vital_signs: {
        bmi: 23.4,
        waistline_cm: 78,
        height_cm: 165,
        weight_kg: 64,
        raised_bp: 'No',
        blood_pressure_readings: {
          first: '120/80',
          second: '118/78'
        }
      },
      consultation_records: [
        {
          date: '2026-08-27',
          subjective_findings: 'Patient reports mild headache and fatigue for 2 days.',
          objective_findings: {
            notes: 'Clear breath sounds, normal vital signs.',
            blood_pressure: '120/80'
          },
          assessment_diagnosis: ['Tension Headache', 'Overfatigue'],
          plan_treatment: ['Paracetamol 500mg tab TID PRN', 'Adequate hydration and rest']
        }
      ]
    };

    const createPayload = {
      patient_id: testPatient.id,
      record_type: 'PATIENT_INFORMATION_SHEET',
      file_name: `ITR_Manual_${testPatient.patient_number || 'PAT001'}_${Date.now()}.pdf`,
      structured_json: mockStructuredData
    };

    const createRes = await authFetch(BASE_URL, '/api/records/manual-create', {
      method: 'POST',
      authCookie: recordsAuth.cookieHeader,
      csrfToken: recordsAuth.csrfToken,
      body: createPayload
    });

    const createData = await createRes.json();
    assert(createRes.status === 201, `Status is 201 Created (got ${createRes.status})`);
    assert(createData.success === true, 'Response success is true');
    assert(!!createData.record && !!createData.record.id, 'Record created with valid UUID');
    assert(createData.record.record_type === 'PATIENT_INFORMATION_SHEET', 'Record type is PATIENT_INFORMATION_SHEET');

    const createdId = createData.record.id;
    console.log(`   Created Record ID: ${createdId}`);

    // 5. Fetch Record Detail
    console.log('\n4. Verifying record via GET /api/records/detail/:id...');
    const detailRes = await authFetch(BASE_URL, `/api/records/detail/${createdId}`, {
      authCookie: recordsAuth.cookieHeader
    });
    const detailData = await detailRes.json();
    assert(detailRes.status === 200, 'Record detail status is 200');
    assert(detailData.success === true, 'Record detail success is true');
    assert(detailData.record.patient_id === testPatient.id, 'Record linked to correct patient ID');
    assert(!!detailData.record.structured_json, 'Record contains structured JSON data');
    assert(detailData.record.structured_json.patient_demographics.name === `${testPatient.first_name} ${testPatient.last_name}`, 'Demographics name matches');
    assert(detailData.record.extracted_text.includes('Tension Headache') || detailData.record.extracted_text.includes('headache'), 'Extracted text indexed consultation diagnosis');

    // 6. Verify Record in Category List
    console.log('\n5. Verifying record appears in GET /api/records/by-category?category=itr...');
    const catRes = await authFetch(BASE_URL, '/api/records/by-category?category=itr&limit=20', {
      authCookie: recordsAuth.cookieHeader
    });
    const catData = await catRes.json();
    assert(catRes.status === 200, 'Category list status is 200');
    assert(catData.success === true, 'Category list success is true');
    assert(Array.isArray(catData.records), 'Category records is an array');

    const foundInList = catData.records.find(r => r.id === createdId);
    assert(!!foundInList, 'Newly created manual ITR found in ITR category list');

    // 7. Verify Healthcare Personnel can read
    console.log('\n6. Verifying Healthcare Personnel can view the manual ITR...');
    const hcAuth = await getCookieForUser(BASE_URL, 'healthcare@keepup.com', 'Healthcare123!', true);
    const hcDetailRes = await authFetch(BASE_URL, `/api/records/detail/${createdId}`, {
      authCookie: hcAuth.cookieHeader
    });
    assert(hcDetailRes.status === 200, 'Healthcare Personnel can view record details (status 200)');

    // 7. Clean up created record
    console.log('\n7. Cleaning up test record...');
    const delRes = await authFetch(BASE_URL, `/api/records/${createdId}`, {
      method: 'DELETE',
      authCookie: recordsAuth.cookieHeader,
      csrfToken: recordsAuth.csrfToken
    });
    assert(delRes.status === 200, 'Test record successfully cleaned up');

    console.log(`\n========================================`);
    console.log(`Test Results: ${passCount} PASSED, ${failCount} FAILED`);
    console.log(`========================================\n`);

  } catch (err) {
    console.error('Test execution error:', err);
    failCount++;
  } finally {
    serverProcess.kill('SIGINT');
  }

  process.exit(failCount > 0 ? 1 : 0);
}

runTests();
