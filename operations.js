export async function mountOperations({call,caseId,setMessage,el,esc}){
 const root=el("coordinationOperations");
 root.innerHTML='<div class="workspace-layout"><section class="workspace-panel"><h3>Group invitations</h3><p>When staff find potentially related cases, you can separately accept or decline a private coordination invitation. No personal case details are shared through invitations.</p><div id="groupInvitations"></div><button type="button" class="btn outline" id="refreshInvites">Refresh invitations</button></section><section class="workspace-panel"><h3>Professional access</h3><p>You control which verified professionals can review your full case. Granting access is optional and can be revoked.</p><label for="proList">Verified professional</label><select id="proList"><option value="">Loading verified professionals…</option></select><div class="workspace-actions"><button type="button" class="btn dark" id="grantPro">Grant access</button><button type="button" class="btn outline" id="revokePro">Revoke access</button></div><small>A referral does not automatically grant case access.</small></section></div>';
 async function loadGroups(){
  try{
   const groups=await call("listMyGroups",{});
   const div=el("groupInvitations");div.replaceChildren();
   for(const group of groups.items){
    const entry=document.createElement("div");entry.className="workspace-alert";
    const summary=document.createElement("p");
    summary.textContent="Coordination group · "+group.count+" potential participants · "+group.status+" · Your response: "+group.myResponse;
    entry.append(summary);
    if(group.status==="pending_member_approval" && group.myResponse==="pending"){
     for(const [accept,title] of [[true,"Accept"],[false,"Decline"]]){
      const btn=document.createElement("button");btn.className="btn outline";btn.type="button";btn.textContent=title;
      btn.addEventListener("click",async()=>{try{await call("respondGroupInvitation",{groupId:group.id,accept});setMessage("Your invitation preference was saved.");await loadGroups()}catch(e){setMessage(e.message,true)}});
      entry.append(btn);
     }
    }
    div.append(entry);
   }
   if(!groups.items.length)div.textContent="No coordination invitations at the moment.";
  }catch(e){setMessage("Group invitations unavailable: "+e.message,true)}
 }
 el("refreshInvites").addEventListener("click",loadGroups);
 el("grantPro").addEventListener("click",()=>changeGrant(true));
 el("revokePro").addEventListener("click",()=>changeGrant(false));
 async function changeGrant(allow){const uid=el("proList").value;if(!uid)return setMessage("Select a verified professional.",true);if(allow&&!confirm("Allow this verified professional to read your case details?"))return;
  try{await call("grantProfessionalAccess",{caseId,professionalUid:uid,allow});setMessage(allow?"Professional access granted.":"Professional access revoked.")}catch(e){setMessage(e.message,true)}
 }
 try{const pros=await call("listVerifiedProfessionals",{});const select=el("proList");select.replaceChildren();
  const placeholder=document.createElement("option");placeholder.value="";placeholder.textContent=pros.items.length?"Choose a verified professional":"No verified professionals available";select.append(placeholder);
  for(const p of pros.items){const option=document.createElement("option");option.value=p.uid;option.textContent=(p.name||"Verified professional")+" · "+(p.specialty||"Legal support");select.append(option)}
 }catch(e){setMessage("Professional list unavailable: "+e.message,true)}
 await loadGroups();
}
