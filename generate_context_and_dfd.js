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
  bg: '#FFFFFF',
  frameBorder: '#000000',
  centerCircleFill: '#1a4d74',
  centerCircleBorder: '#0f2f4a',
  centerCircleText: '#FFFFFF',
  centerCircleSub: '#93c5fd',
  boxFill: '#3890cc',
  boxBorder: '#1a4d74',
  boxText: '#FFFFFF',
  boxSub: '#f0f9ff',
  lineColor: '#1e293b',
  labelText: '#334155',
  // DFD Backend specifics
  backendHeaderFill: '#1a4d74',
  backendHeaderText: '#FFFFFF',
  backendBodyBg: '#FFFFFF',
  backendBorder: '#1a4d74',
  subBoxBg: '#f8fafc',
  subBoxBorder: '#1a4d74',
  subBoxTitle: '#1a4d74',
  subBoxText: '#334155',
  dbFill: '#3890cc',
  dbTopFill: '#4aa2de',
  dbBorder: '#1a4d74'
};

const BW_THEME = {
  bg: '#FFFFFF',
  frameBorder: '#000000',
  centerCircleFill: '#FFFFFF',
  centerCircleBorder: '#000000',
  centerCircleText: '#000000',
  centerCircleSub: '#333333',
  boxFill: '#FFFFFF',
  boxBorder: '#000000',
  boxText: '#000000',
  boxSub: '#333333',
  lineColor: '#000000',
  labelText: '#000000',
  // DFD Backend specifics
  backendHeaderFill: '#000000',
  backendHeaderText: '#FFFFFF',
  backendBodyBg: '#FFFFFF',
  backendBorder: '#000000',
  subBoxBg: '#FFFFFF',
  subBoxBorder: '#000000',
  subBoxTitle: '#000000',
  subBoxText: '#000000',
  dbFill: '#FFFFFF',
  dbTopFill: '#FFFFFF',
  dbBorder: '#000000'
};

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

