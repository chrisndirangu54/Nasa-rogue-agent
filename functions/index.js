const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {onObjectFinalized}=require("firebase-functions/v2/storage");
const {initializeApp}=require("firebase-admin/app");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {getStorage}=require("firebase-admin/storage");
const crypto=require("node:crypto");
initializeApp();
const db=getFirestore();
const OPTIONS={region:"us-central1",maxInstances:15,timeoutSeconds:30};
const forbidden=()=>{throw new HttpsError("permission-denied","Access denied")};
const user=req=>{if(!req.auth)throw new HttpsError("unauthenticated","Sign in required");return req.auth.uid};
const str=(v,n=1000)=>typeof v==="string"?v.trim().slice(0,n):"";
const isStaff=req=>req.auth?.token?.staff===true;
const isAdvocate=req=>req.auth?.token?.advocate===true;
const requiredCase=async(req,id)=>{const uid=user(req);if(!/^[a-zA-Z0-9_-]{6,128}$/.test(id||""))throw new HttpsError("invalid-argument","Invalid case ID");const snap=await db.doc("cases/"+id).get();if(!snap.exists||snap.data().ownerUid!==uid)forbidden();return snap};
const log=async(actor,action,entity,extra={})=>db.collection("audit").add({actor,action,entity,extra,at:FieldValue.serverTimestamp()});
exports.setMatchingConsent=onCall(OPTIONS,async req=>{
 const id=str(req.data?.caseId,128),enabled=req.data?.enabled;
 if(typeof enabled!=="boolean")throw new HttpsError("invalid-argument","Consent must be boolean");
 const snap=await requiredCase(req,id);
 await db.doc("matchingConsents/"+id).set({caseId:id,ownerUid:user(req),enabled,agentName:snap.data().agent||"",area:snap.data().area||"",reviewStatus:"pending",updatedAt:FieldValue.serverTimestamp()});
 await log(user(req),"matching_consent",id,{enabled});return {enabled};
});
exports.getMatchingConsent=onCall(OPTIONS,async req=>{const id=str(req.data?.caseId,128);await requiredCase(req,id);const doc=await db.doc("matchingConsents/"+id).get();return {enabled:doc.exists&&doc.data().enabled===true}});
exports.requestReferral=onCall(OPTIONS,async req=>{
 const id=str(req.data?.caseId,128),kind=req.data?.kind;
 await requiredCase(req,id);if(!["legal","mediation"].includes(kind))throw new HttpsError("invalid-argument","Invalid request type");
 const notes=str(req.data?.notes,1000);
 const ref=db.collection("referrals").doc();
 await ref.set({caseId:id,ownerUid:user(req),kind,notes,status:"pending",createdAt:FieldValue.serverTimestamp()});
 await log(user(req),"referral_requested",ref.id,{caseId:id,kind});return {id:ref.id,status:"pending"};
});
exports.requestPrivacyAction=onCall(OPTIONS,async req=>{
 const uid=user(req),action=req.data?.action;if(!["delete","export"].includes(action))throw new HttpsError("invalid-argument","Invalid action");
 const ref=db.collection("privacyRequests").doc();
 await ref.set({ownerUid:uid,action,status:"pending_review",createdAt:FieldValue.serverTimestamp()});
 await log(uid,"privacy_request",ref.id,{action});return {id:ref.id,status:"pending_review"};
});
exports.issueEvidenceUpload=onCall(OPTIONS,async req=>{
 const caseId=str(req.data?.caseId,128),type=req.data?.contentType,size=req.data?.size;
 await requiredCase(req,caseId);
 if(!["application/pdf","image/png","image/jpeg"].includes(type)||!Number.isInteger(size)||size<=0||size>10485760)throw new HttpsError("invalid-argument","Invalid file");
 const uid=user(req),uploadId=crypto.randomUUID().replace(/-/g,""),path=`quarantine/${uid}/${caseId}/${uploadId}`;
 await db.doc(`evidence/${uploadId}`).set({caseId,ownerUid:uid,path,contentType:type,expectedSize:size,status:"reserved",createdAt:FieldValue.serverTimestamp()});
 return {uploadId,path};
});
exports.evidenceFinalized=onObjectFinalized({region:"us-central1",maxInstances:10},async event=>{
 const obj=event.data,path=obj.name||"";
 const match=/^quarantine\/([^/]+)\/([^/]+)\/([a-f0-9]{32})$/.exec(path);
 if(!match)return;
 const [,uid,caseId,id]=match,ref=db.doc("evidence/"+id),doc=await ref.get();
 if(!doc.exists||doc.data().path!==path||doc.data().ownerUid!==uid||doc.data().caseId!==caseId||!["reserved","quarantined"].includes(doc.data().status)){await getStorage().bucket(obj.bucket).file(path).delete({ignoreNotFound:true});return}
 const validType=["application/pdf","image/png","image/jpeg"].includes(obj.contentType);
 const validSize=Number(obj.size)>0&&Number(obj.size)<=10485760&&Number(obj.size)===doc.data().expectedSize;
 if(!validType||!validSize||obj.contentType!==doc.data().contentType){await ref.update({status:"rejected",reason:"File metadata mismatch"});await getStorage().bucket(obj.bucket).file(path).delete({ignoreNotFound:true});return}
 await ref.update({status:"quarantined",generation:obj.generation||null,updatedAt:FieldValue.serverTimestamp()});
});
exports.listEvidence=onCall(OPTIONS,async req=>{
 const caseId=str(req.data?.caseId,128);await requiredCase(req,caseId);
 const snap=await db.collection("evidence").where("caseId","==",caseId).limit(100).get();
 return {items:snap.docs.filter(x=>x.data().ownerUid===user(req)).map(x=>({id:x.id,name:"Evidence "+x.id.slice(0,8),status:x.data().status}))};
});
exports.getEvidenceLink=onCall(OPTIONS,async req=>{
 const caseId=str(req.data?.caseId,128),id=str(req.data?.evidenceId,128),uid=user(req);
 const cs=await requiredCase(req,caseId),ev=await db.doc("evidence/"+id).get();
 if(!ev.exists||ev.data().caseId!==cs.id||ev.data().ownerUid!==uid||ev.data().status!=="approved")forbidden();
 const [url]=await getStorage().bucket().file(ev.data().path).getSignedUrl({action:"read",expires:Date.now()+2*60*1000,responseDisposition:"attachment"});
 await log(uid,"evidence_access",id,{caseId});return {url};
});
exports.staffQueue=onCall(OPTIONS,async req=>{
 user(req);if(!isStaff(req)&&!isAdvocate(req))forbidden();
 const query=isStaff(req)?db.collection("referrals").where("status","==","pending"):db.collection("referrals").where("assignedUid","==",user(req));
 const snap=await query.limit(50).get();
 return {items:snap.docs.map(d=>({id:d.id,caseId:d.data().caseId,kind:d.data().kind,status:d.data().status}))};
});
exports.assignReferral=onCall(OPTIONS,async req=>{
 user(req);if(!isStaff(req))forbidden();
 const referralId=str(req.data?.referralId,128),advocateUid=str(req.data?.advocateUid,128);
 if(!referralId||!advocateUid)throw new HttpsError("invalid-argument","Missing fields");
 const target=await db.doc("verifiedProfessionals/"+advocateUid).get();
 if(!target.exists||target.data().status!=="verified")forbidden();
 const ref=db.doc("referrals/"+referralId),doc=await ref.get();if(!doc.exists||doc.data().status!=="pending")throw new HttpsError("failed-precondition","Request unavailable");
 await ref.update({assignedUid:advocateUid,status:"assigned",updatedAt:FieldValue.serverTimestamp()});
 // Assignment alone does not grant access to the tenant's private case.
 await log(user(req),"referral_assigned",referralId,{advocateUid});return {status:"assigned"};
});
exports.grantProfessionalAccess=onCall(OPTIONS,async req=>{
 const caseId=str(req.data?.caseId,128),uid=str(req.data?.professionalUid,128),allow=req.data?.allow;
 await requiredCase(req,caseId);
 if(typeof allow!=="boolean")throw new HttpsError("invalid-argument","Invalid consent");
 const pro=await db.doc("verifiedProfessionals/"+uid).get();if(!pro.exists||pro.data().status!=="verified")forbidden();
 const ref=db.doc(`professionalGrants/${caseId}_${uid}`);
 if(allow)await ref.set({caseId,professionalUid:uid,ownerUid:user(req),createdAt:FieldValue.serverTimestamp()});
 else await ref.delete();
 await log(user(req),allow?"professional_access_granted":"professional_access_revoked",caseId,{professionalUid:uid});return {allowed:allow};
});
exports.getProfessionalCase=onCall(OPTIONS,async req=>{
 const uid=user(req),id=str(req.data?.caseId,128);if(!isAdvocate(req))forbidden();
 const grant=await db.doc(`professionalGrants/${id}_${uid}`).get();if(!grant.exists)forbidden();
 const snap=await db.doc("cases/"+id).get();if(!snap.exists)forbidden();
 await log(uid,"professional_case_read",id);return {caseId:id,case:snap.data()};
});
// Staff must review underlying evidence and verify related claims before creating a coordination group.
exports.createCoordinationGroup=onCall(OPTIONS,async req=>{
 user(req);if(!isStaff(req))forbidden();
 const ids=req.data?.caseIds;
 if(!Array.isArray(ids)||ids.length<2||ids.length>30||new Set(ids).size!==ids.length||!ids.every(x=>typeof x==="string"&&/^[\w-]{6,128}$/.test(x)))throw new HttpsError("invalid-argument","Select 2–30 distinct cases");
 const cases=await Promise.all(ids.map(id=>db.doc("cases/"+id).get()));
 const consents=await Promise.all(ids.map(id=>db.doc("matchingConsents/"+id).get()));
 if(cases.some((doc,i)=>!doc.exists||!consents[i].exists||!consents[i].data().enabled||consents[i].data().ownerUid!==doc.data().ownerUid))throw new HttpsError("failed-precondition","All parties must opt in");
 const ref=db.collection("coordinationGroups").doc();
 await ref.set({caseIds:ids,members:cases.map(d=>d.data().ownerUid),status:"pending_member_approval",createdBy:user(req),createdAt:FieldValue.serverTimestamp()});
 await log(user(req),"coordination_group_proposed",ref.id,{count:ids.length});
 return {groupId:ref.id,status:"pending_member_approval"};
});
exports.reviewEvidence=onCall(OPTIONS,async req=>{
 user(req);if(!isStaff(req))forbidden();
 const id=str(req.data?.evidenceId,128),decision=req.data?.decision;
 if(!["approved","rejected"].includes(decision))throw new HttpsError("invalid-argument","Invalid decision");
 const ref=db.doc("evidence/"+id),doc=await ref.get();
 if(!doc.exists||doc.data().status!=="quarantined")throw new HttpsError("failed-precondition","Evidence not ready for review");
 // Approval MUST only be performed after an external/manual malware inspection.
 if(decision==="approved"&&req.data?.malwareCleared!==true)throw new HttpsError("failed-precondition","Malware clearance required");
 await ref.update({status:decision,reviewerUid:user(req),reviewedAt:FieldValue.serverTimestamp()});
 await log(user(req),"evidence_review",id,{decision});return {status:decision};
});

