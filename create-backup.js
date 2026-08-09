/**
 * Final Verified Backup Script
 * Creates a complete timestamped backup with manifest and checksums
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BACKUP_DIR = path.join(__dirname, 'backups', 'final-core-complete-2026-07-21T00-00-00');

// Files and directories to include in backup
const BACKUP_ITEMS = [
  // Source code
  { type: 'dir', path: 'src' },
  
  // Configuration files
  { type: 'file', path: 'package.json' },
  { type: 'file', path: 'package-lock.json' },
  { type: 'file', path: '.env.example' },
  { type: 'file', path: 'server.js' },
  
  // Database and schema
  { type: 'file', path: 'database.json' },
  { type: 'file', path: 'schema.sql' },
  { type: 'file', path: 'rls_policies.sql' },
  { type: 'file', path: 'audit_snapshots_migration.sql' },
  { type: 'file', path: 'migrate-audit-snapshots.js' },
  
  // Test suites
  { type: 'file', path: 'security-tests.js' },
  { type: 'file', path: 'phase3-tests.js' },
  { type: 'file', path: 'core-walkthrough-tests.js' },
  { type: 'file', path: 'final-completion-tests.js' },
  { type: 'file', path: 'test-helpers.js' },
  
  // Utilities
  { type: 'file', path: 'integrity-checker.js' },
  { type: 'file', path: 'cleanup-orphan-files.js' },
  
  // Training data
  { type: 'file', path: 'eng.traineddata' },
  
  // Storage (referenced patient files only - will be selective)
  { type: 'dir', path: 'uploads' },
  { type: 'dir', path: 'storage/quarantine' }
];

// Calculate file checksum
function calculateChecksum(filePath) {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

// Copy file with metadata
function copyFileWithMetadata(srcPath, destPath) {
  const stats = fs.statSync(srcPath);
  fs.copyFileSync(srcPath, destPath);
  
  return {
    relativePath: path.relative(__dirname, srcPath),
    size: stats.size,
    checksum: calculateChecksum(srcPath),
    timestamp: stats.mtime.toISOString()
  };
}

// Recursively copy directory
function copyDirectory(src, dest, manifest, excludePatterns = []) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const relativePath = path.relative(__dirname, srcPath);
    
    // Check exclusions
    const shouldExclude = excludePatterns.some(pattern => {
      if (typeof pattern === 'string') {
        return relativePath.includes(pattern);
      }
      return pattern.test(relativePath);
    });
    
    if (shouldExclude) {
      continue;
    }
    
    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath, manifest, excludePatterns);
    } else if (entry.isFile()) {
      const metadata = copyFileWithMetadata(srcPath, destPath);
      manifest.files.push(metadata);
    }
  }
}

// Main backup function
function createBackup() {
  console.log('🔄 Starting final verified backup...');
  console.log(`📁 Backup location: ${BACKUP_DIR}`);
  
  const manifest = {
    backupName: 'KEEP UP Web Core - Final Complete',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    scope: 'Objectives 1-5 (Web Only)',
    files: []
  };
  
  // Ensure backup directory exists
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  
  // Process each backup item
  for (const item of BACKUP_ITEMS) {
    const srcPath = path.join(__dirname, item.path);
    
    if (!fs.existsSync(srcPath)) {
      console.log(`⚠️  Skipping missing: ${item.path}`);
      continue;
    }
    
    const destPath = path.join(BACKUP_DIR, item.path);
    
    try {
      if (item.type === 'file') {
        // Ensure destination directory exists
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        
        const metadata = copyFileWithMetadata(srcPath, destPath);
        manifest.files.push(metadata);
        console.log(`✅ Backed up: ${item.path} (${(metadata.size / 1024).toFixed(2)} KB)`);
        
      } else if (item.type === 'dir') {
        // Exclude node_modules, test artifacts, logs
        const excludePatterns = [
          'node_modules',
          '.env',
          /\.log$/,
          /cleanup-report-.*\.json$/
        ];
        
        copyDirectory(srcPath, destPath, manifest, excludePatterns);
        console.log(`✅ Backed up directory: ${item.path}`);
      }
    } catch (error) {
      console.error(`❌ Error backing up ${item.path}:`, error.message);
    }
  }
  
  // Write manifest
  const manifestPath = path.join(BACKUP_DIR, 'backup-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  
  // Calculate summary statistics
  const totalSize = manifest.files.reduce((sum, f) => sum + f.size, 0);
  const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
  
  console.log('\n📊 BACKUP SUMMARY');
  console.log(`Files backed up: ${manifest.files.length}`);
  console.log(`Total size: ${totalSizeMB} MB`);
  console.log(`Manifest: ${manifestPath}`);
  
  // Verify backup
  console.log('\n🔍 Verifying backup integrity...');
  let verificationErrors = 0;
  
  for (const fileInfo of manifest.files) {
    const backupFilePath = path.join(BACKUP_DIR, fileInfo.relativePath);
    
    if (!fs.existsSync(backupFilePath)) {
      console.error(`❌ Missing: ${fileInfo.relativePath}`);
      verificationErrors++;
      continue;
    }
    
    const backupChecksum = calculateChecksum(backupFilePath);
    if (backupChecksum !== fileInfo.checksum) {
      console.error(`❌ Checksum mismatch: ${fileInfo.relativePath}`);
      verificationErrors++;
    }
  }
  
  if (verificationErrors === 0) {
    console.log('✅ All files verified successfully');
    
    // Create verification stamp
    const stampPath = path.join(BACKUP_DIR, 'BACKUP_VERIFIED.txt');
    const stamp = `KEEP UP Web Core - Final Verified Backup
Created: ${manifest.timestamp}
Files: ${manifest.files.length}
Total Size: ${totalSizeMB} MB
Verification: PASSED
All checksums validated

This backup represents the completed state of KEEP UP Web Core v1.0.0
covering Objectives 1-5 within the web-only development scope.

DO NOT include actual .env secrets when sharing this backup.
`;
    fs.writeFileSync(stampPath, stamp);
    console.log(`\n✅ BACKUP COMPLETE AND VERIFIED`);
    console.log(`📄 Verification stamp: ${stampPath}`);
    
  } else {
    console.error(`\n❌ BACKUP VERIFICATION FAILED: ${verificationErrors} errors`);
    process.exit(1);
  }
}

// Run backup
try {
  createBackup();
} catch (error) {
  console.error('❌ Backup failed:', error);
  process.exit(1);
}
