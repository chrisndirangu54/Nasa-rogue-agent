import hashlib
import os
import subprocess
import tempfile
from flask import Flask, request, jsonify
from google.cloud import storage
app = Flask(__name__)
client = storage.Client()
ALLOWED = {"application/pdf": b"%PDF-", "image/png": b"\x89PNG\r\n\x1a\n", "image/jpeg": b"\xff\xd8\xff"}

@app.post("/")
def scan():
    body = request.get_json(silent=True) or {}
    bucket = body.get("bucket", "")
    name = body.get("name", "")
    generation = str(body.get("generation", ""))
    if not bucket or not name.startswith("quarantine/") or not generation.isdigit():
        return jsonify(error="invalid evidence reference"), 400
    if bucket != os.environ.get("EVIDENCE_BUCKET"):
        return jsonify(error="bucket not allowed"), 403
    blob = client.bucket(bucket).blob(name, generation=int(generation))
    blob.reload()
    if blob.size is None or not 0 < blob.size <= 10485760:
        return jsonify(result="blocked", generation=generation)
    mime = blob.content_type
    if mime not in ALLOWED:
        return jsonify(result="blocked", generation=generation)
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "candidate")
        blob.download_to_filename(path)
        with open(path, "rb") as stream:
            content = stream.read()
        if not content.startswith(ALLOWED[mime]):
            return jsonify(result="blocked", generation=generation)
        digest = hashlib.sha256(content).hexdigest()
        try:
            result = subprocess.run(["clamscan", "--no-summary", path], capture_output=True, text=True, timeout=210)
        except (subprocess.TimeoutExpired, OSError):
            return jsonify(error="scanner unavailable"), 503
        if result.returncode == 0:
            return jsonify(result="clean", sha256=digest, generation=generation)
        if result.returncode == 1:
            return jsonify(result="blocked", generation=generation)
        return jsonify(error="scanner failed"), 503
