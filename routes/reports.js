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
      return res.status(400).json({
        success: false,
        error: "Debe enviar 'start' y 'end' en formato YYYY-MM-DD."
      });
    }

    const toNum = (v) => parseFloat(v) || 0;
    const round2 = (v) => Number(Number(v || 0).toFixed(2));

    // Traer todos los registros del rango (cada registro por día)
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
        a.exit_time
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
        data: {
          production: [],
          alDia: [],
          summary: {
            total_employees: 0,
            total_payroll: 0,
            total_production_employees: 0,
            total_aldia_employees: 0
          }
        }
      });
    }

    // Maps para acumular por empleado
    const prodMap = {};   // for production employees
    const alDiaMap = {};  // for al dia employees

    rows.forEach(row => {
      const empId = row.employee_id;
      const empType = (row.employee_type || "").trim().toLowerCase();

      // solo contamos el dia como trabajado si exit_time != null
      const workedToday = row.exit_time !== null && row.exit_time !== undefined;

      if (empType === "producción" || empType === "produccion") {
        // producción: sumar t_* y días trabajados y séptimo/proporcional
        if (!prodMap[empId]) {
          prodMap[empId] = {
            employee_id: empId,
            employee: row.employee,
            employee_type: row.employee_type,
            monthly_salary: toNum(row.monthly_salary),
            dias_trabajados: workedToday ? 1 : 0,
            total_despalillo: toNum(row.t_despalillo),
            total_escogida: toNum(row.t_escogida),
            total_monado: toNum(row.t_monado),
            prop_sabado: toNum(row.prop_sabado),
            septimo_dia: toNum(row.septimo_dia) // si viene por registro; después lo sumamos
          };
        } else {
          prodMap[empId].dias_trabajados += workedToday ? 1 : 0;
          prodMap[empId].total_despalillo += toNum(row.t_despalillo);
          prodMap[empId].total_escogida += toNum(row.t_escogida);
          prodMap[empId].total_monado += toNum(row.t_monado);
          prodMap[empId].prop_sabado += toNum(row.prop_sabado);
          prodMap[empId].septimo_dia += toNum(row.septimo_dia);
        }
      } else {
        // Al Día: acumular dias, sumar hours_extra acumuladas
        if (!alDiaMap[empId]) {
          alDiaMap[empId] = {
            employee_id: empId,
            employee: row.employee,
            employee_type: row.employee_type,
            monthly_salary: toNum(row.monthly_salary),
            dias_trabajados: workedToday ? 1 : 0,
            total_hours_extra: toNum(row.hours_extra || 0)
          };
        } else {
          alDiaMap[empId].dias_trabajados += workedToday ? 1 : 0;
          alDiaMap[empId].total_hours_extra += toNum(row.hours_extra || 0);
        }
      }
    });

    // Convertir producción a array y calcular netos (redondear)
    const groupedProduction = Object.values(prodMap).map(emp => {
      const tDesp = emp.total_despalillo;
      const tEsco = emp.total_escogida;
      const tMona = emp.total_monado;
      const propSab = emp.prop_sabado;
      const septos = emp.septimo_dia;

      const totalProduccion = tDesp + tEsco + tMona;
      const neto = totalProduccion + propSab + septos;

      return {
        ...emp,
        total_produccion: round2(totalProduccion),
        total_despalillo: round2(tDesp),
        total_escogida: round2(tEsco),
        total_monado: round2(tMona),
        prop_sabado: round2(propSab),
        septimo_dia: round2(septos),
        neto_pagar: round2(neto)
      };
    });

    // Convertir alDia a array y aplicar la fórmula unificada
    const groupedAlDia = Object.values(alDiaMap).map(emp => {
      const salarioMensual = emp.monthly_salary || 0;
      const salarioDiario = salarioMensual / 30;
      const dias = emp.dias_trabajados || 0;

      // sueldo base = dias_trabajados * salario_diario
      const sueldoBase = dias * salarioDiario;

      // horas extras acumuladas -> valor por hora y dinero total
      const valorHoraNormal = salarioDiario / 8;
      const valorHE = valorHoraNormal * 1.25;
      const horasExtraTotal = emp.total_hours_extra || 0;
      const horas_extra_dinero = horasExtraTotal * valorHE;

      // séptimo día: se aplica si trabajó >= 5 días en el rango
      const septimo_dia = dias >= 5 ? salarioDiario : 0;

      const neto = sueldoBase + horas_extra_dinero + septimo_dia;

      return {
        ...emp,
        salario_diario: round2(salarioDiario),
        sueldo_base: round2(sueldoBase),
        horas_extra: round2(horasExtraTotal),
        horas_extra_dinero: round2(horas_extra_dinero),
        septimo_dia: round2(septimo_dia),
        neto_pagar: round2(neto)
      };
    });

    // Resumen global (redondeado)
    const total_payroll = round2(
      [...groupedProduction, ...groupedAlDia].reduce((s, e) => s + toNum(e.neto_pagar), 0)
    );

    const summary = {
      total_employees: groupedProduction.length + groupedAlDia.length,
      total_payroll,
      total_production_employees: groupedProduction.length,
      total_aldia_employees: groupedAlDia.length,
      total_production_payroll: round2(groupedProduction.reduce((s,e)=>s + toNum(e.neto_pagar),0)),
      total_aldia_payroll: round2(groupedAlDia.reduce((s,e)=>s + toNum(e.neto_pagar),0))
    };

    return res.json({
      success: true,
      data: {
        production: groupedProduction,
        alDia: groupedAlDia,
        summary
      }
    });

  } catch (error) {
    console.error("❌ Error generando reporte semanal:", error);
    res.status(500).json({ success: false, error: error.message });
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
