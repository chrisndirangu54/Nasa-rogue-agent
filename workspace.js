import { firebaseConfig } from "./firebase-config.js";
let app,auth,db,sdk,storage,functions,user,caseId;
const el=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const msg=(value,bad=false)=>'<div class="workspace-alert '+(bad?'workspace-error':'')+'">'+esc(value)+'</div>';
async function call(name,data){const fn=sdk.httpsCallable(functions,name);return (await fn(data)).data}
function setMessage(s,bad=false){el("workspaceFeedback").innerHTML=msg(s,bad)}
export async function initializeWorkspace(context){
 app=context.app;auth=context.auth;db=context.db;
 const [fns,st]=await Promise.all([import("https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js"),import("https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js")]);
 sdk={...fns,...st};functions=fns.getFunctions(app, firebaseConfig.functionsRegion||"us-central1");storage=st.getStorage(app);
 auth.onAuthStateChanged(next=>{user=next;if(!next){el("workspace").hidden=true;caseId=null}});
 el("closeWorkspace").addEventListener("click",()=>{el("workspace").hidden=true;location.hash="#dashboard"});
}
export async function openWorkspace(id){
 if(!db||!user)return;
 caseId=id;el("workspace").hidden=false;location.hash="#workspace";
 const target=el("workspaceContent");target.textContent="Loading secure case…";
 try{
  const store=await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");
  const snapshot=await store.getDoc(store.doc(db,"cases",id));
  if(!snapshot.exists()||snapshot.data().ownerUid!==user.uid){target.textContent="You do not have access to this case.";return}
  const c=snapshot.data();
  target.innerHTML='<div class="workspace-alert">Case reference: '+esc(id)+' · '+esc(c.status)+'</div><div class="workspace-layout">'
   +'<article class="workspace-panel"><h3>Evidence vault</h3><p>Upload PDF, PNG or JPEG records (up to 10 MB each). New files remain quarantined pending review. Do not upload unrelated third-party personal data.</p><input id="evidenceFile" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"/><button type="button" class="btn dark" id="evidenceUpload">Submit evidence</button><ul id="evidenceList"></ul></article>'
   +'<article class="workspace-panel"><h3>Collective case coordination</h3><p>Opt in to having a trained coordinator examine whether other claims might relate to this agent or company. No automatic sharing of your identity or evidence.</p><label class="check"><input id="matchingConsent" type="checkbox"/> I consent to a private eligibility review for collective coordination.</label><button class="btn dark" type="button" id="matchingSave">Save matching preference</button><small id="matchingState">Matching is disabled until you opt in.</small></article>'
   +'<article class="workspace-panel"><h3>Legal and mediation request</h3><p>Ask for qualified professional review. This does not create an advocate-client relationship or file a court case.</p><label>Type of assistance<select id="referralKind"><option value="legal">Legal assistance</option><option value="mediation">Mediation</option></select></label><label>Context (optional)<textarea id="referralNotes" maxlength="1000" placeholder="What assistance would help?"></textarea></label><button class="btn dark" type="button" id="requestReferral">Request assistance</button></article>'
   +'<article class="workspace-panel"><h3>Privacy and case records</h3><p>Download a copy of your structured case details. You can also request account deletion; records subject to lawful retention or legal holds may need additional review.</p><div class="workspace-actions"><button class="btn outline" type="button" id="exportCase">Export case JSON</button><button class="btn outline" type="button" id="requestDeletion">Request account deletion</button></div><small>No automated filing or promise of a refund is made.</small></article></div>'
   +'<div id="workspaceFeedback" role="status" aria-live="polite"></div><section class="workspace-panel"><h3>Coordinator and advocate access</h3><p>Access requires an independently issued staff or verified-advocate custom claim. Case sharing is separately authorized, scoped and audited.</p><button class="btn outline" type="button" id="staffOpen">Open professional queue</button><div id="staffContent"></div></section>';
  el("matchingSave").addEventListener("click",async()=>{try{const result=await call("setMatchingConsent",{caseId:id,enabled:el("matchingConsent").checked});el("matchingState").textContent=result.enabled?"Consent saved. Review is pending.":"Matching preference disabled.";setMessage("Preference saved.")}catch(e){setMessage(e.message,true)}});
  el("requestReferral").addEventListener("click",async()=>{try{await call("requestReferral",{caseId:id,kind:el("referralKind").value,notes:el("referralNotes").value});setMessage("Assistance request recorded for moderator review.")}catch(e){setMessage(e.message,true)}});
  el("exportCase").addEventListener("click",()=>{const blob=new Blob([JSON.stringify({caseId:id,...c,createdAt:c.createdAt?.toDate()?.toISOString()||null,updatedAt:c.updatedAt?.toDate()?.toISOString()||null},null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="tenantshield-case-"+id+".json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1500)});
  el("requestDeletion").addEventListener("click",async()=>{if(!confirm("Request account deletion? This does not immediately erase records subject to legal retention."))return;try{await call("requestPrivacyAction",{action:"delete"});setMessage("Your privacy request has been filed.")}catch(e){setMessage(e.message,true)}});
  el("evidenceUpload").addEventListener("click",()=>uploadEvidence(id));
  el("staffOpen").addEventListener("click",loadStaffQueue);
  await Promise.all([loadEvidence(id),loadConsent(id)]);
 }catch(e){target.textContent="Could not open this case: "+e.message}
}
async function uploadEvidence(id){
 const file=el("evidenceFile").files?.[0];
 if(!file)return setMessage("Choose a file first.",true);
 if(!["application/pdf","image/png","image/jpeg"].includes(file.type)||file.size>10*1024*1024||file.size===0)return setMessage("Only PDF, JPEG or PNG files up to 10 MB are permitted.",true);
 try{
  const token=await call("issueEvidenceUpload",{caseId:id,contentType:file.type,size:file.size});
  const ref=sdk.ref(storage,token.path);
  await sdk.uploadBytes(ref,file,{contentType:file.type,customMetadata:{uploadId:token.uploadId}});
  setMessage("Evidence uploaded to quarantine. A reviewer must approve it before access.");
  el("evidenceFile").value="";await loadEvidence(id);
 }catch(e){setMessage("Upload failed: "+e.message,true)}
}
async function loadEvidence(id){
 try{const response=await call("listEvidence",{caseId:id});const list=el("evidenceList");list.replaceChildren();
 for(const item of response.items){const li=document.createElement("li");li.append(document.createTextNode((item.name||"Evidence file")+" · "+item.status+" · "));
 if(item.status==="approved"){const b=document.createElement("button");b.type="button";b.className="btn outline";b.textContent="View";b.addEventListener("click",async()=>{try{const d=await call("getEvidenceLink",{caseId:id,evidenceId:item.id});window.open(d.url,"_blank","noopener,noreferrer")}catch(e){setMessage(e.message,true)}});li.append(b)}
 list.append(li)}if(!response.items.length)list.textContent="No evidence uploaded yet."
 }catch(e){setMessage("Evidence list unavailable: "+e.message,true)}
}
async function loadConsent(id){try{const result=await call("getMatchingConsent",{caseId:id});el("matchingConsent").checked=!!result.enabled;el("matchingState").textContent=result.enabled?"Opted in; awaiting coordinator review.":"Matching is disabled until you opt in."}catch(e){setMessage(e.message,true)}}
async function loadStaffQueue(){
 try{const response=await call("staffQueue",{});const div=el("staffContent");div.replaceChildren();
 for(const x of response.items){const wrap=document.createElement("div");wrap.className="workspace-alert";wrap.textContent=x.kind+" · "+x.status+" · "+x.id+" · "+(x.caseId||"");div.append(wrap)}
 if(!response.items.length)div.textContent="No outstanding referral requests."
 }catch(e){setMessage("Professional access unavailable: "+e.message,true)}
}
