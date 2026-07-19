/**
 * MXGenius Onboarding Module
 *
 * Self-contained first-run experience: welcome modal with role selection,
 * role-adapted guided tour with tab switching, persistent hotspot pulses,
 * and improved empty-state CTAs for chart containers.
 */
const MXOnboarding = (() => {
  /* ── Constants ────────────────────────────────────────────────────── */
  const LS_COMPLETE = 'mxg_onboarding_complete';
  const LS_ROLE     = 'mxg_role';
  const PORTAL_ID   = 'onboardingRoot';

  const ROLES = [
    {
      id: 'mro',
      title: 'MRO Operator',
      desc: 'Plan maintenance, manage cases, and source parts for aircraft in your facility.',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`
    },
    {
      id: 'fleet',
      title: 'Fleet Manager',
      desc: 'Monitor fleet health, track utilization, and review compliance across your aircraft.',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`
    },
    {
      id: 'owner',
      title: 'Aircraft Owner',
      desc: 'Look up your aircraft, ask maintenance questions, and review records.',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`
    }
  ];

  /* ── Shared Tour Steps (all roles) ────────────────────────────────── */
  const SHARED_STEPS = [
    {
      target: '#mainNav',
      title: 'Navigation',
      body: 'Switch between Dashboard, Case, Operations, 3D Viewer, and Settings. Each tab is a workspace for a different part of your operation.',
      position: 'bottom'
    },
    {
      target: '#activeCaseCard, .active-case-card',
      title: 'Active Maintenance Case',
      body: 'Your current maintenance case lives here. All operations, evidence, and 3D findings anchor to it. Create one from the Case tab to get started.',
      position: 'bottom'
    },
    {
      target: '#chatToggleNav',
      title: 'AI Copilot',
      body: 'Ask questions about aircraft, triage maintenance issues, or use voice mode. Operational changes always require your explicit confirmation.',
      position: 'bottom-left'
    },
    {
      target: '#apiStatus',
      title: 'Connection Status',
      body: 'This indicator shows whether MXGenius is connected to fleet data and the capability service. Green means all systems ready.',
      position: 'bottom-left'
    },
    {
      target: '#globeVrButton',
      title: 'Fleet View in XR',
      body: 'On Meta Quest, open MXGenius in the native Quest Browser, load Fleet Context, then choose View in XR. The passthrough globe supports controller selection and fingertip contact with its fleet markers.',
      position: 'bottom-left',
      onEnter: () => { switchTabSafe('dashboard'); openFleetContext(); }
    }
  ];

  /* ── Role-Specific Steps ──────────────────────────────────────────── */
  const ROLE_STEPS = {
    mro: [
      {
        target: '[data-tab="case"]',
        title: 'Create a Maintenance Case',
        body: 'Start every maintenance event here. Enter the aircraft registration and describe the discrepancy — MXGenius builds the evidence context, finds similar cases, and checks compliance.',
        position: 'bottom',
        onEnter: () => switchTabSafe('case')
      },
      {
        target: '[data-tab="operations"]',
        title: 'Operational Tools',
        body: '50 tools organized by job: assess aircraft, plan maintenance, source parts, check weather, verify compliance, and review analytics. Start with "Plan and execute maintenance" for your daily workflow.',
        position: 'bottom',
        onEnter: () => switchTabSafe('operations')
      }
    ],
    fleet: [
      {
        target: '.fleet-section, details:has(#globeViz), [id*="fleet"]',
        title: 'Fleet Context',
        body: 'Your fleet lives here — an interactive globe with aircraft positions, a search explorer, and company/contact directory. Expand it to populate the dashboard charts below.',
        position: 'bottom',
        onEnter: () => { switchTabSafe('dashboard'); openFleetContext(); }
      },
      {
        target: '.dashboard-filters, .filter-row',
        title: 'Fleet Analytics',
        body: 'Filter by manufacturer, type, or status to drill into your fleet data. The charts below update in real time as you apply filters.',
        position: 'bottom',
        onEnter: () => switchTabSafe('dashboard')
      }
    ],
    owner: [
      {
        target: '.fleet-section, details:has(#globeViz), [id*="fleet"]',
        title: 'Find Your Aircraft',
        body: 'Open Fleet Context and search by your registration number (e.g., N12345) to find your aircraft. Click on it for full details — maintenance history, specifications, and current status.',
        position: 'bottom',
        onEnter: () => { switchTabSafe('dashboard'); openFleetContext(); }
      },
      {
        target: '#chatToggleNav',
        title: 'Ask MXGenius',
        body: 'Type a question about your aircraft to get maintenance guidance, AD applicability, or general aviation knowledge. Try the suggestion pills for common queries.',
        position: 'bottom-left',
        onEnter: () => switchTabSafe('dashboard')
      }
    ]
  };

  /* ── State ─────────────────────────────────────────────────────────── */
  let selectedRole = null;
  let tourIndex = 0;
  let tourSteps = [];
  let activeHotspots = [];

  /* ── Utilities ────────────────────────────────────────────────────── */
  function portal() {
    let el = document.getElementById(PORTAL_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = PORTAL_ID;
      document.body.appendChild(el);
    }
    return el;
  }

  function clearPortal() {
    const p = portal();
    p.innerHTML = '';
  }

  function findTarget(selector) {
    if (!selector) return null;
    const selectors = selector.split(',').map(s => s.trim());
    for (const s of selectors) {
      try {
        const el = document.querySelector(s);
        if (el && el.offsetParent !== null) return el;
        if (el) return el;
      } catch { /* ignore invalid selectors */ }
    }
    return null;
  }

  function switchTabSafe(tabId) {
    const tab = document.querySelector(`[data-tab="${tabId}"]`);
    if (tab) tab.click();
  }

  function openFleetContext() {
    // Try to open the Fleet Context <details> element
    const details = document.querySelector('details');
    if (details && !details.open) details.open = true;
  }

  function getRect(el) {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
  }

  /* ── Welcome Modal ────────────────────────────────────────────────── */
  function showWelcome() {
    clearPortal();
    const backdrop = document.createElement('div');
    backdrop.className = 'onboarding-backdrop';

    const card = document.createElement('div');
    card.className = 'onboarding-welcome';

    // Logo
    card.innerHTML = `
      <div class="onboarding-welcome__logo">
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M8 28c4-12 12-18 16-18s12 6 16 18"/>
          <path d="M14 26l10-6 10 6"/>
          <circle cx="24" cy="34" r="3" fill="currentColor" stroke="none"/>
        </svg>
      </div>
      <h1>Welcome to MXGenius</h1>
      <p>Maintenance intelligence for aviation — powered by evidence, controlled by you.<br>
      Choose your role to personalize the walkthrough.</p>
      <div class="onboarding-roles" id="onbRoles"></div>
      <button class="onboarding-start-btn" id="onbStartBtn" disabled>
        Get Started
        <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor"><path d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"/></svg>
      </button>
      <button class="onboarding-skip" id="onbSkipBtn">Skip walkthrough</button>
    `;

    backdrop.appendChild(card);
    portal().appendChild(backdrop);

    // Render role cards
    const rolesContainer = document.getElementById('onbRoles');
    ROLES.forEach(role => {
      const roleCard = document.createElement('div');
      roleCard.className = 'onboarding-role';
      roleCard.setAttribute('role', 'radio');
      roleCard.setAttribute('aria-checked', 'false');
      roleCard.setAttribute('tabindex', '0');
      roleCard.dataset.role = role.id;
      roleCard.innerHTML = `
        <div class="onboarding-role__icon">${role.icon}</div>
        <div class="onboarding-role__title">${role.title}</div>
        <p class="onboarding-role__desc">${role.desc}</p>
      `;
      roleCard.addEventListener('click', () => selectRole(role.id));
      roleCard.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRole(role.id); }
      });
      rolesContainer.appendChild(roleCard);
    });

    // Wire buttons
    document.getElementById('onbStartBtn').addEventListener('click', startTour);
    document.getElementById('onbSkipBtn').addEventListener('click', skipOnboarding);
  }

  function selectRole(roleId) {
    selectedRole = roleId;
    localStorage.setItem(LS_ROLE, roleId);
    document.querySelectorAll('.onboarding-role').forEach(card => {
      card.setAttribute('aria-checked', card.dataset.role === roleId ? 'true' : 'false');
    });
    const btn = document.getElementById('onbStartBtn');
    if (btn) btn.disabled = false;
  }

  function skipOnboarding() {
    markComplete();
    clearPortal();
  }

  function markComplete() {
    localStorage.setItem(LS_COMPLETE, 'true');
  }

  /* ── Guided Tour ──────────────────────────────────────────────────── */
  function startTour() {
    clearPortal();
    const role = selectedRole || 'mro';
    tourSteps = [...SHARED_STEPS, ...(ROLE_STEPS[role] || [])];
    tourIndex = 0;

    // Switch to dashboard first
    switchTabSafe('dashboard');
    setTimeout(() => showStep(), 200);
  }

  function showStep() {
    if (tourIndex >= tourSteps.length) {
      endTour();
      return;
    }

    const step = tourSteps[tourIndex];

    // Execute onEnter callback (tab switching, collapsible opening)
    if (step.onEnter) step.onEnter();

    // Delay slightly to let tab transitions complete
    setTimeout(() => renderStep(step), 180);
  }

  function renderStep(step) {
    clearPortal();

    const target = findTarget(step.target);
    const root = portal();

    // Create spotlight layer
    const spotlight = document.createElement('div');
    spotlight.className = 'onboarding-spotlight';

    // Click-mask behind the hole (clicking advances or closes)
    const mask = document.createElement('div');
    mask.className = 'onboarding-spotlight__mask';
    spotlight.appendChild(mask);

    // If we found a target, create a hole
    if (target) {
      const rect = getRect(target);
      const pad = 8;
      const hole = document.createElement('div');
      hole.className = 'onboarding-spotlight__hole';
      hole.style.top = (rect.top - pad) + 'px';
      hole.style.left = (rect.left - pad) + 'px';
      hole.style.width = (rect.width + pad * 2) + 'px';
      hole.style.height = (rect.height + pad * 2) + 'px';
      spotlight.appendChild(hole);
    }

    root.appendChild(spotlight);

    // Create tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'onboarding-tooltip';

    const stepLabel = document.createElement('span');
    stepLabel.className = 'onboarding-tooltip__step';
    stepLabel.textContent = `Step ${tourIndex + 1} of ${tourSteps.length}`;

    const title = document.createElement('h3');
    title.textContent = step.title;

    const body = document.createElement('p');
    body.textContent = step.body;

    const actions = document.createElement('div');
    actions.className = 'onboarding-tooltip__actions';

    if (tourIndex > 0) {
      const backBtn = document.createElement('button');
      backBtn.className = 'onboarding-tooltip__back';
      backBtn.textContent = 'Back';
      backBtn.addEventListener('click', () => { tourIndex--; showStep(); });
      actions.appendChild(backBtn);
    }

    const skipBtn = document.createElement('button');
    skipBtn.className = 'onboarding-tooltip__skip';
    skipBtn.textContent = 'Skip';
    skipBtn.addEventListener('click', () => { endTour(); });
    actions.appendChild(skipBtn);

    const nextBtn = document.createElement('button');
    nextBtn.className = 'onboarding-tooltip__next';
    nextBtn.textContent = tourIndex === tourSteps.length - 1 ? 'Finish' : 'Next';
    nextBtn.addEventListener('click', () => { tourIndex++; showStep(); });
    actions.appendChild(nextBtn);

    tooltip.appendChild(stepLabel);
    tooltip.appendChild(title);
    tooltip.appendChild(body);
    tooltip.appendChild(actions);

    root.appendChild(tooltip);

    // Position tooltip relative to target
    positionTooltip(tooltip, target, step.position);

    // Focus management
    nextBtn.focus();
  }

  function positionTooltip(tooltip, target, position) {
    if (!target) {
      // Center in viewport
      tooltip.style.top = '50%';
      tooltip.style.left = '50%';
      tooltip.style.transform = 'translate(-50%, -50%)';
      return;
    }

    const rect = getRect(target);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 16;

    // Force layout to get tooltip dimensions
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = 'block';
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    tooltip.style.visibility = '';

    let top, left;

    switch (position) {
      case 'bottom':
        top = rect.bottom + pad;
        left = rect.left + rect.width / 2 - tw / 2;
        break;
      case 'bottom-left':
        top = rect.bottom + pad;
        left = rect.right - tw;
        break;
      case 'top':
        top = rect.top - th - pad;
        left = rect.left + rect.width / 2 - tw / 2;
        break;
      case 'left':
        top = rect.top + rect.height / 2 - th / 2;
        left = rect.left - tw - pad;
        break;
      case 'right':
        top = rect.top + rect.height / 2 - th / 2;
        left = rect.right + pad;
        break;
      default:
        top = rect.bottom + pad;
        left = rect.left;
    }

    // Clamp to viewport
    if (left < 12) left = 12;
    if (left + tw > vw - 12) left = vw - tw - 12;
    if (top + th > vh - 12) top = rect.top - th - pad;
    if (top < 12) top = rect.bottom + pad;

    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
  }

  /* ── End Tour & Hotspots ──────────────────────────────────────────── */
  function endTour() {
    markComplete();
    clearPortal();
    switchTabSafe('dashboard');
    setTimeout(placeHotspots, 300);
  }

  function placeHotspots() {
    removeHotspots();

    const spots = [
      { target: '#chatToggleNav', dismissEvent: 'click' },
      { target: '#activeCaseCard, .active-case-card', dismissEvent: 'click' }
    ];

    spots.forEach(spot => {
      const el = findTarget(spot.target);
      if (!el) return;

      const dot = document.createElement('div');
      dot.className = 'onboarding-hotspot';

      // Position relative to the target
      const updatePosition = () => {
        const rect = getRect(el);
        dot.style.top = (rect.top - 2) + 'px';
        dot.style.left = (rect.right - 4) + 'px';
        dot.style.position = 'fixed';
      };
      updatePosition();

      document.body.appendChild(dot);
      activeHotspots.push({ dot, el, updatePosition });

      // Dismiss on first interaction
      const dismiss = () => {
        dot.classList.add('onboarding-hotspot--fade');
        setTimeout(() => dot.remove(), 500);
        el.removeEventListener(spot.dismissEvent, dismiss);
      };
      el.addEventListener(spot.dismissEvent, dismiss, { once: true });
    });

    // Reposition on scroll/resize
    const reposition = () => activeHotspots.forEach(h => h.updatePosition());
    window.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition, { passive: true });
  }

  function removeHotspots() {
    activeHotspots.forEach(h => h.dot.remove());
    activeHotspots = [];
  }

  /* ── Empty State CTAs ─────────────────────────────────────────────── */
  const CHART_ICON = `<svg class="onboarding-empty-cta__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3v6h-6"/></svg>`;

  /**
   * Call this from renderDashboard() when a chart container has no data.
   * Replaces the bare "No data" text with a styled CTA that opens Fleet Context.
   */
  function injectEmptyCta(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Don't double-inject
    if (container.querySelector('.onboarding-empty-cta')) return;

    // Clear the "No data" text
    const existing = container.querySelector('div');
    if (existing && existing.textContent.trim().toLowerCase().includes('no data')) {
      existing.remove();
    } else if (container.textContent.trim().toLowerCase().includes('no data') ||
               container.textContent.trim().toLowerCase().includes('no engine') ||
               container.textContent.trim().toLowerCase().includes('no maintenance')) {
      container.textContent = '';
    }

    const cta = document.createElement('div');
    cta.className = 'onboarding-empty-cta';
    cta.innerHTML = `
      ${CHART_ICON}
      <span class="onboarding-empty-cta__text">Fleet data loads when Fleet Context is expanded above</span>
      <button class="onboarding-empty-cta__link" type="button">Open Fleet Context →</button>
    `;

    const link = cta.querySelector('.onboarding-empty-cta__link');
    link.addEventListener('click', () => {
      openFleetContext();
      // Scroll to top smoothly
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    container.appendChild(cta);
  }

  /**
   * Scan all known chart containers and inject CTAs where empty.
   * Safe to call multiple times — skips containers that already have content.
   */
  function refreshEmptyStates() {
    const chartIds = [
      'chartManufacturer', 'chartType', 'chartAdsb',
      'chartAge', 'chartEngine', 'chartMaint'
    ];

    chartIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;

      const hasRealContent = el.querySelector('canvas, svg:not(.onboarding-empty-cta__icon), .bar, .donut');
      const textContent = el.textContent.trim().toLowerCase();
      const isEmpty = !hasRealContent && (
        textContent.includes('no data') ||
        textContent.includes('no engine') ||
        textContent.includes('no maintenance') ||
        textContent === ''
      );

      if (isEmpty) injectEmptyCta(id);
    });
  }

  /* ── Public API ───────────────────────────────────────────────────── */

  /**
   * Call after login completes. Shows welcome modal if first visit.
   */
  function checkFirstRun() {
    if (localStorage.getItem(LS_COMPLETE) === 'true') {
      // Still refresh empty states for returning users
      setTimeout(refreshEmptyStates, 1500);
      return;
    }
    // Small delay so the dashboard has time to render
    setTimeout(showWelcome, 600);
  }

  /**
   * Restart the onboarding experience (called from Settings).
   */
  function restart() {
    localStorage.removeItem(LS_COMPLETE);
    localStorage.removeItem(LS_ROLE);
    selectedRole = null;
    tourIndex = 0;
    removeHotspots();
    showWelcome();
  }

  /**
   * Get the stored user role.
   */
  function getRole() {
    return localStorage.getItem(LS_ROLE) || null;
  }

  return Object.freeze({
    checkFirstRun,
    restart,
    getRole,
    refreshEmptyStates,
    injectEmptyCta
  });
})();
