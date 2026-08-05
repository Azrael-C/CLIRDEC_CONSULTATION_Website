import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { supabase, configured } from "./supabase";
import {
 createFacultyAvailability,
 decideFacultyRequest,
 loadFacultyPortal,
 removeFacultyAvailability,
 type AppointmentStatus,
 type FacultyAvailability,
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
 manilaInstant,
 overlapsExisting,
 weekDays,
} from "./scheduling";

type Role = "student" | "faculty" | "admin";
type View = "home" | "find" | "schedule" | "assistant";
type User = { id:string; name:string; email:string; role:Role };
type Slot = { id:string; faculty_name:string; initials:string; expertise:string; starts_at:string; ends_at:string; location:string; color:string; appointment_id?:string; status?:AppointmentStatus; topic?:string; notes?:string };

const demoSlots: Slot[] = [
  {id:"1",faculty_name:"Dr. Maria Santos",initials:"MS",expertise:"Software Engineering",starts_at:"2026-08-05T09:00",ends_at:"2026-08-05T09:30",location:"CLIRDEC Consultation Room",color:"coral"},
  {id:"2",faculty_name:"Prof. Juan Dela Cruz",initials:"JD",expertise:"Data Analytics",starts_at:"2026-08-05T13:00",ends_at:"2026-08-05T13:30",location:"CLIRDEC Consultation Room",color:"blue"},
  {id:"3",faculty_name:"Dr. Ana Reyes",initials:"AR",expertise:"Research Methods",starts_at:"2026-08-06T10:00",ends_at:"2026-08-06T10:30",location:"CLIRDEC Consultation Room",color:"gold"},
  {id:"4",faculty_name:"Prof. Carlo Mendoza",initials:"CM",expertise:"Web Development",starts_at:"2026-08-07T14:00",ends_at:"2026-08-07T14:30",location:"CLIRDEC Consultation Room",color:"mint"}
];

