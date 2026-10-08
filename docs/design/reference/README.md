# Ledgerline — claro y vivo

Segunda dirección visual para Ledgerline Feature Intelligence. Sustituye a la editorial, que se sentía anticuada. Todas las maquetas son interactivas y usan datos de ejemplo inventados.

## Idea

Una herramienta para decidir qué construir tiene que sentirse **ligera, rápida y segura de sí misma**. Fondo casi blanco con un toque frío, un solo azul saturado que guía el ojo, tarjetas suaves con sombra azulada y mucho aire. El movimiento explica: lo que llega, entra; lo que se calcula, se llena; lo que se puede pulsar, responde.

## Color

El azul ultramar `accent` es lo único saturado. Hace tres trabajos: acción principal, navegación activa y énfasis en cifras. Las cuatro bandas de prioridad son un mismo azul en cuatro intensidades, así el orden se lee antes que la etiqueta. El **ámbar** (`flag`) está reservado a "una persona debe decidir" o "algo está degradado"; nadie más lo usa. Rosa para destructivo y menta para éxito, siempre en tonos suaves.

Tema Día (por defecto) y tema Noche, ambos con contraste AA verificado.

## Tipografía

- **Plus Jakarta Sans** (display, 500–800): titulares y cifras. Geométrica, amable, con carácter.
- **DM Sans** (texto): lectura cómoda a 16 px, interlineado 25.
- **JetBrains Mono**: solo para lo que se mide (confianza, similitud, ARR).

Todo es más grande que antes: cuerpo 16, botones 16 en 48 px de alto (56 en la acción principal), cifras hasta 64.

## Forma

Tarjetas con radio 20 (28 en las hero), sombra azulada que sube en hover, bordes casi invisibles. Botones de radio 12. Chips y bandas en píldora. Los campos miden 54 px.

## Movimiento

Moderado y con propósito (ver la tarjeta **Motion**):

1. **Cascada**: las filas y tarjetas entran de a una, 45 ms entre cada una.
2. **Cifras que cuentan** hasta su valor en 0,9 s.
3. **Barras que se llenan** desde la izquierda.
4. **Elevación** de 3 px en lo pulsable.
5. **Despliegue** de altura suave en "Why" y "Removed".
6. **Indicador deslizante** en filtros y selectores.
7. **Resorte** solo en confirmaciones y avisos.

Duraciones: 140 / 240 / 560 / 900 ms. Con `prefers-reduced-motion` todo se detiene y el contenido aparece ya en su estado final.

## Lo que no cambia

El contenido, el orden de las vistas y las reglas del producto siguen igual: el ámbar solo significa decisión pendiente, las bandas siempre llevan su palabra, nada se borra y la IA nunca decide sola por debajo del umbral. Esta propuesta es solo piel y movimiento.
