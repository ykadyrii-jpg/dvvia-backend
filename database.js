const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'dvvia.db');
let db = null;

async function initDatabase() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run("PRAGMA foreign_keys = ON");

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dvvia_id TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    phone TEXT,
    id_photo_path TEXT,
    mail_photo_path TEXT,
    verified INTEGER DEFAULT 0,
    verified_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL,
    vin TEXT, year INTEGER, make TEXT, model TEXT, trim_level TEXT,
    price REAL, mileage INTEGER, transmission TEXT, drivetrain TEXT,
    fuel_type TEXT, engine TEXT, exterior_color TEXT, interior_color TEXT,
    title_status TEXT, title_photo_path TEXT, vin_photo_path TEXT, odometer_photo_path TEXT,
    condition_exterior TEXT, condition_interior TEXT, condition_tires TEXT,
    condition_mechanical TEXT, condition_ac TEXT, condition_electronics TEXT,
    status TEXT DEFAULT 'pending', verified INTEGER DEFAULT 0, verified_date TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (seller_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS vehicle_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL, photo_type TEXT NOT NULL, photo_path TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL, buyer_id INTEGER NOT NULL, seller_id INTEGER NOT NULL,
    location_name TEXT NOT NULL, location_address TEXT NOT NULL,
    appointment_date TEXT NOT NULL, appointment_time TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    buyer_arrived INTEGER DEFAULT 0, seller_arrived INTEGER DEFAULT 0,
    buyer_late_minutes INTEGER DEFAULT 0, seller_late_minutes INTEGER DEFAULT 0,
    arrival_photo_path TEXT, completed_at TEXT, cancelled_at TEXT, cancelled_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
    FOREIGN KEY (buyer_id) REFERENCES users(id),
    FOREIGN KEY (seller_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS login_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, code TEXT NOT NULL, status TEXT DEFAULT 'pending',
    device_info TEXT, created_at TEXT DEFAULT (datetime('now')), expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS no_shows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, appointment_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (appointment_id) REFERENCES appointments(id)
  )`);

  saveDatabase();
  return db;
}

function saveDatabase() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

function getDb() { return db; }

module.exports = { initDatabase, saveDatabase, getDb };
