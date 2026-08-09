import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { supabase, configured } from "./supabase";
import {
 adminSetRole,
 approveFaqEntry,
 archiveFaqEntry,
 bookAppointment,
 cancelAppointment,
 completeFacultyRequest,
 createFacultyAvailability,
 createFaqEntry,
 decideFacultyRequest,
 loadAdminPortal,
 loadFacultyProfile,
 loadFacultyPortal,
 loadStudentPortal,
 removeFacultyAvailability,
 rescheduleAppointment,
 updateFacultyProfile,
 type AdminPortal,
 type AppointmentStatus,
 type FaqEntry,
 type FacultyAvailability,
 type FacultyProfile,
 type FacultyRequest,
} from "./backend";
import {
 addCalendarDays,
 availabilityValidationMessage,
 calendarTimes,
 formatCalendarDay,
 formatManilaDateTime,
 formatTime,
 initialCalendarWeek,
 isUpcomingSlot,
 manilaDateKey,
 manilaInstant,
 overlapsExisting,
 weekDays,
} from "./scheduling";
import { NotificationCenter, type NotificationAppointment } from "./Notifications";

type Role = "student" | "faculty" | "admin";
type View = "home" | "find" | "schedule" | "assistant" | "profile";
type User = { id:string; name:string; email:string; role:Role; department?:string; email_notifications:boolean };
type Slot = { id:string; faculty_name:string; initials:string; expertise:string; starts_at:string; ends_at:string; location:string; color:string; appointment_id?:string; status?:AppointmentStatus; topic?:string; notes?:string; updated_at?:string };
type ChatMessage = { who:"you"|"bot"; text:string; source?:string; escalation?:boolean };

const demoSlots: Slot[] = [
  {id:"1",faculty_name:"Dr. Maria Santos",initials:"MS",expertise:"Software Engineering",starts_at:"2026-08-05T09:00",ends_at:"2026-08-05T09:30",location:"CLIRDEC Consultation Room",color:"coral"},
  {id:"2",faculty_name:"Prof. Juan Dela Cruz",initials:"JD",expertise:"Data Analytics",starts_at:"2026-08-05T13:00",ends_at:"2026-08-05T13:30",location:"CLIRDEC Consultation Room",color:"blue"},
  {id:"3",faculty_name:"Dr. Ana Reyes",initials:"AR",expertise:"Research Methods",starts_at:"2026-08-06T10:00",ends_at:"2026-08-06T10:30",location:"CLIRDEC Consultation Room",color:"gold"},
  {id:"4",faculty_name:"Prof. Carlo Mendoza",initials:"CM",expertise:"Web Development",starts_at:"2026-08-07T14:00",ends_at:"2026-08-07T14:30",location:"CLIRDEC Consultation Room",color:"mint"}
];

