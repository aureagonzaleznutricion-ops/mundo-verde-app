"use client";

import { useState, useMemo, useEffect } from "react";
import { supabase } from "../supabase";
import { enviarReserva, avisoFallo, quitarProductos } from "./reserva-cliente";
import { dibujoDe } from "./dibujos";
import { MAX_NOMBRE, MAX_OTROS, MAX_OBSERVACIONES, MAX_CANTIDAD } from "../api/reserva/logica";

const UNIDADES = ["kg","unidade","mollo","manoxo","bolsa","bandexa","tarrina","tarrina 250g"];
const isEntera = (u: string) => ["unidade","mollo","manoxo","bolsa","bandexa","tarrina","tarrina 250g"].includes(u);
// Productos por kg que el cliente pide por piezas: se guardan con esta unidad y precio 0 (se pesan en tienda)
const UDS = "uds";
const fmtCant = (c: any, u: string) => u==="kg" ? String(parseFloat(parseFloat(c).toFixed(1))) : String(parseFloat(c));
const DIAS_SEMANA = ["lunes","martes","miercoles","jueves","viernes","sabado","domingo"];
const DIAS_LABELS: Record<string,string> = { lunes:"Lunes", martes:"Martes", miercoles:"Miércoles", jueves:"Jueves", viernes:"Viernes", sabado:"Sábado", domingo:"Domingo" };

type HorarioDia = { activo: boolean; inicio: string; fin: string };
type Horario = Record<string, HorarioDia>;

type Producto = {
  id: number; nombre: string; emoji: string; unidad: string;
  categoria: string; imagen_url?: string; precio?: number; activo: boolean;
};
type ProductoConCantidad = Producto & { cantidad: number };
type Pedido = {
  id: number; fecha: string; hora: string;
  cliente: { nombre: string; telefono: string; email: string };
  productos: ProductoConCantidad[];
  otros: string; observaciones: string; dia_recogida: string; estado: string;
};

