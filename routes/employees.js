const express = require("express");
const router = express.Router();
const { runQuery, getQuery, allQuery } = require("../config/database");
const { authenticateToken, requireAdminOrScanner } = require("../middleware/auth");
const cloudinary = require("../config/cloudinary");
const upload = require("../config/multerCloudinary");
const QRCode = require("qrcode");

/* ==================================================
   GET ALL EMPLOYEES
================================================== */
router.get("/", authenticateToken, async (req, res) => {
  try {
    const employees = await allQuery(`
      SELECT 
        id,
        dni,
        name,
        type,
        monthly_salary,
        photo,
        qr_code,
        is_active
      FROM employees
      WHERE is_active = TRUE
      ORDER BY id DESC
    `);

    res.json({ success: true, data: employees });
  } catch (error) {
    console.error("❌ Error obteniendo empleados:", error);
    res.status(500).json({ success: false, error: "Error obteniendo empleados" });
  }
});

/* ==================================================
   CREATE EMPLOYEE + AUTO-GENERATED QR (600x600)
================================================== */
router.post(
  "/",
  authenticateToken,
  requireAdminOrScanner,
  upload.single("photo"),
  async (req, res) => {
    try {
      const { dni, name, type, monthly_salary } = req.body;

      if (!dni || dni.length !== 13) {
        return res.status(400).json({ success: false, error: "DNI inválido (13 dígitos)" });
      }

      const exists = await getQuery(
        "SELECT id FROM employees WHERE dni = $1 AND is_active = TRUE",
        [dni]
      );

      if (exists) {
        return res.status(400).json({ success: false, error: "Ya existe un empleado con este DNI" });
      }

      const photoUrl = req.file?.path || null;

      const newEmployee = await getQuery(
        `INSERT INTO employees (dni, name, type, monthly_salary, photo, is_active)
        VALUES ($1, $2, $3, $4, $5, TRUE)
        RETURNING id`,
        [dni, name, type, monthly_salary || 0, photoUrl]
      );

      const employeeId = newEmployee.id;

      /* ==============================================
         GENERAR QR 600x600 USANDO "qrcode"
      =============================================== */
      const qrBuffer = await QRCode.toBuffer(employeeId.toString(), {
        width: 600,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
        errorCorrectionLevel: "H"
      });

      const uploadQR = () =>
        new Promise((resolve, reject) => {
          cloudinary.uploader.upload_stream(
            { folder: "attendance-qrs", format: "png", resource_type: "image" },
            (err, result) => (err ? reject(err) : resolve(result))
          ).end(qrBuffer);
        });

      const qrUploaded = await uploadQR();

      await runQuery("UPDATE employees SET qr_code = $1 WHERE id = $2", [
        qrUploaded.secure_url,
        employeeId
      ]);

      res.json({
        success: true,
        message: "Empleado creado correctamente",
        employee_id: employeeId,
        qr_url: qrUploaded.secure_url
      });
    } catch (error) {
      console.error("❌ Error creando empleado:", error);
      res.status(500).json({ success: false, error: "Error creando empleado" });
    }
  }
);

/* ==================================================
   UPDATE EMPLOYEE + REGENERAR QR
================================================== */
router.put(
  "/:id",
  authenticateToken,
  requireAdminOrScanner,
  upload.single("photo"),
  async (req, res) => {
    try {
      const employeeId = req.params.id;
      const { dni, name, type, monthly_salary, remove_photo } = req.body;

      const existing = await getQuery(
        "SELECT dni, photo FROM employees WHERE id = $1 AND is_active = TRUE",
        [employeeId]
      );

      if (!existing) {
        return res.status(404).json({ success: false, error: "Empleado no encontrado" });
      }

      let updatedPhoto = existing.photo;

      if (req.file?.path) {
        updatedPhoto = req.file.path;
      }

      if (remove_photo === "true" && existing.photo) {
        try {
          const publicId = existing.photo.split("/").slice(-1)[0].split(".")[0];
          await cloudinary.uploader.destroy(`attendance-photos/${publicId}`);
        } catch {}
        updatedPhoto = null;
      }

      await runQuery(
        `UPDATE employees SET dni=$1, name=$2, type=$3, monthly_salary=$4, photo=$5 WHERE id=$6`,
        [dni, name, type, monthly_salary || 0, updatedPhoto, employeeId]
      );

      /* ==================================================
         REGENERAR QR SOLO SI CAMBIÓ EL DNI
      ================================================== */
      if (dni !== existing.dni) {
        const qrBuffer = await QRCode.toBuffer(employeeId.toString(), {
          width: 600,
          margin: 2,
          errorCorrectionLevel: "H"
        });

        const uploadedQR = await new Promise((resolve, reject) => {
          cloudinary.uploader.upload_stream(
            { folder: "attendance-qrs", format: "png", resource_type: "image" },
            (err, result) => (err ? reject(err) : resolve(result))
          ).end(qrBuffer);
        });

        await runQuery(
          "UPDATE employees SET qr_code = $1 WHERE id = $2",
          [uploadedQR.secure_url, employeeId]
        );
      }

      res.json({ success: true, message: "Empleado actualizado correctamente" });
    } catch (error) {
      console.error("❌ Error actualizando empleado:", error);
      res.status(500).json({ success: false, error: "Error actualizando empleado" });
    }
  }
);

