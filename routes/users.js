const express = require('express');
const bcrypt = require('bcryptjs');
const { getQuery, allQuery, runQuery } = require('../config/database');
const { authenticateToken, requireSuperAdmin } = require('../middleware/auth');

const router = express.Router();

// ROLES PERMITIDOS (NO incluye super_admin para evitar riesgos)
const allowedRoles = ['super_admin', 'admin', 'scanner', 'viewer'];

/* ================================================================
   GET /api/users - Listado de usuarios
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
      WHERE is_active = true
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
       FROM users WHERE id = ? AND is_active = true`,
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
   POST /api/users - Crear nuevo usuario
   ================================================================ */
router.post('/', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;

    // Validaciones básicas
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
      return res.status(400).json({
        success: false,
        error: 'Rol no válido'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'La contraseña debe tener al menos 6 caracteres'
      });
    }

    // Verificar duplicados
    const existingUser = await getQuery(
      'SELECT id FROM users WHERE username = ? AND is_active = true',
      [username]
    );

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Ya existe un usuario con este nombre'
      });
    }

    // Hash contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await runQuery(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [username, hashedPassword, role]
    );

    const newUser = await getQuery(
      'SELECT id, username, role, created_at FROM users WHERE id = ?',
      [result.id]
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

    // Validar existencia
    const existingUser = await getQuery(
      'SELECT id, role FROM users WHERE id = ? AND is_active = true',
      [userId]
    );

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado'
      });
    }

    // Proteger super_admin
    if (existingUser.role === 'super_admin') {
      return res.status(400).json({
        success: false,
        error: 'No se puede modificar un Super Administrador'
      });
    }

    if (!username || !role) {
      return res.status(400).json({
        success: false,
        error: 'Usuario y rol son obligatorios'
      });
    }

    if (/\s/.test(username)) {
      return res.status(400).json({
        success: false,
        error: 'El usuario no puede contener espacios'
      });
    }

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Rol no válido'
      });
    }

    // Verificar duplicado de username
    const duplicate = await getQuery(
      'SELECT id FROM users WHERE username = ? AND id != ? AND is_active = true',
      [username, userId]
    );

    if (duplicate) {
      return res.status(400).json({
        success: false,
        error: 'Ya existe otro usuario con este nombre'
      });
    }

    // Armar update
    let updateQuery = 'UPDATE users SET username = ?, role = ?, updated_at = NOW()';
    let params = [username, role];

    if (password && password.trim() !== '') {
      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'La contraseña debe tener al menos 6 caracteres'
        });
      }
      const hashed = await bcrypt.hash(password, 10);
      updateQuery += ', password = ?';
      params.push(hashed);
    }

    updateQuery += ' WHERE id = ?';
    params.push(userId);

    await runQuery(updateQuery, params);

    const updatedUser = await getQuery(
      'SELECT id, username, role, created_at, updated_at FROM users WHERE id = ?',
      [userId]
    );

    res.json({
      success: true,
      message: 'Usuario actualizado correctamente',
      data: updatedUser
    });

  } catch (error) {
    console.error('Error actualizando usuario:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* ================================================================
   DELETE /api/users/:id - Soft delete
   ================================================================ */
router.delete('/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    const existingUser = await getQuery(
      'SELECT id, role FROM users WHERE id = ? AND is_active = true',
      [userId]
    );

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado'
      });
    }

    if (existingUser.role === 'super_admin') {
      return res.status(400).json({
        success: false,
        error: 'No se puede eliminar un Super Administrador'
      });
    }

    await runQuery(
      'UPDATE users SET is_active = false, updated_at = NOW() WHERE id = ?',
      [userId]
    );

    res.json({
      success: true,
      message: 'Usuario eliminado exitosamente'
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
