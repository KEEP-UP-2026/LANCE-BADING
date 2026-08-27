// Keep Up System - Explainable Document Classification Utility
// Rule-based classification utilizing weighted keyword scanning in English and Filipino.

const CATEGORY_KEYWORDS = {
  PATIENT_INFORMATION_SHEET: [
    { word: "individual treatment record", weight: 12 },
    { word: "individual treatment", weight: 8 },
    { word: "20 years old and above", weight: 10 },
    { word: "paete rural health unit", weight: 8 },
    { word: "philhealth membership information", weight: 15 },
    { word: "philhealth id number", weight: 15 },
    { word: "philhealth no", weight: 10 },
    { word: "past medical history", weight: 15 },
    { word: "past surgical history", weight: 15 },
    { word: "family history", weight: 12 },
    { word: "personal / social history", weight: 15 },
    { word: "personal/social history", weight: 15 },
    { word: "menstrual history", weight: 15 },
    { word: "pregnancy history", weight: 15 },
    { word: "child care", weight: 8 },
    { word: "animal bite", weight: 8 },
    { word: "ncd", weight: 6 },
    { word: "pack years", weight: 10 },
    { word: "bottles/day", weight: 10 },
    { word: "bottles per day", weight: 10 },
    { word: "highest bp", weight: 10 },
    { word: "coronary artery disease", weight: 8 },
    { word: "cerebrovascular disease", weight: 8 },
    { word: "epilepsy/seizure disorder", weight: 8 },
    { word: "peptic ulcer disease", weight: 8 },
    { word: "pulmonary tuberculosis", weight: 8 },
    { word: "extrapulmonary tuberculosis", weight: 8 },
    { word: "smoking cessation profile", weight: 8 },
    { word: "smokers?", weight: 8 },
    { word: "alcohol intake", weight: 7 },
    { word: "excessive alcohol intake", weight: 7 },
    { word: "high fat / high salt food intake", weight: 7 },
    { word: "dietary fiber intake", weight: 7 },
    { word: "physical activity", weight: 6 },
    { word: "ncd risk assessment done", weight: 10 },
    { word: "profiling of smoking cessation done", weight: 10 },
    { word: "educational attainment", weight: 6 },
    { word: "bhw", weight: 6 },
    { word: "raised bp", weight: 6 },
    { word: "itr form", weight: 6 },
    { word: "itr", weight: 5 },
    { word: "treatment record", weight: 5 },
    { word: "information sheet", weight: 4 },
    { word: "patient information", weight: 4 },
    { word: "impormasyon", weight: 2 },
    { word: "personal data", weight: 3 },
    { word: "personal information", weight: 3 },
    { word: "civil status", weight: 3 },
    { word: "katayuan", weight: 2 },
    { word: "middle name", weight: 1.5 },
    { word: "religion", weight: 1.5 },
    { word: "nationality", weight: 1.5 },
    { word: "lahi", weight: 1.5 },
    { word: "occupation", weight: 2 },
    { word: "trabaho", weight: 1.5 },
    { word: "philhealth", weight: 3 },
    { word: "contact person", weight: 2 },
    { word: "emergency contact", weight: 2.5 },
    { word: "residential address", weight: 2.5 },
    { word: "tirahan", weight: 2 },
    { word: "birthday", weight: 2 },
    { word: "kaarawan", weight: 1.5 },
    { word: "date of birth", weight: 2 },
    { word: "age", weight: 1 },
    { word: "edád", weight: 1 },
    { word: "marital status", weight: 2 },
    { word: "spouse", weight: 1.5 },
    { word: "asawa", weight: 1.5 }
  ],
  CONSULTATION_RECORD: [
    { word: "consultation", weight: 3 },
    { word: "konsulta", weight: 3 },
    { word: "check-up", weight: 2.5 },
    { word: "checkup", weight: 2.5 },
    { word: "diagnosis", weight: 3.5 },
    { word: "lunas", weight: 2 },
    { word: "prescription", weight: 3 },
    { word: "reseta", weight: 3 },
    { word: "vital signs", weight: 2.5 },
    { word: "blood pressure", weight: 2.5 },
    { word: "presyon", weight: 2 },
    { word: "temperature", weight: 1.5 },
    { word: "chief complaint", weight: 3.5 },
    { word: "sakit", weight: 1.5 },
    { word: "symptoms", weight: 2.5 },
    { word: "sintomas", weight: 2 },
    { word: "treatment", weight: 2 },
    { word: "gamot", weight: 2 },
    { word: "medication", weight: 2.5 },
    { word: "physician", weight: 2 },
    { word: "doctor notes", weight: 3.5 },
    { word: "follow-up", weight: 2 },
    { word: "laboratory", weight: 2 },
    { word: "lab result", weight: 2.5 },
    { word: "x-ray", weight: 2 },
    { word: "medical history", weight: 2.5 }
  ],
  IMMUNIZATION_RECORD: [
    { word: "immunization", weight: 4 },
    { word: "vaccination", weight: 3.5 },
    { word: "vaccine", weight: 3 },
    { word: "bakuna", weight: 3.5 },
    { word: "turok", weight: 2.5 },
    { word: "dose", weight: 2 },
    { word: "bcg", weight: 3.5 },
    { word: "dpt", weight: 3.5 },
    { word: "dpt-hepb-hib", weight: 3.5 },
    { word: "opv", weight: 3.5 },
    { word: "ipv", weight: 3.5 },
    { word: "hepa b", weight: 3.5 },
    { word: "hepa-b", weight: 3.5 },
    { word: "hepatitis b", weight: 3.5 },
    { word: "measles", weight: 3 },
    { word: "mmr", weight: 3.5 },
    { word: "tigdas", weight: 3 },
    { word: "rotavirus", weight: 3 },
    { word: "pneumococcal", weight: 3.5 },
    { word: "pcv", weight: 3 },
    { word: "influenza", weight: 3 },
    { word: "flu shot", weight: 3 },
    { word: "trangkaso", weight: 2.5 },
    { word: "baby book", weight: 3 },
    { word: "pediatric", weight: 2.5 },
    { word: "timbang", weight: 1.5 },
    { word: "antigen", weight: 2.5 },
    { word: "booster", weight: 2.5 },
    { word: "childhood immunization", weight: 4 },
    { word: "routine immunization", weight: 3.5 }
  ],
  MATERNAL_CARE_RECORD: [
    { word: "maternal", weight: 4.5 },
    { word: "pregnancy", weight: 4 },
    { word: "buntis", weight: 4 },
    { word: "prenatal", weight: 3.5 },
    { word: "obstetrics", weight: 3.5 },
    { word: "obgyn", weight: 3.5 },
    { word: "pregnant", weight: 3.5 },
    { word: "trimester", weight: 3.5 },
    { word: "fetal", weight: 3.5 },
    { word: "delivery", weight: 2.5 },
    { word: "panganganak", weight: 3 },
    { word: "lpm", weight: 3.5 },
    { word: "edc", weight: 3.5 },
    { word: "aog", weight: 3.5 },
    { word: "gestational", weight: 3 },
    { word: "tetanus toxoid", weight: 3.5 },
    { word: "nagdadalang-tao", weight: 4 },
    { word: "postpartum", weight: 3.5 },
    { word: "antenatal", weight: 3.5 },
    { word: "gravida", weight: 3.5 },
    { word: "para", weight: 2 },
    { word: "ultrasound", weight: 2.5 },
    { word: "fetal heartbeat", weight: 3.5 },
    { word: "fundal height", weight: 3 },
    { word: "amniotic", weight: 3 },
    { word: "labor", weight: 2.5 },
    { word: "contraction", weight: 2.5 },
    { word: "iron supplement", weight: 2.5 },
    { word: "prenatal vitamins", weight: 3 },
    { word: "cervical", weight: 2 }
  ],
  MEDICAL_CERTIFICATE: [
    { word: "medical certificate", weight: 5 },
    { word: "med cert", weight: 4.5 },
    { word: "medcert", weight: 4 },
    { word: "sertipikong medikal", weight: 4.5 },
    { word: "sertipiko", weight: 3 },
    { word: "certificate of health", weight: 4.5 },
    { word: "fit to work", weight: 4 },
    { word: "fit to school", weight: 4 },
    { word: "fit to study", weight: 4 },
    { word: "fit to resume", weight: 4 },
    { word: "sick leave", weight: 4 },
    { word: "rest for", weight: 3.5 },
    { word: "days of rest", weight: 3.5 },
    { word: "activity restriction", weight: 3.5 },
    { word: "prc license no", weight: 3.5 },
    { word: "ptr no", weight: 3.5 },
    { word: "ptr number", weight: 3.5 },
    { word: "attending physician", weight: 3 },
    { word: "physician's signature", weight: 3.5 },
    { word: "this is to certify", weight: 4.5 },
    { word: "to whom it may concern", weight: 3.5 }
  ]
};

