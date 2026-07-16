// GET  /.netlify/functions/insumos           -> lista de stock actual
// POST /.netlify/functions/insumos           -> agrega o actualiza un item
//      body: { id, producto, categoria, ubicacion, stockActual, stockMinimo }
// La primera vez que se pide, si no hay nada guardado, se siembra con
// data/insumos-inicial.json.

const seed = require("../../data/insumos-inicial.json");
const { getJSON, setJSON } = require("../lib/store");

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    let items = await getJSON("insumos", null);
    if (!items) {
      items = seed;
      await setJSON("insumos", items);
    }
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(items) };
  }

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: "JSON invalido" }) };
    }
    if (!body.id || !body.producto) {
      return { statusCode: 400, body: JSON.stringify({ error: "Falta id o producto" }) };
    }
    let items = await getJSON("insumos", seed);
    const idx = items.findIndex((i) => i.id === body.id);
    const item = {
      id: body.id,
      producto: body.producto,
      categoria: body.categoria || "limpieza",
      ubicacion: body.ubicacion || "",
      stockActual: Number(body.stockActual) || 0,
      stockMinimo: Number(body.stockMinimo) || 0,
    };
    if (idx >= 0) items[idx] = item;
    else items.push(item);
    await setJSON("insumos", items);
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, items }) };
  }

  return { statusCode: 405, body: "Method not allowed" };
};
