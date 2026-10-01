// Prueba de la instalación de Ollama sin internet: un servidor local sirve un "release" falso (un archivo
// .tar.zst con un `ollama` que, con `serve`, responde a /api/version) y su sha256sum.txt. Se comprueba que se
// descarga, se verifica, se descomprime sin root, se arranca y se apaga. En Windows (zip) no corre.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

if (process.platform === "win32") process.exit(0);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "discalaves-ollama-"));
const libre = () => new Promise<number>((ok) => { const s = http.createServer().listen(0, () => { const p = (s.address() as AddressInfo).port; s.close(() => ok(p)); }); });

void (async () => {
  // El "release": bin/ollama es un script de node que sirve /api/version en OLLAMA_HOST.
  const raiz = path.join(tmp, "release");
  fs.mkdirSync(path.join(raiz, "bin"), { recursive: true });
  fs.mkdirSync(path.join(raiz, "lib", "ollama"), { recursive: true }); // el release real trae bin/ y lib/
  fs.writeFileSync(path.join(raiz, "lib", "ollama", "libfalsa.so"), "x");
  fs.writeFileSync(path.join(raiz, "bin", "ollama"), `#!/usr/bin/env node
if (process.argv[2] === "--version") process.exit(0);
const [h, p] = process.env.OLLAMA_HOST.split(":");
if (process.env.OLLAMA_CONTEXT_LENGTH !== "16384") process.exit(3); // los ajustes de Discalaves deben llegar
require("http").createServer((q, r) => r.end(q.url === "/api/tags" ? '{"models":[]}' : '{"version":"0.0.0-falso"}')).listen(+p, h);
`, { mode: 0o755 });
  const archivo = path.join(tmp, "ollama-linux-" + (process.arch === "arm64" ? "arm64" : "amd64") + ".tar.zst");
  execFileSync("tar", ["--zstd", "-cf", archivo, "-C", raiz, "bin", "lib"]);
  const hash = createHash("sha256").update(fs.readFileSync(archivo)).digest("hex");
  const web = http.createServer((q, r) => {
    if (q.url === "/sha256sum.txt") return r.end(`${hash}  ${path.basename(archivo)}\n0000  otro.zip\n`);
    r.end(fs.readFileSync(archivo));
  }).listen(0);
  process.env.DISCALAVES_OLLAMA_BASE = `http://127.0.0.1:${(web.address() as AddressInfo).port}`;
  process.env.DISCALAVES_OLLAMA = `http://127.0.0.1:${await libre()}`;
  process.env.DISCALAVES_IA = path.join(tmp, "ia");

  const ollama = await import("./ollama"); // después de las variables: las lee al cargarse
  assert.equal(ollama.hashDe(`abc  ./x.zip\n${hash}  *${path.basename(archivo)}\n`, path.basename(archivo)), hash, "encuentra el hash por nombre");
  assert.equal(await ollama.version(), null, "no hay nada escuchando");
  await ollama.instalar(() => {});
  assert.ok(ollama.binario()!.startsWith(tmp), "queda instalado en la carpeta de la app");
  assert.equal(await ollama.asegurar(path.join(tmp, "ollama.log")), true, "arranca y responde");
  assert.equal(await ollama.version(), "0.0.0-falso");
  ollama.apagar();
  for (let i = 0; i < 20 && (await ollama.version()); i++) await new Promise((r) => setTimeout(r, 200));
  assert.equal(await ollama.version(), null, "la app lo apaga al salir");
  web.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("ollama: ok");
})();
