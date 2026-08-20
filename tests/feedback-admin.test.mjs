import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');
const auth = await readFile(new URL('../auth.js', import.meta.url), 'utf8');
const client = await readFile(new URL('../application-client.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../feedback-admin.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../feedback-admin.js', import.meta.url), 'utf8');
const httpRs = await readFile(
  new URL('../services/mcp/server/src/transport/http.rs', import.meta.url),
  'utf8'
);
const migration = await readFile(
  new URL('../services/mcp/migrations/0018_feedback.sql', import.meta.url),
  'utf8'
);
const css = await readFile(new URL('../feedback.css', import.meta.url), 'utf8');

test('Settings exposes the admin Feedback Queue alongside My Feedback', () => {
  assert.match(dashboard, /value="feedback\.html">My Feedback/);
  assert.match(dashboard, /value="feedback-admin\.html">Feedback Queue \(Admin\)/);
});

test('the admin queue page is authenticated and uses only the application client boundary', () => {
  assert.match(auth, /feedback-admin/);
  assert.match(html, /src="auth\.js\?v=\d+"/);
  assert.match(html, /src="application-client\.js\?v=\d+"/);
  assert.doesNotMatch(js, /fetch\(/);
  assert.match(client, /listAdmin: listFeedbackAdmin/);
  assert.match(client, /\/api\/feedback\/admin/);
});

test('the admin queue lists reports org-wide, not just the caller\'s own', () => {
  assert.match(js, /feedback\.listAdmin/);
  assert.match(js, /reporter_name/);
  assert.match(html, /id="feedbackFilterType"/);
  assert.match(html, /id="feedbackFilterStatus"/);
});

test('a 403 from the admin endpoint is surfaced as a role explanation, not a generic error', () => {
  assert.match(js, /forbidden/i);
  assert.match(js, /Manager and Administrator/);
});

test('the backend gates the org-wide feedback listing behind manager/administrator role and scopes it to the org', () => {
  assert.match(httpRs, /fn feedback_admin_allowed\(context: &ExecutionContext\) -> bool/);
  assert.match(httpRs, /async fn list_feedback_reports_admin/);
  assert.match(httpRs, /FEEDBACK_ADMIN_REQUIRED/);
  assert.match(
    httpRs,
    /WHERE f\.organization_id=\$1\s*\n\s*ORDER BY f\.created_at DESC/
  );
});

test('report detail and screenshot routes allow the reporter or an admin, scoped to the org', () => {
  assert.match(
    httpRs,
    /WHERE f\.id=\$1 AND f\.organization_id=\$2 AND \(\$3 OR f\.reporter_user_id=\$4\)/
  );
  assert.match(
    httpRs,
    /WHERE id=\$1 AND organization_id=\$2 AND \(\$3 OR reporter_user_id=\$4\)/
  );
});

test('every report gets a stable, human-referenceable ticket number', () => {
  assert.match(migration, /report_number\s+bigserial UNIQUE NOT NULL/);
  assert.match(httpRs, /report_number: i64/);
  assert.match(js, /ticketLabel/);
  assert.match(js, /FB-\$\{report\.report_number\}/);
});

test('admins can move a report through a real status workflow, including a needs-info state', () => {
  assert.match(migration, /'new', 'in_progress', 'needs_info', 'resolved', 'declined'/);
  assert.match(
    httpRs,
    /fn validated_feedback_status\(value: &str\) -> Result<&'static str, &'static str>/
  );
  assert.match(httpRs, /"needs_info" => Ok\("needs_info"\)/);
  assert.match(httpRs, /async fn update_feedback_report/);
  assert.match(httpRs, /\.patch\(update_feedback_report\)/);
  assert.match(client, /method: 'PATCH'/);
  assert.match(client, /updateAdmin: updateFeedbackReportAdmin/);
  assert.match(html, /id="feedbackDetailStatus"/);
  assert.match(html, /value="needs_info">Needs info/);
  assert.match(js, /feedback\.updateAdmin/);
  assert.match(html, /id="feedbackDetailSave"/);
  assert.match(js, /elements\.detailSave/);
});

test('admins can leave internal triage notes that are never returned to the submitter', () => {
  assert.match(migration, /admin_notes\s+text CHECK/);
  assert.match(httpRs, /admin_notes: Option<String>/);
  assert.match(httpRs, /CASE WHEN \$3 THEN f\.admin_notes ELSE NULL END AS admin_notes/);
  assert.match(html, /id="feedbackDetailNotes"/);
  assert.match(html, /never shown to the submitter/);
});

test('admins can jump straight to emailing the submitter from the detail view', () => {
  assert.match(httpRs, /reporter_email: String/);
  assert.match(httpRs, /u\.email AS reporter_email/);
  assert.match(html, /id="feedbackDetailContact"/);
  assert.match(js, /mailto:/);
  assert.match(js, /reporter_email/);
});

test('elements toggled via the native hidden attribute are not forced visible by an unconditional display rule', () => {
  // Regression: a class selector with an unscoped `display:` always beats the
  // UA `[hidden] { display: none }` rule regardless of source order, so an
  // element JS sets `.hidden = true` on can still render. Both of these are
  // toggled that way (detailScreenshot, detailContact) — the rule must be
  // scoped with :not([hidden]) or it silently ignores the hidden attribute.
  assert.doesNotMatch(css, /\.feedback-detail__screenshot\s*\{[^}]*display:/);
  assert.match(css, /\.feedback-detail__screenshot:not\(\[hidden\]\)\s*\{[^}]*display:/);
  assert.doesNotMatch(css, /\.feedback-admin__contact\s*\{[^}]*display:/);
  assert.match(css, /\.feedback-admin__contact:not\(\[hidden\]\)\s*\{[^}]*display:/);
});

test('the queue hides resolved and declined reports by default so the backlog does not dominate the view', () => {
  assert.match(html, /id="feedbackFilterOpenOnly"/);
  assert.match(html, /checked/);
  assert.match(js, /CLOSED_STATUSES/);
  assert.match(js, /openOnly: true/);
});
