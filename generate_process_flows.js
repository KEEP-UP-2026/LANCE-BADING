const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

// Color Palette matching the user's reference images
const COLOR_THEME = {
  bg: '#FFFFFF',
  border: '#000000',
  title: '#000000',
  text: '#000000',
  arrow: '#000000',
  startEndFill: '#52a5da',
  startEndText: '#000000',
  boxFill: '#d8ebf9',
  boxText: '#000000',
  diamondFill: '#0196ba',
  diamondText: '#000000',
  connectorFill: '#113f5c',
  connectorText: '#FFFFFF',
  branchText: '#000000'
};

const BW_THEME = {
  bg: '#FFFFFF',
  border: '#000000',
  title: '#000000',
  text: '#000000',
  arrow: '#000000',
  startEndFill: '#FFFFFF',
  startEndText: '#000000',
  boxFill: '#FFFFFF',
  boxText: '#000000',
  diamondFill: '#FFFFFF',
  diamondText: '#000000',
  connectorFill: '#FFFFFF',
  connectorText: '#000000',
  branchText: '#000000'
};

// Data definition for all 4 roles based on the exact pages provided by the user
const processFlows = [
  {
    id: 'records_staff',
    title: 'RECORDS STAFF',
    baseFilename: 'RECORDS_STAFF_Process_Flow',
    columns: [
      {
        top: { type: 'start', text: 'Start' },
        items: [
          { type: 'box', text: 'Login to System' },
          { type: 'box', text: 'Records Dashboard' },
          { type: 'box', text: 'Patient Directory' },
          {
            type: 'diamond',
            text: 'New Patient?',
            yesText: 'Yes',
            noText: 'No: Search',
            loopTargetIndex: 2 // loops back to Patient Directory
          }
        ],
        bottom: { type: 'connector', text: 'A' }
      },
      {
        top: { type: 'connector', text: 'A' },
        items: [
          { type: 'box', text: 'Input Demographics' },
          { type: 'box', text: 'Duplicate Warnings' },
          {
            type: 'diamond',
            text: 'Duplicate Found?',
            yesText: 'No',
            noText: 'Yes: Merge',
            loopTargetIndex: 1 // loops back to Duplicate Warnings
          },
          { type: 'box', text: 'Generate PAT ID' },
          { type: 'box', text: 'Open Patient Profile' }
        ],
        bottom: { type: 'connector', text: 'B' }
      },
      {
        top: { type: 'connector', text: 'B' },
        items: [
          { type: 'box', text: 'Select Document Binder\n(ITR/Consult/Vax/Maternal)' },
          { type: 'box', text: 'Upload Health Document\n(PDF / Image)' },
          { type: 'box', text: 'Automated OCR Engine' },
          {
            type: 'diamond',
            text: 'Classification OK?',
            yesText: 'Yes',
            noText: 'No: Adjust',
            loopTargetIndex: 0 // loops back to Select Document Binder
          },
          { type: 'box', text: 'Save to Health Binder' }
        ],
        bottom: { type: 'connector', text: 'C' }
      },
      {
        top: { type: 'connector', text: 'C' },
        items: [
          { type: 'box', text: 'Unified Search Tool' },
          { type: 'box', text: 'Query Patient or OCR' },
          { type: 'box', text: 'Inspect Record History' },
          {
            type: 'diamond',
            text: 'Archive Record?',
            yesText: 'Yes',
            noText: 'No: Keep Active',
            loopTargetIndex: 2 // loops back to Inspect Record History
          },
          { type: 'box', text: 'Archives Directory' }
        ],
        bottom: { type: 'connector', text: 'D' }
      },
      {
        top: { type: 'connector', text: 'D' },
        items: [
          { type: 'box', text: 'Verify Preserved Data' },
          { type: 'box', text: 'Print / Export Sheet' },
          { type: 'box', text: 'Session Audit Logged' },
          { type: 'box', text: 'Sign Out' }
        ],
        bottom: { type: 'end', text: 'End' }
      }
    ]
  },
  {
    id: 'administrative_staff',
    title: 'ADMINISTRATIVE STAFF',
    baseFilename: 'ADMINISTRATIVE_STAFF_Process_Flow',
    columns: [
      {
        top: { type: 'start', text: 'Start' },
        items: [
          { type: 'box', text: 'Login to System' },
          { type: 'box', text: 'Dashboard Overview' },
          { type: 'box', text: 'Patient Directory' },
          {
            type: 'diamond',
            text: 'Filter Records?',
            yesText: 'Yes',
            noText: 'No: View All',
            loopTargetIndex: 1 // loops back to Dashboard Overview
          }
        ],
        bottom: { type: 'connector', text: 'A' }
      },
      {
        top: { type: 'connector', text: 'A' },
        items: [
          { type: 'box', text: 'Access Document Binders' },
          { type: 'box', text: 'Review ITR & Consultations' },
          { type: 'box', text: 'Review Vax, MedCert, Maternal' },
          {
            type: 'diamond',
            text: 'Discrepancy?',
            yesText: 'No',
            noText: 'Yes: Flag',
            loopTargetIndex: 0 // loops back to Access Document Binders
          },
          { type: 'box', text: 'Check Duplicate Warnings' }
        ],
        bottom: { type: 'connector', text: 'B' }
      },
      {
        top: { type: 'connector', text: 'B' },
        items: [
          { type: 'box', text: 'Unified Search Portal' },
          { type: 'box', text: 'Query by Date & Type' },
          { type: 'box', text: 'Archives Directory' },
          {
            type: 'diamond',
            text: 'Restore Needed?',
            yesText: 'Yes',
            noText: 'No: Retain',
            loopTargetIndex: 2 // loops back to Archives Directory
          },
          { type: 'box', text: 'Monitor Retention Policy' }
        ],
        bottom: { type: 'connector', text: 'C' }
      },
      {
        top: { type: 'connector', text: 'C' },
        items: [
          { type: 'box', text: 'Analytics & Reports' },
          { type: 'box', text: 'Set Reporting Filters' },
          { type: 'box', text: 'Generate Patient Census' },
          {
            type: 'diamond',
            text: 'Export Report?',
            yesText: 'Yes: PDF/CSV',
            noText: 'No: Preview',
            loopTargetIndex: 1 // loops back to Set Reporting Filters
          },
          { type: 'box', text: 'Compile RHU Health Stats' }
        ],
        bottom: { type: 'connector', text: 'D' }
      },
      {
        top: { type: 'connector', text: 'D' },
        items: [
          { type: 'box', text: 'Review Statistical Charts' },
          { type: 'box', text: 'Submit Health Summary' },
          { type: 'box', text: 'Session Audit Logged' },
          { type: 'box', text: 'Sign Out' }
        ],
        bottom: { type: 'end', text: 'End' }
      }
    ]
  },
  {
    id: 'healthcare_personnel',
    title: 'HEALTHCARE PERSONNEL',
    baseFilename: 'HEALTHCARE_PERSONNEL_Process_Flow',
    columns: [
      {
        top: { type: 'start', text: 'Start' },
        items: [
          { type: 'box', text: 'Login to System' },
          { type: 'box', text: 'Clinical Portal' },
          { type: 'box', text: 'Search & Retrieve Records' },
          {
            type: 'diamond',
            text: 'Record Found?',
            yesText: 'Yes',
            noText: 'No: Retry',
            loopTargetIndex: 2 // loops back to Search & Retrieve
          }
        ],
        bottom: { type: 'connector', text: 'A' }
      },
      {
        top: { type: 'connector', text: 'A' },
        items: [
          { type: 'box', text: 'Permitted Patient Info' },
          { type: 'box', text: 'Open Patient Directory' },
          { type: 'box', text: 'Review Demographics' },
          {
            type: 'diamond',
            text: 'Has Past Visits?',
            yesText: 'Yes',
            noText: 'No: Initial',
            loopTargetIndex: 1 // loops back to Patient Directory
          },
          { type: 'box', text: 'Access Clinical Profile' }
        ],
        bottom: { type: 'connector', text: 'B' }
      },
      {
        top: { type: 'connector', text: 'B' },
        items: [
          { type: 'box', text: 'Permitted Clinical Binders' },
          { type: 'box', text: 'Inspect Treatment Record (ITR)' },
          { type: 'box', text: 'Consultation Records' },
          {
            type: 'diamond',
            text: 'Specialized Care?',
            yesText: 'Yes: Review',
            noText: 'No: Routine',
            loopTargetIndex: 2 // loops back to Consultation Records
          },
          { type: 'box', text: 'Immunizations & Maternal' }
        ],
        bottom: { type: 'connector', text: 'C' }
      },
      {
        top: { type: 'connector', text: 'C' },
        items: [
          { type: 'box', text: 'Medical Certificates' },
          { type: 'box', text: 'Inspect Scanned Files' },
          { type: 'box', text: 'Review OCR Clinical Text' },
          {
            type: 'diamond',
            text: 'Referral Needed?',
            yesText: 'Yes',
            noText: 'No: Complete',
            loopTargetIndex: 2 // loops back to OCR Clinical Text
          },
          { type: 'box', text: 'Log Clinical Notes' }
        ],
        bottom: { type: 'connector', text: 'D' }
      },
      {
        top: { type: 'connector', text: 'D' },
        items: [
          { type: 'box', text: 'Read-Only Assessment' },
          { type: 'box', text: 'Verify Patient Summary' },
          { type: 'box', text: 'Clinical Access Logged' },
          { type: 'box', text: 'Sign Out' }
        ],
        bottom: { type: 'end', text: 'End' }
      }
    ]
  },
  {
    id: 'admin',
    title: 'ADMINISTRATOR',
    baseFilename: 'ADMINISTRATOR_Process_Flow',
    columns: [
      {
        top: { type: 'start', text: 'Start' },
        items: [
          { type: 'box', text: 'Login to System' },
          { type: 'box', text: 'Admin Portal' },
          { type: 'box', text: 'System Monitoring' },
          {
            type: 'diamond',
            text: 'System Healthy?',
            yesText: 'Yes',
            noText: 'No: Check',
            loopTargetIndex: 2 // loops back to System Monitoring
          }
        ],
        bottom: { type: 'connector', text: 'A' }
      },
      {
        top: { type: 'connector', text: 'A' },
        items: [
          { type: 'box', text: 'Storage & Health Metrics' },
          { type: 'box', text: 'Check Upload Volumes' },
          {
            type: 'diamond',
            text: 'Storage Critical?',
            yesText: 'No',
            noText: 'Yes: Clean',
            loopTargetIndex: 1 // loops back to Check Upload Volumes
          },
          { type: 'box', text: 'Database Sync Status' },
          { type: 'box', text: 'System Integrity Check' }
        ],
        bottom: { type: 'connector', text: 'B' }
      },
      {
        top: { type: 'connector', text: 'B' },
        items: [
          { type: 'box', text: 'User Accounts Portal' },
          { type: 'box', text: 'Review Staff Directory' },
          { type: 'box', text: 'Create / Edit Account' },
          {
            type: 'diamond',
            text: 'Account Approved?',
            yesText: 'Yes: Active',
            noText: 'No: Revoke',
            loopTargetIndex: 1 // loops back to Staff Directory
          },
          { type: 'box', text: 'Assign RBAC Privileges' }
        ],
        bottom: { type: 'connector', text: 'C' }
      },
      {
        top: { type: 'connector', text: 'C' },
        items: [
          { type: 'box', text: 'Audit Log Review' },
          { type: 'box', text: 'Filter by User & Date' },
          { type: 'box', text: 'Inspect Security Trails' },
          {
            type: 'diamond',
            text: 'Security Alert?',
            yesText: 'No: Clear',
            noText: 'Yes: Audit',
            loopTargetIndex: 2 // loops back to Inspect Security Trails
          },
          { type: 'box', text: 'Export Audit Log Report' }
        ],
        bottom: { type: 'connector', text: 'D' }
      },
      {
        top: { type: 'connector', text: 'D' },
        items: [
          { type: 'box', text: 'Execute Database Backup' },
          { type: 'box', text: 'Verify Backup Integrity' },
          { type: 'box', text: 'Admin Session Logged' },
          { type: 'box', text: 'Sign Out' }
        ],
        bottom: { type: 'end', text: 'End' }
      }
    ]
  }
];

