# TenantShield Kenya

Privacy-first tenant dispute platform built with static ES modules, Firebase Auth, Firestore, Storage and Cloud Functions.

## Features
- Mobile-responsive landing page, deposit planner, private complaint intake and owner-only case dashboard.
- Per-case workspace for private evidence submissions, opt-in matching, legal/mediation referral requests, case export and privacy deletion requests.
- Cloud Functions for consent, referral queue and advocate assignment, staff-reviewed group proposals, approved evidence retrieval and explicit professional access grants.
- Cloud Storage uploads are **quarantined** and unreadable through the client SDK. Approval must follow **manual/external malware inspection**, not just a checkbox.
- Staff and advocate access is tied to server-verified custom claims. Access grants and major actions are audit-logged.
- No public allegations, automatically assembled lawsuits, unreviewed case matching or unsupervised legal advice.

## Deployment prerequisites
1. Create Firebase project with Billing enabled (Cloud Functions and Storage services may require paid Blaze billing) and register web app.
2. Enable Google sign-in and authorized domains; create Firestore and Cloud Storage.
3. Add the web config in `firebase-config.js`. Set `functionsRegion` to your Functions deployment region (default `us-central1`). Do not commit service account keys.
4. Install dependencies: `cd functions && npm install`.
5. Install Firebase CLI, login and associate the right project: `firebase use --add`.
6. Deploy **rules and functions before hosting**: `firebase deploy --only firestore:rules,storage,functions`.
7. Test with Firebase Emulator Suite before processing real tenant data.
8. Deploy hosting: `firebase deploy --only hosting`.
9. Provision staff custom claims via a separate secure admin process (not public signup), and create a corresponding `verifiedProfessionals/{uid}` record with `status: "verified"` only after advocate verification. Never let the client set custom claims.
10. Develop a real malware scanning workflow (e.g. isolated scanner service) and moderation SOP before approving evidence files.

## Security notes
- Storage rules allow tenant uploads only within their own uid-scoped quarantine namespace and limited file types/sizes; Firestore metadata reads go through authenticated Cloud Functions.
- File MIME/size metadata is not proof of safe content. Until scanning and file-signature verification are deployed, **do not approve or open uploaded files**.
- `reviewEvidence` takes a staff attestation of malware clearance; this is an administrative control, not a scanning engine.
- Google sign-in, Authentication App Check, legal-review procedures and privacy documentation must be validated before production.
- Staff roles have broad access to original complaints; implement least-privilege staff access and break-glass auditing before real rollout.
- Group formation is only a proposal; sharing identities, messages, or evidence requires explicit, informed member consent and an additional approval process.
- The case export is limited to the selected structured record. Full access/delete requests need administrator workflow and legally compliant retention/holds.
- No court electronic filing, lawyer licensing validation API, payment processing or AI legal advice is integrated. A qualified Kenyan lawyer must review the legal journeys and public copy.

## Running locally
Serve via `python -m http.server 8000` and open http://localhost:8000. Firebase is inert until configured. Use the Firebase emulators for backend testing.

## Pending production work
- Antivirus content scanning and signature validation, evidence integrity hashes and review UI.
- Verified advocate onboarding interface and explicit consent-based case access UI.
- Group member invitation/approval interface and safe private coordination messaging.
- Moderation interface, appeals and respondent right-of-reply process.
- Privacy notices, retention/deletion job execution, breach response and operational legal checks.

## SoTA security and case-operations hardening
A case journal and separate purpose-logged staff case-access function accompany stricter client Firestore access. Match withdrawal cancels active invitations, group proposals require distinct tenant accounts, and privacy deletion requires another staff actor to execute. These controls are not a substitute for integrated authorization tests, legal review or independent penetration testing.
