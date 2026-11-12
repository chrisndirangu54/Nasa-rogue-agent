import { firebaseConfig } from "./firebase-config.js";
import { initializeWorkspace, openWorkspace } from "./workspace.js";
const $ = (s) => document.querySelector(s);
const reportDialog=$("#reportDialog"),authDialog=$("#authDialog"),status=$("#dashboardStatus"),cases=$("#cases");
let auth,db,currentUser=null,api=null;
const configured=!!(firebaseConfig?.apiKey&&firebaseConfig?.projectId);
const escapeHTML=(v)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const formatKsh=n=>"KSh "+Number(n||0).toLocaleString("en-KE");
function reportMessage(message){$("#reportNotice").textContent=message}
function openReport(){reportMessage("");reportDialog.showModal()}
function openAuth(){if(!configured){$("#authNotice").textContent="Authentication will become available after the Firebase project is configured."}else{$("#authNotice").textContent=""}authDialog.showModal()}
document.querySelectorAll("[data-open-report]").forEach(x=>x.addEventListener("click",openReport));
document.querySelectorAll("[data-close]").forEach(x=>x.addEventListener("click",()=>x.closest("dialog").close()));
[reportDialog,authDialog].forEach(d=>d.addEventListener("click",e=>{if(e.target===d)d.close()}));
$("#signInBtn").addEventListener("click",()=>currentUser?logout():openAuth());
$("#dashboardAuth").addEventListener("click",openAuth);
$("#menuBtn").addEventListener("click",()=>$(".topbar").classList.toggle("open"));
document.querySelectorAll(".topbar nav a").forEach(x=>x.addEventListener("click",()=>$(".topbar").classList.remove("open")));
$("#year").textContent=String(new Date().getFullYear());
function calc(){const deposit=Math.max(0,Number($("#deposit").value)||0);const deduction=Math.max(0,Number($("#deductions").value)||0);$("#balance").textContent=formatKsh(Math.max(0,deposit-deduction))}
$("#deposit").addEventListener("input",calc);$("#deductions").addEventListener("input",calc);calc();
if(configured){try{
 const appModule=await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js");
 const authModule=await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js");
 const storeModule=await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");
 const app=appModule.initializeApp(firebaseConfig);
 if(firebaseConfig.appCheckSiteKey){const ac=await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app-check.js");ac.initializeAppCheck(app,{provider:new ac.ReCaptchaV3Provider(firebaseConfig.appCheckSiteKey),isTokenAutoRefreshEnabled:true});}
 auth=authModule.getAuth(app);db=storeModule.getFirestore(app);api={...authModule,...storeModule};
 initializeWorkspace({app, auth, db});
 authModule.onAuthStateChanged(auth,user=>{currentUser=user;$("#signInBtn").textContent=user?"Sign out":"Sign in";if(user){status.textContent="Your cases are visible only to your account.";loadCases()}else{status.textContent="Sign in to access private case files. Your complaints are not published publicly.";renderEmpty("Sign in to view your private cases.")}});
 }catch(err){console.error("Firebase initialization error",err);status.textContent="The sign-in service is temporarily unavailable."}
}
async function logout(){if(auth&&api)await api.signOut(auth)}
$("#googleLogin").addEventListener("click",async()=>{if(!auth||!api){$("#authNotice").textContent="Firebase is not configured. Follow the README setup guide.";return}try{await api.signInWithPopup(auth,new api.GoogleAuthProvider());authDialog.close()}catch(err){$("#authNotice").textContent="Could not sign in: "+(err.code||"Please retry")}})
function renderEmpty(message){cases.innerHTML='<div class="empty"><span>▤</span><strong>Private case dashboard</strong><p>'+escapeHTML(message)+'</p><button class="btn outline" id="caseCTA">Report a case →</button></div>';$("#caseCTA").addEventListener("click",openReport)}
async function loadCases(){if(!currentUser||!api)return;cases.textContent="Loading your cases…";try{const q=api.query(api.collection(db,"cases"),api.where("ownerUid","==",currentUser.uid),api.limit(50));const snap=await api.getDocs(q);const rows=snap.docs.map(d=>({id:d.id,...d.data()}));rows.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));if(!rows.length){renderEmpty("You haven't submitted a case yet.");return}cases.innerHTML=rows.map(r=>'<article class="case-card"><header><strong>'+escapeHTML(({deposit:"Deposit dispute",harassment:"Harassment report",fees:"Disputed fees",eviction:"Tenancy dispute",other:"Other issue"})[r.category]||"Rental issue")+'</strong><span class="status-pill">'+escapeHTML(r.status||"Submitted")+'</span></header><p>'+escapeHTML((r.description||"").slice(0,350))+'</p><small>'+escapeHTML(r.area||"")+' · '+formatKsh(r.amount||0)+' · '+escapeHTML(r.id)+'</small><div class="case-actions"><button class="btn outline" data-case-id="'+escapeHTML(r.id)+'" type="button">Open secure workspace →</button></div></article>').join("")}catch(err){console.error(err);renderEmpty("We couldn't load cases right now. Check your Firebase permissions and try again.")}}
$("#reportForm").addEventListener("submit",async e=>{e.preventDefault();if(!currentUser){reportMessage("Please sign in before submitting a private report.");openAuth();return}if(!db||!api||!firebaseConfig?.appCheckSiteKey){reportMessage("Secure complaint intake is not configured yet.");return}const f=new FormData(e.target);const entry={category:String(f.get("category")||""),area:String(f.get("area")||"").trim(),agent:String(f.get("agent")||"").trim(),description:String(f.get("description")||"").trim(),amount:f.get("amount")?Number(f.get("amount")):0,outcome:String(f.get("outcome")||"")};if(!["deposit","harassment","fees","eviction","other"].includes(entry.category)||!["refund","mediation","stop","advice","other"].includes(entry.outcome)||entry.description.length<30||entry.description.length>5000||!entry.area||entry.area.length>120||entry.agent.length>150||!Number.isFinite(entry.amount)||entry.amount<0||entry.amount>100000000||!f.get("consent")){reportMessage("Please check all required fields.");return}const submit=$("#submitReport");submit.disabled=true;reportMessage("Saving your report securely…");try{const fn=await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js");const service=fn.getFunctions(api.getApp ? api.getApp():auth.app,firebaseConfig.functionsRegion||"us-central1");await fn.httpsCallable(service,"submitCase")(entry);e.target.reset();reportDialog.close();location.hash="#dashboard";await loadCases()}catch(err){console.error(err);reportMessage("Could not save the report. Please retry or contact support.")}finally{submit.disabled=false}});

// Dashboard case controls delegate to the modular evidence / coordination workspace.
cases.addEventListener("click", e=>{const button=e.target.closest("[data-case-id]");if(button&&currentUser)openWorkspace(button.dataset.caseId)});
