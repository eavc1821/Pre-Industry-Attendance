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
router.get('/:id/stats', authenticateToken, async (req, res) => {
  try {
    const employeeId = req.params.id;

    const employee = await getQuery(
      `SELECT id, name, type, monthly_salary
       FROM employees 
       WHERE id = $1 AND is_active = TRUE`,
      [employeeId]
    );

    if (!employee) {
      return res.status(404).json({ success: false, error: "Empleado no encontrado" });
    }

    const year = new Date().getFullYear();
    const month = new Date().getMonth() + 1;

    /* ======================================================
       EMPLEADOS DE PRODUCCIÓN
    ====================================================== */
    if (employee.type === "Producción") {

      const stats = await getQuery(
        `
        SELECT 
          COUNT(*) AS days_worked,
          COALESCE(SUM(despalillo), 0) AS sum_despalillo,
          COALESCE(SUM(escogida), 0) AS sum_escogida,
          COALESCE(SUM(monado), 0) AS sum_monado
        FROM attendance
        WHERE employee_id = $1
        AND EXTRACT(YEAR FROM date) = $2
        AND EXTRACT(MONTH FROM date) = $3
        AND exit_time IS NOT NULL
        `,
        [employeeId, year, month]
      );

      const daysWorked = Number(stats.days_worked) || 0;

      const totalDes = Number(stats.sum_despalillo) * 80;
      const totalEsc = Number(stats.sum_escogida) * 70;
      const totalMon = Number(stats.sum_monado) * 1;

      const totalProdMoney = totalDes + totalEsc + totalMon;

      const saturdayBonus = Number((totalProdMoney * 0.090909).toFixed(2));
      const seventhDay = Number((totalProdMoney * 0.181818).toFixed(2));

      const netPay = Number((totalProdMoney + saturdayBonus + seventhDay).toFixed(2));

      return res.json({
        success: true,
        data: {
          type: "produccion",

          // Producción mensual
          despalillo: Number(stats.sum_despalillo),
          escogida: Number(stats.sum_escogida),
          monado: Number(stats.sum_monado),

          // Totales monetarios
          total_despalillo: totalDes,
          total_escogida: totalEsc,
          total_monado: totalMon,

          saturday_bonus: saturdayBonus,
          seventh_day: seventhDay,

          dias_trabajados: daysWorked,
          neto_pagar: netPay
        }
      });
    }

    /* ======================================================
       EMPLEADOS AL DÍA
    ====================================================== */
    const stats = await getQuery(
      `
      SELECT 
        COUNT(*) AS days_worked,
        COALESCE(SUM(hours_extra), 0) AS hours_extra
      FROM attendance
      WHERE employee_id = $1
      AND EXTRACT(YEAR FROM date) = $2
      AND EXTRACT(MONTH FROM date) = $3
      AND exit_time IS NOT NULL
      `,
      [employeeId, year, month]
    );

    const daysWorked = Number(stats.days_worked) || 0;
    const hoursExtra = Number(stats.hours_extra) || 0;

    const monthlySalary = Number(employee.monthly_salary);
    const dailySalary = monthlySalary / 30;

    const hourValue = dailySalary / 8;
    const overtimeValue = hourValue * 1.25;
    const overtimeMoney = Number((overtimeValue * hoursExtra).toFixed(2));

    const seventhDay = daysWorked >= 5 ? Number(dailySalary.toFixed(2)) : 0;

    const netPay = Number(
      (dailySalary * daysWorked + overtimeMoney + seventhDay).toFixed(2)
    );

    return res.json({
      success: true,
      data: {
        type: "al dia",

        dias_trabajados: daysWorked,

        daily_salary: Number(dailySalary.toFixed(2)),
        hours_extra: hoursExtra,
        he_dinero: overtimeMoney,
        seventh_day: seventhDay,

        neto_pagar: netPay
      }
    });

  } catch (error) {
    console.error("❌ Error obteniendo stats:", error);
    res.status(500).json({ success: false, error: "Error obteniendo estadísticas" });
  }
});





module.exports = router;
