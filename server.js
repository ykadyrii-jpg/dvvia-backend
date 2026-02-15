const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { initDatabase, saveDatabase, getDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

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

function generateDvviaId() { return 'DV-' + Math.floor(1000000 + Math.random() * 9000000); }
function generatePassword() {
  const c = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%';
  let p = ''; for (let i = 0; i < 12; i++) p += c.charAt(Math.floor(Math.random() * c.length)); return p;
}
function generateLoginCode() { const n = Math.floor(100000 + Math.random() * 900000); return n.toString().slice(0,3) + '-' + n.toString().slice(3); }

function run(sql, params) { const db = getDb(); db.run(sql, params); saveDatabase(); }
function getOne(sql, params) {
  const db = getDb();
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
  stmt.free(); return null;
}
function getAll(sql, params) {
  const db = getDb();
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free(); return rows;
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const dvviaId = generateDvviaId();
    const password = generatePassword();
    const hash = await bcrypt.hash(password, 10);
    run("INSERT INTO users (dvvia_id, password_hash) VALUES (?, ?)", [dvviaId, hash]);
    const user = getOne("SELECT id FROM users WHERE dvvia_id = ?", [dvviaId]);
    res.json({ success: true, dvviaId, password, userId: user.id });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { dvviaId, password } = req.body;
  const user = getOne("SELECT * FROM users WHERE dvvia_id = ?", [dvviaId]);
  if (!user) return res.status(404).json({ success: false, error: 'DVVIA ID not found' });
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ success: false, error: 'Invalid password' });
  res.json({ success: true, userId: user.id, dvviaId: user.dvvia_id, verified: user.verified });
});

app.post('/api/auth/login-request', (req, res) => {
  const { dvviaId } = req.body;
  const user = getOne("SELECT * FROM users WHERE dvvia_id = ?", [dvviaId]);
  if (!user) return res.status(404).json({ success: false, error: 'DVVIA ID not found' });
  const code = generateLoginCode();
  const expires = new Date(Date.now() + 600000).toISOString();
  run("INSERT INTO login_codes (user_id, code, expires_at) VALUES (?, ?, ?)", [user.id, code, expires]);
  res.json({ success: true, code, expiresAt: expires });
});

app.post('/api/auth/verify', (req, res) => {
  const { userId } = req.body;
  run("UPDATE users SET verified = 1, verified_date = datetime('now') WHERE id = ?", [userId]);
  res.json({ success: true });
});

app.post('/api/auth/add-phone', (req, res) => {
  const { userId, phone } = req.body;
  run("UPDATE users SET phone = ? WHERE id = ?", [phone, userId]);
  res.json({ success: true });
});

app.get('/api/auth/profile/:userId', (req, res) => {
  const user = getOne("SELECT id, dvvia_id, phone, verified, verified_date, created_at FROM users WHERE id = ?", [Number(req.params.userId)]);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  const listings = getOne("SELECT COUNT(*) as count FROM vehicles WHERE seller_id = ?", [user.id]);
  const viewings = getOne("SELECT COUNT(*) as count FROM appointments WHERE buyer_id = ? OR seller_id = ?", [user.id, user.id]);
  const noShows = getOne("SELECT COUNT(*) as count FROM no_shows WHERE user_id = ?", [user.id]);
  res.json({ success: true, user: { ...user, totalListings: listings.count, totalViewings: viewings.count, noShows: noShows.count } });
});

