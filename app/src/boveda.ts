// Bóveda: los proveedores con sus claves de API y URLs con credenciales, en un único archivo cifrado de la app.
// Nunca en los perfiles (texto que se puede compartir), en el contenedor, en el prompt ni en los logs.
// Se cifra con el almacén seguro del sistema (safeStorage de Electron: llavero de GNOME/KWallet en Linux,
// DPAPI en Windows). Si no hay almacén seguro, no se guarda nada (nunca en claro) y se avisa.
import fs from "node:fs";
import type { Proveedor } from "./proveedores";

export interface Cifrador {
  disponible(): boolean;
  cifrar(texto: string): Buffer;
  descifrar(datos: Buffer): string;
}

export class SinAlmacenSeguro extends Error {
  constructor() {
    super("este sistema no tiene un almacén seguro de claves (llavero); no guardo claves sin cifrar. Instala o desbloquea el llavero del sistema y vuelve a intentarlo.");
  }
}

export class Boveda {
  constructor(readonly archivo: string, private cifrador: Cifrador) {}

  leer(): Proveedor[] {
    if (!fs.existsSync(this.archivo)) return [];
    if (!this.cifrador.disponible()) throw new SinAlmacenSeguro();
    return JSON.parse(this.cifrador.descifrar(fs.readFileSync(this.archivo)));
  }

  guardar(proveedores: Proveedor[]) {
    if (!this.cifrador.disponible()) throw new SinAlmacenSeguro();
    const tmp = `${this.archivo}.tmp`;
    fs.writeFileSync(tmp, this.cifrador.cifrar(JSON.stringify(proveedores)), { mode: 0o600 });
    fs.renameSync(tmp, this.archivo); // nunca queda a medio escribir
  }
}
