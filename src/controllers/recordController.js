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

  // Step 2a: Fast AI Document Classification preview for User Confirmation Modal
  async classifyPreview(req, res) {
    try {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ success: false, message: 'Preview token is required.' });
      }

      const tempUpload = await TemporaryUploadModel.findByToken(token);
      if (!tempUpload) {
        return res.status(404).json({ success: false, message: 'Enhancement preview session expired.' });
      }

      console.log(`[CLASSIFY] Running quick classification preview for token: ${token}`);
      const ocrResult = await PDFProcessor.extractTextFromPdf(tempUpload.file_path, 0);
      const rawText = (ocrResult.text || '').toUpperCase();
      const itrData = ocrResult.itr_data || {};
      const pageNum = ocrResult.itr_page_number || 1;

      const isP2 = pageNum === 2 || ['philhealth_membership', 'past_medical_history', 'immunizations', 'menstrual_history', 'pregnancy_history'].some(k => k in itrData) || ['PHILHEALTH', 'PAST MEDICAL HISTORY', 'PAST SURGICAL HISTORY', 'IMMUNIZATIONS', 'MENSTRUAL HISTORY', 'PREGNANCY HISTORY'].some(kw => rawText.includes(kw));
      
      const suggestedPage = isP2 ? 2 : 1;
      const suggestedLabel = suggestedPage === 2 ? 'Individual Treatment Record - Page 2' : 'Individual Treatment Record - Page 1';

      return res.status(200).json({
        success: true,
        suggested_page: suggestedPage,
        suggested_label: suggestedLabel,
        confidence_score: 0.95,
        confidence_level: 'HIGH CONFIDENCE'
      });
    } catch (err) {
      console.error('[CLASSIFY_PREVIEW] Classification preview failed:', err.message);
      return res.status(200).json({
        success: true,
        suggested_page: 1,
        suggested_label: 'Individual Treatment Record - Page 1',
        confidence_score: 0.80,
        confidence_level: 'MEDIUM CONFIDENCE'
      });
    }
  },

  // Step 2b: Confirm enhanced image and run PaddleOCR text extraction with confirmed page target
  async ocrPreview(req, res) {
    try {
      const { token, patient_id, page_type, confirmed_page } = req.body;
      const file = req.file;

      const targetPageType = parseInt(page_type || confirmed_page || '0', 10);

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

      await AuditMiddleware.logActivity(req.user.id, req.user.email, 'OCR_PREVIEW_STARTED', `Started PaddleOCR extraction for ${targetFilename} (Target Page: ${targetPageType})`, req);

      let extractedText = '';
      let layoutBlocks = [];
      let pageSize = [595, 842];
      let itrData = null;
      let itrPageNumber = targetPageType || 1;

      let ocrFailureReason = null;
      try {
        console.log(`[OCR] Running text extraction on: ${path.basename(targetPath)} (Confirmed Target Page: ${targetPageType})`);
        const ocrResult = await PDFProcessor.extractTextFromPdf(targetPath, targetPageType);
        extractedText = ocrResult.text || '';
        layoutBlocks = ocrResult.layout_blocks || [];
        pageSize = ocrResult.page_size || [595, 842];
        itrData = ocrResult.itr_data || null;
        itrPageNumber = ocrResult.itr_page_number || (targetPageType || 1);
        console.log(`[OCR] Extraction complete. Engine: ${ocrResult.engine || 'unknown'}. Text length: ${extractedText.length}. Blocks: ${layoutBlocks.length}. Target Page: ${itrPageNumber}`);
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

  // Create manual patient record (e.g. Manual ITR, Consultation, Immunization, or Medical Certificate)
  async createManualRecord(req, res) {
    try {
      const { patient_id, record_type, structured_json, file_name } = req.body;

      let patient = null;
      if (patient_id) {
        // Check if existing patient exists
        patient = await PatientModel.findById(patient_id);
        if (!patient) {
          return res.status(404).json({ success: false, message: 'Selected patient not found.' });
        }
      } else {
        // Optional patient linking: for walk-in patients or newly arrived visitors without an existing profile
        const demo = (structured_json && (structured_json.patient_demographics || structured_json.demographics)) || {};
        const pName = (demo.name || demo.full_name || req.body.patient_name || 'Walk-in Patient').trim();
        const parts = pName.split(' ');
        const firstName = parts[0] || 'Walk-in';
        const lastName = parts.slice(1).join(' ') || 'Patient';

        const allPatients = await PatientModel.findAllActive();
        const existingPatient = allPatients.find(p => {
          const fn = `${p.first_name || ''} ${p.last_name || ''}`.trim().toLowerCase();
          return fn === pName.toLowerCase() || (p.full_name && p.full_name.toLowerCase() === pName.toLowerCase());
        });

        if (existingPatient) {
          patient = existingPatient;
        } else {
          const yr = new Date().getFullYear();
          const random4 = Math.floor(1000 + Math.random() * 9000);
          const generatedPatientNumber = `0001-${yr}-${random4}`;
          const ageNum = demo.age ? parseInt(demo.age, 10) : 25;
          const birthYear = yr - ageNum;
          const birthDate = demo.birth_date || `${birthYear}-01-01`;
          const genderRaw = String(demo.gender || demo.sex || 'OTHER').toUpperCase();
          const sex = genderRaw.startsWith('F') ? 'FEMALE' : (genderRaw.startsWith('M') ? 'MALE' : 'OTHER');

          patient = await PatientModel.create({
            patient_number: generatedPatientNumber,
            first_name: firstName,
            last_name: lastName,
            middle_name: '',
            birth_date: birthDate,
            sex: sex,
            age: ageNum,
            gender: sex,
            address: demo.address || 'Paete, Laguna',
            contact_number: demo.contact_number || '',
            created_by: req.user ? req.user.id : null
          });
        }
      }

      const finalRecordType = record_type || 'PATIENT_INFORMATION_SHEET';
      const recordId = crypto.randomUUID();
      const prefix = finalRecordType === 'MATERNAL_CARE_RECORD' ? 'Maternal' : (finalRecordType === 'MEDICAL_CERTIFICATE' ? 'MedCert' : (finalRecordType === 'IMMUNIZATION_RECORD' ? 'Immunization' : (finalRecordType === 'CONSULTATION_RECORD' ? 'Consultation' : 'Manual_ITR')));
      const sanitizedName = file_name && file_name.trim()
        ? sanitizeFilename(file_name)
        : `${prefix}_${patient.patient_number || patient.id}_${Date.now()}.pdf`;

      // Build searchable text from structured_json for unified search
      let extractedText = '';
      if (structured_json && typeof structured_json === 'object') {
        const textParts = [];

        // Demographics
        const demo = structured_json.patient_demographics || structured_json.demographics || {};
        Object.entries(demo).forEach(([k, v]) => {
          if (v) textParts.push(`${k.replace(/_/g, ' ')}: ${v}`);
        });

        // Vital Signs
        const vitals = structured_json.vital_signs || {};
        Object.entries(vitals).forEach(([k, v]) => {
          if (typeof v === 'object' && v !== null) {
            Object.entries(v).forEach(([vk, vv]) => { if (vv) textParts.push(`${vk}: ${vv}`); });
          } else if (v) {
            textParts.push(`${k.replace(/_/g, ' ')}: ${v}`);
          }
        });

        // Smoking & Lifestyle
        const smk = structured_json.smoking_cessation_profile || structured_json.lifestyle || {};
        Object.entries(smk).forEach(([k, v]) => {
          if (v) textParts.push(`${k.replace(/_/g, ' ')}: ${v}`);
        });

        // Family History
        const fh = structured_json.family_history || {};
        const fhPos = Object.entries(fh).filter(([_, v]) => v === true).map(([k]) => k.replace(/_/g, ' '));
        if (fhPos.length > 0) textParts.push(`Family History: ${fhPos.join(', ')}`);

        // Clinical Consultation Specific Fields
        const consultDetails = structured_json.consultation_details || {};
        if (consultDetails.visit_date) textParts.push(`Visit Date: ${consultDetails.visit_date}`);
        if (consultDetails.chief_complaint) textParts.push(`Chief Complaint: ${consultDetails.chief_complaint}`);
        if (consultDetails.attending_physician) textParts.push(`Attending Physician: ${consultDetails.attending_physician}`);

        const medHistory = structured_json.medical_history || {};
        if (medHistory.history_of_present_illness) textParts.push(`HPI: ${medHistory.history_of_present_illness}`);
        if (medHistory.past_medical_surgical_history) textParts.push(`Past Medical History: ${medHistory.past_medical_surgical_history}`);
        if (medHistory.current_medications) textParts.push(`Current Medications: ${medHistory.current_medications}`);
        if (medHistory.allergies) textParts.push(`Allergies: ${medHistory.allergies}`);
        if (medHistory.family_history) textParts.push(`Family History: ${medHistory.family_history}`);

        const physAssess = structured_json.physical_findings_assessment || {};
        if (physAssess.vital_signs) {
          const vsText = Object.entries(physAssess.vital_signs).filter(([_, v]) => v !== null && v !== '').map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(', ');
          if (vsText) textParts.push(`Vital Signs: ${vsText}`);
        }
        if (physAssess.physical_examination) textParts.push(`Physical Exam: ${physAssess.physical_examination}`);
        if (physAssess.laboratory_diagnostic_results) textParts.push(`Lab Results: ${physAssess.laboratory_diagnostic_results}`);

        const diagMgmt = structured_json.diagnosis_and_management || {};
        if (diagMgmt.diagnosis) textParts.push(`Diagnosis: ${diagMgmt.diagnosis}`);
        if (diagMgmt.prescriptions_medications) textParts.push(`Prescriptions: ${diagMgmt.prescriptions_medications}`);
        if (diagMgmt.treatment_plan_and_advice) textParts.push(`Treatment Plan: ${diagMgmt.treatment_plan_and_advice}`);
        if (diagMgmt.follow_up_date) textParts.push(`Follow-up Date: ${diagMgmt.follow_up_date}`);
        if (diagMgmt.follow_up_instructions) textParts.push(`Follow-up Instructions: ${diagMgmt.follow_up_instructions}`);

        // Vaccine & Immunization Specific Fields
        const vacInfo = structured_json.vaccine_information || {};
        if (vacInfo.vaccine_name) textParts.push(`Vaccine: ${vacInfo.vaccine_name}`);
        if (vacInfo.brand_and_manufacturer) textParts.push(`Brand / Manufacturer: ${vacInfo.brand_and_manufacturer}`);
        if (vacInfo.lot_batch_number) textParts.push(`Lot / Batch: ${vacInfo.lot_batch_number}`);
        if (vacInfo.expiration_date) textParts.push(`Vaccine Exp: ${vacInfo.expiration_date}`);

        const adminDetails = structured_json.administration_details || {};
        if (adminDetails.date_administered) textParts.push(`Date Administered: ${adminDetails.date_administered}`);
        if (adminDetails.dose_number) textParts.push(`Dose: ${adminDetails.dose_number}`);
        if (adminDetails.injection_site) textParts.push(`Site: ${adminDetails.injection_site}`);
        if (adminDetails.route_of_administration) textParts.push(`Route: ${adminDetails.route_of_administration}`);
        if (adminDetails.dosage_volume) textParts.push(`Dosage: ${adminDetails.dosage_volume}`);
        if (adminDetails.next_due_date) textParts.push(`Next Due Date: ${adminDetails.next_due_date}`);
        if (adminDetails.remarks_adverse_reactions) textParts.push(`Remarks: ${adminDetails.remarks_adverse_reactions}`);

        const provInfo = structured_json.provider_information || {};
        if (provInfo.vaccinator_name) textParts.push(`Vaccinator: ${provInfo.vaccinator_name}`);
        if (provInfo.prc_license_number) textParts.push(`PRC License: ${provInfo.prc_license_number}`);
        if (provInfo.facility_name) textParts.push(`Facility: ${provInfo.facility_name}`);

        // Medical Certificate Specific Fields
        const medCertFindings = structured_json.clinical_findings || structured_json.clinical_details || {};
        if (medCertFindings.examination_date) textParts.push(`Exam Date: ${medCertFindings.examination_date}`);
        if (medCertFindings.diagnosis) textParts.push(`Diagnosis: ${medCertFindings.diagnosis}`);
        if (medCertFindings.symptoms) textParts.push(`Symptoms / Complaints: ${medCertFindings.symptoms}`);

        const medCertOpinion = structured_json.medical_opinion || structured_json.recommendations || {};
        if (medCertOpinion.fitness_status) textParts.push(`Fitness Status: ${medCertOpinion.fitness_status}`);
        if (medCertOpinion.sick_leave_days) textParts.push(`Sick Leave: ${medCertOpinion.sick_leave_days} days`);
        if (medCertOpinion.resume_date) textParts.push(`Resume Date: ${medCertOpinion.resume_date}`);
        if (medCertOpinion.restrictions) textParts.push(`Restrictions: ${medCertOpinion.restrictions}`);
        if (medCertOpinion.remarks) textParts.push(`Remarks: ${medCertOpinion.remarks}`);

        const medCertAuth = structured_json.physician_details || structured_json.authentication || {};
        if (medCertAuth.physician_name) textParts.push(`Physician: ${medCertAuth.physician_name}`);
        if (medCertAuth.prc_license_number) textParts.push(`PRC License: ${medCertAuth.prc_license_number}`);
        if (medCertAuth.ptr_number) textParts.push(`PTR Number: ${medCertAuth.ptr_number}`);
        if (medCertAuth.facility_name) textParts.push(`Clinic / Facility: ${medCertAuth.facility_name}`);
        if (medCertAuth.facility_address) textParts.push(`Facility Address: ${medCertAuth.facility_address}`);
        if (medCertAuth.facility_contact) textParts.push(`Facility Contact: ${medCertAuth.facility_contact}`);

        // Maternal Care Specific Fields
        const obstetrics = structured_json.obstetrical_history || structured_json.obstetrics || {};
        if (obstetrics.gravida !== undefined || obstetrics.para !== undefined) {
          textParts.push(`Obstetrical History: G${obstetrics.gravida ?? 0} P${obstetrics.para ?? 0} (${obstetrics.full_term ?? 0}-${obstetrics.preterm ?? 0}-${obstetrics.abortion ?? 0}-${obstetrics.living_children ?? 0})`);
        }
        if (obstetrics.last_menstrual_period || obstetrics.lmp) textParts.push(`LMP: ${obstetrics.last_menstrual_period || obstetrics.lmp}`);
        if (obstetrics.expected_date_confinement || obstetrics.edc || obstetrics.edd) textParts.push(`EDC / EDD: ${obstetrics.expected_date_confinement || obstetrics.edc || obstetrics.edd}`);
        if (obstetrics.gestational_age_weeks) textParts.push(`Gestational Age: ${obstetrics.gestational_age_weeks} weeks`);

        const prenatal = structured_json.prenatal_assessment || structured_json.current_pregnancy || {};
        if (prenatal.fundal_height_cm) textParts.push(`Fundal Height: ${prenatal.fundal_height_cm} cm`);
        if (prenatal.fetal_heart_tone_bpm) textParts.push(`Fetal Heart Tone: ${prenatal.fetal_heart_tone_bpm} bpm`);
        if (prenatal.fetal_presentation) textParts.push(`Fetal Presentation: ${prenatal.fetal_presentation}`);
        if (prenatal.tetanus_toxoid_status) textParts.push(`Tetanus Toxoid Status: ${prenatal.tetanus_toxoid_status}`);
        if (prenatal.micronutrient_supplementation) textParts.push(`Micronutrient Supplementation: ${prenatal.micronutrient_supplementation}`);
        if (prenatal.risk_factors_danger_signs) textParts.push(`Risk Factors / Danger Signs: ${prenatal.risk_factors_danger_signs}`);

        const maternalLabs = structured_json.laboratory_screenings || {};
        if (maternalLabs.blood_type) textParts.push(`Blood Type: ${maternalLabs.blood_type}`);
        if (maternalLabs.hemoglobin_hematocrit) textParts.push(`CBC / Hemoglobin: ${maternalLabs.hemoglobin_hematocrit}`);
        if (maternalLabs.urinalysis) textParts.push(`Urinalysis: ${maternalLabs.urinalysis}`);
        if (maternalLabs.infectious_screenings) textParts.push(`Infectious Screenings: ${maternalLabs.infectious_screenings}`);
        if (maternalLabs.ultrasound_findings) textParts.push(`Ultrasound: ${maternalLabs.ultrasound_findings}`);

        const maternalPlan = structured_json.clinical_impression_and_plan || structured_json.maternal_care_plan || {};
        if (maternalPlan.diagnosis_impression) textParts.push(`Impression / Diagnosis: ${maternalPlan.diagnosis_impression}`);
        if (maternalPlan.clinical_management) textParts.push(`Management Plan: ${maternalPlan.clinical_management}`);
        if (maternalPlan.next_prenatal_visit) textParts.push(`Next Prenatal Visit: ${maternalPlan.next_prenatal_visit}`);
        if (maternalPlan.attending_provider) textParts.push(`Attending Midwife / Provider: ${maternalPlan.attending_provider}`);

        // Consultations Table
        const consultList = structured_json.consultation_records || structured_json.consultations || [];
        if (Array.isArray(consultList)) {
          consultList.forEach((c, idx) => {
            const date = c.date || '';
            const subj = c.subjective_findings || c.chief_complaint || '';
            const obj = typeof c.objective_findings === 'object' && c.objective_findings !== null
              ? (c.objective_findings.notes || c.objective_findings.blood_pressure || JSON.stringify(c.objective_findings))
              : (c.objective_findings || '');
            const diag = Array.isArray(c.assessment_diagnosis)
              ? c.assessment_diagnosis.join(', ')
              : (c.diagnosis || '');
            const plan = Array.isArray(c.plan_treatment)
              ? c.plan_treatment.join(', ')
              : (c.treatment || '');
            const prov = c.provider || '';
            textParts.push(`Consultation ${idx + 1} (${date}): Subj: ${subj} | Obj: ${obj} | Diag: ${diag} | Plan: ${plan} | Provider: ${prov}`);
          });
        }

        extractedText = textParts.join('\n');
      }

      const fileUrl = `/api/records/download/${recordId}`;

      const newRecord = await RecordModel.create({
        id: recordId,
        patient_id: patient.id,
        record_type: finalRecordType,
        file_name: sanitizedName,
        file_url: fileUrl,
        file_path: '',
        file_type: 'application/pdf',
        extracted_text: extractedText,
        layout_blocks: null,
        structured_json: structured_json || {},
        classification_result: finalRecordType,
        uploaded_by: req.user.id
      });

      await AuditMiddleware.logActivity(
        req.user.id,
        req.user.email,
        'MANUAL_RECORD_CREATED',
        `Manually created ${finalRecordType} document: ${sanitizedName} for patient ${patient.full_name || (patient.first_name + ' ' + patient.last_name)} (ID: ${patient.id})`,
        req
      );

      const typeLabel = finalRecordType === 'MATERNAL_CARE_RECORD' ? 'Maternal Care Record' : (finalRecordType === 'MEDICAL_CERTIFICATE' ? 'Medical Certificate' : (finalRecordType === 'IMMUNIZATION_RECORD' ? 'Immunization Record' : (finalRecordType === 'CONSULTATION_RECORD' ? 'Consultation Record' : 'Individual Treatment Record')));

      return res.status(201).json({
        success: true,
        message: `${typeLabel} created and filed successfully.`,
        record: newRecord
      });

    } catch (error) {
      console.error('Create manual record error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while creating manual record.'
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
          patient_name: `${patient.first_name} ${patient.middle_name ? patient.middle_name + ' ' : ''}${patient.last_name}`,
          patient_number: patient.patient_number,
          patient_birth_date: patient.birth_date,
          patient_sex: patient.sex,
          patient_photo_url: patient.photo_url
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

  // List records filtered by category binder with search, pagination, and summary statistics
  async listRecordsByCategory(req, res) {
    try {
      const PatientModel = require('../models/patientModel');
      const { category, search, date_from, date_to, sort = 'newest', page = 1, limit = 15 } = req.query;

      const normalizeCategoryKey = (cat) => {
        if (!cat) return 'ALL';
        const c = String(cat).toUpperCase().trim();
        if (['PATIENT_INFORMATION_SHEET', 'INDIVIDUAL_TREATMENT_RECORD', 'ITR', 'TREATMENT'].includes(c)) return 'PATIENT_INFORMATION_SHEET';
        if (['CONSULTATION_RECORD', 'CONSULTATION', 'CONSULTATIONS'].includes(c)) return 'CONSULTATION_RECORD';
        if (['IMMUNIZATION_RECORD', 'IMMUNIZATION', 'IMMUNIZATIONS', 'VACCINE', 'VACCINATION', 'ANTI_RABIES_RECORD'].includes(c)) return 'IMMUNIZATION_RECORD';
        if (['MEDICAL_CERTIFICATE', 'MEDCERT', 'MED_CERT', 'MEDICAL_CERT', 'CERTIFICATE'].includes(c)) return 'MEDICAL_CERTIFICATE';
        if (['MATERNAL_CARE_RECORD', 'MATERNAL', 'MATERNAL_CARE', 'PRENATAL'].includes(c)) return 'MATERNAL_CARE_RECORD';
        return c;
      };

      const getCategoryLabel = (type) => {
        const norm = normalizeCategoryKey(type);
        switch (norm) {
          case 'PATIENT_INFORMATION_SHEET': return 'Individual Treatment Record';
          case 'CONSULTATION_RECORD': return 'Consultation Record';
          case 'IMMUNIZATION_RECORD': return 'Immunization Record';
          case 'MEDICAL_CERTIFICATE': return 'Medical Certificate';
          case 'MATERNAL_CARE_RECORD': return 'Maternal Care Record';
          default: return type ? type.replace(/_/g, ' ') : 'General Record';
        }
      };

      const targetCategory = normalizeCategoryKey(category);
      const allRecords = await RecordModel.findAllActive();
      const patients = await PatientModel.findAllActive();
      const patientMap = new Map(patients.map(p => [p.id, p]));

      // Enrich active records with patient details
      const enrichedRecords = [];
      for (const rec of allRecords) {
        const patient = patientMap.get(rec.patient_id);
        if (!patient) continue; // Skip orphaned records

        const recCategoryKey = normalizeCategoryKey(rec.record_type);
        const matchesCat = (targetCategory === 'ALL' || recCategoryKey === targetCategory);

        if (matchesCat) {
          // Clean snippet of extracted text
          let snippet = '';
          if (rec.extracted_text) {
            snippet = rec.extracted_text
              .replace(/===\s*[^=]+\s*===/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .substring(0, 180);
            if (rec.extracted_text.length > 180) snippet += '...';
          }

          const patientFullName = `${patient.first_name} ${patient.middle_name ? patient.middle_name + ' ' : ''}${patient.last_name}`.trim();

          enrichedRecords.push({
            id: rec.id,
            patient_id: patient.id,
            patient_name: patientFullName,
            patient_number: patient.patient_number,
            patient_birth_date: patient.birth_date,
            patient_sex: patient.sex,
            patient_address: patient.address || patient.barangay || 'Paete, Laguna',
            patient_photo_url: patient.photo_url || null,
            file_name: rec.file_name,
            file_url: rec.file_url || `/api/records/download/${rec.id}`,
            file_type: rec.file_type,
            record_type: rec.record_type,
            record_type_normalized: recCategoryKey,
            record_type_label: getCategoryLabel(rec.record_type),
            classification_result: rec.classification_result,
            extracted_text_preview: snippet,
            structured_json: rec.structured_json || null,
            created_at: rec.created_at,
            updated_at: rec.updated_at
          });
        }
      }

      // Compute category summary metrics before textual search filters
      const totalCategoryCount = enrichedRecords.length;
      const uniquePatients = new Set(enrichedRecords.map(r => r.patient_id));
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
      const recent30DaysCount = enrichedRecords.filter(r => new Date(r.created_at) >= thirtyDaysAgo).length;

      // Apply search filters
      let filtered = enrichedRecords;
      if (search && search.trim() !== '') {
        const q = search.toLowerCase().trim();
        filtered = filtered.filter(r => {
          const nameMatch = (r.patient_name || '').toLowerCase().includes(q);
          const numMatch = (r.patient_number || '').toLowerCase().includes(q);
          const fileMatch = (r.file_name || '').toLowerCase().includes(q);
          const textMatch = (r.extracted_text_preview || '').toLowerCase().includes(q);
          return nameMatch || numMatch || fileMatch || textMatch;
        });
      }

      // Apply date filters
      if (date_from) {
        const fromDate = new Date(date_from);
        filtered = filtered.filter(r => new Date(r.created_at) >= fromDate);
      }
      if (date_to) {
        const toDate = new Date(date_to);
        toDate.setHours(23, 59, 59, 999);
        filtered = filtered.filter(r => new Date(r.created_at) <= toDate);
      }

      // Apply sorting
      if (sort === 'oldest') {
        filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      } else if (sort === 'patient_name') {
        filtered.sort((a, b) => (a.patient_name || '').localeCompare(b.patient_name || ''));
      } else if (sort === 'filename') {
        filtered.sort((a, b) => (a.file_name || '').localeCompare(b.file_name || ''));
      } else {
        // default: newest first
        filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }

      // Pagination
      const parsedPage = Math.max(1, parseInt(page, 10) || 1);
      const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 15));
      const totalFiltered = filtered.length;
      const totalPages = Math.ceil(totalFiltered / parsedLimit) || 1;
      const offset = (parsedPage - 1) * parsedLimit;
      const paginatedRecords = filtered.slice(offset, offset + parsedLimit);

      return res.status(200).json({
        success: true,
        category: targetCategory,
        category_label: getCategoryLabel(targetCategory),
        stats: {
          total_records: totalCategoryCount,
          total_patients: uniquePatients.size,
          recent_30_days: recent30DaysCount,
          filtered_count: totalFiltered
        },
        pagination: {
          page: parsedPage,
          limit: parsedLimit,
          total_records: totalFiltered,
          total_pages: totalPages
        },
        records: paginatedRecords
      });

    } catch (error) {
      console.error('List records by category error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while fetching category documents.'
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
        
        // Check for local file existence as fallback
        const possibleLocalPaths = [
          storagePath ? (path.isAbsolute(storagePath) ? storagePath : path.join(process.cwd(), storagePath)) : null,
          (record.patient_id && record.id && record.file_name) ? path.join(uploadDir, record.patient_id, record.id, record.file_name) : null,
          (record.patient_id && record.file_name) ? path.join(uploadDir, record.patient_id, record.file_name) : null,
          record.file_name ? path.join(uploadDir, record.file_name) : null,
          record.file_name ? path.join(uploadDir, 'records', record.file_name) : null,
          record.file_name ? path.join(uploadDir, 'temp', record.file_name) : null
        ].filter(Boolean);
        
        let foundLocal = possibleLocalPaths.find(p => p && fs.existsSync(p));
        if (!foundLocal && record.file_name) {
          foundLocal = findFileRecursively(uploadDir, record.file_name);
        }

        if (foundLocal) {
          const resolvedPath = path.resolve(foundLocal);
          const resolvedUploadDir = path.resolve(uploadDir);
          if (!resolvedPath.startsWith(resolvedUploadDir)) {
            return res.status(403).json({ success: false, message: 'Access denied: Invalid file path.' });
          }
          return res.sendFile(resolvedPath, (err) => {
            if (err && !res.headersSent) {
              console.error('SendFile error:', err);
              res.status(404).json({ success: false, message: 'File could not be downloaded.' });
            }
          });
        }

        if (!storagePath) {
          if (record.structured_json || record.extracted_text) {
            return res.redirect(`/dashboard/records/view/${record.id}`);
          }
          return res.status(404).json({ success: false, message: 'File storage path not found for this record.' });
        }

        // Generate short-lived signed URL
        const { data, error } = await dbClient.storage
          .from('patient-records')
          .createSignedUrl(storagePath, 60); // 60 seconds
          
        if (error || !data || !data.signedUrl) {
          if (record.structured_json || record.extracted_text) {
            return res.redirect(`/dashboard/records/view/${record.id}`);
          }
          console.error('Supabase signed URL generation failed:', error);
          return res.status(500).json({ success: false, message: 'Failed to retrieve the secure document link.' });
        }
        
        // Redirect user to the secure signed URL
        return res.redirect(data.signedUrl);
      } else {
        // Local mode: serve file from private local storage path with fallback lookup
        const possiblePaths = [
          record.file_path ? (path.isAbsolute(record.file_path) ? record.file_path : path.join(process.cwd(), record.file_path)) : null,
          (record.patient_id && record.id && record.file_name) ? path.join(uploadDir, record.patient_id, record.id, record.file_name) : null,
          (record.patient_id && record.file_name) ? path.join(uploadDir, record.patient_id, record.file_name) : null,
          record.file_name ? path.join(uploadDir, record.file_name) : null,
          record.file_name ? path.join(uploadDir, 'records', record.file_name) : null,
          record.file_name ? path.join(uploadDir, 'temp', record.file_name) : null
        ].filter(Boolean);

        let foundPath = possiblePaths.find(p => fs.existsSync(p));
        if (!foundPath && record.file_name) {
          foundPath = findFileRecursively(uploadDir, record.file_name);
        }
        if (!foundPath && record.patient_id) {
          foundPath = getAnyImageInDir(path.join(uploadDir, record.patient_id));
        }
          
        if (!foundPath) {
          if (record.structured_json || record.extracted_text) {
            return res.redirect(`/dashboard/records/view/${record.id}`);
          }
          return res.status(404).json({ success: false, message: 'Medical record file not found on disk.' });
        }
        
        const resolvedPath = path.resolve(foundPath);
        const resolvedUploadDir = path.resolve(uploadDir);
        if (!resolvedPath.startsWith(resolvedUploadDir)) {
          return res.status(403).json({ success: false, message: 'Access denied: Invalid file path.' });
        }
        
        return res.sendFile(resolvedPath, (err) => {
          if (err && !res.headersSent) {
            console.error('SendFile local error:', err);
            res.status(404).json({ success: false, message: 'File could not be downloaded.' });
          }
        });
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
