const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { spawn } = require('child_process');
const crypto = require('crypto');
const RecordModel = require('../models/recordModel');
const PatientModel = require('../models/patientModel');
const { dbClient, isSupabase } = require('../config/db');
const AuditMiddleware = require('../middleware/auditMiddleware');
const PDFProcessor = require('../utils/pdfProcessor');
const Classifier = require('../utils/classifier');
const TemporaryUploadModel = require('../models/temporaryUploadModel');

// Path to Python helper scripts
const DOCX_BUILDER_SCRIPT = path.join(process.cwd(), 'docx_builder.py');
const IMAGE_ENHANCER_SCRIPT = path.join(process.cwd(), 'image_enhancer.py');

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

  // Step 1: Upload document and perform image enhancement & alignment correction
  async enhancePreview(req, res) {
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

      // Verify patient exists
      const patient = await PatientModel.findById(patient_id);
      if (!patient) {
        fs.unlinkSync(file.path);
        return res.status(404).json({ success: false, message: 'Patient profile not found.' });
      }

      await AuditMiddleware.logActivity(req.user.id, req.user.email, 'IMAGE_ENHANCEMENT_STARTED', `Started auto-enhancement for file ${file.originalname}`, req);

      const fileExt = path.extname(file.originalname).toLowerCase();
      const uniqueId = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const enhancedPath = path.join(uploadTempDir, `enhanced_${uniqueId}.png`);

      let angleCorrected = 0.0;
      let resolution = [0, 0];
      let bgRemoved = false;
      let perspectiveCorrected = false;
      let finalPath = file.path;

      if (['.png', '.jpg', '.jpeg', '.pdf'].includes(fileExt)) {
        try {
          console.log(`[ENHANCER] Enhancing document: ${path.basename(file.path)}`);
          const pyRes = await new Promise((resolve, reject) => {
            const py = spawn('python', [IMAGE_ENHANCER_SCRIPT, file.path, enhancedPath], {
              cwd: process.cwd(),
              env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
            });
            let stdout = '', stderr = '';
            py.stdout.on('data', c => { stdout += c.toString(); });
            py.stderr.on('data', c => { stderr += c.toString(); });
            py.on('close', code => {
              if (code !== 0 && !fs.existsSync(enhancedPath)) {
                return reject(new Error(`image_enhancer failed (code ${code}): ${stderr}`));
              }
              try {
                const jsonLine = stdout.trim().split('\n').filter(l => l.startsWith('{')).pop();
                resolve(jsonLine ? JSON.parse(jsonLine) : { success: true, output_path: enhancedPath, angle_corrected: 0.0, resolution: [0, 0] });
              } catch (e) {
                resolve({ success: true, output_path: enhancedPath, angle_corrected: 0.0, resolution: [0, 0] });
              }
            });
            py.on('error', err => reject(err));
          });

          if (pyRes.success && fs.existsSync(enhancedPath)) {
            finalPath = enhancedPath;
            angleCorrected = pyRes.angle_corrected || 0.0;
            resolution = pyRes.resolution || [0, 0];
            bgRemoved = pyRes.bg_removed === true;
            perspectiveCorrected = pyRes.perspective_corrected === true;
            // Remove raw file if enhancement succeeded
            if (fs.existsSync(file.path) && file.path !== enhancedPath) {
              fs.unlinkSync(file.path);
            }
          }
        } catch (enhErr) {
          console.warn('[ENHANCER] Image enhancement failed, falling back to original file:', enhErr.message);
          finalPath = file.path;
        }
      }

      // Store temporary upload metadata
      const token = crypto.randomUUID();
      await TemporaryUploadModel.create({
        token,
        patient_id,
        file_name: file.originalname,
        file_path: finalPath,
        file_type: 'image/png',
        extracted_text: '',
        layout_blocks: '',
        suggested_category: 'PATIENT_INFORMATION_SHEET',
        alternative_category: '',
        confidence_score: 0.8,
        classification_reason: '',
        matched_terms: '[]',
        uploaded_by: req.user.id
      });

      const previewUrl = `/api/records/temp-image/${token}`;

      await AuditMiddleware.logActivity(req.user.id, req.user.email, 'IMAGE_ENHANCEMENT_COMPLETED', `Completed auto-enhancement for ${file.originalname} (Angle fix: ${angleCorrected} deg)`, req);

      return res.status(200).json({
        success: true,
        token,
        preview: {
          file_name: file.originalname,
          preview_url: previewUrl,
          angle_corrected: angleCorrected,
          resolution,
          enhancement_applied: true,
          bg_removed: bgRemoved,
          perspective_corrected: perspectiveCorrected
        }
      });

    } catch (error) {
      console.error('Enhance Preview error:', error);
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred during image enhancement.'
      });
    }
  },

  // Serve temporary enhanced preview image securely
  async getTempImage(req, res) {
    try {
      const { token } = req.params;
      if (!token) return res.status(400).send('Token required');

      const temp = await TemporaryUploadModel.findByToken(token);
      if (!temp || !fs.existsSync(temp.file_path)) {
        return res.status(404).send('Preview image expired or missing');
      }

      const resolved = path.resolve(temp.file_path);
      const resolvedTempDir = path.resolve(uploadTempDir);
      if (!resolved.startsWith(resolvedTempDir)) {
        return res.status(403).send('Access denied');
      }

      return res.sendFile(resolved);
    } catch (err) {
      console.error('Get temp image error:', err);
      return res.status(500).send('Error serving preview image');
    }
  },

  // Step 2: Confirm enhanced image and run PaddleOCR text extraction
  async ocrPreview(req, res) {
    try {
      const { token, patient_id } = req.body;
      const file = req.file;

      let tempUpload = null;

      if (token) {
        tempUpload = await TemporaryUploadModel.findByToken(token);
        if (!tempUpload) {
          return res.status(404).json({ success: false, message: 'Enhancement preview session expired. Please re-upload the document.' });
        }
      } else {
        // Fallback direct file upload path if no token passed
        if (!patient_id || !file) {
          if (file) fs.unlinkSync(file.path);
          return res.status(400).json({ success: false, message: 'Document upload file or preview token is required.' });
        }
      }

      const targetPath = tempUpload ? tempUpload.file_path : file.path;
      const targetFilename = tempUpload ? tempUpload.file_name : file.originalname;

      await AuditMiddleware.logActivity(req.user.id, req.user.email, 'OCR_PREVIEW_STARTED', `Started PaddleOCR extraction for ${targetFilename}`, req);

      let extractedText = '';
      let layoutBlocks = [];
      let pageSize = [595, 842];
      let itrData = null;
      let itrPageNumber = 1;

      let ocrFailureReason = null;
      try {
        console.log(`[OCR] Running text extraction on: ${path.basename(targetPath)}`);
        const ocrResult = await PDFProcessor.extractTextFromPdf(targetPath);
        extractedText = ocrResult.text || '';
        layoutBlocks = ocrResult.layout_blocks || [];
        pageSize = ocrResult.page_size || [595, 842];
        itrData = ocrResult.itr_data || null;
        itrPageNumber = ocrResult.itr_page_number || 1;
        console.log(`[OCR] Extraction complete. Engine: ${ocrResult.engine || 'unknown'}. Text length: ${extractedText.length}. Blocks: ${layoutBlocks.length}.`);
      } catch (ocrErr) {
        ocrFailureReason = ocrErr.message;
        console.error('[OCR] Extraction failed:', ocrErr.message);
        // Leave extractedText = '' so classifier returns LOW confidence gracefully
        // instead of classifying a literal error string
        extractedText = '';
      }

      // Classify text based on weighted keyword rules
      const classification = Classifier.classifyText(extractedText);

      let activeToken = token;

      if (tempUpload) {
        // Update existing temporary upload row
        await TemporaryUploadModel.updateByToken(token, {
          extracted_text: extractedText,
          layout_blocks: JSON.stringify({ blocks: layoutBlocks, page_size: pageSize, itr_data: itrData, itr_page_number: itrPageNumber }),
          suggested_category: classification.suggestedCategory,
          alternative_category: classification.alternativeCategory,
          confidence_score: classification.confidence,
          classification_reason: classification.reason,
          matched_terms: JSON.stringify(classification.matchedTerms)
        });
      } else {
        // Create new temporary upload row if fallback path
        activeToken = crypto.randomUUID();
        await TemporaryUploadModel.create({
          token: activeToken,
          patient_id,
          file_name: file.originalname,
          file_path: file.path,
          file_type: file.mimetype,
          extracted_text: extractedText,
          layout_blocks: JSON.stringify({ blocks: layoutBlocks, page_size: pageSize, itr_data: itrData, itr_page_number: itrPageNumber }),
          suggested_category: classification.suggestedCategory,
          alternative_category: classification.alternativeCategory,
          confidence_score: classification.confidence,
          classification_reason: classification.reason,
          matched_terms: JSON.stringify(classification.matchedTerms),
          uploaded_by: req.user.id
        });
      }

      await AuditMiddleware.logActivity(req.user.id, req.user.email, 'OCR_PREVIEW_COMPLETED', `Completed PaddleOCR extraction for file ${targetFilename} (Token: ${activeToken})`, req);
      await AuditMiddleware.logActivity(null, 'system@keepup.com', 'CLASSIFICATION_SUGGESTED', `AI classification suggested ${classification.suggestedCategory} with confidence ${classification.confidence} (${classification.confidenceLevel})`, req);

      return res.status(200).json({
        success: true,
        token: activeToken,
        preview: {
          file_name: targetFilename,
          preview_url: `/api/records/temp-image/${activeToken}`,
          suggested_category: classification.suggestedCategory,
          alternative_category: classification.alternativeCategory,
          confidence_score: classification.confidence,
          confidence_level: classification.confidenceLevel,
          classification_reason: classification.reason,
          matched_terms: classification.matchedTerms,
          extracted_text: extractedText,
          itr_data: itrData,
          itr_page_number: itrPageNumber
        }
      });

    } catch (error) {
      console.error('OCR Preview error:', error);
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred during OCR text extraction.'
      });
    }
  },

  // Confirm final patient record creation
  async confirmUpload(req, res) {
    try {
      const { token, file_name, record_type, extracted_text, structured_json } = req.body;

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
          console.log('[STORAGE] Supabase cloud storage bucket unavailable. File safely stored in local uploads directory.');
          const patientUploadDir = path.join(uploadDir, tempUpload.patient_id, recordId);
          if (!fs.existsSync(patientUploadDir)) {
            fs.mkdirSync(patientUploadDir, { recursive: true });
          }
          const localDest = path.join(patientUploadDir, sanitizedName);
          fs.copyFileSync(tempFilePath, localDest);
          if (fs.existsSync(tempFilePath)) {
            try { fs.unlinkSync(tempFilePath); } catch (_) {}
          }
          finalFilePath = path.relative(process.cwd(), localDest);
        }
      } else {
        const patientUploadDir = path.join(uploadDir, tempUpload.patient_id, recordId);
        if (!fs.existsSync(patientUploadDir)) {
          fs.mkdirSync(patientUploadDir, { recursive: true });
        }
        const localDest = path.join(patientUploadDir, sanitizedName);
        fs.copyFileSync(tempFilePath, localDest);
        if (fs.existsSync(tempFilePath)) {
          try { fs.unlinkSync(tempFilePath); } catch (_) {}
        }
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
        layout_blocks: tempUpload.layout_blocks || null,
        structured_json: structured_json || tempUpload.structured_json || null,
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

      // Enrich ALL patient-matched records first to get accurate total count
      const allEnriched = [];
      for (const rec of allRecords) {
        const patient = patientMap.get(rec.patient_id);
        if (!patient) continue; // Skip orphaned records (patient was deleted)
        allEnriched.push({
          ...rec,
          patient_name: `${patient.first_name} ${patient.last_name}`,
          patient_number: patient.patient_number
        });
      }

      return res.status(200).json({
        success: true,
        total: allEnriched.length, // Accurate count: only records with existing patients
        records: allEnriched.slice(0, parsedLimit)
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

  // Get single record details by ID
  async getRecordById(req, res) {
    try {
      const { id } = req.params;
      const record = await RecordModel.findById(id);
      if (!record) {
        return res.status(404).json({ success: false, message: 'Record not found.' });
      }

      const PatientModel = require('../models/patientModel');
      const patient = await PatientModel.findById(record.patient_id);
      const previewUrl = record.file_url || `/api/records/download/${record.id}`;

      return res.status(200).json({
        success: true,
        record: {
          ...record,
          preview_url: previewUrl
        },
        patient: patient || null
      });
    } catch (error) {
      console.error('Get record by id error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while fetching document details.'
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

  // Delete record permanently
  async deleteRecord(req, res) {
    try {
      const { id } = req.params;
      const record = await RecordModel.findById(id);
      if (!record) {
        return res.status(404).json({ success: false, message: 'Record not found.' });
      }

      await RecordModel.delete(id);

      // Clean up physical file if exists locally
      if (record.file_path && fs.existsSync(record.file_path)) {
        try { fs.unlinkSync(record.file_path); } catch (_) {}
      }

      await AuditMiddleware.logActivity(req.user.id, req.user.email, 'RECORD_DELETED', `Permanently deleted document: ${record.file_name} (Record ID: ${record.id})`, req);

      return res.status(200).json({
        success: true,
        message: 'Record deleted permanently.'
      });
    } catch (error) {
      console.error('Delete record error:', error);
      return res.status(500).json({
        success: false,
        message: 'An error occurred while deleting the patient record.'
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

  // Restore record from ARCHIVED back to ACTIVE
  async restoreRecord(req, res) {
    try {
      const { id } = req.params;
      const record = await RecordModel.findById(id);
      if (!record) {
        return res.status(404).json({ success: false, message: 'Record not found.' });
      }

      const restoredRecord = await RecordModel.update(id, { status: 'ACTIVE' });

      await AuditMiddleware.logActivity(req.user.id, req.user.email, 'RECORD_RESTORED', `Restored document: ${record.file_name} (Record ID: ${record.id})`, req);

      return res.status(200).json({
        success: true,
        message: 'Record restored successfully.',
        record: restoredRecord
      });
    } catch (error) {
      console.error('Restore record error:', error);
      return res.status(500).json({
        success: false,
        message: 'An error occurred while restoring the patient record.'
      });
    }
  },

  // Update record metadata & structured JSON/OCR text (Records Staff only)
  async updateRecordMetadata(req, res) {
    try {
      const { id } = req.params;
      const { file_name, record_type, status, extracted_text, structured_json } = req.body;

      // Check if record exists
      const record = await RecordModel.findById(id);
      if (!record) {
        return res.status(404).json({ success: false, message: 'Record not found.' });
      }

      const updates = {};
      if (file_name && file_name.trim()) {
        updates.file_name = sanitizeFilename(file_name);
      }
      if (record_type && record_type.trim()) {
        updates.record_type = record_type.trim();
      }
      if (status && status.trim()) {
        updates.status = status.trim();
      }
      if (extracted_text !== undefined) {
        updates.extracted_text = extracted_text;
      }
      if (structured_json !== undefined) {
        updates.structured_json = structured_json;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, message: 'No valid updates provided.' });
      }

      // Perform update
      const updatedRecord = await RecordModel.update(id, updates);

      await AuditMiddleware.logActivity(req.user.id, req.user.email, 'RECORD_METADATA_UPDATED', `Updated document ${record.file_name} details`, req);

      return res.status(200).json({
        success: true,
        message: 'Patient document record updated successfully.',
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
          console.log('[STORAGE] Supabase cloud storage bucket unavailable. File safely stored in local uploads directory.');
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
  },

  // Download record as Word document (.docx)
  async downloadAsDocx(req, res) {
    const tempDocxPath = path.join(process.cwd(), 'uploads', 'temp', `docx_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.docx`);
    const tempJsonPath = tempDocxPath.replace('.docx', '_ocr.json');

    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ success: false, message: 'Record ID is required.' });
      }

      const record = await RecordModel.findById(id);
      if (!record || record.status !== 'ACTIVE') {
        return res.status(404).json({ success: false, message: 'Record not found.' });
      }

      await AuditMiddleware.logActivity(req.user.id, req.user.email, 'RECORD_DOCX_DOWNLOAD', `Requested Word export of document: ${record.file_name} (Record ID: ${id})`, req);

      // Build OCR JSON for docx_builder.py
      let ocrData = { text: record.extracted_text || '', layout_blocks: [], page_size: [595, 842] };

      if (record.layout_blocks) {
        try {
          const parsed = typeof record.layout_blocks === 'string'
            ? JSON.parse(record.layout_blocks)
            : record.layout_blocks;
          ocrData.layout_blocks = parsed.blocks || parsed.layout_blocks || [];
          ocrData.page_size = parsed.page_size || [595, 842];
        } catch (_) {
          // Use plain text fallback
        }
      }

      // If no layout blocks available, re-run PaddleOCR on the stored file
      if (ocrData.layout_blocks.length === 0 && record.file_path) {
        try {
          let filePath = record.file_path;
          if (!path.isAbsolute(filePath)) {
            filePath = path.join(process.cwd(), filePath);
          }

          if (fs.existsSync(filePath)) {
            console.log(`[DOCX] Re-running PaddleOCR to build layout for: ${record.file_name}`);
            const freshOcr = await PDFProcessor.extractTextFromPdf(filePath);
            ocrData = freshOcr;
          }
        } catch (reOcrErr) {
          console.warn('[DOCX] Re-OCR failed, using plain text fallback:', reOcrErr.message);
        }
      }

      // Ensure temp directory exists
      const tempDir = path.dirname(tempDocxPath);
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      // Write OCR JSON to temp file for docx_builder.py
      fs.writeFileSync(tempJsonPath, JSON.stringify(ocrData), 'utf-8');

      // Determine clean document title from file name
      const docTitle = record.file_name
        .replace(/\.[^/.]+$/, '')          // Remove extension
        .replace(/[_\-]+/g, ' ')           // Replace underscores/hyphens with space
        .replace(/\b\w/g, c => c.toUpperCase()); // Title-case

      // Run docx_builder.py
      await new Promise((resolve, reject) => {
        const args = [DOCX_BUILDER_SCRIPT, tempJsonPath, tempDocxPath, '--title', docTitle];
        const py = spawn('python', args, { cwd: process.cwd() });

        let stdout = '';
        let stderr = '';

        py.stdout.on('data', chunk => { stdout += chunk.toString(); });
        py.stderr.on('data', chunk => { stderr += chunk.toString(); });

        py.on('close', (code) => {
          // Cleanup JSON temp
          if (fs.existsSync(tempJsonPath)) fs.unlinkSync(tempJsonPath);

          if (code !== 0 && !fs.existsSync(tempDocxPath)) {
            return reject(new Error(`docx_builder.py failed (code ${code}): ${stderr.slice(0, 300)}`));
          }

          try {
            const lastJson = stdout.trim().split('\n').filter(l => l.startsWith('{')).pop();
            if (lastJson) {
              const result = JSON.parse(lastJson);
              if (!result.success) return reject(new Error(result.error || 'docx_builder failed.'));
            }
          } catch (_) {}

          resolve();
        });

        py.on('error', (err) => {
          reject(new Error(`Failed to start docx_builder: ${err.message}`));
        });
      });

      if (!fs.existsSync(tempDocxPath)) {
        return res.status(500).json({ success: false, message: 'Word document generation failed.' });
      }

      // Stream .docx to client
      const downloadName = `${record.file_name.replace(/\.[^/.]+$/, '')}.docx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);

      const fileStream = fs.createReadStream(tempDocxPath);
      fileStream.pipe(res);

      fileStream.on('end', () => {
        // Cleanup temp docx after sending
        if (fs.existsSync(tempDocxPath)) fs.unlinkSync(tempDocxPath);
      });

      fileStream.on('error', (streamErr) => {
        console.error('[DOCX] Stream error:', streamErr);
        if (fs.existsSync(tempDocxPath)) fs.unlinkSync(tempDocxPath);
      });

    } catch (error) {
      console.error('Download as DOCX error:', error);
      // Cleanup temp files on error
      if (fs.existsSync(tempDocxPath)) fs.unlinkSync(tempDocxPath);
      if (fs.existsSync(tempJsonPath)) fs.unlinkSync(tempJsonPath);
      return res.status(500).json({
        success: false,
        message: 'An error occurred while generating the Word document.'
      });
    }
  },

  // List all ARCHIVED records (Records Staff / Admin)
  async listArchivedRecords(req, res) {
    try {
      const allRecords = await RecordModel.findAll(true); // includeArchived = true
      const archivedRecords = allRecords.filter(r => r.status === 'ARCHIVED');

      // Enrich with patient name where possible
      const enriched = await Promise.all(archivedRecords.map(async (rec) => {
        try {
          const patient = await PatientModel.findById(rec.patient_id);
          return {
            ...rec,
            patient_name: patient ? `${patient.first_name} ${patient.middle_name ? patient.middle_name + ' ' : ''}${patient.last_name}` : 'Unknown Patient',
            patient_number: patient ? patient.patient_number : '-'
          };
        } catch (_) {
          return { ...rec, patient_name: 'Unknown Patient', patient_number: '-' };
        }
      }));

      return res.status(200).json({ success: true, records: enriched });
    } catch (error) {
      console.error('List archived records error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while fetching archived records.'
      });
    }
  }
};

module.exports = RecordController;
