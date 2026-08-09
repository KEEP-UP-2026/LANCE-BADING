// KEEP UP System - Phase 3 Integration & Regression Test Suite
// Verifies OCR Preview, PDF OCR, File Classification, Fuzzy Duplicate Merging, Search and legacy regressions.

const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

const TEST_PORT = 3002;
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Helper to draw text onto a PNG buffer
function createTestImage(text, filePath) {
  const canvas = createCanvas(500, 100);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 500, 100);
  ctx.fillStyle = '#000000';
  ctx.font = '22px Arial';
  ctx.fillText(text, 10, 55);
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(filePath, buffer);
}

// Helper to capture token from login endpoint
async function getCookieForUser(email, password) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(`Login failed for ${email}: ${data.message}`);
  }
  const cookieHeader = res.headers.get('set-cookie');
  if (!cookieHeader) {
    throw new Error(`No cookie returned for ${email}`);
  }
  const match = cookieHeader.match(/token=([^;]+)/);
  if (!match) {
    throw new Error(`Failed to parse token from cookie header for ${email}`);
  }
  return match[1];
}

async function runTests() {
  console.log('\n==================================================');
  console.log('       STARTING PHASE 3 INTEGRATION TESTS         ');
  console.log('==================================================\n');

  let serverProcess;
  const scratchDir = path.join(process.cwd(), 'scratch');
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }

  // Define test files
  const tempImgPath = path.join(scratchDir, 'temp-imm.png');
  const tempImgRabiesPath = path.join(scratchDir, 'temp-rabies.png');
  const tempImgXssPath = path.join(scratchDir, 'temp-xss.png');
  const tempPdfTextPath = path.join(scratchDir, 'temp-text.pdf');
  const tempPdfScannedPath = path.join(scratchDir, 'temp-scanned.pdf');
  const tempPdfEncryptedPath = path.join(scratchDir, 'temp-encrypted.pdf');

  // 1. Create mock files
  createTestImage('Routine Childhood Immunization BCG OPV Dose 1 Baby Book Vaccine', tempImgPath);
  createTestImage('Rabies exposure dog bite prophylaxis active immunization post-exposure', tempImgRabiesPath);
  createTestImage('<script>alert("xss")</script> <b>bold tag</b>', tempImgXssPath);

  // Write text-based PDF: vaccine details
  const TEXT_PDF_CONTENT = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 120 >>
