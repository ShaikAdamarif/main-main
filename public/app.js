/* AV PROP MISSION - Static SPA (localStorage) */
(async () => {
'use strict';

// Wait briefly for cloud hydration, but never block the home/login screen.
// If the database/API is slow or unavailable, boot from local data and let sync finish in the background.
if (window.__cloudReady) {
  try {
    await Promise.race([
      window.__cloudReady,
      new Promise(resolve => setTimeout(resolve, 900))
    ]);
  } catch(e) {}
}

// ============ Animated Network Background ============
const canvas = document.getElementById('bgNet');
const ctx = canvas.getContext('2d');
let nodes = [];
function resize(){
  canvas.width = innerWidth; canvas.height = innerHeight;
  const count = Math.floor((innerWidth*innerHeight)/18000);
  nodes = Array.from({length:count}, () => ({
    x: Math.random()*canvas.width,
    y: Math.random()*canvas.height,
    vx:(Math.random()-.5)*.5, vy:(Math.random()-.5)*.5
  }));
}
addEventListener('resize', resize); resize();
function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  for(const n of nodes){
    n.x+=n.vx; n.y+=n.vy;
    if(n.x<0||n.x>canvas.width)n.vx*=-1;
    if(n.y<0||n.y>canvas.height)n.vy*=-1;
  }
  for(let i=0;i<nodes.length;i++){
    const a=nodes[i];
    for(let j=i+1;j<nodes.length;j++){
      const b=nodes[j];
      const dx=a.x-b.x, dy=a.y-b.y, d=Math.hypot(dx,dy);
      if(d<140){
        ctx.strokeStyle=`rgba(74,143,240,${(1-d/140)*0.4})`;
        ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
      }
    }
    ctx.fillStyle='rgba(10,61,145,.6)';
    ctx.beginPath();ctx.arc(a.x,a.y,2,0,Math.PI*2);ctx.fill();
  }
  requestAnimationFrame(draw);
}
draw();

// ============ Storage ============
const KEYS={users:'av_users',projects:'av_projects',assignments:'av_assignments',
  submissions:'av_submissions',callbacks:'av_callbacks',company:'av_company',
  portfolio:'av_portfolio',session:'av_session',offers:'av_offers',
  pwResets:'av_pwresets',regRequests:'av_regreq',adminApprovals:'av_adminreq',
  attendance:'av_attendance',sessionsLog:'av_sessions_log',settings:'av_settings'};

// ============ Face Recognition (face-api.js) ============
const FACE_MODELS_URL='https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model';
const FACE_MATCH_THRESHOLD=0.55; // lower = stricter. 0.5-0.6 typical
let _faceModelsReady=null;
async function loadFaceModels(){
  if(_faceModelsReady) return _faceModelsReady;
  if(typeof faceapi==='undefined'){throw new Error('Face library not loaded');}
  _faceModelsReady=(async()=>{
    await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODELS_URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODELS_URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODELS_URL);
  })();
  return _faceModelsReady;
}
async function detectFaceDescriptor(videoOrCanvas){
  await loadFaceModels();
  const opts=new faceapi.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:0.5});
  const result=await faceapi.detectSingleFace(videoOrCanvas,opts).withFaceLandmarks().withFaceDescriptor();
  return result||null;
}
function faceDistance(a,b){
  if(!a||!b||a.length!==b.length) return 999;
  let s=0;for(let i=0;i<a.length;i++){const d=a[i]-b[i];s+=d*d;}
  return Math.sqrt(s);
}
function stopRegCam(){
  try{
    if(window._regCamStream){
      window._regCamStream.getTracks().forEach(t=>t.stop());
      window._regCamStream=null;
    }
  }catch{}
}
function cameraErrorMessage(e){
  const isSecure = window.isSecureContext || location.hostname==='localhost';
  const hint = !isSecure ? ' — webcam requires HTTPS or localhost' :
               (e&&e.name==='NotAllowedError') ? ' — please allow camera permission in your browser' :
               (e&&e.name==='NotFoundError') ? ' — no camera detected on this device' :
               (e&&e.name==='NotReadableError') ? ' — camera is already in use by another app' : '';
  const base = (e&&e.message)||((e&&e.name)||'Camera unavailable');
  return base + hint;
}
function captureFacePhoto(video,canvas){
  const w=video.videoWidth||640, h=video.videoHeight||480;
  const max=480, scale=Math.min(1,max/Math.max(w,h));
  canvas.width=Math.max(1,Math.round(w*scale));
  canvas.height=Math.max(1,Math.round(h*scale));
  canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/jpeg',0.72);
}
// Reusable face-capture widget. Returns Promise<{descriptor:number[], photo:dataURL}>
function openFaceCapture({title='Capture Face',subtitle='Look straight at the camera. We will detect your eyes & nose.'}={}){
  return new Promise((resolve,reject)=>{
    modal(`
      <h2 class="section-title">${title}</h2>
      <p class="muted">${subtitle}</p>
      <video id="fc_vid" autoplay playsinline muted style="width:100%;border-radius:12px;background:#000;max-height:340px;object-fit:cover"></video>
      <canvas id="fc_cnv" style="display:none"></canvas>
      <div id="fc_status" class="muted" style="margin-top:8px">Loading face models…</div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn" id="fc_cap" disabled>📸 Capture Face</button>
        <button class="btn ghost" id="fc_cancel">Cancel</button>
      </div>
    `);
    let stream=null,done=false;
    const cleanup=()=>{if(stream){try{stream.getTracks().forEach(t=>t.stop())}catch{}stream=null;}};
    document.getElementById('fc_cancel').onclick=()=>{cleanup();closeModal();if(!done){done=true;reject(new Error('cancelled'))}};
    (async()=>{
      try{
        stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:false});
        const v=document.getElementById('fc_vid');v.srcObject=stream;
        await loadFaceModels();
        const st=document.getElementById('fc_status');
        if(st) st.textContent='Ready. Click Capture Face.';
        const btn=document.getElementById('fc_cap');if(btn) btn.disabled=false;
        btn.onclick=async()=>{
          btn.disabled=true;st.textContent='Analyzing face…';
          const c=document.getElementById('fc_cnv');
          c.width=v.videoWidth;c.height=v.videoHeight;
          c.getContext('2d').drawImage(v,0,0);
          const det=await detectFaceDescriptor(v);
          if(!det){st.textContent='No face detected. Look straight & try again.';btn.disabled=false;return;}
          const photo=c.toDataURL('image/jpeg',0.7);
          const descriptor=Array.from(det.descriptor);
          cleanup();closeModal();done=true;resolve({descriptor,photo});
        };
      }catch(e){
        const st=document.getElementById('fc_status');
        const isSecure = window.isSecureContext || location.hostname==='localhost';
        const hint = !isSecure ? ' — webcam requires HTTPS or localhost' :
                     (e && e.name==='NotAllowedError') ? ' — please allow camera permission in your browser' :
                     (e && e.name==='NotFoundError') ? ' — no camera detected on this device' : '';
        if(st) st.innerHTML='<span style="color:#c0392b">Webcam error: '+(e.message||e.name)+hint+'</span>';
      }
    })();
  });
}
const db = {
  get(k,def){try{return JSON.parse(localStorage.getItem(k))??def}catch{return def}},
  set(k,v){localStorage.setItem(k,JSON.stringify(v))}
};
// Avatar circle for user/HR/admin rows — shows registered face photo if present.
function avatarHTML(u){
  const initials = (u && u.name ? u.name.trim().split(/\s+/).map(s=>s[0]||'').join('').slice(0,2).toUpperCase() : '?');
  if(u && u.faceImg){
    return `<img class="av-circle" src="${u.faceImg}" alt="${(u.name||'').replace(/"/g,'&quot;')}" title="Registered face" onclick="window._av.viewFace('${u.id}')"/>`;
  }
  return `<span class="av-circle av-initials" title="No face registered">${initials}</span>`;
}
// Seed
if(!db.get(KEYS.users)) db.set(KEYS.users,[]);
if(!db.get(KEYS.projects)) db.set(KEYS.projects,[]);
if(!db.get(KEYS.assignments)) db.set(KEYS.assignments,[]);
if(!db.get(KEYS.submissions)) db.set(KEYS.submissions,[]);
if(!db.get(KEYS.callbacks)) db.set(KEYS.callbacks,[]);
if(!db.get(KEYS.offers)) db.set(KEYS.offers,[]);
if(!db.get(KEYS.pwResets)) db.set(KEYS.pwResets,[]);
if(!db.get(KEYS.regRequests)) db.set(KEYS.regRequests,[]);
if(!db.get(KEYS.adminApprovals)) db.set(KEYS.adminApprovals,[]);
if(!db.get(KEYS.attendance)) db.set(KEYS.attendance,[]);
if(!db.get(KEYS.sessionsLog)) db.set(KEYS.sessionsLog,[]);
if(!db.get(KEYS.settings)) db.set(KEYS.settings,{attendanceOpen:false});
// Seed default Admin 1 (fixed credentials).
// Runs on boot AND again after cloud hydration / any remote update of av_users,
// so stale data from Neon can never lock you out.
const FIXED_ADMIN_EMAIL='avpropmission@gmail.com';
const FIXED_ADMIN_PWD='1018na29';
function seedAdmin1(){
  const users=db.get(KEYS.users,[]);
  const existing=users.find(u=>u.role==='admin'&&u.adminSlot===1);
  if(!existing){
    users.push({id:uid(),name:'Main Admin',email:FIXED_ADMIN_EMAIL,mob:'',age:'',
      password:FIXED_ADMIN_PWD,role:'admin',adminSlot:1,approved:true,createdAt:now(),fixed:true});
    db.set(KEYS.users,users);
    return;
  }
  let changed=false;
  if(existing.email!==FIXED_ADMIN_EMAIL){existing.email=FIXED_ADMIN_EMAIL;changed=true;}
  if(existing.password!==FIXED_ADMIN_PWD){existing.password=FIXED_ADMIN_PWD;changed=true;}
  if(!existing.approved){existing.approved=true;changed=true;}
  if(!existing.fixed){existing.fixed=true;changed=true;}
  if(changed) db.set(KEYS.users,users);
}
seedAdmin1();
// Re-seed after cloud hydration finishes (it may overwrite av_users with stale data).
if(window.__cloudReady){ window.__cloudReady.then(()=>{ try{seedAdmin1()}catch{} }); }
// Re-seed whenever a remote SSE update replaces av_users.
window.addEventListener('storage', (e)=>{ if(e.key==='av_users'){ try{seedAdmin1()}catch{} } });
if(!db.get(KEYS.company)) db.set(KEYS.company,[
  {id:uid(),title:'Skyline Residency',desc:'Premium 3 BHK apartments in city center.',img:'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=600',url:''},
  {id:uid(),title:'Green Valley Villas',desc:'Luxurious villas with eco-friendly design.',img:'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=600',url:''},
  {id:uid(),title:'Coastal Heights',desc:'Sea-view apartments with modern amenities.',img:'https://images.unsplash.com/photo-1582407947304-fd86f028f716?w=600',url:''}
]);
if(!db.get(KEYS.portfolio)) db.set(KEYS.portfolio,[
  {id:uid(),title:'Luxury Apartment Project',desc:'Modern apartment design and sales.',img:'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600',url:'https://golden-web-solutions-india.lovable.app/#portfolio'},
  {id:uid(),title:'Commercial Plaza',desc:'Multi-floor commercial complex.',img:'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=600',url:'https://golden-web-solutions-india.lovable.app/#portfolio'}
]);

function uid(){return Math.random().toString(36).slice(2,10)+Date.now().toString(36)}
function now(){return new Date().toLocaleString()}
function nowISO(){return new Date().toISOString()}
function msToHM(ms){
  if(!ms||ms<0) return '—';
  const m=Math.floor(ms/60000);const h=Math.floor(m/60);
  return `${h}h ${m%60}m`;
}

// ============ Auth ============
function getSession(){return db.get(KEYS.session,null)}
function setSession(s){db.set(KEYS.session,s)}
function logout(){
  const s=getSession();
  if(s&&s.logId){
    const logs=db.get(KEYS.sessionsLog,[]);
    const l=logs.find(x=>x.id===s.logId);
    if(l&&!l.logoutAt){
      l.logoutAt=nowISO();
      l.logoutAtStr=now();
      l.durationMs=new Date(l.logoutAt)-new Date(l.loginAt);
      db.set(KEYS.sessionsLog,logs);
    }
  }
  setSession(null);go('home');toast('Logged out');
}

// Auto-detect logout when tab/window closes or session ends
function autoCloseSession(){
  const s=getSession();
  if(!s||!s.logId) return;
  const logs=db.get(KEYS.sessionsLog,[]);
  const l=logs.find(x=>x.id===s.logId);
  if(l&&!l.logoutAt){
    l.logoutAt=nowISO();
    l.logoutAtStr=now();
    l.durationMs=new Date(l.logoutAt)-new Date(l.loginAt);
    l.autoClosed=true;
    db.set(KEYS.sessionsLog,logs);
  }
}
window.addEventListener('beforeunload',autoCloseSession);
window.addEventListener('pagehide',autoCloseSession);
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden') autoCloseSession();
});

function adminCount(){return db.get(KEYS.users,[]).filter(u=>u.role==='admin'&&u.approved).length}
function hasAdmin1(){return db.get(KEYS.users,[]).some(u=>u.role==='admin'&&u.adminSlot===1)}
function hasAdmin2(){return db.get(KEYS.users,[]).some(u=>u.role==='admin'&&u.adminSlot===2)}

