// KEEP UP System - Final 25-Step Core Walkthrough (Synthetic Dataset)
// Runs end-to-end verification with fresh test data and records evidence.

const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

const TEST_PORT = 3003;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const RUN_ID = `WALK25-${Date.now().toString(36).toUpperCase()}`;

const results = [];

function recordStep(id, role, input, expected, actual, status, evidence = '') {
  results.push({ id, role, input, expected, actual, status, evidence });
  const icon = status === 'PASS' ? '✅' : '❌';
  console.log(`${icon} Step ${id}: ${status} — ${actual}`);
  if (status === 'FAIL') {
    throw new Error(`Step ${id} failed: expected "${expected}", got "${actual}"`);
  }
}

async function getCookieForUser(email, password) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!data.success) throw new Error(`Login failed for ${email}: ${data.message}`);
  const cookieHeader = res.headers.get('set-cookie');
  const match = cookieHeader.match(/token=([^;]+)/);
  return match[1];
}

function createTestImage(text, filePath) {
  const canvas = createCanvas(500, 100);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 500, 100);
  ctx.fillStyle = '#000000';
  ctx.font = '22px Arial';
  ctx.fillText(text, 10, 55);
  fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
}

async function runWalkthrough() {
  console.log('\n==================================================');
  console.log('   KEEP UP FINAL 25-STEP CORE WALKTHROUGH');
  console.log(`   Run ID: ${RUN_ID}`);
  console.log('==================================================\n');

  let serverProcess;
  const scratchDir = path.join(process.cwd(), 'scratch');
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

  const imgPath = path.join(scratchDir, `${RUN_ID}-maternal.png`);
  createTestImage(`maternal prenatal care pregnancy ${RUN_ID} Paete RHU`, imgPath);

  let adminToken, recordsToken, healthcareToken, staffToken;
  let patientAId, patientBId, recordId, duplicateFlagId, tempToken;

  try {
    serverProcess = spawn('node', ['server.js'], {
      env: { ...process.env, PORT: TEST_PORT, FORCE_LOCAL_DB: 'true', KEEPUP_TEST_MODE: 'true' }
    });
    const logStream = fs.createWriteStream(path.join(process.cwd(), 'walkthrough-server.log'));
    serverProcess.stdout.pipe(logStream);
    serverProcess.stderr.pipe(logStream);
    await new Promise(r => setTimeout(r, 8000));

    // STEP 1 — Admin login
    adminToken = await getCookieForUser('admin@keepup.com', 'Admin123!');
    const adminMe = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Cookie: `token=${adminToken}` } });
    const adminMeData = await adminMe.json();
    recordStep(1, 'RHU_ADMINISTRATOR', 'admin@keepup.com / Admin123!', 'Login success', adminMeData.user.role, adminMeData.success ? 'PASS' : 'FAIL', `role=${adminMeData.user.role}`);

    // STEP 2 — Admin list users
    const usersRes = await fetch(`${BASE_URL}/api/users`, { headers: { Cookie: `token=${adminToken}` } });
    const usersData = await usersRes.json();
    recordStep(2, 'RHU_ADMINISTRATOR', 'GET /api/users', '200 + user list', `${usersRes.status}, count=${usersData.users.length}`, usersRes.status === 200 && usersData.users.length >= 4 ? 'PASS' : 'FAIL');

    // STEP 3 — Admin audit logs access
    const auditRes = await fetch(`${BASE_URL}/api/reports/audit-logs`, { headers: { Cookie: `token=${adminToken}` } });
    const auditData = await auditRes.json();
    recordStep(3, 'RHU_ADMINISTRATOR', 'GET /api/reports/audit-logs', '200 + logs array', `${auditRes.status}, logs=${auditData.logs.length}`, auditRes.status === 200 && Array.isArray(auditData.logs) ? 'PASS' : 'FAIL');

    // STEP 4 — Records staff login
    recordsToken = await getCookieForUser('records@keepup.com', 'Records123!');
    recordStep(4, 'RECORDS_STAFF', 'records@keepup.com / Records123!', 'Login success', 'RECORDS_STAFF', recordsToken ? 'PASS' : 'FAIL');

    // STEP 5 — Create patient A
    const createA = await fetch(`${BASE_URL}/api/patients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${recordsToken}` },
      body: JSON.stringify({
        first_name: 'Maria',
        middle_name: 'S.',
        last_name: `Santos-${RUN_ID}`,
        birth_date: '1992-03-14',
        sex: 'FEMALE',
        address: `Brgy. Ibaba, Paete ${RUN_ID}`,
        contact_number: '09171234567'
      })
    });
    const createAData = await createA.json();
    patientAId = createAData.patient.id;
    recordStep(5, 'RECORDS_STAFF', `Create Maria Santos-${RUN_ID}`, '201 + patient id', `${createA.status}, id=${patientAId}`, createA.status === 201 ? 'PASS' : 'FAIL', `patient_number=${createAData.patient.patient_number}`);

    // STEP 6 — Create patient B (duplicate candidate)
    const createB = await fetch(`${BASE_URL}/api/patients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${recordsToken}` },
      body: JSON.stringify({
        first_name: 'Maria',
        middle_name: 'S',
        last_name: `Santos-${RUN_ID}`,
        birth_date: '1992-03-14',
        sex: 'FEMALE',
        address: `Brgy Ibaba Paete ${RUN_ID}`,
        contact_number: '09171234567'
      })
    });
    const createBData = await createB.json();
    patientBId = createBData.patient.id;
    recordStep(6, 'RECORDS_STAFF', `Create near-duplicate Maria S Santos-${RUN_ID}`, '201 + patient id', `${createB.status}, id=${patientBId}`, createB.status === 201 ? 'PASS' : 'FAIL');

    // STEP 7 — Edit patient A
    const updateA = await fetch(`${BASE_URL}/api/patients/${patientAId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${recordsToken}` },
      body: JSON.stringify({
        first_name: 'Maria',
        middle_name: 'S.',
        last_name: `Santos-${RUN_ID}`,
        birth_date: '1992-03-14',
        sex: 'FEMALE',
        address: `Updated address Paete ${RUN_ID}`,
        contact_number: '09171234567'
      })
    });
    const updateAData = await updateA.json();
    recordStep(7, 'RECORDS_STAFF', 'PUT patient demographics', 'Address updated', updateAData.patient.address, updateA.status === 200 && updateAData.patient.address.includes('Updated') ? 'PASS' : 'FAIL');

    // STEP 8 — OCR preview (maternal care image)
    const boundary = '----WalkthroughBoundary';
    const uploadBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="patient_id"\r\n\r\n${patientAId}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${RUN_ID}-maternal.png"\r\nContent-Type: image/png\r\n\r\n`),
      fs.readFileSync(imgPath),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const ocrRes = await fetch(`${BASE_URL}/api/records/ocr-preview`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, Cookie: `token=${recordsToken}` },
      body: uploadBody
    });
    const ocrData = await ocrRes.json();
    tempToken = ocrData.token;
    recordStep(8, 'RECORDS_STAFF', 'POST /api/records/ocr-preview', 'Preview token + category', `${ocrRes.status}, token=${!!tempToken}, cat=${ocrData.preview.suggested_category}`, ocrRes.status === 200 && tempToken ? 'PASS' : 'FAIL', `suggested=${ocrData.preview.suggested_category}`);

    // STEP 9 — Confirm upload with corrected OCR
    const correctedText = `Verified maternal care record ${RUN_ID} prenatal visit Paete RHU`;
    const confirmRes = await fetch(`${BASE_URL}/api/records/confirm-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${recordsToken}` },
      body: JSON.stringify({
        token: tempToken,
        file_name: `${RUN_ID}-maternal.png`,
        record_type: 'MATERNAL_CARE_RECORD',
        extracted_text: correctedText
      })
    });
    const confirmData = await confirmRes.json();
    recordId = confirmData.record.id;
    recordStep(9, 'RECORDS_STAFF', 'POST /api/records/confirm-upload', 'Record saved with corrected text', `${confirmRes.status}, text match`, confirmRes.status === 201 && confirmData.record.extracted_text === correctedText ? 'PASS' : 'FAIL', `record_id=${recordId}`);

    // STEP 10 — View patient records
    const recListRes = await fetch(`${BASE_URL}/api/records/patient/${patientAId}`, { headers: { Cookie: `token=${recordsToken}` } });
    const recListData = await recListRes.json();
    recordStep(10, 'RECORDS_STAFF', 'GET patient records', 'MATERNAL record listed', `count=${recListData.records.length}`, recListData.records.some(r => r.id === recordId) ? 'PASS' : 'FAIL');

    // STEP 11 — Edit metadata
    const metaRes = await fetch(`${BASE_URL}/api/records/${recordId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${recordsToken}` },
      body: JSON.stringify({ file_name: `${RUN_ID}-maternal-final.png`, record_type: 'MATERNAL_CARE_RECORD' })
    });
    const metaData = await metaRes.json();
    recordStep(11, 'RECORDS_STAFF', 'PUT record metadata', 'Filename updated', metaData.record.file_name, metaRes.status === 200 && metaData.record.file_name.includes('final') ? 'PASS' : 'FAIL');

    // STEP 12 — Secure download
    const dlRes = await fetch(`${BASE_URL}/api/records/download/${recordId}`, { headers: { Cookie: `token=${recordsToken}` } });
    recordStep(12, 'RECORDS_STAFF', 'GET download by record id', '200 file served', String(dlRes.status), dlRes.status === 200 ? 'PASS' : 'FAIL');

    // STEP 13 — Search verified OCR text
    const searchRes = await fetch(`${BASE_URL}/api/search?q=${encodeURIComponent(RUN_ID)}`, { headers: { Cookie: `token=${recordsToken}` } });
    const searchData = await searchRes.json();
    const foundRecord = searchData.records.find(r => r.id === recordId);
    recordStep(13, 'RECORDS_STAFF', `Search q=${RUN_ID}`, 'Record found via OCR', foundRecord ? 'found' : 'missing', foundRecord ? 'PASS' : 'FAIL');

    // STEP 14 — Duplicate warnings present
    const dupRes = await fetch(`${BASE_URL}/api/duplicates`, { headers: { Cookie: `token=${recordsToken}` } });
    const dupData = await dupRes.json();
    duplicateFlagId = (dupData.flags || []).find(f =>
      (f.patient_id === patientAId && f.possible_duplicate_patient_id === patientBId) ||
      (f.patient_id === patientBId && f.possible_duplicate_patient_id === patientAId)
    )?.id;
    recordStep(14, 'RECORDS_STAFF', 'GET /api/duplicates', 'Duplicate flag for pair', duplicateFlagId || 'none', duplicateFlagId ? 'PASS' : 'FAIL', `flag=${duplicateFlagId}`);

    // STEP 15 — Merge patients (A primary)
    const mergeRes = await fetch(`${BASE_URL}/api/duplicates/${duplicateFlagId}/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${recordsToken}` },
      body: JSON.stringify({ primary_patient_id: patientAId, merge_fields: {} })
    });
    const mergeData = await mergeRes.json();
    const mergedB = await fetch(`${BASE_URL}/api/patients/${patientBId}`, { headers: { Cookie: `token=${recordsToken}` } });
    const mergedBData = await mergedB.json();
    recordStep(15, 'RECORDS_STAFF', 'POST merge duplicates', 'Merge success + B archived', `${mergeData.success}, B=${mergedBData.patient.status}`, mergeRes.status === 200 && mergeData.success && mergedBData.patient.status === 'ARCHIVED' ? 'PASS' : 'FAIL', `flag=${duplicateFlagId}`);

    // STEP 16 — Archive document
    const archRecRes = await fetch(`${BASE_URL}/api/records/${recordId}/archive`, {
      method: 'PUT',
      headers: { Cookie: `token=${recordsToken}` }
    });
    const archRecData = await archRecRes.json();
    recordStep(16, 'RECORDS_STAFF', 'PUT archive record', 'Record archived', archRecData.record.status, archRecRes.status === 200 && archRecData.record.status === 'ARCHIVED' ? 'PASS' : 'FAIL');

    // STEP 17 — Archive patient A (after merge, test restore flow on B)
    const archPatRes = await fetch(`${BASE_URL}/api/patients/${patientAId}/archive`, {
      method: 'PUT',
      headers: { Cookie: `token=${recordsToken}` }
    });
    recordStep(17, 'RECORDS_STAFF', 'PUT archive patient A', '200 archived', String(archPatRes.status), archPatRes.status === 200 ? 'PASS' : 'FAIL');

    // STEP 18 — Restore patient B
    const restoreRes = await fetch(`${BASE_URL}/api/patients/${patientBId}/restore`, {
      method: 'PUT',
      headers: { Cookie: `token=${recordsToken}` }
    });
    const restoreData = await restoreRes.json();
    recordStep(18, 'RECORDS_STAFF', 'PUT restore patient B', 'ACTIVE status', restoreData.patient.status, restoreRes.status === 200 && restoreData.patient.status === 'ACTIVE' ? 'PASS' : 'FAIL');

    // STEP 19 — Healthcare personnel read access
    healthcareToken = await getCookieForUser('healthcare@keepup.com', 'Healthcare123!');
    const hcPatientRes = await fetch(`${BASE_URL}/api/patients`, { headers: { Cookie: `token=${healthcareToken}` } });
    recordStep(19, 'HEALTHCARE_PERSONNEL', 'GET /api/patients', '200 read list', String(hcPatientRes.status), hcPatientRes.status === 200 ? 'PASS' : 'FAIL');

    const hcSearchRes = await fetch(`${BASE_URL}/api/search?q=Maria`, { headers: { Cookie: `token=${healthcareToken}` } });
    recordStep(20, 'HEALTHCARE_PERSONNEL', 'GET /api/search', '200 search allowed', String(hcSearchRes.status), hcSearchRes.status === 200 ? 'PASS' : 'FAIL');

    // STEP 21 — Healthcare blocked from write
    const hcWriteRes = await fetch(`${BASE_URL}/api/patients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `token=${healthcareToken}` },
      body: JSON.stringify({ first_name: 'X', last_name: 'Y', birth_date: '2000-01-01', sex: 'MALE', address: 'Z' })
    });
    recordStep(21, 'HEALTHCARE_PERSONNEL', 'POST create patient', '403 forbidden', String(hcWriteRes.status), hcWriteRes.status === 403 ? 'PASS' : 'FAIL');

    // STEP 22 — Administrative staff reports
    staffToken = await getCookieForUser('staff@keepup.com', 'Staff123!');
    const repRes = await fetch(`${BASE_URL}/api/reports/data`, { headers: { Cookie: `token=${staffToken}` } });
    const repData = await repRes.json();
    recordStep(22, 'ADMINISTRATIVE_STAFF', 'GET /api/reports/data', '200 report payload', `${repRes.status}, patients=${repData.report.patientSummary.total}`, repRes.status === 200 && repData.report ? 'PASS' : 'FAIL');

    // STEP 23 — Staff blocked from audit logs
    const staffAuditRes = await fetch(`${BASE_URL}/api/reports/audit-logs`, { headers: { Cookie: `token=${staffToken}` } });
    recordStep(23, 'ADMINISTRATIVE_STAFF', 'GET audit logs', '403 forbidden', String(staffAuditRes.status), staffAuditRes.status === 403 ? 'PASS' : 'FAIL');

    // STEP 24 — Inactive user blocked
    const inactiveRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'inactive@keepup.com', password: 'Inactive123!' })
    });
    recordStep(24, 'INACTIVE', 'Login inactive account', '403 disabled', String(inactiveRes.status), inactiveRes.status === 403 ? 'PASS' : 'FAIL');

    // STEP 25 — Logout + anonymous blocked
    await fetch(`${BASE_URL}/api/auth/logout`, { method: 'POST', headers: { Cookie: `token=${recordsToken}` } });
    const anonDl = await fetch(`${BASE_URL}/api/records/download/${recordId}`);
    recordStep(25, 'Anonymous', 'Download after logout', '401 unauthorized', String(anonDl.status), anonDl.status === 401 ? 'PASS' : 'FAIL');

    // Write evidence file
    const reportPath = path.join(process.cwd(), `walkthrough-results-${RUN_ID}.json`);
    fs.writeFileSync(reportPath, JSON.stringify({ runId: RUN_ID, timestamp: new Date().toISOString(), results }, null, 2));

    console.log('\n==================================================');
    console.log(`ALL 25 WALKTHROUGH STEPS PASSED (${RUN_ID})`);
    console.log(`Evidence saved: ${reportPath}`);
    console.log('==================================================\n');
  } catch (err) {
    console.error('\n❌ WALKTHROUGH FAILURE:', err.message);
    const reportPath = path.join(process.cwd(), `walkthrough-results-${RUN_ID}.json`);
    fs.writeFileSync(reportPath, JSON.stringify({ runId: RUN_ID, timestamp: new Date().toISOString(), results, error: err.message }, null, 2));
    process.exitCode = 1;
  } finally {
    try { if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath); } catch (_) {}
    if (serverProcess) {
      console.log('Stopping walkthrough server...');
      serverProcess.kill();
    }
  }
}

runWalkthrough();
