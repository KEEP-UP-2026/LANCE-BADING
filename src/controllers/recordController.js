const fs = require('fs');
const path = require('path');
const multer = require('multer');
const Tesseract = require('tesseract.js');
const crypto = require('crypto');
const RecordModel = require('../models/recordModel');
const PatientModel = require('../models/patientModel');
const { dbClient, isSupabase } = require('../config/db');
const AuditMiddleware = require('../middleware/auditMiddleware');
const PDFProcessor = require('../utils/pdfProcessor');
const Classifier = require('../utils/classifier');
const TemporaryUploadModel = require('../models/temporaryUploadModel');

// Define and ensure upload directory exists
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Private temporary directory for uploads before confirmation
const uploadTempDir = path.join(uploadDir, 'temp');
if (!fs.existsSync(uploadTempDir)) {
  fs.mkdirSync(uploadTempDir, { recursive: true });
}

// Configurable file size limit from environment variables (default to 10MB)
const maxFileSize = parseInt(process.env.FILE_SIZE_LIMIT, 10) || 10 * 1024 * 1024;

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadTempDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const mimeToExt = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/jpg': ['.jpg', '.jpeg'],
  'application/pdf': ['.pdf']
};

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimetype = file.mimetype.toLowerCase();
  
  if (!mimeToExt[mimetype] || !mimeToExt[mimetype].includes(ext)) {
    return cb(new Error('Only PNG, JPG, JPEG, and PDF documents are allowed, and file contents must match extension.'), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: maxFileSize }
}).single('document');

// Filename sanitization helper to prevent directory traversal or invalid characters
function sanitizeFilename(filename) {
  if (!filename) return 'unnamed_file';
  const ext = path.extname(filename).toLowerCase();
  const base = path.basename(filename, ext);
  // Keep only alphanumeric characters, underscores, and hyphens
  const cleanBase = base.replace(/[^a-zA-Z0-9_\-]/g, '_').substring(0, 100);
  return `${cleanBase}${ext}`;
}

// Cleanup expired temporary uploads (older than 60 minutes)
async function cleanExpiredUploads() {
  try {
    const expiredList = await TemporaryUploadModel.deleteExpired(60);
    let count = 0;
    for (const temp of expiredList) {
      if (fs.existsSync(temp.file_path)) {
        fs.unlinkSync(temp.file_path);
        count++;
      }
    }
    if (count > 0) {
      console.log(`[CLEANUP] Deleted ${count} expired temporary upload files.`);
    }
  } catch (err) {
    console.error('[CLEANUP] Failed to clean expired temporary uploads:', err);
  }
}

// Run periodic cleanup every 15 minutes
setInterval(cleanExpiredUploads, 15 * 60 * 1000);
// Trigger immediate cleanup on load
cleanExpiredUploads();

