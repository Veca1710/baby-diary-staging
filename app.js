
const KEY="babyDiaryMultiBabyV2";
const FAMILY_ID_KEY="babyDiaryFamilyIdV1";
const app=document.getElementById("app");
const toastEl=document.getElementById("toast");

let state=loadState();
let selectedBabyId=localStorage.getItem("babyDiaryCurrentBabyId") || null;
let currentDayId=null;
let currentTab="diary";
let openCardId=null;
let editingEntry=null;
let selectedType="breast";
let supabaseConfig=null;
let remoteReady=false;
let saveTimer=null;
let applyingRemote=false;

const types=[
  {type:"breast",label:"Dojenje",icon:"bottle"},
  {type:"diaper",label:"Pelena",icon:"diaper"},
  {type:"sleep",label:"Spavanje",icon:"sleep"},
  {type:"formula",label:"Dohrana",icon:"bottle"},
  {type:"pump",label:"Izmlazanje",icon:"drop"},
  {type:"supplements",label:"Suplementi",icon:"medicine"},
  {type:"walk",label:"Šetnja",icon:"walk"},
  {type:"note",label:"Ostalo",icon:"note"}
];

function $(s,r=document){return r.querySelector(s)}
function $$(s,r=document){return Array.from(r.querySelectorAll(s))}
function uid(p){return p+"_"+Date.now()+"_"+Math.random().toString(36).slice(2,8)}
function safeParse(v){try{return v?JSON.parse(v):null}catch(e){return null}}

function normalizeMultiBaby(data){
  if(!data || !Array.isArray(data.babies)) return null;
  return {
    ...data,
    version:2,
    ownerName:data.ownerName||data.parentName||"",
    migratedAt:data.migratedAt||null,
    updatedAt:data.updatedAt||null,
    babies:data.babies.map(b=>({
      ...b,
      id:b.id||uid("baby"),
      name:b.name||"Moja beba",
      birthDate:b.birthDate||"",
      avatar:b.avatar||"",
      ownerName:b.ownerName||data.ownerName||"",
      cloud:b.cloud||{},
      reminders:Array.isArray(b.reminders)?b.reminders:[],
      days:Array.isArray(b.days)?b.days:[]
    }))
  };
}

function loadState(){
  const existing=normalizeMultiBaby(safeParse(localStorage.getItem(KEY)));
  return existing || {version:2,babies:[]};
}
function saveState(){
  state.updatedAt=new Date().toISOString();
  localStorage.setItem(KEY,JSON.stringify(state));

  const baby=getBaby();
  const lastEvent=baby?.cloud?.lastEvent;
  const lastEventAt=lastEvent?.at ? new Date(lastEvent.at).getTime() : 0;
  const isFreshSpecificEvent=lastEventAt && (Date.now()-lastEventAt<1200);

  if(getSharedBabyId(baby) && !isFreshSpecificEvent){
    setBabyCloudEvent(baby,"data_changed","Dnevnik je ažuriran");
    queueCloudSave();
  }
}
function getBaby(){
  return (state.babies||[]).find(b=>b.id===selectedBabyId)||null;
}
function getCurrentDay(){
  const b=getBaby();
  if(!b) return null;
  return (b.days||[]).find(d=>d.id===currentDayId)||null;
}

function localISODate(date){
  const y=date.getFullYear();
  const m=String(date.getMonth()+1).padStart(2,"0");
  const d=String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}


function parseLocalDate(dateString){
  const [y,m,d]=String(dateString||today()).split("-").map(Number);
  return new Date(y, (m||1)-1, d||1);
}

function addDaysLocal(dateString, amount){
  const date=parseLocalDate(dateString);
  date.setDate(date.getDate()+amount);
  return localISODate(date);
}

function getOrCreateDayByDate(dateString){
  const baby=getBaby();
  if(!baby) return null;
  baby.days=Array.isArray(baby.days)?baby.days:[];
  let day=baby.days.find(d=>d.date===dateString);
  if(!day){
    day={id:uid("day"),date:dateString,updatedAt:new Date().toISOString(),notes:[]};
    baby.days.push(day);
    saveState();
  }
  return day;
}

function switchDayByOffset(offset){
  const current=getCurrentDay() || ensureDay();
  const baseDate=current?.date || today();
  const targetDate=addDaysLocal(baseDate, offset);
  const targetDay=getOrCreateDayByDate(targetDate);
  if(!targetDay) return;
  currentDayId=targetDay.id;
  openCardId=null;
  document.getElementById("floatingReminder")?.remove();
  renderDiary();
}

function today(){return localISODate(new Date())}
function ensureDay(){
  const b=getBaby();
  if(!b) return null;
  b.days=Array.isArray(b.days)?b.days:[];
  if(currentDayId && b.days.some(d=>d.id===currentDayId)) return getCurrentDay();
  let d=b.days.find(x=>x.date===today());
  if(!d){
    d={id:uid("day"),date:today(),updatedAt:new Date().toISOString(),notes:[]};
    b.days.unshift(d);
    saveState();
  }
  currentDayId=d.id;
  return d;
}

function fmt(date){
  if(!date) return "";
  const d=new Date(date+"T00:00:00");
  const m=["januar","februar","mart","april","maj","jun","jul","avgust","septembar","oktobar","novembar","decembar"];
  return d.getDate()+". "+m[d.getMonth()];
}
function fmtFull(date){
  if(!date) return "";
  const d=new Date(date+"T00:00:00");
  const m=["januar","februar","mart","april","maj","jun","jul","avgust","septembar","oktobar","novembar","decembar"];
  return d.getDate()+". "+m[d.getMonth()]+" "+d.getFullYear()+".";
}
function babyAge(birth){
  if(!birth) return "";
  const s=new Date(birth+"T00:00:00"), n=new Date();
  const diff=Math.floor((new Date(n.getFullYear(),n.getMonth(),n.getDate())-s)/86400000);
  if(diff<0) return "";
  if(diff===0) return "rođena danas";
  if(diff===1) return "1 dan";
  if(diff<31) return diff+" dana";
  const weeks=Math.floor(diff/7);
  if(weeks<9) return weeks+" nedelja";
  return Math.floor(diff/30)+" meseci";
}
function babyDay(date,birth){
  if(!date||!birth) return "";
  const d=new Date(date+"T00:00:00"), b=new Date(birth+"T00:00:00");
  const diff=Math.floor((d-b)/86400000)+1;
  return Number.isFinite(diff)&&diff>0 ? diff+". dan" : "";
}
function timeMin(t){
  if(!t) return null;
  const [h,m]=String(t).split(":").map(Number);
  if(Number.isNaN(h)||Number.isNaN(m)) return null;
  return h*60+m;
}
function invalidRange(from,to){
  if(!from||!to) return false;
  const f=timeMin(from), t=timeMin(to);
  return f!==null&&t!==null&&t<=f;
}
function duration(from,to){
  const f=timeMin(from), t=timeMin(to);
  if(f===null||t===null||t<=f) return "";
  const d=t-f, h=Math.floor(d/60), m=d%60;
  if(h&&m) return `${h}h ${m}m`;
  if(h) return `${h}h`;
  return `${m} min`;
}
function sleepTxt(v){
  return Math.floor(v/60)+"h "+String(v%60).padStart(2,"0")+"m";
}
function nowTime(){
  const d=new Date();
  return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
}
function icon(name){
  const icons={
    down:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>`,
    calendar:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 2h2v2h6V2h2v2h3c1.1 0 2 .9 2 2v14c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2L2.01 6C2.01 4.9 2.9 4 4 4h3V2Zm13 8H4v10h16V10Z"/></svg>`,
    left:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>`,
    right:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="m8.59 16.59 1.41 1.41 6-6-6-6-1.41 1.41L13.17 12z"/></svg>`,
    list:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 5h16v2H4V5Zm0 6h16v2H4v-2Zm0 6h16v2H4v-2Z"/></svg>`,
    chart:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 9h3v10H5V9Zm5-4h3v14h-3V5Zm5 7h3v7h-3v-7Z"/></svg>`,
    plus:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2Z"/></svg>`,
    edit:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"></path><path d="M20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"></path></svg>`,
    trash:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6zM8 4l1-1h6l1 1h4v2H4V4z"/></svg>`,
    bottle:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 2h8v2h-1v3l3 4v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-9l3-4V4H8zm3 2v4l-3 4v2h8v-2l-3-4V4z"/></svg>`,
    diaper:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 5h14v5c0 5-3 9-7 9s-7-4-7-9zm2 2v3c0 3.9 2.1 7 5 7s5-3.1 5-7V7z"/></svg>`,
    sleep:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.1 2.1a9.9 9.9 0 1 0 9.8 12.1A8 8 0 0 1 12.1 2.1z"/></svg>`,
    drop:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8 6.2 6 9.3 6 13a6 6 0 0 0 12 0c0-3.7-2-6.8-6-11z"/></svg>`,
    medicine:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 2h4v4h-4V2Zm-1 6h6l2 3v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9l2-3Zm2 5v2H9v2h2v2h2v-2h2v-2h-2v-2h-2Z"/></svg>`,
    walk:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 5.5A2.5 2.5 0 1 1 8.5 5.5a2.5 2.5 0 0 1 5 0ZM10 9h3l2 4h3v2h-4.2l-1.1-2.2-1.2 3.2 2.5 2.5-1.4 1.4-3.3-3.3 1.5-4.1-2 .8V17H7v-5l3-1.3V9Z"/></svg>`,
    settings:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.11-1.65-2-3.46-2.49 1a7.28 7.28 0 0 0-1.69-.98L15 3h-4l-.36 2.93c-.6.23-1.17.56-1.69.98l-2.49-1-2 3.46 2.11 1.65c-.04.32-.07.65-.07.98s.02.66.07.98l-2.11 1.65 2 3.46 2.49-1c.52.4 1.08.73 1.69.98L11 21h4l.36-2.93c.6-.23 1.17-.56 1.69-.98l2.49 1 2-3.46-2.11-1.65ZM13 15.5A3.5 3.5 0 1 1 13 8a3.5 3.5 0 0 1 0 7.5Z"/></svg>`,
    share:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7a3.27 3.27 0 0 0 0-1.39l7.05-4.11A2.99 2.99 0 1 0 15 5c0 .23.03.45.08.66L8.03 9.77a3 3 0 1 0 0 4.46l7.12 4.18c-.05.19-.08.39-.08.59a2.93 2.93 0 1 0 2.93-2.92Z"/></svg>`,
    profile:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z"/></svg>`,
    note:`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 3h12l4 4v14H4V3zm11 1.5V8h3.5zM7 11h10v2H7zm0 4h10v2H7z"/></svg>`
  };
  return icons[name]||icons.note;
}
function typeDef(type){
  return types.find(t=>t.type===type)||types[types.length-1];
}
function activityToEntry(note, activity, ni, ai){
  let type=activity.type||"note";
  let data={...activity};
  if(["pee","poop","bath"].includes(type)){
    data={type:"diaper",pee:type==="pee"||activity.pee,poop:type==="poop"||activity.poop,changed:activity.changed||false,note:activity.note||""};
    type="diaper";
  }
  return {id:`${note.id||ni}_${ai}`,note,noteIndex:ni,activity:data,activityIndex:ai,type};
}
function entriesOf(day=getCurrentDay()){
  if(!day) return [];
  const entries=[];
  (day.notes||[]).forEach((note,ni)=>{
    (note.activities||[]).forEach((act,ai)=>entries.push(activityToEntry(note,act,ni,ai)));
  });
  return entries.sort((a,b)=>{
    const av=timeMin(a.note.from)??99999, bv=timeMin(b.note.from)??99999;
    return av-bv || a.noteIndex-b.noteIndex || a.activityIndex-b.activityIndex;
  });
}

function hasDurationActivity(type){
  return ["breast","sleep","walk"].includes(type);
}

function instantActivityLabel(type){
  if(["diaper","supplements","formula","pump","note"].includes(type)) return "Vreme";
  return "Početak";
}

function preview(entry){
  const a=entry.activity;
  if(entry.type==="breast"){
    return [a.left?"Leva":null,a.right?"Desna":null].filter(Boolean).join(" • ") || "Dojenje";
  }
  if(entry.type==="formula"||entry.type==="pump") return `${a.ml||a.amount_ml||0} ml`;
  if(entry.type==="sleep") return duration(entry.note.from,entry.note.to)||"Trajanje nije uneto";
  if(entry.type==="diaper"){
    return [a.pee?"Piškio":null,a.poop?"Kakio":null,a.changed?"Zamenjena":null].filter(Boolean).join(" • ") || "Pelena";
  }
  if(entry.type==="supplements"){
    return [a.name||"Suplement", a.amount||null].filter(Boolean).join(" • ");
  }
  if(entry.type==="walk"){
    return duration(entry.note.from,entry.note.to)||"Šetnja";
  }
  return a.text||a.note||"Napomena";
}
function entryNote(entry){return entry.activity.note||entry.activity.textNote||""}
function summaryOf(day){
  const s={notes:(day?.notes||[]).length,breast:0,pump:0,formula:0,sleep:0,pee:0,poop:0,bath:0,vitamin:0,walk:0,supplements:0};
  (day?.notes||[]).forEach(n=>(n.activities||[]).forEach(a=>{
    if(a.type==="breast"){if(a.left)s.breast+=.5;if(a.right)s.breast+=.5}
    if(a.type==="pump")s.pump+=Number(a.ml||0);
    if(a.type==="formula")s.formula+=Number(a.ml||0);
    if(a.type==="pee")s.pee++;
    if(a.type==="poop")s.poop++;
    if(a.type==="diaper"){if(a.pee)s.pee++; if(a.poop)s.poop++;}
    if(a.type==="walk")s.walk++;
    if(a.type==="supplements")s.supplements++;
    if(a.type==="sleep"){
      const f=timeMin(n.from),t=timeMin(n.to);
      if(f!==null&&t!==null&&t>f)s.sleep+=t-f;
    }
  }));
  return s;
}
function toast(msg){
  if(!toastEl){ alert(msg); return; }
  toastEl.textContent=msg;
  toastEl.classList.add("show");
  setTimeout(()=>toastEl.classList.remove("show"),1600);
}

/* screens */
function render(){
  if(!state.babies.length) return renderOnboarding();
  if(!selectedBabyId || !getBaby()) {
    selectedBabyId=state.babies[0].id;
    localStorage.setItem("babyDiaryCurrentBabyId",selectedBabyId);
  }
  return renderDiary();
}
function renderOnboarding(){
  app.innerHTML=`<section class="app-shell">
    <div class="hero">
      <div class="hero-illustration">🧸</div>
      <div>
        <h1>Dobrodošli u dnevnik bebe</h1>
        <p>Prati hranjenje, spavanje i dnevne aktivnosti na jednom mestu.</p>
      </div>
    </div>
    <div class="form-card">
      <label class="field"><span>Ime bebe</span><input class="input" id="babyName" placeholder="Unesi ime"></label>
      <label class="field"><span>Datum rođenja</span><input class="input" id="babyBirth" type="date"></label>
      <button class="primary" id="createBaby">Kreiraj dnevnik</button>
      <button class="demo-link" id="seedDemo" type="button">Prikaži demo dnevnik</button>
    </div>
  </section>`;
}
function renderBabyList(){
  app.innerHTML=`<section class="app-shell">
    <div class="hero">
      <div class="hero-illustration">🧸</div>
      <div><h1>Dnevnik bebe</h1><p>Izaberi bebu za koju želiš da uneseš ili pregledaš dnevnik.</p></div>
    </div>
    <div class="section-row"><h2>Moje bebe</h2><span>${state.babies.length} ${state.babies.length===1?"beba":"bebe"}</span></div>
    <div class="baby-list">
      ${state.babies.map(b=>`<button class="baby-card" data-id="${b.id}">
        <span class="avatar-sm">${b.avatar ? `<img src="${b.avatar}" alt="">` : "👶"}</span>
        <span><span class="baby-title">${b.name}</span><span class="baby-meta">${babyAge(b.birthDate)||"Još nema starosti"}</span></span>
        <span>›</span>
      </button>`).join("")}
    </div>
    <button class="secondary" id="addBaby" style="width:100%;margin-top:12px;">+ Dodaj bebu</button>
  </section>`;
  $$(".baby-card").forEach(btn=>btn.onclick=()=>{
    selectedBabyId=btn.dataset.id;
    localStorage.setItem("babyDiaryCurrentBabyId",selectedBabyId);
    currentDayId=null;
    renderDiary();
  });
  $("#addBaby").onclick=()=>{
    const name=prompt("Ime bebe");
    if(!name) return;
    state.babies.push({id:uid("baby"),name:name.trim(),birthDate:"",avatar:"",reminders:[],days:[]});
    saveState(); renderBabyList();
  };
}
function sortedDays(){
  const b=getBaby();
  return [...(b?.days||[])].sort((a,b)=>(b.date||"").localeCompare(a.date||""));
}
function moveDay(offset){
  const days=sortedDays();
  const i=days.findIndex(d=>d.id===currentDayId);
  const next=days[i+offset];
  if(next){currentDayId=next.id; openCardId=null; renderDiary();}
}


function forceOpenCalendarSheet(){
  if(typeof openCalendarSheet === "function"){
    openCalendarSheet();
    return;
  }
  createCalendarSheetFallback();
}

function bindCalendarControls(){
  const buttons=[
    document.getElementById("calendarTop"),
    document.getElementById("datePill"),
    document.getElementById("calendarBtn")
  ].filter(Boolean);

  buttons.forEach(btn=>{
    btn.onclick=(event)=>{
      event.preventDefault();
      event.stopPropagation();
      forceOpenCalendarSheet();
    };
  });
}

// delegated calendar fallback for all current/future calendar triggers
document.addEventListener("click", function(event){
  const trigger=event.target.closest("#calendarTop, #datePill, #calendarBtn, [data-calendar-open]");
  if(!trigger) return;

  event.preventDefault();
  event.stopPropagation();
  forceOpenCalendarSheet();
}, true);





function createCalendarSheetFallback(){
  document.getElementById("calendarSheet")?.remove();

  const day=getCurrentDay() || ensureDay();
  const base=day?.date ? new Date(day.date+"T00:00:00") : new Date();
  let viewDate=new Date(base.getFullYear(),base.getMonth(),1);

  const bg=document.createElement("div");
  bg.id="calendarSheet";
  bg.className="calendar-sheet-bg open";
  bg.style.display="flex";
  bg.style.zIndex="600";
  bg.classList.add("open");

  bg.innerHTML=`
    <div class="calendar-sheet">
      <div class="calendar-head">
        <div>
          <h2>Izaberi dan</h2>
          <p>Otvori postojeći ili kreiraj prazan dnevnik za izabrani datum.</p>
        </div>
        <button class="close" id="calendarClose" type="button">×</button>
      </div>
      <div id="calendarContent"></div>
    </div>
  `;

  document.body.appendChild(bg);

  const close=()=>bg.remove();
  document.getElementById("calendarClose").onclick=close;
  bg.addEventListener("click",(event)=>{ if(event.target===bg) close(); });

  const render=()=>{
    const mount=document.getElementById("calendarContent");
    if(!mount) return;

    const year=viewDate.getFullYear();
    const month=viewDate.getMonth();
    const monthNames=["januar","februar","mart","april","maj","jun","jul","avgust","septembar","oktobar","novembar","decembar"];
    const weekdays=["P","U","S","Č","P","S","N"];

    const first=new Date(year,month,1);
    const startOffset=(first.getDay()+6)%7;
    const gridStart=new Date(year,month,1-startOffset);

    const current=getCurrentDay();
    const activeDate=current?.date || today();
    const todayDate=today();
    const baby=getBaby();
    const existingDates=new Set((baby?.days||[]).map(d=>d.date));

    const cells=[];
    for(let i=0;i<42;i++){
      const d=new Date(gridStart.getFullYear(),gridStart.getMonth(),gridStart.getDate()+i);
      const iso=localISODate(d);
      const outside=d.getMonth()!==month;

      cells.push(`
        <button class="calendar-day ${outside?"outside":""} ${iso===activeDate?"selected":""} ${iso===todayDate?"today":""} ${existingDates.has(iso)?"has-entry":""}"
          type="button"
          data-calendar-date="${iso}">
          ${d.getDate()}
        </button>
      `);
    }

    mount.innerHTML=`
      <div class="calendar-month-row">
        <button type="button" id="calendarPrevMonth">${icon("left")}</button>
        <div class="calendar-month-title">${monthNames[month]} ${year}</div>
        <button type="button" id="calendarNextMonth">${icon("right")}</button>
      </div>
      <div class="calendar-weekdays">${weekdays.map(w=>`<span>${w}</span>`).join("")}</div>
      <div class="calendar-grid">${cells.join("")}</div>
      <div class="calendar-footer">Tačka označava dane koji već imaju dnevnik.</div>
    `;

    document.getElementById("calendarPrevMonth").onclick=()=>{
      viewDate=new Date(year,month-1,1);
      render();
    };

    document.getElementById("calendarNextMonth").onclick=()=>{
      viewDate=new Date(year,month+1,1);
      render();
    };

    mount.querySelectorAll("[data-calendar-date]").forEach(btn=>{
      btn.onclick=()=>{
        const date=btn.dataset.calendarDate;
        const baby=getBaby();
        if(!baby) return;
        baby.days=Array.isArray(baby.days)?baby.days:[];

        let selectedDay=baby.days.find(d=>d.date===date);
        if(!selectedDay){
          selectedDay={id:uid("day"),date,updatedAt:new Date().toISOString(),notes:[]};
          baby.days.push(selectedDay);
          saveState();
        }

        currentDayId=selectedDay.id;
        openCardId=null;
        close();
        renderDiary();
      };
    });
  };

  render();
}




function selectedDate(){
  return (getCurrentDay()||ensureDay())?.date || today();
}

function ensureReminders(){
  const b=getBaby();
  if(!b) return [];
  b.reminders=Array.isArray(b.reminders)?b.reminders:[];
  return b.reminders;
}

function remindersForDate(date=selectedDate()){
  const reminders=ensureReminders();
  return reminders
    .filter(r=>{
      if(!r || !r.title) return false;
      if(r.repeat==="daily") return true;
      return (r.date||"")===date;
    })
    .sort((a,b)=>(a.time||"99:99").localeCompare(b.time||"99:99"));
}

function isReminderDone(reminder,date=selectedDate()){
  return Array.isArray(reminder.doneDates) && reminder.doneDates.includes(date);
}

function reminderDoneTime(reminder,date=selectedDate()){
  return reminder.doneTimes?.[date] || "";
}

function completeReminder(id){
  const b=getBaby();
  const date=selectedDate();
  const r=(b?.reminders||[]).find(x=>x.id===id);
  if(!r) return;
  r.doneDates=Array.isArray(r.doneDates)?r.doneDates:[];
  r.doneTimes=r.doneTimes&&typeof r.doneTimes==="object"?r.doneTimes:{};
  if(!r.doneDates.includes(date)) r.doneDates.push(date);
  r.doneTimes[date]=nowTime();
  r.updatedAt=new Date().toISOString();
  saveState();
  renderDiary();
}

function reminderMinutes(time){
  const value=String(time||"").trim();
  const parts=value.split(":");
  if(parts.length!==2) return null;
  const h=Number(parts[0]);
  const m=Number(parts[1]);
  if(!Number.isInteger(h)||!Number.isInteger(m)||h<0||h>23||m<0||m>59) return null;
  return h*60+m;
}


function reminderLocalDateTime(reminder,date=selectedDate()){
  const time=String(reminder?.time||"").trim();
  const parts=time.split(":");
  if(parts.length!==2) return null;

  const h=Number(parts[0]);
  const m=Number(parts[1]);
  if(!Number.isInteger(h)||!Number.isInteger(m)||h<0||h>23||m<0||m>59) return null;

  const base=parseLocalDate(date);
  base.setHours(h,m,0,0);
  return base;
}

function currentLocalDateTime(){
  return new Date();
}

function reminderDateTimeMs(reminder,date=selectedDate()){
  const time=String(reminder?.time||"").trim();
  const parts=time.split(":");
  if(parts.length!==2) return null;

  const h=Number(parts[0]);
  const m=Number(parts[1]);
  if(!Number.isInteger(h)||!Number.isInteger(m)||h<0||h>23||m<0||m>59) return null;

  const d=parseLocalDate(date);
  d.setHours(h,m,0,0);
  return d.getTime();
}

function nowDateTimeMs(){
  return Date.now();
}

function isReminderExpired(reminder,date=selectedDate()){
  if(!reminder || isReminderDone(reminder,date)) return false;

  const reminderMs=reminderDateTimeMs(reminder,date);
  if(reminderMs===null) return false;

  return reminderMs <= Date.now();
}

function expiredRemindersForToday(){
  return remindersForDate(today()).filter(r=>isReminderExpired(r,today()));
}

function formatDelayText(reminder,date=selectedDate()){
  const reminderMs=reminderDateTimeMs(reminder,date);
  if(reminderMs===null) return "";

  const diffMs=Date.now()-reminderMs;
  if(diffMs<0) return "";

  const diff=Math.floor(diffMs/60000);
  if(diff===0) return "Vreme je sada";
  if(diff<60) return "Kasni "+diff+" min";

  const h=Math.floor(diff/60);
  const m=diff%60;
  return m ? `Kasni ${h} h ${m} min` : `Kasni ${h} h`;
}

