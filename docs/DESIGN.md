# Design — minimal and muted

**Brief.** Minimal, less vibrant colour; no visible keyboard shortcuts. (Replaces the earlier "Adire" indigo/zobo theme.)

## Plan
**Colour** (cool neutrals, one accent)
| Token | Hex | Job |
|---|---|---|
| Paper | `#F5F6F6` | page |
| Surface | `#FFFFFF` | inputs, panels |
| Ink | `#2A2F33` | text |
| Quiet | `#626A71` | secondary text, labels |
| Slate | `#4F6272` | the only accent: buttons, links, focus |
| Moss / Plum | `#4E6F5C` / `#86566A` | money in / money out, used only on figures and bars |

Dark and high-contrast themes keep the same roles. Category colours are gone: the ribbon uses eight tints of Slate.

**Type.** One family, Inter (it carries ₦, a real minus sign and tabular figures). Hierarchy comes from size and weight (500 for the headline, 600 for names, 400 for text), not colour or case.

**Layout.** One left-aligned column, 760px, top text navigation, no sidebar, no cards. Sections are a quiet heading plus a list with thin dividers.
```
Tally  Today Money Import Check Plan Settings        [Add]
Ask a question, like “groceries last month”
─────────────────────────────────────────────
You spent ₦802,597 in October — ₦393,032 more than September.
▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇ (one thin ribbon)
Shopping 53%  Rent 19%  Fuel 6% …
```
**The one memorable thing.** The ribbon: a month's spending as a single thin strip in one hue, below a plain-sentence headline. Everything else is deliberately quiet.

**Motion.** The ribbon draws once when you first arrive; drawers and menus fade in. Reduced-motion is respected.

## Review against the guidance
* Minimal drifts toward "broadsheet" (hairlines, square corners, dense columns). Kept soft 8–10px corners and generous spacing instead.
* No cream + terracotta, no near-black + acid accent, no uppercase eyebrows, no monospace data labels, no arrows on buttons, no numbered sections, no emphasised single word in the headline.
* Colour carries meaning only for money direction and warnings; everything else is neutral.
* Quality floor: all 27 theme colour pairs pass WCAG AA (`node scripts/contrast.mjs`), visible focus ring, full keyboard operation, mobile layout checked at 390px in a real browser.
