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

app.post('/api/auth/register', async (req, res) => {
  try {
    const pool = getDb();
    const dvviaId = generateDvviaId();
    const password = generatePassword();
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (dvvia_id, password_hash) VALUES ($1, $2) RETURNING id",
      [dvviaId, hash]
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
    res.json({ success: true, userId: user.id, dvviaId: user.dvvia_id, verified: user.verified });
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
    const userResult = await pool.query("SELECT id, dvvia_id, phone, verified, verified_date, created_at FROM users WHERE id = $1", [uid]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    const listings = await pool.query("SELECT COUNT(*) as count FROM vehicles WHERE seller_id = $1", [uid]);
    const viewings = await pool.query("SELECT COUNT(*) as count FROM appointments WHERE buyer_id = $1 OR seller_id = $1", [uid]);
    const noShows = await pool.query("SELECT COUNT(*) as count FROM no_shows WHERE user_id = $1", [uid]);
    res.json({ success: true, user: { ...user, totalListings: listings.rows[0].count, totalViewings: viewings.rows[0].count, noShows: noShows.rows[0].count } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

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

app.get('/api/health', async (req, res) => {
  try {
    const pool = getDb();
    const users = await pool.query("SELECT COUNT(*) as count FROM users");
    const vehicles = await pool.query("SELECT COUNT(*) as count FROM vehicles");
    const appointments = await pool.query("SELECT COUNT(*) as count FROM appointments");
    res.json({ status: 'ok', database: 'connected', counts: { users: users.rows[0].count, vehicles: vehicles.rows[0].count, appointments: appointments.rows[0].count } });
  } catch (err) { res.status(500).json({ status: 'error', error: err.message }); }
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
