// Configuracion de pagos (montos que carga el admin en Ajustes):
//   { viatico, plusDomingo, plusFeriado, feriados:[fechas], valorDepto:{codigo:monto}, telefonos:{empId:tel} }
//
// GET  /api/pay-config  -> config actual (con defaults)
// POST /api/pay-config  -> guarda la config (reemplaza el objeto entero)

const { getJSON, setJSON } = require("../lib/store");
const { DEFAULT_CONFIG } = require("../lib/payment-engine");

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    const cfg = { ...DEFAULT_CONFIG, ...(await getJSON("pay-config", {})) };
    return json(200, cfg);
  }

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "JSON invalido" });
    }
    const cfg = {
      viaticoDia: body.viaticoDia && typeof body.viaticoDia === "object" ? body.viaticoDia : {},
      plusDomingo: Number(body.plusDomingo) || 0,
      plusFeriado: Number(body.plusFeriado) || 0,
      feriados: Array.isArray(body.feriados) ? body.feriados : [],
      valorDepto: body.valorDepto && typeof body.valorDepto === "object" ? body.valorDepto : {},
      telefonos: body.telefonos && typeof body.telefonos === "object" ? body.telefonos : {},
    };
    await setJSON("pay-config", cfg);
    return json(200, { ok: true, config: cfg });
  }

  return { statusCode: 405, body: "Method not allowed" };
};

function json(code, obj) {
  return { statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