function App(){
 const [user,setUser]=useState<User|null>(null); const [authLoading,setAuthLoading]=useState(configured);
 const [recoveringPassword,setRecoveringPassword]=useState(false);
 const [view,setView]=useState<View>("home"); const [slots,setSlots]=useState<Slot[]>(configured?[]:demoSlots);
 const [booked,setBooked]=useState<Slot[]>([]); const [selected,setSelected]=useState<Slot|null>(null); const [bookingTopic,setBookingTopic]=useState("");
 const [reschedulingId,setReschedulingId]=useState<string|null>(null); const [submitting,setSubmitting]=useState(false);
 const [notice,setNotice]=useState(""); const [query,setQuery]=useState(""); const [menu,setMenu]=useState(false);
 const [chat,setChat]=useState<ChatMessage[]>([{who:"bot",text:"Hi! I use approved CLIRDEC information. Ask about services, office hours, consultation procedures, faculty availability, or official contacts."}]);
 const [question,setQuestion]=useState("");
 useEffect(()=>{
  if(!configured){setAuthLoading(false);return;}
  let active=true;
  const loadUser=async(id:string,email:string)=>{
   const {data:p,error}=await supabase.from("profiles").select("full_name,role,department,email_notifications").eq("id",id).single();
   if(!active)return;
   if(error){setNotice("Your account exists, but its portal profile could not be loaded.");setUser(null);return;}
   setUser({id,email,name:p.full_name,role:p.role as Role,department:p.department||"",email_notifications:p.email_notifications??true});
  };
  supabase.auth.getSession().then(async({data})=>{
   if(data.session)await loadUser(data.session.user.id,data.session.user.email||"");
   if(active)setAuthLoading(false);
  });
  const {data:listener}=supabase.auth.onAuthStateChange((event,session)=>{
   if(event==="SIGNED_OUT"){setUser(null);setRecoveringPassword(false);setAuthLoading(false);}
   else if(event==="PASSWORD_RECOVERY"){
    setRecoveringPassword(true);
    setAuthLoading(false);
    if(session)void loadUser(session.user.id,session.user.email||"");
   }else if(session)void loadUser(session.user.id,session.user.email||"");
  });
  return()=>{active=false;listener.subscription.unsubscribe();};
 },[]);
 useEffect(()=>{
  if(!configured||!user||user.role!=="student")return;
  const refresh=()=>void loadStudentData(user.id);
  refresh();
  const interval=window.setInterval(refresh,30_000);
  window.addEventListener("focus",refresh);
  const channel=supabase.channel(`student-appointments:${user.id}`).on(
   "postgres_changes",
   {event:"*",schema:"public",table:"appointments",filter:`student_id=eq.${user.id}`},
   refresh,
  ).subscribe();
  return()=>{
   window.clearInterval(interval);
   window.removeEventListener("focus",refresh);
   void supabase.removeChannel(channel);
  };
 },[user?.id,user?.role]);
 async function loadStudentData(studentId:string){
  try{
   const data=await loadStudentPortal(studentId);
   setSlots(data.slots.map((slot,i)=>({id:slot.id,faculty_name:slot.faculty_name,initials:slot.faculty_name.split(" ").map(n=>n[0]).join("").slice(0,2),expertise:slot.expertise.join(", ")||"General consultation",starts_at:slot.starts_at,ends_at:slot.ends_at,location:slot.location,color:["coral","blue","gold","mint"][i%4]})));
    setBooked(data.appointments.map((item)=>({id:item.availability_id,appointment_id:item.id,faculty_name:item.faculty_name,initials:item.faculty_name.split(" ").map(n=>n[0]).join("").slice(0,2),expertise:item.expertise.join(", ")||"Consultation",starts_at:item.starts_at,ends_at:item.ends_at,location:item.location,color:"mint",status:item.status,topic:item.topic,notes:item.notes,updated_at:item.updated_at})));
  }catch(cause){setNotice(cause instanceof Error?cause.message:"Student data could not be loaded.");}
 }
 const filtered=useMemo(()=>slots.filter(s=>(s.faculty_name+" "+s.expertise).toLowerCase().includes(query.toLowerCase())),[slots,query]);
 async function login(e:FormEvent<HTMLFormElement>){e.preventDefault();setNotice("");if(!configured){setNotice("The production database is not configured yet. Add the Supabase environment variables in Vercel.");return;}const f=new FormData(e.currentTarget);const email=String(f.get("email"));const password=String(f.get("password"));const {error}=await supabase.auth.signInWithPassword({email,password});if(error)setNotice(error.message);}
 async function signup(e:FormEvent<HTMLFormElement>){e.preventDefault();setNotice("");if(!configured){setNotice("The production database is not configured yet. Add the Supabase environment variables in Vercel.");return;}const f=new FormData(e.currentTarget);const full_name=String(f.get("full_name"));const email=String(f.get("email"));const password=String(f.get("password"));const confirmation=String(f.get("confirmation"));if(!studentPasswordIsValid(password)){setNotice("Your password must meet every requirement shown below the password field.");return;}if(password!==confirmation){setNotice("The password confirmation does not match.");return;}const {data,error}=await supabase.auth.signUp({email,password,options:{data:{full_name}}});if(error){setNotice(error.message);return;}setNotice(data.session?"Student account created.":"Student account created. Check your email for the confirmation link before signing in.");}
 async function requestPasswordReset(email:string){setNotice("");if(!configured){setNotice("Password recovery requires the production Supabase configuration.");return;}if(!email||!email.includes("@")){setNotice("Enter your registered email address first.");return;}const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin});setNotice(error?error.message:"Check your email for the secure password-reset link.");}
 async function updateRecoveredPassword(password:string){setNotice("");const {error}=await supabase.auth.updateUser({password});if(error){setNotice(error.message);return false;}setRecoveringPassword(false);setNotice("Your password has been updated.");return true;}
 async function logout(){setUser(null);setView("home");setNotice("");if(configured)await supabase.auth.signOut({scope:"local"});}
 async function saveStudentProfile(values:{fullName:string;department:string;emailNotifications:boolean}){
  if(!user)return false;
  setNotice("");
  if(configured){
   const {error}=await supabase.from("profiles").update({full_name:values.fullName,department:values.department||null,email_notifications:values.emailNotifications}).eq("id",user.id);
   if(error){setNotice(error.message);return false;}
  }
  setUser({...user,name:values.fullName,department:values.department,email_notifications:values.emailNotifications});
  setNotice("Profile has been updated.");
  return true;
 }
 async function confirmBook(){if(!user||!selected||submitting)return;const slot=selected;const topic=bookingTopic.trim();if(!topic){setNotice("Please describe the consultation topic before submitting the request.");return;}setSubmitting(true);try{if(reschedulingId){await rescheduleAppointment(reschedulingId,slot.id);setNotice(`Your request was moved to ${slot.faculty_name}'s published time and is pending approval.`);}else{await bookAppointment({slotId:slot.id,topic,notes:topic});setNotice(`Request sent to ${slot.faculty_name}. Email updates will be sent to ${user.email}.`);}await loadStudentData(user.id);setSelected(null);setBookingTopic("");setReschedulingId(null);setView("schedule");}catch(cause){setNotice(cause instanceof Error?cause.message:"The request could not be submitted.");}finally{setSubmitting(false);}}
 async function cancelRequest(appointmentId:string){if(!user||submitting)return;setSubmitting(true);try{await cancelAppointment(appointmentId);setNotice("The consultation was cancelled and both participants were queued for an email update.");await loadStudentData(user.id);}catch(cause){setNotice(cause instanceof Error?cause.message:"The request could not be cancelled.");}finally{setSubmitting(false);}}
 function beginReschedule(slot:Slot){if(!slot.appointment_id)return;setReschedulingId(slot.appointment_id);setBookingTopic(slot.topic||"");setView("find");setNotice("Choose a different published time. Your current request remains active until the replacement succeeds.");}
 async function ask(e:FormEvent){e.preventDefault();const q=question.trim();if(!q)return;setQuestion("");setChat(c=>[...c,{who:"you",text:q}]);try{const {data}=await supabase.auth.getSession();const headers:Record<string,string>={"Content-Type":"application/json"};if(data.session?.access_token)headers.Authorization=`Bearer ${data.session.access_token}`;const configuredBase=String(import.meta.env.VITE_CHATBOT_URL||"").replace(/\/$/,"");const chatbotBase=configuredBase||(import.meta.env.PROD?"/api":"http://localhost:8000");const r=await fetch(`${chatbotBase}/chat`,{method:"POST",headers,body:JSON.stringify({message:q})});if(!r.ok)throw new Error(`Assistant returned ${r.status}`);const d=await r.json();setChat(c=>[...c,{who:"bot",text:d.answer,source:d.source,escalation:Boolean(d.escalation)}]);}catch{setChat(c=>[...c,{who:"bot",text:"The assistant is temporarily offline. Please use the official CLIRDEC contact channel or try again later.",escalation:true}]);}}
 if(authLoading)return <main className="auth-loading"><p>Loading FacultyConnect…</p></main>;
 if(recoveringPassword)return <PasswordRecovery save={updateRecoveredPassword} notice={notice}/>;
 if(!user)return <ProductionAuth login={login} signup={signup} resetPassword={requestPasswordReset} notice={notice}/>;
 if(user.role!=="student")return <RoleWorkspace user={user} logout={logout}/>;
 const nav=(next:View)=>{setView(next);setMenu(false);setNotice("");if(next!=="find"){setReschedulingId(null);setBookingTopic("");}};
 const studentNotifications:NotificationAppointment[]=booked.filter((item)=>Boolean(item.status)).map((item)=>({id:item.appointment_id||item.id,status:item.status!,updated_at:item.updated_at||item.starts_at,starts_at:item.starts_at,faculty_name:item.faculty_name,student_name:user.name,topic:item.topic||item.expertise,location:item.location}));
 return <div className="app"><header className="topbar"><button className="brand-button" onClick={()=>nav("home")}><BrandLogo/><span><b>CLSU FacultyConnect</b><small>Managed by MISO · CLIRDEC pilot</small></span></button><div className="top-actions"><NotificationCenter user={user} studentAppointments={studentNotifications} onNavigate={(target)=>nav(target as View)}/><button className="profile-chip" onClick={()=>nav("profile")} aria-label="Open my profile"><span>{user.name.split(" ").map(part=>part[0]).join("").slice(0,2)}</span><i><b>{user.name}</b><small>Student</small></i></button><button className="menu-button" onClick={()=>setMenu(!menu)} aria-label="Toggle menu">☰</button></div></header>
 <aside className={menu?"sidebar open":"sidebar"}><nav><Nav active={view==="home"} label="Overview" icon="home" onClick={()=>nav("home")}/><Nav active={view==="assistant"} label="Ask Consult AI" icon="assistant" onClick={()=>nav("assistant")}/><Nav active={view==="find"} label="Faculty availability" icon="search" onClick={()=>nav("find")}/><Nav active={view==="schedule"} label="My requests" icon="requests" onClick={()=>nav("schedule")}/></nav><div className="side-foot"><span>CLIRDEC</span><small>Controlled pilot · Approved content only</small><button onClick={logout}>Sign out</button></div></aside>
 <main className="content">{notice&&<div className="notice"><b>✓</b><span>{notice}</span><button onClick={()=>setNotice("")}>×</button></div>}
 {view==="home"&&<Dashboard user={user} booked={booked} go={nav}/>} {view==="find"&&<FindFaculty query={query} setQuery={setQuery} slots={filtered} select={setSelected}/>} {view==="schedule"&&<Schedule booked={booked} cancel={cancelRequest} reschedule={beginReschedule} busy={submitting} emailNotifications={user.email_notifications}/>} {view==="assistant"&&<Chat chat={chat} question={question} setQuestion={setQuestion} ask={ask}/>} {view==="profile"&&<StudentProfile user={user} save={saveStudentProfile}/>}</main>
 {selected&&<BookingModal slot={selected} topic={bookingTopic} setTopic={setBookingTopic} close={()=>{setSelected(null);setReschedulingId(null);setBookingTopic("");}} confirm={confirmBook} submitting={submitting} rescheduling={Boolean(reschedulingId)}/>}</div>;
}

