/**
 * Analyze Synthetic Test Data
 * Identify test records in the database that can be safely archived or removed
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.json');

// Test identifiers
const TEST_PATTERNS = {
  patients: [
    /WALK25-/i,           // Core walkthrough test tag
    /Security.*Test/i,     // Security test patients
    /Phase.*3/i,          // Phase 3 test identifiers
    /-FC-/i,              // Final completion tests
    /-MRS[0-9A-Z]+/i      // Specific test run identifiers
  ],
  records: [
    /hack\.pdf/i,
    /xss\.png/i,
    /WALK25-/i,
    /fc-test/i
  ]
};

function analyzeDatabase() {
  console.log('📊 ANALYZING SYNTHETIC TEST DATA');
  console.log('═'.repeat(60));
  
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  
  const report = {
    timestamp: new Date().toISOString(),
    users: {
      total: db.users.length,
      testUsers: [],
      systemUsers: []
    },
    patients: {
      total: db.patients.length,
      testPatients: [],
      realPatients: [],
      archivedTest: []
    },
    records: {
      total: db.patient_records.length,
      testRecords: [],
      realRecords: []
    },
    duplicateFlags: {
      total: db.duplicate_flags ? db.duplicate_flags.length : 0,
      testRelated: []
    },
    auditLogs: {
      total: db.audit_logs ? db.audit_logs.length : 0,
      testRelated: []
    }
  };
  
  // Analyze users
  console.log('\n👥 USERS:');
  for (const user of db.users) {
    const isSystemDefault = [
      'admin@keepup.com',
      'records@keepup.com',
      'healthcare@keepup.com',
      'staff@keepup.com',
      'inactive@keepup.com'
    ].includes(user.email);
    
    if (isSystemDefault) {
      report.users.systemUsers.push({
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status
      });
    } else {
      report.users.testUsers.push(user);
    }
  }
  
  console.log(`  Total: ${report.users.total}`);
  console.log(`  System default accounts: ${report.users.systemUsers.length}`);
  console.log(`  Test/Unknown users: ${report.users.testUsers.length}`);
  
  // Analyze patients
  console.log('\n🏥 PATIENTS:');
  const testPatientIds = new Set();
  
  for (const patient of db.patients) {
    let isTest = false;
    
    // Check all fields for test patterns
    const searchableText = [
      patient.first_name,
      patient.middle_name,
      patient.last_name,
      patient.address
    ].filter(Boolean).join(' ');
    
    for (const pattern of TEST_PATTERNS.patients) {
      if (pattern.test(searchableText)) {
        isTest = true;
        break;
      }
    }
    
    if (isTest) {
      testPatientIds.add(patient.id);
      
      if (patient.status === 'ARCHIVED') {
        report.patients.archivedTest.push(patient);
      } else {
        report.patients.testPatients.push(patient);
      }
    } else {
      report.patients.realPatients.push(patient);
    }
  }
  
  console.log(`  Total: ${report.patients.total}`);
  console.log(`  Test patients (ACTIVE): ${report.patients.testPatients.length}`);
  console.log(`  Test patients (ARCHIVED): ${report.patients.archivedTest.length}`);
  console.log(`  Real/Production patients: ${report.patients.realPatients.length}`);
  
  // Analyze records
  console.log('\n📄 PATIENT RECORDS:');
  for (const record of db.patient_records) {
    let isTest = false;
    
    // Check if belongs to test patient
    if (testPatientIds.has(record.patient_id)) {
      isTest = true;
    }
    
    // Check filename patterns
    const filename = record.file_name || '';
    for (const pattern of TEST_PATTERNS.records) {
      if (pattern.test(filename)) {
        isTest = true;
        break;
      }
    }
    
    // Check extracted text
    if (record.extracted_text && /WALK25-/i.test(record.extracted_text)) {
      isTest = true;
    }
    
    if (isTest) {
      report.records.testRecords.push(record);
    } else {
      report.records.realRecords.push(record);
    }
  }
  
  console.log(`  Total: ${report.records.total}`);
  console.log(`  Test records: ${report.records.testRecords.length}`);
  console.log(`  Real records: ${report.records.realRecords.length}`);
  
  // Analyze duplicate flags
  if (db.duplicate_flags && db.duplicate_flags.length > 0) {
    console.log('\n⚠️  DUPLICATE FLAGS:');
    for (const flag of db.duplicate_flags) {
      if (testPatientIds.has(flag.patient_a_id) || testPatientIds.has(flag.patient_b_id)) {
        report.duplicateFlags.testRelated.push(flag);
      }
    }
    console.log(`  Total: ${report.duplicateFlags.total}`);
    console.log(`  Test-related: ${report.duplicateFlags.testRelated.length}`);
  }
  
  // Analyze audit logs (sample)
  if (db.audit_logs && db.audit_logs.length > 0) {
    console.log('\n📋 AUDIT LOGS:');
    let testAuditCount = 0;
    
    for (const log of db.audit_logs) {
      if (testPatientIds.has(log.patient_id)) {
        testAuditCount++;
        if (testAuditCount <= 10) { // Only add first 10 to report
          report.auditLogs.testRelated.push(log);
        }
      }
    }
    
    console.log(`  Total: ${report.auditLogs.total}`);
    console.log(`  Test-related: ${testAuditCount}`);
  }
  
  // Print sample test patients
  console.log('\n📝 SAMPLE TEST PATIENTS:');
  const samplePatients = report.patients.testPatients.slice(0, 5);
  for (const p of samplePatients) {
    console.log(`  - ${p.patient_number}: ${p.first_name} ${p.last_name}`);
    console.log(`    Status: ${p.status}`);
  }
  
  if (report.patients.testPatients.length > 5) {
    console.log(`  ... and ${report.patients.testPatients.length - 5} more`);
  }
  
  // Print sample archived test patients
  if (report.patients.archivedTest.length > 0) {
    console.log('\n📝 SAMPLE ARCHIVED TEST PATIENTS:');
    const sampleArchived = report.patients.archivedTest.slice(0, 3);
    for (const p of sampleArchived) {
      console.log(`  - ${p.patient_number}: ${p.first_name} ${p.last_name}`);
    }
    if (report.patients.archivedTest.length > 3) {
      console.log(`  ... and ${report.patients.archivedTest.length - 3} more`);
    }
  }
  
  // Save detailed report
  const reportPath = path.join(__dirname, 'test-data-analysis.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  console.log('\n' + '═'.repeat(60));
  console.log(`📄 Detailed report saved: ${reportPath}`);
  
  // Summary and recommendation
  console.log('\n💡 RECOMMENDATIONS:');
  console.log('  ✓ System default user accounts should be preserved');
  console.log(`  ✓ ${report.patients.testPatients.length} test patients can be ARCHIVED`);
  console.log(`  ✓ ${report.patients.archivedTest.length} test patients already archived`);
  console.log(`  ✓ ${report.records.testRecords.length} test records can be marked ARCHIVED`);
  console.log(`  ✓ ${report.duplicateFlags.testRelated.length} test-related duplicate flags can be removed`);
  console.log('  ✓ Audit logs should be preserved for historical integrity');
  console.log('\n⚠️  NOTE: This is a DRY-RUN analysis. No changes have been made.');
  
  return report;
}

// Run analysis
try {
  analyzeDatabase();
} catch (error) {
  console.error('❌ Analysis failed:', error.message);
  process.exit(1);
}