function App(){
 const [user,setUser]=useState<User|null>(null); const [authLoading,setAuthLoading]=useState(configured);
 const [view,setView]=useState<View>("home"); const [slots,setSlots]=useState<Slot[]>(configured?[]:demoSlots);
 const [booked,setBooked]=useState<Slot[]>([]); const [selected,setSelected]=useState<Slot|null>(null); const [bookingTopic,setBookingTopic]=useState("");
 const [notice,setNotice]=useState(""); const [query,setQuery]=useState(""); const [menu,setMenu]=useState(false);
 const [chat,setChat]=useState<{who:"you"|"bot";text:string}[]>([{who:"bot",text:"Hi, Sofia! I use approved CLIRDEC information. Ask about services, office hours, consultation procedures, faculty availability, or official contacts."}]);
 const [question,setQuestion]=useState("");
 useEffect(()=>{
  if(!configured){setAuthLoading(false);return;}
  let active=true;
  const loadUser=async(id:string,email:string)=>{
   const {data:p,error}=await supabase.from("profiles").select("full_name,role").eq("id",id).single();
   if(!active)return;
   if(error){setNotice("Your account exists, but its portal profile could not be loaded.");setUser(null);return;}
   setUser({id,email,name:p.full_name,role:p.role as Role});
  };
  supabase.auth.getSession().then(async({data})=>{
   if(data.session)await loadUser(data.session.user.id,data.session.user.email||"");
   if(active)setAuthLoading(false);
  });
  const {data:listener}=supabase.auth.onAuthStateChange((event,session)=>{
   if(event==="SIGNED_OUT"){setUser(null);setAuthLoading(false);}
   else if(session)void loadUser(session.user.id,session.user.email||"");
  });
  return()=>{active=false;listener.subscription.unsubscribe();};
 },[]);
 useEffect(()=>{
  if(!configured||!user||user.role!=="student")return;
  void loadStudentData(user.id);
 },[user?.id,user?.role]);
 async function loadStudentData(studentId:string){
  const {data:open,error:slotError}=await supabase.from("availability").select("id,faculty_id,starts_at,ends_at,location").eq("is_open",true).order("starts_at");
  if(slotError){setNotice(slotError.message);return;}
  const facultyIds=[...new Set((open||[]).map(x=>x.faculty_id))];
  const [{data:profiles},{data:faculty}]=await Promise.all([
   supabase.from("profiles").select("id,full_name").in("id",facultyIds.length?facultyIds:["00000000-0000-0000-0000-000000000000"]),
   supabase.from("faculty_profiles").select("user_id,expertise").in("user_id",facultyIds.length?facultyIds:["00000000-0000-0000-0000-000000000000"])
  ]);
  const names=new Map((profiles||[]).map(x=>[x.id,x.full_name]));
  const expertise=new Map((faculty||[]).map(x=>[x.user_id,(x.expertise||[]).join(", ")]));
  setSlots((open||[]).map((x,i)=>{const name=names.get(x.faculty_id)||"Faculty member";return{id:x.id,faculty_name:name,initials:name.split(" ").map((n:string)=>n[0]).join("").slice(0,2),expertise:expertise.get(x.faculty_id)||"General consultation",starts_at:x.starts_at,ends_at:x.ends_at,location:x.location||"Location provided after approval",color:["coral","blue","gold","mint"][i%4]};}));
  const {data:appointments,error:appointmentError}=await supabase.from("appointments").select("id,availability_id,topic,notes,status,availability:availability_id(id,faculty_id,starts_at,ends_at,location)").eq("student_id",studentId).order("created_at",{ascending:false});
  if(appointmentError){setNotice(appointmentError.message);return;}
  const relatedFacultyIds=[...new Set((appointments||[]).map((x:any)=>{const a=Array.isArray(x.availability)?x.availability[0]:x.availability;return a?.faculty_id;}).filter(Boolean))] as string[];
  const missingFacultyIds=relatedFacultyIds.filter(id=>!names.has(id));
  if(missingFacultyIds.length){
   const [{data:relatedProfiles},{data:relatedFaculty}]=await Promise.all([
    supabase.from("profiles").select("id,full_name").in("id",missingFacultyIds),
    supabase.from("faculty_profiles").select("user_id,expertise").in("user_id",missingFacultyIds)
   ]);
   (relatedProfiles||[]).forEach(x=>names.set(x.id,x.full_name));
   (relatedFaculty||[]).forEach(x=>expertise.set(x.user_id,(x.expertise||[]).join(", ")));
  }
  const related=(appointments||[]).map((x:any)=>{const a=Array.isArray(x.availability)?x.availability[0]:x.availability;const name=names.get(a?.faculty_id)||"Faculty member";return{id:a?.id||x.availability_id,appointment_id:x.id,faculty_name:name,initials:name.split(" ").map((n:string)=>n[0]).join("").slice(0,2),expertise:expertise.get(a?.faculty_id)||"Consultation",starts_at:a?.starts_at,ends_at:a?.ends_at,location:a?.location||"Pending confirmation",color:"mint",status:x.status as AppointmentStatus,topic:x.topic,notes:x.notes};});
  setBooked(related);
 }
 const filtered=useMemo(()=>slots.filter(s=>(s.faculty_name+" "+s.expertise).toLowerCase().includes(query.toLowerCase())),[slots,query]);
 async function login(e:FormEvent<HTMLFormElement>){e.preventDefault();setNotice("");if(!configured){setNotice("The production database is not configured yet. Add the Supabase environment variables in Vercel.");return;}const f=new FormData(e.currentTarget);const email=String(f.get("email"));const password=String(f.get("password"));const {error}=await supabase.auth.signInWithPassword({email,password});if(error)setNotice(error.message);}
 async function signup(e:FormEvent<HTMLFormElement>){e.preventDefault();setNotice("");if(!configured){setNotice("The production database is not configured yet. Add the Supabase environment variables in Vercel.");return;}const f=new FormData(e.currentTarget);const full_name=String(f.get("full_name"));const email=String(f.get("email"));const password=String(f.get("password"));const {data,error}=await supabase.auth.signUp({email,password,options:{data:{full_name}}});if(error){setNotice(error.message);return;}setNotice(data.session?"Student account created.":"Check your email to confirm your student account, then sign in.");}
 async function logout(){if(configured)await supabase.auth.signOut();setUser(null);setView("home");}
 async function confirmBook(){if(!user||!selected)return; const slot=selected;const topic=bookingTopic.trim();if(!topic){setNotice("Please describe the consultation topic before submitting the request.");return;} if(configured){const {error}=await supabase.from("appointments").insert({student_id:user.id,availability_id:slot.id,topic,notes:topic,status:"pending"});if(error){setNotice(error.message);return;}await loadStudentData(user.id);}else setBooked(b=>[{...slot,status:"pending",topic},...b.filter(x=>x.id!==slot.id)]);setSelected(null);setBookingTopic("");setNotice(`Request sent to ${slot.faculty_name}. An email receipt will be sent to ${user.email}; approval requires a separate faculty email.`);setView("schedule");}
 async function ask(e:FormEvent){e.preventDefault();const q=question.trim();if(!q)return;setQuestion("");setChat(c=>[...c,{who:"you",text:q}]);if(!configured){const s=q.toLowerCase();let answer="I’m not confident that I have an approved answer for that. Please choose an FAQ topic or contact authorized CLIRDEC staff for assistance.";if(s.includes("hour")||s.includes("open"))answer="CLIRDEC office hours must come from the current official office advisory. For the pilot, the knowledge-base administrator should publish the approved schedule and contact channel here.";else if(s.includes("consult")||s.includes("request")||s.includes("book"))answer="Open Faculty availability, select a faculty-approved time, describe your concern, and submit a request. The request remains pending until the faculty member approves it.";else if(s.includes("where")||s.includes("location"))answer="The consultation location or online platform is shown in the approved availability details and final faculty confirmation.";else if(s.includes("grade")||s.includes("emergency")||s.includes("complaint"))answer="I can’t answer confidential records, grades, emergencies, complaints, or academic decisions. Please use the appropriate official CLSU or CLIRDEC contact channel.";setTimeout(()=>setChat(c=>[...c,{who:"bot",text:answer}]),350);return;}try{const r=await fetch(`${import.meta.env.VITE_CHATBOT_URL||"http://localhost:8000"}/chat`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:q})});const d=await r.json();setChat(c=>[...c,{who:"bot",text:d.answer}]);}catch{setChat(c=>[...c,{who:"bot",text:"The assistant is temporarily offline. Please use the official CLIRDEC contact channel or try again later."}]);}}
 if(authLoading)return <main className="auth-loading"><p>Loading FacultyConnect…</p></main>;
 if(!user)return <ProductionAuth login={login} signup={signup} notice={notice}/>;
 if(user.role!=="student")return <RoleWorkspace user={user} logout={logout}/>;
 const nav=(next:View)=>{setView(next);setMenu(false);setNotice("");};
 return <div className="app"><header className="topbar"><button className="brand-button" onClick={()=>nav("home")}><BrandLogo/><span><b>CLSU FacultyConnect</b><small>Managed by MISO · CLIRDEC pilot</small></span></button><div className="top-actions"><button className="icon-button" aria-label="Notifications">♢<span className="dot"/></button><button className="profile-chip"><span>SN</span><i><b>{user.name}</b><small>Student</small></i></button><button className="menu-button" onClick={()=>setMenu(!menu)} aria-label="Toggle menu">☰</button></div></header>
 <aside className={menu?"sidebar open":"sidebar"}><nav><Nav active={view==="home"} label="Overview" icon="home" onClick={()=>nav("home")}/><Nav active={view==="assistant"} label="Ask Consult AI" icon="assistant" onClick={()=>nav("assistant")}/><Nav active={view==="find"} label="Faculty availability" icon="search" onClick={()=>nav("find")}/><Nav active={view==="schedule"} label="My requests" icon="requests" onClick={()=>nav("schedule")}/></nav><div className="side-foot"><span>CLIRDEC</span><small>Controlled pilot · Approved content only</small><button onClick={logout}>Sign out</button></div></aside>
 <main className="content">{notice&&<div className="notice"><b>✓</b><span>{notice}</span><button onClick={()=>setNotice("")}>×</button></div>}
 {view==="home"&&<Dashboard user={user} booked={booked} go={nav}/>} {view==="find"&&<FindFaculty query={query} setQuery={setQuery} slots={filtered} select={setSelected}/>} {view==="schedule"&&<Schedule booked={booked}/>} {view==="assistant"&&<Chat chat={chat} question={question} setQuestion={setQuestion} ask={ask}/>}</main>
 {selected&&<BookingModal slot={selected} topic={bookingTopic} setTopic={setBookingTopic} close={()=>{setSelected(null);setBookingTopic("");}} confirm={confirmBook}/>}</div>;
}

