# Staybaires - app de limpieza

App para gestionar calendario, tareas de limpieza, empleadas, pagos e
insumos de los 22 departamentos de Staybaires. Pensada para correr en
Netlify sin costo (dentro de los limites del plan free).

## Que hace

- **Calendario**: sincroniza una vez por dia los `.ics` de Airbnb (las 22
  propiedades), Booking.com (3 propiedades) y Vrbo (1 propiedad), y detecta
  los checkouts.
- **Tareas**: por cada checkout genera una tarea de limpieza y la asigna
  automaticamente segun la jerarquia Susana &rarr; Mari &rarr; Random.
- **Pagos**: calcula lo que se le debe a cada empleada por dia trabajado
  (no por depto): Susana $10.000/dia, Mari y Random $5.000/dia. Si una
  empleada limpia dos deptos el mismo dia, cuenta como un solo dia.
- **Empleadas**: ficha de cada persona con su jerarquia y su resumen de pago.
- **Insumos**: stock de productos de limpieza y blanqueria, cualquiera lo
  puede actualizar.
- **Lavanderia**: pedidos de retiro/entrega para Lujan.
- **Roles**: Admin ve todo. Cada empleada ve solo sus tareas. Lavanderia ve
  solo sus pedidos.

## Como esta armada (y por que)

No usa Next.js/React ni ningun paquete de npm en el frontend: es HTML/CSS/JS
simple en `public/`. La logica de servidor (sincronizar calendarios, calcular
pagos, guardar cambios) vive en `netlify/functions/` como Netlify Functions
en Node.

Los datos se guardan con **Netlify Blobs**, que viene incluido en cualquier
sitio de Netlify sin crear cuenta en otro lado. Si mas adelante quieren login
de verdad por usuario y contraseña (hoy es solo "elegi tu nombre"), el
siguiente paso natural es sumar Supabase Auth - la app ya esta separada en
capas para que ese cambio no toque el resto.

## Estructura

```
public/                  sitio estatico (esto es lo que se ve)
  index.html
  assets/app.js           toda la app (sin build, JS plano)
  assets/styles.css
data/                     datos base, se leen desde las functions
  properties.json          las 22 propiedades + sus 3 links de iCal
  employees.json           Susana, Mari, Random, Lujan, Esteban (admin)
  roles.json                que pestañas ve cada rol
  insumos-inicial.json     stock de arranque (despues se edita desde la app)
netlify/functions/        el "backend"
  config.js                le pasa al frontend propiedades/empleadas/roles
  sync-calendars.js        trae y parsea los 26 .ics, corre 1 vez por dia
  tasks.js                 lista de tareas + marcar hecha / reasignar
  payments.js               resumen de pagos por dia trabajado
  insumos.js                 stock
  lavanderia.js               pedidos de Lujan
netlify/lib/               logica pura, sin red (facil de testear)
  ics-parser.js             lee un .ics a mano, sin librerias
  task-engine.js             calcula checkouts y asigna empleada
  payment-engine.js          calcula dias trabajados y total a pagar
  store.js                    capa sobre Netlify Blobs
  fetch-calendars.js           trae los 26 .ics en paralelo
netlify.toml               config de build, redirects /api/*, cron diario
package.json                unica dependencia real: @netlify/blobs
```

## Deploy (una sola vez)

1. Subi esta carpeta a un repo de GitHub (o arrastra la carpeta directo en
   app.netlify.com si no queres usar Git).
2. En Netlify: **Add new site &rarr; Import an existing project**, elegi el
   repo. Netlify va a leer `netlify.toml` solo (build command no hace falta,
   publish = `public`, functions = `netlify/functions`).
3. Deploy. Con eso ya queda andando en una URL tipo
   `https://staybaires-limpieza.netlify.app`.
4. Mandale esa URL a Susana, Mari y Lujan (por WhatsApp, por ejemplo). Cada
   una entra y elige su nombre - no hace falta usuario ni contraseña en esta
   version.

No hace falta crear cuenta en Supabase ni en ningun otro lado para esta
primera version: Netlify Blobs ya viene activado.

## Cosas para probar apenas este deployado (no las pude probar yo)

El sandbox donde arme esto no tiene salida a internet (ni a
`registry.npmjs.org` ni a los `.ics` reales), asi que:

- **La logica de negocio esta probada de punta a punta** (parseo de .ics,
  deteccion de checkouts, jerarquia de asignacion, calculo de pagos) con
  datos de prueba armados a mano imitando el formato real de Airbnb/Booking.
- **Lo que no pude probar en vivo**: que Netlify realmente pueda instalar
  `@netlify/blobs`, y que los 26 links de iCal reales respondan bien desde
  los servidores de Netlify (deberian, son links publicos estandar, pero no
  lo vi con mis propios ojos).

Si al entrar por primera vez el Calendario aparece vacio, apreta "Actualizar
ahora" - eso fuerza el primer sync. Si tira error, mandame el mensaje y lo
arreglamos.

## Limitaciones de esta primera version (a proposito, para no over-engineer)

- El login es "elegi tu nombre", no hay contraseña. Sirve para un equipo
  chico y de confianza que entra por un link compartido. Si mas adelante
  quieren que cada una tenga su propio usuario real, se suma Supabase Auth.
- Los pagos de Lujan (lavanderia) siguen siendo por transferencia aparte,
  como ya lo vienen haciendo - la app solo cuenta sus pedidos, no calcula
  montos porque no es un valor fijo por dia como con las limpiadoras.
- El sync de calendarios corre 1 vez por dia mas el boton manual. Si
  necesitan que sea mas seguido (cada 1 hora, por ejemplo) es un cambio de
  una linea en `netlify.toml`.
