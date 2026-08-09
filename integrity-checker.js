// KEEP UP System - Data and File Storage Integrity Checker
// Scans database records and filesystem uploads for orphans, duplicates, missing files, and state inconsistencies.

const fs = require('fs');
const path = require('path');
const { dbClient, isSupabase, jsonDbPath } = require('./src/config/db');
const { classifyStaleAuditReference } = require('./src/utils/auditDisplay');

function getFileMeta(fullPath) {
  const stat = fs.statSync(fullPath);
  return {
    size_bytes: stat.size,
    modified_at: stat.mtime.toISOString()
  };
}

// Helper to recursively list files in directory
function getAllFiles(dirPath, arrayOfFiles = []) {
  if (!fs.existsSync(dirPath)) return arrayOfFiles;
  const files = fs.readdirSync(dirPath);

  files.forEach(file => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(path.relative(process.cwd(), fullPath));
    }
  });

  return arrayOfFiles;
}

async function runIntegrityCheck() {
  console.log('==================================================');
  console.log('       STARTING KEEP UP SYSTEM INTEGRITY CHECK    ');
  console.log('==================================================');
  console.log(`Database Mode: ${isSupabase ? 'SUPABASE (Remote)' : 'LOCAL JSON FALLBACK'}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  let users = [];
  let patients = [];
  let records = [];
  let flags = [];
  let logs = [];
  let temps = [];

  // 1. Fetch tables
  try {
    if (isSupabase) {
      const { data: uData } = await dbClient.from('users').select('*');
      users = uData || [];
      const { data: pData } = await dbClient.from('patients').select('*');
      patients = pData || [];
      const { data: rData } = await dbClient.from('patient_records').select('*');
      records = rData || [];
      const { data: fData } = await dbClient.from('duplicate_flags').select('*');
      flags = fData || [];
      const { data: lData } = await dbClient.from('audit_logs').select('*');
      logs = lData || [];
      const { data: tData } = await dbClient.from('temporary_uploads').select('*');
      temps = tData || [];
    } else {
      if (!fs.existsSync(jsonDbPath)) {
        console.log('❌ Error: Local database file not found.');
        return;
      }
      const db = JSON.parse(fs.readFileSync(jsonDbPath, 'utf-8'));
      users = db.users || [];
      patients = db.patients || [];
      records = db.patient_records || [];
      flags = db.duplicate_flags || [];
      logs = db.audit_logs || [];
      temps = db.temporary_uploads || [];
    }
  } catch (err) {
    console.error('❌ Failed to retrieve database records:', err.message);
    process.exitCode = 1;
    return;
  }

  const userIds = new Set(users.map(u => u.id));
  const patientIds = new Set(patients.map(p => p.id));
  const activePatientIds = new Set(patients.filter(p => p.status === 'ACTIVE').map(p => p.id));
  const archivedPatientIds = new Set(patients.filter(p => p.status === 'ARCHIVED').map(p => p.id));

  let anomaliesCount = 0;

  // ---------------------------------------------------------------------------
  // Check 1: Orphan database records
  // ---------------------------------------------------------------------------
  console.log('1. Analyzing Orphan Records...');
  const orphanRecords = records.filter(r => !patientIds.has(r.patient_id));
  const orphanFlags = flags.filter(f => !patientIds.has(f.patient_id) || !patientIds.has(f.possible_duplicate_patient_id));
  const orphanTemps = temps.filter(t => !patientIds.has(t.patient_id));

  if (orphanRecords.length > 0) {
    anomaliesCount += orphanRecords.length;
    console.warn(`  ⚠️ Found ${orphanRecords.length} records pointing to non-existent patients:`);
    orphanRecords.forEach(r => console.log(`    - Record ID: ${r.id}, Patient ID: ${r.patient_id}, File: ${r.file_name}`));
  }
  if (orphanFlags.length > 0) {
    anomaliesCount += orphanFlags.length;
    console.warn(`  ⚠️ Found ${orphanFlags.length} duplicate flags pointing to non-existent patients:`);
    orphanFlags.forEach(f => console.log(`    - Flag ID: ${f.id}, Patient: ${f.patient_id}, Possible Duplicate: ${f.possible_duplicate_patient_id}`));
  }
  if (orphanTemps.length > 0) {
    anomaliesCount += orphanTemps.length;
    console.warn(`  ⚠️ Found ${orphanTemps.length} temporary uploads pointing to non-existent patients:`);
    orphanTemps.forEach(t => console.log(`    - Token: ${t.token}, Patient ID: ${t.patient_id}, File: ${t.file_name}`));
  }
  if (orphanRecords.length === 0 && orphanFlags.length === 0 && orphanTemps.length === 0) {
    console.log('  ✅ No orphan records detected.');
  }

  // ---------------------------------------------------------------------------
  // Check 2: Missing private files on disk
  // ---------------------------------------------------------------------------
  console.log('\n2. Verifying Physical Files on Disk...');
  const missingFiles = [];
  
  // We only verify physical files stored locally under uploads/
  records.forEach(r => {
    if (r.file_path && r.file_path.startsWith('uploads')) {
      const fullPath = path.resolve(process.cwd(), r.file_path);
      if (!fs.existsSync(fullPath)) {
        missingFiles.push(r);
      }
    }
  });

  temps.forEach(t => {
    if (t.file_path && t.file_path.startsWith('uploads')) {
      const fullPath = path.resolve(process.cwd(), t.file_path);
      if (!fs.existsSync(fullPath)) {
        missingFiles.push({ id: `Temp-${t.token}`, file_name: t.file_name, file_path: t.file_path });
      }
    }
  });

  if (missingFiles.length > 0) {
    anomaliesCount += missingFiles.length;
    console.warn(`  ⚠️ Found ${missingFiles.length} database entries with missing physical files on disk:`);
    missingFiles.forEach(f => console.log(`    - Entry: ${f.id}, Expected path: ${f.file_path}, File: ${f.file_name}`));
  } else {
    console.log('  ✅ All local database entries have corresponding files on disk.');
  }

  // ---------------------------------------------------------------------------
  // Check 3: Unreferenced files in uploads directory
  // ---------------------------------------------------------------------------
  console.log('\n3. Searching for Unreferenced Uploaded Files...');
  const uploadDir = path.join(process.cwd(), 'uploads');
  const physicalFiles = getAllFiles(uploadDir);
  const relevantFiles = physicalFiles.filter(f => !f.includes(path.join('uploads', 'temp')));

  const dbFilePaths = new Set([
    ...records.map(r => r.file_path ? path.normalize(r.file_path) : ''),
    ...temps.map(t => t.file_path ? path.normalize(t.file_path) : '')
  ].filter(Boolean));

  const unreferencedFiles = relevantFiles.filter(f => !dbFilePaths.has(path.normalize(f)));

  if (unreferencedFiles.length > 0) {
    anomaliesCount += unreferencedFiles.length;
    console.warn(`  ⚠️ Found ${unreferencedFiles.length} unreferenced files inside the uploads directory:`);
    unreferencedFiles.slice(0, 10).forEach(f => {
      const meta = getFileMeta(path.resolve(process.cwd(), f));
      console.log(`    - File path: ${f}, size: ${meta.size_bytes} bytes, modified: ${meta.modified_at}, db_ref: false, supabase_ref: n/a`);
    });
    if (unreferencedFiles.length > 10) {
      console.log(`    ... and ${unreferencedFiles.length - 10} more (run cleanup-orphan-files.js --dry-run for full inventory)`);
    }
  } else {
    console.log('  ✅ No unreferenced uploaded files found.');
  }

  // ---------------------------------------------------------------------------
  // Check 4: Duplicate patient numbers
  // ---------------------------------------------------------------------------
  console.log('\n4. Checking for Duplicate Patient Numbers...');
  const patientNumberCounts = {};
  patients.forEach(p => {
    patientNumberCounts[p.patient_number] = (patientNumberCounts[p.patient_number] || 0) + 1;
  });

  const duplicatePatientNumbers = Object.keys(patientNumberCounts).filter(num => patientNumberCounts[num] > 1);

  if (duplicatePatientNumbers.length > 0) {
    anomaliesCount += duplicatePatientNumbers.length;
    console.warn(`  ⚠️ Found duplicate patient numbers:`);
    duplicatePatientNumbers.forEach(num => {
      const conflictList = patients.filter(p => p.patient_number === num);
      console.log(`    - Number: ${num} is shared by:`);
      conflictList.forEach(p => console.log(`      * Patient ID: ${p.id}, Name: ${p.first_name} ${p.last_name}`));
    });
  } else {
    console.log('  ✅ All patient numbers are unique.');
  }

  // ---------------------------------------------------------------------------
  // Check 5: Duplicate record references (local fallback arrays)
  // ---------------------------------------------------------------------------
  console.log('\n5. Verifying Record UUID Uniqueness...');
  const recordIdCounts = {};
  records.forEach(r => {
    recordIdCounts[r.id] = (recordIdCounts[r.id] || 0) + 1;
  });

  const duplicateRecordIds = Object.keys(recordIdCounts).filter(id => recordIdCounts[id] > 1);

  if (duplicateRecordIds.length > 0) {
    anomaliesCount += duplicateRecordIds.length;
    console.warn(`  ⚠️ Found duplicate record IDs in database list:`);
    duplicateRecordIds.forEach(id => console.log(`    - Record ID: ${id} occurs ${recordIdCounts[id]} times`));
  } else {
    console.log('  ✅ All record keys are unique.');
  }

  // ---------------------------------------------------------------------------
  // Check 6: Audit log user references (classified)
  // ---------------------------------------------------------------------------
  console.log('\n6. Checking Audit Log References...');
  const auditClassification = { valid: 0, historical_valid: 0, missing_snapshot: 0, invalid_corrupt: 0 };

  logs.forEach(l => {
    if (!l.action || !l.created_at) {
      auditClassification.invalid_corrupt += 1;
      return;
    }
    const cls = classifyStaleAuditReference(l, userIds);
    auditClassification[cls] = (auditClassification[cls] || 0) + 1;
  });

  console.log(`  Valid references: ${auditClassification.valid}`);
  console.log(`  Historical valid (stale user_id with preserved email/name): ${auditClassification.historical_valid}`);
  console.log(`  Missing snapshot: ${auditClassification.missing_snapshot}`);
  if (auditClassification.invalid_corrupt > 0) {
    anomaliesCount += auditClassification.invalid_corrupt;
    console.warn(`  ⚠️ Invalid/corrupt audit entries: ${auditClassification.invalid_corrupt}`);
  } else {
    console.log('  ✅ No corrupt audit entries detected.');
  }

  // ---------------------------------------------------------------------------
  // Check 7: Inconsistent archived states
  // ---------------------------------------------------------------------------
  console.log('\n7. Reviewing Archive State Inconsistencies...');
  const activeRecordsOnArchivedPatients = records.filter(r => r.status === 'ACTIVE' && archivedPatientIds.has(r.patient_id));
  const pendingFlagsOnArchivedPatients = flags.filter(f => f.status === 'PENDING' && (archivedPatientIds.has(f.patient_id) || archivedPatientIds.has(f.possible_duplicate_patient_id)));

  if (activeRecordsOnArchivedPatients.length > 0) {
    anomaliesCount += activeRecordsOnArchivedPatients.length;
    console.warn(`  ⚠️ Found ${activeRecordsOnArchivedPatients.length} active records linked to archived patients:`);
    activeRecordsOnArchivedPatients.forEach(r => console.log(`    - Record: ${r.id}, Patient ID: ${r.patient_id}, File: ${r.file_name}`));
  }
  if (pendingFlagsOnArchivedPatients.length > 0) {
    anomaliesCount += pendingFlagsOnArchivedPatients.length;
    console.warn(`  ⚠️ Found ${pendingFlagsOnArchivedPatients.length} pending duplicate flags involving archived patients:`);
    pendingFlagsOnArchivedPatients.forEach(f => console.log(`    - Flag: ${f.id}, Patient: ${f.patient_id}, Possible Duplicate: ${f.possible_duplicate_patient_id}`));
  }
  if (activeRecordsOnArchivedPatients.length === 0 && pendingFlagsOnArchivedPatients.length === 0) {
    console.log('  ✅ No archive state inconsistencies found.');
  }

  console.log('\n==================================================');
  console.log(`INTEGRITY CHECK COMPLETED: ${anomaliesCount} anomaly/anomalies detected.`);
  console.log('==================================================');
}

runIntegrityCheck().catch(err => {
  console.error('Fatal integrity checking error:', err);
  process.exitCode = 1;
});
