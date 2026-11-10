# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## WebFlipper visual decisions

- Use `DESIGN.md` at the repository root as the design-token source.
- The selected reference is `Docs/design-concepts/waiting-room-dark-light-v1.png`.
- Do not add slogans, theme copy, poetic helper text, or the phrase “おして、めくって、みんなで当てる”.
- Preserve generous whitespace: at least 64px desktop outer margins, 48–64px major gaps, and visible empty space around the room code and primary action.
- Avoid nested cards, dense edge-to-edge layouts, gradients, shadows, and decorative colors outside the approved semantic palette.
- During active quiz scenes, use a fullscreen broadcast-game composition inspired by Lounge's clarity without copying its branding or assets.
- Keep active quiz scenes within `100dvh` whenever practical; headers, prompts, canvases, answer grids, and primary actions must remain visible without page scrolling.
- Result and judging answer frames use solid blue for unselected/incorrect answers and solid red for selected/correct answers. Do not add a visible correct label; expose correctness to assistive technology.
- Preserve the 4:3 drawing surface while allowing the surrounding chrome and the 1–50 answer grid to scale with the browser viewport. Room capacity choices are 10–50 participants in steps of five; the host does not count toward capacity.
- The answer surface is solid blue and the fixed MVP pen is white. Keep Undo, Redo, and Clear only; do not add color pickers, pen widths, shapes, or text tools.
- In judging and results, the whole flip surface is blue by default and switches to red when selected as a correct answer; do not leave a white inner drawing panel.
- In judging and results, surround each drawing surface with a black frame and reserve a thicker black bottom band for the participant name so handwriting never competes with the label.
- Show a real invitation QR code directly below the host's participation URL. Clicking it opens an enlarged, responsive modal; close it with its close button, Escape, or the backdrop, and return focus to the thumbnail. Encode the exact participation URL and generate the QR locally in the browser.
- On desktop, keep the host's invitation panel sticky while the participant roster scrolls independently. Fit the code, URL, and QR into shorter desktop viewports. On stacked mobile layouts, bound the roster height and scroll inside it. Keep the disconnected-participant bulk removal button outside the scrolling roster; confirm before removing anyone and determine the targets from live server-side connection presence.
- The ended-room screen must offer "新しいルームを作る" for the host and "トップへ戻る" for participants. Clear only the caller's ended-room session and room cookies before navigating to `/`; keep other participants' ended screens and the five-minute tombstone. Creating a new room must not require waiting for that tombstone to expire.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
