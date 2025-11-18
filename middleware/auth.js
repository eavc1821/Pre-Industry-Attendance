// middleware/auth.js
const jwt = require('jsonwebtoken');
const { getQuery } = require('../config/database');
const JWT_SECRET = process.env.JWT_SECRET;

// ============================================================
//  AUTHENTICATE TOKEN (PATCHED)
// ============================================================
async function authenticateToken(req, res, next) {
  try {
    const header = req.headers.authorization;

    if (!header) {
      return res.status(401).json({
        success: false,
        error: 'jwt malformed'
      });
    }

    const token = header.split(' ')[1];

    if (!token || token === "undefined" || token === "null") {
      return res.status(401).json({
        success: false,
        error: 'jwt malformed'
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      console.error('JWT verify error:', err.message);

      return res.status(401).json({
        success: false,
        error: err.name === 'TokenExpiredError' ? 'jwt expired' : 'jwt malformed'
      });
    }

    // ⛔ getQuery devuelve 1 registro, no array
    const user = await getQuery(
      'SELECT id, username, role, is_active FROM users WHERE id = $1',
      [decoded.id]
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'jwt malformed'
      });
    }

    if (user.is_active !== true) {
      return res.status(403).json({
        success: false,
        error: 'Usuario inactivo'
      });
    }

    req.user = {
      id: user.id,
      username: user.username,
      role: user.role
    };

    next();

  } catch (error) {
    console.error('authenticateToken error:', error);
    return res.status(500).json({
      success: false,
      error: 'Error interno de autenticación'
    });
  }
}


// ============================================================
//  SUPER ADMIN
// ============================================================
function requireSuperAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'jwt malformed'
    });
  }

  if (req.user.role !== 'super_admin') {
    return res.status(403).json({
      success: false,
      error: 'Requiere rol Super Admin'
    });
  }

  next();
}

// ============================================================
//  ADMIN / SCANNER
// ============================================================
function requireAdminOrScanner(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'jwt malformed'
    });
  }

  const allowed = ['super_admin', 'admin', 'scanner'];

  if (!allowed.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      error: 'Permisos insuficientes'
    });
  }

  next();
}

module.exports = {
  authenticateToken,
  requireSuperAdmin,
  requireAdminOrScanner
};
