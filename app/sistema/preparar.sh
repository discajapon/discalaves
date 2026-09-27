#!/bin/sh
# Prepara la computadora de un empleado: su propio Alpine Linux con un escritorio ligero.
# No necesita root: todo corre en un espacio de nombres de usuario con bubblewrap.
# Uso: sh app/sistema/preparar.sh   (DISCALAVES_IA cambia la carpeta; por defecto ~/Documents/IA-discalves)
set -eu

IA="${DISCALAVES_IA:-$HOME/Documents/IA-discalves}"
SISTEMA="$IA/sistemas/qwen"
RAIZ="$SISTEMA/raiz"
VERSION=3.24.2
SHA256=c5ca053cfe1d85c5b96dff8b9bc57045f7f184a30ffb6b65776409ca90388677
ARCHIVO="alpine-minirootfs-$VERSION-x86_64.tar.gz"
PAQUETES="bash xvfb openbox tint2 xsetroot xterm chromium xdotool xwd ffmpeg font-dejavu mesa-dri-gallium"

if [ ! -e "$RAIZ/etc/alpine-release" ]; then
  mkdir -p "$RAIZ"
  curl -fL -o "$SISTEMA/$ARCHIVO" "https://dl-cdn.alpinelinux.org/alpine/v${VERSION%.*}/releases/x86_64/$ARCHIVO"
  echo "$SHA256  $SISTEMA/$ARCHIVO" | sha256sum -c -
  tar -xzf "$SISTEMA/$ARCHIVO" -C "$RAIZ"
  rm "$SISTEMA/$ARCHIVO"
fi

# La red se comparte con el equipo: se usan los mismos servidores DNS.
cp -L /run/systemd/resolve/resolv.conf "$RAIZ/etc/resolv.conf" 2>/dev/null || cp -L /etc/resolv.conf "$RAIZ/etc/resolv.conf"

como_root() {
  bwrap --bind "$RAIZ" / --proc /proc --dev /dev --tmpfs /tmp \
    --unshare-all --share-net --uid 0 --gid 0 --hostname qwen --die-with-parent \
    --clearenv --setenv PATH /usr/sbin:/usr/bin:/sbin:/bin --setenv HOME /root "$@"
}

como_root /sbin/apk add --no-progress $PAQUETES
# Usuario qwen (uid 1000). adduser no sirve aquí: sin root real no puede cambiar el dueño de /home/qwen,
# que además se monta desde fuera al arrancar.
grep -q '^qwen:' "$RAIZ/etc/passwd" || echo 'qwen:x:1000:1000:qwen:/home/qwen:/bin/bash' >> "$RAIZ/etc/passwd"
grep -q '^qwen:' "$RAIZ/etc/group" || echo 'qwen:x:1000:' >> "$RAIZ/etc/group"
grep -q '^qwen:' "$RAIZ/etc/shadow" || echo 'qwen:!::0:::::' >> "$RAIZ/etc/shadow"
mkdir -p "$RAIZ/home/qwen" "$SISTEMA/x11" "$IA/sistemas/bin"

# Compila "encerrar" (Landlock) dentro de Alpine como binario estático, y quita el compilador.
DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$DIR/encerrar.c" "$RAIZ/root/encerrar.c"
como_root /sbin/apk add --no-progress --virtual .compilar gcc musl-dev linux-headers
como_root /usr/bin/gcc -O2 -static -o /root/encerrar /root/encerrar.c
como_root /sbin/apk del --no-progress .compilar
mv "$RAIZ/root/encerrar" "$IA/sistemas/bin/encerrar"
rm "$RAIZ/root/encerrar.c"

echo "listo: $(cat "$RAIZ/etc/alpine-release") en $RAIZ ($(du -sh "$RAIZ" | cut -f1))"
