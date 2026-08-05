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
 manilaInstant,
 overlapsExisting,
 weekDays,
} from "./scheduling";

type Role = "student" | "faculty" | "admin";
type View = "home" | "find" | "schedule" | "assistant";
type User = { id:string; name:string; email:string; role:Role };
type Slot = { id:string; faculty_name:string; initials:string; expertise:string; starts_at:string; ends_at:string; location:string; color:string; appointment_id?:string; status?:AppointmentStatus; topic?:string; notes?:string };
type ChatMessage = { who:"you"|"bot"; text:string; source?:string; escalation?:boolean };

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
 const [reschedulingId,setReschedulingId]=useState<string|null>(null); const [submitting,setSubmitting]=useState(false);
 const [notice,setNotice]=useState(""); const [query,setQuery]=useState(""); const [menu,setMenu]=useState(false);
 const [chat,setChat]=useState<ChatMessage[]>([{who:"bot",text:"Hi! I use approved CLIRDEC information. Ask about services, office hours, consultation procedures, faculty availability, or official contacts."}]);
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
  try{
   const data=await loadStudentPortal(studentId);
   setSlots(data.slots.map((slot,i)=>({id:slot.id,faculty_name:slot.faculty_name,initials:slot.faculty_name.split(" ").map(n=>n[0]).join("").slice(0,2),expertise:slot.expertise.join(", ")||"General consultation",starts_at:slot.starts_at,ends_at:slot.ends_at,location:slot.location,color:["coral","blue","gold","mint"][i%4]})));
   setBooked(data.appointments.map((item)=>({id:item.availability_id,appointment_id:item.id,faculty_name:item.faculty_name,initials:item.faculty_name.split(" ").map(n=>n[0]).join("").slice(0,2),expertise:item.expertise.join(", ")||"Consultation",starts_at:item.starts_at,ends_at:item.ends_at,location:item.location,color:"mint",status:item.status,topic:item.topic,notes:item.notes})));
  }catch(cause){setNotice(cause instanceof Error?cause.message:"Student data could not be loaded.");}
 }
 const filtered=useMemo(()=>slots.filter(s=>(s.faculty_name+" "+s.expertise).toLowerCase().includes(query.toLowerCase())),[slots,query]);
 async function login(e:FormEvent<HTMLFormElement>){e.preventDefault();setNotice("");if(!configured){setNotice("The production database is not configured yet. Add the Supabase environment variables in Vercel.");return;}const f=new FormData(e.currentTarget);const email=String(f.get("email"));const password=String(f.get("password"));const {error}=await supabase.auth.signInWithPassword({email,password});if(error)setNotice(error.message);}
 async function signup(e:FormEvent<HTMLFormElement>){e.preventDefault();setNotice("");if(!configured){setNotice("The production database is not configured yet. Add the Supabase environment variables in Vercel.");return;}const f=new FormData(e.currentTarget);const full_name=String(f.get("full_name"));const email=String(f.get("email"));const password=String(f.get("password"));const {data,error}=await supabase.auth.signUp({email,password,options:{data:{full_name}}});if(error){setNotice(error.message);return;}setNotice(data.session?"Student account created.":"Check your email to confirm your student account, then sign in.");}
 async function logout(){if(configured)await supabase.auth.signOut();setUser(null);setView("home");}
 async function confirmBook(){if(!user||!selected||submitting)return;const slot=selected;const topic=bookingTopic.trim();if(!topic){setNotice("Please describe the consultation topic before submitting the request.");return;}setSubmitting(true);try{if(reschedulingId){await rescheduleAppointment(reschedulingId,slot.id);setNotice(`Your request was moved to ${slot.faculty_name}'s published time and is pending approval.`);}else{await bookAppointment({slotId:slot.id,topic,notes:topic});setNotice(`Request sent to ${slot.faculty_name}. Email updates will be sent to ${user.email}.`);}await loadStudentData(user.id);setSelected(null);setBookingTopic("");setReschedulingId(null);setView("schedule");}catch(cause){setNotice(cause instanceof Error?cause.message:"The request could not be submitted.");}finally{setSubmitting(false);}}
 async function cancelRequest(appointmentId:string){if(!user||submitting)return;setSubmitting(true);try{await cancelAppointment(appointmentId);setNotice("The consultation was cancelled and both participants were queued for an email update.");await loadStudentData(user.id);}catch(cause){setNotice(cause instanceof Error?cause.message:"The request could not be cancelled.");}finally{setSubmitting(false);}}
 function beginReschedule(slot:Slot){if(!slot.appointment_id)return;setReschedulingId(slot.appointment_id);setBookingTopic(slot.topic||"");setView("find");setNotice("Choose a different published time. Your current request remains active until the replacement succeeds.");}
 async function ask(e:FormEvent){e.preventDefault();const q=question.trim();if(!q)return;setQuestion("");setChat(c=>[...c,{who:"you",text:q}]);try{const {data}=await supabase.auth.getSession();const headers:Record<string,string>={"Content-Type":"application/json"};if(data.session?.access_token)headers.Authorization=`Bearer ${data.session.access_token}`;const r=await fetch(`${import.meta.env.VITE_CHATBOT_URL||"http://localhost:8000"}/chat`,{method:"POST",headers,body:JSON.stringify({message:q})});if(!r.ok)throw new Error(`Assistant returned ${r.status}`);const d=await r.json();setChat(c=>[...c,{who:"bot",text:d.answer,source:d.source,escalation:Boolean(d.escalation)}]);}catch{setChat(c=>[...c,{who:"bot",text:"The assistant is temporarily offline. Please use the official CLIRDEC contact channel or try again later.",escalation:true}]);}}
 if(authLoading)return <main className="auth-loading"><p>Loading FacultyConnect…</p></main>;
 if(!user)return <ProductionAuth login={login} signup={signup} notice={notice}/>;
 if(user.role!=="student")return <RoleWorkspace user={user} logout={logout}/>;
 const nav=(next:View)=>{setView(next);setMenu(false);setNotice("");if(next!=="find"){setReschedulingId(null);setBookingTopic("");}};
 return <div className="app"><header className="topbar"><button className="brand-button" onClick={()=>nav("home")}><BrandLogo/><span><b>CLSU FacultyConnect</b><small>Managed by MISO · CLIRDEC pilot</small></span></button><div className="top-actions"><button className="icon-button" aria-label="Notifications">♢<span className="dot"/></button><button className="profile-chip"><span>SN</span><i><b>{user.name}</b><small>Student</small></i></button><button className="menu-button" onClick={()=>setMenu(!menu)} aria-label="Toggle menu">☰</button></div></header>
 <aside className={menu?"sidebar open":"sidebar"}><nav><Nav active={view==="home"} label="Overview" icon="home" onClick={()=>nav("home")}/><Nav active={view==="assistant"} label="Ask Consult AI" icon="assistant" onClick={()=>nav("assistant")}/><Nav active={view==="find"} label="Faculty availability" icon="search" onClick={()=>nav("find")}/><Nav active={view==="schedule"} label="My requests" icon="requests" onClick={()=>nav("schedule")}/></nav><div className="side-foot"><span>CLIRDEC</span><small>Controlled pilot · Approved content only</small><button onClick={logout}>Sign out</button></div></aside>
 <main className="content">{notice&&<div className="notice"><b>✓</b><span>{notice}</span><button onClick={()=>setNotice("")}>×</button></div>}
 {view==="home"&&<Dashboard user={user} booked={booked} go={nav}/>} {view==="find"&&<FindFaculty query={query} setQuery={setQuery} slots={filtered} select={setSelected}/>} {view==="schedule"&&<Schedule booked={booked} cancel={cancelRequest} reschedule={beginReschedule} busy={submitting}/>} {view==="assistant"&&<Chat chat={chat} question={question} setQuestion={setQuestion} ask={ask}/>}</main>
 {selected&&<BookingModal slot={selected} topic={bookingTopic} setTopic={setBookingTopic} close={()=>{setSelected(null);setReschedulingId(null);setBookingTopic("");}} confirm={confirmBook} submitting={submitting} rescheduling={Boolean(reschedulingId)}/>}</div>;
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
    {!configured&&<small cl…41592 tokens truncated…nce,
        )

    if intent in DEFAULT_ANSWERS and intent_confidence >= 0.55:
        answer, source = DEFAULT_ANSWERS[intent]
        return ChatResponse(
            answer=answer,
            intent=intent,
            confidence=intent_confidence,
            escalation=False,
            source=source,
        )

    return ChatResponse(
        answer=(
            "I’m not confident that I have an approved answer for that question. Please rephrase it "
            "as a booking, availability, faculty expertise, location, cancellation, status, or service question. "
            "For anything else, contact authorized CLIRDEC staff."
        ),
        intent="fallback",
        confidence=max(0.15, intent_confidence),
        escalation=True,
        source="Safe fallback and staff-referral rule",
        suggestions=["How do I request a consultation?", "When is a faculty member available?"],
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "nlp": "spaCy", "pipeline": ",".join(nlp.pipe_names)}


@app.get("/knowledge-status", response_model=KnowledgeStatus)
async def knowledge_status(authorization: str | None = Header(default=None)) -> KnowledgeStatus:
    items, source = await _load_approved_knowledge(authorization)
    remaining = max(0, int(_cache[0] - time.monotonic()))
    return KnowledgeStatus(source=source, approved_entries=len(items), cache_seconds_remaining=remaining)


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, authorization: str | None = Header(default=None)) -> ChatResponse:
    knowledge, _ = await _load_approved_knowledge(authorization)
    return build_response(request.message, knowledge)
