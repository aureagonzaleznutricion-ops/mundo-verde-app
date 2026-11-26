import { test } from "node:test";
import assert from "node:assert/strict";
import { enviarReserva, avisoFallo, quitarProductos } from "../app/components/reserva-cliente.ts";

const entrada = { cliente: { nombre: "Ana", telefono: "600000000", email: "a@b.es" }, lineas: [], otros: "x", observaciones: "", dia_recogida: "Martes" };
const responde = (cuerpo: string, status = 200) => (async () => new Response(cuerpo, { status })) as typeof fetch;

test("envía la reserva a /api/reserva y devuelve el resultado", async () => {
  let llamada: any;
  const r = await enviarReserva(entrada, (async (url: any, init: any) => { llamada = { url, init }; return new Response('{"estado":"no_guardada"}', { status: 502 }); }) as typeof fetch);
  assert.equal(llamada.url, "/api/reserva");
  assert.equal(llamada.init.method, "POST");
  assert.deepEqual(JSON.parse(llamada.init.body), entrada);
  assert.deepEqual(r, { estado: "no_guardada" });
});

test("sin respuesta útil: desconocido", async () => {
  const cae = (async () => { throw new TypeError("offline"); }) as typeof fetch;
  for (const f of [cae, responde("<html>504</html>", 504), responde("{}"), responde("null"), responde('{"estado":"otra"}')]) {
    assert.deepEqual(await enviarReserva(entrada, f), { estado: "desconocido" });
  }
});

test("avisos de fallo", () => {
  assert.equal(avisoFallo({ estado: "no_guardada" }), "No hemos podido guardar tu reserva. Inténtalo de nuevo.");
  assert.equal(avisoFallo({ estado: "invalida", motivo: "Email no válido." }), "No hemos podido guardar tu reserva. Email no válido.");
  assert.equal(avisoFallo({ estado: "desconocido" }), "No sabemos si tu reserva se ha guardado. Consulta con la tienda antes de repetirla.");
  assert.equal(avisoFallo({ estado: "cambios", cambiados: ["Pera"], noDisponibles: [{ id: 3, nombre: "Uvas" }, { id: 99, nombre: "" }] }),
    "Tu reserva todavía no se ha enviado. Ha cambiado el precio o la unidad de: Pera. Ya no están disponibles y se han quitado de tu selección: Uvas, un producto. Revisa tu selección y vuelve a enviarla.");
});

test("quita productos de la selección", () => {
  const sel = { 1: 2, 3: 1 };
  assert.deepEqual(quitarProductos(sel, [3]), { 1: 2 });
  assert.deepEqual(sel, { 1: 2, 3: 1 });
});
