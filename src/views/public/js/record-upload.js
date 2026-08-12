let currentUser = null;
let patientId = '';
let selectedFile = null;
let currentToken = '';

document.addEventListener('DOMContentLoaded', async () => {
  const pathParts = window.location.pathname.split('/');
  patientId = pathParts[pathParts.length - 1];

  try {
    currentUser = await API.getCurrentUser();
    if (!currentUser) {
      showToast('Session expired. Please log in again.', 'error');
      window.location.href = '/login';
      return;
    }
    const fullName = currentUser.full_name || `${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim() || 'User';
    document.getElementById('layout-user-name').textContent = fullName;
    document.getElementById('layout-user-role').textContent = currentUser.role_name || currentUser.role || 'Staff';

    const initials = fullName
      .split(' ')
      .filter(Boolean)
      .map(n => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase() || 'US';

    document.getElementById('layout-user-initials').textContent = initials;
    document.getElementById('mobile-user-initials').textContent = initials;

    injectSidebarLinks(currentUser.role);
    await loadPatientSummary();
  } catch (err) {
    console.error('Failed to initialize user session:', err);
  }

  const uploadZone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('document');
  const filePreviewCard = document.getElementById('file-preview-card');
  const fileNameEl = document.getElementById('file-name');
  const fileSizeEl = document.getElementById('file-size');
  const removeFileBtn = document.getElementById('remove-file-btn');

  const uploadStage = document.getElementById('upload-stage');
  const enhancementStage = document.getElementById('enhancement-stage');
  const ocrLoaderPanel = document.getElementById('ocr-loader-panel');
  const reviewPanel = document.getElementById('review-panel');
  const enhancedPreviewImg = document.getElementById('enhanced-preview-img');
  const enhancementConfirmBtn = document.getElementById('enhancement-confirm-btn');
  const enhancementCancelBtn = document.getElementById('enhancement-cancel-btn');
  const ocrTitle = document.getElementById('ocr-status-title');
  const ocrSubtitle = document.getElementById('ocr-status-subtitle');

  const reviewFilename = document.getElementById('review-filename');
  const reviewCategory = document.getElementById('review-category');
  const reviewExtractedText = document.getElementById('review-extracted-text');
  const reviewConfidenceBadge = document.getElementById('review-confidence-badge');
  const reviewConfidenceLevel = document.getElementById('review-confidence-level');
  const reviewExplanationBanner = document.getElementById('review-explanation-banner');
  const reviewExplanationText = document.getElementById('review-explanation-text');

  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelection(e.target.files[0]);
    }
  });

  removeFileBtn.addEventListener('click', () => {
    selectedFile = null;
    fileInput.value = '';
    filePreviewCard.style.display = 'none';
    uploadZone.style.display = 'flex';
  });

  function handleFileSelection(file) {
    const allowedExtensions = ['png', 'jpg', 'jpeg', 'pdf'];
    const extension = file.name.split('.').pop().toLowerCase();

    if (!allowedExtensions.includes(extension)) {
      showToast('Only PNG, JPG, JPEG, and PDF documents are supported.', 'error');
      return;
    }

    selectedFile = file;
    fileNameEl.textContent = file.name;
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    fileSizeEl.textContent = `${sizeMb} MB`;

    uploadZone.style.display = 'none';
    filePreviewCard.style.display = 'flex';
  }

  document.getElementById('back-profile-btn').addEventListener('click', () => {
    window.location.href = `/dashboard/patients/profile/${patientId}`;
  });

  // STAGE 1: Submit file for Auto-Enhancement & Alignment Preview
  document.getElementById('record-upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      showToast('Please select a healthcare document file first.', 'error');
      return;
    }

    uploadStage.style.display = 'none';
    ocrLoaderPanel.style.display = 'flex';
    enhancementStage.style.display = 'none';
    reviewPanel.style.display = 'none';

    ocrTitle.textContent = 'Enhancing Document Quality & Alignment...';
    ocrSubtitle.textContent = 'Correcting text line tilt, sharpening handwriting, and tuning contrast. Please wait...';

    const formData = new FormData();
    formData.append('patient_id', patientId);
    formData.append('document', selectedFile);

    try {
      const res = await API.postForm('/api/records/enhance-preview', formData);

      if (res && res.success) {
        const preview = res.preview;
        currentToken = res.token;

        enhancedPreviewImg.src = preview.preview_url;

        const badgeAngle = document.getElementById('badge-angle');
        if (preview.angle_corrected && Math.abs(preview.angle_corrected) > 0.1) {
          badgeAngle.textContent = `Alignment: Rotated ${preview.angle_corrected}° Straight`;
          badgeAngle.style.background = 'rgba(34, 197, 94, 0.2)';
          badgeAngle.style.color = '#22c55e';
          badgeAngle.style.borderColor = 'rgba(34, 197, 94, 0.4)';
        } else {
          badgeAngle.textContent = 'Alignment: Perfectly Straight';
          badgeAngle.style.background = 'rgba(99, 102, 241, 0.15)';
          badgeAngle.style.color = '#818cf8';
          badgeAngle.style.borderColor = 'rgba(99, 102, 241, 0.3)';
        }

        const perspBadge = document.getElementById('badge-perspective');
        if (preview.perspective_corrected) {
          perspBadge.textContent = 'Perspective: Corrected';
          perspBadge.style.background = 'rgba(14, 165, 233, 0.15)';
          perspBadge.style.color = '#38bdf8';
          perspBadge.style.borderColor = 'rgba(14, 165, 233, 0.35)';
        } else {
          perspBadge.textContent = 'Perspective: Flat Scan';
          perspBadge.style.background = 'rgba(156, 163, 175, 0.1)';
          perspBadge.style.color = '#9ca3af';
          perspBadge.style.borderColor = 'rgba(156, 163, 175, 0.2)';
        }

        const bgBadge = document.getElementById('badge-bg-remove');
        if (preview.bg_removed) {
          bgBadge.textContent = 'Background: Removed';
          bgBadge.style.background = 'rgba(234, 179, 8, 0.15)';
          bgBadge.style.color = '#eab308';
          bgBadge.style.borderColor = 'rgba(234, 179, 8, 0.35)';
        } else {
          bgBadge.textContent = 'Background: Clean';
          bgBadge.style.background = 'rgba(156, 163, 175, 0.1)';
          bgBadge.style.color = '#9ca3af';
          bgBadge.style.borderColor = 'rgba(156, 163, 175, 0.2)';
        }

        const stageTitle = document.getElementById('enhancement-stage-title');
        const stageSub   = document.getElementById('enhancement-stage-subtitle');
        if (preview.perspective_corrected) {
          stageTitle.textContent = 'Document Scanned & Perspective Corrected';
          stageSub.textContent   = 'Tilted photo automatically flattened to a perfect scan. Review and confirm to extract text.';
        } else if (preview.angle_corrected && Math.abs(preview.angle_corrected) > 0.1) {
          stageTitle.textContent = 'Document Enhanced & Alignment Corrected';
          stageSub.textContent   = `Tilt of ${Math.abs(preview.angle_corrected)}° corrected. Review and confirm to extract text.`;
        } else {
          stageTitle.textContent = 'Document Enhanced & Ready';
          stageSub.textContent   = 'Clarity, contrast, and sharpness optimized. Review and confirm to extract text.';
        }

        ocrLoaderPanel.style.display = 'none';
        enhancementStage.style.display = 'block';

        const toastMsg = preview.perspective_corrected
          ? 'Perspective corrected — document flattened to a clean scan!'
          : preview.bg_removed
            ? 'Document enhanced, aligned & background removed!'
            : 'Document enhanced and alignment corrected!';
        showToast(toastMsg, 'success');
      }
    } catch (err) {
      showToast(err.message || 'An error occurred during image enhancement.', 'error');
      ocrLoaderPanel.style.display = 'none';
      uploadStage.style.display = 'block';
    }
  });

  // ─── Helper: extract field value from regex ───────────────────────────────
  function extractVal(text, pattern) {
    const match = text.match(pattern);
    return match && match[1] ? match[1].trim() : '';
  }

  // ─── High-Precision Regex Text Parser ────────────────────────────────────
  function populateFormFieldsFromExtractedText(text) {
    if (!text || typeof text !== 'string') return;

    function extractVal(pattern) {
      const match = text.match(pattern);
      return match && match[1] ? match[1].trim() : '';
    }

    function setField(id, val) {
      const el = document.getElementById(id);
      if (el && val !== undefined && val !== null && val !== '') {
        el.value = val;
      }
    }

    function setCheck(id, boolVal) {
      const el = document.getElementById(id);
      if (el) {
        el.checked = !!boolVal;
      }
    }

    // 1. DEMOGRAPHICS
    const nameVal        = extractVal(/NAME:\s*([^\n]+)/i);
    const philhealthVal  = extractVal(/Philhealth No\.:\s*([^\n]+)/i);
    const addressVal     = extractVal(/ADDRESS:\s*([^\n]+)/i);
    const civilVal       = extractVal(/Civil Status:\s*([^\n]+)/i);
    const bdayVal        = extractVal(/BIRTHDAY:\s*([^\n]+)/i);
    const ageVal         = extractVal(/Age:\s*(\d+)/i);
    const cpVal          = extractVal(/CP No:?\s*([^\n]+)/i);
    const eduVal         = extractVal(/Educational Attainment:\s*([^\n]+)/i);
    const bhwVal         = extractVal(/BHW:\s*([^\n]+)/i);

    setField('itr-field-name', nameVal);
    setField('itr-field-philhealth', philhealthVal);
    setField('itr-field-address', addressVal);
    setField('itr-field-civilstatus', civilVal);
    setField('itr-field-birthday', bdayVal);
    setField('itr-field-age', ageVal);
    setField('itr-field-cpno', cpVal);
    setField('itr-field-education', eduVal);
    setField('itr-field-bhw', bhwVal);

    // 2. SMOKING CESSATION PROFILE
    const smkSection = text.match(/Smoking Cessation Profile[\s\S]*?(?=Family History|Alcohol Intake|Physical Activity|$)/i);
    const smkText = smkSection ? smkSection[0] : text;

    setCheck('itr-smk-current', /Smokers\?[^:\n]*\[X\]\s*Current/i.test(smkText) || /Current/i.test(extractVal(/Smokers\?:?\s*([^\n]+)/i)));
    setCheck('itr-smk-passive', /Smokers\?[^:\n]*\[X\]\s*Passive/i.test(smkText));
    setCheck('itr-smk-never', /Smokers\?[^:\n]*\[X\]\s*Never/i.test(smkText));
    setCheck('itr-smk-gt1yr', /\[X\]\s*Stopped\s*>\s*a\s*year/i.test(smkText));
    setCheck('itr-smk-lt1yr', /\[X\]\s*Stopped\s*<\s*a\s*year/i.test(smkText));

    setField('itr-field-smoking-brand', extractVal(/Brand of Cigarette\??:\s*([^\n]+)/i));
    setField('itr-field-smoking-sticks', extractVal(/How many stick per day\??:\s*([^\n]+)/i));
    setField('itr-field-smoking-agestarted', extractVal(/Age started\??:\s*([^\n]+)/i));
    setField('itr-field-smoking-years', extractVal(/No of years smoking\??:\s*([^\n]+)/i));
    setField('itr-field-smoking-reason', extractVal(/Reason for smoking\??:\s*([^\n]+)/i));

    const smkSideYes = /side effect[^\n]*\[X\]\s*YES/i.test(text);
    const smkSideNo  = /side effect[^\n]*\[X\]\s*NO/i.test(text);
    setCheck('itr-smk-sideeffect-yes', smkSideYes);
    setCheck('itr-smk-sideeffect-no', smkSideNo);
    setField('itr-field-smoking-effect', extractVal(/What effect\??:\s*([^\n]+)/i));

    const smkQuitYes = /Try quitting before\??:\s*\[X\]\s*YES/i.test(text);
    const smkQuitNo  = /Try quitting before\??:\s*\[X\]\s*NO/i.test(text);
    setCheck('itr-smk-quit-yes', smkQuitYes);
    setCheck('itr-smk-quit-no', smkQuitNo);
    setField('itr-field-smoking-unsuccessful', extractVal(/why were not successful\??:\s*([^\n]+)/i));

    // 3. PHYSICAL ACTIVITY
    const paYes = /moderate intensity physical activity:\s*\[X\]\s*YES/i.test(text);
    const paNo  = /moderate intensity physical activity:\s*\[X\]\s*NO/i.test(text);
    setCheck('itr-pa-yes', paYes);
    setCheck('itr-pa-no', paNo);

    // 4. FAMILY HISTORY
    setCheck('itr-fh-htn', /\[X\]\s*Hypertension/i.test(text));
    setCheck('itr-fh-stroke', /\[X\]\s*Stroke/i.test(text));
    setCheck('itr-fh-heart', /\[X\]\s*Heart Attack/i.test(text));
    setCheck('itr-fh-dm', /\[X\]\s*DM/i.test(text));
    setCheck('itr-fh-asthma', /\[X\]\s*Asthma/i.test(text));
    setCheck('itr-fh-cancer', /\[X\]\s*Cancer/i.test(text));
    setCheck('itr-fh-kidney', /\[X\]\s*Kidney Disease/i.test(text));

    setField('itr-field-comorbid', extractVal(/Co-Morbid:\s*([^\n]+)/i) || extractVal(/Co-Morbid Allergy:\s*([^\n]+)/i));
    setField('itr-field-allergy', extractVal(/Allergy:\s*([^\n]+)/i) || 'None');

    // 5. ALCOHOL INTAKE
    setCheck('itr-alc-never', /\[X\]\s*Never Consumed/i.test(text));
    setCheck('itr-alc-yes', /\[X\]\s*Yes, drinks alcohol/i.test(text));

    const alcExcYes = /Excessive Alcohol Intake[^\n]*\[X\]\s*YES/i.test(text);
    const alcExcNo  = /Excessive Alcohol Intake[^\n]*\[X\]\s*NO/i.test(text);
    setCheck('itr-alc-excess-yes', alcExcYes);
    setCheck('itr-alc-excess-no', alcExcNo);

    // 6. HIGH FAT / HIGH SALT FOOD INTAKE
    const fatYes = /processed \/ Fast foods[^\n]*\[X\]\s*YES/i.test(text);
    const fatNo  = /processed \/ Fast foods[^\n]*\[X\]\s*NO/i.test(text);
    setCheck('itr-fat-yes', fatYes);
    setCheck('itr-fat-no', fatNo);

    // 7. DIETARY FIBER INTAKE
    const vegYes = /3 servings of vegetables daily:\s*\[X\]\s*YES/i.test(text);
    const vegNo  = /3 servings of vegetables daily:\s*\[X\]\s*NO/i.test(text);
    setCheck('itr-fiber-veg-yes', vegYes);
    setCheck('itr-fiber-veg-no', vegNo);

    const fruitYes = /2-3 servings of fruits daily:\s*\[X\]\s*YES/i.test(text);
    const fruitNo  = /2-3 servings of fruits daily:\s*\[X\]\s*NO/i.test(text);
    setCheck('itr-fiber-fruit-yes', fruitYes);
    setCheck('itr-fiber-fruit-no', fruitNo);

    // 8. VITAL SIGNS
    setField('itr-field-bmi', extractVal(/BMI:\s*([\d\.]+)/i));
    setField('itr-field-raisedbp', extractVal(/RAISED BP:\s*([^\n]+)/i));
    setField('itr-field-waist', extractVal(/WaistLine:\s*([^\n]+)/i).replace(/cm/i, '').trim());
    setField('itr-field-ht', extractVal(/HT:\s*([^\n]+)/i).replace(/cm/i, '').trim());
    setField('itr-field-wt', extractVal(/WEIGHT:\s*([^\n]+)/i).replace(/kg/i, '').trim());
    setField('itr-field-bp1', extractVal(/1st Reading:\s*([^\n]+)/i));
    setField('itr-field-bp2', extractVal(/2nd Reading:\s*([^\n]+)/i));

    // 9. CONSULTATION RECORDS TABLE
    const parsedConsultations = parseConsultationRecordsFromText(text);
    if (parsedConsultations && parsedConsultations.length > 0) {
      renderConsultationTableRows(parsedConsultations);
    }
  }

  // ─── Consultation Table ───────────────────────────────────────────────────
  function createConsultationRowHtml(rec) {
    rec = rec || {};
    const date = rec.date || '';
    const subj = rec.subjective_findings || '';

    let age = '', wt = '', ht = '', bp = '';
    if (typeof rec.objective_findings === 'object' && rec.objective_findings !== null) {
      const of = rec.objective_findings;
      age = of.age || '';
      wt  = of.weight_kg || of.wt || '';
      ht  = of.height_cm || of.ht || '';
      bp  = of.blood_pressure || of.bp || '';
    } else if (typeof rec.objective_findings === 'string') {
      const text = rec.objective_findings;
      age = (text.match(/AGE:\s*(\d+)/i) || [])[1] || '';
      wt  = (text.match(/WT:\s*([\d\.]+\s*kg|[\d\.]+)/i) || [])[1] || '';
      ht  = (text.match(/HT:\s*([\d\.]+\s*cm|[\d\.]+)/i) || [])[1] || '';
      bp  = (text.match(/BP:\s*([\d\/]+\s*mmHg|[\d\/]+)/i) || [])[1] || '';
    }

    const diag = Array.isArray(rec.assessment_diagnosis)
      ? rec.assessment_diagnosis.join('\n')
      : (rec.assessment_diagnosis || '');
    
    let plan = Array.isArray(rec.plan_treatment)
      ? rec.plan_treatment.join('\n')
      : (typeof rec.plan_treatment_plan === 'string'
          ? rec.plan_treatment_plan
          : (rec.plan_treatment_plan || {}).text || '');

    return `
      <tr class="consultation-row" style="border-bottom: 1px solid #cbd5e1;">
        <td style="padding: 8px; vertical-align: top; text-align: center;">
          <input type="text" class="consult-row-date" value="${date}" placeholder="e.g. May 20, 2024" style="width: 100%; text-align: center; font-weight: bold;">
        </td>
        <td style="padding: 8px; vertical-align: top;">
          <textarea class="consult-row-subj" rows="4" placeholder="Subjective findings..." style="width: 100%; border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px; font-size: 12px; font-family: inherit; box-sizing: border-box;">${subj}</textarea>
        </td>
        <td style="padding: 8px; vertical-align: top;">
          <table class="nested-risk-table" style="width: 100%; margin-bottom: 6px; font-size: 10.5px; border-collapse: collapse; border: 1px solid #cbd5e1;">
            <thead>
              <tr style="background: #e2e8f0; color: #0f172a;">
                <th style="padding: 3px 5px; border: 1px solid #cbd5e1; text-align: left;">Risk Level</th>
                <th style="padding: 3px 5px; border: 1px solid #cbd5e1; text-align: left;">Percentage of Risk</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style="padding: 2px 4px; border: 1px solid #cbd5e1;">Low</td><td style="padding: 2px 4px; border: 1px solid #cbd5e1;">&lt; 10%</td></tr>
              <tr><td style="padding: 2px 4px; border: 1px solid #cbd5e1;">Mild</td><td style="padding: 2px 4px; border: 1px solid #cbd5e1;">10% to &lt; 20%</td></tr>
              <tr><td style="padding: 2px 4px; border: 1px solid #cbd5e1;">Medium</td><td style="padding: 2px 4px; border: 1px solid #cbd5e1;">20% to &lt; 30%</td></tr>
              <tr><td style="padding: 2px 4px; border: 1px solid #cbd5e1;">High</td><td style="padding: 2px 4px; border: 1px solid #cbd5e1;">30% to &lt; 40%</td></tr>
              <tr><td style="padding: 2px 4px; border: 1px solid #cbd5e1;">Very High</td><td style="padding: 2px 4px; border: 1px solid #cbd5e1;">&ge; 40%</td></tr>
            </tbody>
          </table>
          <div style="font-size: 11.5px; line-height: 1.7; color: #0f172a;">
            <strong>AGE:</strong> <input type="text" class="consult-row-age" value="${age}" style="width: 40px; font-weight: bold;"><br>
            <strong>WT:</strong> <input type="text" class="consult-row-wt" value="${wt}" style="width: 55px; font-weight: bold;"><br>
            <strong>HT:</strong> <input type="text" class="consult-row-ht" value="${ht}" style="width: 55px; font-weight: bold;"><br>
            <strong>BP:</strong> <input type="text" class="consult-row-bp" value="${bp}" style="width: 75px; font-weight: bold;">
          </div>
        </td>
        <td style="padding: 8px; vertical-align: top;">
          <textarea class="consult-row-diag" rows="4" placeholder="Assessment / Diagnosis..." style="width: 100%; border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px; font-size: 12px; font-family: inherit; box-sizing: border-box;">${diag}</textarea>
        </td>
        <td style="padding: 8px; vertical-align: top;">
          <textarea class="consult-row-plan" rows="4" placeholder="Plan / Treatment..." style="width: 100%; border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px; font-size: 12px; font-family: inherit; box-sizing: border-box;">${plan}</textarea>
        </td>
        <td style="padding: 8px; vertical-align: top; text-align: center;">
          <button type="button" class="remove-consult-row-btn" onclick="this.closest('tr').remove()" style="background: transparent; border: none; color: #ef4444; cursor: pointer; padding: 6px; border-radius: 4px;" title="Remove Row">
            <svg style="width: 16px; height: 16px; fill: currentColor;" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </td>
      </tr>
    `;
  }

  function renderConsultationTableRows(records) {
    records = records || [];
    const tbody = document.getElementById('consultation-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!records || records.length === 0) {
      tbody.innerHTML = createConsultationRowHtml({});
      return;
    }

    records.forEach(rec => {
      tbody.insertAdjacentHTML('beforeend', createConsultationRowHtml(rec));
    });
  }

  function parseConsultationRecordsFromText(text) {
    if (!text || typeof text !== 'string') return [];
    const records = [];
    const dateBlocks = text.split(/(?=Date:\s*|Date\s*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|Date\s*:\s*[A-Z][a-z]+\s+\d+)/i);

    for (const block of dateBlocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;

      const dateMatch = trimmed.match(/Date:\s*([^\n]+)/i)
        || trimmed.match(/([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/i)
        || trimmed.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
      if (!dateMatch) continue;

      const date      = dateMatch[1].trim();
      const subjMatch = trimmed.match(/Subjective Findings:\s*([^\n]+(?:\n(?!Objective|Assessment|Plan|Date)[^\n]+)*)/i);
      const objMatch  = trimmed.match(/Objective Findings:\s*([\s\S]*?)(?=Assessment|Plan|Date|$)/i);
      const diagMatch = trimmed.match(/Assessment\/?Diagnosis:\s*([^\n]+(?:\n(?!Plan|Date)[^\n]+)*)/i);
      const planMatch = trimmed.match(/Plan\/?Treatment Plan:\s*([\s\S]*?)(?=Date|$)/i);

      const objText = objMatch ? objMatch[1].trim() : '';
      const age = (objText.match(/AGE:\s*(\d+)/i) || [])[1] || '';
      const wt  = (objText.match(/WT:\s*([\d\.]+\s*kg)/i) || [])[1] || '';
      const ht  = (objText.match(/HT:\s*([\d\.]+\s*cm)/i) || [])[1] || '';
      const bp  = (objText.match(/BP:\s*([\d\/]+\s*mmHg|[\d\/]+)/i) || [])[1] || '';

      const diagList = diagMatch ? diagMatch[1].split(',').map(s => s.trim()).filter(Boolean) : [];
      const planList = planMatch ? planMatch[1].split('\n').map(s => s.replace(/^[\s\-\*]+/, '').trim()).filter(Boolean) : [];

      records.push({
        date,
        subjective_findings: subjMatch ? subjMatch[1].trim() : '',
        objective_findings: {
          risk_table_present: true,
          age: age ? parseInt(age) : null,
          weight_kg: wt,
          height_cm: ht,
          blood_pressure: bp
        },
        assessment_diagnosis: diagList,
        plan_treatment: planList
      });
    }

    return records;
  }

  // ─── Convert Extracted Digital Text to Accurate JSON Schema ─────────────────
  function convertExtractedTextToAccurateJson(txt) {
    if (!txt || typeof txt !== 'string') return {};

    function splitSections(str) {
      const pattern = /===\s*(.*?)\s*===([\s\S]*?)(?====|$)/g;
      const sections = {};
      let match;
      while ((match = pattern.exec(str)) !== null) {
        sections[match[1].trim()] = match[2].trim();
      }
      return sections;
    }

    function getValue(block, label) {
      if (!block) return '';
      const cleanLabel = label.replace(/[?: ]+$/, '').trim();
      const escaped = cleanLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp('^[ \\t]*' + escaped + '[?: \\t]*([^\\n]*)$', 'im');
      const match = block.match(regex);
      return match && match[1] ? match[1].trim() : '';
    }

    function getNumber(val) {
      if (!val) return null;
      const match = String(val).match(/[\d.]+/);
      if (!match) return null;
      const num = parseFloat(match[0]);
      return isNaN(num) ? null : num;
    }

    function checkbox(block, label) {
      if (!block) return false;
      const escaped = label.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp('\\[X\\]\\s*' + escaped, 'i');
      return regex.test(block);
    }

    function parseHeader(block) {
      if (!block) return {};
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      return {
        country: lines[0] || '',
        province: lines[1] || '',
        municipality: lines[2] || '',
        facility: lines[3] || '',
        facility_address: lines[4] || '',
        form_title: lines[5] || '',
        age_group: lines[6] || ''
      };
    }

    function parsePatient(block) {
      if (!block) return {};
      const ageVal = getNumber(getValue(block, 'Age'));
      return {
        name: getValue(block, 'NAME'),
        philhealth_no: getValue(block, 'Philhealth No.'),
        address: getValue(block, 'ADDRESS'),
        civil_status: getValue(block, 'Civil Status'),
        birthday: getValue(block, 'BIRTHDAY'),
        age: ageVal !== null ? Math.round(ageVal) : 0,
        cp_no: getValue(block, 'CP No'),
        educational_attainment: getValue(block, 'Educational Attainment'),
        bhw: getValue(block, 'BHW')
      };
    }

    const sections = splitSections(txt);

    const header_block = sections['HEALTH FACILITY HEADER'] || '';
    const patient_block = sections['PATIENT DEMOGRAPHICS'] || '';

    const lifestyleKey = Object.keys(sections).find(k => k.includes('LIFESTYLE') || k.includes('SMOKING')) || 'LIFESTYLE & RISK FACTORS';
    const lifestyle_risk_block = sections[lifestyleKey] || '';

    const vitalsKey = Object.keys(sections).find(k => k.includes('VITAL')) || 'VITAL SIGNS & PHYSICAL MEASUREMENTS';
    const vitals_block = sections[vitalsKey] || '';

    const consultKey = Object.keys(sections).find(k => k.includes('CONSULTATION')) || 'CONSULTATION & CLINICAL FINDINGS';
    const consult_block = sections[consultKey] || '';

    const smk_st = checkbox(lifestyle_risk_block, 'Never') ? 'Never' : (checkbox(lifestyle_risk_block, 'Current') ? 'Current' : (checkbox(lifestyle_risk_block, 'Passive') ? 'Passive' : (checkbox(lifestyle_risk_block, 'Stopped > a year') ? 'Stopped > 1 year' : (checkbox(lifestyle_risk_block, 'Stopped < a year') ? 'Stopped < 1 year' : ''))));
    const hasSmkCheck = checkbox(lifestyle_risk_block, 'Current') || checkbox(lifestyle_risk_block, 'Passive') || checkbox(lifestyle_risk_block, 'Never') || checkbox(lifestyle_risk_block, 'Stopped > a year') || checkbox(lifestyle_risk_block, 'Stopped < a year');

    const exp_yes = lifestyle_risk_block.includes('Have you experienced side effect') && checkbox(lifestyle_risk_block.split('Have you experienced side effect')[1].split('\n')[0], 'YES');
    const exp_no  = lifestyle_risk_block.includes('Have you experienced side effect') && checkbox(lifestyle_risk_block.split('Have you experienced side effect')[1].split('\n')[0], 'NO');

    const quit_yes = lifestyle_risk_block.includes('Try quitting before') && checkbox(lifestyle_risk_block.split('Try quitting before')[1].split('\n')[0], 'YES');
    const quit_no  = lifestyle_risk_block.includes('Try quitting before') && checkbox(lifestyle_risk_block.split('Try quitting before')[1].split('\n')[0], 'NO');

    const smoking = {
      smoker_status: smk_st,
      options: {
        current: checkbox(lifestyle_risk_block, 'Current') ? true : (hasSmkCheck ? false : null),
        passive: checkbox(lifestyle_risk_block, 'Passive') ? true : (hasSmkCheck ? false : null),
        never: checkbox(lifestyle_risk_block, 'Never') ? true : (hasSmkCheck ? false : null),
        stopped_gt_1_year: checkbox(lifestyle_risk_block, 'Stopped > a year') ? true : (hasSmkCheck ? false : null),
        stopped_lt_1_year: checkbox(lifestyle_risk_block, 'Stopped < a year') ? true : (hasSmkCheck ? false : null)
      },
      brand_of_cigarette: getValue(lifestyle_risk_block, 'Brand of Cigarette'),
      sticks_per_day: getNumber(getValue(lifestyle_risk_block, 'How many stick per day')),
      age_started: getNumber(getValue(lifestyle_risk_block, 'Age started')),
      years_smoking: getNumber(getValue(lifestyle_risk_block, 'No of years smoking')),
      reason_for_smoking: getValue(lifestyle_risk_block, 'Reason for smoking'),
      experienced_side_effects: exp_yes ? true : (exp_no ? false : null),
      side_effect_details: getValue(lifestyle_risk_block, 'If yes, What effect'),
      tried_quitting_before: quit_yes ? true : (quit_no ? false : null),
      quit_attempt_success: null,
      reason_not_successful: getValue(lifestyle_risk_block, 'If yes, why were not successful')
    };

    const hasFhCheck = checkbox(lifestyle_risk_block, 'Hypertension') || checkbox(lifestyle_risk_block, 'Stroke') || checkbox(lifestyle_risk_block, 'Heart Attack') || checkbox(lifestyle_risk_block, 'DM') || checkbox(lifestyle_risk_block, 'Asthma') || checkbox(lifestyle_risk_block, 'Cancer') || checkbox(lifestyle_risk_block, 'Kidney Disease');

    const family = {
      has_1st_degree_relative: hasFhCheck ? true : null,
      hypertension: checkbox(lifestyle_risk_block, 'Hypertension') ? true : (hasFhCheck ? false : null),
      stroke: checkbox(lifestyle_risk_block, 'Stroke') ? true : (hasFhCheck ? false : null),
      heart_attack: checkbox(lifestyle_risk_block, 'Heart Attack') ? true : (hasFhCheck ? false : null),
      dm: checkbox(lifestyle_risk_block, 'DM') ? true : (hasFhCheck ? false : null),
      asthma: checkbox(lifestyle_risk_block, 'Asthma') ? true : (hasFhCheck ? false : null),
      cancer: checkbox(lifestyle_risk_block, 'Cancer') ? true : (hasFhCheck ? false : null),
      kidney_disease: checkbox(lifestyle_risk_block, 'Kidney Disease') ? true : (hasFhCheck ? false : null)
    };

    const clinical = {
      co_morbid: getValue(lifestyle_risk_block, 'Co-Morbid'),
      allergy: getValue(lifestyle_risk_block, 'Allergy')
    };

    const excMatch = lifestyle_risk_block.match(/Excessive Alcohol Intake.*/i);
    const excText = excMatch ? excMatch[0] : '';
    const excDefMatch = excText.match(/\((.*?)\)/);

    const hasAlcCheck = checkbox(lifestyle_risk_block, 'Never Consumed') || checkbox(lifestyle_risk_block, 'Yes, drinks alcohol');
    const hasExcCheck = checkbox(excText, 'YES') || checkbox(excText, 'NO');

    const alcohol_intake = {
      never_consumed: checkbox(lifestyle_risk_block, 'Never Consumed') ? true : (hasAlcCheck ? false : null),
      drinks_alcohol: checkbox(lifestyle_risk_block, 'Yes, drinks alcohol') ? true : (hasAlcCheck ? false : null),
      excessive_alcohol_intake: {
        definition: excDefMatch ? excDefMatch[1] : 'In the past mos., had 5 drinks in one occasion',
        yes: checkbox(excText, 'YES') ? true : (hasExcCheck ? false : null),
        no: checkbox(excText, 'NO') ? true : (hasExcCheck ? false : null)
      }
    };

    const paMatch = lifestyle_risk_block.match(/Does at least 2 1\/2 hours.*/i);
    const paText = paMatch ? paMatch[0] : '';

    const fatMatch = lifestyle_risk_block.match(/Eats processed.*/i);
    const fatText = fatMatch ? fatMatch[0] : '';

    const vegMatch = lifestyle_risk_block.match(/3 servings of vegetables daily.*/i);
    const vegText = vegMatch ? vegMatch[0] : '';

    const fruitMatch = lifestyle_risk_block.match(/2-3 servings of fruits daily.*/i);
    const fruitText = fruitMatch ? fruitMatch[0] : '';

    const diet_and_lifestyle = {
      physical_activity: {
        meets_2_5_hours_per_week: checkbox(paText, 'YES') ? true : (checkbox(paText, 'NO') ? false : null)
      },
      high_fat_high_salt_food_intake: {
        weekly_processed_fastfood: checkbox(fatText, 'YES') ? true : (checkbox(fatText, 'NO') ? false : null)
      },
      dietary_fiber_intake: {
        vegetables_3_servings_daily: checkbox(vegText, 'YES') ? true : (checkbox(vegText, 'NO') ? false : null),
        fruits_2_3_servings_daily: checkbox(fruitMatch ? fruitMatch[0] : '', 'YES') ? true : (checkbox(fruitMatch ? fruitMatch[0] : '', 'NO') ? false : null)
      }
    };

    function parseVitals(block) {
      if (!block) return {};
      const raisedBpText = getValue(block, 'RAISED BP').toLowerCase();
      const raisedBp = raisedBpText.includes('yes') ? true : (raisedBpText.includes('no') ? false : null);
      return {
        bmi: getNumber(getValue(block, 'BMI')),
        waistline_cm: getNumber(getValue(block, 'WaistLine')),
        height_cm: getNumber(getValue(block, 'HT')),
        weight_kg: getNumber(getValue(block, 'WEIGHT')),
        raised_bp: raisedBp,
        blood_pressure_readings: {
          first: getValue(block, '1ST READING') || getValue(block, '1st Reading'),
          second: getValue(block, '2ND READING') || getValue(block, '2nd Reading')
        }
      };
    }

    function parseConsultation(block) {
      if (!block) return [];
      const entries = block.split(/Date:/i).slice(1);
      const results = [];

      for (const entry of entries) {
        const lines = entry.trim().split('\n');
        const date = lines[0] ? lines[0].trim() : '';

        const subj = getValue(entry, 'Subjective Findings');

        const ageMatch = entry.match(/AGE:\s*(\d+)/i);
        const wtMatch  = entry.match(/WT:\s*(\d+)/i);
        const htMatch  = entry.match(/HT:\s*(\d+)/i);
        const bpMatch  = entry.match(/BP:\s*([\d/]+\s*mmHg)/i);

        const age = ageMatch ? getNumber(ageMatch[1]) : null;
        const wt  = wtMatch ? getNumber(wtMatch[1]) : null;
        const ht  = htMatch ? getNumber(htMatch[1]) : null;
        const bp  = bpMatch ? bpMatch[1] : '';

        const diagMatch = entry.match(/Assessment Diagnosis:\s*([\s\S]*?)Plan\//i) || entry.match(/Assessment\/Diagnosis:\s*([\s\S]*?)Plan\//i);
        let diagnosis = [];
        if (diagMatch && diagMatch[1]) {
          diagnosis = diagMatch[1]
            .split('\n')
            .map(d => d.replace(/^[-,\s]+/, '').trim())
            .filter(Boolean);
        }

        const planMatch = entry.match(/Plan\/\s*Treatment Plan:\s*([\s\S]*)/i) || entry.match(/Plan\/Treatment Plan:\s*([\s\S]*)/i);
        let plan = [];
        if (planMatch && planMatch[1]) {
          plan = planMatch[1]
            .split('\n')
            .map(p => p.replace(/^[-,\s]+/, '').trim())
            .filter(Boolean);
        }

        results.push({
          date: date,
          subjective_findings: subj,
          objective_findings: {
            age: age !== null ? Math.round(age) : null,
            weight_kg: wt !== null ? Math.round(wt) : null,
            height_cm: ht !== null ? Math.round(ht) : null,
            blood_pressure: bp
          },
          assessment_diagnosis: diagnosis,
          plan_treatment: plan
        });
      }

      return results;
    }

    return {
      header: parseHeader(header_block),
      patient_demographics: parsePatient(patient_block),
      smoking_cessation_profile: smoking,
      family_history: family,
      clinical_background: clinical,
      alcohol_intake: alcohol_intake,
      diet_and_lifestyle: diet_and_lifestyle,
      vital_signs: parseVitals(vitals_block),
      consultation_records: parseConsultation(consult_block)
    };
  }

  // ─── Format Structured ITR JSON into Exact Standard Template Text ─────────────
  function formatItrToStandardTemplate(data) {
    if (!data || typeof data !== 'object') return "";

    const h = data.header || {};
    const d = data.patient_demographics || {};
    const sc = data.smoking_cessation_profile || {};
    const fh = data.family_history || {};
    const cb = data.clinical_background || {};
    const alc = data.alcohol_intake || {};
    const alc_exc = alc.excessive_alcohol_intake || {};
    const dl = data.diet_and_lifestyle || {};
    const pa = dl.physical_activity || {};
    const fat = dl.high_fat_high_salt_food_intake || {};
    const fiber = dl.dietary_fiber_intake || {};
    const vs = data.vital_signs || {};
    const bpr = vs.blood_pressure_readings || {};
    const crs = data.consultation_records || [];

    function chk(val) {
      return val === true ? '[x]' : '[ ]';
    }

    function opt(status, target) {
      return status === target ? '[x]' : '[ ]';
    }

    const lines = [];
    lines.push('=== HEALTH FACILITY HEADER ===');
    lines.push(h.country || 'Republic of the Philippines');
    lines.push(h.province || 'Province of Laguna');
    lines.push(h.municipality || 'Municipality of Paete');
    lines.push(h.facility || 'PAETE RURAL HEALTH UNIT');
    lines.push(h.facility_address || '2436 F. Sano Street, Brgy. Mayloong, Paete, Laguna');
    lines.push(h.form_title || 'Individual Treatment Record');
    lines.push(h.age_group || '20 Years old and above');
    lines.push('');

    lines.push('=== PATIENT DEMOGRAPHICS ===');
    lines.push(`NAME: ${d.name || ''}`);
    lines.push(`Philhealth No.: ${d.philhealth_no || ''}`);
    lines.push(`ADDRESS: ${d.address || ''}`);
    lines.push(`Civil Status: ${d.civil_status || ''}`);
    lines.push(`BIRTHDAY: ${d.birthday || ''}`);
    lines.push(`Age: ${d.age !== undefined && d.age !== null ? d.age : ''}`);
    lines.push(`CP No: ${d.cp_no || ''}`);
    lines.push(`Educational Attainment: ${d.educational_attainment || ''}`);
    lines.push(`BHW: ${d.bhw || ''}`);
    lines.push('');

    lines.push('=== LIFESTYLE & RISK FACTORS ===');
    lines.push('Smoking Cessation Profile:');
    const smk_st = sc.smoker_status || '';
    lines.push(`Smokers? ${opt(smk_st, 'Current')} Current  ${opt(smk_st, 'Passive')} Passive  ${opt(smk_st, 'Never')} Never  ${opt(smk_st, 'Stopped > 1 year')} Stopped > a year  ${opt(smk_st, 'Stopped < 1 year')} Stopped < a year`);
    lines.push(`Brand of Cigarette?: ${sc.brand_of_cigarette || ''}`);
    lines.push(`How many stick per day?: ${sc.sticks_per_day !== undefined && sc.sticks_per_day !== null ? sc.sticks_per_day : ''}`);
    lines.push(`Age started?: ${sc.age_started !== undefined && sc.age_started !== null ? sc.age_started : ''}`);
    lines.push(`No of years smoking?: ${sc.years_smoking !== undefined && sc.years_smoking !== null ? sc.years_smoking : ''}`);
    lines.push(`Reason for smoking?: ${sc.reason_for_smoking || ''}`);
    lines.push(`Have you experienced side effect or illness brought by smoking?: ${chk(sc.experienced_side_effects === true)} YES  ${chk(sc.experienced_side_effects === false)} NO`);
    lines.push(`If yes, What effect?: ${sc.side_effect_details || ''}`);
    lines.push(`Try quitting before?: ${chk(sc.tried_quitting_before === true)} YES  ${chk(sc.tried_quitting_before === false)} NO`);
    lines.push(`If yes, why were not successful?: ${sc.reason_not_successful || ''}`);
    lines.push('');

    lines.push('Family History (does pt. have 1st degree relative with):');
    lines.push(`${chk(fh.hypertension)} Hypertension  ${chk(fh.stroke)} Stroke  ${chk(fh.heart_attack)} Heart Attack  ${chk(fh.dm)} DM  ${chk(fh.asthma)} Asthma  ${chk(fh.cancer)} Cancer  ${chk(fh.kidney_disease)} Kidney Disease`);
    lines.push(`Co-Morbid: ${cb.co_morbid || ''}`);
    lines.push(`Allergy: ${cb.allergy || ''}`);
    lines.push('');

    lines.push('Alcohol Intake:');
    lines.push(`${chk(alc.never_consumed)} Never Consumed`);
    lines.push(`${chk(alc.drinks_alcohol)} Yes, drinks alcohol`);
    lines.push(`Excessive Alcohol Intake (In the past mos., had 3 drinks in one occasion): ${chk(alc_exc.yes)} YES  ${chk(alc_exc.no)} NO`);
    lines.push('');

    lines.push('Physical Activity:');
    lines.push(`Does at least 2 1/2 hours a week of moderate intensity physical activity: ${chk(pa.meets_2_5_hours_per_week === true)} YES  ${chk(pa.meets_2_5_hours_per_week === false)} NO`);
    lines.push('');

    lines.push('High Fat / High Salt Food Intake:');
    lines.push(`Eats processed / Fast foods and inihaw weekly: ${chk(fat.weekly_processed_fastfood === true)} YES  ${chk(fat.weekly_processed_fastfood === false)} NO`);
    lines.push('');

    lines.push('Dietary Fiber Intake:');
    lines.push(`3 servings of vegetables daily: ${chk(fiber.vegetables_3_servings_daily === true)} YES  ${chk(fiber.vegetables_3_servings_daily === false)} NO`);
    lines.push(`2-3 servings of fruits daily: ${chk(fiber.fruits_2_3_servings_daily === true)} YES  ${chk(fiber.fruits_2_3_servings_daily === false)} NO`);
    lines.push('');

    lines.push('=== VITAL SIGNS & PHYSICAL MEASUREMENTS ===');
    lines.push(`BMI: ${vs.bmi !== undefined && vs.bmi !== null ? vs.bmi : ''}`);
    const rbp = vs.raised_bp;
    lines.push(`RAISED BP: ${rbp === true ? 'Yes' : (rbp === false ? 'No' : '')}`);
    lines.push(`WaistLine: ${vs.waistline_cm !== undefined && vs.waistline_cm !== null ? vs.waistline_cm : ''}`);
    lines.push(`HT: ${vs.height_cm !== undefined && vs.height_cm !== null ? vs.height_cm : ''}`);
    lines.push(`1st Reading: ${bpr.first || ''}`);
    lines.push(`WEIGHT: ${vs.weight_kg !== undefined && vs.weight_kg !== null ? vs.weight_kg : ''}`);
    lines.push(`2nd Reading: ${bpr.second || ''}`);
    lines.push('');

    lines.push('=== CONSULTATION & CLINICAL FINDINGS ===');
    for (const c of crs) {
      const obj = c.objective_findings || {};
      lines.push(`Date: ${c.date || ''}`);
      lines.push(`Subjective Findings: ${c.subjective_findings || ''}`);
      lines.push('Objective Findings:');
      lines.push(`  Risk Level: ${obj.risk_level || ''}`);
      lines.push(`  Percentage of Risk: ${obj.percentage_of_risk || ''}`);
      lines.push(`  AGE: ${obj.age !== undefined && obj.age !== null ? obj.age : ''}`);
      lines.push(`  WT: ${obj.weight_kg !== undefined && obj.weight_kg !== null ? obj.weight_kg : ''}`);
      lines.push(`  HT: ${obj.height_cm !== undefined && obj.height_cm !== null ? obj.height_cm : ''}`);
      lines.push(`  BP: ${obj.blood_pressure || ''}`);
      const diagStr = Array.isArray(c.assessment_diagnosis) ? c.assessment_diagnosis.join(', ') : (c.assessment_diagnosis || '');
      lines.push(`Assessment/Diagnosis: ${diagStr}`);
      const planStr = Array.isArray(c.plan_treatment) ? c.plan_treatment.join(', ') : (c.plan_treatment || '');
      lines.push(`Plan/Treatment Plan: ${planStr}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  // ─── Populate Information Form Fields Directly from Structured JSON ────────
  function populateFormFieldsFromJson(data) {
    if (!data || typeof data !== 'object') return;

    function setField(id, val) {
      const el = document.getElementById(id);
      if (el) {
        el.value = (val !== undefined && val !== null) ? val : '';
      }
    }

    function setCheck(id, boolVal) {
      const el = document.getElementById(id);
      if (el) {
        el.checked = !!boolVal;
      }
    }

    // 1. DEMOGRAPHICS
    const d = data.patient_demographics || {};
    setField('itr-field-name', d.name || '');
    setField('itr-field-philhealth', d.philhealth_no || '');
    setField('itr-field-address', d.address || '');
    setField('itr-field-civilstatus', d.civil_status || '');
    setField('itr-field-birthday', d.birthday || '');
    setField('itr-field-age', d.age !== undefined && d.age !== null ? d.age : '');
    setField('itr-field-cpno', d.cp_no || '');
    setField('itr-field-education', d.educational_attainment || '');
    setField('itr-field-bhw', d.bhw || '');

    // 2. SMOKING CESSATION PROFILE
    const sc = data.smoking_cessation_profile || {};
    const opts = sc.options || {};
    const smkSt = sc.smoker_status || '';
    setCheck('itr-smk-current', opts.current || smkSt === 'Current');
    setCheck('itr-smk-passive', opts.passive || smkSt === 'Passive');
    setCheck('itr-smk-never', opts.never || smkSt === 'Never');
    setCheck('itr-smk-gt1yr', opts.stopped_gt_1_year || (typeof smkSt === 'string' && smkSt.includes('>')));
    setCheck('itr-smk-lt1yr', opts.stopped_lt_1_year || (typeof smkSt === 'string' && smkSt.includes('<')));

    setField('itr-field-smoking-brand', sc.brand_of_cigarette || '');
    setField('itr-field-smoking-sticks', sc.sticks_per_day !== undefined && sc.sticks_per_day !== null ? sc.sticks_per_day : '');
    setField('itr-field-smoking-agestarted', sc.age_started !== undefined && sc.age_started !== null ? sc.age_started : '');
    setField('itr-field-smoking-years', sc.years_smoking !== undefined && sc.years_smoking !== null ? sc.years_smoking : '');
    setField('itr-field-smoking-reason', sc.reason_for_smoking || '');

    setCheck('itr-smk-sideeffect-yes', sc.experienced_side_effects === true);
    setCheck('itr-smk-sideeffect-no', sc.experienced_side_effects === false);
    setField('itr-field-smoking-effect', sc.side_effect_details || '');

    setCheck('itr-smk-quit-yes', sc.tried_quitting_before === true);
    setCheck('itr-smk-quit-no', sc.tried_quitting_before === false);
    setField('itr-field-smoking-unsuccessful', sc.reason_not_successful || '');

    // 3. PHYSICAL ACTIVITY
    const dl = data.diet_and_lifestyle || {};
    const pa = dl.physical_activity || {};
    setCheck('itr-pa-yes', pa.meets_2_5_hours_per_week === true);
    setCheck('itr-pa-no', pa.meets_2_5_hours_per_week === false);

    // 4. FAMILY HISTORY & CLINICAL
    const fh = data.family_history || {};
    setCheck('itr-fh-htn', fh.hypertension === true);
    setCheck('itr-fh-stroke', fh.stroke === true);
    setCheck('itr-fh-heart', fh.heart_attack === true);
    setCheck('itr-fh-dm', fh.dm === true);
    setCheck('itr-fh-asthma', fh.asthma === true);
    setCheck('itr-fh-cancer', fh.cancer === true);
    setCheck('itr-fh-kidney', fh.kidney_disease === true);

    const cb = data.clinical_background || {};
    setField('itr-field-comorbid', cb.co_morbid || '');
    setField('itr-field-allergy', cb.allergy || '');

    // 5. ALCOHOL INTAKE
    const alc = data.alcohol_intake || {};
    const alcExc = alc.excessive_alcohol_intake || {};
    setCheck('itr-alc-never', alc.never_consumed === true);
    setCheck('itr-alc-yes', alc.drinks_alcohol === true);
    setCheck('itr-alc-excess-yes', alcExc.yes === true);
    setCheck('itr-alc-excess-no', alcExc.no === true);

    // 6. HIGH FAT & FIBER
    const fat = dl.high_fat_high_salt_food_intake || {};
    setCheck('itr-fat-yes', fat.weekly_processed_fastfood === true);
    setCheck('itr-fat-no', fat.weekly_processed_fastfood === false);

    const fiber = dl.dietary_fiber_intake || {};
    setCheck('itr-fiber-veg-yes', fiber.vegetables_3_servings_daily === true);
    setCheck('itr-fiber-veg-no', fiber.vegetables_3_servings_daily === false);
    setCheck('itr-fiber-fruit-yes', fiber.fruits_2_3_servings_daily === true);
    setCheck('itr-fiber-fruit-no', fiber.fruits_2_3_servings_daily === false);

    // 7. VITAL SIGNS
    const vs = data.vital_signs || {};
    const bpr = vs.blood_pressure_readings || {};
    setField('itr-field-bmi', vs.bmi !== undefined && vs.bmi !== null ? vs.bmi : '');
    setField('itr-field-raisedbp', vs.raised_bp === true ? 'Yes' : (vs.raised_bp === false ? 'No' : ''));
    setField('itr-field-waist', vs.waistline_cm !== undefined && vs.waistline_cm !== null ? vs.waistline_cm : '');
    setField('itr-field-ht', vs.height_cm !== undefined && vs.height_cm !== null ? vs.height_cm : '');
    setField('itr-field-wt', vs.weight_kg !== undefined && vs.weight_kg !== null ? vs.weight_kg : '');
    setField('itr-field-bp1', bpr.first || '');
    setField('itr-field-bp2', bpr.second || '');

    // 8. CONSULTATION RECORDS TABLE
    const consults = data.consultation_records || [];
    if (Array.isArray(consults) && consults.length > 0) {
      renderConsultationTableRows(consults);
    }
  }

  document.getElementById('add-consultation-row-btn').addEventListener('click', () => {
    const tbody = document.getElementById('consultation-table-body');
    if (tbody) {
      tbody.insertAdjacentHTML('beforeend', createConsultationRowHtml({}));
    }
  });

  // Live Sync / Logging: Convert Extracted Full Text into Accurate JSON, populate form, and print to console
  document.getElementById('review-extracted-text').addEventListener('input', (e) => {
    const accurateJson = convertExtractedTextToAccurateJson(e.target.value);
    populateFormFieldsFromJson(accurateJson);
    console.log('%c=== ACCURATE EXTRACTED OCR DIGITAL TEXT JSON RESULT ===', 'color: #10b981; font-size: 14px; font-weight: bold;');
    console.log(JSON.stringify(accurateJson, null, 2));
    console.dir(accurateJson);
  });

  // Live Sync: When editing form inputs, checkboxes, or table rows -> instantly update JSON & formatted text
  const formTabContainer = document.getElementById('vtab-content-form');
  if (formTabContainer) {
    const updateFromForm = () => {
      const editedJson = collectStructuredJsonFromForm();
      const formattedText = formatItrToStandardTemplate(editedJson);
      if (formattedText.trim()) {
        reviewExtractedText.value = formattedText;
      }
    };
    formTabContainer.addEventListener('input', updateFromForm);
    formTabContainer.addEventListener('change', updateFromForm);
  }

  // Switch between Verification Review Tabs
  window.switchVerificationTab = function(tabName) {
    document.querySelectorAll('.vtab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.vtab-btn').forEach(btn => btn.classList.remove('active'));

    const targetContent = document.getElementById(`vtab-content-${tabName}`);
    const targetBtn     = document.getElementById(`vtab-btn-${tabName}`);

    if (targetContent) targetContent.style.display = 'block';
    if (targetBtn)     targetBtn.classList.add('active');
  };

  // Switch between Form Sub-Sections
  window.switchFormSubSection = function(sectionName) {
    document.querySelectorAll('.form-subnav-btn').forEach(btn => btn.classList.remove('active'));
    const targetBtn = document.getElementById(`fsub-btn-${sectionName}`);
    if (targetBtn) targetBtn.classList.add('active');

    if (sectionName === 'all') {
      document.querySelectorAll('.fsub-card').forEach(card => card.style.display = 'block');
    } else {
      document.querySelectorAll('.fsub-card').forEach(card => card.style.display = 'none');
      const targetCard = document.getElementById(`fsub-card-${sectionName}`);
      if (targetCard) targetCard.style.display = 'block';
    }
  };

  // STAGE 1.5: User clicks "Confirm & Extract Text into OCR"
  enhancementConfirmBtn.addEventListener('click', async () => {
    if (!currentToken) {
      showToast('Enhancement session missing. Please re-upload.', 'error');
      resetUploadStage();
      return;
    }

    enhancementStage.style.display = 'none';
    ocrLoaderPanel.style.display = 'flex';

    ocrTitle.textContent    = 'Running OCR Text Extraction & Classification...';
    ocrSubtitle.textContent = 'Analyzing document text content, presort layout structures, and building verification form...';

    try {
      const res = await API.postJson('/api/records/ocr-preview', { token: currentToken });

      if (res && res.success) {
        const preview = res.preview;

        // Expand content card for Stage 2 review
        document.getElementById('main-content-card').style.maxWidth = '1200px';

        reviewFilename.value      = preview.file_name;
        reviewCategory.value      = preview.suggested_category;
        reviewExtractedText.value = preview.extracted_text || '';
        reviewExplanationText.textContent = `Content-Based AI Classification: ${preview.classification_reason} Matched content words: [${(preview.matched_terms || []).join(', ')}]`;

        const reviewImg = document.getElementById('review-original-image');
        if (reviewImg) {
          reviewImg.src = preview.preview_url || '';
        }

        const itrBadge = document.getElementById('review-itr-page-badge');
        if (preview.suggested_category === 'PATIENT_INFORMATION_SHEET') {
          const pNum = preview.itr_page_number || 1;
          itrBadge.innerHTML = `<svg style="width: 14px; height: 14px; fill: currentColor;" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg> ${pNum === 2 ? 'ITR Page 2 (Follow-up Consultations)' : 'ITR Page 1 (Demographics & Risk Assessment)'}`;
          itrBadge.style.display = 'inline-flex';
        } else {
          itrBadge.innerHTML = `<svg style="width: 14px; height: 14px; fill: currentColor;" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg> ${preview.suggested_category.replace(/_/g, ' ')}`;
          itrBadge.style.display = 'inline-flex';
        }

        // Convert Extracted Digital Text into Accurate JSON and format into Standard Template
        const accurateExtractedJson = convertExtractedTextToAccurateJson(preview.extracted_text || '');
        const standardFormattedText = formatItrToStandardTemplate(accurateExtractedJson);
        reviewExtractedText.value   = standardFormattedText;

        console.log("%c=== ACCURATE EXTRACTED OCR DIGITAL TEXT JSON RESULT ===", "color: #6366f1; font-size: 15px; font-weight: bold; background: #0f172a; padding: 6px 12px; border-radius: 4px;");
        console.log(JSON.stringify(accurateExtractedJson, null, 2));
        console.dir(accurateExtractedJson);

        // Automatically populate Information Form fields from accurate extracted JSON
        populateFormFieldsFromJson(accurateExtractedJson);

        reviewConfidenceBadge.className = 'confidence-badge';
        if (preview.confidence_level === 'HIGH') {
          reviewConfidenceBadge.classList.add('confidence-high');
          reviewConfidenceLevel.textContent   = 'HIGH CONFIDENCE';
          reviewExplanationBanner.className   = 'alert-banner alert-info';
        } else if (preview.confidence_level === 'MEDIUM') {
          reviewConfidenceBadge.classList.add('confidence-medium');
          reviewConfidenceLevel.textContent   = 'MEDIUM CONFIDENCE';
          reviewExplanationBanner.className   = 'alert-banner alert-warning';
        } else {
          reviewConfidenceBadge.classList.add('confidence-low');
          reviewConfidenceLevel.textContent   = 'LOW CONFIDENCE - REVIEW CAREFULLY';
          reviewExplanationBanner.className   = 'alert-banner alert-warning';
          showToast('Low-confidence classification. Please confirm category manually.', 'warning');
        }

        ocrLoaderPanel.style.display = 'none';
        reviewPanel.style.display    = 'block';
        switchVerificationTab('form');
        switchFormSubSection('all');
        showToast('Document classified by content & Verification Form ready!', 'success');
      } else {
        throw new Error(res ? res.message : 'OCR preview failed.');
      }
    } catch (err) {
      showToast(err.message || 'Failed to extract text from enhanced document.', 'error');
      ocrLoaderPanel.style.display    = 'none';
      enhancementStage.style.display  = 'block';
    }
  });

  // ─── Collect All Edited Form Fields & Consultation Table Rows into Structured JSON ───
  function collectStructuredJsonFromForm() {
    function getVal(id) {
      const el = document.getElementById(id);
      return el ? el.value.trim() : '';
    }

    function getNumVal(id) {
      const v = getVal(id);
      if (!v) return null;
      const n = parseFloat(v);
      return isNaN(n) ? null : n;
    }

    function getChk(id) {
      const el = document.getElementById(id);
      return el ? !!el.checked : false;
    }

    // Check if any options in a group are checked to determine boolean vs null
    const hasSmkCheck = getChk('itr-smk-current') || getChk('itr-smk-passive') || getChk('itr-smk-never') || getChk('itr-smk-gt1yr') || getChk('itr-smk-lt1yr');
    const smokerStatus = getChk('itr-smk-current') ? 'Current'
      : getChk('itr-smk-passive') ? 'Passive'
      : getChk('itr-smk-never') ? 'Never'
      : getChk('itr-smk-gt1yr') ? 'Stopped > 1 year'
      : getChk('itr-smk-lt1yr') ? 'Stopped < 1 year' : '';

    const hasFhCheck = getChk('itr-fh-htn') || getChk('itr-fh-stroke') || getChk('itr-fh-heart') || getChk('itr-fh-dm') || getChk('itr-fh-asthma') || getChk('itr-fh-cancer') || getChk('itr-fh-kidney');
    const hasAlcCheck = getChk('itr-alc-never') || getChk('itr-alc-yes');
    const hasExcCheck = getChk('itr-alc-excess-yes') || getChk('itr-alc-excess-no');

    const raisedBpVal = getVal('itr-field-raisedbp').toLowerCase();
    const raisedBp = raisedBpVal.includes('yes') || raisedBpVal === 'true' ? true : (raisedBpVal.includes('no') || raisedBpVal === 'false' ? false : null);

    // 7. Consultation Table Rows
    const consultRows = [];
    const tableTrs = document.querySelectorAll('#consultation-table-body tr');
    tableTrs.forEach(tr => {
      const dateEl = tr.querySelector('.consult-row-date');
      const subjEl = tr.querySelector('.consult-row-subj');
      const ageEl  = tr.querySelector('.consult-row-age');
      const wtEl   = tr.querySelector('.consult-row-wt');
      const htEl   = tr.querySelector('.consult-row-ht');
      const bpEl   = tr.querySelector('.consult-row-bp');
      const diagEl = tr.querySelector('.consult-row-diag');
      const planEl = tr.querySelector('.consult-row-plan');

      const date = dateEl ? dateEl.value.trim() : '';
      const subj = subjEl ? subjEl.value.trim() : '';
      const age  = ageEl ? parseFloat(ageEl.value) : null;
      const wt   = wtEl ? parseFloat(wtEl.value) : null;
      const ht   = htEl ? parseFloat(htEl.value) : null;
      const bp   = bpEl ? bpEl.value.trim() : '';
      const diag = diagEl ? diagEl.value.trim() : '';
      const plan = planEl ? planEl.value.trim() : '';

      if (date || subj || diag || plan || bp) {
        consultRows.push({
          date: date,
          subjective_findings: subj,
          objective_findings: {
            risk_table_present: null,
            age: !isNaN(age) ? Math.round(age) : null,
            weight_kg: !isNaN(wt) ? wt : null,
            height_cm: !isNaN(ht) ? ht : null,
            blood_pressure: bp
          },
          assessment_diagnosis: diag ? diag.split(',').map(s => s.trim()).filter(Boolean) : [],
          plan_treatment: plan ? plan.split('\n').map(s => s.trim()).filter(Boolean) : []
        });
      }
    });

    return {
      header: {
        country: 'Republic of the Philippines',
        province: 'Province of Laguna',
        municipality: 'Municipality of Paete',
        facility: 'PAETE RURAL HEALTH UNIT',
        facility_address: '2436 F. Sano Street, Brgy. Maylong, Paete, Laguna',
        form_title: 'Individual Treatment Record',
        age_group: '20 Years old and above'
      },
      patient_demographics: {
        name: getVal('itr-field-name'),
        philhealth_no: getVal('itr-field-philhealth'),
        address: getVal('itr-field-address'),
        civil_status: getVal('itr-field-civilstatus'),
        birthday: getVal('itr-field-birthday'),
        age: getNumVal('itr-field-age'),
        cp_no: getVal('itr-field-cpno'),
        educational_attainment: getVal('itr-field-education'),
        bhw: getVal('itr-field-bhw')
      },
      smoking_cessation_profile: {
        smoker_status: smokerStatus,
        options: {
          current: getChk('itr-smk-current') ? true : (hasSmkCheck ? false : null),
          passive: getChk('itr-smk-passive') ? true : (hasSmkCheck ? false : null),
          never: getChk('itr-smk-never') ? true : (hasSmkCheck ? false : null),
          stopped_gt_1_year: getChk('itr-smk-gt1yr') ? true : (hasSmkCheck ? false : null),
          stopped_lt_1_year: getChk('itr-smk-lt1yr') ? true : (hasSmkCheck ? false : null)
        },
        brand_of_cigarette: getVal('itr-field-smoking-brand'),
        sticks_per_day: getNumVal('itr-field-smoking-sticks'),
        age_started: getNumVal('itr-field-smoking-agestarted'),
        years_smoking: getNumVal('itr-field-smoking-years'),
        reason_for_smoking: getVal('itr-field-smoking-reason'),
        experienced_side_effects: getChk('itr-smk-sideeffect-yes') ? true : (getChk('itr-smk-sideeffect-no') ? false : null),
        side_effect_details: getVal('itr-field-smoking-effect'),
        tried_quitting_before: getChk('itr-smk-quit-yes') ? true : (getChk('itr-smk-quit-no') ? false : null),
        quit_attempt_success: null,
        reason_not_successful: getVal('itr-field-smoking-unsuccessful')
      },
      family_history: {
        has_1st_degree_relative: hasFhCheck ? true : null,
        hypertension: getChk('itr-fh-htn') ? true : (hasFhCheck ? false : null),
        stroke: getChk('itr-fh-stroke') ? true : (hasFhCheck ? false : null),
        heart_attack: getChk('itr-fh-heart') ? true : (hasFhCheck ? false : null),
        dm: getChk('itr-fh-dm') ? true : (hasFhCheck ? false : null),
        asthma: getChk('itr-fh-asthma') ? true : (hasFhCheck ? false : null),
        cancer: getChk('itr-fh-cancer') ? true : (hasFhCheck ? false : null),
        kidney_disease: getChk('itr-fh-kidney') ? true : (hasFhCheck ? false : null)
      },
      clinical_background: {
        co_morbid: getVal('itr-field-comorbid'),
        allergy: getVal('itr-field-allergy')
      },
      alcohol_intake: {
        never_consumed: getChk('itr-alc-never') ? true : (hasAlcCheck ? false : null),
        drinks_alcohol: getChk('itr-alc-yes') ? true : (hasAlcCheck ? false : null),
        excessive_alcohol_intake: {
          definition: 'In the past mos., had 5 drinks in one occasion',
          yes: getChk('itr-alc-excess-yes') ? true : (hasExcCheck ? false : null),
          no: getChk('itr-alc-excess-no') ? true : (hasExcCheck ? false : null)
        }
      },
      diet_and_lifestyle: {
        physical_activity: {
          meets_2_5_hours_per_week: getChk('itr-pa-yes') ? true : (getChk('itr-pa-no') ? false : null)
        },
        high_fat_high_salt_food_intake: {
          weekly_processed_fastfood: getChk('itr-fat-yes') ? true : (getChk('itr-fat-no') ? false : null)
        },
        dietary_fiber_intake: {
          vegetables_3_servings_daily: getChk('itr-fiber-veg-yes') ? true : (getChk('itr-fiber-veg-no') ? false : null),
          fruits_2_3_servings_daily: getChk('itr-fiber-fruit-yes') ? true : (getChk('itr-fiber-fruit-no') ? false : null)
        }
      },
      vital_signs: {
        bmi: getNumVal('itr-field-bmi'),
        waistline_cm: getNumVal('itr-field-waist'),
        height_cm: getNumVal('itr-field-ht'),
        weight_kg: getNumVal('itr-field-wt'),
        raised_bp: raisedBp,
        blood_pressure_readings: {
          first: getVal('itr-field-bp1'),
          second: getVal('itr-field-bp2')
        }
      },
      consultation_records: consultRows
    };
  }

  enhancementCancelBtn.addEventListener('click', () => {
    resetUploadStage();
  });

  // Confirm & Save record finalized submission
  document.getElementById('record-confirm-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const confirmSaveBtn = document.getElementById('confirm-save-btn');

    confirmSaveBtn.classList.add('loading');
    confirmSaveBtn.disabled = true;

    // Collect latest edited form values & table rows into structured JSON
    const editedStructuredJson = collectStructuredJsonFromForm();
    const formattedStandardText = formatItrToStandardTemplate(editedStructuredJson);

    // If form values exist, use the formatted text generated from the edited form
    const finalExtractedText = formattedStandardText.trim() || reviewExtractedText.value.trim();
    reviewExtractedText.value = finalExtractedText;

    const payload = {
      token:           currentToken,
      file_name:       reviewFilename.value,
      record_type:     reviewCategory.value,
      extracted_text:  finalExtractedText,
      structured_json: editedStructuredJson
    };

    try {
      const res = await API.postJson('/api/records/confirm-upload', payload);
      if (res && res.success) {
        showToast(res.message, 'success');
        setTimeout(() => {
          window.location.href = `/dashboard/patients/profile/${patientId}`;
        }, 1000);
      } else {
        throw new Error(res.message || 'Confirmation failed.');
      }
    } catch (err) {
      showToast(err.message || 'An error occurred while confirming document upload.', 'error');
      confirmSaveBtn.classList.remove('loading');
      confirmSaveBtn.disabled = false;
    }
  });

  // Cancel temporary upload session
  document.getElementById('review-cancel-btn').addEventListener('click', async () => {
    if (!confirm('Are you sure you want to discard this temporary upload? The file will be deleted.')) {
      return;
    }

    try {
      const res = await API.postJson('/api/records/cancel-upload', { token: currentToken });
      if (res && res.success) {
        showToast(res.message, 'info');
        resetUploadStage();
      }
    } catch (err) {
      showToast('Failed to clean up upload session.', 'error');
      resetUploadStage();
    }
  });

  document.getElementById('review-retry-btn').addEventListener('click', () => {
    resetUploadStage();
  });

  function resetUploadStage() {
    currentToken = '';
    selectedFile = null;
    fileInput.value = '';
    filePreviewCard.style.display = 'none';
    uploadZone.style.display      = 'flex';
    enhancementStage.style.display = 'none';
    reviewPanel.style.display      = 'none';
    uploadStage.style.display      = 'block';
    document.getElementById('main-content-card').style.maxWidth = '900px';
  }

  document.getElementById('logout-btn').addEventListener('click', async () => {
    if (confirm('Are you sure you want to log out of the KEEP UP System?')) {
      await API.logout();
    }
  });
});

// ─── Helpers defined at module scope (accessible from DOMContentLoaded) ──────

async function loadPatientSummary() {
  try {
    const res = await API.fetchJson(`/api/patients/${patientId}`);
    if (res && res.success) {
      const patient = res.patient;
      document.getElementById('summary-number').textContent    = patient.patient_number;
      document.getElementById('summary-name').textContent      = `${patient.first_name} ${patient.middle_name || ''} ${patient.last_name}`;

      const birthDate = new Date(patient.birth_date);
      const options   = { year: 'numeric', month: 'long', day: 'numeric' };
      document.getElementById('summary-birthdate').textContent = birthDate.toLocaleDateString('en-US', options);
      document.getElementById('summary-sex').textContent       = patient.sex;
    }
  } catch (err) {
    showToast('Failed to load patient demographics.', 'error');
  }
}


