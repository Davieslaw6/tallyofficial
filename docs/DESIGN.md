# Design plan — Tally

**Subject.** A private money notebook for one person in Nigeria (₦). It never goes online, and it must earn trust: every number should be checkable against the bank statement.
**Primary job.** Answer "where did my money go, and do my books match the bank?" in under ten seconds after unlocking.

## First draft (rejected)
Indigo + white, a hero "big number with a small label and a gradient", a grid of identical rounded stat cards, tracked-out uppercase labels, mono data labels. That is the default dashboard for any finance app, so it was thrown out.

## Direction — "Adire"
Adire is Yoruba indigo resist-dyed cloth: deep indigo ground, undyed cotton, patterns made by what was *held back* from the dye. The metaphor fits a ledger of what stayed and what left.

**Colour** (named, semantic)
| Token | Hex | Job |
|---|---|---|
| Indigo ink | `#1B2160` | text, primary rules, dark-mode ground |
| Dye blue | `#3342B8` | interactive things only |
| Cotton | `#F6F6FA` | page; panels are plain white `#FFFFFF` |
| Wash | `#E4E7F6` | selected rows, quiet fills |
| Zobo | `#A3194B` | money out, errors |
| Leaf | `#19734F` | money in, "matched" |
| Kola | `#B7791F` | one use only: "needs your review" |

**Type.** Bricolage Grotesque (display + every amount; it carries the ₦ glyph and tabular figures) with Instrument Sans for reading text. Distinct shapes, one scale (14 / 16 / 20 / 28 / 44). Sentence case everywhere; no all-caps labels, no mono.

**Layout.** One continuous *sheet* rather than a card grid: sections are separated by space and a short indigo bar, not by boxes. Left rail on desktop, bottom tabs on phones. Content is left-aligned, lines under 70 characters.

```
┌ rail ┬───────────────────────────────────────────┐
│Today │ Ask a question about your money…   [lock] │
│Money │───────────────────────────────────────────│
│Import│ In March you spent ₦412,300 —              │  ← the headline is a sentence
│Check │ ₦87,000 less than February.                │
│Plan  │ ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇ (dye bar)         │  ← categories as one resist-dyed strip
│Safe  │ Books ₦1,204,331 · matched to GTBank 31 Mar│
└──────┴───────────────────────────────────────────┘
```

**The one memorable thing.** The *dye bar*: a month's spending drawn as a single strip of indigo-family segments with small gaps (the "resist"). It is the dashboard's hero, the budget view's scale, and the unlock animation (it fills once when the vault opens). Everything else stays quiet.

**Motion.** Only two moments: the dye bar filling at unlock, and drawers/toasts answering a tap. `prefers-reduced-motion` turns both off.

**Copy.** Plain verbs, active voice, sentence case. "Unlock", not "Authenticate". Errors say what happened and what to do: "Wrong passphrase. It is case-sensitive."

## Review against the brief
- *Does it look like every finance dashboard?* The headline-as-sentence and dye bar replace the stat-card row. Changed: dropped the card grid and gradients.
- *Generic tells?* No cream/terracotta, no near-black + acid accent, no uppercase eyebrows, no mono labels, no "→" on buttons, no numbered sections. Kola appears once.
- *Distinct from the user's earlier "Ledger" app* (navy/paper/brass, Fraunces + Plex Mono): different palette, type and layout on purpose.
- *Quality floor:* WCAG AA contrast on all token pairs, visible focus rings, full keyboard support, light/dark/high-contrast, three densities, mobile-first.
