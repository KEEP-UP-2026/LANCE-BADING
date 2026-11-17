const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

// Main Study Title
const STUDY_TITLE_LINES = [
  'TALA: A WEB-BASED PATIENT RECORD MANAGEMENT SYSTEM WITH BATCH MIGRATION',
  'FOR THE RURAL HEALTH UNIT OF PAETE, LAGUNA'
];
const STUDY_SUBTITLE = 'HIERARCHICAL INPUT PROCESS OUTPUT (HIPO) MODEL';

// 6 Core Modules and their 18 Submodules
const hipoModules = [
  // ROW 1
  {
    code: '1.0',
    title: '1.0 USER AUTHENTICATION & ACCESS CONTROL',
    submodules: [
      {
        code: '1.1',
        title: '1.1 Login & Session Handling',
        input: 'Staff email, password credentials, session CSRF token',
        process: 'Authenticate user, verify bcrypt hash, sign JWT token with role claim',
        output: 'Active authenticated session, role dashboard redirection'
      },
      {
        code: '1.2',
        title: '1.2 Staff Account Provisioning',
        input: 'Full name, email, assigned role, account status',
        process: 'Validate unique email, hash password, insert staff account to database',
        output: 'Registered staff user profile, active user privileges'
      },
      {
        code: '1.3',
        title: '1.3 Role Permissions & Profile',
        input: 'User ID, profile details, password update request',
        process: 'Verify RBAC permissions, update staff record, enforce route policies',
        output: 'Updated staff profile, enforced module access control'
      }
    ]
  },
  {
    code: '2.0',
    title: '2.0 PATIENT REGISTRATION & PROFILING',
    submodules: [
      {
        code: '2.1',
        title: '2.1 Patient Registration',
        input: 'Demographics (Name, Birthdate, Address, PhilHealth, 4Ps)',
        process: 'Validate required fields, generate unique PAT-YYMMDD-XXXX ID, store in DB',
        output: 'Registered patient master record, unique patient ID'
      },
      {
        code: '2.2',
        title: '2.2 Demographic Update & Archive',
        input: 'Patient ID, updated contact info, archive status flag',
        process: 'Verify write authorization, update patient record, cascade status changes',
        output: 'Updated demographic data, active/archived status record'
      },
      {
        code: '2.3',
        title: '2.3 Duplicate Screening & Merge',
        input: 'First/Last name, date of birth, similarity threshold',
        process: 'Run fuzzy matching algorithm, compute score, merge selected profiles',
        output: 'Duplicate warning flag, consolidated master patient record'
      }
    ]
  },
  {
    code: '3.0',
    title: '3.0 BATCH MIGRATION & DATA INGESTION',
    submodules: [
      {
        code: '3.1',
        title: '3.1 Batch Document Archive Ingestion',
        input: 'Legacy archive package (ZIP/Folder, scanned PDFs, CSV metadata)',
        process: 'Validate archive structure, inspect MIME types, stage files in queue',
        output: 'Staged batch migration queue, file validation summary'
      },
      {
        code: '3.2',
        title: '3.2 Automated Patient Record Linking',
        input: 'Staged legacy documents, patient ID matching rules',
        process: 'Match legacy record IDs to master patient directory, assign document records',
        output: 'Linked patient health documents, migration progress log'
      },
      {
        code: '3.3',
        title: '3.3 Migration Error Handling & Audit',
        input: 'Unmatched legacy files, duplicate records, SHA-256 hashes',
        process: 'Flag unmapped files, verify data preservation checksums, generate audit trail',
        output: 'Batch migration discrepancy report, verified DB integrity'
      }
    ]
  },

  // ROW 2
  {
    code: '4.0',
    title: '4.0 DOCUMENT DIGITIZATION & OCR ENGINE',
    submodules: [
      {
        code: '4.1',
        title: '4.1 Document Upload & Security Check',
        input: 'Scanned paper health records (PDF, PNG, JPG), patient ID',
        process: 'Enforce <10MB size limit, sanitize filename, store in patient directory',
        output: 'Stored document path, temporary upload staging token'
      },
      {
        code: '4.2',
        title: '4.2 Automated OCR Text Extraction',
        input: 'Staged document file, OCR configuration parameters',
        process: 'Run Tesseract.js engine, extract raw text and structural layout blocks',
        output: 'Extracted text content, indexed searchable text database'
      },
      {
        code: '4.3',
        title: '4.3 Health Binder Auto-Classification',
        input: 'OCR extracted text, medical keyword classification dictionary',
        process: 'Match keywords to 5 categories (ITR/Consult/Vax/MedCert/Maternal)',
        output: 'Auto-classified binder record, confirmed category metadata'
      }
    ]
  },
  {
    code: '5.0',
    title: '5.0 CLINICAL RETRIEVAL & UNIFIED SEARCH',
    submodules: [
      {
        code: '5.1',
        title: '5.1 Unified Full-Text & OCR Search',
        input: 'Search keywords, patient name, patient number, date filters',
        process: 'Query database index and OCR text, apply role restrictions, highlight matches',
        output: 'Matching patient records list, highlighted search snippets'
      },
      {
        code: '5.2',
        title: '5.2 Clinical Binder Inspection',
        input: 'Patient ID, selected binder category (ITR, Consult, Vax, Maternal)',
        process: 'Retrieve categorized document list, generate time-limited signed URLs',
        output: 'Interactive document viewer, chronological health timeline'
      },
      {
        code: '5.3',
        title: '5.3 Read-Only Healthcare Review',
        input: 'Healthcare personnel consultation query, patient number',
        process: 'Verify clinical read-only privileges, fetch consultation & treatment history',
        output: 'Complete patient health profile, consultation summary'
      }
    ]
  },
  {
    code: '6.0',
    title: '6.0 STATISTICAL REPORTING & GOVERNANCE',
    submodules: [
      {
        code: '6.1',
        title: '6.1 Demographic & Census Aggregation',
        input: 'Date range, barangay filter, PhilHealth category, 4Ps criteria',
        process: 'Aggregate patient volume, calculate demographic and morbidity statistics',
        output: 'RHU Paete patient census report, statistical summary tables'
      },
      {
        code: '6.2',
        title: '6.2 Compliance Report Export (PDF/CSV)',
        input: 'Filtered report datasets, export format selection (PDF / CSV)',
        process: 'Render formatted PDF with RHU Paete header, compile CSV dataset',
        output: 'Downloadable PDF health report, exported structured CSV file'
      },
      {
        code: '6.3',
        title: '6.3 System Audit Logging & Preservation',
        input: 'User transaction events (Login, Create, Upload, Export, Archive)',
        process: 'Capture user snapshot, action type, IP address, timestamp, trigger DB backup',
        output: 'System audit trail log, verified database backup archive'
      }
    ]
  }
];

