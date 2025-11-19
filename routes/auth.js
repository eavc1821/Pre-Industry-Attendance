const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getQuery, runQuery } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;

/* ================================================================
   POST /api/auth/login
================================================================ */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    console.log(">>> LOGIN DEBUG:");
    console.log("Username recibido:", username);
    console.log("Password recibido:", password);

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Usuario y contraseña son requeridos'
      });
    }

    if (/\s/.test(username)) {
      return res.status(400).json({
        success: false,
        error: 'El nombre de usuario no puede contener espacios'
      });
    }

    const user = await getQuery(
      'SELECT * FROM users WHERE username = $1 AND is_active = TRUE',
      [username]
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Credenciales inválidas'
      });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: 'Credenciales inválidas'
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });

  } catch (error) {
    console.error('❌ Error en login:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor'
    });
  }
});

/* ================================================================
   POST /api/auth/verify
================================================================ */
router.post('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'jwt malformed'  // Permite al frontend manejarlo correctamente
      });
    }

    let decoded;

    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (error) {
      console.error('❌ Error verificando token:', error);

      if (error.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          error: 'jwt expired'
        });
      }

      return res.status(401).json({
        success: false,
        error: 'jwt malformed'
      });
    }

    const user = await getQuery(
      'SELECT id, username, role FROM users WHERE id = $1 AND is_active = TRUE',
      [decoded.id]
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'jwt malformed'
      });
    }

    res.json({
      success: true,
      user
    });

  } catch (error) {
    console.error('❌ Error verificando token:', error);
    res.status(401).json({
      success: false,
      error: 'jwt malformed'
    });
  }
});

/* ================================================================
   PUT /api/auth/update-profile
================================================================ */
router.put('/update-profile', authenticateToken, async (req, res) => {
  try {
    const { username, currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!username) {
      return res.status(400).json({
        success: false,
        error: 'El nombre de usuario es requerido'
      });
    }

    if (/\s/.test(username)) {
      return res.status(400).json({
        success: false,
        error: 'El usuario no puede contener espacios'
      });
    }

    const user = await getQuery(
      'SELECT * FROM users WHERE id = $1 AND is_active = TRUE',
      [userId]
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado'
      });
    }

    const duplicate = await getQuery(
      'SELECT id FROM users WHERE username = $1 AND id != $2 AND is_active = TRUE',
      [username, userId]
    );

    if (duplicate) {
      return res.status(400).json({
        success: false,
        error: 'Ya existe otro usuario con este nombre'
      });
    }

    let updateQuery = `UPDATE users SET username = $1, updated_at = NOW()`;
    const params = [username];
    let paramIndex = 2;

    if (newPassword && newPassword.trim() !== '') {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          error: 'Debe ingresar la contraseña actual'
        });
      }

      const match = await bcrypt.compare(currentPassword, user.password);
      if (!match) {
        return res.status(400).json({
          success: false,
          error: 'La contraseña actual es incorrecta'
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'La nueva contraseña debe tener al menos 6 caracteres'
        });
      }

      const hashed = await bcrypt.hash(newPassword, 10);

      updateQuery += `, password = $${paramIndex}`;
      params.push(hashed);
      paramIndex++;
    }

    updateQuery += ` WHERE id = $${paramIndex}`;
    params.push(userId);

    await runQuery(updateQuery, params);

    const updated = await getQuery(
      'SELECT id, username, role, created_at, updated_at FROM users WHERE id = $1',
      [userId]
    );

    res.json({
      success: true,
      message: 'Perfil actualizado correctamente',
      data: updated
    });

  } catch (error) {
    console.error('❌ Error actualizando perfil:', error);
    res.status(500).json({
      success: false,
      error: 'Error al actualizar perfil'
    });
  }
});

module.exports = router;
