import { app, BrowserWindow } from "electron";
import path from "node:path";

function crearVentana() {
  const ventana = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: "Discalaves",
    backgroundColor: "#FFFFFF",
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  ventana.setMenuBarVisibility(false);
  ventana.loadFile(path.join(__dirname, "..", "index.html"));
}

app.whenReady().then(crearVentana);
app.on("window-all-closed", () => app.quit());
