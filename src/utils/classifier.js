// Keep Up System - Explainable Document Classification Utility
// Rule-based classification utilizing weighted keyword scanning in English and Filipino.

const CATEGORY_KEYWORDS = {
  PATIENT_INFORMATION_SHEET: [
    { word: "information sheet", weight: 3 },
    { word: "patient information", weight: 3.5 },
    { word: "impormasyon", weight: 2 },
    { word: "personal data", weight: 2.5 },
    { word: "personal information", weight: 3 },
    { word: "civil status", weight: 2 },
    { word: "katayuan", weight: 2 },
    { word: "middle name", weight: 1.5 },
    { word: "religion", weight: 1.5 },
    { word: "nationality", weight: 1.5 },
    { word: "lahi", weight: 1.5 },
    { word: "occupation", weight: 2 },
    { word: "trabaho", weight: 1.5 },
    { word: "philhealth", weight: 2 },
    { word: "contact person", weight: 2 },
    { word: "emergency contact", weight: 2.5 },
    { word: "residential address", weight: 2.5 },
    { word: "tirahan", weight: 2 },
    { word: "birthday", weight: 1.5 },
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
  ANTI_RABIES_RECORD: [
    { word: "anti-rabies", weight: 5 },
    { word: "anti rabies", weight: 5 },
    { word: "rabies", weight: 4.5 },
    { word: "rabies vaccine", weight: 5 },
    { word: "rabies vaccination", weight: 5 },
    { word: "rabies immunization", weight: 5 },
    { word: "bite", weight: 3.5 },
    { word: "kagat", weight: 3.5 },
    { word: "exposure", weight: 2.5 },
    { word: "dog bite", weight: 4 },
    { word: "cat bite", weight: 4 },
    { word: "monkey bite", weight: 4 },
    { word: "bat bite", weight: 4 },
    { word: "aso", weight: 2 },
    { word: "pusa", weight: 2 },
    { word: "post-exposure", weight: 3 },
    { word: "pre-exposure", weight: 3 },
    { word: "prophylaxis", weight: 3.5 },
    { word: "vaccine site", weight: 2.5 },
    { word: "animal bite", weight: 4.5 },
    { word: "animal scratch", weight: 4 },
    { word: "gasgas ng hayop", weight: 4 },
    { word: "kalmot ng hayop", weight: 4 },
    { word: "rig", weight: 4 },
    { word: "erig", weight: 4.5 },
    { word: "hrig", weight: 4.5 },
    { word: "rabies immunoglobulin", weight: 5 },
    { word: "pcecv", weight: 4.5 },
    { word: "pvrv", weight: 4.5 },
    { word: "intradermal", weight: 2.5 },
    { word: "intramuscular", weight: 2.5 },
    { word: "category ii", weight: 3 },
    { word: "category iii", weight: 3 },
    { word: "washing", weight: 1.5 },
    { word: "wound cleaning", weight: 2.5 },
    { word: "linisin ang sugat", weight: 2.5 }
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
