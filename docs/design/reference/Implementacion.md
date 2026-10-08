# Implementacion

Cómo pasar esta propuesta al código sin romper la metodología del repositorio. Nada de esto está hecho todavía: es el orden que sugiero, y cada paso necesita su ID de tarea en `docs/TASKS.md` antes de empezar.

## Equivalencias con `globals.css`

| Hoy (`globals.css`) | Este sistema |
| --- | --- |
| `--background` | `surface` |
| `--card`, `--popover` | `surface-raised` |
| `--muted`, `--secondary` | `surface-sunken` |
| `--foreground` | `ink` |
| `--muted-foreground` | `ink-muted` |
| `--border` | `line` |
| `--input` | `line-strong` |
| `--primary` / `--primary-foreground` | `accent` / `on-accent` |
| `--ring` | `focus-ring` |
| `--destructive` | `destructive` |
| `--band-*` y `--band-*-fg` | `band-*` y `on-band-*` |
| `--flag`, `--flag-fg`, `--flag-border` | `flag`, `on-flag`, `flag-line` |
| `--radius` | `radius-md` (12); añade `lg` 20 y `xl` 28 |

Nuevos: `accent-tint`, `shadow-card`, `shadow-lift`, `duration-*`, `ease-*`.

## Tipografía

Sustituye Geist por **Plus Jakarta Sans** (pesos 500–800), **DM Sans** y **JetBrains Mono** con `next/font/google`. Apunta `--font-heading` a Plus Jakarta y `--font-sans` a DM Sans. Las variables de `@theme` deben apuntar a las que define `next/font`, no a sí mismas.

## Movimiento

Basta CSS: `@keyframes` para `rise`, `growx` y `pop`, una utilidad `[data-stagger]` con `animation-delay: calc(var(--i) * 45ms)`, y `grid-template-rows: 0fr → 1fr` para los despliegues. El conteo de cifras es un componente cliente pequeño. Cierra siempre con un bloque `@media (prefers-reduced-motion: reduce)` que anule animaciones y transiciones. Si el repositorio ya usa `tw-animate-css`, reutilízalo para las entradas.

## Orden sugerido

1. **Tokens y tipografía.** `globals.css` y `layout.tsx`. Cambia el aspecto de todo sin tocar contenido.
2. **Shell.** Barra lateral de 264 px, modo compacto, barra de pestañas móvil y encabezado de página. Afecta a las seis vistas a la vez.
3. **Señales.** Banda, aviso ámbar, medida, procedencia, botones y campos.
4. **Movimiento base.** Cascada, barras y elevación.
5. **Review y New request**, las vistas con más interacción.
6. **Problems, detalle, Priority y Overview.**
7. **Móvil.** Ajustes de las vistas bajo 700 px.

Cada paso es un commit convencional con su ID de tarea, por ejemplo `feat(ui): T-0xx sidebar shell`.

## Comprobaciones

- Contraste AA en ambos temas (los pares están medidos en los tokens).
- Con `prefers-reduced-motion` activo la interfaz es idéntica y estática.
- El ámbar sigue significando solo "decisión pendiente o degradado".
- Respeta los Non-Goals de `PRODUCT.md`: esto no cambia lo que la app hace.
