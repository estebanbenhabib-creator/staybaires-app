// Datos que se cierran POR MES en el módulo Ingresos: cotización (ARS por USD),
// viático + plus del mes (ARS) y lavandería del mes (ARS). Se guardan congelados
// por período para que el histórico sea correcto (cada mes con su tipo de cambio
// y sus costos), sin depender del estado actual del calendario.
//
// GET  /api/ingresos-mes   -> { [periodo]: { cotizacion, viatico, lavanderia } }
// POST /api/ingresos-mes   -> merge de un mes. body: { periodo, cotizacion?, viatico?, lavanderia? }

const { getJSON, setJSON } = require("../lib/store");

function json(code, obj) {
  return { statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    return json(200, await getJSON("ingresos-mes", {}));
  }

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "JSON invalido" });
    }
    if (!body.periodo) return json(400, { error: "Falta periodo" });
    const all = await getJSON("ingresos-mes", {});
    const prev = all[body.periodo] || {};
    all[body.periodo] = {
      cotizacion: body.cotizacion != null ? Number(body.cotizacion) || 0 : prev.cotizacion || 0,
      viatico: body.viatico != null ? Number(body.viatico) || 0 : prev.viatico || 0,
      lavanderia: body.lavanderia != null ? Number(body.lavanderia) || 0 : prev.lavanderia || 0,
    };
    await setJSON("ingresos-mes", all);
    return json(200, { ok: true, periodo: body.periodo, datos: all[body.periodo] });
  }

  return { statusCode: 405, body: "Method not allowed" };
};
