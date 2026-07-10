import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";

export async function POST(req: NextRequest) {
  const {
    telefono,
    nombre,
    productos,
    total,
    dia_recogida,
    otros,
    observaciones,
  } = await req.json();

  // Normalizar número al formato internacional español
  let numero = telefono.replace(/[\s\-().]/g, "");
  if (!numero.startsWith("+")) {
    numero = "+34" + numero;
  }

  // Construir texto del mensaje
  const lineasProductos = (productos as any[])
    .map(
      (p) =>
        `${p.emoji} ${p.nombre}: ${p.cantidad} ${p.unidad}${
          p.precio ? ` — ${(p.precio * p.cantidad).toFixed(2)} €` : ""
        }`
    )
    .join("\n");

  let mensaje = `🌿 *Mundo Verde Pontevedra*\n`;
  mensaje += `¡Hola ${nombre}! Hemos recibido tu reserva ✅\n\n`;
  if (lineasProductos) mensaje += `*Productos:*\n${lineasProductos}\n\n`;
  if (otros) mensaje += `📝 *Otros:* ${otros}\n\n`;
  if (observaciones) mensaje += `💬 *Observaciones:* ${observaciones}\n\n`;
  if (total > 0) mensaje += `💰 *Total estimado: ${(total as number).toFixed(2)} €*\n\n`;
  if (dia_recogida) mensaje += `📅 *Recogida:* ${dia_recogida}\n\n`;
  mensaje += `Nos pondremos en contacto contigo en menos de 24h para confirmar disponibilidad. ¡Gracias por confiar en nosotras! 🌿\n\n`;
  mensaje += `_⚠️ Este es un mensaje automático. Para consultas escríbenos al 604 034 893._`;

  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );

    await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
      to: `whatsapp:${numero}`,
      body: mensaje,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Twilio WhatsApp error:", err.message);
    // No fallamos el pedido si el WhatsApp no se envía
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}