const Classifier = {
  classifyText(text) {
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
    const scores = {};
    const matchedTermsMap = {};

    // 1. Calculate scores and gather matched terms
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      scores[category] = 0;
      matchedTermsMap[category] = [];

      for (const kw of keywords) {
        // Match term in lowercase text
        const regex = new RegExp(`\\b${kw.word}\\b|${kw.word}`, 'gi');
        const matches = normalizedText.match(regex);
        if (matches) {
          scores[category] += kw.weight * matches.length;
          matchedTermsMap[category].push(kw.word);
        }
      }
    }

    // Structural override: If text contains ITR section headers, boost PATIENT_INFORMATION_SHEET
    if (/PHILHEALTH MEMBERSHIP|PHILHEALTH ID|PAST MEDICAL HISTORY|PAST SURGICAL HISTORY|MENSTRUAL HISTORY|PREGNANCY HISTORY|INDIVIDUAL TREATMENT RECORD/i.test(normalizedText)) {
      scores['PATIENT_INFORMATION_SHEET'] = (scores['PATIENT_INFORMATION_SHEET'] || 0) + 100;
    }

    // 2. Sort categories by score descending
    const sortedCategories = Object.entries(scores)
      .sort((a, b) => b[1] - a[1]);

    const bestCategory = sortedCategories[0][0];
    const bestScore = sortedCategories[0][1];
    
    const alternativeCategory = sortedCategories[1] ? sortedCategories[1][0] : null;
    const alternativeScore = sortedCategories[1] ? sortedCategories[1][1] : 0;

    // 3. Compute confidence score
    let confidence = 0.0;
    if (bestScore > 0) {
      const ratio = bestScore / (bestScore + alternativeScore);
      // Reduce confidence for single weak keyword matches
      const magnitudeFactor = Math.min(1.0, bestScore / 6.0); 
      confidence = parseFloat((ratio * magnitudeFactor).toFixed(2));
    }

    // Determine confidence level
    let confidenceLevel = "LOW";
    if (confidence >= 0.80) {
      confidenceLevel = "HIGH";
    } else if (confidence >= 0.50) {
      confidenceLevel = "MEDIUM";
    }

    // 4. Formulate explainable matched terms list and explanation reason
    const matchedTerms = matchedTermsMap[bestCategory] || [];
    
    let reason = "";
    if (bestScore === 0) {
      reason = "No specific clinical keywords matched. System defaulted to Consultation Record.";
    } else {
      const uniqueTermsStr = matchedTerms.slice(0, 4).join(", ");
      reason = `Suggested based on document matches for key terms: [${uniqueTermsStr}].`;
      if (alternativeScore > 0) {
        reason += ` Alternative matches found in ${alternativeCategory.replace(/_/g, ' ')}.`;
      }
    }

    return {
      suggestedCategory: bestCategory,
      confidence,
      confidenceLevel,
      matchedTerms,
      alternativeCategory: alternativeScore > 0 ? alternativeCategory : null,
      reason
    };
  }
};

module.exports = Classifier;
