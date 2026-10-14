// Mantenimiento = trabajos (mano de obra, ej. Adrian) y gastos (compras: llaves,
// sábanas, toallas, lamparitas, etc.) por departamento. Montos en ARS.
//
// Cada ítem define quién paga:
//   - "esteban"     -> lo pagás vos y se lo reclamás al propietario (queda
//                      pendiente de cobro hasta marcar cobrado=true).
//   - "propietario" -> lo paga el dueño directo (no se reclama).
//
// GET    /api/mantenimiento   -> lista de ítems
// POST   /api/mantenimiento   -> crea (sin id) o actualiza (con id) un ítem
//        body: { id?, tipo:'trabajo'|'gasto', propertyCode, descripcion, monto,
//                persona?, paga:'esteban'|'propietario', cobrado?, fecha? }
// DELETE /api/mantenimiento   -> body { id }

const properties = require("../../data/properties.json");
const { getJSON, setJSON } = require("../lib/store");

const KEY = "mantenimiento-items";

function nuevaId() {
  return "mnt_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function json(code, obj) {
  return { statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    return json(200, await getJSON(KEY, []));
  }

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "JSON invalido" });
    }
    const list = await getJSON(KEY, []);

    // Actualizar uno existente
    if (body.id) {
      const idx = list.findIndex((i) => i.id === body.id);
      if (idx < 0) return json(404, { error: "No existe el ítem" });
      const { id, ...campos } = body;
      list[idx] = { ...list[idx], ...campos };
      await setJSON(KEY, list);
      return json(200, { ok: true, item: list[idx] });
    }

    // Crear uno nuevo
    if (!body.propertyCode || !body.descripcion || !(Number(body.monto) >= 0)) {
      return json(400, { error: "Faltan propertyCode, descripcion o monto" });
    }
    const prop = properties.find((p) => p.codigo === body.propertyCode);
    const tipo = body.tipo === "gasto" ? "gasto" : "trabajo";
    const nuevo = {
      id: nuevaId(),
      fecha: body.fecha || new Date().toISOString().slice(0, 10),
      tipo,
      propertyCode: body.propertyCode,
      propertyName: prop ? prop.nombre : body.propertyName || "",
      direccion: prop ? prop.direccion || "" : "",
      descripcion: String(body.descripcion).trim(),
      monto: Number(body.monto) || 0,
      persona: tipo === "trabajo" ? (body.persona || "Adrian") : null,
      paga: body.paga === "propietario" ? "propietario" : "esteban",
      cobrado: !!body.cobrado,
    };
    list.push(nuevo);
    await setJSON(KEY, list);
    return json(200, { ok: true, item: nuevo });
  }

  if (event.httpMethod === "DELETE") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "JSON invalido" });
    }
    if (!body.id) return json(400, { error: "Falta id" });
    const list = await getJSON(KEY, []);
    await setJSON(KEY, list.filter((i) => i.id !== body.id));
    return json(200, { ok: true });
  }

  return { statusCode: 405, body: "Method not allowed" };
};