// ============ UI helpers ============
const app = document.getElementById('app');
function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg;t.classList.remove('hidden');
  clearTimeout(t._t);t._t=setTimeout(()=>t.classList.add('hidden'),2600);
}
// Big animated overlay (silver-shine) for delete/export/login success
function animSuccess(msg,icon='✅',ms=1400){
  let n=document.getElementById('avAnim');
  if(n) n.remove();
  n=document.createElement('div');
  n.id='avAnim';
  n.innerHTML=`<div class="av-anim-box"><div class="av-anim-icon">${icon}</div><div class="av-anim-msg">${msg}</div></div>`;
  document.body.appendChild(n);
  clearTimeout(animSuccess._t);
  animSuccess._t=setTimeout(()=>{ n.style.animation='avAnimFade .25s ease reverse'; setTimeout(()=>n.remove(),240); }, ms);
}
window.animSuccess=animSuccess;
function modal(html){
  document.getElementById('modalBody').innerHTML=html;
  document.getElementById('modal').classList.remove('hidden');
}
function closeModal(){
  stopRegCam();
  document.getElementById('modal').classList.add('hidden');
}
document.getElementById('modalClose').onclick=closeModal;
document.getElementById('modal').onclick=e=>{if(e.target.id==='modal')closeModal()};

function pwdInput(id,label='Password'){
  return `<div class="input-group"><label>${label}</label><div class="pwd-wrap">
    <input type="password" id="${id}" required />
    <button type="button" class="eye" onclick="(function(b){const i=b.previousElementSibling;i.type=i.type==='password'?'text':'password';b.textContent=i.type==='password'?'👁':'🙈'})(this)">👁</button>
  </div></div>`;
}

async function fileToBase64(file){
  return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res({name:file.name,type:file.type,data:r.result});r.onerror=rej;r.readAsDataURL(file);});
}

// ============ Routing ============
const views = {};
let _lastView = 'home';
let _lastData = undefined;
function go(name,data){
  history.replaceState(null,'','#'+name);
  _lastView = name; _lastData = data;
  (views[name]||views.home)(data);
}
document.querySelectorAll('.navbtn').forEach(b=>b.onclick=()=>go(b.dataset.view));

// ============ HOME ============
views.home = () => {
  const company = db.get(KEYS.company,[]);
  app.innerHTML = `
    <h2 class="section-title">Welcome to AV PROP MISSION</h2>
    <p class="muted">Your trusted partner in real estate excellence. Login to your portal below.</p>

    <div class="grid cols-3">
      ${[['admin','Admin Login','Manage entire platform'],['hr','HR Login','Manage projects & users'],['user','User Login','View assigned work']]
        .map(([r,t,d])=>`
        <div class="card">
          <h3>${t}</h3><p>${d}</p>
          <div class="btn-row">
            <button class="btn" onclick="window._av.openLogin('${r}')">Login</button>
          </div>
        </div>`).join('')}
    </div>

    <div class="card" style="margin-top:24px">
      <h3>Request a Callback</h3>
      <div class="input-group"><label>Name</label><input id="cb_name" /></div>
      <div class="input-group"><label>Mobile Number</label><input id="cb_mob" placeholder="+91 XXXXX XXXXX" /></div>
      <div class="input-group"><label>Email</label><input id="cb_email" type="email" /></div>
      <div class="input-group"><label>Message</label><textarea id="cb_msg" rows="3"></textarea></div>
      <button class="btn" onclick="window._av.submitCallback()">Submit Callback</button>
    </div>

    <h2 class="section-title" style="margin-top:30px">Our Company Projects</h2>
    <div class="grid cols-3">
      ${company.map(p=>`<div class="card" ${p.url?`onclick="window.open('${p.url}','_blank')" style="cursor:pointer"`:''}><img src="${p.img}" style="width:100%;border-radius:10px;margin-bottom:8px"/><h3>${esc(p.title)}</h3><p>${esc(p.desc)}</p></div>`).join('')}
    </div>

    <div class="leaders">
      <div class="leader-box" onclick="this.classList.toggle('pop')">
        <div class="role">Chairman & Managing Director</div>
        <div class="name">SHAIK ASHRAFF</div>
      </div>
      <div class="leader-box" onclick="this.classList.toggle('pop')">
        <div class="role">CEO</div>
        <div class="name">R VINEELA</div>
      </div>
    </div>
  `;
};

views.contact = () => {
  app.innerHTML = `
    <h2 class="section-title">Contact Us</h2>
    <div class="card" style="max-width:520px">
      <h3>Get in Touch</h3>
      <p>Reach out via phone or email — we respond fast.</p>
      <div class="btn-row">
        <a class="btn" href="tel:+919347821312">📞 +91 93478 21312</a>
        <a class="btn ghost" href="mailto:avpropmission@gmail.com">✉ avpropmission@gmail.com</a>
      </div>
    </div>`;
};
views.services = () => {
  app.innerHTML = `
    <h2 class="section-title">Our Services</h2>
    <div class="grid cols-3">
      ${['Property Sales','Property Rentals','Real Estate Consulting','Project Marketing','Investment Advisory','Property Management']
        .map(s=>`<div class="card"><h3>${s}</h3><p>Professional ${s.toLowerCase()} with end-to-end support.</p></div>`).join('')}
    </div>
    <div class="card" style="margin-top:20px;max-width:520px">
      <h3>Contact for Services</h3>
      <div class="btn-row">
        <a class="btn" href="tel:+919347821312">📞 +91 93478 21312</a>
        <a class="btn ghost" href="mailto:avpropmission@gmail.com">✉ avpropmission@gmail.com</a>
      </div>
    </div>`;
};
views.portfolio = () => {
  const items = db.get(KEYS.portfolio,[]);
  app.innerHTML = `
    <h2 class="section-title">Portfolio</h2>
    <p class="muted">A selection of our completed work.</p>
    <div class="grid cols-2">
      ${items.map(p=>`<div class="card">
        <img src="${p.img}" style="width:100%;border-radius:10px;margin-bottom:10px;cursor:pointer" onclick="window._av.viewProject('${p.id}','portfolio')"/>
        <h3>${esc(p.title)}</h3><p>${esc(p.desc)}</p>
        ${p.url?`<a class="btn ghost" href="${p.url}" target="_blank">View Details</a>`:''}
      </div>`).join('')}
    </div>`;
};

function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

// ============ Login / Register ============
window._av = {};

_av.openLogin = (role) => {
  modal(`
    <h2 class="section-title">${role.toUpperCase()} Login</h2>
    <div class="input-group"><label>Email</label><input id="li_email" type="email" /></div>
    ${pwdInput('li_pwd')}
    <button class="btn" onclick="window._av.doLogin('${role}')">Login</button>
    <button class="btn ghost" style="margin-left:8px" onclick="window._av.forgot('${role}')">Forgot Password?</button>
  `);
};

_av.doLogin = (role) => {
  const email=document.getElementById('li_email').value.trim().toLowerCase();
  const pwd=document.getElementById('li_pwd').value;
  // If admin login, re-enforce the fixed Admin 1 credentials first so cloud
  // hydration cannot lock the owner out.
  if(role==='admin'){ try{ seedAdmin1(); }catch{} }
  const users=db.get(KEYS.users,[]);
  const u=users.find(x=>(x.email||'').trim().toLowerCase()===email&&x.password===pwd&&x.role===role);
  if(!u) return toast('Invalid credentials');
  if(!u.approved) return toast('Account pending admin approval');
  const logId=uid();
  const logs=db.get(KEYS.sessionsLog,[]);
  logs.unshift({id:logId,userId:u.id,name:u.name,email:u.email,role:u.role,
    loginAt:nowISO(),loginAtStr:now(),logoutAt:null,logoutAtStr:null});
  db.set(KEYS.sessionsLog,logs);
  setSession({id:u.id,role:u.role,email:u.email,name:u.name,logId});
  closeModal();animSuccess('Logged in Successfully','🎉');
  setTimeout(()=>go('dash'),400);
};

_av.openRegister = (role) => {
  if(role==='admin'){
    const a1=hasAdmin1(),a2=hasAdmin2();
    if(a1&&a2) return toast('Admin slots full (max 2)');
    modal(`
      <h2 class="section-title">Admin Registration</h2>
      <div class="input-group"><label>Select Admin Slot</label>
        <select id="ri_slot">
          <option value="1" ${a1?'disabled':''}>Admin 1 ${a1?'(taken)':''}</option>
          <option value="2" ${a2?'disabled':''}>Admin 2 ${a2?'(taken)':''}</option>
        </select>
      </div>
      ${commonRegFields()}
      ${faceCaptureBlock(false)}
      <button class="btn" onclick="window._av.doRegister('admin')">Register</button>
    `);
    _av.initRegCam(false);
  } else {
    modal(`
      <h2 class="section-title">${role.toUpperCase()} Registration</h2>
      <p class="muted">Your account requires admin approval before login. We will capture your face (eyes & nose) now so attendance can verify you later.</p>
      ${commonRegFields()}
      ${faceCaptureBlock(true)}
      <button class="btn" onclick="window._av.doRegister('${role}')">Register</button>
    `);
    _av.initRegCam(true);
  }
};
function commonRegFields(){
  return `
    <div class="input-group"><label>Full Name</label><input id="ri_name" /></div>
    <div class="input-group"><label>Age</label><input id="ri_age" type="number" /></div>
    <div class="input-group"><label>Email</label><input id="ri_email" type="email" /></div>
    <div class="input-group"><label>Mobile</label><input id="ri_mob" /></div>
    ${pwdInput('ri_pwd')}
  `;
}
function faceCaptureBlock(required){
  return `
    <div class="input-group face-capture-panel">
      <label>Face Capture ${required?'<span style="color:#c0392b">*required</span>':'(optional)'}</label>
      <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
        <video id="rc_vid" autoplay playsinline muted style="display:none;width:260px;max-width:100%;border-radius:12px;background:#000;aspect-ratio:4/3;object-fit:cover;border:2px solid #ddd"></video>
        <img id="rc_preview" alt="captured face" style="display:none;width:140px;border-radius:50%;border:3px solid #2d8a9e;object-fit:cover;aspect-ratio:1/1"/>
      </div>
      <canvas id="rc_cnv" style="display:none"></canvas>
      <div id="rc_status" class="muted" style="margin-top:6px">Click "Enable Webcam" to capture and save this account face in Neon.</div>
      <div class="btn-row" style="margin-top:8px">
        <button type="button" class="btn" id="rc_start">🎥 Enable Webcam</button>
        <button type="button" class="btn" id="rc_capture" disabled style="display:none">📸 Capture Face</button>
        <button type="button" class="btn ghost" id="rc_retake" style="display:none">Retake</button>
      </div>
    </div>
  `;
}
_av.initRegCam = (required) => {
  stopRegCam();
  window._regFace = null;
  const v=document.getElementById('rc_vid');
  const st=document.getElementById('rc_status');
  const start=document.getElementById('rc_start');
  const btn=document.getElementById('rc_capture');
  const retake=document.getElementById('rc_retake');
  const prev=document.getElementById('rc_preview');
  if(!v||!st||!start||!btn||!retake||!prev) return;
  start.onclick=async()=>{
    try{
      if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia) throw new Error('Webcam is not available in this browser');
      start.disabled=true;
      st.textContent='Requesting camera permission…';
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:false});
      window._regCamStream=stream;
      v.srcObject=stream;
      v.style.display='block';
      prev.style.display='none';
      st.textContent='Loading face models…';
      await loadFaceModels();
      st.textContent='Camera ready. Click "Capture Face".';
      btn.style.display='inline-block';
      btn.disabled=false;
      start.style.display='none';
    }catch(e){
      start.disabled=false;
      st.innerHTML='<span style="color:#c0392b">Webcam error: '+cameraErrorMessage(e)+'</span>';
    }
  };
  btn.onclick=async()=>{
    btn.disabled=true;
    st.textContent='Analyzing face…';
    try{
      if(!v.videoWidth) throw new Error('Webcam not ready yet');
      const c=document.getElementById('rc_cnv');
      const det=await detectFaceDescriptor(v);
      if(!det){ st.innerHTML='<span style="color:#c0392b">No face detected — look straight at camera and try again.</span>'; btn.disabled=false; return; }
      const photo=captureFacePhoto(v,c);
      window._regFace={descriptor:Array.from(det.descriptor),photo};
      prev.src=photo;
      prev.style.display='block';
      v.style.display='none';
      btn.style.display='none';
      retake.style.display='inline-block';
      stopRegCam();
      st.innerHTML='<span style="color:#1a7f37">✅ Face captured! Create/Register will store it in Neon.</span>';
    }catch(e){
      st.innerHTML='<span style="color:#c0392b">Face capture failed: '+((e&&e.message)||e)+'</span>';
      btn.disabled=false;
    }
  };
  retake.onclick=()=>{
    stopRegCam();
    window._regFace=null;
    prev.style.display='none';
    v.style.display='none';
    retake.style.display='none';
    btn.style.display='none';
    btn.disabled=true;
    start.style.display='inline-block';
    start.disabled=false;
    st.textContent='Click "Enable Webcam" to retake your face photo.';
  };
};

