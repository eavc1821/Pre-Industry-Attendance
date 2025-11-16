const express = require('express');
const bcrypt = require('bcryptjs');
const { getQuery, allQuery, runQuery } = require('../config/database');
const { authenticateToken, requireSuperAdmin } = require('../middleware/auth');

const router = express.Router();

// ROLES PERMITIDOS
const allowedRoles = ['super_admin', 'admin', 'scanner', 'viewer'];

/* ================================================================
   GET /api/users - Listado de usuarios (solo super_admin)
================================================================ */
router.get('/', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const users = await allQuery(`
      SELECT 
        id,
        username,
        role,
        is_active,
        created_at,
        updated_at
      FROM users
      WHERE is_active = TRUE
      ORDER BY created_at DESC
    `);

    res.json({
      success: true,
      data: users,
      count: users.length
    });

  } catch (error) {
    console.error('Error obteniendo usuarios:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener usuarios'
    });
  }
});

/* ================================================================
   GET /api/users/:id - Obtener usuario por ID
================================================================ */
router.get('/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const user = await getQuery(
      `SELECT id, username, role, created_at, updated_at 
       FROM users 
       WHERE id = $1 AND is_active = TRUE`,
      [req.params.id]
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado'
      });
    }

    res.json({
      success: true,
      data: user
    });

  } catch (error) {
    console.error('Error obteniendo usuario:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener usuario'
    });
  }
});

/* ================================================================
   POST /api/users - Crear usuario
================================================================ */
router.post('/', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({
        success: false,
        error: 'Usuario, contraseña y rol son obligatorios'
      });
    }

    if (/\s/.test(username)) {
      return res.status(400).json({
        success: false,
        error: 'El usuario no puede contener espacios'
      });
    }

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ success: false, error: 'Rol no válido' });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'La contraseña debe tener al menos 6 caracteres'
      });
    }

    const existingUser = await getQuery(
      'SELECT id FROM users WHERE username = $1 AND is_active = TRUE',
      [username]
    );

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Ya existe un usuario con este nombre'
      });
    }

    const hashed = await bcrypt.hash(password, 10);

    const result = await runQuery(
      `INSERT INTO users (username, password, role)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [username, hashed, role]
    );

    const userId = result[0].id;

    const newUser = await getQuery(
      `SELECT id, username, role, created_at 
       FROM users WHERE id = $1`,
      [userId]
    );

    res.status(201).json({
      success: true,
      message: 'Usuario creado exitosamente',
      data: newUser
    });

  } catch (error) {
    console.error('Error creando usuario:', error);
    res.status(500).json({
      success: false,
      error: 'Error al crear usuario'
    });
  }
});

/* ================================================================
   PUT /api/users/:id - Actualizar usuario
================================================================ */
router.put('/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const userId = req.params.id;

    const existing = await getQuery(
      'SELECT id, role FROM users WHERE id = $1 AND is_active = TRUE',
      [userId]
    );

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ success: false, error: 'Rol no válido' });
    }

    if (!username) {
      return res.status(400).json({ success: false, error: 'El nombre de usuario es requerido' });
    }

    if (/\s/.test(username)) {
      return res.status(400).json({ success: false, error: 'Usuario no puede contener espacios' });
    }

    // Verificar duplicados
    const duplicate = await getQuery(
      `SELECT id FROM users 
       WHERE username = $1 AND id != $2 AND is_active = TRUE`,
      [username, userId]
    );

    if (duplicate) {
      return res.status(400).json({
        success: false,
        error: 'Ya existe otro usuario con ese nombre'
      });
    }

    // Armar UPDATE dinámico
    let updateQuery = `UPDATE users SET username = $1, role = $2, updated_at = NOW()`;
    const params = [username, role];

    if (password && password.trim() !== '') {
      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'La contraseña debe tener al menos 6 caracteres'
        });
      }
      const hashed = await bcrypt.hash(password, 10);
      updateQuery += `, password = $3`;
      params.push(hashed);
    }

    updateQuery += ` WHERE id = ${password ? '$4' : '$3'}`;
    params.push(userId);

    await runQuery(updateQuery, params);

    const updated = await getQuery(
      `SELECT id, username, role, created_at, updated_at 
       FROM users WHERE id = $1`,
      [userId]
    );

    res.json({
      success: true,
      message: 'Usuario actualizado correctamente',
      data: updated
    });

  } catch (error) {
    console.error('Error actualizando usuario:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ================================================================
   DELETE /api/users/:id - Soft delete
================================================================ */
router.delete('/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    const existing = await getQuery(
      'SELECT id, role FROM users WHERE id = $1 AND is_active = TRUE',
      [userId]
    );

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    }

    if (existing.role === 'super_admin') {
      return res.status(400).json({
        success: false,
        error: 'No se puede eliminar un super_administrador'
      });
    }

    await runQuery(
      'UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1',
      [userId]
    );

    res.json({
      success: true,
      message: 'Usuario eliminado correctamente'
    });

  } catch (error) {
    console.error('Error eliminando usuario:', error);
    res.status(500).json({
      success: false,
      error: 'Error al eliminar usuario'
    });
  }
});

module.exports = router;