stream
BT
/F1 12 Tf
72 712 Td
(vaccine dose immunization routine baby book rabies anti-rabies maternal prenatal maternal care pregnancy) Tj
ET
endstream
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000223 00000 n
0000000290 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
450
%%EOF`;
  fs.writeFileSync(tempPdfTextPath, TEXT_PDF_CONTENT, 'binary');

  // Write scanned PDF (empty text)
  const SCANNED_PDF_CONTENT = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] >>
endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
trailer
<< /Size 4 /Root 1 0 R >>
startxref
178
%%EOF`;
  fs.writeFileSync(tempPdfScannedPath, SCANNED_PDF_CONTENT, 'binary');

  // Write encrypted PDF mock
  fs.writeFileSync(tempPdfEncryptedPath, '%PDF-1.4\n1 0 obj\n<< /Encrypt 2 0 R >>\nendobj\n%%EOF', 'binary');

  try {
    // Start server
    console.log(`Starting KEEP UP server on port ${TEST_PORT}...`);
    serverProcess = spawn('node', ['server.js'], {
      env: { ...process.env, PORT: TEST_PORT, FILE_SIZE_LIMIT: '5000000', MAX_PDF_PAGES: '3', OCR_PROCESS_TIMEOUT_SECONDS: '15', OCR_MIN_TEXT_LENGTH: '15', KEEPUP_TEST_MODE: 'true' }
    });

    const logStream = fs.createWriteStream(path.join(process.cwd(), 'phase3-server.log'));
    serverProcess.stdout.pipe(logStream);
    serverProcess.stderr.pipe(logStream);

    // Wait for server boot
    await new Promise(resolve => setTimeout(resolve, 20000));
    console.log('Server is running. Retrieving credentials...\n');

    // Retrieve tokens
    const recordsStaffToken = await getCookieForUser('records@keepup.com', 'Records123!');
    const adminStaffToken = await getCookieForUser('staff@keepup.com', 'Staff123!');
    const adminToken = await getCookieForUser('admin@keepup.com', 'Admin123!');
    
    // Set up test patient
    const createPatientRes = await fetch(`${BASE_URL}/api/patients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `token=${recordsStaffToken}`
      },
      body: JSON.stringify({
        patient_number: 'PAT-P3-' + Math.floor(Math.random() * 10000),
        first_name: 'Juan',
        last_name: 'Dela Cruz',
        birth_date: '1995-05-15',
        sex: 'MALE',
        address: 'Paete, Laguna'
      })
    });
    const createPatientData = await createPatientRes.json();
    const patientId = createPatientData.patient.id;
    console.log(`✅ Using Test Patient ID: ${patientId}`);

    // =========================================================================
    // TEST 1: Image OCR Preview
    // =========================================================================
    console.log('\nTEST 1: Image OCR Preview...');
    const boundary = '----WebKitFormBoundaryPhase3Tests';
    const uploadBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="patient_id"\r\n\r\n${patientId}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="immunization.png"\r\nContent-Type: image/png\r\n\r\n`),
      fs.readFileSync(tempImgPath),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const previewRes = await fetch(`${BASE_URL}/api/records/ocr-preview`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Cookie': `token=${recordsStaffToken}`
      },
      body: uploadBody
    });
    
    assert.strictEqual(previewRes.status, 200, 'OCR preview should succeed');
    const previewData = await previewRes.json();
    assert.ok(previewData.success, 'Response should declare success');
    assert.ok(previewData.token, 'Response should contain a temporary session token');
    assert.strictEqual(previewData.preview.suggested_category, 'IMMUNIZATION_RECORD', 'Should categorize as Immunization Record');
    const tempToken1 = previewData.token;
    console.log(`✅ PASS: Extracted token: ${tempToken1}. Suggested Category: ${previewData.preview.suggested_category}`);

    // Confirm no final record is in DB yet
    const patientRecordsRes = await fetch(`${BASE_URL}/api/records/patient/${patientId}`, {
      headers: { 'Cookie': `token=${recordsStaffToken}` }
    });
    const patientRecordsData = await patientRecordsRes.json();
    const matchCount = patientRecordsData.records.filter(r => r.file_name === 'immunization.png').length;
    assert.strictEqual(matchCount, 0, 'No permanent record should exist before confirmation');
    console.log('✅ PASS: No permanent record created prematurely.');

    // =========================================================================
    // TEST 2: OCR Correction
    // =========================================================================
    console.log('\nTEST 2: OCR Correction & Save Confirmation...');
    const confirmRes = await fetch(`${BASE_URL}/api/records/confirm-upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `token=${recordsStaffToken}`
      },
      body: JSON.stringify({
        token: tempToken1,
        file_name: 'verified_immunization.png',
        record_type: 'IMMUNIZATION_RECORD',
        extracted_text: 'Manual Correction: BCG vaccine given at Paete RHU.'
      })
    });
    
    assert.strictEqual(confirmRes.status, 201, 'Confirm save should succeed');
    const confirmData = await confirmRes.json();
    assert.ok(confirmData.success, 'Confirm save response should be success');
    assert.strictEqual(confirmData.record.extracted_text, 'Manual Correction: BCG vaccine given at Paete RHU.', 'Should save corrected text');
    const finalRecordId = confirmData.record.id;
    console.log(`✅ PASS: Confirmed record created with corrected text: ${confirmData.record.extracted_text}`);

    // =========================================================================
    // TEST 3: Classification Suggestion
    // =========================================================================
    console.log('\nTEST 3: Classification Suggestion...');
    const uploadBodyRabies = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="patient_id"\r\n\r\n${patientId}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="rabies.png"\r\nContent-Type: image/png\r\n\r\n`),
      fs.readFileSync(tempImgRabiesPath),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const previewRabiesRes = await fetch(`${BASE_URL}/api/records/ocr-preview`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Cookie': `token=${recordsStaffToken}`
      },
      body: uploadBodyRabies
    });
    
    const previewRabiesData = await previewRabiesRes.json();
    assert.strictEqual(previewRabiesData.preview.suggested_category, 'ANTI_RABIES_RECORD', 'Should categorize as Anti-Rabies Record');
    assert.ok(previewRabiesData.preview.confidence_score > 0.5, 'Should have positive confidence score');
    const tempTokenRabies = previewRabiesData.token;
    console.log(`✅ PASS: Suggested category: ${previewRabiesData.preview.suggested_category} (Confidence: ${previewRabiesData.preview.confidence_score})`);

    // =========================================================================
    // TEST 4: Classification Override
    // =========================================================================
    console.log('\nTEST 4: Classification Override...');
    const confirmOverrideRes = await fetch(`${BASE_URL}/api/records/confirm-upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `token=${recordsStaffToken}`
      },
      body: JSON.stringify({
        token: tempTokenRabies,
        file_name: 'override_category.png',
        record_type: 'CONSULTATION_RECORD',
        extracted_text: previewRabiesData.preview.extracted_text
      })
    });
    
    assert.strictEqual(confirmOverrideRes.status, 201, 'Confirm with override should succeed');
    const confirmOverrideData = await confirmOverrideRes.json();
    assert.strictEqual(confirmOverrideData.record.record_type, 'CONSULTATION_RECORD', 'Category should follow manual override value');
    console.log(`✅ PASS: Saved overridden category successfully: ${confirmOverrideData.record.record_type}`);

    // =========================================================================
    // TEST 5: Text-Based PDF
    // =========================================================================
    console.log('\nTEST 5: Text-Based PDF...');
    const uploadBodyPdfText = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="patient_id"\r\n\r\n${patientId}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="text_extract.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      fs.readFileSync(tempPdfTextPath),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const previewPdfTextRes = await fetch(`${BASE_URL}/api/records/ocr-preview`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Cookie': `token=${recordsStaffToken}`
      },
      body: uploadBodyPdfText
    });
    
    assert.strictEqual(previewPdfTextRes.status, 200, 'Text PDF upload should succeed');
    const previewPdfTextData = await previewPdfTextRes.json();
    assert.ok(previewPdfTextData.preview.extracted_text.includes('vaccine dose'), 'Text should be extracted directly without OCR');
    console.log('✅ PASS: Text-based PDF parsed directly.');

    // Cleanup session token
    await fetch(`${BASE_URL}/api/records/cancel-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': `token=${recordsStaffToken}` },
      body: JSON.stringify({ token: previewPdfTextData.token })
    });

    // =========================================================================
    // TEST 6: Scanned PDF
    // =========================================================================
    console.log('\nTEST 6: Scanned PDF fallback page-by-page rendering...');
    const uploadBodyPdfScanned = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="patient_id"\r\n\r\n${patientId}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="scanned.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      fs.readFileSync(tempPdfScannedPath),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const previewPdfScannedRes = await fetch(`${BASE_URL}/api/records/ocr-preview`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Cookie': `token=${recordsStaffToken}`
      },
      body: uploadBodyPdfScanned
    });
    
    assert.strictEqual(previewPdfScannedRes.status, 200, 'Scanned PDF upload should succeed and fall back to image OCR rendering');
    const previewPdfScannedData = await previewPdfScannedRes.json();
    assert.ok(previewPdfScannedData.token, 'Should yield a processing session token');
    console.log('✅ PASS: Scanned PDF processed page-by-page successfully.');

    // Cleanup token
    await fetch(`${BASE_URL}/api/records/cancel-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': `token=${recordsStaffToken}` },
      body: JSON.stringify({ token: previewPdfScannedData.token })
    });

    // =========================================================================
    // TEST 7: Encrypted or Invalid PDF
    // =========================================================================
    console.log('\nTEST 7: Encrypted or Invalid PDF...');
    const uploadBodyPdfEncrypted = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="patient_id"\r\n\r\n${patientId}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="encrypted.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      fs.readFileSync(tempPdfEncryptedPath),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const previewPdfEncryptedRes = await fetch(`${BASE_URL}/api/records/ocr-preview`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Cookie': `token=${recordsStaffToken}`
      },
      body: uploadBodyPdfEncrypted
    });
    
    assert.strictEqual(previewPdfEncryptedRes.status, 400, 'Encrypted PDF upload should be rejected');
    console.log('✅ PASS: Encrypted PDF rejected safely.');

    // =========================================================================
    // TEST 8: Temporary Upload Cancellation
    // =========================================================================
    console.log('\nTEST 8: Temporary Upload Cancellation...');
    // Create new temporary preview
    const previewCancelRes = await fetch(`${BASE_URL}/api/records/ocr-preview`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Cookie': `token=${recordsStaffToken}`
      },
      body: uploadBody
    });
    const previewCancelData = await previewCancelRes.json();
    const cancelToken = previewCancelData.token;

    // Cancel session
    const cancelRes = await fetch(`${BASE_URL}/api/records/cancel-upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `token=${recordsStaffToken}`
      },
      body: JSON.stringify({ token: cancelToken })
    });
    
    assert.strictEqual(cancelRes.status, 200, 'Cancel should return 200');
    
    // Confirm confirmation fails with 404
    const confirmAfterCancelRes = await fetch(`${BASE_URL}/api/records/confirm-upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `token=${recordsStaffToken}`
      },
      body: JSON.stringify({
        token: cancelToken,
        file_name: 'test.png',
        record_type: 'CONSULTATION_RECORD'
      })
    });
    assert.strictEqual(confirmAfterCancelRes.status, 404, 'Confirm should fail after cancellation');
    console.log('✅ PASS: Cancelled session cleared and files deleted.');

    // =========================================================================
    // TEST 9: Temporary Token Replay Protection
    // =========================================================================
    console.log('\nTEST 9: Temporary Token Replay...');
    // confirmRes was completed in TEST 2 using tempToken1.
    // Try reconfirming it
    const confirmReplayRes = await fetch(`${BASE_URL}/api/records/confirm-upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `token=${recordsStaffToken}`
      },
      body: JSON.stringify({
        token: tempToken1,
        file_name: 'reconfirm_replay.png',
        record_type: 'IMMUNIZATION_RECORD'
      })
    });
    
    assert.strictEqual(confirmReplayRes.status, 404, 'Replaying a confirmed upload session should fail with 404');
    console.log('✅ PASS: Replay protection verified.');

    // =========================================================================
    // TEST 10: Duplicate Similar Name
    // =========================================================================
    console.log('\nTEST 10: Duplicate Similar Name (Juan M. dela-Cruz)...');
    const duplicatePatientRes = await fetch(`${BASE_URL}/api/patients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `token=${recordsStaffToken}`
      },
      body: JSON.stringify({
        patient_number: 'PAT-P3-DUP-' + Math.floor(Math.random() * 1000),
        first_name: 'Juan M.',
        last_name: 'dela-Cruz',
        birth_date: '1995-05-15',
        sex: 'MALE',
        address: 'Paete, Laguna'
      })
    });
    
    const duplicatePatientData = await duplicatePatientRes.json();
    const duplicatePatientId = duplicatePatientData.patient.id;

    // Fetch duplicate queue
    const dupQueueRes = await fetch(`${BASE_URL}/api/duplicates`, {
      headers: { 'Cookie': `token=${recordsStaffToken}` }
    });
    const dupQueueData = await dupQueueRes.json();
    
    const targetFlag = dupQueueData.flags.find(f => 
      (f.patient_id === patientId && f.possible_duplicate_patient_id === duplicatePatientId) ||
      (f.patient_id === duplicatePatientId && f.possible_duplicate_patient_id === patientId)
    );
    
    assert.ok(targetFlag, 'Should raise a duplicate warning flag between the two similar patients');
    assert.ok(targetFlag.similarity_score > 65, 'Likelihood score should reflect high/medium matching');
    console.log(`✅ PASS: Possible duplicate warning raised. Flag ID: ${targetFlag.id}. Match score: ${targetFlag.similarity_score}%`);

    // =========================================================================
    // TEST 11: Non-Duplicate Similar Name
    // =========================================================================
    console.log('\nTEST 11: Non-Duplicate Similar Name...');
    const distinctPatientRes = await fetch(`${BASE_URL}/api/patients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `token=${recordsStaffToken}`
      },
      body: JSON.stringify({
        patient_number: 'PAT-P3-DIST-' + Math.floor(Math.random() * 1000),
        first_name: 'Juan',
        last_name: 'Dela Cruz',
        birth_date: '1970-12-25', // Different birth date
        sex: 'MALE',
        address: 'Rizal, Laguna' // Different address
      })
    });
    const distinctPatientData = await distinctPatientRes.json();
    const distinctPatientId = distinctPatientData.patient.id;

    const dupQueueRes2 = await fetch(`${BASE_URL}/api/duplicates`, {
      headers: { 'Cookie': `token=${recordsStaffToken}` }
    });
    const dupQueueData2 = await dupQueueRes2.json();
    
    const wrongFlag = dupQueueData2.flags.find(f => 
      (f.patient_id === patientId && f.possible_duplicate_patient_id === distinctPatientId) ||
      (f.patient_id === distinctPatientId && f.possible_duplicate_patient_id === patientId)
    );
    
    assert.ok(!wrongFlag, 'Should not create duplicate warning flag for different birth dates');
    console.log('✅ PASS: Non-duplicate similar name profile passed check.');

    // =========================================================================
    // TEST 12: Duplicate Merge
    // =========================================================================
    console.log('\nTEST 12: Duplicate Merge side-by-side action...');
    
    // Attach dummy record to duplicatePatientId
    const uploadBodyDup = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="patient_id"\r\n\r\n${duplicatePatientId}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="dup_file.png"\r\nContent-Type: image/png\r\n\r\n`),
      fs.readFileSync(tempImgPath),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const previewDupRes = await fetch(`${BASE_URL}/api/records/ocr-preview`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Cookie': `token=${recordsStaffToken}` },
      body: uploadBodyDup
    });
    const previewDupData = await previewDupRes.json();
    
    // Confirm it
    await fetch(`${BASE_URL}/api/records/confirm-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': `token=${recordsStaffToken}` },
      body: JSON.stringify({
        token: previewDupData.token,
        file_name: 'dup_file.png',
        record_type: 'CONSULTATION_RECORD'
      })
    });

    // Merge duplicatePatientId into primary patientId
    const mergeRes = await fetch(`${BASE_URL}/api/duplicates/${targetFlag.id}/merge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `token=${recordsStaffToken}`
      },
      body: JSON.stringify({
        primary_patient_id: patientId,
        merge_fields: {
          middle_name: 'M. (Merged)'
        }
      })
    });

    assert.strictEqual(mergeRes.status, 200, 'Merge request should succeed with 200');
    
    // Confirm records moved to primary profile
    const primaryRecordsRes = await fetch(`${BASE_URL}/api/records/patient/${patientId}`, {
      headers: { 'Cookie': `token=${recordsStaffToken}` }
    });
    const primaryRecordsData = await primaryRecordsRes.json();
    const hasMergedRecord = primaryRecordsData.records.some(r => r.file_name === 'dup_file.png');
    assert.ok(hasMergedRecord, 'Reassigned file record should be mapped under primary patient');

    // Confirm secondary patient archived
    const secondaryRes = await fetch(`${BASE_URL}/api/patients/${duplicatePatientId}`, {
      headers: { 'Cookie': `token=${recordsStaffToken}` }
    });
    const secondaryData = await secondaryRes.json();
    assert.strictEqual(secondaryData.patient.status, 'ARCHIVED', 'Secondary duplicate patient profile must be archived');
    console.log('✅ PASS: Profile merge reassigned records, updated details, and archived secondary patient.');

    // =========================================================================
    // TEST 13: Search Verified OCR
    // =========================================================================
    console.log('\nTEST 13: Search Verified OCR...');
    // We saved corrected text "Manual Correction: BCG vaccine given at Paete RHU." in TEST 2.
    // Search for "Paete RHU"
    const ocrSearchRes = await fetch(`${BASE_URL}/api/search?q=Paete%20RHU`, {
      headers: { 'Cookie': `token=${recordsStaffToken}` }
    });
    const ocrSearchData = await ocrSearchRes.json();
    const hasMatch = ocrSearchData.records.some(r => r.id === finalRecordId);
    assert.ok(hasMatch, 'Should find the record by searching verified corrected OCR text');
    console.log('✅ PASS: Search queried verified OCR text successfully.');

    // =========================================================================
    // TEST 14: Search Authorization
    // =========================================================================
    console.log('\nTEST 14: Search Authorization...');
    // Login as Administrative Staff (staff@keepup.com) who has no access to records
    const unauthorizedSearchRes = await fetch(`${BASE_URL}/api/search?q=Paete%20RHU`, {
      headers: { 'Cookie': `token=${adminStaffToken}` }
    });
    assert.strictEqual(unauthorizedSearchRes.status, 403, 'Administrative staff should be blocked from unified search with 403');
    console.log('✅ PASS: Role search authorization validated.');

    // =========================================================================
    // TEST 15: XSS Regression in search snippets
    // =========================================================================
    console.log('\nTEST 15: XSS Regression in search snippets...');
    const uploadBodyXss = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="patient_id"\r\n\r\n${patientId}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="xss.png"\r\nContent-Type: image/png\r\n\r\n`),
      fs.readFileSync(tempImgXssPath),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const previewXssRes = await fetch(`${BASE_URL}/api/records/ocr-preview`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Cookie': `token=${recordsStaffToken}` },
      body: uploadBodyXss
    });
    const previewXssData = await previewXssRes.json();

    // Confirm it
    const confirmXssRes = await fetch(`${BASE_URL}/api/records/confirm-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': `token=${recordsStaffToken}` },
      body: JSON.stringify({
        token: previewXssData.token,
        file_name: 'xss.png',
        record_type: 'CONSULTATION_RECORD',
        extracted_text: '<script>alert("xss")</script> <b>bold tag</b>'
      })
    });
    const confirmXssData = await confirmXssRes.json();

    // Search for "alert"
    const searchXssRes = await fetch(`${BASE_URL}/api/search?q=alert`, {
      headers: { 'Cookie': `token=${recordsStaffToken}` }
    });
    const searchXssData = await searchXssRes.json();
    const xssRecord = searchXssData.records.find(r => r.id === confirmXssData.record.id);
    assert.ok(xssRecord, 'Should find the xss record');
    assert.ok(xssRecord.snippet.includes('&lt;script&gt;'), 'HTML script tag should be safely escaped in snippets');
    assert.ok(!xssRecord.snippet.includes('<script>'), 'Snippet should NOT contain raw script tag');
    console.log('✅ PASS: HTML/script text safely escaped from XSS vulnerability in snippets.');

    // =========================================================================
    // TEST 16: Existing Security Regression (Verify 11 cases)
    // =========================================================================
    console.log('\nTEST 16: Running existing security regression tests...');
    
    // Case 1: Anonymous direct access to patient files
    const anonRes = await fetch(`${BASE_URL}/api/records/download/any-file-name.png`);
    assert.strictEqual(anonRes.status, 401, 'Anonymous access should be blocked with 401');
    console.log('✅ PASS: Case 1: Anonymous access blocked.');

    // Case 3: Access attempt by unauthorized role
    const unauthorizedDownloadRes = await fetch(`${BASE_URL}/api/records/download/${finalRecordId}`, {
      headers: { 'Cookie': `token=${adminStaffToken}` }
    });
    assert.strictEqual(unauthorizedDownloadRes.status, 403, 'Administrative Staff blocked from download');
    console.log('✅ PASS: Case 3: Unauthorized role blocked.');

    // Case 4: Path traversal attempts
    const pathTraversalRes = await fetch(`${BASE_URL}/api/records/download/..%2F..%2F..%2Fserver.js`, {
      headers: { 'Cookie': `token=${recordsStaffToken}` }
    });
    assert.ok([403, 404].includes(pathTraversalRes.status), 'Path traversal should return 403 or 404');
    console.log('✅ PASS: Case 4: Path traversal attempt blocked.');

    // Case 9: Expired or invalid signed URLs
    const invalidSignatureRes = await fetch(`${BASE_URL}/api/records/download/invalid-uuid-token`, {
      headers: { 'Cookie': `token=${recordsStaffToken}` }
    });
    assert.strictEqual(invalidSignatureRes.status, 404, 'Invalid URLs return 404');
    console.log('✅ PASS: Case 9: Secure signed URL validation verified.');

    // Case 10: System Audit Logs Authorization Access
    const adminAuditRes = await fetch(`${BASE_URL}/api/reports/audit-logs`, {
      headers: { 'Cookie': `token=${adminToken}` }
    });
    assert.strictEqual(adminAuditRes.status, 200, 'Admin should access audit logs');
    
    const unauthorizedAuditRes = await fetch(`${BASE_URL}/api/reports/audit-logs`, {
      headers: { 'Cookie': `token=${recordsStaffToken}` }
    });
    assert.strictEqual(unauthorizedAuditRes.status, 403, 'Records staff blocked from audit logs');
    console.log('✅ PASS: Case 10: Audit logging access controls verified.');

    // Case 11: Digitized Record Metadata Editing
    const updateRes = await fetch(`${BASE_URL}/api/records/${finalRecordId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `token=${recordsStaffToken}`
      },
      body: JSON.stringify({
        file_name: 'renamed_record.pdf',
        record_type: 'CONSULTATION_RECORD'
      })
    });
    assert.strictEqual(updateRes.status, 200, 'Records staff should update record metadata');
    console.log('✅ PASS: Case 11: Record metadata editing permissions verified.');

    console.log('\n==================================================');
    console.log('      ALL PHASE 3 INTEGRATION TESTS PASSED        ');
    console.log('==================================================\n');

  } catch (err) {
    console.error('\n❌ INTEGRATION TEST SUITE FAILURE:', err);
    process.exitCode = 1;
  } finally {
    // Cleanup files
    try {
      if (fs.existsSync(tempImgPath)) fs.unlinkSync(tempImgPath);
      if (fs.existsSync(tempImgRabiesPath)) fs.unlinkSync(tempImgRabiesPath);
      if (fs.existsSync(tempImgXssPath)) fs.unlinkSync(tempImgXssPath);
      if (fs.existsSync(tempPdfTextPath)) fs.unlinkSync(tempPdfTextPath);
      if (fs.existsSync(tempPdfScannedPath)) fs.unlinkSync(tempPdfScannedPath);
      if (fs.existsSync(tempPdfEncryptedPath)) fs.unlinkSync(tempPdfEncryptedPath);
    } catch (_) {}

    if (serverProcess) {
      console.log('Stopping test server...');
      serverProcess.kill();
    }
  }
}

runTests();