// Color & Black-White Theme configurations
const COLOR_THEME = {
  bg: '#FFFFFF',
  border: '#000000',
  treeLine: '#000000',
  rootFill: '#0f3b57',
  rootText: '#FFFFFF',
  rootSubtitle: '#93c5fd',
  modFill: '#1d4ed8',
  modText: '#FFFFFF',
  subFill: '#dbeafe',
  subText: '#0f172a',
  inputFill: '#fefce8',
  inputBorder: '#e2e8f0',
  processFill: '#f0fdf4',
  processBorder: '#e2e8f0',
  outputFill: '#faf5ff',
  outputBorder: '#e2e8f0',
  boxText: '#0f172a',
  badgeText: '#000000'
};

const BW_THEME = {
  bg: '#FFFFFF',
  border: '#000000',
  treeLine: '#000000',
  rootFill: '#FFFFFF',
  rootText: '#000000',
  rootSubtitle: '#000000',
  modFill: '#FFFFFF',
  modText: '#000000',
  subFill: '#FFFFFF',
  subText: '#000000',
  inputFill: '#FFFFFF',
  inputBorder: '#000000',
  processFill: '#FFFFFF',
  processBorder: '#000000',
  outputFill: '#FFFFFF',
  outputBorder: '#000000',
  boxText: '#000000',
  badgeText: '#000000'
};

/**
 * Text wrapping helper
 */
function wrapText(ctx, text, maxWidth) {
  if (!text) return [''];
  const words = text.split(' ');
  const lines = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const width = ctx.measureText(currentLine + ' ' + word).width;
    if (width < maxWidth) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
  return lines;
}

/**
 * Draws the complete HIPO Model Diagram
 */
