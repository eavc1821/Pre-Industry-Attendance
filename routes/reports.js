const express = require("express");
const router = express.Router();
const { getQuery, allQuery } = require("../config/database");
const { authenticateToken, requireSuperAdmin } = require("../middleware/auth");

/* ============================================================
   Función para convertir valores numéricos de forma segura
============================================================ */
const N = (v) => Number(v) || 0;

/* ============================================================
   📌 REPORTE SEMANAL — SOLO SUPER ADMIN
============================================================ */
router.get("/weekly", authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ success: false, error: "Debe enviar start y end en formato YYYY-MM-DD." });
    }

    const toNum = (v) => parseFloat(v) || 0;
    const round2 = (v) => Number(Number(v || 0).toFixed(2));

    /* ============================================================
       TRAER REGISTROS CON exit_time (requerido para calcular días)
    ============================================================ */
    const rows = await allQuery(
      `
      SELECT 
        a.id,
        a.employee_id,
        e.name AS employee,
        e.type AS employee_type,
        e.monthly_salary,
        a.date,
        a.hours_extra,
        a.t_despalillo,
        a.t_escogida,
        a.t_monado,
        a.prop_sabado,
        a.septimo_dia,
        a.exit_time   -- <<<< OBLIGATORIO PARA CALCULAR DIAS CORRECTOS
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.date >= $1 AND a.date <= $2
      ORDER BY e.name ASC, a.date ASC
      `,
      [start, end]
    );

    if (!rows.length) {
      return res.json({
        success: true,
        data: { production: [], alDia: [], summary: {
          total_employees:0,
          total_payroll:0,
          total_production_employees:0,
          total_aldia_employees:0
        }}
      });
    }

    const prodMap = {};
    const alDiaMap = {};

    /* ============================================================
       AGRUPAR REGISTROS POR EMPLEADO
    ============================================================ */
    rows.forEach(row => {
      const empId = row.employee_id;
      const empType = (row.employee_type || "").trim().toLowerCase();

      // Día trabajado = exit_time registrado
      const workedToday = row.exit_time !== null && row.exit_time !== undefined;

      if (empType === "producción" || empType === "produccion") {
        // ==== PRODUCCIÓN ====
        if (!prodMap[empId]) {
          prodMap[empId] = {
            employee_id: empId,
            employee: row.employee,
            monthly_salary: row.monthly_salary,
            dias_trabajados: workedToday ? 1 : 0,
            total_despalillo: toNum(row.t_despalillo),
            total_escogida: toNum(row.t_escogida),
            total_monado: toNum(row.t_monado),
            prop_sabado: toNum(row.prop_sabado),
            septimo_dia: toNum(row.septimo_dia)
          };
        } else {
          prodMap[empId].dias_trabajados += workedToday ? 1 : 0;
          prodMap[empId].total_despalillo += toNum(row.t_despalillo);
          prodMap[empId].total_escogida += toNum(row.t_escogida);
          prodMap[empId].total_monado += toNum(row.t_monado);
          prodMap[empId].prop_sabado += toNum(row.prop_sabado);
          prodMap[empId].septimo_dia += toNum(row.septimo_dia);
        }
      } 
      else {
        // ==== AL DÍA ====
        if (!alDiaMap[empId]) {
          alDiaMap[empId] = {
            employee_id: empId,
            employee: row.employee,
            monthly_salary: toNum(row.monthly_salary),
            dias_trabajados: workedToday ? 1 : 0,
            total_hours_extra: toNum(row.hours_extra)
          };
        } else {
          alDiaMap[empId].dias_trabajados += workedToday ? 1 : 0;
          alDiaMap[empId].total_hours_extra += toNum(row.hours_extra);
        }
      }
    });

    /* ============================================================
       CALCULAR AL DÍA — FÓRMULA OFICIAL DE TU EMPRESA
    ============================================================ */
    const groupedAlDia = Object.values(alDiaMap).map(emp => {
      const salarioMensual = emp.monthly_salary;
      const salarioDiario  = salarioMensual / 30;
      const dias           = emp.dias_trabajados;
      const horasExtra     = emp.total_hours_extra;

      const valorHE = (salarioDiario / 8) * 1.25;
      const horas_extra_dinero = horasExtra * valorHE;

      // 7mo día solo si trabaja 5 o más
      const septimo_dia = dias >= 5 ? salarioDiario : 0;

      const sueldoBase = dias * salarioDiario;

      const neto = sueldoBase + horas_extra_dinero + septimo_dia;

      return {
        ...emp,
        salario_diario: round2(salarioDiario),
        horas_extra: horasExtra,
        horas_extra_dinero: round2(horas_extra_dinero),
        septimo_dia: round2(septimo_dia),
        dias_trabajados: dias,
        neto_pagar: round2(neto)
      };
    });

    /* ============================================================
       CALCULAR PRODUCCIÓN
    ============================================================ */
    const groupedProduction = Object.values(prodMap).map(emp => {
      const totalProd = emp.total_despalillo + emp.total_escogida + emp.total_monado;
      const neto = totalProd + emp.prop_sabado + emp.septimo_dia;

      return {
        ...emp,
        total_produccion: round2(totalProd),
        neto_pagar: round2(neto)
      };
    });

    /* ============================================================
       RESUMEN GLOBAL
    ============================================================ */
    const summary = {
      total_employees: groupedProduction.length + groupedAlDia.length,
      total_production_employees: groupedProduction.length,
      total_aldia_employees: groupedAlDia.length,
      total_production_payroll: round2(groupedProduction.reduce((s,e)=>s + e.neto_pagar,0)),
      total_aldia_payroll: round2(groupedAlDia.reduce((s,e)=>s + e.neto_pagar,0))
    };

    summary.total_payroll = round2(summary.total_production_payroll + summary.total_aldia_payroll);

    return res.json({
      success: true,
      data: {
        production: groupedProduction,
        alDia: groupedAlDia,
        summary
      }
    });

  } catch (error) {
    console.error("❌ Error generando weekly:", error);
    return res.status(500).json({ success:false, error:error.message });
  }
});



