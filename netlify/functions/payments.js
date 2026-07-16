// GET  /.netlify/functions/payments?from=YYYY-MM-DD&to=YYYY-MM-DD
//      -> resumen por empleada: dias trabajados y total a pagar
// POST /.netlify/functions/payments  { employeeId, date, motivo }
//      -> carga un jornal a mano (ej: una tarea extra sin checkout ese dia)
// DELETE /.netlify/functions/payments  { employeeId, date }
//      -> saca un jornal cargado a mano

const employees = require("../../data/employees.json");
const { getJSON, setJSON } = require("../lib/store");
const { computeDailyPayments, filterByDateRange } = require("../lib/payment-engine");

exports.handler = async (event) => {
  if (event.httpMethod === "GET") {
    const params = event.queryStringParameters || {};
    const payload = await getJSON("tasks-cache", { tasks: [] });
    const manualJornales = await getJSON("manual-jornales", []);

    let summary = computeDailyPayments(payload.tasks, manualJornales, employees);
    if (params.from || params.to) {
      summary = filterByDateRange(summary, params.from, params.to);
    }

    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ summary, manualJornales }) };
  }

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: "JSON invalido" }) };
    }
    if (!body.employeeId || !body.date) {
      return { statusCode: 400, body: JSON.stringify({ error: "Falta employeeId o date" }) };
    }
    const manualJornales = await getJSON("manual-jornales", []);
    manualJornales.push({ employeeId: body.employeeId, date: body.date, motivo: body.motivo || "" });
    await setJSON("manual-jornales", manualJornales);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  if (event.httpMethod === "DELETE") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: "JSON invalido" }) };
    }
    const manualJornales = await getJSON("manual-jornales", []);
    const filtered = manualJornales.filter((j) => !(j.employeeId === body.employeeId && j.date === body.date));
    await setJSON("manual-jornales", filtered);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, body: "Method not allowed" };
};
