// Keep Up System - Explainable Document Classification Utility
// Grounded directly on Paete Rural Health Unit (RHU) Centralized Record Binders (reference_documents)
// Rule-based classification utilizing weighted keyword scanning & structural layout signatures.

const CATEGORY_KEYWORDS = {
  // Binder 1: Individual Treatment Record (ITR Page 1 & Page 2)
  PATIENT_INFORMATION_SHEET: [
    { word: "individual treatment record", weight: 35 },
    { word: "20 years old and above", weight: 25 },
    { word: "paete rural health unit", weight: 12 },
    { word: "lifestyle & risk factors", weight: 30 },
    { word: "smoking cessation profile", weight: 30 },
    { word: "smokers?", weight: 20 },
    { word: "philhealth membership information", weight: 35 },
    { word: "philhealth id number", weight: 30 },
    { word: "philhealth no", weight: 15 },
    { word: "individual paying program", weight: 25 },
    { word: "membership category", weight: 25 },
    { word: "membership type", weight: 25 },
    { word: "past medical history", weight: 35 },
    { word: "past surgical history", weight: 35 },
    { word: "family history", weight: 15 },
    { word: "personal / social history", weight: 35 },
    { word: "personal/social history", weight: 35 },
    { word: "menstrual history", weight: 35 },
    { word: "pregnancy history", weight: 35 },
    { word: "vital signs & physical measurements", weight: 30 },
    { word: "consultation & clinical findings", weight: 25 },
    { word: "dietary fiber intake", weight: 25 },
    { word: "high fat / high salt food intake", weight: 25 },
    { word: "excessive alcohol intake", weight: 25 },
    { word: "alcohol intake", weight: 15 },
    { word: "physical activity", weight: 15 },
    { word: "educational attainment", weight: 15 },
    { word: "bhw", weight: 15 },
    { word: "raised bp", weight: 20 },
    { word: "highest bp recorded", weight: 25 },
    { word: "pack years", weight: 20 },
    { word: "bottles per day", weight: 20 },
    { word: "coronary artery disease", weight: 15 },
    { word: "cerebrovascular disease", weight: 15 },
    { word: "epilepsy/seizure disorder", weight: 15 },
    { word: "peptic ulcer disease", weight: 15 },
    { word: "pulmonary tuberculosis", weight: 15 },
    { word: "extrapulmonary tuberculosis", weight: 15 },
    { word: "first degree relative", weight: 15 },
    { word: "itr form", weight: 15 },
    { word: "civil status", weight: 5 },
    { word: "residential address", weight: 5 }
  ],

  // Binder 2: Consultation & Outpatient Clinical Records
  CONSULTATION_RECORD: [
    { word: "consultation & outpatient clinical record", weight: 40 },
    { word: "outpatient clinical record", weight: 35 },
    { word: "clinical findings & diagnosis", weight: 35 },
    { word: "prescription & treatment plan", weight: 35 },
    { word: "chief complaint", weight: 30 },
    { word: "assessment / diagnosis", weight: 30 },
    { word: "assessment/diagnosis", weight: 30 },
    { word: "date of consultation", weight: 25 },
    { word: "subjective findings", weight: 25 },
    { word: "objective findings", weight: 25 },
    { word: "reseta", weight: 15 },
    { word: "konsulta", weight: 15 },
    { word: "check-up", weight: 10 },
    { word: "treatment plan", weight: 20 },
    { word: "attending physician", weight: 20 },
    { word: "acute upper respiratory tract infection", weight: 25 },
    { word: "doctor notes", weight: 20 },
    { word: "reklamo", weight: 15 },
    { word: "lunas", weight: 10 }
  ],

  // Binder 3: Routine Childhood Immunization (Baby Book & reference_documents/3_Immunizations)
  CHILDHOOD_IMMUNIZATION: [
    { word: "routine childhood immunization", weight: 50 },
    { word: "childhood immunization", weight: 45 },
    { word: "screening / pre-vaccination assessment", weight: 50 },
    { word: "pre-vaccination assessment", weight: 45 },
    { word: "immunization details (this visit)", weight: 50 },
    { word: "immunization details", weight: 40 },
    { word: "vaccination history", weight: 45 },
    { word: "next immunization date", weight: 45 },
    { word: "next schedule", weight: 35 },
    { word: "vaccine (antigen)", weight: 40 },
    { word: "batch / lot number", weight: 35 },
    { word: "with fever today", weight: 35 },
    { word: "anti-rabies vaccine", weight: 30 },
    { word: "rabies vaccine", weight: 25 },
    { word: "animal bite", weight: 20 },
    { word: "bakuna", weight: 20 },
    { word: "with acute illness", weight: 35 },
    { word: "history of allergic reaction to vaccines", weight: 35 },
    { word: "routine childhood immunization record", weight: 45 },
    { word: "routine childhood immunization", weight: 40 },
    { word: "childhood immunization record", weight: 40 },
    { word: "childhood immunization", weight: 35 },
    { word: "baby book", weight: 35 },
    { word: "patient & child demographics", weight: 35 },
    { word: "vaccination log", weight: 35 },
    { word: "child name", weight: 30 },
    { word: "mother name", weight: 20 },
    { word: "bcg vaccine", weight: 30 },
    { word: "hepatitis b (birth dose)", weight: 30 },
    { word: "hepb birth dose", weight: 30 },
    { word: "penta 1", weight: 30 },
    { word: "penta 2", weight: 30 },
    { word: "penta 3", weight: 30 },
    { word: "dpt-hepb-hib", weight: 30 },
    { word: "opv 1", weight: 30 },
    { word: "opv 2", weight: 30 },
    { word: "pcv 1", weight: 30 },
    { word: "measles / mmr 1", weight: 30 },
    { word: "measles / mmr", weight: 25 },
    { word: "bakuna ng bata", weight: 25 },
    { word: "bakuna", weight: 15 }
  ],

  // Binder 4: Maternal Care & Prenatal Record Sheet
  MATERNAL_CARE_RECORD: [
    { word: "maternal care & prenatal record sheet", weight: 45 },
    { word: "maternal care & prenatal", weight: 40 },
    { word: "prenatal record sheet", weight: 40 },
    { word: "prenatal visit log", weight: 40 },
    { word: "fundal height", weight: 35 },
    { word: "fetal heartbeat", weight: 35 },
    { word: "single live intrauterine pregnancy", weight: 40 },
    { word: "ultrasound report", weight: 30 },
    { word: "active fetal movement", weight: 30 },
    { word: "tetanus toxoid vaccine", weight: 30 },
    { word: "iron & folic acid supplements", weight: 35 },
    { word: "prenatal checkup", weight: 30 },
    { word: "nagdadalang-tao", weight: 25 },
    { word: "buntis", weight: 20 },
    { word: "panganganak", weight: 20 },
    { word: "gravida", weight: 20 },
    { word: "para", weight: 15 },
    { word: "edc", weight: 20 },
    { word: "aog", weight: 20 },
    { word: "gestational age", weight: 20 }
  ],

  // Clinical Auxiliary: Medical Certificates & Fit-to-Work
  MEDICAL_CERTIFICATE: [
    { word: "medical certificate", weight: 45 },
    { word: "sertipikong medikal", weight: 40 },
    { word: "fit to work", weight: 35 },
    { word: "fit to study", weight: 35 },
    { word: "fit to school", weight: 35 },
    { word: "fit to resume", weight: 35 },
    { word: "this is to certify", weight: 30 },
    { word: "to whom it may concern", weight: 25 },
    { word: "physician's signature", weight: 30 },
    { word: "prc license no", weight: 25 },
    { word: "ptr no", weight: 25 },
    { word: "days of rest", weight: 25 }
  ]
};

