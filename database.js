const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        dvvia_id TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        phone TEXT,
        id_photo_path TEXT,
        mail_photo_path TEXT,
        verified INTEGER DEFAULT 0,
        verified_date TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id SERIAL PRIMARY KEY,
        seller_id INTEGER NOT NULL REFERENCES users(id),
        vin TEXT, year INTEGER, make TEXT, model TEXT, trim_level TEXT,
        price REAL, mileage INTEGER, transmission TEXT, drivetrain TEXT,
        fuel_type TEXT, engine TEXT, exterior_color TEXT, interior_color TEXT,
        title_status TEXT, title_photo_path TEXT, vin_photo_path TEXT, odometer_photo_path TEXT,
        condition_exterior TEXT, condition_interior TEXT, condition_tires TEXT,
        condition_mechanical TEXT, condition_ac TEXT, condition_electronics TEXT,
        status TEXT DEFAULT 'pending', verified INTEGER DEFAULT 0, verified_date TEXT,
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vehicle_photos (
        id SERIAL PRIMARY KEY,
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
        photo_type TEXT NOT NULL,
        photo_path TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
        buyer_id INTEGER NOT NULL REFERENCES users(id),
        seller_id INTEGER NOT NULL REFERENCES users(id),
        location_name TEXT NOT NULL, location_address TEXT NOT NULL,
        appointment_date TEXT NOT NULL, appointment_time TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        buyer_arrived INTEGER DEFAULT 0, seller_arrived INTEGER DEFAULT 0,
        buyer_late_minutes INTEGER DEFAULT 0, seller_late_minutes INTEGER DEFAULT 0,
        arrival_photo_path TEXT, completed_at TEXT, cancelled_at TEXT, cancelled_by INTEGER,
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS login_codes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        code TEXT NOT NULL, status TEXT DEFAULT 'pending',
        device_info TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS no_shows (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        appointment_id INTEGER NOT NULL REFERENCES appointments(id),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('Database initialized successfully');
  } finally {
    client.release();
  }
  return pool;
}

function saveDatabase() {
  // No-op for PostgreSQL - data is automatically persisted
}

function getDb() { return pool; }

module.exports = { initDatabase, saveDatabase, getDb };