const studentPasswordRules=[
 {id:"length",label:"At least 12 characters",test:(value:string)=>value.length>=12},
 {id:"uppercase",label:"One uppercase letter",test:(value:string)=>/[A-Z]/.test(value)},
 {id:"lowercase",label:"One lowercase letter",test:(value:string)=>/[a-z]/.test(value)},
 {id:"number",label:"One number",test:(value:string)=>/\d/.test(value)},
 {id:"symbol",label:"One symbol (for example: ! @ # $ %)",test:(value:string)=>/[^A-Za-z0-9\s]/.test(value)},
] as const;
function studentPasswordIsValid(value:string){return studentPasswordRules.every(rule=>rule.test(value));}
function PasswordVisibilityIcon({visible}:{visible:boolean}){
 return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{visible?<><path d="M3 3l18 18"/><path d="M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.3A10.8 10.8 0 0 1 12 4c5.2 0 9 4.7 9 8a8.5 8.5 0 0 1-2.1 3.9M6.6 6.6C4.3 8 3 10.3 3 12c0 3.3 3.8 8 9 8 1.1 0 2.2-.2 3.1-.6"/></>:<><path d="M3 12c0-3.3 3.8-8 9-8s9 4.7 9 8-3.8 8-9 8-9-4.7-9-8Z"/><circle cx="12" cy="12" r="2.5"/></>}</svg>;
}
type SielState="neutral"|"active"|"ecstatic"|"shy"|"peek";
const sielMessages:Record<SielState,{title:string;detail:string}>={
 neutral:{title:"Hi, I’m Siel!",detail:"Let’s create your student account."},
 active:{title:"I’m ready!",detail:"Tell me a little about yourself."},
 ecstatic:{title:"That’s a strong password!",detail:"Every requirement is complete."},
 shy:{title:"I can’t see it!",detail:"Your password stays private while you type."},
 peek:{title:"Just checking!",detail:"Your password is visible on this screen."},
};
function AnimatedSiel({state}:{state:SielState}){
 const message=sielMessages[state];
 return <figure className={`siel-card state-${state}`}>
  <span className="siel-avatar-shell"><svg className="siel-avatar" viewBox="0 0 180 180" role="img" aria-label={`Siel the CLSU Green Cobra is ${state}`}>
   <circle className="siel-backdrop" cx="90" cy="90" r="82"/>
   <g className="siel-sparkles" aria-hidden="true"><path d="M30 42v13M23.5 48.5h13"/><path d="M150 48v10M145 53h10"/><circle cx="146" cy="124" r="3"/></g>
   <g className="siel-character">
    <path className="siel-hood" d="M34 98C22 69 29 34 58 28c7-12 20-18 32-18s25 6 32 18c29 6 36 41 24 70-10 25-31 40-56 40S44 123 34 98Z"/>
    <path className="siel-face" d="M53 77c1-27 16-44 37-44s36 17 37 44c1 27-14 48-37 48S52 104 53 77Z"/>
    <path className="siel-muzzle" d="M66 91c6-10 13-13 24-8 11-5 18-2 24 8 3 13-7 24-24 24S63 104 66 91Z"/>
    <g className="siel-eyes">
     <ellipse cx="72" cy="75" rx="5" ry="6"/><ellipse cx="108" cy="75" rx="5" ry="6"/>
     <circle className="siel-eye-glint" cx="70.5" cy="73" r="1.5"/><circle className="siel-eye-glint" cx="106.5" cy="73" r="1.5"/>
    </g>
    <path className="siel-brow siel-brow-left" d="M64 64q8-5 15 0"/><path className="siel-brow siel-brow-right" d="M101 64q8-5 15 0"/>
    <path className="siel-nose" d="M84 89q6-5 12 0-1 7-6 7t-6-7Z"/>
    {state==="ecstatic"?<path className="siel-mouth siel-mouth-happy" d="M73 100q17 25 34 0-17 9-34 0Z"/>:state==="active"||state==="peek"?<ellipse className="siel-mouth siel-mouth-open" cx="90" cy="104" rx="8" ry="9"/>:<path className="siel-mouth" d="M76 101q14 13 28 0"/>}
    <path className="siel-torso" d="M58 120q32-16 64 0l10 52H48l10-52Z"/>
    <path className="siel-chest" d="M74 124q16-7 32 0l6 48H68l6-48Z"/>
    <path className="siel-chevron" d="m71 137 19 9 19-9M70 147l20 9 20-9"/>
    <circle className="siel-medallion" cx="90" cy="128" r="6"/><path className="siel-medallion-mark" d="M93 125a4 4 0 1 0 0 6"/>
    <g className="siel-arm siel-arm-left"><path d="M50 158Q44 120 67 80"/><circle cx="68" cy="78" r="12"/></g>
    <g className="siel-arm siel-arm-right"><path d="M130 158q6-38-17-78"/><circle cx="112" cy="78" r="12"/></g>
   </g>
  </svg></span>
  <figcaption aria-live="polite"><b>{message.title}</b><span>{message.detail}</span><small>Animated Siel · CLSU Green Cobra</small></figcaption>
 </figure>;
}
function ProductionAuth({login,signup,resetPassword,notice}:{login:(e:FormEvent<HTMLFormElement>)=>void;signup:(e:FormEvent<HTMLFormElement>)=>void;resetPassword:(email:string)=>Promise<void>;notice:string}){
 const [creating,setCreating]=useState(false);
 const [password,setPassword]=useState("");
 const [confirmation,setConfirmation]=useState("");
 const [passwordVisible,setPasswordVisible]=useState(false);
 const [focusedField,setFocusedField]=useState<"none"|"identity"|"password">("none");
 const passwordValid=studentPasswordIsValid(password);
 const passwordsMatch=confirmation.length>0&&password===confirmation;
 const passedRuleCount=studentPasswordRules.filter(rule=>rule.test(password)).length;
 const sielState:SielState=passwordValid&&passwordsMatch?"ecstatic":passwordVisible?"peek":focusedField==="password"?"shy":focusedField==="identity"?"active":"neutral";
 const changeMode=()=>{setCreating(value=>!value);setPassword("");setConfirmation("");setPasswordVisible(false);setFocusedField("none");};
 return <main className="auth">
  <section className="auth-story">
   <div className="public-brand"><BrandLogo tone="light" size="hero"/><span>CLSU FacultyConnect</span></div>
   <div><span className="pilot-label">MISO · CLIRDEC PILOT</span><h1>Approved answers. Clear next steps.</h1><p>Use your registered email to access faculty consultation services and verified CLIRDEC guidance.</p><ul><li>Role-protected student, faculty, and administrator portals</li><li>Faculty-approved schedules and request decisions</li><li>Email updates for important appointment events</li></ul></div>
   <small>Central Luzon State University · Nurturing a Culture of Excellence</small>
  </section>
  <section className="auth-panel">
   <form className={creating?"login student-signup":"login"} onSubmit={creating?signup:login}>
    <span className="mobile-brand"><BrandLogo/><span>CLSU FacultyConnect</span></span><p className="eyebrow">SECURE PORTAL</p>
    {creating?<div className="signup-heading"><div><h2>Create a student account</h2><p className="muted">Register as a student to request faculty consultations. Faculty and administrator accounts are issued only by MISO.</p></div><AnimatedSiel state={sielState}/></div>:<><h2>Log in to your portal</h2><p className="muted">Students, faculty, and administrators use the same secure sign-in.</p></>}
    {creating&&<label>Full name<input name="full_name" required autoComplete="name" onFocus={()=>setFocusedField("identity")} onBlur={()=>setFocusedField("none")}/></label>}
    <label>{creating?"Student email address":"Email address"}<input name="email" type="email" required autoComplete="email" onFocus={()=>{if(creating)setFocusedField("identity");}} onBlur={()=>{if(creating)setFocusedField("none");}}/></label>
    <div className="auth-field password-label"><label htmlFor="portal-password">Password</label><span className="password-field"><input id="portal-password" name="password" type={passwordVisible?"text":"password"} required minLength={creating?12:8} autoComplete={creating?"new-password":"current-password"} value={password} onChange={event=>setPassword(event.target.value)} onFocus={()=>{if(creating)setFocusedField("password");}} onBlur={()=>{if(creating)setFocusedField("none");}} aria-describedby={creating?"student-password-rules student-password-progress":undefined} aria-invalid={creating&&password.length>0&&!passwordValid}/><button type="button" className="password-visibility" aria-label={passwordVisible?"Hide password":"Show password"} aria-pressed={passwordVisible} onClick={()=>setPasswordVisible(value=>!value)}><PasswordVisibilityIcon visible={passwordVisible}/><span>{passwordVisible?"Hide":"Show"}</span></button></span></div>
    {creating&&<><div className={passwordVisible?"password-privacy visible":"password-privacy"} role="status"><span aria-hidden="true">{passwordVisible?"👁":"🛡"}</span><p><b>{passwordVisible?"Your password is visible":"Your password is hidden"}</b><small>{passwordVisible?"Make sure no one else can see your screen.":"Select Show whenever you need to check what you typed."}</small></p></div><p id="student-password-progress" className="sr-only" aria-live="polite">{passedRuleCount} of {studentPasswordRules.length} password requirements met.</p><ul className="password-rules" id="student-password-rules" aria-label="Password requirements">{studentPasswordRules.map(rule=>{const passed=rule.test(password);return <li key={rule.id} className={passed?"passed":""}><span aria-hidden="true">{passed?"✓":"·"}</span>{rule.label}</li>;})}</ul><div className="auth-field"><label htmlFor="portal-password-confirmation">Confirm password</label><span className="password-field"><input id="portal-password-confirmation" name="confirmation" type={passwordVisible?"text":"password"} required minLength={12} autoComplete="new-password" value={confirmation} onChange={event=>setConfirmation(event.target.value)} onFocus={()=>setFocusedField("password")} onBlur={()=>setFocusedField("none")} aria-describedby="password-match-status" aria-invalid={confirmation.length>0&&!passwordsMatch}/></span></div><p id="password-match-status" className={passwordsMatch?"password-match passed":"password-match"} aria-live="polite">{confirmation.length===0?"Re-enter your password to confirm it.":passwordsMatch?"✓ Passwords match.":"Passwords do not match yet."}</p></>}
    <button className="primary" disabled={creating&&(!passwordValid||!passwordsMatch)}>{creating?"Create student account":"Log in"}</button>
    <div className="auth-options">
     {!creating&&<button type="button" className="auth-option" onClick={event=>{const form=event.currentTarget.form;if(form)void resetPassword(String(new FormData(form).get("email")||""));}}><b>Forgot your password?</b><small>Enter your email above to receive a secure reset link.</small></button>}
     <button type="button" className="auth-option" onClick={changeMode}><b>{creating?"Already registered? Sign in":"Create a student account"}</b><small>{creating?"Return to the secure portal login.":"For students who need to request faculty consultations."}</small></button>
    </div>
    {!creating&&<aside className="account-type-list" aria-label="Account types"><p>ACCOUNT TYPES</p><div><b>Student</b><span>Self-register and request consultations.</span></div><div><b>Faculty</b><span>MISO-issued account for schedules and requests.</span></div><div><b>Administrator</b><span>Restricted MISO account for portal oversight.</span></div></aside>}
    {!configured&&<small className="demo-note">Backend setup required · Supabase environment variables are not configured.</small>}
    {notice&&<p className="error" aria-live="polite">{notice}</p>}
   </form>
  </section>
 </main>;
}
function PasswordRecovery({save,notice}:{save:(password:string)=>Promise<boolean>;notice:string}){
 const [saving,setSaving]=useState(false);
 const [localError,setLocalError]=useState("");
 const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const form=new FormData(event.currentTarget);const password=String(form.get("password")||"");const confirmation=String(form.get("confirmation")||"");if(password!==confirmation){setLocalError("Passwords do not match.");return;}setLocalError("");setSaving(true);await save(password);setSaving(false);};
 return <main className="auth"><section className="auth-story"><div className="public-brand"><BrandLogo tone="light" size="hero"/><span>CLSU FacultyConnect</span></div><div><span className="pilot-label">SECURE ACCOUNT RECOVERY</span><h1>Choose a new password.</h1><p>The recovery link creates a temporary authenticated session. Your password is updated directly through Supabase Auth.</p></div></section><section className="auth-panel"><form className="login" onSubmit={submit}><p className="eyebrow">PASSWORD RECOVERY</p><h2>Set your new password</h2><label>New password<input name="password" type="password" required minLength={8} autoComplete="new-password"/></label><label>Confirm password<input name="confirmation" type="password" required minLength={8} autoComplete="new-password"/></label><button className="primary" disabled={saving}>{saving?"Updating…":"Update password"}</button>{(localError||notice)&&<p className="error">{localError||notice}</p>}</form></section></main>;
}
function BrandLogo({tone="dark",size="header"}:{tone?:"dark"|"light";size?:"header"|"hero"}){return <img className={`brand-logo brand-logo-${size}`} src={tone==="light"?"/brand/Logo_white.png":"/brand/Logo_Black.png"} alt="" aria-hidden="true"/>}
type NavIconName="home"|"assistant"|"search"|"requests"|"calendar"|"profile"|"users"|"report";
function NavIcon({name}:{name:NavIconName}){
 const paths:Record<NavIconName,ReactNode>={
  home:<><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5M9.5 20v-6h5v6"/></>,
  assistant:<><path d="M12 3 13.7 8.3 19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="m19 17 .8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8L19 17Z"/></>,
  search:<><circle cx="11" cy="11" r="6.5"/><path d="m16 16 5 5"/></>,
  requests:<><path d="M6 3.5h12a2 2 0 0 1 2 2v15H4v-15a2 2 0 0 1 2-2Z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
  calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M7 14h3M14 14h3M7 18h3M14 18h3"/></>,
  profile:<><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></>,
  users:<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></>,
  report:<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
 };
 return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Nav({active,label,icon,onClick}:{active:boolean;label:string;icon:NavIconName;onClick:()=>void}){return <button className={active?"nav-item active":"nav-item"} onClick={onClick}><NavIcon name={icon}/><span>{label}</span></button>}
function statusLabel(status:AppointmentStatus="pending"){return({pending:"Pending faculty approval",confirmed:"Confirmed",completed:"Completed",cancelled:"Cancelled",declined:"Declined"} as Record<AppointmentStatus,string>)[status];}
function Dashboard({user,booked,go}:{user:User;booked:Slot[];go:(v:View)=>void}) {
 const next=booked[0];
 return <>
  <section className="page-head">
   <div>
    <p className="eyebrow">CLIRDEC FAQ PILOT</p>
    <h1>What do you need help with, {user.name.split(" ")[0]}?</h1>
    <p>Start with the approved-information assistant or view faculty-maintained availability.</p>
   </div>
   <button className="primary" onClick={()=>go("assistant")}>Ask Consult AI <span>→</span></button>
  </section>
  <section className="overview-grid">
   <article className="next-card">
    <div className="section-label">
     <span>LATEST CONSULTATION REQUEST</span>
     {next&&<b>{statusLabel(next.status)}</b>}
    </div>
    {next ? <>
     <div className="appointment-date">
      <strong>{new Date(next.starts_at).getDate()}</strong>
      <span>{formatManilaDateTime(new Date(next.starts_at),{month:"short"}).toUpperCase()}<br/>{formatManilaDateTime(new Date(next.starts_at),{weekday:"short"})}</span>
     </div>
     <div className="appointment-main">
      <span className={`avatar ${next.color}`}>{next.initials}</span>
      <div>
       <h3>{next.topic||next.expertise}</h3>
       <p>{next.faculty_name}</p>
       <small>Requested time: {formatManilaDateTime(new Date(next.starts_at),{hour:"numeric",minute:"2-digit"})} Philippine time</small>
      </div>
     </div>
     <button className="text-button" onClick={()=>go("schedule")}>View request status →</button>
    </> : <div className="empty">
     <b>No active request</b>
     <p>Availability shown in the portal is faculty-approved, but a request still requires faculty confirmation.</p>
    </div>}
   </article>
   <article className="quick-card">
    <span className="section-label">APPROVED GUIDANCE</span>
    <button onClick={()=>go("assistant")}>
     <span className="quick-icon">✦</span>
     <i><b>Ask Consult AI</b><small>FAQs, services, procedures, hours, and contacts</small></i>
     <strong>→</strong>
    </button>
    <button onClick={()=>go("find")}>
     <span className="quick-icon">⌕</span>
     <i><b>View faculty availability</b><small>Use approved categories and published schedules</small></i>
     <strong>→</strong>
    </button>
   </article>
  </section>
  <section className="how">
   <div className="section-title">
    <div><p className="eyebrow">SAFE BY DESIGN</p><h2>Approved answer or official referral</h2></div>
    <p>The pilot does not provide unrestricted generative answers.</p>
   </div>
   <div className="steps">
    <article><b>01</b><span>✦</span><h3>Ask naturally</h3><p>Use English, Filipino, mixed language, or common abbreviations.</p></article>
    <article><b>02</b><span>?</span><h3>Clarify when needed</h3><p>The assistant asks one clarifying question when confidence is low.</p></article>
    <article><b>03</b><span>↗</span><h3>Refer safely</h3><p>Unsupported or sensitive concerns go to an official staff channel.</p></article>
   </div>
  </section>
 </>;
}
function FindFaculty({query,setQuery,slots,select}:{query:string;setQuery:(s:string)=>void;slots:Slot[];select:(s:Slot)=>void}){return <><section className="page-head compact"><div><p className="eyebrow">APPROVED CONSULTATION GUIDANCE</p><h1>Faculty availability</h1><p>Browse faculty-maintained schedules and approved expertise categories. The system does not automatically assign a faculty member.</p></div></section><div className="search-box"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search an approved category or faculty name"/></div><div className="result-head"><b>{slots.length} published availability entries</b><span>Source: faculty-approved CLIRDEC schedules</span></div><section className="faculty-grid">{slots.map(s=><article className="faculty-card" key={s.id}><div className="faculty-top"><span className={`avatar large ${s.color}`}>{s.initials}</span><div><span className="available">● Faculty-published</span><h3>{s.faculty_name}</h3><p>{s.expertise}</p></div></div><div className="slot-line"><span>Published time</span><b>{formatManilaDateTime(new Date(s.starts_at),{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})} · Philippine time</b></div><button className="primary wide" onClick={()=>select(s)}>Review and request →</button></article>)}</section></>}
function Schedule({booked,cancel,reschedule,busy,emailNotifications}:{booked:Slot[];cancel:(id:string)=>void;reschedule:(slot:Slot)=>void;busy:boolean;emailNotifications:boolean}){return <><section className="page-head compact"><div><p className="eyebrow">CONSULTATION GUIDANCE</p><h1>My requests</h1><p>Requests shown here are not appointments until the faculty member confirms them.</p></div></section><div className="scope-note"><b>{emailNotifications?"Email notifications enabled":"Email notifications disabled"}</b><span>{emailNotifications?"Your registered email receives request, decision, cancellation, and reminder updates.":"Enable optional email updates from My profile. In-app status remains available here."} Cancelling or rescheduling never removes the audit history.</span></div><div className="schedule-list">{booked.map(s=>{const active=s.status==="pending"||s.status==="confirmed";return <article key={s.appointment_id||s.id}><div className="date-block"><strong>{formatManilaDateTime(new Date(s.starts_at),{day:"numeric"})}</strong><span>{formatManilaDateTime(new Date(s.starts_at),{month:"short"})}</span></div><span className={`avatar ${s.color}`}>{s.initials}</span><div className="schedule-info"><span className={`status ${s.status||"pending"}`}>{statusLabel(s.status).toUpperCase()}</span><h3>{s.topic||s.expertise}</h3><p>{s.faculty_name} · {formatManilaDateTime(new Date(s.starts_at),{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</p><small>{emailNotifications?"✉ Email updates enabled":"In-app status updates"} · {s.status==="confirmed"?s.location:"Final location follows faculty approval."}</small>{active&&s.appointment_id&&<div className="inline-actions"><button className="outline" disabled={busy} onClick={()=>reschedule(s)}>Choose another time</button><button className="danger-button" disabled={busy} onClick={()=>cancel(s.appointment_id!)}>Cancel</button></div>}</div></article>})}{!booked.length&&<div className="empty-card">You have no consultation requests. Ask Consult AI for the approved procedure or view faculty availability.</div>}</div></>}
function StudentProfile({user,save}:{user:User;save:(values:{fullName:string;department:string;emailNotifications:boolean})=>Promise<boolean>}){
 const [editing,setEditing]=useState(false);
 const [saving,setSaving]=useState(false);
 const initials=user.name.split(" ").map(part=>part[0]).join("").slice(0,2);
 const submit=async(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();
  const form=new FormData(e.currentTarget);
  setSaving(true);
  const saved=await save({fullName:String(form.get("full_name")||"").trim(),department:String(form.get("department")||"").trim(),emailNotifications:form.get("email_notifications")==="on"});
  setSaving(false);
  if(saved)setEditing(false);
 };
 return <>
  <section className="page-head compact student-profile-heading"><div><h1>My profile</h1></div></section>
  <section className="student-profile-layout">
   <article className="student-identity-card"><span className="avatar student-avatar">{initials}</span><div><h2>{user.name}</h2><p>{user.email}</p></div></article>
   <article className="student-details-card"><button className="edit-profile-button" onClick={()=>setEditing(true)}>Edit profile</button><Info l="Full name" v={user.name}/><Info l="Email" v={user.email}/><Info l="Course and year" v={user.department||"Not provided"}/><Info l="Email updates" v={user.email_notifications?"Enabled":"Disabled"}/><Info l="Account type" v="Student"/><Info l="Profile status" v="Active FacultyConnect account"/></article>
  </section>
  {editing?<div className="modal-backdrop" onMouseDown={()=>setEditing(false)}><form className="modal profile-edit-modal" role="dialog" aria-modal="true" aria-labelledby="profile-edit-title" onSubmit={submit} onMouseDown={e=>e.stopPropagation()}><button type="button" className="modal-close" onClick={()=>setEditing(false)} aria-label="Close">×</button><span className="avatar student-avatar">{initials}</span><h2 id="profile-edit-title">Edit profile</h2><label className="topic">Full name<input name="full_name" defaultValue={user.name} required/></label><label className="topic">Email<input value={user.email} disabled/></label><label className="topic">Course and year<input name="department" defaultValue={user.department||""} placeholder="For example, BSIT 3-5"/></label><label className="check-row"><input type="checkbox" name="email_notifications" defaultChecked={user.email_notifications}/><span>Send optional appointment emails</span></label><div className="modal-actions"><button type="button" className="outline" onClick={()=>setEditing(false)}>Cancel</button><button className="primary" disabled={saving}>{saving?"Saving…":"Save profile"}</button></div></form></div>:null}
 </>;
}
function Chat({chat,question,setQuestion,ask}:{chat:ChatMessage[];question:string;setQuestion:(s:string)=>void;ask:(e:FormEvent)=>void}){return <><section className="page-head compact"><div><p className="eyebrow">CLIRDEC FAQ PILOT</p><h1>Ask Consult AI</h1><p>Answers use Product Owner or CLIRDEC-approved information. Unsupported and sensitive questions receive a safe referral.</p></div></section><div className="assistant-safety"><span>✓ Approved FAQ knowledge</span><span>✓ English, Filipino, or mixed phrasing</span><span>✓ Safe fallback and staff referral</span></div><section className="chatbot"><div className="chat-head"><span className="ai-mark">✦</span><div><b>Consult AI</b><small>Online · Approved CLIRDEC knowledge base</small></div></div><div className="messages">{chat.map((m,i)=><div key={i} className={`message-wrap ${m.who}`}><p>{m.text}</p>{m.who==="bot"&&m.source&&<small>Source: {m.source}</small>}{m.escalation&&<small className="escalation-note">Staff follow-up recommended</small>}</div>)}</div><div className="prompts"><button onClick={()=>setQuestion("What are CLIRDEC office hours?")}>Office hours</button><button onClick={()=>setQuestion("How do I request a faculty consultation?")}>Request consultation</button><button onClick={()=>setQuestion("Where are sessions held?")}>Session location</button><button onClick={()=>setQuestion("What services are available?")}>CLIRDEC services</button></div><form onSubmit={ask}><input aria-label="Chat question" value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Ask in English, Filipino, or mixed language..."/><button className="primary">Send →</button></form><footer className="chat-source">Answers must be traceable to an approved FAQ, office advisory, service directory, or faculty-maintained schedule.</footer></section></>}
function BookingModal({slot,topic,setTopic,close,confirm,submitting,rescheduling}:{slot:Slot;topic:string;setTopic:(value:string)=>void;close:()=>void;confirm:()=>void;submitting:boolean;rescheduling:boolean}){return <div className="modal-backdrop" onMouseDown={close}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="booking-title" onMouseDown={e=>e.stopPropagation()}><button className="modal-close" onClick={close} aria-label="Close">×</button><p className="eyebrow">{rescheduling?"RESCHEDULE CONSULTATION":"CONSULTATION REQUEST"}</p><h2 id="booking-title">{rescheduling?"Move to this published time":"Request a published time"}</h2><div className="modal-faculty"><span className={`avatar large ${slot.color}`}>{slot.initials}</span><div><h3>{slot.faculty_name}</h3><p>{slot.expertise}</p></div></div><div className="booking-details"><div><span>Preferred date</span><b>{new Date(slot.starts_at).toLocaleDateString([], {weekday:"long",month:"long",day:"numeric"})}</b></div><div><span>Preferred time</span><b>{new Date(slot.starts_at).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}</b></div><div><span>Availability source</span><b>Faculty-maintained schedule</b></div></div><label className="topic">Consultation topic and concern<textarea required value={topic} disabled={rescheduling} onChange={e=>setTopic(e.target.value)} placeholder="Provide enough context for the faculty member to review your request"/></label><button className="primary wide" disabled={submitting} onClick={confirm}>{submitting?"Saving…":rescheduling?"Confirm new time →":"Submit request →"}</button><small className="modal-note">{rescheduling?"The previous request is cancelled only after the new time is reserved successfully.":"Submitting does not confirm an appointment. The faculty member must review and approve the request."}</small></section></div>}
type FView="fhome"|"requests"|"availability"|"fprofile"; type AView="ahome"|"users"|"appointments"|"knowledge"|"reports";
function RoleWorkspace({user,logout}:{user:User;logout:()=>void}) {
 const faculty=user.role==="faculty";
 const [view,setView]=useState<FView|AView>(faculty?"fhome":"ahome");
 const [menu,setMenu]=useState(false);
 const nav:[FView|AView,string,NavIconName][]=faculty
  ? [["fhome","Overview","home"],["requests","Requests","requests"],["availability","Availability","calendar"],["fprofile","Profile","profile"]]
  : [["ahome","Pilot overview","home"],["knowledge","FAQ knowledge base","assistant"],["users","Users and roles","users"],["appointments","Consultation logs","calendar"],["reports","Pilot QA","report"]];
 const navigate=(target:FView|AView)=>{setView(target);setMenu(false);};
 return <div className="app role-app">
  <header className="topbar">
   <button className="brand-button" onClick={()=>navigate(faculty?"fhome":"ahome")}><BrandLogo/><span><b>CLSU FacultyConnect</b><small>Managed by MISO · CLIRDEC pilot</small></span></button>
   <div className="top-actions">
    <NotificationCenter user={user} onNavigate={(target)=>navigate(target as FView|AView)}/>
    <button className="profile-chip" onClick={()=>navigate(faculty?"fprofile":"users")} aria-label={faculty?"Open my profile":"Open users and roles"}><span>{user.name.split(" ").map(x=>x[0]).join("").slice(0,2)}</span><i><b>{user.name}</b><small>{faculty?"Faculty":"Authorized administrator"}</small></i></button>
    <button className="menu-button" onClick={()=>setMenu(!menu)} aria-label="Toggle menu">☰</button>
   </div>
  </header>
  <aside className={menu?"sidebar open":"sidebar"}>
   <div><p className="side-kicker">{faculty?"FACULTY PORTAL":"AUTHORIZED CONTENT ADMIN"}</p><nav>{nav.map(([v,l,i])=><Nav key={v} active={view===v} label={l} icon={i} onClick={()=>navigate(v)}/>)}</nav></div>
   <div className="side-foot"><span>Central Luzon State University</span><small>Role-restricted controlled pilot</small><button onClick={logout}>Sign out</button></div>
  </aside>
  <main className="content">{faculty?<FacultyPages view={view as FView} user={user}/>:<AdminPages view={view as AView} user={user}/>}</main>
 </div>;
}
function Head({label,title,copy}:{label:string;title:string;copy:string;action?:string}){return <section className="page-head portal-head"><div><p className="eyebrow">{label}</p><h1>{title}</h1><p>{copy}</p></div></section>}
function Stats({data}:{data:string[][]}){return <div className="metrics">{data.map(x=><article key={x[1]}><b>{x[0]}</b><span>{x[1]}</span></article>)}</div>}
function WeekdayAvailabilityCalendar({weekStart,setWeekStart,selectedStart,setSelectedStart,duration,slots}:{weekStart:string;setWeekStart:(dateKey:string)=>void;selectedStart:Date|null;setSelectedStart:(date:Date)=>void;duration:number;slots:FacultyAvailability[]}){
 const days=weekDays(weekStart);
 const times=calendarTimes();
 const firstWeek=initialCalendarWeek();
 const now=new Date();
 const selectedTime=selectedStart?.getTime();
 const range=`${formatCalendarDay(days[0],{month:"short",day:"numeric"})} – ${formatCalendarDay(days[4],{month:"short",day:"numeric",year:"numeric"})}`;
 return <div className="weekly-calendar">
  <div className="calendar-toolbar">
   <div><p className="eyebrow">MONDAY–FRIDAY</p><h3>{range}</h3></div>
   <div className="week-controls"><button type="button" className="outline" disabled={weekStart<=firstWeek} onClick={()=>setWeekStart(addCalendarDays(weekStart,-7))} aria-label="Previous week">←</button><button type="button" className="outline" onClick={()=>setWeekStart(addCalendarDays(weekStart,7))} aria-label="Next week">→</button></div>
  </div>
  <div className="calendar-scroll" tabIndex={0} aria-label="Weekday availability calendar">
   <div className="availability-grid">
    <span className="calendar-corner">Time</span>
    {days.map(day=><span className="calendar-day" key={day}><b>{formatCalendarDay(day,{weekday:"short"})}</b><small>{formatCalendarDay(day,{month:"short",day:"numeric"})}</small></span>)}
    {times.map(minutes=><div className="calendar-row" key={minutes}>
     <b className="calendar-time">{formatTime(minutes)}</b>
     {days.map(day=>{
      const start=manilaInstant(day,minutes);
      const end=new Date(start.getTime()+duration*60_000);
      const cellEnd=new Date(start.getTime()+30*60_000);
      const conflict=overlapsExisting(start,cellEnd,slots);
      const reason=availabilityValidationMessage(start,end,slots,now);
      const selected=selectedTime===start.getTime();
      const state=conflict?"Published":reason?"Unavailable":selected?"Selected":"Available";
      return <button type="button" key={day} className={`slot-toggle${selected?" selected":""}${conflict?" occupied":""}`} disabled={Boolean(reason)} onClick={()=>setSelectedStart(start)} title={reason||`Select ${formatTime(minutes)}`} aria-label={`${formatCalendarDay(day,{weekday:"long",month:"long",day:"numeric"})} at ${formatTime(minutes)} — ${state}`}><span>{conflict?"Busy":selected?"Selected":""}</span></button>;
     })}
    </div>)}
   </div>
  </div>
  <div className="calendar-legend"><span><i className="legend-open"/>Available</span><span><i className="legend-selected"/>Selected</span><span><i className="legend-busy"/>Already published</span></div>
  <p className="availability-foot">Times use Philippine Standard Time. The calendar disables weekends, past times, entries with less than 24 hours’ notice, and overlaps.</p>
 </div>;
}
function FacultyPages({view,user}:{view:FView;user:User}){
 const [requests,setRequests]=useState<FacultyRequest[]>([]);
 const [facultySlots,setFacultySlots]=useState<FacultyAvailability[]>([]);
 const [profile,setProfile]=useState<FacultyProfile>({expertise:[],bio:"",active:true});
 const [loading,setLoading]=useState(configured);
 const [message,setMessage]=useState("");
 const [requestFilter,setRequestFilter]=useState<"pending"|"confirmed"|"completed">("pending");
 const [calendarWeek,setCalendarWeek]=useState(()=>initialCalendarWeek());
 const [selectedStart,setSelectedStart]=useState<Date|null>(null);
 const [duration,setDuration]=useState(30);
 const refresh=async()=>{if(!configured)return;setLoading(true);try{const [data,facultyProfile]=await Promise.all([loadFacultyPortal(user.id),loadFacultyProfile(user.id)]);setRequests(data.requests);setFacultySlots(data.availability);setProfile(facultyProfile);window.dispatchEvent(new Event("facultyconnect:refresh-notifications"));}catch(cause){setMessage(cause instanceof Error?cause.message:"Faculty data could not be loaded.");}finally{setLoading(false);}};
 useEffect(()=>{void refresh();},[user.id]);
 const pending=requests.filter(item=>item.status==="pending");
 const confirmed=requests.filter(item=>item.status==="confirmed");
 const now=new Date();
 const upcomingConfirmed=confirmed.filter(item=>isUpcomingSlot(item,now));
 const upcomingSlots=facultySlots.filter(slot=>isUpcomingSlot(slot,now));
 const decide=async(id:string,status:"confirmed"|"declined")=>{setMessage("");try{await decideFacultyRequest(id,status);setMessage(status==="confirmed"?"Request approved. The student email notification was queued.":"Request declined. The student email notification was queued.");await refresh();}catch(cause){setMessage(cause instanceof Error?cause.message:"The request could not be updated.");}};
 const complete=async(id:string)=>{setMessage("");try{await completeFacultyRequest(id);setMessage("Consultation marked completed.");await refresh();}catch(cause){setMessage(cause instanceof Error?cause.message:"The consultation could not be completed.");}};
 const publish=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const form=new FormData(e.currentTarget);if(!selectedStart){setMessage("Select an available weekday and time from the calendar.");return;}const end=new Date(selectedStart.getTime()+duration*60_000);const validation=availabilityValidationMessage(selectedStart,end,facultySlots);if(validation){setMessage(validation);return;}try{await createFacultyAvailability({facultyId:user.id,startsAt:selectedStart.toISOString(),endsAt:end.toISOString(),location:String(form.get("location")||"").trim(),consultationMode:String(form.get("consultation_mode")) as "in_person"|"online"});e.currentTarget.reset();setSelectedStart(null);setDuration(30);setMessage("Availability published for students.");await refresh();}catch(cause){setMessage(cause instanceof Error?cause.message:"Availability could not be published.");}};
 const removeSlot=async(id:string)=>{try{await removeFacultyAvailability(id);setMessage("Open availability removed.");await refresh();}catch(cause){setMessage(cause instanceof Error?cause.message:"Availability could not be removed.");}};
 const saveProfile=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const form=new FormData(e.currentTarget);try{await updateFacultyProfile({userId:user.id,expertise:String(form.get("expertise")||"").split(","),bio:String(form.get("bio")||"")});setMessage("Faculty profile updated for student search.");await refresh();}catch(cause){setMessage(cause instanceof Error?cause.message:"The faculty profile could not be updated.");}};
 if(loading)return <div className="empty-card">Loading your faculty workspace…</div>;
 const feedback=message&&<div className="notice"><b>✓</b><span>{message}</span><button onClick={()=>setMessage("")}>×</button></div>;
 if(view==="fhome")return <>{feedback}<Head label="FACULTY PORTAL" title={`Welcome, ${user.name}`} copy="Manage your consultation requests and published availability from one place."/><Stats data={[[String(upcomingConfirmed.length),"Upcoming consultations"],[String(pending.length),"Pending requests"],[String(upcomingSlots.filter(slot=>slot.is_open).length),"Open time slots"],[String(requests.filter(item=>item.status==="completed").length),"Completed sessions"]]}/><div className="workspace-grid"><Work title="Upcoming consultations">{upcomingConfirmed.slice(0,4).map(r=><Line key={r.id} a={formatManilaDateTime(new Date(r.starts_at),{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})} b={r.topic} c={r.student_name}/>)}{!upcomingConfirmed.length&&<div className="empty-card">No upcoming confirmed consultations.</div>}</Work><Work title="Published availability">{upcomingSlots.slice(0,5).map(slot=><Line key={slot.id} a={formatManilaDateTime(new Date(slot.starts_at),{weekday:"short"})} b={formatManilaDateTime(new Date(slot.starts_at),{hour:"numeric",minute:"2-digit"})} c={slot.is_open?"Open for requests":"Already requested"}/>)}{!upcomingSlots.length&&<div className="empty-card">No upcoming availability is published.</div>}</Work></div></>;
 if(view==="requests")return <>{feedback}<FacultyRequestWorkspace requests={requests} filter={requestFilter} setFilter={setRequestFilter} decide={decide} complete={complete}/></>;
 if(view==="availability"){
  const selectedEnd=selectedStart?new Date(selectedStart.getTime()+duration*60_000):null;
  const selectionError=selectedStart&&selectedEnd?availabilityValidationMessage(selectedStart,selectedEnd,facultySlots):"";
  return <>{feedback}<Head label="FACULTY PORTAL" title="Manage availability" copy="Choose weekday consultation times from the calendar. Booked and overlapping slots close automatically."/>
   <div className="availability-layout">
    <Work title="Choose a weekday and time"><WeekdayAvailabilityCalendar weekStart={calendarWeek} setWeekStart={setCalendarWeek} selectedStart={selectedStart} setSelectedStart={setSelectedStart} duration={duration} slots={facultySlots}/></Work>
    <div className="availability-side">
     <Work title="Publish selected time"><form className="knowledge-form" onSubmit={publish}>
      <div className={`selected-slot-summary${selectionError?" invalid":""}`}><span>Selected consultation</span>{selectedStart&&selectedEnd?<><b>{formatManilaDateTime(selectedStart,{weekday:"long",month:"long",day:"numeric"})}</b><p>{formatManilaDateTime(selectedStart,{hour:"numeric",minute:"2-digit"})}–{formatManilaDateTime(selectedEnd,{hour:"numeric",minute:"2-digit"})} · Philippine time</p></>:<p>Choose an available cell in the calendar.</p>}{selectionError&&<small>{selectionError}</small>}</div>
      <label>Duration<select name="duration" value={duration} onChange={e=>setDuration(Number(e.target.value))}><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></select></label>
      <label>Mode<select name="consultation_mode" defaultValue="in_person"><option value="in_person">In person</option><option value="online">Online</option></select></label>
      <label>Location or meeting platform<input name="location" required placeholder="CLIRDEC room or approved online platform"/></label>
      <button className="primary" disabled={!selectedStart||Boolean(selectionError)}>Publish availability</button>
     </form></Work>
      <Work title="Published schedule"><div className="published-slots">{upcomingSlots.map(slot=><article className="published-slot" key={slot.id}><div className="published-slot-copy"><div className="published-slot-head"><span className={slot.is_open?"slot-state open":"slot-state requested"}>{slot.is_open?"Open":"Requested"}</span><b>{formatManilaDateTime(new Date(slot.starts_at),{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</b></div><small>{slot.location||"Location provided after approval"}</small></div>{slot.is_open?<button className="published-slot-remove" onClick={()=>void removeSlot(slot.id)}>Remove</button>:<span className="published-slot-lock" aria-label="This time has a consultation request">Reserved</span>}</article>)}{!upcomingSlots.length&&<div className="empty-card">No upcoming availability has been published.</div>}</div></Work>
    </div>
   </div>
  </>;
 }
 return <>{feedback}<Head label="FACULTY PORTAL" title="Faculty profile" copy="Keep your verified expertise current so students can find the appropriate faculty member."/><section className="profile-layout"><article className="profile-summary"><span className="avatar profile-avatar coral">{user.name.split(" ").map(x=>x[0]).join("").slice(0,2)}</span><h2>{user.name}</h2><p>{profile.active?"Active faculty profile":"Profile hidden from students"}</p><small>{user.email}</small></article><article className="profile-details editable-profile"><form className="knowledge-form" onSubmit={saveProfile}><label>Expertise categories<input name="expertise" defaultValue={profile.expertise.join(", ")} placeholder="Software Engineering, Web Development"/></label><label>Faculty bio<textarea name="bio" defaultValue={profile.bio} placeholder="Brief background and consultation areas"/></label><button className="primary">Save faculty profile</button></form><div><Info l="Availability policy" v="Only times you publish are shown to students."/><Info l="Privacy" v="Student concerns are visible only to participants and authorized administrators."/></div></article></section></>;
}
function FacultyRequestWorkspace({requests,filter,setFilter,decide,complete}:{requests:FacultyRequest[];filter:"pending"|"confirmed"|"completed";setFilter:(value:"pending"|"confirmed"|"completed")=>void;decide:(id:string,status:"confirmed"|"declined")=>Promise<void>;complete:(id:string)=>Promise<void>}){
 const counts={pending:requests.filter(item=>item.status==="pending").length,confirmed:requests.filter(item=>item.status==="confirmed").length,completed:requests.filter(item=>item.status==="completed").length};
 const visible=requests.filter(item=>item.status===filter);
 const labels:{value:"pending"|"confirmed"|"completed";label:string}[]=[{value:"pending",label:"Pending"},{value:"confirmed",label:"Approved"},{value:"completed",label:"Completed"}];
 return <>
  <Head label="FACULTY PORTAL" title="Appointment requests" copy="Review pending concerns, then track confirmed consultations through completion."/>
  <div className="filter-tabs" aria-label="Request status filters">{labels.map(item=><button type="button" key={item.value} className={filter===item.value?"active":""} aria-pressed={filter===item.value} onClick={()=>setFilter(item.value)}>{item.label} {counts[item.value]}</button>)}</div>
  <div className="request-list">{visible.map(request=><article key={request.id}>
   <div className="request-main"><span className="avatar mint">{request.student_name.split(" ").map(part=>part[0]).join("").slice(0,2)}</span><div><span className={`status ${request.status}`}>{request.status.toUpperCase()}</span><h3>{request.topic}</h3><p>{request.student_name}{request.status!=="pending"&&` · ${request.location}`}</p></div><b className="request-time">{formatManilaDateTime(new Date(request.starts_at),{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</b></div>
   {request.status==="pending"&&<><div className="student-note"><span>Student note</span><p>{request.notes}</p></div><div className="request-actions"><button className="outline" onClick={()=>void decide(request.id,"declined")}>Decline + email</button><button className="primary" onClick={()=>void decide(request.id,"confirmed")}>Accept + email ✓</button></div></>}
   {request.status==="confirmed"&&<div className="request-actions"><button className="primary" disabled={new Date(request.ends_at)>new Date()} onClick={()=>void complete(request.id)}>Mark completed</button></div>}
  </article>)}{!visible.length&&<div className="empty-card">There are no {filter} consultation requests.</div>}</div>
 </>;
}

function AdminPages({view,user}:{view:AView;user:User}){
 const [data,setData]=useState<AdminPortal>({users:[],appointments:[],faqs:[]});
 const [loading,setLoading]=useState(true);const [message,setMessage]=useState("");const [query,setQuery]=useState("");
 const [appointmentFilter,setAppointmentFilter]=useState<"all"|AppointmentStatus>("all");
 const refresh=async()=>{setLoading(true);try{setData(await loadAdminPortal());window.dispatchEvent(new Event("facultyconnect:refresh-notifications"));}catch(cause){setMessage(cause instanceof Error?cause.message:"Administration data could not be loaded.");}finally{setLoading(false);}};
 useEffect(()=>{void refresh();},[]);
 const changeRole=async(id:string,role:Role)=>{try{await adminSetRole(id,role);setMessage("User role updated and recorded in the audit log.");await refresh();}catch(cause){setMessage(cause instanceof Error?cause.message:"The role could not be changed.");}};
 const saveFaq=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const form=new FormData(e.currentTarget);try{await createFaqEntry({userId:user.id,question:String(form.get("question")||""),answer:String(form.get("answer")||""),sourceReference:String(form.get("source")||""),category:String(form.get("category")||"")});e.currentTarget.reset();setMessage("FAQ saved as a draft for approval.");await refresh();}catch(cause){setMessage(cause instanceof Error?cause.message:"The FAQ draft could not be saved.");}};
 const approve=async(id:string)=>{try{await approveFaqEntry(id,user.id);setMessage("FAQ approved and available to the spaCy service.");await refresh();}catch(cause){setMessage(cause instanceof Error?cause.message:"The FAQ could not be approved.");}};
 const archive=async(id:string)=>{try{await archiveFaqEntry(id);setMessage("FAQ archived and removed from chatbot answers.");await refresh();}catch(cause){setMessage(cause instanceof Error?cause.message:"The FAQ could not be archived.");}};
 if(loading)return <div className="empty-card">Loading the administration workspace…</div>;
 const feedback=message&&<div className="notice"><b>✓</b><span>{message}</span><button onClick={()=>setMessage("")}>×</button></div>;
 const pending=data.appointments.filter(item=>item.status==="pending").length;
 const confirmed=data.appointments.filter(item=>item.status==="confirmed").length;
 const completed=data.appointments.filter(item=>item.status==="completed").length;
 const filteredUsers=data.users.filter(item=>(item.full_name+" "+item.department+" "+item.role).toLowerCase().includes(query.toLowerCase()));
 const filteredAppointments=appointmentFilter==="all"?data.appointments:data.appointments.filter(item=>item.status===appointmentFilter);
 const todayKey=manilaDateKey(new Date());
 const todaysAppointments=data.appointments.filter(item=>item.status==="confirmed"&&manilaDateKey(new Date(item.starts_at))===todayKey);
 const activeAppointments=data.appointments.filter(item=>item.status==="pending"||item.status==="confirmed");
 const doubleBookings=Math.max(0,activeAppointments.length-new Set(activeAppointments.map(item=>item.availability_id)).size);
 if(view==="ahome")return <>{feedback}<Head label="MISO ADMINISTRATION" title="Pilot Overview" copy="Monitor the CLIRDEC pilot before university-wide expansion."/><Stats data={[[String(data.users.length),"Registered users"],[String(data.appointments.length),"Consultations"],[String(pending),"Pending requests"],[String(doubleBookings),"Active double bookings"]]}/><div className="workspace-grid"><Work title="Today's appointments">{todaysAppointments.slice(0,6).map(item=><Line key={item.id} a={formatManilaDateTime(new Date(item.starts_at),{hour:"numeric",minute:"2-digit"})} b={item.topic} c={item.student_name}/>)}{!todaysAppointments.length&&<div className="empty-card">No confirmed consultations today.</div>}</Work><Work title="Pilot totals"><Line a="Now" b="Pilot data refreshed" c="Live Supabase records"/><Line a={String(data.faqs.filter(item=>item.status==="approved").length)} b="Approved FAQ entries" c="Available to students"/><Line a={String(completed)} b="Completed consultations" c="Pilot records"/></Work></div></>;
 if(view==="users")return <>{feedback}<Head label="MISO ADMINISTRATION" title="Manage users" copy="Faculty and administrator access is assigned only here and every change is audited." action="Add user"/><div className="search-box compact-search"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by name or CLSU ID"/></div><Data headings={["User","Department","Role","Status","Action"]}>{filteredUsers.map(item=><div className="data-row" key={item.id}><span data-label="User"><b>{item.full_name}</b><small>{item.id.slice(0,8)}</small></span><span data-label="Department">{item.department||"Not set"}</span><span data-label="Role"><select className="role-select" value={item.role} disabled={item.id===user.id} onChange={e=>void changeRole(item.id,e.target.value as Role)}><option value="student">Student</option><option value="faculty">Faculty</option><option value="admin">Administrator</option></select></span><span data-label="Status"><i className="active-pill">Active</i></span><span data-label="Action"><small>{item.id===user.id?"Current account":"Audited change"}</small></span></div>)}</Data></>;
 if(view==="appointments")return <>{feedback}<Head label="MISO ADMINISTRATION" title="Manage appointments" copy="Monitor schedules and investigate pilot exceptions."/><div className="filter-tabs" aria-label="Appointment status filters"><button type="button" className={appointmentFilter==="all"?"active":""} aria-pressed={appointmentFilter==="all"} onClick={()=>setAppointmentFilter("all")}>All {data.appointments.length}</button><button type="button" className={appointmentFilter==="confirmed"?"active":""} aria-pressed={appointmentFilter==="confirmed"} onClick={()=>setAppointmentFilter("confirmed")}>Confirmed {confirmed}</button><button type="button" className={appointmentFilter==="pending"?"active":""} aria-pressed={appointmentFilter==="pending"} onClick={()=>setAppointmentFilter("pending")}>Pending {pending}</button><button type="button" className={appointmentFilter==="cancelled"?"active":""} aria-pressed={appointmentFilter==="cancelled"} onClick={()=>setAppointmentFilter("cancelled")}>Cancelled {data.appointments.filter(item=>item.status==="cancelled").length}</button></div><Data headings={["Consultation","Participants","Date and time","Status"]} cls="appointment-row">{filteredAppointments.map(item=><div className="data-row appointment-row" key={item.id}><span data-label="Consultation"><b>{item.topic}</b><small>{item.consultation_mode==="online"?"Online":"In person"}</small></span><span data-label="Participants">{item.student_name}<small>{item.faculty_name}</small></span><span data-label="Date and time">{formatManilaDateTime(new Date(item.starts_at),{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</span><span data-label="Status"><i className={item.status==="pending"?"pending-pill":"active-pill"}>{statusLabel(item.status)}</i></span></div>)}</Data></>;
 if(view==="knowledge")return <>{feedback}<Head label="MISO ADMINISTRATION" title="FAQ knowledge base" copy="Only approved CLIRDEC information may be published to the NLP assistant." action="Add draft entry"/><div className="knowledge-layout"><Work title="Draft an answer"><form className="knowledge-form" onSubmit={saveFaq}><label>Student question<input name="question" required placeholder="Enter a frequently asked question"/></label><label>Approved source<input name="source" required placeholder="Official page, advisory, procedure, or faculty schedule"/></label><label>Proposed answer<textarea name="answer" required placeholder="Write the verified response"/></label><label>Category<select name="category"><option>Office hours and contacts</option><option>Consultation procedure</option><option>Faculty availability</option><option>CLIRDEC services</option></select></label><button className="primary">Save as draft entry</button></form></Work><Work title="Knowledge review queue"><div className="faq-list">{data.faqs.map((faq:FaqEntry)=><article key={faq.id}><span>{faq.status}</span><div><b>{faq.question}</b><small>{faq.source_reference}</small></div><div className="faq-actions">{faq.status!=="approved"&&faq.status!=="archived"&&<button onClick={()=>void approve(faq.id)}>Approve</button>}{faq.status!=="archived"&&<button onClick={()=>void archive(faq.id)}>Archive</button>}</div></article>)}{!data.faqs.length&&<div className="empty-card">No FAQ entries yet.</div>}</div></Work></div></>;
 return <>{feedback}<Head label="MISO ADMINISTRATION" title="QA and user-acceptance testing" copy="Track provisional thresholds that still require Product Owner confirmation." action="Export QA evidence"/><Stats data={[["80%","FAQ accuracy target"],["≤3s","Response-time target"],["80%","Task completion target"],["4/5","Satisfaction target"]]}/><div className="report-grid"><Work title="Required pilot checks"><div className="qa-list"><p><b>FAQ test set</b><span>Approved questions, supported paraphrases, and official source traceability.</span></p><p><b>Safe fallback</b><span>Clarification, suggested topics, and staff referral for unsupported questions.</span></p><p><b>Role separation</b><span>Student, faculty, and administrator permissions remain distinct.</span></p><p><b>Availability integrity</b><span>Only faculty-approved schedules are shown; no invented confirmed booking.</span></p></div></Work><Work title="Acceptance gate"><div className="qa-list"><p><b>No critical security or privacy defect</b><i>Required</i></p><p><b>No unresolved high-severity error</b><i>Required</i></p><p><b>Representative students and faculty tested</b><i>Pending</i></p><p><b>Product Owner threshold confirmation</b><i>Open question</i></p></div></Work></div></>;
}
function Work({title,children}:{title:string;children:ReactNode}){return <section className="work-card"><div className="card-title"><h2>{title}</h2></div>{children}</section>}
function Line({a,b,c}:{a:string;b:string;c:string}){return <div className="timeline-line"><span>{a}</span><i/><p><b>{b}</b><small>{c}</small></p></div>}
function Info({l,v}:{l:string;v:string}){return <div className="info"><span>{l}</span><p>{v}</p></div>}
function Data({headings,children,cls=""}:{headings:string[];children:ReactNode;cls?:string}){return <section className="data-card"><div className={`data-row data-head ${cls}`}>{headings.map(h=><b key={h}>{h}</b>)}</div>{children}</section>}
export default App;
