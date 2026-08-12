const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { validateJwtSecret } = require('./src/config/jwtConfig');
validateJwtSecret();

const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const patientRoutes = require('./src/routes/patientRoutes');
const recordRoutes = require('./src/routes/recordRoutes');
const duplicateRoutes = require('./src/routes/duplicateRoutes');
const searchRoutes = require('./src/routes/searchRoutes');
const reportRoutes = require('./src/routes/reportRoutes');
const dashboardRoutes = require('./src/routes/dashboardRoutes');
const AuthMiddleware = require('./src/middleware/authMiddleware');
const CsrfMiddleware = require('./src/middleware/csrfMiddleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(CsrfMiddleware.validate.bind(CsrfMiddleware));
app.use(express.static(path.join(__dirname, 'src/views/public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { fallthrough: true }));

function findFileRecursively(dir, targetFilename) {
  if (!dir || !targetFilename || !fs.existsSync(dir)) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findFileRecursively(fullPath, targetFilename);
        if (found) return found;
      } else if (entry.isFile() && entry.name.toLowerCase() === targetFilename.toLowerCase()) {
        return fullPath;
      }
    }
  } catch (_) {}
  return null;
}

function getAnyImageInDir(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = getAnyImageInDir(fullPath);
        if (found) return found;
      } else if (entry.isFile() && (entry.name.endsWith('.png') || entry.name.endsWith('.jpg') || entry.name.endsWith('.jpeg') || entry.name.endsWith('.pdf'))) {
        return fullPath;
      }
    }
  } catch (_) {}
  return null;
}

// Smart Fallback for /uploads when literal path does not exist on disk
app.get('/uploads/*', (req, res) => {
  const reqPath = req.params[0] || req.path || '';
  const filename = path.basename(reqPath);
  const uploadsDir = path.join(__dirname, 'uploads');
  
  const pathParts = reqPath.split('/').filter(Boolean);
  const patientId = pathParts.length > 0 ? pathParts[0] : null;

  const possiblePaths = [
    path.join(uploadsDir, reqPath),
    filename ? path.join(uploadsDir, filename) : null,
    (patientId && filename) ? path.join(uploadsDir, patientId, filename) : null,
    filename ? path.join(uploadsDir, 'records', filename) : null,
    filename ? path.join(uploadsDir, 'temp', filename) : null,
    filename ? path.join(uploadsDir, 'avatars', filename) : null
  ].filter(Boolean);

  let foundPath = possiblePaths.find(p => fs.existsSync(p));
  
  if (!foundPath && filename) {
    foundPath = findFileRecursively(uploadsDir, filename);
  }
  
  if (!foundPath && patientId) {
    foundPath = getAnyImageInDir(path.join(uploadsDir, patientId));
  }

  if (foundPath) {
    return res.sendFile(path.resolve(foundPath), (err) => {
      if (err && !res.headersSent) {
        res.status(404).send('File not found');
      }
    });
  }
  return res.status(404).send('File not found');
});

function getDashboardPath(role) {
  switch (role) {
    case 'RHU_ADMINISTRATOR':
      return '/dashboard/admin';
    case 'RECORDS_STAFF':
      return '/dashboard/records';
    case 'HEALTHCARE_PERSONNEL':
      return '/dashboard/healthcare';
    case 'ADMINISTRATIVE_STAFF':
      return '/dashboard/administrative';
    default:
      return '/login';
  }
}

app.get('/', AuthMiddleware.authenticate, (req, res) => {
  if (req.user) {
    return res.redirect(getDashboardPath(req.user.role));
  }
  res.redirect('/login');
});

app.get('/login', AuthMiddleware.authenticate, (req, res) => {
  if (req.user) {
    return res.redirect(getDashboardPath(req.user.role));
  }
  res.sendFile(path.join(__dirname, 'src/views/login.html'));
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/records', recordRoutes);
app.use('/api/duplicates', duplicateRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/reports', reportRoutes);
app.use('/dashboard', dashboardRoutes);

// Return JSON 404 for unmatched API routes (prevents "Unexpected token '<'" on frontend)
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: `API route not found: ${req.method} ${req.originalUrl}` });
});

app.use((req, res) => {
  res.redirect('/');
});

app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`  KEEP UP SYSTEM - Objectives 1-5 Active`);
  console.log(`  Server listening on port: ${PORT}     `);
  console.log(`  Local URL: http://localhost:${PORT}   `);
  console.log(`========================================`);
});