_av.doRegister = (role) => {
  const name=document.getElementById('ri_name').value.trim();
  const age=document.getElementById('ri_age').value;
  const email=document.getElementById('ri_email').value.trim().toLowerCase();
  const mob=document.getElementById('ri_mob').value.trim();
  const pwd=document.getElementById('ri_pwd').value;
  if(!name||!email||!pwd) return toast('Fill all required fields');
  const users=db.get(KEYS.users,[]);
  if(users.some(u=>u.email===email)) return toast('Email already registered');
  let slot=null;
  if(role==='admin'){
    slot=parseInt(document.getElementById('ri_slot').value);
    if(slot===2 && hasAdmin2()) return toast('Admin 2 slot taken');
    if(slot===1 && hasAdmin1()) return toast('Admin 1 slot taken');
  }
  const needFace = (role==='hr'||role==='user');
  const face = window._regFace || null;
  if(needFace && !face) return toast('Please capture your face before registering.');
  const user={id:uid(),name,age,email,mob,password:pwd,role,createdAt:now(),approved:false};
  if(face){user.face=face.descriptor;user.faceImg=face.photo;}
  if(role==='admin'){
    user.adminSlot=slot;
    if(slot===1 && !hasAdmin1()){
      user.approved=true;
      users.push(user);db.set(KEYS.users,users);
      window._regFace=null;
      successAnim('Admin 1 registered! Auto-approved.');
      return;
    }
    users.push(user);db.set(KEYS.users,users);
    window._regFace=null;
    successAnim('Admin 2 registered. Awaiting Admin 1 approval.');
  } else {
    users.push(user);db.set(KEYS.users,users);
    window._regFace=null;
    successAnim(`${role.toUpperCase()} registered. Awaiting admin approval.`);
  }
};

function successAnim(msg){
  document.getElementById('modalBody').innerHTML=`
    <div style="text-align:center;padding:30px">
      <div style="font-size:80px;animation:pop .5s">✅</div>
      <h2 class="section-title" style="margin-top:10px">Success!</h2>
      <p class="muted">${msg}</p>
    </div>`;
  document.getElementById('modal').classList.remove('hidden');
  setTimeout(()=>{closeModal();go('home')},1800);
}
function successAnimStay(msg,cb){
  document.getElementById('modalBody').innerHTML=`
    <div style="text-align:center;padding:30px">
      <div style="font-size:80px;animation:pop .5s">✅</div>
      <h2 class="section-title" style="margin-top:10px">Success!</h2>
      <p class="muted">${msg}</p>
    </div>`;
  document.getElementById('modal').classList.remove('hidden');
  setTimeout(()=>{closeModal();if(cb)cb();},1500);
}

// Forgot password — OTP shown on screen
_av.forgot = (role) => {
  modal(`
    <h2 class="section-title">Forgot Password</h2>
    <div class="input-group"><label>Registered Email</label><input id="fp_email" type="email" /></div>
    <button class="btn" onclick="window._av.sendOtp('${role}')">Send OTP</button>
  `);
};
_av.sendOtp = (role) => {
  const email=document.getElementById('fp_email').value.trim().toLowerCase();
  const users=db.get(KEYS.users,[]);
  const u=users.find(x=>x.email===email&&x.role===role);
  if(!u) return toast('Email not found for this role');
  const otp=Math.floor(1000+Math.random()*9000).toString();
  u._otp=otp;db.set(KEYS.users,users);
  document.getElementById('modalBody').innerHTML=`
    <h2 class="section-title">Enter OTP</h2>
    <div class="card" style="margin-bottom:14px;text-align:center;background:linear-gradient(135deg,#fff,#dbe9ff)">
      <p class="muted">Your OTP (shown on screen, no email sent):</p>
      <div style="font-size:36px;font-weight:800;letter-spacing:8px;color:var(--blue)">${otp}</div>
    </div>
    <div class="input-group"><label>Enter OTP</label><input id="fp_otp" /></div>
    ${pwdInput('fp_new','New Password')}
    <button class="btn" onclick="window._av.resetPwd('${email}','${role}')">Reset Password</button>
  `;
};
_av.resetPwd = (email,role) => {
  const otp=document.getElementById('fp_otp').value.trim();
  const np=document.getElementById('fp_new').value;
  const users=db.get(KEYS.users,[]);
  const u=users.find(x=>x.email===email&&x.role===role);
  if(!u||u._otp!==otp) return toast('Invalid OTP');
  if(role==='admin' && u.adminSlot===1){
    // admin 1 reset needs admin 2 approval if exists
    const a2=users.find(x=>x.role==='admin'&&x.adminSlot===2&&x.approved);
    if(a2){
      const reqs=db.get(KEYS.pwResets,[]);
      reqs.push({id:uid(),userId:u.id,name:u.name,email:u.email,role,adminSlot:1,newPwd:np,approverSlot:2,by:'self',at:now()});
      db.set(KEYS.pwResets,reqs);delete u._otp;db.set(KEYS.users,users);
      return successAnim('Reset request sent to Admin 2 for approval.');
    }
  }
  if(role==='admin' && u.adminSlot===2){
    // admin 2 reset goes to admin 1
    const reqs=db.get(KEYS.pwResets,[]);
    reqs.push({id:uid(),userId:u.id,name:u.name,email:u.email,role,adminSlot:2,newPwd:np,approverSlot:1,by:'self',at:now()});
    db.set(KEYS.pwResets,reqs);delete u._otp;db.set(KEYS.users,users);
    return successAnim('Reset request sent to Admin 1 for approval.');
  }
  if(role!=='admin'){
    // user/hr reset needs admin approval
    const reqs=db.get(KEYS.pwResets,[]);
    reqs.push({id:uid(),userId:u.id,name:u.name,email:u.email,role,newPwd:np,at:now()});
    db.set(KEYS.pwResets,reqs);delete u._otp;db.set(KEYS.users,users);
    return successAnim('Reset request sent to admin for approval.');
  }
  u.password=np;delete u._otp;db.set(KEYS.users,users);
  successAnim('Password reset successful!');
};

_av.submitCallback = () => {
  const c={id:uid(),
    name:document.getElementById('cb_name').value.trim(),
    mob:document.getElementById('cb_mob').value.trim(),
    email:document.getElementById('cb_email').value.trim(),
    msg:document.getElementById('cb_msg').value.trim(),at:now()};
  if(!c.name||!c.mob) return toast('Name and mobile required');
  const list=db.get(KEYS.callbacks,[]);list.unshift(c);db.set(KEYS.callbacks,list);
  toast('Callback request submitted! ✅');
  ['cb_name','cb_mob','cb_email','cb_msg'].forEach(i=>document.getElementById(i).value='');
};

// ============ DASHBOARDS ============
views.dash = () => {
  const s=getSession();
  if(!s) return go('home');
  if(s.role==='admin') return adminDash();
  if(s.role==='hr') return hrDash();
  return userDash();
};

function dashHeader(s,title){
  return `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:20px">
    <div><h2 class="section-title">${title}</h2><p class="muted">Welcome, ${esc(s.name)} (${s.email})</p></div>
    <div class="btn-row" style="margin:0">
      <button class="btn ghost" onclick="window._av.viewProfile()">My Profile</button>
      <button class="btn danger" onclick="window._av.logout()">Logout</button>
    </div>
  </div>`;
}
_av.logout = logout;
_av.viewProfile = () => {
  const s=getSession();
  const u=db.get(KEYS.users,[]).find(x=>x.id===s.id);
  modal(`<h2 class="section-title">My Profile</h2>
    <div class="card">
      <p><b>Name:</b> ${esc(u.name)}</p>
      <p><b>Email:</b> ${esc(u.email)}</p>
      <p><b>Mobile:</b> ${esc(u.mob||'-')}</p>
      <p><b>Age:</b> ${esc(u.age||'-')}</p>
      <p><b>Role:</b> ${u.role.toUpperCase()}${u.adminSlot?' '+u.adminSlot:''}</p>
      <p><b>Joined:</b> ${esc(u.createdAt)}</p>
    </div>
    ${u.role==='admin'&&!u.fixed?`<button class="btn danger" style="margin-top:10px" onclick="window._av.deleteMyAccount()">Delete My Account</button>`:''}
  `);
};
_av.deleteMyAccount = () => {
  const s=getSession();
  const u=db.get(KEYS.users,[]).find(x=>x.id===s.id);
  if(u&&u.fixed) return toast('Main admin account cannot be deleted');
  if(!confirm('Delete your admin account permanently?')) return;
  let users=db.get(KEYS.users,[]);
  users=users.filter(u=>u.id!==s.id);
  db.set(KEYS.users,users);logout();
};

// ===== ADMIN =====
function adminDash(){
  const s=getSession();
  const users=db.get(KEYS.users,[]);
  const hr=users.filter(u=>u.role==='hr');
  const usr=users.filter(u=>u.role==='user');
  const adm=users.filter(u=>u.role==='admin');
  const company=db.get(KEYS.company,[]);
  app.innerHTML = dashHeader(s,'Admin Dashboard') + `
    <div class="grid cols-3">
      <div class="card"><h3>${adm.length}</h3><p>Admins</p></div>
      <div class="card"><h3>${hr.length}</h3><p>HR Members</p></div>
      <div class="card"><h3>${usr.length}</h3><p>Users</p></div>
    </div>

    <div class="tabs" style="margin-top:20px">
      ${['overview','manage','approvals','users','assign','submissions','offers','callbacks','attendance','timelogs','company','portfolio','passwords']
        .map(t=>`<button class="tab" data-tab="${t}">${tabLabel(t)}</button>`).join('')}
    </div>
    <div id="tabContent"></div>

    <h2 class="section-title" style="margin-top:30px">Company Projects</h2>
    <div class="grid cols-3">
      ${company.slice(0,3).map(p=>`<div class="card"><img src="${p.img}" style="width:100%;border-radius:10px;margin-bottom:8px;cursor:pointer" onclick="${p.url?`window.open('${p.url}','_blank')`:`window._av.viewProject('${p.id}','company')`}"/><h3>${esc(p.title)}</h3><p>${esc(p.desc)}</p></div>`).join('')}
    </div>
  `;
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');renderAdminTab(b.dataset.tab);
  });
  document.querySelector('.tab').click();
}
function tabLabel(t){return{overview:'Overview',manage:'Manage Accounts',approvals:'Approvals',users:'HR/Users',assign:'Assign Work',submissions:'Submissions',offers:'Offer Letters',callbacks:'Callback Requests',attendance:'Attendance Records',timelogs:'⏱ Time Logs',company:'My Company Projects',portfolio:'Edit My Portfolio',passwords:'View Passwords'}[t]}