app.post('/api/vehicles', (req, res) => {
  const b = req.body;
  run("INSERT INTO vehicles (seller_id, vin, year, make, model, trim_level, price, mileage, transmission, drivetrain, fuel_type, engine, exterior_color, interior_color, title_status, condition_exterior, condition_interior, condition_tires, condition_mechanical, condition_ac, condition_electronics) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [b.sellerId, b.vin, b.year, b.make, b.model, b.trimLevel, b.price, b.mileage, b.transmission, b.drivetrain, b.fuelType, b.engine, b.exteriorColor, b.interiorColor, b.titleStatus, b.conditionExterior, b.conditionInterior, b.conditionTires, b.conditionMechanical, b.conditionAc, b.conditionElectronics]);
  const v = getOne("SELECT last_insert_rowid() as id");
  res.json({ success: true, vehicleId: v.id });
});

app.get('/api/vehicles', (req, res) => {
  const vehicles = getAll("SELECT v.*, u.dvvia_id as seller_dvvia_id FROM vehicles v JOIN users u ON v.seller_id = u.id WHERE v.status = 'active' ORDER BY v.created_at DESC");
  res.json({ success: true, vehicles });
});

app.get('/api/vehicles/:id', (req, res) => {
  const vehicle = getOne("SELECT v.*, u.dvvia_id as seller_dvvia_id FROM vehicles v JOIN users u ON v.seller_id = u.id WHERE v.id = ?", [Number(req.params.id)]);
  if (!vehicle) return res.status(404).json({ success: false, error: 'Vehicle not found' });
  const photos = getAll("SELECT * FROM vehicle_photos WHERE vehicle_id = ?", [vehicle.id]);
  res.json({ success: true, vehicle, photos });
});

app.post('/api/vehicles/:id/verify', (req, res) => {
  run("UPDATE vehicles SET status = 'active', verified = 1, verified_date = datetime('now') WHERE id = ?", [Number(req.params.id)]);
  res.json({ success: true });
});

app.post('/api/appointments', (req, res) => {
  const b = req.body;
  const vehicle = getOne("SELECT * FROM vehicles WHERE id = ?", [b.vehicleId]);
  if (!vehicle) return res.status(404).json({ success: false, error: 'Vehicle not found' });
  run("INSERT INTO appointments (vehicle_id, buyer_id, seller_id, location_name, location_address, appointment_date, appointment_time) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [b.vehicleId, b.buyerId, vehicle.seller_id, b.locationName, b.locationAddress, b.appointmentDate, b.appointmentTime]);
  const a = getOne("SELECT last_insert_rowid() as id");
  res.json({ success: true, appointmentId: a.id });
});

app.get('/api/appointments/user/:userId', (req, res) => {
  const uid = Number(req.params.userId);
  const appointments = getAll("SELECT a.*, v.year, v.make, v.model, v.price FROM appointments a JOIN vehicles v ON a.vehicle_id = v.id WHERE a.buyer_id = ? OR a.seller_id = ? ORDER BY a.appointment_date DESC", [uid, uid]);
  res.json({ success: true, appointments });
});

app.post('/api/appointments/:id/arrive', (req, res) => {
  const col = req.body.role === 'buyer' ? 'buyer_arrived' : 'seller_arrived';
  run("UPDATE appointments SET " + col + " = 1 WHERE id = ?", [Number(req.params.id)]);
  res.json({ success: true });
});

app.post('/api/appointments/:id/late', (req, res) => {
  const col = req.body.role === 'buyer' ? 'buyer_late_minutes' : 'seller_late_minutes';
  run("UPDATE appointments SET " + col + " = ? WHERE id = ?", [req.body.minutes, Number(req.params.id)]);
  res.json({ success: true });
});

app.post('/api/appointments/:id/complete', (req, res) => {
  run("UPDATE appointments SET status = 'completed', completed_at = datetime('now') WHERE id = ?", [Number(req.params.id)]);
  res.json({ success: true });
});

app.post('/api/appointments/:id/cancel', (req, res) => {
  run("UPDATE appointments SET status = 'cancelled', cancelled_at = datetime('now'), cancelled_by = ? WHERE id = ?", [req.body.userId, Number(req.params.id)]);
  res.json({ success: true });
});

app.get('/api/health', (req, res) => {
  const users = getOne("SELECT COUNT(*) as count FROM users");
  const vehicles = getOne("SELECT COUNT(*) as count FROM vehicles");
  const appointments = getOne("SELECT COUNT(*) as count FROM appointments");
  res.json({ status: 'ok', database: 'connected', counts: { users: users.count, vehicles: vehicles.count, appointments: appointments.count } });
});

async function start() {
  await initDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  DVVIA Backend Server Running');
    console.log('  http://localhost:' + PORT);
    console.log('');
  });
}

start();
