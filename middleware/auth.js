const jwt = require('jsonwebtoken');

// 🔐 JWT SECRET (obligatorio)
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ ERROR FATAL: Falta la variable JWT_SECRET en el entorno.');
  process.exit(1); // Detener servidor (es crítico)
}

/* ================================================================
   Middleware: Autenticación por token
   ================================================================ */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Token de acceso requerido'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        error: 'Token inválido o expirado'
      });
    }

    req.user = user;
    next();
  });
};

/* ================================================================
   Middleware: Super Administrador
   ================================================================ */
const requireSuperAdmin = (req, res, next) => {
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({
      success: false,
      error: 'Se requiere rol de Super Administrador para esta acción'
    });
  }
  next();
};

/* ================================================================
   Middleware: Administrador
   ================================================================ */
const requireAdmin = (req, res, next) => {
  if (!['super_admin', 'admin'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      error: 'Se requiere rol de Administrador'
    });
  }
  next();
};

/* ================================================================
   Middleware: Admin o Scanner (para asistencia)
   ================================================================ */
const requireAdminOrScanner = (req, res, next) => {
  const allowedRoles = ['super_admin', 'admin', 'scanner'];

  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      error: 'Permisos insuficientes para esta acción'
    });
  }
  next();
};

module.exports = {
  authenticateToken,
  requireSuperAdmin,
  requireAdmin,
  requireAdminOrScanner
};
