const express = require("express");
const router = express.Router();
const { getQuery, runQuery } = require("../config/database");
const { authenticateToken, requireAdmin } = require("../middleware/auth");



/* ============================================================
   📌 ENDPOINT: REPORTE DIARIO
   Devuelve TODOS los empleados que tuvieron asistencia ese día
============================================================ */
router.get("/daily", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        error: "Debe enviar ?date=YYYY-MM-DD"
      });
    }

    const rows = await getQuery(
      `
      SELECT
        a.id,
        a.employee_id,
        e.name AS employee_name,
        e.type AS employee_type,
        e.monthly_salary,
        a.entry_time,
        a.exit_time,
        a.hours_extra,
        a.t_despalillo,
        a.t_escogida,
        a.t_monado,
        a.prop_sabado,
        a.septimo_dia,
        a.dias_trabajados,
        a.sabado,
        a.date
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.date = $1
      ORDER BY e.name ASC
      `,
      [date]
    );

    if (!rows || rows.length === 0) {
      return res.json({
        success: true,
        message: "No hay registros para la fecha solicitada.",
        data: []
      });
    }

    const processed = rows.map((row) => {
      // Función rápida Number segura:
      const N = (v) => Number(v) || 0;

      // ---------------------------------------------
      // 🔵 EMPLEADOS AL DÍA
      // ---------------------------------------------
      if (row.employee_type === "Al Dia") {
        const salarioDiario = N(row.monthly_salary) / 30;
        const valorHora = salarioDiario / 8;
        const valorExtra = valorHora * 1.25;

        const he = N(row.hours_extra);
        const dineroHE = he * valorExtra;

        const sab = N(row.sabado);
        const sept = N(row.septimo_dia);
        const dias = N(row.dias_trabajados);

        const neto =
          dias * salarioDiario +
          dineroHE +
          sab +
          sept;

        return {
          ...row,
          tipo: "Al Día",
          salario_diario: Number(salarioDiario.toFixed(2)),
          horas_extra_dinero: Number(dineroHE.toFixed(2)),
          neto_pagar: Number(neto.toFixed(2)),
        };
      }

      // ---------------------------------------------
      // 🟢 EMPLEADOS PRODUCCIÓN
      // ---------------------------------------------
      if (row.employee_type === "Producción") {
        const tDesp = N(row.t_despalillo);
        const tEsco = N(row.t_escogida);
        const tMona = N(row.t_monado);
        const sept = N(row.septimo_dia);

        const totalProd = tDesp + tEsco + tMona;
        const propSabado = totalProd * 0.090909;

        const neto = totalProd + propSabado + sept;

        return {
          ...row,
          tipo: "Producción",
          total_produccion: Number(totalProd.toFixed(2)),
          prop_sabado: Number(propSabado.toFixed(2)),
          neto_pagar: Number(neto.toFixed(2)),
        };
      }

      return row;
    });

    res.json({
      success: true,
      data: processed
    });

  } catch (error) {
    console.error("❌ Error generando reporte diario:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});


/* ============================================================
   🛠 FUNCIONES AUXILIARES PARA CONVERSIÓN SEGURA
============================================================ */
const N = (v) => Number(v) || 0;

/* ============================================================
   📌 ENDPOINT: REPORTE SEMANAL
============================================================ */
router.get("/weekly", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({
        success: false,
        error: "Debe enviar 'start' y 'end' para generar el reporte."
      });
    }

    // 🔍 Obtener todos los registros del rango solicitado
    const rows = await getQuery(
      `
      SELECT 
        a.id,
        a.employee_id,
        e.name AS employee_name,
        e.type AS employee_type,
        e.monthly_salary,
        a.date,
        a.hours_extra,
        a.t_despalillo,
        a.t_escogida,
        a.t_monado,
        a.prop_sabado,
        a.septimo_dia,
        a.dias_trabajados,
        a.sabado
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.date BETWEEN $1 AND $2
      ORDER BY e.name ASC, a.date ASC
      `,
      [start, end]
    );

    if (!rows || rows.length === 0) {
      return res.json({
        success: true,
        message: "No hay datos en este rango.",
        data: []
      });
    }

    /* ============================================================
       🧮 PROCESAMIENTO DEL REPORTE
    ============================================================ */
    const processed = rows.map((row) => {
      /* ---------------------------------------------
         🔵 PROCESAR EMPLEADOS "AL DÍA"
      --------------------------------------------- */
      if (row.employee_type === "Al Dia") {
        const salarioMensual = N(row.monthly_salary);
        const salarioDiario = salarioMensual / 30;

        const dias = N(row.dias_trabajados);
        const he = N(row.hours_extra);

        const sabado = N(row.sabado);
        const septimo = N(row.septimo_dia);

        const valorHora = salarioDiario / 8;
        const valorHoraExtra = valorHora * 1.25;

        const dineroHE = he * valorHoraExtra;

        const neto =
          dias * salarioDiario +
          dineroHE +
          sabado +
          septimo;

        return {
          ...row,
          dias_trabajados: dias,
          hours_extra: he,
          he_dinero: Number(dineroHE.toFixed(2)),
          salario_diario: Number(salarioDiario.toFixed(2)),
          salario_mensual: salarioMensual,
          sabado,
          septimo_dia: septimo,
          neto_pagar: Number((neto || 0).toFixed(2)),
        };
      }

      /* ---------------------------------------------
         🟢 PROCESAR EMPLEADOS DE "PRODUCCIÓN"
      --------------------------------------------- */
      if (row.employee_type === "Producción") {
        const tDesp = N(row.t_despalillo);
        const tEsco = N(row.t_escogida);
        const tMona = N(row.t_monado);
        const sept = N(row.septimo_dia);

        const totalProd = tDesp + tEsco + tMona;

        const propSabado = totalProd * 0.090909;

        const neto = totalProd + propSabado + sept;

        return {
          ...row,
          t_despalillo: tDesp,
          t_escogida: tEsco,
          t_monado: tMona,
          prop_sabado: Number(propSabado.toFixed(2)),
          septimo_dia: sept,
          total_produccion: Number(totalProd.toFixed(2)),
          neto_pagar: Number((neto || 0).toFixed(2)),
        };
      }

      return row;
    });

    /* ============================================================
       📤 RESPUESTA FINAL
    ============================================================ */
    res.json({
      success: true,
      data: processed,
    });

  } catch (error) {
    console.error("❌ Error generando reporte semanal:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* ============================================================
   📌 ENDPOINT: REPORTE MENSUAL
============================================================ */
router.get("/monthly", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(400).json({
        success: false,
        error: "Debe enviar 'year' y 'month'."
      });
    }

    const start = `${year}-${month}-01`;
    const end = `${year}-${month}-31`;

    const rows = await getQuery(
      `
      SELECT 
        a.*,
        e.name AS employee_name,
        e.type AS employee_type,
        e.monthly_salary
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.date BETWEEN $1 AND $2
      ORDER BY e.name ASC, a.date ASC
      `,
      [start, end]
    );

    res.json({
      success: true,
      data: rows
    });

  } catch (error) {
    console.error("❌ Error generando reporte mensual:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
