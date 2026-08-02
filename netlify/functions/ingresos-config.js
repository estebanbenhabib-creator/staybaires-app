// Config del modulo Ingresos: el mapeo de cada unidad (anuncio de Airbnb /
// propiedad de Booking) a un codigo de departamento y su marca propio/tercero,
// mas la tarifa de limpieza de Booking. Lo edita la pantalla de asociacion.
//
// GET  /api/ingresos-config  -> { mapeo: { [unidad]: { codigo, propio } }, limpiezaBooking }
// POST /api/ingresos-config  -> guarda la config (body con esos campos)

const { getJSON, setJSON } = require("../lib/store");

const DEFAULT = { mapeo: {}, limpiezaBooking: 30, cotizacion: 0 };

function json(code, obj) {
  return { statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    return json(200, await getJSON("ingresos-config", DEFAULT));
  }

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "JSON invalido" });
    }
    const prev = await getJSON("ingresos-config", DEFAULT);
    const next = {
      mapeo: body.mapeo && typeof body.mapeo === "object" ? body.mapeo : prev.mapeo,
      limpiezaBooking: body.limpiezaBooking != null ? Number(body.limpiezaBooking) || 0 : prev.limpiezaBooking,
      cotizacion: body.cotizacion != null ? Number(body.cotizacion) || 0 : prev.cotizacion || 0,
    };
    await setJSON("ingresos-config", next);
    return json(200, { ok: true, config: next });
  }

  return { statusCode: 405, body: "Method not allowed" };
};
