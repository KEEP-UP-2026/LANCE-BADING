const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

// Data for each user role in KEEP-UP 2026
const roleFlowcharts = [
  {
    id: 'rhu_administrator',
    title: 'RHU ADMINISTRATOR',
    baseFilename: 'RHU_ADMINISTRATOR_Flowchart',
    col1: [
      'Log in to system\nadministrator portal',
      'View system overview\nand storage metrics',
      'Access user\nmanagement portal',
      'Create and register\nnew staff accounts',
      'Update user roles\nand account statuses'
    ],
    col2: [
      'Access system-wide\naudit trail logs',
      'Filter audit events by\nuser, action, and date',
      'Review security logs\nand data access trails',
      'Monitor database integrity\nand sync status',
      'Execute verified system\ndata backups'
    ]
  },
  {
    id: 'records_staff',
    title: 'RECORDS STAFF',
    baseFilename: 'RECORDS_STAFF_Flowchart',
    col1: [
      'Log in to records\nmanagement portal',
      'View patient records\ndashboard',
      'Search master\npatient directory',
      'Register new patient\ndemographic profile',
      'Resolve duplicate alerts\nand merge records'
    ],
    col2: [
      'Upload physical health\ndocuments (PDF, JPG)',
      'Execute automated OCR\ntext extraction',
      'Verify and adjust\nrecord classification',
      'Inspect digitized patient\nrecords and history',
      'Archive or unarchive\ninactive patient files'
    ]
  },
  {
    id: 'healthcare_personnel',
    title: 'HEALTHCARE PERSONNEL',
    baseFilename: 'HEALTHCARE_PERSONNEL_Flowchart',
    col1: [
      'Log in to healthcare\npersonnel portal',
      'Access clinical\npatient directory',
      'Search patient by\nname or patient ID',
      'Open comprehensive\npatient health profile',
      'Review demographic and\nemergency contact info'
    ],
    col2: [
      'Browse categorized\nclinical health records',
      'Inspect consultation\nand diagnostic files',
      'Review OCR-extracted\nmedical clinical text',
      'Examine immunization\nand maternal history',
      'Verify patient treatment\nand health summary'
    ]
  },
  {
    id: 'administrative_staff',
    title: 'ADMINISTRATIVE STAFF',
    baseFilename: 'ADMINISTRATIVE_STAFF_Flowchart',
    col1: [
      'Log in to administrative\nstaff portal',
      'Access administrative\nreports dashboard',
      'Filter patient records\nby date and category',
      'Select statistical\nreporting parameters',
      'Generate patient census\nand demographic summary'
    ],
    col2: [
      'Review record type\ndistribution analytics',
      'Analyze monthly\nhealthcare indicators',
      'Generate compliance\nand utilization summaries',
      'Export comprehensive\nreports to PDF format',
      'Export structured\nreporting datasets to CSV'
    ]
  }
];

/**
 * Draws a flowchart
 * @param {Object} config - role configuration
 * @param {string} mode - 'page' (full-page frame like Image 1) or 'fitted' (balanced margins like Image 4)
 */
