# Design Audit

## Direction

The focal point is the oversized `v2all` terminal wordmark. Its olive underscore is the only grid break and the only object that bleeds beyond the canvas. The blank band below it occupies 15% of the viewport height, with nothing in the margins beside that band. Every other content block follows the twelve-column grid, reflowing to four columns on mobile.

The spine is statement and action, then proof and mechanism, then the network limitation. The subscription has one copy button. There is no second sales pitch at the bottom.

## Tell Hunter

Ranked by expected detection speed, not a measured usability study.

| Rank | Signal                                                  | Why It Reads As A Tell                                                | Applied Change                                                                |
| ---- | ------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1    | "It connects. That's the bar."                          | A generic slogan with technical styling; it could advertise a router. | Replaced it with "Dead configs stay out."                                     |
| 2    | Two matching heading-left/content-right sections        | The repeated silhouette exposes the section template.                 | Made the caveat heading span the grid, with the warning and command below it. |
| 3    | Section numbers and process numbers both starting at 01 | Two competing systems of decorative indexing.                         | Removed section numbers; retained the actual process sequence.                |
| 4    | The green dash beside "Prove it"                        | Resembles verification UI without representing a measured state.      | Deleted the dash and its CSS.                                                 |
| 5    | A slogan repeated in the footer                         | Restates a promise after the argument is over.                        | Deleted the footer tagline.                                                   |

## Scores

These are editorial self-assessment scores, not an independent review.

| Category    | Before /3 |  After /3 |
| ----------- | --------: | --------: |
| Idea        |         3 |         3 |
| Focal point |         3 |         3 |
| Hierarchy   |         2 |         3 |
| Space       |         3 |         3 |
| Type        |         2 |         3 |
| Color       |         3 |         3 |
| Detail      |         2 |         2 |
| States      |         1 |         3 |
| Motion      |         2 |         2 |
| Restraint   |         2 |         3 |
| **Total**   | **23/30** | **28/30** |

The two targeted low scores were states (1) and restraint (2, tied with other categories). Clipboard attempts now clear stale success, expose a pending state to assistive technology, and select the exact URL when copying fails. Confirmation uses a 150 ms opacity transition outside the button. The button itself has no entrance, transition, or looping animation. Redundant slogans, duplicate indexing, and the verification-like ornament were removed.

## Responsive Fixes

- 390px: replaced the proof heading's stranded word with "An open port isn't proof." The heading remains 48px rather than shrinking.
- 768px: kept the URL and copy action stacked; reserved two lines for clipboard feedback so errors do not displace the following section.
- 1440px: changed the caveat composition instead of repeating the previous section layout.
- 360px: verified no horizontal overflow, no clipped subscription text, and a 48px copy target.

The copy control uses a 16px text label without an icon that repeats it. The shell command remains 16px on mobile rather than shrinking to fit. The wordmark keeps the system's 1.05 line-height; its empty font leading is optically trimmed without clipping the letters.

## Gate Evidence

- The single `dist/index.html` is approximately 61 KB uncompressed, including its embedded font and font license. It requires no build step to open.
- All content and the selectable subscription remain available with JavaScript disabled.
- The upstream subscription URL returned HTTP 200. The upstream CI workflow uses `0 */6 * * *`. No live survivor count is invented.
- Text contrast on the paper background: ink 13.46:1, muted 4.90:1, accent 5.69:1. The button uses the same paper/accent pair.
- Automated WCAG 2.1 A/AA checks found zero violations at 360, 390, 768, and 1440px. Keyboard paths and 2px focus rings were tested separately.
- The native clipboard, legacy fallback, denial recovery, JavaScript-disabled page, and direct `file://` copy flow were exercised in Chromium.
- No console errors or horizontal scrolling were observed in the tested environments.
- Screenshots are in `artifacts/v2all-390.png`, `artifacts/v2all-768.png`, and `artifacts/v2all-1440.png`; an extra 360px image and JavaScript-disabled image are included.
- Current byte size, local LCP, layout-shift measurements, and test outcomes are recorded by `scripts/verify.mjs` in `artifacts/verification.json`.

Local browser tests validate the landing page, not proxy reachability from a censored network. Automated accessibility checks are not a substitute for an independent screen-reader audit.