exports.listMyGroups=onCall(OPTIONS,async req=>{
 const uid=user(req);
 const snap=await db.collection("coordinationGroups").where("members","array-contains",uid).limit(30).get();
 return {items:snap.docs.map(d=>({id:d.id,status:d.data().status,count:d.data().members.length,myResponse:d.data().approvals?.[uid]||"pending"}))};
});
exports.respondGroupInvitation=onCall(OPTIONS,async req=>{
 const uid=user(req),id=str(req.data?.groupId,128),accept=req.data?.accept;
 if(typeof accept!=="boolean"||!id)throw new HttpsError("invalid-argument","Invalid response");
 const ref=db.doc("coordinationGroups/"+id);
 await db.runTransaction(async tx=>{
  const snap=await tx.get(ref);if(!snap.exists||!snap.data().members.includes(uid))forbidden();
  const group=snap.data();if(group.status!=="pending_member_approval")throw new HttpsError("failed-precondition","Invitation closed");
  const approvals={...(group.approvals||{}),[uid]:accept?"accepted":"declined"};
  const status=Object.values(approvals).includes("declined")?"declined":group.members.every(member=>approvals[member]==="accepted")?"ready_for_moderated_coordination":"pending_member_approval";
  tx.update(ref,{approvals,status,updatedAt:FieldValue.serverTimestamp()});
 });
 await log(uid,"group_invitation_response",id,{accept});return {recorded:true};
});
exports.listVerifiedProfessionals=onCall(OPTIONS,async req=>{
 user(req);const s=await db.collection("verifiedProfessionals").where("status","==","verified").limit(40).get();
 return {items:s.docs.map(d=>({uid:d.id,name:str(d.data().displayName,120),specialty:str(d.data().specialty,120)}))};
});
exports.staffMatchQueue=onCall(OPTIONS,async req=>{
 user(req);if(!isStaff(req))forbidden();
 const s=await db.collection("matchingConsents").where("enabled","==",true).limit(100).get();
 return {items:s.docs.map(d=>({caseId:d.id,area:d.data().area||"",agentName:d.data().agentName||"",reviewStatus:d.data().reviewStatus||"pending"}))};
});
exports.staffEvidenceQueue=onCall(OPTIONS,async req=>{
 user(req);if(!isStaff(req))forbidden();
 const s=await db.collection("evidence").where("status","==","quarantined").limit(50).get();
 return {items:s.docs.map(d=>({id:d.id,caseId:d.data().caseId,contentType:d.data().contentType,size:d.data().expectedSize,status:d.data().status}))};
});
exports.staffReviewReferral=onCall(OPTIONS,async req=>{
 user(req);if(!isStaff(req))forbidden();
 const id=str(req.data?.referralId,128),decision=req.data?.decision;
 if(!["closed","needs_more_info"].includes(decision))throw new HttpsError("invalid-argument","Invalid status");
 const ref=db.doc("referrals/"+id),snap=await ref.get();if(!snap.exists||snap.data().status!=="pending")throw new HttpsError("failed-precondition","Request unavailable");
 await ref.update({status:decision,reviewerUid:user(req),updatedAt:FieldValue.serverTimestamp()});
 await log(user(req),"referral_review",id,{decision});return {status:decision};
});