/* Legacy demo authentication retained temporarily for visual reference.
function Auth({role,setRole,login,notice}:{role:Role;setRole:(r:Role)=>void;login:(e:FormEvent<HTMLFormElement>)=>void;notice:string}){return <main className="auth"><section className="auth-story"><div className="public-brand"><span className="brand-mark">C</span> CLSU FacultyConnect</div><div><span className="pilot-label">MISO · CLIRDEC PILOT</span><h1>Approved answers. Clear next steps.</h1><p>Ask common CLIRDEC questions in natural language, view faculty-approved availability, and receive a safe official referral when the assistant cannot answer.</p><ul><li>Product Owner-approved FAQ knowledge</li><li>Clarification and safe staff referral</li><li>Mobile access for students and faculty</li></ul></div><small>Central Luzon State University · Nurturing a Culture of Excellence</small></section><section className="auth-panel"><form className="login" onSubmit={login}><span className="mobile-brand">CLSU FacultyConnect</span><p className="eyebrow">CONTROLLED PILOT</p><h2>Sign in to your portal</h2><p className="muted">Use demo mode to preview each role-restricted workspace.</p><div className="role-tabs">{(["student","faculty","admin"] as Role[]).map(r=><button type="button" className={role===r?"active":""} key={r} onClick={()=>setRole(r)}>{r==="admin"?"Admin":r[0].toUpperCase()+r.slice(1)}</button>)}</div><label>CLSU email address<input name="email" type="email" required defaultValue="sofia@clsu2.edu.ph"/></label><label>Password<input name="password" type="password" required minLength={6} defaultValue="password"/></label><button className="primary">Sign in <span>→</span></button>{!configured&&<small className="demo-note">Demo mode · no account required</small>}{notice&&<p className="error">{notice}</p>}</form></section></main>}
function Auth({role,setRole,login,notice}:{role:Role;setRole:(r:Role)=>void;login:(e:FormEvent<HTMLFormElement>)=>void;notice:string}){return <main className="auth"><section className="auth-story"><div className="public-brand"><span className="brand-mark">C</span> CLSU FacultyConnect</div><div><span className="pilot-label">MISO · CLIRDEC PILOT</span><h1>Approved answers. Clear next steps.</h1><p>Ask common CLIRDEC questions in natural language, view faculty-approved availability, and receive a safe official referral when the assistant cannot answer.</p><ul><li>Product Owner-approved FAQ knowledge</li><li>Clarification and safe staff referral</li><li>Mobile access for students and faculty</li></ul></div><small>Central Luzon State University · Nurturing a Culture of Excellence</small></section><section className="auth-panel"><form className="login" onSubmit={login}><span className="mobile-brand">CLSU FacultyConnect</span><p className="eyebrow">CONTROLLED PILOT</p><h2>Sign in to your portal</h2><p className="muted">Use demo mode to preview each role-restricted workspace.</p><div className="role-tabs">{(["student","faculty","admin"] as Role[]).map(r=><button type="button" className={role===r?"active":""} key={r} onClick={()=>setRole(r)}>{r==="admin"?"Admin":r[0].toUpperCase()+r.slice(1)}</button>)}</div><label>CLSU email address<input name="email" type="email" required defaultValue="sofia@clsu2.edu.ph"/></label><label>Password<input name="password" type="password" required minLength={6} defaultValue="password"/></label><button className="primary">Sign in <span>→</span></button>{!configured&&<small className="demo-note">Demo mode · no account required</small>}{notice&&<p className="error">{notice}</p>}</form></section></main>}
*/

