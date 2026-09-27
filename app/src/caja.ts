// Argumentos de bubblewrap para la computadora aislada de cada IA: ve /usr y /etc en solo lectura,
// su carpeta como /home/<usuario>, nada de las carpetas del usuario, y tiene internet.
//
// ponytail: bubblewrap no es todavía el contenedor endurecido de CLAUDE.md: comparte la red del
// equipo (incluida la red local). Se cambia cuando llegue el motor de contenedores.

export function caja(carpeta: string, argumentos: string[], montajes: string[] = [], usuario = "qwen"): string[] {
  const home = `/home/${usuario}`;
  return [
    "--ro-bind", "/usr", "/usr",
    "--symlink", "usr/bin", "/bin", "--symlink", "usr/lib", "/lib",
    "--symlink", "usr/lib64", "/lib64", "--symlink", "usr/sbin", "/sbin",
    "--ro-bind", "/etc", "/etc",
    "--ro-bind-try", "/run/systemd/resolve", "/run/systemd/resolve", // DNS de systemd-resolved
    "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/dev/shm", "--tmpfs", "/tmp",
    "--bind", carpeta, home, "--chdir", home,
    "--unshare-all", "--share-net", "--hostname", usuario,
    "--die-with-parent", "--new-session",
    "--clearenv", "--setenv", "HOME", home, "--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin",
    "--setenv", "LANG", "C.UTF-8", "--setenv", "TERM", "dumb",
    ...montajes,
    ...argumentos,
  ];
}