// Helper: Draw Arrowhead
function drawArrowhead(ctx, fromX, fromY, toX, toY, color, size = 9) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - size * Math.cos(angle - Math.PI / 7), toY - size * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(toX - size * Math.cos(angle + Math.PI / 7), toY - size * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Helper: Database Cylinder
function drawCylinder(ctx, x, y, w, h, fill, topFill, border, isBW) {
  const ry = 20;
  const rx = w / 2;
  const cx = x + rx;
  const topY = y + ry;
  const botY = y + h - ry;

  ctx.save();
  // Bottom / Body
  ctx.beginPath();
  ctx.moveTo(x, topY);
  ctx.lineTo(x, botY);
  ctx.ellipse(cx, botY, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(x + w, topY);
  ctx.ellipse(cx, topY, rx, ry, 0, 0, Math.PI, false);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Top Ellipse
  ctx.beginPath();
  ctx.ellipse(cx, topY, rx, ry, 0, 0, 2 * Math.PI);
  ctx.fillStyle = topFill;
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Subtle interior arc for depth
  if (!isBW) {
    ctx.beginPath();
    ctx.ellipse(cx, botY, rx, ry, 0, 0, Math.PI, false);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();
}

// Helper: Draw Text with clean background badge to prevent line collision
function drawTextBadge(ctx, lines, x, y, align = 'center', color = '#334155', bg = '#FFFFFF') {
  ctx.save();
  ctx.font = 'italic 12px Inter, Arial, sans-serif';
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';

  const lineH = 17;
  const totalH = lines.length * lineH;
  let maxW = 0;
  lines.forEach(l => {
    const w = ctx.measureText(l).width;
    if (w > maxW) maxW = w;
  });

  const padX = 6;
  const padY = 4;
  let bgX = x - maxW / 2 - padX;
  if (align === 'left') bgX = x - padX;
  if (align === 'right') bgX = x - maxW - padX;

  const bgY = y - totalH / 2 - padY;
  const bgW = maxW + padX * 2;
  const bgH = totalH + padY * 2;

  ctx.fillStyle = bg;
  ctx.fillRect(bgX, bgY, bgW, bgH);

  ctx.fillStyle = color;
  lines.forEach((l, idx) => {
    const lineY = y - totalH / 2 + lineH * (idx + 0.5);
    ctx.fillText(l, x, lineY);
  });
  ctx.restore();
}

/* =========================================================================
   1. SYSTEM CONTEXT DIAGRAM GENERATOR
   ========================================================================= */
function generateSystemContextDiagram(themeKey) {
  const isBW = themeKey === 'bw';
  const theme = isBW ? BW_THEME : COLOR_THEME;

  const W = 1440;
  const H = 1000;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  // Outer Border Frame
  const margin = 40;
  ctx.strokeStyle = theme.frameBorder;
  ctx.lineWidth = 1.8;
  ctx.strokeRect(margin, margin, W - 2 * margin, H - 2 * margin);

  // Center Coordinates
  const cx = W / 2;
  const cy = H / 2;
  const centerRadius = 92;

  // Outer Boxes Definition
  const boxes = {
    top: {
      id: 'batch_ocr',
      title: 'BATCH MIGRATION & OCR',
      lines: ['Tesseract OCR & PDF Parser', 'Batch CSV • Legacy Scans Pipeline'],
      x: cx - 130, y: 110, w: 260, h: 90
    },
    topRight: {
      id: 'frontend',
      title: 'FRONTEND',
      lines: ['HTML5, CSS3 & Vanilla JS', 'Client Dashboards & Portals'],
      x: 1040, y: 230, w: 250, h: 90
    },
    bottomRight: {
      id: 'notifications',
      title: 'NOTIFICATIONS',
      lines: ['In-App Status Notifications', '(Hard-coded Internal Engine)'],
      x: 1040, y: 670, w: 250, h: 90
    },
    bottom: {
      id: 'users',
      title: 'USERS',
      lines: ['RHU Admin • Records Staff •', 'Healthcare Personnel • Admin Staff'],
      x: cx - 130, y: 790, w: 260, h: 90
    },
    bottomLeft: {
      id: 'accounts_db',
      title: 'ACCOUNTS DB',
      lines: ['PostgreSQL & Supabase DB', 'Users, Patients, Records, Logs'],
      x: 150, y: 670, w: 250, h: 90
    },
    topLeft: {
      id: 'auth',
      title: 'AUTH',
      lines: ['JWT Tokens, Bcrypt Hasher &', 'Role-Based Access (RBAC)'],
      x: 150, y: 230, w: 250, h: 90
    }
  };

  // Draw Connectors and Labels

  // 1. TOP: BATCH MIGRATION & OCR -> CENTER
  {
    const startX = cx;
    const startY = boxes.top.y + boxes.top.h;
    const endX = cx;
    const endY = cy - centerRadius - 4;

    ctx.save();
    ctx.strokeStyle = theme.lineColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    drawArrowhead(ctx, startX, startY, endX, endY, theme.lineColor);
    ctx.restore();

    drawTextBadge(ctx, ['batch ingestion /', 'extracted records'], cx + 14, 305, 'left', theme.labelText, theme.bg);
  }

  // 2. TOP-RIGHT: FRONTEND <-> CENTER (Bidirectional)
  {
    const startX = boxes.topRight.x;
    const startY = boxes.topRight.y + boxes.topRight.h * 0.6;
    const endX = cx + centerRadius * Math.cos(-Math.PI / 4) + 2;
    const endY = cy + centerRadius * Math.sin(-Math.PI / 4) - 2;
    const cpX = 890;
    const cpY = 320;

    ctx.save();
    ctx.strokeStyle = theme.lineColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(cpX, cpY, endX, endY);
    ctx.stroke();

    drawArrowhead(ctx, cpX, cpY, endX, endY, theme.lineColor);
    drawArrowhead(ctx, cpX, cpY, startX, startY, theme.lineColor);
    ctx.restore();

    drawTextBadge(ctx, ['API requests /', 'responses'], 935, 335, 'center', theme.labelText, theme.bg);
  }

  // 3. BOTTOM-RIGHT: CENTER -> NOTIFICATIONS
  {
    const startX = cx + centerRadius * Math.cos(Math.PI / 4) + 2;
    const startY = cy + centerRadius * Math.sin(Math.PI / 4) + 2;
    const endX = boxes.bottomRight.x;
    const endY = boxes.bottomRight.y + boxes.bottomRight.h * 0.4;
    const cpX = 890;
    const cpY = 675;

    ctx.save();
    ctx.strokeStyle = theme.lineColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(cpX, cpY, endX, endY);
    ctx.stroke();

    drawArrowhead(ctx, cpX, cpY, endX, endY, theme.lineColor);
    ctx.restore();

    drawTextBadge(ctx, ['in-app alerts /', 'status updates'], 935, 655, 'center', theme.labelText, theme.bg);
  }

  // 4. BOTTOM: USERS -> CENTER
  {
    const startX = cx;
    const startY = boxes.bottom.y;
    const endX = cx;
    const endY = cy + centerRadius + 4;

    ctx.save();
    ctx.strokeStyle = theme.lineColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    drawArrowhead(ctx, startX, startY, endX, endY, theme.lineColor);
    ctx.restore();

    drawTextBadge(ctx, ['user actions /', 'submissions'], cx - 14, 705, 'right', theme.labelText, theme.bg);
  }

  // 5. BOTTOM-LEFT: ACCOUNTS DB <-> CENTER (Bidirectional)
  {
    const startX = boxes.bottomLeft.x + boxes.bottomLeft.w;
    const startY = boxes.bottomLeft.y + boxes.bottomLeft.h * 0.4;
    const endX = cx + centerRadius * Math.cos(3 * Math.PI / 4) - 2;
    const endY = cy + centerRadius * Math.sin(3 * Math.PI / 4) + 2;
    const cpX = 545;
    const cpY = 675;

    ctx.save();
    ctx.strokeStyle = theme.lineColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(cpX, cpY, endX, endY);
    ctx.stroke();

    drawArrowhead(ctx, cpX, cpY, endX, endY, theme.lineColor);
    drawArrowhead(ctx, cpX, cpY, startX, startY, theme.lineColor);
    ctx.restore();

    drawTextBadge(ctx, ['account read/write &', 'data persistence'], 505, 655, 'center', theme.labelText, theme.bg);
  }

  // 6. TOP-LEFT: AUTH <-> CENTER (Bidirectional)
  {
    const startX = boxes.topLeft.x + boxes.topLeft.w;
    const startY = boxes.topLeft.y + boxes.topLeft.h * 0.6;
    const endX = cx + centerRadius * Math.cos(-3 * Math.PI / 4) - 2;
    const endY = cy + centerRadius * Math.sin(-3 * Math.PI / 4) - 2;
    const cpX = 545;
    const cpY = 320;

    ctx.save();
    ctx.strokeStyle = theme.lineColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(cpX, cpY, endX, endY);
    ctx.stroke();

    drawArrowhead(ctx, cpX, cpY, endX, endY, theme.lineColor);
    drawArrowhead(ctx, cpX, cpY, startX, startY, theme.lineColor);
    ctx.restore();

    drawTextBadge(ctx, ['auth tokens /', 'validation'], 505, 335, 'center', theme.labelText, theme.bg);
  }

  // Draw Center Circle
  ctx.save();
  // Thin decorative outer halo ring
  ctx.beginPath();
  ctx.arc(cx, cy, centerRadius + 5, 0, 2 * Math.PI);
  ctx.strokeStyle = theme.centerCircleBorder;
  ctx.lineWidth = isBW ? 1.2 : 1.5;
  ctx.stroke();

  // Solid Main Circle
  ctx.beginPath();
  ctx.arc(cx, cy, centerRadius, 0, 2 * Math.PI);
  ctx.fillStyle = theme.centerCircleFill;
  ctx.fill();
  ctx.strokeStyle = theme.centerCircleBorder;
  ctx.lineWidth = 2.0;
  ctx.stroke();

  // Center Text
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.centerCircleText;
  ctx.font = 'bold 24px Inter, Arial, sans-serif';
  ctx.letterSpacing = '1.5px';
  ctx.fillText('TALA', cx, cy - 4);

  // Subtitle under TALA
  ctx.font = '600 11.5px Inter, Arial, sans-serif';
  ctx.fillStyle = theme.centerCircleSub;
  ctx.letterSpacing = '1px';
  ctx.fillText('RHU PAETE', cx, cy + 20);
  ctx.restore();

  // Draw 6 Outer Rectangular Nodes
  Object.values(boxes).forEach(box => {
    drawRoundedRect(ctx, box.x, box.y, box.w, box.h, 9, theme.boxFill, true, theme.boxBorder, 1.6);

    ctx.save();
    ctx.textAlign = 'center';
    // Title
    ctx.font = 'bold 14.5px Inter, Arial, sans-serif';
    ctx.fillStyle = theme.boxText;
    ctx.fillText(box.title, box.x + box.w / 2, box.y + 30);

    // Subtext lines
    ctx.font = '11.5px Inter, Arial, sans-serif';
    ctx.fillStyle = theme.boxSub;
    box.lines.forEach((line, idx) => {
      ctx.fillText(line, box.x + box.w / 2, box.y + 52 + idx * 17);
    });
    ctx.restore();
  });

  return canvas.toBuffer('image/png');
}

/* =========================================================================
   2. DATA FLOW DIAGRAM (DFD) GENERATOR
   ========================================================================= */
function generateDataFlowDiagram(themeKey) {
  const isBW = themeKey === 'bw';
  const theme = isBW ? BW_THEME : COLOR_THEME;

  const W = 1500;
  const H = 1000;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  // Outer Border Frame
  const margin = 40;
  ctx.strokeStyle = theme.frameBorder;
  ctx.lineWidth = 1.8;
  ctx.strokeRect(margin, margin, W - 2 * margin, H - 2 * margin);

  // Positions and Layout
  const bottomY = 805;
  const bottomH = 100;

  // 1. GATEWAY / EDGE (Bottom Left)
  const gateway = { x: 145, y: bottomY, w: 260, h: bottomH };
  // 2. FRONTEND (Bottom Center)
  const frontend = { x: 595, y: bottomY, w: 285, h: bottomH };
  // 3. USER (Bottom Right)
  const user = { x: 1045, y: bottomY, w: 285, h: bottomH };

  // 4. Large BACKEND Container (Center)
  const backend = {
    x: 520,
    y: 180,
    w: 435,
    h: 525,
    headerH: 48
  };

  // 5. DATABASE Cylinder (Left of Backend)
  const db = { x: 145, y: 320, w: 250, h: 140 };

  // 6. STORAGE & MIGRATION REPO (Top Right of Backend)
  const storage = { x: 1045, y: 120, w: 285, h: 92 };

  // 7. NOTIFICATION & ALERTS (Middle Right of Backend)
  const notification = { x: 1045, y: 400, w: 285, h: 105 };

  // ================= CONNECTORS & LABELS =================

  // Connector A: USER -> FRONTEND (Horizontal Left)
  {
    const startX = user.x;
    const startY = bottomY + bottomH / 2;
    const endX = frontend.x + frontend.w;
    const endY = startY;

    ctx.save();
    ctx.strokeStyle = theme.lineColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    drawArrowhead(ctx, startX, startY, endX, endY, theme.lineColor);

    // Label
    ctx.font = 'italic 11.5px Inter, Arial, sans-serif';
    ctx.fillStyle = theme.labelText;
    ctx.textAlign = 'center';
    ctx.fillText('Uses UI / dashboards /', (startX + endX) / 2, startY - 18);
    ctx.fillText('forms', (startX + endX) / 2, startY - 4);
    ctx.restore();
  }

  // Connector B: FRONTEND -> GATEWAY / EDGE (Horizontal Left)
  {
    const startX = frontend.x;
    const startY = bottomY + bottomH / 2;
    const endX = gateway.x + gateway.w;
    const endY = startY;

    ctx.save();
    ctx.strokeStyle = theme.lineColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    drawArrowhead(ctx, startX, startY, endX, endY, theme.lineColor);

    // Label
    ctx.font = 'italic 12px Inter, Arial, sans-serif';
    ctx.fillStyle = theme.labelText;
    ctx.textAlign = 'center';
    ctx.fillText('HTTPS / WS', (startX + endX) / 2, startY - 12);
    ctx.restore();
  }

  // Connector C: GATEWAY / EDGE -> BACKEND (Routes Request, TLS)
  // Up from GATEWAY top, right to BACKEND left
  {
    const startX = gateway.x + gateway.w * 0.5;
    const startY = gateway.y;
    const cornerY = 280;
    const endX = backend.x;
    const endY = cornerY;

    ctx.save();
    ctx.strokeStyle = theme.lineColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(startX, cornerY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    drawArrowhead(ctx, startX, cornerY, endX, endY, theme.lineColor);

    // Label
    ctx.font = 'italic 11.5px Inter, Arial, sans-serif';
    ctx.fillStyle = theme.labelText;
    ctx.textAlign = 'center';
    ctx.fillText('Routes Request, TLS', (startX + endX) / 2, cornerY - 24);
    ctx.fillText('& Rate Limiting', (startX + endX) / 2, cornerY - 8);
    ctx.restore();
  }

  // Connector D: FRONTEND <-> BACKEND (Bidirectional Vertical)
  {
    const startX = frontend.x + frontend.w * 0.5;
    const startY = frontend.y;
    const endX = startX;
    const endY = backend.y + backend.h;

    ctx.save();
    ctx.strokeStyle = theme.lineColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    drawArrowhead(ctx, startX, startY, endX, endY, theme.lineColor); // points up to backend
    drawArrowhead(ctx, endX, endY, startX, startY, theme.lineColor); // points down to frontend

    // Label beside vertical line
    ctx.font = 'italic 11.5px Inter, Arial, sans-serif';
    ctx.fillStyle = theme.labelText;
    ctx.textAlign = 'left';
    ctx.fillText('REST & WS endpoints /', startX + 10, (startY + endY) / 2 - 8);
    ctx.fillText('real-time updates', startX + 10, (startY + endY) / 2 + 10);
    ctx.restore();
  }

  // Connector E: DATABASE <-> BACKEND (Bidirectional Horizontal)
  {
    const startX = db.x + db.w;
    const startY = db.y + db.h * 0.5 + 5;
    const endX = backend.x;
    const endY = startY;

    ctx.save();
    ctx.strokeStyle = theme.lineColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    drawArrowhead(ctx, endX, endY, startX, startY, theme.lineColor);
    drawArrowhead(ctx, startX, startY, endX, endY, theme.lineColor);

    // Label
    ctx.font = 'italic 12px Inter, Arial, sans-serif';
    ctx.fillStyle = theme.labelText;
    ctx.textAlign = 'center';
    ctx.fillText('CRUD / queries', (startX + endX) / 2, startY - 10);
    ctx.restore();
  }

  // Connector F: BACKEND -> STORAGE & MIGRATION REPO
  // Up from backend top, right to storage left edge
  {
    const startX = backend.x + backend.w * 0.6;
    const startY = backend.y;
    const cornerY = storage.y + storage.h * 0.35;
    const endX = storage.x;
    const endY = cornerY;

    ctx.save();
    ctx.strokeStyle = theme.lineColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(startX, cornerY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    drawArrowhead(ctx, startX, cornerY, endX, endY, theme.lineColor);

    // Label
    ctx.font = 'italic 11.5px Inter, Arial, sans-serif';
    ctx.fillStyle = theme.labelText;
    ctx.textAlign = 'center';
    ctx.fillText('Uploads / Scanned Records / Data Parsing', (startX + endX) / 2 + 15, cornerY - 12);
    ctx.restore();
  }

  // Connector G: BACKEND -> NOTIFICATION & ALERTS (Horizontal Right)
  {
    const startX = backend.x + backend.w;
    const startY = notification.y + notification.h * 0.5;
    const endX = notification.x;
    const endY = startY;

    ctx.save();
    ctx.strokeStyle = theme.lineColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    drawArrowhead(ctx, startX, startY, endX, endY, theme.lineColor);

    // Label
    ctx.font = 'italic 11.5px Inter, Arial, sans-serif';
    ctx.fillStyle = theme.labelText;
    ctx.textAlign = 'center';
    ctx.fillText('Trigger Alerts', (startX + endX) / 2, startY - 12);
    ctx.restore();
  }

  // ================= DRAW NODES =================

  // 1. GATEWAY / EDGE Box
  drawRoundedRect(ctx, gateway.x, gateway.y, gateway.w, gateway.h, 8, theme.boxFill, true, theme.boxBorder, 1.6);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 14.5px Inter, Arial, sans-serif';
  ctx.fillStyle = theme.boxText;
  ctx.fillText('GATEWAY / EDGE', gateway.x + gateway.w / 2, gateway.y + 32);
  ctx.font = '11px Inter, Arial, sans-serif';
  ctx.fillStyle = theme.boxSub;
  ctx.fillText('Express Middleware / Security', gateway.x + gateway.w / 2, gateway.y + 55);
  ctx.fillText('Helmet — CORS — Rate Limit', gateway.x + gateway.w / 2, gateway.y + 73);
  ctx.restore();

  // 2. FRONTEND Box
  drawRoundedRect(ctx, frontend.x, frontend.y, frontend.w, frontend.h, 8, theme.boxFill, true, theme.boxBorder, 1.6);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 14.5px Inter, Arial, sans-serif';
  ctx.fillStyle = theme.boxText;
  ctx.fillText('FRONTEND', frontend.x + frontend.w / 2, frontend.y + 32);
  ctx.font = '11px Inter, Arial, sans-serif';
  ctx.fillStyle = theme.boxSub;
  ctx.fillText('Browser — HTTP(S) / Web Client', frontend.x + frontend.w / 2, frontend.y + 55);
  ctx.fillText('(HTML5 / CSS / Vanilla JS)', frontend.x + frontend.w / 2, frontend.y + 73);
  ctx.restore();

  // 3. USER Box
  drawRoundedRect(ctx, user.x, user.y, user.w, user.h, 8, theme.boxFill, true, theme.boxBorder, 1.6);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 14.5px Inter, Arial, sans-serif';
  ctx.fillStyle = theme.boxText;
  ctx.fillText('USER', user.x + user.w / 2, user.y + 32);
  ctx.font = '11px Inter, Arial, sans-serif';
  ctx.fillStyle = theme.boxSub;
  ctx.fillText('RHU Admin / Records Staff /', user.x + user.w / 2, user.y + 55);
  ctx.fillText('Healthcare Personnel / Admin Staff', user.x + user.w / 2, user.y + 73);
  ctx.restore();

  // 4. STORAGE & MIGRATION REPO (Top Right)
  drawRoundedRect(ctx, storage.x, storage.y, storage.w, storage.h, 8, theme.boxFill, true, theme.boxBorder, 1.6);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 14px Inter, Arial, sans-serif';
  ctx.fillStyle = theme.boxText;
  ctx.fillText('STORAGE & MIGRATION REPO', storage.x + storage.w / 2, storage.y + 30);
  ctx.font = '11px Inter, Arial, sans-serif';
  ctx.fillStyle = theme.boxSub;
  ctx.fillText('Multer & Temporary Uploads', storage.x + storage.w / 2, storage.y + 52);
  ctx.fillText('Legacy Scanned ITRs & PDF/CSVs', storage.x + storage.w / 2, storage.y + 70);
  ctx.restore();

  // 5. NOTIFICATION Box (Middle Right)
  drawRoundedRect(ctx, notification.x, notification.y, notification.w, notification.h, 8, theme.boxFill, true, theme.boxBorder, 1.6);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 14px Inter, Arial, sans-serif';
  ctx.fillStyle = theme.boxText;
  ctx.fillText('NOTIFICATION & ALERTS', notification.x + notification.w / 2, notification.y + 35);
  ctx.font = '11px Inter, Arial, sans-serif';
  ctx.fillStyle = theme.boxSub;
  ctx.fillText('In-App Alert Dispatcher', notification.x + notification.w / 2, notification.y + 58);
  ctx.fillText('(Duplicate Warnings & Migration Status)', notification.x + notification.w / 2, notification.y + 76);
  ctx.restore();

  // 6. DATABASE Cylinder (Left)
  drawCylinder(ctx, db.x, db.y, db.w, db.h, theme.dbFill, theme.dbTopFill, theme.dbBorder, isBW);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 15px Inter, Arial, sans-serif';
  ctx.fillStyle = theme.boxText;
  ctx.fillText('DATABASE', db.x + db.w / 2, db.y + 68);
  ctx.font = '11px Inter, Arial, sans-serif';
  ctx.fillStyle = theme.boxSub;
  ctx.fillText('PostgreSQL — users, patients,', db.x + db.w / 2, db.y + 92);
  ctx.fillText('records, duplicates, audit logs', db.x + db.w / 2, db.y + 110);
  ctx.restore();

  // 7. Large BACKEND Container Box (Center)
  {
    // Outer Container
    drawRoundedRect(ctx, backend.x, backend.y, backend.w, backend.h, 8, theme.backendBodyBg, true, theme.backendBorder, 1.8);

    // Header Bar
    ctx.save();
    ctx.beginPath();
    const r = 8;
    ctx.moveTo(backend.x + r, backend.y);
    ctx.lineTo(backend.x + backend.w - r, backend.y);
    ctx.arcTo(backend.x + backend.w, backend.y, backend.x + backend.w, backend.y + r, r);
    ctx.lineTo(backend.x + backend.w, backend.y + backend.headerH);
    ctx.lineTo(backend.x, backend.y + backend.headerH);
    ctx.lineTo(backend.x, backend.y + r);
    ctx.arcTo(backend.x, backend.y, backend.x + r, backend.y, r);
    ctx.closePath();
    ctx.fillStyle = theme.backendHeaderFill;
    ctx.fill();
    ctx.strokeStyle = theme.backendBorder;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Header Title
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px Inter, Arial, sans-serif';
    ctx.fillStyle = theme.backendHeaderText;
    ctx.fillText('</> BACKEND (Node.js & Express 4)', backend.x + backend.w / 2, backend.y + 30);
    ctx.restore();

    // 6 Sub-boxes Inside Backend (2 Columns x 3 Rows)
    const subModules = [
      // Row 1
      {
        col: 0, row: 0,
        title: 'API Gateway & Auth',
        items: ['JWT Verification', 'Bcrypt Password Hasher', 'Static Files Serve']
      },
      {
        col: 1, row: 0,
        title: 'Batch Migration & OCR',
        items: ['Multer Multipart Upload', 'Tesseract.js OCR Reader', 'PDF & CSV Record Parser']
      },
      // Row 2
      {
        col: 0, row: 1,
        title: 'Patient & Clinical Registry',
        items: ['Patient Demographics Master', 'Clinical Binders (ITR, Consult)', 'Maternal & Immunization Vax']
      },
      {
        col: 1, row: 1,
        title: 'Duplicate Detection & Search',
        items: ['Phonetic & Levenshtein Match', 'Duplicate Warning Flags', 'Unified Full-Text Search']
      },
      // Row 3
      {
        col: 0, row: 2,
        title: 'Epidemiological Analytics',
        items: ['Morbidity & Census Reports', 'RHU Paete Indicators', 'Summary Statistical Export']
      },
      {
        col: 1, row: 2,
        title: 'Audit Trail & Governance',
        items: ['System Activity Logging', 'Archive & Restore Records', 'Role Privilege Enforcement']
      }
    ];

    const subPadX = 16;
    const subW = (backend.w - subPadX * 3) / 2; // ~195px
    const subPadY = 16;
    const subStartY = backend.y + backend.headerH + subPadY;
    const subH = (backend.h - backend.headerH - subPadY * 4) / 3; // ~135px

    subModules.forEach(mod => {
      const bx = backend.x + subPadX + mod.col * (subW + subPadX);
      const by = subStartY + mod.row * (subH + subPadY);

      drawRoundedRect(ctx, bx, by, subW, subH, 6, theme.subBoxBg, true, theme.subBoxBorder, 1.2);

      ctx.save();
      ctx.textAlign = 'center';
      // Sub-box Title
      ctx.font = 'bold 12.5px Inter, Arial, sans-serif';
      ctx.fillStyle = theme.subBoxTitle;
      ctx.fillText(mod.title, bx + subW / 2, by + 26);

      // Sub-box Items
      ctx.font = '11px Inter, Arial, sans-serif';
      ctx.fillStyle = theme.subBoxText;
      mod.items.forEach((item, i) => {
        ctx.fillText(item, bx + subW / 2, by + 52 + i * 22);
      });
      ctx.restore();
    });
  }

  return canvas.toBuffer('image/png');
}

// Generate Both Diagrams in Color and Black & White
console.log('Generating System Context Diagram (Color)...');
const contextColorBuf = generateSystemContextDiagram('color');
fs.writeFileSync(path.join(flowchartsDir, 'TALA_System_Context_Diagram.png'), contextColorBuf);
fs.writeFileSync(path.join(publicDir, 'TALA_System_Context_Diagram.png'), contextColorBuf);

console.log('Generating System Context Diagram (B&W)...');
const contextBWBuf = generateSystemContextDiagram('bw');
fs.writeFileSync(path.join(flowchartsDir, 'TALA_System_Context_Diagram_BW.png'), contextBWBuf);
fs.writeFileSync(path.join(publicDir, 'TALA_System_Context_Diagram_BW.png'), contextBWBuf);

console.log('Generating Data Flow Diagram (Color)...');
const dfdColorBuf = generateDataFlowDiagram('color');
fs.writeFileSync(path.join(flowchartsDir, 'TALA_Data_Flow_Diagram.png'), dfdColorBuf);
fs.writeFileSync(path.join(publicDir, 'TALA_Data_Flow_Diagram.png'), dfdColorBuf);

console.log('Generating Data Flow Diagram (B&W)...');
const dfdBWBuf = generateDataFlowDiagram('bw');
fs.writeFileSync(path.join(flowchartsDir, 'TALA_Data_Flow_Diagram_BW.png'), dfdBWBuf);
fs.writeFileSync(path.join(publicDir, 'TALA_Data_Flow_Diagram_BW.png'), dfdBWBuf);

console.log('All diagrams generated successfully!');
