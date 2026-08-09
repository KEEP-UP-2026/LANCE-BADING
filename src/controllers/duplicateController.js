const DuplicateModel = require('../models/duplicateModel');
const PatientModel = require('../models/patientModel');
const RecordModel = require('../models/recordModel');
const AuditMiddleware = require('../middleware/auditMiddleware');

const DuplicateController = {
  // Get all PENDING duplicate flags
  async listPending(req, res) {
    try {
      const flags = await DuplicateModel.findAllPending();
      return res.status(200).json({
        success: true,
        flags
      });
    } catch (error) {
      console.error('List pending duplicate flags error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while retrieving duplicate flags.'
      });
    }
  },

  // Update duplicate flag status (e.g., set status to REVIEWED or IGNORED)
  async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status || !['REVIEWED', 'IGNORED', 'PENDING'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid status: REVIEWED, IGNORED, or PENDING.'
        });
      }

      const updatedFlag = await DuplicateModel.update(id, { status });
      if (!updatedFlag) {
        return res.status(404).json({
          success: false,
          message: 'Duplicate flag not found.'
        });
      }

      // Log duplicate review action
      const actionType = status === 'REVIEWED' ? 'DUPLICATE_REVIEWED' : 'DUPLICATE_IGNORED';
      await AuditMiddleware.logActivity(
        req.user.id,
        req.user.email,
        actionType,
        `Duplicate warning flag ${id} status set to ${status}`,
        req
      );

      return res.status(200).json({
        success: true,
        message: `Duplicate flag status successfully updated to ${status}.`,
        flag: updatedFlag
      });
    } catch (error) {
      console.error('Update duplicate flag status error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while updating duplicate flag.'
      });
    }
  },

  // Merge duplicate profiles side-by-side
  async mergePatients(req, res) {
    try {
      const { id } = req.params; // duplicate flag ID
      const { primary_patient_id, merge_fields } = req.body;

      if (!primary_patient_id) {
        return res.status(400).json({
          success: false,
          message: 'Please specify the primary patient profile ID to merge into.'
        });
      }

      // Fetch duplicate flag details
      const flag = await DuplicateModel.findById(id);
      if (!flag) {
        return res.status(404).json({
          success: false,
          message: 'Duplicate flag not found.'
        });
      }

      if (flag.status === 'MERGED' || flag.status === 'RESOLVED') {
        return res.status(400).json({
          success: false,
          message: 'This duplicate warning has already been resolved or merged.'
        });
      }

      const { patient_id, possible_duplicate_patient_id } = flag;
      
      // Determine secondary profile ID
      let secondary_patient_id = '';
      if (primary_patient_id === patient_id) {
        secondary_patient_id = possible_duplicate_patient_id;
      } else if (primary_patient_id === possible_duplicate_patient_id) {
        secondary_patient_id = patient_id;
      } else {
        return res.status(400).json({
          success: false,
          message: 'The selected primary patient ID does not belong to this duplicate flag pair.'
        });
      }

      if (primary_patient_id === secondary_patient_id) {
        return res.status(400).json({
          success: false,
          message: 'Cannot merge a patient profile into itself.'
        });
      }

      // Fetch patient profiles
      const primaryPatient = await PatientModel.findById(primary_patient_id);
      const secondaryPatient = await PatientModel.findById(secondary_patient_id);

      if (!primaryPatient || !secondaryPatient) {
        return res.status(404).json({
          success: false,
          message: 'One or both patient profiles not found.'
        });
      }

      if (primaryPatient.status === 'ARCHIVED' || secondaryPatient.status === 'ARCHIVED') {
        return res.status(400).json({
          success: false,
          message: 'Cannot merge profiles that are already archived.'
        });
      }

      // Update demographic info on primary patient if merge_fields are specified manually
      const updates = {};
      if (merge_fields) {
        const allowedFields = ['middle_name', 'contact_number', 'philhealth_number', 'address', 'sex'];
        for (const field of allowedFields) {
          if (merge_fields[field] !== undefined) {
            updates[field] = merge_fields[field];
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        await PatientModel.update(primary_patient_id, updates);
      }

      // Move patient records to primary profile
      await RecordModel.reassignPatientRecords(secondary_patient_id, primary_patient_id);

      // Archive secondary duplicate patient
      await PatientModel.archive(secondary_patient_id);

      // Resolve all duplicate flags involving the archived patient
      await DuplicateModel.updateFlagsStatusForPatient(secondary_patient_id, 'MERGED');

      // Update current flag
      await DuplicateModel.update(id, { status: 'MERGED' });

      // Log duplicate resolved / merged audit event
      await AuditMiddleware.logActivity(
        req.user.id,
        req.user.email,
        'DUPLICATE_MERGED',
        `Merged duplicate patient profile ${secondaryPatient.first_name} ${secondaryPatient.last_name} (${secondary_patient_id}) into primary ${primaryPatient.first_name} ${primaryPatient.last_name} (${primary_patient_id})`,
        req
      );

      return res.status(200).json({
        success: true,
        message: 'Patient profiles merged successfully. Secondary profile archived, and all records reassigned.'
      });

    } catch (error) {
      console.error('Merge duplicates error:', error);
      return res.status(500).json({
        success: false,
        message: 'An internal server error occurred while merging profiles.'
      });
    }
  }
};

module.exports = DuplicateController;
