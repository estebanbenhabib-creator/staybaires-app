// Items manuales de una liquidacion (los carga el admin): viaticos extra,
// reembolsos de supermercado / articulos de limpieza, plus por suciedad, etc.
//   { id, employeeId, date, concepto, monto }
//
// GET    /api/pay-items                 -> lista completa
// POST   /api/pay-items                 -> agrega uno  body: { employeeId, date, concepto, monto }
// DELETE /api/pay-items                 -> borra uno   body: { id }

const { getJSON, setJSON } = require("../lib/store");

function nuevaId() {
  return "item_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function json(code, obj) {
  return { statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    return json(200, await getJSON("pay-items", []));
  }

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "JSON invalido" });
    }
    if (!body.employeeId || !body.date || !body.concepto || body.monto == null) {
      return json(400, { error: "Faltan employeeId, date, concepto o monto" });
    }
    const item = {
      id: nuevaId(),
      employeeId: body.employeeId,
      date: body.date,
      concepto: String(body.concepto),
      monto: Number(body.monto) || 0,
    };
    const list = await getJSON("pay-items", []);
    list.push(item);
    await setJSON("pay-items", list);
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
    const list = await getJSON("pay-items", []);
    await setJSON("pay-items", list.filter((it) => it.id !== body.id));
    return json(200, { ok: true });
  }

  return { statusCode: 405, body: "Method not allowed" };
};
