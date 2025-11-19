// ===============================================================
// SERVER.JS – Producción (Railway + PostgreSQL + Cloudinary)
// ===============================================================

require('dotenv').config({ path: null });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');



// Importar migración y rutas
// const runMigration = require('./db/migrate');
const authRoutes = require('./routes/auth');
const employeeRoutes = require('./routes/employees');
const userRoutes = require('./routes/users');
const attendanceRoutes = require('./routes/attendance');
const reportRoutes = require('./routes/reports');
const dashboardRoutes = require('./routes/dashboard');
const devRoutes = require('./routes/dev');
const runMigration = require('./db/migrate');


const app = express();
const PORT = process.env.PORT || 5000;

// ===============================================================
// MIDDLEWARE GLOBAL
// ===============================================================
app.use(helmet());

app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://gjd78.com',
    'https://www.gjd78.com'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 200
}));


app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ===============================================================
// ELIMINADO: /uploads (no se usa en Railway)
// ===============================================================
// app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ===============================================================
// MIGRACIÓN A POSTGRESQL ANTES DE CARGAR RUTAS
// ===============================================================
(async () => {
  try {
    console.log("🔄 Ejecutando migración (si es necesaria)...");
     await runMigration(); // solo crea tablas si no existen
    console.log("✅ Migración completada");

    // ===============================================================
    // RUTAS API
    // ===============================================================
    app.use('/api/auth', authRoutes);
    app.use('/api/employees', employeeRoutes);
    app.use('/api/users', userRoutes);
    app.use('/api/attendance', attendanceRoutes);
    app.use('/api/reports', reportRoutes);
    app.use('/api/dashboard', dashboardRoutes);
    app.use('/api/dev', devRoutes);

    // Health Check
    app.get('/api/health', (req, res) => {
      res.json({
        status: 'OK',
        message: 'Servidor funcionando correctamente',
        timestamp: new Date().toISOString()
      });
    });

    // 404
    app.use('*', (req, res) => {
      res.status(404).json({ error: 'Ruta no encontrada' });
    });

    // Error global
    app.use((err, req, res, next) => {
      console.error('❌ Error global:', err);
      res.status(500).json({
        error: 'Error interno del servidor: ' + err.message
      });
    });

    // ===============================================================
    // START SERVER
    // ===============================================================
    app.listen(PORT, () => {
      console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    });

  } catch (error) {
    console.error("❌ Error durante migración:", error);
    process.exit(1);
  }
})();
