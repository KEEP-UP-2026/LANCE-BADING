const fs = require('fs');
const path = require('path');
const multer = require('multer');
const PatientModel = require('../models/patientModel');
const DuplicateModel = require('../models/duplicateModel');
const AuditMiddleware = require('../middleware/auditMiddleware');
const { FuzzyMatcher } = require('../utils/fuzzyMatcher');

// Configure Avatar upload storage
const avatarUploadDir = path.join(process.cwd(), 'uploads', 'avatars');
if (!fs.existsSync(avatarUploadDir)) {
  fs.mkdirSync(avatarUploadDir, { recursive: true });
}

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, avatarUploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `avatar_${req.params.id || Date.now()}_${Date.now()}${ext}`);
  }
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (allowed.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPG, PNG, WEBP) are allowed for profile photos.'), false);
    }
  }
}).single('photo');

// Helper to run duplicate checking on a patient object
async function runDuplicateCheck(patient) {
  try {
    // Clear any existing PENDING flags where this patient is involved to avoid duplicate warning rows
    await DuplicateModel.deleteFlagsForPatient(patient.id);

    const activePatients = await PatientModel.findAllActive();
    
    for (const other of activePatients) {
      if (other.id === patient.id) continue;

      const result = FuzzyMatcher.comparePatients(patient, other);
      if (result.isCandidate) {
        // Prevent duplicate flags for the same patient pair
        const pairExists = await DuplicateModel.checkPairExists(patient.id, other.id);
        if (!pairExists) {
          // Save flag to duplicate_flags
          await DuplicateModel.create({
            patient_id: patient.id,
            possible_duplicate_patient_id: other.id,
            reason: result.explanation,
            similarity_score: result.score,
            status: 'PENDING'
          });

          // Log duplicate detection event
          await AuditMiddleware.logActivity(
            null,
            'system@keepup.com',
            'DUPLICATE_CANDIDATE_DETECTED',
            `Possible duplicate detected between ${patient.first_name} ${patient.last_name} and ${other.first_name} ${other.last_name} (Score: ${result.score}%)`,
            null
          );
        }
      }
    }
  } catch (err) {
    console.error('Error running duplicate check:', err);
  }
}