/* ============================================================
   📌 REPORTE MENSUAL — SOLO SUPER ADMIN
============================================================ */
router.get("/monthly", authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(400).json({
        success: false,
        error: "Debe enviar year y month en formato válido."
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

    res.json({ success: true, data: rows });

  } catch (error) {
    console.error("❌ Error generando reporte mensual:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ============================================================
   📌 REPORTE DIARIO — SOLO SUPER ADMIN
============================================================ */
router.get("/daily", authenticateToken, requireSuperAdmin, async (req, res) => {
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
        a.date
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.date = $1
      ORDER BY e.name ASC
      `,
      [date]
    );

    const processed = rows.map(row => {

      if (row.employee_type === "Al Dia") {
        const salarioMensual = N(row.monthly_salary);
        const salarioDiario = salarioMensual / 30;

        const horasExtra = N(row.hours_extra);
        const valorHora = salarioDiario / 8;
        const valorHE = valorHora * 1.25;
        const dineroHE = horasExtra * valorHE;

        const neto = salarioDiario + dineroHE + N(row.septimo_dia);

        return {
          ...row,
          tipo: "Al Día",
          salario_diario: Number(salarioDiario.toFixed(2)),
          horas_extra_dinero: Number(dineroHE.toFixed(2)),
          neto_pagar: Number(neto.toFixed(2)),
        };
      }

      if (row.employee_type === "Producción") {
        const tDesp = N(row.t_despalillo);
        const tEsco = N(row.t_escogida);
        const tMona = N(row.t_monado);
        const propSabado = N(row.prop_sabado);
        const sept = N(row.septimo_dia);

        const totalProd = tDesp + tEsco + tMona;
        const neto = totalProd + propSabado + sept;

        return {
          ...row,
          tipo: "Producción",
          total_produccion: Number(totalProd.toFixed(2)),
          neto_pagar: Number(neto.toFixed(2)),
        };
      }

      return row;
    });

    res.json({ success: true, data: processed });

  } catch (error) {
    console.error("❌ Error generando reporte diario:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
