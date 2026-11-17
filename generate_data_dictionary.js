const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

// Data definition for all 6 database tables in KEEP-UP 2026
const tables = [
  // TABLE 1
  {
    name: 'users',
    fields: [
      { name: 'id', type: 'UUID', format: 'uuid', size: '16 bytes', desc: 'Primary key identifier ng user account', example: 'c3a8e1b2-4d5f-4a6c-8e9b-123456789abc', rel: 'PK' },
      { name: 'full_name', type: 'VARCHAR(255)', format: 'text', size: '255', desc: 'Opisyal na buong pangalan ng kawani o doktor', example: 'Dr. Maria Elena Santos', rel: '-' },
      { name: 'email', type: 'VARCHAR(255)', format: 'email', size: '255', desc: 'Opisyal na email address sa system (unique)', example: 'admin@keepup.com', rel: 'UK' },
      { name: 'password', type: 'VARCHAR(255)', format: 'hashed string', size: '255', desc: 'Bcrypt cryptographic password hash', example: '$2a$10$058vSwsf7kqaa5fK...', rel: '-' },
      { name: 'role', type: 'VARCHAR(50)', format: 'text', size: '50', desc: 'Access role (\'RHU_ADMINISTRATOR\', \'RECORDS_STAFF\', \'HEALTHCARE_PERSONNEL\', \'ADMINISTRATIVE_STAFF\')', example: 'RHU_ADMINISTRATOR', rel: '-' },
      { name: 'status', type: 'VARCHAR(50)', format: 'text', size: '50', desc: 'Katayuan ng user account (\'ACTIVE\', \'INACTIVE\')', example: 'ACTIVE', rel: '-' },
      { name: 'created_at', type: 'TIMESTAMPTZ', format: 'timestamp', size: '8 bytes', desc: 'Petsa at oras ng paglikha ng user account', example: '2026-07-21 08:00:00+08', rel: '-' },
      { name: 'updated_at', type: 'TIMESTAMPTZ', format: 'timestamp', size: '8 bytes', desc: 'Petsa at oras ng huling pagbabago ng tala', example: '2026-10-13 09:30:00+08', rel: '-' }
    ]
  },

  // TABLE 2
  {
    name: 'patients',
    fields: [
      { name: 'id', type: 'UUID', format: 'uuid', size: '16 bytes', desc: 'Primary key identifier ng pasyente', example: 'd4b9f2c3-5e6a-4b7d-9f3c-234567890def', rel: 'PK' },
      { name: 'patient_number', type: 'VARCHAR(100)', format: 'alphanumeric', size: '100', desc: 'Natatanging opisyal na numero ng pasyente (PAT-YYMMDD-XXXX)', example: 'PAT-261013-0042', rel: 'UK' },
      { name: 'first_name', type: 'VARCHAR(255)', format: 'text', size: '255', desc: 'Pangalan ng pasyente', example: 'Juan', rel: '-' },
      { name: 'middle_name', type: 'VARCHAR(255)', format: 'text', size: '255', desc: 'Gitnang pangalan ng pasyente', example: 'Protacio', rel: '-' },
      { name: 'last_name', type: 'VARCHAR(255)', format: 'text', size: '255', desc: 'Apelyido ng pasyente', example: 'Dela Cruz', rel: '-' },
      { name: 'suffix', type: 'VARCHAR(50)', format: 'text', size: '50', desc: 'Hulapi sa pangalan (hal. \'Jr.\', \'Sr.\', \'III\')', example: 'Jr.', rel: '-' },
      { name: 'birth_date', type: 'DATE', format: 'date', size: '4 bytes', desc: 'Araw ng kapanganakan ng pasyente', example: '1995-06-19', rel: '-' },
      { name: 'sex', type: 'VARCHAR(50)', format: 'text', size: '50', desc: 'Kasarian ng pasyente (\'Male\', \'Female\')', example: 'Male', rel: '-' },
      { name: 'civil_status', type: 'VARCHAR(50)', format: 'text', size: '50', desc: 'Katayuang sibil (\'Single\', \'Married\', \'Widowed\', atbp.)', example: 'Single', rel: '-' },
      { name: 'place_of_birth', type: 'VARCHAR(255)', format: 'text', size: '255', desc: 'Lugar ng kapanganakan ng pasyente', example: 'Silang, Cavite', rel: '-' },
      { name: 'religion', type: 'VARCHAR(255)', format: 'text', size: '255', desc: 'Relihiyon ng pasyente', example: 'Roman Catholic', rel: '-' },
      { name: 'nationality', type: 'VARCHAR(100)', format: 'text', size: '100', desc: 'Nasyonalidad ng pasyente', example: 'Filipino', rel: '-' },
      { name: 'house_street_purok', type: 'TEXT', format: 'text', size: '-', desc: 'Numero ng bahay, kalye, o purok ng tirahan', example: 'Purok 4, Ilaya Street', rel: '-' },
      { name: 'barangay', type: 'VARCHAR(255)', format: 'text', size: '255', desc: 'Barangay kung saan naninirahan ang pasyente', example: 'Poblacion 1', rel: '-' },
      { name: 'city_municipality', type: 'VARCHAR(255)', format: 'text', size: '255', desc: 'Lungsod o bayan ng tirahan', example: 'Silang', rel: '-' },
      { name: 'province', type: 'VARCHAR(255)', format: 'text', size: '255', desc: 'Lalawigan ng tirahan', example: 'Cavite', rel: '-' },
      { name: 'address', type: 'TEXT', format: 'text', size: '-', desc: 'Kumpletong pinagsama-samang tirahan', example: 'Purok 4, Poblacion 1, Silang, Cavite', rel: '-' },
      { name: 'contact_number', type: 'VARCHAR(100)', format: 'numeric string', size: '100', desc: 'Numero ng telepono o cellphone ng pasyente', example: '09171234567', rel: '-' },
      { name: 'occupation', type: 'VARCHAR(255)', format: 'text', size: '255', desc: 'Trabaho o hanapbuhay ng pasyente', example: 'Magsasaka', rel: '-' },
      { name: 'philhealth_number', type: 'VARCHAR(100)', format: 'numeric string', size: '100', desc: 'Opisyal na PhilHealth Identification Number', example: '12-345678901-2', rel: '-' },
      { name: 'philhealth_category', type: 'VARCHAR(100)', format: 'text', size: '100', desc: 'Kategorya ng PhilHealth (\'Direct Contributor\', \'Indigent\', atbp.)', example: 'Indigent', rel: '-' },
      { name: 'is_4ps_beneficiary', type: 'VARCHAR(10)', format: 'text', size: '10', desc: 'Katayuan kung benepisyaryo ng 4Ps (\'Yes\', \'No\')', example: 'Yes', rel: '-' },
      { name: 'emergency_contact_name', type: 'VARCHAR(255)', format: 'text', size: '255', desc: 'Pangalan ng tatawagan sa oras ng kagipitan', example: 'Maria Dela Cruz', rel: '-' },
      { name: 'emergency_relationship', type: 'VARCHAR(100)', format: 'text', size: '100', desc: 'Relasyon ng emergency contact (\'Mother\', \'Spouse\', atbp.)', example: 'Mother', rel: '-' },
      { name: 'emergency_contact_number', type: 'VARCHAR(100)', format: 'numeric string', size: '100', desc: 'Numero ng emergency contact', example: '09189876543', rel: '-' },
      { name: 'status', type: 'VARCHAR(50)', format: 'text', size: '50', desc: 'Katayuan ng talaan ng pasyente (\'ACTIVE\', \'ARCHIVED\')', example: 'ACTIVE', rel: '-' },
      { name: 'created_by', type: 'UUID', format: 'uuid', size: '16 bytes', desc: 'Foreign key ng kawani na nagparehistro ng pasyente', example: 'c3a8e1b2-4d5f-4a6c-8e9b-123456789abc', rel: 'FK -> users(id)' },
      { name: 'created_at', type: 'TIMESTAMPTZ', format: 'timestamp', size: '8 bytes', desc: 'Petsa at oras ng paglikha ng tala ng pasyente', example: '2026-08-10 09:15:00+08', rel: '-' },
      { name: 'updated_at', type: 'TIMESTAMPTZ', format: 'timestamp', size: '8 bytes', desc: 'Petsa at oras ng huling pagbabago ng tala', example: '2026-10-12 11:20:00+08', rel: '-' }
    ]
  },

  // TABLE 3
  {
    name: 'patient_records',
    fields: [
      { name: 'id', type: 'UUID', format: 'uuid', size: '16 bytes', desc: 'Primary key identifier ng digitized health record', example: 'e5f6a7b8-c9d0-4e1f-2a3b-456789012345', rel: 'PK' },
      { name: 'patient_id', type: 'UUID', format: 'uuid', size: '16 bytes', desc: 'Foreign key ng kaukulang pasyente', example: 'd4b9f2c3-5e6a-4b7d-9f3c-234567890def', rel: 'FK -> patients(id)' },
      { name: 'record_type', type: 'VARCHAR(100)', format: 'text', size: '100', desc: 'Kategorya ng rekord (\'CONSULTATION_RECORD\', \'IMMUNIZATION_RECORD\', atbp.)', example: 'CONSULTATION_RECORD', rel: '-' },
      { name: 'file_name', type: 'VARCHAR(255)', format: 'filename', size: '255', desc: 'Orihinal na pangalan ng na-upload na file', example: 'consultation_sheet_20261012.pdf', rel: '-' },
      { name: 'file_url', type: 'TEXT', format: 'url', size: '-', desc: 'Ligtas na URL o download link ng dokumento', example: '/uploads/d4b9f2c3/record-01.pdf', rel: '-' },
      { name: 'file_path', type: 'TEXT', format: 'path string', size: '-', desc: 'Internal storage directory path sa server', example: 'uploads/d4b9f2c3/record-01.pdf', rel: '-' },
      { name: 'file_type', type: 'VARCHAR(100)', format: 'MIME type', size: '100', desc: 'MIME format ng dokumento (\'application/pdf\', \'image/png\', atbp.)', example: 'application/pdf', rel: '-' },
      { name: 'extracted_text', type: 'TEXT', format: 'text', size: '-', desc: 'Nailabas na teksto mula sa automated OCR engine', example: 'Chief Complaint: Fever and cough for 3 days...', rel: '-' },
      { name: 'layout_blocks', type: 'TEXT', format: 'text', size: '-', desc: 'Nai-parse na bounding coordinates at blocks ng OCR', example: '{"blocks":[{"x":12,"y":45,"w":200,"h":30}]}', rel: '-' },
      { name: 'structured_json', type: 'JSONB', format: 'json', size: '-', desc: 'Na-extract na structured medical attributes sa JSON', example: '{"vital_signs":{"bp":"120/80","temp":37.5}}', rel: '-' },
      { name: 'classification_result', type: 'VARCHAR(100)', format: 'text', size: '100', desc: 'Kinalabasan ng auto-classifier ng kategorya', example: 'CONSULTATION_RECORD', rel: '-' },
      { name: 'uploaded_by', type: 'UUID', format: 'uuid', size: '16 bytes', desc: 'Foreign key ng kawani na nag-digitize ng dokumento', example: 'c3a8e1b2-4d5f-4a6c-8e9b-123456789abc', rel: 'FK -> users(id)' },
      { name: 'status', type: 'VARCHAR(50)', format: 'text', size: '50', desc: 'Katayuan ng medikal na rekord (\'ACTIVE\', \'ARCHIVED\')', example: 'ACTIVE', rel: '-' },
      { name: 'created_at', type: 'TIMESTAMPTZ', format: 'timestamp', size: '8 bytes', desc: 'Petsa at oras ng pag-upload ng dokumento', example: '2026-10-12 14:10:00+08', rel: '-' },
      { name: 'updated_at', type: 'TIMESTAMPTZ', format: 'timestamp', size: '8 bytes', desc: 'Petsa at oras ng huling pagbabago sa rekord', example: '2026-10-12 14:15:00+08', rel: '-' }
    ]
  },

  // TABLE 4
  {
    name: 'duplicate_flags',
    fields: [
      { name: 'id', type: 'UUID', format: 'uuid', size: '16 bytes', desc: 'Primary key identifier ng duplicate warning flag', example: 'f6a7b8c9-d0e1-4f2a-3b4c-567890123456', rel: 'PK' },
      { name: 'patient_id', type: 'UUID', format: 'uuid', size: '16 bytes', desc: 'Foreign key ng pangunahing pasyente', example: 'd4b9f2c3-5e6a-4b7d-9f3c-234567890def', rel: 'FK -> patients(id)' },
      { name: 'possible_duplicate_patient_id', type: 'UUID', format: 'uuid', size: '16 bytes', desc: 'Foreign key ng pinaghihinalaang katulad na pasyente', example: 'a1b2c3d4-e5f6-4a7b-8c9d-012345678901', rel: 'FK -> patients(id)' },
      { name: 'reason', type: 'TEXT', format: 'text', size: '-', desc: 'Dahilan ng pagkakatugma (Fuzzy match sa pangalan at birth date)', example: 'Fuzzy match on First Name, Last Name and DOB', rel: '-' },
      { name: 'similarity_score', type: 'DECIMAL(5,2)', format: 'percentage', size: '5 bytes', desc: 'Porsyento ng pagkakatulad batay sa fuzzy algorithm', example: '94.50', rel: '-' },
      { name: 'status', type: 'VARCHAR(50)', format: 'text', size: '50', desc: 'Katayuan ng pagsusuri (\'PENDING\', \'REVIEWED\', \'IGNORED\')', example: 'PENDING', rel: '-' },
      { name: 'detected_at', type: 'TIMESTAMPTZ', format: 'timestamp', size: '8 bytes', desc: 'Petsa at oras kung kailan na-detect ang posibleng duplicate', example: '2026-10-13 10:22:00+08', rel: '-' }
    ]
  },

  // TABLE 5
  {
    name: 'temporary_uploads',
    fields: [
      { name: 'token', type: 'UUID', format: 'uuid', size: '16 bytes', desc: 'Primary key security token identifier ng staging upload', example: '9b8c7d6e-5f4a-3b2c-1d0e-9876543210ab', rel: 'PK' },
      { name: 'patient_id', type: 'UUID', format: 'uuid', size: '16 bytes', desc: 'Foreign key ng pasyenteng tatanggap ng dokumento', example: 'd4b9f2c3-5e6a-4b7d-9f3c-234567890def', rel: 'FK -> patients(id)' },
      { name: 'file_name', type: 'VARCHAR(255)', format: 'filename', size: '255', desc: 'Pangalan ng pansamantalang na-upload na file', example: 'temp_scan_patient01.png', rel: '-' },
      { name: 'file_path', type: 'VARCHAR(512)', format: 'path string', size: '512', desc: 'Ligtas na directory path sa staging upload folder', example: 'uploads/temp/temp_scan_patient01.png', rel: '-' },
      { name: 'file_type', type: 'VARCHAR(100)', format: 'MIME type', size: '100', desc: 'MIME format ng file (\'image/png\', \'application/pdf\')', example: 'image/png', rel: '-' },
      { name: 'extracted_text', type: 'TEXT', format: 'text', size: '-', desc: 'Raw OCR text habang isinasailalim sa classification', example: 'Maternal Health Record Gravida 2 Para 1...', rel: '-' },
      { name: 'suggested_category', type: 'VARCHAR(100)', format: 'text', size: '100', desc: 'Iminumungkahing kategorya ng OCR machine classifier', example: 'MATERNAL_CARE_RECORD', rel: '-' },
      { name: 'alternative_category', type: 'VARCHAR(100)', format: 'text', size: '100', desc: 'Ikalawang pinakamalapit na kategorya bilang fallback', example: 'CONSULTATION_RECORD', rel: '-' },
      { name: 'confidence_score', type: 'DECIMAL(5,2)', format: 'percentage', size: '5 bytes', desc: 'Porsyento ng tiwala sa auto-classification (0 - 100%)', example: '98.20', rel: '-' },
      { name: 'classification_reason', type: 'TEXT', format: 'text', size: '-', desc: 'Paliwanag sa napiling kategorya batay sa termino', example: 'Matched terms: \'Gravida\', \'Prenatal\', \'LMP\'', rel: '-' },
      { name: 'matched_terms', type: 'TEXT', format: 'text', size: '-', desc: 'Talaan ng natagpuang medikal na salita mula sa OCR', example: 'Gravida, Prenatal, Trimester, FHT', rel: '-' },
      { name: 'uploaded_by', type: 'UUID', format: 'uuid', size: '16 bytes', desc: 'Foreign key ng kawani na nagpatakbo ng OCR digitization', example: 'c3a8e1b2-4d5f-4a6c-8e9b-123456789abc', rel: 'FK -> users(id)' },
      { name: 'created_at', type: 'TIMESTAMPTZ', format: 'timestamp', size: '8 bytes', desc: 'Petsa at oras ng pansamantalang pag-upload sa staging', example: '2026-10-13 11:05:00+08', rel: '-' }
    ]
  },

  // TABLE 6
  {
    name: 'audit_logs',
    fields: [
      { name: 'id', type: 'UUID', format: 'uuid', size: '16 bytes', desc: 'Primary key identifier ng security audit log record', example: '7e8d9c0b-1a2f-3e4d-5c6b-789012345678', rel: 'PK' },
      { name: 'user_id', type: 'UUID', format: 'uuid', size: '16 bytes', desc: 'Foreign key ng kawani o doktor na gumawa ng aksyon', example: 'c3a8e1b2-4d5f-4a6c-8e9b-123456789abc', rel: 'FK -> users(id)' },
      { name: 'user_email', type: 'VARCHAR(255)', format: 'email', size: '255', desc: 'Email address ng gumawa ng transaksyon', example: 'records@keepup.com', rel: '-' },
      { name: 'actor_name_snapshot', type: 'VARCHAR(255)', format: 'text', size: '255', desc: 'Na-snapshot na buong pangalan ng gumawa ng aksyon', example: 'Records Staff User', rel: '-' },
      { name: 'actor_role_snapshot', type: 'VARCHAR(50)', format: 'text', size: '50', desc: 'Na-snapshot na access role ng gumawa ng aksyon', example: 'RECORDS_STAFF', rel: '-' },
      { name: 'action', type: 'VARCHAR(100)', format: 'text', size: '100', desc: 'Naisagawang operasyon (\'PATIENT_CREATE\', \'USER_LOGIN\', atbp.)', example: 'PATIENT_CREATE', rel: '-' },
      { name: 'details', type: 'TEXT', format: 'text', size: '-', desc: 'Detalyadong impormasyon at snapshot ng pagbabago', example: 'Registered new patient PAT-261013-0042', rel: '-' },
      { name: 'ip_address', type: 'VARCHAR(100)', format: 'ip address', size: '100', desc: 'Client IP address ng pinagmulan ng transaksyon', example: '192.168.1.105', rel: '-' },
      { name: 'created_at', type: 'TIMESTAMPTZ', format: 'timestamp', size: '8 bytes', desc: 'Eksaktong petsa at oras ng pagtatala ng audit event', example: '2026-10-13 11:15:30+08', rel: '-' }
    ]
  }
];

