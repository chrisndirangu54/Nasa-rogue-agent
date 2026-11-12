# TenantShield Kenya

A responsive, privacy-first MVP for documenting rental disputes and accessing potential resolution pathways in Kenya.

## Implemented
- Responsive landing page, dispute types, how-it-works guidance and deposit-balance calculator.
- Private complaint intake with structured fields, explicit consent and client-side validation.
- Firebase Google sign-in and Firestore-backed *owner-only* case dashboard when configured.
- Firestore rules restricting users to creating and reading their own complaints. No public case directory.
- Storage rules deny all uploads until an audited evidence pipeline exists.
- Safe text rendering, no unverified public allegations, no automated claims of wrongdoing.

## Setup
1. Create a Firebase project and register a web app.
2. Enable **Authentication → Google** and configure authorized domains.
3. Create a **Cloud Firestore** database.
4. Copy the Firebase web configuration object into `firebase-config.js` (replace `null`). These are client identifiers, **not** service-account secrets.
5. Install Firebase CLI if needed: `npm install -g firebase-tools`, then `firebase login` and `firebase use --add`.
6. Deploy security rules **before admitting users**: `firebase deploy --only firestore:rules,storage`.
7. Preview locally with `python -m http.server 8000` and open http://localhost:8000 . (Do not open the HTML directly as a `file://` URL.)
8. Deploy hosting after reviewing the Firebase project association: `firebase deploy --only hosting`.

Until Firebase is configured, this site operates as a **non-persistent presentation preview**. No reports are saved.

## Security and production blockers
- Do not publish real complaints or invite real users until a Kenyan legal/privacy review, privacy policy, retention schedule, breach response and lawful basis assessment are complete.
- Evidence uploads are **not implemented**; do not put personal evidence into the source repository.
- Case matching and collective litigation groups are **not implemented**. They require consent-based coordination, careful identity verification, respondent fairness procedures and trained moderation.
- Legal advice, professional referrals and court integrations are **not implemented**.
- Firestore `list` rules are owner-restricted; queries must filter `ownerUid` by the signed-in user.
- This application is **not a law firm**, not an emergency reporting service and does not determine that an agent committed misconduct.
- For production, move high-risk workflow operations to a trusted server, add App Check, audit logs, retention/deletion processes, user export and verified support contacts.
- Project identifiers in `firebase-config.js` are expected to be public, but backend secrets, API keys with privileged permissions and service credentials must never be committed.

## Development
Static ES modules (no bundler required). Main files: `index.html`, `styles.css`, `app.js`, `firebase-config.js`. Firebase JS SDK is dynamically imported from Google's CDN after project configuration.

## Roadmap
1. Tenant evidence upload service with scanning and restricted access.
2. Moderator console with audited case access and right-of-reply workflow.
3. Tenant opt-in matching using reviewed agent/entity identifiers.
4. Legal-referral directory, mediation workflows and consent management.
5. Policy-compliant notifications, case export and GDPR/Kenya DPA privacy tooling.
