const PatientModel = require('../models/patientModel');
const RecordModel = require('../models/recordModel');

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generateSnippet(text, query) {
  if (!text || !query) return '';
  
  const cleanQuery = query.trim();
  if (!cleanQuery) return text.substring(0, 100) + (text.length > 100 ? '...' : '');

  const index = text.toLowerCase().indexOf(cleanQuery.toLowerCase());
  if (index === -1) {
    return text.substring(0, 100) + (text.length > 100 ? '...' : '');
  }

  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + cleanQuery.length + 50);
  
  let snippet = text.substring(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';

  return snippet;
}

function highlightTerm(escapedText, query) {
  if (!escapedText || !query) return escapedText;
  const escapedQuery = escapeHtml(query.trim());
  if (!escapedQuery) return escapedText;
  
  const regex = new RegExp(`(${escapeRegExp(escapedQuery)})`, 'gi');
  return escapedText.replace(regex, '<mark class="bg-yellow-100 font-semibold">$1</mark>');
}

const SearchController = {
  // Enhanced Unified Search Endpoint
  async unifiedSearch(req, res) {
    try {
      const { q, record_type, start_date, end_date, patient_status, page = 1, limit = 10 } = req.query;
      const AuditMiddleware = require('../middleware/auditMiddleware');

      const parsedPage = parseInt(page, 10) || 1;
      const parsedLimit = Math.min(50, parseInt(limit, 10) || 10);
      const offset = (parsedPage - 1) * parsedLimit;

      const minQueryLength = parseInt(process.env.SEARCH_MIN_QUERY_LENGTH || '2', 10);
      const maxResults = parseInt(process.env.SEARCH_MAX_RESULTS || '50', 10);

      // Audit search action
      await AuditMiddleware.logActivity(
        req.user.id,
        req.user.email,
        'SEARCH_PERFORMED',
        `Performed search query: "${q || ''}" with filters`,
        req
      );

      // Query length check
      if (!q || q.trim().length < minQueryLength) {
        return res.status(200).json({
          success: true,
          patients: [],
          records: [],
          pagination: {
            page: parsedPage,
            limit: parsedLimit,
            total_patients: 0,
            total_records: 0
          }
        });
      }

      const queryStr = q.trim().toLowerCase();

      // Authorization checks
      const canReadRecords = ['RHU_ADMINISTRATOR', 'RECORDS_STAFF', 'HEALTHCARE_PERSONNEL'].includes(req.user.role);
      const canReadArchived = ['RHU_ADMINISTRATOR', 'RECORDS_STAFF'].includes(req.user.role);

      // Date range parsing
      const startDate = start_date ? new Date(start_date) : null;
      const endDate = end_date ? new Date(end_date) : null;

      // 1. Fetch Patients (optionally including archived based on params and rights)
      const includeArchived = patient_status === 'ARCHIVED' && canReadArchived;
      const allPatients = await PatientModel.findAll(includeArchived || canReadArchived);

      // 2. Perform Patient matching
      const matchedPatientsList = allPatients.filter(p => {
        // Enforce status filter if explicitly requested
        if (patient_status && p.status !== patient_status) return false;
        
        // Date range filter based on creation
        if (startDate && new Date(p.created_at) < startDate) return false;
        if (endDate && new Date(p.created_at) > endDate) return false;

        const fullName = `${p.first_name} ${p.middle_name || ''} ${p.last_name}`.toLowerCase();
        return (
          p.patient_number.toLowerCase().includes(queryStr) ||
          p.first_name.toLowerCase().includes(queryStr) ||
          (p.middle_name && p.middle_name.toLowerCase().includes(queryStr)) ||
          p.last_name.toLowerCase().includes(queryStr) ||
          fullName.includes(queryStr) ||
          (p.contact_number && p.contact_number.toLowerCase().includes(queryStr)) ||
          (p.address && p.address.toLowerCase().includes(queryStr))
        );
      });

      // 3. Perform Record matching (Only if user has record read authorization)
      let matchedRecordsList = [];
      if (canReadRecords) {
        const allRecords = await RecordModel.findAll(canReadArchived); // Include archived records for admin/staff
        
        for (const rec of allRecords) {
          // Type filter
          if (record_type && rec.record_type !== record_type) continue;

          // Date range filter
          if (startDate && new Date(rec.created_at) < startDate) continue;
          if (endDate && new Date(rec.created_at) > endDate) continue;

          const fileNameMatch = rec.file_name.toLowerCase().includes(queryStr);
          const recordTypeMatch = rec.record_type.toLowerCase().includes(queryStr);
          const textMatch = rec.extracted_text && rec.extracted_text.toLowerCase().includes(queryStr);
          const classificationMatch = rec.classification_result && rec.classification_result.toLowerCase().includes(queryStr);

          if (fileNameMatch || recordTypeMatch || textMatch || classificationMatch) {
            const patient = allPatients.find(p => p.id === rec.patient_id);
            if (!patient) continue; // Skip orphan records or inaccessible patients

            const escapedSnippet = escapeHtml(generateSnippet(rec.extracted_text || '', queryStr));
            const highlightedSnippet = highlightTerm(escapedSnippet, queryStr);

            matchedRecordsList.push({
              ...rec,
              patient_name: `${patient.first_name} ${patient.last_name}`,
              patient_number: patient.patient_number,
              snippet: highlightedSnippet
            });
          }
        }
      }

      // Limit overall results count
      const limitedPatients = matchedPatientsList.slice(0, maxResults);
      const limitedRecords = matchedRecordsList.slice(0, maxResults);

      // Paginate
      const paginatedPatients = limitedPatients.slice(offset, offset + parsedLimit);
      const paginatedRecords = limitedRecords.slice(offset, offset + parsedLimit);

      return res.status(200).json({
        success: true,
        patients: paginatedPatients,
        records: paginatedRecords,
        pagination: {
          page: parsedPage,
          limit: parsedLimit,
          total_patients: limitedPatients.length,
          total_records: limitedRecords.length
        }
      });

    } catch (error) {
      console.error('Unified search error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while performing search.'
      });
    }
  }
};

module.exports = SearchController;