function renderAdminTab(t){
  const c=document.getElementById('tabContent');
  const users=db.get(KEYS.users,[]);
  const sess=getSession();
  const me=users.find(u=>u.id===sess.id);
  const mySlot=me&&me.adminSlot;
  if(t==='overview'){
    c.innerHTML=`<div class="card"><h3>Welcome, Admin ${mySlot||''}</h3><p>Use the tabs above to manage accounts, approvals, users, projects, callbacks, offers, portfolio, and more.</p></div>`;
  }
  else if(t==='manage'){
    const a2=users.find(u=>u.role==='admin'&&u.adminSlot===2);
    let html=`<div class="card"><h3>Admin Accounts (Max 2)</h3>
      <div class="list-row"><div><b>Admin 1</b> <span class="tag approved">Active</span><div class="meta">${esc(users.find(u=>u.adminSlot===1)?.email||'')}</div></div></div>`;
    if(a2){
      html+=`<div class="list-row"><div><b>Admin 2</b> <span class="tag ${a2.approved?'approved':'pending'}">${a2.approved?'Active':'Pending'}</span><div class="meta">${esc(a2.email)}</div></div>
        ${mySlot===1?`<div><button class="btn danger" onclick="window._av.removeAdmin2()">Remove Admin 2</button></div>`:''}</div>`;
    } else if(mySlot===1){
      html+=`<div style="margin-top:14px"><button class="btn" onclick="window._av.openAddAdmin2()">+ Add Admin 2</button></div>`;
    } else {
      html+=`<p class="muted" style="margin-top:10px">Admin 2 slot empty. Only Admin 1 can add.</p>`;
    }
    html+=`</div>
      <div class="card" style="margin-top:14px"><h3>Add HR / User Account</h3>
        <div class="input-group"><label>Role</label><select id="ma_role"><option value="hr">HR</option><option value="user">User</option></select></div>
        <div class="input-group"><label>Full Name</label><input id="ma_name"/></div>
        <div class="input-group"><label>Email</label><input id="ma_email" type="email"/></div>
        <div class="input-group"><label>Mobile</label><input id="ma_mob"/></div>
        <div class="input-group"><label>Age</label><input id="ma_age" type="number"/></div>
        ${pwdInput('ma_pwd')}
        ${faceCaptureBlock(true)}
        <button class="btn" onclick="window._av.addAccount()">Create Account</button>
      </div>`;
    c.innerHTML=html;
    _av.initRegCam(true);
  }
  else if(t==='approvals'){
    const pendingUsers=users.filter(u=>!u.approved&&u.role!=='admin');
    const pendingAdmins=users.filter(u=>!u.approved&&u.role==='admin');
    const pwResets=db.get(KEYS.pwResets,[]).filter(r=>{
      // admin password resets only show to designated approver slot
      if(r.role==='admin') return r.approverSlot===mySlot;
      return true; // HR/user resets visible to any admin
    });
    c.innerHTML=`
      <h3 style="color:var(--blue);margin-bottom:10px">Pending Admin 2 Registrations</h3>
      ${pendingAdmins.length?pendingAdmins.map(u=>`<div class="list-row"><div class="av-row">${avatarHTML(u)}<div><b>${esc(u.name)}</b> (Admin ${u.adminSlot})<div class="meta">${esc(u.email)}</div></div></div>
        ${mySlot===1?`<div><button class="btn success" onclick="window._av.approve('${u.id}')">Approve</button>
        <button class="btn danger" onclick="window._av.reject('${u.id}')">Reject</button></div>`:'<div class="meta">Admin 1 only</div>'}</div>`).join(''):'<p class="muted">None</p>'}
      <h3 style="color:var(--blue);margin:14px 0 10px">Pending HR/User Registrations</h3>
      ${pendingUsers.length?pendingUsers.map(u=>`<div class="list-row"><div class="av-row">${avatarHTML(u)}<div><b>${esc(u.name)}</b> (${u.role})<div class="meta">${esc(u.email)}</div></div></div>
        <div><button class="btn success" onclick="window._av.approve('${u.id}')">Approve</button>
        <button class="btn danger" onclick="window._av.reject('${u.id}')">Reject</button></div></div>`).join(''):'<p class="muted">None</p>'}
      <h3 style="color:var(--blue);margin:14px 0 10px">Password Reset Requests</h3>
      ${pwResets.length?pwResets.map(r=>{const ru=users.find(x=>x.id===r.userId)||r;return `<div class="list-row"><div class="av-row">${avatarHTML(ru)}<div><b>${esc(r.name)}</b> (${r.role}${r.adminSlot?' '+r.adminSlot:''})<div class="meta">${esc(r.email)} • ${r.at}</div></div></div>
        <div><button class="btn success" onclick="window._av.approveReset('${r.id}')">Approve</button>
        <button class="btn danger" onclick="window._av.rejectReset('${r.id}')">Reject</button></div></div>`}).join(''):'<p class="muted">None</p>'}
    `;
  }
  else if(t==='users'){
    const list=users.filter(u=>u.role!=='admin');
    c.innerHTML=list.length?list.map(u=>`<div class="list-row"><div class="av-row">${avatarHTML(u)}<div><b>${esc(u.name)}</b> <span class="tag ${u.approved?'approved':'pending'}">${u.approved?'Approved':'Pending'}</span>
      <div class="meta">${u.role.toUpperCase()} • ${esc(u.email)} • ${esc(u.mob||'')} • Age ${esc(u.age||'-')} • ${esc(u.createdAt)}</div></div></div>
      <div><button class="btn ghost" onclick="window._av.exportUser('${u.id}')">Export</button>
      <button class="btn danger" onclick="window._av.delUser('${u.id}')">Delete</button></div></div>`).join(''):'<p class="muted">No HR/Users yet</p>';
  }
  else if(t==='assign'){
    const targets=users.filter(u=>u.approved&&u.role!=='admin');
    c.innerHTML=`<div class="card">
      <h3>Assign Work</h3>
      <div class="input-group"><label>Title</label><input id="aw_title"/></div>
      <div class="input-group"><label>Description</label><textarea id="aw_desc" rows="3"></textarea></div>
      <div class="input-group"><label>Assign To</label>
        <select id="aw_to">${targets.map(u=>`<option value="${u.id}">${esc(u.name)} (${u.role})</option>`).join('')}</select>
      </div>
      <div class="input-group"><label>Attach File (optional)</label><input id="aw_file" type="file"/></div>
      <button class="btn" onclick="window._av.assignWork()">Assign</button>
    </div>
    <h3 style="color:var(--blue);margin:14px 0 10px">All Assignments</h3>
    ${db.get(KEYS.assignments,[]).map(a=>`<div class="list-row"><div><b>${esc(a.title)}</b> <span class="tag ${a.status==='done'?'success':'pending'}">${a.status==='done'?'Success ✓':'Pending'}</span>
      <div class="meta">→ ${esc(a.toName)} • ${a.at}</div></div>
      <div><button class="btn ghost" onclick="window._av.editAssign('${a.id}')">Edit</button>
      <button class="btn danger" onclick="window._av.delAssign('${a.id}')">Delete</button></div></div>`).join('')||'<p class="muted">No assignments</p>'}`;
  }
  else if(t==='submissions'){
    const subs=db.get(KEYS.submissions,[]).filter(x=>x.toRole==='admin');
    c.innerHTML=subs.length?subs.map(s=>`<div class="list-row"><div><b>${esc(s.title)}</b> <span class="tag ${s.status==='done'?'success':'pending'}">${s.status==='done'?'Success ✓':'Pending'}</span>
      <div class="meta">From ${esc(s.fromName)} (${s.fromRole}) • ${s.at}</div>
      <div class="meta">${esc(s.desc||'')}</div></div>
      <div>${s.file?`<button class="btn ghost" onclick="window._av.dlFile('sub','${s.id}')">Download</button>`:''}
      ${s.status!=='done'?`<button class="btn success" onclick="window._av.markDone('${s.id}')">Mark as Done</button>`:'<span class="tag success">Completed</span>'}</div></div>`).join(''):'<p class="muted">No submissions</p>';
  }
  else if(t==='offers'){
    const targets=users.filter(u=>u.approved&&u.role!=='admin');
    c.innerHTML=`<div class="card">
      <h3>Send Offer Letter</h3>
      <div class="input-group"><label>To</label>
        <select id="ol_to">${targets.map(u=>`<option value="${u.id}">${esc(u.name)} (${u.role})</option>`).join('')}</select>
      </div>
      <div class="input-group"><label>Title</label><input id="ol_title" value="Offer Letter"/></div>
      <div class="input-group"><label>Attach File (PDF/DOC)</label><input id="ol_file" type="file"/></div>
      <button class="btn" onclick="window._av.sendOffer()">Send Offer Letter</button>
    </div>
    <h3 style="color:var(--blue);margin:14px 0 10px">Sent Offers</h3>
    ${db.get(KEYS.offers,[]).map(o=>`<div class="list-row"><div><b>${esc(o.title)}</b><div class="meta">→ ${esc(o.toName)} • ${o.at}</div></div>
      <div>${o.file?`<button class="btn ghost" onclick="window._av.dlFile('offer','${o.id}')">Download</button>`:''}</div></div>`).join('')||'<p class="muted">None</p>'}`;
  }
  else if(t==='callbacks'){
    const cbs=db.get(KEYS.callbacks,[]);
    c.innerHTML=cbs.length?cbs.map(cb=>`<div class="card" style="margin-bottom:10px">
      <b>${esc(cb.name)}</b> <span class="meta">• ${cb.at}</span>
      <div class="meta">📞 ${esc(cb.mob)} ✉ ${esc(cb.email||'-')}</div>
      <p>${esc(cb.msg||'')}</p>
      <div class="callback-actions">
        <a class="icon-btn" href="tel:${esc(cb.mob)}">📞 Call</a>
        <a class="icon-btn" href="mailto:${esc(cb.email||'')}">✉ Mail</a>
        <button class="icon-btn" style="background:linear-gradient(135deg,#d83a3a,#ff7a7a)" onclick="window._av.delCb('${cb.id}')">Delete</button>
      </div></div>`).join(''):'<p class="muted">No callback requests</p>';
  }
  else if(t==='company'){
    const list=db.get(KEYS.company,[]);
    c.innerHTML=`<div class="card">
      <h3>Add Company Project</h3>
      <div class="input-group"><label>Title</label><input id="cp_title"/></div>
      <div class="input-group"><label>Description</label><textarea id="cp_desc" rows="2"></textarea></div>
      <div class="input-group"><label>Image URL</label><input id="cp_img"/></div>
      <div class="input-group"><label>Project URL</label><input id="cp_url"/></div>
      <button class="btn" onclick="window._av.addCompany()">Add Project</button>
    </div>
    <div class="grid cols-2" style="margin-top:14px">
      ${list.map(p=>`<div class="card"><img src="${p.img}" style="width:100%;border-radius:10px;margin-bottom:8px"/><h3>${esc(p.title)}</h3><p>${esc(p.desc)}</p>
      <div class="btn-row"><button class="btn ghost" onclick="window._av.editCompany('${p.id}')">Edit</button>
      <button class="btn danger" onclick="window._av.delCompany('${p.id}')">Delete</button></div></div>`).join('')}
    </div>`;
  }
  else if(t==='portfolio'){
    const list=db.get(KEYS.portfolio,[]);
    c.innerHTML=`<div class="card">
      <h3>Add Portfolio Item</h3>
      <div class="input-group"><label>Title</label><input id="pf_title"/></div>
      <div class="input-group"><label>Description</label><textarea id="pf_desc" rows="2"></textarea></div>
      <div class="input-group"><label>Image URL</label><input id="pf_img"/></div>
      <div class="input-group"><label>Project URL</label><input id="pf_url"/></div>
      <button class="btn" onclick="window._av.addPortfolio()">Add</button>
    </div>
    <div class="grid cols-2" style="margin-top:14px">
      ${list.map(p=>`<div class="card"><img src="${p.img}" style="width:100%;border-radius:10px;margin-bottom:8px"/><h3>${esc(p.title)}</h3><p>${esc(p.desc)}</p>
      <div class="btn-row"><button class="btn ghost" onclick="window._av.editPortfolio('${p.id}')">Edit</button>
      <button class="btn danger" onclick="window._av.delPortfolio('${p.id}')">Delete</button></div></div>`).join('')}
    </div>`;
  }
  else if(t==='passwords'){
    c.innerHTML=`<div class="card"><h3>All User Passwords</h3>
      <p class="muted">Visible only to admin. Export individual data via the Users tab.</p>
      ${users.map(u=>`<div class="list-row"><div class="av-row">${avatarHTML(u)}<div><b>${esc(u.name)}</b> (${u.role})<div class="meta">${esc(u.email)}</div></div></div>
      <div><code style="background:#fff;padding:4px 10px;border-radius:6px">${esc(u.password)}</code></div></div>`).join('')}
    </div>`;
  }
  else if(t==='attendance'){
    const settings=db.get(KEYS.settings,{attendanceOpen:false});
    const records=db.get(KEYS.attendance,[]).filter(r=>!!r.photo);
    const people=users.filter(u=>u.role!=='admin');
    c.innerHTML=`
      <div class="card">
        <h3>Attendance Records — Access Control</h3>
        <p class="muted">When ON, every HR &amp; User can mark their attendance from their own login (with webcam photo). When OFF, the Attendance button is locked for everyone.</p>
        <button class="btn ${settings.attendanceOpen?'danger':'success'}" onclick="window._av.toggleAttendance()">
          ${settings.attendanceOpen?'🟢 Attendance is OPEN — Click to TURN OFF':'🔴 Attendance is CLOSED — Click to TURN ON'}
        </button>
      </div>
      <div class="card" style="margin-top:14px">
        <h3>Export Attendance</h3>
        <div class="input-group"><label>Select Person (HR / User) — for per-person export</label>
          <select id="att_person">${people.map(u=>`<option value="${u.id}">${esc(u.name)} (${u.role.toUpperCase()})</option>`).join('')}</select>
        </div>
        <div class="btn-row">
          <button class="btn" onclick="window._av.exportAttendance('excel')">⬇ Per-Person Excel</button>
          <button class="btn ghost" onclick="window._av.exportAttendance('pdf')">⬇ Per-Person PDF</button>
          <button class="btn" onclick="window._av.exportAllAttendance('pdf')">📄 Export ENTIRE PDF (All People)</button>
          <button class="btn ghost" onclick="window._av.exportAllAttendance('excel')">📊 Export ENTIRE Excel</button>
        </div>
      </div>
      <div class="card" style="margin-top:14px">
        <h3>🔍 Search Attendance</h3>
        <div class="input-group"><label>Search (by name / email / role / date text)</label>
          <input id="att_search" placeholder="e.g. Ravi, hr, 2026-05-16" oninput="window._av.filterAttList()"/></div>
        <div class="btn-row" style="gap:10px;flex-wrap:wrap">
          <div class="input-group" style="flex:1;min-width:160px"><label>From date</label>
            <input id="att_from" type="date" oninput="window._av.filterAttList()"/></div>
          <div class="input-group" style="flex:1;min-width:160px"><label>To date</label>
            <input id="att_to" type="date" oninput="window._av.filterAttList()"/></div>
          <div class="input-group" style="align-self:end"><button class="btn ghost" onclick="window._av.clearAttFilters()">Clear</button></div>
        </div>
      </div>
      <h3 style="color:var(--blue);margin:18px 0 10px">Attendance Records (<span id="att_count">${records.length}</span>)</h3>
      <div id="att_list">
      ${records.length?records.map(r=>{const ru=users.find(x=>x.id===r.userId)||r;const dkey=(r.at||'').slice(0,10);return `<div class="list-row att-row" data-search="${esc(((r.name||'')+' '+(r.email||'')+' '+(r.role||'')+' '+(r.at||'')).toLowerCase())}" data-date="${esc(dkey)}">
        <div class="av-row">${avatarHTML(ru)}<div><b>${esc(r.name)}</b> <span class="tag approved">${r.role.toUpperCase()}</span>
          <div class="meta">${esc(r.email||'')} • ${esc(r.at)}</div></div></div>
        <div style="display:flex;gap:8px;align-items:center">
          <img src="${r.photo}" style="height:54px;width:54px;object-fit:cover;border-radius:8px;cursor:pointer" onclick="window._av.viewAttPhoto('${r.id}')"/>
          <button class="btn ghost" title="Edit" onclick="window._av.editAtt('${r.id}')">✏️</button>
          <button class="btn danger" title="Delete" onclick="window._av.deleteAtt('${r.id}')">🗑</button>
        </div>
      </div>`}).join(''):'<p class="muted">No attendance records yet</p>'}
      </div>
    `;
  }
  else if(t==='timelogs'){
    renderTimeLogs(c);
  }
}