function showFloatingReminderBanner(){
  const expired=expiredRemindersForToday();
  if(!expired.length) return;

  document.getElementById("floatingReminder")?.remove();

  const banner=document.createElement("div");
  banner.id="floatingReminder";
  banner.className="floating-reminder";

  if(expired.length===1){
    const reminder=expired[0];
    banner.innerHTML=`
      <div class="floating-reminder-card">
        <button class="floating-reminder-close" type="button" aria-label="Zatvori">×</button>
        <div class="floating-reminder-kicker">Podsetnik za danas</div>
        <div class="floating-reminder-title">${escapeHtml(reminder.title)}</div>
        <div class="floating-reminder-meta">Predviđeno vreme: ${reminder.time || "bez vremena"}${formatDelayText(reminder,today()) ? " • "+formatDelayText(reminder,today()) : ""}</div>
        <button class="floating-reminder-action" type="button" data-floating-reminder-done="${reminder.id}">Označi kao urađeno</button>
      </div>
    `;
  }else{
    const first=expired.slice(0,3);
    banner.innerHTML=`
      <div class="floating-reminder-card">
        <button class="floating-reminder-close" type="button" aria-label="Zatvori">×</button>
        <div class="floating-reminder-kicker">Podsetnici čekaju potvrdu</div>
        <div class="floating-reminder-title">${expired.length} istekla podsetnika</div>
        <div class="floating-reminder-list">
          ${first.map(r=>`<div>• ${escapeHtml(r.title)} <span>${r.time||""}</span></div>`).join("")}
          ${expired.length>3 ? `<div>+${expired.length-3} još</div>` : ""}
        </div>
        <button class="floating-reminder-action" type="button" id="showReminderList">Prikaži podsetnike</button>
      </div>
    `;
  }

  document.body.appendChild(banner);
  requestAnimationFrame(()=>banner.classList.add("show"));

  banner.querySelector(".floating-reminder-close").onclick=()=>{
    banner.classList.remove("show");
    setTimeout(()=>banner.remove(),220);
  };

  banner.querySelector("[data-floating-reminder-done]")?.addEventListener("click",()=>{
    const reminder=expired[0];
    completeReminder(reminder.id);
    currentTab="reminders";
    renderDiary();

    const doneTime=reminderDoneTime(reminder,today()) || nowTime();
    banner.classList.add("done");
    banner.querySelector(".floating-reminder-kicker").textContent="✓ Urađeno";
    banner.querySelector(".floating-reminder-meta").textContent="Potvrđeno u "+doneTime;
    banner.querySelector(".floating-reminder-action")?.remove();

    setTimeout(()=>{
      banner.classList.remove("show");
      setTimeout(()=>banner.remove(),220);
    },1200);
  });

  banner.querySelector("#showReminderList")?.addEventListener("click",()=>{
    banner.classList.remove("show");
    setTimeout(()=>banner.remove(),220);
    currentTab="reminders";
    renderDiary();
  });

  clearTimeout(window.__floatingReminderTimer);
  window.__floatingReminderTimer=setTimeout(()=>{
    if(document.body.contains(banner) && !banner.classList.contains("done")){
      banner.classList.remove("show");
      setTimeout(()=>banner.remove(),220);
    }
  },7000);
}

function openReminderListSheet(){
  document.getElementById("reminderListSheet")?.remove();

  const items=remindersForDate(selectedDate()).filter(r=>!isReminderDone(r));
  const sheet=document.createElement("div");
  sheet.id="reminderListSheet";
  sheet.className="reminder-list-sheet-bg open";
  sheet.innerHTML=`
    <div class="reminder-list-sheet">
      <div class="modal-head">
        <div>
          <h2>Ne zaboravi danas</h2>
          <p>Podsetnici ne kreiraju aktivnosti. Samo ih označi kada su urađeni.</p>
        </div>
        <button class="close" id="closeReminderListSheet" type="button">×</button>
      </div>

      <div class="reminder-sheet-list">
        ${items.length ? items.map(r=>`
          <div class="reminder-sheet-card ${isReminderExpired(r)?"expired":""}">
            <div>
              <strong>${escapeHtml(r.title)}</strong>
              <small>Predviđeno vreme: ${r.time || "bez vremena"}${formatDelayText(r, selectedDate()) ? " • "+formatDelayText(r, selectedDate()) : ""}</small>
            </div>
            <button type="button" data-sheet-reminder-done="${r.id}">Označi kao urađeno</button>
          </div>
        `).join("") : `<div class="empty-card">Nema aktivnih podsetnika za danas.</div>`}
      </div>
    </div>
  `;

  document.body.appendChild(sheet);

  const close=()=>sheet.remove();
  document.getElementById("closeReminderListSheet").onclick=close;
  sheet.addEventListener("click",(event)=>{ if(event.target===sheet) close(); });

  sheet.querySelectorAll("[data-sheet-reminder-done]").forEach(btn=>{
    btn.onclick=()=>{
      completeReminder(btn.dataset.sheetReminderDone);
      close();
    };
  });
}



function removeReminder(id){
  const b=getBaby();
  if(!b || !Array.isArray(b.reminders)) return;
  b.reminders=b.reminders.filter(r=>r.id!==id);
  saveState();
  document.getElementById("reminderModal")?.remove();
  document.getElementById("confirmRemoveReminder")?.remove();
  renderDiary();
}

function openRemoveReminderConfirm(id){
  const reminder=getReminderById(id);
  if(!reminder) return;

  document.getElementById("confirmRemoveReminder")?.remove();

  const modal=document.createElement("div");
  modal.id="confirmRemoveReminder";
  modal.className="confirm-reminder-bg open";
  modal.innerHTML=`
    <div class="confirm-reminder-card">
      <h2>Ukloniti podsetnik?</h2>
      <p>Podsetnik "${escapeHtml(reminder.title)}" biće uklonjen za ovu bebu.</p>
      <div class="confirm-reminder-actions">
        <button type="button" class="cancel" id="cancelRemoveReminder">Otkaži</button>
        <button type="button" class="danger-action" id="confirmRemoveReminderBtn">Ukloni</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById("cancelRemoveReminder").onclick=()=>modal.remove();
  document.getElementById("confirmRemoveReminderBtn").onclick=()=>removeReminder(id);
  modal.addEventListener("click",(event)=>{ if(event.target===modal) modal.remove(); });
}

function getReminderById(id){
  return ensureReminders().find(r=>r.id===id) || null;
}


function expiredReminderCount(){
  return remindersForDate(today()).filter(r=>isReminderExpired(r,today())).length;
}

function renderRemindersToday(){
  const items=remindersForDate(selectedDate());

  return `<section class="reminders-today ${items.length ? "" : "empty"}">
    <div class="reminders-header">
      <div>
        <div class="reminders-title">Ne zaboravi danas</div>
        <p>${items.length ? "Podsetnici koje želiš da ispratiš danas." : "Nema podsetnika za danas."}</p>
      </div>
      <button type="button" class="reminder-add-inline" id="addReminderInline">+ Novi podsetnik</button>
    </div>

    ${items.length ? `<div class="reminder-list">
      ${items.map(r=>{
        const done=isReminderDone(r);
        const doneTime=reminderDoneTime(r);
        const expired=typeof isReminderExpired==="function" ? isReminderExpired(r, selectedDate()) : false;
        return `<div class="reminder-card ${done?"done":""} ${expired&&!done?"expired":""}" data-reminder-id="${r.id}">
          <div class="reminder-main">
            <span class="reminder-icon">${done?"✓":expired?"🔔":"💡"}</span>
            <span>
              <strong>${escapeHtml(r.title)}</strong>
              <small>${done && doneTime ? "Urađeno u "+doneTime : "Predviđeno vreme: "+(r.time || "bez vremena")}${r.repeat==="daily" ? " • svaki dan" : ""}${expired&&!done&&typeof formatDelayText==="function" ? " • "+formatDelayText(r, selectedDate()) : ""}</small>
            </span>
          </div>
          <button type="button" class="reminder-more-btn" data-reminder-menu="${r.id}" aria-label="Opcije podsetnika">⋯</button>
          <div class="reminder-menu" id="reminderMenu-${r.id}">
            <button type="button" data-reminder-edit="${r.id}">Izmeni podsetnik</button>
            <button type="button" class="danger" data-reminder-remove="${r.id}">Ukloni podsetnik</button>
          </div>
          <div class="reminder-actions">
            ${done ? `<span class="reminder-done">Urađeno</span>` : `<button type="button" class="reminder-done-btn" data-reminder-done="${r.id}">Označi kao urađeno</button>`}
          </div>
        </div>`;
      }).join("")}
    </div>` : `<div class="reminders-empty-card">
      <span>💡</span>
      <div>
        <strong>Dodaj prvi podsetnik</strong>
        <small>Na primer: Vitamin D, kupanje ili poziv pedijatru.</small>
      </div>
    </div>`}
  </section>`;
}


function escapeHtml(value){
  return String(value||"").replace(/[&<>"']/g, c => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#039;"
  }[c]));
}

function openReminderModal(reminderId=null){
  document.getElementById("reminderModal")?.remove();

  const editingReminder = reminderId ? getReminderById(reminderId) : null;
  const initialTitle = editingReminder?.title || "";
  const initialTime = editingReminder?.time || nowTime();
  const initialDaily = editingReminder ? editingReminder.repeat==="daily" : true;
  const initialDate = editingReminder?.date || selectedDate();

  const modal=document.createElement("div");
  modal.id="reminderModal";
  modal.className="reminder-modal-bg open";
  modal.innerHTML=`
    <div class="reminder-modal">
      <div class="modal-head">
        <div>
          <h2>${editingReminder?"Uredi podsetnik":"Novi podsetnik"}</h2>
          <p>Podsetnik ne kreira aktivnost. Samo te podseća šta treba završiti.</p>
        </div>
        <button class="close" id="closeReminderModal" type="button">×</button>
      </div>

      <div class="form">
        <label>
          <span class="field-label">Podsetnik je za *</span>
          <input class="input" id="reminderTitle" value="${escapeHtml(initialTitle)}" placeholder="npr. Vitamin D, kupanje, pedijatar">
        </label>

        <label>
          <span class="field-label">Vreme</span>
          <input class="input" id="reminderTime" type="time" value="${initialTime}">
        </label>

        <label class="reminder-repeat">
          <input id="reminderDaily" type="checkbox" ${initialDaily?"checked":""}>
          <span>Ponavljaj svakog dana</span>
        </label>

        <label class="reminder-date-field hidden" id="reminderDateWrap">
          <span class="field-label">Datum podsetnika</span>
          <input class="input" id="reminderDate" type="date" value="${initialDate}">
        </label>
      </div>

      <div class="error" id="reminderError"></div>
      <div class="modal-actions">
        <button class="cancel" id="cancelReminderModal" type="button">Otkaži</button>
        <button class="save" id="saveReminder" type="button">${editingReminder?"Sačuvaj izmene":"Sačuvaj"}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const close=()=>modal.remove();
  document.getElementById("closeReminderModal").onclick=close;
  document.getElementById("cancelReminderModal").onclick=close;
  modal.addEventListener("click",(event)=>{ if(event.target===modal) close(); });

  const dailyInput=document.getElementById("reminderDaily");
  const dateWrap=document.getElementById("reminderDateWrap");
  const updateDateVisibility=()=>{
    if(dailyInput.checked){
      dateWrap.classList.add("hidden");
    }else{
      dateWrap.classList.remove("hidden");
    }
  };
  dailyInput.onchange=updateDateVisibility;
  updateDateVisibility();

  document.getElementById("saveReminder").onclick=()=>{
    const title=document.getElementById("reminderTitle").value.trim();
    const error=document.getElementById("reminderError");
    error.classList.remove("show");

    if(!title){
      error.textContent="Unesi naziv podsetnika.";
      error.classList.add("show");
      return;
    }

    const reminders=ensureReminders();
    const payload={
      title,
      time:document.getElementById("reminderTime").value||"",
      repeat:document.getElementById("reminderDaily").checked ? "daily" : "once",
      date:document.getElementById("reminderDaily").checked ? selectedDate() : (document.getElementById("reminderDate").value || selectedDate()),
      updatedAt:new Date().toISOString()
    };

    if(editingReminder){
      Object.assign(editingReminder,payload);
    }else{
      reminders.push({
        id:uid("reminder"),
        ...payload,
        doneDates:[],
        doneTimes:{},
        createdAt:new Date().toISOString()
      });
    }

    saveState();
    close();
    renderDiary();
  };

  setTimeout(()=>document.getElementById("reminderTitle")?.focus(),80);
}





function renderDiary(){
  if(!state.babies || !state.babies.length){
    renderEmptyBabyOnboarding();
    return;
  }

  const baby=getBaby();
  if(!baby){ return renderOnboarding(); }
  const day=ensureDay();
  if(!day){ return renderOnboarding(); }
  const dateText=fmt(day.date);
  const dayText=babyDay(day.date,baby.birthDate);
  app.innerHTML=`<section class="app-shell">
    <header class="topbar">
      <div class="baby-menu-wrap">
        <button class="baby-switch" id="babySwitch" type="button" aria-haspopup="menu" aria-expanded="false">
          <span class="avatar">${baby.avatar ? `<img src="${baby.avatar}" alt="">` : "👶"}</span>
          <span><span class="name-row">${baby.name}${icon("down")}</span><span class="age">${babyAge(baby.birthDate)||""}</span></span>
        </button>
        <div class="baby-menu" id="babyMenu" role="menu"></div>
      </div>
      <div class="baby-menu-backdrop" id="babyMenuBackdrop"></div>
      <button class="icon-btn" id="calendarTop" data-calendar-open="true" aria-label="Kalendar">${icon("calendar")}</button>
    </header>

    <section class="title-block">
      <h1 id="pageTitle">${currentTab==="overview"?"Pregled dana":currentTab==="reminders"?"Moji podsetnici":"Dnevnik"}</h1>
      <div class="day-nav">
        <button class="nav-btn" id="prevDay" type="button" aria-label="Prethodni dan">${icon("left")}</button>
        <button class="date-pill" id="datePill" type="button" data-calendar-open="true"><strong>${dateText}</strong><span>${dayText?"• "+dayText:""}</span></button>
        <button class="nav-btn" id="nextDay" type="button" aria-label="Sledeći dan">${icon("right")}</button>
      </div>
      <input class="date-input-hidden" id="dateInput" type="date" value="${day.date}">
    </section>

    <section class="panel ${currentTab==="diary"?"active":""}" data-panel="diary">
      <div class="timeline" id="timeline"></div>
    </section>

    <section class="panel ${currentTab==="reminders"?"active":""}" data-panel="reminders">
      <div id="remindersPage"></div>
    </section>

    <section class="panel ${currentTab==="overview"?"active":""}" data-panel="overview">
      <div id="overview"></div>
    </section>

    <button class="fab ${(currentTab==="overview"||currentTab==="reminders")?"hidden-on-overview":""}" id="fab" aria-label="Dodaj aktivnost">${icon("plus")}<span>Dodaj<br>aktivnost</span></button>

    <nav class="bottom">
      <button class="tab ${currentTab==="diary"?"active":""}" data-tab="diary">${icon("list")}Dnevnik</button>
      <button class="tab reminders-tab ${currentTab==="reminders"?"active":""}" data-tab="reminders">
        <span class="tab-icon-wrap">${icon("bell")}${expiredReminderCount()>0?`<span class="tab-badge">${expiredReminderCount()}</span>`:""}</span>
        Podsetnici
      </button>
      <button class="tab ${currentTab==="overview"?"active":""}" data-tab="overview">${icon("chart")}Pregled</button>
    </nav>
  </section>
  <div class="modal-bg" id="modal"></div>`;

  renderBabyMenu();
  $("#babySwitch").onclick=toggleBabyMenu;
  $("#babyMenuBackdrop").onclick=closeBabyMenu;
  $("#calendarTop").onclick=openDatePicker;
  $("#datePill").onclick=openDatePicker;
  $("#dateInput").onchange=e=>{
    let newDay=getBaby().days.find(d=>d.date===e.target.value);
    if(!newDay){
      newDay={id:uid("day"),date:e.target.value,updatedAt:new Date().toISOString(),notes:[]};
      getBaby().days.push(newDay);
      saveState();
    }
    currentDayId=newDay.id;
    openCardId=null;
    document.getElementById("floatingReminder")?.remove();
    renderDiary();
  };
  $("#prevDay").onclick=(event)=>{
    event.preventDefault();
    event.stopPropagation();
    switchDayByOffset(-1);
  };
  $("#nextDay").onclick=(event)=>{
    event.preventDefault();
    event.stopPropagation();
    switchDayByOffset(1);
  };
  $("#fab").onclick=()=>openActivityModal();
  $$(".tab").forEach(t=>t.onclick=()=>{currentTab=t.dataset.tab;renderDiary();});
  renderTimeline();
  renderRemindersPage();
  renderOverview();
  $("#addReminderInline") && ($("#addReminderInline").onclick=(event)=>{
    event.preventDefault();
    event.stopPropagation();
    openReminderModal();
  });
  $$(".reminder-done-btn").forEach(btn=>btn.onclick=(event)=>{
    event.preventDefault();
    event.stopPropagation();
    completeReminder(btn.dataset.reminderDone);
  });
  $$(".reminder-more-btn").forEach(btn=>btn.onclick=(event)=>{
    event.preventDefault();
    event.stopPropagation();
    const id=btn.dataset.reminderMenu;
    const menu=document.getElementById("reminderMenu-"+id);
    $$(".reminder-menu.open").forEach(m=>{ if(m!==menu) m.classList.remove("open"); });
    menu?.classList.toggle("open");
  });
  $$("[data-reminder-edit]").forEach(btn=>btn.onclick=(event)=>{
    event.preventDefault();
    event.stopPropagation();
    $$(".reminder-menu.open").forEach(m=>m.classList.remove("open"));
    openReminderModal(btn.dataset.reminderEdit);
  });
  $$("[data-reminder-remove]").forEach(btn=>btn.onclick=(event)=>{
    event.preventDefault();
    event.stopPropagation();
    $$(".reminder-menu.open").forEach(m=>m.classList.remove("open"));
    openRemoveReminderConfirm(btn.dataset.reminderRemove);
  });
  document.addEventListener("click", function closeReminderMenus(event){
    if(!event.target.closest(".reminder-menu") && !event.target.closest(".reminder-more-btn")){
      $$(".reminder-menu.open").forEach(m=>m.classList.remove("open"));
    }
  }, {once:true});
  bindCalendarControls();
  if(selectedDate() === today()){
    setTimeout(showFloatingReminderBanner, 450);
  }else{
    document.getElementById("floatingReminder")?.remove();
  }
}
function openDatePicker(){
  forceOpenCalendarSheet();
}
function renderTimeline(){
  const list=entriesOf();
  const mount=$("#timeline");
  if(!list.length){
    mount.innerHTML=`<div class="empty-timeline"><strong>Još nema aktivnosti</strong><span>Dodaj prvu aktivnost za ovaj dan.</span></div>`;
    return;
  }
  if(!openCardId) openCardId=list[list.length-1].id;
  mount.innerHTML=list.map(e=>{
    const def=typeDef(e.type), dur=duration(e.note.from,e.note.to), isOpen=e.id===openCardId;
    const note=entryNote(e);
    return `<article class="card ${isOpen?"open":""}" data-id="${e.id}">
      <button class="card-head" data-action="toggle">
        <span class="time">${(e.note.from&&e.note.to)?e.note.from+"\\n– "+e.note.to:(e.note.from||"—")}</span>
        <span class="bubble">${icon(def.icon)}</span>
        <span><span class="card-title">${def.label}</span><span class="card-sub">${preview(e)}</span></span>
        <span class="chev">${icon("down")}</span>
      </button>
      <div class="expanded">
        <div class="expanded-grid ${hasDurationActivity(e.type)?"":"instant-grid"}">
          <div class="detail-field"><label>${instantActivityLabel(e.type)}</label><div class="detail-box"><span>${e.note.from||"—"}</span></div></div>
          ${hasDurationActivity(e.type)?`
            <div class="detail-field"><label>Kraj</label><div class="detail-box"><span>${e.note.to||"—"}</span></div></div>
            <div class="detail-field"><label>Trajanje</label><div class="detail-box"><span>${dur||"—"}</span></div></div>
          `:""}
        </div>
        ${note ? `<div class="note-field"><label>Napomena</label><div class="note-box"><span>${note}</span></div></div>` : ""}
        <div class="actions">
          <button class="text-btn danger" data-action="delete">${icon("trash")} Obriši</button>
          <button class="text-btn" data-action="edit">${icon("edit")} Uredi</button>
        </div>
      </div>
    </article>`;
  }).join("");
  $$(".card").forEach(card=>card.onclick=e=>{
    const actionEl=e.target.closest("[data-action]");
    const action=actionEl?.dataset.action || "toggle";
    const entry=entriesOf().find(x=>x.id===card.dataset.id);
    if(!entry) return;
    if(action==="edit"){
      e.preventDefault();
      e.stopPropagation();
      openActivityModal(entry);
      return;
    }
    if(action==="delete"){
      e.preventDefault();
      e.stopPropagation();
      deleteEntry(entry);
      return;
    }
    openCardId=openCardId===entry.id?null:entry.id;
    renderDiary();
  });
}

function reminderCardHtml(r){
  const done=isReminderDone(r);
  const doneTime=reminderDoneTime(r);
  const expired=typeof isReminderExpired==="function" ? isReminderExpired(r, selectedDate()) : false;

  return `<div class="reminder-card ${done?"done":""} ${expired&&!done?"expired":""}" data-reminder-id="${r.id}">
    <button type="button" class="reminder-more-btn" data-reminder-menu="${r.id}" aria-label="Opcije podsetnika">⋯</button>
    <div class="reminder-menu" id="reminderMenu-${r.id}">
      <button type="button" data-reminder-edit="${r.id}">Izmeni podsetnik</button>
      <button type="button" class="danger" data-reminder-remove="${r.id}">Ukloni podsetnik</button>
    </div>
    <div class="reminder-main">
      <span class="reminder-icon">${done?"✓":expired?"🔔":"💡"}</span>
      <span>
        <strong>${escapeHtml(r.title)}</strong>
        <small>${done && doneTime ? "Urađeno u "+doneTime : "Predviđeno vreme: "+(r.time || "bez vremena")}${r.repeat==="daily" ? " • svaki dan" : ""}${expired&&!done&&typeof formatDelayText==="function" ? " • "+formatDelayText(r, selectedDate()) : ""}</small>
      </span>
    </div>
    <div class="reminder-actions">
      ${done ? `<span class="reminder-done">Urađeno</span>` : `<button type="button" class="reminder-done-btn" data-reminder-done="${r.id}">Označi kao urađeno</button>`}
    </div>
  </div>`;
}

function renderRemindersPage(){
  const mount=$("#remindersPage");
  if(!mount) return;

  const date=selectedDate();
  const items=remindersForDate(date);
  const expired=items.filter(r=>!isReminderDone(r,date) && isReminderExpired(r,date));
  const active=items.filter(r=>!isReminderDone(r,date) && !isReminderExpired(r,date));
  const done=items.filter(r=>isReminderDone(r,date));

  if(!items.length){
    mount.innerHTML=`<section class="reminders-page">
      <div class="reminders-empty-state">
        <div class="reminders-empty-illustration">👶<span>🔔</span></div>
        <h2>Još nema podsetnika</h2>
        <p>Dodaj podsetnike za vitamine, probiotik, preglede kod pedijatra ili bilo koju dnevnu rutinu koju ne želiš da zaboraviš.</p>
        <button type="button" class="primary reminder-empty-cta" id="addReminderInline">Kreiraj prvi podsetnik</button>
      </div>
    </section>`;
    return;
  }

  mount.innerHTML=`<section class="reminders-page">
    <div class="reminders-page-head">
      <div>
        <h2>Moji podsetnici</h2>
        <p>Podsetnici za ${fmt(date)}. Ne kreiraju aktivnosti automatski.</p>
      </div>
      <button type="button" class="reminder-add-inline" id="addReminderInline">+ Novi podsetnik</button>
    </div>

    ${expired.length ? `<div class="reminders-group expired-group">
      <h3>Potrebna akcija</h3>
      <div class="reminder-list">${expired.map(reminderCardHtml).join("")}</div>
    </div>` : ""}

    ${active.length ? `<div class="reminders-group">
      <h3>Aktivni</h3>
      <div class="reminder-list">${active.map(reminderCardHtml).join("")}</div>
    </div>` : ""}

    ${done.length ? `<div class="reminders-group done-group">
      <h3>Urađeni danas</h3>
      <div class="reminder-list">${done.map(reminderCardHtml).join("")}</div>
    </div>` : ""}
  </section>`;
}