function drawHipoDiagram(theme = COLOR_THEME) {
  const W = 2360;
  const H = 1040;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  // Outer Framing Rectangle
  const marginX = 25;
  const marginY = 22;
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 2.4;
  ctx.strokeRect(marginX, marginY, W - 2 * marginX, H - 2 * marginY);

  // 1. Root System Title Box at Top Center
  const rootW = 1440;
  const rootH = 72;
  const rootX = (W - rootW) / 2;
  const rootY = 38;

  ctx.save();
  ctx.fillStyle = theme.rootFill;
  ctx.fillRect(rootX, rootY, rootW, rootH);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(rootX, rootY, rootW, rootH);

  // Title Lines
  ctx.fillStyle = theme.rootText;
  ctx.font = 'bold 15px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(STUDY_TITLE_LINES[0], rootX + rootW / 2, rootY + 18);
  ctx.fillText(STUDY_TITLE_LINES[1], rootX + rootW / 2, rootY + 36);

  // Subtitle
  ctx.fillStyle = theme.rootSubtitle;
  ctx.font = 'bold 12px Arial, sans-serif';
  ctx.fillText(STUDY_SUBTITLE, rootX + rootW / 2, rootY + 55);
  ctx.restore();

  // Metrics for Rows and Columns
  const modW = 730;
  const modGapX = 35;
  const totalRowW = 3 * modW + 2 * modGapX; // 2260px
  const startRowX = (W - totalRowW) / 2; // ~50px

  const row1TopY = 160;
  const row2TopY = 575;

  // Root connector line down to row 1
  ctx.save();
  ctx.strokeStyle = theme.treeLine;
  ctx.lineWidth = 1.8;

  // Center vertical stem from root
  ctx.beginPath();
  ctx.moveTo(W / 2, rootY + rootH);
  ctx.lineTo(W / 2, 138);
  ctx.stroke();

  // Horizontal bus line for Row 1
  const row1BusY = 138;
  const colCenters = [
    startRowX + modW * 0.5,
    startRowX + modW + modGapX + modW * 0.5,
    startRowX + 2 * (modW + modGapX) + modW * 0.5
  ];

  ctx.beginPath();
  ctx.moveTo(colCenters[0], row1BusY);
  ctx.lineTo(colCenters[2], row1BusY);
  ctx.stroke();

  // Drop line to each Module in Row 1
  colCenters.forEach(cx => {
    ctx.beginPath();
    ctx.moveTo(cx, row1BusY);
    ctx.lineTo(cx, row1TopY);
    ctx.stroke();
  });

  // Vertical branch from center down to Row 2
  const row2BusY = 552;
  ctx.beginPath();
  ctx.moveTo(W / 2, row1BusY);
  ctx.lineTo(startRowX - 18, row1BusY); // left bypass or clean center
  ctx.stroke();

  // Better clean tree for Row 2: Stem down through center gap
  ctx.beginPath();
  ctx.moveTo(W / 2, row1TopY + 365); // from bottom of row 1 center
  ctx.lineTo(W / 2, row2BusY);
  ctx.stroke();

  // Horizontal bus for Row 2
  ctx.beginPath();
  ctx.moveTo(colCenters[0], row2BusY);
  ctx.lineTo(colCenters[2], row2BusY);
  ctx.stroke();

  // Drop line to each Module in Row 2
  colCenters.forEach(cx => {
    ctx.beginPath();
    ctx.moveTo(cx, row2BusY);
    ctx.lineTo(cx, row2TopY);
    ctx.stroke();
  });
  ctx.restore();

  // Function to draw one Module (with its 3 Submodules and IPO stacks)
  function drawModule(mod, modLeft, modTop) {
    const modH = 32;

    // 1. Module Header Box
    ctx.save();
    ctx.fillStyle = theme.modFill;
    ctx.fillRect(modLeft, modTop, modW, modH);
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1.8;
    ctx.strokeRect(modLeft, modTop, modW, modH);

    ctx.fillStyle = theme.modText;
    ctx.font = 'bold 12.5px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(mod.title, modLeft + modW / 2, modTop + modH / 2);
    ctx.restore();

    // Horizontal distribution bus for the 3 submodules
    const subBusY = modTop + modH + 12;
    const subW = 230;
    const subGapX = 14;
    const subLefts = [
      modLeft + 6,
      modLeft + 6 + subW + subGapX,
      modLeft + 6 + 2 * (subW + subGapX)
    ];
    const subCenters = subLefts.map(l => l + subW / 2);

    ctx.save();
    ctx.strokeStyle = theme.treeLine;
    ctx.lineWidth = 1.5;

    // Stem down from Module header
    ctx.beginPath();
    ctx.moveTo(modLeft + modW / 2, modTop + modH);
    ctx.lineTo(modLeft + modW / 2, subBusY);
    ctx.stroke();

    // Horizontal bus across 3 submodules
    ctx.beginPath();
    ctx.moveTo(subCenters[0], subBusY);
    ctx.lineTo(subCenters[2], subBusY);
    ctx.stroke();

    // Drop stems to each submodule
    subCenters.forEach(scx => {
      ctx.beginPath();
      ctx.moveTo(scx, subBusY);
      ctx.lineTo(scx, subBusY + 10);
      ctx.stroke();
    });
    ctx.restore();

    // 2. Draw 3 Submodules
    const subTopY = subBusY + 10;
    mod.submodules.forEach((sub, sIdx) => {
      const sLeft = subLefts[sIdx];
      const sCenter = subCenters[sIdx];

      // Submodule Header Box
      const subHeaderH = 26;
      ctx.save();
      ctx.fillStyle = theme.subFill;
      ctx.fillRect(sLeft, subTopY, subW, subHeaderH);
      ctx.strokeStyle = theme.border;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(sLeft, subTopY, subW, subHeaderH);

      ctx.fillStyle = theme.subText;
      ctx.font = 'bold 10.5px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sub.title, sCenter, subTopY + subHeaderH / 2);
      ctx.restore();

      // Connector line from submodule header to Input box
      const inputTopY = subTopY + subHeaderH + 8;
      ctx.strokeStyle = theme.treeLine;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(sCenter, subTopY + subHeaderH);
      ctx.lineTo(sCenter, inputTopY);
      ctx.stroke();

      // Helper to draw IPO Box
      function drawIpoBox(topY, boxH, label, content, fill, borderCol) {
        ctx.save();
        ctx.fillStyle = fill;
        ctx.fillRect(sLeft, topY, subW, boxH);
        ctx.strokeStyle = borderCol || theme.border;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(sLeft, topY, subW, boxH);

        // Label Badge
        ctx.fillStyle = theme.badgeText;
        ctx.font = 'bold 10px Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(label, sLeft + 6, topY + 5);

        // Content
        ctx.fillStyle = theme.boxText;
        ctx.font = '9.5px Arial, sans-serif';
        const lines = wrapText(ctx, content, subW - 12);
        const lineH = 13;
        lines.forEach((line, lIdx) => {
          if (lIdx < 4) {
            ctx.fillText(line, sLeft + 6, topY + 20 + lIdx * lineH);
          }
        });
        ctx.restore();
      }

      // 1. INPUT Box
      const inputH = 74;
      drawIpoBox(inputTopY, inputH, 'INPUT:', sub.input, theme.inputFill, theme.inputBorder);

      // Connector to Process
      const processTopY = inputTopY + inputH + 6;
      ctx.beginPath();
      ctx.moveTo(sCenter, inputTopY + inputH);
      ctx.lineTo(sCenter, processTopY);
      ctx.stroke();

      // 2. PROCESS Box
      const processH = 82;
      drawIpoBox(processTopY, processH, 'PROCESS:', sub.process, theme.processFill, theme.processBorder);

      // Connector to Output
      const outputTopY = processTopY + processH + 6;
      ctx.beginPath();
      ctx.moveTo(sCenter, processTopY + processH);
      ctx.lineTo(sCenter, outputTopY);
      ctx.stroke();

      // 3. OUTPUT Box
      const outputH = 74;
      drawIpoBox(outputTopY, outputH, 'OUTPUT:', sub.output, theme.outputFill, theme.outputBorder);
    });
  }

  // Draw Row 1 Modules (1.0, 2.0, 3.0)
  for (let i = 0; i < 3; i++) {
    const mLeft = startRowX + i * (modW + modGapX);
    drawModule(hipoModules[i], mLeft, row1TopY);
  }

  // Draw Row 2 Modules (4.0, 5.0, 6.0)
  for (let i = 0; i < 3; i++) {
    const mLeft = startRowX + i * (modW + modGapX);
    drawModule(hipoModules[i + 3], mLeft, row2TopY);
  }

  return canvas.toBuffer('image/png');
}

