// Liquidacion de pago a las colaboradoras. Se calcula sobre las tareas
// MARCADAS COMO HECHAS en un rango de fechas, y para cada colaboradora suma:
//   viatico fijo por dia: dias trabajados x monto por dia (Susana $10.000,
//     el resto $5.000 por defecto; editable por colaboradora en Ajustes)
//   + valor por depto: por cada limpieza hecha, el valor del depto (Ajustes)
//   + plus domingo: dias trabajados que caen domingo x plusDomingo (Ajustes)
//   + plus feriado: dias trabajados marcados feriado x plusFeriado (Ajustes)
//   + items manuales: reembolsos de super/articulos, plus suciedad, etc., que
//     carga el admin (concepto + monto).
// No hay "base por dia" aparte: el pago fijo por dia ES el viatico.
//
// Los montos (viatico por dia, valor por depto, plus, feriados, telefonos)
// viven en el blob "pay-config"; los items en "pay-items". Un "dia trabajado"
// es una fecha unica con al menos una tarea hecha.

const DEFAULT_CONFIG = { viaticoDia: {}, plusDomingo: 0, plusFeriado: 0, feriados: [], valorDepto: {}, telefonos: {} };

function esDomingo(iso) {
  return new Date(iso + "T00:00:00").getDay() === 0;
}

function computeLiquidacion(tasks, employees, config, items, from, to) {
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) };
  const feriados = new Set(cfg.feriados || []);
  const inRange = (d) => (!from || d >= from) && (!to || d <= to);
  const results = [];

  for (const emp of employees) {
    if (emp.rol !== "empleada") continue;

    // Tareas de limpieza (checkout o manual) hechas por esta colaboradora en el rango.
    const suyas = tasks.filter((t) => t.assignedTo === emp.id && t.status === "hecha" && t.type !== "checkin" && inRange(t.date));
    const dias = Array.from(new Set(suyas.map((t) => t.date))).sort();

    const deptosDetalle = suyas.map((t) => ({
      nombre: t.propertyName,
      direccion: t.direccion,
      date: t.date,
      monto: (cfg.valorDepto && cfg.valorDepto[t.propertyCode]) || 0,
    }));
    const valorDeptos = deptosDetalle.reduce((s, d) => s + d.monto, 0);

    // Viatico fijo por dia: usa el monto de Ajustes si esta cargado, si no cae
    // al tarifaPorDia de la persona (Susana 10.000, el resto 5.000).
    const viaticoDia = cfg.viaticoDia && cfg.viaticoDia[emp.id] != null ? Number(cfg.viaticoDia[emp.id]) : emp.tarifaPorDia || 0;
    const viatico = dias.length * viaticoDia;

    const domingos = dias.filter(esDomingo);
    const plusDomingo = domingos.length * (cfg.plusDomingo || 0);
    const feriadosTrab = dias.filter((d) => feriados.has(d));
    const plusFeriado = feriadosTrab.length * (cfg.plusFeriado || 0);

    const misItems = (items || []).filter((it) => it.employeeId === emp.id && inRange(it.date));
    const itemsTotal = misItems.reduce((s, it) => s + (Number(it.monto) || 0), 0);

    const total = viatico + valorDeptos + plusDomingo + plusFeriado + itemsTotal;

    results.push({
      employeeId: emp.id,
      nombre: emp.nombre,
      dias,
      totalDias: dias.length,
      cantDeptos: suyas.length,
      deptosDetalle,
      valorDeptos,
      viaticoDia,
      viatico,
      domingos: domingos.length,
      plusDomingo,
      feriados: feriadosTrab.length,
      plusFeriado,
      items: misItems,
      itemsTotal,
      total,
    });
  }
  return results;
}

module.exports = { computeLiquidacion, DEFAULT_CONFIG };
