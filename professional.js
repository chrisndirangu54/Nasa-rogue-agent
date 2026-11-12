import {firebaseConfig} from "./firebase-config.js";
const el=id=>document.getElementById(id);
const status=s=>el("professionalStatus").textContent=s;
if(!firebaseConfig?.apiKey||!firebaseConfig?.projectId){status("Configure Firebase before using the professional portal.");el("proLogin").disabled=true}
else{
 const [{initializeApp},authApi,fnApi]=await Promise.all([
  import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js"),
  import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js"),
  import("https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js")]);
 const app=initializeApp(firebaseConfig),auth=authApi.getAuth(app),functions=fnApi.getFunctions(app,firebaseConfig.functionsRegion||"us-central1");
 const call=async(name,data={})=>(await fnApi.httpsCallable(functions,name)(data)).data;
 el("proLogin").onclick=()=>authApi.signInWithPopup(auth,new authApi.GoogleAuthProvider()).catch(e=>status(e.message));
 el("proLogout").onclick=()=>authApi.signOut(auth);
 authApi.onAuthStateChanged(auth,async user=>{
  el("proLogin").hidden=!!user;el("proLogout").hidden=!user;el("professionalPanels").hidden=!user;
  if(!user){status("Sign in with a staff-authorized account.");return}
  try{await refresh();status("Signed in. Access is granted only to authorized staff or advocates.")}catch(e){el("professionalPanels").hidden=true;status("Access denied or unavailable: "+e.message)}
 });
 const list=(name,items,format)=>{const root=el(name);root.replaceChildren();if(!items.length){root.textContent="No records.";return}for(const item of items){const d=document.createElement("div");d.className="workspace-alert";d.textContent=format(item);root.append(d)}};
 async function refresh(){
  const refs=await call("staffQueue");list("referralQueue",refs.items,x=>x.id+" · "+x.kind+" · "+x.status+" · case "+x.caseId);
  try{const [match,evidence]=await Promise.all([call("staffMatchQueue"),call("staffEvidenceQueue")]);
   list("matchingQueue",match.items,x=>x.caseId+" · "+x.area+" · "+x.agentName);
   list("evidenceQueue",evidence.items,x=>x.id+" · case "+x.caseId+" · "+x.contentType+" · "+x.status);
  }catch(e){el("matchingQueue").textContent="Staff-only queue unavailable.";el("evidenceQueue").textContent="Staff-only evidence queue unavailable."}
  try{const [apps,privacy]=await Promise.all([call("staffProfessionalApplications"),call("staffPrivacyQueue")]);list("proApplications",apps.items,x=>x.uid+" · "+x.name+" · license "+x.license);list("privacyQueue",privacy.items,x=>x.id+" · "+x.action+" · "+x.ownerUid)}catch(e){el("proApplications").textContent="Staff-only verification queue unavailable.";el("privacyQueue").textContent="Privacy queue unavailable."}
 }
 const execute=async(name,payload,success)=>{try{await call(name,payload);status(success);await refresh()}catch(e){status("Operation failed: "+e.message)}};
 const click=(id,name,get,success)=>{el(id).onclick=()=>execute(name,get(),success)};
 click("changeCaseStatus","staffChangeCaseStatus",()=>({caseId:el("moderateCaseId").value.trim(),status:el("moderateStatus").value}),"Case stage updated");
 click("recordRespondent","staffRecordRespondentStatement",()=>({caseId:el("moderateCaseId").value.trim(),reference:el("respondentRef").value.trim(),statement:el("respondentText").value.trim()}),"Restricted respondent reply recorded");
 click("verifyProfessional","staffVerifyProfessional",()=>({uid:el("applicantUid").value.trim(),verificationReference:el("verificationRef").value.trim(),decision:"verified"}),"Professional verified");
 click("rejectProfessional","staffVerifyProfessional",()=>({uid:el("applicantUid").value.trim(),verificationReference:el("verificationRef").value.trim(),decision:"rejected"}),"Application rejected");
 click("privacyApprove","staffPrivacyDecision",()=>({requestId:el("privacyRequestId").value.trim(),reason:el("privacyReason").value.trim(),decision:"approved_for_execution"}),"Privacy request approved");
 click("privacyReject","staffPrivacyDecision",()=>({requestId:el("privacyRequestId").value.trim(),reason:el("privacyReason").value.trim(),decision:"rejected"}),"Privacy request rejected");
 el("privacyExecute").onclick=()=>{if(confirm("Permanently execute the approved deletion? Confirm legal hold, identity and retention review."))execute("staffExecuteDeletion",{requestId:el("privacyRequestId").value.trim()},"Deletion execution completed")};
 click("evidenceApprove","reviewEvidence",()=>({evidenceId:el("evidenceId").value.trim(),decision:"approved"}),"Clean scanned evidence approved");
 click("evidenceReject","reviewEvidence",()=>({evidenceId:el("evidenceId").value.trim(),decision:"rejected"}),"Evidence rejected");
 el("proposeGroup").onclick=async()=>{
  const ids=el("caseIds").value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(ids.length<2||!confirm("Have these cases been independently reviewed, with consent from each tenant?"))return;
  try{const result=await call("createCoordinationGroup",{caseIds:ids});status("Group "+result.groupId+" proposed. Member approval is still required.")}catch(e){status(e.message)}
 };
 el("assignAdvocate").onclick=async()=>{
  try{const r=await call("assignReferral",{referralId:el("referralId").value.trim(),advocateUid:el("advocateUid").value.trim()});status("Referral assigned: "+r.status);await refresh()}catch(e){status(e.message)}
 };
}
