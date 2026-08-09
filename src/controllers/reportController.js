const { dbClient, isSupabase, jsonDbPath } = require('../config/db');
const fs = require('fs');
const AuditModel = require('../models/auditModel');
const AuditMiddleware = require('../middleware/auditMiddleware');
const { shouldLogOnce, buildReportAccessKey, buildAuditLogsAccessKey } = require('../utils/auditAccessDedup');
const { resolveAuditActor } = require('../utils/auditDisplay');

const ALLOWED_REPORT_TYPES = new Set([
  'overview', 'patients', 'consultations', 'immunizations', 'anti-rabies',
  'maternal-care', 'duplicates', 'summary', 'stats', 'data'
]);

const ALLOWED_EXPORT_FORMATS = new Set(['PDF', 'CSV']);

// Helper to read local JSON data
function readLocalData() {
  try {
    const data = fs.readFileSync(jsonDbPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading JSON DB file:', error);
    return { users: [], patients: [], patient_records: [], duplicate_flags: [] };
  }
}

function sanitizeFilterValue(value, maxLen = 120) {
  if (value === undefined || value === null) return '';
  return String(value).trim().substring(0, maxLen);
}

function mapLogsForResponse(logs) {
  const db = readLocalData();
  const knownUserIds = new Set((db.users || []).map(u => u.id));
  return logs.map(log => {
    const actor = resolveAuditActor(log, knownUserIds);
    return {
      ...log,
      actor_display: actor.label,
      actor_sublabel: actor.sublabel,
      actor_role_display: actor.role
    };
  });
}

const ReportController = {
  // Get aggregate stats for dashboard counters
  async getStats(req, res) {
    try {
      let patients = [];
      let records = [];
      let duplicateFlags = [];

      if (isSupabase) {
        const { data: pData, error: pErr } = await dbClient.from('patients').select('*');
        if (pErr) throw pErr;
        patients = pData || [];

        const { data: rData, error: rErr } = await dbClient.from('patient_records').select('*');
        if (rErr) throw rErr;
        records = rData || [];

        const { data: dData, error: dErr } = await dbClient.from('duplicate_flags').select('*');
        if (dErr) throw dErr;
        duplicateFlags = dData || [];
      } else {
        const db = readLocalData();
        patients = db.patients || [];
        records = db.patient_records || [];
        duplicateFlags = db.duplicate_flags || [];
      }

      const totalActivePatients = patients.filter(p => p.status === 'ACTIVE').length;
      const totalArchivedPatients = patients.filter(p => p.status === 'ARCHIVED').length;
      const totalConsultationRecords = records.filter(r => r.record_type === 'CONSULTATION_RECORD' && r.status === 'ACTIVE').length;
      const totalImmunizationRecords = records.filter(r => r.record_type === 'IMMUNIZATION_RECORD' && r.status === 'ACTIVE').length;
      const totalAntiRabiesRecords = records.filter(r => r.record_type === 'ANTI_RABIES_RECORD' && r.status === 'ACTIVE').length;
      const totalMaternalCareRecords = records.filter(r => r.record_type === 'MATERNAL_CARE_RECORD' && r.status === 'ACTIVE').length;
      const totalUploadedHealthcareRecords = records.filter(r => r.status === 'ACTIVE').length;
      const totalDuplicateWarnings = duplicateFlags.length;
      const pendingDuplicateWarnings = duplicateFlags.filter(f => f.status === 'PENDING').length;

      const reportType = sanitizeFilterValue(req.query.report_type, 40) || 'stats';
      const filters = { report_type: reportType };
      const dedupKey = buildReportAccessKey(req.user.id, reportType, filters);
      if (shouldLogOnce(dedupKey, 60000)) {
        await AuditMiddleware.logFromRequest(
          req,
          'REPORT_ACCESSED',
          `Report stats viewed by ${req.user.role}. Filters: report_type=${reportType}. Status: success`
        );
      }

      return res.status(200).json({
        success: true,
        stats: {
          patients: {
            active: totalActivePatients,
            archived: totalArchivedPatients,
            total: patients.length
          },
          binders: {
            consultation: totalConsultationRecords,
            immunization: totalImmunizationRecords,
            anti_rabies: totalAntiRabiesRecords,
            maternal_care: totalMaternalCareRecords,
            total_active: totalUploadedHealthcareRecords
          },
          duplicates: {
            total: totalDuplicateWarnings,
            pending: pendingDuplicateWarnings
          }
        }
      });
    } catch (error) {
      console.error('Get stats error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while fetching reports statistics.'
      });
    }
  },

  // Generate filtered reports data
  async getReportData(req, res) {
    try {
      const { start_date, end_date, patient_name, category } = req.query;
      const reportType = sanitizeFilterValue(req.query.report_type, 40) || 'data';

      let patients = [];
      let records = [];
      let duplicateFlags = [];

      if (isSupabase) {
        const { data: pData, error: pErr } = await dbClient.from('patients').select('*');
        if (pErr) throw pErr;
        patients = pData || [];

        const { data: rData, error: rErr } = await dbClient
          .from('patient_records')
          .select(`*, patient:patients(*)`);
        if (rErr) throw rErr;
        records = rData || [];

        const { data: dData, error: dErr } = await dbClient
          .from('duplicate_flags')
          .select(`*, patient:patients!patient_id(*), possible_duplicate_patient:patients!possible_duplicate_patient_id(*)`);
        if (dErr) throw dErr;
        duplicateFlags = dData || [];
      } else {
        const db = readLocalData();
        patients = db.patients || [];
        const recordsRaw = db.patient_records || [];
        const duplicateFlagsRaw = db.duplicate_flags || [];

        records = recordsRaw.map(r => {
          const patient = patients.find(p => p.id === r.patient_id) || null;
          return { ...r, patient };
        });

        duplicateFlags = duplicateFlagsRaw.map(f => {
          const patient = patients.find(p => p.id === f.patient_id) || null;
          const possibleDuplicatePatient = patients.find(p => p.id === f.possible_duplicate_patient_id) || null;
          return { ...f, patient, possible_duplicate_patient: possibleDuplicatePatient };
        });
      }

      let filteredPatients = [...patients];
      let filteredRecords = [...records];
      let filteredDuplicateFlags = [...duplicateFlags];

      if (start_date) {
        const start = new Date(start_date);
        filteredPatients = filteredPatients.filter(p => new Date(p.created_at) >= start);
        filteredRecords = filteredRecords.filter(r => new Date(r.created_at) >= start);
        filteredDuplicateFlags = filteredDuplicateFlags.filter(f => new Date(f.detected_at) >= start);
      }
      if (end_date) {
        const end = new Date(end_date);
        end.setHours(23, 59, 59, 999);
        filteredPatients = filteredPatients.filter(p => new Date(p.created_at) <= end);
        filteredRecords = filteredRecords.filter(r => new Date(r.created_at) <= end);
        filteredDuplicateFlags = filteredDuplicateFlags.filter(f => new Date(f.detected_at) <= end);
      }

      if (patient_name && patient_name.trim() !== '') {
        const nameQuery = patient_name.toLowerCase().trim();
        filteredPatients = filteredPatients.filter(p => {
          const fullName = `${p.first_name} ${p.middle_name || ''} ${p.last_name}`.toLowerCase();
          return fullName.includes(nameQuery) || p.patient_number.toLowerCase().includes(nameQuery);
        });
        filteredRecords = filteredRecords.filter(r => {
          if (!r.patient) return false;
          const fullName = `${r.patient.first_name} ${r.patient.middle_name || ''} ${r.patient.last_name}`.toLowerCase();
          return fullName.includes(nameQuery) || r.patient.patient_number.toLowerCase().includes(nameQuery);
        });
        filteredDuplicateFlags = filteredDuplicateFlags.filter(f => {
          const nameMatchA = f.patient && `${f.patient.first_name} ${f.patient.middle_name || ''} ${f.patient.last_name}`.toLowerCase().includes(nameQuery);
          const nameMatchB = f.possible_duplicate_patient && `${f.possible_duplicate_patient.first_name} ${f.possible_duplicate_patient.middle_name || ''} ${f.possible_duplicate_patient.last_name}`.toLowerCase().includes(nameQuery);
          return nameMatchA || nameMatchB;
        });
      }

      if (category && category.trim() !== '' && category !== 'ALL') {
        filteredRecords = filteredRecords.filter(r => r.record_type === category);
      }

      const filters = {
        report_type: reportType,
        start_date: sanitizeFilterValue(start_date, 20),
        end_date: sanitizeFilterValue(end_date, 20),
        patient_name: sanitizeFilterValue(patient_name, 80),
        category: sanitizeFilterValue(category, 60)
      };

      const dedupKey = buildReportAccessKey(req.user.id, reportType, filters);
      if (shouldLogOnce(dedupKey, 60000)) {
        await AuditMiddleware.logFromRequest(
          req,
          'REPORT_ACCESSED',
          `Report data viewed by ${req.user.role}. Filters: report_type=${reportType}, start=${filters.start_date || 'all'}, end=${filters.end_date || 'present'}, patient_name=${filters.patient_name ? '[set]' : '[none]'}, category=${filters.category || 'ALL'}. Status: success`
        );
      }

      const totalP = filteredPatients.length;
      const activeP = filteredPatients.filter(p => p.status === 'ACTIVE').length;
      const archivedP = filteredPatients.filter(p => p.status === 'ARCHIVED').length;
      const activePercent = totalP > 0 ? ((activeP / totalP) * 100).toFixed(1) : '0.0';
      const archivedPercent = totalP > 0 ? ((archivedP / totalP) * 100).toFixed(1) : '0.0';

      const patientSummary = {
        total: totalP,
        active: activeP,
        archived: archivedP,
        active_percentage: activePercent,
        archived_percentage: archivedPercent,
        list: filteredPatients.map(p => ({
          id: p.id,
          patient_number: p.patient_number,
          name: `${p.first_name} ${p.middle_name ? p.middle_name + ' ' : ''}${p.last_name}`,
          birth_date: p.birth_date,
          sex: p.sex,
          status: p.status,
          created_at: p.created_at
        }))
      };

      const mapRecord = r => ({
        id: r.id,
        file_name: r.file_name,
        file_url: r.file_url,
        record_type: r.record_type,
        created_at: r.created_at,
        patient_name: r.patient ? `${r.patient.first_name} ${r.patient.middle_name ? r.patient.middle_name + ' ' : ''}${r.patient.last_name}` : 'Unknown Patient',
        patient_number: r.patient ? r.patient.patient_number : 'N/A'
      });

      const consultations = filteredRecords.filter(r => r.record_type === 'CONSULTATION_RECORD' && r.status === 'ACTIVE').map(mapRecord);
      const immunizations = filteredRecords.filter(r => r.record_type === 'IMMUNIZATION_RECORD' && r.status === 'ACTIVE').map(mapRecord);
      const antiRabies = filteredRecords.filter(r => r.record_type === 'ANTI_RABIES_RECORD' && r.status === 'ACTIVE').map(mapRecord);
      const maternalCares = filteredRecords.filter(r => r.record_type === 'MATERNAL_CARE_RECORD' && r.status === 'ACTIVE').map(mapRecord);
      const allActiveRecords = filteredRecords.filter(r => r.status === 'ACTIVE').map(mapRecord);

      const totalD = filteredDuplicateFlags.length;
      const pendingD = filteredDuplicateFlags.filter(f => f.status === 'PENDING').length;
      const reviewedD = filteredDuplicateFlags.filter(f => f.status === 'REVIEWED').length;
      const ignoredD = filteredDuplicateFlags.filter(f => f.status === 'IGNORED').length;

      const duplicateSummary = {
        total: totalD,
        pending: pendingD,
        reviewed: reviewedD,
        ignored: ignoredD,
        list: filteredDuplicateFlags.map(f => ({
          id: f.id,
          reason: f.reason,
          similarity_score: f.similarity_score,
          status: f.status,
          detected_at: f.detected_at,
          patient_name: f.patient ? `${f.patient.first_name} ${f.patient.last_name}` : 'N/A',
          patient_number: f.patient ? f.patient.patient_number : 'N/A',
          duplicate_patient_name: f.possible_duplicate_patient ? `${f.possible_duplicate_patient.first_name} ${f.possible_duplicate_patient.last_name}` : 'N/A',
          duplicate_patient_number: f.possible_duplicate_patient ? f.possible_duplicate_patient.patient_number : 'N/A'
        }))
      };

      return res.status(200).json({
        success: true,
        report: {
          period: {
            start: start_date || 'All Time',
            end: end_date || 'Present'
          },
          patientSummary,
          consultations,
          immunizations,
          antiRabies,
          maternalCares,
          allRecords: allActiveRecords,
          duplicateSummary
        }
      });
    } catch (error) {
      console.error('Generate report data error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while generating reports data.'
      });
    }
  },

  async auditExport(req, res) {
    try {
      const exportFormat = String(req.body.export_format || '').toUpperCase();
      const reportType = sanitizeFilterValue(req.body.report_type, 40);
      const startDate = sanitizeFilterValue(req.body.start_date, 20);
      const endDate = sanitizeFilterValue(req.body.end_date, 20);
      const category = sanitizeFilterValue(req.body.category, 60);

      if (!ALLOWED_EXPORT_FORMATS.has(exportFormat)) {
        return res.status(400).json({ success: false, message: 'Invalid export format. Allowed: PDF, CSV.' });
      }
      if (!reportType || !ALLOWED_REPORT_TYPES.has(reportType)) {
        return res.status(400).json({ success: false, message: 'Invalid report type.' });
      }

      await AuditMiddleware.logFromRequest(
        req,
        'REPORT_EXPORTED',
        `Exported ${exportFormat} report "${reportType}" with filters start=${startDate || 'all'}, end=${endDate || 'present'}, category=${category || 'ALL'}`
      );

      return res.status(200).json({ success: true, message: 'Export event recorded.' });
    } catch (error) {
      console.error('Audit export error:', error);
      return res.status(500).json({ success: false, message: 'Failed to record export audit event.' });
    }
  },

  // Get recent system audit logs (Admin only)
  async getAuditLogs(req, res) {
    try {
      const forceRefresh = req.query.refresh === '1';
      const dedupKey = buildAuditLogsAccessKey(req.user.id);
      if (forceRefresh || shouldLogOnce(dedupKey, 300000)) {
        await AuditMiddleware.logFromRequest(
          req,
          'AUDIT_LOGS_ACCESSED',
          `Administrator viewed audit logs${forceRefresh ? ' (explicit refresh)' : ''}. Status: success`
        );
      }

      const logs = await AuditModel.findRecent(100);
      return res.status(200).json({
        success: true,
        logs: mapLogsForResponse(logs)
      });
    } catch (error) {
      console.error('Get audit logs controller error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while retrieving audit logs.'
      });
    }
  }
};

module.exports = ReportController;
