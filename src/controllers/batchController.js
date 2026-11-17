const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const BatchModel = require('../models/batchModel');
const RecordModel = require('../models/recordModel');
const PatientModel = require('../models/patientModel');
const AuditMiddleware = require('../middleware/auditMiddleware');
const PDFProcessor = require('../utils/pdfProcessor');
const Classifier = require('../utils/classifier');
const FuzzyMatcher = require('../utils/fuzzyMatcher');
const { dbClient, isSupabase } = require('../config/db');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveUserUuid(user) {
  if (!user) return null;
  if (user.id && UUID_REGEX.test(user.id)) return user.id;
  if (isSupabase && user.email) {
    try {
      const { data } = await dbClient.from('users').select('id').eq('email', user.email.toLowerCase()).maybeSingle();
      if (data && data.id && UUID_REGEX.test(data.id)) return data.id;
    } catch (_) {}
  }
  return null;
}

function toValidUuidOrNull(val) {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim();
  return UUID_REGEX.test(trimmed) ? trimmed : null;
}

// Ensure base upload folders exist
const uploadDir = path.join(process.cwd(), 'uploads');
const uploadTempDir = path.join(uploadDir, 'temp');
const uploadBatchDir = path.join(uploadTempDir, 'batch');

[uploadDir, uploadTempDir, uploadBatchDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure Multer for Batch Upload (up to 25 documents)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadBatchDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `batch_${unique}_${safeName}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB max per file
    files: 25 // Maximum 25 documents per batch
  },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.png', '.jpg', '.jpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File format ${ext} not supported. Allowed: PDF, PNG, JPG.`), false);
    }
  }
}).array('documents', 25);

// Helper: Magic byte file signature validator
function verifyFileSignature(filePath, originalname) {
  try {
    const ext = path.extname(originalname).toLowerCase();
    const buffer = Buffer.alloc(8);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, 8, 0);
    fs.closeSync(fd);

    const hex = buffer.toString('hex').toLowerCase();
    if (ext === '.png') return hex.startsWith('89504e470d0a1a0a');
    if (ext === '.jpg' || ext === '.jpeg') return hex.startsWith('ffd8ff');
    if (ext === '.pdf') return hex.startsWith('25504446');
    return false;
  } catch (err) {
    return false;
  }
}