/**
 * Draws a 5-column landscape Process Flow diagram
 */
function drawProcessFlow(config, theme = COLOR_THEME) {
  const W = 1560;
  const H = 940;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  // Outer Border Box
  const marginX = 35;
  const marginY = 35;
  const borderW = W - 2 * marginX;
  const borderH = H - 2 * marginY;

  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 2.4;
  ctx.strokeRect(marginX, marginY, borderW, borderH);

  // Title at Top Center
  ctx.fillStyle = theme.title;
  ctx.font = 'bold 24px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(config.title, W / 2, marginY + 45);

  // 5 Columns Metrics
  const numCols = 5;
  const colCenters = [];
  const colStep = borderW / numCols;
  for (let i = 0; i < numCols; i++) {
    colCenters.push(marginX + colStep * (i + 0.5));
  }

  const boxW = 186;
  const boxH = 46;
  const diamondW = 154;
  const diamondH = 50;
  const ovalW = 126;
  const ovalH = 42;
  const circleR = 19;
  const arrowHeadLen = 7.5;

  const topCY = marginY + 115;
  const bottomCY = marginY + borderH - 75;

  // Helpers
  function drawArrowHead(toX, toY, dir = 'down') {
    ctx.fillStyle = theme.arrow;
    ctx.beginPath();
    if (dir === 'down') {
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - 4.5, toY - arrowHeadLen);
      ctx.lineTo(toX + 4.5, toY - arrowHeadLen);
    } else if (dir === 'left') {
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX + arrowHeadLen, toY - 4.5);
      ctx.lineTo(toX + arrowHeadLen, toY + 4.5);
    } else if (dir === 'right') {
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - arrowHeadLen, toY - 4.5);
      ctx.lineTo(toX - arrowHeadLen, toY + 4.5);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawVerticalArrow(fromX, fromY, toX, toY) {
    ctx.strokeStyle = theme.arrow;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    drawArrowHead(toX, toY, 'down');
  }

  function drawStartEndOval(cx, cy, text) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, ovalW / 2, ovalH / 2, 0, 0, 2 * Math.PI);
    ctx.fillStyle = theme.startEndFill;
    ctx.fill();
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = theme.startEndText;
    ctx.font = 'bold 15px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy);
    ctx.restore();
  }

  function drawConnectorCircle(cx, cy, text) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, circleR, 0, 2 * Math.PI);
    ctx.fillStyle = theme.connectorFill;
    ctx.fill();
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = theme.connectorText;
    ctx.font = 'bold 14px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy);
    ctx.restore();
  }

  function drawProcessBox(cx, cy, text) {
    ctx.save();
    const left = cx - boxW / 2;
    const top = cy - boxH / 2;

    ctx.fillStyle = theme.boxFill;
    ctx.fillRect(left, top, boxW, boxH);
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(left, top, boxW, boxH);

    ctx.fillStyle = theme.boxText;
    ctx.font = '12px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const lines = text.split('\n');
    const lineHeight = 15;
    const totalTextH = (lines.length - 1) * lineHeight;
    const startTextY = cy - totalTextH / 2;

    lines.forEach((line, idx) => {
      ctx.fillText(line, cx, startTextY + idx * lineHeight);
    });

    ctx.restore();
  }

  function drawDecisionDiamond(cx, cy, text) {
    ctx.save();
    const hw = diamondW / 2;
    const hh = diamondH / 2;

    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();

    ctx.fillStyle = theme.diamondFill;
    ctx.fill();
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Text inside diamond
    ctx.fillStyle = theme.diamondText;
    ctx.font = 'bold 11.5px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy);

    ctx.restore();
  }

  // Draw each of the 5 columns
  for (let c = 0; c < config.columns.length; c++) {
    const col = config.columns[c];
    const cx = colCenters[c];

    // 1. Draw Top Element
    if (col.top.type === 'start') {
      drawStartEndOval(cx, topCY, col.top.text);
    } else if (col.top.type === 'connector') {
      drawConnectorCircle(cx, topCY, col.top.text);
    }

    // 2. Compute Vertical Positions of Intermediate Items
    const itemCount = col.items.length;
    const usableHeight = bottomCY - topCY - 60;
    const spacing = usableHeight / (itemCount + 1);

    const itemPositions = [];
    for (let i = 0; i < itemCount; i++) {
      const cy = topCY + 30 + (i + 1) * spacing;
      itemPositions.push({ cy, item: col.items[i] });
    }

    // Connect Top Element to Item 0
    const topBottomY = col.top.type === 'start' ? topCY + ovalH / 2 : topCY + circleR;
    const firstItemTopY = itemPositions[0].item.type === 'diamond' ? itemPositions[0].cy - diamondH / 2 : itemPositions[0].cy - boxH / 2;
    drawVerticalArrow(cx, topBottomY, cx, firstItemTopY);

    // 3. Draw Items and Inter-Item Arrows
    for (let i = 0; i < itemCount; i++) {
      const pos = itemPositions[i];
      const it = pos.item;

      if (it.type === 'box') {
        drawProcessBox(cx, pos.cy, it.text);
      } else if (it.type === 'diamond') {
        drawDecisionDiamond(cx, pos.cy, it.text);

        // Branch Labels & Loop Arrow
        if (it.yesText) {
          ctx.fillStyle = theme.branchText;
          ctx.font = 'bold 10.5px Arial, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(it.yesText, cx + 8, pos.cy + diamondH / 2 + 13);
        }

        // No branch loop (right and up)
        if (it.noText && typeof it.loopTargetIndex === 'number') {
          const targetPos = itemPositions[it.loopTargetIndex];
          const diamondRightX = cx + diamondW / 2;
          const loopRightX = cx + boxW / 2 + 38;

          // Branch label nicely placed above the horizontal line
          ctx.fillStyle = theme.branchText;
          ctx.font = 'bold 9.5px Arial, sans-serif';
          ctx.textAlign = 'center';
          const labelMidX = (diamondRightX + loopRightX) / 2;
          ctx.fillText(it.noText, labelMidX, pos.cy - 6);

          // Path: from diamond right vertex -> right -> up -> left into target box
          ctx.strokeStyle = theme.arrow;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(diamondRightX, pos.cy);
          ctx.lineTo(loopRightX, pos.cy);
          ctx.lineTo(loopRightX, targetPos.cy);
          ctx.lineTo(cx + boxW / 2, targetPos.cy);
          ctx.stroke();

          // Arrowhead pointing left into target box
          drawArrowHead(cx + boxW / 2, targetPos.cy, 'left');
        }
      }

      // Connect to next item or bottom
      if (i < itemCount - 1) {
        const nextPos = itemPositions[i + 1];
        const curBottomY = it.type === 'diamond' ? pos.cy + diamondH / 2 : pos.cy + boxH / 2;
        const nextTopY = nextPos.item.type === 'diamond' ? nextPos.cy - diamondH / 2 : nextPos.cy - boxH / 2;
        drawVerticalArrow(cx, curBottomY, cx, nextTopY);
      } else {
        // Connect last item to bottom element
        const curBottomY = it.type === 'diamond' ? pos.cy + diamondH / 2 : pos.cy + boxH / 2;
        const bottomTopY = col.bottom.type === 'end' ? bottomCY - ovalH / 2 : bottomCY - circleR;
        drawVerticalArrow(cx, curBottomY, cx, bottomTopY);
      }
    }

    // 4. Draw Bottom Element
    if (col.bottom.type === 'end') {
      drawStartEndOval(cx, bottomCY, col.bottom.text);
    } else if (col.bottom.type === 'connector') {
      drawConnectorCircle(cx, bottomCY, col.bottom.text);
    }
  }

  return canvas.toBuffer('image/png');
}

