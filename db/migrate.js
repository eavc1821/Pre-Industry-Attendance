const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

async function runMigration() {
  try {
    console.log("🚀 Ejecutando migración PostgreSQL...");

    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSQL = fs.readFileSync(schemaPath, 'utf8');

    await pool.query(schemaSQL);

    console.log("✅ Migración completada");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error ejecutando migración:", err);
    process.exit(1);
  }
}

runMigration();
