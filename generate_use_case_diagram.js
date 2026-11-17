const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

// Color Palettes
const COLOR_THEME = {
  bg: '#FFFFFF',
  border: '#000000',
  title: '#000000',
  actorText: '#000000',
  actorStroke: '#000000',
  associationLine: '#000000',
  umlLine: '#000000',
  umlText: '#000000',
  legendBg: '#FFFFFF',
  legendBorder: '#cbd5e1',
  categories: {
    auth: { fill: '#d0e6f7', text: '#000000', label: 'Authentication' },
    patient: { fill: '#d7f2db', text: '#000000', label: 'Patient Management' },
    ocr: { fill: '#e8ddf8', text: '#000000', label: 'Digitization & OCR' },
    clinical: { fill: '#fef0cb', text: '#000000', label: 'Clinical Health Records' },
    search: { fill: '#cff0f3', text: '#000000', label: 'Search & Archival' },
    governance: { fill: '#fbdfe4', text: '#000000', label: 'Administration & Governance' }
  }
};

const BW_THEME = {
  bg: '#FFFFFF',
  border: '#000000',
  title: '#000000',
  actorText: '#000000',
  actorStroke: '#000000',
  associationLine: '#000000',
  umlLine: '#000000',
  umlText: '#000000',
  legendBg: '#FFFFFF',
  legendBorder: '#000000',
  categories: {
    auth: { fill: '#FFFFFF', text: '#000000', label: 'Authentication' },
    patient: { fill: '#FFFFFF', text: '#000000', label: 'Patient Management' },
    ocr: { fill: '#FFFFFF', text: '#000000', label: 'Digitization & OCR' },
    clinical: { fill: '#FFFFFF', text: '#000000', label: 'Clinical Health Records' },
    search: { fill: '#FFFFFF', text: '#000000', label: 'Search & Archival' },
    governance: { fill: '#FFFFFF', text: '#000000', label: 'Administration & Governance' }
  }
};

// Use Cases Definition
const useCases = {
  // Column 1
  reg_patient: { id: 'reg_patient', text: 'Register New Patient', cat: 'patient', x: 375, y: 135, w: 180, h: 44 },
  search_patient: { id: 'search_patient', text: 'Search Patient Directory', cat: 'patient', x: 375, y: 205, w: 185, h: 44 },
  edit_patient: { id: 'edit_patient', text: 'Update Patient Demographics', cat: 'patient', x: 375, y: 275, w: 195, h: 44 },
  upload_doc: { id: 'upload_doc', text: 'Upload Scanned Documents', cat: 'ocr', x: 375, y: 350, w: 195, h: 44 },
  view_itr: { id: 'view_itr', text: 'Inspect Treatment Records (ITR)', cat: 'clinical', x: 375, y: 430, w: 205, h: 44 },
  view_consult: { id: 'view_consult', text: 'Review Consultation Records', cat: 'clinical', x: 375, y: 510, w: 200, h: 44 },
  view_vax_mat: { id: 'view_vax_mat', text: 'Examine Vax & Maternal Care', cat: 'clinical', x: 375, y: 590, w: 205, h: 44 },
  view_medcert: { id: 'view_medcert', text: 'Verify Medical Certificates', cat: 'clinical', x: 375, y: 670, w: 195, h: 44 },

  // Column 2
  dup_warn: { id: 'dup_warn', text: 'Screen Duplicate Warnings', cat: 'patient', x: 620, y: 140, w: 195, h: 44 },
  ocr_extract: { id: 'ocr_extract', text: 'Extract OCR Text', cat: 'ocr', x: 620, y: 220, w: 175, h: 44 },
  classify_binder: { id: 'classify_binder', text: 'Auto-Classify Binders', cat: 'ocr', x: 620, y: 300, w: 180, h: 44 },
  unified_search: { id: 'unified_search', text: 'Unified Full-Text Search', cat: 'search', x: 620, y: 400, w: 195, h: 44 },
  manage_archives: { id: 'manage_archives', text: 'Manage Archives Directory', cat: 'search', x: 620, y: 495, w: 195, h: 44 },
  gen_reports: { id: 'gen_reports', text: 'Generate Census & Reports', cat: 'governance', x: 620, y: 615, w: 200, h: 44 },

  // Column 3
  manage_profile: { id: 'manage_profile', text: 'Manage User Profile', cat: 'auth', x: 865, y: 135, w: 180, h: 44 },
  merge_patient: { id: 'merge_patient', text: 'Merge Duplicate Profiles', cat: 'patient', x: 865, y: 215, w: 195, h: 44 },
  override_cat: { id: 'override_cat', text: 'Override Record Category', cat: 'ocr', x: 865, y: 295, w: 195, h: 44 },
  review_ocr_notes: { id: 'review_ocr_notes', text: 'Review OCR Clinical Notes', cat: 'clinical', x: 865, y: 410, w: 195, h: 44 },
  export_reports: { id: 'export_reports', text: 'Export Reports (PDF / CSV)', cat: 'governance', x: 865, y: 550, w: 195, h: 44 },
  review_audit: { id: 'review_audit', text: 'Review Audit Logs & Trails', cat: 'governance', x: 865, y: 665, w: 195, h: 44 },

  // Column 4
  auth_user: { id: 'auth_user', text: 'Authenticate User', cat: 'auth', x: 1105, y: 135, w: 175, h: 44 },
  manage_users: { id: 'manage_users', text: 'Manage Staff User Accounts', cat: 'governance', x: 1105, y: 330, w: 200, h: 44 },
  system_monitor: { id: 'system_monitor', text: 'System Health Monitoring', cat: 'governance', x: 1105, y: 500, w: 195, h: 44 },
  backup_data: { id: 'backup_data', text: 'Execute Database Backups', cat: 'governance', x: 1105, y: 665, w: 195, h: 44 }
};