// Generate files into target directories
const targetDirs = [
  path.join(__dirname, 'flowcharts'),
  path.join(__dirname, 'src/views/public/flowcharts'),
  'C:\\Users\\Alphi\\.gemini\\antigravity-ide\\brain\\7b985ef1-2fc0-44ea-8cdd-ae3ddd4fb770'
];

targetDirs.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

console.log('Generating Polished Process Flow Diagrams for KEEP UP 2026...');

processFlows.forEach((pf) => {
  // 1. Color Theme (matching the attached reference images)
  const colorBuffer = drawProcessFlow(pf, COLOR_THEME);
  targetDirs.forEach((dir) => {
    fs.writeFileSync(path.join(dir, `${pf.baseFilename}.png`), colorBuffer);
  });
  console.log(`[Color Theme] Generated: ${pf.baseFilename}.png (${colorBuffer.length} bytes)`);

  // 2. Black & White Theme (matching thesis/academic monochrome requirements)
  const bwBuffer = drawProcessFlow(pf, BW_THEME);
  targetDirs.forEach((dir) => {
    fs.writeFileSync(path.join(dir, `${pf.baseFilename}_BW.png`), bwBuffer);
  });
  console.log(`[B&W Theme] Generated: ${pf.baseFilename}_BW.png (${bwBuffer.length} bytes)`);
});

console.log('All Process Flow Diagrams generated and copied everywhere!');
