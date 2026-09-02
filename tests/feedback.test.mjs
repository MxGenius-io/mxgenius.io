import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dashboard = await readFile(new URL('../dashboard.html', import.meta.url), 'utf8');
const auth = await readFile(new URL('../auth.js', import.meta.url), 'utf8');
const client = await readFile(new URL('../application-client.js', import.meta.url), 'utf8');
const reporterJs = await readFile(new URL('../feedback-reporter.js', import.meta.url), 'utf8');
const reporterCss = await readFile(new URL('../feedback-reporter.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../feedback.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../feedback.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../feedback.css', import.meta.url), 'utf8');

test('Settings exposes the My Feedback workspace alongside the other shared workspaces', () => {
  assert.match(dashboard, /id="settingsWorkspacesCard"/);
  assert.match(dashboard, /value="feedback\.html">My Feedback/);
  assert.match(html, /Back to Settings/);
});

test('the feedback pages are authenticated and use only the application client boundary', () => {
  assert.match(auth, /dashboard\|progress\|patent-workspace\|build-board\|feedback/);
  assert.match(auth, /mx_auth_protected_return/);
  assert.match(html, /src="auth\.js\?v=\d+"/);
  assert.match(html, /src="application-client\.js\?v=\d+"/);
  assert.doesNotMatch(js, /fetch\(/);
  assert.doesNotMatch(reporterJs, /fetch\(/);
  assert.match(client, /feedback: Object\.freeze/);
  assert.match(client, /\/api\/feedback/);
});

test('dashboard.html exposes one consolidated feedback entry point and loads the reporter modal', () => {
  assert.match(dashboard, /id="feedbackReporterBtn"/);
  assert.doesNotMatch(dashboard, /id="featureReporterBtn"/);
  assert.match(dashboard, /id="feedbackType"/);
  assert.match(dashboard, /id="feedbackReporterModal"/);
  assert.match(dashboard, /feedback-reporter\.css/);
  assert.match(dashboard, /feedback-reporter\.js/);
  assert.match(dashboard, /html2canvas\.js/);
});

test('the reporter opens on the b keyboard shortcut, suppressed while typing', () => {
  assert.match(reporterJs, /KEYBOARD_SHORTCUT = 'b'/);
  assert.match(reporterJs, /isTypingTarget/);
  assert.match(reporterJs, /html2canvas\(/);
});

test('bug reports and feature requests share one reporter with a type picker', () => {
  assert.match(dashboard, /id="feedbackType"/);
  assert.match(dashboard, /value="bug" selected>Bug report/);
  assert.match(dashboard, /value="feature">Feature request/);
  assert.match(reporterJs, /open\('bug'\)/);
  assert.match(reporterJs, /elements\.type\?\.addEventListener\('change'/);
  assert.doesNotMatch(reporterJs, /featureOpenBtn/);
  assert.match(reporterJs, /const mode = state\.mode/);
  assert.match(reporterJs, /reportType: mode/);
  assert.match(reporterJs, /Report a Bug/);
  assert.match(reporterJs, /Request a Feature/);
});

test('severity is bug-only, with three levels and no critical tier', () => {
  assert.match(dashboard, /id="feedbackSeverityField"/);
  assert.match(reporterJs, /elements\.severityField\.hidden = state\.mode !== 'bug'/);
  const [, severitySelect] = dashboard.match(/<select id="feedbackSeverity">([\s\S]*?)<\/select>/) || [];
  assert.ok(severitySelect, 'feedbackSeverity select must be present');
  for (const level of ['low', 'medium', 'high']) {
    assert.match(severitySelect, new RegExp(`value="${level}"`));
  }
  assert.doesNotMatch(severitySelect, /value="critical"/);
});

test('the reporter has freehand, rectangle, arrow, and text annotation tools with color and undo', () => {
  for (const tool of ['draw', 'rect', 'arrow', 'text']) {
    assert.match(dashboard, new RegExp(`data-tool="${tool}"`));
  }
  assert.match(dashboard, /feedbackColorSwatches/);
  assert.match(dashboard, /feedbackUndoBtn/);
  assert.match(dashboard, /feedbackClearBtn/);
  assert.match(reporterCss, /@media \(max-width: 860px\)/);
});

test('the report form collects type, title, bug severity, and description', () => {
  assert.match(dashboard, /id="feedbackType"/);
  assert.match(dashboard, /id="feedbackTitle"/);
  assert.match(dashboard, /id="feedbackSeverity"/);
  assert.match(dashboard, /id="feedbackDescription"/);
});

test('a successful submit shows a dismissable confirmation with mode-specific copy, closing the form', () => {
  assert.match(dashboard, /id="feedbackConfirmationModal"/);
  assert.match(dashboard, /id="feedbackConfirmationMessage"/);
  assert.match(dashboard, /id="feedbackConfirmationClose"/);
  assert.match(reporterJs, /CONFIRMATION_DISMISS_MS = 10000/);
  assert.match(reporterJs, /received your bug report/);
  assert.match(reporterJs, /received your feature request/);
  assert.match(reporterJs, /function showConfirmation/);
  assert.match(reporterJs, /close\(\);\s*\n\s*showConfirmation/);
});

test('clipboard paste replaces the screenshot instead of a file upload', () => {
  assert.match(dashboard, /id="feedbackPasteBtn"/);
  assert.doesNotMatch(dashboard, /id="feedbackReplaceBtn"/);
  assert.doesNotMatch(dashboard, /id="feedbackScreenshotFile"/);
  assert.match(reporterJs, /navigator\.clipboard\.read/);
  assert.match(reporterJs, /function pasteFromClipboard/);
});

test('My Feedback lists the reporter\'s own submissions with a detail view', () => {
  assert.match(js, /feedback\.list/);
  assert.match(js, /feedback\.getScreenshot/);
  assert.match(html, /id="feedbackList"/);
  assert.match(html, /id="feedbackDetailModal"/);
  assert.match(css, /@media \(max-width: 640px\)/);
});