function ProductionAuth({login,signup,notice}:{login:(e:FormEvent<HTMLFormElement>)=>void;signup:(e:FormEvent<HTMLFormElement>)=>void;notice:string}){
 const [creating,setCreating]=useState(false);
 return <main className="auth">
  <section className="auth-story">
   <div className="public-brand"><BrandLogo tone="light" size="hero"/><span>CLSU FacultyConnect</span></div>
   <div><span className="pilot-label">MISO · CLIRDEC PILOT</span><h1>Approved answers. Clear next steps.</h1><p>Use your registered email to access faculty consultation services and verified CLIRDEC guidance.</p><ul><li>Role-protected student, faculty, and administrator portals</li><li>Faculty-approved schedules and request decisions</li><li>Email updates for important appointment events</li></ul></div>
   <small>Central Luzon State University · Nurturing a Culture of Excellence</small>
  </section>
  <section className="auth-panel">
   <form className="login" onSubmit={creating?signup:login}>
    <span className="mobile-brand"><BrandLogo/><span>CLSU FacultyConnect</span></span><p className="eyebrow">SECURE PORTAL</p>
    <h2>{creating?"Create a student account":"Sign in to your portal"}</h2>
    <p className="muted">Faculty and administrator roles are assigned only through an authorized administrative process.</p>
    {creating&&<label>Full name<input name="full_name" required autoComplete="name"/></label>}
    <label>Email address<input name="email" type="email" required autoComplete="email"/></label>
    <label>Password<input name="password" type="password" required minLength={8} autoComplete={creating?"new-password":"current-password"}/></label>
    <button className="primary">{creating?"Create student account":"Sign in"} <span>→</span></button>
    <button type="button" className="text-button" onClick={()=>setCreating(x=>!x)}>{creating?"Already registered? Sign in":"New student? Create an account"}</button>
    {!configured&&<small className="demo-note">Backend setup required · Supabase environment variables are not configured.</small>}
    {notice&&<p className="error">{notice}</p>}
   </form>
  </section>
 </main>;
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
function Dashboard({user,booked,go}:{user:User;booked:Slot[];go:(v:View)=>void}){const next=booked[0];return <><section className="page-head"><div><p className="eyebrow">CLIRDEC FAQ PILOT</p><h1>What do you need help with, {user.name.split(" ")[0]}?</h1><p>Start with the approved-information assistant or view faculty-maintained availability.</p></div><button className="primary" onClick={()=>go("assistant")}>Ask Consult AI <span>→</span></button></section><section className="overview-grid"><article className="next-card"><div className="section-label"><span>LATEST CONSULTATION REQUEST</span>{next&&<b>{statusLabel(next.status)}</b>}</div>{next?<><div className="appointment-date"><strong>{new Date(next.starts_at).getDate()}</strong><span>{new Date(next.starts_at).toLocaleDateString([], {month:"short"}).toUpperCase()}<br/>{new Date(next.starts_at).toLocaleDateString([], {weekday:"short"})}</span></div><div className="appointment-main"><span className={`avatar ${next.color}`}>{next.initials}</span><div><h3>{next.topic||next.expertise}</h3><p>{next.faculty_name}</p><small>Requested time: {new Date(next.starts_at).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}</small></div></div><button className="text-button" onClick={()=>go("schedule")}>View request status →</button></>:<div className="empty"><b>No active request</b><p>Availability shown in the portal is faculty-approved, but a request still requires faculty confirmation.</p></div>}</article><article className="quick-card"><span className="section-label">APPROVED GUIDANCE</span><button onClick={()=>go("assistant")}><span className="quick-icon">✦</span><i><b>Ask Consult AI</b><small>FAQs, services, procedures, hours, and contacts</small></i><strong>→</strong></button><button onClick={()=>go("find")}><span className="quick-icon">⌕</span><i><b>View faculty availability</b><small>Use approved categories and published schedules</small></i><strong>→</strong></button></article></section><section className="how"><div className="section-title"><div><p className="eyebrow">SAFE BY DESIGN</p><h2>Approved answer or official referral</h2></div><p>The pilot does not provide unrestricted generative answers.</p></div><div className="steps"><article><b>01</b><span>✦</span><h3>Ask naturally</h3><p>Use English, Filipino, mixed language, or common abbreviations.</p></article><article><b>02</b><span>?</span><h3>Clarify when needed</h3><p>The assistant asks one clarifying question when confidence is low.</p></article><article><b>03</b><span>↗</span><h3>Refer safely</h3><p>Unsupported or sensitive concerns go to an official staff channel.</p></article></div></section></>}
function FindFaculty({query,setQuery,slots,select}:{query:string;setQuery:(s:string)=>void;slots:Slot[];select:(s:Slot)=>void}){return <><section className="page-head compact"><div><p className="eyebrow">APPROVED CONSULTATION GUIDANCE</p><h1>Faculty availability</h1><p>Browse faculty-maintained schedules and approved expertise categories. The system does not automatically assign a faculty member.</p></div></section><div className="search-box"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search an approved category or faculty name"/></div><div className="result-head"><b>{slots.length} published availability entries</b><span>Source: faculty-approved CLIRDEC schedules</span></div><section className="faculty-grid">{slots.map(s=><article className="faculty-card" key={s.id}><div className="faculty-top"><span className={`avatar large ${s.color}`}>{s.initials}</span><div><span className="available">● Faculty-published</span><h3>{s.faculty_name}</h3><p>{s.expertise}</p></div></div><div className="slot-line"><span>Published time</span><b>{new Date(s.starts_at).toLocaleDateString([], {weekday:"short",month:"short",day:"numeric"})} · {new Date(s.starts_at).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}</b></div><button className="primary wide" onClick={()=>select(s)}>Review and request →</button></article>)}</section></>}
function Schedule({booked}:{booked:Slot[]}){return <><section className="page-head compact"><div><p className="eyebrow">CONSULTATION GUIDANCE</p><h1>My requests</h1><p>Requests shown here are not appointments until the faculty member confirms them.</p></div></section><div className="scope-note"><b>Email notifications enabled</b><span>Gmail or the registered CLSU email receives a receipt, faculty decision, schedule change, cancellation, and approved reminder. Full self-service cancellation and rescheduling remain deferred.</span></div><div className="schedule-list">{booked.map(s=><article key={s.appointment_id||s.id}><div className="date-block"><strong>{new Date(s.starts_at).getDate()}</strong><span>{new Date(s.starts_at).toLocaleDateString([], {month:"short"})}</span></div><span className={`avatar ${s.color}`}>{s.initials}</span><div className="schedule-info"><span className={`status ${s.status||"pending"}`}>{statusLabel(s.status).toUpperCase()}</span><h3>{s.topic||s.expertise}</h3><p>{s.faculty_name} · Requested {new Date(s.starts_at).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}</p><small>✉ Email updates enabled · {s.status==="confirmed"?s.location:"Final location follows faculty approval."}</small></div></article>)}{!booked.length&&<div className="empty-card">You have no active consultation requests. Ask Consult AI for the approved procedure or view faculty availability.</div>}</div></>}
function Chat({chat,question,setQuestion,ask}:{chat:{who:"you"|"bot";text:string}[];question:string;setQuestion:(s:string)=>void;ask:(e:FormEvent)=>void}){return <><section className="page-head compact"><div><p className="eyebrow">PRIMARY MVP CAPABILITY</p><h1>Ask Consult AI</h1><p>Answers use Product Owner- or CLIRDEC-approved information. Unsupported and sensitive questions receive a safe referral.</p></div></section><div className="assistant-safety"><span>✓ Approved FAQ knowledge</span><span>✓ English, Filipino, or mixed phrasing</span><span>✓ Safe fallback and staff referral</span></div><section className="chatbot"><div className="chat-head"><span className="ai-mark">✦</span><div><b>Consult AI</b><small>Online · Approved CLIRDEC knowledge base</small></div></div><div className="messages">{chat.map((m,i)=><p key={i} className={m.who}>{m.text}</p>)}</div><div className="prompts"><button onClick={()=>setQuestion("What are CLIRDEC office hours?")}>Office hours</button><button onClick={()=>setQuestion("How do I request a faculty consultation?")}>Request consultation</button><button onClick={()=>setQuestion("Where are sessions held?")}>Session location</button><button onClick={()=>setQuestion("What services are available?")}>CLIRDEC services</button></div><form onSubmit={ask}><input aria-label="Chat question" value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Ask in English, Filipino, or mixed language..."/><button className="primary">Send →</button></form><footer className="chat-source">Answers must be traceable to an approved FAQ, office advisory, service directory, or faculty-maintained schedule.</footer></section></>}
function BookingModal({slot,topic,setTopic,close,confirm}:{slot:Slot;topic:string;setTopic:(value:string)=>void;close:()=>void;confirm:()=>void}){return <div className="modal-backdrop" onMouseDown={close}><section className="modal" onMouseDown={e=>e.stopPropagation()}><button className="modal-close" onClick={close}>×</button><p className="eyebrow">CONSULTATION REQUEST</p><h2>Request a published time</h2><div className="modal-faculty"><span className={`avatar large ${slot.color}`}>{slot.initials}</span><div><h3>{slot.faculty_name}</h3><p>{slot.expertise}</p></div></div><div className="booking-details"><div><span>Preferred date</span><b>{new Date(slot.starts_at).toLocaleDateString([], {weekday:"long",month:"long",day:"numeric"})}</b></div><div><span>Preferred time</span><b>{new Date(slot.starts_at).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}</b></div><div><span>Availability source</span><b>Faculty-maintained schedule</b></div></div><label className="topic">Consultation topic and concern<textarea required value={topic} onChange={e=>setTopic(e.target.value)} placeholder="Provide enough context for the faculty member to review your request"/></label><button className="primary wide" onClick={confirm}>Submit request →</button><small className="modal-note">Submitting does not confirm an appointment. The faculty member must review and approve the request.</small></section></div>}
type FView="fhome"|"requests"|"availability"|"fprofile"; type AView="ahome"|"users"|"appointments"|"knowledge"|"reports";
const requestData=[{name:"Sofia Navarro",topic:"Software testing strategy",course:"COMSCI 3100",time:"Aug 5 · 9:00 AM"},{name:"Marcus Lim",topic:"Database normalization",course:"IT 3210",time:"Aug 6 · 1:00 PM"},{name:"Lea Ramos",topic:"Research methodology",course:"COMSCI 3100",time:"Aug 7 · 10:30 AM"}];
function RoleWorkspace({user,logout}:{user:User;logout:()=>void}){const faculty=user.role==="faculty";const [view,setView]=useState<FView|AView>(faculty?"fhome":"ahome");const [menu,setMenu]=useState(false);const nav:[FView|AView,string,NavIconName][]=faculty?[["fhome","Overview","home"],["requests","Requests","requests"],["availability","Availability","calendar"],["fprofile","Profile","profile"]]:[["ahome","Pilot overview","home"],["knowledge","FAQ knowledge base","assistant"],["users","Users and roles","users"],["appointments","Consultation logs","calendar"],["reports","Pilot QA","report"]];return <div className="app role-app"><header className="topbar"><button className="brand-button" onClick={()=>setView(faculty?"fhome":"ahome")}><BrandLogo/><span><b>CLSU FacultyConnect</b><small>Managed by MISO · CLIRDEC pilot</small></span></button><div className="top-actions"><button className="icon-button" aria-label="Notifications">♢<span className="dot"/></button><button className="profile-chip"><span>{user.name.split(" ").map(x=>x[0]).join("").slice(0,2)}</span><i><b>{user.name}</b><small>{faculty?"Faculty":"Authorized administrator"}</small></i></button><button className="menu-button" onClick={()=>setMenu(!menu)} aria-label="Toggle menu">☰</button></div></header><aside className={menu?"sidebar open":"sidebar"}><div><p className="side-kicker">{faculty?"FACULTY PORTAL":"AUTHORIZED CONTENT ADMIN"}</p><nav>{nav.map(([v,l,i])=><Nav key={v} active={view===v} label={l} icon={i} onClick={()=>{setView(v);setMenu(false)}}/>)}</nav></div><div className="side-foot"><span>Central Luzon State University</span><small>Role-restricted controlled pilot</small><button onClick={logout}>Sign out</button></div></aside><main className="content">{faculty?<FacultyPages view={view as FView} user={user}/>:<AdminPages view={view as AView}/>}</main></div>}
function Head({label,title,copy,action}:{label:string;title:string;copy:string;action?:string}){return <section className="page-head portal-head"><div><p className="eyebrow">{label}</p><h1>{title}</h1><p>{copy}</p></div>{action&&<button className="primary">{action} →</button>}</section>}
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
 const [loading,setLoading]=useState(configured);
 const [message,setMessage]=useState("");
 const [calendarWeek,setCalendarWeek]=useState(()=>initialCalendarWeek());
 const [selectedStart,setSelectedStart]=useState<Date|null>(null);
 const [duration,setDuration]=useState(30);
 const refresh=async()=>{if(!configured)return;setLoading(true);try{const data=await loadFacultyPortal(user.id);setRequests(data.requests);setFacultySlots(data.availability);}catch(cause){setMessage(cause instanceof Error?cause.message:"Faculty data could not be loaded.");}finally{setLoading(false);}};
 useEffect(()=>{void refresh();},[user.id]);
 const pending=requests.filter(item=>item.status==="pending");
 const confirmed=requests.filter(item=>item.status==="confirmed");
 const decide=async(id:string,status:"confirmed"|"declined")=>{setMessage("");try{await decideFacultyRequest(id,status);setMessage(status==="confirmed"?"Request approved. The student email notification was queued.":"Request declined. The student email notification was queued.");await refresh();}catch(cause){setMessage(cause instanceof Error?cause.message:"The request could not be updated.");}};
 const publish=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const form=new FormData(e.currentTarget);if(!selectedStart){setMessage("Select an available weekday and time from the calendar.");return;}const end=new Date(selectedStart.getTime()+duration*60_000);const validation=availabilityValidationMessage(selectedStart,end,facultySlots);if(validation){setMessage(validation);return;}try{await createFacultyAvailability({facultyId:user.id,startsAt:selectedStart.toISOString(),endsAt:end.toISOString(),location:String(form.get("location")||"").trim(),consultationMode:String(form.get("consultation_mode")) as "in_person"|"online"});e.currentTarget.reset();setSelectedStart(null);setDuration(30);setMessage("Availability published for students.");await refresh();}catch(cause){setMessage(cause instanceof Error?cause.message:"Availability could not be published.");}};
 const removeSlot=async(id:string)=>{try{await removeFacultyAvailability(id);setMessage("Open availability removed.");await refresh();}catch(cause){setMessage(cause instanceof Error?cause.message:"Availability could not be removed.");}};
 if(loading)return <div className="empty-card">Loading your faculty workspace…</div>;
 const feedback=message&&<div className="notice"><b>✓</b><span>{message}</span><button onClick={()=>setMessage("")}>×</button></div>;
 if(view==="fhome")return <>{feedback}<Head label="FACULTY PORTAL" title={`Welcome, ${user.name}`} copy="Manage your consultation requests and published availability from one place."/><Stats data={[[String(confirmed.length),"Confirmed consultations"],[String(pending.length),"Pending requests"],[String(facultySlots.filter(slot=>slot.is_open).length),"Open time slots"],[String(requests.filter(item=>item.status==="completed").length),"Completed sessions"]]}/><div className="workspace-grid"><Work title="Upcoming consultations">{confirmed.slice(0,4).map(r=><Line key={r.id} a={new Date(r.starts_at).toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})} b={r.topic} c={r.student_name}/>)}{!confirmed.length&&<div className="empty-card">No confirmed consultations yet.</div>}</Work><Work title="Published availability">{facultySlots.slice(0,5).map(slot=><Line key={slot.id} a={new Date(slot.starts_at).toLocaleDateString([], {weekday:"short"})} b={new Date(slot.starts_at).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})} c={slot.is_open?"Open for requests":"Already requested"}/>)}{!facultySlots.length&&<div className="empty-card">Publish your first consultation time.</div>}</Work></div></>;
 if(view==="requests")return <>{feedback}<Head label="FACULTY PORTAL" title="Appointment requests" copy="Review the student concern before accepting. Every decision queues an email update."/><div className="filter-tabs"><button className="active">Pending {pending.length}</button><button>Approved {confirmed.length}</button><button>Completed {requests.filter(item=>item.status==="completed").length}</button></div><div className="request-list">{pending.map(r=><article key={r.id}><div className="request-main"><span className="avatar mint">{r.student_name.split(" ").map(x=>x[0]).join("").slice(0,2)}</span><div><span className="status pending">PENDING</span><h3>{r.topic}</h3><p>{r.student_name}{r.student_email?` · ${r.student_email}`:""}</p></div><b className="request-time">{new Date(r.starts_at).toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</b></div><div className="student-note"><span>Student note</span><p>{r.notes}</p></div><div className="request-actions"><button className="outline" onClick={()=>void decide(r.id,"declined")}>Decline + email</button><button className="primary" onClick={()=>void decide(r.id,"confirmed")}>Accept + email ✓</button></div></article>)}{!pending.length&&<div className="empty-card">All pending requests have been reviewed.</div>}</div></>;
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
     <Work title="Published schedule"><div className="faq-list published-slots">{facultySlots.map(slot=><article key={slot.id}><span>{slot.is_open?"Open":"Requested"}</span><b>{formatManilaDateTime(new Date(slot.starts_at),{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</b>{slot.is_open?<button onClick={()=>void removeSlot(slot.id)}>Remove</button>:<small>{slot.location}</small>}</article>)}{!facultySlots.length&&<div className="empty-card">No availability has been published.</div>}</div></Work>
    </div>
   </div>
  </>;
 }
 return <>{feedback}<Head label="FACULTY PORTAL" title="Faculty profile" copy="Your verified profile helps students find the appropriate faculty expert."/><section className="profile-layout"><article className="profile-summary"><span className="avatar profile-avatar coral">{user.name.split(" ").map(x=>x[0]).join("").slice(0,2)}</span><h2>{user.name}</h2><p>Faculty member</p></article><article className="profile-details"><Info l="Registered email" v={user.email}/><Info l="Profile source" v="Authorized CLSU FacultyConnect account"/><Info l="Availability policy" v="Only times you publish are shown to students."/><Info l="Privacy" v="Student concerns are visible only to participants and authorized administrators."/></article></section></>;
}
function AdminPages({view}:{view:AView}){const [users,setUsers]=useState([{name:"Sofia Navarro",id:"22-1045",role:"Student",status:"Active"},{name:"Dr. Maria Santos",id:"F-0182",role:"Faculty",status:"Active"},{name:"Marcus Lim",id:"22-1178",role:"Student",status:"Active"},{name:"Prof. Juan Dela Cruz",id:"F-0210",role:"Faculty",status:"Inactive"}]);const [faqs,setFaqs]=useState(["How do I book a consultation?","Where are CLIRDEC sessions held?","Can I cancel an appointment?"]);if(view==="ahome")return <><Head label="MISO ADMINISTRATION" title="Pilot overview" copy="Monitor the CLIRDEC pilot before university-wide expansion." action="Export summary"/><Stats data={[["215","Registered users"],["42","Consultations"],["8","Pending requests"],["0","Double bookings"]]}/><div className="workspace-grid"><Work title="Today’s appointments">{requestData.map(r=><Line key={r.name} a={r.time} b={r.topic} c={r.name}/>)}</Work><Work title="Recent activity"><Line a="10 min ago" b="Availability updated" c="Dr. Maria Santos"/><Line a="24 min ago" b="New consultation booked" c="Sofia Navarro"/><Line a="1 hr ago" b="FAQ entry revised" c="MISO Administrator"/></Work></div></>;
if(view==="users")return <><Head label="MISO ADMINISTRATION" title="Manage users" copy="Review pilot accounts and role assignments." action="Add user"/><div className="search-box compact-search"><span>⌕</span><input placeholder="Search by name or CLSU ID"/></div><Data headings={["User","CLSU ID","Role","Status","Action"]}>{users.map(u=><div className="data-row" key={u.id}><span data-label="User"><b>{u.name}</b></span><span data-label="CLSU ID">{u.id}</span><span data-label="Role">{u.role}</span><span data-label="Status"><i className={u.status==="Active"?"active-pill":"inactive-pill"}>{u.status}</i></span><span data-label="Action"><button className="table-action" onClick={()=>setUsers(x=>x.filter(y=>y.id!==u.id))}>Remove</button></span></div>)}</Data></>;
if(view==="appointments")return <><Head label="MISO ADMINISTRATION" title="Manage appointments" copy="Monitor schedules and investigate pilot exceptions." action="Export list"/><div className="filter-tabs"><button className="active">All 42</button><button>Confirmed 31</button><button>Pending 8</button><button>Cancelled 3</button></div><Data headings={["Consultation","Participants","Date and time","Status"]} cls="appointment-row">{requestData.map((r,i)=><div className="data-row appointment-row" key={r.name}><span data-label="Consultation"><b>{r.topic}</b><small>{r.course}</small></span><span data-label="Participants">{r.name}<small>Dr. Maria Santos</small></span><span data-label="Date and time">{r.time}</span><span data-label="Status"><i className={i===1?"pending-pill":"active-pill"}>{i===1?"Pending":"Confirmed"}</i></span></div>)}</Data></>;
if(view==="knowledge")return <><Head label="AUTHORIZED CONTENT ADMIN" title="FAQ knowledge base" copy="Only approved CLIRDEC information may be published to the NLP assistant." action="Add draft entry"/><div className="scope-note"><b>Approval rule</b><span>New or edited answers remain drafts until the Product Owner or designated CLIRDEC approving officer approves publication. Administrative changes require an audit record.</span></div><div className="knowledge-layout"><Work title="Draft an answer"><div className="knowledge-form"><label>Student question<input placeholder="Enter a frequently asked question"/></label><label>Approved source<input placeholder="Official page, advisory, procedure, or faculty schedule"/></label><label>Proposed answer<textarea placeholder="Write the verified response"/></label><label>Category<select><option>Office hours and contacts</option><option>Consultation procedure</option><option>Faculty availability</option><option>CLIRDEC services</option></select></label><button className="primary">Save as draft</button></div></Work><Work title="Knowledge review queue"><div className="faq-list">{faqs.map((f,i)=><article key={f}><span>{i===0?"Approved":"Review"}</span><b>{f}</b><button onClick={()=>setFaqs(x=>x.filter(y=>y!==f))}>Archive</button></article>)}</div></Work></div></>;
return <><Head label="PILOT ACCEPTANCE" title="QA and user-acceptance testing" copy="Track provisional thresholds that still require Product Owner confirmation." action="Export QA evidence"/><Stats data={[["80%","FAQ accuracy target"],["≤3s","Response-time target"],["80%","Task completion target"],["4/5","Satisfaction target"]]}/><div className="report-grid"><Work title="Required pilot checks"><div className="qa-list"><p><b>FAQ test set</b><span>Approved questions, supported paraphrases, and official source traceability</span></p><p><b>Safe fallback</b><span>Clarification, suggested topics, and staff referral for unsupported questions</span></p><p><b>Role separation</b><span>Student, faculty, and administrator permissions remain distinct</span></p><p><b>Availability integrity</b><span>Only faculty-approved schedules are shown; no invented confirmed booking</span></p></div></Work><Work title="Acceptance gate"><div className="qa-list"><p><b>No critical security or privacy defect</b><i>Required</i></p><p><b>No unresolved high-severity error</b><i>Required</i></p><p><b>Representative students and faculty tested</b><i>Pending</i></p><p><b>Product Owner threshold confirmation</b><i>Open question</i></p></div></Work></div></>}
function Work({title,children}:{title:string;children:ReactNode}){return <section className="work-card"><div className="card-title"><h2>{title}</h2></div>{children}</section>}
function Line({a,b,c}:{a:string;b:string;c:string}){return <div className="timeline-line"><span>{a}</span><i/><p><b>{b}</b><small>{c}</small></p></div>}
function Info({l,v}:{l:string;v:string}){return <div className="info"><span>{l}</span><p>{v}</p></div>}
function Data({headings,children,cls=""}:{headings:string[];children:ReactNode;cls?:string}){return <section className="data-card"><div className={`data-row data-head ${cls}`}>{headings.map(h=><b key={h}>{h}</b>)}</div>{children}</section>}
export default App;