function renderOverview(){
  const day=getCurrentDay(), s=summaryOf(day), entries=entriesOf(day);
  const sleepEntries=entries.filter(e=>e.type==="sleep"&&duration(e.note.from,e.note.to));
  let longest="—";
  if(sleepEntries.length){
    sleepEntries.sort((a,b)=>(timeMin(b.note.to)-timeMin(b.note.from))-(timeMin(a.note.to)-timeMin(a.note.from)));
    const e=sleepEntries[0];
    longest=`${e.note.from}–${e.note.to} • ${duration(e.note.from,e.note.to)}`;
  }
  const last=entries[entries.length-1];
  $("#overview").innerHTML=`<div class="overview">
    <div class="kpi"><div class="kpi-head"><small>Dojenje</small><span class="kpi-icon">${icon("bottle")}</span></div><b>${s.breast}</b></div>
    <div class="kpi"><div class="kpi-head"><small>Dohrana</small><span class="kpi-icon">${icon("bottle")}</span></div><b>${s.formula} ml</b></div>
    <div class="kpi"><div class="kpi-head"><small>Spavanje</small><span class="kpi-icon">${icon("sleep")}</span></div><b>${sleepTxt(s.sleep)}</b></div>
    <div class="kpi"><div class="kpi-head"><small>Pelene</small><span class="kpi-icon">${icon("diaper")}</span></div><b>${s.pee+s.poop}</b></div>
    <div class="kpi"><div class="kpi-head"><small>Izmlazanje</small><span class="kpi-icon">${icon("drop")}</span></div><b>${s.pump} ml</b></div>
    <div class="kpi"><div class="kpi-head"><small>Suplementi</small><span class="kpi-icon">${icon("medicine")}</span></div><b>${s.supplements}</b></div>
    <div class="kpi"><div class="kpi-head"><small>Šetnja</small><span class="kpi-icon">${icon("walk")}</span></div><b>${s.walk}</b></div>
    <div class="kpi"><div class="kpi-head"><small>Unosa</small><span class="kpi-icon">${icon("list")}</span></div><b>${entries.length}</b></div>
    <div class="summary">
      <h3>Sažetak dana</h3>
      <div class="summary-row"><span>Najduži san</span><strong>${longest}</strong></div>
      <div class="summary-row"><span>Poslednja aktivnost</span><strong>${last?typeDef(last.type).label+" • "+(last.note.from||"—"):"—"}</strong></div>
      <div class="summary-row"><span>Status</span><strong>${entries.length?"Ažurirano":"Nema unosa"}</strong></div>
    </div>
  </div>`;
}
function deleteEntry(entry){
  const day=getCurrentDay();
  const note=day.notes[entry.noteIndex];
  note.activities.splice(entry.activityIndex,1);
  if(note.activities.length===0) day.notes.splice(entry.noteIndex,1);
  openCardId=null;
  day.updatedAt=new Date().toISOString();
  saveState();
  renderDiary();
}




function openSettingsPage(){
  closeBabyMenu();
  document.getElementById("settingsScreen")?.remove();

  const screen=document.createElement("section");
  screen.id="settingsScreen";
  screen.className="settings-screen open";
  screen.innerHTML=`
    <div class="settings-page">
      <div class="settings-top">
        <button class="settings-back" id="settingsBack" type="button">${icon("left")}</button>
        <div class="settings-title">
          <h1>Podešavanja</h1>
        </div>
        <span style="width:42px"></span>
      </div>
      <div class="settings-menu-backdrop" id="settingsMenuBackdrop"></div>

      <section class="settings-section owner-name-settings-section">
        <h2>Korisnik</h2>
        <div class="settings-card">
          <button class="settings-action" id="changeOwnerName" type="button">
            <span>
              <strong>Vaše ime</strong>
              <small>${escapeHtml((typeof getParentName === "function" && getParentName() !== "Osoba") ? getParentName() : (state.ownerName || getBaby()?.ownerName || "Nije dodato"))}</small>
            </span>
            ${icon("right")}
          </button>
        </div>
      </section>

      <section class="settings-section">
        <h2>Upravljanje bebama</h2>
        <div class="settings-card" id="settingsBabiesList"></div>
        <button class="settings-add-baby" id="settingsAddBaby" type="button">+ Dodaj novu bebu</button>
      </section>

      <section class="settings-section">
        <h2>Podaci</h2>
        <div class="settings-card">
          <button class="settings-action" id="transferData" type="button">
            <span>
              Prenos podataka
              <small>Prebaci podatke na drugi telefon ili ih vrati kasnije</small>
            </span>
            ${icon("right")}
          </button>
          <button class="settings-action" id="exportDiary" type="button">
            <span>
              Izvezi dnevnik
              <small>Podeli dnevnik sa pedijatrom ili odštampaj</small>
            </span>
            ${icon("right")}
          </button>
        </div>
      </section>

      
      <section class="settings-section">
        <h2>Deljenje dnevnika</h2>
        ${renderAccessPeople()}
        <div class="settings-card">
          <button class="settings-action" id="shareDiary" type="button">
            <span>
              Podeli dnevnik sa drugom osobom
              <small>Omogući drugoj osobi da prati i upisuje dnevnik na svom telefonu</small>
            </span>
            ${icon("right")}
          </button>
        </div>
      </section>

      <section class="settings-section">
        <h2>O aplikaciji</h2>
        <div class="settings-card">
          <div class="settings-action">
            <span>
              Baby Diary v2.0 Concept
              <small>Napravljeno sa ❤️ za osobae</small>
            </span>
          </div>
        </div>
      </section>
    </div>
  `;
  document.body.appendChild(screen);
  document.getElementById("settingsBack").onclick=closeSettingsPage;
  document.getElementById("exportDiary").onclick=openExportSheet;
  document.getElementById("transferData").onclick=openTransferDataSheet;
  document.getElementById("shareDiary") && (document.getElementById("shareDiary").onclick=openShareDiarySheet);
  document.getElementById("settingsAddBaby")?.addEventListener("click",()=>openAddBabyModal());
  renderSettingsBabies();
  bindSettingsAddBabyButton();
}


function openTransferDataSheet(){
  document.getElementById("transferDataSheet")?.remove();

  const sheet=document.createElement("div");
  sheet.id="transferDataSheet";
  sheet.className="transfer-sheet-bg open";
  sheet.innerHTML=`
    <div class="transfer-sheet">
      <div class="modal-head">
        <div>
          <h2>Prenos podataka</h2>
          <p>Prebaci podatke na drugi telefon ili ih vrati kasnije.</p>
        </div>
        <button class="close" id="closeTransferSheet" type="button">×</button>
      </div>

      <div class="transfer-card">
        <div>
          <strong>Izvezi podatke</strong>
          <small>Preuzmi sve bebe, aktivnosti i podsetnike u jedan fajl.</small>
        </div>
        <button type="button" id="exportAllData">Izvezi podatke</button>
      </div>

      <div class="transfer-card">
        <div>
          <strong>Uvezi podatke</strong>
          <small>Vrati prethodno izvezene podatke na ovaj telefon.</small>
        </div>
        <button type="button" id="importAllData">Uvezi podatke</button>
        <input id="importDataFile" type="file" accept="application/json,.json" hidden>
      </div>

      <p class="transfer-note">Fajl sačuvaj na sigurnom mestu, na primer iCloud, Google Drive ili računar.</p>
    </div>
  `;

  document.body.appendChild(sheet);

  const close=()=>sheet.remove();
  document.getElementById("closeTransferSheet").onclick=close;
  sheet.addEventListener("click",(event)=>{ if(event.target===sheet) close(); });

  document.getElementById("exportAllData").onclick=exportAllData;
  document.getElementById("importAllData").onclick=()=>{
    document.getElementById("importDataFile").click();
  };
  document.getElementById("importDataFile").onchange=handleImportFileSelected;
}

function closeSettingsPage(){
  document.getElementById("settingsScreen")?.remove();
}

function renderSettingsBabies(){
  const list=document.getElementById("settingsBabiesList");
  if(!list) return;
  const babies=state.babies||[];
  list.innerHTML=babies.map(b=>`
    <div class="settings-baby-row">
      <span class="settings-baby-avatar">${b.avatar?`<img src="${b.avatar}" alt="">`:"👶"}</span>
      <span class="settings-baby-info">
        <span class="settings-baby-name-row">
          <span class="settings-baby-name">${b.name||"Beba"}</span>
          ${b.id===selectedBabyId?`<span class="active-pill">Aktivna</span>`:""}
        </span>
        <span class="settings-baby-meta">${babyAge(b.birthDate)||"Datum nije dodat"}</span>
      </span>
      <button class="settings-more-btn" type="button" data-baby-more="${b.id}" aria-label="Opcije">⋯</button>
      <div class="settings-row-menu" id="settingsMenu_${b.id}">
        <button type="button" data-profile-baby="${b.id}">Profil bebe</button>
        <button type="button" data-set-active-baby="${b.id}" ${b.id===selectedBabyId?"disabled":""}>Postavi kao aktivnu</button>
        <button type="button" class="danger" data-remove-baby="${b.id}">Ukloni bebu</button>
      </div>
    </div>
  `).join("");
  document.getElementById("settingsMenuBackdrop").onclick=closeSettingsRowMenus;


  // profile modal visibility hotfix delegation
  list.addEventListener("pointerdown",(event)=>{
    if(event.target.closest(".settings-row-menu")) event.stopPropagation();
  }, true);

  list.addEventListener("click",(event)=>{
    const profileBtn=event.target.closest("[data-profile-baby]");
    if(profileBtn){
      event.preventDefault();
      event.stopPropagation();
      const babyId=profileBtn.dataset.profileBaby;
      closeSettingsRowMenus();
      setTimeout(()=>openProfileModal(babyId), 0);
      return;
    }
  }, true);

  $$("[data-baby-more]", list).forEach(btn=>{
    btn.onclick=(event)=>{
      event.stopPropagation();
      toggleSettingsRowMenu(btn.dataset.babyMore);
    };
  });
  $$("[data-profile-baby]", list).forEach(btn=>{
    btn.onclick=(event)=>{
      event.preventDefault();
      event.stopPropagation();
      const babyId=btn.dataset.profileBaby;
      closeSettingsRowMenus();
      setTimeout(()=>openProfileModal(babyId), 0);
    };
  });

  $$("[data-set-active-baby]", list).forEach(btn=>{
    btn.onclick=()=>{
      if(btn.disabled) return;
      setActiveBabyFromSettings(btn.dataset.setActiveBaby);
    };
  });

  $$("[data-remove-baby]", list).forEach(btn=>{
    btn.onclick=()=>openRemoveBabyConfirm(btn.dataset.removeBaby);
  });
}


function closeSettingsRowMenus(){
  $$(".settings-row-menu").forEach(menu=>menu.classList.remove("open"));
  document.getElementById("settingsMenuBackdrop")?.classList.remove("open");
}

function toggleSettingsRowMenu(babyId){
  const menu=document.getElementById("settingsMenu_"+babyId);
  const btn=document.querySelector(`[data-baby-more="${babyId}"]`);
  const backdrop=document.getElementById("settingsMenuBackdrop");
  const isOpen=menu?.classList.contains("open");

  closeSettingsRowMenus();

  if(!menu || !btn || isOpen) return;

  menu.classList.add("open");
  backdrop?.classList.add("open");

  const margin=12;
  const menuWidth=184;
  const menuHeight=menu.offsetHeight || 92;
  const rect=btn.getBoundingClientRect();
  const viewportW=window.innerWidth;
  const viewportH=window.innerHeight;

  let left=rect.right - menuWidth;
  left=Math.max(margin, Math.min(left, viewportW - menuWidth - margin));

  let top=rect.bottom + 8;
  if(top + menuHeight > viewportH - margin){
    top=rect.top - menuHeight - 8;
  }
  top=Math.max(margin, Math.min(top, viewportH - menuHeight - margin));

  menu.style.left=left+"px";
  menu.style.top=top+"px";
}

function setActiveBabyFromSettings(babyId){
  selectedBabyId=babyId;
  currentDayId=null;
  openCardId=null;
  currentTab="diary";
  localStorage.setItem("babyDiaryCurrentBabyId",babyId);
  closeSettingsRowMenus();
  saveState();
  renderSettingsBabies();
  renderDiary();
}

function openRemoveBabyConfirm(babyId){
  closeSettingsRowMenus();
  const baby=(state.babies||[]).find(b=>b.id===babyId);
  if(!baby) return;
  document.getElementById("removeBabyConfirm")?.remove();
  const confirm=document.createElement("div");
  confirm.id="removeBabyConfirm";
  confirm.className="confirm-bg open";
  confirm.innerHTML=`
    <div class="confirm-modal">
      <h2>Ukloniti bebu?</h2>
      <p>Ovo će ukloniti profil bebe <strong>${baby.name||"Beba"}</strong> i njen dnevnik sa ovog uređaja.</p>
      <div class="confirm-actions">
        <button class="confirm-cancel" id="cancelRemoveBaby" type="button">Otkaži</button>
        <button class="confirm-delete" id="confirmRemoveBaby" type="button">Ukloni</button>
      </div>
    </div>
  `;
  document.body.appendChild(confirm);
  document.getElementById("cancelRemoveBaby").onclick=closeRemoveBabyConfirm;
  confirm.addEventListener("click",(e)=>{ if(e.target===confirm) closeRemoveBabyConfirm(); });
  document.getElementById("confirmRemoveBaby").onclick=()=>{
    removeBaby(babyId);
    closeRemoveBabyConfirm();
  };
}

function closeRemoveBabyConfirm(){
  document.getElementById("removeBabyConfirm")?.remove();
}

function removeBaby(babyId){
  state.babies=(state.babies||[]).filter(b=>b.id!==babyId);
  if(selectedBabyId===babyId){
    selectedBabyId=state.babies[0]?.id || null;
    currentDayId=null;
    openCardId=null;
    if(selectedBabyId) localStorage.setItem("babyDiaryCurrentBabyId",selectedBabyId);
    else localStorage.removeItem("babyDiaryCurrentBabyId");
  }
  saveState();

  if(!state.babies.length){
    closeSettingsPage();
    renderOnboarding();
    return;
  }

  renderSettingsBabies();
  renderDiary();
}



function sanitizePdfText(text){
  return String(text ?? "")
    .replace(/[()\\]/g, "\\$&")
    .replace(/[^\x20-\x7EčćžšđČĆŽŠĐ]/g, " ")
    .replace(/[čć]/g,"c")
    .replace(/[ČĆ]/g,"C")
    .replace(/[ž]/g,"z")
    .replace(/[Ž]/g,"Z")
    .replace(/[š]/g,"s")
    .replace(/[Š]/g,"S")
    .replace(/[đ]/g,"dj")
    .replace(/[Đ]/g,"Dj");
}

function wrapPdfText(text, maxChars=84){
  const words=sanitizePdfText(text).split(/\s+/).filter(Boolean);
  const lines=[];
  let line="";
  words.forEach(word=>{
    if((line+" "+word).trim().length>maxChars){
      if(line) lines.push(line);
      line=word;
    }else{
      line=(line+" "+word).trim();
    }
  });
  if(line) lines.push(line);
  return lines.length ? lines : [""];
}

function pdfLine(label, value){
  return `${label}: ${value || "-"}`;
}

function formatActivityForPdf(entry){
  const def=typeDef(entry.type);
  const t=entry.note.from && entry.note.to ? `${entry.note.from}-${entry.note.to}` : (entry.note.from || "-");
  const dur=duration(entry.note.from, entry.note.to);
  const parts=[t, def.label, preview(entry)];
  if(dur && entry.type!=="sleep" && entry.type!=="walk") parts.push(dur);
  return parts.filter(Boolean).join("  |  ");
}

function buildPdfReport(scope){
  const baby=getBaby();
  if(!baby) return {title:"Dnevnik bebe", lines:["Nema aktivne bebe."]};

  const allDays=[...(baby.days||[])].sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  const current=getCurrentDay();
  const days=scope==="all" ? allDays : (current ? [current] : []);

  const title=scope==="all" ? `Dnevnik bebe - ${baby.name}` : `Dnevnik bebe - ${baby.name} - ${current ? fmtFull(current.date) : ""}`;

  const lines=[];
  lines.push("DNEVNIK BEBE");
  lines.push("");
  lines.push(pdfLine("Beba", baby.name));
  lines.push(pdfLine("Export", new Date().toLocaleString("sr-RS")));
  if(scope==="day" && current){
    lines.push(pdfLine("Datum", fmtFull(current.date)));
    lines.push(pdfLine("Starost", babyDay(current.date,baby.birthDate) || babyAge(baby.birthDate)));
  }
  if(scope==="all"){
    lines.push(pdfLine("Opseg", "Ceo dnevnik bebe"));
    lines.push(pdfLine("Broj dana", days.length));
  }

  days.forEach((day, index)=>{
    const s=summaryOf(day);
    const entries=entriesOf(day);

    lines.push("");
    lines.push(index===0 && scope==="day" ? "SAZETAK DANA" : `DAN: ${fmtFull(day.date)} ${babyDay(day.date,baby.birthDate) ? " | " + babyDay(day.date,baby.birthDate) : ""}`);
    lines.push("-".repeat(52));
    lines.push(pdfLine("Dojenje", s.breast));
    lines.push(pdfLine("Dohrana", `${s.formula} ml`));
    lines.push(pdfLine("Izmlazanje", `${s.pump} ml`));
    lines.push(pdfLine("Spavanje", sleepTxt(s.sleep)));
    lines.push(pdfLine("Pelene", `${s.pee+s.poop}`));
    lines.push(pdfLine("Suplementi", s.supplements || 0));
    lines.push(pdfLine("Setnja", s.walk || 0));

    lines.push("");
    lines.push("TIMELINE");
    lines.push("-".repeat(52));

    if(!entries.length){
      lines.push("Nema aktivnosti za ovaj dan.");
    }else{
      entries.forEach(entry=>{
        lines.push(formatActivityForPdf(entry));
        const note=entryNote(entry);
        if(note){
          wrapPdfText("Napomena: "+note, 78).forEach(wrapped=>lines.push("  "+wrapped));
        }
      });
    }
  });

  lines.push("");
  lines.push("Generated by Baby Diary v61");

  return {title, lines};
}

