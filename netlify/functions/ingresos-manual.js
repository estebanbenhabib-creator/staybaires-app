// Reservas cargadas a mano: las que NO vienen en los exports de Airbnb/Booking
// (ej. un listing que está en la cuenta de otro host pero cobra Esteban). Se
// guardan por mes y se suman al depto en el módulo Ingresos.
//   { id, periodo, codigo, inicio, fin, huesped, total, limpieza, comisionPct }
// Reparto (tercero): dueño = (total - limpieza) * (1 - comisionPct/100);
//                    vos   = total - dueño   (= limpieza + comisionPct% del resto)
//
// GET    /api/ingresos-manual   -> lista
// POST   /api/ingresos-manual   -> agrega una. body: { periodo, codigo, inicio, fin, huesped?, total, limpieza?, comisionPct? }
// DELETE /api/ingresos-manual   -> borra una. body: { id }

const { getJSON, setJSON } = require("../lib/store");

function json(code, obj) {
  return { statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
function nuevaId() {
  return "man_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    return json(200, await getJSON("ingresos-manual", []));
  }

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "JSON invalido" });
    }
    const total = Number(body.total) || 0;
    if (!body.periodo || !body.codigo || !total) {
      return json(400, { error: "Faltan periodo, codigo o total" });
    }
    const list = await getJSON("ingresos-manual", []);
    const item = {
      id: nuevaId(),
      periodo: body.periodo,
      codigo: body.codigo,
      inicio: body.inicio || "",
      fin: body.fin || "",
      huesped: body.huesped || "",
      total,
      limpieza: Number(body.limpieza) || 0,
      comisionPct: body.comisionPct != null ? Number(body.comisionPct) : 15,
      creado: new Date().toISOString(),
    };
    list.push(item);
    await setJSON("ingresos-manual", list);
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
    const list = await getJSON("ingresos-manual", []);
    await setJSON("ingresos-manual", list.filter((x) => x.id !== body.id));
    return json(200, { ok: true });
  }

  return { statusCode: 405, body: "Method not allowed" };
};
