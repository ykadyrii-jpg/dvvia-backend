const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { initDatabase, getDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'dvvia-admin-2026';

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const uploadsDir = path.join(__dirname, 'uploads');
['id-photos','mail-photos','title-photos','vin-photos','odometer-photos','vehicle-photos','arrival-photos'].forEach(dir => {
  const p = path.join(uploadsDir, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.params.type || 'misc';
    const dir = path.join(uploadsDir, type);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => { cb(null, uuidv4() + (path.extname(file.originalname) || '.jpg')); }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const regStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadsDir, file.fieldname === 'id_photo' ? 'id-photos' : 'mail-photos');
    cb(null, dir);
  },
  filename: (req, file, cb) => { cb(null, uuidv4() + '.jpg'); }
});
const uploadReg = multer({ storage: regStorage, limits: { fileSize: 10 * 1024 * 1024 } });

const uploadVehicle = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      let dir = 'vehicle-photos';
      if (file.fieldname === 'title_photo') dir = 'title-photos';
      else if (file.fieldname === 'vin_photo') dir = 'vin-photos';
      else if (file.fieldname === 'odometer_photo') dir = 'odometer-photos';
      cb(null, path.join(uploadsDir, dir));
    },
    filename: (req, file, cb) => { cb(null, uuidv4() + '.jpg'); }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }
});

function generateDvviaId() { return 'DV-' + Math.floor(1000000 + Math.random() * 9000000); }
function generatePassword() {
  const c = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%';
  let p = ''; for (let i = 0; i < 12; i++) p += c.charAt(Math.floor(Math.random() * c.length)); return p;
}