// Actor definitions
const actors = [
  { id: 'records_staff', label: 'Records Staff', x: 88, y: 220 },
  { id: 'healthcare', label: 'Healthcare\nPersonnel', x: 88, y: 470 },
  { id: 'admin_staff', label: 'Administrative\nStaff', x: 88, y: 670 },
  { id: 'rhu_admin', label: 'RHU\nAdministrator', x: 1475, y: 450 }
];

// Associations (Actor to Use Case)
const associations = [
  // Records Staff associations
  { actor: 'records_staff', uc: 'reg_patient' },
  { actor: 'records_staff', uc: 'search_patient' },
  { actor: 'records_staff', uc: 'edit_patient' },
  { actor: 'records_staff', uc: 'upload_doc' },
  { actor: 'records_staff', uc: 'unified_search' },
  { actor: 'records_staff', uc: 'manage_archives' },

  // Healthcare Personnel associations
  { actor: 'healthcare', uc: 'search_patient' },
  { actor: 'healthcare', uc: 'view_itr' },
  { actor: 'healthcare', uc: 'view_consult' },
  { actor: 'healthcare', uc: 'view_vax_mat' },
  { actor: 'healthcare', uc: 'view_medcert' },
  { actor: 'healthcare', uc: 'review_ocr_notes' },

  // Administrative Staff associations
  { actor: 'admin_staff', uc: 'search_patient' },
  { actor: 'admin_staff', uc: 'view_itr' },
  { actor: 'admin_staff', uc: 'unified_search' },
  { actor: 'admin_staff', uc: 'manage_archives' },
  { actor: 'admin_staff', uc: 'gen_reports' },
  { actor: 'admin_staff', uc: 'export_reports' },

  // RHU Administrator associations
  { actor: 'rhu_admin', uc: 'manage_profile' },
  { actor: 'rhu_admin', uc: 'manage_users' },
  { actor: 'rhu_admin', uc: 'system_monitor' },
  { actor: 'rhu_admin', uc: 'review_audit' },
  { actor: 'rhu_admin', uc: 'backup_data' },
  { actor: 'rhu_admin', uc: 'manage_archives' }
];

