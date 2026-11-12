const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const f=fs.readFileSync("functions/index.js","utf8");
const rules=fs.readFileSync("firestore.rules","utf8");
test("tenant cases are owner-only for direct client reads",()=>{assert.match(rules,/allow get,list: if owner\(\);/);assert.doesNotMatch(rules,/allow get,list: if owner\(\) \|\| staff/);});
test("staff reads require purpose and audit",()=>{assert.match(f,/exports\.staffReadCase/);assert.match(f,/purpose\.length<15/);assert.match(f,/"case_access"/);});
test("privacy erasure requires second reviewer",()=>{assert.match(f,/reviewerUid===user\(req\)/);assert.match(f,/executingBy:user\(req\)/);});
test("withdrawn consent closes open matching invitations",()=>{assert.match(f,/cancelled_consent_withdrawn/);assert.match(f,/Distinct tenant accounts required/);});
test("scanner clearance is needed for evidence approval",()=>{assert.match(f,/scanStatus!=="clean"/);});
test("no scanner source files are hosted",()=>{assert.ok(JSON.parse(fs.readFileSync("firebase.json","utf8")).hosting.ignore.includes("scanner/**"));});

test("direct client case creation is blocked",()=>{assert.match(rules,/allow create: if false/);});
test("server submission requires App Check, intake gate and daily quota",()=>{assert.match(f,/exports\.submitCase=onCall\(\{\.\.\.OPTIONS,enforceAppCheck:true\}/);assert.match(f,/TENANTSHIELD_INTAKE_ENABLED/);assert.match(f,/total>=3/);});
