# Private ClamAV scanning service

The `scanner/` directory contains an authenticated Cloud Run service using ClamAV, file signature checks, SHA-256 and GCS object generation pinning. It is **not deployed**.

Build/deploy example (substitute the actual Firebase bucket and service identity):

```sh
gcloud run deploy tenantshield-evidence-scanner --source scanner --region us-central1 --no-allow-unauthenticated --memory 2Gi --timeout 300 --set-env-vars EVIDENCE_BUCKET=YOUR_BUCKET
```

Grant the scanner runtime identity `storage.objects.get` only for the evidence bucket. Grant the Firebase Functions runtime identity Cloud Run invoker on this *specific* service, and configure its `EVIDENCE_SCANNER_URL`. Do **not** allow public invocation. Rebuild signatures frequently and monitor malware definition age. Evidence remains quarantined if the scanner is missing or fails. Independently verify scanned generation and file metadata before manual approval.

A production readiness review must also verify scanner IAM, load, file parsers, resource limits, alerting, retention, and privacy compliance.
