#!/bin/sh
# Arranque de la computadora de una IA (corre como su usuario, sin privilegios): KasmVNC en la
# pantalla :1 con una sesión XFCE, y el reenvío del CDP de Chromium para Playwright.
set -eu
: "${CLAVE_VER:?falta CLAVE_VER}" "${CLAVE_CONTROL:?falta CLAVE_CONTROL}"

mkdir -p "$HOME/.vnc"
printf '#!/bin/sh\nexec dbus-launch --exit-with-session startxfce4\n' > "$HOME/.vnc/xstartup"
chmod 755 "$HOME/.vnc/xstartup"
touch "$HOME/.vnc/.de-was-selected" # evita la pregunta interactiva de KasmVNC por el escritorio

# Dos usuarios de KasmVNC con claves nuevas en cada arranque: "ver" solo mira; "control" usa teclado y ratón.
rm -f "$HOME/.kasmpasswd"
printf '%s\n%s\n' "$CLAVE_VER" "$CLAVE_VER" | vncpasswd -u ver -r >/dev/null
printf '%s\n%s\n' "$CLAVE_CONTROL" "$CLAVE_CONTROL" | vncpasswd -u control -r -w >/dev/null
unset CLAVE_VER CLAVE_CONTROL

socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222 &
exec vncserver :1 -fg -select-de manual
