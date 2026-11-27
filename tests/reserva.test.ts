import { test } from "node:test";
import assert from "node:assert/strict";
import { procesarReserva, movilEspanol, SinRespuesta, type Deps, type ProductoBD } from "../app/api/reserva/logica.ts";

const BD: ProductoBD[] = [
  { id: 1, nombre: "Pera", emoji: "🍐", unidad: "kg", precio: 4.95, activo: true },
  { id: 2, nombre: "Apio", emoji: "🌿", unidad: "mollo", precio: 2.65, activo: true },
  { id: 3, nombre: "Uvas", emoji: "🍇", unidad: "kg", precio: 5.95, activo: false },
  { id: 4, nombre: "Setas", emoji: "🍄", unidad: "kg", precio: null, activo: true },
];
const pera = { producto_id: 1, cantidad: 2, porUnidades: false, precioVisto: 4.95, unidadVista: "kg" };
const base = (extra: any = {}) => ({
  cliente: { nombre: "Ana", telefono: "600 000 000", email: "ana@example.com" },
  lineas: [pera], otros: "", observaciones: "", dia_recogida: "Martes", ...extra,
});
const conCliente = (c: any) => base({ cliente: { ...base().cliente, ...c } });

function falso(extra: Partial<Deps> = {}) {
  const guardados: any[] = [], enviados: any[] = [];
  const deps: Deps = {
    leerProductos: async (ids) => BD.filter((p) => ids.includes(p.id)),
    guardarPedido: async (pedido, lineas) => { guardados.push({ pedido, lineas }); return 7; },
    enviarWhatsapp: async (m) => { enviados.push(m); },
    ahora: () => new Date("2026-11-26T10:00:00Z"),
    ...extra,
  };
  return { deps, guardados, enviados };
}

test("reserva normal: datos de la BD, guarda una vez y envía", async () => {
  const f = falso();
  const r: any = await procesarReserva(base({ lineas: [{ ...pera, nombre: "FALSO" }] }), f.deps);
  assert.equal(r.estado, "guardada");
  assert.equal(r.whatsapp, true);
  assert.equal(r.id, 7);
  assert.equal(f.guardados.length, 1);
  assert.deepEqual(f.guardados[0].lineas, [{ producto_id: 1, nombre: "Pera", emoji: "🍐", unidad: "kg", cantidad: 2, precio: 4.95 }]);
  assert.equal(f.guardados[0].pedido.cliente_nombre, "Ana");
  assert.deepEqual(f.enviados, [{ numero: "+34600000000", variables: { "1": "Ana", "2": "🍐 Pera: 2 kg - 9.90 EUR", "3": "9.90", "4": "Martes" } }]);
});

test("por unidades: sin precio y se pesa en tienda", async () => {
  const f = falso();
  const r: any = await procesarReserva(base({ lineas: [{ ...pera, cantidad: 3, porUnidades: true }] }), f.deps);
  assert.equal(r.lineas[0].unidad, "uds");
  assert.equal(r.lineas[0].precio, 0);
  assert.equal(f.enviados[0].variables["2"], "🍐 Pera: 3 uds (se pesa en tienda)");
  assert.equal(f.enviados[0].variables["3"], "Por confirmar");
});

for (const [caso, cambio] of [["precio", { precioVisto: 4.5 }], ["unidad", { unidadVista: "mollo" }]] as const) {
  test(`cambio de ${caso}: no guarda ni envía`, async () => {
    const f = falso();
    const r: any = await procesarReserva(base({ lineas: [{ ...pera, ...cambio }] }), f.deps);
    assert.deepEqual(r, { estado: "cambios", cambiados: ["Pera"], noDisponibles: [] });
    assert.equal(f.guardados.length + f.enviados.length, 0);
  });
}

test("producto oculto o inexistente", async () => {
  const f = falso();
  const r: any = await procesarReserva(base({ lineas: [{ ...pera, producto_id: 3, precioVisto: 5.95 }, { ...pera, producto_id: 99 }] }), f.deps);
  assert.equal(r.estado, "cambios");
  assert.deepEqual(r.noDisponibles.map((p: any) => p.id), [3, 99]);
  assert.equal(r.noDisponibles[0].nombre, "Uvas");
  assert.equal(f.guardados.length, 0);
});

test("por unidades en un producto que no va por kg: inválida", async () => {
  const r = await procesarReserva(base({ lineas: [{ producto_id: 2, cantidad: 1, porUnidades: true, precioVisto: 2.65, unidadVista: "mollo" }] }), falso().deps);
  assert.equal(r.estado, "invalida");
});

test("el email es opcional", async () => {
  const r = await procesarReserva(conCliente({ email: "" }), falso().deps);
  assert.equal(r.estado, "guardada");
});

test("límites rechazados", async () => {
  for (const mala of [
    conCliente({ nombre: "a".repeat(121) }), conCliente({ nombre: "  " }), conCliente({ telefono: "" }), conCliente({ email: "sin-arroba" }),
    base({ otros: "a".repeat(1501) }), base({ observaciones: "a".repeat(501) }),
    base({ lineas: [{ ...pera, cantidad: 0 }] }), base({ lineas: [{ ...pera, cantidad: 101 }] }), base({ lineas: [{ ...pera, cantidad: NaN }] }),
    base({ dia_recogida: "Lunes" }), base({ lineas: [], otros: " " }),
  ]) {
    const f = falso();
    assert.equal((await procesarReserva(mala, f.deps)).estado, "invalida", JSON.stringify(mala).slice(0, 150));
    assert.equal(f.guardados.length, 0);
  }
});

test("límites exactos aceptados", async () => {
  const r = await procesarReserva(base({ cliente: { ...base().cliente, nombre: "a".repeat(120) }, otros: "a".repeat(1500), observaciones: "a".repeat(500), lineas: [{ ...pera, cantidad: 100 }] }), falso().deps);
  assert.equal(r.estado, "guardada");
});

