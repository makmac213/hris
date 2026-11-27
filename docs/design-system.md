# Design system

The aim is minimal, modern and corporate: quiet surfaces, one accent, and hierarchy from type and spacing rather than colour. Tokens live in `styles/globals.css`; primitives live in `components/ui/`.

- **Type:** IBM Plex Sans. Sizes are 13 (meta), 14 (body), 16 (section), 20 (dialog title) and 28 (page title). Dates, IDs and money use tabular figures.
- **Colour:** OKLCH tokens, with cool neutrals and one cobalt accent for actions and selection. Status colours appear only in badges, warnings and money that is taken away (deductions show as red `−₱`). Light mode is the default. Dark mode is optional: each person turns it on under their name in the sidebar, it is saved in their browser, and it comes from the same tokens through `light-dark()`.
- **Shape:** one 6px radius for controls and panels; 2 to 4px for small marks (dots, counts, the today marker). Avatars and radio buttons are the only circles.
- **Spacing:** a 4px scale (4, 8, 12, 16, 24, 32, 48). Borders separate sections; shadows are only used on floating layers like dialogs, menus and the zoom control.
- **Motion:** 150ms ease-out for hover and press and 160ms for dialogs. All motion turns off under `prefers-reduced-motion`.

## Primitives

`Button` (primary, secondary, ghost, danger), `Field` (label, hint and error wiring), `Dialog` (with a `wide` option), `Badge`, `Avatar`, `PersonCell`, `Progress`, `Icon`, `Toast`, `RowMenu` (the "more" menu for row actions), `Blank` (an empty value: "None").

## Rules we hold to

- Every input has a visible label. No placeholder-only labels.
- One primary action per screen or dialog.
- Numbers are right-aligned, and so are their headers.
- Row actions: one visible action at most, the rest in a "more" menu.
- No nested cards, gradient accents, eyebrow labels or metric-tile grids.
- **No em dashes**, in the interface or in docs. An empty value shows as `Blank` ("None"); a range uses an en dash (9:00 – 18:00); a pause in a sentence becomes a period, comma or colon.
- **No emojis** anywhere in the product.
- **No one-side colored borders**: no accent stripe on the left of a card, row or cell, no colored underline. A state that needs color gets a full border, a tinted background, or a small square dot next to its text. Active tabs are shown with accent text and weight.
- Every state is designed: empty, loading, blocked, error and not found.
- Words: "time in" and "time out", never "clock in". Money is `₱1,234.56`, negative is `−₱1,234.56`.
