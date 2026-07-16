// Trae los .ics de todas las propiedades en paralelo. Corre del lado del
// servidor de Netlify (que tiene internet normal), no en este sandbox.

async function fetchWithTimeout(url, ms = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "StaybairesApp/1.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {Array} properties - data/properties.json
 * @returns {Object} { [codigo]: { airbnb, booking, vrbo, errors: [] } }
 */
async function fetchAllCalendars(properties) {
  const results = {};

  const jobs = [];
  for (const prop of properties) {
    results[prop.codigo] = { airbnb: null, booking: null, vrbo: null, errors: [] };
    if (prop.icalAirbnb) {
      jobs.push(
        fetchWithTimeout(prop.icalAirbnb)
          .then((text) => (results[prop.codigo].airbnb = text))
          .catch((err) => results[prop.codigo].errors.push(`airbnb: ${err.message}`))
      );
    }
    if (prop.icalBooking) {
      jobs.push(
        fetchWithTimeout(prop.icalBooking)
          .then((text) => (results[prop.codigo].booking = text))
          .catch((err) => results[prop.codigo].errors.push(`booking: ${err.message}`))
      );
    }
    if (prop.icalVrbo) {
      jobs.push(
        fetchWithTimeout(prop.icalVrbo)
          .then((text) => (results[prop.codigo].vrbo = text))
          .catch((err) => results[prop.codigo].errors.push(`vrbo: ${err.message}`))
      );
    }
  }

  await Promise.allSettled(jobs);
  return results;
}

module.exports = { fetchAllCalendars, fetchWithTimeout };