// admin actions
_av.approve = (id) => {
  const users=db.get(KEYS.users,[]);
  const u=users.find(x=>x.id===id);if(u){u.approved=true;db.set(KEYS.users,users);renderAdminTab('approvals');toast('Approved')}
};
_av.reject = (id) => {
  if(!confirm('Reject and delete?')) return;
  let users=db.get(KEYS.users,[]);users=users.filter(u=>u.id!==id);db.set(KEYS.users,users);renderAdminTab('approvals');toast('Rejected');
};
_av.openAddAdmin2 = () => {
  const sess=getSession();
  const me=db.get(KEYS.users,[]).find(u=>u.id===sess.id);
  if(!me||me.adminSlot!==1) return toast('Only Admin 1 can add Admin 2');
  if(hasAdmin2()) return toast('Admin 2 already exists');
  modal(`<h2 class="section-title">Add Admin 2</h2>
    <p class="muted">Admin 2 will be auto-approved and can log in immediately.</p>
    <div class="input-group"><label>Full Name</label><input id="aa_name"/></div>
    <div class="input-group"><label>Email</label><input id="aa_email" type="email"/></div>
    <div class="input-group"><label>Mobile</label><input id="aa_mob"/></div>
    <div class="input-group"><label>Age</label><input id="aa_age" type="number"/></div>
    ${pwdInput('aa_pwd')}
    <button class="btn" onclick="window._av.createAdmin2()">Create Admin 2</button>`);
};
_av.createAdmin2 = () => {
  const name=document.getElementById('aa_name').value.trim();
  const email=document.getElementById('aa_email').value.trim().toLowerCase();
  const mob=document.getElementById('aa_mob').value.trim();
  const age=document.getElementById('aa_age').value;
  const pwd=document.getElementById('aa_pwd').value;
  if(!name||!email||!pwd) return toast('Name, email and password required');
  const users=db.get(KEYS.users,[]);
  if(users.some(u=>u.email===email)) return toast('Email already registered');
  if(hasAdmin2()) return toast('Admin 2 already exists');
  users.push({id:uid(),name,email,mob,age,password:pwd,role:'admin',adminSlot:2,approved:true,createdAt:now()});
  db.set(KEYS.users,users);
  successAnim('Admin 2 created successfully!');
  setTimeout(()=>renderAdminTab('manage'),1900);
};
_av.removeAdmin2 = () => {
  const sess=getSession();
  const me=db.get(KEYS.users,[]).find(u=>u.id===sess.id);
  if(!me||me.adminSlot!==1) return toast('Only Admin 1 can remove Admin 2');
  if(!confirm('Remove Admin 2 account permanently?')) return;
  let users=db.get(KEYS.users,[]);
  users=users.filter(u=>!(u.role==='admin'&&u.adminSlot===2));
  db.set(KEYS.users,users);toast('Admin 2 removed');renderAdminTab('manage');
};
_av.addAccount = () => {
  const role=document.getElementById('ma_role').value;
  const name=document.getElementById('ma_name').value.trim();
  const email=document.getElementById('ma_email').value.trim().toLowerCase();
  const mob=document.getElementById('ma_mob').value.trim();
  const age=document.getElementById('ma_age').value;
  const pwd=document.getElementById('ma_pwd').value;
  if(!name||!email||!pwd) return toast('Name, email and password required');
  const face=window._regFace||null;
  if(!face) return toast('Please capture the face photo before creating the account.');
  const users=db.get(KEYS.users,[]);
  if(users.some(u=>u.email===email)) return toast('Email already registered');
  users.push({id:uid(),name,email,mob,age,password:pwd,role,approved:true,createdAt:now(),face:face.descriptor,faceImg:face.photo});
  db.set(KEYS.users,users);
  stopRegCam();
  window._regFace=null;
  if(window.cloudSync){try{window.cloudSync();}catch{}}
  toast(`${role.toUpperCase()} account created with face ✅`);
  renderAdminTab('manage');
};
_av.delUser = (id) => {
  if(!confirm('Delete this user?')) return;
  let users=db.get(KEYS.users,[]);users=users.filter(u=>u.id!==id);db.set(KEYS.users,users);renderAdminTab('users');toast('Deleted');
};
_av.exportUser = (id) => {
  const u=db.get(KEYS.users,[]).find(x=>x.id===id);
  const subs=db.get(KEYS.submissions,[]).filter(s=>s.fromId===id);
  const asg=db.get(KEYS.assignments,[]).filter(a=>a.toId===id);
  const html=`<html><head><title>${esc(u.name)} - Export</title></head><body>
    <h1>${esc(u.name)} (${u.role})</h1>
    <p>Email: ${esc(u.email)}<br>Mobile: ${esc(u.mob||'')}<br>Age: ${esc(u.age||'')}<br>Joined: ${esc(u.createdAt)}<br>Password: ${esc(u.password)}</p>
    <h2>Assignments</h2><ul>${asg.map(a=>`<li>${esc(a.title)} - ${a.status}</li>`).join('')}</ul>
    <h2>Submissions</h2><ul>${subs.map(s=>`<li>${esc(s.title)} - ${s.status}</li>`).join('')}</ul>
  </body></html>`;
  const blob=new Blob([html],{type:'text/html'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${u.name}_export.html`;a.click();
};
_av.assignWork = async () => {
  const title=document.getElementById('aw_title').value.trim();
  const desc=document.getElementById('aw_desc').value.trim();
  const toId=document.getElementById('aw_to').value;
  const fileEl=document.getElementById('aw_file');
  if(!title||!toId) return toast('Title and recipient required');
  const u=db.get(KEYS.users,[]).find(x=>x.id===toId);
  const a={id:uid(),title,desc,toId,toName:u.name,toRole:u.role,status:'pending',at:now()};
  if(fileEl.files[0]) a.file=await fileToBase64(fileEl.files[0]);
  const list=db.get(KEYS.assignments,[]);list.unshift(a);db.set(KEYS.assignments,list);
  toast('Work assigned ✅');renderAdminTab('assign');
};
_av.delAssign = (id) => {
  if(!confirm('Delete?')) return;
  let l=db.get(KEYS.assignments,[]);l=l.filter(a=>a.id!==id);db.set(KEYS.assignments,l);renderAdminTab('assign');
};
_av.editAssign = (id) => {
  const a=db.get(KEYS.assignments,[]).find(x=>x.id===id);
  modal(`<h2 class="section-title">Edit Assignment</h2>
    <div class="input-group"><label>Title</label><input id="ea_t" value="${esc(a.title)}"/></div>
    <div class="input-group"><label>Description</label><textarea id="ea_d" rows="3">${esc(a.desc||'')}</textarea></div>
    <button class="btn" onclick="window._av.saveAssign('${id}')">Save</button>`);
};
_av.saveAssign = (id) => {
  const list=db.get(KEYS.assignments,[]);const a=list.find(x=>x.id===id);
  a.title=document.getElementById('ea_t').value;a.desc=document.getElementById('ea_d').value;
  db.set(KEYS.assignments,list);closeModal();toast('Saved');renderAdminTab('assign');
};
_av.markDone = (id) => {
  const list=db.get(KEYS.submissions,[]);const s=list.find(x=>x.id===id);if(!s) return;
  s.status='done';s.completedAt=now();
  db.set(KEYS.submissions,list);
  // update related assignment (link by assignmentId, else by fromId+title)
  const ass=db.get(KEYS.assignments,[]);
  let a=s.assignmentId?ass.find(x=>x.id===s.assignmentId):null;
  if(!a) a=ass.find(x=>x.toId===s.fromId&&x.title===s.title&&x.status!=='done');
  if(a){a.status='done';a.completedAt=now();db.set(KEYS.assignments,ass);}
  renderAdminTab('submissions');successAnimStay('Marked as Success ✓');
};
_av.sendOffer = async () => {
  const toId=document.getElementById('ol_to').value;
  const title=document.getElementById('ol_title').value.trim();
  const fileEl=document.getElementById('ol_file');
  const u=db.get(KEYS.users,[]).find(x=>x.id===toId);
  const o={id:uid(),toId,toName:u.name,title,at:now()};
  if(fileEl.files[0]) o.file=await fileToBase64(fileEl.files[0]);
  const list=db.get(KEYS.offers,[]);list.unshift(o);db.set(KEYS.offers,list);
  toast('Offer sent ✅');renderAdminTab('offers');
};
_av.dlFile = (kind,id) => {
  const map={sub:KEYS.submissions,offer:KEYS.offers,asg:KEYS.assignments};
  const item=db.get(map[kind],[]).find(x=>x.id===id);
  if(!item||!item.file) return toast('No file');
  const a=document.createElement('a');a.href=item.file.data;a.download=item.file.name;a.click();
};
_av.delCb = (id) => {let l=db.get(KEYS.callbacks,[]);l=l.filter(c=>c.id!==id);db.set(KEYS.callbacks,l);renderAdminTab('callbacks')};
_av.addCompany = () => {
  const p={id:uid(),title:document.getElementById('cp_title').value,desc:document.getElementById('cp_desc').value,
    img:document.getElementById('cp_img').value||'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=600',url:document.getElementById('cp_url').value};
  if(!p.title) return toast('Title required');
  const l=db.get(KEYS.company,[]);l.unshift(p);db.set(KEYS.company,l);toast('Added');renderAdminTab('company');
};
_av.editCompany = (id) => {
  const p=db.get(KEYS.company,[]).find(x=>x.id===id);
  modal(`<h2 class="section-title">Edit Project</h2>
    <div class="input-group"><label>Title</label><input id="ec_t" value="${esc(p.title)}"/></div>
    <div class="input-group"><label>Description</label><textarea id="ec_d" rows="2">${esc(p.desc)}</textarea></div>
    <div class="input-group"><label>Image URL</label><input id="ec_i" value="${esc(p.img)}"/></div>
    <div class="input-group"><label>URL</label><input id="ec_u" value="${esc(p.url||'')}"/></div>
    <button class="btn" onclick="window._av.saveCompany('${id}')">Save</button>`);
};
_av.saveCompany = (id) => {
  const l=db.get(KEYS.company,[]);const p=l.find(x=>x.id===id);
  p.title=document.getElementById('ec_t').value;p.desc=document.getElementById('ec_d').value;
  p.img=document.getElementById('ec_i').value;p.url=document.getElementById('ec_u').value;
  db.set(KEYS.company,l);closeModal();toast('Saved');renderAdminTab('company');
};
_av.delCompany = (id) => {if(!confirm('Delete?'))return;let l=db.get(KEYS.company,[]);l=l.filter(p=>p.id!==id);db.set(KEYS.company,l);renderAdminTab('company')};
_av.addPortfolio = () => {
  const p={id:uid(),title:document.getElementById('pf_title').value,desc:document.getElementById('pf_desc').value,
    img:document.getElementById('pf_img').value||'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600',url:document.getElementById('pf_url').value};
  if(!p.title) return toast('Title required');
  const l=db.get(KEYS.portfolio,[]);l.unshift(p);db.set(KEYS.portfolio,l);toast('Added');renderAdminTab('portfolio');
};
_av.editPortfolio = (id) => {
  const p=db.get(KEYS.portfolio,[]).find(x=>x.id===id);
  modal(`<h2 class="section-title">Edit Portfolio</h2>
    <div class="input-group"><label>Title</label><input id="ep_t" value="${esc(p.title)}"/></div>
    <div class="input-group"><label>Description</label><textarea id="ep_d" rows="2">${esc(p.desc)}</textarea></div>
    <div class="input-group"><label>Image URL</label><input id="ep_i" value="${esc(p.img)}"/></div>
    <div class="input-group"><label>URL</label><input id="ep_u" value="${esc(p.url||'')}"/></div>
    <button class="btn" onclick="window._av.savePortfolio('${id}')">Save</button>`);
};
_av.savePortfolio = (id) => {
  const l=db.get(KEYS.portfolio,[]);const p=l.find(x=>x.id===id);
  p.title=document.getElementById('ep_t').value;p.desc=document.getElementById('ep_d').value;
  p.img=document.getElementById('ep_i').value;p.url=document.getElementById('ep_u').value;
  db.set(KEYS.portfolio,l);closeModal();toast('Saved');renderAdminTab('portfolio');
};
_av.delPortfolio = (id) => {if(!confirm('Delete?'))return;let l=db.get(KEYS.portfolio,[]);l=l.filter(p=>p.id!==id);db.set(KEYS.portfolio,l);renderAdminTab('portfolio')};
_av.approveReset = (id) => {
  const reqs=db.get(KEYS.pwResets,[]);const r=reqs.find(x=>x.id===id);
  const users=db.get(KEYS.users,[]);const u=users.find(x=>x.id===r.userId);
  u.password=r.newPwd;db.set(KEYS.users,users);
  db.set(KEYS.pwResets,reqs.filter(x=>x.id!==id));toast('Password reset approved');renderAdminTab('approvals');
};
_av.rejectReset = (id) => {
  db.set(KEYS.pwResets,db.get(KEYS.pwResets,[]).filter(r=>r.id!==id));renderAdminTab('approvals');
};
_av.viewProject = (id,kind) => {
  const map={company:KEYS.company,portfolio:KEYS.portfolio};
  const p=db.get(map[kind],[]).find(x=>x.id===id);if(!p)return;
  modal(`<h2 class="section-title">${esc(p.title)}</h2>
    <img src="${p.img}" style="width:100%;border-radius:12px;margin-bottom:10px"/>
    <p>${esc(p.desc)}</p>
    ${p.url?`<a class="btn" style="margin-top:10px" href="${p.url}" target="_blank">Open Project Link</a>`:''}`);
};

// ============ ATTENDANCE ============
_av.toggleAttendance = () => {
  const s=db.get(KEYS.settings,{attendanceOpen:false});
  s.attendanceOpen=!s.attendanceOpen;
  db.set(KEYS.settings,s);
  toast(`Attendance ${s.attendanceOpen?'TURNED ON ✅':'TURNED OFF 🔒'}`);
  renderAdminTab('attendance');
};
_av.viewAttPhoto = (id) => {
  const r=db.get(KEYS.attendance,[]).find(x=>x.id===id);
  if(!r||!r.photo) return;
  modal(`<h2 class="section-title">${esc(r.name)} — ${esc(r.at)}</h2>
    <p class="muted">${esc(r.role.toUpperCase())} • ${esc(r.email||'')}</p>
    <img src="${r.photo}" style="width:100%;border-radius:12px"/>`);
};
_av.exportAttendance = (kind) => {
  const sel=document.getElementById('att_person');
  if(!sel||!sel.value) return toast('Select a person');
  const u=db.get(KEYS.users,[]).find(x=>x.id===sel.value);
  if(!u) return toast('User not found');
  const records=db.get(KEYS.attendance,[]).filter(r=>r.userId===u.id && !!r.photo);
  if(kind==='excel'){
    if(typeof XLSX==='undefined') return toast('Excel library not loaded');
    const wb=XLSX.utils.book_new();
    const head=[
      [`Attendance Report — ${u.name} (${u.role.toUpperCase()})`],
      [`Email: ${u.email}    Mobile: ${u.mob||'-'}`],
      []
    ];
    const attRows=[['#','Date / Time','Email','Role'],
      ...records.map((r,i)=>[i+1,r.at,r.email||u.email,r.role])];
    const ws=XLSX.utils.aoa_to_sheet([...head,['ATTENDANCE MARKS'],...attRows]);
    XLSX.utils.book_append_sheet(wb,ws,'Attendance');
    XLSX.writeFile(wb,`${u.name.replace(/\s+/g,'_')}_attendance.xlsx`);
    toast('Excel exported ✅');
  } else {
    if(!window.jspdf) return toast('PDF library not loaded');
    const {jsPDF}=window.jspdf;
    const doc=new jsPDF();
    doc.setFontSize(16);doc.text(`Attendance Report — ${u.name} (${u.role.toUpperCase()})`,14,18);
    doc.setFontSize(10);doc.text(`Email: ${u.email}    Mobile: ${u.mob||'-'}`,14,26);
    let y=38;
    doc.setFontSize(13);doc.text('Attendance Marks',14,y);y+=7;doc.setFontSize(10);
    if(!records.length){doc.text('No attendance records.',16,y);y+=8;}
    records.forEach((r,i)=>{if(y>275){doc.addPage();y=20;}
      doc.text(`${i+1}. ${r.at}`,16,y);y+=6;});
    doc.save(`${u.name.replace(/\s+/g,'_')}_attendance.pdf`);
    toast('PDF exported ✅');
  }
};
_av.exportAllAttendance = (kind) => {
  const users=db.get(KEYS.users,[]);
  const all=db.get(KEYS.attendance,[]).filter(r=>!!r.photo);
  if(!all.length) return toast('No attendance records to export');
  const byUser={};
  all.forEach(r=>{(byUser[r.userId]=byUser[r.userId]||[]).push(r)});
  if(kind==='excel'){
    if(typeof XLSX==='undefined') return toast('Excel library not loaded');
    const wb=XLSX.utils.book_new();
    const rows=[['#','Name','Role','Email','Date / Time']];
    all.forEach((r,i)=>rows.push([i+1,r.name,r.role,r.email||'',r.at]));
    const ws=XLSX.utils.aoa_to_sheet([['ALL ATTENDANCE RECORDS'],[],...rows]);
    XLSX.utils.book_append_sheet(wb,ws,'All Attendance');
    XLSX.writeFile(wb,`ALL_attendance.xlsx`);
    toast('Excel exported ✅');
  } else {
    if(!window.jspdf) return toast('PDF library not loaded');
    const {jsPDF}=window.jspdf;
    const doc=new jsPDF();
    doc.setFontSize(16);doc.text('Attendance Report — ALL People',14,18);
    doc.setFontSize(10);doc.text(`Generated: ${now()}    Total records: ${all.length}`,14,26);
    let y=36;
    Object.keys(byUser).forEach(uid=>{
      const u=users.find(x=>x.id===uid)||{name:byUser[uid][0].name,role:byUser[uid][0].role,email:byUser[uid][0].email||''};
      const recs=byUser[uid];
      if(y>270){doc.addPage();y=20;}
      doc.setFontSize(13);doc.text(`${u.name} (${(u.role||'').toUpperCase()})`,14,y);y+=6;
      doc.setFontSize(10);doc.text(`Email: ${u.email||'-'}   Records: ${recs.length}`,14,y);y+=6;
      recs.forEach((r,i)=>{if(y>280){doc.addPage();y=20;}
        doc.text(`  ${i+1}. ${r.at}`,16,y);y+=6;});
      y+=4;
    });
    doc.save('ALL_attendance.pdf');
    toast('PDF exported ✅');
  }
};
_av.deleteAtt = (id) => {
  if(!confirm('Delete this attendance record permanently?')) return;
  let recs=db.get(KEYS.attendance,[]);
  recs=recs.filter(r=>r.id!==id);
  db.set(KEYS.attendance,recs);
  animSuccess('Deleted Successfully','🗑');
  renderAdminTab('attendance');
};
_av.editAtt = (id) => {
  const recs=db.get(KEYS.attendance,[]);
  const r=recs.find(x=>x.id===id); if(!r) return;
  modal(`<h2 class="section-title">Edit Attendance</h2>
    <div class="input-group"><label>Name</label><input id="ea_name" value="${esc(r.name||'')}"/></div>
    <div class="input-group"><label>Email</label><input id="ea_email" value="${esc(r.email||'')}"/></div>
    <div class="input-group"><label>Date / Time</label><input id="ea_at" value="${esc(r.at||'')}"/></div>
    <button class="btn" onclick="window._av.saveAtt('${r.id}')">Save</button>`);
};
_av.saveAtt = (id) => {
  const recs=db.get(KEYS.attendance,[]);
  const r=recs.find(x=>x.id===id); if(!r) return;
  r.name=document.getElementById('ea_name').value.trim()||r.name;
  r.email=document.getElementById('ea_email').value.trim();
  r.at=document.getElementById('ea_at').value.trim()||r.at;
  db.set(KEYS.attendance,recs);
  toast('Saved');
  document.getElementById('modal_back')?.remove();
  renderAdminTab('attendance');
};
_av._attStream=null;
function _filterList(inputId, rowSel, countId){
  const q=(document.getElementById(inputId)?.value||'').trim().toLowerCase();
  const rows=document.querySelectorAll(rowSel);
  let n=0;
  rows.forEach(r=>{
    const hay=r.getAttribute('data-search')||'';
    const show=!q||hay.includes(q);
    r.style.display=show?'':'none';
    if(show) n++;
  });
  const c=document.getElementById(countId); if(c) c.textContent=n;
}
_av.filterAttList = () => {
  const q=(document.getElementById('att_search')?.value||'').trim().toLowerCase();
  const from=document.getElementById('att_from')?.value||'';
  const to=document.getElementById('att_to')?.value||'';
  const rows=document.querySelectorAll('.att-row');
  let n=0;
  rows.forEach(r=>{
    const hay=r.getAttribute('data-search')||'';
    const dkey=r.getAttribute('data-date')||'';
    let show=!q||hay.includes(q);
    if(show && from) show = dkey && dkey>=from;
    if(show && to) show = dkey && dkey<=to;
    r.style.display=show?'':'none';
    if(show) n++;
  });
  const c=document.getElementById('att_count'); if(c) c.textContent=n;
};
_av.clearAttFilters = () => {
  const s=document.getElementById('att_search'); if(s) s.value='';
  const f=document.getElementById('att_from'); if(f) f.value='';
  const t=document.getElementById('att_to'); if(t) t.value='';
  _av.filterAttList();
};
_av.filterLogList = () => _filterList('log_search','.log-row','log_count');

// ============ TIME LOGS (separate from Attendance) ============
// Hides Main Admin (adminSlot===1) entries — only shows Admin 2, HR, and Users.
function isMainAdmin(u){return !!(u && u.role==='admin' && u.adminSlot===1)}
function getVisibleLogs(){
  const users=db.get(KEYS.users,[]);
  const logs=db.get(KEYS.sessionsLog,[]);
  return logs.filter(l=>{
    const u=users.find(x=>x.id===l.userId);
    // Hide entries that belong to Admin 1 (main admin)
    if(u && isMainAdmin(u)) return false;
    // Fallback when user is gone: also drop legacy "Main Admin" rows by name
    if(!u && /main\s*admin/i.test(l.name||'')) return false;
    return true;
  });
}
function logDateKey(l){const d=new Date(l.loginAt);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function logMonthKey(l){const d=new Date(l.loginAt);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}

function renderTimeLogs(c){
  const users=db.get(KEYS.users,[]);
  const people=users.filter(u=>!isMainAdmin(u));
  c.innerHTML=`
    <div class="card shine-card">
      <h3>⏱ Time Logs — Login / Logout Tracker</h3>
      <p class="muted">Auto-detects login &amp; logout for Admin 2, HR and Users (Main Admin is hidden by design). Logout is recorded automatically when a tab is closed.</p>
      <div class="tl-filters">
        <div class="input-group"><label>Person</label>
          <select id="tl_person"><option value="">All people</option>
          ${people.map(u=>`<option value="${u.id}">${esc(u.name)} (${u.role.toUpperCase()}${u.adminSlot?' '+u.adminSlot:''})</option>`).join('')}
          </select></div>
        <div class="input-group"><label>Day</label><input type="date" id="tl_day"/></div>
        <div class="input-group"><label>Month</label><input type="month" id="tl_month"/></div>
        <div class="input-group"><label>Status</label>
          <select id="tl_status"><option value="">All</option><option value="active">Active (still logged in)</option><option value="closed">Logged out</option></select></div>
      </div>
      <div class="btn-row">
        <button class="btn" onclick="window._av.tlApply()">🔍 Apply Filters</button>
        <button class="btn ghost" onclick="window._av.tlReset()">Reset</button>
        <button class="btn success" onclick="window._av.tlExport('excel')">⬇ Export Excel</button>
        <button class="btn success" onclick="window._av.tlExport('pdf')">⬇ Export PDF</button>
        <button class="btn danger" onclick="window._av.tlDeleteAll()">🗑 Delete All Filtered</button>
      </div>
    </div>
    <h3 style="color:var(--blue);margin:18px 0 10px">Sessions (<span id="tl_count">0</span>)</h3>
    <div id="tl_grid" class="tl-grid"></div>
  `;
  _av.tlApply();
}

function _tlCurrentFiltered(){
  const person=document.getElementById('tl_person')?.value||'';
  const day=document.getElementById('tl_day')?.value||'';
  const month=document.getElementById('tl_month')?.value||'';
  const status=document.getElementById('tl_status')?.value||'';
  let logs=getVisibleLogs();
  if(person) logs=logs.filter(l=>l.userId===person);
  if(day) logs=logs.filter(l=>logDateKey(l)===day);
  if(month) logs=logs.filter(l=>logMonthKey(l)===month);
  if(status==='active') logs=logs.filter(l=>!l.logoutAt);
  if(status==='closed') logs=logs.filter(l=>!!l.logoutAt);
  return logs;
}

_av.tlReset = () => {
  ['tl_person','tl_day','tl_month','tl_status'].forEach(id=>{const e=document.getElementById(id); if(e) e.value='';});
  _av.tlApply();
};

_av.tlApply = () => {
  const grid=document.getElementById('tl_grid'); if(!grid) return;
  const users=db.get(KEYS.users,[]);
  const logs=_tlCurrentFiltered();
  document.getElementById('tl_count').textContent=logs.length;
  if(!logs.length){grid.innerHTML='<p class="muted">No sessions for this filter.</p>';return;}
  // Group by user — show ONE box per person
  const groups={};
  logs.forEach(l=>{ (groups[l.userId]=groups[l.userId]||[]).push(l); });
  const today=new Date().toISOString().slice(0,10);
  grid.innerHTML=Object.entries(groups).map(([uid,ls])=>{
    const u=users.find(x=>x.id===uid)||{name:ls[0].name,role:ls[0].role,email:ls[0].email};
    const anyActive=ls.some(l=>!l.logoutAt);
    const todayCount=ls.filter(l=>logDateKey(l)===today).length;
    const face=u.faceImg?`<img src="${u.faceImg}" alt="${esc(u.name)}"/>`
      :`<div class="tl-initials">${esc((u.name||'?').trim().split(/\s+/).map(s=>s[0]||'').join('').slice(0,2).toUpperCase())}</div>`;
    const roleLabel=(u.role||ls[0].role||'').toUpperCase()+(u.adminSlot?' '+u.adminSlot:'');
    const last=ls[0];
    return `<div class="tl-card ${anyActive?'tl-active':''}" style="cursor:pointer" onclick="window._av.tlOpenPerson('${uid}')">
      <div class="tl-face">${face}<span class="tl-status ${anyActive?'on':'off'}">${anyActive?'● ACTIVE':'● ENDED'}</span></div>
      <div class="tl-name">${esc(u.name||last.name)}</div>
      <div class="tl-role"><span class="tag approved">${esc(roleLabel)}</span></div>
      <div class="tl-meta">✉ ${esc(u.email||last.email||'')}</div>
      <div class="tl-times">
        <div><span>📅 Today's logins</span><b>${todayCount}</b></div>
        <div><span>📚 Total sessions</span><b>${ls.length}</b></div>
        <div><span>🔑 Last login</span><b>${esc(last.loginAtStr||'')}</b></div>
      </div>
      <div class="tl-actions">
        <button class="btn ghost" onclick="event.stopPropagation();window._av.tlOpenPerson('${uid}')">View Details</button>
      </div>
    </div>`;
  }).join('');
};

_av.tlOpenPerson = (uid) => {
  const users=db.get(KEYS.users,[]);
  const u=users.find(x=>x.id===uid);
  const all=_tlCurrentFiltered().filter(l=>l.userId===uid)
    .sort((a,b)=>new Date(b.loginAt)-new Date(a.loginAt));
  if(!all.length) return toast('No sessions');
  const name=u?u.name:(all[0].name||'User');
  const email=u?u.email:(all[0].email||'');
  const roleLabel=((u?.role||all[0].role||'')+'').toUpperCase()+(u?.adminSlot?' '+u.adminSlot:'');
  const rows=all.map(l=>{
    const active=!l.logoutAt;
    const dur=active?'<span style="color:#118a4e;font-weight:700">⏳ Active</span>'
      :esc(msToHM(new Date(l.logoutAt)-new Date(l.loginAt)));
    return `<tr>
      <td><span class="tl-status ${active?'on':'off'}">${active?'● ACTIVE':'● ENDED'}</span></td>
      <td>${esc(l.loginAtStr||'-')}</td>
      <td>${esc(l.logoutAtStr||'—')}</td>
      <td>${dur}</td>
      <td style="white-space:nowrap">
        <button class="btn ghost" style="padding:4px 8px;font-size:11px" onclick="window._av.tlExportOne('${l.id}','pdf')">PDF</button>
        <button class="btn ghost" style="padding:4px 8px;font-size:11px" onclick="window._av.tlExportOne('${l.id}','excel')">Excel</button>
        <button class="btn danger" style="padding:4px 8px;font-size:11px" onclick="window._av.tlDelete('${l.id}',true)">Delete</button>
      </td>
    </tr>`;
  }).join('');
  modal(`
    <h2 class="section-title">📋 ${esc(name)} — All Sessions</h2>
    <p class="muted">${esc(roleLabel)} · ${esc(email)} · Total: <b>${all.length}</b></p>
    <div style="max-height:60vh;overflow:auto;margin-top:10px;border:1px solid rgba(74,143,240,.25);border-radius:12px">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead style="background:linear-gradient(135deg,#e6efff,#cfe0ff);position:sticky;top:0">
          <tr><th style="padding:8px;text-align:left">Status</th><th style="padding:8px;text-align:left">🔑 Login</th><th style="padding:8px;text-align:left">🚪 Logout</th><th style="padding:8px;text-align:left">⏱ Duration</th><th style="padding:8px;text-align:left">Actions</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn success" onclick="window._av.tlExportPerson('${uid}','pdf')">⬇ Export All as PDF</button>
      <button class="btn success" onclick="window._av.tlExportPerson('${uid}','excel')">⬇ Export All as Excel</button>
      <button class="btn ghost" onclick="window.closeModal()">Close</button>
    </div>
  `);
};
window.closeModal=closeModal;

_av.tlDelete = (id,reopen) => {
  if(!confirm('Delete this session entry?')) return;
  const l=db.get(KEYS.sessionsLog,[]).find(x=>x.id===id);
  const uid=l?.userId;
  let logs=db.get(KEYS.sessionsLog,[]);
  logs=logs.filter(l=>l.id!==id);
  db.set(KEYS.sessionsLog,logs);
  animSuccess('Deleted Successfully','🗑');
  _av.tlApply();
  if(reopen&&uid) setTimeout(()=>{ try{ _av.tlOpenPerson(uid);}catch{} },200);
};
_av.tlDeleteAll = () => {
  const filtered=_tlCurrentFiltered();
  if(!filtered.length) return toast('Nothing to delete');
  if(!confirm(`Delete ${filtered.length} filtered session(s)?`)) return;
  const ids=new Set(filtered.map(l=>l.id));
  const remaining=db.get(KEYS.sessionsLog,[]).filter(l=>!ids.has(l.id));
  db.set(KEYS.sessionsLog,remaining);
  animSuccess('Deleted Successfully','🗑'); _av.tlApply();
};

function _tlRows(logs){
  return [['#','Name','Role','Email','Login','Logout','Duration','Status'],
    ...logs.map((l,i)=>[i+1,l.name,(l.role||'').toUpperCase(),l.email||'',
      l.loginAtStr||'', l.logoutAtStr||'—',
      l.logoutAt?msToHM(new Date(l.logoutAt)-new Date(l.loginAt)):'still logged in',
      l.logoutAt?'Closed':'Active'])];
}
function _tlFileBase(){
  const p=document.getElementById('tl_person'); const d=document.getElementById('tl_day'); const m=document.getElementById('tl_month');
  const u=p&&p.value?db.get(KEYS.users,[]).find(x=>x.id===p.value):null;
  const parts=['time_logs'];
  if(u) parts.push(u.name.replace(/\s+/g,'_'));
  if(d&&d.value) parts.push(d.value);
  else if(m&&m.value) parts.push(m.value);
  return parts.join('_');
}
_av.tlExport = (kind) => {
  const logs=_tlCurrentFiltered();
  if(!logs.length) return toast('Nothing to export');
  const aoa=_tlRows(logs);
  const base=_tlFileBase();
  if(kind==='excel'){
    if(typeof XLSX==='undefined') return toast('Excel library not loaded');
    const wb=XLSX.utils.book_new();
    const ws=XLSX.utils.aoa_to_sheet([['Time Logs Report'],[],...aoa]);
    XLSX.utils.book_append_sheet(wb,ws,'TimeLogs');
    XLSX.writeFile(wb,`${base}.xlsx`); animSuccess('Submitted Successfully','📊');
  } else {
    if(!window.jspdf) return toast('PDF library not loaded');
    const {jsPDF}=window.jspdf; const doc=new jsPDF();
    doc.setFontSize(16);doc.text('Time Logs Report',14,18);
    doc.setFontSize(10);doc.text(`Total sessions: ${logs.length}`,14,26);
    let y=36; doc.setFontSize(9);
    aoa.forEach((row,i)=>{
      if(y>285){doc.addPage();y=20;}
      const line=row.map(v=>String(v)).join(' | ');
      doc.text(line.slice(0,180),14,y); y+=6;
      if(i===0){doc.setLineWidth(.2);doc.line(14,y-3,200,y-3);}
    });
    doc.save(`${base}.pdf`); animSuccess('Submitted Successfully','📄');
  }
};
_av.tlExportPerson = (uid,kind) => {
  const users=db.get(KEYS.users,[]);
  const u=users.find(x=>x.id===uid);
  const logs=_tlCurrentFiltered().filter(l=>l.userId===uid);
  if(!logs.length) return toast('Nothing to export');
  const aoa=_tlRows(logs);
  const base=`time_logs_${((u?.name)||logs[0].name||'user').replace(/\s+/g,'_')}`;
  if(kind==='excel'){
    if(typeof XLSX==='undefined') return toast('Excel library not loaded');
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([[`Time Logs — ${(u?.name)||logs[0].name}`],[],...aoa]),'TimeLogs');
    XLSX.writeFile(wb,`${base}.xlsx`); animSuccess('Submitted Successfully','📊');
  } else {
    if(!window.jspdf) return toast('PDF library not loaded');
    const {jsPDF}=window.jspdf; const doc=new jsPDF();
    doc.setFontSize(16);doc.text(`Time Logs — ${(u?.name)||logs[0].name}`,14,18);
    doc.setFontSize(10);doc.text(`Total sessions: ${logs.length}`,14,26);
    let y=36; doc.setFontSize(9);
    aoa.forEach((row,i)=>{
      if(y>285){doc.addPage();y=20;}
      const line=row.map(v=>String(v)).join(' | ');
      doc.text(line.slice(0,180),14,y); y+=6;
      if(i===0){doc.setLineWidth(.2);doc.line(14,y-3,200,y-3);}
    });
    doc.save(`${base}.pdf`); animSuccess('Submitted Successfully','📄');
  }
};
_av.tlExportOne = (id,kind) => {
  const l=db.get(KEYS.sessionsLog,[]).find(x=>x.id===id); if(!l) return;
  const aoa=_tlRows([l]); const base=`time_log_${(l.name||'user').replace(/\s+/g,'_')}_${logDateKey(l)}`;
  if(kind==='excel'){
    if(typeof XLSX==='undefined') return toast('Excel library not loaded');
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Time Log'],[],...aoa]),'TimeLog');
    XLSX.writeFile(wb,`${base}.xlsx`); animSuccess('Submitted Successfully','📊');
  } else {
    if(!window.jspdf) return toast('PDF library not loaded');
    const {jsPDF}=window.jspdf; const doc=new jsPDF();
    doc.setFontSize(16);doc.text(`Time Log — ${l.name}`,14,18);
    doc.setFontSize(10);
    doc.text(`Role: ${(l.role||'').toUpperCase()}`,14,28);
    doc.text(`Email: ${l.email||'-'}`,14,34);
    doc.text(`Login:    ${l.loginAtStr||'-'}`,14,44);
    doc.text(`Logout:   ${l.logoutAtStr||'—'}`,14,50);
    doc.text(`Duration: ${l.logoutAt?msToHM(new Date(l.logoutAt)-new Date(l.loginAt)):'still logged in'}`,14,56);
    doc.save(`${base}.pdf`); animSuccess('Submitted Successfully','📄');
  }
};
_av.openMarkAttendance = async () => {
  const settings=db.get(KEYS.settings,{attendanceOpen:false});
  if(!settings.attendanceOpen){
    return modal(`<h2 class="section-title">Attendance Locked 🔒</h2>
      <p class="muted">The admin has not opened attendance yet. Please wait for the admin to turn on the <b>Attendance Records</b> button.</p>`);
  }
  modal(`
    <h2 class="section-title">Mark Attendance</h2>
    <p class="muted">Smile! Your photo will be captured and saved with the timestamp.</p>
    <video id="att_vid" autoplay playsinline muted style="width:100%;border-radius:12px;background:#000;max-height:360px;object-fit:cover"></video>
    <canvas id="att_cnv" style="display:none"></canvas>
    <div class="btn-row" style="margin-top:10px">
      <button class="btn" id="att_cap_btn">📸 Capture &amp; Mark Attendance</button>
      <button class="btn ghost" onclick="window._av.closeAttCam()">Cancel</button>
    </div>
  `);
  try{
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:false});
    _av._attStream=stream;
    const v=document.getElementById('att_vid');v.srcObject=stream;
    document.getElementById('att_cap_btn').onclick=()=>_av.captureAttendance();
  }catch(e){
    document.getElementById('modalBody').innerHTML=
      `<h2 class="section-title">Webcam Error</h2>
       <p class="muted">Could not access webcam: ${esc(e.message||e.name)}. Please allow camera permission and try again.</p>`;
  }
};
_av.closeAttCam = () => {
  if(_av._attStream){try{_av._attStream.getTracks().forEach(t=>t.stop())}catch{} _av._attStream=null;}
  closeModal();
};
function todayKey(d){const x=d?new Date(d):new Date();return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');}
_av.captureAttendance = async () => {
  const v=document.getElementById('att_vid');
  const c=document.getElementById('att_cnv');
  if(!v||!v.videoWidth) return toast('Webcam not ready yet');
  const s=getSession();
  // ===== Once-per-day guard =====
  const today=todayKey();
  const existing=db.get(KEYS.attendance,[]).find(r=>r.userId===s.id && todayKey(r.atISO||r.at)===today);
  if(existing){
    if(_av._attStream){try{_av._attStream.getTracks().forEach(t=>t.stop())}catch{} _av._attStream=null;}
    return modal(`<h2 class="section-title">Already Marked Today ✅</h2>
      <p class="muted">You have already marked attendance today at <b>${esc(existing.at)}</b>. Only one attendance per day is allowed.</p>`);
  }
  const photo=captureFacePhoto(v,c);
  // ===== Face match verification =====
  const me=db.get(KEYS.users,[]).find(x=>x.id===s.id);
  if(!me||!me.face||!me.face.length){
    if(_av._attStream){try{_av._attStream.getTracks().forEach(t=>t.stop())}catch{} _av._attStream=null;}
    return modal(`<h2 class="section-title">Face Not Registered</h2>
      <p class="muted">No face is registered on your account. Please contact admin to re-register with a face capture.</p>`);
  }
  toast('Verifying face (eyes, nose, ears, jawline)… please wait');
  let det=null;
  try{ det=await detectFaceDescriptor(v); }catch(e){ toast('Face engine error: '+(e.message||e.name)); }
  if(!det){
    toast('No face detected. Look straight at the camera and try again.');
    return;
  }
  const dist=faceDistance(Array.from(det.descriptor), me.face);
  if(dist>FACE_MATCH_THRESHOLD){
    if(_av._attStream){try{_av._attStream.getTracks().forEach(t=>t.stop())}catch{} _av._attStream=null;}
    return modal(`<h2 class="section-title">Face Mismatch ❌</h2>
      <p class="muted">The captured face does not match your registered face (eyes / nose / ears / jaw landmarks did not match). Attendance was NOT marked.</p>
      <p class="muted" style="font-size:12px">match score: ${dist.toFixed(3)} (must be ≤ ${FACE_MATCH_THRESHOLD})</p>`);
  }
  if(_av._attStream){try{_av._attStream.getTracks().forEach(t=>t.stop())}catch{} _av._attStream=null;}
  const list=db.get(KEYS.attendance,[]);
  list.unshift({id:uid(),userId:s.id,name:s.name,email:s.email,role:s.role,photo,at:now(),atISO:nowISO(),dayKey:today,faceMatchScore:Number(dist.toFixed(3))});
  db.set(KEYS.attendance,list);
  successAnimStay(`Your attendance marked ✅  (face matched — score ${dist.toFixed(3)}, one-per-day rule applied)`);
};

// ===== HR =====
function hrDash(){
  const s=getSession();
  const company=db.get(KEYS.company,[]).slice(0,3);
  const myAssigns=db.get(KEYS.assignments,[]).filter(a=>a.toId===s.id);
  const userSubs=db.get(KEYS.submissions,[]).filter(x=>x.toRole==='hr');
  const offers=db.get(KEYS.offers,[]).filter(o=>o.toId===s.id);
  app.innerHTML = dashHeader(s,'HR Dashboard') + `
    <div class="grid cols-3">
      <div class="card"><h3>${myAssigns.length}</h3><p>Work Assigned</p></div>
      <div class="card"><h3>${myAssigns.filter(a=>a.status==='done').length}</h3><p>Completed</p></div>
      <div class="card"><h3>${offers.length}</h3><p>Offer Letters</p></div>
    </div>
    <div class="tabs" style="margin-top:20px">
      <button class="tab active" data-tab="assigned">Work Assigned</button>
      <button class="tab" data-tab="submit">Submit Work</button>
      <button class="tab" data-tab="offers">View Offer Letters</button>
      <button class="tab" data-tab="attendance">Mark Attendance</button>
    </div>
    <div id="hrTab"></div>
    <h2 class="section-title" style="margin-top:30px">Company Projects</h2>
    <div class="grid cols-3">
      ${company.map(p=>`<div class="card" ${p.url?`onclick="window.open('${p.url}','_blank')" style="cursor:pointer"`:''}><img src="${p.img}" style="width:100%;border-radius:10px;margin-bottom:8px"/><h3>${esc(p.title)}</h3><p>${esc(p.desc)}</p></div>`).join('')}
    </div>`;
  document.querySelectorAll('#app .tab').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('#app .tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderHrTab(b.dataset.tab);
  });
  renderHrTab('assigned');
}
function renderHrTab(t){
  const s=getSession();const c=document.getElementById('hrTab');
  if(t==='assigned'){
    const list=db.get(KEYS.assignments,[]).filter(a=>a.toId===s.id);
    c.innerHTML=list.length?list.map(a=>`<div class="list-row"><div><b>${esc(a.title)}</b> <span class="tag ${a.status==='done'?'success':'pending'}">${a.status==='done'?'Success ✓':'Pending'}</span>
      <div class="meta">${esc(a.desc||'')} • ${a.at}</div></div>
      <div>${a.file?`<button class="btn ghost" onclick="window._av.dlFile('asg','${a.id}')">Download</button>`:''}</div></div>`).join(''):'<p class="muted">None</p>';
  }
  else if(t==='submit'){
    const myPending=db.get(KEYS.assignments,[]).filter(a=>a.toId===s.id&&a.status!=='done');
    c.innerHTML=`<div class="card">
      <h3>Submit Work</h3>
      <div class="input-group"><label>For Assignment (optional)</label>
        <select id="sw_asg"><option value="">— None —</option>${myPending.map(a=>`<option value="${a.id}">${esc(a.title)}</option>`).join('')}</select>
      </div>
      <div class="input-group"><label>Title</label><input id="sw_title"/></div>
      <div class="input-group"><label>Description</label><textarea id="sw_desc" rows="3"></textarea></div>
      <div class="input-group"><label>Attach File</label><input id="sw_file" type="file"/></div>
      <p class="muted">Submit to:</p>
      <div class="grid cols-3">
        <div class="card"><h3>To Admin</h3><button class="btn" onclick="window._av.submitWork('admin')">Submit to Admin</button></div>
      </div>
    </div>`;
  }
  else if(t==='assignuser'){
    const usrs=db.get(KEYS.users,[]).filter(u=>u.role==='user'&&u.approved);
    c.innerHTML=`<div class="card">
      <h3>Assign Work to User</h3>
      <div class="input-group"><label>Title</label><input id="hra_t"/></div>
      <div class="input-group"><label>Description</label><textarea id="hra_d" rows="2"></textarea></div>
      <div class="input-group"><label>User</label><select id="hra_u">${usrs.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div>
      <div class="input-group"><label>File</label><input id="hra_f" type="file"/></div>
      <button class="btn" onclick="window._av.hrAssign()">Assign</button>
    </div>`;
  }
  else if(t==='usersubs'){
    const list=db.get(KEYS.submissions,[]).filter(x=>x.toRole==='hr');
    c.innerHTML=list.length?list.map(s=>`<div class="list-row"><div><b>${esc(s.title)}</b> <span class="tag ${s.status==='done'?'success':'pending'}">${s.status==='done'?'Success ✓':'Pending'}</span>
      <div class="meta">From ${esc(s.fromName)} • ${s.at}</div></div>
      <div>${s.file?`<button class="btn ghost" onclick="window._av.dlFile('sub','${s.id}')">Download</button>`:''}
      ${s.status!=='done'?`<button class="btn success" onclick="window._av.hrMarkDone('${s.id}')">Mark as Done</button>`:'<span class="tag success">Completed</span>'}</div></div>`).join(''):'<p class="muted">None</p>';
  }
  else if(t==='offers'){
    const list=db.get(KEYS.offers,[]).filter(o=>o.toId===s.id);
    c.innerHTML=list.length?list.map(o=>`<div class="list-row"><div><b>${esc(o.title)}</b><div class="meta">${o.at}</div></div>
      <div>${o.file?`<button class="btn ghost" onclick="window._av.dlFile('offer','${o.id}')">Download</button>`:''}</div></div>`).join(''):'<p class="muted">No offer letters</p>';
  }
  else if(t==='attendance'){
    c.innerHTML=renderAttendanceTab();
  }
}
_av.submitWork = async (toRole) => {
  const s=getSession();
  const title=document.getElementById('sw_title').value.trim();
  const desc=document.getElementById('sw_desc').value.trim();
  const fileEl=document.getElementById('sw_file');
  const asgEl=document.getElementById('sw_asg');
  const assignmentId=asgEl?asgEl.value:'';
  if(!title) return toast('Title required');
  const sub={id:uid(),title,desc,fromId:s.id,fromName:s.name,fromRole:s.role,toRole,assignmentId,status:'pending',at:now()};
  if(fileEl.files[0]) sub.file=await fileToBase64(fileEl.files[0]);
  const list=db.get(KEYS.submissions,[]);list.unshift(sub);db.set(KEYS.submissions,list);
  const role=getSession().role;
  const reRender=role==='hr'?()=>renderHrTab('submit'):()=>renderUsrTab('submit');
  reRender();successAnimStay('Submitted Successfully ✓');
};
_av.hrMarkDone = (id) => {
  const list=db.get(KEYS.submissions,[]);const s=list.find(x=>x.id===id);if(!s) return;
  s.status='done';s.completedAt=now();db.set(KEYS.submissions,list);
  const ass=db.get(KEYS.assignments,[]);
  let a=s.assignmentId?ass.find(x=>x.id===s.assignmentId):null;
  if(!a) a=ass.find(x=>x.toId===s.fromId&&x.title===s.title&&x.status!=='done');
  if(a){a.status='done';a.completedAt=now();db.set(KEYS.assignments,ass);}
  successAnimStay('Marked as Success ✓',()=>hrDash());
};
_av.hrAssign = async () => {
  const title=document.getElementById('hra_t').value.trim();
  const desc=document.getElementById('hra_d').value.trim();
  const toId=document.getElementById('hra_u').value;
  const fileEl=document.getElementById('hra_f');
  if(!title||!toId) return toast('Required fields');
  const u=db.get(KEYS.users,[]).find(x=>x.id===toId);
  const a={id:uid(),title,desc,toId,toName:u.name,toRole:'user',status:'pending',at:now(),assignedBy:'hr'};
  if(fileEl.files[0]) a.file=await fileToBase64(fileEl.files[0]);
  const list=db.get(KEYS.assignments,[]);list.unshift(a);db.set(KEYS.assignments,list);
  toast('Assigned to user ✅');
};

// ===== USER =====
function userDash(){
  const s=getSession();
  const company=db.get(KEYS.company,[]).slice(0,3);
  const myAssigns=db.get(KEYS.assignments,[]).filter(a=>a.toId===s.id);
  const offers=db.get(KEYS.offers,[]).filter(o=>o.toId===s.id);
  app.innerHTML = dashHeader(s,'User Dashboard') + `
    <div class="grid cols-3">
      <div class="card"><h3>${myAssigns.length}</h3><p>Work Assigned</p></div>
      <div class="card"><h3>${myAssigns.filter(a=>a.status==='done').length}</h3><p>Completed</p></div>
      <div class="card"><h3>${offers.length}</h3><p>Offer Letters</p></div>
    </div>
    <div class="tabs" style="margin-top:20px">
      <button class="tab active" data-tab="assigned">Work Assigned</button>
      <button class="tab" data-tab="submit">Submit Work</button>
      <button class="tab" data-tab="offers">View Offer Letter</button>
      <button class="tab" data-tab="attendance">Mark Attendance</button>
    </div>
    <div id="usrTab"></div>
    <h2 class="section-title" style="margin-top:30px">Company Projects</h2>
    <div class="grid cols-3">
      ${company.map(p=>`<div class="card" ${p.url?`onclick="window.open('${p.url}','_blank')" style="cursor:pointer"`:''}><img src="${p.img}" style="width:100%;border-radius:10px;margin-bottom:8px"/><h3>${esc(p.title)}</h3><p>${esc(p.desc)}</p></div>`).join('')}
    </div>`;
  document.querySelectorAll('#app .tab').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('#app .tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderUsrTab(b.dataset.tab);
  });
  renderUsrTab('assigned');
}
function renderUsrTab(t){
  const s=getSession();const c=document.getElementById('usrTab');
  if(t==='assigned'){
    const list=db.get(KEYS.assignments,[]).filter(a=>a.toId===s.id);
    c.innerHTML=list.length?list.map(a=>`<div class="list-row"><div><b>${esc(a.title)}</b> <span class="tag ${a.status==='done'?'success':'pending'}">${a.status==='done'?'Success ✓':'Pending'}</span>
      <div class="meta">${esc(a.desc||'')} • ${a.at}</div></div>
      <div>${a.file?`<button class="btn ghost" onclick="window._av.dlFile('asg','${a.id}')">Download</button>`:''}</div></div>`).join(''):'<p class="muted">None</p>';
  }
  else if(t==='submit'){
    const myPending=db.get(KEYS.assignments,[]).filter(a=>a.toId===s.id&&a.status!=='done');
    c.innerHTML=`<div class="card">
      <h3>Submit Work to Admin</h3>
      <div class="input-group"><label>For Assignment (optional)</label>
        <select id="sw_asg"><option value="">— None —</option>${myPending.map(a=>`<option value="${a.id}">${esc(a.title)}</option>`).join('')}</select>
      </div>
      <div class="input-group"><label>Title</label><input id="sw_title"/></div>
      <div class="input-group"><label>Description</label><textarea id="sw_desc" rows="3"></textarea></div>
      <div class="input-group"><label>Attach File</label><input id="sw_file" type="file"/></div>
      <button class="btn" onclick="window._av.submitWork('admin')">Submit to Admin</button>
    </div>`;
  }
  else if(t==='offers'){
    const list=db.get(KEYS.offers,[]).filter(o=>o.toId===s.id);
    c.innerHTML=list.length?list.map(o=>`<div class="list-row"><div><b>${esc(o.title)}</b><div class="meta">${o.at}</div></div>
      <div>${o.file?`<button class="btn ghost" onclick="window._av.dlFile('offer','${o.id}')">Download</button>`:''}</div></div>`).join(''):'<p class="muted">No offer letters yet</p>';
  }
  else if(t==='attendance'){
    c.innerHTML=renderAttendanceTab();
  }
}

function renderAttendanceTab(){
  const s=getSession();
  const settings=db.get(KEYS.settings,{attendanceOpen:false});
  const mine=db.get(KEYS.attendance,[]).filter(r=>r.userId===s.id);
  return `
    <div class="card">
      <h3>Mark Your Attendance</h3>
      <p class="muted">Status: <b style="color:${settings.attendanceOpen?'#2a8f3a':'#c0392b'}">${settings.attendanceOpen?'🟢 OPEN — you can mark attendance now':'🔒 CLOSED — wait for admin to enable'}</b></p>
      <button class="btn ${settings.attendanceOpen?'':'ghost'}" onclick="window._av.openMarkAttendance()">📸 Mark Attendance (Webcam)</button>
    </div>
    <h3 style="color:var(--blue);margin:14px 0 10px">My Attendance History (${mine.length})</h3>
    ${mine.length?mine.map(r=>`<div class="list-row">
      <div><b>${esc(r.at)}</b><div class="meta">Marked from ${esc(r.role.toUpperCase())} login</div></div>
      <div>${r.photo?`<img src="${r.photo}" style="height:48px;width:48px;object-fit:cover;border-radius:8px"/>`:''}</div>
    </div>`).join(''):'<p class="muted">You have not marked attendance yet.</p>'}
  `;
}
_av.submitBoth = async () => { await _av.submitWork('hr'); await _av.submitWork('admin'); };
_av.viewFace = (id) => {
  const u = db.get(KEYS.users,[]).find(x=>x.id===id);
  if(!u){ toast('User not found'); return; }
  if(!u.faceImg){ toast('No face photo registered'); return; }
  modal(`<h2 class="section-title">${esc(u.name)}</h2>
    <p class="muted">${esc(u.role.toUpperCase())} • ${esc(u.email)}</p>
    <img src="${u.faceImg}" style="width:100%;max-height:420px;object-fit:contain;border-radius:12px;background:#000;margin-top:10px"/>
    <p class="muted" style="margin-top:8px">Registered face — used to verify identity at attendance.</p>`);
};

// init
const sess=getSession();
if(sess) go('dash'); else go('home');

// Expose refresh for cloud realtime to re-render the current view.
window._av.refresh = () => { (views[_lastView]||views.home)(_lastData); };

})();