test("solo 'otros', sin productos", async () => {
  const f = falso();
  assert.equal((await procesarReserva(base({ lineas: [], otros: "Aguacates" }), f.deps)).estado, "guardada");
  assert.equal(f.enviados[0].variables["2"], "Otros: Aguacates");
});

test("móviles españoles", () => {
  for (const t of ["600000000", "712 34 56 78", "+34 600-000-000", "0034600000000", "34600000000", "(600) 000.000"]) assert.match(movilEspanol(t)!, /^\+34[67]\d{8}$/, t);
  for (const t of ["986000000", "+447700900000", "60000000", "6000000000", "abc"]) assert.equal(movilEspanol(t), null, t);
});

test("fijo o extranjero: guarda sin enviar", async () => {
  for (const telefono of ["986000000", "+447700900000"]) {
    const f = falso();
    const r: any = await procesarReserva(conCliente({ telefono }), f.deps);
    assert.equal(r.estado, "guardada");
    assert.equal(r.whatsapp, false);
    assert.equal(f.enviados.length, 0);
  }
});

test("si falla el envío, la reserva sigue guardada", async () => {
  const f = falso({ enviarWhatsapp: async () => { throw new Error("twilio"); } });
  const r: any = await procesarReserva(base(), f.deps);
  assert.equal(r.estado, "guardada");
  assert.equal(r.whatsapp, false);
});

test("fallos al leer o guardar: no envía", async () => {
  const boom = async (): Promise<never> => { throw new Error("db"); };
  for (const [extra, estado] of [
    [{ guardarPedido: boom }, "no_guardada"],
    [{ leerProductos: boom }, "no_guardada"],
    [{ guardarPedido: async (): Promise<never> => { throw new SinRespuesta(); } }, "desconocido"],
  ] as const) {
    const f = falso(extra);
    assert.equal((await procesarReserva(base(), f.deps)).estado, estado);
    assert.equal(f.enviados.length, 0);
  }
});

test("sin saltos de línea ni espacios repetidos en el mensaje", async () => {
  const f = falso();
  await procesarReserva(base({ cliente: { ...base().cliente, nombre: "Ana\n\nLópez" }, otros: "uno\r\ndos\t    tres", observaciones: "a\nb" }), f.deps);
  for (const v of Object.values(f.enviados[0].variables) as string[]) assert.doesNotMatch(v, /[\r\n\t]| {2}/);
});

test("fecha y hora de Madrid aunque el servidor esté en UTC", async () => {
  const f = falso({ ahora: () => new Date("2026-12-31T23:30:00Z") });
  const r: any = await procesarReserva(base(), f.deps);
  assert.equal(r.fecha, "1/1/2027");
  assert.equal(r.hora, "00:30");
  assert.equal(f.guardados[0].pedido.fecha, "1/1/2027");
});

test("cuerpos mal formados", async () => {
  for (const mala of [null, {}, "x", 3, base({ lineas: "x" }), base({ lineas: [null] }), base({ cliente: null }), base({ otros: 5 }), base({ lineas: [pera, pera] })]) {
    assert.equal((await procesarReserva(mala, falso().deps)).estado, "invalida");
  }
});

test("producto sin precio no cuenta como cambio", async () => {
  const r = await procesarReserva(base({ lineas: [{ producto_id: 4, cantidad: 1, porUnidades: false, precioVisto: 0, unidadVista: "kg" }] }), falso().deps);
  assert.equal(r.estado, "guardada");
});

// Texto de la plantilla aprobada en Twilio, para medir el mensaje tal como llega.
const PLANTILLA = "🌿 *Mundo Verde Pontevedra*\n¡Hola {{1}}! Hemos recibido tu reserva ✅\n\n{{2}}\n\n💰 *Total estimado: {{3}} €*\n📅 *Recogida: {{4}}*\n\n¡Gracias por confiar en nosotras! 🌿\n\n_⚠️ Este es un mensaje automático. Para consultas escríbenos al 604 034 893._";
const montado = (v: Record<string, string>) => PLANTILLA.replace(/\{\{(\d)\}\}/g, (_, n) => v[n]);
const AVISO = "… (mensaje recortado: tu pedido completo está guardado)";

test("pedido muy largo: se guarda entero y el mensaje cabe en 1024", async () => {
  for (const relleno of ["a", "🥕"]) {
    const f = falso();
    const otros = relleno.repeat(1500 / relleno.length);
    const r: any = await procesarReserva(base({ cliente: { ...base().cliente, nombre: "n".repeat(120) }, otros, observaciones: "o".repeat(500) }), f.deps);
    assert.equal(r.estado, "guardada");
    assert.equal(f.guardados[0].pedido.otros, otros);
    const v = f.enviados[0].variables;
    assert.ok(montado(v).length <= 1024, String(montado(v).length));
    assert.ok(montado(v).length > 1000);
    assert.ok(v["2"].endsWith(AVISO));
    assert.ok(v["2"].isWellFormed(), "no debe partir un emoji");
  }
});

test("pedido normal: el mensaje no se recorta", async () => {
  const f = falso();
  await procesarReserva(base({ otros: "x".repeat(300) }), f.deps);
  assert.equal(f.enviados[0].variables["2"], "🍐 Pera: 2 kg - 9.90 EUR | Otros: " + "x".repeat(300));
});

test("«Otros» con varias líneas se guarda tal cual", async () => {
  const f = falso();
  await procesarReserva(base({ otros: "1 kg tomates\n2 limones" }), f.deps);
  assert.equal(f.guardados[0].pedido.otros, "1 kg tomates\n2 limones");
});
