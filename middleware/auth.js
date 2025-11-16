// middleware/auth.js
const jwt = require('jsonwebtoken');
const { getQuery } = require('../config/database'); // tu helper para SELECT
const JWT_SECRET = process.env.JWT_SECRET;

// Verifica token y carga usuario en req.user
async function authenticateToken(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header) {
      return res.status(401).json({ success: false, error: 'Token no proporcionado' });
    }

    const token = header.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, error: 'Token mal formado' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      console.error('JWT verify error:', err.message);
      return res.status(401).json({ success: false, error: 'Token inválido o expirado' });
    }

    // Buscar usuario real en BD para verificar is_active y rol actual
    const user = await getQuery('SELECT id, username, role, is_active FROM users WHERE id = $1', [decoded.id]);

    if (!user) {
      console.warn('authenticateToken: usuario no existe id=', decoded.id);
      return res.status(401).json({ success: false, error: 'Usuario no encontrado' });
    }

    if (!user.is_active) {
      console.warn('authenticateToken: usuario inactivo id=', decoded.id);
      return res.status(403).json({ success: false, error: 'Usuario inactivo' });
    }

    // Attach user
    req.user = {
      id: user.id,
      username: user.username,
      role: user.role
    };

    next();
  } catch (error) {
    console.error('authenticateToken error:', error);
    res.status(500).json({ success: false, error: 'Error interno de autenticación' });
  }
}

// Middleware para super admin
function requireSuperAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: 'Token no proporcionado' });
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ success: false, error: 'Requiere rol Super Admin' });
  }
  next();
}

// Middleware para admin o scanner
function requireAdminOrScanner(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: 'Token no proporcionado' });
  const allowed = ['super_admin', 'admin', 'scanner'];
  if (!allowed.includes(req.user.role)) {
    return res.status(403).json({ success: false, error: 'Permisos insuficientes' });
  }
  next();
}

module.exports = {
  authenticateToken,
  requireSuperAdmin,
  requireAdminOrScanner
};
