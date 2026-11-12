import {firebaseConfig} from "./firebase-config.js";
const el=id=>document.getElementById(id);
if(!firebaseConfig?.projectId||!firebaseConfig?.apiKey){el("result").textContent="Firebase must be configured before applications can be submitted.";el("application").hidden=true;el("login").disabled=true}
else{
 const [{initializeApp},authApi,fnApi]=await Promise.all([import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js"),import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js"),import("https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js")]);
 const app=initializeApp(firebaseConfig),auth=authApi.getAuth(app),fn=fnApi.getFunctions(app,firebaseConfig.functionsRegion||"us-central1");
 authApi.onAuthStateChanged(auth,user=>{el("application").hidden=!user;el("login").hidden=!!user});
 el("login").onclick=async()=>{try{await authApi.signInWithPopup(auth,new authApi.GoogleAuthProvider())}catch(e){el("result").textContent=e.message}};
 el("application").onsubmit=async e=>{e.preventDefault();try{const data={displayName:el("displayName").value.trim(),specialty:el("specialty").value.trim(),licenseNumber:el("licenseNumber").value.trim()};await fnApi.httpsCallable(fn,"applyProfessionalVerification")(data);el("result").textContent="Application submitted. Verification is pending."}catch(err){el("result").textContent=err.message}};
}
