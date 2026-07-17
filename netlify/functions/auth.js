// POST /.netlify/functions/auth  { employeeId, password }
// Verifica la clave del lado del servidor (data/employees.json no se le
// manda nunca entero al navegador, asi que las claves no quedan visibles
// mirando el codigo fuente de la pagina, a diferencia de si el chequeo se
// hiciera en el JS del cliente).
//
// Si una persona no tiene "password" cargado en employees.json, entra
// directo sin pedir clave (asi quedaron Random y Lujan por ahora).

const employees = require("../../data/employees.json");

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") {
          return { statusCode: 405, body: "Method not allowed" };
    }

    let body;
    try {
          body = JSON.parse(event.body || "{}");
    } catch {
          return { statusCode: 400, body: JSON.stringify({ ok: false, error: "JSON invalido" }) };
    }

    const emp = employees.find((e) => e.id === body.employeeId);
    if (!emp) {
          return { statusCode: 404, body: JSON.stringify({ ok: false, error: "No existe esa persona" }) };
    }

    if (emp.password && emp.password !== body.password) {
          return { statusCode: 401, body: JSON.stringify({ ok: false, error: "Clave incorrecta" }) };
    }

    return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
                  ok: true,
                  employeeId: emp.id,
                  nombre: emp.nombre,
                  rol: emp.rol,
                  jerarquia: emp.jerarquia,
                  esRotativa: !!emp.esRotativa,
          }),
    };
};