// Columns configuration matching the exact 7 headers from the example images
const COLUMNS = [
  { header: 'FIELD NAME', width: 220, key: 'name', isCode: true },
  { header: 'DATA TYPE', width: 150, key: 'type', isCode: false },
  { header: 'DATA FORMAT', width: 120, key: 'format', isCode: false },
  { header: 'FIELD SIZE', width: 100, key: 'size', isCode: false },
  { header: 'DESCRIPTION', width: 440, key: 'desc', isCode: false },
  { header: 'EXAMPLE', width: 290, key: 'example', isCode: true },
  { header: 'RELATIONSHIP', width: 160, key: 'rel', isCode: false }
];

const TABLE_WIDTH = COLUMNS.reduce((sum, col) => sum + col.width, 0); // 1480px

/**
 * Wraps text to fit within a given maximum width
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
 * Calculates height needed for a table
 */
function calculateTableLayout(ctx, table) {
  const headerHeight = 28;
  const titleHeight = 32;
  const rowHeights = [];

  ctx.font = '11px Arial, sans-serif';
  for (const field of table.fields) {
    // Measure Description column height
    const descLines = wrapText(ctx, field.desc, COLUMNS[4].width - 16);
    // Measure Example column height
    ctx.font = '10px "Courier New", monospace';
    const exampleLines = wrapText(ctx, field.example, COLUMNS[5].width - 14);
    ctx.font = '11px Arial, sans-serif';

    const maxLines = Math.max(descLines.length, exampleLines.length, 1);
    const height = Math.max(25, maxLines * 16 + 8);
    rowHeights.push({ height, descLines, exampleLines });
  }

  const tableBodyHeight = rowHeights.reduce((sum, r) => sum + r.height, 0);
  const totalHeight = titleHeight + headerHeight + tableBodyHeight;
  return { titleHeight, headerHeight, rowHeights, totalHeight };
}

