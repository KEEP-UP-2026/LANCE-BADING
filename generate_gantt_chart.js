const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

// Output directories
const flowchartsDir = path.join(__dirname, 'flowcharts');
const publicDir = path.join(__dirname, 'src', 'views', 'public', 'flowcharts');
[flowchartsDir, publicDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Color and B&W Palettes
const COLOR_THEME = {
  headerBg: '#4f85be',
  headerTitle: '#FFFFFF',
  bodyBg: '#005492',
  boxHeaderBg: '#053456',
  boxHeaderText: '#FFFFFF',
  taskText: '#FFFFFF',
  trackBg: '#024270',
  pillBg: '#008399',
  pillBorder: '#008399',
  finalMilestoneBg: '#0097ad',
  border: '#003a66'
};

const BW_THEME = {
  headerBg: '#FFFFFF',
  headerTitle: '#000000',
  bodyBg: '#FFFFFF',
  boxHeaderBg: '#000000',
  boxHeaderText: '#FFFFFF',
  taskText: '#000000',
  trackBg: '#f1f5f9',
  pillBg: '#1e293b',
  pillBorder: '#0f172a',
  finalMilestoneBg: '#000000',
  border: '#000000'
};

// 11 Exact Tasks and their precise timeline spans (based on 1024x768 base)
const baseTasks = [
  { name: 'Chapter 1', pLeft: 303, pRight: 445 },
  { name: 'Chapter 2', pLeft: 390, pRight: 455 },
  { name: 'Chapter 3', pLeft: 393, pRight: 560 },
  { name: 'Develop 50% of the system', pLeft: 397, pRight: 633 },
  { name: 'Colloquium', pLeft: 601, pRight: 666 },
  { name: 'Developed 100% of the system', pLeft: 601, pRight: 771 },
  { name: 'Testing and Evalaution', pLeft: 773, pRight: 877 },
  { name: 'Chapter 4', pLeft: 667, pRight: 877 },
  { name: 'Chapter 5', pLeft: 878, pRight: 961 },
  { name: 'Appendecis', pLeft: 878, pRight: 961 },
  { name: 'Final Defense', pLeft: 963, pRight: 993, isCircle: true }
];

const months = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];

// Helper: Rounded Rectangle
function drawRoundedRect(ctx, x, y, w, h, r, fill, stroke, strokeColor, strokeWidth = 1.5) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
  ctx.restore();
}

function generateGanttChart(themeKey, scale = 2) {
  const isBW = themeKey === 'bw';
  const theme = isBW ? BW_THEME : COLOR_THEME;

  const baseW = 1024;
  const baseH = 768;
  const W = baseW * scale;
  const H = baseH * scale;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  // 1. Top Header Banner
  const headerH = 125;
  ctx.fillStyle = theme.headerBg;
  ctx.fillRect(0, 0, baseW, headerH);

  if (isBW) {
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, baseW, headerH);
  }

  // Header Title
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 38px "Times New Roman", Georgia, serif';
  ctx.fillStyle = theme.headerTitle;
  ctx.letterSpacing = '2px';
  ctx.fillText('TALA GANTCHART', baseW / 2, headerH / 2);
  ctx.restore();

  // 2. Main Body Background
  ctx.fillStyle = theme.bodyBg;
  ctx.fillRect(0, headerH, baseW, baseH - headerH);

  if (isBW) {
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, headerH, baseW, baseH - headerH);
  }

  // 3. Table Header Row (y: 175 to 214)
  const headerY = 175;
  const headerBoxH = 39;

  // Task List Header Box (x: 30 to 254)
  const taskBoxX = 30;
  const taskBoxW = 224;
  ctx.fillStyle = theme.boxHeaderBg;
  ctx.fillRect(taskBoxX, headerY, taskBoxW, headerBoxH);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 15.5px "Times New Roman", Georgia, serif';
  ctx.fillStyle = theme.boxHeaderText;
  ctx.fillText('Task List', taskBoxX + taskBoxW / 2, headerY + headerBoxH / 2);
  ctx.restore();

  // Month Header Box (x: 272 to 993)
  const monthBoxX = 272;
  const monthBoxW = 722;
  ctx.fillStyle = theme.boxHeaderBg;
  ctx.fillRect(monthBoxX, headerY, monthBoxW, headerBoxH);

  const colW = monthBoxW / 7; // ~103.14px
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 16px "Times New Roman", Georgia, serif';
  ctx.fillStyle = theme.boxHeaderText;
  months.forEach((m, idx) => {
    const colCenterX = monthBoxX + idx * colW + colW / 2;
    ctx.fillText(m, colCenterX, headerY + headerBoxH / 2);
  });
  ctx.restore();

  // 4. 11 Task Rows
  const rowBaseY = [
    234, 272, 310, 348, 386, 424, 462, 500, 538, 576, 614
  ];
  const rowH = 29;

  baseTasks.forEach((task, idx) => {
    const yTop = rowBaseY[idx];
    const yCenter = yTop + rowH / 2;

    // A. Task Label (Left Column)
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 14.5px "Times New Roman", Georgia, serif';
    ctx.fillStyle = theme.taskText;
    ctx.fillText(task.name, taskBoxX + 6, yCenter);
    ctx.restore();

    // B. Timeline Track (Right Column)
    ctx.fillStyle = theme.trackBg;
    ctx.fillRect(monthBoxX, yTop, monthBoxW, rowH);

    if (isBW) {
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1;
      ctx.strokeRect(monthBoxX, yTop, monthBoxW, rowH);
    }

    // C. Pill Bar
    const pillH = 25;
    const pillY = yTop + (rowH - pillH) / 2;
    const pW = task.pRight - task.pLeft;

    if (task.isCircle) {
      // Final Defense Milestone Circle / Capsule
      const radius = pillH / 2;
      const cX = task.pLeft + pW / 2;
      const cY = pillY + radius;
      ctx.beginPath();
      ctx.arc(cX, cY, radius, 0, 2 * Math.PI);
      ctx.fillStyle = theme.finalMilestoneBg;
      ctx.fill();
      if (isBW) {
        ctx.strokeStyle = theme.pillBorder;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    } else {
      // Standard Capsule Pill Bar
      drawRoundedRect(
        ctx,
        task.pLeft,
        pillY,
        pW,
        pillH,
        pillH / 2,
        theme.pillBg,
        isBW,
        theme.pillBorder,
        1.5
      );
    }
  });

  return canvas.toBuffer('image/png');
}

// Generate Both Themes (in Ultra-HD 2048 x 1536)
console.log('Generating TALA Gantt Chart (Color)...');
const ganttColor = generateGanttChart('color', 2);
fs.writeFileSync(path.join(flowchartsDir, 'TALA_Gantt_Chart.png'), ganttColor);
fs.writeFileSync(path.join(publicDir, 'TALA_Gantt_Chart.png'), ganttColor);

console.log('Generating TALA Gantt Chart (B&W)...');
const ganttBW = generateGanttChart('bw', 2);
fs.writeFileSync(path.join(flowchartsDir, 'TALA_Gantt_Chart_BW.png'), ganttBW);
fs.writeFileSync(path.join(publicDir, 'TALA_Gantt_Chart_BW.png'), ganttBW);

console.log('Gantt charts generated successfully!');
