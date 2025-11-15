const express = require('express');
const qr = require('qr-image');
const { getQuery, allQuery, runQuery } = require('../config/database');
const { authenticateToken, requireAdminOrScanner } = require('../middleware/auth');
const upload = require('../config/multerCloudinary');
const cloudinary = require('../config/cloudinary');

const router = express.Router();

/* ================================================================
   GET /api/employees - Listar empleados activos
================================================================ */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const employees = await allQuery(`
      SELECT 
        id, name, dni, type, monthly_salary, 
        photo, qr_code, is_active, created_at
      FROM employees 
      WHERE is_active = TRUE
      ORDER BY name ASC
    `);

    res.json({
      success: true,
      data: employees,
      count: employees.length
    });

  } catch (error) {
    console.error('❌ Error obteniendo empleados:', error);
    res.status(500).json({ success: false, error: 'Error obteniendo empleados' });
  }
});

/* ================================================================
   POST /api/employees - Crear empleado + QR automático
================================================================ */
router.post('/', authenticateToken, requireAdminOrScanner, upload.single('photo'), async (req, res) => {
  try {
    const { name, dni, type, monthly_salary } = req.body;

    // Validaciones
    if (!name || !dni || !type) {
      return res.status(400).json({ success: false, error: 'Nombre, DNI y tipo son requeridos' });
    }

    if (dni.length !== 13) {
      return res.status(400).json({ success: false, error: 'DNI debe tener 13 dígitos' });
    }

    if (type === "Al Dia" && (!monthly_salary || monthly_salary <= 0)) {
      return res.status(400).json({ success: false, error: 'Salario mensual requerido para empleados Al Día' });
    }

    // DNI único
    const exists = await getQuery('SELECT id FROM employees WHERE dni = ? AND is_active = TRUE', [dni]);
    if (exists) {
      return res.status(400).json({ success: false, error: 'DNI ya está registrado' });
    }

    // Foto Cloudinary
    const photoUrl = req.file?.path || null;

    // Crear empleado sin QR aún
    const insert = await runQuery(
      `INSERT INTO employees (name, dni, type, monthly_salary, photo)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
      [name, dni, type, monthly_salary || 0, photoUrl]
    );

    const employeeId = insert.id;

    /* ---------------------------
       Generar QR con ID real
    --------------------------- */
    const qrBuffer = qr.imageSync(employeeId.toString(), { type: 'png' });

    const uploadQr = () => new Promise((resolve, reject) => {
      const uploader = cloudinary.uploader.upload_stream(
        { folder: "attendance-qr", format: "png" },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      uploader.end(qrBuffer);
    });

    const qrUpload = await uploadQr();

    // Guardar QR URL
    await runQuery(`UPDATE employees SET qr_code = ? WHERE id = ?`, [
      qrUpload.secure_url, employeeId
    ]);

    const newEmployee = await getQuery('SELECT * FROM employees WHERE id = ?', [employeeId]);

    res.status(201).json({
      success: true,
      message: "Empleado creado exitosamente",
      data: newEmployee
    });

  } catch (error) {
    console.error('❌ Error creando empleado:', error);
    res.status(500).json({ success: false, error: 'Error al crear empleado' });
  }
});

/* ================================================================
   PUT /api/employees/:id - Actualizar empleado
================================================================ */
router.put('/:id', authenticateToken, requireAdminOrScanner, upload.single('photo'), async (req, res) => {
  try {
    const { name, dni, type, monthly_salary, remove_photo } = req.body;
    const employeeId = req.params.id;

    if (!name || !dni || !type) {
      return res.status(400).json({ success: false, error: 'Nombre, DNI y tipo requeridos' });
    }

    if (dni.length !== 13) {
      return res.status(400).json({ success: false, error: 'DNI debe tener 13 dígitos' });
    }

    const employee = await getQuery(
      'SELECT id, photo FROM employees WHERE id = ? AND is_active = TRUE',
      [employeeId]
    );

    if (!employee) {
      return res.status(404).json({ success: false, error: 'Empleado no encontrado' });
    }

    // Evitar duplicado de DNI
    const duplicate = await getQuery(
      'SELECT id FROM employees WHERE dni = ? AND id != ? AND is_active = TRUE',
      [dni, employeeId]
    );

    if (duplicate) {
      return res.status(400).json({ success: false, error: 'Otro empleado tiene este DNI' });
    }

    /* ---------------------------
       Manejo de Foto Cloudinary
    --------------------------- */
    let photoUrl = employee.photo;

    // Si piden eliminar foto
    if (remove_photo === "true" && employee.photo) {
      try {
        const publicId = employee.photo.split("/").slice(-1)[0].split(".")[0];
        await cloudinary.uploader.destroy(`attendance-photos/${publicId}`);
      } catch (e) {
        console.log("⚠️ No se pudo eliminar foto previa:", e.message);
      }
      photoUrl = null;
    }

    // Si subieron nueva foto
    if (req.file) {
      photoUrl = req.file.path;
    }

    await runQuery(
      `UPDATE employees 
       SET name = ?, dni = ?, type = ?, monthly_salary = ?, photo = ?, updated_at = NOW()
       WHERE id = ?`,
      [name, dni, type, monthly_salary || 0, photoUrl, employeeId]
    );

    const updated = await getQuery('SELECT * FROM employees WHERE id = ?', [employeeId]);

    res.json({ success: true, message: "Empleado actualizado", data: updated });

  } catch (error) {
    console.error('❌ Error actualizando empleado:', error);
    res.status(500).json({ success: false, error: 'Error actualizando empleado' });
  }
});

/* ================================================================
   DELETE /api/employees/:id - Soft delete
================================================================ */
router.delete('/:id', authenticateToken, requireAdminOrScanner, async (req, res) => {
  try {
    const employeeId = req.params.id;

    const employee = await getQuery(
      'SELECT id, photo FROM employees WHERE id = ? AND is_active = TRUE',
      [employeeId]
    );

    if (!employee) {
      return res.status(404).json({ success: false, error: 'Empleado no encontrado' });
    }

    // Eliminar foto Cloudinary si existe
    if (employee.photo) {
      try {
        const publicId = employee.photo.split("/").slice(-1)[0].split(".")[0];
        await cloudinary.uploader.destroy(`attendance-photos/${publicId}`);
      } catch (e) {
        console.log("⚠️ Error eliminando foto:", e.message);
      }
    }

    await runQuery(
      'UPDATE employees SET is_active = FALSE, updated_at = NOW() WHERE id = ?',
      [employeeId]
    );

    res.json({ success: true, message: "Empleado eliminado" });

  } catch (error) {
    console.error('❌ Error eliminando empleado:', error);
    res.status(500).json({ success: false, error: 'Error eliminando empleado' });
  }
});

/* ================================================================
   POST /generate-qr - Generar/Regenerar QR Cloudinary
================================================================ */
router.post('/:id/generate-qr', authenticateToken, requireAdminOrScanner, async (req, res) => {
  try {
    const employeeId = req.params.id;

    const employee = await getQuery(
      'SELECT id, qr_code FROM employees WHERE id = ? AND is_active = TRUE',
      [employeeId]
    );

    if (!employee) {
      return res.status(404).json({ success: false, error: 'Empleado no encontrado' });
    }

    const qrBuffer = qr.imageSync(employeeId.toString(), { type: 'png' });

    // Si tiene QR previo, eliminarlo
    if (employee.qr_code) {
      try {
        const publicId = employee.qr_code.split("/").slice(-1)[0].split(".")[0];
        await cloudinary.uploader.destroy(`attendance-qr/${publicId}`);
      } catch (e) {
        console.log("⚠️ No se pudo eliminar QR previo:", e.message);
      }
    }

    const uploadToCloudinary = () => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "attendance-qr", format: "png" },
          (err, result) => (err ? reject(err) : resolve(result))
        );
        stream.end(qrBuffer);
      });
    };

    const qrUpload = await uploadToCloudinary();

    await runQuery(
      'UPDATE employees SET qr_code = ? WHERE id = ?',
      [qrUpload.secure_url, employeeId]
    );

    res.json({
      success: true,
      message: "QR actualizado correctamente",
      qr_url: qrUpload.secure_url
    });

  } catch (error) {
    console.error("❌ Error generando QR:", error);
    res.status(500).json({ success: false, error: "Error generando QR" });
  }
});

/* ================================================================
   GET /employees/:id/stats - Estadísticas (POSTGRES)
================================================================ */
router.get('/:id/stats', authenticateToken, async (req, res) => {
  try {
    const employeeId = req.params.id;

    const employee = await getQuery(
      `SELECT id, name, type, monthly_salary 
       FROM employees WHERE id = ? AND is_active = TRUE`,
      [employeeId]
    );

    if (!employee) {
      return res.status(404).json({ success: false, error: "Empleado no encontrado" });
    }

    const year = new Date().getFullYear();
    const month = new Date().getMonth() + 1;

    if (employee.type === "Producción") {

      const stats = await getQuery(
        `
        SELECT 
          COUNT(*) as dias_trabajados,
          COALESCE(SUM(despalillo), 0) as total_despalillo,
          COALESCE(SUM(escogida), 0) as total_escogida,
          COALESCE(SUM(monado), 0) as total_monado,
          COALESCE(SUM(t_despalillo), 0) as t_despalillo,
          COALESCE(SUM(t_escogida), 0) as t_escogida,
          COALESCE(SUM(t_monado), 0) as t_monado,
          COALESCE(SUM(septimo_dia), 0) as septimo_dia
        FROM attendance
        WHERE employee_id = ?
        AND EXTRACT(YEAR FROM date) = ?
        AND EXTRACT(MONTH FROM date) = ?
        AND exit_time IS NOT NULL
        `,
        [employeeId, year, month]
      );

      const total = stats.t_despalillo + stats.t_escogida + stats.t_monado;
      const propSabado = total * 0.090909;
      const neto = total + propSabado + stats.septimo_dia;

      return res.json({
        success: true,
        data: {
          ...stats,
          prop_sabado: Number(propSabado.toFixed(2)),
          neto_pagar: Number(neto.toFixed(2)),
          type: "Producción"
        }
      });
    }

    /* --- AL DÍA --- */

    const stats = await getQuery(
      `
      SELECT 
        COUNT(*) as dias_trabajados,
        COALESCE(SUM(hours_extra), 0) as horas_extras
      FROM attendance
      WHERE employee_id = ?
      AND EXTRACT(YEAR FROM date) = ?
      AND EXTRACT(MONTH FROM date) = ?
      AND exit_time IS NOT NULL
      `,
      [employeeId, year, month]
    );

    const salarioDiario = employee.monthly_salary / 30;
    const valorHoraNormal = salarioDiario / 8;
    const valorHE = valorHoraNormal * 1.25;
    const heDinero = stats.horas_extras * valorHE;
    const sabado = salarioDiario;
    const septimoDia = stats.dias_trabajados >= 5 ? salarioDiario : 0;
    const neto = (stats.dias_trabajados * salarioDiario) + heDinero + sabado + septimoDia;

    res.json({
      success: true,
      data: {
        dias_trabajados: stats.dias_trabajados,
        horas_extras: stats.horas_extras,
        he_dinero: Number(heDinero.toFixed(2)),
        salario_diario: Number(salarioDiario.toFixed(2)),
        sabado: Number(sabado.toFixed(2)),
        septimo_dia: Number(septimoDia.toFixed(2)),
        neto_pagar: Number(neto.toFixed(2)),
        type: "Al Dia"
      }
    });

  } catch (error) {
    console.error("❌ Error obteniendo stats:", error);
    res.status(500).json({ success: false, error: "Error obteniendo estadísticas" });
  }
});

module.exports = router;
