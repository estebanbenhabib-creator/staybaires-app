// GET /api/payments?from=YYYY-MM-DD&to=YYYY-MM-DD
//   -> liquidacion por colaboradora (base por dia + valor por depto + viatico
//      + plus + items) sobre las tareas HECHAS en el rango. Devuelve tambien
//      la config (para tener los telefonos al armar el WhatsApp).

const employees = require("../../data/employees.json");
const { getJSON } = require("../lib/store");
const { computeLiquidacion, DEFAULT_CONFIG } = require("../lib/payment-engine");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  const params = event.queryStringParameters || {};
  const payload = await getJSON("tasks-cache", { tasks: [] });
  const config = { ...DEFAULT_CONFIG, ...(await getJSON("pay-config", {})) };
  const items = await getJSON("pay-items", []);

  const summary = computeLiquidacion(payload.tasks || [], employees, config, items, params.from, params.to);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ summary, config, from: params.from || null, to: params.to || null }),
  };
};
