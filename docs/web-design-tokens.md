# Dashboard design tokens

Concord uses one neutral family, one accent and three semantic states. This is the complete list from [`apps/web/src/index.css`](../apps/web/src/index.css) (the source of truth). The site follows OS light/dark preference rather than a manual theme switch.

## CSS variable reference

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#f4f5f7` | `#0e1012` | Whole-page canvas |
| `--surface` | `#fcfcfd` | `#14171a` | Cards, forms, panels |
| `--sunken` | `#eceef1` | `#1b1f23` | Subdued inset surfaces |
| `--line` | `#dde0e5` | `#262b31` | Light separators |
| `--line-strong` | `#c3c8d0` | `#3a414b` | Emphasized borders |
| `--text` | `#15181c` | `#e7e9ec` | Main body text |
| `--muted` | `#586070` | `#98a1ae` | Secondary labels and table headings |
| `--accent` | `#1d4ed0` | `#86a8ff` | Buttons, links, focus outline |
| `--accent-ink` | `#fcfcfd` | `#0e1012` | Text on accent backgrounds |
| `--bad` | `#ad241c` | `#ff9389` | Error and destructive foreground |
| `--bad-bg` | `#fbebea` | `#371917` | Error backgrounds |
| `--ok` | `#17713f` | `#72d6a0` | Success foreground |
| `--ok-bg` | `#e6f4ec` | `#122e1e` | Success backgrounds |
| `--warn` | `#7d5200` | `#efc266` | Warning foreground |
| `--warn-bg` | `#faf0d9` | `#30270f` | Warning backgrounds |

## Tailwind and browser mode

`@theme inline` maps `--color-<name>` to `var(--<name>)` for **all fifteen colour variables** above. For instance, `bg-surface`, `text-muted`, `border-line-strong`, `text-bad`, and `bg-ok-bg` resolve through these tokens. Font aliases `--font-sans` and `--font-mono` use Geist Sans and Geist Mono with system fallbacks. `html { color-scheme: light dark; }` lets browser-native inputs reflect the active preference; the palette changes under `@media (prefers-color-scheme: dark)`, with no JS theme toggle.

## Representative WCAG contrast checks

Ratios calculated from the current hex values with WCAG 2.x relative luminance (higher is more contrast). Pairs are foreground/background, not an assertion that every UI combination passes accessibility review.

| Pair | Light ratio | Dark ratio |
| --- | ---: | ---: |
| `--text` / `--surface` | 17.37:1 | 14.79:1 |
| `--muted` / `--surface` | 6.17:1 | 6.89:1 |
| `--accent` / `--surface` | 6.71:1 | 7.76:1 |
| `--accent-ink` / `--accent` | 6.71:1 | 8.22:1 |
| `--bad` / `--bad-bg` | 5.97:1 | 7.45:1 |
| `--ok` / `--ok-bg` | 5.34:1 | 8.25:1 |
| `--warn` / `--warn-bg` | 6.02:1 | 8.84:1 |

## Style rules

- Use semantic Tailwind aliases / CSS variables, not hard-coded hex colours in React components. New visual tokens must be defined under both `:root` and its `prefers-color-scheme: dark` override, with a matching `@theme inline` alias.
- Radius is **4px** for common controls and skeletons. For tabular information, use `.num` (Geist Mono, tabular numbers, 13px) for stable alignment and `.tbl` for consistent table border, padding (8px 12px), muted headings, and right-aligned `.r` numeric cells.
- Interactive focus uses a **2px** accent outline with **2px** offset (`:focus-visible`). Respect `prefers-reduced-motion`: `.skeleton` pulse animation is only applied when reduced motion is *not* requested.
- Text defaults to **14px** and line height **1.45**. Keep new components legible at both light and dark values; re-run contrast checks after changing any paired foreground/background tokens.