function drawFlowchart(config, mode = 'page') {
  const W = 920;
  const H = mode === 'page' ? 1160 : 790;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background - Pure White
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // Outer Border Rectangle
  const marginX = 35;
  const marginY = 35;
  const borderW = W - 2 * marginX;
  const borderH = H - 2 * marginY;

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2.2;
  ctx.strokeRect(marginX, marginY, borderW, borderH);

  // Title at Top Center
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 24px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const titleY = marginY + 45;
  ctx.fillText(config.title, W / 2, titleY);

  // Layout Metrics
  const boxW = 250;
  const boxH = 54;
  const ovalW = 155;
  const ovalH = 46;
  const vGap = 24; // gap between sequential boxes
  const arrowHeadLen = 8.5;

  const col1CenterX = marginX + borderW * 0.28; // ~273px
  const col2CenterX = marginX + borderW * 0.72; // ~647px
  const midX = (col1CenterX + col2CenterX) / 2; // ~460px

  const startOvalCY = titleY + 58;

  // Function to draw arrow head
  function drawArrowHead(toX, toY, dir = 'down') {
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    if (dir === 'down') {
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - 5, toY - arrowHeadLen);
      ctx.lineTo(toX + 5, toY - arrowHeadLen);
    }
    ctx.closePath();
    ctx.fill();
  }

  // Function to draw vertical line with downward arrow
  function drawVerticalArrow(fromX, fromY, toX, toY) {
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    drawArrowHead(toX, toY, 'down');
  }

  // Function to draw an Oval (Start/End)
  function drawOval(cx, cy, w, h, text) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, 2 * Math.PI);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.9;
    ctx.stroke();

    ctx.fillStyle = '#000000';
    ctx.font = 'bold 16px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy);
    ctx.restore();
  }

  // Function to draw a Process Box
  function drawBox(cx, cy, w, h, text) {
    ctx.save();
    const left = cx - w / 2;
    const top = cy - h / 2;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(left, top, w, h);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.8;
    ctx.strokeRect(left, top, w, h);

    // Multi-line text centered
    ctx.fillStyle = '#000000';
    ctx.font = '13.5px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const lines = text.split('\n');
    const lineHeight = 17;
    const totalTextH = (lines.length - 1) * lineHeight;
    const startTextY = cy - totalTextH / 2;

    lines.forEach((line, idx) => {
      ctx.fillText(line, cx, startTextY + idx * lineHeight);
    });

    ctx.restore();
  }

  // 1. Draw Start Oval
  drawOval(col1CenterX, startOvalCY, ovalW, ovalH, 'Start');

  // Compute Box Y coordinates (5 boxes in each column)
  const col1BoxYList = [];
  const col1StartY = startOvalCY + ovalH / 2 + vGap;

  for (let i = 0; i < config.col1.length; i++) {
    const boxCY = col1StartY + boxH / 2 + i * (boxH + vGap);
    col1BoxYList.push(boxCY);
  }

  // Arrow from Start Oval to Box 1
  drawVerticalArrow(col1CenterX, startOvalCY + ovalH / 2, col1CenterX, col1BoxYList[0] - boxH / 2);

  // Draw Column 1 Boxes and vertical arrows
  for (let i = 0; i < config.col1.length; i++) {
    drawBox(col1CenterX, col1BoxYList[i], boxW, boxH, config.col1[i]);
    if (i < config.col1.length - 1) {
      drawVerticalArrow(
        col1CenterX,
        col1BoxYList[i] + boxH / 2,
        col1CenterX,
        col1BoxYList[i + 1] - boxH / 2
      );
    }
  }

  // Box Y coordinates for Column 2 (aligned exactly with Column 1)
  const col2BoxYList = [...col1BoxYList];

  // Draw Column 2 Boxes and vertical arrows
  for (let i = 0; i < config.col2.length; i++) {
    drawBox(col2CenterX, col2BoxYList[i], boxW, boxH, config.col2[i]);
    if (i < config.col2.length - 1) {
      drawVerticalArrow(
        col2CenterX,
        col2BoxYList[i] + boxH / 2,
        col2CenterX,
        col2BoxYList[i + 1] - boxH / 2
      );
    }
  }

  // 2. Draw Serpentine Arrow: from bottom of Column 1 Box 5 to top of Column 2 Box 1
  const lastBoxCol1Bottom = col1BoxYList[config.col1.length - 1] + boxH / 2;
  const firstBoxCol2Top = col2BoxYList[0] - boxH / 2;
  const loopBottomY = lastBoxCol1Bottom + vGap * 0.85;
  const loopTopY = firstBoxCol2Top - vGap * 0.85;

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(col1CenterX, lastBoxCol1Bottom);
  ctx.lineTo(col1CenterX, loopBottomY);
  ctx.lineTo(midX, loopBottomY);
  ctx.lineTo(midX, loopTopY);
  ctx.lineTo(col2CenterX, loopTopY);
  ctx.lineTo(col2CenterX, firstBoxCol2Top);
  ctx.stroke();
  drawArrowHead(col2CenterX, firstBoxCol2Top, 'down');

  // 3. Draw End Oval below Column 2 Box 5
  const lastBoxCol2Bottom = col2BoxYList[config.col2.length - 1] + boxH / 2;
  const endOvalCY = lastBoxCol2Bottom + vGap + ovalH / 2;

  drawVerticalArrow(col2CenterX, lastBoxCol2Bottom, col2CenterX, endOvalCY - ovalH / 2);
  drawOval(col2CenterX, endOvalCY, ovalW, ovalH, 'End');

  return canvas.toBuffer('image/png');
}

// Generate files in both root 'flowcharts/' and 'src/views/public/flowcharts/'
const targetDirs = [
  path.join(__dirname, 'flowcharts'),
  path.join(__dirname, 'src/views/public/flowcharts')
];

targetDirs.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

console.log('Generating KEEP UP 2026 Flowcharts in Black & White...');

roleFlowcharts.forEach((fc) => {
  // 1. Page Format (matches exact frame proportion of Image 1, 2, 3)
  const pageBuffer = drawFlowchart(fc, 'page');
  targetDirs.forEach((dir) => {
    fs.writeFileSync(path.join(dir, `${fc.baseFilename}.png`), pageBuffer);
  });
  console.log(`[Page Frame] Generated: ${fc.baseFilename}.png (${pageBuffer.length} bytes)`);

  // 2. Fitted Format (matches balanced margin thesis figure of Image 4)
  const fittedBuffer = drawFlowchart(fc, 'fitted');
  targetDirs.forEach((dir) => {
    fs.writeFileSync(path.join(dir, `${fc.baseFilename}_Fitted.png`), fittedBuffer);
  });
  console.log(`[Fitted Frame] Generated: ${fc.baseFilename}_Fitted.png (${fittedBuffer.length} bytes)`);
});

console.log('All Flowchart PNGs successfully generated!');
