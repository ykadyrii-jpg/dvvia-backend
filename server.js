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

// ─── ADMIN PASSWORD ───────────────────────────────────────────────
// Change this to something only you know
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'dvvia-admin-2026';
// ──────────────────────────────────────────────────────────────────

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
  filename: (req, file, cb) => {
    cb(null, uuidv4() + (path.extname(file.originalname) || '.jpg'));
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// Multer for registration photos (id + mail in one request)
const regStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadsDir, file.fieldname === 'id_photo' ? 'id-photos' : 'mail-photos');
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, uuidv4() + '.jpg');
  }
});
const uploadReg = multer({ storage: regStorage, limits: { fileSize: 10 * 1024 * 1024 } });

function generateDvviaId() { return 'DV-' + Math.floor(1000000 + Math.random() * 9000000); }
function generatePassword() {
  const c = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%';
  let p = ''; for (let i = 0; i < 12; i++) p += c.charAt(Math.floor(Math.random() * c.length)); return p;
}

// ─── ADMIN MIDDLEWARE ─────────────────────────────────────────────
function adminAuth(req, res, next) {
  const pwd = req.headers['x-admin-password'] || req.query.pwd;
  if (pwd !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
// ──────────────────────────────────────────────────────────────────

// ─── ADMIN PANEL (HTML) ───────────────────────────────────────────
app.get('/admin', (req, res) => {
  const pwd = req.query.pwd || '';
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>DVVIA Admin — ID Review</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #080c14; color: #c8d6e5; font-family: -apple-system, sans-serif; padding: 32px 20px; }
    h1 { color: #00c896; font-size: 24px; margin-bottom: 4px; }
    .subtitle { color: #5a6a80; font-size: 14px; margin-bottom: 32px; }
    .login-box { max-width: 360px; }
    .login-box input { width: 100%; padding: 14px 16px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; color: #fff; font-size: 16px; margin-bottom: 12px; }
    .btn { padding: 12px 24px; border-radius: 10px; border: none; cursor: pointer; font-size: 15px; font-weight: 700; }
    .btn-green { background: #00c896; color: #080c14; }
    .btn-red { background: rgba(255,80,80,0.15); color: #ff5050; border: 1px solid rgba(255,80,80,0.3); }
    .btn-approve { background: rgba(0,200,150,0.15); color: #00c896; border: 1px solid rgba(0,200,150,0.3); }
    .users-grid { display: flex; flex-direction: column; gap: 24px; max-width: 900px; }
    .user-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 24px; }
    .user-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .user-id { font-size: 20px; font-weight: 800; color: #fff; }
    .badge { padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: 700; }
    .badge-pending { background: rgba(255,180,0,0.15); color: #f5a623; border: 1px solid rgba(255,180,0,0.2); }
    .badge-verified { background: rgba(0,200,150,0.15); color: #00c896; border: 1px solid rgba(0,200,150,0.2); }
    .badge-rejected { background: rgba(255,80,80,0.15); color: #ff5050; border: 1px solid rgba(255,80,80,0.2); }
    .photos { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
    .photo-box { border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); }
    .photo-label { font-size: 12px; color: #5a6a80; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .photo-box img { width: 100%; height: 220px; object-fit: cover; display: block; }
    .no-photo { width: 100%; height: 220px; background: rgba(255,255,255,0.03); display: flex; align-items: center; justify-content: center; color: #3a4a60; font-size: 14px; }
    .actions { display: flex; gap: 12px; }
    .user-meta { font-size: 13px; color: #5a6a80; margin-bottom: 16px; }
    .empty { text-align: center; padding: 60px; color: #3a4a60; font-size: 16px; }
    #loading { color: #5a6a80; text-align: center; padding: 40px; }
  </style>
</head>
<body>
  <h1>DVVIA Admin</h1>
  <p class="subtitle">Identity Verification Review</p>

  <div id="login-section" style="display:${pwd ? 'none' : 'block'}">
    <div class="login-box">
      <input type="password" id="pwd-input" placeholder="Admin password" />
      <button class="btn btn-green" onclick="login()">Access Panel</button>
    </div>
  </div>

  <div id="panel" style="display:${pwd ? 'block' : 'none'}">
    <div style="display:flex; gap:16px; margin-bottom:28px; flex-wrap:wrap;">
      <button class="btn btn-green" onclick="loadUsers('pending')" id="tab-pending">⏳ Pending</button>
      <button class="btn" style="background:rgba(255,255,255,0.06);color:#8a9bb5;" onclick="loadUsers('all')" id="tab-all">All Users</button>
    </div>
    <div id="loading">Loading...</div>
    <div id="users-grid" class="users-grid" style="display:none"></div>
    <div id="empty" class="empty" style="display:none">No users found</div>
  </div>

  <script>
    let currentPwd = '${pwd}';

    function login() {
      currentPwd = document.getElementById('pwd-input').value;
      document.getElementById('login-section').style.display = 'none';
      document.getElementById('panel').style.display = 'block';
      loadUsers('pending');
    }

    function loadUsers(filter) {
      document.getElementById('loading').style.display = 'block';
      document.getElementById('users-grid').style.display = 'none';
      document.getElementById('empty').style.display = 'none';

      const url = filter === 'pending'
        ? '/api/admin/users/pending?pwd=' + currentPwd
        : '/api/admin/users?pwd=' + currentPwd;

      fetch(url)
        .then(r => r.json())
        .then(data => {
          document.getElementById('loading').style.display = 'none';
          if (!data.users || data.users.length === 0) {
            document.getElementById('empty').style.display = 'block';
            return;
          }
          const grid = document.getElementById('users-grid');
          grid.style.display = 'flex';
          grid.innerHTML = data.users.map(u => renderUser(u)).join('');
        })
        .catch(() => {
          document.getElementById('loading').innerHTML = 'Error loading users. Check password.';
        });
    }

    function renderUser(u) {
      const status = u.verification_status || 'pending';
      const badgeClass = status === 'verified' ? 'badge-verified' : status === 'rejected' ? 'badge-rejected' : 'badge-pending';
      const idPhotoUrl = u.id_photo_path ? '/' + u.id_photo_path.replace(/\\\\/g, '/') : null;
      const mailPhotoUrl = u.mail_photo_path ? '/' + u.mail_photo_path.replace(/\\\\/g, '/') : null;
      const date = new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

      return \`<div class="user-card" id="card-\${u.id}">
        <div class="user-header">
          <span class="user-id">\${u.dvvia_id}</span>
          <span class="badge \${badgeClass}">\${status.toUpperCase()}</span>
        </div>
        <div class="user-meta">User #\${u.id} · Registered \${date}</div>
        <div class="photos">
          <div>
            <div class="photo-label">Driver's License</div>
            <div class="photo-box">
              \${idPhotoUrl ? \`<img src="\${idPhotoUrl}" alt="ID" />\` : '<div class="no-photo">No photo uploaded</div>'}
            </div>
          </div>
          <div>
            <div class="photo-label">USPS Mail</div>
            <div class="photo-box">
              \${mailPhotoUrl ? \`<img src="\${mailPhotoUrl}" alt="Mail" />\` : '<div class="no-photo">No photo uploaded</div>'}
            </div>
          </div>
        </div>
        \${status === 'pending' ? \`
        <div class="actions">
          <button class="btn btn-approve" onclick="approve(\${u.id})">✓ Approve — Verified</button>
          <button class="btn btn-red" onclick="reject(\${u.id})">✕ Reject</button>
        </div>\` : ''}
      </div>\`;
    }

    function approve(userId) {
      fetch('/api/admin/users/' + userId + '/approve', {
        method: 'POST',
        headers: { 'x-admin-password': currentPwd, 'Content-Type': 'application/json' }
      }).then(r => r.json()).then(d => {
        if (d.success) {
          document.getElementById('card-' + userId).style.opacity = '0.4';
          document.getElementById('card-' + userId).querySelector('.actions').innerHTML = '<span style="color:#00c896;font-weight:700;">✓ Approved</span>';
        }
      });
    }

    function reject(userId) {
      const reason = prompt('Reason for rejection (optional):') || 'Documents do not match';
      fetch('/api/admin/users/' + userId + '/reject', {
        method: 'POST',
        headers: { 'x-admin-password': currentPwd, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      }).then(r => r.json()).then(d => {
        if (d.success) {
          document.getElementById('card-' + userId).style.opacity = '0.4';
          document.getElementById('card-' + userId).querySelector('.actions').innerHTML = '<span style="color:#ff5050;font-weight:700;">✕ Rejected</span>';
        }
      });
    }

    if ('${pwd}') loadUsers('pending');
  </script>
</body>
</html>`);
});
// ──────────────────────────────────────────────────────────────────

// ─── AUTH ROUTES ──────────────────────────────────────────────────

// Register WITH photos — new main registration endpoint
app.post('/api/auth/register', uploadReg.fields([
  { name: 'id_photo', maxCount: 1 },
  { name: 'mail_photo', maxCount: 1 }
]), async (req, res) => {
  try {
    const pool = getDb();
    const dvviaId = generateDvviaId();
    const password = generatePassword();
    const hash = await bcrypt.hash(password, 10);

    const idPhotoPath = req.files?.id_photo?.[0]
      ? path.join('uploads', 'id-photos', req.files.id_photo[0].filename)
      : null;
    const mailPhotoPath = req.files?.mail_photo?.[0]
      ? path.join('uploads', 'mail-photos', req.files.mail_photo[0].filename)
      : null;

    const result = await pool.query(
      `INSERT INTO users (dvvia_id, password_hash, id_photo_path, mail_photo_path, verification_status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
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

app.post('/api/auth/login-request', async (req, res) => {
  try {
    const pool = getDb();
    const { dvviaId } = req.body;
    const result = await pool.query("SELECT * FROM users WHERE dvvia_id = $1", [dvviaId]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ success: false, error: 'DVVIA ID not found' });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 600000).toISOString();
    await pool.query("INSERT INTO login_codes (user_id, code, expires_at) VALUES ($1, $2, $3)", [user.id, code, expires]);
    res.json({ success: true, code, expiresAt: expires });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/auth/verify', async (req, res) => {
  try {
    const pool = getDb();
    const { userId } = req.body;
    await pool.query("UPDATE users SET verified = 1, verified_date = NOW() WHERE id = $1", [userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/auth/add-phone', async (req, res) => {
  try {
    const pool = getDb();
    const { userId, phone } = req.body;
    await pool.query("UPDATE users SET phone = $1 WHERE id = $2", [phone, userId]);
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

// ─── ADMIN ROUTES ─────────────────────────────────────────────────

app.get('/api/admin/users/pending', adminAuth, async (req, res) => {
  try {
    const pool = getDb();
    const result = await pool.query(
      "SELECT id, dvvia_id, verification_status, id_photo_path, mail_photo_path, created_at FROM users WHERE verification_status = 'pending' ORDER BY created_at DESC"
    );
    res.json({ success: true, users: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/admin/users', adminAuth, async (req, res) => {
  try {
    const pool = getDb();
    const result = await pool.query(
      "SELECT id, dvvia_id, verification_status, id_photo_path, mail_photo_path, created_at FROM users ORDER BY created_at DESC LIMIT 100"
    );
    res.json({ success: true, users: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/admin/users/:id/approve', adminAuth, async (req, res) => {
  try {
    const pool = getDb();
    await pool.query(
      "UPDATE users SET verification_status = 'verified', verified = 1, verified_date = NOW() WHERE id = $1",
      [Number(req.params.id)]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/admin/users/:id/reject', adminAuth, async (req, res) => {
  try {
    const pool = getDb();
    const reason = req.body.reason || 'Documents do not match';
    await pool.query(
      "UPDATE users SET verification_status = 'rejected', rejection_reason = $1 WHERE id = $2",
      [reason, Number(req.params.id)]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── VEHICLE ROUTES ───────────────────────────────────────────────

app.post('/api/vehicles', async (req, res) => {
  try {
    const pool = getDb();
    const b = req.body;
    const result = await pool.query(
      "INSERT INTO vehicles (seller_id, vin, year, make, model, trim_level, price, mileage, transmission, drivetrain, fuel_type, engine, exterior_color, interior_color, title_status, condition_exterior, condition_interior, condition_tires, condition_mechanical, condition_ac, condition_electronics) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id",
      [b.sellerId, b.vin, b.year, b.make, b.model, b.trimLevel, b.price, b.mileage, b.transmission, b.drivetrain, b.fuelType, b.engine, b.exteriorColor, b.interiorColor, b.titleStatus, b.conditionExterior, b.conditionInterior, b.conditionTires, b.conditionMechanical, b.conditionAc, b.conditionElectronics]
    );
    res.json({ success: true, vehicleId: result.rows[0].id });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/vehicles', async (req, res) => {
  try {
    const pool = getDb();
    const result = await pool.query("SELECT v.*, u.dvvia_id as seller_dvvia_id FROM vehicles v JOIN users u ON v.seller_id = u.id WHERE v.status = 'active' ORDER BY v.created_at DESC");
    res.json({ success: true, vehicles: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/vehicles/:id', async (req, res) => {
  try {
    const pool = getDb();
    const vResult = await pool.query("SELECT v.*, u.dvvia_id as seller_dvvia_id FROM vehicles v JOIN users u ON v.seller_id = u.id WHERE v.id = $1", [Number(req.params.id)]);
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

// ─── APPOINTMENT ROUTES ───────────────────────────────────────────

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
    res.json({ success: true, appointmentId: result.rows[0].id });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/appointments/user/:userId', async (req, res) => {
  try {
    const pool = getDb();
    const uid = Number(req.params.userId);
    const result = await pool.query(
      "SELECT a.*, v.year, v.make, v.model, v.price FROM appointments a JOIN vehicles v ON a.vehicle_id = v.id WHERE a.buyer_id = $1 OR a.seller_id = $1 ORDER BY a.appointment_date DESC",
      [uid]
    );
    res.json({ success: true, appointments: result.rows });
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

// ─── HEALTH ───────────────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  try {
    const pool = getDb();
    const users = await pool.query("SELECT COUNT(*) as count FROM users");
    const vehicles = await pool.query("SELECT COUNT(*) as count FROM vehicles");
    const appointments = await pool.query("SELECT COUNT(*) as count FROM appointments");
    const pending = await pool.query("SELECT COUNT(*) as count FROM users WHERE verification_status = 'pending'");
    res.json({ status: 'ok', database: 'connected', counts: { users: users.rows[0].count, vehicles: vehicles.rows[0].count, appointments: appointments.rows[0].count, pendingVerification: pending.rows[0].count } });
  } catch (err) { res.status(500).json({ status: 'error', error: err.message }); }
});

// ─── START ────────────────────────────────────────────────────────

async function start() {
  await initDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  DVVIA Backend Server Running');
    console.log('  http://localhost:' + PORT);
    console.log('  Admin panel: http://localhost:' + PORT + '/admin');
    console.log('');
  });
}

start();
