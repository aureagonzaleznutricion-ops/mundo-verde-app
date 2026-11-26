// Reglas de una reserva: comprobar, guardar y, solo si se guarda, enviar el WhatsApp.
// Sin dependencias: la base de datos y Twilio llegan desde fuera (ver route.ts).

export const MAX_NOMBRE = 120;
export const MAX_OTROS = 1500; // hay clientes que escriben aquí la lista entera
export const MAX_OBSERVACIONES = 500;
export const MAX_CANTIDAD = 100;
const DIAS = ["Martes", "Jueves"];
const UDS = "uds";
// El mensaje ya relleno no puede pasar de 1024 caracteres. 240 cubre el texto fijo de la plantilla de Twilio (223) con margen.
const MAX_MENSAJE = 1024;
const TEXTO_PLANTILLA = 240;
const RECORTADO = "… (mensaje recortado: tu pedido completo está guardado)";

export type LineaEntrada = { producto_id: number; cantidad: number; porUnidades: boolean; precioVisto: number; unidadVista: string };
export type Entrada = {
  cliente: { nombre: string; telefono: string; email: string };
  lineas: LineaEntrada[]; otros: string; observaciones: string; dia_recogida: string;
};
export type ProductoBD = { id: number; nombre: string; emoji: string; unidad: string; precio: number | null; activo: boolean };
export type LineaPedido = { producto_id: number; nombre: string; emoji: string; unidad: string; cantidad: number; precio: number };
export type PedidoNuevo = {
  fecha: string; hora: string; cliente_nombre: string; cliente_telefono: string; cliente_email: string;
  otros: string; observaciones: string; dia_recogida: string;
};
export type Resultado =
  | { estado: "guardada"; id: number; fecha: string; hora: string; lineas: LineaPedido[]; whatsapp: boolean }
  | { estado: "invalida"; motivo: string }
  | { estado: "cambios"; cambiados: string[]; noDisponibles: { id: number; nombre: string }[] }
  | { estado: "no_guardada" }
  | { estado: "desconocido" };
export type Deps = {
  leerProductos(ids: number[]): Promise<ProductoBD[]>;
  guardarPedido(pedido: PedidoNuevo, lineas: LineaPedido[]): Promise<number>;
  enviarWhatsapp(mensaje: { numero: string; variables: Record<"1" | "2" | "3" | "4", string> }): Promise<void>;
  ahora(): Date;
};

/** La lanza guardarPedido cuando no se sabe si el pedido llegó a guardarse. */
export class SinRespuesta extends Error {}

