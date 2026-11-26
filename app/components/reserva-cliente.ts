// Lado del cliente: enviar la reserva y traducir el resultado a un aviso.
import type { Entrada, Resultado } from "../api/reserva/logica";

const ESTADOS = ["guardada", "invalida", "cambios", "no_guardada", "desconocido"];

export async function enviarReserva(entrada: Entrada, fetchFn: typeof fetch = fetch): Promise<Resultado> {
  try {
    const res = await fetchFn("/api/reserva", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entrada) });
    const cuerpo = await res.json();
    return ESTADOS.includes(cuerpo?.estado) ? cuerpo : { estado: "desconocido" };
  } catch (err) {
    console.error("Error al enviar la reserva:", err);
    return { estado: "desconocido" };
  }
}

export function avisoFallo(r: Exclude<Resultado, { estado: "guardada" }>): string {
  if (r.estado === "invalida") return `No hemos podido guardar tu reserva. ${r.motivo}`;
  if (r.estado === "no_guardada") return "No hemos podido guardar tu reserva. Inténtalo de nuevo.";
  if (r.estado === "desconocido") return "No sabemos si tu reserva se ha guardado. Consulta con la tienda antes de repetirla.";
  return [
    "Tu reserva todavía no se ha enviado.",
    r.cambiados.length && `Ha cambiado el precio o la unidad de: ${r.cambiados.join(", ")}.`,
    r.noDisponibles.length && `Ya no están disponibles y se han quitado de tu selección: ${r.noDisponibles.map((p) => p.nombre || "un producto").join(", ")}.`,
    "Revisa tu selección y vuelve a enviarla.",
  ].filter(Boolean).join(" ");
}

export function quitarProductos(seleccion: Record<number, number>, ids: number[]): Record<number, number> {
  const resto = { ...seleccion };
  ids.forEach((id) => delete resto[id]);
  return resto;
}
