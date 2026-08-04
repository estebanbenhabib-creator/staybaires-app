// Gasto mensual de lavandería (pagos a Luján), en ARS. Es un costo operativo
// que se resta del neto en el módulo Ingresos (como el viático). No viene de
// las plataformas ni de los pagos a las chicas: lo carga el admin por mes.
//
// GET  /api/ingresos-lavanderia  -> { [periodo]: montoArs }
// POST /api/ingresos-lavanderia  -> guarda un mes. body: { periodo, montoArs }

const { getJSON, setJSON } = require("../lib/store");

function json(code, obj) {
  return { statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    return json(200, await getJSON("gastos-lavanderia", {}));
  }

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "JSON invalido" });
    }
    if (!body.periodo) return json(400, { error: "Falta periodo" });
    const all = await getJSON("gastos-lavanderia", {});
    all[body.periodo] = Number(body.montoArs) || 0;
    await setJSON("gastos-lavanderia", all);
    return json(200, { ok: true, periodo: body.periodo, montoArs: all[body.periodo] });
  }

  return { statusCode: 405, body: "Method not allowed" };
};
