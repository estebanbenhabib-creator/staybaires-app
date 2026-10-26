// GET /.netlify/functions/config -> todo lo que el frontend necesita para
// arrancar: propiedades, empleadas y el mapa de roles/permisos.

const properties = require("../../data/properties.json");
const employees = require("../../data/employees.json");
const roles = require("../../data/roles.json");
// Deptos que ya no se administran. Quedan fuera de la operación (no están en
// properties.json), pero el módulo de Ingresos los sigue reconociendo para
// cobros rezagados: nombre del depto/propietario y matching por dirección.
let propertiesArchivadas = [];
try {
    propertiesArchivadas = require("../../data/properties-archivadas.json");
} catch { /* sin archivadas */ }

exports.handler = async () => {
    const publicEmployees = employees.map((e) => ({
          id: e.id,
          nombre: e.nombre,
          rol: e.rol,
          jerarquia: e.jerarquia,
          esRotativa: !!e.esRotativa,
          tarifaPorDia: e.tarifaPorDia || 0,
          requiresPassword: !!e.password,
    }));
    return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ properties, propertiesArchivadas, employees: publicEmployees, roles }),
    };
};