/**
 * Draws a group of up to 3 tables on a single canvas image
 */
function drawTablesImage(tableList, titleSuffix) {
  const marginX = 35;
  const marginY = 35;
  const tableGap = 28;

  // Temporary canvas to measure text
  const tempCanvas = createCanvas(100, 100);
  const tempCtx = tempCanvas.getContext('2d');

  const layouts = tableList.map(t => calculateTableLayout(tempCtx, t));
  const totalTablesHeight = layouts.reduce((sum, l) => sum + l.totalHeight, 0);
  const totalGaps = (tableList.length - 1) * tableGap;

  const canvasWidth = TABLE_WIDTH + 2 * marginX; // ~1550px
  const canvasHeight = totalTablesHeight + totalGaps + 2 * marginY;

  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Outer Border Box
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.strokeRect(marginX, marginY, TABLE_WIDTH, canvasHeight - 2 * marginY);

  let currentY = marginY;

  tableList.forEach((table, tIndex) => {
    const layout = layouts[tIndex];
    const tableLeft = marginX;

    // 1. Table Name Header
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 15px "Courier New", Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(table.name, tableLeft + 12, currentY + layout.titleHeight / 2);

    currentY += layout.titleHeight;

    const tableTop = currentY;

    // 2. Table Column Headers
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(tableLeft, tableTop, TABLE_WIDTH, layout.headerHeight);

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(tableLeft, tableTop, TABLE_WIDTH, layout.headerHeight);

    let curColX = tableLeft;
    COLUMNS.forEach((col) => {
      // Header Text
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 11px Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(col.header, curColX + 8, tableTop + layout.headerHeight / 2);

      // Vertical line after header column
      ctx.beginPath();
      ctx.moveTo(curColX + col.width, tableTop);
      ctx.lineTo(curColX + col.width, tableTop + layout.headerHeight);
      ctx.stroke();

      curColX += col.width;
    });

    currentY += layout.headerHeight;

    // 3. Table Rows
    table.fields.forEach((field, fIndex) => {
      const rowInfo = layout.rowHeights[fIndex];
      const rowHeight = rowInfo.height;
      const rowTop = currentY;

      // Draw horizontal line at top of row
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.strokeRect(tableLeft, rowTop, TABLE_WIDTH, rowHeight);

      let colX = tableLeft;
      COLUMNS.forEach((col, cIndex) => {
        const cellLeft = colX;
        const cellWidth = col.width;
        const cellPadding = 8;

        // Draw cell content
        ctx.fillStyle = '#000000';
        if (col.key === 'name') {
          ctx.font = '11.5px "Courier New", Consolas, monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(field.name, cellLeft + cellPadding, rowTop + rowHeight / 2);
        } else if (col.key === 'type') {
          ctx.font = '11px Arial, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(field.type, cellLeft + cellPadding, rowTop + rowHeight / 2);
        } else if (col.key === 'format') {
          ctx.font = '11px Arial, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(field.format, cellLeft + cellPadding, rowTop + rowHeight / 2);
        } else if (col.key === 'size') {
          ctx.font = '11px Arial, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(field.size, cellLeft + cellPadding, rowTop + rowHeight / 2);
        } else if (col.key === 'desc') {
          ctx.font = '11px Arial, sans-serif';
          ctx.textAlign = 'left';
          const lines = rowInfo.descLines;
          const lineH = 15;
          const startTextY = rowTop + (rowHeight - (lines.length - 1) * lineH) / 2;
          lines.forEach((l, li) => {
            ctx.fillText(l, cellLeft + cellPadding, startTextY + li * lineH);
          });
        } else if (col.key === 'example') {
          ctx.font = '10.5px "Courier New", Consolas, monospace';
          ctx.textAlign = 'left';
          const lines = rowInfo.exampleLines;
          const lineH = 14;
          const startTextY = rowTop + (rowHeight - (lines.length - 1) * lineH) / 2;
          lines.forEach((l, li) => {
            ctx.fillText(l, cellLeft + cellPadding, startTextY + li * lineH);
          });
        } else if (col.key === 'rel') {
          ctx.font = 'bold 11px Arial, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(field.rel, cellLeft + cellPadding, rowTop + rowHeight / 2);
        }

        // Draw vertical column divider line
        ctx.beginPath();
        ctx.moveTo(cellLeft + cellWidth, rowTop);
        ctx.lineTo(cellLeft + cellWidth, rowTop + rowHeight);
        ctx.stroke();

        colX += cellWidth;
      });

      currentY += rowHeight;
    });

    currentY += tableGap;
  });

  return canvas.toBuffer('image/png');
}

// Group tables into batches of 3
const BATCH_SIZE = 3;
const groups = [];
for (let i = 0; i < tables.length; i += BATCH_SIZE) {
  groups.push(tables.slice(i, i + BATCH_SIZE));
}

// Target directories
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

console.log(`Generating Data Dictionary PNGs (${groups.length} image batches)...`);

groups.forEach((group, index) => {
  const partNumber = index + 1;
  const tableNames = group.map(t => t.name).join('_');
  const filename = `Data_Dictionary_Part_${partNumber}.png`;
  const pngBuffer = drawTablesImage(group, `Part ${partNumber}`);

  targetDirs.forEach(dir => {
    fs.writeFileSync(path.join(dir, filename), pngBuffer);
  });

  console.log(`Saved [${filename}]: Contains tables [${group.map(t => t.name).join(', ')}] (${pngBuffer.length} bytes)`);
});

console.log('All Data Dictionary images generated successfully!');