const PatientController = {
  // Fetch all ACTIVE patients
  async listPatients(req, res) {
    try {
      const patients = await PatientModel.findAllActive();
      return res.status(200).json({
        success: true,
        patients
      });
    } catch (error) {
      console.error('List patients error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while retrieving the patient list.'
      });
    }
  },

  // Get details of a single patient by ID
  async getPatient(req, res) {
    try {
      const { id } = req.params;
      const patient = await PatientModel.findById(id);

      if (!patient) {
        return res.status(404).json({
          success: false,
          message: 'Patient profile not found.'
        });
      }

      return res.status(200).json({
        success: true,
        patient
      });
    } catch (error) {
      console.error('Get patient error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while retrieving patient details.'
      });
    }
  },

  // Create a new patient profile (Records Staff only)
  async createPatient(req, res) {
    try {
      const { 
        patient_number,
        first_name, 
        middle_name, 
        last_name, 
        suffix,
        birth_date, 
        sex, 
        civil_status,
        place_of_birth,
        religion,
        nationality,
        house_street_purok,
        barangay,
        city_municipality,
        province,
        address, 
        contact_number, 
        occupation,
        philhealth_number,
        philhealth_category,
        is_4ps_beneficiary,
        emergency_contact_name,
        emergency_relationship,
        emergency_contact_number,
        photo_url
      } = req.body;

      // 1. Validate required fields (First Name, Last Name, Date of Birth, Sex, Contact Number)
      if (!first_name || !first_name.trim()) {
        return res.status(400).json({ success: false, message: 'First name is required.' });
      }
      if (!last_name || !last_name.trim()) {
        return res.status(400).json({ success: false, message: 'Last name is required.' });
      }
      if (!birth_date || !birth_date.trim()) {
        return res.status(400).json({ success: false, message: 'Birth date is required.' });
      }
      if (!sex || !sex.trim()) {
        return res.status(400).json({ success: false, message: 'Sex assignment is required.' });
      }
      if (!contact_number || !contact_number.trim()) {
        return res.status(400).json({ success: false, message: 'Contact number is required.' });
      }

      // Check birth date validity
      const bDate = new Date(birth_date);
      if (isNaN(bDate.getTime())) {
        return res.status(400).json({ success: false, message: 'Please provide a valid birth date.' });
      }

      // Construct formatted full address if granular fields provided
      const constructedAddress = [house_street_purok, barangay, city_municipality, province]
        .filter(Boolean)
        .map(s => s.trim())
        .join(', ');
      
      const fullAddress = constructedAddress || (address ? address.trim() : 'N/A');

      // 2. Generate unique patient_number (0001-YYYY-XXXX) if not supplied
      let patientNumber = patient_number ? patient_number.trim() : '';
      let isUnique = false;
      const year = bDate.getFullYear();

      if (patientNumber) {
        const exists = await PatientModel.checkPatientNumberExists(patientNumber);
        if (exists) patientNumber = ''; // re-generate if collision
      }

      while (!isUnique && !patientNumber) {
        const randomNum = Math.floor(1000 + Math.random() * 9000); // 4 digit random number
        patientNumber = `0001-${year}-${randomNum}`;
        const exists = await PatientModel.checkPatientNumberExists(patientNumber);
        if (!exists) {
          isUnique = true;
        }
      }

      // 3. Save patient information
      const newPatient = await PatientModel.create({
        patient_number: patientNumber,
        first_name: first_name.trim(),
        middle_name: middle_name ? middle_name.trim() : null,
        last_name: last_name.trim(),
        suffix: suffix ? suffix.trim() : null,
        birth_date: birth_date,
        sex: sex.trim(),
        civil_status: civil_status ? civil_status.trim() : null,
        place_of_birth: place_of_birth ? place_of_birth.trim() : null,
        religion: religion ? religion.trim() : null,
        nationality: nationality ? nationality.trim() : 'Filipino',
        house_street_purok: house_street_purok ? house_street_purok.trim() : null,
        barangay: barangay ? barangay.trim() : null,
        city_municipality: city_municipality ? city_municipality.trim() : null,
        province: province ? province.trim() : null,
        address: fullAddress,
        contact_number: contact_number ? contact_number.trim() : null,
        occupation: occupation ? occupation.trim() : null,
        philhealth_number: philhealth_number ? philhealth_number.trim() : null,
        philhealth_category: philhealth_category ? philhealth_category.trim() : null,
        is_4ps_beneficiary: is_4ps_beneficiary ? is_4ps_beneficiary.trim() : 'No',
        emergency_contact_name: emergency_contact_name ? emergency_contact_name.trim() : null,
        emergency_relationship: emergency_relationship ? emergency_relationship.trim() : null,
        emergency_contact_number: emergency_contact_number ? emergency_contact_number.trim() : null,
        photo_url: photo_url ? photo_url.trim() : null,
        created_by: req.user.id
      });

      // 4. Run background duplicate record check
      await runDuplicateCheck(newPatient);

      await AuditMiddleware.logActivity(req.user.id, req.user.email, 'PATIENT_CREATED', `Created patient profile: ${newPatient.first_name} ${newPatient.last_name} (${newPatient.patient_number})`, req);

      return res.status(201).json({
        success: true,
        message: 'Patient record created successfully.',
        patient: newPatient
      });

    } catch (error) {
      console.error('Create patient error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while creating the patient record.'
      });
    }
  },

  // Update existing patient (Records Staff only)
  async updatePatient(req, res) {
    try {
      const { id } = req.params;
      const { 
        first_name, 
        middle_name, 
        last_name, 
        suffix,
        birth_date, 
        sex, 
        civil_status,
        place_of_birth,
        religion,
        nationality,
        house_street_purok,
        barangay,
        city_municipality,
        province,
        address, 
        contact_number, 
        occupation,
        philhealth_number,
        philhealth_category,
        is_4ps_beneficiary,
        emergency_contact_name,
        emergency_relationship,
        emergency_contact_number,
        photo_url
      } = req.body;

      // 1. Verify existence
      const patient = await PatientModel.findById(id);
      if (!patient) {
        return res.status(404).json({ success: false, message: 'Patient profile not found.' });
      }

      // 2. Validate required fields
      if (!first_name || !first_name.trim()) {
        return res.status(400).json({ success: false, message: 'First name is required.' });
      }
      if (!last_name || !last_name.trim()) {
        return res.status(400).json({ success: false, message: 'Last name is required.' });
      }
      if (!birth_date || !birth_date.trim()) {
        return res.status(400).json({ success: false, message: 'Birth date is required.' });
      }
      if (!sex || !sex.trim()) {
        return res.status(400).json({ success: false, message: 'Sex assignment is required.' });
      }
      if (!contact_number || !contact_number.trim()) {
        return res.status(400).json({ success: false, message: 'Contact number is required.' });
      }

      // Check birth date validity
      const bDate = new Date(birth_date);
      if (isNaN(bDate.getTime())) {
        return res.status(400).json({ success: false, message: 'Please provide a valid birth date.' });
      }

      const constructedAddress = [house_street_purok, barangay, city_municipality, province]
        .filter(Boolean)
        .map(s => s.trim())
        .join(', ');
      
      const fullAddress = constructedAddress || (address ? address.trim() : patient.address || 'N/A');

      // 3. Update in database
      const updatedPatient = await PatientModel.update(id, {
        first_name: first_name.trim(),
        middle_name: middle_name ? middle_name.trim() : null,
        last_name: last_name.trim(),
        suffix: suffix ? suffix.trim() : null,
        birth_date: birth_date,
        sex: sex.trim(),
        civil_status: civil_status ? civil_status.trim() : null,
        place_of_birth: place_of_birth ? place_of_birth.trim() : null,
        religion: religion ? religion.trim() : null,
        nationality: nationality ? nationality.trim() : 'Filipino',
        house_street_purok: house_street_purok ? house_street_purok.trim() : null,
        barangay: barangay ? barangay.trim() : null,
        city_municipality: city_municipality ? city_municipality.trim() : null,
        province: province ? province.trim() : null,
        address: fullAddress,
        contact_number: contact_number ? contact_number.trim() : null,
        occupation: occupation ? occupation.trim() : null,
        philhealth_number: philhealth_number ? philhealth_number.trim() : null,
        philhealth_category: philhealth_category ? philhealth_category.trim() : null,
        is_4ps_beneficiary: is_4ps_beneficiary ? is_4ps_beneficiary.trim() : 'No',
        emergency_contact_name: emergency_contact_name ? emergency_contact_name.trim() : null,
        emergency_relationship: emergency_relationship ? emergency_relationship.trim() : null,
        emergency_contact_number: emergency_contact_number ? emergency_contact_number.trim() : null
      });

      // 4. Run background duplicate check on updated patient details
      await runDuplicateCheck(updatedPatient);

      await AuditMiddleware.logActivity(req.user.id, req.user.email, 'PATIENT_UPDATED', `Updated patient profile: ${updatedPatient.first_name} ${updatedPatient.last_name} (${updatedPatient.patient_number})`, req);

      return res.status(200).json({
        success: true,
        message: 'Patient record updated successfully.',
        patient: updatedPatient
      });

    } catch (error) {
      console.error('Update patient error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while updating the patient record.'
      });
    }
  },

  // Archive patient (Records Staff only)
  async archivePatient(req, res) {
    try {
      const { id } = req.params;

      const patient = await PatientModel.findById(id);
      if (!patient) {
        return res.status(404).json({ success: false, message: 'Patient profile not found.' });
      }

      const archivedPatient = await PatientModel.archive(id);

      // Clean up duplicate flags where this patient is involved since they are archived
      await DuplicateModel.deleteFlagsForPatient(id);

      await AuditMiddleware.logActivity(req.user.id, req.user.email, 'PATIENT_ARCHIVED', `Archived patient profile: ${patient.first_name} ${patient.last_name} (${patient.patient_number})`, req);

      return res.status(200).json({
        success: true,
        message: 'Patient record archived successfully.',
        patient: archivedPatient
      });

    } catch (error) {
      console.error('Archive patient error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while archiving the patient record.'
      });
    }
  },

  // Restore patient (Records Staff only)
  async restorePatient(req, res) {
    try {
      const { id } = req.params;

      const patient = await PatientModel.findById(id);
      if (!patient) {
        return res.status(404).json({ success: false, message: 'Patient profile not found.' });
      }

      if (patient.status === 'ACTIVE') {
        return res.status(400).json({ success: false, message: 'Patient profile is already active.' });
      }

      const restoredPatient = await PatientModel.update(id, { status: 'ACTIVE' });

      // Run background duplicate check on restored patient details
      await runDuplicateCheck(restoredPatient);

      await AuditMiddleware.logActivity(
        req.user.id,
        req.user.email,
        'PATIENT_RESTORED',
        `Restored patient profile: ${restoredPatient.first_name} ${restoredPatient.last_name} (${restoredPatient.patient_number})`,
        req
      );

      return res.status(200).json({
        success: true,
        message: 'Patient record restored successfully.',
        patient: restoredPatient
      });

    } catch (error) {
      console.error('Restore patient error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while restoring the patient record.'
      });
    }
  },

  // Permanently delete a patient (Records Staff only)
  async deletePatient(req, res) {
    try {
      const { id } = req.params;

      const patient = await PatientModel.findById(id);
      if (!patient) {
        return res.status(404).json({ success: false, message: 'Patient profile not found.' });
      }

      // Clean up duplicate flags
      await DuplicateModel.deleteFlagsForPatient(id);

      await PatientModel.delete(id);

      await AuditMiddleware.logActivity(
        req.user.id,
        req.user.email,
        'PATIENT_DELETED',
        `Permanently deleted patient profile: ${patient.first_name} ${patient.last_name} (${patient.patient_number})`,
        req
      );

      return res.status(200).json({
        success: true,
        message: `Patient record of "${patient.first_name} ${patient.last_name}" has been permanently deleted.`
      });

    } catch (error) {
      console.error('Delete patient error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while deleting the patient record.'
      });
    }
  },

  // List all ARCHIVED patients
  async listArchivedPatients(req, res) {
    try {
      const archivedPatients = await PatientModel.findAllArchived();
      return res.status(200).json({
        success: true,
        patients: archivedPatients
      });
    } catch (error) {
      console.error('List archived patients error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while fetching archived patients.'
      });
    }
  },

  // Upload patient profile photo
  uploadPhoto(req, res) {
    avatarUpload(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ success: false, message: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Please select an image file to upload.' });
      }

      try {
        const { id } = req.params;
        const patient = await PatientModel.findById(id);
        if (!patient) {
          return res.status(404).json({ success: false, message: 'Patient profile not found.' });
        }

        const photoUrl = `/uploads/avatars/${req.file.filename}`;
        const updated = await PatientModel.update(id, { photo_url: photoUrl });

        await AuditMiddleware.logActivity(
          req.user.id,
          req.user.email,
          'PATIENT_UPDATED',
          `Updated profile picture for patient: ${patient.first_name} ${patient.last_name} (${patient.patient_number})`,
          req
        );

        return res.status(200).json({
          success: true,
          message: 'Profile photo updated successfully.',
          photo_url: photoUrl,
          patient: updated
        });
      } catch (error) {
        console.error('Upload photo error:', error);
        return res.status(500).json({ success: false, message: 'Failed to upload patient profile photo.' });
      }
    });
  }
};

module.exports = PatientController;
