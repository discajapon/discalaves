# Computadora de cada IA: Debian 13 con escritorio XFCE mínimo, Chromium con ventana y terminal,
# y KasmVNC para ver el escritorio en vivo desde la app. Dockerfile estándar (OCI): también sirve con
# Podman rootless. El usuario de cada IA se añade encima en una capa mínima (ver src/computadora.ts).
FROM debian:trixie-slim@sha256:a99cfc517144bc59b1978475ec53b46ecabec7e43635402ee5b77cc54cd1b20a

ARG KASMVNC_VERSION=1.5.0
ARG KASMVNC_SHA256=80b241de7dfe53bba2b7e1cc5ac8c5246d72271efa16be2d4f76607f30fab1c4

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=es_ES.UTF-8 \
    LC_ALL=es_ES.UTF-8 \
    DISPLAY=:1 \
    NO_AT_BRIDGE=1 \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/games:/usr/games

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      xfce4-session xfwm4 xfce4-panel xfce4-terminal dbus-x11 \
      chromium chromium-l10n fonts-dejavu-core fonts-noto-color-emoji \
      locales tzdata ca-certificates curl socat procps less nano \
 && curl -fsSL -o /tmp/kasmvnc.deb \
      "https://github.com/kasmtech/KasmVNC/releases/download/v${KASMVNC_VERSION}/kasmvncserver_trixie_${KASMVNC_VERSION}_amd64.deb" \
 && echo "${KASMVNC_SHA256}  /tmp/kasmvnc.deb" | sha256sum -c - \
 && apt-get install -y --no-install-recommends /tmp/kasmvnc.deb \
 && rm /tmp/kasmvnc.deb \
 && sed -i 's/^# *es_ES.UTF-8 UTF-8/es_ES.UTF-8 UTF-8/' /etc/locale.gen && locale-gen \
 # El cliente web de KasmVNC relee sus lienzos (getImageData) al redimensionar; sin willReadFrequently
 # Chromium avisa en la consola en cada conexión.
 && sed -i -e 's/getContext("2d")/getContext("2d",{willReadFrequently:!0})/g' \
      -e 's/getContext("2d",{alpha:!1})/getContext("2d",{alpha:!1,willReadFrequently:!0})/g' \
      /usr/share/kasmvnc/www/assets/ui-*.js \
 && rm -rf /var/lib/apt/lists/*

COPY kasmvnc.yaml /etc/kasmvnc/kasmvnc.yaml
COPY xfce4-session.xml /etc/xdg/xfce4/xfconf/xfce-perchannel-xml/xfce4-session.xml
COPY iniciar.sh /usr/local/bin/iniciar
# "sudo" de esta computadora: la app ejecuta como root los comandos que EMPIEZAN por sudo (exec -u 0);
# este sustituto hace que un sudo a mitad de comando funcione dentro de ese root y lo explique fuera de él.
RUN chmod 755 /usr/local/bin/iniciar \
 && printf '#!/bin/sh\n[ "$(id -u)" = 0 ] && exec "$@"\necho "sudo: pon sudo al principio del comando para ejecutarlo como root de tu computadora" >&2\nexit 1\n' > /usr/local/bin/sudo \
 && chmod 755 /usr/local/bin/sudo

# 6901: KasmVNC (pantalla en vivo). 9223: CDP de Chromium, reenviado con socat (Chromium solo escucha en su loopback).
EXPOSE 6901 9223
CMD ["/usr/local/bin/iniciar"]
