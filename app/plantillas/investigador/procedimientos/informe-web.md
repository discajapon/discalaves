---
descripcion: investigar un tema en internet y dejar un informe en un archivo
---
# Informe a partir de la web

1. Busca con buscar_web usando 1 o 2 consultas concretas.
2. Abre con abrir_pagina las 2 o 3 fuentes más fiables (oficiales, enciclopedias, medios reconocidos). Descarta foros y tiendas salvo que el tema lo pida.
   - Con la primera parte de cada fuente suele bastar; pide otra parte (parte: 2…) solo si te falta un dato concreto.
   - Si el sitio tiene su propio buscador y te sirve: ver_pagina, escribir_en con la ref del buscador y enviar: true, y abre el resultado con hacer_clic (ref).
   - Si algo no se entiende como texto (gráficos, imágenes, botones sin nombre), mira con captura_pantalla.
3. Si dos fuentes no coinciden en un dato, dilo en el informe; no elijas una en silencio.
4. Escribe el informe con escribir_archivo en `informes/<tema>.md` con este formato:

```
# <Tema>

## Resumen
3 a 5 frases.

## Puntos clave
- punto (fuente: dirección)

## Dudas o datos sin confirmar
- ...

## Fuentes
- dirección — qué se sacó de ahí
```

5. Responde al usuario con el resumen en 2 frases y la ruta del archivo.
