// Insumos = lista de faltantes por departamento (lista de compras). No hay
// deposito central: cuando algo se acaba en un depto, alguien (las chicas o
// Esteban) lo marca como faltante; cuando se compra, se saca de la lista.
//
// GET    /api/insumos   -> lista de faltantes pendientes
// POST   /api/insumos   -> marca faltante(s). Acepta uno solo
//        { propertyCode, insumo, categoria } o varios de una
//        { propertyCode, insumos: [{ insumo, categoria }], notes? }
// DELETE /api/insumos   -> saca un faltante (ya comprado)  body: { id }

const properties = require("../../data/properties.json");
const { getJSON, setJSON } = require("../lib/store");

function nuevaId() {
  return "flt_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function json(code, obj) {
  return { statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    return json(200, await getJSON("insumos-faltantes", []));
  }

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "JSON invalido" });
    }
    // Acepta uno solo (insumo/categoria) o varios (insumos: [{insumo,categoria}]).
    const entradas = Array.isArray(body.insumos) ? body.insumos : [{ insumo: body.insumo, categoria: body.categoria }];
    const validas = entradas.filter((e) => e && e.insumo);
    if (!body.propertyCode || validas.length === 0) {
      return json(400, { error: "Faltan propertyCode o insumo(s)" });
    }
    const prop = properties.find((p) => p.codigo === body.propertyCode);
    const fecha = new Date().toISOString().slice(0, 10);
    const nuevos = validas.map((e) => ({
      id: nuevaId(),
      propertyCode: body.propertyCode,
      propertyName: prop ? prop.nombre : body.propertyName || "",
      direccion: prop ? prop.direccion || "" : "",
      insumo: e.insumo,
      categoria: e.categoria || "",
      notes: body.notes || null,
      fecha,
    }));
    const list = await getJSON("insumos-faltantes", []);
    list.push(...nuevos);
    await setJSON("insumos-faltantes", list);
    return json(200, { ok: true, items: nuevos });
  }

  if (event.httpMethod === "DELETE") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "JSON invalido" });
    }
    if (!body.id) return json(400, { error: "Falta id" });
    const list = await getJSON("insumos-faltantes", []);
    await setJSON("insumos-faltantes", list.filter((i) => i.id !== body.id));
    return json(200, { ok: true });
  }

  return { statusCode: 405, body: "Method not allowed" };
};