function exportarCSV(pedidos: Pedido[]) {
  const filas = [["ID","Fecha","Hora","Cliente","Teléfono","Email","Día Recogida","Producto","Cantidad","Unidad","Precio/u","Subtotal","Otros","Observaciones","Estado"]];
  pedidos.forEach(p => {
    if (p.productos.length === 0 && p.otros) {
      filas.push([String(p.id), p.fecha, p.hora, p.cliente.nombre, p.cliente.telefono, p.cliente.email, p.dia_recogida||"", "", "", "", "", "", p.otros, p.observaciones||"", p.estado]);
    } else {
      p.productos.forEach((prod, i) => {
        const subtotal = ((prod.precio||0)*prod.cantidad).toFixed(2);
        filas.push([String(p.id), p.fecha, p.hora, p.cliente.nombre, p.cliente.telefono, p.cliente.email, i===0?(p.dia_recogida||""):"", prod.nombre, String(prod.cantidad), prod.unidad, String(prod.precio||0), subtotal, i===0?(p.otros||""):"", i===0?(p.observaciones||""):"", i===0?p.estado:""]);
      });
    }
  });
  const totales: Record<string,{cantidad:number;unidad:string;emoji:string}> = {};
  pedidos.forEach(p => p.productos.forEach((prod:any) => {
    const k = `${prod.nombre}|${prod.unidad}`;
    if (!totales[k]) totales[k] = {cantidad:0,unidad:prod.unidad,emoji:prod.emoji};
    totales[k].cantidad += parseFloat(prod.cantidad);
  }));
  filas.push([]); filas.push(["TOTALES POR PRODUCTO"]); filas.push(["Producto","Cantidad total","Unidad"]);
  Object.entries(totales).sort((a,b)=>b[1].cantidad-a[1].cantidad).forEach(([k,data]) => {
    filas.push([k.split("|")[0], fmtCant(data.cantidad,data.unidad), data.unidad]);
  });
  const csv = filas.map(f=>f.map(v=>`"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv],{type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href=url; a.download="pedidos_mundo_verde.csv"; a.click();
  URL.revokeObjectURL(url);
}

const HORARIO_DEFAULT: Horario = {
  lunes:{activo:true,inicio:"09:00",fin:"14:00"}, martes:{activo:true,inicio:"09:00",fin:"20:00"},
  miercoles:{activo:true,inicio:"09:00",fin:"14:00"}, jueves:{activo:true,inicio:"09:00",fin:"20:00"},
  viernes:{activo:true,inicio:"09:00",fin:"20:00"}, sabado:{activo:true,inicio:"09:00",fin:"14:00"},
  domingo:{activo:false,inicio:"09:00",fin:"14:00"},
};
const FORM_VACIO = {nombre:"",emoji:"🌿",unidad:"kg",categoria:"fruta",precio:0};

// Cabecera de las pantallas que ve el cliente: letras del logo, una línea de texto y el símbolo en el círculo
function CabeceraCliente({ texto }: { texto: string }) {
  return (
    <header style={{background:"#fff",borderRadius:"0 0 24px 24px",boxShadow:"0 4px 16px rgba(27,42,34,0.06)",padding:"16px 20px",marginBottom:"1.25rem",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
      <div style={{display:"flex",flexDirection:"column",gap:6,minWidth:0}}>
        <h1 style={{margin:0,lineHeight:0}}><img src="/logo-texto.png" alt="Mundo Verde" width={185} height={24} style={{height:24,width:"auto",display:"block"}} /></h1>
        <p style={{margin:0,fontSize:13,color:"#55645b"}}>{texto}</p>
      </div>
      <div style={{width:52,height:52,flex:"none",borderRadius:26,background:"#fff",boxShadow:"0 0 0 1px #dde3da",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <img src="/logo-simbolo.png" alt="" width={40} height={31} style={{width:40,height:"auto",display:"block"}} />
      </div>
    </header>
  );
}

export default function ReservasApp() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [vista, setVista] = useState("cliente");
  const [cantidades, setCantidades] = useState<Record<number,number>>({});
  const [unidadesSel, setUnidadesSel] = useState<Record<number,number>>({});
  const [cliente, setCliente] = useState({nombre:"",telefono:"",email:""});
  const [errores, setErrores] = useState<Record<string,string>>({});
  const [avisoEnvio, setAvisoEnvio] = useState("");
  const [confirmada, setConfirmada] = useState<(Pedido & {whatsapp:boolean})|null>(null);
  const [otrosProductos, setOtrosProductos] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [diaRecogida, setDiaRecogida] = useState("");
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [emailPanel, setEmailPanel] = useState("");
  const [passPanel, setPassPanel] = useState("");
  const [entrandoPanel, setEntrandoPanel] = useState(false);
  const [panelDesbloqueado, setPanelDesbloqueado] = useState(false);
  const [errorPanel, setErrorPanel] = useState("");
  const [panelTab, setPanelTab] = useState("resumen");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [filtroFecha, setFiltroFecha] = useState("");
  const [formProd, setFormProd] = useState(FORM_VACIO);
  const [editandoId, setEditandoId] = useState<number|null>(null);
  const [filtroCat, setFiltroCat] = useState("todos");
  const [busqueda, setBusqueda] = useState("");
  const [buscaCliente, setBuscaCliente] = useState("");
  // Texto que el cliente está escribiendo en un contador (para poder teclear "1,5" sin que se borre la coma)
  const [escribiendo, setEscribiendo] = useState<{clave:string;texto:string}|null>(null);
  const [catCliente, setCatCliente] = useState<"todos"|"fruta"|"verdura">("todos");
  const [confirmEliminar, setConfirmEliminar] = useState<number|null>(null);
  const [guardando, setGuardando] = useState(false);
  const [horario, setHorario] = useState<Horario>(HORARIO_DEFAULT);
  const [cierres, setCierres] = useState<string[]>([]);
  const [mensajeCierre, setMensajeCierre] = useState("En este momento no estamos recibiendo reservas.");
  const [nuevoCierre, setNuevoCierre] = useState("");
  const [guardandoConfig, setGuardandoConfig] = useState(false);
  const [reservasAbiertas, setReservasAbiertas] = useState(true);
  // Stock de ClassicGes (solo panel de la tienda; los clientes no pueden leerlo)
  const [stockCG, setStockCG] = useState<Record<number, number | null>>({});
  const [sincCG, setSincCG] = useState<string>("");

  const hoy = new Date();

  const estaAbierto = (h: Horario, c: string[]) => {
    const ahora = new Date();
    const fechaStr = ahora.toISOString().split("T")[0];
    if (c.includes(fechaStr)) return false;
    const diasJS = ["domingo","lunes","martes","miercoles","jueves","viernes","sabado"];
    const diaKey = diasJS[ahora.getDay()];
    const diaConfig = h[diaKey];
    if (!diaConfig?.activo) return false;
    const horaActual = ahora.getHours() * 60 + ahora.getMinutes();
    const [hI, mI] = diaConfig.inicio.split(":").map(Number);
    const [hF, mF] = diaConfig.fin.split(":").map(Number);
    return horaActual >= hI*60+mI && horaActual < hF*60+mF;
  };

  useEffect(() => {
    cargarProductos(); cargarConfiguracion();
    supabase.auth.getSession().then(({ data }) => { if (data.session) setPanelDesbloqueado(true); });
  }, []);

  useEffect(() => {
    if (panelDesbloqueado && panelTab === "productos") cargarStockCG();
  }, [panelDesbloqueado, panelTab]);

  useEffect(() => {
    if (panelDesbloqueado) cargarPedidos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelDesbloqueado]);

  const cargarConfiguracion = async () => {
    const { data } = await supabase.from("configuracion").select("*");
    if (data) {
      let hParsed = HORARIO_DEFAULT;
      let cParsed: string[] = [];
      data.forEach((row: any) => {
        if (row.clave === "horario") { try { hParsed = JSON.parse(row.valor); setHorario(hParsed); } catch {} }
        if (row.clave === "cierres_puntuales") { try { cParsed = JSON.parse(row.valor); setCierres(cParsed); } catch {} }
        if (row.clave === "mensaje_cierre") setMensajeCierre(row.valor);
      });
      setReservasAbiertas(estaAbierto(hParsed, cParsed));
    }
  };

  const guardarConfiguracion = async () => {
    setGuardandoConfig(true);
    await supabase.from("configuracion").upsert({clave:"horario", valor:JSON.stringify(horario)}, {onConflict:"clave"});
    await supabase.from("configuracion").upsert({clave:"cierres_puntuales", valor:JSON.stringify(cierres)}, {onConflict:"clave"});
    await supabase.from("configuracion").upsert({clave:"mensaje_cierre", valor:mensajeCierre}, {onConflict:"clave"});
    setReservasAbiertas(estaAbierto(horario, cierres));
    setGuardandoConfig(false);
  };

  const cargarProductos = async (conEspera = true) => {
    if (conEspera) setCargando(true);
    const { data } = await supabase.from("productos").select("*").order("categoria").order("nombre");
    if (data) setProductos(data);
    setCargando(false);
  };

  const cargarStockCG = async () => {
    const { data } = await supabase.from("cg_stock_productos").select("producto_id,stock,ultima_sincronizacion");
    if (!data) return;
    const m: Record<number, number | null> = {};
    let sinc = "";
    data.forEach((r: any) => { m[r.producto_id] = r.stock === null ? null : Number(r.stock); if (r.ultima_sincronizacion) sinc = r.ultima_sincronizacion; });
    setStockCG(m);
    setSincCG(sinc ? new Date(sinc).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
  };

  const cargarPedidos = async () => {
    const { data: pedidosData } = await supabase.from("pedidos").select("*").order("creado_at",{ascending:false});
    if (!pedidosData) return;
    const pedidosConProductos: Pedido[] = await Promise.all(pedidosData.map(async p => {
      const { data: prods } = await supabase.from("pedido_productos").select("*").eq("pedido_id", p.id);
      return { id:p.id, fecha:p.fecha, hora:p.hora, cliente:{nombre:p.cliente_nombre,telefono:p.cliente_telefono,email:p.cliente_email}, productos:prods||[], otros:p.otros||"", observaciones:p.observaciones||"", dia_recogida:p.dia_recogida||"", estado:p.estado };
    }));
    setPedidos(pedidosConProductos);
  };

  const setCantidad = (id: number, val: string|number) => {
    const n = Math.min(MAX_CANTIDAD, Math.max(0, parseFloat(parseFloat(String(val||0)).toFixed(1))));
    setCantidades(prev => ({...prev,[id]:n}));
    if (n>0) setUnidadesSel(prev => ({...prev,[id]:0}));
  };
  const setUnidades = (id: number, val: string|number) => {
    const n = Math.min(MAX_CANTIDAD, Math.max(0, Math.round(parseFloat(String(val||0)) || 0)));
    setUnidadesSel(prev => ({...prev,[id]:n}));
    if (n>0) setCantidades(prev => ({...prev,[id]:0}));
  };

  // Cada producto elegido, con su cantidad: en kg (con precio) o en unidades (sin precio, se pesa en tienda)
  const productosSeleccionados: ProductoConCantidad[] = productos.flatMap(p =>
    cantidades[p.id] > 0 ? [{...p, cantidad:cantidades[p.id]}]
    : unidadesSel[p.id] > 0 && p.unidad==="kg" ? [{...p, cantidad:unidadesSel[p.id], unidad:UDS, precio:0}]
    : []);
  const hayPorUnidades = productosSeleccionados.some(p => p.unidad===UDS);
  const totalPedido = productosSeleccionados.reduce((sum,p) => sum+((p.precio||0)*p.cantidad), 0);

  const validar = () => {
    const e: Record<string,string> = {};
    if (!cliente.nombre.trim()) e.nombre = "El nombre es obligatorio";
    if (!cliente.telefono.trim()) e.telefono = "El teléfono es obligatorio";
    if (cliente.email.trim() && !/\S+@\S+\.\S+/.test(cliente.email)) e.email = "Email no válido";
    if (productosSeleccionados.length===0 && !otrosProductos.trim()) e.productos = "Selecciona al menos un producto";
    if (!diaRecogida) e.diaRecogida = "Por favor selecciona el día de recogida";
    setErrores(e); return Object.keys(e).length===0;
  };

  const enviarPedido = async () => {
    if (!validar()) return;
    setGuardando(true); setAvisoEnvio("");
    const resultado = await enviarReserva({
      cliente,
      lineas: productosSeleccionados.map(p => {
        const visto = productos.find(x => x.id===p.id)!; // precio y unidad tal como se muestran en la lista
        return { producto_id:p.id, cantidad:p.cantidad, porUnidades:p.unidad===UDS, precioVisto:visto.precio||0, unidadVista:visto.unidad };
      }),
      otros:otrosProductos.trim(), observaciones:observaciones.trim(), dia_recogida:diaRecogida,
    });
    if (resultado.estado==="guardada") {
      const { id, fecha, hora, whatsapp } = resultado;
      const nuevoPedido: Pedido = { id, fecha, hora, cliente:{...cliente}, productos:resultado.lineas.map(l=>({...l, id:l.producto_id, categoria:"", activo:true})), otros:otrosProductos.trim(), observaciones:observaciones.trim(), dia_recogida:diaRecogida, estado:"pendiente" };
      setPedidos(prev => [nuevoPedido,...prev]);
      setConfirmada({...nuevoPedido, whatsapp});
      setVista("confirmacion");
    } else {
      if (resultado.estado==="cambios") {
        await cargarProductos(false);
        const ids = resultado.noDisponibles.map(p => p.id);
        setCantidades(prev => quitarProductos(prev, ids));
        setUnidadesSel(prev => quitarProductos(prev, ids));
      }
      setAvisoEnvio(avisoFallo(resultado));
    }
    setGuardando(false);
  };

  const nuevaReserva = () => {
    setCantidades({}); setUnidadesSel({}); setCliente({nombre:"",telefono:"",email:""}); setOtrosProductos(""); setObservaciones(""); setDiaRecogida(""); setErrores({}); setAvisoEnvio(""); setConfirmada(null); setVista("cliente");
  };

  const entrarPanel = async () => {
    setEntrandoPanel(true); setErrorPanel("");
    const { error } = await supabase.auth.signInWithPassword({ email: emailPanel.trim(), password: passPanel });
    setEntrandoPanel(false);
    if (error) { setErrorPanel("Email o contraseña incorrectos"); return; }
    setPassPanel(""); setPanelDesbloqueado(true);
  };

  const salirPanel = async () => {
    await supabase.auth.signOut();
    setPanelDesbloqueado(false); setPedidos([]); setVista("cliente");
  };

  const cambiarEstado = async (id: number, estado: string) => {
    await supabase.from("pedidos").update({estado}).eq("id",id);
    setPedidos(prev => prev.map(p => p.id===id?{...p,estado}:p));
  };

  const eliminarPedido = async (id: number) => {
    await supabase.from("pedido_productos").delete().eq("pedido_id",id);
    await supabase.from("pedidos").delete().eq("id",id);
    setPedidos(prev => prev.filter(p => p.id!==id));
  };

  const pedidosFiltrados = useMemo(() => pedidos.filter(p => {
    if (filtroEstado!=="todos" && p.estado!==filtroEstado) return false;
    if (filtroFecha && p.fecha!==new Date(filtroFecha).toLocaleDateString("es-ES")) return false;
    return true;
  }), [pedidos, filtroEstado, filtroFecha]);

  const totalesPorProducto = useMemo(() => {
    const t: Record<string,{cantidad:number;unidad:string;emoji:string}> = {};
    pedidosFiltrados.forEach(p => p.productos.forEach((prod:any) => {
      const k = `${prod.nombre}|${prod.unidad}`;
      if (!t[k]) t[k] = {cantidad:0,unidad:prod.unidad,emoji:prod.emoji};
      t[k].cantidad += parseFloat(prod.cantidad);
    }));
    return t;
  }, [pedidosFiltrados]);

  const stats = useMemo(() => ({
    total:pedidos.length, pendientes:pedidos.filter(p=>p.estado==="pendiente").length,
    confirmados:pedidos.filter(p=>p.estado==="confirmado").length, gestionados:pedidos.filter(p=>p.estado==="gestionado").length,
  }), [pedidos]);

  const guardarProducto = async () => {
    if (!formProd.nombre.trim()) return;
    setGuardando(true);
    if (editandoId!==null) {
      await supabase.from("productos").update(formProd).eq("id",editandoId);
      setProductos(prev => prev.map(p=>p.id===editandoId?{...p,...formProd}:p).sort((a,b) => {
        if(a.categoria!==b.categoria) return a.categoria.localeCompare(b.categoria);
        return a.nombre.localeCompare(b.nombre);
      }));
      setEditandoId(null);
    } else {
      const { data } = await supabase.from("productos").insert({...formProd,activo:true}).select().single();
      if (data) setProductos(prev => [...prev,data].sort((a,b) => {
        if(a.categoria!==b.categoria) return a.categoria.localeCompare(b.categoria);
        return a.nombre.localeCompare(b.nombre);
      }));
    }
    setFormProd(FORM_VACIO); setGuardando(false);
  };

  const iniciarEdicion = (p: Producto) => { setFormProd({nombre:p.nombre,emoji:p.emoji,unidad:p.unidad,categoria:p.categoria,precio:p.precio||0}); setEditandoId(p.id); };
  const cancelarEdicion = () => { setFormProd(FORM_VACIO); setEditandoId(null); };
  const eliminarProducto = async (id: number) => { await supabase.from("productos").update({activo:false}).eq("id",id); setProductos(prev=>prev.filter(p=>p.id!==id)); setConfirmEliminar(null); };
  const toggleActivo = async (id: number, activo: boolean) => { await supabase.from("productos").update({activo:!activo}).eq("id",id); setProductos(prev=>prev.map(p=>p.id===id?{...p,activo:!activo}:p)); };
  const productosFiltrados = productos.filter(p => {
    if(filtroCat!=="todos"&&p.categoria!==filtroCat) return false;
    if(busqueda&&!p.nombre.toLowerCase().includes(busqueda.toLowerCase())) return false;
    return true;
  });

  const s = {
    app:{fontFamily:"var(--font-raleway), system-ui, sans-serif",maxWidth:680,margin:"0 auto",paddingBottom:"2rem"},
    header:{background:"#2f6b4f",color:"#fff",padding:"1.25rem 1.5rem",borderRadius:"0 0 12px 12px",marginBottom:"1.5rem"},
    headerRow:{display:"flex",justifyContent:"space-between",alignItems:"center"},
    titulo:{margin:0,fontSize:22,fontWeight:500},
    subtitulo:{margin:"4px 0 0",fontSize:13,opacity:0.85},
    badge:{fontSize:11,background:"rgba(255,255,255,0.2)",padding:"4px 10px",borderRadius:20,cursor:"pointer",border:"none",color:"#fff"},
    seccion:{padding:"0 1rem",marginBottom:"1.5rem"},
    label:{fontSize:13,fontWeight:600,color:"var(--color-text-secondary)",marginBottom:6,display:"block"},
    input:{width:"100%",padding:"0 14px",height:48,borderRadius:16,border:"1px solid var(--color-border-tertiary)",fontSize:16,fontFamily:"inherit",boxSizing:"border-box" as const,background:"#fff",color:"inherit"},
    textarea:{width:"100%",padding:"12px 14px",borderRadius:16,border:"1px solid var(--color-border-tertiary)",fontSize:16,fontFamily:"inherit",boxSizing:"border-box" as const,background:"#fff",color:"inherit",resize:"vertical" as const,lineHeight:1.5,minHeight:80},
    card:{border:"0.5px solid var(--color-border-tertiary)",borderRadius:12,padding:"1.25rem",marginBottom:"1rem",background:"var(--color-background-primary)"},
    btnPrimary:(color?:string)=>({background:color||"#2f6b4f",color:"#fff",border:"none",borderRadius:8,padding:"9px 18px",fontSize:14,fontWeight:500,cursor:"pointer"}),
    btnSecondary:{background:"transparent",border:"0.5px solid var(--color-border-tertiary)",borderRadius:8,padding:"8px 14px",fontSize:13,cursor:"pointer",color:"inherit"},
    btnDanger:{background:"transparent",border:"0.5px solid #e24b4a",borderRadius:8,padding:"8px 14px",fontSize:13,cursor:"pointer",color:"#e24b4a"},
    resumenItem:{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"0.5px solid var(--color-border-tertiary)",fontSize:14},
    confirmBox:{background:"#fff",borderRadius:24,boxShadow:"0 2px 10px rgba(27,42,34,0.06)",padding:"1.5rem 1.25rem",margin:"1rem",textAlign:"center" as const},
    tabs:{display:"flex",gap:4,padding:"0 1rem",marginBottom:"1rem",flexWrap:"wrap" as const},
    tab:{fontSize:12,padding:"6px 12px",borderRadius:20,border:"0.5px solid var(--color-border-tertiary)",cursor:"pointer",background:"transparent",color:"inherit"},
    tabActivo:{background:"#2f6b4f",color:"#fff",border:"1px solid #2f6b4f"},
    statGrid:{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,padding:"0 1rem",marginBottom:"1.25rem"},
    statCard:{background:"var(--color-background-secondary)",borderRadius:8,padding:"0.75rem",textAlign:"center" as const},
    grid:{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))",gap:8,padding:"0 1rem"},
    categoriaHeader:{fontSize:12,fontWeight:500,color:"#2f6b4f",textTransform:"uppercase" as const,letterSpacing:1,margin:"1.25rem 0 0.5rem",padding:"0 1rem"},
    error:{color:"#e24b4a",fontSize:12,marginTop:4},
    estadoBadge:(e:string)=>({fontSize:11,padding:"2px 8px",borderRadius:20,fontWeight:500,background:e==="confirmado"?"#e8f5e9":e==="gestionado"?"#e3f2fd":"#fff3e0",color:e==="confirmado"?"#2e7d32":e==="gestionado"?"#1565c0":"#e65100"}),
    totalBox:{background:"#dcebdf",borderRadius:16,padding:"0.75rem 1rem",marginTop:"0.75rem",display:"flex",justifyContent:"space-between",alignItems:"center"},
  };

  if (vista==="confirmacion" && confirmada) {
    const ultimo = confirmada;
    const totalConfirmacion = ultimo.productos.reduce((sum,p)=>sum+((p.precio||0)*p.cantidad),0);
    return (
      <div style={s.app}>
        <CabeceraCliente texto="Fruta y verdura ecológica · Pontevedra" />
        <div style={s.confirmBox}>
          <div style={{width:60,height:60,borderRadius:30,background:"#f2a65a",margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"center"}}><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#1b2a22" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
          <h2 style={{color:"#1b2a22",margin:"0.75rem 0 0.5rem",fontSize:28}}>¡Reserva guardada!</h2>
          <p style={{color:"#555",fontSize:14,margin:"0.5rem 0 0.5rem"}}>Gracias, <strong>{ultimo.cliente.nombre}</strong>. {ultimo.whatsapp
            ? "Reserva guardada. Estamos enviándote la confirmación por WhatsApp. 💬"
            : "Reserva guardada, pero no hemos podido enviarte el WhatsApp. No hace falta que la repitas."}</p>
          {ultimo.dia_recogida && <p style={{fontSize:15,fontWeight:700,color:"#2f6b4f",margin:"0 0 1rem"}}>Recogida el {ultimo.dia_recogida.toLowerCase()} en Rúa Peregrina 54</p>}
          <div style={{textAlign:"left",marginBottom:"0.5rem"}}>
            {ultimo.productos.map(p=>(<div key={p.id} style={s.resumenItem}><span>{p.emoji} {p.nombre} × {p.cantidad} {p.unidad}</span><span style={{fontWeight:500}}>{p.unidad===UDS?"se pesa en tienda":`${((p.precio||0)*p.cantidad).toFixed(2)} €`}</span></div>))}
            {ultimo.otros && <p style={{fontSize:13,color:"#666",marginTop:8}}>📝 {ultimo.otros}</p>}
            {ultimo.observaciones && <p style={{fontSize:13,color:"#555",marginTop:4}}>💬 {ultimo.observaciones}</p>}
          </div>
          {totalConfirmacion>0 && (<div style={s.totalBox}><span style={{fontWeight:500}}>Total estimado</span><span style={{fontSize:18,fontWeight:600,color:"#2f6b4f"}}>{totalConfirmacion.toFixed(2)} €</span></div>)}
          {ultimo.productos.some(p=>p.unidad===UDS) && <p style={{fontSize:12,color:"#888",margin:"6px 0 0"}}>Los productos pedidos por unidades no están incluidos en el total: se pesan en tienda.</p>}
          <button style={{...s.btnPrimary(),width:"100%",height:52,borderRadius:26,fontSize:16,fontWeight:700,fontFamily:"inherit",marginTop:"1.25rem"}} onClick={nuevaReserva}>Hacer otra reserva</button>
        </div>
      </div>
    );
  }

  if (vista==="panel") {
    if (!panelDesbloqueado) {
      return (
        <div style={s.app}>
          <div style={s.header}><h1 style={s.titulo}>🌿 Panel de la tienda</h1><p style={s.subtitulo}>Acceso exclusivo</p></div>
          <div style={{...s.card,margin:"1rem",textAlign:"center"}}>
            <div style={{fontSize:36,marginBottom:12}}>🔒</div>
            <p style={{color:"#555",marginBottom:16,fontSize:14}}>Entra con el email y la contraseña de la tienda</p>
            <input type="email" autoComplete="username" placeholder="Email" value={emailPanel} onChange={e=>setEmailPanel(e.target.value)} style={{...s.input,maxWidth:260,margin:"0 auto 10px",display:"block",textAlign:"center"}} />
            <input type="password" autoComplete="current-password" placeholder="Contraseña" value={passPanel} onChange={e=>setPassPanel(e.target.value)} onKeyDown={e=>e.key==="Enter"&&entrarPanel()} style={{...s.input,maxWidth:260,margin:"0 auto 10px",display:"block",textAlign:"center"}} />
            {errorPanel && <p style={s.error}>{errorPanel}</p>}
            <button style={{...s.btnPrimary(),marginTop:8}} disabled={entrandoPanel} onClick={entrarPanel}>{entrandoPanel?"Entrando...":"Entrar"}</button>
            <br /><br />
            <button style={{...s.btnSecondary,fontSize:13}} onClick={()=>setVista("cliente")}>← Volver a reservas</button>
          </div>
        </div>
      );
    }

    return (
      <div style={s.app}>
        <div style={s.header}>
          <div style={s.headerRow}>
            <div><h1 style={s.titulo}>📋 Panel de la tienda</h1><p style={s.subtitulo}>Mundo Verde Pontevedra</p></div>
            <div style={{display:"flex",gap:6}}>
              <button style={s.badge} onClick={()=>exportarCSV(pedidosFiltrados)}>⬇ CSV</button>
              <button style={s.badge} onClick={()=>setVista("cliente")}>← Tienda</button>
              <button style={s.badge} onClick={salirPanel}>Salir</button>
            </div>
          </div>
        </div>

        <div style={s.statGrid}>
          {[["Total",stats.total,"#333"],["Pendientes",stats.pendientes,"#e65100"],["Confirmados",stats.confirmados,"#2e7d32"],["Gestionados",stats.gestionados,"#1565c0"]].map(([l,n,c])=>(
            <div key={String(l)} style={s.statCard}><p style={{fontSize:22,fontWeight:500,margin:0,color:String(c)}}>{n}</p><p style={{fontSize:11,color:"#888",margin:"2px 0 0"}}>{l}</p></div>
          ))}
        </div>

        <div style={s.tabs}>
          {[["resumen","📊 Totales"],["pedidos","📦 Pedidos"],["productos","🛍️ Productos"],["horario","📅 Horario"]].map(([t,l])=>(
            <button key={t} style={panelTab===t?{...s.tab,...s.tabActivo}:s.tab} onClick={()=>setPanelTab(t)}>{l}</button>
          ))}
        </div>

        {panelTab!=="productos" && panelTab!=="horario" && (
          <div style={{display:"flex",gap:8,padding:"0 1rem",marginBottom:"1rem",flexWrap:"wrap" as const,alignItems:"center"}}>
            <select style={{padding:"7px 10px",borderRadius:8,border:"0.5px solid var(--color-border-tertiary)",fontSize:13,background:"transparent",color:"inherit",cursor:"pointer"}} value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)}>
              <option value="todos">Todos los estados</option>
              <option value="pendiente">Pendientes</option>
              <option value="confirmado">Confirmados</option>
              <option value="gestionado">Gestionados</option>
            </select>
            <input type="date" style={{padding:"7px 10px",borderRadius:8,border:"0.5px solid var(--color-border-tertiary)",fontSize:13,background:"transparent",color:"inherit"}} value={filtroFecha} onChange={e=>setFiltroFecha(e.target.value)} />
            {(filtroEstado!=="todos"||filtroFecha)&&<button style={{...s.btnSecondary,padding:"5px 10px",fontSize:12}} onClick={()=>{setFiltroEstado("todos");setFiltroFecha("");}}>✕ Limpiar</button>}
            <span style={{fontSize:12,color:"#888",marginLeft:"auto"}}>{pedidosFiltrados.length} pedido{pedidosFiltrados.length!==1?"s":""}</span>
          </div>
        )}

        <div style={s.seccion}>
          {panelTab==="resumen" && (
            Object.keys(totalesPorProducto).length===0
              ? <p style={{color:"#aaa",textAlign:"center",padding:"2rem 0"}}>No hay datos</p>
              : <div style={{background:"#f0faf4",border:"1px solid #2f6b4f",borderRadius:10,padding:"1rem"}}>
                  {Object.entries(totalesPorProducto).sort((a,b)=>b[1].cantidad-a[1].cantidad).map(([k,data])=>(
                    <div key={k} style={s.resumenItem}><span>{data.emoji} {k.split("|")[0]}</span><span style={{fontWeight:500,color:"#2f6b4f"}}>{fmtCant(data.cantidad,data.unidad)} {data.unidad}</span></div>
                  ))}
                </div>
          )}

          {panelTab==="pedidos" && (
            pedidosFiltrados.length===0
              ? <p style={{color:"#aaa",textAlign:"center",padding:"2rem 0"}}>No hay pedidos</p>
              : pedidosFiltrados.map(p=>{
                  const totalPed = p.productos.reduce((sum:number,prod:any)=>sum+((prod.precio||0)*parseFloat(prod.cantidad)),0);
                  return (
                    <div key={p.id} style={s.card}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                        <div>
                          <strong style={{fontSize:14}}>{p.cliente.nombre}</strong>
                          <span style={{...s.estadoBadge(p.estado),marginLeft:8}}>{p.estado}</span>
                          {p.dia_recogida&&<span style={{fontSize:11,marginLeft:8,background:"#e8f5e9",color:"#2e7d32",padding:"2px 8px",borderRadius:20,fontWeight:500}}>📅 {p.dia_recogida}</span>}
                        </div>
                        <span style={{fontSize:12,color:"#888"}}>{p.fecha} {p.hora}</span>
                      </div>
                      <div style={{fontSize:12,color:"#666",marginBottom:8}}>📞 {p.cliente.telefono} · ✉️ {p.cliente.email}</div>
                      {p.productos.map((prod:any)=>(<div key={prod.id} style={{...s.resumenItem,fontSize:13}}><span>{prod.emoji} {prod.nombre} × {fmtCant(prod.cantidad,prod.unidad)} {prod.unidad}</span><span>{prod.precio>0?`${((prod.precio||0)*parseFloat(prod.cantidad)).toFixed(2)} €`:prod.unidad===UDS?"se pesa":""}</span></div>))}
                      {p.otros&&<div style={{marginTop:8,padding:"6px 10px",background:"#fff8e1",borderRadius:6,fontSize:12,color:"#5d4037"}}>📝 {p.otros}</div>}
                      {p.observaciones&&<div style={{marginTop:4,padding:"6px 10px",background:"#e3f2fd",borderRadius:6,fontSize:12,color:"#1565c0"}}>💬 {p.observaciones}</div>}
                      {totalPed>0&&(<div style={{...s.totalBox,marginTop:8}}><span style={{fontSize:13,fontWeight:500}}>Total estimado</span><span style={{fontSize:15,fontWeight:600,color:"#2f6b4f"}}>{totalPed.toFixed(2)} €</span></div>)}
                      <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap" as const}}>
                        {[["pendiente","⏳","#e65100"],["confirmado","✅","#2e7d32"],["gestionado","📦","#1565c0"]].map(([e,icon,color])=>(
                          <button key={e} onClick={()=>cambiarEstado(p.id,e as string)} style={{fontSize:11,padding:"4px 10px",borderRadius:20,border:"none",cursor:"pointer",background:p.estado===e?color:"var(--color-background-secondary)",color:p.estado===e?"#fff":"inherit",fontWeight:p.estado===e?500:400}}>
                            {icon} {(e as string).charAt(0).toUpperCase()+(e as string).slice(1)}
                          </button>
                        ))}
                        <button onClick={()=>eliminarPedido(p.id)} style={{fontSize:11,padding:"4px 10px",borderRadius:20,border:"0.5px solid #e24b4a",cursor:"pointer",background:"transparent",color:"#e24b4a",marginLeft:"auto"}}>🗑️ Eliminar</button>
                      </div>
                    </div>
                  );
                })
          )}

          {panelTab==="productos" && (
            <div>
              <div style={s.card}>
                <h3 style={{fontSize:15,fontWeight:500,marginBottom:12,marginTop:0}}>{editandoId!==null?"✏️ Editar producto":"➕ Añadir producto nuevo"}</h3>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                  <div style={{gridColumn:"1 / -1"}}><label style={s.label}>Nombre</label><input style={s.input} placeholder="Ej: Remolacha" value={formProd.nombre} onChange={e=>setFormProd(f=>({...f,nombre:e.target.value}))} /></div>
                  <div><label style={s.label}>Emoji</label><input style={s.input} placeholder="🥕" value={formProd.emoji} onChange={e=>setFormProd(f=>({...f,emoji:e.target.value}))} /></div>
                  <div><label style={s.label}>Unidad</label><select style={s.input} value={formProd.unidad} onChange={e=>setFormProd(f=>({...f,unidad:e.target.value}))}>{UNIDADES.map(u=><option key={u} value={u}>{u}</option>)}</select></div>
                  <div><label style={s.label}>Precio (€)</label><input type="number" min="0" step="0.01" style={s.input} placeholder="0.00" value={formProd.precio||""} onChange={e=>setFormProd(f=>({...f,precio:parseFloat(e.target.value)||0}))} /></div>
                  <div style={{gridColumn:"1 / -1"}}><label style={s.label}>Categoría</label><div style={{display:"flex",gap:8}}>{["fruta","verdura"].map(cat=>(<button key={cat} onClick={()=>setFormProd(f=>({...f,categoria:cat}))} style={{...s.btnSecondary,flex:1,background:formProd.categoria===cat?"#2f6b4f":"transparent",color:formProd.categoria===cat?"#fff":"inherit",border:formProd.categoria===cat?"1px solid #2f6b4f":"0.5px solid var(--color-border-tertiary)"}}>{cat==="fruta"?"🍎 Fruta":"🥦 Verdura"}</button>))}</div></div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button style={s.btnPrimary()} onClick={guardarProducto} disabled={!formProd.nombre.trim()||guardando}>{guardando?"Guardando...":editandoId!==null?"Guardar cambios":"Añadir producto"}</button>
                  {editandoId!==null&&<button style={s.btnSecondary} onClick={cancelarEdicion}>Cancelar</button>}
                </div>
              </div>
              <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap" as const,alignItems:"center"}}>
                <input style={{...s.input,maxWidth:200}} placeholder="🔍 Buscar..." value={busqueda} onChange={e=>setBusqueda(e.target.value)} />
                <div style={{display:"flex",gap:4}}>{["todos","fruta","verdura"].map(c=>(<button key={c} style={filtroCat===c?{...s.tab,...s.tabActivo}:s.tab} onClick={()=>setFiltroCat(c)}>{c==="todos"?"Todos":c==="fruta"?"🍎 Frutas":"🥦 Verduras"}</button>))}</div>
                <span style={{fontSize:12,color:"#888",marginLeft:"auto"}}>{productosFiltrados.length} productos{sincCG?` · stock ClassicGes del ${sincCG}`:""}</span>
              </div>
              {productosFiltrados.length===0
                ? <p style={{textAlign:"center",color:"#aaa",padding:"2rem 0"}}>No se encontraron productos</p>
                : productosFiltrados.map(p=>(
                  <div key={p.id} style={{...s.card,padding:"0.75rem 1rem",marginBottom:8,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap" as const}}>
                    {confirmEliminar===p.id?(
                      <div style={{display:"flex",alignItems:"center",gap:8,width:"100%",flexWrap:"wrap" as const}}>
                        <span style={{fontSize:13,flex:1}}>¿Eliminar <strong>{p.nombre}</strong>?</span>
                        <button style={{...s.btnPrimary("#e24b4a"),padding:"6px 12px",fontSize:12}} onClick={()=>eliminarProducto(p.id)}>Sí, eliminar</button>
                        <button style={{...s.btnSecondary,padding:"6px 12px",fontSize:12}} onClick={()=>setConfirmEliminar(null)}>Cancelar</button>
                      </div>
                    ):(
                      <>
                        <span style={{fontSize:24}}>{p.emoji}</span>
                        <div style={{flex:1}}>
                          <p style={{margin:0,fontSize:14,fontWeight:500}}>{p.nombre}</p>
                          <p style={{margin:0,fontSize:12,color:"#888"}}>por {p.unidad} · {p.categoria}{p.precio?` · ${p.precio.toFixed(2)} €/${p.unidad}`:" · sin precio"}</p>
                          {p.id in stockCG && (
                            <p style={{margin:0,fontSize:12,fontWeight:500,color:(stockCG[p.id]??0)<=0?"#c62828":"#2f6b4f"}}>
                              📦 Stock ClassicGes: {stockCG[p.id]===null?"sin dato":`${Number(stockCG[p.id]).toLocaleString("es-ES",{maximumFractionDigits:2})} ${p.unidad}`}
                            </p>
                          )}
                        </div>
                        <div style={{display:"flex",gap:6}}>
                          <button onClick={()=>toggleActivo(p.id,p.activo)} style={{fontSize:11,padding:"4px 10px",borderRadius:20,border:"none",cursor:"pointer",background:p.activo?"#e8f5e9":"#fbe9e7",color:p.activo?"#2e7d32":"#c62828",fontWeight:500}}>{p.activo?"✅ Visible":"🔴 Oculto"}</button>
                          <button style={{...s.btnSecondary,padding:"5px 10px",fontSize:12}} onClick={()=>{if(editandoId===p.id){setEditandoId(null);}else{iniciarEdicion(p);}}}>✏️ Editar</button>
                          <button style={{...s.btnDanger,padding:"5px 10px",fontSize:12}} onClick={()=>setConfirmEliminar(p.id)}>🗑️</button>
                        </div>
                        {editandoId===p.id&&(
                          <div style={{width:"100%",marginTop:12,padding:"1rem",background:"var(--color-background-secondary)",borderRadius:8}}>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                              <div style={{gridColumn:"1 / -1"}}><label style={s.label}>Nombre</label><input style={s.input} value={formProd.nombre} onChange={e=>setFormProd(f=>({...f,nombre:e.target.value}))} /></div>
                              <div><label style={s.label}>Emoji</label><input style={s.input} value={formProd.emoji} onChange={e=>setFormProd(f=>({...f,emoji:e.target.value}))} /></div>
                              <div><label style={s.label}>Precio (€)</label><input type="number" min="0" step="0.01" style={s.input} value={formProd.precio||""} onChange={e=>setFormProd(f=>({...f,precio:parseFloat(e.target.value)||0}))} /></div>
                              <div><label style={s.label}>Unidad</label><select style={s.input} value={formProd.unidad} onChange={e=>setFormProd(f=>({...f,unidad:e.target.value}))}>{UNIDADES.map(u=><option key={u} value={u}>{u}</option>)}</select></div>
                              <div><label style={s.label}>Categoría</label><select style={s.input} value={formProd.categoria} onChange={e=>setFormProd(f=>({...f,categoria:e.target.value}))}><option value="fruta">🍎 Fruta</option><option value="verdura">🥦 Verdura</option></select></div>
                            </div>
                            <div style={{display:"flex",gap:8}}>
                              <button style={s.btnPrimary()} onClick={guardarProducto} disabled={guardando}>{guardando?"Guardando...":"Guardar"}</button>
                              <button style={s.btnSecondary} onClick={cancelarEdicion}>Cancelar</button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))
              }
            </div>
          )}

          {panelTab==="horario" && (
            <div>
              <div style={s.card}>
                <h3 style={{fontSize:15,fontWeight:500,marginBottom:4,marginTop:0}}>🕐 Horario de reservas</h3>
                <p style={{fontSize:13,color:"#888",marginBottom:16}}>Define en qué días y horas se pueden hacer reservas.</p>
                {DIAS_SEMANA.map(dia=>(
                  <div key={dia} style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,flexWrap:"wrap" as const}}>
                    <div style={{width:90,fontSize:13,fontWeight:500}}>{DIAS_LABELS[dia]}</div>
                    <button onClick={()=>setHorario(h=>({...h,[dia]:{...h[dia],activo:!h[dia].activo}}))} style={{fontSize:11,padding:"4px 10px",borderRadius:20,border:"none",cursor:"pointer",background:horario[dia]?.activo?"#e8f5e9":"#fbe9e7",color:horario[dia]?.activo?"#2e7d32":"#c62828",fontWeight:500}}>
                      {horario[dia]?.activo?"✅ Abierto":"🔴 Cerrado"}
                    </button>
                    {horario[dia]?.activo&&(
                      <>
                        <input type="time" value={horario[dia]?.inicio||"09:00"} onChange={e=>setHorario(h=>({...h,[dia]:{...h[dia],inicio:e.target.value}}))} style={{...s.input,width:"auto",padding:"6px 8px",fontSize:13}} />
                        <span style={{fontSize:13,color:"#888"}}>a</span>
                        <input type="time" value={horario[dia]?.fin||"20:00"} onChange={e=>setHorario(h=>({...h,[dia]:{...h[dia],fin:e.target.value}}))} style={{...s.input,width:"auto",padding:"6px 8px",fontSize:13}} />
                      </>
                    )}
                  </div>
                ))}
              </div>

              <div style={s.card}>
                <h3 style={{fontSize:15,fontWeight:500,marginBottom:4,marginTop:0}}>🚫 Cierres puntuales</h3>
                <p style={{fontSize:13,color:"#888",marginBottom:12}}>Añade fechas concretas en las que no habrá reservas.</p>
                <div style={{display:"flex",gap:8,marginBottom:12}}>
                  <input type="date" value={nuevoCierre} onChange={e=>setNuevoCierre(e.target.value)} style={{...s.input,flex:1}} />
                  <button style={s.btnPrimary()} onClick={()=>{if(nuevoCierre&&!cierres.includes(nuevoCierre)){setCierres(c=>[...c,nuevoCierre].sort());setNuevoCierre("");}}}>Añadir</button>
                </div>
                {cierres.length===0
                  ? <p style={{fontSize:13,color:"#aaa"}}>No hay cierres puntuales añadidos.</p>
                  : cierres.map(fecha=>(
                    <div key={fecha} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"0.5px solid var(--color-border-tertiary)"}}>
                      <span style={{fontSize:13}}>📅 {new Date(fecha+"T12:00:00").toLocaleDateString("es-ES",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</span>
                      <button onClick={()=>setCierres(c=>c.filter(f=>f!==fecha))} style={{...s.btnDanger,padding:"4px 10px",fontSize:12}}>✕</button>
                    </div>
                  ))
                }
              </div>

              <div style={s.card}>
                <h3 style={{fontSize:15,fontWeight:500,marginBottom:8,marginTop:0}}>💬 Mensaje cuando está cerrado</h3>
                <textarea value={mensajeCierre} onChange={e=>setMensajeCierre(e.target.value)} rows={2} style={s.textarea} />
              </div>

              <div style={{padding:"0 0 1rem"}}>
                <button style={{...s.btnPrimary(),width:"100%",padding:"12px"}} onClick={guardarConfiguracion} disabled={guardandoConfig}>
                  {guardandoConfig?"Guardando...":"💾 Guardar configuración de horario"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Búsqueda sin tener en cuenta mayúsculas ni tildes
  const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const coincide = (p: Producto) => !buscaCliente.trim() || normalizar(p.nombre).includes(normalizar(buscaCliente));
  const frutasTodas = productos.filter(p=>p.categoria==="fruta"&&p.activo);
  const verdurasTodas = productos.filter(p=>p.categoria==="verdura"&&p.activo);
  const frutas = catCliente==="verdura" ? [] : frutasTodas.filter(coincide);
  const verduras = catCliente==="fruta" ? [] : verdurasTodas.filter(coincide);

  const renderGrid = (lista: Producto[]) => lista.map(p=>{
    const qty = cantidades[p.id]||0;
    const uds = unidadesSel[p.id]||0;
    const entera = isEntera(p.unidad);
    const elegido = qty>0 || uds>0;
    const fondoDibujo = p.categoria==="fruta" ? "#f6e3d4" : "#dcebdf";
    const contador = (valor: number, etiqueta: string, menos: () => void, mas: () => void, cambiar: (v: string) => void, paso: number) => {
      const activo = valor>0;
      const clave = `${p.id}-${etiqueta}`;
      const mostrado = escribiendo?.clave===clave ? escribiendo.texto : (valor ? String(valor).replace(".", ",") : "");
      return (
        <div style={{display:"flex",alignItems:"center",background:activo?"#dcebdf":"#eef1ea",borderRadius:20,height:40}}>
          <button type="button" aria-label={`Quitar ${etiqueta} de ${p.nombre}`} onClick={menos} style={{width:38,height:40,border:"none",background:"transparent",cursor:"pointer",fontSize:20,color:"#2f6b4f",padding:0}}>−</button>
          <label style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:3,fontSize:12,fontWeight:600,color:activo?"#1b2a22":"#55645b"}}>
            <input type="text" inputMode={paso<1?"decimal":"numeric"} autoComplete="off" value={mostrado} placeholder="0" aria-label={`${etiqueta} de ${p.nombre}`}
              onFocus={e=>{ setEscribiendo({clave,texto:mostrado}); e.target.select(); }}
              onChange={e=>{ const t=e.target.value.replace(/[^0-9.,]/g,""); setEscribiendo({clave,texto:t}); cambiar(t.replace(",",".")); }}
              onBlur={()=>setEscribiendo(null)}
              style={{width:42,height:28,boxSizing:"border-box",textAlign:"center",border:"1px solid #b9c4b6",borderRadius:8,background:"#fff",fontSize:14,fontWeight:700,color:"inherit",padding:0}} />
            {etiqueta}
          </label>
          <button type="button" aria-label={`Añadir ${etiqueta} de ${p.nombre}`} onClick={mas} style={{width:38,height:40,border:"none",background:"transparent",cursor:"pointer",fontSize:20,color:"#2f6b4f",padding:0}}>+</button>
        </div>
      );
    };
    return (
      <div key={p.id} style={{background:"#fff",borderRadius:22,padding:10,display:"flex",flexDirection:"column",gap:6,boxShadow:elegido?"0 0 0 2px #2f6b4f, 0 2px 10px rgba(27,42,34,0.06)":"0 2px 10px rgba(27,42,34,0.06)"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,minHeight:44}}>
          <div style={{width:44,height:44,flex:"none",borderRadius:14,background:fondoDibujo,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,overflow:"hidden"}}>
            {(p.imagen_url || dibujoDe(p.nombre))
              ? <img src={p.imagen_url || dibujoDe(p.nombre)!} alt="" width={40} height={40} loading="lazy" style={{width:40,height:40,objectFit:"contain"}} />
              : <span aria-hidden="true">{p.emoji}</span>}
          </div>
          <div style={{display:"flex",flexDirection:"column",minWidth:0}}>
            <span style={{fontFamily:"var(--font-lora), Georgia, serif",fontSize:14,fontWeight:600,lineHeight:1.15}}>{p.nombre}</span>
            {p.precio
              ? <span style={{fontSize:12,fontWeight:700,color:"#2f6b4f"}}>{p.precio.toFixed(2)} €/{p.unidad}</span>
              : <span style={{fontSize:12,color:"#55645b"}}>precio a consultar</span>}
          </div>
        </div>
        {contador(qty, entera ? p.unidad : "kg", ()=>setCantidad(p.id,qty-(entera?1:0.1)), ()=>setCantidad(p.id,qty+(entera?1:0.1)), v=>setCantidad(p.id,v), entera?1:0.1)}
        {p.unidad==="kg" && contador(uds, "uds", ()=>setUnidades(p.id,uds-1), ()=>setUnidades(p.id,uds+1), v=>setUnidades(p.id,v), 1)}
        {qty>0&&p.precio?<span style={{fontSize:12,fontWeight:700,color:"#2f6b4f",textAlign:"center"}}>{(p.precio*qty).toFixed(2)} €</span>:null}
        {uds>0?<span style={{fontSize:11,fontWeight:700,color:"#8a3b12",textAlign:"center"}}>Se pesa en tienda</span>:null}
      </div>
    );
  });

  if (!reservasAbiertas) {
    return (
      <div style={s.app}>
        <CabeceraCliente texto="Fruta y verdura ecológica · Pontevedra" />
        <div style={{padding:"8px 20px 4px",display:"flex",flexDirection:"column",gap:10}}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#a9481a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          <h2 style={{margin:0,fontSize:28,lineHeight:1.15}}>Ahora no aceptamos reservas</h2>
          <p style={{margin:0,fontSize:16,lineHeight:1.5,color:"#3b4a41"}}>{mensajeCierre}</p>
        </div>
        <div style={{margin:"1rem 1rem 0",background:"#fff",borderRadius:24,boxShadow:"0 2px 10px rgba(27,42,34,0.06)",padding:"16px 18px"}}>
          <h3 style={{margin:"0 0 8px",fontSize:17,fontWeight:700}}>Cuándo puedes reservar</h3>
          {DIAS_SEMANA.filter(d=>horario[d]?.activo).map(d=>(
            <div key={d} style={{display:"flex",justifyContent:"space-between",fontSize:15,padding:"4px 0"}}><span style={{color:"#55645b"}}>{DIAS_LABELS[d]}</span><span>{horario[d].inicio} – {horario[d].fin}</span></div>
          ))}
        </div>
        <div style={{margin:"0.75rem 1rem 0",background:"#fff",borderRadius:24,boxShadow:"0 2px 10px rgba(27,42,34,0.06)",padding:"16px 18px"}}>
          <h3 style={{margin:"0 0 4px",fontSize:17,fontWeight:700}}>Mientras tanto, ven a la tienda</h3>
          <p style={{margin:"0 0 8px",fontSize:14,color:"#55645b"}}>Rúa Peregrina 54, Pontevedra</p>
          {[["Lun, mié, vie","10:00–14:00 · 17:00–20:45"],["Mar, jue","9:30–14:00 · 17:00–20:45"],["Sábado","10:15–14:15"]].map(([d,h])=>(
            <div key={d} style={{display:"flex",justifyContent:"space-between",fontSize:14,padding:"3px 0"}}><span style={{color:"#55645b"}}>{d}</span><span>{h}</span></div>
          ))}
        </div>
        <p style={{textAlign:"center",marginTop:"2rem"}}><button onClick={()=>setVista("panel")} style={{background:"none",border:"none",color:"#55645b",fontSize:13,textDecoration:"underline",cursor:"pointer",padding:12}}>Acceso tienda</button></p>
      </div>
    );
  }

  return (
    <div style={s.app}>
      <CabeceraCliente texto="Recogida martes o jueves · Rúa Peregrina 54" />

      <div style={{padding:"0 14px",display:"flex",flexDirection:"column",gap:10,marginBottom:12}}>
        <input type="search" value={buscaCliente} onChange={e=>setBuscaCliente(e.target.value)} placeholder={`Buscar entre ${frutasTodas.length+verdurasTodas.length} productos…`} aria-label="Buscar productos"
          style={{height:44,borderRadius:22,border:"1px solid #dde3da",background:"#fff",padding:"0 18px",fontSize:16,fontFamily:"inherit",color:"inherit",boxSizing:"border-box",width:"100%"}} />
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {([["todos","Todo",""],["fruta","Frutas",String(frutasTodas.length)],["verdura","Verduras",String(verdurasTodas.length)]] as const).map(([cat,txt,n])=>{
            const chip = (activo: boolean, fondo: string, color: string) => ({height:36,padding:"0 16px",borderRadius:18,border:"none",cursor:"pointer",fontSize:14,fontWeight:700,fontFamily:"inherit",background:activo?fondo:"#eef1ea",color:activo?"#fff":color});
            const estilo = cat==="fruta" ? chip(catCliente===cat,"#c2581f","#8a3b12") : cat==="verdura" ? chip(catCliente===cat,"#2f6b4f","#24553f") : chip(catCliente===cat,"#1b2a22","#1b2a22");
            return <button key={cat} type="button" aria-pressed={catCliente===cat} onClick={()=>setCatCliente(cat)} style={estilo}>{txt}{n?` · ${n}`:""}</button>;
          })}
        </div>
        <p style={{margin:0,fontSize:12,color:"#55645b"}}>Ecológico y de temporada: el tamaño y el aspecto varían cada semana.</p>
      </div>

      {cargando?(<p style={{textAlign:"center",padding:"3rem",color:"#55645b"}}>Cargando productos...</p>):(
        <>
          {frutas.length>0 && <><h2 style={{margin:"8px 14px 8px",fontSize:20,color:"#8a3b12"}}>Frutas</h2>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(160px, 1fr))",gap:10,padding:"0 14px"}}>{renderGrid(frutas)}</div></>}
          {verduras.length>0 && <><h2 style={{margin:"18px 14px 8px",fontSize:20,color:"#24553f"}}>Verduras</h2>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(160px, 1fr))",gap:10,padding:"0 14px"}}>{renderGrid(verduras)}</div></>}
          {frutas.length===0 && verduras.length===0 && (
            <p style={{padding:"1.5rem 14px",textAlign:"center",color:"#55645b",fontSize:14}}>No encontramos «{buscaCliente}». Si lo necesitas, escríbelo abajo en «Otros productos».</p>
          )}
        </>
      )}

      {errores.productos&&<p style={{...s.error,padding:"0 1rem",marginTop:8}}>{errores.productos}</p>}

      <div style={{...s.seccion,marginTop:"1.5rem"}}>
        <h3 style={{fontSize:17,fontWeight:700,margin:"0 0 6px"}}>¿Buscas algo que no está en la lista?</h3>
        <p style={{fontSize:13,color:"#55645b",margin:"0 0 10px"}}>Escríbelo aquí y lo miramos.</p>
        <textarea placeholder="Ej: Aguacates (2 unidades), Remolacha (1 kg)..." value={otrosProductos} onChange={e=>setOtrosProductos(e.target.value)} maxLength={MAX_OTROS} rows={3} style={s.textarea} />
        <p aria-live="polite" style={otrosProductos.length>=MAX_OTROS?s.error:{fontSize:12,color:"#888",textAlign:"right",marginTop:4}}>
          {otrosProductos.length>=MAX_OTROS ? `Has llegado al máximo de ${MAX_OTROS} caracteres. Comprueba que no falte nada al final.` : `${otrosProductos.length} / ${MAX_OTROS}`}
        </p>
      </div>

      <div style={{...s.seccion,marginTop:"0"}}>
        <h3 style={{fontSize:17,fontWeight:700,margin:"0 0 6px"}}>Observaciones</h3>
        <p style={{fontSize:13,color:"#55645b",margin:"0 0 10px"}}>¿Alguna indicación para tu pedido?</p>
        <textarea placeholder="Ej: Por favor, que las manzanas sean pequeñas..." value={observaciones} onChange={e=>setObservaciones(e.target.value)} maxLength={MAX_OBSERVACIONES} rows={3} style={s.textarea} />
      </div>

      {productosSeleccionados.length>0&&(
        <div id="tu-seleccion" style={{...s.seccion,scrollMarginTop:16}}><div style={{background:"#fff",borderRadius:24,boxShadow:"0 2px 10px rgba(27,42,34,0.06)",padding:"16px 18px"}}>
          <h3 style={{fontSize:17,fontWeight:700,margin:"0 0 10px"}}>Tu cesta</h3>
          {productosSeleccionados.map(p=>(<div key={p.id} style={s.resumenItem}><span>{p.emoji} {p.nombre} × {p.cantidad} {p.unidad}</span><span style={{fontWeight:500}}>{p.unidad===UDS?"se pesa en tienda":p.precio?`${(p.precio*p.cantidad).toFixed(2)} €`:"-"}</span></div>))}
          {totalPedido>0&&(<div style={s.totalBox}><span style={{fontWeight:500}}>Total estimado</span><span style={{fontSize:18,fontWeight:600,color:"#2f6b4f"}}>{totalPedido.toFixed(2)} €</span></div>)}
          {hayPorUnidades&&<p style={{fontSize:12,color:"#55645b",margin:"6px 0 0"}}>Los productos pedidos por unidades no están incluidos en el total: se pesan en tienda.</p>}
        </div></div>
      )}

      <div style={s.seccion}>
        <h3 style={{fontSize:17,fontWeight:700,margin:"0 0 10px"}}>¿Qué día lo recoges?</h3>
        <div style={{display:"flex",gap:10,marginBottom:6}}>
          {["Martes","Jueves"].map(dia=>(
            <button key={dia} type="button" aria-pressed={diaRecogida===dia} onClick={()=>setDiaRecogida(dia)} style={{flex:1,height:56,borderRadius:18,border:diaRecogida===dia?"none":"1px solid var(--color-border-tertiary)",background:diaRecogida===dia?"#2f6b4f":"#fff",color:diaRecogida===dia?"#fff":"inherit",fontWeight:diaRecogida===dia?700:600,fontSize:16,fontFamily:"inherit",cursor:"pointer"}}>
              {diaRecogida===dia?"✓ ":""}{dia}
            </button>
          ))}
        </div>
        {errores.diaRecogida&&<p style={s.error}>{errores.diaRecogida}</p>}
      </div>

      <div style={s.seccion}>
        <h3 style={{fontSize:17,fontWeight:700,margin:"0 0 12px"}}>Tus datos</h3>
        {([["nombre","Nombre completo","María García"],["telefono","Teléfono","600 000 000"],["email","Email (opcional)","maria@email.com"]] as [keyof typeof cliente,string,string][]).map(([campo,lbl,ph])=>(
          <div key={campo} style={{marginBottom:12}}>
            <label style={s.label}>{lbl}</label>
            <input placeholder={ph} maxLength={campo==="nombre"?MAX_NOMBRE:campo==="telefono"?30:200} value={cliente[campo]} onChange={e=>setCliente(c=>({...c,[campo]:e.target.value}))} type={campo==="email"?"email":campo==="telefono"?"tel":"text"} autoComplete={campo==="nombre"?"name":campo==="telefono"?"tel":"email"} style={{...s.input,border:errores[campo]?"1.5px solid #c62828":"1px solid var(--color-border-tertiary)"}} />
            {errores[campo]&&<p style={s.error}>{errores[campo]}</p>}
          </div>
        ))}
        {avisoEnvio&&<p role="alert" style={{...s.error,fontSize:14,lineHeight:1.5,border:"1px solid #e24b4a",borderRadius:8,padding:"10px 12px",marginBottom:8}}>{avisoEnvio}</p>}
        <button style={{...s.btnPrimary(),width:"100%",height:54,borderRadius:27,fontSize:17,fontWeight:700,fontFamily:"inherit",marginTop:4,opacity:guardando?0.7:1}} onClick={enviarPedido} disabled={guardando}>
          {guardando?"Enviando...":"Enviar reserva"}
        </button>
        <p style={{fontSize:12,color:"#888",textAlign:"center",marginTop:8}}>Te contactaremos en menos de 24h para confirmar disponibilidad</p>
      </div>
      <p style={{textAlign:"center",marginTop:"2rem"}}><button onClick={()=>setVista("panel")} style={{background:"none",border:"none",color:"#55645b",fontSize:13,textDecoration:"underline",cursor:"pointer",padding:12}}>Acceso tienda</button></p>

      {/* Barra fija con lo que lleva el cliente: siempre a mano mientras elige */}
      {productosSeleccionados.length>0 && (
        <>
          <div style={{height:96}} aria-hidden="true" />
          <div style={{position:"fixed",left:0,right:0,bottom:0,padding:"0 16px calc(16px + env(safe-area-inset-bottom))",pointerEvents:"none",zIndex:20}}>
            <div style={{maxWidth:648,margin:"0 auto",pointerEvents:"auto",minHeight:62,boxSizing:"border-box",padding:"10px 10px 10px 20px",borderRadius:31,background:"#1b2a22",color:"#fff",display:"flex",alignItems:"center",gap:12,boxShadow:"0 8px 24px rgba(27,42,34,0.25)"}}>
              <div style={{display:"flex",flexDirection:"column",flex:1,minWidth:0}}>
                <span style={{fontSize:13,color:"#c9d6cd"}}>{productosSeleccionados.length} {productosSeleccionados.length===1?"producto":"productos"}{totalPedido>0?" · total estimado":""}</span>
                <span style={{fontSize:17,fontWeight:700}}>
                  {totalPedido>0 ? `${totalPedido.toFixed(2).replace(".", ",")} €` : "Se pesa en tienda"}
                  {totalPedido>0 && hayPorUnidades && <span style={{fontSize:13,fontWeight:600,color:"#c9d6cd"}}> + lo que se pese</span>}
                </span>
              </div>
              <button type="button" onClick={()=>document.getElementById("tu-seleccion")?.scrollIntoView({behavior:"smooth"})}
                style={{background:"#f2a65a",color:"#1b2a22",fontWeight:700,fontSize:15,padding:"0 20px",height:44,borderRadius:22,border:"none",cursor:"pointer",fontFamily:"inherit",flex:"none"}}>Ver cesta</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
