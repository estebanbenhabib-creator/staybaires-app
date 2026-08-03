// Ingresos extra por extension de estadia cobrada por fuera de las plataformas
// (no aparecen en los reportes de Airbnb/Booking). Se cargan desde "Cambiar
// dia" en el calendario y se suman a Ingresos como ganancia 100% de Esteban.
//
// GET    /api/ingresos-extra   -> lista de extras
// POST   /api/ingresos-extra   -> agrega uno. body: { codigo, fecha, montoUsd, taskId?, nota? }
// DELETE /api/ingresos-extra   -> borra uno. body: { id }

const { getJSON, setJSON } = require("../lib/store");

function json(code, obj) {
  return { statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
function nuevaId() {
  return "ext_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    return json(200, await getJSON("ingresos-extra", []));
  }

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "JSON invalido" });
    }
    const monto = Number(body.montoUsd) || 0;
    if (!body.codigo || !body.fecha || !monto) {
      return json(400, { error: "Faltan codigo, fecha o montoUsd" });
    }
    const list = await getJSON("ingresos-extra", []);
    const item = {
      id: nuevaId(),
      codigo: body.codigo,
      fecha: body.fecha,
      montoUsd: monto,
      taskId: body.taskId || null,
      nota: body.nota || null,
      creado: new Date().toISOString(),
    };
    list.push(item);
    await setJSON("ingresos-extra", list);
    return json(200, { ok: true, item });
  }

  if (event.httpMethod === "DELETE") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "JSON invalido" });
    }
    if (!body.id) return json(400, { error: "Falta id" });
    const list = await getJSON("ingresos-extra", []);
    await setJSON("ingresos-extra", list.filter((x) => x.id !== body.id));
    return json(200, { ok: true });
  }

  return { statusCode: 405, body: "Method not allowed" };
};
