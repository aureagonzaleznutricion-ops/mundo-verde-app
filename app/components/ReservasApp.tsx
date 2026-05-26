"use client";

import { useState, useMemo, useEffect } from "react";
import { supabase } from "../supabase";

const UNIDADES = ["kg","unidade","mollo","manoxo","bolsa","bandexa","tarrina","tarrina 250g"];
const isEntera = (u: string) => ["unidade","mollo","manoxo","bolsa","bandexa","tarrina","tarrina 250g"].includes(u);

type Producto = {
  id: number;
  nombre: string;
  emoji: string;
  unidad: string;
  categoria: string;
  imagen_url?: string;
  precio?: number;
  activo: boolean;
};

type ProductoConCantidad = Producto & { cantidad: number };

type Pedido = {
  id: number;
  fecha: string;
  hora: string;
  cliente: { nombre: string; telefono: string; email: string };
  productos: ProductoConCantidad[];
  otros: string;
  estado: string;
};

function exportarCSV(pedidos: Pedido[]) {
  const filas = [["ID","Fecha","Hora","Cliente","Teléfono","Email","Producto","Cantidad","Unidad","Precio/u","Subtotal","Otros","Estado"]];
  pedidos.forEach(p => {
    if (p.productos.length === 0 && p.otros) {
      filas.push([String(p.id), p.fecha, p.hora, p.cliente.nombre, p.cliente.telefono, p.cliente.email, "", "", "", "", "", p.otros, p.estado]);
    } else {
      p.productos.forEach((prod, i) => {
        const subtotal = ((prod.precio || 0) * prod.cantidad).toFixed(2);
        filas.push([String(p.id), p.fecha, p.hora, p.cliente.nombre, p.cliente.telefono, p.cliente.email, prod.nombre, String(prod.cantidad), prod.unidad, String(prod.precio || 0), subtotal, i === 0 ? (p.otros || "") : "", i === 0 ? p.estado : ""]);
      });
    }
  });
  const csv = filas.map(f => f.map(v => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "pedidos_mundo_verde.csv"; a.click();
  URL.revokeObjectURL(url);
}

const FORM_VACIO = { nombre: "", emoji: "🌿", unidad: "kg", categoria: "fruta", precio: 0 };

export default function ReservasApp() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [vista, setVista] = useState("cliente");
  const [cantidades, setCantidades] = useState<Record<number, number>>({});
  const [cliente, setCliente] = useState({ nombre: "", telefono: "", email: "" });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [otrosProductos, setOtrosProductos] = useState("");
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [codigoPanel, setCodigoPanel] = useState("");
  const [panelDesbloqueado, setPanelDesbloqueado] = useState(false);
  const [errorPanel, setErrorPanel] = useState("");
  const [panelTab, setPanelTab] = useState("resumen");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [filtroFecha, setFiltroFecha] = useState("");
  const [formProd, setFormProd] = useState(FORM_VACIO);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [filtroCat, setFiltroCat] = useState("todos");
  const [busqueda, setBusqueda] = useState("");
  const [confirmEliminar, setConfirmEliminar] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);

  const hoy = new Date();
  const esFinDeSemana = [5,6,0].includes(hoy.getDay());

  useEffect(() => {
    cargarProductos();
    cargarPedidos();
  }, []);

  const cargarProductos = async () => {
    setCargando(true);
    const { data, error } = await supabase.from("productos").select("*").order("categoria").order("nombre");
    if (!error && data) setProductos(data);
    setCargando(false);
  };

  const cargarPedidos = async () => {
    const { data: pedidosData } = await supabase.from("pedidos").select("*").order("creado_at", { ascending: false });
    if (!pedidosData) return;
    const pedidosConProductos: Pedido[] = await Promise.all(pedidosData.map(async p => {
      const { data: prods } = await supabase.from("pedido_productos").select("*").eq("pedido_id", p.id);
      return {
        id: p.id, fecha: p.fecha, hora: p.hora,
        cliente: { nombre: p.cliente_nombre, telefono: p.cliente_telefono, email: p.cliente_email },
        productos: prods || [], otros: p.otros || "", estado: p.estado,
      };
    }));
    setPedidos(pedidosConProductos);
  };

  const setCantidad = (id: number, val: string | number) => {
    const n = Math.max(0, parseFloat(parseFloat(String(val || 0)).toFixed(1)));
    setCantidades(prev => ({ ...prev, [id]: n }));
  };

  const productosSeleccionados = productos.filter(p => cantidades[p.id] > 0);

  const totalPedido = productosSeleccionados.reduce((sum, p) => {
    return sum + ((p.precio || 0) * cantidades[p.id]);
  }, 0);

  const validar = () => {
    const e: Record<string, string> = {};
    if (!cliente.nombre.trim()) e.nombre = "El nombre es obligatorio";
    if (!cliente.telefono.trim()) e.telefono = "El teléfono es obligatorio";
    if (!cliente.email.trim()) e.email = "El email es obligatorio";
    else if (!/\S+@\S+\.\S+/.test(cliente.email)) e.email = "Email no válido";
    if (productosSeleccionados.length === 0 && !otrosProductos.trim()) e.productos = "Selecciona al menos un producto o escribe uno en 'Otros productos'";
    setErrores(e); return Object.keys(e).length === 0;
  };

  const enviarPedido = async () => {
    if (!validar()) return;
    setGuardando(true);
    const fecha = hoy.toLocaleDateString("es-ES");
    const hora = hoy.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

    const { data: pedidoData, error } = await supabase.from("pedidos").insert({
      fecha, hora,
      cliente_nombre: cliente.nombre,
      cliente_telefono: cliente.telefono,
      cliente_email: cliente.email,
      otros: otrosProductos.trim(),
      estado: "pendiente",
    }).select().single();

    if (!error && pedidoData) {
      const lineas = productosSeleccionados.map(p => ({
        pedido_id: pedidoData.id,
        producto_id: p.id,
        nombre: p.nombre,
        emoji: p.emoji,
        unidad: p.unidad,
        cantidad: cantidades[p.id],
        precio: p.precio || 0,
      }));
      if (lineas.length > 0) await supabase.from("pedido_productos").insert(lineas);

      const nuevoPedido: Pedido = {
        id: pedidoData.id, fecha, hora,
        cliente: { ...cliente },
        productos: productosSeleccionados.map(p => ({ ...p, cantidad: cantidades[p.id] })),
        otros: otrosProductos.trim(), estado: "pendiente",
      };
      setPedidos(prev => [nuevoPedido, ...prev]);
      setVista("confirmacion");
    }
    setGuardando(false);
  };

  const nuevaReserva = () => {
    setCantidades({}); setCliente({ nombre: "", telefono: "", email: "" });
    setOtrosProductos(""); setErrores({}); setVista("cliente");
  };

  const cambiarEstado = async (id: number, estado: string) => {
    await supabase.from("pedidos").update({ estado }).eq("id", id);
    setPedidos(prev => prev.map(p => p.id === id ? { ...p, estado } : p));
  };

  const pedidosFiltrados = useMemo(() => pedidos.filter(p => {
    if (filtroEstado !== "todos" && p.estado !== filtroEstado) return false;
    if (filtroFecha && p.fecha !== new Date(filtroFecha).toLocaleDateString("es-ES")) return false;
    return true;
  }), [pedidos, filtroEstado, filtroFecha]);

  const totalesPorProducto = useMemo(() => {
    const t: Record<string, { cantidad: number; unidad: string; emoji: string }> = {};
    pedidosFiltrados.forEach(p => p.productos.forEach((prod: any) => {
      if (!t[prod.nombre]) t[prod.nombre] = { cantidad: 0, unidad: prod.unidad, emoji: prod.emoji };
      t[prod.nombre].cantidad += parseFloat(prod.cantidad);
    }));
    return t;
  }, [pedidosFiltrados]);

  const stats = useMemo(() => ({
    total: pedidos.length,
    pendientes: pedidos.filter(p => p.estado === "pendiente").length,
    confirmados: pedidos.filter(p => p.estado === "confirmado").length,
    gestionados: pedidos.filter(p => p.estado === "gestionado").length,
  }), [pedidos]);

  const guardarProducto = async () => {
    if (!formProd.nombre.trim()) return;
    setGuardando(true);
    if (editandoId !== null) {
      await supabase.from("productos").update(formProd).eq("id", editandoId);
      setProductos(prev => prev.map(p => p.id === editandoId ? { ...p, ...formProd } : p));
      setEditandoId(null);
    } else {
      const { data } = await supabase.from("productos").insert({ ...formProd, activo: true }).select().single();
      if (data) setProductos(prev => [...prev, data]);
    }
    setFormProd(FORM_VACIO);
    setGuardando(false);
  };

  const iniciarEdicion = (p: Producto) => {
    setFormProd({ nombre: p.nombre, emoji: p.emoji, unidad: p.unidad, categoria: p.categoria, precio: p.precio || 0 });
    setEditandoId(p.id);
  };

  const cancelarEdicion = () => { setFormProd(FORM_VACIO); setEditandoId(null); };

  const toggleActivo = async (id: number, activo: boolean) => {
  await supabase.from("productos").update({ activo: !activo }).eq("id", id);
  setProductos(prev => prev.map(p => p.id === id ? { ...p, activo: !activo } : p));
};
  const eliminarProducto = async (id: number) => {
    await supabase.from("productos").update({ activo: false }).eq("id", id);
    setProductos(prev => prev.filter(p => p.id !== id));
    setConfirmEliminar(null);
  };

  const productosFiltrados = productos.filter(p => {
    if (filtroCat !== "todos" && p.categoria !== filtroCat) return false;
    if (busqueda && !p.nombre.toLowerCase().includes(busqueda.toLowerCase())) return false;
    return true;
  });

  const s = {
    app: { fontFamily: "system-ui, sans-serif", maxWidth: 680, margin: "0 auto", paddingBottom: "2rem" },
    header: { background: "#2d6a4f", color: "#fff", padding: "1.25rem 1.5rem", borderRadius: "0 0 12px 12px", marginBottom: "1.5rem" },
    headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
    titulo: { margin: 0, fontSize: 22, fontWeight: 500 },
    subtitulo: { margin: "4px 0 0", fontSize: 13, opacity: 0.85 },
    badge: { fontSize: 11, background: "rgba(255,255,255,0.2)", padding: "4px 10px", borderRadius: 20, cursor: "pointer", border: "none", color: "#fff" },
    seccion: { padding: "0 1rem", marginBottom: "1.5rem" },
    label: { fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 6, display: "block" },
    input: { width: "100%", padding: "9px 12px", borderRadius: 8, border: "0.5px solid var(--color-border-tertiary)", fontSize: 14, boxSizing: "border-box" as const, background: "transparent", color: "inherit" },
    textarea: { width: "100%", padding: "9px 12px", borderRadius: 8, border: "0.5px solid var(--color-border-tertiary)", fontSize: 14, boxSizing: "border-box" as const, background: "transparent", color: "inherit", resize: "vertical" as const, lineHeight: 1.6, minHeight: 80 },
    card: { border: "0.5px solid var(--color-border-tertiary)", borderRadius: 12, padding: "1.25rem", marginBottom: "1rem", background: "var(--color-background-primary)" },
    btnPrimary: (color?: string) => ({ background: color || "#2d6a4f", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer" }),
    btnSecondary: { background: "transparent", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer", color: "inherit" },
    btnDanger: { background: "transparent", border: "0.5px solid #e24b4a", borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer", color: "#e24b4a" },
    resumenItem: { display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "0.5px solid var(--color-border-tertiary)", fontSize: 14 },
    aviso: { background: "#fff8e1", border: "0.5px solid #f9a825", borderRadius: 8, padding: "0.75rem 1rem", fontSize: 13, color: "#5d4037", margin: "0 1rem 1rem" },
    confirmBox: { background: "#f0faf4", border: "1px solid #2d6a4f", borderRadius: 12, padding: "1.5rem", margin: "1rem", textAlign: "center" as const },
    tabs: { display: "flex", gap: 4, padding: "0 1rem", marginBottom: "1rem", flexWrap: "wrap" as const },
    tab: { fontSize: 12, padding: "6px 12px", borderRadius: 20, border: "0.5px solid var(--color-border-tertiary)", cursor: "pointer", background: "transparent", color: "inherit" },
    tabActivo: { background: "#2d6a4f", color: "#fff", border: "1px solid #2d6a4f" },
    statGrid: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, padding: "0 1rem", marginBottom: "1.25rem" },
    statCard: { background: "var(--color-background-secondary)", borderRadius: 8, padding: "0.75rem", textAlign: "center" as const },
    grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, padding: "0 1rem" },
    categoriaHeader: { fontSize: 12, fontWeight: 500, color: "#2d6a4f", textTransform: "uppercase" as const, letterSpacing: 1, margin: "1.25rem 0 0.5rem", padding: "0 1rem" },
    error: { color: "#e24b4a", fontSize: 12, marginTop: 4 },
    estadoBadge: (e: string) => ({ fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 500, background: e === "confirmado" ? "#e8f5e9" : e === "gestionado" ? "#e3f2fd" : "#fff3e0", color: e === "confirmado" ? "#2e7d32" : e === "gestionado" ? "#1565c0" : "#e65100" }),
    totalBox: { background: "#f0faf4", border: "1px solid #2d6a4f", borderRadius: 10, padding: "0.75rem 1rem", marginTop: "0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center" },
  };

  if (vista === "confirmacion") {
    const ultimo = pedidos[0];
    const totalConfirmacion = ultimo.productos.reduce((sum, p) => sum + ((p.precio || 0) * p.cantidad), 0);
    return (
      <div style={s.app}>
        <div style={s.header}><h1 style={s.titulo}>🌿 Mundo Verde Pontevedra</h1><p style={s.subtitulo}>Reserva de productos frescos · Pontevedra</p></div>
        <div style={s.confirmBox}>
          <div style={{ fontSize: 48 }}>✅</div>
          <h2 style={{ color: "#2d6a4f", margin: "0.5rem 0" }}>¡Reserva enviada!</h2>
          <p style={{ color: "#555", fontSize: 14, margin: "0.5rem 0 1.5rem" }}>Gracias, <strong>{ultimo.cliente.nombre}</strong>. Nos pondremos en contacto contigo para confirmar.</p>
          <div style={{ textAlign: "left", marginBottom: "0.5rem" }}>
            {ultimo.productos.map(p => (
              <div key={p.id} style={s.resumenItem}>
                <span>{p.emoji} {p.nombre} × {p.cantidad} {p.unidad}</span>
                <span style={{ fontWeight: 500 }}>{((p.precio || 0) * p.cantidad).toFixed(2)} €</span>
              </div>
            ))}
            {ultimo.otros && <p style={{ fontSize: 13, color: "#666", marginTop: 8 }}>📝 {ultimo.otros}</p>}
          </div>
          {totalConfirmacion > 0 && (
            <div style={s.totalBox}>
              <span style={{ fontWeight: 500 }}>Total estimado</span>
              <span style={{ fontSize: 18, fontWeight: 600, color: "#2d6a4f" }}>{totalConfirmacion.toFixed(2)} €</span>
            </div>
          )}
          <button style={{ ...s.btnSecondary, marginTop: "1rem" }} onClick={nuevaReserva}>Nueva reserva</button>
        </div>
      </div>
    );
  }

  if (vista === "panel") {
    if (!panelDesbloqueado) {
      return (
        <div style={s.app}>
          <div style={s.header}><h1 style={s.titulo}>🌿 Panel de la tienda</h1><p style={s.subtitulo}>Acceso exclusivo</p></div>
          <div style={{ ...s.card, margin: "1rem", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
            <p style={{ color: "#555", marginBottom: 16, fontSize: 14 }}>Introduce el código de acceso</p>
            <input type="password" placeholder="Código..." value={codigoPanel} onChange={e => setCodigoPanel(e.target.value)}
              onKeyDown={e => e.key === "Enter" && (codigoPanel === "eco2024" ? (setPanelDesbloqueado(true), setErrorPanel("")) : setErrorPanel("Código incorrecto"))}
              style={{ ...s.input, maxWidth: 200, margin: "0 auto 10px", display: "block", textAlign: "center" }} />
            {errorPanel && <p style={s.error}>{errorPanel}</p>}
            <button style={{ ...s.btnPrimary(), marginTop: 8 }} onClick={() => codigoPanel === "eco2024" ? (setPanelDesbloqueado(true), setErrorPanel("")) : setErrorPanel("Código incorrecto")}>Entrar</button>
            <br /><br />
            <button style={{ ...s.btnSecondary, fontSize: 13 }} onClick={() => setVista("cliente")}>← Volver a reservas</button>
            <p style={{ fontSize: 12, color: "#aaa", marginTop: 16 }}>Código de demo: eco2024</p>
          </div>
        </div>
      );
    }

    return (
      <div style={s.app}>
        <div style={s.header}>
          <div style={s.headerRow}>
            <div><h1 style={s.titulo}>📋 Panel de la tienda</h1><p style={s.subtitulo}>Mundo Verde Pontevedra</p></div>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={s.badge} onClick={() => exportarCSV(pedidosFiltrados)}>⬇ CSV</button>
              <button style={s.badge} onClick={() => setVista("cliente")}>← Tienda</button>
            </div>
          </div>
        </div>

        <div style={s.statGrid}>
          {[["Total", stats.total, "#333"], ["Pendientes", stats.pendientes, "#e65100"], ["Confirmados", stats.confirmados, "#2e7d32"], ["Gestionados", stats.gestionados, "#1565c0"]].map(([l, n, c]) => (
            <div key={String(l)} style={s.statCard}><p style={{ fontSize: 22, fontWeight: 500, margin: 0, color: String(c) }}>{n}</p><p style={{ fontSize: 11, color: "#888", margin: "2px 0 0" }}>{l}</p></div>
          ))}
        </div>

        <div style={s.tabs}>
          {[["resumen","📊 Totales"],["pedidos","📦 Pedidos"],["productos","🛍️ Productos"]].map(([t, l]) => (
            <button key={t} style={panelTab === t ? { ...s.tab, ...s.tabActivo } : s.tab} onClick={() => setPanelTab(t)}>{l}</button>
          ))}
        </div>

        {panelTab !== "productos" && (
          <div style={{ display: "flex", gap: 8, padding: "0 1rem", marginBottom: "1rem", flexWrap: "wrap" as const, alignItems: "center" }}>
            <select style={{ padding: "7px 10px", borderRadius: 8, border: "0.5px solid var(--color-border-tertiary)", fontSize: 13, background: "transparent", color: "inherit", cursor: "pointer" }} value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
              <option value="todos">Todos los estados</option>
              <option value="pendiente">Pendientes</option>
              <option value="confirmado">Confirmados</option>
              <option value="gestionado">Gestionados</option>
            </select>
            <input type="date" style={{ padding: "7px 10px", borderRadius: 8, border: "0.5px solid var(--color-border-tertiary)", fontSize: 13, background: "transparent", color: "inherit" }} value={filtroFecha} onChange={e => setFiltroFecha(e.target.value)} />
            {(filtroEstado !== "todos" || filtroFecha) && <button style={{ ...s.btnSecondary, padding: "5px 10px", fontSize: 12 }} onClick={() => { setFiltroEstado("todos"); setFiltroFecha(""); }}>✕ Limpiar</button>}
            <span style={{ fontSize: 12, color: "#888", marginLeft: "auto" }}>{pedidosFiltrados.length} pedido{pedidosFiltrados.length !== 1 ? "s" : ""}</span>
          </div>
        )}

        <div style={s.seccion}>
          {panelTab === "resumen" && (
            Object.keys(totalesPorProducto).length === 0
              ? <p style={{ color: "#aaa", textAlign: "center", padding: "2rem 0" }}>No hay datos</p>
              : <div style={{ background: "#f0faf4", border: "1px solid #2d6a4f", borderRadius: 10, padding: "1rem" }}>
                  {Object.entries(totalesPorProducto).sort((a,b) => b[1].cantidad - a[1].cantidad).map(([nombre, data]) => (
                    <div key={nombre} style={s.resumenItem}><span>{data.emoji} {nombre}</span><span style={{ fontWeight: 500, color: "#2d6a4f" }}>{parseFloat(data.cantidad.toFixed(1))} {data.unidad}</span></div>
                  ))}
                </div>
          )}

          {panelTab === "pedidos" && (
            pedidosFiltrados.length === 0
              ? <p style={{ color: "#aaa", textAlign: "center", padding: "2rem 0" }}>No hay pedidos</p>
              : pedidosFiltrados.map(p => {
                  const totalPed = p.productos.reduce((sum: number, prod: any) => sum + ((prod.precio || 0) * parseFloat(prod.cantidad)), 0);
                  return (
                    <div key={p.id} style={s.card}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                        <div><strong style={{ fontSize: 14 }}>{p.cliente.nombre}</strong><span style={{ ...s.estadoBadge(p.estado), marginLeft: 8 }}>{p.estado}</span></div>
                        <span style={{ fontSize: 12, color: "#888" }}>{p.fecha} {p.hora}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>📞 {p.cliente.telefono} · ✉️ {p.cliente.email}</div>
                      {p.productos.map((prod: any) => (
                        <div key={prod.id} style={{ ...s.resumenItem, fontSize: 13 }}>
                          <span>{prod.emoji} {prod.nombre} × {parseFloat(prod.cantidad).toFixed(1)} {prod.unidad}</span>
                          <span>{prod.precio > 0 ? `${((prod.precio || 0) * parseFloat(prod.cantidad)).toFixed(2)} €` : ""}</span>
                        </div>
                      ))}
                      {p.otros && <div style={{ marginTop: 8, padding: "6px 10px", background: "#fff8e1", borderRadius: 6, fontSize: 12, color: "#5d4037" }}>📝 {p.otros}</div>}
                      {totalPed > 0 && (
                        <div style={{ ...s.totalBox, marginTop: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 500 }}>Total estimado</span>
                          <span style={{ fontSize: 15, fontWeight: 600, color: "#2d6a4f" }}>{totalPed.toFixed(2)} €</span>
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                        {[["pendiente","⏳","#e65100"],["confirmado","✅","#2e7d32"],["gestionado","📦","#1565c0"]].map(([e, icon, color]) => (
                          <button key={e} onClick={() => cambiarEstado(p.id, e as string)}
                            style={{ fontSize: 11, padding: "4px 10px", borderRadius: 20, border: "none", cursor: "pointer", background: p.estado === e ? color : "var(--color-background-secondary)", color: p.estado === e ? "#fff" : "inherit", fontWeight: p.estado === e ? 500 : 400 }}>
                            {icon} {(e as string).charAt(0).toUpperCase() + (e as string).slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })
          )}

          {panelTab === "productos" && (
            <div>
              <div style={s.card}>
                <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: 12, marginTop: 0 }}>
                  {editandoId !== null ? "✏️ Editar producto" : "➕ Añadir producto nuevo"}
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={s.label}>Nombre del producto</label>
                    <input style={s.input} placeholder="Ej: Remolacha" value={formProd.nombre} onChange={e => setFormProd(f => ({ ...f, nombre: e.target.value }))} />
                  </div>
                  <div>
                    <label style={s.label}>Emoji</label>
                    <input style={s.input} placeholder="🥕" value={formProd.emoji} onChange={e => setFormProd(f => ({ ...f, emoji: e.target.value }))} />
                  </div>
                  <div>
                    <label style={s.label}>Unidad</label>
                    <select style={s.input} value={formProd.unidad} onChange={e => setFormProd(f => ({ ...f, unidad: e.target.value }))}>
                      {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={s.label}>Precio (€ por unidad)</label>
                    <input type="number" min="0" step="0.01" style={s.input} placeholder="0.00" value={formProd.precio || ""} onChange={e => setFormProd(f => ({ ...f, precio: parseFloat(e.target.value) || 0 }))} />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={s.label}>Categoría</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      {["fruta","verdura"].map(cat => (
                        <button key={cat} onClick={() => setFormProd(f => ({ ...f, categoria: cat }))}
                          style={{ ...s.btnSecondary, flex: 1, background: formProd.categoria === cat ? "#2d6a4f" : "transparent", color: formProd.categoria === cat ? "#fff" : "inherit", border: formProd.categoria === cat ? "1px solid #2d6a4f" : "0.5px solid var(--color-border-tertiary)" }}>
                          {cat === "fruta" ? "🍎 Fruta" : "🥦 Verdura"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={s.btnPrimary()} onClick={guardarProducto} disabled={!formProd.nombre.trim() || guardando}>
                    {guardando ? "Guardando..." : editandoId !== null ? "Guardar cambios" : "Añadir producto"}
                  </button>
                  {editandoId !== null && <button style={s.btnSecondary} onClick={cancelarEdicion}>Cancelar</button>}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" as const, alignItems: "center" }}>
                <input style={{ ...s.input, maxWidth: 200 }} placeholder="🔍 Buscar..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
                <div style={{ display: "flex", gap: 4 }}>
                  {["todos","fruta","verdura"].map(c => (
                    <button key={c} style={filtroCat === c ? { ...s.tab, ...s.tabActivo } : s.tab} onClick={() => setFiltroCat(c)}>
                      {c === "todos" ? "Todos" : c === "fruta" ? "🍎 Frutas" : "🥦 Verduras"}
                    </button>
                  ))}
                </div>
                <span style={{ fontSize: 12, color: "#888", marginLeft: "auto" }}>{productosFiltrados.length} productos</span>
              </div>

              {productosFiltrados.length === 0
                ? <p style={{ textAlign: "center", color: "#aaa", padding: "2rem 0" }}>No se encontraron productos</p>
                : productosFiltrados.map(p => (
                  <div key={p.id} style={{ ...s.card, padding: "0.75rem 1rem", marginBottom: 8, display: "flex", alignItems: "center", gap: 12 }}>
                    {confirmEliminar === p.id ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", flexWrap: "wrap" as const }}>
                        <span style={{ fontSize: 13, flex: 1 }}>¿Eliminar <strong>{p.nombre}</strong>?</span>
                        <button style={{ ...s.btnPrimary("#e24b4a"), padding: "6px 12px", fontSize: 12 }} onClick={() => eliminarProducto(p.id)}>Sí, eliminar</button>
                        <button style={{ ...s.btnSecondary, padding: "6px 12px", fontSize: 12 }} onClick={() => setConfirmEliminar(null)}>Cancelar</button>
                      </div>
                    ) : (
                      <>
                        <span style={{ fontSize: 24 }}>{p.emoji}</span>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{p.nombre}</p>
                          <p style={{ margin: 0, fontSize: 12, color: "#888" }}>
                            por {p.unidad} · {p.categoria}
                            {p.precio ? ` · ${p.precio.toFixed(2)} €/${p.unidad}` : " · sin precio"}
                          </p>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
  <button
    onClick={() => toggleActivo(p.id, p.activo)}
    style={{ fontSize: 11, padding: "4px 10px", borderRadius: 20, border: "none", cursor: "pointer", background: p.activo ? "#e8f5e9" : "#fbe9e7", color: p.activo ? "#2e7d32" : "#c62828", fontWeight: 500 }}>
    {p.activo ? "✅ Visible" : "🔴 Oculto"}
  </button>
  <button style={{ ...s.btnSecondary, padding: "5px 10px", fontSize: 12 }} onClick={() => iniciarEdicion(p)}>✏️ Editar</button>
  <button style={{ ...s.btnDanger, padding: "5px 10px", fontSize: 12 }} onClick={() => setConfirmEliminar(p.id)}>🗑️</button>
</div>
                      </>
                    )}
                  </div>
                ))
              }
            </div>
          )}
        </div>
      </div>
    );
  }

  const frutas = productos.filter(p => p.categoria === "fruta" && p.activo);
const verduras = productos.filter(p => p.categoria === "verdura" && p.activo);

  const renderGrid = (lista: Producto[]) => lista.map(p => {
    const qty = cantidades[p.id] || 0;
    const entera = isEntera(p.unidad);
    return (
      <div key={p.id} style={{ border: qty > 0 ? "1.5px solid #2d6a4f" : "0.5px solid var(--color-border-tertiary)", borderRadius: 10, padding: "0.75rem", textAlign: "center", background: qty > 0 ? "#f0faf4" : "var(--color-background-primary)" }}>
        <span style={{ fontSize: 26, display: "block", marginBottom: 4 }}>{p.emoji}</span>
        <p style={{ fontSize: 12, fontWeight: 500, margin: "0 0 2px" }}>{p.nombre}</p>
        <p style={{ fontSize: 11, color: "#888", margin: "0 0 2px" }}>por {p.unidad}</p>
        {p.precio ? <p style={{ fontSize: 12, color: "#2d6a4f", fontWeight: 500, margin: "0 0 8px" }}>{p.precio.toFixed(2)} €/{p.unidad}</p> : <p style={{ fontSize: 11, color: "#ccc", margin: "0 0 8px" }}>precio a consultar</p>}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <button style={{ width: 24, height: 24, borderRadius: 12, border: "0.5px solid var(--color-border-tertiary)", background: "transparent", cursor: "pointer", fontSize: 15, color: "inherit" }} onClick={() => setCantidad(p.id, qty - (entera ? 1 : 0.1))}>−</button>
          <input type="number" min="0" step={entera ? 1 : 0.1} value={qty || ""} placeholder="0" onChange={e => setCantidad(p.id, e.target.value)}
            style={{ width: 40, textAlign: "center", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 6, padding: "2px", fontSize: 13, background: "transparent", color: "inherit" }} />
          <button style={{ width: 24, height: 24, borderRadius: 12, border: "0.5px solid var(--color-border-tertiary)", background: "transparent", cursor: "pointer", fontSize: 15, color: "inherit" }} onClick={() => setCantidad(p.id, qty + (entera ? 1 : 0.1))}>+</button>
        </div>
        {qty > 0 && p.precio ? <p style={{ fontSize: 12, color: "#2d6a4f", fontWeight: 500, marginTop: 6, marginBottom: 0 }}>{(p.precio * qty).toFixed(2)} €</p> : null}
      </div>
    );
  });

  return (
    <div style={s.app}>
      <div style={s.header}>
        <div style={s.headerRow}>
          <div><h1 style={s.titulo}>🌿 Mundo Verde Pontevedra</h1><p style={s.subtitulo}>Reserva de productos frescos · Pontevedra</p></div>
          <button style={s.badge} onClick={() => setVista("panel")}>Panel tienda</button>
        </div>
      </div>

      {!esFinDeSemana && <div style={s.aviso}>⏰ Las reservas están disponibles <strong>viernes, sábado y domingo</strong>. Vuelve el próximo viernes.</div>}

      <p style={{ padding: "0 1rem", fontSize: 14, color: "#666", marginBottom: "0.5rem" }}>Selecciona los productos que deseas reservar y te contactaremos para confirmar.</p>

      {cargando ? (
        <p style={{ textAlign: "center", padding: "3rem", color: "#888" }}>Cargando productos...</p>
      ) : (
        <>
          <p style={s.categoriaHeader}>🍎 Frutas</p>
          <div style={s.grid}>{renderGrid(frutas)}</div>
          <p style={s.categoriaHeader}>🥦 Verduras</p>
          <div style={s.grid}>{renderGrid(verduras)}</div>
        </>
      )}

      {errores.productos && <p style={{ ...s.error, padding: "0 1rem", marginTop: 8 }}>{errores.productos}</p>}

      <div style={{ ...s.seccion, marginTop: "1.5rem" }}>
        <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>🛒 Otros productos</h3>
        <p style={{ fontSize: 13, color: "#666", marginBottom: 10 }}>¿Buscas algo que no está en la lista? Descríbelo aquí.</p>
        <textarea placeholder="Ej: Aguacates (2 unidades), Remolacha (1 kg)..." value={otrosProductos} onChange={e => setOtrosProductos(e.target.value)} rows={3} style={s.textarea} />
      </div>

      {productosSeleccionados.length > 0 && (
        <div style={s.seccion}>
          <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: 10 }}>Tu selección</h3>
          {productosSeleccionados.map(p => (
            <div key={p.id} style={s.resumenItem}>
              <span>{p.emoji} {p.nombre} × {cantidades[p.id]} {p.unidad}</span>
              <span style={{ fontWeight: 500 }}>{p.precio ? `${(p.precio * cantidades[p.id]).toFixed(2)} €` : "-"}</span>
            </div>
          ))}
          {totalPedido > 0 && (
            <div style={s.totalBox}>
              <span style={{ fontWeight: 500 }}>Total estimado</span>
              <span style={{ fontSize: 18, fontWeight: 600, color: "#2d6a4f" }}>{totalPedido.toFixed(2)} €</span>
            </div>
          )}
        </div>
      )}

      <div style={s.seccion}>
        <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>Tus datos de contacto</h3>
        {([["nombre","Nombre completo","María García"],["telefono","Teléfono","600 000 000"],["email","Email","maria@email.com"]] as [keyof typeof cliente, string, string][]).map(([campo, lbl, ph]) => (
          <div key={campo} style={{ marginBottom: 12 }}>
            <label style={s.label}>{lbl}</label>
            <input placeholder={ph} value={cliente[campo]} onChange={e => setCliente(c => ({ ...c, [campo]: e.target.value }))}
              style={{ ...s.input, border: errores[campo] ? "0.5px solid #e24b4a" : "0.5px solid var(--color-border-tertiary)" }} />
            {errores[campo] && <p style={s.error}>{errores[campo]}</p>}
          </div>
        ))}
        <button style={{ ...s.btnPrimary(), width: "100%", padding: "12px", marginTop: 4 }} onClick={enviarPedido} disabled={guardando}>
          {guardando ? "Enviando..." : "Enviar reserva"}
        </button>
        <p style={{ fontSize: 12, color: "#888", textAlign: "center", marginTop: 8 }}>Te contactaremos en menos de 24h para confirmar disponibilidad</p>
      </div>
    </div>
  );
}