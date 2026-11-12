# TenantShield Kenya — operational release checklist

This branch contains the website, private complaint system, restricted case workspaces, ClamAV scanner deployment source, legal-professional application and review flows, right-of-reply recording, coordination invitations, audit logging and privacy request workflows.

**Status: NOT production ready.** Code checks are not a substitute for an independent privacy/security review, staging integration tests or judicial/regulatory approval.

## Production configuration
1. Create a dedicated Firebase/Google Cloud project with billing, Firestore, Firebase Authentication, Cloud Storage and Cloud Functions enabled.
2. Configure `firebase-config.js` for the web app and enable Google provider plus authorized domains.
3. Apply `firestore.rules` and `storage.rules` before accepting a tenant.
4. Deploy the private scanner in `scanner/`, with narrow Cloud Storage get-only permission, authenticated Cloud Run invocation, ClamAV signature refresh and security monitoring.
5. Set `EVIDENCE_SCANNER_URL` in Cloud Functions runtime and verify IAM access using a restricted service identity. **Absent scanner configuration, files must remain unreadable in quarantine.**
6. Deploy Cloud Functions, run authenticated and unauthorized emulator tests, then deploy Firebase Hosting.
7. Issue staff custom claims via a secure administrative process, not self-registration. Verify advocate practice credentials against authoritative records before approval.
8. Publish privacy policy, retention schedule, contact and appeal processes, moderation and respondent response procedures, breach response, and Kenyan legal review.
9. Introduce feature flags for real complaint intake and uploads only after audit. No public allegations are displayed.

## Privacy and evidence caveats
- Structured exports omit evidence bytes, complete audit history, and any records beyond request query limits. Treat exports as preliminary, not a complete statutory data access response.
- Staff deletion removes mapped case/evidence records and the Auth account, but audit history, respondent records, existing exports, backups and records subject to litigation requirements require separately documented handling. Do not represent it as instant full erasure.
- Retention and legal holds must be defined and verified by a privacy officer before deleting data. Staff action is destructive.
- A scanner result only reduces malware risk and does not validate that evidence proves wrongdoing. Do not open or distribute raw evidence without safe viewing procedures.
- The current professional flow relies on staff entering an independently verified reference; it does not automatically verify licenses.
- Moderation and respondent statements are private administrative records, not publication.
- Tenant coordination proposals are opt-in, with a second invitation approval required. They are not legal class actions or court filings.

## Checks
`node --check` on browser JS and Cloud Functions, Python syntax check for the scanner, and dependency installation run in GitHub Actions. Review workflow run results for each commit.

## Future launch gates
Independent penetration test, App Check enforcement, anti-abuse/rate limiting, malware scanner deployment, fully defined data retention and deletion policy, monitored incident response, legal counsel validation, and production end-to-end trials.