export function movilEspanol(telefono: string): string | null {
  const m = telefono.replace(/[\s\-().]/g, "").match(/^(?:\+34|0034|34)?([67]\d{8})$/);
  return m ? `+34${m[1]}` : null;
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const unaLinea = (t: string) => t.replace(/\s+/g, " ").trim();

function validar(e: unknown): Entrada | string {
  const mal = "Los datos de la reserva no son válidos.";
  if (!esObjeto(e) || !esObjeto(e.cliente) || !Array.isArray(e.lineas)) return mal;
  const { nombre, telefono, email } = e.cliente;
  const { otros, observaciones, dia_recogida } = e;
  if (typeof nombre !== "string" || typeof telefono !== "string" || typeof email !== "string" ||
      typeof otros !== "string" || typeof observaciones !== "string" || typeof dia_recogida !== "string") return mal;
  if (!nombre.trim()) return "El nombre es obligatorio.";
  if (nombre.trim().length > MAX_NOMBRE) return `El nombre no puede pasar de ${MAX_NOMBRE} caracteres.`;
  if (!telefono.trim() || telefono.length > 30) return "Revisa el teléfono.";
  if (email.length > 200 || !/^\S+@\S+\.\S+$/.test(email.trim())) return "Email no válido.";
  if (otros.trim().length > MAX_OTROS) return `«Otros» no puede pasar de ${MAX_OTROS} caracteres.`;
  if (observaciones.trim().length > MAX_OBSERVACIONES) return `«Observaciones» no puede pasar de ${MAX_OBSERVACIONES} caracteres.`;
  if (!DIAS.includes(dia_recogida)) return "Selecciona el día de recogida.";
  if (e.lineas.length === 0 && !otros.trim()) return "Selecciona al menos un producto.";
  if (e.lineas.length > 200) return mal;
  const ids = new Set<number>();
  for (const l of e.lineas as unknown[]) {
    if (!esObjeto(l) || !Number.isInteger(l.producto_id) || typeof l.porUnidades !== "boolean" ||
        typeof l.precioVisto !== "number" || typeof l.unidadVista !== "string" || ids.has(l.producto_id as number)) return mal;
    if (typeof l.cantidad !== "number" || !(l.cantidad > 0 && l.cantidad <= MAX_CANTIDAD))
      return `La cantidad de cada producto debe ser mayor que 0 y como máximo ${MAX_CANTIDAD}.`;
    ids.add(l.producto_id as number);
  }
  return {
    cliente: { nombre: nombre.trim(), telefono: telefono.trim(), email: email.trim() },
    lineas: e.lineas as LineaEntrada[], otros: otros.trim(), observaciones: observaciones.trim(), dia_recogida,
  };
}

function variablesMensaje(r: Entrada, lineas: LineaPedido[]): Record<"1" | "2" | "3" | "4", string> {
  const productos = lineas.map((p) =>
    `${p.emoji} ${p.nombre}: ${p.cantidad} ${p.unidad}${
      p.precio ? ` - ${(p.precio * p.cantidad).toFixed(2)} EUR` : p.unidad === UDS ? " (se pesa en tienda)" : ""
    }`).join(", ");
  const detalle = [productos, r.otros && `Otros: ${r.otros}`, r.observaciones && `Obs: ${r.observaciones}`].filter(Boolean).join(" | ");
  const total = lineas.reduce((suma, p) => suma + p.precio * p.cantidad, 0);
  const nombre = unaLinea(r.cliente.nombre);
  const importe = total > 0 ? total.toFixed(2) : "Por confirmar";
  const hueco = MAX_MENSAJE - TEXTO_PLANTILLA - nombre.length - importe.length - r.dia_recogida.length;
  return { "1": nombre, "2": recortar(unaLinea(detalle), hueco), "3": importe, "4": r.dia_recogida };
}

// Solo se recorta el mensaje: el pedido se guarda entero.
function recortar(texto: string, maximo: number): string {
  if (texto.length <= maximo) return texto;
  const corte = texto.slice(0, maximo - RECORTADO.length).replace(/[\uD800-\uDBFF]$/, ""); // sin emojis a medias
  return corte.trimEnd() + RECORTADO;
}

export async function procesarReserva(entrada: unknown, deps: Deps): Promise<Resultado> {
  const r = validar(entrada);
  if (typeof r === "string") return { estado: "invalida", motivo: r };

  let productos: ProductoBD[] = [];
  try {
    if (r.lineas.length) productos = await deps.leerProductos(r.lineas.map((l) => l.producto_id));
  } catch (err) {
    console.error("Error al leer productos:", err);
    return { estado: "no_guardada" };
  }

  const lineas: LineaPedido[] = [];
  const cambiados: string[] = [];
  const noDisponibles: { id: number; nombre: string }[] = [];
  for (const l of r.lineas) {
    const p = productos.find((x) => x.id === l.producto_id);
    if (!p || !p.activo) { noDisponibles.push({ id: l.producto_id, nombre: p?.nombre ?? "" }); continue; }
    if ((p.precio ?? 0) !== l.precioVisto || p.unidad !== l.unidadVista) { cambiados.push(p.nombre); continue; }
    if (l.porUnidades && p.unidad !== "kg") return { estado: "invalida", motivo: `${p.nombre} no se puede pedir por unidades.` };
    lineas.push({
      producto_id: p.id, nombre: p.nombre, emoji: p.emoji, cantidad: l.cantidad,
      unidad: l.porUnidades ? UDS : p.unidad, precio: l.porUnidades ? 0 : p.precio ?? 0,
    });
  }
  if (cambiados.length || noDisponibles.length) return { estado: "cambios", cambiados, noDisponibles };

  // El servidor publicado va en UTC: la fecha y la hora son siempre las de la tienda.
  const ahora = deps.ahora();
  const fecha = ahora.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" });
  const hora = ahora.toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" });

  let id: number;
  try {
    id = await deps.guardarPedido({
      fecha, hora, cliente_nombre: r.cliente.nombre, cliente_telefono: r.cliente.telefono, cliente_email: r.cliente.email,
      otros: r.otros, observaciones: r.observaciones, dia_recogida: r.dia_recogida,
    }, lineas);
  } catch (err) {
    console.error("Error al guardar el pedido:", err);
    return { estado: err instanceof SinRespuesta ? "desconocido" : "no_guardada" };
  }

  let whatsapp = false;
  const numero = movilEspanol(r.cliente.telefono);
  if (numero) {
    try {
      await deps.enviarWhatsapp({ numero, variables: variablesMensaje(r, lineas) });
      whatsapp = true;
    } catch (err) {
      console.error("Twilio WhatsApp error:", err instanceof Error ? err.message : err);
    }
  }
  return { estado: "guardada", id, fecha, hora, lineas, whatsapp };
}
