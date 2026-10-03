// Gasto por empleado a partir del uso de tokens que devuelve cada API, con una tabla de precios editable
// (USD por millón de tokens, en precios.json) y un tope mensual por empleado (13 USD por defecto).
// Sin claves: son archivos de texto en los datos de la app.
import fs from "node:fs";
import path from "node:path";
import type { Uso } from "./proveedores";

export const TOPE_POR_DEFECTO = 13;
export interface Precio { entrada: number; salida: number } // USD por millón de tokens

const leer = <T>(archivo: string, vacio: T): T => {
  try {
    return JSON.parse(fs.readFileSync(archivo, "utf8"));
  } catch {
    return vacio;
  }
};
const mes = (t = new Date()) => t.toISOString().slice(0, 7); // ponytail: mes en UTC

export class Gasto {
  constructor(readonly datos: string) {}
  private get archivoPrecios() {
    return path.join(this.datos, "precios.json");
  }
  private get archivoGasto() {
    return path.join(this.datos, "gasto.json");
  }

  // Clave de la tabla: "<proveedor>:<modelo>", la misma que va en el perfil sin el prefijo "nube:".
  precio(modelo: string): Precio | undefined {
    const p = leer<Record<string, Precio>>(this.archivoPrecios, {})[modelo];
    return p && Number.isFinite(p.entrada) && Number.isFinite(p.salida) && p.entrada >= 0 && p.salida >= 0 ? p : undefined;
  }
  ponerPrecio(modelo: string, p: Precio) {
    const tabla = leer<Record<string, Precio>>(this.archivoPrecios, {});
    tabla[modelo] = { entrada: p.entrada, salida: p.salida };
    fs.mkdirSync(this.datos, { recursive: true });
    fs.writeFileSync(this.archivoPrecios, JSON.stringify(tabla, null, 2));
  }

  // Tokens que devolvió el servidor, por empleado y mes (también donde no hay precios, como el servidor remoto).
  sumarTokens(empleado: string, uso: Uso) {
    const archivo = path.join(this.datos, "tokens.json");
    const t = leer<Record<string, Record<string, [number, number]>>>(archivo, {});
    const e = ((t[empleado] ??= {})[mes()] ??= [0, 0]);
    e[0] += uso.entrada;
    e[1] += uso.salida;
    fs.mkdirSync(this.datos, { recursive: true });
    fs.writeFileSync(archivo, JSON.stringify(t, null, 2));
  }
  tokens(empleado: string): { mes: [number, number]; total: [number, number] } {
    const m = leer<Record<string, Record<string, [number, number]>>>(path.join(this.datos, "tokens.json"), {})[empleado] ?? {};
    const total = Object.values(m).reduce<[number, number]>((a, [e, s]) => [a[0] + e, a[1] + s], [0, 0]);
    return { mes: m[mes()] ?? [0, 0], total };
  }

  delMes(empleado: string): number {
    return leer<Record<string, Record<string, number>>>(this.archivoGasto, {})[empleado]?.[mes()] ?? 0;
  }
  // Suma lo que costó un turno y devuelve el total del mes.
  sumar(empleado: string, uso: Uso, p: Precio): number {
    const g = leer<Record<string, Record<string, number>>>(this.archivoGasto, {});
    const e = (g[empleado] ??= {});
    e[mes()] = (e[mes()] ?? 0) + (uso.entrada * p.entrada + uso.salida * p.salida) / 1e6;
    fs.mkdirSync(this.datos, { recursive: true });
    fs.writeFileSync(this.archivoGasto, JSON.stringify(g, null, 2));
    return e[mes()];
  }
}
