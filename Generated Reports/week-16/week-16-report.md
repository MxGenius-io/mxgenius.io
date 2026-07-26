# Weekly Progress Report — Week 16

**Date Range:** Jun 29, 2026 — Jul 5, 2026
**Project:** Advanced AOG · Hermetic Labs

---

Hey Josh,

Solid week — this was a foundational infrastructure and security sprint. I focused on getting MxGenius cleaned up, production-hardened, and properly deployed under the new MxGenius-io GitHub organization. Here's the breakdown.

---

## Work Order Panel & Invoice Parsing

Built out the Work Order left panel with email invoice ingestion and GPT-powered JSON parsing. This means incoming work orders can now be pasted or forwarded from email, and the system will automatically extract structured fields (aircraft, part numbers, labor hours, etc.) into the dashboard format. It's a big step toward closing the loop between the shop floor and the platform.

## Azure Chat Auth & Layout Fixes

Fixed the Azure chat auth token flow — it was failing silently on certain session states. Also cleaned up duplicate/malformed `ai-chat-panel` elements that were breaking the layout, removed duplicate tabs, and added a proper footer to the dashboard.

## Security Hardening

This was the big focus. Google's Safe Browsing had flagged the site due to exposed credential forms, so I did a full security pass:

- **Removed all hardcoded credentials and dev tokens** from `app.js`
- **Stripped credential forms and OAuth flows** that were triggering the Safe Browsing flag
- **Added proper `.gitignore`** to prevent future credential leaks
- **Built a GitHub Actions deployment workflow** (`deploy.yml`) that injects `MXG_API_EMAIL` and `MXG_API_PASSWORD` from GitHub Secrets at build time — source stays clean, deployed site gets real credentials

This is the right way to handle it going forward. No more credentials in the codebase, period.

## MxGenius-io GitHub Organization

Set up the new **MxGenius-io** GitHub organization with:
- Organization profile and README with branding banner
- CNAME record created for custom domain routing
- Dashboard button now visible in mobile hamburger menu

---

## Bottom Line

The platform went from "working prototype with some exposed wiring" to "properly secured, CI/CD-deployed production app" this week. The credential cleanup and GitHub Actions secret injection pattern is the model we'll follow for every deployment going forward. Work order parsing gives us a real workflow feature to demo.

Next week I'm planning a major dashboard and UX overhaul.

---

*Prepared by Hermetic Labs for Advanced AOG*
