# Rocky Parts Build Report and User Guide

Date: July 28, 2026  
Application: [MXGenius](https://mxgenius.io/)  
Audience: Rocky and the parts/procurement team

## Send-ready email

**Subject: MXGenius parts workflow is ready for your review**

Rocky,

The first working version of the parts workflow is ready at
[mxgenius.io](https://mxgenius.io/).

Sign in with `Rocky@mxgenius.io`. The first time you enter the application,
choose **Parts & Procurement** in the welcome guide. It will walk you through
the new workflow.

You can now:

- upload a parts document or photo;
- review and correct the information suggested by OCR;
- create the inventory record after you confirm the details;
- keep the source documents and inventory history with the unit;
- review candidate FAA Airworthiness Directives from the live FAA source; and
- create a QR label that returns to the same controlled unit record.

The instructions below show the complete process. As you work through it, the
most useful feedback will be which fields are missing, how much information you
want OCR to capture, and what you want printed on the physical label.

OCR is there to reduce typing. It does not approve the part. FAA results are
review candidates and do not replace a qualified applicability check.

Dwayne

---

## Build report

### Ready for Rocky

| Area | What is available |
| --- | --- |
| Access | `Rocky@mxgenius.io` and the `@mxgenius.io` organization are allowed through the protected sign-in flow. Rocky receives the Parts & Procurement role. |
| Guided onboarding | A seven-step Parts & Procurement walkthrough covers access, navigation, connection status, Copilot, Parts Management, receiving, and the unit record. |
| Parts receiving | A four-step flow accepts a PDF, packing slip, FAA 8130-3, placard image, or part photo. |
| OCR review | Extracted values are suggestions. Rocky can review and correct the information before creating the unit. |
| Inventory record | The confirmed record retains the part details, private source documents, and inventory history. |
| FAA connection | The FAA panel queries the live FAA Dynamic Regulatory System and presents candidate Airworthiness Directives with source information. |
| QR label | A printable QR label opens the same controlled unit record. The QR code does not contain a password or storage credential. |
| Existing tools | Aircraft lookup, structured Copilot answers, image uploads, maintenance cases, and the 3D workspace remain available. |

### Safety and scope

- Nothing extracted by OCR becomes approved data until a person reviews the
  receiving summary and confirms it.
- A blank FAA result does not mean that no Airworthiness Directive applies.
  Final effectivity and serial-number applicability still require qualified
  review in the authoritative FAA record.
- Uploaded evidence is kept behind the signed-in application boundary.
- The QR code is a link to the controlled record. A person opening it must
  still have application access.
- Browser printing is included. A dedicated label-printer or laser-etch
  integration is not included in this build.
- Image matching is not being presented as biometric or automatic part
  identification in this build.

### Release verification

- Production frontend: `mxgenius.io`
- Frontend release: `f5069b5`
- Automated frontend tests: 81 passed
- Pages validation and deployment: passed
- Live onboarding assets and Parts & Procurement walkthrough: verified
- FAA aircraft identity resolution and live candidate-source connection:
  verified

## Rocky's walkthrough

### 1. Sign in

1. Open [mxgenius.io](https://mxgenius.io/).
2. Select **Sign in**.
3. Use `Rocky@mxgenius.io`.
4. Complete the Microsoft verification shown on screen. Depending on the
   account, Microsoft may use a one-time code or the Authenticator app.
5. If the landing page already says that you are signed in, select the button
   to open MXGenius.

### 2. Run the welcome guide

1. Choose **Parts & Procurement**.
2. Select **Start Tour**.
3. Follow the seven prompts through account access, navigation, connection
   status, AI Copilot, Parts Management, receiving, and the unit record.
4. Select **Finish**. The tour leaves you in **Parts Management**.

To replay it later, open **Settings**, find **Onboarding Walkthrough**, and
select **Restart Tour**.

### 3. Receive a part

1. Open **Parts Management**.
2. Select **Receive Part**.
3. Upload one clear PDF or image. A packing slip, FAA 8130-3, placard, or part
   photo can be used.
4. Select **Upload and extract**.
5. Review every OCR suggestion. Correct any value that is incomplete or wrong.
6. Complete the inventory details, including the serial or lot number,
   condition, trace type, and location when they apply.
7. Select **Review confirmation**.
8. Read the summary, then select **Confirm and create unit** only when the
   information is correct.

### 4. Review the unit

1. Search the Parts Management inventory by part number, description, or
   serial number.
2. Select the unit.
3. Use the record tabs:
   - **Overview** for the confirmed part and stock information.
   - **Documents** for the uploaded evidence.
   - **History** for receiving and later inventory events.
   - **FAA ADs** for candidate Airworthiness Directives and their source.
   - **QR Label** for the printable record label.

### 5. Print or attach the QR label

1. Open **QR Label** on the unit record.
2. Use the browser's print command.
3. Print to paper or a compatible label sheet.
4. Scan the finished label with a phone to confirm it returns to the correct
   MXGenius unit.

The same stable record URL can later be used by a separate printer or
laser-etch workflow.

## What Rocky should evaluate

Rocky's review should answer four practical questions:

1. Are the receiving fields sufficient for the parts he handles?
2. Which additional fields should OCR attempt to suggest?
3. What information and label size should be used for the physical QR label?
4. Is the FAA candidate presentation useful for review without implying an
   automatic compliance determination?

## If something does not work

- Confirm the browser is signed in as `Rocky@mxgenius.io`.
- Wait for **Fleet proxy ready** before starting a lookup or receiving flow.
- If access is denied, capture the exact email shown by Microsoft and the
  message on the MXGenius page.
- If an upload or FAA request fails, keep the message shown on screen. It
  distinguishes missing information, a rejected request, and an unavailable
  source.
- Do not treat an empty OCR or FAA response as approval. Continue with a manual
  review and report the source document or unit that produced the result.
