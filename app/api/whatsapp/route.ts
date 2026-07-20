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

  // Construir variable {{2}}: lista de productos + otros + observaciones
  const lineasProductos = (productos as any[])
    .map(
      (p) =>
        `${p.emoji} ${p.nombre}: ${p.cantidad} ${p.unidad}${
          p.precio ? ` - ${(p.precio * p.cantidad).toFixed(2)} EUR` : ""
        }`
    )
    .join(", ");

  let detalle = lineasProductos || "";
  if (otros) detalle += (detalle ? " | " : "") + `Otros: ${otros}`;
  if (observaciones) detalle += (detalle ? " | " : "") + `Obs: ${observaciones}`;
  if (!detalle) detalle = "Sin productos especificados";

  const totalStr = total > 0 ? (total as number).toFixed(2) : "Por confirmar";
  const diaStr = dia_recogida || "Por confirmar";

  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );

    await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
      to: `whatsapp:${numero}`,
      contentSid: "HXa8c6c7e22f3080edcdc721d11f01f685",
      contentVariables: JSON.stringify({
        "1": nombre,
        "2": detalle,
        "3": totalStr,
        "4": diaStr,
      }),
    } as any);

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