function createSimplePdf(title, lines){
  const pageWidth=595.28;
  const pageHeight=841.89;
  const marginX=48;
  const topY=792;
  const bottomY=56;
  const lineHeight=15;
  const fontSize=10;
  const titleFontSize=16;

  const pages=[];
  let ops=[];
  let y=topY;

  function pushText(text, x, yPos, size=fontSize, bold=false){
    const safe=sanitizePdfText(text);
    ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${yPos} Td (${safe}) Tj ET`);
  }

  function newPage(){
    if(ops.length) pages.push(ops);
    ops=[];
    y=topY;
  }

  pushText(title, marginX, y, titleFontSize, true);
  y-=28;

  lines.forEach(raw=>{
    const wrapped=wrapPdfText(raw, 88);
    wrapped.forEach(line=>{
      if(y<bottomY){
        newPage();
      }
      const isHeading=line === line.toUpperCase() && line.length>2 && !line.includes(":") && !line.includes("-");
      pushText(line, marginX, y, isHeading ? 12 : fontSize, isHeading);
      y-=isHeading ? 19 : lineHeight;
    });
  });

  if(ops.length) pages.push(ops);

  const objects=[];
  function addObject(content){
    objects.push(content);
    return objects.length;
  }

  const font1=addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const font2=addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  const pageObjectIds=[];
  const contentObjectIds=[];

  pages.forEach(pageOps=>{
    const stream=pageOps.join("\n");
    const contentId=addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    contentObjectIds.push(contentId);
    const pageId=addObject(""); // placeholder
    pageObjectIds.push(pageId);
  });

  const pagesId=addObject(""); // placeholder
  const catalogId=addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  pageObjectIds.forEach((pageId, i)=>{
    objects[pageId-1]=`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${contentObjectIds[i]} 0 R >>`;
  });

  objects[pagesId-1]=`<< /Type /Pages /Kids [${pageObjectIds.map(id=>`${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`;

  let pdf="%PDF-1.4\n";
  const offsets=[0];

  objects.forEach((obj, i)=>{
    offsets.push(pdf.length);
    pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefOffset=pdf.length;
  pdf+=`xref\n0 ${objects.length+1}\n`;
  pdf+="0000000000 65535 f \n";
  offsets.slice(1).forEach(offset=>{
    pdf+=String(offset).padStart(10,"0")+" 00000 n \n";
  });
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Blob([pdf], {type:"application/pdf"});
}

function exportPdfForPediatrician(scope="day"){
  const baby=getBaby();
  if(!baby) return toast("Nema aktivne bebe za export.");

  const report=buildPdfReport(scope);
  const blob=createSimplePdf(report.title, report.lines);
  const url=URL.createObjectURL(blob);

  const activeDay=getCurrentDay();
  const safeName=(baby.name||"beba").toLowerCase().replace(/[^a-z0-9čćžšđ]+/gi,"-").replace(/^-|-$/g,"");
  const datePart=scope==="day" && activeDay ? activeDay.date : "ceo-dnevnik";

  const a=document.createElement("a");
  a.href=url;
  a.download=`dnevnik-${safeName || "beba"}-${datePart}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(()=>URL.revokeObjectURL(url), 1000);

  toast("PDF export je pokrenut.");
}


function openExportSheet(){
  document.getElementById("exportSheet")?.remove();

  const baby=getBaby();
  const day=getCurrentDay();

  const sheet=document.createElement("div");
  sheet.id="exportSheet";
  sheet.className="export-sheet-bg open";
  sheet.innerHTML=`
    <div class="export-sheet">
      <div class="export-head">
        <div>
          <h2>Export dnevnika</h2>
          <p>Izaberi opseg i format exporta.</p>
        </div>
        <button class="close" id="exportClose" type="button">×</button>
      </div>

      <div class="export-section">
        <p class="export-section-title">Šta želiš da izvezeš?</p>

        <label class="export-option">
          <input type="radio" name="exportScope" value="day" checked>
          <span>
            <strong>Samo ovaj dan</strong>
            <small>${day ? fmtFull(day.date) : "Trenutno izabrani dan"}${baby && day ? " • " + (babyDay(day.date,baby.birthDate)||"") : ""}</small>
          </span>
        </label>

        <label class="export-option">
          <input type="radio" name="exportScope" value="all">
          <span>
            <strong>Ceo dnevnik bebe</strong>
            <small>Svi dani za ${baby?.name || "aktivnu bebu"}</small>
          </span>
        </label>
      </div>

      <div class="export-section">
        <p class="export-section-title">Format</p>

        <label class="export-option">
          <input type="radio" name="exportFormat" value="pdf" checked>
          <span>
            <strong>PDF za pedijatra</strong>
            <small>Čitljiv izveštaj sa sažetkom, timeline-om i napomenama</small>
          </span>
        </label>

        <label class="export-option disabled">
          <input type="radio" name="exportFormat" value="csv" disabled>
          <span>
            <strong>CSV tabela</strong>
            <small>Kasnije za Excel / analizu</small>
          </span>
        </label>
      </div>

      <div class="export-actions">
        <button class="export-cancel" id="exportCancel" type="button">Otkaži</button>
        <button class="export-primary" id="exportStart" type="button">Nastavi</button>
      </div>
    </div>
  `;

  document.body.appendChild(sheet);

  sheet.style.display="flex";
  sheet.style.zIndex="500";



  document.getElementById("exportClose").onclick=closeExportSheet;
  document.getElementById("exportCancel").onclick=closeExportSheet;
  sheet.addEventListener("click",(event)=>{
    if(event.target===sheet) closeExportSheet();
  });

  document.getElementById("exportStart").onclick=()=>{
    const scope=document.querySelector('input[name="exportScope"]:checked')?.value || "day";
    const format=document.querySelector('input[name="exportFormat"]:checked')?.value || "pdf";

    closeExportSheet();

    if(format==="pdf"){
      exportPdfForPediatrician(scope);
      return;
    }

    toast("Ovaj format ćemo dodati kasnije.");
  };
}

function closeExportSheet(){
  document.getElementById("exportSheet")?.remove();
}


function exportActiveBabyDiary(){
  const baby=getBaby();
  if(!baby) return toast("Nema aktivne bebe za export.");
  const payload={exportedAt:new Date().toISOString(),app:"Baby Diary v61",baby};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  const safeName=(baby.name||"beba").toLowerCase().replace(/[^a-z0-9čćžšđ]+/gi,"-").replace(/^-|-$/g,"");
  a.href=url;
  a.download=`dnevnik-${safeName || "beba"}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("Export dnevnika je pokrenut.");
}


function renderBabyMenu(){
  const menu=$("#babyMenu");
  if(!menu) return;

  const babies=state.babies||[];
  const active=getBaby();

  const activeRows=babies.map(b=>{
    const isActive=b.id===selectedBabyId;
    return `
      <button type="button" class="baby-switch-row ${isActive?"active":""}" data-switch-baby="${b.id}">
        <span class="baby-switch-avatar">${b.avatar?`<img src="${b.avatar}" alt="">`:"👶"}</span>
        <span class="baby-switch-info">
          <span class="baby-switch-name">${b.name||"Beba"}</span>
          <span class="baby-switch-age">${babyAge(b.birthDate)||"Datum nije dodat"}</span>
        </span>
        <span class="baby-switch-check">${isActive?"✓":""}</span>
      </button>
    `;
  }).join("");

  menu.innerHTML=`
    <div class="baby-menu-section-title">Aktivna beba</div>
    ${activeRows}
    <div class="baby-menu-divider"></div>
    <button type="button" data-menu-action="settings"><span class="menu-icon">${icon("settings")}</span><span class="menu-text">Podešavanja<small>Opcije aplikacije</small></span></button>
  `;

  $$("#babyMenu [data-menu-action]").forEach(btn=>{
    btn.onclick=(event)=>{
      event.preventDefault();
      event.stopPropagation();

      const action=btn.dataset.menuAction;

      if(action==="settings"){
        closeBabyMenu();
        openSettingsPage();
        return;
      }

      handleBabyMenuAction(action);
    };
  });

  $$("#babyMenu [data-switch-baby]").forEach(btn=>{
    btn.onclick=(event)=>{
      event.preventDefault();
      event.stopPropagation();
      switchBaby(btn.dataset.switchBaby);
    };
  });
}

function switchBaby(id){
  if(!id || id===selectedBabyId){
    closeBabyMenu();
    return;
  }
  selectedBabyId=id;
  localStorage.setItem("babyDiaryCurrentBabyId",id);
  currentDayId=null;
  openCardId=null;
  currentTab="diary";
  closeBabyMenu();
  renderDiary();
}


// baby menu click isolation hotfix
document.addEventListener("click", function(event){
  if(event.target.closest("#babyMenu")){
    event.stopPropagation();
  }
}, true);

document.addEventListener("pointerdown", function(event){
  if(event.target.closest("#babyMenu")){
    event.stopPropagation();
  }
}, true);


// settings menu direct delegated finalfix
document.addEventListener("click", function(event){
  const settingsBtn = event.target.closest('#babyMenu [data-menu-action="settings"]');
  if(!settingsBtn) return;

  event.preventDefault();
  event.stopPropagation();

  if(typeof closeBabyMenu === "function") closeBabyMenu();
  if(typeof openSettingsPage === "function") openSettingsPage();
}, true);

function toggleBabyMenu(){
  renderBabyMenu();
  const menu=$("#babyMenu"), backdrop=$("#babyMenuBackdrop"), trigger=$("#babySwitch");
  if(menu?.classList.contains("open")) return closeBabyMenu();
  menu?.classList.add("open");
  backdrop?.classList.add("open");
  trigger?.setAttribute("aria-expanded","true");
}
function closeBabyMenu(){
  $("#babyMenu")?.classList.remove("open");
  $("#babyMenuBackdrop")?.classList.remove("open");
  $("#babySwitch")?.setAttribute("aria-expanded","false");
}
function handleBabyMenuAction(action){
  closeBabyMenu();
  if(action==="addBaby"){
    return openAddBabyModal();
  }
  if(action==="profile") return openProfileModal();
  if(action==="share") return toast("Deljenje dnevnika pedijatru dolazi kasnije.");
  if(action==="settings"){ closeBabyMenu(); openSettingsPage(); return; }
}




function bindSettingsAddBabyButton(){
  const btn=document.getElementById("settingsAddBaby");
  if(!btn) return;

  btn.onclick=(event)=>{
    event.preventDefault();
    event.stopPropagation();
    openAddBabyModal();
  };
}

// robust delegated fallback for Settings Add Baby CTA
document.addEventListener("click", function(event){
  const btn=event.target.closest("#settingsAddBaby");
  if(!btn) return;

  event.preventDefault();
  event.stopPropagation();

  if(typeof openAddBabyModal==="function") openAddBabyModal();
}, true);



function resizeAvatarImage(file, callback){
  const reader=new FileReader();

  reader.onload=()=>{
    const img=new Image();

    img.onload=()=>{
      const maxSize=512;
      const ratio=Math.min(maxSize/img.width, maxSize/img.height, 1);
      const w=Math.round(img.width*ratio);
      const h=Math.round(img.height*ratio);

      const canvas=document.createElement("canvas");
      canvas.width=w;
      canvas.height=h;

      const ctx=canvas.getContext("2d");
      ctx.drawImage(img,0,0,w,h);

      const dataUrl=canvas.toDataURL("image/jpeg",0.82);
      callback(dataUrl);
    };

    img.onerror=()=>{
      callback(reader.result);
    };

    img.src=reader.result;
  };

  reader.readAsDataURL(file);
}


function openAddBabyModal(){
  document.getElementById("addBabyModal")?.remove();

  let avatarData="";

  const modal=document.createElement("div");
  modal.id="addBabyModal";
  modal.className="add-baby-modal-bg open";
  modal.style.display="flex";
  modal.style.zIndex="400";

  modal.innerHTML=`
    <div class="add-baby-modal" style="z-index:401">
      <div class="add-baby-head">
        <div>
          <h2>Dodaj novu bebu</h2>
          <p>Unesi osnovne podatke. Samo ime je obavezno.</p>
        </div>
        <button class="close" id="addBabyClose" type="button">×</button>
      </div>

      <div class="add-baby-avatar-area">
        <div class="add-baby-avatar" id="addBabyAvatarPreview">👶</div>
        <label class="add-baby-upload">
          Dodaj avatar
          <input id="addBabyAvatarInput" type="file" accept="image/*">
        </label>
      </div>

      <label class="field">
        <span>Ime bebe *</span>
        <input class="input" id="addBabyName" placeholder="Unesi ime">
      </label>

      <label class="field">
        <span>Datum rođenja</span>
        <input class="input" id="addBabyBirth" type="date">
      </label>

      <div class="add-baby-actions">
        <button class="add-baby-cancel" id="addBabyCancel" type="button">Otkaži</button>
        <button class="add-baby-save" id="addBabySave" type="button">Sačuvaj</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById("addBabyClose").onclick=closeAddBabyModal;
  document.getElementById("addBabyCancel").onclick=closeAddBabyModal;

  modal.addEventListener("click",(e)=>{
    if(e.target===modal) closeAddBabyModal();
  });

  document.getElementById("addBabyAvatarInput").onchange=(event)=>{
    const file=event.target.files && event.target.files[0];
    if(!file) return;

    resizeAvatarImage(file,(dataUrl)=>{
      avatarData=dataUrl;
      document.getElementById("addBabyAvatarPreview").innerHTML=`<img src="${avatarData}" alt="">`;
    });
  };

  document.getElementById("addBabySave").onclick=()=>{
    const name=document.getElementById("addBabyName").value.trim();
    if(!name) return toast("Ime bebe je obavezno.");

    const baby={
      id:uid("baby"),
      name,
      birthDate:document.getElementById("addBabyBirth").value||"",
      avatar:avatarData||"",
      reminders:[],
      days:[]
    };

    state.babies.push(baby);
    selectedBabyId=baby.id;
    currentDayId=null;
    openCardId=null;
    currentTab="diary";

    localStorage.setItem("babyDiaryCurrentBabyId", baby.id);

    saveState();
    closeAddBabyModal();

    if(document.getElementById("settingsScreen") && typeof renderSettingsBabies==="function"){
      renderSettingsBabies();
      if(typeof bindSettingsAddBabyButton==="function") bindSettingsAddBabyButton();
    }

    renderDiary();
  };

  setTimeout(()=>document.getElementById("addBabyName")?.focus(), 50);
}

function closeAddBabyModal(){
  document.getElementById("addBabyModal")?.remove();
}


function openProfileModal(babyId=null){
  const baby = babyId ? (state.babies||[]).find(b=>b.id===babyId) : getBaby();
  if(!baby) return toast("Beba nije pronađena.");

  if(typeof closeSettingsRowMenus==="function") closeSettingsRowMenus();
  document.getElementById("profileModal")?.remove();

  const modal=document.createElement("div");
  modal.id="profileModal";
  modal.className="profile-modal-bg open";
  modal.style.display="flex";
  modal.style.zIndex="300";
  modal.innerHTML=`
    <div class="profile-modal" style="z-index:301">
      <div class="profile-head">
        <div>
          <h2>Profil bebe</h2>
          <p>Avatar i osnovni podaci.</p>
        </div>
        <button class="close" id="profileClose" type="button">×</button>
      </div>

      <div class="profile-avatar-area">
        <div class="profile-avatar" id="profileAvatarPreview">${baby.avatar ? `<img src="${baby.avatar}" alt="">` : "👶"}</div>
        <label class="profile-upload">
          Promeni avatar
          <input id="profileAvatarInput" type="file" accept="image/*">
        </label>
      </div>

      <label class="field">
        <span>Ime bebe</span>
        <input class="input" id="profileBabyName" value="${baby.name||""}">
      </label>

      <label class="field">
        <span>Datum rođenja</span>
        <input class="input" id="profileBabyBirth" type="date" value="${baby.birthDate||""}">
      </label>

      <div class="profile-actions">
        <button class="profile-cancel" id="profileCancel" type="button">Otkaži</button>
        <button class="profile-save" id="profileSave" type="button">Sačuvaj</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById("profileClose").onclick=closeProfileModal;
  document.getElementById("profileCancel").onclick=closeProfileModal;

  modal.addEventListener("click",(e)=>{
    if(e.target===modal) closeProfileModal();
  });

  const avatarInput=document.getElementById("profileAvatarInput");
  if(avatarInput){
    avatarInput.onchange=(event)=>{
      const file=event.target.files && event.target.files[0];
      if(!file) return;

      resizeAvatarImage(file,(avatarData)=>{
        baby.avatar=avatarData;
        document.getElementById("profileAvatarPreview").innerHTML=`<img src="${baby.avatar}" alt="">`;
      });
    };
  }

  document.getElementById("profileSave").onclick=()=>{
    const name=document.getElementById("profileBabyName").value.trim();
    if(!name) return toast("Ime bebe je obavezno.");

    baby.name=name;
    baby.birthDate=document.getElementById("profileBabyBirth").value || "";

    saveState();
    localStorage.setItem(KEY, JSON.stringify(state));
    closeProfileModal();

    if(document.getElementById("settingsScreen") && typeof renderSettingsBabies==="function"){
      renderSettingsBabies();
    }

    if(baby.id===selectedBabyId){
      renderDiary();
    }
  };
}

function closeProfileModal(){
  document.getElementById("profileModal")?.remove();
}


function openActivityModal(entry=null){
  editingEntry=entry;
  selectedType=entry?entry.type:"breast";
  renderModal();
  $("#modal").classList.add("open");
}
function closeModal(){editingEntry=null;$("#modal").classList.remove("open")}
function renderModal(){
  const t=typeDef(selectedType);
  const a=editingEntry?.activity||{};
  const from=editingEntry?.note.from || nowTime();
  const to=editingEntry?.note.to || "";
  $("#modal").innerHTML=`<div class="modal">
    <div class="modal-head">
      <div><h2>${editingEntry?"Uredi aktivnost":"Dodaj aktivnost"}</h2><p>Izaberi tip aktivnosti i po potrebi promeni vreme.</p></div>
      <button class="close" id="closeModal">×</button>
    </div>
    <div class="modal-section-label">Aktivnosti</div>
    <div class="picker">
      ${types.map(type=>`<button class="type-btn ${type.type===selectedType?"active":""}" data-type="${type.type}"><span class="bubble">${icon(type.icon)}</span>${type.label}</button>`).join("")}
    </div>
    <div class="form">
      <div class="form-grid ${hasDurationActivity(t.type)?"":"instant-form-grid"}">
        <label><span class="field-label">${hasDurationActivity(t.type)?"Početak":"Vreme"}</span><input class="input" id="start" type="time" value="${from}"></label>
        ${hasDurationActivity(t.type)?`<label><span class="field-label">Kraj</span><input class="input" id="end" type="time" value="${to}"></label>`:""}
      </div>
      ${t.type==="breast"?`<div class="checks"><label><input id="left" type="checkbox" ${a.left?"checked":""}> Leva</label><label><input id="right" type="checkbox" ${a.right?"checked":""}> Desna</label></div>`:""}
      ${(t.type==="formula"||t.type==="pump")?`<label><span class="field-label">Količina ml</span><input class="input" id="amount" type="number" inputmode="numeric" value="${a.ml||""}"></label>`:""}
      ${t.type==="diaper"?`<div class="checks"><label><input id="pee" type="checkbox" ${a.pee?"checked":""}> Piškio</label><label><input id="poop" type="checkbox" ${a.poop?"checked":""}> Kakio</label><label><input id="changed" type="checkbox" ${a.changed?"checked":""}> Zamenjena</label></div>`:""}
      ${t.type==="supplements"?`<label><span class="field-label">Naziv suplementa</span><input class="input" id="supplementName" value="${a.name||""}" placeholder="npr. Vitamin D"></label><label><span class="field-label">Količina (opciono)</span><input class="input" id="supplementAmount" value="${a.amount||""}" placeholder="npr. 5 kapi"></label>`:""}
      ${t.type==="walk"?`<div class="empty-card" style="padding:10px 12px;text-align:left;font-size:13px;">Trajanje se računa automatski iz početka i kraja.</div>`:""}
      ${t.type==="note"?`<label><span class="field-label">Detalj</span><input class="input" id="text" value="${a.text||""}"></label>`:""}
      <label><span class="field-label">Napomena</span><textarea id="note" class="input">${a.note||""}</textarea></label>
    </div>
    <div class="error" id="modalError"></div>
    <div class="modal-actions"><button class="cancel" id="cancelModal">Otkaži</button><button class="save" id="saveActivity">Sačuvaj</button></div>

  </div>`;
  $("#closeModal").onclick=closeModal;
  $("#cancelModal").onclick=closeModal;
  $("#saveActivity").onclick=saveActivity;
  $$(".type-btn[data-type]").forEach(btn=>btn.onclick=()=>{selectedType=btn.dataset.type;renderModal();});
}
function saveActivity(){
  const from=$("#start").value;
  const t=typeDef(selectedType);
  const to=hasDurationActivity(t.type) ? ($("#end")?.value||"") : "";
  const err=$("#modalError");
  err.classList.remove("show");
  if(!from){err.textContent="Unesi početno vreme.";err.classList.add("show");return;}
  if(hasDurationActivity(t.type) && invalidRange(from,to)){err.textContent="Kraj mora biti posle početka.";err.classList.add("show");return;}
  const activity={type:selectedType,note:$("#note").value||""};
  if(t.type==="breast"){activity.left=!!$("#left")?.checked;activity.right=!!$("#right")?.checked}
  if(t.type==="formula"||t.type==="pump"){activity.ml=$("#amount")?.value||""}
  if(t.type==="diaper"){activity.pee=!!$("#pee")?.checked;activity.poop=!!$("#poop")?.checked;activity.changed=!!$("#changed")?.checked}
  if(t.type==="supplements"){
    activity.name=$("#supplementName")?.value||"";
    activity.amount=$("#supplementAmount")?.value||"";
  }
  if(t.type==="note"){activity.text=$("#text")?.value||""}
  const day=getCurrentDay();
  if(editingEntry){
    const note=day.notes[editingEntry.noteIndex];
    note.from=from; note.to=to; note.activities[editingEntry.activityIndex]=activity;
    openCardId=editingEntry.id;
  }else{
    const note={id:uid("note"),from,to,createdAt:new Date().toISOString(),activities:[activity]};
    day.notes.push(note);
    openCardId=note.id+"_0";
  }
  day.updatedAt=new Date().toISOString();
  saveState();
  closeModal();
  renderDiary();
}

/* Supabase */
function getFamilyId(){
  let id=localStorage.getItem(FAMILY_ID_KEY);
  if(!id){id="family_"+Date.now()+"_"+Math.random().toString(36).slice(2,10);localStorage.setItem(FAMILY_ID_KEY,id)}
  return id;
}
async function loadSupabaseConfig(){
  try{
    const res=await fetch("/api/config.js",{cache:"no-store"});
    if(!res.ok) return null;
    const cfg=await res.json();
    if(!cfg.supabaseUrl||!cfg.supabaseAnonKey) return null;
    supabaseConfig=cfg; remoteReady=true; return cfg;
  }catch(e){return null}
}
async function supabaseRequest(path,options={}){
  const base=supabaseConfig.supabaseUrl.replace(/\/$/,"");
  const headers={
    "apikey":supabaseConfig.supabaseAnonKey,
    "Authorization":"Bearer "+supabaseConfig.supabaseAnonKey,
    "Content-Type":"application/json",
    ...(options.headers||{})
  };
  const res=await fetch(base+"/rest/v1/"+path,{...options,headers});
  const text=await res.text();
  if(!res.ok) throw new Error(text||res.statusText);
  return text?JSON.parse(text):null;
}
function queueRemoteSave(){
  if(applyingRemote||!remoteReady||!supabaseConfig) return;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(saveRemoteState,500);
}
async function saveRemoteState(){
  if(!remoteReady||!supabaseConfig) return;
  try{
    const clean=JSON.parse(JSON.stringify(state));
    clean.updatedAt=new Date().toISOString();
    await supabaseRequest("app_snapshots?on_conflict=family_id",{
      method:"POST",
      headers:{"Prefer":"resolution=merge-duplicates,return=minimal"},
      body:JSON.stringify({family_id:getFamilyId(),data:clean,updated_at:new Date().toISOString()})
    });
  }catch(e){console.error("saveRemoteState",e)}
}
async function loadRemoteState(){
  const cfg=await loadSupabaseConfig();
  if(!cfg) return;
  try{
    const rows=await supabaseRequest("app_snapshots?family_id=eq."+encodeURIComponent(getFamilyId())+"&select=data,updated_at&limit=1",{method:"GET"});
    if(Array.isArray(rows)&&rows.length&&rows[0].data){
      const remote=normalizeMultiBaby(rows[0].data);
      const localTime=state?.updatedAt?new Date(state.updatedAt).getTime():0;
      const remoteTime=rows[0].updated_at?new Date(rows[0].updated_at).getTime():0;
      if(remote&&remoteTime>localTime){
        applyingRemote=true;
        state=remote;
        localStorage.setItem(KEY,JSON.stringify(state));
        applyingRemote=false;
        render();
      }
    }else{
      await saveRemoteState();
    }
  }catch(e){console.error("loadRemoteState",e)}
}


function renderFatalError(error){
  const message = error && (error.stack || error.message) ? (error.stack || error.message) : String(error);
  document.body.innerHTML = `
    <section class="error-screen">
      <div class="error-card">
        <h1>Preview nije mogao da se učita</h1>
        <p>Ovo je zaštitni prikaz da ne dobiješ prazan ekran.</p>
        <pre>${message.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre>
        <button class="primary" onclick="localStorage.removeItem('${KEY}');location.reload()">Resetuj preview podatke</button>
      </div>
    </section>`;
}

function seedDemoData(){
  const baby={
    id:uid("baby"),
    name:"Timo",
    birthDate:new Date(Date.now()-7*86400000).toISOString().slice(0,10),
    days:[{
      id:uid("day"),
      date:today(),
      updatedAt:new Date().toISOString(),
      notes:[
        {id:uid("note"),from:"00:20",to:"00:40",activities:[{type:"breast",left:true,right:false,note:""}]},
        {id:uid("note"),from:"01:10",to:"",activities:[{type:"diaper",pee:true,poop:false,changed:true,note:"Zamenjena pelena"}]},
        {id:uid("note"),from:"03:00",to:"04:45",activities:[{type:"sleep",note:"Probudio se jednom na kratko."}]},
        {id:uid("note"),from:"05:15",to:"",activities:[{type:"formula",ml:"80",note:""}]}
      ]
    }]
  };
  state={version:2,updatedAt:new Date().toISOString(),babies:[baby]};
  selectedBabyId=baby.id;
  currentDayId=baby.days[0].id;
  localStorage.setItem(KEY,JSON.stringify(state));
  localStorage.setItem("babyDiaryCurrentBabyId",baby.id);
  saveState();
  renderDiary();
}

window.addEventListener("error", function(event){
  renderFatalError(event.error || event.message);
});

window.addEventListener("unhandledrejection", function(event){
  renderFatalError(event.reason || "Unhandled promise rejection");
});


window.addEventListener("load",()=>{
  try{
    render();
    setTimeout(loadRemoteState,300);
  }catch(error){
    renderFatalError(error);
  }
});


// v61 hard reset load marker
window.addEventListener("load", function(){
  document.documentElement.setAttribute("data-v61-js-loaded","true");
});


// Robust create handler for static fallback + rendered onboarding
// v23: owner-aware first-run create handler. This handler must run before the old fallback can create a baby without ownerName.
document.addEventListener("click", function(event){
  const createBtn = event.target.closest("#createBaby, #fallbackCreateBaby");
  if(!createBtn) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  try{
    const ownerInput = document.getElementById("ownerName") || document.getElementById("onboardingPersonName");
    const nameInput = document.getElementById("babyName") || document.getElementById("onboardingBabyName") || document.getElementById("fallbackBabyName");
    const birthInput = document.getElementById("babyBirth") || document.getElementById("fallbackBabyBirth");

    const ownerName = (ownerInput?.value || "").trim();
    const babyName = (nameInput?.value || "").trim();

    ownerInput?.classList.remove("field-error");
    nameInput?.classList.remove("field-error");

    if(!ownerName){
      ownerInput?.classList.add("field-error");
      ownerInput?.focus();
      toast("Unesi svoje ime.");
      return;
    }
    if(!babyName){
      nameInput?.classList.add("field-error");
      nameInput?.focus();
      toast("Unesi ime bebe.");
      return;
    }

    localStorage.setItem(typeof CLOUD_PARENT_KEY !== "undefined" ? CLOUD_PARENT_KEY : "babyDiaryParentName", ownerName);
    localStorage.setItem("babyDiaryOwnerNameV1", ownerName);

    const baby = {
      id: uid("baby"),
      name: babyName,
      birthDate: birthInput?.value || "",
      avatar: "",
      ownerName,
      cloud: {},
      reminders: [],
      days: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    state = {
      version: 2,
      ownerName,
      updatedAt: new Date().toISOString(),
      babies: [baby]
    };

    selectedBabyId = baby.id;
    currentDayId = null;
    openCardId = null;
    currentTab = "diary";

    localStorage.setItem(KEY, JSON.stringify(state));
    localStorage.setItem("babyDiaryCurrentBabyId", baby.id);

    renderDiary();
  }catch(error){
    renderFatalError(error);
  }
}, true);


// bottom sheet backdrop close
document.addEventListener("click", function(event){
  const bg = event.target.closest(".modal-bg");
  if(!bg) return;
  if(event.target === bg){
    if(typeof closeModal === "function") closeModal();
  }
});


// settings popover scroll close
window.addEventListener("resize",()=>closeSettingsRowMenus?.());
window.addEventListener("scroll",()=>closeSettingsRowMenus?.(), true);


window.__testOpenProfileModal=function(){
  const baby=(state.babies||[])[0];
  if(!baby) return "no baby";
  openProfileModal(baby.id);
  return !!document.getElementById("profileModal");
};





// v12 reminder future time bugfix

// v12 navigation and reminder toast bugfix marker

// v12 final clean bugfix marker

// v12 reminder datetime comparison fix

// v12 hard final fix marker

// v12 repaired navigation and future reminder fix

// v12 active reminder style fix marker



function countActivitiesFromState(data){
  return (data.babies||[]).reduce((sum,baby)=>{
    return sum + (baby.days||[]).reduce((daySum,day)=>{
      return daySum + (day.notes||[]).reduce((noteSum,note)=>noteSum + ((note.activities||[]).length),0);
    },0);
  },0);
}

function countDaysFromState(data){
  return (data.babies||[]).reduce((sum,baby)=>sum + ((baby.days||[]).length),0);
}

function countRemindersFromState(data){
  return (data.babies||[]).reduce((sum,baby)=>sum + ((baby.reminders||[]).length),0);
}

function exportAllData(){
  try{
    const payload={
      app:"Baby Diary",
      exportType:"baby-diary-data-transfer",
      exportedAt:new Date().toISOString(),
      version:state.version||2,
      data:state
    };

    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const date=localISODate(new Date());
    const filename=`baby-diary-podaci-${date}.json`;

    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");
    link.href=url;
    link.download=filename;
    document.body.appendChild(link);
    link.click();

    setTimeout(()=>{
      URL.revokeObjectURL(url);
      link.remove();
    },250);

    showTransferInfoModal(
      "Podaci su izvezeni",
      "Fajl sa podacima sačuvaj na sigurnom mestu, na primer iCloud, Google Drive ili računar."
    );
  }catch(error){
    console.error(error);
    toast("Izvoz podataka nije uspeo.");
  }
}

function handleImportFileSelected(event){
  const file=event.target.files && event.target.files[0];
  event.target.value="";
  if(!file) return;

  const reader=new FileReader();

  reader.onload=()=>{
    try{
      const raw=JSON.parse(reader.result);
      const imported=raw?.data ? raw.data : raw;
      const normalized=normalizeMultiBaby(imported);

      if(!normalized || !Array.isArray(normalized.babies) || !normalized.babies.length){
        throw new Error("Invalid Baby Diary data");
      }

      openImportPreviewModal(normalized);
    }catch(error){
      console.error(error);
      showTransferInfoModal(
        "Fajl nije prepoznat",
        "Izaberi fajl koji je prethodno izvezen iz Baby Diary aplikacije."
      );
    }
  };

  reader.onerror=()=>{
    showTransferInfoModal("Uvoz nije uspeo","Nismo mogli da pročitamo izabrani fajl.");
  };

  reader.readAsText(file);
}

function cloneImportedBaby(baby){
  const cloned=JSON.parse(JSON.stringify(baby));
  cloned.id=uid("baby");
  cloned.name=cloned.name ? cloned.name : "Uvezena beba";
  cloned.days=Array.isArray(cloned.days)?cloned.days:[];
  cloned.reminders=Array.isArray(cloned.reminders)?cloned.reminders:[];
  cloned.avatar=cloned.avatar||"";
  return cloned;
}

function openImportPreviewModal(importedState){
  document.getElementById("importPreviewModal")?.remove();

  const hasExisting=(state.babies||[]).length>0;
  const babyNames=(importedState.babies||[]).map(b=>b.name||"Beba").join(", ");
  const days=countDaysFromState(importedState);
  const activities=countActivitiesFromState(importedState);
  const reminders=countRemindersFromState(importedState);

  const modal=document.createElement("div");
  modal.id="importPreviewModal";
  modal.className="transfer-sheet-bg open";
  modal.innerHTML=`
    <div class="transfer-sheet">
      <div class="modal-head">
        <div>
          <h2>Uvoz podataka</h2>
          <p>Proveri pronađene podatke pre uvoza.</p>
        </div>
        <button class="close" id="closeImportPreview" type="button">×</button>
      </div>

      <div class="import-summary">
        <strong>Pronađeni podaci</strong>
        <div>👶 ${escapeHtml(babyNames)}</div>
        <div>📅 ${days} ${days===1?"dan evidencije":"dana evidencije"}</div>
        <div>🍼 ${activities} ${activities===1?"aktivnost":"aktivnosti"}</div>
        <div>⏰ ${reminders} ${reminders===1?"podsetnik":"podsetnika"}</div>
      </div>

      ${hasExisting ? `
        <div class="import-options">
          <p>Kako želiš da uvezeš podatke?</p>
          <label><input type="radio" name="importMode" value="replace" checked> Zameni postojeće podatke</label>
          <small>Trenutni podaci biće zamenjeni podacima iz fajla.</small>
          <label><input type="radio" name="importMode" value="append"> Dodaj kao novu bebu</label>
          <small>Podaci iz fajla biće dodati uz postojeće bebe.</small>
        </div>
      ` : `
        <p class="transfer-note">Aplikacija trenutno nema podatke, pa će pronađeni podaci biti učitani direktno.</p>
      `}

      <div class="modal-actions">
        <button class="cancel" id="cancelImportPreview" type="button">Otkaži</button>
        <button class="save" id="confirmImportPreview" type="button">Uvezi podatke</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const close=()=>modal.remove();
  document.getElementById("closeImportPreview").onclick=close;
  document.getElementById("cancelImportPreview").onclick=close;
  modal.addEventListener("click",(event)=>{ if(event.target===modal) close(); });

  document.getElementById("confirmImportPreview").onclick=()=>{
    const mode=hasExisting ? (document.querySelector('input[name="importMode"]:checked')?.value||"replace") : "replace";

    if(mode==="replace" && hasExisting){
      openReplaceDataConfirm(importedState);
    }else{
      applyImportedData(importedState,mode);
    }
  };
}

function openReplaceDataConfirm(importedState){
  document.getElementById("replaceDataConfirm")?.remove();

  const modal=document.createElement("div");
  modal.id="replaceDataConfirm";
  modal.className="confirm-reminder-bg open";
  modal.innerHTML=`
    <div class="confirm-reminder-card">
      <h2>Zameniti postojeće podatke?</h2>
      <p>Trenutni podaci u aplikaciji biće zamenjeni podacima iz izabranog fajla.</p>
      <div class="confirm-reminder-actions">
        <button type="button" class="cancel" id="cancelReplaceData">Otkaži</button>
        <button type="button" class="danger-action" id="confirmReplaceData">Zameni podatke</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById("cancelReplaceData").onclick=()=>modal.remove();
  document.getElementById("confirmReplaceData").onclick=()=>applyImportedData(importedState,"replace");
  modal.addEventListener("click",(event)=>{ if(event.target===modal) modal.remove(); });
}

function applyImportedData(importedState,mode){
  if(mode==="append"){
    const importedBabies=(importedState.babies||[]).map(cloneImportedBaby);
    state.babies=Array.isArray(state.babies)?state.babies:[];
    state.babies.push(...importedBabies);
    if(importedBabies[0]){
      selectedBabyId=importedBabies[0].id;
      localStorage.setItem("babyDiaryCurrentBabyId",selectedBabyId);
    }
  }else{
    state=normalizeMultiBaby(importedState);
    selectedBabyId=state.babies[0]?.id||null;
    if(selectedBabyId) localStorage.setItem("babyDiaryCurrentBabyId",selectedBabyId);
  }

  currentDayId=null;
  openCardId=null;
  currentTab="diary";

  saveState();
  document.getElementById("transferDataSheet")?.remove();
  document.getElementById("importPreviewModal")?.remove();
  document.getElementById("replaceDataConfirm")?.remove();

  renderDiary();
  showTransferInfoModal("Podaci su uvezeni","Podaci su uspešno učitani u aplikaciju.");
}

function showTransferInfoModal(title,message){
  document.getElementById("transferInfoModal")?.remove();

  const modal=document.createElement("div");
  modal.id="transferInfoModal";
  modal.className="confirm-reminder-bg open";
  modal.innerHTML=`
    <div class="confirm-reminder-card">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      <div class="confirm-reminder-actions single">
        <button type="button" class="save" id="closeTransferInfo">U redu</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.getElementById("closeTransferInfo").onclick=()=>modal.remove();
  modal.addEventListener("click",(event)=>{ if(event.target===modal) modal.remove(); });
}

// v13 transfer data delegated handler
document.addEventListener("click", function(event){
  const btn = event.target.closest("#transferData");
  if(!btn) return;

  event.preventDefault();
  event.stopPropagation();

  if(typeof openTransferDataSheet === "function"){
    openTransferDataSheet();
  }
}, true);



function currentBabyNameForInvite(){
  const baby=getBaby();
  return baby?.name || "bebe";
}

function getOrCreateInviteCode(){
  let code=localStorage.getItem("babyDiaryInviteCode");
  return code || "KREIRAJ-POZIV";
}

function inviteLinkFromCode(code){
  const base=location.origin || "https://timov-dnevnik.vercel.app";
  return `${base}/?join=${encodeURIComponent(code)}`;
}

function inviteMessage(){
  const code=getOrCreateInviteCode();
  const link=inviteLinkFromCode(code);
  const babyName=currentBabyNameForInvite();

  return `👶 Poziv za Baby Diary

Pozivam te da zajedno pratimo dnevnik za ${babyName}.

1. Otvori ovaj link:
${link}

2. Ako nemaš aplikaciju, Baby Diary će se otvoriti u browseru.
Kada se otvori pozivnica, klikni "Poveži dnevnik".
Posle toga možeš da dodaš aplikaciju na Home Screen.

Rezervni kod: ${code}`;
}

async function shareInvite(){
  try{
    await safeInviteNamePrompt();

    const code=await createCloudInvite();
    localStorage.setItem("babyDiaryInviteCode",code);

    const text=inviteMessage();
    const url=inviteLinkFromCode(code);

    if(navigator.share){
      try{
        await navigator.share({
          title:"Poziv za Baby Diary",
          text,
          url
        });
        return;
      }catch(error){}
    }

    try{
      await navigator.clipboard.writeText(text);
      toast("Pozivnica je kopirana.");
    }catch(error){
      showInviteTextModal(text);
    }
  }catch(error){
    console.error(error);
    showTransferInfoModal("Deljenje nije uspelo", error.message || "Pokušaj ponovo.");
  }
}


function personInitials(name){
  const clean=String(name||"Osoba").trim();
  const parts=clean.split(/\s+/).filter(Boolean);
  if(!parts.length) return "O";
  if(parts.length===1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0]+parts[1][0]).toUpperCase();
}

function getAccessPeople(){
  state.cloud=state.cloud||{};
  state.cloud.people=Array.isArray(state.cloud.people)?state.cloud.people:[];
  return state.cloud.people;
}

function mergeAccessPeople(localPeople=[],remotePeople=[]){
  const map=new Map();

  [...(remotePeople||[]), ...(localPeople||[])].forEach(person=>{
    if(!person) return;
    const key=person.deviceId || person.id || person.name;
    if(!key) return;

    const existing=map.get(key);
    if(!existing){
      map.set(key,{...person});
      return;
    }

    const existingSeen=existing.lastSeenAt ? new Date(existing.lastSeenAt).getTime() : 0;
    const personSeen=person.lastSeenAt ? new Date(person.lastSeenAt).getTime() : 0;

    map.set(key,{
      ...existing,
      ...person,
      id: existing.id || person.id,
      name: person.name || existing.name || "Osoba",
      deviceId: person.deviceId || existing.deviceId,
      role: person.role || existing.role || "editor",
      joinedAt: existing.joinedAt || person.joinedAt || new Date().toISOString(),
      lastSeenAt: personSeen>=existingSeen ? (person.lastSeenAt||existing.lastSeenAt) : (existing.lastSeenAt||person.lastSeenAt)
    });
  });

  return Array.from(map.values());
}

function ensureAccessPeople(){
  state.cloud=state.cloud||{};
  state.cloud.people=Array.isArray(state.cloud.people)?state.cloud.people:[];
  const deviceId=getDeviceId();
  const name=getParentName();
  let me=state.cloud.people.find(p=>p.deviceId===deviceId);
  if(!me){
    me={
      id:"person_"+Date.now()+"_"+Math.random().toString(36).slice(2,8),
      name,
      deviceId,
      role:"editor",
      joinedAt:new Date().toISOString(),
      lastSeenAt:new Date().toISOString()
    };
    state.cloud.people.push(me);
  }else{
    me.name=name;
    me.lastSeenAt=new Date().toISOString();
  }
  return state.cloud.people;
}

function addOrUpdateAccessPerson(name,deviceId=getDeviceId()){
  state.cloud=state.cloud||{};
  state.cloud.people=Array.isArray(state.cloud.people)?state.cloud.people:[];
  const finalName=(name||getParentName()||"Osoba").trim()||"Osoba";
  let person=state.cloud.people.find(p=>p.deviceId===deviceId);
  if(!person){
    person={
      id:"person_"+Date.now()+"_"+Math.random().toString(36).slice(2,8),
      name:finalName,
      deviceId,
      role:"editor",
      joinedAt:new Date().toISOString(),
      lastSeenAt:new Date().toISOString()
    };
    state.cloud.people.push(person);
  }else{
    person.name=finalName;
    person.lastSeenAt=new Date().toISOString();
  }
  return person;
}

function renderAccessPeople(){
  const baby=getBaby();
  const people=ensureBabyAccessPeople(baby);
  const currentDeviceId=getDeviceId();
  return `<div class="access-people-block">
    <div class="access-people-head">
      <strong>Osobe sa pristupom (${people.length})</strong>
      <small>Mogu da prate i upisuju ovaj dnevnik.</small>
    </div>
    <div class="access-people-chips">
      ${people.map(person=>`
        <button class="access-person-chip" type="button" data-person-id="${person.id}">
          <span class="access-avatar">${escapeHtml(personInitials(person.name))}</span>
          <span>
            <strong>${escapeHtml(person.name||"Osoba")}${person.deviceId===currentDeviceId?" (Ti)":""}</strong>
            <small>Može da upisuje</small>
          </span>
        </button>
      `).join("")}
    </div>
  </div>`;
}

function openAccessPersonInfo(personId){
  const people=ensureAccessPeople();
  const person=people.find(p=>p.id===personId);
  if(!person) return;
  document.getElementById("accessPersonInfo")?.remove();

  const isMe=person.deviceId===getDeviceId();
  const modal=document.createElement("div");
  modal.id="accessPersonInfo";
  modal.className="confirm-reminder-bg open";
  modal.innerHTML=`
    <div class="confirm-reminder-card">
      <div class="access-person-detail">
        <span class="access-avatar big">${escapeHtml(personInitials(person.name))}</span>
        <h2>${escapeHtml(person.name||"Osoba")}${isMe?" (Ti)":""}</h2>
        <p>Može da prati i upisuje dnevnik.</p>
        <small>Povezan/a od: ${person.joinedAt ? fmt(person.joinedAt.slice(0,10)) : "nepoznato"}</small>
      </div>
      <div class="confirm-reminder-actions single">
        <button type="button" class="save" id="closeAccessPersonInfo">U redu</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById("closeAccessPersonInfo").onclick=()=>modal.remove();
  modal.addEventListener("click",(event)=>{ if(event.target===modal) modal.remove(); });
}

function openShareDiarySheet(){
  document.getElementById("shareDiarySheet")?.remove();

  const code=getOrCreateInviteCode();
  const link=inviteLinkFromCode(code);
  const babyName=currentBabyNameForInvite();

  const sheet=document.createElement("div");
  sheet.id="shareDiarySheet";
  sheet.className="share-sheet-bg open";
  sheet.innerHTML=`
    <div class="share-sheet">
      <div class="modal-head">
        <div>
          <h2>Deljenje dnevnika</h2>
          <p>Podeli dnevnik sa drugom osobom kako biste zajedno pratili i upisujete dnevnik.</p>
        </div>
        <button class="close" id="closeShareDiarySheet" type="button">×</button>
      </div>

      <div class="share-hero">
        <div class="share-illustration">👶<span>🔗</span></div>
        <strong>Poziv za ${escapeHtml(babyName)}</strong>
        <small>Druga osoba će dobiti link i uputstvo kako da otvori aplikaciju.</small>
      </div>

      <button class="primary share-primary" id="sendInviteButton" type="button">Pošalji pozivnicu</button>

      <button class="share-secondary" id="showInviteCode" type="button">Prikaži kod</button>

      <div class="invite-code-box hidden" id="inviteCodeBox">
        <span>Kod za povezivanje</span>
        <strong>${escapeHtml(code)}</strong>
        <small>${escapeHtml(link)}</small>
        <button type="button" id="copyInviteMessage">Kopiraj poruku</button>
      </div>

      <p class="share-note">Napomena: ovo je v2.0 UX osnova. Prava sinhronizacija između dva telefona zahteva uključeno cloud povezivanje.</p>
    </div>
  `;

  document.body.appendChild(sheet);

  const close=()=>sheet.remove();
  document.getElementById("closeShareDiarySheet").onclick=close;
  sheet.addEventListener("click",(event)=>{ if(event.target===sheet) close(); });

  document.getElementById("sendInviteButton").onclick=shareInvite;
  document.getElementById("showInviteCode").onclick=()=>{
    document.getElementById("inviteCodeBox").classList.toggle("hidden");
  };
  document.getElementById("copyInviteMessage").onclick=async()=>{
    const text=inviteMessage();
    try{
      await navigator.clipboard.writeText(text);
      toast("Poruka je kopirana.");
    }catch(error){
      showInviteTextModal(text);
    }
  };
}

function showInviteTextModal(text){
  document.getElementById("inviteTextModal")?.remove();

  const modal=document.createElement("div");
  modal.id="inviteTextModal";
  modal.className="confirm-reminder-bg open";
  modal.innerHTML=`
    <div class="confirm-reminder-card">
      <h2>Kopiraj pozivnicu</h2>
      <p>Pošalji ovu poruku drugoj osobi.</p>
      <textarea class="input invite-textarea" readonly>${escapeHtml(text)}</textarea>
      <div class="confirm-reminder-actions single">
        <button type="button" class="save" id="closeInviteText">U redu</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.getElementById("closeInviteText").onclick=()=>modal.remove();
  modal.addEventListener("click",(event)=>{ if(event.target===modal) modal.remove(); });
}

// v2.0 share diary delegated handler
document.addEventListener("click", function(event){
  const btn=event.target.closest("#shareDiary");
  if(!btn) return;

  event.preventDefault();
  event.stopPropagation();

  openShareDiarySheet();
}, true);



/* Baby Diary v2.0 Cloud Sharing */
const CLOUD_FAMILY_KEY="babyDiaryCloudFamilyId";
const CLOUD_PARENT_KEY="babyDiaryParentName";
const CLOUD_LAST_REMOTE_KEY="babyDiaryLastRemoteUpdatedAt";
let cloudReady=false;
let cloudConfig=null;
let cloudSyncTimer=null;
let lastRemoteUpdatedAt=localStorage.getItem(CLOUD_LAST_REMOTE_KEY)||"";

function getDeviceId(){
  let id=localStorage.getItem("babyDiaryDeviceId");
  if(!id){
    id="device_"+Date.now()+"_"+Math.random().toString(36).slice(2,10);
    localStorage.setItem("babyDiaryDeviceId",id);
  }
  return id;
}

function getParentName(){
  return localStorage.getItem(CLOUD_PARENT_KEY)||"Osoba";
}

function setParentName(name){
  const clean=(name||"").trim()||"Osoba";
  localStorage.setItem(CLOUD_PARENT_KEY,clean);

  try{
    const baby=getBaby();
    if(baby?.cloud?.sharedBabyId && typeof addOrUpdateBabyAccessPerson==="function"){
      addOrUpdateBabyAccessPerson(baby,clean,getDeviceId());
      localStorage.setItem(KEY,JSON.stringify(state));
    }else if(typeof addOrUpdateAccessPerson==="function"){
      addOrUpdateAccessPerson(clean,getDeviceId());
      localStorage.setItem(KEY,JSON.stringify(state));
    }
  }catch(error){}
}

function getCloudFamilyId(){
  return localStorage.getItem(CLOUD_FAMILY_KEY)||localStorage.getItem("babyDiaryFamilyId")||"";
}

function setCloudFamilyId(id){
  if(id){
    localStorage.setItem(CLOUD_FAMILY_KEY,id);
    localStorage.setItem("babyDiaryFamilyId",id);
  }
}

async function loadSupabaseConfig(){
  if(cloudConfig) return cloudConfig;
  try{
    const res=await fetch("/api/config.js",{cache:"no-store"});
    if(!res.ok) return null;
    const cfg=await res.json();
    if(!cfg.supabaseUrl||!cfg.supabaseAnonKey) return null;
    cloudConfig=cfg;
    cloudReady=true;
    return cfg;
  }catch(error){
    console.warn("Supabase config not available",error);
    return null;
  }
}

async function supabaseFetch(path,options={}){
  const cfg=await loadSupabaseConfig();
  if(!cfg) throw new Error("Supabase nije podešen.");

  const base=cfg.supabaseUrl.replace(/\/$/,"");
  const headers={
    "apikey":cfg.supabaseAnonKey,
    "Authorization":"Bearer "+cfg.supabaseAnonKey,
    "Content-Type":"application/json",
    ...(options.headers||{})
  };

  const res=await fetch(base+"/rest/v1/"+path,{...options,headers});
  const text=await res.text();

  if(!res.ok) throw new Error(text||res.statusText);
  return text ? JSON.parse(text) : null;
}

function prepareStateForCloud(){
  ensureAccessPeople();
  const clean=JSON.parse(JSON.stringify(state));
  clean.updatedAt=new Date().toISOString();
  clean.cloud={
    ...(clean.cloud||{}),
    deviceId:getDeviceId(),
    updatedBy:getParentName()
  };
  return clean;
}

async function ensureCloudFamilyCreated(){
  let familyId=getCloudFamilyId();
  if(!familyId){
    familyId="family_"+Date.now()+"_"+Math.random().toString(36).slice(2,10);
    setCloudFamilyId(familyId);
  addOrUpdateAccessPerson(getParentName(),getDeviceId());
  }

  const clean=prepareStateForCloud();
  const updatedAt=new Date().toISOString();

  await supabaseFetch("app_snapshots?on_conflict=family_id",{
    method:"POST",
    headers:{"Prefer":"resolution=merge-duplicates,return=representation"},
    body:JSON.stringify({
      family_id:familyId,
      data:clean,
      updated_at:updatedAt,
      updated_by:getParentName()
    })
  });

  state.updatedAt=updatedAt;
  localStorage.setItem(KEY,JSON.stringify(state));
  localStorage.setItem(CLOUD_LAST_REMOTE_KEY,updatedAt);

  startCloudPolling();
  return familyId;
}


function setCloudEvent(type,label){
  state.cloud={
    ...(state.cloud||{}),
    lastEvent:{
      id:"event_"+Date.now()+"_"+Math.random().toString(36).slice(2,8),
      type,
      label:label||"",
      by:getParentName(),
      deviceId:getDeviceId(),
      at:new Date().toISOString()
    }
  };
}

async function saveCloudState(){
  const familyId=getCloudFamilyId();
  if(!familyId) return;

  try{
    let remotePeople=[];
    try{
      const rows=await supabaseFetch(
        "app_snapshots?family_id=eq."+encodeURIComponent(familyId)+"&select=data&limit=1",
        {method:"GET"}
      );
      remotePeople=Array.isArray(rows)&&rows[0]?.data?.cloud?.people ? rows[0].data.cloud.people : [];
    }catch(error){}

    state.cloud=state.cloud||{};
    state.cloud.people=mergeAccessPeople(state.cloud.people||[],remotePeople);
    ensureAccessPeople();

    const clean=prepareStateForCloud();
    const updatedAt=new Date().toISOString();

    await supabaseFetch("app_snapshots?on_conflict=family_id",{
      method:"POST",
      headers:{"Prefer":"resolution=merge-duplicates,return=minimal"},
      body:JSON.stringify({
        family_id:familyId,
        data:clean,
        updated_at:updatedAt,
        updated_by:getParentName()
      })
    });

    state.updatedAt=updatedAt;
    localStorage.setItem(KEY,JSON.stringify(state));

    lastRemoteUpdatedAt=updatedAt;
    localStorage.setItem(CLOUD_LAST_REMOTE_KEY,updatedAt);
  }catch(error){
    console.warn("Cloud save failed",error);
  }
}

function queueCloudSave(){
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer=setTimeout(saveCloudState,650);
}

async function loadCloudState(showToast=true){
  const familyId=getCloudFamilyId();
  if(!familyId) return;

  try{
    const rows=await supabaseFetch(
      "app_snapshots?family_id=eq."+encodeURIComponent(familyId)+"&select=data,updated_at,updated_by&limit=1",
      {method:"GET"}
    );

    if(!Array.isArray(rows)||!rows.length||!rows[0].data) return;

    const remoteData=rows[0].data;
    const remoteUpdatedAt=rows[0].updated_at||remoteData.updatedAt||"";
    const remoteTime=remoteUpdatedAt?new Date(remoteUpdatedAt).getTime():0;
    const lastSeenTime=lastRemoteUpdatedAt?new Date(lastRemoteUpdatedAt).getTime():0;

    const currentPeople=state?.cloud?.people||[];
    const remotePeople=remoteData?.cloud?.people||[];
    const mergedPeople=mergeAccessPeople(currentPeople,remotePeople);
    const peopleChanged=JSON.stringify(currentPeople)!==JSON.stringify(mergedPeople);

    if(!remoteTime || remoteTime<=lastSeenTime){
      if(peopleChanged){
        state.cloud=state.cloud||{};
        state.cloud.people=mergedPeople;
        localStorage.setItem(KEY,JSON.stringify(state));
        renderDiary();
      }
      return;
    }

    const remoteCloud=remoteData.cloud||{};
    const remoteEvent=remoteCloud.lastEvent||null;
    const isOwnUpdate=remoteCloud.deviceId===getDeviceId() || remoteEvent?.deviceId===getDeviceId();

    state=normalizeMultiBaby(remoteData);
    state.cloud=state.cloud||{};
    state.cloud.people=mergeAccessPeople(currentPeople, state.cloud.people||[]);
    state.updatedAt=remoteUpdatedAt;

    localStorage.setItem(KEY,JSON.stringify(state));
    lastRemoteUpdatedAt=remoteUpdatedAt;
    localStorage.setItem(CLOUD_LAST_REMOTE_KEY,remoteUpdatedAt);

    renderDiary();

    if(showToast && !isOwnUpdate){
      showCloudUpdateToast(remoteEvent, rows[0].updated_by||remoteCloud.updatedBy||"Druga osoba");
    }
  }catch(error){
    console.warn("Cloud load failed",error);
  }
}

function startCloudPolling(){
  if(window.__babyDiaryCloudPollingStarted) return;
  window.__babyDiaryCloudPollingStarted=true;

  if(getCloudFamilyId()){
    loadCloudState(false);
  }

  setInterval(()=>{
    if(getCloudFamilyId()){
      loadCloudState(true);
    }
  },3000);

  document.addEventListener("visibilitychange",()=>{
    if(!document.hidden && getCloudFamilyId()){
      loadCloudState(true);
    }
  });

  window.addEventListener("focus",()=>{
    if(getCloudFamilyId()){
      loadCloudState(true);
    }
  });
}

function showCloudUpdateToast(eventOrName,parentNameFallback){
  document.getElementById("cloudUpdateToast")?.remove();

  const event=typeof eventOrName==="object" && eventOrName ? eventOrName : null;
  const personName=event?.by || parentNameFallback || eventOrName || "Druga osoba";

  let title="Nova izmena u dnevniku";
  let message=`${personName} je ažurirao/la dnevnik.`;

  if(event?.type==="joined"){
    title="Osoba je povezana";
    message=`${personName} se povezao/la sa dnevnikom.`;
  }

  const toastEl=document.createElement("div");
  toastEl.id="cloudUpdateToast";
  toastEl.className="cloud-update-toast show";
  toastEl.innerHTML=`
    <div>
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(message)}</span>
    </div>
    <button type="button" id="openCloudDiary">Otvori</button>
  `;

  document.body.appendChild(toastEl);
  document.getElementById("openCloudDiary").onclick=()=>{
    currentTab="diary";
    toastEl.remove();
    renderDiary();
  };

  setTimeout(()=>{
    toastEl.classList.remove("show");
    setTimeout(()=>toastEl.remove(),220);
  },6500);
}

function createInviteCode(){
  const babyName=currentBabyNameForInvite();
  const prefix=(babyName||"BABY").toUpperCase().replace(/[^A-ZČĆŽŠĐ0-9]/g,"").slice(0,4)||"BABY";
  const suffix=Math.floor(1000+Math.random()*9000);
  return `${prefix}-${suffix}`;
}

async function createCloudInvite(){
  addOrUpdateAccessPerson(getParentName(),getDeviceId());
  const familyId=await ensureCloudFamilyCreated();
  const code=createInviteCode();

  await supabaseFetch("invite_codes",{
    method:"POST",
    headers:{"Prefer":"return=representation"},
    body:JSON.stringify({
      code,
      family_id:familyId,
      baby_name:currentBabyNameForInvite(),
      created_by:getParentName()
    })
  });

  await saveCloudState();
  startCloudPolling();
  return code;
}

async function connectWithInviteCode(code,mode="replace"){
  const cleanCode=String(code||"").trim().toUpperCase();
  if(!cleanCode) throw new Error("Unesi kod.");

  const invites=await supabaseFetch(
    "invite_codes?code=eq."+encodeURIComponent(cleanCode)+"&select=code,family_id,baby_name,created_by&limit=1",
    {method:"GET"}
  );

  if(!Array.isArray(invites)||!invites.length){
    throw new Error("Kod nije pronađen.");
  }

  const familyId=invites[0].family_id;
  const rows=await supabaseFetch(
    "app_snapshots?family_id=eq."+encodeURIComponent(familyId)+"&select=data,updated_at,updated_by&limit=1",
    {method:"GET"}
  );

  if(!Array.isArray(rows)||!rows.length||!rows[0].data){
    throw new Error("Dnevnik nije pronađen.");
  }

  const previousPeople=state?.cloud?.people||[];
  const remoteState=normalizeMultiBaby(rows[0].data);

  if(mode==="append" && (state.babies||[]).length){
    const importedBabies=(remoteState.babies||[]).map(cloneImportedBaby);
    state.babies.push(...importedBabies);
    selectedBabyId=importedBabies[0]?.id||selectedBabyId;
    state.cloud=state.cloud||{};
    state.cloud.people=mergeAccessPeople(previousPeople, remoteState.cloud?.people||[]);
  }else{
    state=remoteState;
    selectedBabyId=state.babies[0]?.id||null;
    state.cloud=state.cloud||{};
    state.cloud.people=mergeAccessPeople(previousPeople, state.cloud.people||[]);
  }

  setCloudFamilyId(familyId);
  addOrUpdateAccessPerson(getParentName(),getDeviceId());

  if(selectedBabyId) localStorage.setItem("babyDiaryCurrentBabyId",selectedBabyId);

  state.updatedAt=rows[0].updated_at||new Date().toISOString();
  lastRemoteUpdatedAt=state.updatedAt;
  localStorage.setItem(KEY,JSON.stringify(state));
  localStorage.setItem(CLOUD_LAST_REMOTE_KEY,lastRemoteUpdatedAt);

  currentTab="diary";
  currentDayId=null;
  openCardId=null;

  renderDiary();
  startCloudPolling();

  setCloudEvent("joined","Osoba se povezala");
  await saveCloudState();

  showTransferInfoModal("Dnevnik je povezan","Sada obe osobe mogu da prate i upisuju isti dnevnik.");
}



function openConnectCodeModal(){
  document.getElementById("connectCodeModal")?.remove();

  const hasExisting=(state.babies||[]).length>0;
  const modal=document.createElement("div");
  modal.id="connectCodeModal";
  modal.className="confirm-reminder-bg open";
  modal.innerHTML=`
    <div class="confirm-reminder-card">
      <h2>Poveži dnevnik</h2>
      <p>Unesi kod koji ti je poslao druga osoba.</p>
      <input class="input" id="connectCodeInput" placeholder="npr. TIMO-4829" style="margin-top:12px;text-transform:uppercase">

      ${hasExisting ? `
        <div class="import-options">
          <p>Na ovom telefonu već postoje podaci.</p>
          <label><input type="radio" name="connectMode" value="replace" checked> Zameni moje podatke deljenim dnevnikom</label>
          <small>Koristi ako želiš isti dnevnik kao druga osoba.</small>
          <label><input type="radio" name="connectMode" value="append"> Dodaj deljeni dnevnik kao novu bebu</label>
          <small>Najbezbednije ako nisi siguran/na.</small>
        </div>
      ` : ""}

      <div class="confirm-reminder-actions">
        <button type="button" class="cancel" id="cancelConnectCode">Otkaži</button>
        <button type="button" class="save" id="confirmConnectCode">Poveži</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById("cancelConnectCode").onclick=()=>modal.remove();
  modal.addEventListener("click",(event)=>{ if(event.target===modal) modal.remove(); });

  document.getElementById("confirmConnectCode").onclick=async()=>{
    const code=document.getElementById("connectCodeInput").value;
    const parentName=prompt("Kako želiš da se tvoje ime prikazuje drugoj osobi?", getParentName());
    if(parentName) setParentName(parentName);

    const mode=hasExisting ? (document.querySelector('input[name="connectMode"]:checked')?.value||"replace") : "replace";

    try{
      await connectWithInviteCode(code,mode);
      modal.remove();
      document.getElementById("shareDiarySheet")?.remove();
    }catch(error){
      showTransferInfoModal("Povezivanje nije uspelo", error.message || "Proveri kod i pokušaj ponovo.");
    }
  };
}



function getJoinCodeFromUrl(){
  try{
    const params=new URLSearchParams(window.location.search);
    const code=params.get("join");
    return code ? code.trim().toUpperCase() : "";
  }catch(error){
    return "";
  }
}

function clearJoinCodeFromUrl(){
  try{
    const url=new URL(window.location.href);
    url.searchParams.delete("join");
    window.history.replaceState({},document.title,url.pathname+url.search+url.hash);
  }catch(error){}
}

async function previewInviteByCode(code){
  const cleanCode=String(code||"").trim().toUpperCase();
  if(!cleanCode) throw new Error("Kod nije pronađen.");

  const invites=await supabaseFetch(
    "invite_codes?code=eq."+encodeURIComponent(cleanCode)+"&select=code,family_id,baby_name,created_by&limit=1",
    {method:"GET"}
  );

  if(!Array.isArray(invites)||!invites.length){
    throw new Error("Pozivnica nije pronađena.");
  }

  return invites[0];
}

async function handleJoinLinkOnStart(){
  const code=getJoinCodeFromUrl();
  if(!code) return false;

  try{
    await loadSupabaseConfig();
    const invite=await previewInviteByCode(code);
    openJoinInviteScreen(invite);
    return true;
  }catch(error){
    console.error(error);
    openJoinInviteError(code,error.message||"Pozivnica nije mogla da se otvori.");
    return true;
  }
}

function openJoinInviteScreen(invite){
  document.getElementById("app").innerHTML=`
    <main class="join-screen">
      <section class="join-card">
        <div class="join-illustration">👶<span>🔗</span></div>
        <h1>Poziv za Baby Diary</h1>
        <p>Pozvani ste da se povežete sa dnevnikom za:</p>
        <strong>${escapeHtml(invite.baby_name||"bebu")}</strong>
        <small>Poziv je poslao/la ${escapeHtml(invite.created_by||"druga osoba")}.</small>

        <div class="join-actions">
          <button class="primary" id="acceptJoinInvite" type="button">Poveži dnevnik</button>
          <button class="cancel" id="declineJoinInvite" type="button">Ne sada</button>
        </div>
      </section>
    </main>
  `;

  document.getElementById("declineJoinInvite").onclick=()=>{
    clearJoinCodeFromUrl();
    renderDiary();
  };

  document.getElementById("acceptJoinInvite").onclick=()=>{
    openJoinModeModal(invite.code);
  };
}

function openJoinInviteError(code,message){
  document.getElementById("app").innerHTML=`
    <main class="join-screen">
      <section class="join-card">
        <div class="join-illustration">⚠️</div>
        <h1>Pozivnica nije otvorena</h1>
        <p>${escapeHtml(message)}</p>
        <small>Kod: ${escapeHtml(code)}</small>

        <div class="join-actions">
          <button class="primary" id="retryJoinInvite" type="button">Pokušaj ponovo</button>
          <button class="cancel" id="closeJoinError" type="button">Nastavi bez povezivanja</button>
        </div>
      </section>
    </main>
  `;

  document.getElementById("retryJoinInvite").onclick=()=>handleJoinLinkOnStart();
  document.getElementById("closeJoinError").onclick=()=>{
    clearJoinCodeFromUrl();
    renderDiary();
  };
}

function openJoinModeModal(code){
  const hasExisting=(state.babies||[]).length>0;

  if(!hasExisting){
    askParentNameAndConnect(code,"replace");
    return;
  }

  document.getElementById("joinModeModal")?.remove();

  const modal=document.createElement("div");
  modal.id="joinModeModal";
  modal.className="confirm-reminder-bg open";
  modal.innerHTML=`
    <div class="confirm-reminder-card">
      <h2>Na ovom telefonu već postoje podaci</h2>
      <p>Kako želiš da nastaviš?</p>

      <div class="import-options">
        <label><input type="radio" name="joinMode" value="append" checked> Dodaj deljeni dnevnik kao novu bebu</label>
        <small>Najbezbednije ako nisi siguran/na.</small>

        <label><input type="radio" name="joinMode" value="replace"> Zameni moje podatke deljenim dnevnikom</label>
        <small>Koristi samo ako želiš da ovaj telefon koristi podatke iz pozivnice.</small>
      </div>

      <div class="confirm-reminder-actions">
        <button type="button" class="cancel" id="cancelJoinMode">Otkaži</button>
        <button type="button" class="save" id="confirmJoinMode">Nastavi</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById("cancelJoinMode").onclick=()=>modal.remove();
  modal.addEventListener("click",(event)=>{ if(event.target===modal) modal.remove(); });

  document.getElementById("confirmJoinMode").onclick=()=>{
    const mode=document.querySelector('input[name="joinMode"]:checked')?.value||"append";
    modal.remove();
    askParentNameAndConnect(code,mode);
  };
}

async function askParentNameAndConnect(code,mode){
  await safeInviteNamePrompt();

  try{
    await connectWithInviteCode(code,mode);
    clearJoinCodeFromUrl();
  }catch(error){
    console.error(error);
    showTransferInfoModal("Povezivanje nije uspelo", error.message || "Proveri kod i pokušaj ponovo.");
  }
}


// v20 join link startup guard
window.addEventListener("DOMContentLoaded", ()=>{
  const code=getJoinCodeFromUrl();
  if(!code) return;
  setTimeout(()=>handleJoinLinkOnStart(),150);
});

// v2.0 cloud toast own-update and joined-event fix


// v20 cloud polling startup guard
window.addEventListener("DOMContentLoaded", ()=>{
  setTimeout(()=>{
    if(getCloudFamilyId()){
      startCloudPolling();
    }
  },800);
});

// v2.0 cloud polling + remote toast delivery fix

// v2.0 share naming neutral person fix


// v20 access person delegated handler
document.addEventListener("click", function(event){
  const chip=event.target.closest(".access-person-chip");
  if(!chip) return;
  event.preventDefault();
  event.stopPropagation();
  openAccessPersonInfo(chip.dataset.personId);
}, true);

// v2.0 access people chips fix

// v2.0 full neutral naming fix: osoba instead of roditelj


// v20 cloud members startup guard
window.addEventListener("DOMContentLoaded", ()=>{
  setTimeout(()=>{
    if(getCloudFamilyId()){
      startCloudPolling();
    }
  },800);
});

// v2.0 members merge + joined toast fix

// v2.0 simplified invite flow: removed visible manual code entry



function leaveSharedDiaryLocally(){
  const baby=getBaby();
  const sharedBabyId=getSharedBabyId(baby);
  if(!baby || !sharedBabyId) return false;

  state.babies=state.babies.filter(b=>b.id!==baby.id);
  selectedBabyId=state.babies[0]?.id||null;
  if(selectedBabyId) localStorage.setItem("babyDiaryCurrentBabyId",selectedBabyId);
  localStorage.removeItem(getBabyRemoteKey(sharedBabyId));

  localStorage.setItem(KEY,JSON.stringify(state));
  toast("Deljeni dnevnik je uklonjen samo sa ovog telefona.");
  renderDiary();
  return true;
}

function confirmLeaveSharedDiary(){
  document.getElementById("leaveSharedDiaryConfirm")?.remove();

  const modal=document.createElement("div");
  modal.id="leaveSharedDiaryConfirm";
  modal.className="confirm-reminder-bg open";
  modal.innerHTML=`
    <div class="confirm-reminder-card">
      <h2>Ukloniti deljeni dnevnik?</h2>
      <p>Ova beba će biti uklonjena samo sa ovog telefona. Kod drugih osoba podaci ostaju sačuvani.</p>
      <div class="confirm-reminder-actions">
        <button type="button" class="cancel" id="cancelLeaveSharedDiary">Otkaži</button>
        <button type="button" class="danger-action" id="confirmLeaveSharedDiary">Ukloni sa ovog telefona</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.getElementById("cancelLeaveSharedDiary").onclick=()=>modal.remove();
  document.getElementById("confirmLeaveSharedDiary").onclick=()=>{
    modal.remove();
    leaveSharedDiaryLocally();
  };
  modal.addEventListener("click",(event)=>{ if(event.target===modal) modal.remove(); });
}


// v2.0 shared delete protection handler
document.addEventListener("click", function(event){
  const target=event.target.closest("button, [role='button']");
  if(!target || !getSharedBabyId(getBaby())) return;

  const text=(target.textContent||"").toLowerCase();
  const id=(target.id||"").toLowerCase();
  const cls=(target.className||"").toString().toLowerCase();
  const dataAction=(target.dataset?.action||target.dataset?.babyAction||"").toLowerCase();

  const looksLikeBabyDelete=
    text.includes("obriši bebu") ||
    text.includes("obrisi bebu") ||
    text.includes("ukloni bebu") ||
    id.includes("deletebaby") ||
    id.includes("removebaby") ||
    cls.includes("delete-baby") ||
    cls.includes("remove-baby") ||
    dataAction.includes("delete-baby") ||
    dataAction.includes("remove-baby");

  if(!looksLikeBabyDelete) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  confirmLeaveSharedDiary();
}, true);

// v2.0 shared members refresh and local-only shared diary delete fix




function normalizeBaby(baby){
  const fallbackId = typeof uid === "function" ? uid("baby") : ("baby_"+Date.now()+"_"+Math.random().toString(36).slice(2,8));
  const normalized = {
    id: baby?.id || fallbackId,
    name: baby?.name || "Beba",
    birthDate: baby?.birthDate || "",
    avatar: baby?.avatar || "",
    days: Array.isArray(baby?.days) ? baby.days : [],
    reminders: Array.isArray(baby?.reminders) ? baby.reminders : [],
    cloud: baby?.cloud && typeof baby.cloud === "object" ? baby.cloud : {},
    createdAt: baby?.createdAt || new Date().toISOString(),
    updatedAt: baby?.updatedAt || new Date().toISOString()
  };

  // Preserve any additional fields from future versions.
  return {
    ...(baby || {}),
    ...normalized,
    cloud: {
      ...((baby && baby.cloud) || {}),
      ...(normalized.cloud || {})
    }
  };
}

/* Baby Diary v2.0 Baby-level Cloud Sharing */
const CLOUD_LAST_BABY_REMOTE_PREFIX="babyDiaryLastRemoteBabyUpdatedAt:";

function getSharedBabyId(baby=getBaby()){
  return baby?.cloud?.sharedBabyId || "";
}

function setSharedBabyIdForBaby(baby,id){
  if(!baby || !id) return;
  baby.cloud=baby.cloud||{};
  baby.cloud.sharedBabyId=id;
}

function getBabyRemoteKey(sharedBabyId){
  return CLOUD_LAST_BABY_REMOTE_PREFIX+sharedBabyId;
}

function getLastBabyRemoteUpdatedAt(sharedBabyId){
  return localStorage.getItem(getBabyRemoteKey(sharedBabyId))||"";
}

function setLastBabyRemoteUpdatedAt(sharedBabyId,value){
  if(sharedBabyId && value) localStorage.setItem(getBabyRemoteKey(sharedBabyId),value);
}

function ensureBabyAccessPeople(baby=getBaby()){
  if(!baby) return [];
  baby.cloud=baby.cloud||{};
  baby.cloud.people=Array.isArray(baby.cloud.people)?baby.cloud.people:[];
  const deviceId=getDeviceId();
  const name=getParentName();
  let me=baby.cloud.people.find(p=>p.deviceId===deviceId);
  if(!me){
    me={
      id:"person_"+Date.now()+"_"+Math.random().toString(36).slice(2,8),
      name,
      deviceId,
      role:"editor",
      joinedAt:new Date().toISOString(),
      lastSeenAt:new Date().toISOString()
    };
    baby.cloud.people.push(me);
  }else{
    me.name=name;
    me.lastSeenAt=new Date().toISOString();
  }
  return baby.cloud.people;
}

function addOrUpdateBabyAccessPerson(baby,name,deviceId=getDeviceId()){
  if(!baby) return null;
  baby.cloud=baby.cloud||{};
  baby.cloud.people=Array.isArray(baby.cloud.people)?baby.cloud.people:[];
  const finalName=(name||getParentName()||"Osoba").trim()||"Osoba";
  let person=baby.cloud.people.find(p=>p.deviceId===deviceId);
  if(!person){
    person={
      id:"person_"+Date.now()+"_"+Math.random().toString(36).slice(2,8),
      name:finalName,
      deviceId,
      role:"editor",
      joinedAt:new Date().toISOString(),
      lastSeenAt:new Date().toISOString()
    };
    baby.cloud.people.push(person);
  }else{
    person.name=finalName;
    person.lastSeenAt=new Date().toISOString();
  }
  return person;
}

function setBabyCloudEvent(baby,type,label){
  if(!baby) return;
  baby.cloud=baby.cloud||{};
  baby.cloud.lastEvent={
    id:"event_"+Date.now()+"_"+Math.random().toString(36).slice(2,8),
    type,
    label:label||"",
    by:getParentName(),
    deviceId:getDeviceId(),
    at:new Date().toISOString()
  };
}

function prepareBabyForCloud(baby=getBaby()){
  if(!baby) return null;
  ensureBabyAccessPeople(baby);
  const clean=JSON.parse(JSON.stringify(baby));
  clean.updatedAt=new Date().toISOString();
  clean.cloud={
    ...(clean.cloud||{}),
    deviceId:getDeviceId(),
    updatedBy:getParentName()
  };
  return clean;
}

async function ensureSharedBabyCreated(){
  const baby=getBaby();
  if(!baby) throw new Error("Nema aktivne bebe.");
  let sharedBabyId=getSharedBabyId(baby);
  if(!sharedBabyId){
    sharedBabyId="baby_"+Date.now()+"_"+Math.random().toString(36).slice(2,10);
    setSharedBabyIdForBaby(baby,sharedBabyId);
  }

  addOrUpdateBabyAccessPerson(baby,getParentName(),getDeviceId());
  const clean=prepareBabyForCloud(baby);
  const updatedAt=new Date().toISOString();

  await supabaseFetch("baby_snapshots?on_conflict=shared_baby_id",{
    method:"POST",
    headers:{"Prefer":"resolution=merge-duplicates,return=representation"},
    body:JSON.stringify({
      shared_baby_id:sharedBabyId,
      data:clean,
      updated_at:updatedAt,
      updated_by:getParentName()
    })
  });

  baby.updatedAt=updatedAt;
  localStorage.setItem(KEY,JSON.stringify(state));
  setLastBabyRemoteUpdatedAt(sharedBabyId,updatedAt);
  startCloudPolling();
  return sharedBabyId;
}

async function saveCurrentBabyToCloud(){
  const baby=getBaby();
  const sharedBabyId=getSharedBabyId(baby);
  if(!baby || !sharedBabyId) return;

  try{
    let remotePeople=[];
    try{
      const rows=await supabaseFetch(
        "baby_snapshots?shared_baby_id=eq."+encodeURIComponent(sharedBabyId)+"&select=data&limit=1",
        {method:"GET"}
      );
      remotePeople=Array.isArray(rows)&&rows[0]?.data?.cloud?.people ? rows[0].data.cloud.people : [];
    }catch(error){}

    baby.cloud=baby.cloud||{};
    baby.cloud.people=mergeAccessPeople(baby.cloud.people||[],remotePeople);
    ensureBabyAccessPeople(baby);

    const clean=prepareBabyForCloud(baby);
    const updatedAt=new Date().toISOString();

    await supabaseFetch("baby_snapshots?on_conflict=shared_baby_id",{
      method:"POST",
      headers:{"Prefer":"resolution=merge-duplicates,return=minimal"},
      body:JSON.stringify({
        shared_baby_id:sharedBabyId,
        data:clean,
        updated_at:updatedAt,
        updated_by:getParentName()
      })
    });

    baby.updatedAt=updatedAt;
    localStorage.setItem(KEY,JSON.stringify(state));
    setLastBabyRemoteUpdatedAt(sharedBabyId,updatedAt);
  }catch(error){
    console.warn("Baby cloud save failed",error);
  }
}

async function loadCurrentBabyFromCloud(showToast=true){
  const baby=getBaby();
  const sharedBabyId=getSharedBabyId(baby);
  if(!baby || !sharedBabyId) return;

  try{
    const rows=await supabaseFetch(
      "baby_snapshots?shared_baby_id=eq."+encodeURIComponent(sharedBabyId)+"&select=data,updated_at,updated_by&limit=1",
      {method:"GET"}
    );
    if(!Array.isArray(rows)||!rows.length||!rows[0].data) return;

    const remoteBaby=rows[0].data;
    const remoteUpdatedAt=rows[0].updated_at||remoteBaby.updatedAt||"";
    const remoteTime=remoteUpdatedAt?new Date(remoteUpdatedAt).getTime():0;
    const lastSeen=getLastBabyRemoteUpdatedAt(sharedBabyId);
    const lastSeenTime=lastSeen?new Date(lastSeen).getTime():0;

    const currentPeople=baby?.cloud?.people||[];
    const remotePeople=remoteBaby?.cloud?.people||[];
    const mergedPeople=mergeAccessPeople(currentPeople,remotePeople);
    const peopleChanged=JSON.stringify(currentPeople)!==JSON.stringify(mergedPeople);

    if(!remoteTime || remoteTime<=lastSeenTime){
      if(peopleChanged){
        baby.cloud=baby.cloud||{};
        baby.cloud.people=mergedPeople;
        localStorage.setItem(KEY,JSON.stringify(state));
        renderDiary();
      }
      return;
    }

    const remoteCloud=remoteBaby.cloud||{};
    const remoteEvent=remoteCloud.lastEvent||null;
    const isOwnUpdate=remoteCloud.deviceId===getDeviceId() || remoteEvent?.deviceId===getDeviceId();

    const localIndex=(state.babies||[]).findIndex(b=>b.id===baby.id);
    if(localIndex===-1) return;

    const preservedLocalId=state.babies[localIndex].id;
    const normalizedRemote=normalizeBaby(remoteBaby);
    state.babies[localIndex]=normalizedRemote;
    state.babies[localIndex].id=preservedLocalId;
    state.babies[localIndex].cloud=state.babies[localIndex].cloud||{};
    state.babies[localIndex].cloud.sharedBabyId=sharedBabyId;
    state.babies[localIndex].cloud.people=mergeAccessPeople(currentPeople,state.babies[localIndex].cloud.people||[]);
    state.babies[localIndex].updatedAt=remoteUpdatedAt;

    localStorage.setItem(KEY,JSON.stringify(state));
    setLastBabyRemoteUpdatedAt(sharedBabyId,remoteUpdatedAt);
    renderDiary();

    if(showToast && !isOwnUpdate){
      showCloudUpdateToast(remoteEvent, rows[0].updated_by||remoteCloud.updatedBy||"Druga osoba");
    }
  }catch(error){
    console.warn("Baby cloud load failed",error);
  }
}

async function createCloudInvite(){
  addOrUpdateBabyAccessPerson(getBaby(),getParentName(),getDeviceId());
  const sharedBabyId=await ensureSharedBabyCreated();
  const code=createInviteCode();

  await supabaseFetch("baby_invite_codes",{
    method:"POST",
    headers:{"Prefer":"return=representation"},
    body:JSON.stringify({
      code,
      shared_baby_id:sharedBabyId,
      baby_name:currentBabyNameForInvite(),
      created_by:getParentName()
    })
  });

  await saveCurrentBabyToCloud();
  startCloudPolling();
  return code;
}

async function previewInviteByCode(code){
  const cleanCode=String(code||"").trim().toUpperCase();
  if(!cleanCode) throw new Error("Kod nije pronađen.");

  const invites=await supabaseFetch(
    "baby_invite_codes?code=eq."+encodeURIComponent(cleanCode)+"&select=code,shared_baby_id,baby_name,created_by&limit=1",
    {method:"GET"}
  );

  if(!Array.isArray(invites)||!invites.length){
    throw new Error("Pozivnica nije pronađena.");
  }

  return invites[0];
}

async function connectWithInviteCode(code,mode="replace"){
  const cleanCode=String(code||"").trim().toUpperCase();
  if(!cleanCode) throw new Error("Unesi kod.");

  const invites=await supabaseFetch(
    "baby_invite_codes?code=eq."+encodeURIComponent(cleanCode)+"&select=code,shared_baby_id,baby_name,created_by&limit=1",
    {method:"GET"}
  );
  if(!Array.isArray(invites)||!invites.length) throw new Error("Kod nije pronađen.");

  const sharedBabyId=invites[0].shared_baby_id;
  const rows=await supabaseFetch(
    "baby_snapshots?shared_baby_id=eq."+encodeURIComponent(sharedBabyId)+"&select=data,updated_at,updated_by&limit=1",
    {method:"GET"}
  );
  if(!Array.isArray(rows)||!rows.length||!rows[0].data) throw new Error("Dnevnik nije pronađen.");

  const remoteBaby=normalizeBaby(rows[0].data);
  remoteBaby.cloud=remoteBaby.cloud||{};
  remoteBaby.cloud.sharedBabyId=sharedBabyId;

  if(mode==="replace" && !(state.babies||[]).length){
    remoteBaby.id=uid("baby");
    state.babies=[remoteBaby];
    selectedBabyId=remoteBaby.id;
  }else{
    remoteBaby.id=uid("baby");
    state.babies=Array.isArray(state.babies)?state.babies:[];
    state.babies.push(remoteBaby);
    selectedBabyId=remoteBaby.id;
  }

  addOrUpdateBabyAccessPerson(remoteBaby,getParentName(),getDeviceId());
  if(selectedBabyId) localStorage.setItem("babyDiaryCurrentBabyId",selectedBabyId);

  remoteBaby.updatedAt=rows[0].updated_at||new Date().toISOString();
  setLastBabyRemoteUpdatedAt(sharedBabyId,remoteBaby.updatedAt);
  localStorage.setItem(KEY,JSON.stringify(state));

  currentTab="diary";
  currentDayId=null;
  openCardId=null;

  renderDiary();
  startCloudPolling();

  setBabyCloudEvent(remoteBaby,"joined","Osoba se povezala");
  await saveCurrentBabyToCloud();
  showTransferInfoModal("Dnevnik je povezan","Sada obe osobe mogu da prate i upisuju ovaj dnevnik.");
}

function startCloudPolling(){
  if(window.__babyDiaryCloudPollingStarted) return;
  window.__babyDiaryCloudPollingStarted=true;

  if(getSharedBabyId(getBaby())) loadCurrentBabyFromCloud(false);

  setInterval(()=>{
    if(getSharedBabyId(getBaby())) loadCurrentBabyFromCloud(true);
  },3000);

  document.addEventListener("visibilitychange",()=>{
    if(!document.hidden && getSharedBabyId(getBaby())) loadCurrentBabyFromCloud(true);
  });

  window.addEventListener("focus",()=>{
    if(getSharedBabyId(getBaby())) loadCurrentBabyFromCloud(true);
  });
}

async function saveCloudState(){
  await saveCurrentBabyToCloud();
}

async function loadCloudState(showToast=true){
  await loadCurrentBabyFromCloud(showToast);
}

function getCloudFamilyId(){
  return getSharedBabyId(getBaby());
}

function setCloudFamilyId(id){
  setSharedBabyIdForBaby(getBaby(),id);
}


// v20 baby-level sharing startup guard
window.addEventListener("DOMContentLoaded", ()=>{
  setTimeout(()=>{
    if(getSharedBabyId(getBaby())) startCloudPolling();
  },800);
});

// v2.0 baby-level sharing fix

// v2.0 normalizeBaby fix for baby-level invite acceptance

/* v2.0 FINAL PATCH: baby-level members sync + local-only shared baby removal */

function babyEventSeenKey(sharedBabyId){
  return "babyDiarySeenCloudEvent:"+sharedBabyId;
}

function getSeenBabyEvent(sharedBabyId){
  return localStorage.getItem(babyEventSeenKey(sharedBabyId))||"";
}

function setSeenBabyEvent(sharedBabyId,eventId){
  if(sharedBabyId && eventId) localStorage.setItem(babyEventSeenKey(sharedBabyId),eventId);
}

function getAllSharedBabies(){
  return (state.babies||[]).filter(b=>b?.cloud?.sharedBabyId);
}

function getActiveSharedBaby(){
  const baby=getBaby();
  return baby?.cloud?.sharedBabyId ? baby : null;
}

function ensureBabyAccessPeopleFinal(baby=getBaby()){
  if(!baby) return [];
  baby.cloud=baby.cloud||{};
  baby.cloud.people=Array.isArray(baby.cloud.people)?baby.cloud.people:[];
  const deviceId=getDeviceId();
  const name=getParentName();
  let me=baby.cloud.people.find(p=>p.deviceId===deviceId);
  if(!me){
    me={
      id:"person_"+Date.now()+"_"+Math.random().toString(36).slice(2,8),
      name,
      deviceId,
      role:"editor",
      joinedAt:new Date().toISOString(),
      lastSeenAt:new Date().toISOString()
    };
    baby.cloud.people.push(me);
  }else{
    me.name=name;
    me.lastSeenAt=new Date().toISOString();
  }
  return baby.cloud.people;
}

function mergeAccessPeopleFinal(localPeople=[],remotePeople=[]){
  const map=new Map();
  [...(localPeople||[]), ...(remotePeople||[])].forEach(person=>{
    if(!person) return;
    const key=person.deviceId || person.id || person.name;
    if(!key) return;
    const existing=map.get(key)||{};
    const existingSeen=existing.lastSeenAt ? new Date(existing.lastSeenAt).getTime() : 0;
    const personSeen=person.lastSeenAt ? new Date(person.lastSeenAt).getTime() : 0;
    map.set(key,{
      ...existing,
      ...person,
      id: existing.id || person.id || ("person_"+Math.random().toString(36).slice(2,8)),
      name: person.name || existing.name || "Osoba",
      deviceId: person.deviceId || existing.deviceId,
      role: person.role || existing.role || "editor",
      joinedAt: existing.joinedAt || person.joinedAt || new Date().toISOString(),
      lastSeenAt: personSeen>=existingSeen ? (person.lastSeenAt||existing.lastSeenAt||new Date().toISOString()) : (existing.lastSeenAt||person.lastSeenAt||new Date().toISOString())
    });
  });
  return Array.from(map.values());
}

function getSharedBabyId(baby=getBaby()){
  return baby?.cloud?.sharedBabyId || "";
}

function setSharedBabyIdForBaby(baby,id){
  if(!baby || !id) return;
  baby.cloud=baby.cloud||{};
  baby.cloud.sharedBabyId=id;
}

function getBabyRemoteKey(sharedBabyId){
  return "babyDiaryLastRemoteBabyUpdatedAt:"+sharedBabyId;
}

function getLastBabyRemoteUpdatedAt(sharedBabyId){
  return localStorage.getItem(getBabyRemoteKey(sharedBabyId))||"";
}

function setLastBabyRemoteUpdatedAt(sharedBabyId,value){
  if(sharedBabyId && value) localStorage.setItem(getBabyRemoteKey(sharedBabyId),value);
}

function setBabyCloudEvent(baby,type,label){
  if(!baby) return;
  baby.cloud=baby.cloud||{};
  baby.cloud.lastEvent={
    id:"event_"+Date.now()+"_"+Math.random().toString(36).slice(2,8),
    type,
    label:label||"",
    by:getParentName(),
    deviceId:getDeviceId(),
    at:new Date().toISOString()
  };
}

function prepareBabyForCloudFinal(baby=getBaby()){
  if(!baby) return null;
  ensureBabyAccessPeopleFinal(baby);
  const clean=JSON.parse(JSON.stringify(baby));
  clean.updatedAt=new Date().toISOString();
  clean.cloud={
    ...(clean.cloud||{}),
    deviceId:getDeviceId(),
    updatedBy:getParentName()
  };
  return clean;
}

async function saveCurrentBabyToCloud(){
  const baby=getBaby();
  const sharedBabyId=getSharedBabyId(baby);
  if(!baby || !sharedBabyId) return;

  try{
    let remotePeople=[];
    try{
      const rows=await supabaseFetch(
        "baby_snapshots?shared_baby_id=eq."+encodeURIComponent(sharedBabyId)+"&select=data&limit=1",
        {method:"GET"}
      );
      remotePeople=Array.isArray(rows)&&rows[0]?.data?.cloud?.people ? rows[0].data.cloud.people : [];
    }catch(error){}

    baby.cloud=baby.cloud||{};
    baby.cloud.people=mergeAccessPeopleFinal(baby.cloud.people||[],remotePeople);
    ensureBabyAccessPeopleFinal(baby);

    const clean=prepareBabyForCloudFinal(baby);
    const updatedAt=new Date().toISOString();

    await supabaseFetch("baby_snapshots?on_conflict=shared_baby_id",{
      method:"POST",
      headers:{"Prefer":"resolution=merge-duplicates,return=minimal"},
      body:JSON.stringify({
        shared_baby_id:sharedBabyId,
        data:clean,
        updated_at:updatedAt,
        updated_by:getParentName()
      })
    });

    baby.updatedAt=updatedAt;
    localStorage.setItem(KEY,JSON.stringify(state));
    setLastBabyRemoteUpdatedAt(sharedBabyId,updatedAt);
  }catch(error){
    console.warn("Baby cloud save failed",error);
  }
}

async function loadBabyFromCloudById(localBaby,showToast=true){
  const sharedBabyId=getSharedBabyId(localBaby);
  if(!localBaby || !sharedBabyId) return;

  try{
    const rows=await supabaseFetch(
      "baby_snapshots?shared_baby_id=eq."+encodeURIComponent(sharedBabyId)+"&select=data,updated_at,updated_by&limit=1",
      {method:"GET"}
    );

    if(!Array.isArray(rows)||!rows.length||!rows[0].data) return;

    const remoteBaby=rows[0].data;
    const remoteUpdatedAt=rows[0].updated_at||remoteBaby.updatedAt||"";
    const remoteCloud=remoteBaby.cloud||{};
    const remoteEvent=remoteCloud.lastEvent||null;
    const localIndex=(state.babies||[]).findIndex(b=>b.id===localBaby.id);
    if(localIndex===-1) return;

    const currentLocal=state.babies[localIndex];
    const currentPeople=currentLocal?.cloud?.people||[];
    const remotePeople=remoteBaby?.cloud?.people||[];
    const mergedPeople=mergeAccessPeopleFinal(currentPeople,remotePeople);

    const lastSeen=getLastBabyRemoteUpdatedAt(sharedBabyId);
    const remoteTime=remoteUpdatedAt?new Date(remoteUpdatedAt).getTime():0;
    const lastSeenTime=lastSeen?new Date(lastSeen).getTime():0;

    const remoteChanged=remoteTime && remoteTime>lastSeenTime;
    const peopleChanged=JSON.stringify(currentPeople)!==JSON.stringify(mergedPeople);

    if(remoteChanged){
      const preservedLocalId=currentLocal.id;
      const normalizedRemote=typeof normalizeBaby==="function" ? normalizeBaby(remoteBaby) : {...remoteBaby};
      state.babies[localIndex]=normalizedRemote;
      state.babies[localIndex].id=preservedLocalId;
      state.babies[localIndex].cloud=state.babies[localIndex].cloud||{};
      state.babies[localIndex].cloud.sharedBabyId=sharedBabyId;
      state.babies[localIndex].cloud.people=mergedPeople;
      state.babies[localIndex].updatedAt=remoteUpdatedAt;
      setLastBabyRemoteUpdatedAt(sharedBabyId,remoteUpdatedAt);
    }else if(peopleChanged){
      currentLocal.cloud=currentLocal.cloud||{};
      currentLocal.cloud.people=mergedPeople;
    }

    localStorage.setItem(KEY,JSON.stringify(state));
    if(remoteChanged || peopleChanged) renderDiary();

    const isOwnUpdate=remoteCloud.deviceId===getDeviceId() || remoteEvent?.deviceId===getDeviceId();
    const lastSeenEvent=getSeenBabyEvent(sharedBabyId);
    const eventIsNew=remoteEvent?.id && remoteEvent.id!==lastSeenEvent;

    if(showToast && remoteChanged && !isOwnUpdate && eventIsNew){
      setSeenBabyEvent(sharedBabyId,remoteEvent.id);
      showCloudUpdateToast(remoteEvent, rows[0].updated_by||remoteCloud.updatedBy||"Druga osoba");
    }
  }catch(error){
    console.warn("Baby cloud load failed",error);
  }
}

async function loadCurrentBabyFromCloud(showToast=true){
  const baby=getBaby();
  if(!baby || !getSharedBabyId(baby)) return;
  await loadBabyFromCloudById(baby,showToast);
}

async function loadAllSharedBabiesFromCloud(showToast=true){
  const babies=getAllSharedBabies();
  for(const baby of babies){
    await loadBabyFromCloudById(baby,showToast);
  }
}

async function createCloudInvite(){
  const baby=getBaby();
  if(!baby) throw new Error("Nema aktivne bebe.");
  let sharedBabyId=getSharedBabyId(baby);
  if(!sharedBabyId){
    sharedBabyId="baby_"+Date.now()+"_"+Math.random().toString(36).slice(2,10);
    setSharedBabyIdForBaby(baby,sharedBabyId);
  }

  ensureBabyAccessPeopleFinal(baby);
  await saveCurrentBabyToCloud();

  const code=createInviteCode();
  await supabaseFetch("baby_invite_codes",{
    method:"POST",
    headers:{"Prefer":"return=representation"},
    body:JSON.stringify({
      code,
      shared_baby_id:sharedBabyId,
      baby_name:currentBabyNameForInvite(),
      created_by:getParentName()
    })
  });

  startCloudPolling();
  return code;
}

async function previewInviteByCode(code){
  const cleanCode=String(code||"").trim().toUpperCase();
  if(!cleanCode) throw new Error("Kod nije pronađen.");
  const invites=await supabaseFetch(
    "baby_invite_codes?code=eq."+encodeURIComponent(cleanCode)+"&select=code,shared_baby_id,baby_name,created_by&limit=1",
    {method:"GET"}
  );
  if(!Array.isArray(invites)||!invites.length){
    throw new Error("Pozivnica nije pronađena.");
  }
  return invites[0];
}

async function connectWithInviteCode(code,mode="replace"){
  const cleanCode=String(code||"").trim().toUpperCase();
  if(!cleanCode) throw new Error("Unesi kod.");

  const invites=await supabaseFetch(
    "baby_invite_codes?code=eq."+encodeURIComponent(cleanCode)+"&select=code,shared_baby_id,baby_name,created_by&limit=1",
    {method:"GET"}
  );
  if(!Array.isArray(invites)||!invites.length) throw new Error("Kod nije pronađen.");

  const sharedBabyId=invites[0].shared_baby_id;
  const rows=await supabaseFetch(
    "baby_snapshots?shared_baby_id=eq."+encodeURIComponent(sharedBabyId)+"&select=data,updated_at,updated_by&limit=1",
    {method:"GET"}
  );
  if(!Array.isArray(rows)||!rows.length||!rows[0].data) throw new Error("Dnevnik nije pronađen.");

  const remoteBaby=typeof normalizeBaby==="function" ? normalizeBaby(rows[0].data) : {...rows[0].data};
  remoteBaby.id=uid("baby");
  remoteBaby.cloud=remoteBaby.cloud||{};
  remoteBaby.cloud.sharedBabyId=sharedBabyId;
  remoteBaby.cloud.people=mergeAccessPeopleFinal(remoteBaby.cloud.people||[],[]);
  ensureBabyAccessPeopleFinal(remoteBaby);

  state.babies=Array.isArray(state.babies)?state.babies:[];
  state.babies.push(remoteBaby);
  selectedBabyId=remoteBaby.id;
  localStorage.setItem("babyDiaryCurrentBabyId",selectedBabyId);

  remoteBaby.updatedAt=rows[0].updated_at||new Date().toISOString();
  setLastBabyRemoteUpdatedAt(sharedBabyId,remoteBaby.updatedAt);
  localStorage.setItem(KEY,JSON.stringify(state));

  currentTab="diary";
  currentDayId=null;
  openCardId=null;

  renderDiary();
  startCloudPolling();

  setBabyCloudEvent(remoteBaby,"joined","Osoba se povezala");
  await saveCurrentBabyToCloud();

  showTransferInfoModal("Dnevnik je povezan","Sada obe osobe mogu da prate i upisuju ovaj dnevnik.");
}

function saveState(){
  state.updatedAt=new Date().toISOString();
  localStorage.setItem(KEY,JSON.stringify(state));

  const baby=getBaby();
  if(getSharedBabyId(baby)){
    setBabyCloudEvent(baby,"data_changed","Dnevnik je ažuriran");
    queueCloudSave();
  }
}

function renderAccessPeople(){
  const baby=getBaby();
  const people=ensureBabyAccessPeopleFinal(baby);
  const currentDeviceId=getDeviceId();
  return `<div class="access-people-block">
    <div class="access-people-head">
      <strong>Osobe sa pristupom (${people.length})</strong>
      <small>Mogu da prate i upisuju ovaj dnevnik.</small>
    </div>
    <div class="access-people-chips">
      ${people.map(person=>`
        <button class="access-person-chip" type="button" data-person-id="${person.id}">
          <span class="access-avatar">${escapeHtml(personInitials(person.name))}</span>
          <span>
            <strong>${escapeHtml(person.name||"Osoba")}${person.deviceId===currentDeviceId?" (Ti)":""}</strong>
            <small>Može da upisuje</small>
          </span>
        </button>
      `).join("")}
    </div>
  </div>`;
}

function removeActiveSharedBabyLocally(){
  const baby=getBaby();
  const sharedBabyId=getSharedBabyId(baby);
  if(!baby || !sharedBabyId) return false;

  state.babies=(state.babies||[]).filter(b=>b.id!==baby.id);
  selectedBabyId=state.babies[0]?.id||null;
  if(selectedBabyId){
    localStorage.setItem("babyDiaryCurrentBabyId",selectedBabyId);
  }else{
    localStorage.removeItem("babyDiaryCurrentBabyId");
  }

  localStorage.removeItem(getBabyRemoteKey(sharedBabyId));
  localStorage.removeItem(babyEventSeenKey(sharedBabyId));
  localStorage.setItem(KEY,JSON.stringify(state));

  toast("Beba je uklonjena samo sa ovog telefona.");
  renderDiary();
  return true;
}

function leaveSharedDiaryLocally(){
  return removeActiveSharedBabyLocally();
}

function confirmLeaveSharedDiary(){
  document.getElementById("leaveSharedDiaryConfirm")?.remove();

  const modal=document.createElement("div");
  modal.id="leaveSharedDiaryConfirm";
  modal.className="confirm-reminder-bg open";
  modal.innerHTML=`
    <div class="confirm-reminder-card">
      <h2>Ukloniti bebu sa ovog telefona?</h2>
      <p>Ova beba će biti uklonjena samo sa ovog telefona. Kod drugih osoba podaci ostaju sačuvani.</p>
      <div class="confirm-reminder-actions">
        <button type="button" class="cancel" id="cancelLeaveSharedDiary">Otkaži</button>
        <button type="button" class="danger-action" id="confirmLeaveSharedDiary">Ukloni sa ovog telefona</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById("cancelLeaveSharedDiary").onclick=()=>modal.remove();
  document.getElementById("confirmLeaveSharedDiary").onclick=()=>{
    modal.remove();
    removeActiveSharedBabyLocally();
  };
  modal.addEventListener("click",(event)=>{ if(event.target===modal) modal.remove(); });
}

function deleteBaby(id){
  const baby=(state.babies||[]).find(b=>b.id===id) || getBaby();
  if(baby?.cloud?.sharedBabyId){
    selectedBabyId=baby.id;
    localStorage.setItem("babyDiaryCurrentBabyId",selectedBabyId);
    confirmLeaveSharedDiary();
    return;
  }

  state.babies=(state.babies||[]).filter(b=>b.id!==id);
  selectedBabyId=state.babies[0]?.id||null;
  if(selectedBabyId) localStorage.setItem("babyDiaryCurrentBabyId",selectedBabyId);
  else localStorage.removeItem("babyDiaryCurrentBabyId");
  saveState();
  renderDiary();
}

function confirmDeleteBaby(id){
  const baby=(state.babies||[]).find(b=>b.id===id) || getBaby();
  if(baby?.cloud?.sharedBabyId){
    selectedBabyId=baby.id;
    localStorage.setItem("babyDiaryCurrentBabyId",selectedBabyId);
    confirmLeaveSharedDiary();
    return;
  }
  const ok=confirm("Da li želiš da obrišeš ovu bebu?");
  if(!ok) return;
  deleteBaby(id);
}

function startCloudPolling(){
  if(window.__babyDiaryCloudPollingStarted) return;
  window.__babyDiaryCloudPollingStarted=true;

  loadAllSharedBabiesFromCloud(false);

  setInterval(()=>{
    loadAllSharedBabiesFromCloud(true);
  },2500);

  document.addEventListener("visibilitychange",()=>{
    if(!document.hidden) loadAllSharedBabiesFromCloud(true);
  });

  window.addEventListener("focus",()=>{
    loadAllSharedBabiesFromCloud(true);
  });
}

async function saveCloudState(){
  await saveCurrentBabyToCloud();
}

async function loadCloudState(showToast=true){
  await loadAllSharedBabiesFromCloud(showToast);
}

// extra capture for UI delete buttons, including when only one shared baby exists
document.addEventListener("click", function(event){
  const target=event.target.closest("button, [role='button']");
  if(!target) return;
  const text=(target.textContent||"").toLowerCase();
  const id=(target.id||"").toLowerCase();
  const cls=(target.className||"").toString().toLowerCase();
  const action=(target.dataset?.action||target.dataset?.babyAction||"").toLowerCase();

  const looksLikeBabyDelete=
    text.includes("obriši bebu") ||
    text.includes("obrisi bebu") ||
    text.includes("ukloni bebu") ||
    text.includes("izbriši bebu") ||
    id.includes("deletebaby") ||
    id.includes("removebaby") ||
    cls.includes("delete-baby") ||
    cls.includes("remove-baby") ||
    action.includes("delete-baby") ||
    action.includes("remove-baby");

  if(!looksLikeBabyDelete) return;
  const baby=getBaby();
  if(!baby?.cloud?.sharedBabyId) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  confirmLeaveSharedDiary();
}, true);

window.addEventListener("DOMContentLoaded", ()=>{
  setTimeout(()=>{
    if(getAllSharedBabies().length) startCloudPolling();
  },800);
});



/* v2.0 PATCH: reliable baby members refresh + empty state after removing last shared baby */

async function refreshActiveBabyPeopleFromCloud(){
  const baby=getBaby();
  const sharedBabyId=baby?.cloud?.sharedBabyId;
  if(!baby || !sharedBabyId) return;

  try{
    const rows=await supabaseFetch(
      "baby_snapshots?shared_baby_id=eq."+encodeURIComponent(sharedBabyId)+"&select=data,updated_at,updated_by&limit=1",
      {method:"GET"}
    );

    if(!Array.isArray(rows)||!rows.length||!rows[0].data) return;

    const remotePeople=rows[0].data?.cloud?.people||[];
    const localPeople=baby.cloud?.people||[];
    const merged=mergeAccessPeopleFinal
      ? mergeAccessPeopleFinal(localPeople,remotePeople)
      : mergeAccessPeople(localPeople,remotePeople);

    baby.cloud=baby.cloud||{};
    const changed=JSON.stringify(baby.cloud.people||[])!==JSON.stringify(merged);
    baby.cloud.people=merged;

    if(changed){
      localStorage.setItem(KEY,JSON.stringify(state));
      renderDiary();
    }
  }catch(error){
    console.warn("People refresh failed",error);
  }
}

function renderAccessPeople(){
  const baby=getBaby();
  const people=(typeof ensureBabyAccessPeopleFinal==="function")
    ? ensureBabyAccessPeopleFinal(baby)
    : ensureBabyAccessPeople(baby);

  // Pull fresh people from cloud after settings render.
  setTimeout(()=>refreshActiveBabyPeopleFromCloud(),250);

  const currentDeviceId=getDeviceId();
  return `<div class="access-people-block">
    <div class="access-people-head">
      <strong>Osobe sa pristupom (${people.length})</strong>
      <small>Mogu da prate i upisuju ovaj dnevnik.</small>
    </div>
    <div class="access-people-chips">
      ${people.map(person=>`
        <button class="access-person-chip" type="button" data-person-id="${person.id}">
          <span class="access-avatar">${escapeHtml(personInitials(person.name))}</span>
          <span>
            <strong>${escapeHtml(person.name||"Osoba")}${person.deviceId===currentDeviceId?" (Ti)":""}</strong>
            <small>Može da upisuje</small>
          </span>
        </button>
      `).join("")}
    </div>
  </div>`;
}

async function loadAllSharedBabiesFromCloud(showToast=true){
  const babies=(state.babies||[]).filter(b=>b?.cloud?.sharedBabyId);
  for(const baby of babies){
    if(typeof loadBabyFromCloudById==="function"){
      await loadBabyFromCloudById(baby,showToast);
    }
  }

  // Extra pass: force member list merge for active baby.
  await refreshActiveBabyPeopleFromCloud();
}

function goToEmptyBabyState(){
  selectedBabyId=null;
  currentDayId=null;
  openCardId=null;
  localStorage.removeItem("babyDiaryCurrentBabyId");
  localStorage.setItem(KEY,JSON.stringify(state));
  renderDiary();
}

function removeActiveSharedBabyLocally(){
  const baby=getBaby();
  const sharedBabyId=baby?.cloud?.sharedBabyId;
  if(!baby || !sharedBabyId) return false;

  state.babies=(state.babies||[]).filter(b=>b.id!==baby.id);

  try{
    localStorage.removeItem(getBabyRemoteKey(sharedBabyId));
    localStorage.removeItem(babyEventSeenKey(sharedBabyId));
  }catch(error){}

  if(state.babies.length){
    selectedBabyId=state.babies[0].id;
    localStorage.setItem("babyDiaryCurrentBabyId",selectedBabyId);
    localStorage.setItem(KEY,JSON.stringify(state));
    toast("Beba je uklonjena samo sa ovog telefona.");
    renderDiary();
  }else{
    state.babies=[];
    toast("Beba je uklonjena sa ovog telefona.");
    goToEmptyBabyState();
  }

  return true;
}

function leaveSharedDiaryLocally(){
  return removeActiveSharedBabyLocally();
}

function deleteBaby(id){
  const baby=(state.babies||[]).find(b=>b.id===id) || getBaby();
  if(baby?.cloud?.sharedBabyId){
    selectedBabyId=baby.id;
    localStorage.setItem("babyDiaryCurrentBabyId",selectedBabyId);
    confirmLeaveSharedDiary();
    return;
  }

  state.babies=(state.babies||[]).filter(b=>b.id!==id);

  if(state.babies.length){
    selectedBabyId=state.babies[0].id;
    localStorage.setItem("babyDiaryCurrentBabyId",selectedBabyId);
    saveState();
    renderDiary();
  }else{
    state.babies=[];
    goToEmptyBabyState();
  }
}

function confirmDeleteBaby(id){
  const baby=(state.babies||[]).find(b=>b.id===id) || getBaby();
  if(baby?.cloud?.sharedBabyId){
    selectedBabyId=baby.id;
    localStorage.setItem("babyDiaryCurrentBabyId",selectedBabyId);
    confirmLeaveSharedDiary();
    return;
  }
  const ok=confirm("Da li želiš da obrišeš ovu bebu?");
  if(!ok) return;
  deleteBaby(id);
}

// More aggressive polling for members only.
window.addEventListener("focus",()=>{
  setTimeout(()=>refreshActiveBabyPeopleFromCloud(),300);
});

window.addEventListener("DOMContentLoaded",()=>{
  setTimeout(()=>refreshActiveBabyPeopleFromCloud(),1200);
});

// v2.0 member refresh and last baby empty-state fix



/* v2.0 display name before baby setup */

function hasDisplayName(){
  const name=(localStorage.getItem(CLOUD_PARENT_KEY)||"").trim();
  return !!name && name !== "Osoba";
}

function askDisplayNameIfMissing(callback){
  if(hasDisplayName()){
    if(typeof callback==="function") callback();
    return;
  }

  document.getElementById("displayNameModal")?.remove();

  const modal=document.createElement("div");
  modal.id="displayNameModal";
  modal.className="confirm-reminder-bg open";
  modal.innerHTML=`
    <div class="confirm-reminder-card">
      <h2>Vaše ime</h2>
      <p>Unesite ime koje će se prikazivati u deljenom dnevniku.</p>
      <input class="input" id="displayNameInput" placeholder="npr. Mama, Tata, Baka..." autocomplete="name">
      <div class="confirm-reminder-actions">
        <button type="button" class="cancel" id="cancelDisplayName">Kasnije</button>
        <button type="button" class="save" id="saveDisplayName">Sačuvaj</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const input=document.getElementById("displayNameInput");
  setTimeout(()=>input?.focus(),100);

  function close(){
    modal.remove();
  }

  function save(){
    const value=(input.value||"").trim();
    if(!value){
      input.focus();
      input.classList.add("field-error");
      return;
    }
    setParentName(value);
    close();
    if(typeof callback==="function") callback();
    renderDiary();
  }

  document.getElementById("cancelDisplayName").onclick=()=>{
    close();
    if(typeof callback==="function") callback();
  };
  document.getElementById("saveDisplayName").onclick=save;
  input.addEventListener("keydown",(event)=>{
    if(event.key==="Enter") save();
  });
}

function getParentName(){
  return localStorage.getItem(CLOUD_PARENT_KEY)||"Osoba";
}

function setParentName(name){
  const clean=(name||"").trim()||"Osoba";
  localStorage.setItem(CLOUD_PARENT_KEY,clean);

  try{
    const baby=getBaby();
    if(baby?.cloud?.sharedBabyId && typeof addOrUpdateBabyAccessPerson==="function"){
      addOrUpdateBabyAccessPerson(baby,clean,getDeviceId());
      localStorage.setItem(KEY,JSON.stringify(state));
      saveCurrentBabyToCloud?.();
    }
  }catch(error){}
}

function safeInviteNamePrompt(){
  if(hasDisplayName()) return Promise.resolve(getParentName());

  return new Promise(resolve=>{
    askDisplayNameIfMissing(()=>{
      resolve(getParentName());
    });
  });
}


// v20 display-name add-baby intercept
document.addEventListener("click", function(event){
  const target=event.target.closest("button, [role='button']");
  if(!target || hasDisplayName()) return;

  const text=(target.textContent||"").toLowerCase();
  const id=(target.id||"").toLowerCase();
  const cls=(target.className||"").toString().toLowerCase();

  const looksLikeAddBaby=
    text.includes("dodaj novu bebu") ||
    text.includes("dodaj bebu") ||
    id.includes("addbaby") ||
    cls.includes("add-baby");

  if(!looksLikeAddBaby) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const cloneClick=()=>setTimeout(()=>target.click(),80);
  askDisplayNameIfMissing(cloneClick);
}, true);

// v2.0 display name onboarding before baby setup



/* v2.0 explicit onboarding fields: display name + baby name */

function renderEmptyBabyOnboarding(){
  const savedName=(localStorage.getItem(CLOUD_PARENT_KEY)||"").trim();

  document.getElementById("app").innerHTML=`
    <main class="onboarding-screen">
      <section class="onboarding-card">
        <div class="join-illustration">👶</div>
        <h1>Dobrodošli u Baby Diary</h1>
        <p>Prvo unesite svoje ime i ime bebe.</p>

        <label class="onboarding-field">
          <span>Vaše ime</span>
          <input class="input" id="onboardingPersonName" placeholder="npr. Mama, Tata, Baka..." value="${escapeHtml(savedName && savedName!=="Osoba" ? savedName : "")}" autocomplete="name">
        </label>

        <label class="onboarding-field">
          <span>Ime bebe</span>
          <input class="input" id="onboardingBabyName" placeholder="npr. Timo" autocomplete="off">
        </label>

        <button class="primary onboarding-primary" id="createFirstBabyWithName" type="button">Započni dnevnik</button>
      </section>
    </main>
  `;

  const personInput=document.getElementById("onboardingPersonName");
  const babyInput=document.getElementById("onboardingBabyName");

  setTimeout(()=>personInput?.focus(),120);

  function create(){
    const personName=(personInput.value||"").trim();
    const babyName=(babyInput.value||"").trim();

    personInput.classList.remove("field-error");
    babyInput.classList.remove("field-error");

    if(!personName){
      personInput.classList.add("field-error");
      personInput.focus();
      return;
    }

    if(!babyName){
      babyInput.classList.add("field-error");
      babyInput.focus();
      return;
    }

    setParentName(personName);

    const baby={
      id:uid("baby"),
      name:babyName,
      birthDate:"",
      avatar:"",
      days:[],
      reminders:[],
      cloud:{},
      createdAt:new Date().toISOString(),
      updatedAt:new Date().toISOString()
    };

    state.babies=[baby];
    selectedBabyId=baby.id;
    localStorage.setItem("babyDiaryCurrentBabyId",selectedBabyId);
    saveState();
    renderDiary();
  }

  document.getElementById("createFirstBabyWithName").onclick=create;

  [personInput,babyInput].forEach(input=>{
    input.addEventListener("keydown",(event)=>{
      if(event.key==="Enter") create();
    });
  });
}

// v2.0 explicit onboarding fields fix


// v20 existing onboarding owner name guard
document.addEventListener("click", function(event){
  const target=event.target.closest("button, [role='button']");
  if(!target) return;

  const text=(target.textContent||"").toLowerCase();
  const isCreateDiary=text.includes("kreiraj dnevnik") || text.includes("započni dnevnik") || text.includes("zapocni dnevnik");
  if(!isCreateDiary) return;

  const ownerInput=document.getElementById("ownerName");
  if(!ownerInput) return;

  const ownerName=(ownerInput.value||"").trim();
  if(!ownerName){
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    ownerInput.classList.add("field-error");
    ownerInput.focus();
    return;
  }

  setParentName(ownerName);
}, true);

// v2.0 existing onboarding owner name field fix



/* v2.0 owner name runtime patch */

function getOwnerNameValue(){
  const value=(localStorage.getItem(CLOUD_PARENT_KEY)||"").trim();
  return value && value!=="Osoba" ? value : "";
}

function applyOwnerNameFieldToOnboarding(){
  const app=document.getElementById("app");
  if(!app) return;

  const text=(app.textContent||"").toLowerCase();
  const hasBabyName=text.includes("ime bebe");
  const hasCreate=text.includes("kreiraj dnevnik");
  if(!hasBabyName || !hasCreate || document.getElementById("ownerName")) return;

  const inputs=[...app.querySelectorAll("input")];
  const babyNameInput=inputs.find(input=>{
    const ph=(input.getAttribute("placeholder")||"").toLowerCase();
    const id=(input.id||"").toLowerCase();
    return ph.includes("ime") || id.includes("baby") || id.includes("name");
  }) || inputs[0];

  if(!babyNameInput) return;

  const wrapper=document.createElement("div");
  wrapper.className="owner-name-onboarding-field";
  wrapper.innerHTML=`
    <label for="ownerName">Vaše ime</label>
    <input id="ownerName" class="${babyNameInput.className||""}" placeholder="Unesi svoje ime" autocomplete="name" value="${escapeHtml(getOwnerNameValue())}">
  `;

  const exactLabels=[...app.querySelectorAll("label, span, div, p")].filter(el=>(el.textContent||"").trim().toLowerCase()==="ime bebe");
  const babyLabel=exactLabels[0];

  if(babyLabel && babyLabel.parentNode){
    babyLabel.parentNode.insertBefore(wrapper,babyLabel);
  }else if(babyNameInput.parentNode){
    babyNameInput.parentNode.insertBefore(wrapper,babyNameInput);
  }
}

function ensureOwnerNameBeforeCreate(event){
  const target=event.target.closest("button, [role='button']");
  if(!target) return;

  const text=(target.textContent||"").toLowerCase();
  const isCreate=text.includes("kreiraj dnevnik") || text.includes("započni dnevnik") || text.includes("zapocni dnevnik");
  if(!isCreate) return;

  const ownerInput=document.getElementById("ownerName");
  if(!ownerInput) return;

  const ownerName=(ownerInput.value||"").trim();
  ownerInput.classList.remove("field-error");

  if(!ownerName){
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    ownerInput.classList.add("field-error");
    ownerInput.focus();
    return;
  }

  setParentName(ownerName);
}

document.addEventListener("click", ensureOwnerNameBeforeCreate, true);

window.addEventListener("DOMContentLoaded",()=>{
  const apply=()=>applyOwnerNameFieldToOnboarding();
  setTimeout(apply,50);
  setTimeout(apply,250);
  setTimeout(apply,800);
  setTimeout(apply,1500);
  const app=document.getElementById("app");
  if(app){
    new MutationObserver(apply).observe(app,{childList:true,subtree:true});
  }
});



function openChangeOwnerNameModal(){
  document.getElementById("changeOwnerNameModal")?.remove();

  const modal=document.createElement("div");
  modal.id="changeOwnerNameModal";
  modal.className="confirm-reminder-bg open";
  modal.innerHTML=`
    <div class="confirm-reminder-card">
      <h2>Promeni vaše ime</h2>
      <p>Ovo ime se prikazuje u deljenim dnevnicima.</p>
      <input class="input" id="changeOwnerNameInput" placeholder="Unesi svoje ime" value="${escapeHtml(getOwnerNameValue())}" autocomplete="name">
      <div class="confirm-reminder-actions">
        <button type="button" class="cancel" id="cancelChangeOwnerName">Otkaži</button>
        <button type="button" class="save" id="saveChangeOwnerName">Sačuvaj</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  const input=document.getElementById("changeOwnerNameInput");
  setTimeout(()=>input?.focus(),100);

  function save(){
    const value=(input.value||"").trim();
    input.classList.remove("field-error");
    if(!value){
      input.classList.add("field-error");
      input.focus();
      return;
    }
    setParentName(value);
    try{
      const baby=getBaby();
      if(baby?.cloud?.sharedBabyId && typeof addOrUpdateBabyAccessPerson==="function"){
        addOrUpdateBabyAccessPerson(baby,value,getDeviceId());
        localStorage.setItem(KEY,JSON.stringify(state));
        if(typeof saveCurrentBabyToCloud==="function") saveCurrentBabyToCloud();
        else if(typeof saveCloudState==="function") saveCloudState();
      }
    }catch(error){}
    modal.remove();
    renderDiary();
  }

  document.getElementById("cancelChangeOwnerName").onclick=()=>modal.remove();
  document.getElementById("saveChangeOwnerName").onclick=save;
  input.addEventListener("keydown",(event)=>{ if(event.key==="Enter") save(); });
  modal.addEventListener("click",(event)=>{ if(event.target===modal) modal.remove(); });
}

function injectOwnerNameSettings(){
  const app=document.getElementById("app");
  if(!app) return;

  const text=(app.textContent||"").toLowerCase();
  if(!text.includes("podešavanja") && !text.includes("podesavanja")) return;
  if(document.querySelector(".owner-name-settings-section")) return;

  const name=getOwnerNameValue() || "Nije dodato";
  const section=document.createElement("section");
  section.className="settings-section owner-name-settings-section";
  section.innerHTML=`
    <h2>Korisnik</h2>
    <div class="settings-card">
      <button class="settings-action" id="changeOwnerName" type="button">
        <span>
          <strong>Vaše ime</strong>
          <small>${escapeHtml(name)}</small>
        </span>
        <span class="settings-chevron">›</span>
      </button>
    </div>
  `;

  const podaciHeading=[...app.querySelectorAll("h2,h3")].find(el=>(el.textContent||"").trim().toLowerCase()==="podaci");
  if(podaciHeading && podaciHeading.parentNode){
    podaciHeading.parentNode.insertBefore(section,podaciHeading);
  }else{
    const main=app.querySelector("main")||app.firstElementChild||app;
    main.appendChild(section);
  }

  const btn=document.getElementById("changeOwnerName");
  if(btn) btn.onclick=openChangeOwnerNameModal;
}

window.addEventListener("DOMContentLoaded",()=>{
  const inject=()=>injectOwnerNameSettings();
  setTimeout(inject,100);
  setTimeout(inject,500);
  const app=document.getElementById("app");
  if(app) new MutationObserver(inject).observe(app,{childList:true,subtree:true});
});

document.addEventListener("click", function(event){
  const target=event.target.closest("#changeOwnerName");
  if(!target) return;
  event.preventDefault();
  event.stopPropagation();
  openChangeOwnerNameModal();
}, true);

// v2.0 real owner name onboarding and settings fix

/* v21 final fix: owner name persistence + settings-only placement */
(function(){
  function ownerNameValue(){
    const value=(localStorage.getItem(CLOUD_PARENT_KEY)||"").trim();
    return value && value!=="Osoba" ? value : "";
  }

  function saveOwnerNameEverywhere(name){
    const clean=(name||"").trim();
    if(!clean) return;
    localStorage.setItem(CLOUD_PARENT_KEY,clean);
    try{ setParentName(clean); }catch(error){}
    try{
      state=state||{version:2,babies:[]};
      state.ownerName=clean;
      const baby=getBaby?.();
      if(baby){ baby.ownerName=clean; baby.updatedAt=new Date().toISOString(); }
      localStorage.setItem(KEY,JSON.stringify(state));
    }catch(error){}
  }

  // Replace old first-run onboarding so the user name is a real field, not a runtime injection.
  renderOnboarding=function(){
    app.innerHTML=`<section class="app-shell">
      <div class="hero">
        <div class="hero-illustration">🧸</div>
        <div>
          <h1>Dobrodošli u dnevnik bebe</h1>
          <p>Prvo unesite svoje ime i osnovne podatke bebe.</p>
        </div>
      </div>
      <div class="form-card">
        <label class="field"><span>Vaše ime</span><input class="input" id="ownerName" placeholder="Unesi svoje ime" value="${escapeHtml(ownerNameValue())}" autocomplete="name"></label>
        <label class="field"><span>Ime bebe</span><input class="input" id="babyName" placeholder="Unesi ime"></label>
        <label class="field"><span>Datum rođenja</span><input class="input" id="babyBirth" type="date"></label>
        <button class="primary" id="createBaby" type="button">Kreiraj dnevnik</button>
        <button class="demo-link" id="seedDemo" type="button">Prikaži demo dnevnik</button>
      </div>
    </section>`;
  };

  // Take over create flow before older handlers, so the owner name is saved before renderDiary() removes onboarding DOM.
  document.addEventListener("click",function(event){
    const createBtn=event.target.closest("#createBaby, #fallbackCreateBaby");
    if(!createBtn) return;
    const ownerInput=document.getElementById("ownerName") || document.getElementById("onboardingPersonName");
    const babyNameInput=document.getElementById("babyName") || document.getElementById("onboardingBabyName") || document.getElementById("fallbackBabyName");
    const birthInput=document.getElementById("babyBirth") || document.getElementById("fallbackBabyBirth");
    if(!babyNameInput) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const ownerName=(ownerInput?.value||"").trim();
    const babyName=(babyNameInput?.value||"").trim();
    ownerInput?.classList.remove("field-error");
    babyNameInput?.classList.remove("field-error");

    if(!ownerName){
      ownerInput?.classList.add("field-error");
      ownerInput?.focus();
      toast?.("Unesi svoje ime.");
      return;
    }
    if(!babyName){
      babyNameInput?.classList.add("field-error");
      babyNameInput?.focus();
      toast?.("Unesi ime bebe.");
      return;
    }

    saveOwnerNameEverywhere(ownerName);

    const baby={
      id:uid("baby"),
      name:babyName,
      birthDate:birthInput?.value||"",
      avatar:"",
      days:[],
      reminders:[],
      cloud:{},
      ownerName,
      createdAt:new Date().toISOString(),
      updatedAt:new Date().toISOString()
    };

    state={version:2,ownerName,updatedAt:new Date().toISOString(),babies:[baby]};
    selectedBabyId=baby.id;
    currentDayId=null;
    openCardId=null;
    currentTab="diary";
    localStorage.setItem(KEY,JSON.stringify(state));
    localStorage.setItem("babyDiaryCurrentBabyId",baby.id);
    renderDiary();
  }, true);

  function removeOwnerNameFromDiary(){
    document.querySelectorAll("#app .owner-name-settings-section").forEach(el=>el.remove());
  }

  function ensureOwnerNameInSettings(){
    removeOwnerNameFromDiary();
    const settingsPage=document.querySelector("#settingsScreen .settings-page");
    if(!settingsPage) return;
    if(settingsPage.querySelector(".owner-name-settings-section")){
      const small=settingsPage.querySelector(".owner-name-settings-section small");
      if(small) small.textContent=ownerNameValue() || "Nije dodato";
      return;
    }
    const section=document.createElement("section");
    section.className="settings-section owner-name-settings-section";
    section.innerHTML=`
      <h2>Korisnik</h2>
      <div class="settings-card">
        <button class="settings-action" id="changeOwnerName" type="button">
          <span>
            <strong>Vaše ime</strong>
            <small>${escapeHtml(ownerNameValue() || "Nije dodato")}</small>
          </span>
          ${icon("right")}
        </button>
      </div>`;
    const firstSection=settingsPage.querySelector(".settings-section");
    if(firstSection) settingsPage.insertBefore(section,firstSection);
    else settingsPage.appendChild(section);
    const btn=section.querySelector("#changeOwnerName");
    if(btn) btn.onclick=openChangeOwnerNameModal;
  }

  const previousOpenSettingsPage=openSettingsPage;
  openSettingsPage=function(){
    previousOpenSettingsPage();
    setTimeout(ensureOwnerNameInSettings,0);
  };

  const previousRenderDiary=renderDiary;
  renderDiary=function(){
    previousRenderDiary();
    removeOwnerNameFromDiary();
  };

  // Disable the old broad injector that placed Korisnik on the Dnevnik page.
  injectOwnerNameSettings=function(){ ensureOwnerNameInSettings(); };

  document.addEventListener("click",function(event){
    const target=event.target.closest("#changeOwnerName");
    if(!target) return;
    event.preventDefault();
    event.stopPropagation();
    openChangeOwnerNameModal();
  }, true);

  window.addEventListener("DOMContentLoaded",()=>{
    setTimeout(removeOwnerNameFromDiary,150);
    setTimeout(removeOwnerNameFromDiary,700);
  });
})();

/* v22 bugfix: persistent owner name, modal layering, and invite fallback cleanup */
(function(){
  const OWNER_NAME_KEYS=[typeof CLOUD_PARENT_KEY!=="undefined" ? CLOUD_PARENT_KEY : "babyDiaryParentName", "babyDiaryOwnerNameV1"];

  function cleanOwnerName(value){
    const clean=String(value||"").trim();
    return clean && clean!=="Osoba" ? clean : "";
  }

  function readOwnerName(){
    for(const key of OWNER_NAME_KEYS){
      const value=cleanOwnerName(localStorage.getItem(key));
      if(value) return value;
    }
    const stateName=cleanOwnerName(state?.ownerName);
    if(stateName) return stateName;
    const babyName=cleanOwnerName(getBaby?.()?.ownerName);
    if(babyName) return babyName;
    return "";
  }

  function persistOwnerName(name,{render=false}={}){
    const clean=cleanOwnerName(name);
    if(!clean) return "";

    OWNER_NAME_KEYS.forEach(key=>localStorage.setItem(key,clean));

    try{
      state=state||{version:2,babies:[]};
      state.ownerName=clean;
      state.updatedAt=new Date().toISOString();

      const baby=getBaby?.();
      if(baby){
        baby.ownerName=clean;
        baby.cloud=baby.cloud||{};
        if(typeof addOrUpdateBabyAccessPerson==="function"){
          addOrUpdateBabyAccessPerson(baby,clean,getDeviceId());
        }else if(typeof addOrUpdateAccessPerson==="function"){
          addOrUpdateAccessPerson(clean,getDeviceId());
        }
        baby.updatedAt=new Date().toISOString();
      }
      localStorage.setItem(KEY,JSON.stringify(state));
    }catch(error){}

    try{ saveCurrentBabyToCloud?.(); }catch(error){}
    if(render) renderDiary?.();
    return clean;
  }

  // Migrate any older saved value immediately, then keep localStorage/state in sync.
  persistOwnerName(readOwnerName());

  getParentName=function(){ return readOwnerName() || "Osoba"; };
  setParentName=function(name){ return persistOwnerName(name); };

  if(typeof getOwnerNameValue==="function"){
    getOwnerNameValue=function(){ return readOwnerName(); };
  }

  hasDisplayName=function(){ return !!readOwnerName(); };

  askDisplayNameIfMissing=function(callback){
    if(hasDisplayName()){
      if(typeof callback==="function") callback();
      return;
    }

    document.getElementById("displayNameModal")?.remove();

    const modal=document.createElement("div");
    modal.id="displayNameModal";
    modal.className="confirm-reminder-bg open owner-name-modal-top";
    modal.innerHTML=`
      <div class="confirm-reminder-card">
        <h2>Vaše ime</h2>
        <p>Unesite ime koje će se prikazivati u deljenom dnevniku.</p>
        <input class="input" id="displayNameInput" placeholder="npr. Mama, Tata, Baka..." autocomplete="name" value="${escapeHtml(readOwnerName())}">
        <div class="confirm-reminder-actions">
          <button type="button" class="cancel" id="cancelDisplayName">Kasnije</button>
          <button type="button" class="save" id="saveDisplayName">Sačuvaj</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    const input=document.getElementById("displayNameInput");
    setTimeout(()=>input?.focus(),100);

    function close(){ modal.remove(); }
    function save(){
      const value=(input.value||"").trim();
      input.classList.remove("field-error");
      if(!value){ input.classList.add("field-error"); input.focus(); return; }
      persistOwnerName(value,{render:true});
      close();
      if(typeof callback==="function") callback();
    }

    document.getElementById("cancelDisplayName").onclick=()=>{ close(); if(typeof callback==="function") callback(); };
    document.getElementById("saveDisplayName").onclick=save;
    input.addEventListener("keydown",event=>{ if(event.key==="Enter") save(); });
  };

  safeInviteNamePrompt=function(){
    if(hasDisplayName()) return Promise.resolve(getParentName());
    return new Promise(resolve=>{
      askDisplayNameIfMissing(()=>resolve(getParentName()));
    });
  };

  openChangeOwnerNameModal=function(){
    document.getElementById("changeOwnerNameModal")?.remove();

    const modal=document.createElement("div");
    modal.id="changeOwnerNameModal";
    modal.className="confirm-reminder-bg open owner-name-modal-top";
    modal.innerHTML=`
      <div class="confirm-reminder-card">
        <h2>Vaše ime</h2>
        <p>Unesite ime koje će se prikazivati u deljenom dnevniku.</p>
        <input class="input" id="changeOwnerNameInput" placeholder="npr. Mama, Tata, Baka..." value="${escapeHtml(readOwnerName())}" autocomplete="name">
        <div class="confirm-reminder-actions">
          <button type="button" class="cancel" id="cancelChangeOwnerName">Otkaži</button>
          <button type="button" class="save" id="saveChangeOwnerName">Sačuvaj</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    const input=document.getElementById("changeOwnerNameInput");
    setTimeout(()=>input?.focus(),100);

    function save(){
      const value=(input.value||"").trim();
      input.classList.remove("field-error");
      if(!value){ input.classList.add("field-error"); input.focus(); return; }
      persistOwnerName(value,{render:true});
      modal.remove();
    }

    document.getElementById("cancelChangeOwnerName").onclick=()=>modal.remove();
    document.getElementById("saveChangeOwnerName").onclick=save;
    input.addEventListener("keydown",event=>{ if(event.key==="Enter") save(); });
    modal.addEventListener("click",event=>{ if(event.target===modal) modal.remove(); });
  };

  function refreshOwnerNameUI(){
    const name=readOwnerName() || "Nije dodato";
    document.querySelectorAll(".owner-name-settings-section small").forEach(el=>{ el.textContent=name; });
    document.querySelectorAll(".access-person-chip").forEach(chip=>{
      const strong=chip.querySelector("strong");
      if(strong && strong.textContent.includes("(Ti)")) strong.textContent=(readOwnerName()||"Osoba")+" (Ti)";
    });
  }

  const previousRenderDiaryV22=renderDiary;
  renderDiary=function(){
    persistOwnerName(readOwnerName());
    previousRenderDiaryV22();
    setTimeout(refreshOwnerNameUI,0);
  };

  // Main share action should not open the old "Kopiraj pozivnicu" modal after the sheet is closed.
  shareInvite=async function(){
    try{
      await safeInviteNamePrompt();

      const code=await createCloudInvite();
      localStorage.setItem("babyDiaryInviteCode",code);

      const text=inviteMessage();
      const url=inviteLinkFromCode(code);

      if(navigator.share){
        try{
          await navigator.share({title:"Poziv za Baby Diary",text,url});
          return;
        }catch(error){
          // User cancelled native share sheet: do nothing.
          if(error?.name==="AbortError" || error?.name==="NotAllowedError") return;
        }
      }

      try{
        await navigator.clipboard.writeText(text);
        toast("Pozivnica je kopirana.");
      }catch(error){
        toast("Pozivnica nije kopirana. Prikaži kod i kopiraj poruku ručno.");
      }
    }catch(error){
      console.error(error);
      showTransferInfoModal("Deljenje nije uspelo", error.message || "Pokušaj ponovo.");
    }
  };

  document.addEventListener("click",function(event){
    const btn=event.target.closest("#sendInviteButton");
    if(!btn) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    shareInvite();
  },true);
})();