const Classifier = {
  /**
   * Classify document text against Paete RHU's Centralized Record Binders.
   * @param {string} text - Raw or normalized OCR text extracted from document.
   * @returns {Object} Classification metadata, confidence, matched tokens, and audit justification.
   */
  classifyText(text, filename = '') {
    if (!text || typeof text !== 'string') {
      return {
        suggestedCategory: "CONSULTATION_RECORD",
        confidence: 0.0,
        confidenceLevel: "LOW",
        matchedTerms: [],
        alternativeCategory: null,
        reason: "No readable document text was provided. Defaulted to Consultation Record."
      };
    }

    const normalizedText = text.toLowerCase();
    const filenameLower = (filename || '').toLowerCase();
    const scores = {};
    const matchedTermsMap = {};

    // 1. Calculate weighted keyword scores
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      scores[category] = 0;
      matchedTermsMap[category] = [];

      for (const kw of keywords) {
        // Safe regex escaping for special characters
        const escaped = kw.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escaped}\\b|${escaped}`, 'gi');
        const matches = normalizedText.match(regex);
        if (matches) {
          scores[category] += kw.weight * matches.length;
          matchedTermsMap[category].push(kw.word);
        }
      }
    }

    // 2. High-Priority Document Header / Title & Filename Signature
    // Evaluates the top header block (where the official RHU title is printed) and file name
    const headerBlock = normalizedText.slice(0, 1000);

    const hasMedCertHeader = headerBlock.includes('medical certificate') || headerBlock.includes('sertipikong medikal') || filenameLower.includes('medical certificate') || filenameLower.includes('medcert');
    const hasItrHeader = headerBlock.includes('individual treatment record') || headerBlock.includes('20 years old and above') || headerBlock.includes('philhealth membership information') || headerBlock.includes('philhealth id number') || filenameLower.includes('treatment record') || filenameLower.includes('itr') || filenameLower.includes('back');
    const hasConsultHeader = headerBlock.includes('consultation & outpatient') || headerBlock.includes('consultation record') || (headerBlock.includes('consultation') && !hasMedCertHeader && !hasItrHeader) || filenameLower.includes('consultation');
    const hasChildhoodHeader = headerBlock.includes('routine childhood immunization') || headerBlock.includes('childhood immunization') || headerBlock.includes('child health record') || headerBlock.includes('baby book') || filenameLower.includes('immunization') || filenameLower.includes('vax');
    const hasMaternalHeader = headerBlock.includes('maternal care & prenatal') || headerBlock.includes('maternal care') || headerBlock.includes('prenatal record') || filenameLower.includes('maternal') || filenameLower.includes('prenatal');

    if (hasMedCertHeader) {
      scores['MEDICAL_CERTIFICATE'] = (scores['MEDICAL_CERTIFICATE'] || 0) + 5000;
      matchedTermsMap['MEDICAL_CERTIFICATE'] = matchedTermsMap['MEDICAL_CERTIFICATE'] || [];
      matchedTermsMap['MEDICAL_CERTIFICATE'].unshift('EXPLICIT HEADER: MEDICAL CERTIFICATE');
    } else if (hasItrHeader) {
      scores['PATIENT_INFORMATION_SHEET'] = (scores['PATIENT_INFORMATION_SHEET'] || 0) + 5000;
      matchedTermsMap['PATIENT_INFORMATION_SHEET'] = matchedTermsMap['PATIENT_INFORMATION_SHEET'] || [];
      matchedTermsMap['PATIENT_INFORMATION_SHEET'].unshift('EXPLICIT HEADER: INDIVIDUAL TREATMENT RECORD');
    } else if (hasMaternalHeader) {
      scores['MATERNAL_CARE_RECORD'] = (scores['MATERNAL_CARE_RECORD'] || 0) + 5000;
      matchedTermsMap['MATERNAL_CARE_RECORD'] = matchedTermsMap['MATERNAL_CARE_RECORD'] || [];
      matchedTermsMap['MATERNAL_CARE_RECORD'].unshift('EXPLICIT HEADER: MATERNAL CARE');
    } else if (hasChildhoodHeader) {
      scores['CHILDHOOD_IMMUNIZATION'] = (scores['CHILDHOOD_IMMUNIZATION'] || 0) + 5000;
      matchedTermsMap['CHILDHOOD_IMMUNIZATION'] = matchedTermsMap['CHILDHOOD_IMMUNIZATION'] || [];
      matchedTermsMap['CHILDHOOD_IMMUNIZATION'].unshift('EXPLICIT HEADER: CHILDHOOD IMMUNIZATION');
    } else if (hasConsultHeader) {
      scores['CONSULTATION_RECORD'] = (scores['CONSULTATION_RECORD'] || 0) + 5000;
      matchedTermsMap['CONSULTATION_RECORD'] = matchedTermsMap['CONSULTATION_RECORD'] || [];
      matchedTermsMap['CONSULTATION_RECORD'].unshift('EXPLICIT HEADER: CONSULTATION');
    }

    // 3. High-Precision Structural Body Signatures from reference_documents/
    const isITR = /philhealth membership information|lifestyle & risk factors|smoking cessation profile|past medical history|past surgical history|menstrual history|pregnancy history|20 years old and above/i.test(normalizedText);
    const isMaternal = /maternal care & prenatal|prenatal record sheet|prenatal visit log|fundal height|fetal heartbeat|single live intrauterine pregnancy/i.test(normalizedText);
    const isChildhood = /routine childhood immunization|childhood immunization|baby book|vaccination log|bcg vaccine|hepb birth dose|penta 1|oral polio|immunization details/i.test(normalizedText);
    const isConsult = /consultation & outpatient clinical record|clinical findings & diagnosis|prescription & treatment plan/i.test(normalizedText);
    const isMedCert = /medical certificate|sertipikong medikal|fit to work|fit to study|certificate of health|this is to certify/i.test(normalizedText);

    // Apply secondary structural boosts
    if (isITR) {
      scores['PATIENT_INFORMATION_SHEET'] = (scores['PATIENT_INFORMATION_SHEET'] || 0) + 600;
    } else if (isMaternal) {
      scores['MATERNAL_CARE_RECORD'] = (scores['MATERNAL_CARE_RECORD'] || 0) + 600;
    } else if (isChildhood) {
      scores['CHILDHOOD_IMMUNIZATION'] = (scores['CHILDHOOD_IMMUNIZATION'] || 0) + 600;
    } else if (isConsult) {
      scores['CONSULTATION_RECORD'] = (scores['CONSULTATION_RECORD'] || 0) + 600;
    } else if (isMedCert) {
      scores['MEDICAL_CERTIFICATE'] = (scores['MEDICAL_CERTIFICATE'] || 0) + 600;
    }

    // 3. Sort categories by score descending
    const sortedCategories = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const bestCategory = sortedCategories[0][0];
    const bestScore = sortedCategories[0][1];
    
    const alternativeCategory = sortedCategories[1] ? sortedCategories[1][0] : null;
    const alternativeScore = sortedCategories[1] ? sortedCategories[1][1] : 0;

    // 4. Compute confidence score with dampened alternative drag
    let confidence = 0.0;
    if (bestScore > 0) {
      const ratio = bestScore / (bestScore + (alternativeScore * 0.25));
      const magnitudeFactor = Math.min(1.0, bestScore / 8.0); 
      confidence = Math.min(0.99, parseFloat((ratio * magnitudeFactor).toFixed(2)));
    }

    // Determine confidence level
    let confidenceLevel = "LOW";
    if (confidence >= 0.85) {
      confidenceLevel = "HIGH";
    } else if (confidence >= 0.50) {
      confidenceLevel = "MEDIUM";
    }

    // 5. Grounded Human-Readable Justification referencing Paete RHU Reference Taxonomy
    const matchedTerms = matchedTermsMap[bestCategory] || [];
    const binderMap = {
      'PATIENT_INFORMATION_SHEET': 'RHU Centralized Binder 1: Individual Treatment Record (ITR)',
      'CONSULTATION_RECORD': 'RHU Centralized Binder 2: Consultation & Outpatient Clinical Record',
      'CHILDHOOD_IMMUNIZATION': 'RHU Centralized Binder 3: Routine Childhood Immunization (Baby Book)',
      'MATERNAL_CARE_RECORD': 'RHU Centralized Binder 4: Maternal Care & Prenatal Record Sheet',
      'MEDICAL_CERTIFICATE': 'RHU Clinical Auxiliary: Medical Certificate'
    };

    let reason = "";
    if (bestScore === 0) {
      reason = "No specific clinical keywords matched. Defaulted to Consultation Record.";
    } else {
      const uniqueTerms = Array.from(new Set(matchedTerms)).slice(0, 4);
      const binderLabel = binderMap[bestCategory] || bestCategory.replace(/_/g, ' ');
      reason = `Classified as [${binderLabel}] based on matched reference terms: [${uniqueTerms.join(', ')}].`;
      if (alternativeScore > 50 && alternativeCategory) {
        reason += ` Alternative matches found in ${alternativeCategory.replace(/_/g, ' ')}.`;
      }
    }

    return {
      suggestedCategory: bestCategory,
      confidence,
      confidenceLevel,
      matchedTerms: Array.from(new Set(matchedTerms)),
      alternativeCategory: alternativeScore > 50 ? alternativeCategory : null,
      reason
    };
  }
};

module.exports = Classifier;
