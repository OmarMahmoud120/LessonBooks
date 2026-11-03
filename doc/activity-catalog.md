# Activity catalog

| Type              | Interaction and scoring                                                    | Phase |
| ----------------- | -------------------------------------------------------------------------- | ----- |
| multiple_choice   | single/multiple options by stable ID; exact or penalized partial set score | 1     |
| true_false        | labelled two-option choice                                                 | 1     |
| fill_in_the_blank | named blanks with accepted answers; explicit normalization                 | 1     |
| drag_to_match     | labelled pair controls; keyboard/select alternative to pointer drag        | 1     |
| categorize        | place items into named categories; select alternative to drag              | 1     |
| sequencing        | order stable item IDs, accessible move controls                            | 3     |
| label_diagram     | labelled regions with keyboard-selectable answer controls                  | 3     |
| memory_cards      | paired cards with text alternatives and no time pressure                   | 3     |
| word_builder      | ordered letters/syllables; locale-aware handling                           | 3     |
| number_line       | bounded number choice / math input, explicit tolerance                     | 3     |

Every implemented activity has correct, incorrect and hint feedback; points and difficulty; optional media; retry behavior and a stable event identity. Use real buttons and labels, visible focus, feedback live regions and >=44px touch targets. No color-only information. Use logical CSS, dir/lang attributes and reduced-motion preferences. Automated axe testing supplements keyboard checks; it does not establish full screen-reader conformance.

Hints and scoring are local in Phase 1. Persistent progress, assignment gating and rewards are later phases. Handwritten fixtures test mathematical answers and multiple accepted forms.
