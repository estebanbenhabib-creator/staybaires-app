// GET /.netlify/functions/config -> todo lo que el frontend necesita para
// arrancar: propiedades, empleadas y el mapa de roles/permisos.

const properties = require("../../data/properties.json");
const employees = require("../../data/employees.json");
const roles = require("../../data/roles.json");

exports.handler = async () => {
  const publicEmployees = employees.map((e) => ({ id: e.id, nombre: e.nombre, rol: e.rol, jerarquia: e.jerarquia }));
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ properties, employees: publicEmployees, roles }),
  };
};
