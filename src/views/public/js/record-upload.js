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
  function convertExtractedTextToAccurateJson(txt, targetPage = 0) {
    if (!txt || typeof txt !== 'string') return {};

    function splitSections(str) {
      const pattern = /===\s*(.*?)\s*===([\s\S]*?)(?====|$)/g;
      const sections = {};
      let match;
      while ((match = pattern.exec(str)) !== null) {
        sections[match[1].trim()] = match[2].trim();
      }
      if (Object.keys(sections).length >= 2) return sections;

      const hdrRegex = /^[ \t]*(?:===|[#*]-*)?[ \t]*(PHILHEALTH MEMBERSHIP INFORMATION|PHILHEALTH|VITAL SIGNS|PAST MEDICAL HISTORY|PAST SURGICAL HISTORY|FAMILY HISTORY|PERSONAL\s*\/\s*SOCIAL HISTORY|PERSONAL\/SOCIAL HISTORY|IMMUNIZATIONS|MENSTRUAL HISTORY|PREGNANCY HISTORY|HEALTH FACILITY HEADER|PATIENT DEMOGRAPHICS|LIFESTYLE\s*&\s*RISK FACTORS|VITAL SIGNS\s*&\s*PHYSICAL MEASUREMENTS|CONSULTATION\s*&\s*CLINICAL FINDINGS)[ \t]*(?:===|:|\(For Women\)|$)/gim;

      const found = [];
      let m;
      while ((m = hdrRegex.exec(str)) !== null) {
        found.push({ index: m.index, matchEnd: hdrRegex.lastIndex, name: m[1].toUpperCase().trim() });
      }
      if (found.length === 0) return sections;

      const fallbackRes = {};
      if (found[0].index > 0) {
        const prefix = str.slice(0, found[0].index).trim();
        if (/PHILHEALTH|MEMBERSHIP|ID NUMBER|MEMBER/i.test(prefix)) {
          fallbackRes['PHILHEALTH MEMBERSHIP INFORMATION'] = prefix;
        }
      }

      for (let i = 0; i < found.length; i++) {
        let rawH = found[i].name;
        let hkey = rawH;
        if (rawH.includes('PHILHEALTH')) hkey = 'PHILHEALTH MEMBERSHIP INFORMATION';
        else if (rawH.includes('VITAL') && !rawH.includes('PHYSICAL')) hkey = 'VITAL SIGNS';
        else if (rawH.includes('PERSONAL')) hkey = 'PERSONAL / SOCIAL HISTORY';
        else if (rawH.includes('MEDICAL')) hkey = 'PAST MEDICAL HISTORY';
        else if (rawH.includes('SURGICAL')) hkey = 'PAST SURGICAL HISTORY';
        else if (rawH.includes('FAMILY')) hkey = 'FAMILY HISTORY';
        else if (rawH.includes('IMMUNIZ')) hkey = 'IMMUNIZATIONS';
        else if (rawH.includes('MENSTRUAL')) hkey = 'MENSTRUAL HISTORY';
        else if (rawH.includes('PREGNANCY')) hkey = 'PREGNANCY HISTORY';

        let st = found[i].matchEnd;
        let en = i + 1 < found.length ? found[i + 1].index : str.length;
        fallbackRes[hkey] = str.slice(st, en).trim();
      }

      return { ...fallbackRes, ...sections };
    }

    function getValue(block, label) {
      if (!block) return '';
      const cleanLabel = label.replace(/[?: ]+$/, '').trim();
      const escaped = cleanLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped + '[?: \\t]*([^\\n;,\\t]+)', 'i');
      const match = block.match(regex);
      if (match && match[1]) {
        let val = match[1].trim();
        val = val.replace(/\s+[A-Z][a-zA-Z0-9\s/()]+:.*$/, '');
        return val;
      }
      return '';
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
      const regex = new RegExp('\\[[\\s]*[XxvV✓/*1]+[\\s]*\\][ \\t]*' + escaped + '|' + escaped + '[ \\t]*\\[[\\s]*[XxvV✓/*1]+[\\s]*\\]|\\([\\s]*[XxvV✓/*1]+[\\s]*\\\)[ \\t]*' + escaped, 'i');
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

    let isPage2;
    if (targetPage === 1) {
      isPage2 = false;
    } else if (targetPage === 2) {
      isPage2 = true;
    } else {
      isPage2 = Object.keys(sections).some(k => ['PHILHEALTH MEMBERSHIP INFORMATION', 'PAST MEDICAL HISTORY', 'PAST SURGICAL HISTORY', 'IMMUNIZATIONS', 'MENSTRUAL HISTORY', 'PREGNANCY HISTORY'].includes(k)) || /PHILHEALTH|PAST MEDICAL HISTORY|PAST SURGICAL HISTORY|IMMUNIZATIONS|MENSTRUAL HISTORY|PREGNANCY HISTORY/i.test(txt);
    }

    if (isPage2) {
      const pmB = sections['PHILHEALTH MEMBERSHIP INFORMATION'] || '';
      const vsB = sections['VITAL SIGNS'] || sections['VITAL SIGNS & PHYSICAL MEASUREMENTS'] || '';
      const pmhB = sections['PAST MEDICAL HISTORY'] || '';
      const pshB = sections['PAST SURGICAL HISTORY'] || '';
      const fhB = sections['FAMILY HISTORY'] || '';
      const psocB = sections['PERSONAL / SOCIAL HISTORY'] || sections['PERSONAL/SOCIAL HISTORY'] || '';
      const immB = sections['IMMUNIZATIONS'] || '';
      const menB = sections['MENSTRUAL HISTORY'] || '';
      const pregB = sections['PREGNANCY HISTORY'] || '';

      return {
        philhealth_membership: {
          philhealth_id_number: getValue(pmB, 'Philhealth ID Number') || getValue(pmB, 'PhilHealth ID') || getValue(pmB, 'Philhealth No') || getValue(pmB, 'ID Number'),
          membership_type: {
            member: checkbox(pmB, 'Member') && !checkbox(pmB, 'Non-Member'),
            dependent: checkbox(pmB, 'Dependent'),
            non_member: checkbox(pmB, 'Non-Member')
          },
          membership_category: {
            sponsored: checkbox(pmB, 'Sponsored'),
            ipp: checkbox(pmB, 'Individual Paying Program (IPP)') || checkbox(pmB, 'IPP') || checkbox(pmB, 'Individually Paying Program'),
            employed: checkbox(pmB, 'Employed'),
            lifetime: checkbox(pmB, 'Lifetime'),
            nhits: checkbox(pmB, 'NHITS') || checkbox(pmB, 'NHIS'),
            lgu: checkbox(pmB, 'LGU'),
            organized_group: checkbox(pmB, 'Organized Group'),
            government: checkbox(pmB, 'Government'),
            nga: checkbox(pmB, 'NGA'),
            private: checkbox(pmB, 'Private'),
            ofw: checkbox(pmB, 'OFW')
          }
        },
        vital_signs: {
          blood_pressure: getValue(vsB, 'Blood Pressure') || getValue(vsB, 'BP'),
          heart_rate: getNumber(getValue(vsB, 'Heart Rate') || getValue(vsB, 'HR')),
          respiratory_rate: getNumber(getValue(vsB, 'Respiratory Rate') || getValue(vsB, 'RR')),
          pulse_rate: getNumber(getValue(vsB, 'Pulse Rate') || getValue(vsB, 'PR')),
          temperature: getNumber(getValue(vsB, 'Temperature') || getValue(vsB, 'TEMP') || getValue(vsB, 'Temp')),
          spo2: getNumber(getValue(vsB, 'SpO2') || getValue(vsB, 'Blood Oxygen')),
          height_cm: getNumber(getValue(vsB, 'Height (cm)') || getValue(vsB, 'HT') || getValue(vsB, 'Height')),
          weight_kg: getNumber(getValue(vsB, 'Weight (kg)') || getValue(vsB, 'WEIGHT') || getValue(vsB, 'Weight')),
          waist_circumference_cm: getNumber(getValue(vsB, 'Waist Circumference (cm)') || getValue(vsB, 'WaistLine') || getValue(vsB, 'Waist circumference')),
          hip_circumference_cm: getNumber(getValue(vsB, 'Hip Circumference (cm)') || getValue(vsB, 'Hip') || getValue(vsB, 'Hip circumference'))
        },
        past_medical_history: {
          allergy: getValue(pmhB, 'Allergy (specify)') || getValue(pmhB, 'Allergy'),
          asthma: pmhB.includes('Asthma') ? checkbox(pmhB, 'Asthma') : null,
          cancer: {
            has: pmhB.includes('Cancer') ? checkbox(pmhB, 'Cancer') : null,
            organ: getValue(pmhB, 'Cancer (specify organ)')
          },
          cerebrovascular_disease: pmhB.includes('Cerebrovascular') ? checkbox(pmhB, 'Cerebrovascular Disease') : null,
          coronary_artery_disease: pmhB.includes('Coronary') ? checkbox(pmhB, 'Coronary Artery Disease') || checkbox(pmhB, 'Coronary artery disease') : null,
          diabetes_mellitus: pmhB.includes('Diabetes') ? checkbox(pmhB, 'Diabetes Mellitus') || checkbox(pmhB, 'Diabetes mellitus') : null,
          emphysema: pmhB.includes('Emphysema') ? checkbox(pmhB, 'Emphysema') : null,
          epilepsy_seizure_disorder: pmhB.includes('Epilepsy') ? checkbox(pmhB, 'Epilepsy/Seizure Disorder') || checkbox(pmhB, 'Epilepsy') : null,
          hepatitis: {
            has: pmhB.includes('Hepatitis') ? checkbox(pmhB, 'Hepatitis') : null,
            type: getValue(pmhB, 'Hepatitis (specify type)')
          },
          hyperlipidemia: pmhB.includes('Hyperlipidemia') ? checkbox(pmhB, 'Hyperlipidemia') : null,
          hypertension: {
            has: pmhB.includes('Hypertension') ? checkbox(pmhB, 'Hypertension') : null,
            highest_bp: getValue(pmhB, 'Highest BP Recorded') || getValue(pmhB, 'highest BP')
          },
          peptic_ulcer_disease: pmhB.includes('Peptic') ? checkbox(pmhB, 'Peptic Ulcer Disease') : null,
          pneumonia: pmhB.includes('Pneumonia') ? checkbox(pmhB, 'Pneumonia') : null,
          thyroid_disease: pmhB.includes('Thyroid') ? checkbox(pmhB, 'Thyroid Disease') || checkbox(pmhB, 'Thyroid disease') : null,
          tuberculosis: {
            organ: getValue(pmhB, 'Tuberculosis (specify organ)') || getValue(pmhB, 'Tuberculosis, specify organ'),
            category: getValue(pmhB, 'If Pulmonary TB Category') || getValue(pmhB, 'If PTB, what category')
          },
          urinary_tract_infection: (pmhB.includes('UTI') || pmhB.includes('Urinary')) ? checkbox(pmhB, 'Urinary Tract Infection') || checkbox(pmhB, 'Urinary tract infection') || checkbox(pmhB, 'UTI') : null,
          others: getValue(pmhB, 'Others')
        },
        past_surgical_history: {
          operation: getValue(pshB, 'Operation'),
          date: getValue(pshB, 'Date')
        },
        family_history: {
          allergy: getValue(fhB, 'Allergy (specify)') || getValue(fhB, 'Allergy'),
          asthma: fhB.includes('Asthma') ? checkbox(fhB, 'Asthma') : null,
          cancer: {
            has: fhB.includes('Cancer') ? checkbox(fhB, 'Cancer') : null,
            organ: getValue(fhB, 'Cancer (specify organ)')
          },
          cerebrovascular_disease: fhB.includes('Cerebrovascular') ? checkbox(fhB, 'Cerebrovascular Disease') : null,
          coronary_artery_disease: fhB.includes('Coronary') ? checkbox(fhB, 'Coronary Artery Disease') || checkbox(fhB, 'Coronary artery disease') : null,
          diabetes_mellitus: fhB.includes('Diabetes') ? checkbox(fhB, 'Diabetes Mellitus') || checkbox(fhB, 'Diabetes mellitus') : null,
          emphysema: fhB.includes('Emphysema') ? checkbox(fhB, 'Emphysema') : null,
          epilepsy_seizure_disorder: fhB.includes('Epilepsy') ? checkbox(fhB, 'Epilepsy/Seizure Disorder') || checkbox(fhB, 'Epilepsy') : null,
          hepatitis: {
            has: fhB.includes('Hepatitis') ? checkbox(fhB, 'Hepatitis') : null,
            type: getValue(fhB, 'Hepatitis (specify type)')
          },
          hyperlipidemia: fhB.includes('Hyperlipidemia') ? checkbox(fhB, 'Hyperlipidemia') : null,
          hypertension: {
            has: fhB.includes('Hypertension') ? checkbox(fhB, 'Hypertension') : null,
            highest_bp: getValue(fhB, 'Highest BP Recorded') || getValue(fhB, 'highest BP')
          },
          peptic_ulcer_disease: fhB.includes('Peptic') ? checkbox(fhB, 'Peptic Ulcer Disease') : null,
          pneumonia: fhB.includes('Pneumonia') ? checkbox(fhB, 'Pneumonia') : null,
          thyroid_disease: fhB.includes('Thyroid') ? checkbox(fhB, 'Thyroid Disease') || checkbox(fhB, 'Thyroid disease') : null,
          pulmonary_tuberculosis: fhB.includes('Pulmonary Tuberculosis') ? checkbox(fhB, 'Pulmonary Tuberculosis') : null,
          extrapulmonary_tuberculosis: fhB.includes('Extrapulmonary') ? checkbox(fhB, 'Extrapulmonary Tuberculosis') : null,
          urinary_tract_infection: (fhB.includes('UTI') || fhB.includes('Urinary')) ? checkbox(fhB, 'Urinary Tract Infection') || checkbox(fhB, 'Urinary tract Infection') : null,
          mental_illness: fhB.includes('Mental') ? checkbox(fhB, 'Mental Illness') : null,
          others: getValue(fhB, 'Others')
        },
        personal_social_history: {
          smoking: {
            yes: psocB.includes('Smoking') && checkbox(psocB.split(/Smoking/i)[1].split('\n')[0], 'Yes'),
            no: psocB.includes('Smoking') && checkbox(psocB.split(/Smoking/i)[1].split('\n')[0], 'No'),
            quit: psocB.includes('Smoking') && checkbox(psocB.split(/Smoking/i)[1].split('\n')[0], 'Quit'),
            pack_years: getNumber(getValue(psocB, 'Pack Years') || getValue(psocB, 'pack years'))
          },
          alcohol: {
            yes: psocB.includes('Alcohol') && checkbox(psocB.split(/Alcohol/i)[1].split('\n')[0], 'Yes'),
            no: psocB.includes('Alcohol') && checkbox(psocB.split(/Alcohol/i)[1].split('\n')[0], 'No'),
            quit: psocB.includes('Alcohol') && checkbox(psocB.split(/Alcohol/i)[1].split('\n')[0], 'Quit'),
            bottles_per_day: getNumber(getValue(psocB, 'Bottles per Day') || getValue(psocB, 'bottles/day'))
          },
          illicit_drugs: {
            yes: psocB.includes('Illicit') && checkbox(psocB.split(/Illicit/i)[1].split('\n')[0], 'Yes'),
            no: psocB.includes('Illicit') && checkbox(psocB.split(/Illicit/i)[1].split('\n')[0], 'No'),
            quit: psocB.includes('Illicit') && checkbox(psocB.split(/Illicit/i)[1].split('\n')[0], 'Quit')
          },
          sexually_active: psocB.includes('Sexually Active') ? checkbox(psocB.split(/Sexually Active/i)[1].split('\n')[0], 'Yes') : null
        },
        immunizations: {
          child_care: {
            bcg_date: getValue(immB, 'BCG Date') || getValue(immB, 'BCG'),
            hepb_birth_date: getValue(immB, 'HepB Birth Date') || getValue(immB, 'Hepa at Birth'),
            hepb_24hrs_date: getValue(immB, 'HepB 24hrs Date') || getValue(immB, 'HepB after 24hrs'),
            penta_date: getValue(immB, 'PENTA Date') || getValue(immB, 'PENTA'),
            opv_date: getValue(immB, 'OPV Date') || getValue(immB, 'OPV'),
            ipv_date: getValue(immB, 'IPV Date') || getValue(immB, 'IPV'),
            pcv_date: getValue(immB, 'PCV Date') || getValue(immB, 'PCV'),
            measles_vaccine_date: getValue(immB, 'Measles Vaccine Date') || getValue(immB, 'Measles Vaccine'),
            rotavirus_vaccine_date: getValue(immB, 'Rotavirus Vaccine Date') || getValue(immB, 'Rotavirus Vaccine'),
            chickenpox_vaccine_date: getValue(immB, 'Chickenpox Vaccine Date') || getValue(immB, 'Chickenpox')
          },
          general: {
            flu_vaccine_date: getValue(immB, 'Flu Vaccine Date') || getValue(immB, 'Flu Vaccine'),
            hpv_date: getValue(immB, 'HPV Date') || getValue(immB, 'HPV'),
            hpv_grade4_date: getValue(immB, 'HPV Grade 4 Date') || getValue(immB, 'HPVGR4'),
            mr_grade1_date: getValue(immB, 'MR Grade 1 Date') || getValue(immB, 'MRGR'),
            mr_grade7_date: getValue(immB, 'MR Grade 7 Date') || getValue(immB, 'MRGR7'),
            td_grade1_date: getValue(immB, 'TD Grade 1 Date') || getValue(immB, 'TDGR1'),
            td_grade7_date: getValue(immB, 'TD Grade 7 Date') || getValue(immB, 'TDGR7'),
            tetanus_toxoid_date: getValue(immB, 'Tetanus Toxoid Date') || getValue(immB, 'Tetanus Toxoid')
          },
          animal_bite: {
            pcecv1_date: getValue(immB, 'PCECV1 Date') || getValue(immB, 'PCECV1'),
            pvrv1_date: getValue(immB, 'PVRV1 Date') || getValue(immB, 'PVRV1'),
            pvrv2_date: getValue(immB, 'PVRV2 Date') || getValue(immB, 'PVRV2'),
            pvrv3_date: getValue(immB, 'PVRV3 Date') || getValue(immB, 'PVRV3'),
            pvrv4_date: getValue(immB, 'PVRV4 Date') || getValue(immB, 'PVRV4'),
            pcecv2_date: getValue(immB, 'PCECV2 Date') || getValue(immB, 'PCECV2')
          },
          ncd: {
            pneumococcal_vaccine_date: getValue(immB, 'Pneumococcal Vaccine Date') || getValue(immB, 'Pneumococcal Vaccine'),
            flu_vaccine_date: getValue(immB, 'Flu Vaccine (NCD) Date') || getValue(immB, 'Flu vaccine')
          },
          maternal_care: {
            tetanus_toxoid_date: getValue(immB, 'Tetanus Toxoid (Maternal) Date') || getValue(immB, 'Tetanus toxoid')
          }
        },
        menstrual_history: {
          menarche_age: getNumber(getValue(menB, 'Menarche Age') || getValue(menB, 'Menarche')),
          onset_of_sexual_intercourse: getNumber(getValue(menB, 'Onset of Sexual Intercourse') || getValue(menB, 'Onset of sexual intercourse')),
          last_menstrual_period: getValue(menB, 'Last Menstrual Period'),
          menstrual_bleeding_pattern: getValue(menB, 'Menstrual Bleeding Pattern'),
          birth_control_method: getValue(menB, 'Birth Control Method') || getValue(menB, 'Birth control method'),
          period_duration: getValue(menB, 'Period Duration'),
          cycle_interval: getValue(menB, 'Cycle Interval') || getValue(menB, 'Interval/Cycle'),
          pads_per_day: getNumber(getValue(menB, 'Pads per Day') || getValue(menB, 'pads/day')),
          menopause: menB.includes('Menopause') ? checkbox(menB.split(/Menopause/i)[1].split('\n')[0], 'Yes') : null,
          age_of_menopause: getNumber(getValue(menB, 'Age of Menopause') || getValue(menB, 'at what age'))
        },
        pregnancy_history: {
          gravidity: getNumber(getValue(pregB, 'Gravidity') || getValue(pregB, 'Gravity')),
          parity: getNumber(getValue(pregB, 'Parity')),
          type_of_delivery: getValue(pregB, 'Type of Delivery'),
          full_term: getNumber(getValue(pregB, 'Full Term') || getValue(pregB, 'Full term')),
          premature: getNumber(getValue(pregB, 'Premature')),
          abortion: getNumber(getValue(pregB, 'Abortion')),
          living_children: getNumber(getValue(pregB, 'Living Children')),
          pre_eclampsia: pregB.includes('Pre-eclampsia') ? checkbox(pregB.split(/Pre-eclampsia/i)[1].split('\n')[0], 'Yes') : null,
          age_at_first_pregnancy: getNumber(getValue(pregB, 'Age at First Pregnancy') || getValue(pregB, 'Age of 1st full Pregnancy')),
          family_planning_counseling: pregB.includes('Family Planning') ? checkbox(pregB.split(/Family Planning/i)[1].split('\n')[0], 'Yes') : null
        }
      };
    }

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

    let is_page_2;
    if (data.itr_page_number === 1) {
      is_page_2 = false;
    } else if (data.itr_page_number === 2) {
      is_page_2 = true;
    } else {
      is_page_2 = !!(data.philhealth_membership || data.past_medical_history || data.immunizations || data.menstrual_history || data.pregnancy_history);
    }

    if (is_page_2) {
      const pm = data.philhealth_membership || {};
      const pm_type = pm.membership_type || {};
      const pm_cat = pm.membership_category || {};
      const pmh = data.past_medical_history || {};
      const pmh_can = pmh.cancer || {};
      const pmh_hep = pmh.hepatitis || {};
      const pmh_htn = pmh.hypertension || {};
      const pmh_tb = pmh.tuberculosis || {};
      const psh = data.past_surgical_history || {};
      const fh2 = data.family_history || {};
      const fh_can = fh2.cancer || {};
      const fh_hep = fh2.hepatitis || {};
      const fh_htn = fh2.hypertension || {};
      const psoc = data.personal_social_history || {};
      const psoc_smk = psoc.smoking || {};
      const psoc_alc = psoc.alcohol || {};
      const psoc_drg = psoc.illicit_drugs || {};
      const imm = data.immunizations || {};
      const imm_child = imm.child_care || {};
      const imm_gen = imm.general || {};
      const imm_ab = imm.animal_bite || {};
      const imm_ncd = imm.ncd || {};
      const imm_mat = imm.maternal_care || {};
      const men = data.menstrual_history || {};
      const preg = data.pregnancy_history || {};

      const lines2 = [];
      lines2.push('=== PHILHEALTH MEMBERSHIP INFORMATION ===');
      lines2.push(`Philhealth ID Number: ${pm.philhealth_id_number || ''}\n`);
      lines2.push('Membership Type:');
      lines2.push(`${chk(pm_type.member)} Member`);
      lines2.push(`${chk(pm_type.dependent)} Dependent`);
      lines2.push(`${chk(pm_type.non_member)} Non-Member\n`);
      lines2.push('Membership Category:');
      lines2.push(`${chk(pm_cat.sponsored)} Sponsored`);
      lines2.push(`${chk(pm_cat.ipp)} Individual Paying Program (IPP)`);
      lines2.push(`${chk(pm_cat.employed)} Employed`);
      lines2.push(`${chk(pm_cat.lifetime)} Lifetime`);
      lines2.push(`${chk(pm_cat.nhits)} NHITS`);
      lines2.push(`${chk(pm_cat.lgu)} LGU`);
      lines2.push(`${chk(pm_cat.organized_group)} Organized Group`);
      lines2.push(`${chk(pm_cat.government)} Government`);
      lines2.push(`${chk(pm_cat.nga)} NGA`);
      lines2.push(`${chk(pm_cat.private)} Private`);
      lines2.push(`${chk(pm_cat.ofw)} OFW\n`);

      lines2.push('=== VITAL SIGNS ===');
      lines2.push(`Blood Pressure: ${vs.blood_pressure || ''}`);
      lines2.push(`Heart Rate: ${vs.heart_rate !== undefined && vs.heart_rate !== null ? vs.heart_rate : ''}`);
      lines2.push(`Respiratory Rate: ${vs.respiratory_rate !== undefined && vs.respiratory_rate !== null ? vs.respiratory_rate : ''}`);
      lines2.push(`Pulse Rate: ${vs.pulse_rate !== undefined && vs.pulse_rate !== null ? vs.pulse_rate : ''}`);
      lines2.push(`Temperature: ${vs.temperature !== undefined && vs.temperature !== null ? vs.temperature : ''}`);
      lines2.push(`SpO2: ${vs.spo2 !== undefined && vs.spo2 !== null ? vs.spo2 : ''}`);
      lines2.push(`Height (cm): ${vs.height_cm !== undefined && vs.height_cm !== null ? vs.height_cm : ''}`);
      lines2.push(`Weight (kg): ${vs.weight_kg !== undefined && vs.weight_kg !== null ? vs.weight_kg : ''}`);
      lines2.push(`Waist Circumference (cm): ${vs.waist_circumference_cm !== undefined && vs.waist_circumference_cm !== null ? vs.waist_circumference_cm : ''}`);
      lines2.push(`Hip Circumference (cm): ${vs.hip_circumference_cm !== undefined && vs.hip_circumference_cm !== null ? vs.hip_circumference_cm : ''}\n`);

      lines2.push('=== PAST MEDICAL HISTORY ===');
      lines2.push(`Allergy (specify): ${pmh.allergy || ''}`);
      lines2.push(`Asthma:\n${chk(pmh.asthma === true)} Yes\n${chk(pmh.asthma === false)} No\n`);
      lines2.push(`Cancer (specify organ): ${pmh_can.organ || ''}`);
      lines2.push(`Cerebrovascular Disease:\n${chk(pmh.cerebrovascular_disease === true)} Yes\n${chk(pmh.cerebrovascular_disease === false)} No\n`);
      lines2.push(`Coronary Artery Disease:\n${chk(pmh.coronary_artery_disease === true)} Yes\n${chk(pmh.coronary_artery_disease === false)} No\n`);
      lines2.push(`Diabetes Mellitus:\n${chk(pmh.diabetes_mellitus === true)} Yes\n${chk(pmh.diabetes_mellitus === false)} No\n`);
      lines2.push(`Emphysema:\n${chk(pmh.emphysema === true)} Yes\n${chk(pmh.emphysema === false)} No\n`);
      lines2.push(`Epilepsy/Seizure Disorder:\n${chk(pmh.epilepsy_seizure_disorder === true)} Yes\n${chk(pmh.epilepsy_seizure_disorder === false)} No\n`);
      lines2.push(`Hepatitis (specify type): ${pmh_hep.type || ''}`);
      lines2.push(`Hyperlipidemia:\n${chk(pmh.hyperlipidemia === true)} Yes\n${chk(pmh.hyperlipidemia === false)} No\n`);
      lines2.push(`Hypertension:\n${chk(pmh_htn.has === true)} Yes\n${chk(pmh_htn.has === false)} No`);
      lines2.push(`Highest BP Recorded: ${pmh_htn.highest_bp || ''}\n`);
      lines2.push(`Peptic Ulcer Disease:\n${chk(pmh.peptic_ulcer_disease === true)} Yes\n${chk(pmh.peptic_ulcer_disease === false)} No\n`);
      lines2.push(`Pneumonia:\n${chk(pmh.pneumonia === true)} Yes\n${chk(pmh.pneumonia === false)} No\n`);
      lines2.push(`Thyroid Disease:\n${chk(pmh.thyroid_disease === true)} Yes\n${chk(pmh.thyroid_disease === false)} No\n`);
      lines2.push(`Tuberculosis (specify organ): ${pmh_tb.organ || ''}`);
      lines2.push(`If Pulmonary TB Category: ${pmh_tb.category || ''}\n`);
      lines2.push(`Urinary Tract Infection:\n${chk(pmh.urinary_tract_infection === true)} Yes\n${chk(pmh.urinary_tract_infection === false)} No\n`);
      lines2.push(`Others: ${pmh.others || ''}\n`);

      lines2.push('=== PAST SURGICAL HISTORY ===');
      lines2.push(`Operation: ${psh.operation || ''}`);
      lines2.push(`Date: ${psh.date || ''}\n`);

      lines2.push('=== FAMILY HISTORY ===');
      lines2.push(`Allergy (specify): ${fh2.allergy || ''}`);
      lines2.push(`Asthma:\n${chk(fh2.asthma === true)} Yes\n${chk(fh2.asthma === false)} No\n`);
      lines2.push(`Cancer (specify organ): ${fh_can.organ || ''}`);
      lines2.push(`Cerebrovascular Disease:\n${chk(fh2.cerebrovascular_disease === true)} Yes\n${chk(fh2.cerebrovascular_disease === false)} No\n`);
      lines2.push(`Coronary Artery Disease:\n${chk(fh2.coronary_artery_disease === true)} Yes\n${chk(fh2.coronary_artery_disease === false)} No\n`);
      lines2.push(`Diabetes Mellitus:\n${chk(fh2.diabetes_mellitus === true)} Yes\n${chk(fh2.diabetes_mellitus === false)} No\n`);
      lines2.push(`Emphysema:\n${chk(fh2.emphysema === true)} Yes\n${chk(fh2.emphysema === false)} No\n`);
      lines2.push(`Epilepsy/Seizure Disorder:\n${chk(fh2.epilepsy_seizure_disorder === true)} Yes\n${chk(fh2.epilepsy_seizure_disorder === false)} No\n`);
      lines2.push(`Hepatitis (specify type): ${fh_hep.type || ''}`);
      lines2.push(`Hyperlipidemia:\n${chk(fh2.hyperlipidemia === true)} Yes\n${chk(fh2.hyperlipidemia === false)} No\n`);
      lines2.push(`Hypertension:\n${chk(fh_htn.has === true)} Yes\n${chk(fh_htn.has === false)} No`);
      lines2.push(`Highest BP Recorded: ${fh_htn.highest_bp || ''}\n`);
      lines2.push(`Peptic Ulcer Disease:\n${chk(fh2.peptic_ulcer_disease === true)} Yes\n${chk(fh2.peptic_ulcer_disease === false)} No\n`);
      lines2.push(`Pneumonia:\n${chk(fh2.pneumonia === true)} Yes\n${chk(fh2.pneumonia === false)} No\n`);
      lines2.push(`Thyroid Disease:\n${chk(fh2.thyroid_disease === true)} Yes\n${chk(fh2.thyroid_disease === false)} No\n`);
      lines2.push(`Pulmonary Tuberculosis:\n${chk(fh2.pulmonary_tuberculosis === true)} Yes\n${chk(fh2.pulmonary_tuberculosis === false)} No\n`);
      lines2.push(`Extrapulmonary Tuberculosis:\n${chk(fh2.extrapulmonary_tuberculosis === true)} Yes\n${chk(fh2.extrapulmonary_tuberculosis === false)} No\n`);
      lines2.push(`Urinary Tract Infection:\n${chk(fh2.urinary_tract_infection === true)} Yes\n${chk(fh2.urinary_tract_infection === false)} No\n`);
      lines2.push(`Mental Illness:\n${chk(fh2.mental_illness === true)} Yes\n${chk(fh2.mental_illness === false)} No\n`);
      lines2.push(`Others: ${fh2.others || ''}\n`);

      lines2.push('=== PERSONAL / SOCIAL HISTORY ===');
      lines2.push(`Smoking:\n${chk(psoc_smk.yes)} Yes\n${chk(psoc_smk.no)} No\n${chk(psoc_smk.quit)} Quit`);
      lines2.push(`Pack Years: ${psoc_smk.pack_years !== undefined && psoc_smk.pack_years !== null ? psoc_smk.pack_years : ''}\n`);
      lines2.push(`Alcohol:\n${chk(psoc_alc.yes)} Yes\n${chk(psoc_alc.no)} No\n${chk(psoc_alc.quit)} Quit`);
      lines2.push(`Bottles per Day: ${psoc_alc.bottles_per_day !== undefined && psoc_alc.bottles_per_day !== null ? psoc_alc.bottles_per_day : ''}\n`);
      lines2.push(`Illicit Drugs:\n${chk(psoc_drg.yes)} Yes\n${chk(psoc_drg.no)} No\n${chk(psoc_drg.quit)} Quit\n`);
      lines2.push(`Sexually Active:\n${chk(psoc.sexually_active === true)} Yes\n${chk(psoc.sexually_active === false)} No\n`);

      lines2.push('=== IMMUNIZATIONS ===\n');
      lines2.push('-- CHILD CARE --');
      lines2.push(`BCG Date: ${imm_child.bcg_date || ''}`);
      lines2.push(`HepB Birth Date: ${imm_child.hepb_birth_date || ''}`);
      lines2.push(`HepB 24hrs Date: ${imm_child.hepb_24hrs_date || ''}`);
      lines2.push(`PENTA Date: ${imm_child.penta_date || ''}`);
      lines2.push(`OPV Date: ${imm_child.opv_date || ''}`);
      lines2.push(`IPV Date: ${imm_child.ipv_date || ''}`);
      lines2.push(`PCV Date: ${imm_child.pcv_date || ''}`);
      lines2.push(`Measles Vaccine Date: ${imm_child.measles_vaccine_date || ''}`);
      lines2.push(`Rotavirus Vaccine Date: ${imm_child.rotavirus_vaccine_date || ''}`);
      lines2.push(`Chickenpox Vaccine Date: ${imm_child.chickenpox_vaccine_date || ''}\n`);
      lines2.push('-- GENERAL --');
      lines2.push(`Flu Vaccine Date: ${imm_gen.flu_vaccine_date || ''}`);
      lines2.push(`HPV Date: ${imm_gen.hpv_date || ''}`);
      lines2.push(`HPV Grade 4 Date: ${imm_gen.hpv_grade4_date || ''}`);
      lines2.push(`MR Grade 1 Date: ${imm_gen.mr_grade1_date || ''}`);
      lines2.push(`MR Grade 7 Date: ${imm_gen.mr_grade7_date || ''}`);
      lines2.push(`TD Grade 1 Date: ${imm_gen.td_grade1_date || ''}`);
      lines2.push(`TD Grade 7 Date: ${imm_gen.td_grade7_date || ''}`);
      lines2.push(`Tetanus Toxoid Date: ${imm_gen.tetanus_toxoid_date || ''}\n`);
      lines2.push('-- ANIMAL BITE --');
      lines2.push(`PCECV1 Date: ${imm_ab.pcecv1_date || ''}`);
      lines2.push(`PVRV1 Date: ${imm_ab.pvrv1_date || ''}`);
      lines2.push(`PVRV2 Date: ${imm_ab.pvrv2_date || ''}`);
      lines2.push(`PVRV3 Date: ${imm_ab.pvrv3_date || ''}`);
      lines2.push(`PVRV4 Date: ${imm_ab.pvrv4_date || ''}`);
      lines2.push(`PCECV2 Date: ${imm_ab.pcecv2_date || ''}\n`);
      lines2.push('-- NCD --');
      lines2.push(`Pneumococcal Vaccine Date: ${imm_ncd.pneumococcal_vaccine_date || ''}`);
      lines2.push(`Flu Vaccine (NCD) Date: ${imm_ncd.flu_vaccine_date || ''}\n`);
      lines2.push('-- MATERNAL CARE --');
      lines2.push(`Tetanus Toxoid (Maternal) Date: ${imm_mat.tetanus_toxoid_date || ''}\n`);

      lines2.push('=== MENSTRUAL HISTORY ===');
      lines2.push(`Menarche Age: ${men.menarche_age !== undefined && men.menarche_age !== null ? men.menarche_age : ''}`);
      lines2.push(`Onset of Sexual Intercourse: ${men.onset_of_sexual_intercourse !== undefined && men.onset_of_sexual_intercourse !== null ? men.onset_of_sexual_intercourse : ''}`);
      lines2.push(`Last Menstrual Period: ${men.last_menstrual_period || ''}`);
      lines2.push(`Menstrual Bleeding Pattern: ${men.menstrual_bleeding_pattern || ''}`);
      lines2.push(`Birth Control Method: ${men.birth_control_method || ''}`);
      lines2.push(`Period Duration: ${men.period_duration || ''}`);
      lines2.push(`Cycle Interval: ${men.cycle_interval || ''}`);
      lines2.push(`Pads per Day: ${men.pads_per_day !== undefined && men.pads_per_day !== null ? men.pads_per_day : ''}\n`);
      lines2.push(`Menopause:\n${chk(men.menopause === true)} Yes\n${chk(men.menopause === false)} No`);
      lines2.push(`Age of Menopause: ${men.age_of_menopause !== undefined && men.age_of_menopause !== null ? men.age_of_menopause : ''}\n`);

      lines2.push('=== PREGNANCY HISTORY ===');
      lines2.push(`Gravidity: ${preg.gravidity !== undefined && preg.gravidity !== null ? preg.gravidity : ''}`);
      lines2.push(`Parity: ${preg.parity !== undefined && preg.parity !== null ? preg.parity : ''}`);
      lines2.push(`Type of Delivery: ${preg.type_of_delivery || ''}`);
      lines2.push(`Full Term: ${preg.full_term !== undefined && preg.full_term !== null ? preg.full_term : ''}`);
      lines2.push(`Premature: ${preg.premature !== undefined && preg.premature !== null ? preg.premature : ''}`);
      lines2.push(`Abortion: ${preg.abortion !== undefined && preg.abortion !== null ? preg.abortion : ''}`);
      lines2.push(`Living Children: ${preg.living_children !== undefined && preg.living_children !== null ? preg.living_children : ''}\n`);
      lines2.push(`Pre-eclampsia:\n${chk(preg.pre_eclampsia === true)} Yes\n${chk(preg.pre_eclampsia === false)} No\n`);
      lines2.push(`Age at First Pregnancy: ${preg.age_at_first_pregnancy !== undefined && preg.age_at_first_pregnancy !== null ? preg.age_at_first_pregnancy : ''}\n`);
      lines2.push(`Family Planning Counseling:\n${chk(preg.family_planning_counseling === true)} Yes\n${chk(preg.family_planning_counseling === false)} No`);
      return lines2.join('\n');
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

  // ─── ITR Paper Page 1 / Page 2 Switcher ────────
  window.switchItrPaperPage = function(page) {
    const p1 = document.getElementById('itr-paper-page1');
    const p2 = document.getElementById('itr-paper-page2');
    const btn1 = document.getElementById('subtab-itr-p1');
    const btn2 = document.getElementById('subtab-itr-p2');
    
    if (page === 1) {
      if (p1) p1.style.display = 'block';
      if (p2) p2.style.display = 'none';
      if (btn1) btn1.classList.add('active');
      if (btn2) btn2.classList.remove('active');
    } else {
      if (p1) p1.style.display = 'none';
      if (p2) p2.style.display = 'block';
      if (btn1) btn1.classList.remove('active');
      if (btn2) btn2.classList.add('active');
    }
  };

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

    // Auto-switch to Page 2 if data contains PhilHealth or Page 2 history keys
    if (data.philhealth_membership || data.past_medical_history || data.immunizations || data.menstrual_history || data.pregnancy_history || data.itr_page_number === 2) {
      switchItrPaperPage(2);
    } else {
      switchItrPaperPage(1);
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

    // ─── PAGE 2 POPULATION ───────────────────────────────────────
    const pm = data.philhealth_membership || {};
    setField('itr2-philhealth-id', pm.philhealth_id_number || '');
    const mt = pm.membership_type || {};
    setCheck('itr2-memtype-member', mt.member);
    setCheck('itr2-memtype-dependent', mt.dependent);
    setCheck('itr2-memtype-nonmember', mt.non_member);

    const mc = pm.membership_category || {};
    setCheck('itr2-memcat-sponsored', mc.sponsored);
    setCheck('itr2-memcat-ipp', mc.ipp);
    setCheck('itr2-memcat-employed', mc.employed);
    setCheck('itr2-memcat-lifetime', mc.lifetime);
    setCheck('itr2-memcat-nhits', mc.nhits);
    setCheck('itr2-memcat-lgu', mc.lgu);
    setCheck('itr2-memcat-organized', mc.organized_group);
    setCheck('itr2-memcat-government', mc.government);
    setCheck('itr2-memcat-nga', mc.nga);
    setCheck('itr2-memcat-private', mc.private);
    setCheck('itr2-memcat-ofw', mc.ofw);

    setField('itr2-vs-bp', vs.blood_pressure || '');
    setField('itr2-vs-hr', vs.heart_rate);
    setField('itr2-vs-rr', vs.respiratory_rate);
    setField('itr2-vs-pr', vs.pulse_rate);
    setField('itr2-vs-temp', vs.temperature);
    setField('itr2-vs-spo2', vs.spo2);
    setField('itr2-vs-height', vs.height_cm);
    setField('itr2-vs-weight', vs.weight_kg);
    setField('itr2-vs-waist', vs.waist_circumference_cm);
    setField('itr2-vs-hip', vs.hip_circumference_cm);

    const pmh = data.past_medical_history || {};
    setField('itr2-pmh-allergy', pmh.allergy || '');
    setCheck('itr2-pmh-asthma-yes', pmh.asthma === true);
    setCheck('itr2-pmh-asthma-no', pmh.asthma === false);

    const pmhCancer = pmh.cancer || {};
    setCheck('itr2-pmh-cancer-yes', pmhCancer.has === true || pmh.cancer === true);
    setCheck('itr2-pmh-cancer-no', pmhCancer.has === false || pmh.cancer === false);
    setField('itr2-pmh-cancer-organ', pmhCancer.organ || '');

    setCheck('itr2-pmh-cvd-yes', pmh.cerebrovascular_disease === true);
    setCheck('itr2-pmh-cvd-no', pmh.cerebrovascular_disease === false);
    setCheck('itr2-pmh-cad-yes', pmh.coronary_artery_disease === true);
    setCheck('itr2-pmh-cad-no', pmh.coronary_artery_disease === false);
    setCheck('itr2-pmh-dm-yes', pmh.diabetes_mellitus === true);
    setCheck('itr2-pmh-dm-no', pmh.diabetes_mellitus === false);
    setCheck('itr2-pmh-emphysema-yes', pmh.emphysema === true);
    setCheck('itr2-pmh-emphysema-no', pmh.emphysema === false);
    setCheck('itr2-pmh-epilepsy-yes', pmh.epilepsy_seizure_disorder === true);
    setCheck('itr2-pmh-epilepsy-no', pmh.epilepsy_seizure_disorder === false);

    const pmhHep = pmh.hepatitis || {};
    setCheck('itr2-pmh-hep-yes', pmhHep.has === true);
    setCheck('itr2-pmh-hep-no', pmhHep.has === false);
    setField('itr2-pmh-hep-type', pmhHep.type || '');

    setCheck('itr2-pmh-hyperlipid-yes', pmh.hyperlipidemia === true);
    setCheck('itr2-pmh-hyperlipid-no', pmh.hyperlipidemia === false);

    const pmhHtn = pmh.hypertension || {};
    setCheck('itr2-pmh-htn-yes', pmhHtn.has === true);
    setCheck('itr2-pmh-htn-no', pmhHtn.has === false);
    setField('itr2-pmh-htn-highest', pmhHtn.highest_bp || '');

    setCheck('itr2-pmh-pud-yes', pmh.peptic_ulcer_disease === true);
    setCheck('itr2-pmh-pud-no', pmh.peptic_ulcer_disease === false);
    setCheck('itr2-pmh-pneu-yes', pmh.pneumonia === true);
    setCheck('itr2-pmh-pneu-no', pmh.pneumonia === false);
    setCheck('itr2-pmh-thyroid-yes', pmh.thyroid_disease === true);
    setCheck('itr2-pmh-thyroid-no', pmh.thyroid_disease === false);

    const pmhTb = pmh.tuberculosis || {};
    setField('itr2-pmh-tb-organ', pmhTb.organ || '');
    setField('itr2-pmh-tb-category', pmhTb.category || '');

    setCheck('itr2-pmh-uti-yes', pmh.urinary_tract_infection === true);
    setCheck('itr2-pmh-uti-no', pmh.urinary_tract_infection === false);
    setField('itr2-pmh-others', pmh.others || '');

    const psh = data.past_surgical_history || {};
    setField('itr2-psh-op', psh.operation || '');
    setField('itr2-psh-date', psh.date || '');

    const psoc = data.personal_social_history || {};
    const psocSmk = psoc.smoking || {};
    setCheck('itr2-psoc-smk-yes', psocSmk.yes);
    setCheck('itr2-psoc-smk-no', psocSmk.no);
    setCheck('itr2-psoc-smk-quit', psocSmk.quit);
    setField('itr2-psoc-packyears', psocSmk.pack_years || '');

    const psocAlc = psoc.alcohol || {};
    setCheck('itr2-psoc-alc-yes', psocAlc.yes);
    setCheck('itr2-psoc-alc-no', psocAlc.no);
    setCheck('itr2-psoc-alc-quit', psocAlc.quit);
    setField('itr2-psoc-bottles', psocAlc.bottles_per_day || '');

    const psocDrugs = psoc.illicit_drugs || {};
    setCheck('itr2-psoc-drugs-yes', psocDrugs.yes);
    setCheck('itr2-psoc-drugs-no', psocDrugs.no);
    setCheck('itr2-psoc-drugs-quit', psocDrugs.quit);

    setCheck('itr2-psoc-sex-yes', psoc.sexually_active === true);
    setCheck('itr2-psoc-sex-no', psoc.sexually_active === false);

    const fh2 = data.family_history || {};
    setField('itr2-fh-allergy', fh2.allergy || '');
    setCheck('itr2-fh-asthma-yes', fh2.asthma === true);
    setCheck('itr2-fh-asthma-no', fh2.asthma === false);

    const fhCancer = fh2.cancer || {};
    setCheck('itr2-fh-cancer-yes', fhCancer.has === true);
    setCheck('itr2-fh-cancer-no', fhCancer.has === false);
    setField('itr2-fh-cancer-organ', fhCancer.organ || '');

    setCheck('itr2-fh-cvd-yes', fh2.cerebrovascular_disease === true);
    setCheck('itr2-fh-cvd-no', fh2.cerebrovascular_disease === false);
    setCheck('itr2-fh-cad-yes', fh2.coronary_artery_disease === true);
    setCheck('itr2-fh-cad-no', fh2.coronary_artery_disease === false);
    setCheck('itr2-fh-dm-yes', fh2.diabetes_mellitus === true);
    setCheck('itr2-fh-dm-no', fh2.diabetes_mellitus === false);
    setCheck('itr2-fh-emphysema-yes', fh2.emphysema === true);
    setCheck('itr2-fh-emphysema-no', fh2.emphysema === false);
    setCheck('itr2-fh-epilepsy-yes', fh2.epilepsy_seizure_disorder === true);
    setCheck('itr2-fh-epilepsy-no', fh2.epilepsy_seizure_disorder === false);

    const fhHep = fh2.hepatitis || {};
    setCheck('itr2-fh-hep-yes', fhHep.has === true);
    setCheck('itr2-fh-hep-no', fhHep.has === false);
    setField('itr2-fh-hep-type', fhHep.type || '');

    setCheck('itr2-fh-hyperlipid-yes', fh2.hyperlipidemia === true);
    setCheck('itr2-fh-hyperlipid-no', fh2.hyperlipidemia === false);

    const fhHtn = fh2.hypertension || {};
    setCheck('itr2-fh-htn-yes', fhHtn.has === true);
    setCheck('itr2-fh-htn-no', fhHtn.has === false);
    setField('itr2-fh-htn-highest', fhHtn.highest_bp || '');

    setCheck('itr2-fh-pud-yes', fh2.peptic_ulcer_disease === true);
    setCheck('itr2-fh-pud-no', fh2.peptic_ulcer_disease === false);
    setCheck('itr2-fh-pneu-yes', fh2.pneumonia === true);
    setCheck('itr2-fh-pneu-no', fh2.pneumonia === false);
    setCheck('itr2-fh-thyroid-yes', fh2.thyroid_disease === true);
    setCheck('itr2-fh-thyroid-no', fh2.thyroid_disease === false);
    setCheck('itr2-fh-ptb-yes', fh2.pulmonary_tuberculosis === true);
    setCheck('itr2-fh-ptb-no', fh2.pulmonary_tuberculosis === false);
    setCheck('itr2-fh-eptb-yes', fh2.extrapulmonary_tuberculosis === true);
    setCheck('itr2-fh-eptb-no', fh2.extrapulmonary_tuberculosis === false);
    setCheck('itr2-fh-uti-yes', fh2.urinary_tract_infection === true);
    setCheck('itr2-fh-uti-no', fh2.urinary_tract_infection === false);
    setCheck('itr2-fh-mental-yes', fh2.mental_illness === true);
    setCheck('itr2-fh-mental-no', fh2.mental_illness === false);
    setField('itr2-fh-others', fh2.others || '');

    const imm = data.immunizations || {};
    const child = imm.child_care || {};
    setField('itr2-imm-bcg', child.bcg_date || '');
    setField('itr2-imm-hepb-birth', child.hepb_birth_date || '');
    setField('itr2-imm-hepb-24h', child.hepb_24hrs_date || '');
    setField('itr2-imm-penta', child.penta_date || '');
    setField('itr2-imm-opv', child.opv_date || '');
    setField('itr2-imm-ipv', child.ipv_date || '');
    setField('itr2-imm-pcv', child.pcv_date || '');
    setField('itr2-imm-measles', child.measles_vaccine_date || '');
    setField('itr2-imm-rotavirus', child.rotavirus_vaccine_date || '');
    setField('itr2-imm-chickenpox', child.chickenpox_vaccine_date || '');

    const gen = imm.general || {};
    setField('itr2-imm-flu', gen.flu_vaccine_date || '');
    setField('itr2-imm-hpv', gen.hpv_date || '');
    setField('itr2-imm-hpv-g4', gen.hpv_grade4_date || '');
    setField('itr2-imm-mr-g1', gen.mr_grade1_date || '');
    setField('itr2-imm-mr-g7', gen.mr_grade7_date || '');
    setField('itr2-imm-td-g1', gen.td_grade1_date || '');
    setField('itr2-imm-td-g7', gen.td_grade7_date || '');
    setField('itr2-imm-tt', gen.tetanus_toxoid_date || '');

    const ab = imm.animal_bite || {};
    setField('itr2-imm-pcecv1', ab.pcecv1_date || '');
    setField('itr2-imm-pvrv1', ab.pvrv1_date || '');
    setField('itr2-imm-pvrv2', ab.pvrv2_date || '');
    setField('itr2-imm-pvrv3', ab.pvrv3_date || '');
    setField('itr2-imm-pvrv4', ab.pvrv4_date || '');
    setField('itr2-imm-pcecv2', ab.pcecv2_date || '');

    const ncd = imm.ncd || {};
    setField('itr2-imm-pneumo', ncd.pneumococcal_vaccine_date || '');
    setField('itr2-imm-flu-ncd', ncd.flu_vaccine_date || '');

    const mat = imm.maternal_care || {};
    setField('itr2-imm-tt-mat', mat.tetanus_toxoid_date || '');

    const men = data.menstrual_history || {};
    setField('itr2-men-age', men.menarche_age);
    setField('itr2-men-onset', men.onset_of_sexual_intercourse);
    setField('itr2-men-lmp', men.last_menstrual_period || '');
    setField('itr2-men-pattern', men.menstrual_bleeding_pattern || '');
    setField('itr2-men-method', men.birth_control_method || '');
    setField('itr2-men-duration', men.period_duration || '');
    setField('itr2-men-interval', men.cycle_interval || '');
    setField('itr2-men-pads', men.pads_per_day);
    setCheck('itr2-men-meno-yes', men.menopause === true);
    setCheck('itr2-men-meno-no', men.menopause === false);
    setField('itr2-men-menoage', men.age_of_menopause);

    const preg = data.pregnancy_history || {};
    setField('itr2-preg-grav', preg.gravidity);
    setField('itr2-preg-par', preg.parity);
    setField('itr2-preg-delivery', preg.type_of_delivery || '');
    setField('itr2-preg-fullterm', preg.full_term);
    setField('itr2-preg-premature', preg.premature);
    setField('itr2-preg-abortion', preg.abortion);
    setField('itr2-preg-living', preg.living_children);
    setCheck('itr2-preg-preeclamp-yes', preg.pre_eclampsia === true);
    setCheck('itr2-preg-preeclamp-no', preg.pre_eclampsia === false);
    setField('itr2-preg-agefirst', preg.age_at_first_pregnancy);
    setCheck('itr2-preg-fp-yes', preg.family_planning_counseling === true);
    setCheck('itr2-preg-fp-no', preg.family_planning_counseling === false);
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

  // ─── Classification Confirmation Modal Handlers ──────────────────
  const modalClassConfirm = document.getElementById('modal-classification-confirm');
  const modalClassSelect = document.getElementById('modal-class-select');
  const modalClassDetectedText = document.getElementById('modal-class-detected-text');
  const modalClassConfidenceBadge = document.getElementById('modal-class-confidence-badge');
  const modalClassCloseBtn = document.getElementById('modal-class-close-btn');
  const modalClassCancelBtn = document.getElementById('modal-class-cancel-btn');
  const modalClassConfirmBtn = document.getElementById('modal-class-confirm-btn');

  function showClassificationModal(suggestedPage, suggestedLabel, confidenceScore, confidenceLevel) {
    if (modalClassSelect) modalClassSelect.value = String(suggestedPage || 1);
    if (modalClassDetectedText) {
      modalClassDetectedText.innerHTML = `
        <svg style="width: 20px; height: 20px; fill: #2563eb;" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
        ${suggestedLabel || 'Individual Treatment Record - Page 1'}
      `;
    }
    if (modalClassConfidenceBadge) {
      const percent = Math.round((confidenceScore || 0.95) * 100);
      modalClassConfidenceBadge.textContent = `${confidenceLevel || 'HIGH CONFIDENCE'} (${percent}%)`;
    }
    if (modalClassConfirm) modalClassConfirm.style.display = 'flex';
  }

  function hideClassificationModal() {
    if (modalClassConfirm) modalClassConfirm.style.display = 'none';
  }

  if (modalClassCloseBtn) modalClassCloseBtn.addEventListener('click', hideClassificationModal);
  if (modalClassCancelBtn) modalClassCancelBtn.addEventListener('click', hideClassificationModal);

  // STAGE 1.5: User clicks "Confirm & Extract Text into OCR" -> Show Classification Confirmation Modal
  enhancementConfirmBtn.addEventListener('click', async () => {
    if (!currentToken) {
      showToast('Enhancement session missing. Please re-upload.', 'error');
      resetUploadStage();
      return;
    }

    try {
      showToast('Checking document classification...', 'info');
      const classifyRes = await API.postJson('/api/records/classify-preview', { token: currentToken });
      
      const suggestedPage = (classifyRes && classifyRes.suggested_page) ? classifyRes.suggested_page : 1;
      const suggestedLabel = (classifyRes && classifyRes.suggested_label) ? classifyRes.suggested_label : 'Individual Treatment Record - Page 1';
      const confidenceScore = (classifyRes && classifyRes.confidence_score) ? classifyRes.confidence_score : 0.95;
      const confidenceLevel = (classifyRes && classifyRes.confidence_level) ? classifyRes.confidence_level : 'HIGH CONFIDENCE';

      showClassificationModal(suggestedPage, suggestedLabel, confidenceScore, confidenceLevel);
    } catch (err) {
      console.warn('[CLASSIFY] Fast classification preview error, defaulting to Page 1:', err);
      showClassificationModal(1, 'Individual Treatment Record - Page 1', 0.80, 'MEDIUM CONFIDENCE');
    }
  });

  // User confirms target page in Classification Confirmation Modal
  if (modalClassConfirmBtn) {
    modalClassConfirmBtn.addEventListener('click', async () => {
      const selectedPage = parseInt(modalClassSelect ? modalClassSelect.value : '1', 10);
      hideClassificationModal();

      enhancementStage.style.display = 'none';
      ocrLoaderPanel.style.display = 'flex';

      const pageTitle = selectedPage === 2 ? 'Individual Treatment Record - Page 2' : 'Individual Treatment Record - Page 1';
      ocrTitle.textContent    = `Running OCR Text Extraction & Formatting for ${pageTitle}...`;
      ocrSubtitle.textContent = 'Extracting answers, structuring fields, and populating form template. Please wait...';

      try {
        const res = await API.postJson('/api/records/ocr-preview', { 
          token: currentToken, 
          page_type: selectedPage,
          confirmed_page: selectedPage 
        });

        if (res && res.success) {
          const preview = res.preview;

          // Expand content card for Stage 2 review
          document.getElementById('main-content-card').style.maxWidth = '1200px';

          reviewFilename.value      = preview.file_name;
          reviewCategory.value      = preview.suggested_category;
          reviewExtractedText.value = preview.extracted_text || '';
          reviewExplanationText.textContent = `User-Confirmed Classification Target: ${pageTitle}. Matched content words: [${(preview.matched_terms || []).join(', ')}]`;

          const reviewImg = document.getElementById('review-original-image');
          if (reviewImg) {
            reviewImg.src = preview.preview_url || '';
          }

          const itrBadge = document.getElementById('review-itr-page-badge');
          itrBadge.innerHTML = `<svg style="width: 14px; height: 14px; fill: currentColor;" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg> ${selectedPage === 2 ? 'ITR Page 2 (Philhealth, History & Immunizations)' : 'ITR Page 1 (Demographics, Lifestyle & Consultation)'}`;
          itrBadge.style.display = 'inline-flex';

          // Convert Extracted Digital Text into Accurate JSON and format into Standard Template
          let accurateExtractedJson = preview.itr_data;
          if (!accurateExtractedJson || (selectedPage === 1 && !accurateExtractedJson.header) || (selectedPage === 2 && !accurateExtractedJson.philhealth_membership)) {
            accurateExtractedJson = convertExtractedTextToAccurateJson(preview.extracted_text || '');
          }
          if (accurateExtractedJson && typeof accurateExtractedJson === 'object') {
            accurateExtractedJson.itr_page_number = selectedPage;
          }

          const standardFormattedText = (preview.extracted_text && selectedPage === 1 && preview.extracted_text.includes('=== HEALTH FACILITY HEADER ==='))
            ? preview.extracted_text
            : (preview.extracted_text && selectedPage === 2 && preview.extracted_text.includes('=== PHILHEALTH MEMBERSHIP INFORMATION ==='))
              ? preview.extracted_text
              : formatItrToStandardTemplate(accurateExtractedJson);

          reviewExtractedText.value   = standardFormattedText;

          console.log("%c=== ACCURATE EXTRACTED OCR DIGITAL TEXT JSON RESULT ===", "color: #6366f1; font-size: 15px; font-weight: bold; background: #0f172a; padding: 6px 12px; border-radius: 4px;");
          console.log(JSON.stringify(accurateExtractedJson, null, 2));

          // Switch Information Form subtab to match confirmed page
          if (window.switchItrPaperPage) {
            window.switchItrPaperPage(selectedPage);
          }

          // Automatically populate Information Form fields from accurate extracted JSON
          populateFormFieldsFromJson(accurateExtractedJson);

          ocrLoaderPanel.style.display = 'none';
          reviewPanel.style.display    = 'block';
          switchVerificationTab('form');
          switchFormSubSection('all');
          showToast(`Document processed for ${pageTitle}!`, 'success');
        } else {
          throw new Error(res ? res.message : 'OCR preview failed.');
        }
      } catch (err) {
        showToast(err.message || 'Failed to extract text from enhanced document.', 'error');
        ocrLoaderPanel.style.display    = 'none';
        enhancementStage.style.display  = 'block';
      }
    });
  }

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

    // Check if Page 2 is active or has populated fields
    const p2Container = document.getElementById('itr-paper-page2');
    const isPage2Active = p2Container && p2Container.style.display !== 'none';
    const hasPage2Data = isPage2Active || getVal('itr2-philhealth-id') || getVal('itr2-pmh-allergy') || getVal('itr2-imm-bcg') || getVal('itr2-men-lmp');

    if (hasPage2Data) {
      return {
        itr_page_number: 2,
        philhealth_membership: {
          philhealth_id_number: getVal('itr2-philhealth-id'),
          membership_type: {
            member: getChk('itr2-memtype-member'),
            dependent: getChk('itr2-memtype-dependent'),
            non_member: getChk('itr2-memtype-nonmember')
          },
          membership_category: {
            sponsored: getChk('itr2-memcat-sponsored'),
            ipp: getChk('itr2-memcat-ipp'),
            employed: getChk('itr2-memcat-employed'),
            lifetime: getChk('itr2-memcat-lifetime'),
            nhits: getChk('itr2-memcat-nhits'),
            lgu: getChk('itr2-memcat-lgu'),
            organized_group: getChk('itr2-memcat-organized'),
            government: getChk('itr2-memcat-government'),
            nga: getChk('itr2-memcat-nga'),
            private: getChk('itr2-memcat-private'),
            ofw: getChk('itr2-memcat-ofw')
          }
        },
        vital_signs: {
          blood_pressure: getVal('itr2-vs-bp'),
          heart_rate: getNumVal('itr2-vs-hr'),
          respiratory_rate: getNumVal('itr2-vs-rr'),
          pulse_rate: getNumVal('itr2-vs-pr'),
          temperature: getVal('itr2-vs-temp') || null,
          spo2: getNumVal('itr2-vs-spo2'),
          height_cm: getNumVal('itr2-vs-height'),
          weight_kg: getNumVal('itr2-vs-weight'),
          waist_circumference_cm: getNumVal('itr2-vs-waist'),
          hip_circumference_cm: getNumVal('itr2-vs-hip')
        },
        past_medical_history: {
          allergy: getVal('itr2-pmh-allergy'),
          asthma: getChk('itr2-pmh-asthma-yes') ? true : (getChk('itr2-pmh-asthma-no') ? false : null),
          cancer: {
            has: getChk('itr2-pmh-cancer-yes') ? true : (getChk('itr2-pmh-cancer-no') ? false : null),
            organ: getVal('itr2-pmh-cancer-organ')
          },
          cerebrovascular_disease: getChk('itr2-pmh-cvd-yes') ? true : (getChk('itr2-pmh-cvd-no') ? false : null),
          coronary_artery_disease: getChk('itr2-pmh-cad-yes') ? true : (getChk('itr2-pmh-cad-no') ? false : null),
          diabetes_mellitus: getChk('itr2-pmh-dm-yes') ? true : (getChk('itr2-pmh-dm-no') ? false : null),
          emphysema: getChk('itr2-pmh-emphysema-yes') ? true : (getChk('itr2-pmh-emphysema-no') ? false : null),
          epilepsy_seizure_disorder: getChk('itr2-pmh-epilepsy-yes') ? true : (getChk('itr2-pmh-epilepsy-no') ? false : null),
          hepatitis: {
            has: getChk('itr2-pmh-hep-yes') ? true : (getChk('itr2-pmh-hep-no') ? false : null),
            type: getVal('itr2-pmh-hep-type')
          },
          hyperlipidemia: getChk('itr2-pmh-hyperlipid-yes') ? true : (getChk('itr2-pmh-hyperlipid-no') ? false : null),
          hypertension: {
            has: getChk('itr2-pmh-htn-yes') ? true : (getChk('itr2-pmh-htn-no') ? false : null),
            highest_bp: getVal('itr2-pmh-htn-highest')
          },
          peptic_ulcer_disease: getChk('itr2-pmh-pud-yes') ? true : (getChk('itr2-pmh-pud-no') ? false : null),
          pneumonia: getChk('itr2-pmh-pneu-yes') ? true : (getChk('itr2-pmh-pneu-no') ? false : null),
          thyroid_disease: getChk('itr2-pmh-thyroid-yes') ? true : (getChk('itr2-pmh-thyroid-no') ? false : null),
          tuberculosis: {
            organ: getVal('itr2-pmh-tb-organ'),
            category: getVal('itr2-pmh-tb-category')
          },
          urinary_tract_infection: getChk('itr2-pmh-uti-yes') ? true : (getChk('itr2-pmh-uti-no') ? false : null),
          others: getVal('itr2-pmh-others')
        },
        past_surgical_history: {
          operation: getVal('itr2-psh-op'),
          date: getVal('itr2-psh-date')
        },
        family_history: {
          allergy: getVal('itr2-fh-allergy'),
          asthma: getChk('itr2-fh-asthma-yes') ? true : (getChk('itr2-fh-asthma-no') ? false : null),
          cancer: {
            has: getChk('itr2-fh-cancer-yes') ? true : (getChk('itr2-fh-cancer-no') ? false : null),
            organ: getVal('itr2-fh-cancer-organ')
          },
          cerebrovascular_disease: getChk('itr2-fh-cvd-yes') ? true : (getChk('itr2-fh-cvd-no') ? false : null),
          coronary_artery_disease: getChk('itr2-fh-cad-yes') ? true : (getChk('itr2-fh-cad-no') ? false : null),
          diabetes_mellitus: getChk('itr2-fh-dm-yes') ? true : (getChk('itr2-fh-dm-no') ? false : null),
          emphysema: getChk('itr2-fh-emphysema-yes') ? true : (getChk('itr2-fh-emphysema-no') ? false : null),
          epilepsy_seizure_disorder: getChk('itr2-fh-epilepsy-yes') ? true : (getChk('itr2-fh-epilepsy-no') ? false : null),
          hepatitis: {
            has: getChk('itr2-fh-hep-yes') ? true : (getChk('itr2-fh-hep-no') ? false : null),
            type: getVal('itr2-fh-hep-type')
          },
          hyperlipidemia: getChk('itr2-fh-hyperlipid-yes') ? true : (getChk('itr2-fh-hyperlipid-no') ? false : null),
          hypertension: {
            has: getChk('itr2-fh-htn-yes') ? true : (getChk('itr2-fh-htn-no') ? false : null),
            highest_bp: getVal('itr2-fh-htn-highest')
          },
          peptic_ulcer_disease: getChk('itr2-fh-pud-yes') ? true : (getChk('itr2-fh-pud-no') ? false : null),
          pneumonia: getChk('itr2-fh-pneu-yes') ? true : (getChk('itr2-fh-pneu-no') ? false : null),
          thyroid_disease: getChk('itr2-fh-thyroid-yes') ? true : (getChk('itr2-fh-thyroid-no') ? false : null),
          pulmonary_tuberculosis: getChk('itr2-fh-ptb-yes') ? true : (getChk('itr2-fh-ptb-no') ? false : null),
          extrapulmonary_tuberculosis: getChk('itr2-fh-eptb-yes') ? true : (getChk('itr2-fh-eptb-no') ? false : null),
          urinary_tract_infection: getChk('itr2-fh-uti-yes') ? true : (getChk('itr2-fh-uti-no') ? false : null),
          mental_illness: getChk('itr2-fh-mental-yes') ? true : (getChk('itr2-fh-mental-no') ? false : null),
          others: getVal('itr2-fh-others')
        },
        personal_social_history: {
          smoking: {
            yes: getChk('itr2-psoc-smk-yes'),
            no: getChk('itr2-psoc-smk-no'),
            quit: getChk('itr2-psoc-smk-quit'),
            pack_years: getNumVal('itr2-psoc-packyears')
          },
          alcohol: {
            yes: getChk('itr2-psoc-alc-yes'),
            no: getChk('itr2-psoc-alc-no'),
            quit: getChk('itr2-psoc-alc-quit'),
            bottles_per_day: getNumVal('itr2-psoc-bottles')
          },
          illicit_drugs: {
            yes: getChk('itr2-psoc-drugs-yes'),
            no: getChk('itr2-psoc-drugs-no'),
            quit: getChk('itr2-psoc-drugs-quit')
          },
          sexually_active: getChk('itr2-psoc-sex-yes') ? true : (getChk('itr2-psoc-sex-no') ? false : null)
        },
        immunizations: {
          child_care: {
            bcg_date: getVal('itr2-imm-bcg'),
            hepb_birth_date: getVal('itr2-imm-hepb-birth'),
            hepb_24hrs_date: getVal('itr2-imm-hepb-24h'),
            penta_date: getVal('itr2-imm-penta'),
            opv_date: getVal('itr2-imm-opv'),
            ipv_date: getVal('itr2-imm-ipv'),
            pcv_date: getVal('itr2-imm-pcv'),
            measles_vaccine_date: getVal('itr2-imm-measles'),
            rotavirus_vaccine_date: getVal('itr2-imm-rotavirus'),
            chickenpox_vaccine_date: getVal('itr2-imm-chickenpox')
          },
          general: {
            flu_vaccine_date: getVal('itr2-imm-flu'),
            hpv_date: getVal('itr2-imm-hpv'),
            hpv_grade4_date: getVal('itr2-imm-hpv-g4'),
            mr_grade1_date: getVal('itr2-imm-mr-g1'),
            mr_grade7_date: getVal('itr2-imm-mr-g7'),
            td_grade1_date: getVal('itr2-imm-td-g1'),
            td_grade7_date: getVal('itr2-imm-td-g7'),
            tetanus_toxoid_date: getVal('itr2-imm-tt')
          },
          animal_bite: {
            pcecv1_date: getVal('itr2-imm-pcecv1'),
            pvrv1_date: getVal('itr2-imm-pvrv1'),
            pvrv2_date: getVal('itr2-imm-pvrv2'),
            pvrv3_date: getVal('itr2-imm-pvrv3'),
            pvrv4_date: getVal('itr2-imm-pvrv4'),
            pcecv2_date: getVal('itr2-imm-pcecv2')
          },
          ncd: {
            pneumococcal_vaccine_date: getVal('itr2-imm-pneumo'),
            flu_vaccine_date: getVal('itr2-imm-flu-ncd')
          },
          maternal_care: {
            tetanus_toxoid_date: getVal('itr2-imm-tt-mat')
          }
        },
        menstrual_history: {
          menarche_age: getNumVal('itr2-men-age'),
          onset_of_sexual_intercourse: getNumVal('itr2-men-onset'),
          last_menstrual_period: getVal('itr2-men-lmp'),
          menstrual_bleeding_pattern: getVal('itr2-men-pattern'),
          birth_control_method: getVal('itr2-men-method'),
          period_duration: getVal('itr2-men-duration'),
          cycle_interval: getVal('itr2-men-interval'),
          pads_per_day: getNumVal('itr2-men-pads'),
          menopause: getChk('itr2-men-meno-yes') ? true : (getChk('itr2-men-meno-no') ? false : null),
          age_of_menopause: getNumVal('itr2-men-menoage')
        },
        pregnancy_history: {
          gravidity: getNumVal('itr2-preg-grav'),
          parity: getNumVal('itr2-preg-par'),
          type_of_delivery: getVal('itr2-preg-delivery'),
          full_term: getNumVal('itr2-preg-fullterm'),
          premature: getNumVal('itr2-preg-premature'),
          abortion: getNumVal('itr2-preg-abortion'),
          living_children: getNumVal('itr2-preg-living'),
          pre_eclampsia: getChk('itr2-preg-preeclamp-yes') ? true : (getChk('itr2-preg-preeclamp-no') ? false : null),
          age_at_first_pregnancy: getNumVal('itr2-preg-agefirst'),
          family_planning_counseling: getChk('itr2-preg-fp-yes') ? true : (getChk('itr2-preg-fp-no') ? false : null)
        }
      };
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
    document.getElementById('main-content-card').style.maxWidth = '900px';
  }
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


