import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dibujoDe } from "../app/components/dibujos.ts";

// Todos los productos que había en la base de datos en noviembre de 2026 (activos e inactivos)
const PRODUCTOS = ["Aguacate bacon nacional","Albaricoques","Arandanos tarrina ","Caquis","castaña galega","Cereixas","Ciruela vermella","Ciruelas amarelas:claudia","clementina","Datil Medjool Jordania","Feixoas","Figos frescos","Frambuesas","Fresas 500gr","Granada","Grosellas","Higos","Kiwi galego","Laranxa mesa","Laranxas zume","Limons","Mandarinas","Mango","Maza choupete","Maza Galaxy","Maza Golden","Maza royal gala","Maza vasca","Mazas Fuji","Melocotones","Melon piel sapo ","Mirabel (ciruela amarela)","Mora","Nectarina","Nisperos","Papaia","Paraguaio","Pera","Pera Galega","Piña","Platano","Pomelo","Sandia galega","Uvas","Acelgas ","Alcachofas","Allos","Allos tiernos","Apio","Berenxena","Boniato galego","Boniato morado galego","Brocoli","Cabaciño","Calabaza Cacahuete galega","Calabaza Potimarron galega","Castañas","Cebola branca galega","Cebola morada","Cenouras","Champiñon Portobello","chirivia","Cogollos","Couveflor","Cúrcuma","Endivia","Esparragos 250gr","Espinafres","Guisantes","Kale","Leituga Batavia","Leituga folla de roble","Lombarda","nabiza galega","Patacas galegas","Pemento verde galego","Pemento vermello","Pementos Padron","Pepino","Porros","Rabanitos galegos","Remolacha mollo","Repolo picudo","Repolo rizo","Rucula","Shitake","Tomate cherry","Tomate galego","Tomate negro","Tomates","Verza","Xenxibre","Xudias planas galega","Xudías redondas"];

test("cada producto tiene un dibujo que existe", () => {
  for (const nombre of PRODUCTOS) {
    const ruta = dibujoDe(nombre);
    assert.ok(ruta, `Sin dibujo: ${nombre}`);
    assert.ok(existsSync(`public${ruta}`), `Falta el archivo ${ruta} (${nombre})`);
  }
});

test("los parecidos no se confunden", () => {
  assert.equal(dibujoDe("Boniato morado galego"), "/productos/boniato-morado.svg");
  assert.equal(dibujoDe("Cebola morada"), "/productos/cebolla-morada.svg");
  assert.equal(dibujoDe("Mora"), "/productos/mora.svg");
  assert.equal(dibujoDe("Maza Golden"), "/productos/manzana-golden.svg");
  assert.equal(dibujoDe("Tomate negro"), "/productos/tomate-negro.svg");
  assert.equal(dibujoDe("Allos tiernos"), "/productos/ajo-tierno.svg");
  assert.equal(dibujoDe("Pemento verde galego"), "/productos/pimiento-verde.svg");
  assert.equal(dibujoDe("Mirabel (ciruela amarela)"), "/productos/ciruela-amarilla.svg");
  assert.equal(dibujoDe("Producto inventado"), null);
});
