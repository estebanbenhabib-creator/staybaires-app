// GET  /.netlify/functions/lavanderia -> lista de pedidos de retiro/entrega
// POST /.netlify/functions/lavanderia -> crea o actualiza un pedido
//      body: { id?, tipo: 'retiro'|'entrega', propertyCode, propertyName, fecha, status? }

const { getJSON, setJSON } = require("../lib/store");

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    const pedidos = await getJSON("lavanderia-pedidos", []);
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(pedidos) };
  }

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: "JSON invalido" }) };
    }
    const pedidos = await getJSON("lavanderia-pedidos", []);

    if (body.id) {
      const idx = pedidos.findIndex((p) => p.id === body.id);
      if (idx >= 0) {
        pedidos[idx] = { ...pedidos[idx], ...body };
        await setJSON("lavanderia-pedidos", pedidos);
        return { statusCode: 200, body: JSON.stringify({ ok: true, pedido: pedidos[idx] }) };
      }
    }

    const nuevo = {
      id: body.id || `ped_${Date.now()}`,
      tipo: body.tipo || "retiro",
      propertyCode: body.propertyCode || null,
      propertyName: body.propertyName || "",
      fecha: body.fecha || new Date().toISOString().slice(0, 10),
      status: body.status || "pendiente",
    };
    pedidos.push(nuevo);
    await setJSON("lavanderia-pedidos", pedidos);
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, pedido: nuevo }) };
  }

  return { statusCode: 405, body: "Method not allowed" };
};