function adminAuth(req, res, next) {
  const pwd = req.headers['x-admin-password'] || req.query.pwd;
  if (pwd !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function deleteFile(filePath) {
  if (!filePath) return;
  try {
    const fullPath = path.join(__dirname, filePath);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  } catch (e) { console.log('Could not delete file:', filePath, e.message); }
}

// ─── NOTIFICATION HELPER ─────────────────────────────────────────────────────
async function createNotification(pool, userId, type, title, body, meta = null) {
  try {
    await pool.query(
      'INSERT INTO notifications (user_id, type, title, body, meta) VALUES ($1, $2, $3, $4, $5)',
      [userId, type, title, body, meta ? JSON.stringify(meta) : null]
    );
  } catch (e) { console.log('Notification error:', e.message); }
}

// ─── ADMIN PANEL ─────────────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  const pwd = req.query.pwd || '';
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>DVVIA Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #080c14; color: #c8d6e5; font-family: -apple-system, sans-serif; padding: 24px 16px; }
    h1 { color: #00c896; font-size: 22px; margin-bottom: 4px; }
    .subtitle { color: #5a6a80; font-size: 13px; margin-bottom: 24px; }
    .login-box { max-width: 360px; }
    .login-box input { width: 100%; padding: 14px 16px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; color: #fff; font-size: 16px; margin-bottom: 12px; }
    .btn { padding: 10px 20px; border-radius: 10px; border: none; cursor: pointer; font-size: 14px; font-weight: 700; }
    .btn-green { background: #00c896; color: #080c14; }
    .btn-red { background: rgba(255,80,80,0.15); color: #ff5050; border: 1px solid rgba(255,80,80,0.3); }
    .btn-approve { background: rgba(0,200,150,0.15); color: #00c896; border: 1px solid rgba(0,200,150,0.3); }
    .btn-approve:disabled { opacity: 0.35; cursor: not-allowed; }
    .tabs { display: flex; gap: 10px; margin-bottom: 24px; flex-wrap: wrap; }
    .tab { padding: 10px 20px; border-radius: 10px; border: none; cursor: pointer; font-size: 14px; font-weight: 700; background: rgba(255,255,255,0.06); color: #8a9bb5; }
    .tab.active { background: #00c896; color: #080c14; }
    .grid { display: flex; flex-direction: column; gap: 20px; max-width: 960px; }
    .card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 20px; }
    .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .card-id { font-size: 18px; font-weight: 800; color: #fff; }
    .badge { padding: 4px 12px; border-radius: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .badge-pending { background: rgba(255,180,0,0.15); color: #f5a623; border: 1px solid rgba(255,180,0,0.2); }
    .badge-verified { background: rgba(0,200,150,0.15); color: #00c896; border: 1px solid rgba(0,200,150,0.2); }
    .badge-rejected { background: rgba(255,80,80,0.15); color: #ff5050; border: 1px solid rgba(255,80,80,0.2); }
    .badge-active { background: rgba(0,200,150,0.15); color: #00c896; border: 1px solid rgba(0,200,150,0.2); }
    .photos { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 18px; }
    .photo-box { border-radius: 10px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); }
    .photo-label { font-size: 11px; color: #5a6a80; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
    .photo-box img { width: 100%; height: 180px; object-fit: cover; display: block; cursor: pointer; }
    .no-photo { width: 100%; height: 180px; background: rgba(255,255,255,0.03); display: flex; align-items: center; justify-content: center; color: #3a4a60; font-size: 13px; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
    .meta { font-size: 12px; color: #5a6a80; margin-bottom: 14px; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
    .form-group { display: flex; flex-direction: column; gap: 4px; }
    .form-group label { font-size: 11px; color: #5a6a80; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .form-group input, .form-group select { padding: 10px 12px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff; font-size: 14px; }
    .form-group input:focus, .form-group select:focus { outline: none; border-color: #00c896; }
    .empty { text-align: center; padding: 60px; color: #3a4a60; font-size: 15px; }
    #loading { color: #5a6a80; text-align: center; padding: 40px; }
    .count-badge { background: rgba(255,180,0,0.15); color: #f5a623; border-radius: 10px; padding: 2px 8px; font-size: 12px; font-weight: 700; margin-left: 6px; }
    .section-divider { height: 1px; background: rgba(255,255,255,0.06); margin: 14px 0; }
    .location-section { background: rgba(0,200,150,0.03); border: 1px solid rgba(0,200,150,0.12); border-radius: 12px; padding: 16px; margin-top: 14px; }
    .location-title { font-size: 12px; font-weight: 700; color: #00c896; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 8px; }
    .location-prefilled { display: flex; align-items: flex-start; gap: 8px; padding: 10px 14px; background: rgba(0,200,150,0.08); border: 1px solid rgba(0,200,150,0.2); border-radius: 10px; margin-bottom: 12px; font-size: 13px; color: #00c896; font-weight: 600; }
    .location-zip-row { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; }
    .location-zip-row input { flex: 1; padding: 10px 12px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; color: #fff; font-size: 14px; max-width: 140px; }
    .location-zip-row input:focus { outline: none; border-color: #00c896; }
    .btn-find { padding: 10px 16px; background: rgba(0,200,150,0.12); color: #00c896; border: 1px solid rgba(0,200,150,0.25); border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 700; white-space: nowrap; }
    .btn-find:disabled { opacity: 0.4; cursor: not-allowed; }
    .spot-btn { padding: 11px 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; color: #c8d6e5; font-size: 13px; cursor: pointer; text-align: left; transition: all 0.15s; margin-bottom: 8px; width: 100%; }
    .spot-btn:hover { border-color: rgba(0,200,150,0.3); background: rgba(0,200,150,0.05); }
    .spot-btn.selected { border-color: #00c896; background: rgba(0,200,150,0.1); color: #00c896; font-weight: 700; }
    .spot-name { font-weight: 600; }
    .spot-addr { font-size: 12px; color: #5a6a80; margin-top: 2px; }
    .spot-btn.selected .spot-addr { color: rgba(0,200,150,0.6); }
    .location-loading { color: #5a6a80; font-size: 13px; padding: 8px 0; }
    .location-error { color: #f5a623; font-size: 13px; padding: 8px 0; }
    .delete-notice { font-size: 11px; color: #3a4a60; margin-top: 10px; font-style: italic; }
  </style>
</head>
<body>
  <h1>DVVIA Admin</h1>
  <p class="subtitle">Platform Management Dashboard</p>

  <div id="login-section" style="display:${pwd ? 'none' : 'block'}">
    <div class="login-box">
      <input type="password" id="pwd-input" placeholder="Admin password" onkeydown="if(event.key==='Enter')login()" />
      <button class="btn btn-green" onclick="login()">Access Panel</button>
    </div>
  </div>

  <div id="panel" style="display:${pwd ? 'block' : 'none'}">
    <div class="tabs">
      <button class="tab active" onclick="switchTab('users')" id="tab-users">👤 Users <span class="count-badge" id="users-count">...</span></button>
      <button class="tab" onclick="switchTab('vehicles')" id="tab-vehicles">🚗 Vehicles <span class="count-badge" id="vehicles-count">...</span></button>
    </div>
    <div id="loading">Loading...</div>
    <div id="content-grid" class="grid" style="display:none"></div>
    <div id="empty-state" class="empty" style="display:none">Nothing to review ✓</div>
  </div>

  <script>
    let currentPwd = '${pwd}';
    let currentTab = 'users';
    const selectedLocations = {};
    const BASE = window.location.origin;

    function login() {
      currentPwd = document.getElementById('pwd-input').value;
      document.getElementById('login-section').style.display = 'none';
      document.getElementById('panel').style.display = 'block';
      loadCounts(); loadTab('users');
    }

    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.getElementById('tab-' + tab).classList.add('active');
      loadTab(tab);
    }

    function loadCounts() {
      fetch('/api/admin/counts?pwd=' + currentPwd)
        .then(r => r.json())
        .then(d => {
          if (d.pendingUsers !== undefined) document.getElementById('users-count').textContent = d.pendingUsers;
          if (d.pendingVehicles !== undefined) document.getElementById('vehicles-count').textContent = d.pendingVehicles;
        }).catch(() => {});
    }

    function loadTab(tab) {
      document.getElementById('loading').style.display = 'block';
      document.getElementById('content-grid').style.display = 'none';
      document.getElementById('empty-state').style.display = 'none';
      const url = tab === 'users' ? '/api/admin/users/pending?pwd=' + currentPwd : '/api/admin/vehicles/pending?pwd=' + currentPwd;
      fetch(url).then(r => r.json()).then(data => {
        document.getElementById('loading').style.display = 'none';
        const items = data.users || data.vehicles || [];
        if (items.length === 0) { document.getElementById('empty-state').style.display = 'block'; return; }
        const grid = document.getElementById('content-grid');
        grid.style.display = 'flex';
        grid.innerHTML = tab === 'users' ? items.map(u => renderUser(u)).join('') : items.map(v => renderVehicle(v)).join('');
      }).catch(() => { document.getElementById('loading').innerHTML = 'Error loading. Check password.'; });
    }

    function renderUser(u) {
      const status = u.verification_status || 'pending';
      const badgeClass = status === 'verified' ? 'badge-verified' : status === 'rejected' ? 'badge-rejected' : 'badge-pending';
      const idUrl = u.id_photo_path ? BASE + '/' + u.id_photo_path.replace(/\\\\/g, '/') : null;
      const mailUrl = u.mail_photo_path ? BASE + '/' + u.mail_photo_path.replace(/\\\\/g, '/') : null;
      const date = new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      return \`<div class="card" id="card-\${u.id}">
        <div class="card-header"><span class="card-id">\${u.dvvia_id}</span><span class="badge \${badgeClass}">\${status}</span></div>
        <div class="meta">User #\${u.id} · Registered \${date}</div>
        <div class="photos">
          <div>
            <div class="photo-label">Driver's License</div>
            <div class="photo-box">\${idUrl ? \`<img src="\${idUrl}" onclick="window.open(this.src)" onerror="this.parentElement.innerHTML='<div class=no-photo>Photo deleted</div>'" />\` : '<div class="no-photo">No photo</div>'}</div>
          </div>
          <div>
            <div class="photo-label">USPS Mail</div>
            <div class="photo-box">\${mailUrl ? \`<img src="\${mailUrl}" onclick="window.open(this.src)" onerror="this.parentElement.innerHTML='<div class=no-photo>Photo deleted</div>'" />\` : '<div class="no-photo">No photo</div>'}</div>
          </div>
        </div>
        <p class="delete-notice">⚠️ Photos are permanently deleted from server after approve or reject.</p>
        \${status === 'pending' ? \`
        <div class="actions">
          <button class="btn btn-approve" onclick="approveUser(\${u.id})">✓ Approve Identity</button>
          <button class="btn btn-red" onclick="rejectUser(\${u.id})">✕ Reject</button>
        </div>\` : \`<div style="color:#00c896;font-weight:700;">\${status === 'verified' ? '✓ Approved — Photos deleted' : '✕ Rejected — Photos deleted'}</div>\`}
      </div>\`;
    }

    function renderVehicle(v) {
      const status = v.listing_status || v.status || 'pending';
      const badgeClass = status === 'active' ? 'badge-active' : status === 'rejected' ? 'badge-rejected' : 'badge-pending';
      const titleUrl = v.title_photo_path ? BASE + '/' + v.title_photo_path.replace(/\\\\/g, '/') : null;
      const vinUrl = v.vin_photo_path ? BASE + '/' + v.vin_photo_path.replace(/\\\\/g, '/') : null;
      const odomUrl = v.odometer_photo_path ? BASE + '/' + v.odometer_photo_path.replace(/\\\\/g, '/') : null;
      const date = new Date(v.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const isPending = status === 'pending' || status === 'Pending Review';
      const hasLocation = !!(v.meeting_location_name);
      if (hasLocation) selectedLocations[v.id] = { name: v.meeting_location_name, address: v.meeting_location_address || '' };

      return \`<div class="card" id="vcard-\${v.id}">
        <div class="card-header">
          <span class="card-id">Listing #\${v.id} — \${v.seller_dvvia_id || 'Unknown'}</span>
          <span class="badge \${badgeClass}">\${status}</span>
        </div>
        <div class="meta">Submitted \${date} · Asking price: <strong style="color:#00c896">\$\${Number(v.price || 0).toLocaleString()}</strong></div>
        <div class="photos">
          <div><div class="photo-label">Vehicle Title</div><div class="photo-box">\${titleUrl ? \`<img src="\${titleUrl}" onclick="window.open(this.src)" onerror="this.parentElement.innerHTML='<div class=no-photo>No photo</div>'" />\` : '<div class="no-photo">No photo</div>'}</div></div>
          <div><div class="photo-label">VIN Plate</div><div class="photo-box">\${vinUrl ? \`<img src="\${vinUrl}" onclick="window.open(this.src)" onerror="this.parentElement.innerHTML='<div class=no-photo>No photo</div>'" />\` : '<div class="no-photo">No photo</div>'}</div></div>
          <div><div class="photo-label">Odometer</div><div class="photo-box">\${odomUrl ? \`<img src="\${odomUrl}" onclick="window.open(this.src)" onerror="this.parentElement.innerHTML='<div class=no-photo>No photo</div>'" />\` : '<div class="no-photo">No photo</div>'}</div></div>
        </div>
        <p class="delete-notice">⚠️ Title, VIN, and odometer photos are permanently deleted after approve or reject.</p>
        <div class="section-divider"></div>
        <div class="photo-label" style="margin-bottom:12px">Fill in vehicle details from photos above:</div>
        <div class="form-grid">
          <div class="form-group"><label>Year</label><input type="number" id="v\${v.id}-year" placeholder="e.g. 2021" value="\${v.year && v.year !== new Date().getFullYear() ? v.year : ''}" /></div>
          <div class="form-group"><label>Make</label><input type="text" id="v\${v.id}-make" placeholder="e.g. Toyota" value="\${v.make && v.make !== 'Pending' ? v.make : ''}" /></div>
          <div class="form-group"><label>Model</label><input type="text" id="v\${v.id}-model" placeholder="e.g. Camry SE" value="\${v.model && v.model !== 'Review' ? v.model : ''}" /></div>
          <div class="form-group"><label>Mileage</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="v\${v.id}-mileage" placeholder="e.g. 34200" value="\${v.mileage > 0 ? v.mileage : ''}" /></div>
          <div class="form-group"><label>VIN</label><input type="text" id="v\${v.id}-vin" placeholder="Full VIN number" value="\${v.vin && v.vin !== 'PENDING' ? v.vin : ''}" /></div>
          <div class="form-group"><label>Title Status</label>
            <select id="v\${v.id}-title">
              <option value="Clean" \${v.title_status === 'Clean' ? 'selected' : ''}>Clean</option>
              <option value="Salvage" \${v.title_status === 'Salvage' ? 'selected' : ''}>Salvage</option>
              <option value="Rebuilt" \${v.title_status === 'Rebuilt' ? 'selected' : ''}>Rebuilt</option>
              <option value="Lien" \${v.title_status === 'Lien' ? 'selected' : ''}>Lien</option>
            </select>
          </div>
          <div class="form-group"><label>Exterior Color</label><input type="text" id="v\${v.id}-color" placeholder="e.g. Pearl White" value="\${v.exterior_color || ''}" /></div>
          <div class="form-group"><label>Transmission</label>
            <select id="v\${v.id}-trans">
              <option value="Automatic" \${v.transmission === 'Automatic' ? 'selected' : ''}>Automatic</option>
              <option value="Manual" \${v.transmission === 'Manual' ? 'selected' : ''}>Manual</option>
              <option value="CVT" \${v.transmission === 'CVT' ? 'selected' : ''}>CVT</option>
            </select>
          </div>
        </div>
        \${isPending ? \`
        <div class="location-section">
          <div class="location-title">📍 Meeting Location</div>
          \${hasLocation ? \`
            <div class="location-prefilled">✓ Seller chose: \${v.meeting_location_name}\${v.meeting_location_address ? '<br><span style="font-size:12px;font-weight:400;color:rgba(0,200,150,0.7)">' + v.meeting_location_address + '</span>' : ''}</div>
            <p style="font-size:12px;color:#5a6a80;margin-bottom:12px;">You can override with a different spot if needed:</p>
          \` : \`
            <p style="font-size:12px;color:#f5a623;margin-bottom:12px;">⚠️ Seller did not choose a location. Enter their verified zip code to set one:</p>
          \`}
          <div class="location-zip-row">
            <input type="text" id="v\${v.id}-zip" placeholder="Zip code" maxlength="5" oninput="this.value=this.value.replace(/[^0-9]/g,'')" />
            <button class="btn-find" id="v\${v.id}-find-btn" onclick="findNearbySpots(\${v.id})">Find Nearby Spots</button>
          </div>
          <div id="v\${v.id}-spots"></div>
        </div>
        <div class="actions">
          <button class="btn btn-approve" id="v\${v.id}-approve-btn" onclick="approveVehicle(\${v.id})" \${hasLocation ? '' : 'disabled'}>✓ Approve & Go Live</button>
          <button class="btn btn-red" onclick="rejectVehicle(\${v.id})">✕ Reject Listing</button>
        </div>\` : \`<div style="color:#00c896;font-weight:700;margin-top:8px;">\${status === 'active' ? '✓ Live — ' + (v.meeting_location_name || 'No location') : '✕ Rejected'}</div>\`}
      </div>\`;
    }

    async function findNearbySpots(vehicleId) {
      const zip = document.getElementById('v' + vehicleId + '-zip').value.trim();
      if (zip.length !== 5) { alert('Please enter a valid 5-digit zip code.'); return; }
      const spotsDiv = document.getElementById('v' + vehicleId + '-spots');
      const findBtn = document.getElementById('v' + vehicleId + '-find-btn');
      findBtn.disabled = true;
      spotsDiv.innerHTML = '<div class="location-loading">🔍 Finding nearby public spots...</div>';
      try {
        const geoRes = await fetch('https://nominatim.openstreetmap.org/search?postalcode=' + zip + '&countrycodes=us&format=json&limit=1', { headers: { 'Accept-Language': 'en', 'User-Agent': 'DVVIA-Admin/1.0' } });
        const geoData = await geoRes.json();
        if (!geoData || geoData.length === 0) { spotsDiv.innerHTML = '<div class="location-error">⚠️ Zip code not found. Try again.</div>'; findBtn.disabled = false; return; }
        const lat = parseFloat(geoData[0].lat), lng = parseFloat(geoData[0].lon);
        const q = \`[out:json][timeout:15];(node["amenity"="police"](around:10000,\${lat},\${lng});node["amenity"="post_office"](around:10000,\${lat},\${lng});node["amenity"="courthouse"](around:10000,\${lat},\${lng});node["amenity"="townhall"](around:10000,\${lat},\${lng});node["name"~"Walmart|Target|Kroger|Meijer|Publix",i]["shop"](around:8000,\${lat},\${lng}););out body 12;\`;
        const elements = (await (await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q) })).json()).elements || [];
        const seen = new Set(), spots = [];
        for (const el of elements) {
          if (!el.tags) continue;
          const name = el.tags.name || ''; if (!name || name.length < 3) continue;
          const addr = [el.tags['addr:housenumber'], el.tags['addr:street'], el.tags['addr:city']].filter(Boolean).join(' ') || 'Public location';
          if (seen.has(name.toLowerCase())) continue; seen.add(name.toLowerCase());
          const amenity = el.tags.amenity || '';
          let icon = '🏢';
          if (amenity === 'police') icon = '🚔'; else if (amenity === 'post_office') icon = '📮'; else if (amenity === 'courthouse' || amenity === 'townhall') icon = '🏛️'; else if (name.match(/walmart|target|kroger|meijer|publix/i)) icon = '🛒';
          spots.push({ name, addr, icon }); if (spots.length >= 6) break;
        }
        if (spots.length === 0) { spotsDiv.innerHTML = '<div class="location-error">⚠️ No public spots found. Try a neighboring zip code.</div>'; findBtn.disabled = false; return; }
        spotsDiv.innerHTML = spots.map((s, i) => \`<button class="spot-btn" id="spot-\${vehicleId}-\${i}" onclick="selectSpot(\${vehicleId},\${i},'\${s.name.replace(/'/g,"\\\\'")}','\${s.addr.replace(/'/g,"\\\\'")}')"><div class="spot-name">\${s.icon} \${s.name}</div><div class="spot-addr">\${s.addr}</div></button>\`).join('');
        findBtn.disabled = false;
      } catch (err) { spotsDiv.innerHTML = '<div class="location-error">⚠️ Could not load spots.</div>'; findBtn.disabled = false; }
    }

    function selectSpot(vehicleId, index, name, addr) {
      document.querySelectorAll('[id^="spot-' + vehicleId + '-"]').forEach(el => el.classList.remove('selected'));
      document.getElementById('spot-' + vehicleId + '-' + index).classList.add('selected');
      selectedLocations[vehicleId] = { name, address: addr };
      document.getElementById('v' + vehicleId + '-approve-btn').disabled = false;
    }

    function approveUser(userId) {
      if (!confirm('Approve this identity? Photos will be permanently deleted from the server.')) return;
      fetch('/api/admin/users/' + userId + '/approve', { method: 'POST', headers: { 'x-admin-password': currentPwd, 'Content-Type': 'application/json' } })
        .then(r => r.json()).then(d => {
          if (d.success) { document.getElementById('card-' + userId).style.opacity = '0.5'; document.getElementById('card-' + userId).querySelector('.actions').innerHTML = '<span style="color:#00c896;font-weight:700;">✓ Approved — Photos deleted</span>'; loadCounts(); }
        });
    }

    function rejectUser(userId) {
      const reason = prompt('Reason for rejection (optional):') || 'Documents do not match';
      if (!confirm('Reject this user? Photos will be permanently deleted from the server.')) return;
      fetch('/api/admin/users/' + userId + '/reject', { method: 'POST', headers: { 'x-admin-password': currentPwd, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) })
        .then(r => r.json()).then(d => {
          if (d.success) { document.getElementById('card-' + userId).style.opacity = '0.5'; document.getElementById('card-' + userId).querySelector('.actions').innerHTML = '<span style="color:#ff5050;font-weight:700;">✕ Rejected — Photos deleted</span>'; loadCounts(); }
        });
    }

    function approveVehicle(vehicleId) {
      const year = document.getElementById('v' + vehicleId + '-year').value;
      const make = document.getElementById('v' + vehicleId + '-make').value;
      const model = document.getElementById('v' + vehicleId + '-model').value;
      const mileage = document.getElementById('v' + vehicleId + '-mileage').value;
      const vin = document.getElementById('v' + vehicleId + '-vin').value;
      const titleStatus = document.getElementById('v' + vehicleId + '-title').value;
      const color = document.getElementById('v' + vehicleId + '-color').value;
      const transmission = document.getElementById('v' + vehicleId + '-trans').value;
      const location = selectedLocations[vehicleId];
      if (!year || !make || !model || !mileage || !vin) { alert('Please fill in Year, Make, Model, Mileage and VIN before approving.'); return; }
      fetch('/api/admin/vehicles/' + vehicleId + '/approve', {
        method: 'POST', headers: { 'x-admin-password': currentPwd, 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, make, model, mileage, vin, titleStatus, exteriorColor: color, transmission, meetingLocationName: location ? location.name : '', meetingLocationAddress: location ? location.address : '' })
      }).then(r => r.json()).then(d => {
        if (d.success) { document.getElementById('vcard-' + vehicleId).style.opacity = '0.5'; document.getElementById('vcard-' + vehicleId).querySelector('.actions').innerHTML = '<span style="color:#00c896;font-weight:700;">✓ Live — ' + (location ? location.name : 'No location') + '</span>'; loadCounts(); }
        else { alert('Error: ' + d.error); }
      });
    }

    function rejectVehicle(vehicleId) {
      const reason = prompt('Reason for rejection:') || 'Listing did not meet DVVIA requirements';
      fetch('/api/admin/vehicles/' + vehicleId + '/reject', { method: 'POST', headers: { 'x-admin-password': currentPwd, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) })
        .then(r => r.json()).then(d => {
          if (d.success) { document.getElementById('vcard-' + vehicleId).style.opacity = '0.5'; document.getElementById('vcard-' + vehicleId).querySelector('.actions').innerHTML = '<span style="color:#ff5050;font-weight:700;">✕ Rejected</span>'; loadCounts(); }
        });
    }

    if ('${pwd}') { loadCounts(); loadTab('users'); }
  </script>
</body>
</html>`);
});

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────

app.post('/api/auth/register', uploadReg.fields([
  { name: 'id_photo', maxCount: 1 },
  { name: 'mail_photo', maxCount: 1 }
]), async (req, res) => {
  try {
    const pool = getDb();
    const dvviaId = generateDvviaId();
    const password = generatePassword();
    const hash = await bcrypt.hash(password, 10);
    const idPhotoPath = req.files?.id_photo?.[0] ? path.join('uploads', 'id-photos', req.files.id_photo[0].filename) : null;
    const mailPhotoPath = req.files?.mail_photo?.[0] ? path.join('uploads', 'mail-photos', req.files.mail_photo[0].filename) : null;
    const result = await pool.query(
      `INSERT INTO users (dvvia_id, password_hash, id_photo_path, mail_photo_path, verification_status) VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
      [dvviaId, hash, idPhotoPath, mailPhotoPath]
    );
    res.json({ success: true, dvviaId, password, userId: result.rows[0].id });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const pool = getDb();
    const { dvviaId, password } = req.body;
    const result = await pool.query("SELECT * FROM users WHERE dvvia_id = $1", [dvviaId]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ success: false, error: 'DVVIA ID not found' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ success: false, error: 'Invalid password' });
    res.json({ success: true, userId: user.id, dvviaId: user.dvvia_id, verified: user.verified, verificationStatus: user.verification_status || 'pending' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/auth/verify', async (req, res) => {
  try {
    const pool = getDb();
    await pool.query("UPDATE users SET verified = 1, verified_date = NOW() WHERE id = $1", [req.body.userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/auth/add-phone', async (req, res) => {
  try {
    const pool = getDb();
    await pool.query("UPDATE users SET phone = $1 WHERE id = $2", [req.body.phone, req.body.userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/auth/profile/:userId', async (req, res) => {
  try {
    const pool = getDb();
    const uid = Number(req.params.userId);
    const userResult = await pool.query("SELECT id, dvvia_id, phone, verified, verification_status, verified_date, created_at FROM users WHERE id = $1", [uid]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    const listings = await pool.query("SELECT COUNT(*) as count FROM vehicles WHERE seller_id = $1", [uid]);
    const viewings = await pool.query("SELECT COUNT(*) as count FROM appointments WHERE buyer_id = $1 OR seller_id = $1", [uid]);
    const noShows = await pool.query("SELECT COUNT(*) as count FROM no_shows WHERE user_id = $1", [uid]);
    res.json({ success: true, user: { ...user, totalListings: listings.rows[0].count, totalViewings: viewings.rows[0].count, noShows: noShows.rows[0].count } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── WEB LOGIN ROUTES ─────────────────────────────────────────────────────────

// User enters DVVIA ID on website → notification sent to app → app approves → website unlocks
app.post('/api/auth/web-login-request', async (req, res) => {
  try {
    const pool = getDb();
    const { dvviaId } = req.body;
    if (!dvviaId) return res.status(400).json({ success: false, error: 'DVVIA ID required' });
    const result = await pool.query("SELECT id, dvvia_id, verification_status FROM users WHERE dvvia_id = $1", [dvviaId.toUpperCase()]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ success: false, error: 'DVVIA ID not found' });
    if (user.verification_status !== 'verified') return res.status(403).json({ success: false, error: 'Account not yet verified. Complete verification in the app first.' });
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    await pool.query(
      `INSERT INTO web_login_tokens (token, user_id, expires_at, status) VALUES ($1, $2, $3, 'pending')`,
      [token, user.id, expiresAt]
    );
    await createNotification(pool, user.id, 'web_login_request', 'Web Login Request 🌐', 'Someone is trying to log into dvvia.com with your DVVIA ID. Tap to approve or deny.', { token });
    res.json({ success: true, token });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Website polls every 2 seconds waiting for app approval
app.get('/api/auth/web-login-poll/:token', async (req, res) => {
  try {
    const pool = getDb();
    const result = await pool.query(
      `SELECT wlt.*, u.dvvia_id FROM web_login_tokens wlt JOIN users u ON wlt.user_id = u.id WHERE wlt.token = $1`,
      [req.params.token]
    );
    const token = result.rows[0];
    if (!token) return res.json({ approved: false, denied: true });
    if (new Date() > new Date(token.expires_at)) return res.json({ approved: false, denied: true, reason: 'expired' });
    if (token.status === 'approved') return res.json({ approved: true, dvviaId: token.dvvia_id, userId: token.user_id });
    if (token.status === 'denied') return res.json({ approved: false, denied: true });
    res.json({ approved: false, denied: false });
  } catch (err) { res.status(500).json({ approved: false, denied: false }); }
});

// App approves web login
app.post('/api/auth/web-login-approve', async (req, res) => {
  try {
    const pool = getDb();
    const { token, userId } = req.body;
    await pool.query("UPDATE web_login_tokens SET status = 'approved' WHERE token = $1 AND user_id = $2", [token, userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// App denies web login
app.post('/api/auth/web-login-deny', async (req, res) => {
  try {
    const pool = getDb();
    const { token, userId } = req.body;
    await pool.query("UPDATE web_login_tokens SET status = 'denied' WHERE token = $1 AND user_id = $2", [token, userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── ADMIN USER ROUTES ────────────────────────────────────────────────────────

app.get('/api/admin/counts', adminAuth, async (req, res) => {
  try {
    const pool = getDb();
    const pendingUsers = await pool.query("SELECT COUNT(*) as count FROM users WHERE verification_status = 'pending'");
    const pendingVehicles = await pool.query("SELECT COUNT(*) as count FROM vehicles WHERE status = 'pending' OR title_status = 'Pending Review'");
    res.json({ pendingUsers: pendingUsers.rows[0].count, pendingVehicles: pendingVehicles.rows[0].count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/users/pending', adminAuth, async (req, res) => {
  try {
    const pool = getDb();
    const result = await pool.query("SELECT id, dvvia_id, verification_status, id_photo_path, mail_photo_path, created_at FROM users WHERE verification_status = 'pending' ORDER BY created_at DESC");
    res.json({ success: true, users: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/admin/users', adminAuth, async (req, res) => {
  try {
    const pool = getDb();
    const result = await pool.query("SELECT id, dvvia_id, verification_status, id_photo_path, mail_photo_path, created_at FROM users ORDER BY created_at DESC LIMIT 100");
    res.json({ success: true, users: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/admin/users/:id/approve', adminAuth, async (req, res) => {
  try {
    const pool = getDb();
    const uid = Number(req.params.id);
    const userResult = await pool.query("SELECT id_photo_path, mail_photo_path FROM users WHERE id = $1", [uid]);
    const user = userResult.rows[0];
    await pool.query("UPDATE users SET verification_status = 'verified', verified = 1, verified_date = NOW(), id_photo_path = NULL, mail_photo_path = NULL WHERE id = $1", [uid]);
    if (user) { deleteFile(user.id_photo_path); deleteFile(user.mail_photo_path); }
    await createNotification(pool, uid, 'account_approved', 'Identity Verified ✅', 'Your DVVIA identity has been verified. You can now post vehicles and request viewings.');
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/admin/users/:id/reject', adminAuth, async (req, res) => {
  try {
    const pool = getDb();
    const uid = Number(req.params.id);
    const reason = req.body.reason || 'Documents do not match';
    const userResult = await pool.query("SELECT id_photo_path, mail_photo_path FROM users WHERE id = $1", [uid]);
    const user = userResult.rows[0];
    await pool.query("UPDATE users SET verification_status = 'rejected', rejection_reason = $1, id_photo_path = NULL, mail_photo_path = NULL WHERE id = $2", [reason, uid]);
    if (user) { deleteFile(user.id_photo_path); deleteFile(user.mail_photo_path); }
    await createNotification(pool, uid, 'account_rejected', 'Verification Failed', `Your identity could not be verified. Reason: ${reason}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── ADMIN VEHICLE ROUTES ─────────────────────────────────────────────────────

app.get('/api/admin/vehicles/pending', adminAuth, async (req, res) => {
  try {
    const pool = getDb();
    const result = await pool.query(
      `SELECT v.*, u.dvvia_id as seller_dvvia_id FROM vehicles v JOIN users u ON v.seller_id = u.id WHERE v.status != 'active' OR v.title_status = 'Pending Review' ORDER BY v.created_at DESC`
    );
    res.json({ success: true, vehicles: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/admin/vehicles/:id/approve', adminAuth, async (req, res) => {
  try {
    const pool = getDb();
    const vid = Number(req.params.id);
    const { year, make, model, mileage, vin, titleStatus, exteriorColor, transmission, meetingLocationName, meetingLocationAddress } = req.body;
    const vResult = await pool.query("SELECT title_photo_path, vin_photo_path, odometer_photo_path, seller_id FROM vehicles WHERE id = $1", [vid]);
    const v = vResult.rows[0];
    await pool.query(
      `UPDATE vehicles SET status='active', verified=1, verified_date=NOW(), year=$1, make=$2, model=$3, mileage=$4, vin=$5, title_status=$6, exterior_color=$7, transmission=$8, meeting_location_name=$9, meeting_location_address=$10, title_photo_path=NULL, vin_photo_path=NULL, odometer_photo_path=NULL WHERE id=$11`,
      [year, make, model, mileage, vin, titleStatus || 'Clean', exteriorColor, transmission, meetingLocationName || null, meetingLocationAddress || null, vid]
    );
    if (v) { deleteFile(v.title_photo_path); deleteFile(v.vin_photo_path); deleteFile(v.odometer_photo_path); }
    if (v?.seller_id) await createNotification(pool, v.seller_id, 'listing_approved', 'Your Listing is Live! 🚗', `Your ${make} ${model} is now live on DVVIA. Buyers can request viewings.`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/admin/vehicles/:id/reject', adminAuth, async (req, res) => {
  try {
    const pool = getDb();
    const vid = Number(req.params.id);
    const reason = req.body.reason || 'Listing did not meet DVVIA requirements';
    const vResult = await pool.query("SELECT title_photo_path, vin_photo_path, odometer_photo_path, seller_id FROM vehicles WHERE id = $1", [vid]);
    const v = vResult.rows[0];
    await pool.query("UPDATE vehicles SET status='rejected', rejection_reason=$1, title_photo_path=NULL, vin_photo_path=NULL, odometer_photo_path=NULL WHERE id=$2", [reason, vid]);
    if (v) { deleteFile(v.title_photo_path); deleteFile(v.vin_photo_path); deleteFile(v.odometer_photo_path); }
    if (v?.seller_id) await createNotification(pool, v.seller_id, 'listing_rejected', 'Listing Not Approved', `Your listing was not approved. Reason: ${reason}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── VEHICLE ROUTES ───────────────────────────────────────────────────────────

app.post('/api/vehicles', uploadVehicle.fields([
  { name: 'title_photo', maxCount: 1 },
  { name: 'vin_photo', maxCount: 1 },
  { name: 'odometer_photo', maxCount: 1 },
  { name: 'vehicle_photos', maxCount: 20 },
]), async (req, res) => {
  try {
    const pool = getDb();
    const b = req.body;
    const titlePhotoPath = req.files?.title_photo?.[0] ? path.join('uploads', 'title-photos', req.files.title_photo[0].filename) : null;
    const vinPhotoPath = req.files?.vin_photo?.[0] ? path.join('uploads', 'vin-photos', req.files.vin_photo[0].filename) : null;
    const odometerPhotoPath = req.files?.odometer_photo?.[0] ? path.join('uploads', 'odometer-photos', req.files.odometer_photo[0].filename) : null;
    const result = await pool.query(
      `INSERT INTO vehicles (seller_id, vin, year, make, model, trim_level, price, mileage, transmission, drivetrain, fuel_type, engine, exterior_color, interior_color, title_status, condition_exterior, condition_interior, condition_tires, condition_mechanical, condition_ac, condition_electronics, title_photo_path, vin_photo_path, odometer_photo_path, meeting_location_name, meeting_location_address, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,'pending') RETURNING id`,
      [b.sellerId, b.vin || 'PENDING', b.year, b.make, b.model, b.trimLevel, b.price, b.mileage,
       b.transmission, b.drivetrain, b.fuelType, b.engine, b.exteriorColor, b.interiorColor,
       b.titleStatus || 'Pending Review', b.conditionExterior, b.conditionInterior, b.conditionTires,
       b.conditionMechanical, b.conditionAc, b.conditionElectronics,
       titlePhotoPath, vinPhotoPath, odometerPhotoPath,
       b.meetingLocationName || null, b.meetingLocationAddress || null]
    );
    const vehicleId = result.rows[0].id;

    // ── Save vehicle exterior/interior photos ──
    const vehiclePhotoFiles = req.files?.vehicle_photos || [];
    console.log(`Vehicle ${vehicleId}: received ${vehiclePhotoFiles.length} exterior photos, fields:`, Object.keys(req.files || {}));
    const vehiclePhotoLabels = Array.isArray(req.body.vehicle_photo_labels)
      ? req.body.vehicle_photo_labels
      : req.body.vehicle_photo_labels ? [req.body.vehicle_photo_labels] : [];
    for (let i = 0; i < vehiclePhotoFiles.length; i++) {
      const photoPath = 'uploads/vehicle-photos/' + vehiclePhotoFiles[i].filename;
      const label = vehiclePhotoLabels[i] || 'photo';
      await pool.query(
        'INSERT INTO vehicle_photos (vehicle_id, photo_path, label) VALUES ($1, $2, $3)',
        [vehicleId, photoPath, label]
      );
    }

    res.json({ success: true, vehicleId });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/vehicles', async (req, res) => {
  try {
    const pool = getDb();
    const result = await pool.query(
      `SELECT v.id, v.year, v.make, v.model, v.trim_level, v.price, v.mileage,
              v.transmission, v.drivetrain, v.fuel_type, v.engine,
              v.exterior_color, v.interior_color, v.title_status, v.vin,
              v.condition_exterior, v.condition_interior, v.condition_tires,
              v.condition_mechanical, v.condition_ac, v.condition_electronics,
              v.meeting_location_name, v.meeting_location_address,
              v.verified, v.verified_date, v.created_at, v.status,
              u.dvvia_id as seller_dvvia_id,
              (SELECT photo_path FROM vehicle_photos WHERE vehicle_id = v.id ORDER BY id ASC LIMIT 1) as first_photo
       FROM vehicles v JOIN users u ON v.seller_id = u.id
       WHERE v.status = 'active' ORDER BY v.created_at DESC`
    );
    res.json({ success: true, vehicles: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/vehicles/:id', async (req, res) => {
  try {
    const pool = getDb();
    const vResult = await pool.query(
      `SELECT v.id, v.year, v.make, v.model, v.trim_level, v.price, v.mileage,
              v.transmission, v.drivetrain, v.fuel_type, v.engine,
              v.exterior_color, v.interior_color, v.title_status, v.vin,
              v.condition_exterior, v.condition_interior, v.condition_tires,
              v.condition_mechanical, v.condition_ac, v.condition_electronics,
              v.meeting_location_name, v.meeting_location_address,
              v.verified, v.verified_date, v.created_at, v.status,
              u.dvvia_id as seller_dvvia_id
       FROM vehicles v JOIN users u ON v.seller_id = u.id WHERE v.id = $1`,
      [Number(req.params.id)]
    );
    const vehicle = vResult.rows[0];
    if (!vehicle) return res.status(404).json({ success: false, error: 'Vehicle not found' });
    const photos = await pool.query("SELECT * FROM vehicle_photos WHERE vehicle_id = $1", [vehicle.id]);
    res.json({ success: true, vehicle, photos: photos.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/vehicles/:id/verify', async (req, res) => {
  try {
    const pool = getDb();
    await pool.query("UPDATE vehicles SET status = 'active', verified = 1, verified_date = NOW() WHERE id = $1", [Number(req.params.id)]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/vehicles/seller/:sellerId', async (req, res) => {
  try {
    const pool = getDb();
    const result = await pool.query(
      `SELECT id, year, make, model, trim_level, price, mileage, transmission, exterior_color, title_status, status, meeting_location_name, rejection_reason, created_at FROM vehicles WHERE seller_id = $1 ORDER BY created_at DESC`,
      [Number(req.params.sellerId)]
    );
    res.json({ success: true, vehicles: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/vehicles/:id/status', async (req, res) => {
  try {
    const pool = getDb();
    const vid = Number(req.params.id);
    const { status, sellerId } = req.body;
    const allowed = ['active', 'pending_sale', 'sold'];
    if (!allowed.includes(status)) return res.status(400).json({ success: false, error: 'Invalid status.' });
    const check = await pool.query("SELECT id FROM vehicles WHERE id = $1 AND seller_id = $2", [vid, sellerId]);
    if (check.rows.length === 0) return res.status(403).json({ success: false, error: 'Not authorized.' });
    await pool.query("UPDATE vehicles SET status = $1 WHERE id = $2", [status, vid]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── APPOINTMENT ROUTES ───────────────────────────────────────────────────────

app.post('/api/appointments', async (req, res) => {
  try {
    const pool = getDb();
    const b = req.body;
    const vResult = await pool.query("SELECT * FROM vehicles WHERE id = $1", [b.vehicleId]);
    const vehicle = vResult.rows[0];
    if (!vehicle) return res.status(404).json({ success: false, error: 'Vehicle not found' });
    const result = await pool.query(
      "INSERT INTO appointments (vehicle_id, buyer_id, seller_id, location_name, location_address, appointment_date, appointment_time) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [b.vehicleId, b.buyerId, vehicle.seller_id, b.locationName, b.locationAddress, b.appointmentDate, b.appointmentTime]
    );
    await createNotification(pool, vehicle.seller_id, 'viewing_request', 'New Viewing Request 📅', `Someone wants to view your ${vehicle.make || 'vehicle'} on ${b.appointmentDate} at ${b.appointmentTime}.`);
    res.json({ success: true, appointmentId: result.rows[0].id });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/appointments/user/:userId', async (req, res) => {
  try {
    const pool = getDb();
    const uid = Number(req.params.userId);
    const result = await pool.query(
      `SELECT a.*, v.year, v.make, v.model, v.price, buyer.dvvia_id as buyer_dvvia_id, seller.dvvia_id as seller_dvvia_id
       FROM appointments a JOIN vehicles v ON a.vehicle_id = v.id JOIN users buyer ON a.buyer_id = buyer.id JOIN users seller ON a.seller_id = seller.id
       WHERE a.buyer_id = $1 OR a.seller_id = $1 ORDER BY a.appointment_date DESC`, [uid]
    );
    res.json({ success: true, appointments: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/appointments/booked-slots/:vehicleId/:date', async (req, res) => {
  try {
    const pool = getDb();
    const { vehicleId, date } = req.params;
    const result = await pool.query(
      `SELECT appointment_time FROM appointments WHERE vehicle_id = $1 AND appointment_date = $2 AND status NOT IN ('cancelled')`,
      [Number(vehicleId), date]
    );
    res.json({ success: true, bookedTimes: result.rows.map(r => r.appointment_time) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/appointments/:id/arrive', async (req, res) => {
  try {
    const pool = getDb();
    const col = req.body.role === 'buyer' ? 'buyer_arrived' : 'seller_arrived';
    await pool.query(`UPDATE appointments SET ${col} = 1 WHERE id = $1`, [Number(req.params.id)]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/appointments/:id/late', async (req, res) => {
  try {
    const pool = getDb();
    const col = req.body.role === 'buyer' ? 'buyer_late_minutes' : 'seller_late_minutes';
    await pool.query(`UPDATE appointments SET ${col} = $1 WHERE id = $2`, [req.body.minutes, Number(req.params.id)]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/appointments/:id/complete', async (req, res) => {
  try {
    const pool = getDb();
    await pool.query("UPDATE appointments SET status = 'completed', completed_at = NOW() WHERE id = $1", [Number(req.params.id)]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/appointments/:id/cancel', async (req, res) => {
  try {
    const pool = getDb();
    await pool.query("UPDATE appointments SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $1 WHERE id = $2", [req.body.userId, Number(req.params.id)]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── NOTIFICATION ROUTES ──────────────────────────────────────────────────────

app.get('/api/notifications/:userId', async (req, res) => {
  try {
    const pool = getDb();
    const result = await pool.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [Number(req.params.userId)]);
    res.json({ success: true, notifications: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/notifications/:userId/unread-count', async (req, res) => {
  try {
    const pool = getDb();
    const result = await pool.query('SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND read_at IS NULL', [Number(req.params.userId)]);
    res.json({ success: true, count: Number(result.rows[0].count) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/notifications/:userId/read-all', async (req, res) => {
  try {
    const pool = getDb();
    await pool.query('UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL', [Number(req.params.userId)]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── DEBUG — check vehicle photos in database ────────────────────────────────
app.get('/api/debug/photos/:vehicleId', async (req, res) => {
  try {
    const pool = getDb();
    const result = await pool.query(
      'SELECT * FROM vehicle_photos WHERE vehicle_id = $1',
      [Number(req.params.vehicleId)]
    );
    res.json({ success: true, count: result.rows.length, photos: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── HEALTH ───────────────────────────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  try {
    const pool = getDb();
    const users = await pool.query("SELECT COUNT(*) as count FROM users");
    const vehicles = await pool.query("SELECT COUNT(*) as count FROM vehicles");
    const appointments = await pool.query("SELECT COUNT(*) as count FROM appointments");
    const pendingUsers = await pool.query("SELECT COUNT(*) as count FROM users WHERE verification_status = 'pending'");
    const pendingVehicles = await pool.query("SELECT COUNT(*) as count FROM vehicles WHERE status != 'active'");
    res.json({ status: 'ok', database: 'connected', counts: { users: users.rows[0].count, vehicles: vehicles.rows[0].count, appointments: appointments.rows[0].count, pendingUsers: pendingUsers.rows[0].count, pendingVehicles: pendingVehicles.rows[0].count } });
  } catch (err) { res.status(500).json({ status: 'error', error: err.message }); }
});

// ─── START ────────────────────────────────────────────────────────────────────

async function start() {
  await initDatabase();
  try {
    const pool = getDb();
    await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS meeting_location_name TEXT, ADD COLUMN IF NOT EXISTS meeting_location_address TEXT`);
    await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS meta TEXT`).catch(() => {});
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vehicle_photos (
        id SERIAL PRIMARY KEY,
        vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
        photo_path TEXT NOT NULL,
        label TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        meta TEXT,
        read_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS web_login_tokens (
        id SERIAL PRIMARY KEY,
        token TEXT UNIQUE NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        status TEXT DEFAULT 'pending',
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
  } catch (e) { console.log('Note:', e.message); }

  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  DVVIA Backend Running on port ' + PORT);
    console.log('  Admin: /admin');
    console.log('');
  });
}

start();
