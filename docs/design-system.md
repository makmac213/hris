# Design system

The aim is minimal, modern and corporate: quiet surfaces, one accent, and hierarchy from type and spacing rather than colour. Tokens live in `styles/globals.css`; primitives live in `components/ui/`.

- **Type:** IBM Plex Sans. Sizes are 13 (meta), 14 (body), 16 (section), 20 (dialog title) and 28 (page title). Dates, IDs and money use tabular figures.
- **Colour:** OKLCH tokens, with cool neutrals and one cobalt accent for actions and selection. Status colours appear only in badges, warnings and money that is taken away (deductions show as red `−₱`). Dark mode comes from the same tokens through `light-dark()`.
- **Shape:** one 6px radius everywhere. Avatars are the only circles.
- **Spacing:** a 4px scale (4, 8, 12, 16, 24, 32, 48). Borders separate sections; shadows are only used on floating layers like dialogs, menus and the zoom control.
- **Motion:** 150ms ease-out for hover and press and 160ms for dialogs. All motion turns off under `prefers-reduced-motion`.

## Primitives

`Button` (primary, secondary, ghost, danger), `Field` (label, hint and error wiring), `Dialog` (with a `wide` option), `Badge`, `Avatar`, `PersonCell`, `Progress`, `Icon`, `Toast`.

## Rules we hold to

- Every input has a visible label. No placeholder-only labels.
- One primary action per screen or dialog.
- Numbers are right-aligned, and so are their headers.
- Row actions: one visible action at most, the rest in a "more" menu.
- No nested cards, gradient accents, eyebrow labels or metric-tile grids.
- Every state is designed: empty, loading, blocked, error and not found.
- Words: "time in" and "time out", never "clock in". Money is `₱1,234.56`, negative is `−₱1,234.56`.
