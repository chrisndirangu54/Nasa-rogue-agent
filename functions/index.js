const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {onObjectFinalized}=require("firebase-functions/v2/storage");
const {initializeApp}=require("firebase-admin/app");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {getStorage}=require("firebase-admin/storage");
const crypto=require("node:crypto");
const {GoogleAuth}=require("google-auth-library");
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
exports.evidenceFinalized=onObjectFinalized({region:"us-central1",maxInstances:10,timeoutSeconds:300,memory:"1GiB"},async event=>{
 const obj=event.data,path=obj.name||"";
 const match=/^quarantine\/([^/]+)\/([^/]+)\/([a-f0-9]{32})$/.exec(path);
 if(!match)return;
 const [,uid,caseId,id]=match,ref=db.doc("evidence/"+id),doc=await ref.get();
 if(!doc.exists||doc.data().path!==path||doc.data().ownerUid!==uid||doc.data().caseId!==caseId||!["reserved","quarantined"].includes(doc.data().status)){await getStorage().bucket(obj.bucket).file(path).delete({ignoreNotFound:true});return}
 const validType=["application/pdf","image/png","image/jpeg"].includes(obj.contentType);
 const validSize=Number(obj.size)>0&&Number(obj.size)<=10485760&&Number(obj.size)===doc.data().expectedSize;
 if(!validType||!validSize||obj.contentType!==doc.data().contentType){await ref.update({status:"rejected",reason:"File metadata mismatch"});await getStorage().bucket(obj.bucket).file(path).delete({ignoreNotFound:true});return}

 const url=process.env.EVIDENCE_SCANNER_URL;
 if(!url){await ref.update({status:"quarantined",scanStatus:"unavailable",generation:obj.generation||null,updatedAt:FieldValue.serverTimestamp()});return}
 try {
  const client=await new GoogleAuth().getIdTokenClient(url);
  const result=await client.request({url,method:"POST",data:{bucket:obj.bucket,name:path,generation:String(obj.generation)},timeout:240000});
  const scan=result.data;
  const safe=scan?.result==="clean"&&/^[a-f0-9]{64}$/.test(scan.sha256||"")&&scan.generation===String(obj.generation);
  await ref.update({status:safe?"quarantined":"rejected",scanStatus:safe?"clean":"blocked",sha256:safe?scan.sha256:null,generation:obj.generation||null,updatedAt:FieldValue.serverTimestamp()});
  if(!safe)await getStorage().bucket(obj.bucket).file(path).delete({ignoreNotFound:true});
 }catch(err){
  console.error("Evidence scanning unavailable",err.message);
  await ref.update({status:"quarantined",scanStatus:"error",generation:obj.generation||null,updatedAt:FieldValue.serverTimestamp()});
 }

});
exports.listEvidence=onCall(OPTIONS,async req=>{
 const caseId=str(req.data?.caseId,128);await requiredCase(req,caseId);
 const snap=await db.collection("evidence").where("caseId","==",caseId).limit(100).get();
 return {items:snap.docs.filter(x=>x.data().ownerUid===user(req)).map(x=>({id:x.id,name:"Evidence "+x.id.slice(0,8),status:x.data().status}))};
});
exports.getEvidenceLink=onCall(OPTIONS,async req=>{
 const caseId=str(req.data?.caseId,128),id=str(req.data?.evidenceId,128),uid=user(req);
 const cs=await requiredCase(req,caseId),ev=await db.doc("evidence/"+id).get();
 if(!ev.exists||ev.data().caseId!==cs.id||ev.data().ownerUid!==uid||(ev.data().status!=="approved"||ev.data().scanStatus!=="clean"))forbidden();
 const [url]=await getStorage().bucket().file(ev.data().path).getSignedUrl({action:"read",expires:Date.now()+2*60*1000,responseDisposition:"attachment",version:String(ev.data().generation)});
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
 const distinctOwners=new Set(cases.map(d=>d.data().ownerUid));
 if(distinctOwners.size!==ids.length)throw new HttpsError("invalid-argument","A group must include distinct tenant accounts");
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
 if(decision==="approved"){
  if(doc.data().scanStatus!=="clean"||!doc.data().sha256||!doc.data().generation)throw new HttpsError("failed-precondition","Automated scanner clearance required");
  const [meta]=await getStorage().bucket().file(doc.data().path).getMetadata();
  if(String(meta.generation)!==String(doc.data().generation))throw new HttpsError("failed-precondition","File changed since scan");
 }
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
  if(accept){const myCases=await Promise.all(snap.data().caseIds.map(id=>tx.get(db.doc("matchingConsents/"+id))));if(myCases.some(doc=>!doc.exists||doc.data().enabled!==true))throw new HttpsError("failed-precondition","Matching consent was withdrawn");}
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

const staffOnly=req=>{user(req);if(!isStaff(req))forbidden()};
const ident=v=>{if(typeof v!=="string"||!/^[a-zA-Z0-9_-]{6,128}$/.test(v))throw new HttpsError("invalid-argument","Invalid identifier");return v};
exports.staffChangeCaseStatus=onCall(OPTIONS,async req=>{
 staffOnly(req);const id=ident(req.data?.caseId),status=req.data?.status;
 if(!["under_review","awaiting_tenant","mediation","referred","resolved","closed"].includes(status))throw new HttpsError("invalid-argument","Invalid status");
 const ref=db.doc("cases/"+id),snap=await ref.get();if(!snap.exists)throw new HttpsError("not-found","Case not found");
 await ref.update({status,updatedAt:FieldValue.serverTimestamp()});
 await log(user(req),"case_status_change",id,{from:snap.data().status,to:status});return {status};
});
exports.staffRecordRespondentStatement=onCall(OPTIONS,async req=>{
 staffOnly(req);const id=ident(req.data?.caseId),statement=str(req.data?.statement,5000),reference=str(req.data?.reference,200);
 if(statement.length<30||reference.length<5)throw new HttpsError("invalid-argument","Verified response and source are required");
 if(!(await db.doc("cases/"+id).get()).exists)throw new HttpsError("not-found","Case not found");
 const ref=db.collection("respondentStatements").doc();
 await ref.set({caseId:id,statement,verificationReference:reference,status:"restricted",recordedBy:user(req),createdAt:FieldValue.serverTimestamp()});
 await log(user(req),"respondent_statement",ref.id,{caseId:id});return {id:ref.id};
});
exports.applyProfessionalVerification=onCall(OPTIONS,async req=>{
 const uid=user(req),name=str(req.data?.displayName,120),specialty=str(req.data?.specialty,120),license=str(req.data?.licenseNumber,80);
 if(name.length<3||license.length<4)throw new HttpsError("invalid-argument","Identity and professional license number required");
 await db.doc("professionalApplications/"+uid).set({ownerUid:uid,displayName:name,specialty,licenseNumber:license,status:"pending",updatedAt:FieldValue.serverTimestamp()});
 await log(uid,"professional_application",uid);return {status:"pending"};
});
exports.staffProfessionalApplications=onCall(OPTIONS,async req=>{
 staffOnly(req);const snap=await db.collection("professionalApplications").where("status","==","pending").limit(50).get();
 return {items:snap.docs.map(d=>({uid:d.id,name:d.data().displayName,license:d.data().licenseNumber,specialty:d.data().specialty}))};
});
exports.staffVerifyProfessional=onCall(OPTIONS,async req=>{
 staffOnly(req);const uid=ident(req.data?.uid),decision=req.data?.decision,verification=str(req.data?.verificationReference,240);
 if(!["verified","rejected"].includes(decision)||verification.length<5)throw new HttpsError("invalid-argument","Independent verification reference required");
 const ref=db.doc("professionalApplications/"+uid),doc=await ref.get();
 if(!doc.exists||doc.data().status!=="pending")throw new HttpsError("failed-precondition","Application unavailable");
 if(decision==="verified"){
  const {getAuth}=require("firebase-admin/auth"),adminAuth=getAuth(),record=await adminAuth.getUser(uid);
  await adminAuth.setCustomUserClaims(uid,{...(record.customClaims||{}),advocate:true});
  await db.doc("verifiedProfessionals/"+uid).set({displayName:doc.data().displayName,specialty:doc.data().specialty,licenseNumber:doc.data().licenseNumber,status:"verified",verifiedBy:user(req),verifiedAt:FieldValue.serverTimestamp()});
 }
 await ref.update({status:decision,verificationReference:verification,reviewedBy:user(req),reviewedAt:FieldValue.serverTimestamp()});
 await log(user(req),"professional_verification",uid,{decision});return {status:decision};
});
exports.exportMyData=onCall({...OPTIONS,timeoutSeconds:60},async req=>{
 const uid=user(req);
 const collections=["cases","evidence","referrals","matchingConsents","professionalGrants","privacyRequests"];
 const result={exportedAt:new Date().toISOString(),note:"Metadata only; files and audit records require separate privacy review."};
 for(const name of collections){
  const docs=await db.collection(name).where("ownerUid","==",uid).limit(200).get();
  result[name]=docs.docs.map(d=>({id:d.id,...d.data(),path:undefined}));
 }
 await log(uid,"account_data_export",uid);return result;
});
exports.staffPrivacyQueue=onCall(OPTIONS,async req=>{
 staffOnly(req);const snap=await db.collection("privacyRequests").where("status","==","pending_review").limit(50).get();
 return {items:snap.docs.map(d=>({id:d.id,action:d.data().action,ownerUid:d.data().ownerUid}))};
});
exports.staffPrivacyDecision=onCall(OPTIONS,async req=>{
 staffOnly(req);const id=ident(req.data?.requestId),decision=req.data?.decision,reason=str(req.data?.reason,600);
 if(!["approved_for_execution","rejected"].includes(decision)||reason.length<10)throw new HttpsError("invalid-argument","A documented decision is required");
 const ref=db.doc("privacyRequests/"+id),doc=await ref.get();
 if(!doc.exists||doc.data().status!=="pending_review")throw new HttpsError("failed-precondition","Request unavailable");
 if(decision==="approved_for_execution"){
  const hold=await db.doc("legalHolds/"+doc.data().ownerUid).get();
  if(hold.exists&&hold.data().active)throw new HttpsError("failed-precondition","An active legal hold requires privacy officer review");
 }
 await ref.update({status:decision,reviewerUid:user(req),reviewReason:reason,updatedAt:FieldValue.serverTimestamp()});
 await log(user(req),"privacy_request_review",id,{decision});return {status:decision};
});
exports.staffExecuteDeletion=onCall({...OPTIONS,timeoutSeconds:300},async req=>{
 staffOnly(req);const id=ident(req.data?.requestId),ref=db.doc("privacyRequests/"+id),snap=await ref.get();
 if(!snap.exists||snap.data().action!=="delete"||!["approved_for_execution","executing"].includes(snap.data().status))throw new HttpsError("failed-precondition","Deletion not approved");
 const uid=snap.data().ownerUid,hold=await db.doc("legalHolds/"+uid).get();
 if(hold.exists&&hold.data().active)throw new HttpsError("failed-precondition","Active legal hold");
 await ref.update({status:"executing",updatedAt:FieldValue.serverTimestamp()});
 const names=["cases","evidence","referrals","matchingConsents","professionalGrants","professionalApplications","verifiedProfessionals","respondentStatements"];
 for(const name of names){
  if(["professionalApplications","verifiedProfessionals"].includes(name)){await db.doc(name+"/"+uid).delete();continue}
  if(name==="respondentStatements")continue; // References to public third parties are reviewed separately.
  while(true){
   const snap=await db.collection(name).where("ownerUid","==",uid).limit(100).get();
   if(snap.empty)break;
   for(const doc of snap.docs){
    if(name==="evidence"&&doc.data().path)await getStorage().bucket().file(doc.data().path).delete({ignoreNotFound:true});
    await doc.ref.delete();
   }
  }
 }
 const groups=await db.collection("coordinationGroups").where("members","array-contains",uid).get();
 for(const doc of groups.docs)await doc.ref.update({status:"cancelled_privacy",members:FieldValue.arrayRemove(uid)});
 const {getAuth}=require("firebase-admin/auth");await getAuth().deleteUser(uid);
 await ref.update({status:"completed",completedAt:FieldValue.serverTimestamp()});
 await log(user(req),"privacy_deletion_completed",id,{redactedUid:crypto.createHash("sha256").update(uid).digest("hex").slice(0,16)});
 return {status:"completed"};
});
