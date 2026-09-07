(() => {
  'use strict';

  const WORKSPACE_KEY = 'integration-readiness';
  const WORKSPACE_TITLE = 'MXGenius Integration Readiness';
  const STATUS_OPTIONS = [
    ['needs_input', 'Needs team input'],
    ['scoped', 'Scope agreed'],
    ['access_needed', 'Access / hardware needed'],
    ['ready_to_test', 'Ready to test'],
    ['proven', 'Proven']
  ];
  const NEED_OPTIONS = [
    ['demo', 'Required for first demo'],
    ['v1', 'Required for v1'],
    ['future', 'Later phase'],
    ['review', 'Need to decide']
  ];
  const MIGRATION_TIMING_OPTIONS = [
    ['now', 'Start now'],
    ['before_funds', 'Before money moves'],
    ['before_release', 'Before next release'],
    ['after_access', 'After company access exists'],
    ['review', 'Sequence to confirm']
  ];
  const MIGRATION_STATUS_OPTIONS = [
    ['needs_input', 'Needs team input'],
    ['scoped', 'Scope agreed'],
    ['access_needed', 'Access needed'],
    ['ready_to_transfer', 'Ready to transfer'],
    ['transferred', 'Transferred']
  ];

  const starterSoftware = [
    {
      id: 'software-microsoft-teams', name: 'Microsoft Teams', url: 'https://teams.microsoft.com/', category: 'Communication', need: 'demo', status: 'scoped', owner: 'Unassigned',
      purpose: 'Bring the right people into an MXGenius case and deliver controlled alerts or handoffs.',
      dataIn: 'People, team/channel context, approved messages, files, and meeting links.',
      dataOut: 'Case link, summary, assigned action, escalation, or review request.',
      experience: 'The technician stays in MXGenius; the team receives a concise, linked handoff in the agreed Teams location.',
      notes: 'Confirm tenant, channel policy, guest access, notification rules, and whether the first demo posts or only prepares a draft.'
    },
    {
      id: 'software-adp', name: 'ADP', url: 'https://www.adp.com/', category: 'Workforce', need: 'review', status: 'needs_input', owner: 'Unassigned',
      purpose: 'Confirm whether staffing, certification, time, scheduling, or another workforce function belongs in the maintenance flow.',
      dataIn: 'Team must identify the exact ADP product, authorized fields, and business event.',
      dataOut: 'Team must decide whether MXGenius reads, links, drafts, or writes anything.',
      experience: 'Define the smallest useful action without exposing payroll or unrelated employee data.',
      notes: 'Starter prompt only. Do not connect until purpose, privacy boundary, owner, and authorization are explicit.'
    },
    {
      id: 'software-partspace', name: 'PartSpace', url: '', category: 'Parts & procurement', need: 'demo', status: 'needs_input', owner: 'Unassigned',
      purpose: 'Locate or compare aviation parts inside the procurement workflow.',
      dataIn: 'Part number, alternates, seller or inventory result, availability, condition, and lead time as authorized.',
      dataOut: 'Search criteria, shortlist, source link, and buyer review request; no autonomous purchase.',
      experience: 'A part requirement opens a familiar sourcing view with evidence and a clear human purchasing decision.',
      notes: 'Add the exact vendor URL, API/product name, entitlement, sandbox availability, and named account owner.'
    },
    {
      id: 'software-faa-drs', name: 'FAA Dynamic Regulatory System (DRS)', url: 'https://drs.faa.gov/', category: 'Regulatory data', need: 'demo', status: 'scoped', owner: 'Unassigned',
      purpose: 'Surface candidate FAA regulatory material for applicability review.',
      dataIn: 'Airworthiness directives, type certificate data, and other approved/public FAA documents available to the workflow.',
      dataOut: 'Search terms, candidate references, applicability questions, and source links.',
      experience: 'MXGenius cites the authoritative source and asks for human applicability review; it never declares compliance by itself.',
      notes: 'Confirm which FAA collections and document types the first demo must prove.'
    },
    {
      id: 'software-boeing-data', name: 'Boeing technical data', url: 'https://myboeingfleet.boeing.com/', category: 'OEM technical data', need: 'review', status: 'access_needed', owner: 'Unassigned',
      purpose: 'Use authorized aircraft manuals, service information, and task references when Boeing aircraft are in scope.',
      dataIn: 'Only entitled, current, aircraft-applicable technical data and revision metadata.',
      dataOut: 'Deep link, cited section, extracted task context, and a request for technician review.',
      experience: 'Keep the approved source visible beside the answer and fail closed when currency, entitlement, or applicability is uncertain.',
      notes: 'Confirm fleet scope, MyBoeingFleet entitlement, licensing limits, access method, and demo aircraft.'
    },
    {
      id: 'software-jetnet', name: 'JetNet', url: 'https://www.jetnet.com/', category: 'Fleet intelligence', need: 'demo', status: 'ready_to_test', owner: 'Unassigned',
      purpose: 'Provide subscribed aircraft, fleet, model, and market context already represented in MXGenius.',
      dataIn: 'Authorized customer API aircraft and model intelligence.',
      dataOut: 'Queries and selected aircraft context; no claim of live aircraft tracking.',
      experience: 'Selecting an aircraft or location carries the same context into browser, 3D, and spatial views.',
      notes: 'Mounted integration; confirm production entitlement, visible availability state, and exact demo path.'
    },
    {
      id: 'software-entra', name: 'Microsoft Entra ID', url: 'https://entra.microsoft.com/', category: 'Identity & access', need: 'demo', status: 'proven', owner: 'Unassigned',
      purpose: 'Authenticate users and enforce organization and role boundaries.',
      dataIn: 'Approved identity and tenant claims.',
      dataOut: 'Application session and least-privilege authorization decisions.',
      experience: 'One secure sign-in, clear access state, and no provider credentials in the browser.',
      notes: 'Confirm first-demo users, roles, guest policy, and support owner.'
    },
    {
      id: 'software-internal-records', name: 'Internal maintenance / MRO record system', url: '', category: 'Internal operations', need: 'demo', status: 'needs_input', owner: 'Unassigned',
      purpose: 'Connect the system of record used to open, perform, defer, approve, and close maintenance work.',
      dataIn: 'Aircraft, discrepancy, work order, task, sign-off, attachment, and status data as authorized.',
      dataOut: 'Draft findings, linked evidence, completed steps, disposition, and approved record updates.',
      experience: 'MXGenius assists inside the existing maintenance process; it does not create a second competing record.',
      notes: 'Name the exact internal product, URL, data owner, write boundary, test environment, and required first-demo action.'
    }
  ];

  const starterDevices = [
    { id: 'device-pi', name: 'Raspberry Pi 5 · 16 GB', location: 'Inside enclosure', interface: 'Core compute and network gateway', power: 'Regulated supply from step-down converter', reading: 'Runs local bridge, device services, health, and diagnostic transport.', demo: 'Boot to the MXGenius kiosk, discover approved peripherals, and report stable health.', safety: 'Record OS image, service versions, thermal limits, shutdown procedure, and owner.', owner: 'Unassigned', need: 'demo', status: 'ready_to_test', notes: 'Validated as the current 16 GB edge-compute target; final enclosure acceptance is still required.' },
    { id: 'device-dewalt-battery', name: 'DeWalt battery + adapter', location: 'External power source', interface: 'Battery adapter into protected DC power path', power: 'Exact battery family, voltage, capacity, fuse, and connector need confirmation', reading: 'Supply voltage, current, remaining capacity, and fault/low-power state if available.', demo: 'Power the complete box safely for the required demo duration.', safety: 'Confirm pack model, protection, step-down input range, fuse, thermal clearance, and safe shutdown.', owner: 'Unassigned', need: 'demo', status: 'needs_input', notes: 'Compatibility is a working assumption until the exact battery, adapter, runtime, and protection path are documented and tested.' },
    { id: 'device-step-down', name: 'DC step-down converter', location: 'Inside enclosure', interface: 'Battery input to regulated Pi/peripheral rails', power: 'Input/output voltage and continuous/peak current must match final load', reading: 'Optional voltage/current/temperature telemetry if the selected unit exposes it.', demo: 'Hold stable power through boot, connected-device load, network use, and orderly shutdown.', safety: 'Select exact part number; verify fuse, heat, isolation, transient behavior, and connector polarity.', owner: 'Unassigned', need: 'demo', status: 'needs_input', notes: 'Add the selected converter and measured power budget.' },
    { id: 'device-port-panel', name: 'External port panel + cable harness', location: 'Enclosure boundary', interface: 'Panel-mounted USB, network, power, and approved sensor connections', power: 'Pass through only the rails required by the final devices', reading: 'Provides labeled, strain-relieved physical paths rather than a data reading itself.', demo: 'Every demo cable connects without opening the enclosure and remains secure during use.', safety: 'Define connector types, pinout, ESD protection, weather/dust expectation, strain relief, and labels.', owner: 'Unassigned', need: 'demo', status: 'needs_input', notes: 'This is the physical answer to “what attaches to the box”; finalize after the device list is locked.' },
    { id: 'device-fan', name: 'Enclosure cooling fan', location: 'Inside enclosure', interface: 'Pi-controlled or always-on fan header', power: 'Voltage, current, airflow, noise, and control method need final part selection', reading: 'Fan state/RPM and internal temperature if supported.', demo: 'Keep the Pi and power components within the agreed temperature range for the complete run.', safety: 'Document guards, airflow direction, filter/ingress effect, failure alert, and replacement access.', owner: 'Unassigned', need: 'demo', status: 'needs_input', notes: 'Match fan and vents to the final enclosure and measured thermal load.' },
    { id: 'device-flir', name: 'FLIR ONE thermal camera', location: 'External sensor', interface: 'Camera to Quest companion / approved device bridge; exact production cable path must be recorded', power: 'Camera/device dependent', reading: 'Thermal frames and camera readiness; temperature claims depend on supported calibration and mode.', demo: 'Show stable thermal imagery in the MXGenius spatial panel and attach selected evidence to a case.', safety: 'Keep camera readiness distinct from diagnostic readiness; resolve vendor library disposition before public release.', owner: 'Unassigned', need: 'demo', status: 'ready_to_test', notes: 'Mounted sensor path; final headset hardware acceptance remains.' },
    { id: 'device-quest', name: 'Meta Quest headset', location: 'External display / operator interface', interface: 'Wi-Fi/WebXR plus the native sensor companion', power: 'Headset battery or approved external power', reading: 'Head pose, controller/hand input, spatial panel state, and relayed sensor context.', demo: 'Open the apparatus workspace, view FLIR/Pi status, manipulate panels, and capture evidence.', safety: 'Confirm safe demo area, guardian/passthrough behavior, hygiene, battery state, and exit path.', owner: 'Unassigned', need: 'demo', status: 'ready_to_test', notes: 'Private Alpha path is mounted; complete the current on-hardware acceptance checklist.' },
    { id: 'device-drill', name: 'Demo drill / driver', location: 'External tool', interface: 'Unknown — select exact tool and available USB, Bluetooth, Wi-Fi, CAN, serial, or added sensor path', power: 'Name exact battery/tool model and whether the box powers it or only reads it', reading: 'Team must choose the useful signals: RPM, torque, trigger, battery, vibration, run time, or task result.', demo: 'Define the exact maintenance action the drill represents and what MXGenius must recognize or record.', safety: 'Specify guarding, operator qualification, limits, calibration needs, and a no-command / read-only boundary.', owner: 'Unassigned', need: 'demo', status: 'needs_input', notes: 'Placeholder for the exact drill. Add manufacturer, model, interface, expected measurement, and success evidence.' },
    { id: 'device-pressure', name: 'Pressure gauge / transducer', location: 'External sensor', interface: 'Unknown — analog, USB, Bluetooth, Wi-Fi, serial, or an acquisition module', power: 'Specify sensor excitation, range, connector, and whether isolation is required', reading: 'Pressure value, unit, range, sample rate, timestamp, calibration identity, and quality/fault state.', demo: 'Read a stable value, preserve its provenance, compare only against approved aircraft data, and record the human disposition.', safety: 'Exact medium, pressure range, accuracy, fittings, overpressure protection, calibration, and aircraft interface are required.', owner: 'Unassigned', need: 'demo', status: 'needs_input', notes: 'Placeholder for the exact gauge/transducer and aircraft-safe test setup.' },
    { id: 'device-ios', name: 'iPhone / iPad test device', location: 'External display / AR interface', interface: 'Secure network plus the MXGenius iOS wrapper', power: 'Device battery or approved charger', reading: 'Camera/AR pose, selected aircraft/model context, microphone state, and spatial UI events.', demo: 'Prove the agreed native AR and voice path on a named supported device.', safety: 'Record supported hardware/OS, permissions, test account, network, and device acceptance owner.', owner: 'Unassigned', need: 'review', status: 'ready_to_test', notes: 'Native AR path is mounted; decide whether it is part of the first black-box demo or a separate lane.' }
  ];

  const starterWorkflows = [
    { id: 'workflow-discrepancy', name: 'Troubleshoot a maintenance discrepancy', trigger: 'A technician describes or captures a discrepancy and asks what to check next.', inputs: 'Aircraft/case context, approved manuals, observations, history, connected readings, and technician experience.', response: 'Restate discrepancy → establish applicability → cite evidence → ordered diagnostic steps → cautions/stop conditions → human decision → record.', approval: 'An authorized person verifies the evidence and decides the maintenance disposition; MXGenius never releases the aircraft.', success: 'A technician can follow the reasoning, open every source, identify missing evidence, and save the reviewed outcome.', owner: 'Unassigned', need: 'demo', status: 'needs_input', example: 'Add one representative discrepancy and the gold-standard answer an experienced technician would expect.' },
    { id: 'workflow-device-reading', name: 'Interpret a connected tool or sensor reading', trigger: 'A supported device sends a measurement or the technician requests a live reading.', inputs: 'Device identity, calibration, value/unit/time, quality/fault state, aircraft/task context, and approved limit.', response: 'Observation → device provenance → approved comparison → meaning/uncertainty → next action → confirmation → trace record.', approval: 'The technician confirms the device and setup; authorized maintenance personnel own interpretation and disposition.', success: 'The reading and its provenance remain attached to the case, with no invented limit and a clear fail-closed state.', owner: 'Unassigned', need: 'demo', status: 'needs_input', example: 'Use the selected pressure gauge or drill signal once the exact device and maintenance scenario are locked.' },
    { id: 'workflow-part', name: 'Identify, source, and request a part', trigger: 'A task or finding creates a part requirement.', inputs: 'Aircraft/task applicability, part number, alternates, stock, condition, trace, seller results, lead time, and urgency.', response: 'Requirement → identity/applicability evidence → internal stock → external options → risk/gaps → recommended shortlist → buyer/quality approval.', approval: 'Quality confirms acceptable identity/trace/condition and an authorized buyer approves any transaction.', success: 'The team can explain why an option was shown, preserve source evidence, and create a controlled request without autonomous purchasing.', owner: 'Unassigned', need: 'demo', status: 'needs_input', example: 'Add one real or representative part requirement, acceptable alternates, evidence standard, and sourcing system.' },
    { id: 'workflow-regulatory', name: 'Review an FAA or OEM requirement', trigger: 'A user asks whether a regulatory or technical document may affect an aircraft, part, or task.', inputs: 'Aircraft serial/configuration, current FAA/OEM sources, revision/effective dates, applicability language, and maintenance records.', response: 'Question → authoritative candidates → applicability facts → conflicts/missing data → required review actions → owner → cited record.', approval: 'Authorized maintenance/compliance personnel make and record the applicability or compliance determination.', success: 'Every conclusion is traceable to a current source and MXGenius abstains when identity, currency, entitlement, or applicability is uncertain.', owner: 'Unassigned', need: 'demo', status: 'needs_input', example: 'Choose one familiar FAA or OEM applicability review and provide the expected section order and decision language.' },
    { id: 'workflow-handoff', name: 'Create a shift, escalation, or remote-support handoff', trigger: 'Work changes owner, needs expert help, or reaches a stop condition.', inputs: 'Case status, completed checks, evidence, unresolved questions, risk, next action, owner, and communication destination.', response: 'Situation → aircraft/task context → work completed → evidence → open risk/question → exact ask → owner/time → linked case record.', approval: 'The receiving person acknowledges ownership; required maintenance approvals remain in the system of record.', success: 'The next person can resume without repeating work, while Teams or another channel contains only the concise approved handoff and secure link.', owner: 'Unassigned', need: 'demo', status: 'needs_input', example: 'Add the team’s preferred handoff format and a representative escalation that should appear in Teams.' }
  ];

  const starterMigrations = [
    {
      id: 'migration-azure-ownership', name: 'Azure account ownership + operator access', platform: 'Microsoft Azure', timing: 'now', status: 'access_needed',
      currentOwner: 'Dwayne — current control; confirm tenant and billing owner', targetOwner: 'MXGenius legal entity + company-managed account', handoffOwner: 'Company operator other than Dwayne — assign',
      scope: 'Entra tenant, subscriptions, billing ownership, production administration, role assignments, recovery contacts, and support access.',
      platformRequirement: 'Confirm the exact Azure agreement and subscription type before choosing a billing-transfer or directory-transfer path. Those are separate changes and can affect access.',
      companyControl: 'MXGenius safeguard — self-imposed, not represented as a Microsoft requirement: the person who configures money to another account should not be the only person operating or approving that destination.',
      dependency: 'A company-managed identity must exist and the second operator must successfully sign in before any ownership change.',
      nextStep: 'Inventory the tenant, subscription, billing owner, and current roles; add the named company operator with least privilege; test recovery and production access.',
      success: 'MXGenius controls billing and administration, at least two authorized people can recover access, and Dwayne is no longer the sole operator.',
      helpUrl: 'https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/billing-subscription-transfer',
      notes: 'Do not move the tenant or subscription until role-loss effects, service identities, support plan, and rollback evidence have been reviewed.'
    },
    {
      id: 'migration-azure-runtime', name: 'Azure production services, data + secrets cutover', platform: 'Azure production estate', timing: 'after_access', status: 'scoped',
      currentOwner: 'Current Azure subscription / resource groups — inventory exact owner', targetOwner: 'MXGenius-controlled Azure environment', handoffOwner: 'Company cloud operator — assign',
      scope: 'Container Apps and APIs, PostgreSQL, Blob Storage, AI Search, Azure OpenAI, Web PubSub, monitoring, backups, DNS bindings, managed identities, app registrations, secrets, and deployment credentials.',
      platformRequirement: 'Service moves vary by resource type. Treat the subscription/directory decision as the boundary, then validate each dependency and identity before cutover.',
      companyControl: 'Keep a recoverable backup and a tested rollback path. Rotate personal credentials only after the company identity and services are proven.',
      dependency: 'Complete and test Azure company ownership and operator access first. Coordinate iOS and Quest builds so their API, identity, and signing configuration continue to point to the correct production endpoints.',
      nextStep: 'Create an exact resource-and-data inventory with owner, region, dependency, backup, secret, cost center, move method, and acceptance check for every production service.',
      success: 'The company operator deploys, restores, monitors, and pays for the full production estate under MXGenius control with no personal credential in the operating path.',
      helpUrl: 'https://learn.microsoft.com/en-us/azure/role-based-access-control/transfer-subscription',
      notes: 'Sequence: inventory and backup → add/test access → choose account boundary → move or re-home resources → rotate secrets → validate apps and data → retain rollback evidence.'
    },
    {
      id: 'migration-apple', name: 'Apple Developer + App Store Connect', platform: 'Apple / iOS', timing: 'now', status: 'needs_input',
      currentOwner: 'Current Apple team/account — confirm Account Holder', targetOwner: 'MXGenius organization membership', handoffOwner: 'Josh — confirm developer account; Rock — proposed setup lead (confirm)',
      scope: 'Organization enrollment, Account Holder and Admin access, App Store Connect roles, app record, TestFlight, bundle IDs, signing certificates, provisioning profiles, API keys, agreements, banking, and tax setup.',
      platformRequirement: 'Apple permits organization team members and one Account Holder. Decide whether this is a role transfer within an organization or an app transfer between accounts; the paths are not interchangeable.',
      companyControl: 'Company identities should own the legal, signing, recovery, and financial path. Keep named development access for the people building and releasing iOS.',
      dependency: 'Confirm Josh’s developer access, the current Account Holder, MXGenius organization enrollment, legal authority, and who “Rock” refers to before selecting the transfer path.',
      nextStep: 'Have Josh verify access; name the setup lead and intended Account Holder; inventory the app, build, signing, TestFlight, agreement, and banking state before changing teams.',
      success: 'An MXGenius Account Holder and backup Admin can sign, upload, test, submit, renew, accept agreements, and recover access without relying on Dwayne’s personal account.',
      helpUrl: 'https://developer.apple.com/help/account/access/transfer-the-account-holder-role/',
      notes: 'If a separate app transfer is required, first confirm eligibility and preserve app metadata, sales/download records, identifiers, entitlements, and signing continuity.'
    },
    {
      id: 'migration-partner-center', name: 'Microsoft Partner Center', platform: 'Microsoft Partner Center', timing: 'now', status: 'access_needed',
      currentOwner: 'Current personal authentication / tenant path — confirm', targetOwner: 'MXGenius work account and verified company profile', handoffOwner: 'Company Partner Center owner or manager — assign',
      scope: 'Company verification, tenant association, authentication, user roles, marketplace/developer program access, recovery, payout, tax, and support contacts as applicable.',
      platformRequirement: 'Partner Center access uses a Microsoft Entra work account and workspace roles. Verification, program enrollment, and financial profiles depend on the program actually in use.',
      companyControl: 'Use named company users, least-privilege roles, MFA, and a backup administrator; do not leave authentication or recovery with one personal account.',
      dependency: 'Confirm the MXGenius Entra tenant and legal profile, then identify the existing Partner Center seller/developer account and its current role holders.',
      nextStep: 'Sign in to the intended company tenant, complete any pending authentication or verification, add a second authorized user, and record exact workspace roles.',
      success: 'Two authorized MXGenius users can reach the required workspace; the company profile is verified; recovery, payout, tax, and support contacts are company-controlled.',
      helpUrl: 'https://learn.microsoft.com/en-us/partner-center/account-settings/add-manage-users',
      notes: 'Authentication may be the only immediate blocker, but confirm which Partner Center program and workspace are in scope before marking this transferred.'
    },
    {
      id: 'migration-github', name: 'GitHub organization + release ownership', platform: 'GitHub / GitHub Pages', timing: 'now', status: 'scoped',
      currentOwner: 'MxGenius-io organization — confirm current owners and billing manager', targetOwner: 'MXGenius-controlled organization', handoffOwner: 'Second organization owner — assign',
      scope: 'Repositories, Actions, Pages deployment, environments, secrets, CNAME/domain settings, app installations, security alerts, billing, and recovery.',
      platformRequirement: 'GitHub organizations support multiple owners and recommend at least two owners for continuity.',
      companyControl: 'Use company-managed identities, protected environments, 2FA, documented recovery, and no personal-only release secret.',
      dependency: 'Confirm the organization already represents the legal entity, then inventory owners, billing, installed apps, deploy keys, Actions secrets, and branch protections.',
      nextStep: 'Add and verify a second MXGenius organization owner, assign a billing manager if needed, and perform one release plus recovery walk-through.',
      success: 'A second authorized owner can administer the organization and deploy mxgenius.io without Dwayne’s account or local machine.',
      helpUrl: 'https://docs.github.com/en/organizations/managing-peoples-access-to-your-organization-with-roles/maintaining-ownership-continuity-for-your-organization',
      notes: 'The repository is already under MxGenius-io; this item verifies durable entity control rather than assuming the organization name alone completes the handoff.'
    },
    {
      id: 'migration-domain', name: 'Domain, DNS + company email administration', platform: 'mxgenius.io / registrar / DNS / mail', timing: 'before_release', status: 'needs_input',
      currentOwner: 'Current registrant, registrar, DNS, and mailbox administrators — confirm', targetOwner: 'MXGenius legal entity + company-managed admin accounts', handoffOwner: 'Primary and backup domain administrators — assign',
      scope: 'Registrant record, registrar account, renewal payment, recovery email/phone, DNS zone, nameservers, certificates, MX/SPF/DKIM/DMARC, shared mailboxes, and service aliases.',
      platformRequirement: 'The registrar controls its exact change-of-registrant and account-transfer process. Record any transfer lock or verification delay before changing data.',
      companyControl: 'Keep renewal, recovery, and DNS changes under company control with two named administrators and alerts sent to a company mailbox.',
      dependency: 'Identify the registrar, DNS host, mail provider, current registrant, renewal date, and every production record before making a change.',
      nextStep: 'Export the DNS zone, inventory records and certificates, add a backup company administrator, and ask the registrar for its entity/registrant change procedure.',
      success: 'MXGenius is the registrant, renewal and recovery use company contacts, two admins can operate DNS and mail, and the live site/authentication pass after a controlled test.',
      helpUrl: 'https://www.icann.org/en/groups/ssac/documents/sac-044-en.pdf',
      notes: 'Provider is intentionally left open until the current registrar, DNS host, and mail tenant are confirmed.'
    },
    {
      id: 'migration-meta', name: 'Meta Horizon developer team + Quest builds', platform: 'Meta Horizon / Quest', timing: 'before_release', status: 'needs_input',
      currentOwner: 'Current developer team and app owner — confirm', targetOwner: 'MXGenius developer team', handoffOwner: 'MXGenius team administrator and release manager — assign',
      scope: 'Developer team, organization verification, members and roles, app ownership, release channels, Quest build uploads, store assets, signing material, test users, financial account, and support access.',
      platformRequirement: 'Meta requires a developer team for app distribution and provides team members and roles in the Developer Dashboard. Confirm transfer support for the existing app before creating a replacement.',
      companyControl: 'Use a company team, verified administrators, scoped release permissions, and a second person able to upload and manage builds.',
      dependency: 'Identify the current team ID, app ID, owner/admins, Alpha channel, signing keys, package identity, and organization-verification state.',
      nextStep: 'Add the MXGenius administrator, confirm the team/app ownership path with Meta support if needed, and prove an Alpha build can be uploaded and installed by the new release owner.',
      success: 'The MXGenius team controls the Quest app, release channels, verification, signing, support, and financial settings with no personal-only dependency.',
      helpUrl: 'https://developers.meta.com/horizon/resources/publish-account-management-intro/',
      notes: 'Preserve the existing package/app identity and private Alpha path unless Meta confirms a safe transfer or replacement sequence.'
    },
    {
      id: 'migration-vendors', name: 'Vendor, API + data subscription ownership', platform: 'External providers', timing: 'review', status: 'needs_input',
      currentOwner: 'Current personal or project accounts — inventory', targetOwner: 'MXGenius contracts and company-managed identities', handoffOwner: 'Provider owner for each account — assign',
      scope: 'JetNet, parts vendors, OEM portals, communications, analytics, AI/provider accounts, test services, licenses, API keys, support contracts, billing, and renewal contacts.',
      platformRequirement: 'Each provider has its own contract, licensing, entitlement, and account-transfer rules. Some subscriptions may need a new company agreement rather than an ownership edit.',
      companyControl: 'Separate shared business access from personal credentials; give each provider one named owner, one backup, an approved billing source, and a secret-rotation record.',
      dependency: 'Use the Software list to identify every connected provider, then reconcile it against bank/card statements, password manager entries, source secrets, invoices, and support email.',
      nextStep: 'Create one migration row per real provider account, add its portal/help URL, contract owner, renewal date, data export, transfer method, and validation step, then remove this catch-all row.',
      success: 'Every paid or privileged external dependency is either company-owned, explicitly retired, or documented as non-transferable with a replacement plan.',
      helpUrl: '',
      notes: 'This is the completeness sweep for accounts not yet named. It should disappear once every provider has its own row.'
    }
  ];

  const state = { version: 0, document: null, dirty: false, saving: false, openItemId: null };
  const elements = {};

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function newId(prefix) { return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}`; }
  function clean(value, length = 4000) { return String(value ?? '').slice(0, length); }
  function allowed(value, options, fallback) { return options.some(([key]) => key === value) ? value : fallback; }
  function defaultDocument() { return { schema_version: 2, software: clone(starterSoftware), devices: clone(starterDevices), workflows: clone(starterWorkflows), migrations: clone(starterMigrations) }; }

  function normalizeSoftware(value) {
    const item = value && typeof value === 'object' ? value : {};
    return { id: clean(item.id || newId('software'), 100), name: clean(item.name || 'New software', 180), url: clean(item.url, 500), category: clean(item.category, 120), need: allowed(item.need, NEED_OPTIONS, 'review'), status: allowed(item.status, STATUS_OPTIONS, 'needs_input'), owner: clean(item.owner || 'Unassigned', 120), purpose: clean(item.purpose), dataIn: clean(item.dataIn), dataOut: clean(item.dataOut), experience: clean(item.experience), notes: clean(item.notes) };
  }
  function normalizeDevice(value) {
    const item = value && typeof value === 'object' ? value : {};
    return { id: clean(item.id || newId('device'), 100), name: clean(item.name || 'New device', 180), location: clean(item.location, 160), interface: clean(item.interface), power: clean(item.power), reading: clean(item.reading), demo: clean(item.demo), safety: clean(item.safety), owner: clean(item.owner || 'Unassigned', 120), need: allowed(item.need, NEED_OPTIONS, 'review'), status: allowed(item.status, STATUS_OPTIONS, 'needs_input'), notes: clean(item.notes) };
  }
  function normalizeWorkflow(value) {
    const item = value && typeof value === 'object' ? value : {};
    return { id: clean(item.id || newId('workflow'), 100), name: clean(item.name || 'New process', 180), trigger: clean(item.trigger), inputs: clean(item.inputs), response: clean(item.response), approval: clean(item.approval), success: clean(item.success), owner: clean(item.owner || 'Unassigned', 120), need: allowed(item.need, NEED_OPTIONS, 'review'), status: allowed(item.status, STATUS_OPTIONS, 'needs_input'), example: clean(item.example) };
  }
  function normalizeMigration(value) {
    const item = value && typeof value === 'object' ? value : {};
    return { id: clean(item.id || newId('migration'), 100), name: clean(item.name || 'New account or service migration', 180), platform: clean(item.platform, 160), timing: allowed(item.timing, MIGRATION_TIMING_OPTIONS, 'review'), status: allowed(item.status, MIGRATION_STATUS_OPTIONS, 'needs_input'), currentOwner: clean(item.currentOwner), targetOwner: clean(item.targetOwner), handoffOwner: clean(item.handoffOwner || 'Unassigned', 180), scope: clean(item.scope), platformRequirement: clean(item.platformRequirement), companyControl: clean(item.companyControl), dependency: clean(item.dependency), nextStep: clean(item.nextStep), success: clean(item.success), helpUrl: clean(item.helpUrl, 500), notes: clean(item.notes) };
  }
  function normalizeDocument(value) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      schema_version: 2,
      software: Array.isArray(input.software) ? input.software.map(normalizeSoftware) : clone(starterSoftware),
      devices: Array.isArray(input.devices) ? input.devices.map(normalizeDevice) : clone(starterDevices),
      workflows: Array.isArray(input.workflows) ? input.workflows.map(normalizeWorkflow) : clone(starterWorkflows),
      migrations: Array.isArray(input.migrations) ? input.migrations.map(normalizeMigration) : clone(starterMigrations)
    };
  }

  function currentSession() {
    const current = globalThis.MXGENIUS_CONFIG?.getSession?.() || {};
    return { accessToken: current.accessToken, organizationId: current.organizationId, account: current.account, correlationId: globalThis.crypto?.randomUUID?.() };
  }
  async function authenticatedSession() {
    await globalThis.MXGENIUS_CONFIG?.ready;
    let session = currentSession();
    if (!session.accessToken && globalThis.MXGENIUS_AUTH?.getToken) {
      await globalThis.MXGENIUS_AUTH.getToken();
      session = currentSession();
    }
    if (!session.accessToken) throw new Error('Sign in is required to open the shared readiness checklist.');
    return session;
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function optionSelect(options, value, label) {
    const select = document.createElement('select');
    select.setAttribute('aria-label', label);
    for (const [key, text] of options) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = text;
      option.selected = key === value;
      select.append(option);
    }
    return select;
  }
  function textField(item, key, label, options = {}) {
    const field = makeElement('label', `field${options.wide ? ' field--wide' : ''}${options.full ? ' field--full' : ''}`);
    field.append(makeElement('span', '', label));
    const control = options.multiline ? document.createElement('textarea') : document.createElement('input');
    if (options.multiline) control.rows = options.rows || 3;
    else control.type = options.type || 'text';
    control.value = item[key] || '';
    control.maxLength = options.maxLength || (options.type === 'url' ? 500 : 4000);
    if (options.placeholder) control.placeholder = options.placeholder;
    control.addEventListener('input', () => { item[key] = clean(control.value, control.maxLength); setDirty(); });
    field.append(control);
    if (options.help) field.append(makeElement('small', '', options.help));
    return field;
  }
  function selectField(item, key, label, options) {
    const field = makeElement('label', 'field');
    field.append(makeElement('span', '', label));
    const select = optionSelect(options, item[key], label);
    select.addEventListener('change', () => { item[key] = select.value; state.openItemId = item.id; setDirty(); renderAll(); });
    field.append(select);
    return field;
  }
  function statusLabel(value) { return STATUS_OPTIONS.find(([key]) => key === value)?.[1] || 'Needs team input'; }
  function migrationStatusLabel(value) { return MIGRATION_STATUS_OPTIONS.find(([key]) => key === value)?.[1] || 'Needs team input'; }
  function compactNeedLabel(value) {
    return { demo: 'First demo', v1: 'Version 1', future: 'Later', review: 'To decide' }[value] || 'To decide';
  }
  function compactMigrationTiming(value) {
    return { now: 'Start now', before_funds: 'Before money moves', before_release: 'Before release', after_access: 'After access', review: 'Sequence to confirm' }[value] || 'Sequence to confirm';
  }

  function itemSummary(item, context) {
    const summary = document.createElement('summary');
    const meta = makeElement('span', 'summary-meta');
    meta.append(
      makeElement('span', '', context || 'Details not set'),
      makeElement('span', '', compactNeedLabel(item.need)),
      makeElement('span', '', item.owner || 'Unassigned')
    );
    summary.append(
      makeElement('span', 'check-mark', item.status === 'proven' ? '✓' : '•'),
      makeElement('span', 'summary-name', item.name),
      meta,
      makeElement('span', 'status-pill', statusLabel(item.status))
    );
    return summary;
  }
  function itemActions(item, collection, rerender, url = '', linkLabel = 'Open system URL ↗') {
    const actions = makeElement('div', 'item-actions');
    const link = makeElement('a', '', linkLabel);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    let validUrl = '';
    try { validUrl = /^https?:$/.test(new URL(url).protocol) ? url : ''; } catch { validUrl = ''; }
    link.href = validUrl || '#';
    link.hidden = !validUrl;
    const remove = makeElement('button', 'button button--small button--danger', 'Remove from checklist');
    remove.type = 'button';
    remove.addEventListener('click', () => {
      if (!globalThis.confirm(`Remove “${item.name}” from the shared checklist?`)) return;
      const index = collection.findIndex((candidate) => candidate.id === item.id);
      if (index >= 0) collection.splice(index, 1);
      setDirty();
      rerender();
    });
    actions.append(link, remove);
    return actions;
  }

  function renderSoftwareItem(item) {
    const details = makeElement('details', 'check-item');
    details.dataset.status = item.status;
    details.open = state.openItemId === item.id;
    details.append(itemSummary(item, item.category || 'Software'));
    const form = makeElement('div', 'item-form');
    form.append(
      textField(item, 'name', 'System or software name'),
      textField(item, 'url', 'URL / portal', { type: 'url', placeholder: 'https://…' }),
      textField(item, 'category', 'Business area', { placeholder: 'Parts, manuals, communication…' }),
      selectField(item, 'need', 'When is it required?', NEED_OPTIONS),
      selectField(item, 'status', 'Readiness', STATUS_OPTIONS),
      textField(item, 'owner', 'Owner', { placeholder: 'Name or team' }),
      textField(item, 'purpose', 'Why MXGenius needs it', { multiline: true, wide: true }),
      textField(item, 'experience', 'How the team wants it to work', { multiline: true, wide: true }),
      textField(item, 'dataIn', 'What MXGenius may read', { multiline: true, wide: true }),
      textField(item, 'dataOut', 'What MXGenius may send or do', { multiline: true, wide: true }),
      textField(item, 'notes', 'Access, licensing, privacy, sandbox, blockers, or decisions', { multiline: true, full: true }),
      itemActions(item, state.document.software, renderAll, item.url)
    );
    details.append(form);
    return details;
  }

  function renderDeviceItem(item) {
    const details = makeElement('details', 'check-item');
    details.dataset.status = item.status;
    details.open = state.openItemId === item.id;
    details.append(itemSummary(item, item.location || 'Location not set'));
    const form = makeElement('div', 'item-form');
    form.append(
      textField(item, 'name', 'Exact device / part number'),
      textField(item, 'location', 'Where it sits', { placeholder: 'Inside enclosure or attaches outside' }),
      textField(item, 'owner', 'Owner', { placeholder: 'Name or team' }),
      selectField(item, 'need', 'When is it required?', NEED_OPTIONS),
      selectField(item, 'status', 'Readiness', STATUS_OPTIONS),
      textField(item, 'interface', 'How it connects to the box', { multiline: true, wide: true, help: 'Include physical connector and protocol: USB, Bluetooth, Wi-Fi, GPIO, analog, serial, CAN, or other.' }),
      textField(item, 'power', 'Power requirement', { multiline: true, wide: true }),
      textField(item, 'reading', 'What MXGenius must read', { multiline: true, wide: true, help: 'Include units, range, rate, device identity, calibration, and error state where relevant.' }),
      textField(item, 'demo', 'What the first demo must prove', { multiline: true, wide: true }),
      textField(item, 'safety', 'Safety, calibration, or physical constraints', { multiline: true, wide: true }),
      textField(item, 'notes', 'Open questions, purchase details, or test evidence', { multiline: true, wide: true }),
      itemActions(item, state.document.devices, renderAll)
    );
    details.append(form);
    return details;
  }

  function renderWorkflowItem(item) {
    const details = makeElement('details', 'check-item');
    details.dataset.status = item.status;
    details.open = state.openItemId === item.id;
    details.append(itemSummary(item, 'Aviation process'));
    const form = makeElement('div', 'item-form');
    form.append(
      textField(item, 'name', 'Process name', { wide: true }),
      textField(item, 'owner', 'Aviation expert / owner'),
      selectField(item, 'need', 'When is it required?', NEED_OPTIONS),
      selectField(item, 'status', 'Definition readiness', STATUS_OPTIONS),
      textField(item, 'trigger', 'When this process starts', { multiline: true, wide: true }),
      textField(item, 'inputs', 'Systems, devices, facts, and approved sources required', { multiline: true, wide: true }),
      textField(item, 'response', 'The answer order MXGenius should follow', { multiline: true, wide: true }),
      textField(item, 'approval', 'Human decision, sign-off, and stop condition', { multiline: true, wide: true }),
      textField(item, 'success', 'What proves this process works', { multiline: true, wide: true }),
      textField(item, 'example', 'Gold-standard example for MXGenius to mimic', { multiline: true, wide: true }),
      itemActions(item, state.document.workflows, renderAll)
    );
    details.append(form);
    return details;
  }

  function renderMigrationItem(item) {
    const details = makeElement('details', 'check-item');
    details.dataset.status = item.status;
    details.open = state.openItemId === item.id;
    const summary = document.createElement('summary');
    const meta = makeElement('span', 'summary-meta');
    meta.append(
      makeElement('span', '', item.platform || 'Platform not set'),
      makeElement('span', '', compactMigrationTiming(item.timing)),
      makeElement('span', '', item.handoffOwner || 'Unassigned')
    );
    summary.append(
      makeElement('span', 'check-mark', item.status === 'transferred' ? '✓' : '•'),
      makeElement('span', 'summary-name', item.name),
      meta,
      makeElement('span', 'status-pill', migrationStatusLabel(item.status))
    );
    details.append(summary);
    const form = makeElement('div', 'item-form');
    form.append(
      textField(item, 'name', 'Account, service, or server', { wide: true }),
      textField(item, 'platform', 'Platform / provider'),
      selectField(item, 'timing', 'When to start', MIGRATION_TIMING_OPTIONS),
      selectField(item, 'status', 'Migration status', MIGRATION_STATUS_OPTIONS),
      textField(item, 'currentOwner', 'Current owner / control', { multiline: true, wide: true, help: 'Use “confirm” where the legal, billing, tenant, or technical owner has not been verified.' }),
      textField(item, 'targetOwner', 'MXGenius destination', { multiline: true, wide: true }),
      textField(item, 'handoffOwner', 'Person responsible for the handoff', { wide: true, placeholder: 'Name or team' }),
      textField(item, 'scope', 'What moves with it', { multiline: true, wide: true }),
      textField(item, 'platformRequirement', 'What the platform requires', { multiline: true, wide: true }),
      textField(item, 'companyControl', 'MXGenius safeguard', { multiline: true, wide: true, help: 'Internal separation, backup access, approval, or recovery controls—even when the platform does not require them.' }),
      textField(item, 'dependency', 'What must happen first', { multiline: true, wide: true }),
      textField(item, 'nextStep', 'Next owner action', { multiline: true, wide: true }),
      textField(item, 'success', 'What proves the handoff is complete', { multiline: true, wide: true }),
      textField(item, 'helpUrl', 'Official help URL', { type: 'url', placeholder: 'https://…' }),
      textField(item, 'notes', 'Risks, rollback, authentication, or open questions', { multiline: true, full: true }),
      itemActions(item, state.document.migrations, renderAll, item.helpUrl, 'Open official help ↗')
    );
    details.append(form);
    return details;
  }

  function renderList(target, items, renderer) {
    target.replaceChildren();
    if (!items.length) {
      target.append(elements.emptyTemplate.content.cloneNode(true));
      return;
    }
    items.forEach((item, index) => target.append(renderer(item, index)));
  }
  function renderSummary() {
    const collections = [state.document.software, state.document.devices, state.document.workflows, state.document.migrations];
    elements.softwareTotal.textContent = collections[0].length;
    elements.deviceTotal.textContent = collections[1].length;
    elements.workflowTotal.textContent = collections[2].length;
    elements.migrationTotal.textContent = collections[3].length;
    elements.openTotal.textContent = collections.flat().filter((item) => item.status === 'needs_input' || item.status === 'access_needed').length;
  }
  function renderAll() {
    if (!state.document) return;
    renderList(elements.softwareList, state.document.software, renderSoftwareItem);
    renderList(elements.deviceList, state.document.devices, renderDeviceItem);
    renderList(elements.workflowList, state.document.workflows, renderWorkflowItem);
    renderList(elements.migrationList, state.document.migrations, renderMigrationItem);
    renderSummary();
  }

  function setSaveState(message, value = '') {
    elements.saveState.textContent = message;
    elements.saveState.dataset.state = value;
    if (value !== 'error') elements.saveState.removeAttribute('title');
  }
  function setDirty() {
    state.dirty = true;
    elements.save.disabled = false;
    setSaveState('Unsaved changes', 'dirty');
  }
  function showError(error) {
    const message = error?.message || String(error);
    const display = error?.code === 'WORKSPACE_VERSION_CONFLICT'
      ? 'Someone else updated this checklist. Reload the team version before saving again.'
      : message;
    setSaveState(display, 'error');
    elements.saveState.title = message;
    elements.save.disabled = false;
  }
  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return 'unknown time';
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function applyPayload(payload) {
    const workspace = payload?.workspace;
    state.version = Number(workspace?.version || 0);
    state.document = normalizeDocument(workspace?.document);
    state.dirty = false;
    elements.save.disabled = true;
    setSaveState(
      state.version ? `Shared checklist v${state.version} · saved ${formatDate(workspace.updated_at)}` : 'Starter checklist · save to create the team version',
      state.version ? 'saved' : ''
    );
    renderAll();
  }
  async function loadChecklist() {
    if (state.dirty && !globalThis.confirm('Discard unsaved changes and reload the shared checklist?')) return;
    elements.reload.disabled = true;
    setSaveState('Loading shared checklist…');
    try {
      const payload = await globalThis.MXApplicationClient.projectWorkspaces.get(WORKSPACE_KEY, await authenticatedSession());
      applyPayload(payload);
    } catch (error) {
      if (!state.document) applyPayload({ workspace: null });
      showError(error);
    } finally {
      elements.reload.disabled = false;
    }
  }
  async function persistChecklist() {
    if (state.saving || !state.dirty) return;
    state.saving = true;
    elements.save.disabled = true;
    setSaveState('Saving shared checklist…', 'saving');
    try {
      const allItems = [...state.document.software, ...state.document.devices, ...state.document.workflows, ...state.document.migrations];
      const status = allItems.length && allItems.every((item) => item.status === 'proven' || item.status === 'transferred') ? 'review_complete' : 'collecting';
      const payload = await globalThis.MXApplicationClient.projectWorkspaces.save(
        WORKSPACE_KEY,
        { title: WORKSPACE_TITLE, status, expectedVersion: state.version, document: state.document },
        await authenticatedSession()
      );
      applyPayload(payload);
    } catch (error) {
      state.dirty = true;
      showError(error);
    } finally {
      state.saving = false;
    }
  }
  function addSoftware() {
    const item = normalizeSoftware({ id: newId('software'), name: 'New software or system', status: 'needs_input', need: 'review', owner: 'Unassigned' });
    state.document.software.unshift(item); state.openItemId = item.id; document.getElementById('software').open = true; setDirty(); renderAll(); document.getElementById('software')?.scrollIntoView({ behavior: 'smooth' });
  }
  function addDevice() {
    const item = normalizeDevice({ id: newId('device'), name: 'New device or component', status: 'needs_input', need: 'review', owner: 'Unassigned' });
    state.document.devices.unshift(item); state.openItemId = item.id; document.getElementById('devices').open = true; setDirty(); renderAll(); document.getElementById('devices')?.scrollIntoView({ behavior: 'smooth' });
  }
  function addWorkflow() {
    const item = normalizeWorkflow({ id: newId('workflow'), name: 'New aviation process', status: 'needs_input', need: 'review', owner: 'Unassigned' });
    state.document.workflows.unshift(item); state.openItemId = item.id; document.getElementById('outputs').open = true; setDirty(); renderAll(); document.getElementById('outputs')?.scrollIntoView({ behavior: 'smooth' });
  }
  function addMigration() {
    const item = normalizeMigration({ id: newId('migration'), name: 'New account or service migration', status: 'needs_input', timing: 'review', handoffOwner: 'Unassigned' });
    state.document.migrations.unshift(item); state.openItemId = item.id; document.getElementById('migration').open = true; setDirty(); renderAll(); document.getElementById('migration')?.scrollIntoView({ behavior: 'smooth' });
  }
  function collectElements() {
    Object.assign(elements, {
      saveState: document.getElementById('readinessSaveState'), save: document.getElementById('readinessSave'), reload: document.getElementById('readinessReload'),
      softwareList: document.getElementById('softwareList'), deviceList: document.getElementById('deviceList'), workflowList: document.getElementById('workflowList'), migrationList: document.getElementById('migrationList'),
      softwareTotal: document.getElementById('softwareTotal'), deviceTotal: document.getElementById('deviceTotal'), workflowTotal: document.getElementById('workflowTotal'), migrationTotal: document.getElementById('migrationTotal'), openTotal: document.getElementById('openTotal'),
      addSoftware: document.getElementById('addSoftware'), addDevice: document.getElementById('addDevice'), addWorkflow: document.getElementById('addWorkflow'), addMigration: document.getElementById('addMigration'), emptyTemplate: document.getElementById('emptyStateTemplate')
    });
  }
  function boot() {
    collectElements();
    elements.save.addEventListener('click', persistChecklist);
    elements.reload.addEventListener('click', loadChecklist);
    elements.addSoftware.addEventListener('click', addSoftware);
    elements.addDevice.addEventListener('click', addDevice);
    elements.addWorkflow.addEventListener('click', addWorkflow);
    elements.addMigration.addEventListener('click', addMigration);
    globalThis.addEventListener('beforeunload', (event) => { if (!state.dirty) return; event.preventDefault(); event.returnValue = ''; });
    loadChecklist();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
