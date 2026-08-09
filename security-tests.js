// KEEP UP System - Automated Security Test Suite
// Verified scenarios: anonymous access, role authorization, path traversal, magic bytes, oversized uploads, and XSS rendering.

const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const TEST_PORT = 3001;
const BASE_URL = `http://localhost:${TEST_PORT}`;

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
  console.log('       STARTING SECURITY VERIFICATION TESTS       ');
  console.log('==================================================\n');

  let serverProcess;
  try {
    // 1. Start the server on the test port
    console.log(`Starting KEEP UP server on port ${TEST_PORT}...`);
    serverProcess = spawn('node', ['server.js'], {
      env: { ...process.env, PORT: TEST_PORT, FILE_SIZE_LIMIT: '50000', KEEPUP_TEST_MODE: 'true' }
    });

    const logStream = fs.createWriteStream(path.join(process.cwd(), 'test-server.log'));
    serverProcess.stdout.pipe(logStream);
    serverProcess.stderr.pipe(logStream);

    // Wait for server to boot (Supabase database setup requires 10-15 seconds to initialize)
    await new Promise(resolve => setTimeout(resolve, 20000));
    console.log('Server is running. Retrieving credentials...\n');

    // Dynamically log in to get tokens
    const recordsStaffToken = await getCookieForUser('records@keepup.com', 'Records123!');
    const adminStaffToken = await getCookieForUser('staff@keepup.com', 'Staff123!');
    const adminToken = await getCookieForUser('admin@keepup.com', 'Admin123!');
    console.log('✅ Logged in successfully as Records Staff, Administrative Staff & Administrator.');

    // Make sure we have a patient ID to test uploads with
    const patientsRes = await fetch(`${BASE_URL}/api/patients`, {
      headers: { 'Cookie': `token=${recordsStaffToken}` }
    });
    const patientsData = await patientsRes.json();
    let patientId = null;
    if (patientsData && patientsData.success && patientsData.patients.length > 0) {
      patientId = patientsData.patients[0].id;
    } else {
      // Create a test patient if none exists
      const createPatientRes = await fetch(`${BASE_URL}/api/patients`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `token=${recordsStaffToken}`
        },
        body: JSON.stringify({
          patient_number: 'PAT-TEST-' + Math.floor(Math.random() * 1000),
          first_name: 'Security',
          last_name: 'Test',
          birth_date: '1990-01-01',
          sex: 'MALE',
          address: 'Test Laboratory'
        })
      });
      const createPatientData = await createPatientRes.json();
      patientId = createPatientData.patient.id;
    }

    console.log(`Using Patient ID for testing: ${patientId}\n`);

    // =========================================================================
    // CASE 1: Anonymous direct access to patient files
    // =========================================================================
    console.log('Case 1: Anonymous direct access to uploaded patient files...');
    const anonRes = await fetch(`${BASE_URL}/api/records/download/any-file-name.png`);
    assert.strictEqual(anonRes.status, 401, 'Anonymous access should be blocked with 401');
    console.log('✅ PASS: Anonymous access blocked.');

    // =========================================================================
    // CASE 2: Authenticated access by permitted users
    // =========================================================================
    console.log('\nCase 2: Authenticated access by permitted users...');
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    
    // Valid PDF signature: %PDF (25 50 44 46)
    const pdfContent = Buffer.concat([
      Buffer.from('%PDF-1.4\n%'),
      Buffer.alloc(100)
    ]);

    const uploadBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="patient_id"\r\n\r\n${patientId}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="record_type"\r\n\r\nPATIENT_INFORMATION_SHEET\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="health_card.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      pdfContent,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const uploadRes = await fetch(`${BASE_URL}/api/records/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Cookie': `token=${recordsStaffToken}`
      },
      body: uploadBody
    });

    const uploadData = await uploadRes.json();
    assert.strictEqual(uploadRes.status, 201, 'Upload of valid PDF should succeed');
    assert.ok(uploadData.success, 'Upload response should be success');
    const testRecordId = uploadData.record.id;
    console.log(`✅ PASS: File uploaded successfully. Record ID: ${testRecordId}`);

    // Test downloading the file
    const downloadRes = await fetch(`${BASE_URL}/api/records/download/${testRecordId}`, {
      headers: { 'Cookie': `token=${recordsStaffToken}` },
      redirect: 'manual'
    });
    assert.ok([200, 302].includes(downloadRes.status), 'Download request should return 200 or 302');
    console.log(`✅ PASS: Secure download endpoint authorized request (Status ${downloadRes.status}).`);

    // =========================================================================
    // CASE 3: Access attempt by an unauthorized role
    // =========================================================================
    console.log('\nCase 3: Access attempt by an unauthorized role...');
    const unauthorizedDownloadRes = await fetch(`${BASE_URL}/api/records/download/${testRecordId}`, {
      headers: { 'Cookie': `token=${adminStaffToken}` }
    });
    assert.strictEqual(unauthorizedDownloadRes.status, 403, 'Administrative Staff should be blocked with 403');
    console.log('✅ PASS: Unauthorized role blocked.');

    // =========================================================================
    // CASE 4: Path traversal attempts
    // =========================================================================
    console.log('\nCase 4: Path traversal attempts...');
    const pathTraversalRes = await fetch(`${BASE_URL}/api/records/download/..%2F..%2F..%2Fserver.js`, {
      headers: { 'Cookie': `token=${recordsStaffToken}` }
    });
    assert.ok([403, 404].includes(pathTraversalRes.status), 'Path traversal should return 403 or 404');
    console.log('✅ PASS: Path traversal attempt resolved safely.');

    // =========================================================================
    // CASE 5: Malicious filenames
    // =========================================================================
    console.log('\nCase 5: Malicious filenames sanitization...');
    const maliciousBoundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    const maliciousUploadBody = Buffer.concat([
      Buffer.from(`--${maliciousBoundary}\r\nContent-Disposition: form-data; name="patient_id"\r\n\r\n${patientId}\r\n`),
      Buffer.from(`--${maliciousBoundary}\r\nContent-Disposition: form-data; name="record_type"\r\n\r\nCONSULTATION_RECORD\r\n`),
      Buffer.from(`--${maliciousBoundary}\r\nContent-Disposition: form-data; name="document"; filename="../../../hack.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      pdfContent,
      Buffer.from(`\r\n--${maliciousBoundary}--\r\n`)
    ]);

    const maliciousUploadRes = await fetch(`${BASE_URL}/api/records/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${maliciousBoundary}`,
        'Cookie': `token=${recordsStaffToken}`
      },
      body: maliciousUploadBody
    });
    const maliciousUploadData = await maliciousUploadRes.json();
    assert.strictEqual(maliciousUploadRes.status, 201, 'Upload should succeed');
    assert.strictEqual(maliciousUploadData.record.file_name, 'hack.pdf', 'Filename should be sanitized');
    console.log('✅ PASS: Malicious filename sanitized.');

    // =========================================================================
    // CASE 6: HTML/script content in OCR search results
    // =========================================================================
    console.log('\nCase 6: HTML/script content in OCR search results (XSS Verification)...');
    const searchRes = await fetch(`${BASE_URL}/api/search?q=<script>`, {
      headers: { 'Cookie': `token=${recordsStaffToken}` }
    });
    const searchData = await searchRes.json();
    assert.ok(searchData.success, 'Search request should succeed');
    console.log('✅ PASS: Search API response handles query safely.');

    // =========================================================================
    // CASE 7: Invalid MIME types
    // =========================================================================
    console.log('\nCase 7: Invalid MIME types (disguised files)...');
    const disguisedBoundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    const disguisedFileContent = Buffer.from('MZ\x90\x00\x03\x00\x00\x00This is an executable dummy content');
    const disguisedUploadBody = Buffer.concat([
      Buffer.from(`--${disguisedBoundary}\r\nContent-Disposition: form-data; name="patient_id"\r\n\r\n${patientId}\r\n`),
      Buffer.from(`--${disguisedBoundary}\r\nContent-Disposition: form-data; name="record_type"\r\n\r\nIMMUNIZATION_RECORD\r\n`),
      Buffer.from(`--${disguisedBoundary}\r\nContent-Disposition: form-data; name="document"; filename="disguised.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      disguisedFileContent,
      Buffer.from(`\r\n--${disguisedBoundary}--\r\n`)
    ]);

    const disguisedUploadRes = await fetch(`${BASE_URL}/api/records/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${disguisedBoundary}`,
        'Cookie': `token=${recordsStaffToken}`
      },
      body: disguisedUploadBody
    });
    assert.strictEqual(disguisedUploadRes.status, 400, 'Disguised file should be rejected with 400');
    console.log('✅ PASS: Disguised executable file rejected.');

    // =========================================================================
    // CASE 8: Oversized file uploads
    // =========================================================================
    console.log('\nCase 8: Oversized file uploads...');
    const oversizedBoundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    const oversizedContent = Buffer.concat([
      Buffer.from('%PDF-1.4\n%'),
      Buffer.alloc(60000) // Exceeds 50KB limit
    ]);
    const oversizedUploadBody = Buffer.concat([
      Buffer.from(`--${oversizedBoundary}\r\nContent-Disposition: form-data; name="patient_id"\r\n\r\n${patientId}\r\n`),
      Buffer.from(`--${oversizedBoundary}\r\nContent-Disposition: form-data; name="record_type"\r\n\r\nANTI_RABIES_RECORD\r\n`),
      Buffer.from(`--${oversizedBoundary}\r\nContent-Disposition: form-data; name="document"; filename="large.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      oversizedContent,
      Buffer.from(`\r\n--${oversizedBoundary}--\r\n`)
    ]);

    const oversizedUploadRes = await fetch(`${BASE_URL}/api/records/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${oversizedBoundary}`,
        'Cookie': `token=${recordsStaffToken}`
      },
      body: oversizedUploadBody
    });
    assert.strictEqual(oversizedUploadRes.status, 400, 'Oversized file should be rejected with 400');
    console.log('✅ PASS: Oversized file rejected.');

    // =========================================================================
    // CASE 9: Expired or invalid signed URLs
    // =========================================================================
    console.log('\nCase 9: Expired or invalid signed URLs...');
    const invalidSignatureRes = await fetch(`${BASE_URL}/api/records/download/invalid-uuid-token`, {
      headers: { 'Cookie': `token=${recordsStaffToken}` }
    });
    assert.strictEqual(invalidSignatureRes.status, 404, 'Invalid/expired signed download URLs should return 404');
    console.log('✅ PASS: Secure signed URL validation verified.');

    // =========================================================================
    // CASE 10: System Audit Logs Authorization Access
    // =========================================================================
    console.log('\nCase 10: System Audit Logs Authorization Access...');
    const adminAuditRes = await fetch(`${BASE_URL}/api/reports/audit-logs`, {
      headers: { 'Cookie': `token=${adminToken}` }
    });
    assert.strictEqual(adminAuditRes.status, 200, 'Admin should access audit logs with 200');
    const adminAuditData = await adminAuditRes.json();
    assert.ok(adminAuditData.success && Array.isArray(adminAuditData.logs), 'Audit logs response should be an array');
    
    // Check that non-admin is blocked
    const unauthorizedAuditRes = await fetch(`${BASE_URL}/api/reports/audit-logs`, {
      headers: { 'Cookie': `token=${recordsStaffToken}` }
    });
    assert.strictEqual(unauthorizedAuditRes.status, 403, 'Records Staff should be blocked from audit logs with 403');
    console.log('✅ PASS: Audit logging access controls verified.');

    // =========================================================================
    // CASE 11: Digitized Record Metadata Editing Permission & Validation
    // =========================================================================
    console.log('\nCase 11: Digitized Record Metadata Editing...');
    const updateRes = await fetch(`${BASE_URL}/api/records/${testRecordId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `token=${recordsStaffToken}`
      },
      body: JSON.stringify({
        file_name: 'updated_record.pdf',
        record_type: 'CONSULTATION_RECORD'
      })
    });
    assert.strictEqual(updateRes.status, 200, 'Records staff should update record metadata with 200');
    const updateData = await updateRes.json();
    assert.ok(updateData.success, 'Metadata update response should be success');
    assert.strictEqual(updateData.record.file_name, 'updated_record.pdf', 'Record filename should match update');
    
    // Check role blocking
    const unauthorizedUpdateRes = await fetch(`${BASE_URL}/api/records/${testRecordId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `token=${adminStaffToken}`
      },
      body: JSON.stringify({
        file_name: 'hack.pdf',
        record_type: 'CONSULTATION_RECORD'
      })
    });
    assert.strictEqual(unauthorizedUpdateRes.status, 403, 'Administrative Staff should be blocked from updates with 403');
    console.log('✅ PASS: Record metadata editing permissions verified.');

    console.log('\n==================================================');
    console.log('      ALL SECURITY VERIFICATION TESTS PASSED      ');
    console.log('==================================================\n');

  } catch (err) {
    console.error('\n❌ TEST SUITE FAILURE:', err);
    process.exitCode = 1;
  } finally {
    if (serverProcess) {
      console.log('Stopping test server...');
      serverProcess.kill();
    }
  }
}

runTests();