const RecordController = {
  // Middleware to handle multer file upload in express routes
  uploadMiddleware(req, res, next) {
    upload(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message || 'File upload error.'
        });
      }
      
      if (!req.file) {
        return next();
      }

      // Verify file content signature (magic bytes)
      try {
        const file = req.file;
        const ext = path.extname(file.originalname).toLowerCase();
        
        const buffer = Buffer.alloc(8);
        const fd = fs.openSync(file.path, 'r');
        fs.readSync(fd, buffer, 0, 8, 0);
        fs.closeSync(fd);
        
        const hex = buffer.toString('hex').toLowerCase();
        let isValid = false;
        
        if (ext === '.png') {
          isValid = hex.startsWith('89504e470d0a1a0a');
        } else if (ext === '.jpg' || ext === '.jpeg') {
          isValid = hex.startsWith('ffd8ff');
        } else if (ext === '.pdf') {
          isValid = hex.startsWith('25504446'); // %PDF
        }
        
        if (!isValid) {
          fs.unlinkSync(file.path);
          return res.status(400).json({
            success: false,
            message: 'Invalid file format. The file content does not match its extension.'
          });
        }
        next();
      } catch (err) {
        console.error('File signature check error:', err);
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({
          success: false,
          message: 'Failed to validate uploaded document format.'
        });
      }
    });
  },

  // Upload and process record for preview (Unconfirmed stage)
  async ocrPreview(req, res) {
    try {
      const { patient_id } = req.body;
      const file = req.file;

      if (!patient_id) {
        if (file) fs.unlinkSync(file.path);
        return res.status(400).json({ success: false, message: 'Patient ID is required.' });
      }

      if (!file) {
        return res.status(400).json({ success: false, message: 'No document file uploaded.' });
      }

      // Check if patient exists
      const patient = await PatientModel.findById(patient_id);
      if (!patient) {
        fs.unlinkSync(file.path);
        return res.status(404).json({ success: false, message: 'Patient profile not found.' });
      }

      await AuditMiddleware.logActivity(req.user.id, req.user.email, 'OCR_PREVIEW_STARTED', `Started OCR preview check for file ${file.originalname}`, req);

      const fileExt = path.extname(file.originalname).toLowerCase();
      let extractedText = '';

      if (['.png', '.jpg', '.jpeg'].includes(fileExt)) {
        try {
          console.log(`Running Tesseract OCR on temp image: ${file.path}`);
          const ocrResult = await Tesseract.recognize(file.path, 'eng');
          extractedText = ocrResult.data.text || '';
        } catch (ocrErr) {
          console.error('Tesseract OCR extraction failed:', ocrErr);
          extractedText = '[OCR processing failed during upload]';
        }
      } else if (fileExt === '.pdf') {
        try {
          console.log(`Running PDF processor on temp file: ${file.path}`);
          extractedText = await PDFProcessor.extractTextFromPdf(file.path);
        } catch (pdfErr) {
          console.error('PDF OCR extraction failed:', pdfErr);
          fs.unlinkSync(file.path);
          await AuditMiddleware.logActivity(req.user.id, req.user.email, 'OCR_PREVIEW_FAILED', `PDF processing failed: ${pdfErr.message}`, req);
          return res.status(400).json({ success: false, message: pdfErr.message || 'Failed to process PDF file.' });
        }
      }

      // Classify based on the new weighted keyword rules
      const classification = Classifier.classifyText(extractedText);

      // Save temporary upload metadata to database
      const token = crypto.randomUUID();
      
      await TemporaryUploadModel.create({
        token,
        patient_id,
        file_name: file.originalname,
        file_path: file.path,
        file_type: file.mimetype,
        extracted_text: extractedText,
        suggested_category: classification.suggestedCategory,
        alternative_category: classification.alternativeCategory,
        confidence_score: classification.confidence,
        classification_reason: classification.reason,
        matched_terms: JSON.stringify(classification.matchedTerms),
        uploaded_by: req.user.id
      });

      await AuditMiddleware.logActivity(req.user.id, req.user.email, 'OCR_PREVIEW_COMPLETED', `Completed OCR preview for file ${file.originalname} (Token: ${token})`, req);
      await AuditMiddleware.logActivity(null, 'system@keepup.com', 'CLASSIFICATION_SUGGESTED', `AI-assisted classification suggested ${classification.suggestedCategory} with confidence ${classification.confidence} (${classification.confidenceLevel})`, req);

      return res.status(200).json({
        success: true,
        token,
        preview: {
          file_name: file.originalname,
          suggested_category: classification.suggestedCategory,
          alternative_category: classification.alternativeCategory,
          confidence_score: classification.confidence,
          confidence_level: classification.confidenceLevel,
          classification_reason: classification.reason,
          matched_terms: classification.matchedTerms,
          extracted_text: extractedText
        }
      });

    } catch (error) {
      console.error('OCR Preview error:', error);
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred during OCR text extraction preview.'
      });
    }
  },

  // Confirm final patient record creation
  async confirmUpload(req, res) {
    try {
      const { token, file_name, record_type, extracted_text } = req.body;

      if (!token) {
        return res.status(400).json({ success: false, message: 'Upload token is required.' });
      }
      if (!file_name || !file_name.trim()) {
        return res.status(400).json({ success: false, message: 'Sanitized filename is required.' });
      }
      if (!record_type) {
        return res.status(400).json({ success: false, message: 'Record category is required.' });
      }

      // Fetch and validate temporary upload
      const tempUpload = await TemporaryUploadModel.findByToken(token);
      if (!tempUpload) {
        return res.status(404).json({ success: false, message: 'Upload session has expired or is invalid.' });
      }

      // Check authorization
      if (tempUpload.uploaded_by !== req.user.id && req.user.role !== 'RHU_ADMINISTRATOR') {
        return res.status(403).json({ success: false, message: 'Access denied: You are not authorized to complete this upload.' });
      }

      const tempFilePath = tempUpload.file_path;
      if (!fs.existsSync(tempFilePath)) {
        await TemporaryUploadModel.deleteByToken(token);
        return res.status(404).json({ success: false, message: 'Temporary file not found on disk.' });
      }

      // Move temporary file into permanent private storage (Supabase or private subdirectory)
      const recordId = crypto.randomUUID();
      const sanitizedName = sanitizeFilename(file_name);
      let finalFilePath = '';

      if (isSupabase) {
        const storagePath = `${tempUpload.patient_id}/${recordId}/${sanitizedName}`;
        try {
          try {
            await dbClient.storage.createBucket('patient-records', { public: false });
          } catch (_) {}

          const fileData = fs.readFileSync(tempFilePath);
          const { data, error } = await dbClient.storage
            .from('patient-records')
            .upload(storagePath, fileData, {
              contentType: tempUpload.file_type,
              upsert: true
            });

          if (error) throw error;
          finalFilePath = storagePath;
          fs.unlinkSync(tempFilePath);
        } catch (storageErr) {
          console.error('Supabase storage upload failed, saving locally:', storageErr);
          const patientUploadDir = path.join(uploadDir, tempUpload.patient_id, recordId);
          if (!fs.existsSync(patientUploadDir)) {
            fs.mkdirSync(patientUploadDir, { recursive: true });
          }
          const localDest = path.join(patientUploadDir, sanitizedName);
          fs.renameSync(tempFilePath, localDest);
          finalFilePath = path.relative(process.cwd(), localDest);
        }
      } else {
        const patientUploadDir = path.join(uploadDir, tempUpload.patient_id, recordId);
        if (!fs.existsSync(patientUploadDir)) {
          fs.mkdirSync(patientUploadDir, { recursive: true });
        }
        const localDest = path.join(patientUploadDir, sanitizedName);
        fs.renameSync(tempFilePath, localDest);
        finalFilePath = path.relative(process.cwd(), localDest);
      }

      // Save finalized patient record in DB
      const fileUrl = `/api/records/download/${recordId}`;
      const newRecord = await RecordModel.create({
        id: recordId,
        patient_id: tempUpload.patient_id,
        record_type,
        file_name: sanitizedName,
        file_url: fileUrl,
        file_path: finalFilePath,
        file_type: tempUpload.file_type,
        extracted_text: extracted_text !== undefined ? extracted_text : tempUpload.extracted_text,
        classification_result: tempUpload.suggested_category,
        uploaded_by: req.user.id
      });

      // Log audits
      await AuditMiddleware.logActivity(req.user.id, req.user.email, 'RECORD_UPLOAD_CONFIRMED', `Confirmed upload of document: ${sanitizedName} for patient ID ${tempUpload.patient_id}`, req);

      if (tempUpload.extracted_text !== extracted_text) {
        await AuditMiddleware.logActivity(req.user.id, req.user.email, 'OCR_TEXT_CORRECTED', `User corrected OCR text for record ${recordId}`, req);
      }

      if (tempUpload.suggested_category !== record_type) {
        await AuditMiddleware.logActivity(req.user.id, req.user.email, 'CLASSIFICATION_CHANGED', `Changed category suggestion from ${tempUpload.suggested_category} to ${record_type} for record ${recordId}`, req);
      }

      // Delete temporary token row
      await TemporaryUploadModel.deleteByToken(token);

      return res.status(201).json({
        success: true,
        message: 'Patient record confirmed and saved successfully.',
        record: newRecord
      });

    } catch (error) {
      console.error('Confirm upload error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while finalizing document upload.'
      });
    }
  },

  // Cancel temporary upload session
  async cancelUpload(req, res) {
    try {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ success: false, message: 'Upload token is required.' });
      }

      const tempUpload = await TemporaryUploadModel.findByToken(token);
      if (!tempUpload) {
        return res.status(404).json({ success: false, message: 'Upload session already cancelled or invalid.' });
      }

      // Delete temp file from disk
      if (fs.existsSync(tempUpload.file_path)) {
        fs.unlinkSync(tempUpload.file_path);
      }

      // Delete row from DB
      await TemporaryUploadModel.deleteByToken(token);

      await AuditMiddleware.logActivity(req.user.id, req.user.email, 'RECORD_UPLOAD_CANCELLED', `Cancelled temporary upload session for file ${tempUpload.file_name}`, req);

      return res.status(200).json({
        success: true,
        message: 'Temporary upload cancelled successfully.'
      });

    } catch (error) {
      console.error('Cancel upload error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while cancelling document upload.'
      });
    }
  },

  // List recent active records (dashboard activity streams)
  async listRecentRecords(req, res) {
    try {
      const PatientModel = require('../models/patientModel');
      const parsedLimit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 5));
      const allRecords = await RecordModel.findAllActive();
      const patients = await PatientModel.findAllActive();
      const patientMap = new Map(patients.map(p => [p.id, p]));

      const enriched = [];
      for (const rec of allRecords) {
        const patient = patientMap.get(rec.patient_id);
        if (!patient) continue;
        enriched.push({
          ...rec,
          patient_name: `${patient.first_name} ${patient.last_name}`,
          patient_number: patient.patient_number
        });
        if (enriched.length >= parsedLimit) break;
      }

      return res.status(200).json({
        success: true,
        total: allRecords.length,
        records: enriched
      });
    } catch (error) {
      console.error('List recent records error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while fetching recent records.'
      });
    }
  },

  // Get records of a single patient
  async getPatientRecords(req, res) {
    try {
      const { patientId } = req.params;
      const records = await RecordModel.findByPatientId(patientId);
      return res.status(200).json({
        success: true,
        records
      });
    } catch (error) {
      console.error('Get patient records error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while fetching patient records.'
      });
    }
  },

  // Archive record
  async archiveRecord(req, res) {
    try {
      const { id } = req.params;
      const record = await RecordModel.findById(id);
      if (!record) {
        return res.status(404).json({ success: false, message: 'Record not found.' });
      }

      const archivedRecord = await RecordModel.archive(id);

      await AuditMiddleware.logActivity(req.user.id, req.user.email, 'RECORD_ARCHIVED', `Archived document: ${record.file_name} (Record ID: ${record.id})`, req);

      return res.status(200).json({
        success: true,
        message: 'Record archived successfully.',
        record: archivedRecord
      });
    } catch (error) {
      console.error('Archive record error:', error);
      return res.status(500).json({
        success: false,
        message: 'An error occurred while archiving the patient record.'
      });
    }
  },

  // Download record securely
  async downloadRecord(req, res) {
    try {
      const { filename } = req.params;
      if (!filename) {
        return res.status(400).json({ success: false, message: 'Filename or Record ID parameter is required.' });
      }

      // 1. Find record in DB
      let record = null;
      const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(filename) || filename.startsWith('rec-uuid-');
      
      if (isUuid) {
        record = await RecordModel.findById(filename);
      } else {
        // Fallback for legacy filenames: find record that contains filename in file_name or file_url or file_path
        const safeFilename = path.basename(filename);
        const allRecords = await RecordModel.findAllActive();
        record = allRecords.find(r => 
          r.file_name === safeFilename || 
          (r.file_path && r.file_path.endsWith(safeFilename)) ||
          r.file_url.endsWith(safeFilename)
        );
      }

      if (!record || record.status !== 'ACTIVE') {
        return res.status(404).json({ success: false, message: 'Requested medical record file not found.' });
      }

      await AuditMiddleware.logActivity(req.user.id, req.user.email, 'RECORD_DOWNLOADED', `Downloaded medical document: ${record.file_name} (Record ID: ${record.id})`, req);

      // 2. Serve file based on mode
      if (isSupabase) {
        const storagePath = record.file_path;
        if (!storagePath) {
          return res.status(404).json({ success: false, message: 'File storage path not found for this record.' });
        }
        
        // If it starts with uploads/, it was a local fallback save in Supabase mode
        if (storagePath.startsWith('uploads') || fs.existsSync(path.join(process.cwd(), storagePath))) {
          const filePath = path.isAbsolute(storagePath) ? storagePath : path.join(process.cwd(), storagePath);
          const resolvedPath = path.resolve(filePath);
          const resolvedUploadDir = path.resolve(uploadDir);
          if (!resolvedPath.startsWith(resolvedUploadDir)) {
            return res.status(403).json({ success: false, message: 'Access denied: Invalid file path.' });
          }
          return res.sendFile(resolvedPath);
        }

        // Generate short-lived signed URL
        const { data, error } = await dbClient.storage
          .from('patient-records')
          .createSignedUrl(storagePath, 60); // 60 seconds
          
        if (error || !data || !data.signedUrl) {
          console.error('Supabase signed URL generation failed:', error);
          return res.status(500).json({ success: false, message: 'Failed to retrieve the secure document link.' });
        }
        
        // Redirect user to the secure signed URL
        return res.redirect(data.signedUrl);
      } else {
        // Local mode: serve file from private local storage path
        const filePath = path.isAbsolute(record.file_path)
          ? record.file_path
          : path.join(process.cwd(), record.file_path);
          
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ success: false, message: 'Medical record file not found on disk.' });
        }
        
        // Prevent directory traversal: check that the file is indeed under the uploads directory
        const resolvedPath = path.resolve(filePath);
        const resolvedUploadDir = path.resolve(uploadDir);
        if (!resolvedPath.startsWith(resolvedUploadDir)) {
          return res.status(403).json({ success: false, message: 'Access denied: Invalid file path.' });
        }
        
        return res.sendFile(resolvedPath);
      }
    } catch (error) {
      console.error('Download record error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while retrieving the file.'
      });
    }
  },

  // Update record metadata (Records Staff only)
  async updateRecordMetadata(req, res) {
    try {
      const { id } = req.params;
      const { file_name, record_type } = req.body;

      if (!file_name || !file_name.trim()) {
        return res.status(400).json({ success: false, message: 'File name is required.' });
      }
      if (!record_type || !record_type.trim()) {
        return res.status(400).json({ success: false, message: 'Record category is required.' });
      }

      // Check if record exists
      const record = await RecordModel.findById(id);
      if (!record) {
        return res.status(404).json({ success: false, message: 'Record not found.' });
      }

      const sanitizedName = sanitizeFilename(file_name);

      // Perform update
      const updatedRecord = await RecordModel.update(id, {
        file_name: sanitizedName,
        record_type
      });

      await AuditMiddleware.logActivity(req.user.id, req.user.email, 'RECORD_METADATA_UPDATED', `Updated metadata of document ${record.file_name} -> ${sanitizedName} (Category: ${record_type})`, req);

      return res.status(200).json({
        success: true,
        message: 'Document metadata updated successfully.',
        record: updatedRecord
      });
    } catch (error) {
      console.error('Update record metadata error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while updating record details.'
      });
    }
  },

  // Direct upload handler (supporting security-tests.js regression)
  async upload(req, res) {
    try {
      const { patient_id, record_type } = req.body;
      const file = req.file;

      if (!patient_id) {
        if (file) fs.unlinkSync(file.path);
        return res.status(400).json({ success: false, message: 'Patient ID is required.' });
      }
      if (!record_type) {
        if (file) fs.unlinkSync(file.path);
        return res.status(400).json({ success: false, message: 'Record type is required.' });
      }
      if (!file) {
        return res.status(400).json({ success: false, message: 'No document file uploaded.' });
      }

      // Check if patient exists
      const patient = await PatientModel.findById(patient_id);
      if (!patient) {
        fs.unlinkSync(file.path);
        return res.status(404).json({ success: false, message: 'Patient profile not found.' });
      }

      const recordId = crypto.randomUUID();
      const sanitizedName = sanitizeFilename(file.originalname);
      let finalFilePath = '';
      const tempFilePath = file.path;

      // Move temporary file into permanent private storage
      if (isSupabase) {
        const storagePath = `${patient_id}/${recordId}/${sanitizedName}`;
        try {
          try {
            await dbClient.storage.createBucket('patient-records', { public: false });
          } catch (_) {}

          const fileData = fs.readFileSync(tempFilePath);
          const { data, error } = await dbClient.storage
            .from('patient-records')
            .upload(storagePath, fileData, {
              contentType: file.mimetype,
              upsert: true
            });

          if (error) throw error;
          finalFilePath = storagePath;
          fs.unlinkSync(tempFilePath);
        } catch (storageErr) {
          console.error('Supabase storage upload failed, saving locally:', storageErr);
          const patientUploadDir = path.join(uploadDir, patient_id, recordId);
          if (!fs.existsSync(patientUploadDir)) {
            fs.mkdirSync(patientUploadDir, { recursive: true });
          }
          const localDest = path.join(patientUploadDir, sanitizedName);
          fs.renameSync(tempFilePath, localDest);
          finalFilePath = path.relative(process.cwd(), localDest);
        }
      } else {
        const patientUploadDir = path.join(uploadDir, patient_id, recordId);
        if (!fs.existsSync(patientUploadDir)) {
          fs.mkdirSync(patientUploadDir, { recursive: true });
        }
        const localDest = path.join(patientUploadDir, sanitizedName);
        fs.renameSync(tempFilePath, localDest);
        finalFilePath = path.relative(process.cwd(), localDest);
      }

      const fileUrl = `/api/records/download/${recordId}`;
      const newRecord = await RecordModel.create({
        id: recordId,
        patient_id,
        record_type,
        file_name: sanitizedName,
        file_url: fileUrl,
        file_path: finalFilePath,
        file_type: file.mimetype,
        extracted_text: '',
        classification_result: record_type,
        uploaded_by: req.user.id
      });

      await AuditMiddleware.logActivity(req.user.id, req.user.email, 'RECORD_UPLOAD_CONFIRMED', `Direct upload of document: ${sanitizedName} for patient ID ${patient_id}`, req);

      return res.status(201).json({
        success: true,
        message: 'Patient record uploaded and saved successfully.',
        record: newRecord
      });
    } catch (error) {
      console.error('Direct upload error:', error);
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred during document upload.'
      });
    }
  }
};

module.exports = RecordController;
