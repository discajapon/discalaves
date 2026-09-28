// Pruebas que no necesitan GPU, Docker ni WSL: rutas y adaptadores por sistema. Corren en Linux y en el
// runner de Windows de GitHub Actions: npm run prueba:unidad
import assert from "node:assert/strict";
import { rutasPara } from "./rutas";

// Linux: igual que siempre.
let r = rutasPara("linux", {}, "/home/ana");
assert.equal(r.windows, false);
assert.equal(r.ia, "/home/ana/Documents/IA-discalves");
assert.equal(r.servidor, "/home/ana/Documents/IA-discalves/llama.cpp/llama-server");
assert.equal(r.modelo, "/home/ana/Documents/IA-discalves/modelos/Qwen3.5-9B-Q4_K_M.gguf");
assert.equal(r.datos, null, "en Linux los datos siguen donde los pone Electron");
assert.equal(r.trabajo("qwen"), "/home/ana/Documents/IA-discalves/trabajo/qwen");
assert.equal(r.enMotor("/tmp/x"), "/tmp/x", "en Linux el motor ve la misma ruta");
assert.equal(rutasPara("linux", { DISCALAVES_IA: "/srv/ia" }, "/home/ana").servidor, "/srv/ia/llama.cpp/llama-server");

// Windows: runtime, modelos y datos en %LOCALAPPDATA%\Discalaves; trabajo dentro de la distro.
r = rutasPara("win32", { LOCALAPPDATA: "C:\\Users\\Ana\\AppData\\Local" }, "C:\\Users\\Ana");
assert.equal(r.windows, true);
assert.equal(r.ia, "C:\\Users\\Ana\\AppData\\Local\\Discalaves");
assert.equal(r.servidor, "C:\\Users\\Ana\\AppData\\Local\\Discalaves\\llama.cpp\\llama-server.exe");
assert.equal(r.modelo, "C:\\Users\\Ana\\AppData\\Local\\Discalaves\\modelos\\Qwen3.5-9B-Q4_K_M.gguf");
assert.equal(r.datos, "C:\\Users\\Ana\\AppData\\Local\\Discalaves\\datos");
assert.equal(r.distro, "C:\\Users\\Ana\\AppData\\Local\\Discalaves\\wsl");
assert.equal(r.trabajo("qwen"), "\\\\wsl$\\discalaves\\home\\discalaves\\trabajo\\qwen");
assert.equal(r.enMotor(r.trabajo("qwen")), "/home/discalaves/trabajo/qwen");
assert.equal(r.enMotor("\\\\WSL$\\Discalaves\\home\\discalaves\\trabajo\\x"), "/home/discalaves/trabajo/x", "sin distinguir mayúsculas");
assert.throws(() => r.enMotor("C:\\Users\\Ana\\Documentos"), /no está dentro de la distro/, "nunca se monta una carpeta de Windows");
// Sin LOCALAPPDATA, se deduce de la carpeta del usuario; DISCALAVES_IA solo mueve runtime y modelos.
assert.equal(rutasPara("win32", {}, "C:\\Users\\Ana").datos, "C:\\Users\\Ana\\AppData\\Local\\Discalaves\\datos");
const conIA = rutasPara("win32", { LOCALAPPDATA: "C:\\L", DISCALAVES_IA: "D:\\IA" });
assert.equal(conIA.servidor, "D:\\IA\\llama.cpp\\llama-server.exe");
assert.equal(conIA.datos, "C:\\L\\Discalaves\\datos");

console.log("unidad: ok");