// UML Relationships between Use Cases
const umlRelations = [
  { from: 'reg_patient', to: 'dup_warn', type: 'include' },
  { from: 'dup_warn', to: 'merge_patient', type: 'extend' },
  { from: 'upload_doc', to: 'ocr_extract', type: 'include' },
  { from: 'ocr_extract', to: 'classify_binder', type: 'include' },
  { from: 'classify_binder', to: 'override_cat', type: 'extend' },
  { from: 'gen_reports', to: 'export_reports', type: 'include' },
  { from: 'manage_profile', to: 'auth_user', type: 'include' }
];

/**
 * Draws the complete Use Case Diagram
 */
function drawUseCaseDiagram(theme = COLOR_THEME) {
  const W = 1580;
  const H = 940;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  // Outer Box Frame
  const marginX = 25;
  const marginY = 25;
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 2.2;
  ctx.strokeRect(marginX, marginY, W - 2 * marginX, H - 2 * marginY);

  // System Boundary Box
  const sysLeft = 195;
  const sysTop = 50;
  const sysWidth = 1175;
  const sysHeight = 750;

  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1.8;
  ctx.strokeRect(sysLeft, sysTop, sysWidth, sysHeight);

  // System Boundary Title
  ctx.fillStyle = theme.title;
  ctx.font = 'bold 22px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('KEEP UP', sysLeft + sysWidth / 2, sysTop + 14);

  // Helper to draw Stick Figure Actor
  function drawActor(actor) {
    const { x, y, label } = actor;
    const headR = 14;

    ctx.save();
    ctx.strokeStyle = theme.actorStroke;
    ctx.lineWidth = 2;

    // Head
    ctx.beginPath();
    ctx.arc(x, y - 28, headR, 0, Math.PI * 2);
    ctx.stroke();

    // Body
    ctx.beginPath();
    ctx.moveTo(x, y - 14);
    ctx.lineTo(x, y + 16);
    ctx.stroke();

    // Arms
    ctx.beginPath();
    ctx.moveTo(x - 20, y - 2);
    ctx.lineTo(x + 20, y - 2);
    ctx.stroke();

    // Legs
    ctx.beginPath();
    ctx.moveTo(x, y + 16);
    ctx.lineTo(x - 16, y + 42);
    ctx.moveTo(x, y + 16);
    ctx.lineTo(x + 16, y + 42);
    ctx.stroke();

    // Label
    ctx.fillStyle = theme.actorText;
    ctx.font = 'bold 12.5px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const lines = label.split('\n');
    lines.forEach((line, idx) => {
      ctx.fillText(line, x, y + 48 + idx * 15);
    });

    ctx.restore();
  }

  // Draw Association Lines from Actors to Use Cases
  ctx.save();
  ctx.strokeStyle = theme.associationLine;
  ctx.lineWidth = 1.3;

  associations.forEach(assoc => {
    const act = actors.find(a => a.id === assoc.actor);
    const uc = useCases[assoc.uc];
    if (!act || !uc) return;

    // Line from actor torso to use case boundary
    const fromX = act.x > uc.x ? act.x - 20 : act.x + 20;
    const fromY = act.y;
    const toX = act.x > uc.x ? uc.x + uc.w / 2 : uc.x - uc.w / 2;
    const toY = uc.y;

    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
  });
  ctx.restore();

  // Helper to draw dashed UML arrows (include / extend)
  function drawUmlArrow(fromUc, toUc, stereotype) {
    ctx.save();
    ctx.strokeStyle = theme.umlLine;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 4]);

    const startX = fromUc.x + fromUc.w / 2;
    const startY = fromUc.y;
    const endX = toUc.x - toUc.w / 2;
    const endY = toUc.y;

    // Draw dashed line
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    // Draw arrowhead
    ctx.setLineDash([]);
    const angle = Math.atan2(endY - startY, endX - startX);
    const headLen = 8;

    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - headLen * Math.cos(angle - Math.PI / 6), endY - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - headLen * Math.cos(angle + Math.PI / 6), endY - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();

    // Stereotype text
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2 - 8;
    ctx.fillStyle = theme.umlText;
    ctx.font = 'italic 10px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`<<${stereotype}>>`, midX, midY);

    ctx.restore();
  }

  // Draw UML relations
  umlRelations.forEach(rel => {
    const fromUc = useCases[rel.from];
    const toUc = useCases[rel.to];
    if (fromUc && toUc) {
      drawUmlArrow(fromUc, toUc, rel.type);
    }
  });

  // Helper to draw Use Case Ellipse
  function drawUseCase(uc) {
    ctx.save();
    const { x, y, w, h, text, cat } = uc;
    const colorCfg = theme.categories[cat];

    ctx.beginPath();
    ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = colorCfg.fill;
    ctx.fill();
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Text inside ellipse
    ctx.fillStyle = colorCfg.text;
    ctx.font = '11px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);

    ctx.restore();
  }

  // Draw all Use Cases
  Object.values(useCases).forEach(drawUseCase);

  // Draw Actors
  actors.forEach(drawActor);

  // Draw Legend Box at Bottom
  const legW = 1040;
  const legH = 68;
  const legLeft = (W - legW) / 2;
  const legTop = H - marginY - legH - 12;

  ctx.save();
  ctx.fillStyle = theme.legendBg;
  ctx.strokeStyle = theme.legendBorder;
  ctx.lineWidth = 1.5;

  // Rounded rectangle
  const r = 8;
  ctx.beginPath();
  ctx.moveTo(legLeft + r, legTop);
  ctx.lineTo(legLeft + legW - r, legTop);
  ctx.arcTo(legLeft + legW, legTop, legLeft + legW, legTop + r, r);
  ctx.lineTo(legLeft + legW, legTop + legH - r);
  ctx.arcTo(legLeft + legW, legTop + legH, legLeft + legW - r, legTop + legH, r);
  ctx.lineTo(legLeft + r, legTop + legH);
  ctx.arcTo(legLeft, legTop + legH, legLeft, legTop + legH - r, r);
  ctx.lineTo(legLeft, legTop + r);
  ctx.arcTo(legLeft, legTop, legLeft + r, legTop, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Legend Title
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 11px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('LEGEND', legLeft + legW / 2, legTop + 8);

  // Legend Items
  const catKeys = Object.keys(theme.categories);
  const itemSpacing = legW / (catKeys.length + 1);
  const swatchY = legTop + 36;

  catKeys.forEach((key, idx) => {
    const item = theme.categories[key];
    const itemX = legLeft + itemSpacing * (idx + 0.85);

    // Swatch box
    ctx.fillStyle = item.fill;
    ctx.fillRect(itemX, swatchY, 18, 12);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(itemX, swatchY, 18, 12);

    // Swatch Label
    ctx.fillStyle = '#000000';
    ctx.font = '10.5px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.label, itemX + 24, swatchY + 6);
  });

  ctx.restore();

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

console.log('Generating Use Case Diagrams for KEEP UP 2026...');

// 1. Color Theme (matching the attached example image)
const colorBuffer = drawUseCaseDiagram(COLOR_THEME);
targetDirs.forEach(dir => {
  fs.writeFileSync(path.join(dir, 'KEEP_UP_Use_Case_Diagram.png'), colorBuffer);
});
console.log(`[Color Theme] Generated: KEEP_UP_Use_Case_Diagram.png (${colorBuffer.length} bytes)`);

// 2. Black & White Theme (matching thesis/academic monochrome requirements)
const bwBuffer = drawUseCaseDiagram(BW_THEME);
targetDirs.forEach(dir => {
  fs.writeFileSync(path.join(dir, 'KEEP_UP_Use_Case_Diagram_BW.png'), bwBuffer);
});
console.log(`[B&W Theme] Generated: KEEP_UP_Use_Case_Diagram_BW.png (${bwBuffer.length} bytes)`);

console.log('All Use Case Diagrams generated successfully!');
