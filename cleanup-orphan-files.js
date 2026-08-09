// KEEP UP System - Orphan Upload File Cleanup (dry-run by default)
// Usage:
//   node cleanup-orphan-files.js              # report only (default)
//   node cleanup-orphan-files.js --dry-run      # explicit dry-run
//   node cleanup-orphan-files.js --quarantine   # move confirmed test artifacts
//   node cleanup-orphan-files.js --delete-confirmed  # delete from quarantine manifest only

const fs = require('fs');
const path = require('path');
const { dbClient, isSupabase, jsonDbPath } = require('./src/config/db');

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
const QUARANTINE_ROOT = path.resolve(process.cwd(), 'storage', 'quarantine');
const MANIFEST_PATH = path.join(QUARANTINE_ROOT, 'quarantine-manifest.json');

const TEST_ARTIFACT_PATTERNS = [
  /^hack\.pdf$/i,
  /^dup_file\.png$/i,
  /^verified_immunization\.png$/i,
  /^override_category\.png$/i,
  /^xss\.png$/i,
  /^health_card\.pdf$/i,
  /^temp-/i,
  /^WALK25-/i,
  /^\d{13}-\d+\.(png|pdf|jpg|jpeg)$/i
];

function getAllFiles(dirPath, arrayOfFiles = []) {
  if (!fs.existsSync(dirPath)) return arrayOfFiles;
  for (const file of fs.readdirSync(dirPath)) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(fullPath);
    }
  }
  return arrayOfFiles;
}

function isInsideRoot(targetPath, rootPath) {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(rootPath);
  return resolved === root || resolved.startsWith(root + path.sep);
}

function loadDbReferences() {
  let records = [];
  let temps = [];

  if (isSupabase) {
    throw new Error('Quarantine cleanup script supports local JSON mode only. Set FORCE_LOCAL_DB=true.');
  }

  if (!fs.existsSync(jsonDbPath)) {
    return { records, temps };
  }

  const db = JSON.parse(fs.readFileSync(jsonDbPath, 'utf-8'));
  records = db.patient_records || [];
  temps = db.temporary_uploads || [];
  return { records, temps };
}

function buildReferencedPathSet(records, temps) {
  const refs = new Set();
  [...records, ...temps].forEach(entry => {
    if (entry.file_path) {
      refs.add(path.normalize(entry.file_path));
      refs.add(path.normalize(path.resolve(process.cwd(), entry.file_path)));
    }
  });
  return refs;
}

function classifyFile(fullPath, referencedPaths) {
  const rel = path.relative(process.cwd(), fullPath);
  const normalizedRel = path.normalize(rel);
  const basename = path.basename(fullPath);
  const stat = fs.statSync(fullPath);
  const inUploadRoot = isInsideRoot(fullPath, UPLOAD_ROOT);
  const inTempSubdir = normalizedRel.includes(path.join('uploads', 'temp'));
  const dbReferenced = referencedPaths.has(normalizedRel) || referencedPaths.has(path.resolve(fullPath));
  const isTestArtifact = TEST_ARTIFACT_PATTERNS.some(p => p.test(basename));

  let classification = 'unreferenced_unknown';
  if (dbReferenced) classification = 'referenced';
  else if (inTempSubdir) classification = 'unreferenced_temp';
  else if (isTestArtifact) classification = 'confirmed_test_artifact';
  else if (!inUploadRoot) classification = 'outside_upload_root';

  return {
    path: normalizedRel,
    absolute_path: fullPath,
    filename: basename,
    size_bytes: stat.size,
    modified_at: stat.mtime.toISOString(),
    in_upload_root: inUploadRoot,
    db_referenced: dbReferenced,
    supabase_referenced: null,
    classification
  };
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return { entries: [], created_at: null };
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
}

function saveManifest(manifest) {
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');
}

