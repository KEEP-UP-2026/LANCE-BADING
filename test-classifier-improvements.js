/**
 * Test Classifier Improvements
 * Tingnan kung mas accurate na ang classification
 */

const Classifier = require('./src/utils/classifier');

console.log('========================================');
console.log('   CLASSIFIER IMPROVEMENT TEST');
console.log('========================================\n');

// Test cases for Anti-Rabies
const testCases = [
  {
    name: 'Anti-Rabies Test 1: Basic rabies vaccine',
    text: 'Patient received rabies vaccine after dog bite. Post-exposure prophylaxis administered.',
    expected: 'ANTI_RABIES_RECORD'
  },
  {
    name: 'Anti-Rabies Test 2: With ERIG',
    text: 'Dog bite category III. ERIG given at wound site. Rabies immunization started.',
    expected: 'ANTI_RABIES_RECORD'
  },
  {
    name: 'Anti-Rabies Test 3: Filipino terms',
    text: 'May kagat ng aso. Binigyan ng anti-rabies vaccine. Gasgas ng hayop sa braso.',
    expected: 'ANTI_RABIES_RECORD'
  },
  {
    name: 'Anti-Rabies Test 4: Animal scratch',
    text: 'Patient has animal scratch from cat. Wound cleaning done. PVRV vaccine given.',
    expected: 'ANTI_RABIES_RECORD'
  },
  {
    name: 'Immunization Test 1: BCG vaccine',
    text: 'BCG vaccine administered. Routine childhood immunization. Baby book updated.',
    expected: 'IMMUNIZATION_RECORD'
  },
  {
    name: 'Immunization Test 2: DPT',
    text: 'DPT-HepB-HIB vaccine given. First dose. Pediatric vaccination.',
    expected: 'IMMUNIZATION_RECORD'
  },
  {
    name: 'Maternal Care Test 1: Prenatal',
    text: 'Prenatal checkup. Patient is pregnant, 2nd trimester. Gravida 2 Para 1.',
    expected: 'MATERNAL_CARE_RECORD'
  },
  {
    name: 'Maternal Care Test 2: Filipino',
    text: 'Buntis, nagdadalang-tao. Prenatal vitamins binigay. Ultrasound next week.',
    expected: 'MATERNAL_CARE_RECORD'
  },
  {
    name: 'Consultation Test 1: Regular checkup',
    text: 'General consultation. Chief complaint: fever and cough. Vital signs taken. Prescription given.',
    expected: 'CONSULTATION_RECORD'
  },
  {
    name: 'Patient Info Test 1: Basic info',
    text: 'Patient information sheet. Personal data: Full name, birthday, address, contact person, civil status, occupation.',
    expected: 'PATIENT_INFORMATION_SHEET'
  }
];

let passCount = 0;
let failCount = 0;

testCases.forEach((test, index) => {
  console.log(`TEST ${index + 1}: ${test.name}`);
  console.log(`Text: "${test.text.substring(0, 60)}..."`);
  
  const result = Classifier.classifyText(test.text);
  
  console.log(`Expected: ${test.expected}`);
  console.log(`Got: ${result.suggestedCategory}`);
  console.log(`Confidence: ${result.confidence} (${result.confidenceLevel})`);
  console.log(`Matched terms: [${result.matchedTerms.slice(0, 5).join(', ')}]`);
  console.log(`Reason: ${result.reason}`);
  
  if (result.suggestedCategory === test.expected) {
    console.log('✅ PASS\n');
    passCount++;
  } else {
    console.log('❌ FAIL');
    if (result.alternativeCategory) {
      console.log(`   Alternative: ${result.alternativeCategory}\n`);
    } else {
      console.log('');
    }
    failCount++;
  }
});

console.log('========================================');
console.log('   RESULTS SUMMARY');
console.log('========================================');
console.log(`Total Tests: ${testCases.length}`);
console.log(`✅ Passed: ${passCount}`);
console.log(`❌ Failed: ${failCount}`);
console.log(`Success Rate: ${((passCount / testCases.length) * 100).toFixed(1)}%`);
console.log('========================================\n');

if (passCount === testCases.length) {
  console.log('🎉 All tests passed! Classifier is working great!\n');
} else {
  console.log(`⚠️  ${failCount} test(s) failed. May need more keyword tuning.\n`);
}
