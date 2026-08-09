// Keep Up System - Fuzzy Patient Matcher Utility
// Calculates similarity scores and explanations using Jaro-Winkler distance and normalized demographic comparison.

// Calculates Jaro Distance between two strings
function getJaroSimilarity(s1, s2) {
  if (!s1 || !s2) return 0.0;
  if (s1 === s2) return 1.0;

  const len1 = s1.length;
  const len2 = s2.length;
  const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;

  const matches1 = new Array(len1).fill(false);
  const matches2 = new Array(len2).fill(false);

  let matchCount = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(len2 - 1, i + matchWindow);

    for (let j = start; j <= end; j++) {
      if (!matches2[j] && s1[i] === s2[j]) {
        matches1[i] = true;
        matches2[j] = true;
        matchCount++;
        break;
      }
    }
  }

  if (matchCount === 0) return 0.0;

  // Count transpositions
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (matches1[i]) {
      while (!matches2[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }
  }

  const m = matchCount;
  const t = transpositions / 2;

  return (m / len1 + m / len2 + (m - t) / m) / 3.0;
}

// Calculates Jaro-Winkler Similarity (gives weight to common prefixes)
function getJaroWinklerSimilarity(s1, s2) {
  const jaro = getJaroSimilarity(s1, s2);
  if (jaro < 0.7) return jaro;

  // Calculate common prefix length (up to 4 chars)
  let prefix = 0;
  const maxPrefix = Math.min(4, s1.length, s2.length);
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) {
      prefix++;
    } else {
      break;
    }
  }

  const p = 0.1; // Scaling factor
  return parseFloat((jaro + prefix * p * (1.0 - jaro)).toFixed(4));
}

// Normalizes name string (removes accents, punctuation, spacing)
function normalizeString(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD') // decomposes combined graphemes into raw letters + accents
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]/gi, '') // remove non-alphanumeric
    .trim();
}

const FuzzyMatcher = {
  comparePatients(p1, p2) {
    const normFirst1 = normalizeString(p1.first_name);
    const normFirst2 = normalizeString(p2.first_name);
    const normLast1 = normalizeString(p1.last_name);
    const normLast2 = normalizeString(p2.last_name);
    
    const normMiddle1 = normalizeString(p1.middle_name || '');
    const normMiddle2 = normalizeString(p2.middle_name || '');

    // 1. Calculate Jaro-Winkler similarities for names
    const simFirst = getJaroWinklerSimilarity(normFirst1, normFirst2);
    const simLast = getJaroWinklerSimilarity(normLast1, normLast2);

    // 2. Exact checks
    const otherBDate = new Date(p2.birth_date).toISOString().split('T')[0];
    const patientBDate = new Date(p1.birth_date).toISOString().split('T')[0];
    const isSameBirth = otherBDate === patientBDate;
    
    const isSameSex = p1.sex && p2.sex && p1.sex.toLowerCase() === p2.sex.toLowerCase();

    // PhilHealth check
    const isSamePhilHealth = p1.philhealth_number && p2.philhealth_number && 
      p1.philhealth_number.trim() !== '' && 
      p1.philhealth_number.replace(/-/g, '').trim() === p2.philhealth_number.replace(/-/g, '').trim();

    // Contact check
    const isSameContact = p1.contact_number && p2.contact_number &&
      p1.contact_number.trim() !== '' &&
      p1.contact_number.replace(/[^0-9]/g, '') === p2.contact_number.replace(/[^0-9]/g, '');

    // Address check
    const normAddr1 = normalizeString(p1.address || '');
    const normAddr2 = normalizeString(p2.address || '');
    const isSameAddress = normAddr1 && normAddr2 && (normAddr1 === normAddr2 || getJaroWinklerSimilarity(normAddr1, normAddr2) > 0.85);

    // Middle name difference check
    const hasDifferentMiddle = normMiddle1 && normMiddle2 && getJaroWinklerSimilarity(normMiddle1, normMiddle2) < 0.7;

    // 3. Compute likelihood score
    let score = 0;
    const reasons = [];

    // Rule A: PhilHealth number match (Direct identifier)
    if (isSamePhilHealth) {
      score = 98;
      reasons.push("PhilHealth identification number matches exactly.");
    } else {
      // Build score additively
      let nameScore = (simFirst * 40) + (simLast * 40); // Max 80 pts
      
      // Middle name modifier
      if (normMiddle1 && normMiddle2) {
        const simMiddle = getJaroWinklerSimilarity(normMiddle1, normMiddle2);
        nameScore = (simFirst * 30) + (simLast * 30) + (simMiddle * 20);
      } else if (p1.middle_name && p2.middle_name && p1.middle_name[0] && p2.middle_name[0]) {
        // Initials match check
        if (p1.middle_name[0].toLowerCase() === p2.middle_name[0].toLowerCase()) {
          nameScore += 5;
        }
      }

      score += nameScore;

      // Birth date modifier
      if (isSameBirth) {
        score += 15;
        reasons.push(`Birth date (${patientBDate}) matches exactly.`);
      } else {
        score -= 20; // penalize heavily if birth dates differ
      }

      // Sex modifier
      if (isSameSex) {
        score += 5;
      }

      // Contact modifier
      if (isSameContact) {
        score += 10;
        reasons.push("Contact numbers match exactly.");
      }

      // Address modifier
      if (isSameAddress) {
        score += 10;
        reasons.push("Residential addresses match or are highly similar.");
      }

      // Cap/normalize between 0 and 100
      score = Math.max(0, Math.min(100, Math.round(score)));
    }

    // Prevent false positives for common name matches
    if (!isSameBirth && !isSameContact && !isSamePhilHealth && !isSameAddress) {
      // If birth date, contact, PhilHealth, and address all differ/are empty, they are distinct people
      score = 0;
    }
    if (hasDifferentMiddle) {
      // Explicitly different middle names indicate distinct people
      score = 0;
    }

    // Name explanation
    if (score > 0) {
      if (simFirst > 0.85 && simLast > 0.85) {
        reasons.unshift(`First names are ${(simFirst * 100).toFixed(0)}% similar and last names are ${(simLast * 100).toFixed(0)}% similar.`);
      } else if (simFirst > 0.80 || simLast > 0.80) {
        reasons.push(`Name similarity shows weak correlation (First: ${(simFirst*100).toFixed(0)}%, Last: ${(simLast*100).toFixed(0)}%).`);
      }
    }

    // Determine likelihood level
    let level = "NONE";
    if (score >= 85) {
      level = "HIGH";
    } else if (score >= 65) {
      level = "MEDIUM";
    } else if (score >= 45) {
      level = "LOW";
    }

    return {
      isCandidate: score >= 45,
      score,
      level,
      explanation: score > 0 ? `Possible duplicate because: ${reasons.join(" ")}` : "Not a duplicate candidate."
    };
  }
};

module.exports = {
  getJaroWinklerSimilarity,
  normalizeString,
  FuzzyMatcher
};