async function runCleanup() {
  const args = process.argv.slice(2);
  const dryRun = args.length === 0 || args.includes('--dry-run');
  const quarantine = args.includes('--quarantine');
  const deleteConfirmed = args.includes('--delete-confirmed');

  console.log('==================================================');
  console.log('       KEEP UP ORPHAN FILE CLEANUP');
  console.log('==================================================');
  console.log(`Mode: ${deleteConfirmed ? 'DELETE-CONFIRMED' : quarantine ? 'QUARANTINE' : 'DRY-RUN'}`);
  console.log(`Upload root: ${UPLOAD_ROOT}\n`);

  const { records, temps } = loadDbReferences();
  const referencedPaths = buildReferencedPathSet(records, temps);
  const physicalFiles = getAllFiles(UPLOAD_ROOT).filter(f => !f.includes(path.join('uploads', 'temp')));

  const inventory = physicalFiles.map(f => classifyFile(f, referencedPaths));
  const unreferenced = inventory.filter(i => i.classification !== 'referenced');
  const confirmedArtifacts = unreferenced.filter(i => i.classification === 'confirmed_test_artifact');

  const report = {
    timestamp: new Date().toISOString(),
    mode: deleteConfirmed ? 'delete-confirmed' : quarantine ? 'quarantine' : 'dry-run',
    total_files_scanned: inventory.length,
    referenced_count: inventory.filter(i => i.classification === 'referenced').length,
    unreferenced_count: unreferenced.length,
    confirmed_test_artifacts: confirmedArtifacts.length,
    actions: [],
    inventory: unreferenced
  };

  if (dryRun && !quarantine && !deleteConfirmed) {
    console.log(`Scanned: ${report.total_files_scanned} files`);
    console.log(`Referenced (protected): ${report.referenced_count}`);
    console.log(`Unreferenced: ${report.unreferenced_count}`);
    console.log(`Confirmed test artifacts: ${report.confirmed_test_artifacts}`);
    confirmedArtifacts.forEach(f => console.log(`  [artifact] ${f.path} (${f.size_bytes} bytes)`));
    const reportPath = path.join(process.cwd(), `cleanup-report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`\nDry-run report saved: ${reportPath}`);
    console.log('No files were modified.');
    return report;
  }

  if (quarantine) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const quarantineDir = path.join(QUARANTINE_ROOT, stamp);
    fs.mkdirSync(quarantineDir, { recursive: true });

    for (const file of confirmedArtifacts) {
      if (!isInsideRoot(file.absolute_path, UPLOAD_ROOT)) {
        report.actions.push({ path: file.path, status: 'skipped', reason: 'outside upload root' });
        continue;
      }
      if (file.db_referenced) {
        report.actions.push({ path: file.path, status: 'skipped', reason: 'db referenced' });
        continue;
      }
      const dest = path.join(quarantineDir, file.filename);
      fs.renameSync(file.absolute_path, dest);
      report.actions.push({ path: file.path, status: 'quarantined', dest: path.relative(process.cwd(), dest) });
    }

    const manifest = loadManifest();
    manifest.entries = manifest.entries || [];
    manifest.entries.push({
      quarantined_at: new Date().toISOString(),
      quarantine_dir: path.relative(process.cwd(), quarantineDir),
      files: report.actions.filter(a => a.status === 'quarantined')
    });
    saveManifest(manifest);

    const reportPath = path.join(process.cwd(), `cleanup-report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`Quarantined: ${report.actions.filter(a => a.status === 'quarantined').length}`);
    console.log(`Report: ${reportPath}`);
    return report;
  }

  if (deleteConfirmed) {
    const manifest = loadManifest();
    let deleted = 0;
    for (const batch of manifest.entries || []) {
      for (const entry of batch.files || []) {
        const abs = path.resolve(process.cwd(), entry.dest);
        if (!isInsideRoot(abs, QUARANTINE_ROOT)) {
          report.actions.push({ path: entry.dest, status: 'skipped', reason: 'not in quarantine root' });
          continue;
        }
        if (fs.existsSync(abs)) {
          fs.unlinkSync(abs);
          deleted += 1;
          report.actions.push({ path: entry.dest, status: 'deleted' });
        }
      }
    }
    const reportPath = path.join(process.cwd(), `cleanup-report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`Deleted from quarantine: ${deleted}`);
    console.log(`Report: ${reportPath}`);
    return report;
  }

  return report;
}

runCleanup().catch(err => {
  console.error('Cleanup failed:', err.message);
  process.exitCode = 1;
});