// Helper: Extract structured fields from OCR text based on category
function extractStructuredData(rawText, category, ocrResult = {}) {
  const data = {};
  const text = rawText || '';

  // If OCR provided rabies_data, unpack it
  const rd = ocrResult.rabies_data || (ocrResult.doc_type === 'RABIES_PEP' ? ocrResult.itr_data : null);

  // Generic extraction for common demographic fields
  const nameMatch = text.match(/(?:NAME|Patient Name|Child Name|Mother Name|Pangalan|Pangalan ng Pasyente)\s*[:\-]?\s*([A-Za-z\s,\.]+)/i);
  if (nameMatch && nameMatch[1]) {
    data.patient_name = nameMatch[1].trim().split('\n')[0].substring(0, 80);
    // Strip trailing labels if merged on same line by OCR
    data.patient_name = data.patient_name.replace(/\b(?:Age|Edad|Sex|Kasarian|Birthdate|DOB|Address|Tirahan|Civil|CP)\b.*$/i, '').trim();
  }
  if (rd?.patient_demographics?.name && (!data.patient_name || data.patient_name.length < 3)) {
    data.patient_name = rd.patient_demographics.name;
  }

  const dobMatch = text.match(/(?:Kapanganakan|Birthdate|Date of Birth|DOB|Bday|BIRTHDAY)\s*[:\-]?\s*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4}|[A-Za-z]+ \d{1,2},? \d{4})/i);
  if (dobMatch && dobMatch[1]) {
    data.birth_date = dobMatch[1].trim();
  }

  const ageMatch = text.match(/(?:Edad|Age)\s*[:\-]?\s*(\d{1,3})/i);
  if (ageMatch && ageMatch[1]) {
    data.age = parseInt(ageMatch[1], 10);
  } else if (rd?.patient_demographics?.age) {
    data.age = rd.patient_demographics.age;
  }

  const sexMatch = text.match(/(?:Kasarian|Sex|Gender)\s*[:\-]?\s*(Male|Female|M|F|Lalaki|Babae)/i);
  if (sexMatch && sexMatch[1]) {
    const s = sexMatch[1].toUpperCase();
    data.sex = (s === 'M' || s === 'MALE' || s.startsWith('LAL')) ? 'Male' : 'Female';
  } else if (rd?.patient_demographics?.sex) {
    data.sex = rd.patient_demographics.sex.toUpperCase().startsWith('F') ? 'Female' : 'Male';
  }

  const addressMatch = text.match(/(?:Tirahan|Address|Barangay|Brgy|ADDRESS)\s*[:\-]?\s*([A-Za-z0-9\s,\.]+)/i);
  if (addressMatch && addressMatch[1]) {
    data.address = addressMatch[1].trim().split('\n')[0].substring(0, 120);
    data.address = data.address.replace(/\b(?:Sex|Kasarian|Age|Edad|Contact|Civil|CP)\b.*$/i, '').trim();
  } else if (rd?.patient_demographics?.address) {
    data.address = rd.patient_demographics.address;
  }

  const philhealthMatch = text.match(/(?:Philhealth No\.|Philhealth ID Number|PhilHealth|PIN)\s*[:\-]?\s*([0-9\-]+)/i);
  if (philhealthMatch && philhealthMatch[1]) {
    data.philhealth_number = philhealthMatch[1].trim();
  }

  const occMatch = text.match(/(?:Occupation|Trabaho)\s*[:\-]?\s*([^\n\r\|]+)/i);
  if (occMatch && occMatch[1]) {
    data.occupation = occMatch[1].trim();
  }

  const contactMatch = text.match(/(?:Contact No\.|CP No\.|Contact|Mobile)\s*[:\-]?\s*([0-9\-\+]+)/i);
  if (contactMatch && contactMatch[1]) {
    data.contact_number = contactMatch[1].trim();
  }

  const civilMatch = text.match(/(?:Civil Status|Katayuan)\s*[:\-]?\s*([A-Za-z]+)/i);
  if (civilMatch && civilMatch[1]) {
    data.civil_status = civilMatch[1].trim();
  }

  // Category specific parsing aligned with reference_documents/
  if (category === 'CONSULTATION_RECORD') {
    const complaintMatch = text.match(/(?:Chief Complaint|Reklamo|Dahilan|S\/S|Subjective)\s*[:\-]?\s*([^\n\r]+)/i);
    if (complaintMatch) data.chief_complaint = complaintMatch[1].trim();

    const hpiMatch = text.match(/(?:History of Present Illness|HPI)\s*[:\-]?\s*([^\n\r]+)/i);
    if (hpiMatch) data.history_present_illness = hpiMatch[1].trim();

    const diagnosisMatch = text.match(/(?:Assessment\s*(?:\/\s*Diagnosis)?|Diagnosis)\s*:\s*([^\n\r]+)/i);
    if (diagnosisMatch && !diagnosisMatch[1].includes('===')) {
      data.diagnosis = diagnosisMatch[1].trim();
    } else {
      const fallbackDx = text.match(/(?:Assessment|Impression|Dx)\s*[:\-]?\s*([^\n\r]+)/i);
      if (fallbackDx && !fallbackDx[1].includes('===')) data.diagnosis = fallbackDx[1].trim();
    }

    const treatmentMatch = text.match(/(?:Prescription & Treatment Plan|Treatment Plan|Plan\/Treatment Plan|Treatment \/ Management|Gamot|Rx)\s*[:\-]?([\s\S]*?)(?:===|\d+\. FOLLOW-UP|$)/i);
    if (treatmentMatch) {
      data.treatment = treatmentMatch[1].trim().replace(/^\s*-\s*/gm, '').split('\n').map(x => x.trim()).filter(Boolean).join('; ');
    }

    const bpMatch = text.match(/(?:BP|Blood Pressure)\s*[:\-]?\s*(\d{2,3}\/\d{2,3})/i);
    if (bpMatch) data.blood_pressure = bpMatch[1].trim();

    const prMatch = text.match(/(?:PR|Pulse Rate|Pulse)\s*[:\-]?\s*(\d{2,3})/i);
    if (prMatch) data.pulse_rate = prMatch[1].trim();

    const rrMatch = text.match(/(?:RR|Respiratory Rate)\s*[:\-]?\s*(\d{1,3})/i);
    if (rrMatch) data.respiratory_rate = rrMatch[1].trim();

    const tempMatch = text.match(/(?:Temp|Temperature)\s*[:\-]?\s*(\d{2}(?:\.\d)?)/i);
    if (tempMatch) data.temperature = tempMatch[1].trim();

    const htMatch = text.match(/(?:Height|Ht)\s*[:\-]?\s*(\d{2,3}(?:\.\d)?)/i);
    if (htMatch) data.height_cm = htMatch[1].trim();

    const wtMatch = text.match(/(?:Weight|Wt)\s*[:\-]?\s*(\d{2,3}(?:\.\d)?)/i);
    if (wtMatch) data.weight_kg = wtMatch[1].trim();

    const bmiMatch = text.match(/(?:BMI)\s*[:\-]?\s*(\d{1,2}(?:\.\d)?)/i);
    if (bmiMatch) data.bmi = bmiMatch[1].trim();

    const peMatch = text.match(/(?:Physical Examination|PE)\s*[:\-]?\s*([^\n\r]+)/i);
    if (peMatch) data.physical_examination = peMatch[1].trim();

    const allergiesMatch = text.match(/(?:Allergies)\s*[:\-]?\s*(?:None|Specify)?[:\s]*([^\n\r]+)/i);
    if (allergiesMatch && !/none/i.test(allergiesMatch[1])) data.allergies_specify = allergiesMatch[1].trim();

    const chronicMatch = text.match(/(?:Chronic Illness(?:es)?)\s*[:\-]?\s*(?:None|Specify)?[:\s]*([^\n\r]+)/i);
    if (chronicMatch && !/none/i.test(chronicMatch[1])) data.chronic_illness_specify = chronicMatch[1].trim();

    const medMatch = text.match(/(?:Current Medication(?:s)?)\s*[:\-]?\s*(?:None|Specify)?[:\s]*([^\n\r]+)/i);
    if (medMatch && !/none/i.test(medMatch[1])) data.current_meds_specify = medMatch[1].trim();

    const famMatch = text.match(/(?:Family History)\s*[:\-]?\s*(?:None|Specify)?[:\s]*([^\n\r]+)/i);
    if (famMatch && !/none/i.test(famMatch[1])) data.family_history_specify = famMatch[1].trim();

    const retMatch = text.match(/(?:Return on|Follow-up on)\s*[:\-]?\s*([^\n\r]+)/i);
    if (retMatch) data.followup_return_on = retMatch[1].trim();

    const remMatch = text.match(/(?:Remarks \/ Instructions|Instructions)\s*[:\-]?\s*([^\n\r]+)/i);
    if (remMatch) data.followup_remarks = remMatch[1].trim();

    const dateMatch = text.match(/(?:Date of Consultation|Date)\s*[:\-]?\s*([A-Za-z]+ \d{1,2},? \d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    if (dateMatch) data.consultation_date = dateMatch[1].trim();

  } else if (category === 'MEDICAL_CERTIFICATE') {
    const examDateMatch = text.match(/(?:Date of Examination|Examination Date|Date)\s*[:\-]?\s*([A-Za-z]+ \d{1,2},? \d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    if (examDateMatch) {
      data.exam_date = examDateMatch[1].trim();
      data.consultation_date = data.exam_date;
      data.date = data.exam_date;
    }

    const timeMatch = text.match(/(?:Time)\s*[:\-]?\s*([0-9]{1,2}:[0-9]{2}(?:\s*[AP]M)?)/i);
    if (timeMatch) data.exam_time = timeMatch[1].trim();

    const complaintMatch = text.match(/(?:Chief Complaint)\s*[:\-]?\s*([^\n\r]+)/i);
    if (complaintMatch) data.chief_complaint = complaintMatch[1].trim();

    const relHistMatch = text.match(/(?:Relevant History)\s*[:\-]?\s*([^\n\r]+)/i);
    if (relHistMatch) data.relevant_history = relHistMatch[1].trim();

    const peMatch = text.match(/(?:Physical Examination Findings|Physical Examination|PE)\s*[:\-]?\s*([^\n\r]+)/i);
    if (peMatch) data.physical_examination = peMatch[1].trim();

    const bpMatch = text.match(/(?:BP|Blood Pressure)\s*[:\-]?\s*(\d{2,3}\/\d{2,3})/i);
    if (bpMatch) data.blood_pressure = bpMatch[1].trim();

    const prMatch = text.match(/(?:PR|Pulse Rate|Pulse)\s*[:\-]?\s*(\d{2,3})/i);
    if (prMatch) data.pulse_rate = prMatch[1].trim();

    const rrMatch = text.match(/(?:RR|Respiratory Rate)\s*[:\-]?\s*(\d{1,3})/i);
    if (rrMatch) data.respiratory_rate = rrMatch[1].trim();

    const tempMatch = text.match(/(?:Temp|Temperature)\s*[:\-]?\s*(\d{2}(?:\.\d)?)/i);
    if (tempMatch) data.temperature = tempMatch[1].trim();

    const dxMatch = text.match(/(?:DIAGNOSIS\s*(?:\/\s*IMPRESSION)?|Diagnosis|Impression)\s*[:\-]?\s*([^\n\r]+)/i);
    if (dxMatch && !dxMatch[1].includes('===')) data.diagnosis = dxMatch[1].trim();

    data.recommendations_rest = /\[x\]\s*Rest|\bRest\b/i.test(text);
    data.recommendations_medication = /\[x\]\s*Medication|\bMedication\b/i.test(text);
    data.recommendations_further_exam = /\[x\]\s*Further Examination/i.test(text);
    data.recommendations_referral = /\[x\]\s*Referral/i.test(text);
    data.recommendations_other = /\[x\]\s*Other/i.test(text);

    const otherSpecMatch = text.match(/Other\s*\/\s*Specify\s*[:\-]?\s*([^\n\r]+)/i);
    if (otherSpecMatch) data.recommendations_other_specify = otherSpecMatch[1].trim();

    const certMatch = text.match(/(?:7\.\s*MEDICAL CERTIFICATION|MEDICAL CERTIFICATION)\s*[:\-]?([\s\S]*?)(?:8\.\s*REMARKS|REMARKS|$)/i);
    if (certMatch) data.medical_certification = certMatch[1].trim();

    const remMatch = text.match(/(?:8\.\s*REMARKS|REMARKS)\s*[:\-]?\s*([^\n\r]+)/i);
    if (remMatch) data.remarks = remMatch[1].trim();

    const physMatch = text.match(/(?:Attending Physician|Physician|Doctor|MD)\s*[:\-]?\s*([^\n\r]+)/i);
    if (physMatch) data.attending_provider = physMatch[1].trim();

    const licMatch = text.match(/(?:PRC License No|License No|PRC)\s*[:\-]?\s*([0-9A-Za-z\-]+)/i);
    if (licMatch) data.license_no = licMatch[1].trim();

  } else if (category === 'IMMUNIZATION_RECORD' || category === 'CHILDHOOD_IMMUNIZATION') {
    // 1. Exposure details
    const expDate = text.match(/(?:Date of Exposure|Exposure Date|Petsa ng Kagat)\s*[:\-]?\s*([A-Za-z0-9\s,\/\-\.]+)/i);
    data.exposure_date = expDate ? expDate[1].trim().split('\n')[0] : (rd?.rabies_exposure?.date_of_exposure || '');

    const expPlace = text.match(/(?:Place of Exposure|Lugar ng Kagat)\s*[:\-]?\s*([^\n\r]+)/i);
    data.exposure_place = expPlace ? expPlace[1].trim() : (rd?.rabies_exposure?.place_of_exposure || '');

    const animalMatch = text.match(/(?:Source of Exposure)\s*[:\-]?\s*([^\n\r]+)/i) || text.match(/\b(Cat|Dog|Puppy|Kitten|Aso|Pusa)\b/i);
    data.animal_source = animalMatch ? (animalMatch[1] || animalMatch[0]).trim() : (rd?.rabies_exposure?.source_of_exposure || '');

    const catMatch = text.match(/(?:Category of Exposure|Category|Kategorya)\s*[:\-]?\s*(I{1,3}|Category\s*I{1,3})/i);
    if (catMatch) {
      let c = catMatch[1].toUpperCase();
      if (!c.startsWith('CATEGORY')) c = `Category ${c}`;
      data.bite_category = c;
    } else {
      data.bite_category = rd?.rabies_exposure?.category_of_exposure || 'Category III';
    }

    const washMatch = text.match(/Washing\s*of\s*Bite\s*Wound\s*[:\-]?\s*([A-Za-z]+)/i);
    data.washing_wound = washMatch ? washMatch[1].toUpperCase() : (rd?.post_exposure_prophylaxis?.washing_of_bite_wound || 'YES');

    // 2. Vaccine details
    const vaccineMatch = text.match(/Brand name\s*[:\-]?\s*([^\n\r]+)/i) || text.match(/(?:Speeda|PVRV|Rabipur|PCECV|Vero Cell)/i);
    data.vaccine_name = vaccineMatch ? (vaccineMatch[1] || vaccineMatch[0]).trim() : (rd?.post_exposure_prophylaxis?.brand_name || 'Speeda');
    
    const genMatch = text.match(/Generic name\s*[:\-]?\s*([^\n\r]+)/i);
    data.generic_name = genMatch ? genMatch[1].trim().split(/\s+Brand/)[0] : (rd?.post_exposure_prophylaxis?.generic_name || 'PVRV (PCECV)');
    
    const routeMatch = text.match(/Route\s*[:\-]?\s*([A-Za-z]+)/i);
    data.route = routeMatch ? routeMatch[1].trim() : (rd?.post_exposure_prophylaxis?.route || 'ID');

    // 3. Dosing Schedule Dates
    const d0 = text.match(/D0\s*[:\-]?\s*([0-9\/]+)/i);
    const d3 = text.match(/D3\s*[:\-]?\s*([0-9\/]+)/i);
    const d7 = text.match(/D7\s*[:\-]?\s*([0-9\/]+)/i);

    data.d0_date = d0 ? d0[1].trim() : (rd?.pep_schedule?.d0?.date || '');
    data.d3_date = d3 ? d3[1].trim() : (rd?.pep_schedule?.d3?.date || '');
    data.d7_date = d7 ? d7[1].trim() : (rd?.pep_schedule?.d7?.date || '');
    data.d14_date = rd?.pep_schedule?.d14?.date || '';
    data.d28_date = rd?.pep_schedule?.d28_30?.date || '';

    // Dosing schedule summary
    const schedParts = [];
    if (data.d0_date) schedParts.push(`D0: ${data.d0_date}`);
    if (data.d3_date) schedParts.push(`D3: ${data.d3_date}`);
    if (data.d7_date) schedParts.push(`D7: ${data.d7_date}`);
    data.dose_schedule = schedParts.length > 0 ? schedParts.join(' | ') : 'Day 0 Administered';

    // Animal status & remarks
    data.animal_status = rd?.animal_observation?.status_14_days || (/dead|patay/i.test(text) ? 'Dead' : 'Alive & Healthy');
    data.remarks = rd?.animal_observation?.remarks || '';
    data.exposure_details = `${data.animal_source || 'Animal'} Exposure at ${data.exposure_place || 'Paete'} (${data.bite_category})`;

  } else if (category === 'CHILDHOOD_IMMUNIZATION' || category === 'IMMUNIZATION_RECORD') {
    const motherMatch = text.match(/Mother Name\s*[:\-]?\s*([^\n\r\|]+)/i);
    if (motherMatch) data.mother_name = motherMatch[1].trim();

    const vaxLines = [];
    const vaxRegex = /(BCG Vaccine|Hepatitis B|Penta \d|OPV \d|PCV \d|Measles \/ MMR \d)\s*[:\-]?\s*([^\n\r]+)/gi;
    let vm;
    while ((vm = vaxRegex.exec(text)) !== null) {
      vaxLines.push(`${vm[1]}: ${vm[2].trim()}`);
    }
    data.vaccine_log = vaxLines.join('\n');
    data.vaccine_name = vaxLines[0] || 'Childhood Routine Vaccine';
    data.dose_number = 'Routine Schedule';
    data.admin_date = new Date().toISOString().split('T')[0];

    const screenFever = text.match(/With fever today\?[:\s]*(Yes|No)/i);
    if (screenFever) data.screen_fever = screenFever[1];

    const screenRem = text.match(/Specify \/ Remarks\s*[:\-]?\s*([^\n\r]+)/i);
    if (screenRem) data.screening_remarks = screenRem[1].trim();

    const nextDate = text.match(/Next Immunization Date\s*[:\-]?\s*([^\n\r]+)/i);
    if (nextDate) data.next_immunization_date = nextDate[1].trim();

    const dueMatch = text.match(/Vaccine\/s Due\s*[:\-]?\s*([^\n\r]+)/i);
    if (dueMatch) data.vaccines_due = dueMatch[1].trim();

    const remNotes = text.match(/Remarks \/ Notes\s*[:\-]?\s*([^\n\r]+)/i);
    if (remNotes) data.remarks_notes = remNotes[1].trim();

  } else if (category === 'MATERNAL_CARE_RECORD' || category === 'MATERNAL_CARE') {
    const gpMatch = text.match(/(?:G|Gravida)\s*[:\-]?\s*(G?\d+)\s*\|?\s*(?:P|Para)\s*[:\-]?\s*(P?\d+[^\n\r\|]*)/i);
    if (gpMatch) {
      data.gravida = gpMatch[1].trim();
      data.para = gpMatch[2].trim();
    } else {
      const gMatch = text.match(/Gravida\s*[:\-]?\s*(G?\d+)/i);
      if (gMatch) data.gravida = gMatch[1].trim();
      const pMatch = text.match(/Para\s*[:\-]?\s*(P?\d+[^\n\r\|]*)/i);
      if (pMatch) data.para = pMatch[1].trim();
    }

    const aMatch = text.match(/(?:Abortion|Abortion \(A\)|A)\s*[:\-]?\s*(A?\d+)/i);
    if (aMatch) data.abortion = aMatch[1].trim();

    const lMatch = text.match(/(?:Living Children|Living Children \(L\)|L)\s*[:\-]?\s*(L?\d+)/i);
    if (lMatch) data.living_children = lMatch[1].trim();

    const lmpMatch = text.match(/LMP\s*[:\-]?\s*([^\n\r\|]+)/i);
    if (lmpMatch) data.lmp = lmpMatch[1].trim().replace(/\s*\|.*$/, '');

    const edcMatch = text.match(/(?:EDC|EDC \/ EDD|EDD)\s*[:\-]?\s*([^\n\r\|]+)/i);
    if (edcMatch) data.edc = edcMatch[1].trim().replace(/\s*\|.*$/, '');

    const aogMatch = text.match(/(?:AOG|AOG \(weeks\))\s*[:\-]?\s*([^\)\n\r]+)/i);
    if (aogMatch) data.aog = aogMatch[1].trim();

    const fhMatch = text.match(/Fundal Height\s*[:\-]?\s*([^\n\r\|]+)/i);
    if (fhMatch) data.fundal_height = fhMatch[1].trim();

    const fhbMatch = text.match(/(?:Fetal Heartbeat|FHT)\s*[:\-]?\s*([^\n\r\|]+)/i);
    if (fhbMatch) data.fetal_heartbeat = fhbMatch[1].trim();

    const usMatch = text.match(/Ultrasound Report\s*[:\-]?\s*([^\n\r]+)/i);
    if (usMatch) data.ultrasound_report = usMatch[1].trim();

    const edMatch = text.match(/Health Education \/ Counseling\s*[:\-]?\s*([^\n\r]+)/i);
    if (edMatch) data.health_education = edMatch[1].trim();

    const supMatch = text.match(/Supplements \/ Medications\s*[:\-]?\s*([^\n\r]+)/i);
    if (supMatch) data.supplements_medications = supMatch[1].trim();

    const nxtMatch = text.match(/Next Prenatal Visit\s*[:\-]?\s*([^\n\r]+)/i);
    if (nxtMatch) data.next_visit = nxtMatch[1].trim();

    const othMatch = text.match(/Other Instructions\s*[:\-]?\s*([^\n\r]+)/i);
    if (othMatch) data.other_instructions = othMatch[1].trim();
  } else if (category === 'PATIENT_INFORMATION_SHEET' || category === 'INDIVIDUAL_TREATMENT_RECORD' || category === 'ITR' || (ocrResult.itr_data && Object.keys(ocrResult.itr_data).length > 0)) {
    const itr = ocrResult.itr_data || {};
    const d = itr.patient_demographics || {};
    const sc = itr.smoking_cessation_profile || {};
    const fh = itr.family_history || {};
    const cb = itr.clinical_background || {};
    const alc = itr.alcohol_intake || {};
    const dl = itr.diet_and_lifestyle || {};
    const vs = itr.vital_signs || {};
    const pm = itr.philhealth_membership || {};
    const pmh = itr.past_medical_history || {};
    const psh = itr.past_surgical_history || {};
    const psoc = itr.personal_social_history || {};
    const imm = itr.immunizations || {};
    const men = itr.menstrual_history || {};
    const preg = itr.pregnancy_history || {};

    data.itr_data = itr;

    // 1. Patient Demographics
    data.patient_name = data.patient_name || d.name || '';
    data.philhealth_number = data.philhealth_number || d.philhealth_no || pm.philhealth_id_number || '';
    data.address = data.address || d.address || '';
    data.civil_status = data.civil_status || d.civil_status || '';
    data.birth_date = data.birth_date || d.birthday || '';
    data.age = data.age || d.age || '';
    data.contact_number = data.contact_number || d.cp_no || '';
    data.educational_attainment = data.educational_attainment || d.educational_attainment || '';
    data.bhw = data.bhw || d.bhw || '';

    // 2. Smoking Cessation Profile
    const scOpt = sc.options || {};
    data.smoker_status = sc.smoker_status || (scOpt.current ? 'Current' : (scOpt.passive ? 'Passive' : (scOpt.never ? 'Never' : '')));
    const isCurrent = Boolean(scOpt.current || (data.smoker_status && data.smoker_status.toLowerCase() === 'current'));
    data.smoker_current = isCurrent;
    data.smoker_passive = isCurrent ? false : Boolean(scOpt.passive || (data.smoker_status && data.smoker_status.toLowerCase() === 'passive'));
    data.smoker_never = isCurrent ? false : Boolean(scOpt.never || (data.smoker_status && data.smoker_status.toLowerCase() === 'never'));
    data.smoker_stopped_gt_1yr = isCurrent ? false : Boolean(scOpt.stopped_gt_1_year || (data.smoker_status && data.smoker_status.includes('>')));
    data.smoker_stopped_lt_1yr = isCurrent ? false : Boolean(scOpt.stopped_lt_1_year || (data.smoker_status && data.smoker_status.includes('<')));

    data.smoking_brand = sc.brand_of_cigarette || '';
    data.smoking_sticks_per_day = sc.sticks_per_day || '';
    data.smoking_age_started = sc.age_started || '';
    data.smoking_years = sc.years_smoking || '';
    data.smoking_reason = sc.reason_for_smoking || '';
    data.smoking_side_effects_yes = sc.experienced_side_effects === true;
    data.smoking_side_effects_no = sc.experienced_side_effects === false;
    data.smoking_side_effects_details = sc.side_effect_details || '';
    data.smoking_tried_quitting_yes = sc.tried_quitting_before === true;
    data.smoking_tried_quitting_no = sc.tried_quitting_before === false;
    data.smoking_reason_not_successful = sc.reason_not_successful || '';

    // 3. Family History
    data.fh_hypertension = Boolean(fh.hypertension);
    data.fh_stroke = Boolean(fh.stroke);
    data.fh_heart_attack = Boolean(fh.heart_attack);
    data.fh_dm = Boolean(fh.dm || fh.diabetes_mellitus);
    data.fh_asthma = Boolean(fh.asthma);
    data.fh_cancer = Boolean(typeof fh.cancer === 'object' ? fh.cancer.has : fh.cancer);
    data.fh_kidney_disease = Boolean(fh.kidney_disease);
    data.co_morbid = cb.co_morbid || '';
    data.allergy = cb.allergy || pmh.allergy || '';

    // 4. Alcohol Intake
    data.alcohol_never = Boolean(alc.never_consumed);
    data.alcohol_yes = Boolean(alc.drinks_alcohol);
    const alcExc = alc.excessive_alcohol_intake || {};
    data.alcohol_excessive_yes = Boolean(alcExc.yes);
    data.alcohol_excessive_no = Boolean(alcExc.no);

    // 5. Physical Activity & Diet
    const pa = dl.physical_activity || {};
    data.physical_activity_yes = pa.meets_2_5_hours_per_week === true;
    data.physical_activity_no = pa.meets_2_5_hours_per_week === false;

    const fat = dl.high_fat_high_salt_food_intake || {};
    data.high_fat_salt_yes = fat.weekly_processed_fastfood === true;
    data.high_fat_salt_no = fat.weekly_processed_fastfood === false;

    const fiber = dl.dietary_fiber_intake || {};
    data.fiber_vegetables_yes = fiber.vegetables_3_servings_daily === true;
    data.fiber_vegetables_no = fiber.vegetables_3_servings_daily === false;
    data.fiber_fruits_yes = fiber.fruits_2_3_servings_daily === true;
    data.fiber_fruits_no = fiber.fruits_2_3_servings_daily === false;

    // 8. Body measurements & 9. Raised BP
    data.bmi = vs.bmi || '';
    data.waistline_cm = vs.waistline_cm || vs.waist_circumference_cm || '';
    data.height_cm = vs.height_cm || '';
    data.weight_kg = vs.weight_kg || '';
    const bpr = vs.blood_pressure_readings || {};
    data.bp_first_reading = bpr.first || vs.blood_pressure || data.blood_pressure || '';
    data.bp_second_reading = bpr.second || '';
    data.blood_pressure = data.blood_pressure || vs.blood_pressure || data.bp_first_reading;

    // 10. Treatment Record Table
    const crs = itr.consultation_records || [];
    if (crs.length > 0) {
      const firstEntry = crs[0];
      const obj = firstEntry.objective_findings || {};
      data.treatment_date = firstEntry.date || '';
      data.subjective_findings = firstEntry.subjective_findings || '';
      
      let rLevel = (obj.risk_level || '').trim();
      let pRisk = (obj.percentage_of_risk || '').trim();
      const mRisk = rLevel.match(/^([A-Za-z\s]+)(?:\s*\((.*?)\))?$/);
      if (mRisk) {
        const word = mRisk[1].trim();
        if (/very\s*high/i.test(word)) rLevel = 'Very High';
        else if (/high/i.test(word)) rLevel = 'High';
        else if (/medium/i.test(word)) rLevel = 'Medium';
        else if (/mild/i.test(word)) rLevel = 'Mild';
        else if (/low/i.test(word)) rLevel = 'Low';
        if (mRisk[2] && !pRisk) pRisk = mRisk[2].trim();
      }
      data.risk_level = rLevel;
      data.percentage_of_risk = pRisk;

      data.obj_age = obj.age || data.age || '';
      data.obj_wt = obj.weight_kg || data.weight_kg || '';
      data.obj_ht = obj.height_cm || data.height_cm || '';
      data.obj_bp = obj.blood_pressure || data.blood_pressure || '';
      data.diagnosis = Array.isArray(firstEntry.assessment_diagnosis) ? firstEntry.assessment_diagnosis.join(', ') : (firstEntry.assessment_diagnosis || '');

      let planList = Array.isArray(firstEntry.plan_treatment) ? [...firstEntry.plan_treatment] : (firstEntry.plan_treatment ? [firstEntry.plan_treatment] : []);
      data.plan_ncd_done = planList.some(p => /NCD\s*risk\s*assessment/i.test(p));
      data.plan_smoking_done = planList.some(p => /Profiling\s*of\s*Smoking/i.test(p));
      const cleanPlans = planList.filter(p => !/NCD\s*risk\s*assessment/i.test(p) && !/Profiling\s*of\s*Smoking/i.test(p));
      data.treatment = cleanPlans.join('\n') || '';
    }

    // Back Page (Page 2) Fields:
    // 11. PhilHealth
    const pmType = pm.membership_type || {};
    const pmCat = pm.membership_category || {};
    data.philhealth_member = Boolean(pmType.member);
    data.philhealth_dependent = Boolean(pmType.dependent);
    data.philhealth_non_member = Boolean(pmType.non_member);
    data.philhealth_sponsored = Boolean(pmCat.sponsored);
    data.philhealth_nhts = Boolean(pmCat.nhts || pmCat.nhits);
    data.philhealth_lgu = Boolean(pmCat.lgu);
    data.philhealth_nga = Boolean(pmCat.nga);
    data.philhealth_sponsored_private = Boolean(pmCat.sponsored && pmCat.private);
    data.philhealth_ipp = Boolean(pmCat.ipp);
    data.philhealth_organized_group = Boolean(pmCat.organized_group);
    data.philhealth_ofw = Boolean(pmCat.ofw);
    data.philhealth_employed = Boolean(pmCat.employed);
    data.philhealth_government = Boolean(pmCat.government);
    data.philhealth_employed_private = Boolean(pmCat.employed && pmCat.private);
    data.philhealth_lifetime = Boolean(pmCat.lifetime);

    // 12. Vital signs
    data.heart_rate = vs.heart_rate || '';
    data.respiratory_rate = vs.respiratory_rate || '';
    data.pulse_rate = vs.pulse_rate || '';
    data.temperature = vs.temperature || '';
    data.spo2 = vs.spo2 || '';
    data.hip_circumference_cm = vs.hip_circumference_cm || '';

    // 13. Past Medical History
    data.pmh_allergy = pmh.allergy || data.allergy || '';
    data.pmh_asthma = Boolean(pmh.asthma);
    data.pmh_cancer = Boolean(typeof pmh.cancer === 'object' ? pmh.cancer.has : pmh.cancer);
    data.pmh_cancer_organ = (pmh.cancer && pmh.cancer.organ) || '';
    data.pmh_cerebrovascular = Boolean(pmh.cerebrovascular_disease);
    data.pmh_cad = Boolean(pmh.coronary_artery_disease);
    data.pmh_diabetes = Boolean(pmh.diabetes_mellitus);
    data.pmh_emphysema = Boolean(pmh.emphysema);
    data.pmh_epilepsy = Boolean(pmh.epilepsy_seizure_disorder);
    data.pmh_hepatitis = Boolean(typeof pmh.hepatitis === 'object' ? pmh.hepatitis.has : pmh.hepatitis);
    data.pmh_hepatitis_type = (pmh.hepatitis && pmh.hepatitis.type) || '';
    data.pmh_hyperlipidemia = Boolean(pmh.hyperlipidemia);
    data.pmh_hypertension = Boolean(typeof pmh.hypertension === 'object' ? pmh.hypertension.has : pmh.hypertension);
    data.pmh_hypertension_bp = (pmh.hypertension && pmh.hypertension.highest_bp) || '';
    data.pmh_pud = Boolean(pmh.peptic_ulcer_disease);
    data.pmh_pneumonia = Boolean(pmh.pneumonia);
    data.pmh_thyroid = Boolean(pmh.thyroid_disease);
    data.pmh_tb_organ = (pmh.tuberculosis && pmh.tuberculosis.organ) || '';
    data.pmh_tb_category = (pmh.tuberculosis && pmh.tuberculosis.category) || '';
    data.pmh_uti = Boolean(pmh.urinary_tract_infection);
    data.pmh_others = pmh.others || '';

    // 14. Past Surgical History
    data.surgical_operation = psh.operation || '';
    data.surgical_date = psh.date || '';

    // 15. Family History (Back Page)
    data.fh2_allergy = (fh.allergy && typeof fh.allergy === 'string' ? fh.allergy : '') || '';
    data.fh2_asthma = Boolean(fh.asthma);
    data.fh2_cancer = Boolean(typeof fh.cancer === 'object' ? fh.cancer.has : fh.cancer);
    data.fh2_cancer_organ = (fh.cancer && fh.cancer.organ) || '';
    data.fh2_cerebrovascular = Boolean(fh.cerebrovascular_disease);
    data.fh2_cad = Boolean(fh.coronary_artery_disease);
    data.fh2_diabetes = Boolean(fh.diabetes_mellitus);
    data.fh2_emphysema = Boolean(fh.emphysema);
    data.fh2_epilepsy = Boolean(fh.epilepsy_seizure_disorder);
    data.fh2_hepatitis = Boolean(typeof fh.hepatitis === 'object' ? fh.hepatitis.has : fh.hepatitis);
    data.fh2_hepatitis_type = (fh.hepatitis && fh.hepatitis.type) || '';
    data.fh2_hyperlipidemia = Boolean(fh.hyperlipidemia);
    data.fh2_hypertension = Boolean(typeof fh.hypertension === 'object' ? fh.hypertension.has : fh.hypertension);
    data.fh2_hypertension_bp = (fh.hypertension && fh.hypertension.highest_bp) || '';
    data.fh2_pud = Boolean(fh.peptic_ulcer_disease);
    data.fh2_pneumonia = Boolean(fh.pneumonia);
    data.fh2_thyroid = Boolean(fh.thyroid_disease);
    data.fh2_ptb = Boolean(fh.pulmonary_tuberculosis);
    data.fh2_eptb = Boolean(fh.extrapulmonary_tuberculosis);
    data.fh2_uti = Boolean(fh.urinary_tract_infection);
    data.fh2_mental_illness = Boolean(fh.mental_illness);
    data.fh2_others = fh.others || '';

    // 16. Personal / Social History
    const pSmk = psoc.smoking || {};
    const pAlc = psoc.alcohol || {};
    const pDrug = psoc.illicit_drugs || {};
    data.psoc_smoking_yes = Boolean(pSmk.yes);
    data.psoc_smoking_no = Boolean(pSmk.no);
    data.psoc_smoking_quit = Boolean(pSmk.quit);
    data.psoc_pack_years = pSmk.pack_years || '';
    data.psoc_alcohol_yes = Boolean(pAlc.yes);
    data.psoc_alcohol_no = Boolean(pAlc.no);
    data.psoc_alcohol_quit = Boolean(pAlc.quit);
    data.psoc_bottles_per_day = pAlc.bottles_per_day || '';
    data.psoc_drugs_yes = Boolean(pDrug.yes);
    data.psoc_drugs_no = Boolean(pDrug.no);
    data.psoc_drugs_quit = Boolean(pDrug.quit);
    data.psoc_sexually_active_yes = psoc.sexually_active === true;
    data.psoc_sexually_active_no = psoc.sexually_active === false;

    // 17. Immunizations
    const cc = imm.child_care || {};
    const gen = imm.general || {};
    const ab = imm.animal_bite || {};
    const ncd = imm.ncd || {};
    const mat = imm.maternal_care || {};

    data.vax_bcg_date = cc.bcg_date || '';
    data.vax_hepb_birth_date = cc.hepb_birth_date || '';
    data.vax_hepb_24h_date = cc.hepb_24hrs_date || '';
    data.vax_penta_date = cc.penta_date || '';
    data.vax_opv_date = cc.opv_date || '';
    data.vax_ipv_date = cc.ipv_date || '';
    data.vax_pcv_date = cc.pcv_date || '';
    data.vax_measles_date = cc.measles_vaccine_date || '';
    data.vax_rotavirus_date = cc.rotavirus_vaccine_date || '';
    data.vax_varicella_date = cc.chickenpox_vaccine_date || '';

    data.vax_flu_date = gen.flu_vaccine_date || '';
    data.vax_hpv_date = gen.hpv_date || '';
    data.vax_hpv_gr4_date = gen.hpv_grade4_date || '';
    data.vax_mr_gr1_date = gen.mr_grade1_date || '';
    data.vax_mr_gr7_date = gen.mr_grade7_date || '';
    data.vax_td_gr1_date = gen.td_grade1_date || '';
    data.vax_td_gr7_date = gen.td_grade7_date || '';
    data.vax_tt_date = gen.tetanus_toxoid_date || '';

    data.vax_pcecv1_date = ab.pcecv1_date || '';
    data.vax_pvrv1_date = ab.pvrv1_date || '';
    data.vax_pvrv2_date = ab.pvrv2_date || '';
    data.vax_pvrv3_date = ab.pvrv3_date || '';
    data.vax_pvrv4_date = ab.pvrv4_date || '';
    data.vax_pcecv2_date = ab.pcecv2_date || '';

    data.vax_pneumo_ncd_date = ncd.pneumococcal_vaccine_date || '';
    data.vax_flu_ncd_date = ncd.flu_vaccine_date || '';
    data.vax_tt_maternal_date = mat.tetanus_toxoid_date || '';

    // 18. Menstrual History
    data.menarche_age = men.menarche_age || '';
    data.onset_sexual_intercourse = men.onset_of_sexual_intercourse || '';
    data.last_menstrual_period = men.last_menstrual_period || '';
    data.menstrual_bleeding_pattern = men.menstrual_bleeding_pattern || '';
    data.birth_control_method = men.birth_control_method || '';
    data.period_duration = men.period_duration || '';
    data.interval_cycle = men.cycle_interval || '';
    data.pads_per_day = men.pads_per_day || '';
    data.menopause_yes = men.menopause === true;
    data.menopause_no = men.menopause === false;
    data.age_of_menopause = men.age_of_menopause || '';

    // 19. Pregnancy History
    data.gravidity = preg.gravidity || '';
    data.parity = preg.parity || '';
    data.type_of_delivery = preg.type_of_delivery || '';
    data.full_term = preg.full_term || '';
    data.premature = preg.premature || '';
    data.abortion = preg.abortion || '';
    data.living_children = preg.living_children || '';
    data.pre_eclampsia_yes = preg.pre_eclampsia === true;
    data.pre_eclampsia_no = preg.pre_eclampsia === false;
    data.age_at_first_pregnancy = preg.age_at_first_pregnancy || '';
    data.family_planning_counseling_yes = preg.family_planning_counseling === true;
    data.family_planning_counseling_no = preg.family_planning_counseling === false;
  }

  return data;
}

// In-memory queue worker tracker
const runningQueues = new Set();

const BatchController = {
  // Middleware to handle bulk file upload
  uploadBatchMiddleware(req, res, next) {
    upload(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message || 'Batch upload file error.'
        });
      }
      next();
    });
  },

  // Step 1: Batch Upload Endpoint
  async createBatchJob(req, res) {
    const files = req.files || [];
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No supported documents were uploaded. Please select 1 to 25 files.'
      });
    }

    const eligibleFiles = [];
    const uploadProblems = [];

    // Verify file signatures and integrity
    for (const file of files) {
      const isValid = verifyFileSignature(file.path, file.originalname);
      if (!isValid) {
        uploadProblems.push({
          filename: file.originalname,
          reason: 'File content does not match its extension or is corrupted.'
        });
        if (fs.existsSync(file.path)) {
          try { fs.unlinkSync(file.path); } catch (_) {}
        }
      } else {
        eligibleFiles.push(file);
      }
    }

    if (eligibleFiles.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'None of the uploaded documents passed security and format integrity checks.',
        problems: uploadProblems
      });
    }

    try {
      const batchRef = `BATCH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

      // Create batch job
      const job = await BatchModel.createJob({
        batch_reference: batchRef,
        uploaded_by: (req.user && req.user.id) || null,
        uploader_name: (req.user && (req.user.full_name || req.user.email)) || 'Records Staff',
        total_files: eligibleFiles.length
      });

      const defaultTargetPatientId = req.body.target_patient_id || req.body.patient_id || null;

      // Create batch items
      const itemsToCreate = eligibleFiles.map(file => ({
        batch_id: job.id,
        original_filename: file.originalname,
        file_path: file.path,
        file_size_bytes: file.size,
        mime_type: file.mimetype,
        status: 'WAITING',
        target_patient_id: defaultTargetPatientId || null
      }));

      const createdItems = await BatchModel.createItems(itemsToCreate);

      // Audit log
      if (req.user) {
        await AuditMiddleware.logActivity(
          req.user.id,
          req.user.email,
          'BATCH_UPLOAD_SUBMITTED',
          `Uploaded batch ${batchRef} with ${eligibleFiles.length} files (${uploadProblems.length} rejected on pre-check).`,
          req
        );
      }

      // Trigger asynchronous background worker
      setImmediate(() => {
        BatchController.processBatchQueue(job.id);
      });

      return res.status(201).json({
        success: true,
        message: `Batch ${batchRef} created successfully with ${eligibleFiles.length} documents queued.`,
        batch_id: job.id,
        batch_reference: batchRef,
        total_queued: eligibleFiles.length,
        upload_problems: uploadProblems
      });
    } catch (err) {
      console.error('Batch create error:', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to create batch processing session.'
      });
    }
  },

  // Step 2: Background Ingestion & OCR/AI Worker with Concurrency Limit (2 concurrent files)
  async processBatchQueue(batchId) {
    if (runningQueues.has(batchId)) return;
    runningQueues.add(batchId);

    try {
      console.log(`[BATCH WORKER] Starting processing for Batch: ${batchId}`);
      const items = await BatchModel.findItemsByBatchId(batchId);
      // Pick up WAITING items as well as any stuck PROCESSING items
      const pendingItems = items.filter(i => i.status === 'WAITING' || i.status === 'PROCESSING');

      if (pendingItems.length === 0) {
        console.log(`[BATCH WORKER] No pending items for Batch: ${batchId}`);
        return;
      }

      // Pre-fetch active patients for auto-matching
      const allActivePatients = await PatientModel.findAllActive();

      // Worker concurrency helper
      const CONCURRENCY = 2;
      for (let i = 0; i < pendingItems.length; i += CONCURRENCY) {
        const chunk = pendingItems.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map(async (item) => {
          await BatchController.processSingleItem(item, allActivePatients);
        }));
        await BatchModel.recountBatchStats(batchId);
      }

      console.log(`[BATCH WORKER] Completed processing for Batch: ${batchId}`);
    } catch (err) {
      console.error(`[BATCH WORKER] Error processing batch ${batchId}:`, err);
    } finally {
      runningQueues.delete(batchId);
      await BatchModel.recountBatchStats(batchId);
    }
  },

  /**
   * Automatic Queue Recovery Watchdog:
   * Finds any batch items that were left in WAITING or stranded in PROCESSING
   * (e.g. after a server restart, system reboot, or unhandled crash) and automatically
   * resumes processing them.
   */
  async resumeUnfinishedBatches() {
    try {
      const allItems = await BatchModel.findAllItems(1000);
      const pendingItems = allItems.filter(i => i.status === 'WAITING' || i.status === 'PROCESSING');
      if (pendingItems.length === 0) {
        return;
      }

      console.log(`[BATCH RECOVERY] Found ${pendingItems.length} unfinished batch item(s). Initiating recovery...`);

      // Reset PROCESSING items older than 2 minutes back to WAITING
      const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
      for (const item of pendingItems) {
        if (item.status === 'PROCESSING') {
          const updatedAt = new Date(item.updated_at || item.created_at).getTime();
          if (updatedAt < twoMinutesAgo) {
            console.log(`[BATCH RECOVERY] Resetting stuck item ${item.id} (${item.original_filename}) to WAITING`);
            await BatchModel.updateItem(item.id, { status: 'WAITING' });
          }
        }
      }

      // Group by batch_id and trigger processBatchQueue
      const uniqueBatchIds = [...new Set(pendingItems.map(i => i.batch_id).filter(Boolean))];
      for (const bId of uniqueBatchIds) {
        if (!runningQueues.has(bId)) {
          console.log(`[BATCH RECOVERY] Resuming processing for batch ${bId}`);
          BatchController.processBatchQueue(bId).catch(err => {
            console.error(`[BATCH RECOVERY] Error processing batch ${bId}:`, err);
          });
        }
      }
    } catch (err) {
      console.error('[BATCH RECOVERY] Failed to resume unfinished batches:', err);
    }
  },

  async processSingleItem(item, allActivePatients = []) {
    try {
      await BatchModel.updateItem(item.id, { status: 'PROCESSING' });

      if (!fs.existsSync(item.file_path)) {
        await BatchModel.updateItem(item.id, {
          status: 'FAILED',
          error_message: 'File missing from storage.'
        });
        return;
      }

      // Step 2a: Run PaddleOCR text extraction
      let ocrResult = { text: '', raw_text: '', layout_blocks: [], page_size: [595, 842] };
      try {
        ocrResult = await PDFProcessor.extractTextFromPdf(item.file_path, 0);
      } catch (ocrErr) {
        console.warn(`[OCR WARN] Document OCR extraction failed on ${item.original_filename}:`, ocrErr.message);
      }

      const extractedText = ocrResult.text || ocrResult.raw_text || '';
      const combinedUpper = `${extractedText} ${ocrResult.raw_text || ''}`.toUpperCase();
      
      // Step 2b: Classify document category
      let suggestedCategory = ocrResult.suggested_category || ocrResult.doc_type;
      let confidenceScore = ocrResult.confidence || 0.99;
      let confidenceLevel = 'HIGH';

      // Authoritative classification check:
      // Always test against the ground-truth reference classifier with both text & original filename
      const classification = Classifier.classifyText(extractedText, item.original_filename);

      // Priority rules:
      // 1. If Classifier found an explicit document header / filename signature (confidence >= 0.85),
      //    it takes absolute precedence over generic AI body guesses.
      // 2. If Gemini/OCR did not provide a category or paddleocr was used, use Classifier result.
      if (classification.confidence >= 0.85 || !suggestedCategory || ocrResult.engine === 'paddleocr') {
        suggestedCategory = classification.suggestedCategory || 'PATIENT_INFORMATION_SHEET';
        confidenceScore = Math.max(confidenceScore, classification.confidence || 0.95);
        confidenceLevel = classification.confidenceLevel || 'HIGH';
      }

      // [DEBUG LOGGING] Prominent console output of extracted OCR text & classification
      console.log('\n' + '='.repeat(70));
      console.log(`📄 [OCR & CLASSIFICATION DEBUG] File: ${item.original_filename}`);
      console.log(`🔧 Engine: ${ocrResult.engine || 'unknown'} | Length: ${extractedText.length} characters | Blocks: ${ocrResult.layout_blocks?.length || 0}`);
      console.log('-'.repeat(70));
      console.log('📝 EXTRACTED OCR RAW TEXT:');
      console.log(extractedText || '[NO TEXT EXTRACTED]');
      console.log('-'.repeat(70));
      console.log('🏷️ CLASSIFICATION RESULT:');
      console.log(`  Suggested Category: ${suggestedCategory}`);
      console.log(`  Confidence: ${confidenceScore} (${confidenceLevel})`);
      console.log(`  Matched Terms: [${(classification.matchedTerms || []).join(', ')}]`);
      console.log(`  Reason: ${classification.reason || 'N/A'}`);
      console.log('='.repeat(70) + '\n');

      // Step 2c: Extract structured fields (Prefer Multimodal AI Structured Output + Regex Fallbacks)
      const regexData = extractStructuredData(extractedText, suggestedCategory, ocrResult);
      let structuredData = { ...regexData };

      if (ocrResult.ai_structured_data && typeof ocrResult.ai_structured_data === 'object' && Object.keys(ocrResult.ai_structured_data).length > 0) {
        structuredData = { ...structuredData, ...ocrResult.ai_structured_data };
      }

      // Harmonize demographic shortcuts
      structuredData.patient_name = structuredData.patient_name || structuredData.name || '';
      structuredData.consultation_date = structuredData.consultation_date || structuredData.exam_date || structuredData.date || structuredData.date_registered || '';
      structuredData.age = structuredData.age || '';
      structuredData.sex = structuredData.sex || 'Female';
      structuredData.address = structuredData.address || '';
      structuredData.civil_status = structuredData.civil_status || '';

      // Step 2d: Patient profile auto-matching
      let matchedPatientId = null;
      let matchedPatientScore = 0;
      let matchedPatientName = null;

      if (structuredData.patient_name && allActivePatients.length > 0) {
        const queryName = structuredData.patient_name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
        const queryTokens = queryName.split(/\s+/).filter(t => t.length > 2);

        for (const p of allActivePatients) {
          const fullName = `${p.first_name} ${p.last_name}`.toLowerCase();
          const reverseName = `${p.last_name} ${p.first_name}`.toLowerCase();
          
          if (queryName.includes(fullName) || fullName.includes(queryName) || queryName.includes(reverseName)) {
            matchedPatientId = p.id;
            matchedPatientScore = 95;
            matchedPatientName = `${p.first_name} ${p.last_name} (${p.patient_number})`;
            break;
          }
        }
      }

      // Determine final status
      const isReadable = extractedText.trim().length > 25;
      const finalStatus = isReadable ? 'READY_FOR_REVIEW' : 'MANUAL_REQUIRED';
      const errorMessage = isReadable ? null : 'Extracted text is insufficient or scan is unreadable. Manual processing required.';

      await BatchModel.updateItem(item.id, {
        status: finalStatus,
        suggested_category: suggestedCategory,
        confidence_score: confidenceScore,
        confidence_level: confidenceLevel,
        target_patient_id: matchedPatientId,
        extracted_data: {
          ...structuredData,
          _matched_patient_name: matchedPatientName,
          _matched_patient_score: matchedPatientScore
        },
        raw_ocr_text: extractedText,
        error_message: errorMessage
      });
    } catch (itemErr) {
      console.error(`Error processing item ${item.id}:`, itemErr);
      await BatchModel.updateItem(item.id, {
        status: 'FAILED',
        error_message: itemErr.message || 'Unknown processing error.'
      });
    }
  },

  // Step 3: Get Batch Status & Items
  async getBatchStatus(req, res) {
    try {
      const { batchId } = req.params;
      const job = await BatchModel.findJobById(batchId);
      if (!job) {
        return res.status(404).json({ success: false, message: 'Batch job not found.' });
      }

      const items = await BatchModel.findItemsByBatchId(job.id);
      
      const counts = {
        total: items.length,
        waiting: items.filter(i => i.status === 'WAITING').length,
        processing: items.filter(i => i.status === 'PROCESSING').length,
        ready_for_review: items.filter(i => i.status === 'READY_FOR_REVIEW').length,
        manual_required: items.filter(i => i.status === 'MANUAL_REQUIRED').length,
        confirmed: items.filter(i => i.status === 'CONFIRMED').length,
        rejected: items.filter(i => i.status === 'REJECTED').length,
        failed: items.filter(i => i.status === 'FAILED').length
      };

      const percent = counts.total > 0
        ? Math.round(((counts.total - (counts.waiting + counts.processing)) / counts.total) * 100)
        : 100;

      return res.status(200).json({
        success: true,
        job,
        counts,
        progress_percentage: percent,
        items
      });
    } catch (err) {
      console.error('Get batch status error:', err);
      return res.status(500).json({ success: false, message: 'Failed to retrieve batch status.' });
    }
  },

  // List recent batches
  async listBatches(req, res) {
    try {
      const jobs = await BatchModel.listRecentJobs(30);
      return res.status(200).json({ success: true, jobs });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to retrieve batch jobs.' });
    }
  },

  // Get all batch items across all batches for unified queue display
  async getAllBatchItems(req, res) {
    try {
      const items = await BatchModel.findAllItems(1000);

      // Filter out rejected and archived items so they never appear in the batch status table
      const visibleItems = (items || []).filter(i => i.status !== 'REJECTED' && i.status !== 'ARCHIVED');

      const counts = {
        total: visibleItems.length,
        waiting: visibleItems.filter(i => i.status === 'WAITING').length,
        processing: visibleItems.filter(i => i.status === 'PROCESSING').length,
        ready_for_review: visibleItems.filter(i => i.status === 'READY_FOR_REVIEW').length,
        manual_required: visibleItems.filter(i => i.status === 'MANUAL_REQUIRED').length,
        confirmed: visibleItems.filter(i => i.status === 'CONFIRMED').length,
        failed: visibleItems.filter(i => i.status === 'FAILED').length
      };

      // Auto-recover stalled or pending items if no queue worker is actively running
      if ((counts.waiting > 0 || counts.processing > 0) && runningQueues.size === 0) {
        setImmediate(() => {
          BatchController.resumeUnfinishedBatches().catch(console.error);
        });
      }

      return res.status(200).json({
        success: true,
        counts,
        items: visibleItems
      });
    } catch (err) {
      console.error('[BatchController.getAllBatchItems] Error:', err);
      return res.status(500).json({ success: false, message: 'Failed to retrieve all batch items.' });
    }
  },

  // Explicit queue recovery trigger endpoint
  async recoverBatches(req, res) {
    try {
      setImmediate(() => {
        BatchController.resumeUnfinishedBatches().catch(console.error);
      });
      return res.status(200).json({
        success: true,
        message: 'Batch queue recovery successfully triggered in background.'
      });
    } catch (err) {
      console.error('[BatchController.recoverBatches] Error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Step 4: Get Individual Batch Item for Draft Review
  async getBatchItem(req, res) {
    try {
      const { itemId } = req.params;
      const item = await BatchModel.findItemById(itemId);
      if (!item) {
        return res.status(404).json({ success: false, message: 'Batch item not found.' });
      }

      let matchedPatient = null;
      if (item.target_patient_id) {
        matchedPatient = await PatientModel.findById(item.target_patient_id);
      }

      return res.status(200).json({
        success: true,
        item,
        matchedPatient,
        file_url: `/api/records/batch/file/${item.id}`
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to retrieve draft details.' });
    }
  },

  // Serve the scanned file for previewing in the Side-by-Side viewer
  async serveBatchFile(req, res) {
    try {
      const { itemId } = req.params;
      const item = await BatchModel.findItemById(itemId);
      if (!item) {
        return res.status(404).send('Batch item not found.');
      }

      // Robust multi-location file path resolver
      let resolvedPath = null;
      if (item.file_path && fs.existsSync(item.file_path)) {
        resolvedPath = item.file_path;
      } else if (item.file_path && fs.existsSync(path.resolve(process.cwd(), item.file_path))) {
        resolvedPath = path.resolve(process.cwd(), item.file_path);
      } else {
        // Candidate 1: Temp batch directory
        const baseName = item.file_path ? path.basename(item.file_path) : '';
        const tempPath = baseName ? path.join(process.cwd(), 'uploads', 'temp', 'batch', baseName) : null;
        if (tempPath && fs.existsSync(tempPath)) {
          resolvedPath = tempPath;
        } else if (item.target_patient_id && baseName) {
          // Candidate 2: Patient permanent directory
          const patientPath = path.join(process.cwd(), 'uploads', item.target_patient_id, baseName);
          if (fs.existsSync(patientPath)) {
            resolvedPath = patientPath;
          }
        }

        // Candidate 3: Search recursively in uploads
        if (!resolvedPath) {
          const uploadsDir = path.join(process.cwd(), 'uploads');
          const findFileRecursive = (dir, name1, name2) => {
            try {
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                  const res = findFileRecursive(full, name1, name2);
                  if (res) return res;
                } else if (entry.isFile()) {
                  if (name1 && entry.name === name1) return full;
                  if (name2 && entry.name.endsWith(name2.replace(/[^a-zA-Z0-9._-]/g, '_'))) return full;
                }
              }
            } catch (_) {}
            return null;
          };
          resolvedPath = findFileRecursive(uploadsDir, baseName, item.original_filename);
        }
      }

      if (!resolvedPath || !fs.existsSync(resolvedPath)) {
        console.error(`[serveBatchFile] File not found on disk for item ${itemId}. Attempted: ${item.file_path}`);
        return res.status(404).send('Document scan file not found on disk.');
      }

      // If file was found at an updated location, sync to batch item
      if (resolvedPath !== item.file_path) {
        try {
          await BatchModel.updateItem(itemId, { file_path: resolvedPath });
        } catch (_) {}
      }

      res.setHeader('Content-Type', item.mime_type || 'image/jpeg');
      res.setHeader('Content-Disposition', `inline; filename="${item.original_filename || 'document'}"`);
      return fs.createReadStream(resolvedPath).pipe(res);
    } catch (err) {
      console.error('[serveBatchFile] Error serving file:', err);
      return res.status(500).send('Error serving file.');
    }
  },

  // Step 5: Save Corrections during Draft Review
  async saveDraftCorrection(req, res) {
    try {
      const { itemId } = req.params;
      const { suggested_category, extracted_data, target_patient_id } = req.body;

      const item = await BatchModel.findItemById(itemId);
      if (!item) {
        return res.status(404).json({ success: false, message: 'Draft not found.' });
      }

      const reviewerId = await resolveUserUuid(req.user);
      let cleanPatientId = toValidUuidOrNull(item.target_patient_id);
      if (target_patient_id !== undefined) {
        cleanPatientId = toValidUuidOrNull(target_patient_id);
      }

      const updates = {
        suggested_category: suggested_category || item.suggested_category,
        extracted_data: extracted_data || item.extracted_data,
        target_patient_id: cleanPatientId,
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString()
      };

      const updated = await BatchModel.updateItem(itemId, updates);

      if (item.confirmed_record_id) {
        try {
          await RecordModel.update(item.confirmed_record_id, {
            patient_id: cleanPatientId,
            structured_json: extracted_data || item.extracted_data || {}
          });
        } catch (recUpdateErr) {
          console.warn('[BATCH CONTROLLER] Non-fatal record sync warning:', recUpdateErr.message);
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Draft corrections saved successfully.',
        item: updated
      });
    } catch (err) {
      console.error('[BATCH CONTROLLER] saveDraftCorrection error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Failed to update draft corrections.' });
    }
  },

  // Step 6: Fallback Manual Processing Submission
  async saveManualProcessing(req, res) {
    try {
      const { itemId } = req.params;
      const { category, extracted_data, target_patient_id } = req.body;

      const item = await BatchModel.findItemById(itemId);
      if (!item) {
        return res.status(404).json({ success: false, message: 'Item not found.' });
      }

      if (!category) {
        return res.status(400).json({ success: false, message: 'Approved record category is required.' });
      }

      const reviewerId = await resolveUserUuid(req.user);
      let cleanPatientId = toValidUuidOrNull(item.target_patient_id);
      if (target_patient_id !== undefined) {
        cleanPatientId = toValidUuidOrNull(target_patient_id);
      }

      const updated = await BatchModel.updateItem(itemId, {
        status: 'READY_FOR_REVIEW',
        suggested_category: category,
        confidence_score: 1.0,
        confidence_level: 'MANUALLY_ENTERED',
        target_patient_id: cleanPatientId,
        extracted_data: extracted_data || {},
        error_message: null,
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString()
      });

      await BatchModel.recountBatchStats(item.batch_id);

      return res.status(200).json({
        success: true,
        message: 'Manual entry saved. Record is now ready for final confirmation.',
        item: updated
      });
    } catch (err) {
      console.error('[BATCH CONTROLLER] saveManualProcessing error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Failed to save manual processing data.' });
    }
  },

  // Step 7: Record Confirmation & Patient Profile Linking
  async confirmBatchItem(req, res) {
    try {
      const { itemId } = req.params;
      const { patient_id, record_category, custom_title, structured_fields } = req.body;

      const item = await BatchModel.findItemById(itemId);
      if (!item) {
        return res.status(404).json({ success: false, message: 'Draft record not found.' });
      }

      // Idempotent: If already confirmed AND linked to the same patient, return success immediately
      if (item.status === 'CONFIRMED' && item.confirmed_record_id && item.target_patient_id && (!patient_id || item.target_patient_id === patient_id)) {
        return res.status(200).json({
          success: true,
          message: 'Record successfully verified and permanently saved to patient chart.',
          record_id: item.confirmed_record_id,
          patient_id: item.target_patient_id
        });
      }

      const category = record_category || item.suggested_category || 'PATIENT_INFORMATION_SHEET';
      const reviewerId = await resolveUserUuid(req.user);
      const targetPatientId = patient_id || item.target_patient_id || null;

      // Allow confirming/saving a record as Unlinked if no patient is selected yet
      if (!targetPatientId) {
        if (item.confirmed_record_id) {
          try {
            await RecordModel.update(item.confirmed_record_id, {
              patient_id: null,
              structured_json: structured_fields || item.extracted_data || {}
            });
          } catch (_) {}
        }

        await BatchModel.updateItem(itemId, {
          status: 'CONFIRMED',
          suggested_category: category,
          extracted_data: structured_fields || item.extracted_data || {},
          target_patient_id: null,
          reviewed_by: reviewerId,
          reviewed_at: new Date().toISOString()
        });

        await BatchModel.recountBatchStats(item.batch_id);

        return res.status(200).json({
          success: true,
          unlinked: true,
          message: 'Record verified and saved as Unlinked.',
          record_id: item.confirmed_record_id || item.id,
          patient_id: null
        });
      }

      // Verify patient exists
      const patient = await PatientModel.findById(targetPatientId);
      if (!patient) {
        return res.status(404).json({ success: false, message: 'Selected patient profile does not exist.' });
      }

      const recordTitle = custom_title || `${category.replace(/_/g, ' ')} - ${new Date().toLocaleDateString('en-US')}`;

      // Map to official database record_type & record_subtype based on RHU Centralized Binders
      let finalRecordType = 'PATIENT_INFORMATION_SHEET';
      let recordSubtype = null;

      if (category === 'CHILDHOOD_IMMUNIZATION' || category === 'IMMUNIZATION_RECORD' || category === 'ANTI_RABIES' || category === 'ANTI_RABIES_RECORD') {
        finalRecordType = 'IMMUNIZATION_RECORD';
        recordSubtype = 'CHILDHOOD';
      } else if (category === 'MATERNAL_CARE' || category === 'MATERNAL_CARE_RECORD') {
        finalRecordType = 'MATERNAL_CARE_RECORD';
      } else if (category === 'CONSULTATION_RECORD') {
        finalRecordType = 'CONSULTATION_RECORD';
      } else if (category === 'MEDICAL_CERTIFICATE') {
        finalRecordType = 'MEDICAL_CERTIFICATE';
      } else {
        finalRecordType = 'PATIENT_INFORMATION_SHEET';
      }

      // Move file to permanent storage
      const finalDir = path.join(uploadDir, targetPatientId);
      if (!fs.existsSync(finalDir)) {
        fs.mkdirSync(finalDir, { recursive: true });
      }

      const safeExt = path.extname(item.original_filename);
      const permFilename = `rec_${Date.now()}_${item.original_filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const permFilePath = path.join(finalDir, permFilename);

      if (fs.existsSync(item.file_path)) {
        fs.copyFileSync(item.file_path, permFilePath);
        // Retain copy for review preview consistency
      }

      const relativePath = path.relative(process.cwd(), permFilePath);
      const fileUrl = `/${relativePath.replace(/\\/g, '/')}`;

      // Create or update official medical record
      let savedRecord = null;
      if (item.confirmed_record_id) {
        const existingRec = await RecordModel.findById(item.confirmed_record_id);
        if (existingRec) {
          savedRecord = await RecordModel.update(item.confirmed_record_id, {
            patient_id: targetPatientId,
            record_type: finalRecordType,
            structured_json: structured_fields || item.extracted_data || {},
            classification_result: category
          });
        }
      }

      if (!savedRecord) {
        const recordId = crypto.randomUUID();
        savedRecord = await RecordModel.create({
          id: recordId,
          patient_id: targetPatientId,
          record_type: finalRecordType,
          record_subtype: recordSubtype,
          category: category,
          title: recordTitle,
          file_path: relativePath,
          file_url: fileUrl,
          file_name: permFilename,
          file_type: item.mime_type || 'image/jpeg',
          extracted_text: item.raw_ocr_text || '',
          structured_json: structured_fields || item.extracted_data || {},
          classification_result: category,
          uploaded_by: reviewerId || req.user.id,
          is_verified: true,
          verified_by: reviewerId || req.user.id,
          verified_at: new Date().toISOString()
        });
      }

      // Update batch item status
      await BatchModel.updateItem(itemId, {
        status: 'CONFIRMED',
        confirmed_record_id: savedRecord.id,
        target_patient_id: targetPatientId,
        suggested_category: category,
        extracted_data: structured_fields || item.extracted_data || {},
        file_path: fs.existsSync(permFilePath) ? permFilePath : item.file_path,
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString()
      });

      await BatchModel.recountBatchStats(item.batch_id);

      // Write to Audit Log
      await AuditMiddleware.logActivity(
        req.user.id,
        req.user.email,
        'BATCH_RECORD_CONFIRMED',
        `Confirmed verified record [${recordTitle}] for patient ${patient.first_name} ${patient.last_name} (${patient.patient_number}) from batch document ${item.original_filename}.`,
        req
      );

      return res.status(200).json({
        success: true,
        message: 'Record successfully verified and permanently saved to patient chart.',
        record_id: savedRecord.id,
        patient_id: targetPatientId
      });
    } catch (err) {
      console.error('Confirm batch item error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Failed to confirm batch record.' });
    }
  },

  // Step 8: Reject Unusable Draft - Automatically and permanently deletes the record/draft
  async rejectBatchItem(req, res) {
    try {
      const { itemId } = req.params;
      const { rejection_reason } = req.body;

      const item = await BatchModel.findItemById(itemId);
      if (!item) {
        return res.status(404).json({ success: false, message: 'Draft not found.' });
      }

      // 1. Delete physical scanned file if it exists locally
      if (item.file_path && fs.existsSync(item.file_path)) {
        try { fs.unlinkSync(item.file_path); } catch (_) {}
      }

      // 2. If this draft had a confirmed record created, permanently delete it from patient_records as well
      if (item.confirmed_record_id) {
        try {
          const RecordModel = require('../models/recordModel');
          await RecordModel.delete(item.confirmed_record_id);
        } catch (recErr) {
          console.warn('Error deleting linked patient record on reject:', recErr.message);
        }
      }

      // 3. Automatically and permanently delete the draft record from database
      await BatchModel.deleteItem(itemId);

      // 4. Recount batch stats
      if (item.batch_id) {
        await BatchModel.recountBatchStats(item.batch_id);
      }

      // 5. Audit Log
      await AuditMiddleware.logActivity(
        req.user.id,
        req.user.email,
        'BATCH_DRAFT_REJECTED',
        `Rejected and automatically deleted draft item ${item.original_filename}. Reason: ${rejection_reason || 'Unusable draft'}.`,
        req
      );

      return res.status(200).json({
        success: true,
        message: 'Draft rejected and automatically deleted.'
      });
    } catch (err) {
      console.error('Reject batch item error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Failed to reject draft.' });
    }
  }
};

BatchController.extractStructuredData = extractStructuredData;

module.exports = BatchController;