// Generate files into target directories
const targetDirs = [
  path.join(__dirname, 'flowcharts'),
  path.join(__dirname, 'src/views/public/flowcharts'),
  'C:\\Users\\Alphi\\.gemini\\antigravity-ide\\brain\\7b985ef1-2fc0-44ea-8cdd-ae3ddd4fb770'
];

targetDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

console.log('Generating HIPO Model Diagrams for TALA (RHU Paete, Laguna)...');

// 1. Color Theme (matching professional thesis presentation)
const colorBuffer = drawHipoDiagram(COLOR_THEME);
targetDirs.forEach(dir => {
  fs.writeFileSync(path.join(dir, 'TALA_HIPO_Model.png'), colorBuffer);
});
console.log(`[Color Theme] Generated: TALA_HIPO_Model.png (${colorBuffer.length} bytes)`);

// 2. Black & White Theme (matching official thesis book print requirements)
const bwBuffer = drawHipoDiagram(BW_THEME);
targetDirs.forEach(dir => {
  fs.writeFileSync(path.join(dir, 'TALA_HIPO_Model_BW.png'), bwBuffer);
});
console.log(`[B&W Theme] Generated: TALA_HIPO_Model_BW.png (${bwBuffer.length} bytes)`);

console.log('All HIPO Model diagrams successfully generated!');
