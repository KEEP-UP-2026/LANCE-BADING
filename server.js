const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
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
