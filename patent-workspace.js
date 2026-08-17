(() => {
  'use strict';

  const WORKSPACE_KEY = 'provisional-patent';
  const WORKSPACE_TITLE = 'Provisional Patent Application';
  const ANSWER_STATES = [
    ['needs_input', 'Needs input'],
    ['proposed', 'Proposed'],
    ['confirmed', 'Confirmed'],
    ['not_applicable', 'Not applicable']
  ];

  const sections = [
    {
      key: 'people',
      kicker: 'Start here',
      title: 'People & ownership',
      description: 'Name every inventor and resolve who owns the application. A name alone is not enough—the contribution and ownership trail must also be clear.',
      questions: [
        {
          key: 'inventors',
          label: 'Who are all of the inventors?',
          help: 'For each person, add city/state/country of residence and the specific feature or concept they personally conceived. Do not list someone only because they built or tested it.',
          type: 'textarea',
          required: true,
          defaultValue: 'Dwayne Tillman\nJoshua Millard\nThomas Hagy',
          defaultState: 'proposed'
        },
        {
          key: 'applicant_assignee',
          label: 'Who will own or receive the application?',
          help: 'State the applicant or assignee and identify any employment, contractor, invention-assignment, or later assignment document that supports ownership.',
          type: 'textarea',
          required: true
        },
        {
          key: 'correspondence',
          label: 'What correspondence identity should appear on the filing?',
          help: 'Provide one complete mailing address, email address, and telephone number.',
          type: 'textarea',
          required: true
        }
      ]
    },
    {
      key: 'disclosure',
      kicker: 'Dates matter',
      title: 'Disclosure & filing facts',
      description: 'These questions turn “we think” into dates, names, and explicit yes/no decisions that counsel can review.',
      questions: [
        {
          key: 'public_disclosure',
          label: 'Has any part of the invention been publicly disclosed, used, offered for sale, sold, pitched without confidentiality, or published?',
          help: 'Answer Yes, No, or Uncertain. If Yes or Uncertain, give the earliest known date, audience, location, and what was revealed.',
          type: 'textarea',
          required: true
        },
        {
          key: 'planned_disclosure',
          label: 'Is a public demo, sale, pitch, publication, or unrestricted handoff planned?',
          help: 'Give the event and date, or state “None planned before filing.”',
          type: 'textarea',
          required: true
        },
        {
          key: 'foreign_filing',
          label: 'Should foreign patent rights be preserved?',
          help: 'List the countries or answer No or Undecided. This is a decision flag for counsel, not a legal conclusion.',
          type: 'text',
          required: true
        },
        {
          key: 'related_applications',
          label: 'Are there any related patent applications or invention disclosures?',
          help: 'List each one by title and number, or state None.',
          type: 'textarea',
          required: true
        },
        {
          key: 'government_interest',
          label: 'Was U.S. Government funding, equipment, facilities, or a government contract involved?',
          help: 'Name the agency and contract or state None.',
          type: 'textarea',
          required: true
        },
        {
          key: 'entity_status',
          label: 'What fee status should be reviewed?',
          help: 'Choose a working answer. Eligibility still needs confirmation at filing.',
          type: 'select',
          options: ['Undecided', 'Undiscounted', 'Small entity', 'Micro entity'],
          required: true
        },
        {
          key: 'practitioner',
          label: 'Who will perform the final patent review and filing?',
          help: 'Name the registered patent attorney or agent, or state Pro se and name the responsible filer.',
          type: 'text',
          required: true
        }
      ]
    },
    {
      key: 'technical',
      kicker: 'Confirm the draft',
      title: 'Technical disclosure',
      description: 'The specification is already broadly drafted. Capture only what the existing draft gets wrong, leaves out, or treats as optional when it is actually essential.',
      questions: [
        {
          key: 'preferred_design',
          label: 'Which physical configuration is the preferred design today?',
          help: 'Identify the exact CAD/model, mount arrangement, camera position, Pi location, battery location, and cable route that represent the current best mode.',
          type: 'textarea',
          required: true
        },
        {
          key: 'alternatives',
          label: 'Which alternatives must the application preserve?',
          help: 'List real alternatives the team has contemplated—different mount locations, rails, carriers, sensors, counterbalance, materials, or removable modules.',
          type: 'textarea',
          required: true
        },
        {
          key: 'changes_since_draft',
          label: 'What changed or was learned after the August 14 draft?',
          help: 'List concrete changes. State None if the draft still matches the apparatus.',
          type: 'textarea',
          required: true
        },
        {
          key: 'materials_and_methods',
          label: 'What materials and fabrication methods are actually contemplated?',
          help: 'Name known print materials, inserts, fasteners, straps, pads, machining or molding alternatives, and any material choice that affects how the apparatus works.',
          type: 'textarea',
          required: true
        },
        {
          key: 'software_boundary',
          label: 'Which software or data behavior is part of the apparatus, and which is merely optional context?',
          help: 'Describe the local sensor/Pi/headset path, any calibration behavior, and any optional cloud or third-party software without turning brand names into required structure.',
          type: 'textarea',
          required: true
        },
        {
          key: 'missing_detail',
          label: 'Is any feature missing because the team assumed it was obvious?',
          help: 'Call out retention, load path, adjustability, connector protection, thermal management, balance, safety, calibration, assembly, or servicing details that should be described.',
          type: 'textarea',
          required: true
        }
      ]
    },
    {
      key: 'drawings',
      kicker: 'Ten defined views',
      title: 'Drawing intake',
      description: 'Every figure has one job. Attach a source view or example, name its owner, and mark it confirmed only when the written description and callouts agree.',
      drawings: [
        'Perspective assembly',
        'Exploded assembly',
        'Headset coupling detail',
        'Rail / quick-release detail',
        'Adjustable sensor carrier',
        'Cable and safety detail',
        'Optional active hub block diagram',
        'Alternative configurations and balance',
        'Calibration diagram',
        'Kit and installation method'
      ]
    },
    {
      key: 'review',
      kicker: 'No silent assumptions',
      title: 'Substantive review',
      description: 'The person checking each item should put their name beside it. A checked box means the question was actually reviewed, not merely seen.',
      checklist: [
        ['all_inventors', 'Every actual inventor is named and each listed inventor contributed to a disclosed invention.'],
        ['title_matches', 'The title matches across the specification and filing cover information.'],
        ['preferred_and_alternatives', 'The preferred embodiment, alternatives, and recently learned details are disclosed.'],
        ['drawings_match', 'Every necessary drawing is present and every figure label and reference numeral matches the text.'],
        ['no_missing_feature', 'No prototype feature is missing merely because the team assumed it was obvious.'],
        ['supporting_concerns', 'Support, performance, certification, regulatory, and safety statements are appropriately limited and supported.'],
        ['disclosure_reviewed', 'Public-disclosure, sale, offer-for-sale, demonstration, publication, and foreign-filing concerns were reviewed.'],
        ['clean_copy', 'The filing copy contains no draft warning, unresolved placeholder, comment, tracked change, or yellow completion field.']
      ]
    },
    {
      key: 'filing',
      kicker: 'Last mile',
      title: 'Filing readiness',
      description: 'This is a handoff checklist, not a submit button. The final filing remains a deliberate human action in USPTO Patent Center.',
      questions: [
        {
          key: 'final_specification',
          label: 'Where is the final specification-and-drawings PDF?',
          help: 'Attach it as a reference and record its filename or controlled location here.',
          type: 'text',
          required: true
        },
        {
          key: 'cover_information',
          label: 'Is the provisional cover sheet or ADS complete and consistent?',
          help: 'State Complete, Not complete, or Needs review and name the person responsible.',
          type: 'text',
          required: true
        },
        {
          key: 'fee_and_account',
          label: 'Who owns the Patent Center submission and fee check?',
          help: 'Name the filer, the account to be used, the entity-status decision, and the date fees will be rechecked.',
          type: 'textarea',
          required: true
        },
        {
          key: 'approval_to_file',
          label: 'Who must approve the final filing copy before submission?',
          help: 'List the required reviewers and record their approval state. Do not enter secrets or account credentials.',
          type: 'textarea',
          required: true
        },
        {
          key: 'filing_result',
          label: 'After filing, where will the receipt, application number, filing date, and confirmation number be recorded?',
          help: 'Define the controlled location now. Add the actual values only after submission.',
          type: 'textarea',
          required: true
        }
      ]
    }
  ];

  const state = {
    activeSection: 'people',
    version: 0,
    status: 'collecting',
    document: null,
    assets: [],
    revisions: [],
    dirty: false,
    saving: false
  };

  const elements = {};

  function defaultDocument() {
    const answers = {};
    for (const section of sections) {
      for (const question of section.questions || []) {
        answers[question.key] = {
          value: question.defaultValue || '',
          state: question.defaultState || 'needs_input',
          owner: ''
        };
      }
    }
    const drawings = Object.fromEntries(
      (sections.find((section) => section.key === 'drawings')?.drawings || [])
        .map((title, index) => [`figure_${index + 1}`, { title, state: 'needs_input', owner: '', notes: '' }])
    );
    const review = Object.fromEntries(
      (sections.find((section) => section.key === 'review')?.checklist || [])
        .map(([key]) => [key, { complete: false, reviewer: '' }])
    );
    return {
      schema_version: 1,
      source_draft: { label: 'Current provisional draft', draft_date: '2026-08-14' },
      answers,
      drawings,
      review
    };
  }

  function normalizeDocument(value) {
    const base = defaultDocument();
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const document = {
      ...input,
      schema_version: 1,
      source_draft: { ...base.source_draft, ...(input.source_draft || {}) },
      answers: { ...base.answers, ...(input.answers || {}) },
      drawings: { ...base.drawings, ...(input.drawings || {}) },
      review: { ...base.review, ...(input.review || {}) }
    };
    for (const [key, answer] of Object.entries(base.answers)) {
      document.answers[key] = { ...answer, ...(document.answers[key] || {}) };
    }
    for (const [key, drawing] of Object.entries(base.drawings)) {
      document.drawings[key] = { ...drawing, ...(document.drawings[key] || {}) };
    }
    for (const [key, item] of Object.entries(base.review)) {
      document.review[key] = { ...item, ...(document.review[key] || {}) };
    }
    return document;
  }

  function session() {
    const current = globalThis.MXGENIUS_CONFIG?.getSession?.() || {};
    return {
      accessToken: current.accessToken,
      organizationId: current.organizationId,
      correlationId: globalThis.crypto?.randomUUID?.()
    };
  }

  async function authenticatedSession() {
    await globalThis.MXGENIUS_CONFIG?.ready;
    let current = session();
    if (!current.accessToken && globalThis.MXGENIUS_AUTH?.getToken) {
      await globalThis.MXGENIUS_AUTH.getToken();
      current = session();
    }
    if (!current.accessToken) throw new Error('Sign in is required to open the shared workspace.');
    return current;
  }

  function setSaveState(message, value = '') {
    elements.saveState.textContent = message;
    elements.saveState.dataset.state = value;
  }

  function markDirty() {
    state.dirty = true;
    elements.save.disabled = false;
    setSaveState('Unsaved changes', 'dirty');
    elements.error.hidden = true;
    updateProgress();
  }

  function stateCounts(section) {
    if (section.questions) {
      const items = section.questions.map((question) => state.document.answers[question.key]);
      return [items.filter((item) => ['confirmed', 'not_applicable'].includes(item.state)).length, items.length];
    }
    if (section.drawings) {
      const items = section.drawings.map((_, index) => state.document.drawings[`figure_${index + 1}`]);
      return [items.filter((item) => ['confirmed', 'not_applicable'].includes(item.state)).length, items.length];
    }
    const items = section.checklist || [];
    return [items.filter(([key]) => state.document.review[key]?.complete).length, items.length];
  }

  function totalCounts() {
    return sections.reduce((totals, section) => {
      const [done, count] = stateCounts(section);
      return [totals[0] + done, totals[1] + count];
    }, [0, 0]);
  }

  function updateProgress() {
    const [done, total] = totalCounts();
    const percent = total ? Math.round((done / total) * 100) : 0;
    elements.progressBar.style.width = `${percent}%`;
    elements.progressText.textContent = `${done} of ${total} decisions confirmed · ${percent}%`;
    const active = sections.find((section) => section.key === state.activeSection);
    const [sectionDone, sectionTotal] = stateCounts(active);
    elements.sectionProgress.textContent = `${sectionDone}/${sectionTotal} confirmed`;
    renderNavigation();
  }

  function makeOption(value, label, selectedValue) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = value === selectedValue;
    return option;
  }

  function renderNavigation() {
    elements.sections.replaceChildren();
    for (const section of sections) {
      const [done, total] = stateCounts(section);
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.section = section.key;
      if (section.key === state.activeSection) button.setAttribute('aria-current', 'page');
      const name = document.createElement('span');
      name.textContent = section.title;
      const count = document.createElement('small');
      count.textContent = `${done}/${total}`;
      button.append(name, count);
      button.addEventListener('click', () => {
        state.activeSection = section.key;
        renderSection();
      });
      elements.sections.append(button);
    }
  }

  function answerControl(question, answer) {
    let control;
    if (question.type === 'select') {
      control = document.createElement('select');
      control.append(makeOption('', 'Select an answer', answer.value));
      for (const option of question.options || []) control.append(makeOption(option, option, answer.value));
    } else if (question.type === 'textarea') {
      control = document.createElement('textarea');
      control.rows = 4;
      control.value = answer.value || '';
    } else {
      control = document.createElement('input');
      control.type = question.type === 'date' ? 'date' : 'text';
      control.value = answer.value || '';
    }
    control.id = `answer-${question.key}`;
    control.addEventListener('input', () => {
      answer.value = control.value;
      if (answer.state === 'needs_input' && control.value.trim()) answer.state = 'proposed';
      markDirty();
    });
    return control;
  }

  function renderQuestions(section) {
    for (const question of section.questions) {
      const answer = state.document.answers[question.key];
      const card = document.createElement('article');
      card.className = 'question-card';
      card.dataset.state = answer.state;

      const top = document.createElement('div');
      top.className = 'question-card__top';
      const copy = document.createElement('div');
      const heading = document.createElement('h3');
      heading.textContent = question.label;
      if (question.required) {
        const required = document.createElement('span');
        required.className = 'question-required';
        required.textContent = ' *';
        required.title = 'Required before review';
        heading.append(required);
      }
      const help = document.createElement('p');
      help.textContent = question.help;
      copy.append(heading, help);

      const status = document.createElement('select');
      status.className = 'question-state';
      status.setAttribute('aria-label', `${question.label} answer state`);
      for (const [value, label] of ANSWER_STATES) status.append(makeOption(value, label, answer.state));
      status.addEventListener('change', () => {
        answer.state = status.value;
        card.dataset.state = answer.state;
        markDirty();
      });
      top.append(copy, status);

      const fields = document.createElement('div');
      fields.className = 'question-fields';
      const answerLabel = document.createElement('label');
      answerLabel.className = 'answer-wide';
      answerLabel.textContent = 'Team answer';
      answerLabel.append(answerControl(question, answer));
      const ownerLabel = document.createElement('label');
      ownerLabel.textContent = 'Owner for follow-up';
      const owner = document.createElement('input');
      owner.type = 'text';
      owner.value = answer.owner || '';
      owner.placeholder = 'Name or role';
      owner.addEventListener('input', () => { answer.owner = owner.value; markDirty(); });
      ownerLabel.append(owner);
      fields.append(answerLabel, ownerLabel);
      card.append(top, fields);
      elements.questions.append(card);
    }
  }

  function renderDrawings(section) {
    const grid = document.createElement('div');
    grid.className = 'drawing-grid';
    section.drawings.forEach((title, index) => {
      const key = `figure_${index + 1}`;
      const drawing = state.document.drawings[key];
      const card = document.createElement('article');
      card.className = 'drawing-card';
      const heading = document.createElement('h3');
      heading.textContent = `FIG. ${index + 1} · ${title}`;

      const statusLabel = document.createElement('label');
      statusLabel.textContent = 'State';
      const status = document.createElement('select');
      for (const [value, label] of ANSWER_STATES) status.append(makeOption(value, label, drawing.state));
      status.addEventListener('change', () => { drawing.state = status.value; markDirty(); });
      statusLabel.append(status);

      const ownerLabel = document.createElement('label');
      ownerLabel.textContent = 'Owner';
      const owner = document.createElement('input');
      owner.type = 'text';
      owner.value = drawing.owner || '';
      owner.placeholder = 'Name or role';
      owner.addEventListener('input', () => { drawing.owner = owner.value; markDirty(); });
      ownerLabel.append(owner);

      const notesLabel = document.createElement('label');
      notesLabel.textContent = 'Source / changes needed';
      const notes = document.createElement('textarea');
      notes.rows = 3;
      notes.value = drawing.notes || '';
      notes.placeholder = 'Identify the CAD view, example, missing callouts, or correction.';
      notes.addEventListener('input', () => { drawing.notes = notes.value; markDirty(); });
      notesLabel.append(notes);

      const attach = document.createElement('button');
      attach.type = 'button';
      attach.className = 'button button--small';
      attach.textContent = `Attach FIG. ${index + 1} source`;
      attach.addEventListener('click', () => {
        elements.referenceSection.value = 'drawings';
        elements.referenceNote.value = `FIG. ${index + 1} · ${title}: `;
        elements.referenceFile.click();
      });
      card.append(heading, statusLabel, ownerLabel, notesLabel, attach);
      grid.append(card);
    });
    elements.questions.append(grid);
  }

  function renderChecklist(section) {
    const list = document.createElement('div');
    list.className = 'checklist';
    for (const [key, label] of section.checklist) {
      const item = state.document.review[key];
      const row = document.createElement('label');
      row.className = 'check-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(item.complete);
      checkbox.addEventListener('change', () => { item.complete = checkbox.checked; markDirty(); });
      const text = document.createElement('span');
      text.textContent = label;
      const reviewer = document.createElement('input');
      reviewer.type = 'text';
      reviewer.value = item.reviewer || '';
      reviewer.placeholder = 'Reviewed by';
      reviewer.addEventListener('input', () => { item.reviewer = reviewer.value; markDirty(); });
      row.append(checkbox, text, reviewer);
      list.append(row);
    }
    elements.questions.append(list);
  }

  function renderSection() {
    const section = sections.find((candidate) => candidate.key === state.activeSection) || sections[0];
    elements.sectionKicker.textContent = section.kicker;
    elements.sectionTitle.textContent = section.title;
    elements.sectionDescription.textContent = section.description;
    elements.referenceSection.value = section.key;
    elements.questions.replaceChildren();
    if (section.questions) renderQuestions(section);
    else if (section.drawings) renderDrawings(section);
    else renderChecklist(section);
    updateProgress();
    renderReferences();
  }

  function formatDate(value) {
    if (!value) return 'Unknown time';
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString();
  }

  function formatSize(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }

  function renderReferences() {
    elements.referenceList.replaceChildren();
    if (!state.assets.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No references attached yet.';
      elements.referenceList.append(empty);
      return;
    }
    for (const asset of state.assets) {
      const item = document.createElement('article');
      item.className = 'reference-item';
      const name = document.createElement('strong');
      name.textContent = asset.original_filename;
      const details = document.createElement('small');
      const contributor = asset.uploaded_by_name || 'Team member';
      details.textContent = `${asset.section_key} · ${formatSize(asset.byte_size)} · ${contributor} · ${formatDate(asset.created_at)}`;
      if (asset.note) {
        const note = document.createElement('small');
        note.textContent = asset.note;
        item.append(name, details, note);
      } else {
        item.append(name, details);
      }
      const view = document.createElement('button');
      view.type = 'button';
      view.className = 'button button--small';
      view.textContent = 'Open';
      view.addEventListener('click', () => openAsset(asset, view));
      item.append(view);
      elements.referenceList.append(item);
    }
  }

  function renderRevisions() {
    elements.revisionList.replaceChildren();
    if (!state.revisions.length) {
      elements.revisionSummary.textContent = 'No team saves yet.';
      return;
    }
    elements.revisionSummary.textContent = `Version ${state.version} is the current team copy.`;
    for (const revision of state.revisions) {
      const item = document.createElement('li');
      const who = revision.saved_by_name || 'Team member';
      item.textContent = `v${revision.version} · ${who}`;
      const detail = document.createElement('small');
      detail.textContent = `${formatDate(revision.created_at)} · ${revision.status.replaceAll('_', ' ')}`;
      const archive = document.createElement('span');
      archive.className = 'archive-state';
      archive.dataset.state = revision.archive_state;
      archive.textContent = revision.archive_state === 'stored' ? '· blob archived' : '· blob archive pending';
      detail.append(archive);
      item.append(detail);
      elements.revisionList.append(item);
    }
  }

  function applyPayload(payload) {
    const workspace = payload?.workspace;
    state.version = Number(workspace?.version || 0);
    state.status = workspace?.status || 'collecting';
    state.document = normalizeDocument(workspace?.document);
    state.assets = Array.isArray(payload?.assets) ? payload.assets : [];
    state.revisions = Array.isArray(payload?.revisions) ? payload.revisions : [];
    state.dirty = false;
    elements.status.value = state.status;
    elements.save.disabled = true;
    setSaveState(
      state.version ? `Team version ${state.version} · saved ${formatDate(workspace.updated_at)}` : 'New workspace · not saved yet',
      state.version ? 'saved' : ''
    );
    renderSection();
    renderRevisions();
  }

  function showError(error) {
    const message = error?.message || String(error);
    elements.errorText.textContent = message;
    elements.error.hidden = false;
    setSaveState(error?.code === 'WORKSPACE_VERSION_CONFLICT' ? 'Newer team version available' : 'Save failed', 'error');
  }

  async function loadWorkspace() {
    elements.error.hidden = true;
    setSaveState('Loading team workspace…');
    try {
      const payload = await globalThis.MXApplicationClient.projectWorkspaces.get(
        WORKSPACE_KEY,
        await authenticatedSession()
      );
      applyPayload(payload);
    } catch (error) {
      showError(error);
      if (!state.document) applyPayload({ workspace: null, assets: [], revisions: [] });
    }
  }

  async function saveWorkspace() {
    if (state.saving) return false;
    state.saving = true;
    elements.save.disabled = true;
    setSaveState('Saving team version…');
    try {
      const payload = await globalThis.MXApplicationClient.projectWorkspaces.save(
        WORKSPACE_KEY,
        {
          title: WORKSPACE_TITLE,
          status: state.status,
          expectedVersion: state.version,
          document: state.document
        },
        await authenticatedSession()
      );
      applyPayload(payload);
      return true;
    } catch (error) {
      state.dirty = true;
      elements.save.disabled = false;
      showError(error);
      return false;
    } finally {
      state.saving = false;
    }
  }

  async function uploadReference(file) {
    if (!file) return;
    const priorLabel = elements.referenceChoose.textContent;
    elements.referenceChoose.disabled = true;
    elements.referenceChoose.textContent = 'Uploading…';
    try {
      if (state.version === 0 && !(await saveWorkspace())) return;
      await globalThis.MXApplicationClient.projectWorkspaces.uploadAsset(
        WORKSPACE_KEY,
        file,
        {
          section: elements.referenceSection.value,
          note: elements.referenceNote.value,
          session: await authenticatedSession()
        }
      );
      elements.referenceNote.value = '';
      const payload = await globalThis.MXApplicationClient.projectWorkspaces.get(
        WORKSPACE_KEY,
        await authenticatedSession()
      );
      applyPayload(payload);
    } catch (error) {
      showError(error);
    } finally {
      elements.referenceFile.value = '';
      elements.referenceChoose.disabled = false;
      elements.referenceChoose.textContent = priorLabel;
    }
  }

  async function openAsset(asset, button) {
    const popup = window.open('', '_blank');
    const priorLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Opening…';
    try {
      const blob = await globalThis.MXApplicationClient.projectWorkspaces.getAsset(
        WORKSPACE_KEY,
        asset.id,
        await authenticatedSession()
      );
      const url = URL.createObjectURL(blob);
      if (popup) popup.location.href = url;
      else window.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      popup?.close();
      showError(error);
    } finally {
      button.disabled = false;
      button.textContent = priorLabel;
    }
  }

  function captureElements() {
    elements.save = document.getElementById('workspaceSave');
    elements.saveState = document.getElementById('workspaceSaveState');
    elements.status = document.getElementById('workspaceStatus');
    elements.progressBar = document.getElementById('workspaceProgressBar');
    elements.progressText = document.getElementById('workspaceProgressText');
    elements.error = document.getElementById('workspaceError');
    elements.errorText = document.getElementById('workspaceErrorText');
    elements.reload = document.getElementById('workspaceReload');
    elements.sections = document.getElementById('workspaceSections');
    elements.sectionKicker = document.getElementById('sectionKicker');
    elements.sectionTitle = document.getElementById('sectionTitle');
    elements.sectionDescription = document.getElementById('sectionDescription');
    elements.sectionProgress = document.getElementById('sectionProgress');
    elements.questions = document.getElementById('sectionQuestions');
    elements.referenceSection = document.getElementById('referenceSection');
    elements.referenceNote = document.getElementById('referenceNote');
    elements.referenceFile = document.getElementById('referenceFile');
    elements.referenceChoose = document.getElementById('referenceChoose');
    elements.referenceList = document.getElementById('referenceList');
    elements.revisionSummary = document.getElementById('revisionSummary');
    elements.revisionList = document.getElementById('revisionList');
  }

  function bindEvents() {
    for (const section of sections) {
      elements.referenceSection.append(makeOption(section.key, section.title, state.activeSection));
    }
    elements.save.addEventListener('click', saveWorkspace);
    elements.reload.addEventListener('click', loadWorkspace);
    elements.status.addEventListener('change', () => {
      state.status = elements.status.value;
      markDirty();
    });
    elements.referenceChoose.addEventListener('click', () => elements.referenceFile.click());
    elements.referenceFile.addEventListener('change', () => uploadReference(elements.referenceFile.files?.[0]));
    window.addEventListener('beforeunload', (event) => {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
    window.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveWorkspace();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    captureElements();
    state.document = defaultDocument();
    bindEvents();
    renderSection();
    loadWorkspace();
  });
})();
