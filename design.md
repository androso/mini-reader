# Design — Mentarie

A locked design system for the Mentarie web app. Every page redesign reads this
file before emitting code. Extend this system when it needs to grow; do not
invent per-page themes.

## Genre

Playful, with a soft atmospheric palette for long reading sessions. The app
chrome feels like a calm night sea, while the book remains the warmest and
quietest surface in the product.

## Macrostructure family

- Library: **Catalogue**. Covers form the visual index; opening a book is the
  primary action and upload is the only global action.
- Reader: **Split Studio**. The book and the AI conversation are equal halves of
  one reading workflow. The persisted pane position and width remain intact.
- Authentication: **Split Studio, compact**. Product purpose on one side, the
  login or signup form on the other.
- Future marketing pages: **Workbench**. Show the real reading and questioning
  workflow instead of abstract feature claims.

## Theme

- `--color-paper` oklch(97% 0.012 95)
- `--color-paper-2` oklch(94% 0.016 95)
- `--color-paper-3` oklch(91% 0.02 95)
- `--color-ink` oklch(20% 0.025 245)
- `--color-ink-2` oklch(42% 0.028 225)
- `--color-rule` oklch(84% 0.025 205)
- `--color-accent` oklch(70% 0.13 195)
- `--color-accent-2` oklch(58% 0.12 215)
- `--color-accent-2-soft` oklch(84% 0.07 205)
- `--color-accent-3` oklch(56% 0.18 25)
- `--color-focus` oklch(58% 0.18 195)
- `--color-chat` oklch(20% 0.025 245)

Deep teal marks primary actions, sea blue marks links, sea glass marks selected
context, and coral is reserved for destructive or failed states. Accents never
blend in gradients.

## Typography

- Display and body: Plus Jakarta Sans, weights 400, 500, 600, and 700.
- Labels and tabular values: JetBrains Mono, weights 400 and 500.
- Reading exception: Literata inside EPUB and extracted book content only.
- Display tracking: `-0.025em`.
- Type scale anchor: `--text-display: clamp(2.5rem, 4vw + 1rem, 4.75rem)`.

## Spacing

A named four-point scale lives in `tokens.css`. Components use named tokens or
Tailwind utilities that map to the same rhythm; page CSS does not introduce
one-off spacing values.

## Motion

- Primary actions use a short lift and physical press.
- Book cards use one colour-and-lift response on hover or keyboard focus.
- Reader panes do not animate position or size during ordinary use.
- Reduced motion removes spatial movement and keeps state changes at 150 ms or
  less.

## Microinteractions stance

- Focus rings appear immediately and meet 3:1 contrast.
- Success is quiet when the result is visible; errors remain explicit.
- Hover behavior always has a keyboard and touch equivalent.
- Loading indicators are functional and restrained.

## CTA voice

- Primary actions use the deep-teal push-button style and concrete verbs such as
  “Upload book”, “Open book”, and “Ask”.
- Secondary actions use a quiet outlined or surface style.
- Destructive actions use coral text and remain visually subordinate until
  explicitly focused.

## Per-page allowances

- App pages use no decorative hero enrichment.
- The library may use real EPUB covers; fallback art uses flat token surfaces.
- The reader may use Literata inside book content, overriding Hum’s sans-only
  rule because the book is content rather than application chrome.
- The embedded PDF viewer keeps its native document rendering.

## What pages MUST share

- The Mentarie wordmark and small reading mark.
- The warm reading ground, navy-charcoal ink, and semantic accent assignments.
- Plus Jakarta Sans application typography and the same button/input voice.
- Rounded surface geometry, immediate focus rings, and restrained motion.

## What pages MAY differ on

- The library uses a cover-led catalogue grid.
- Authentication uses a compact two-column composition.
- The reader uses a functional split workspace with no decorative content.

## Exports

### tokens.css

The canonical CSS export is maintained in `/tokens.css` at the repository root.

### Tailwind v4 `@theme`

```css
@theme {
    --color-paper: oklch(97% 0.012 95);
    --color-ink: oklch(20% 0.025 245);
    --color-accent: oklch(70% 0.13 195);
    --font-display: "Plus Jakarta Sans", sans-serif;
    --font-body: "Plus Jakarta Sans", sans-serif;
    --spacing-md: 1rem;
    --text-md: 1.25rem;
    --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG `tokens.json`

```json
{
    "color": {
        "paper": { "$value": "oklch(97% 0.012 95)", "$type": "color" },
        "ink": { "$value": "oklch(20% 0.025 245)", "$type": "color" },
        "accent": { "$value": "oklch(70% 0.13 195)", "$type": "color" }
    },
    "font": {
        "display": { "$value": "Plus Jakarta Sans", "$type": "fontFamily" },
        "body": { "$value": "Plus Jakarta Sans", "$type": "fontFamily" }
    },
    "space": {
        "md": { "$value": "1rem", "$type": "dimension" }
    }
}
```

### shadcn/ui CSS variables

```css
:root {
    --background: 97% 0.012 95;
    --foreground: 20% 0.025 245;
    --primary: 70% 0.13 195;
    --primary-foreground: 20% 0.025 245;
    --muted: 94% 0.016 95;
    --muted-foreground: 42% 0.028 225;
    --border: 84% 0.025 205;
    --input: 84% 0.025 205;
    --ring: 58% 0.18 195;
    --radius: 0.75rem;
}
```
