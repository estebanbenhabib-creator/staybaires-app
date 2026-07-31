// Ingresos netos por departamento. Cada "import" es un mes procesado en el
// cliente (lee los CSV/XLS de Airbnb y Booking con SheetJS y aplica las
// formulas de ingresos-engine.js). Aca solo se persiste el resultado.
//
// GET    /api/ingresos           -> { [periodo]: payload }  (todos los meses)
// POST   /api/ingresos           -> guarda un mes. body: { periodo, payload }
// DELETE /api/ingresos           -> borra un mes. body: { periodo }

const { getJSON, setJSON } = require("../lib/store");

function json(code, obj) {
  return { statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    return json(200, await getJSON("ingresos", {}));
  }

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "JSON invalido" });
    }
    if (!body.periodo || !body.payload) {
      return json(400, { error: "Faltan periodo o payload" });
    }
    const all = await getJSON("ingresos", {});
    all[body.periodo] = { ...body.payload, periodo: body.periodo, guardadoEn: new Date().toISOString() };
    await setJSON("ingresos", all);
    return json(200, { ok: true, periodo: body.periodo });
  }

  if (event.httpMethod === "DELETE") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "JSON invalido" });
    }
    if (!body.periodo) return json(400, { error: "Falta periodo" });
    const all = await getJSON("ingresos", {});
    delete all[body.periodo];
    await setJSON("ingresos", all);
    return json(200, { ok: true });
  }

  return { statusCode: 405, body: "Method not allowed" };
};