/* ==================================================
   SOFT DELETE
================================================== */
router.delete("/:id", authenticateToken, requireAdminOrScanner, async (req, res) => {
  try {
    await runQuery("UPDATE employees SET is_active = FALSE WHERE id = $1", [
      req.params.id
    ]);

    res.json({ success: true, message: "Empleado eliminado correctamente" });
  } catch (error) {
    console.error("❌ Error eliminando empleado:", error);
    res.status(500).json({ success: false, error: "Error eliminando empleado" });
  }
});

/* ==================================================
   STATS POR EMPLEADO
================================================== */
router.get('/:id/stats', async (req, res) => {
  try {
    const employeeId = req.params.id;
    const { type, monthly_salary } = await getQuery(
      "SELECT type, monthly_salary FROM employees WHERE id = $1 AND is_active = TRUE",
      [employeeId]
    );

    const year = new Date().getFullYear();
    const month = new Date().getMonth() + 1;

    if (type === "Producción") {
      const stats = await getQuery(
        `
        SELECT
          COUNT(*) days_worked,
          SUM(despalillo) despalillo,
          SUM(escogida) escogida,
          SUM(monado) monado
        FROM attendance
        WHERE employee_id = $1
        AND EXTRACT(YEAR FROM date) = $2
        AND EXTRACT(MONTH FROM date) = $3
        AND exit_time IS NOT NULL
        `,
        [employeeId, year, month]
      );

      const total_despalillo = Number(stats.despalillo) * 80;
      const total_escogida = Number(stats.escogida) * 70;
      const total_monado = Number(stats.monado) * 1;

      const production_total = total_despalillo + total_escogida + total_monado;

      const saturday_bonus = Number((production_total * 0.090909).toFixed(2));
      const seventh_day = Number((production_total * 0.181818).toFixed(2));
      const neto_pagar = Number((production_total + saturday_bonus + seventh_day).toFixed(2));

      return res.json({
        success: true,
        data: {
          type: "produccion",
          dias_trabajados: Number(stats.days_worked),

          despalillo: Number(stats.despalillo),
          escogida: Number(stats.escogida),
          monado: Number(stats.monado),

          total_despalillo,
          total_escogida,
          total_monado,

          saturday_bonus,
          seventh_day,
          neto_pagar
        }
      });
    }

    // AL DÍA
    const stats = await getQuery(
      `
      SELECT 
        COUNT(*) days_worked,
        SUM(hours_extra) hours_extra
      FROM attendance
      WHERE employee_id = $1
      AND EXTRACT(YEAR FROM date) = $2
      AND EXTRACT(MONTH FROM date) = $3
      AND exit_time IS NOT NULL
      `,
      [employeeId, year, month]
    );

    const dias = Number(stats.days_worked);
    const hours = Number(stats.hours_extra);

    const daily = monthly_salary / 30;
    const hourValue = daily / 8;
    const overtimeValue = hourValue * 1.25;

    const he_dinero = Number((overtimeValue * hours).toFixed(2));
    const seventh_day = dias >= 5 ? Number(daily.toFixed(2)) : 0;
    const neto_pagar = Number((dias * daily + he_dinero + seventh_day).toFixed(2));

    return res.json({
      success: true,
      data: {
        type: "al dia",
        dias_trabajados: dias,
        hours_extra: hours,
        he_dinero,
        daily_salary: daily,
        seventh_day,
        neto_pagar
      }
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: "Error obteniendo stats" });
  }
});






module.exports = router;
