import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import twilio from "twilio";
import { procesarReserva, SinRespuesta, type ProductoBD } from "./logica";

const STATUS = { guardada: 200, invalida: 400, cambios: 409, no_guardada: 502, desconocido: 502 } as const;

export async function POST(req: NextRequest) {
  // Clave pública y sin sesión: el mismo permiso que tiene un cliente desde el navegador.
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
    global: { fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }) },
  });

  const resultado = await procesarReserva(await req.json().catch(() => null), {
    ahora: () => new Date(),
    leerProductos: async (ids) => {
      const { data, error } = await db.from("productos").select("id,nombre,emoji,unidad,precio,activo").in("id", ids);
      if (error) throw error;
      return data as ProductoBD[];
    },
    guardarPedido: async (pedido, lineas) => {
      const { data, error } = await db.rpc("crear_pedido", { p_pedido: pedido, p_lineas: lineas });
      // Un error sin código es un fallo de conexión: no se sabe si llegó a guardarse.
      if (error) throw error.code ? error : new SinRespuesta(error.message);
      return (data as { id: number }).id;
    },
    enviarWhatsapp: async ({ numero, variables }) => {
      // El tiempo máximo evita que un Twilio lento deje al cliente sin saber que su reserva se guardó.
      const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!, { timeout: 8000 });
      await client.messages.create({
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
        to: `whatsapp:${numero}`,
        contentSid: "HXa8c6c7e22f3080edcdc721d11f01f685",
        contentVariables: JSON.stringify(variables),
      });
    },
  });

  return NextResponse.json(resultado, { status: STATUS[resultado.estado] });
}
