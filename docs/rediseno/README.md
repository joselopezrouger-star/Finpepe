# FinPep · kit de rediseño para Claude Code

Todo lo necesario para que Claude Code implemente el rediseño en el repo de FinPep, por etapas.

## Qué hay en esta carpeta

| Archivo | Para qué sirve |
|---|---|
| `PLAN.md` | Las 9 etapas, con el prompt para pegar en Claude Code y cómo verificar cada una. **Empezá por acá.** |
| `REGLAS-DISENO.md` | Reglas cortas de diseño para sumar al `CLAUDE.md` del repo, así Claude Code las respeta siempre. |
| `referencia.html` | La revisión completa: diagnóstico, recomendaciones, sistema de diseño y los 7 mockups en iPhone, hechos con HTML/CSS como tu app. Abrilo en el navegador. |
| `capturas/` | PNG de cada pantalla en oscuro y claro, y versiones `-completa` de las pantallas largas. |
| `tokens.css` | Colores (oscuro y claro), tipografías, espaciados, radios y escala tipográfica como variables CSS. |
| `componentes.css` | Las clases de los mockups adaptadas a la app real: tarjetas, filas, chips, botones, segmentados, panel inferior, barra inferior con el +, teclado, gráficos. |
| `iconos.svg` | Sprite con los íconos que usan los mockups. |
| `graficos.js` | Funciones para dibujar los gráficos en SVG sin librerías: líneas suaves con marcadores, áreas, escalones y grilla. |

## Cómo usarlo

1. **Subí esta carpeta al repo**, por ejemplo en `docs/rediseno/`, y hacé commit en `main` para que Claude Code la vea:
   ```
   git add docs/rediseno
   git commit -m "Kit de rediseño"
   git push
   ```
2. **Sumá las reglas al `CLAUDE.md`** del repo: copiá el contenido de `REGLAS-DISENO.md` al final de ese archivo, o crealo si no existe. También se lo podés pedir a Claude Code en la etapa 0.
3. **Abrí Claude Code** en claude.ai/code y elegí el repo de FinPep.
4. **Seguí `PLAN.md` en orden.** Pegá el prompt de una etapa, revisá el pull request, probalo en el iPhone y recién ahí pasá a la siguiente. Una etapa por sesión de Claude Code y un PR por etapa.

## Antes de arrancar

- Los mockups usan datos de octubre de 2026 tomados de tus capturas. Los valores de julio a septiembre de los gráficos están leídos a ojo, así que son aproximados. En la app, todo tiene que salir de los datos reales.
- El modo claro en los archivos usa `<html data-theme="light">`. Si FinPep usa otra clase o atributo, Claude Code lo adapta en la etapa 1.
- Hay dos inconsistencias en los números actuales que conviene revisar en la etapa 1 (están en `PLAN.md`).
