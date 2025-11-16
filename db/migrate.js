const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');


async function runMigration() {
  try {
    console.log("🚀 Ejecutando migración PostgreSQL...");

    const schemaPath = path.join(__dirname, './schema.sql');
    const schemaSQL = fs.readFileSync(schemaPath, 'utf8');

    await pool.query(schemaSQL);

    console.log("✅ Migración completada");
  } catch (err) {
    console.error("❌ Error ejecutando migración:", err);
  } finally {
    process.exit(0);
  }
}

// Ejecutar solo si se llama desde terminal
if (require.main === module) {
  runMigration();
}

module.exports = runMigration;
