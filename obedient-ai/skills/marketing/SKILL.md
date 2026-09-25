---
name: marketing
description: Analyse a software project and produce a launch kit - a Remotion marketing video in mobile (4:5) and desktop (16:9) cuts, plus LinkedIn, X/Twitter and Instagram posts - then run a review agent until it is ship-quality. Use when the user asks for a launch video, promo video, marketing video, product announcement, social posts for a launch, or "market this project".
---

# Marketing launch kit

Produces, inside the project, `marketing/`:

- `launch-video/`: a Remotion project with a `Launch` (1080×1350) composition and a `LaunchWide` (1920×1080) composition. Both render from the same scenes.
- `<slug>-launch-4x5.mp4` and `<slug>-launch-16x9.mp4`
- `posts.md`: LinkedIn, X/Twitter and Instagram copy.
- `facts.md`: every claim used in the video and posts, each with its source.

Work in this order. Do not skip the fact sheet or the review loop.

## 1. Analyse the project, then write `facts.md`

- Read the README, any store or listing copy, the manifest or package metadata, `PRIVACY.md`, and the screenshots in the repo.
- Find the **one differentiator**: the "smart part" the product does that alternatives don't. Read the code that implements it, so the video can show the real mechanism rather than a metaphor.
- Collect **real numbers only**: throughput, limits and ranges from the code or README. Record each one as `claim — source file:line`. If a number the story needs does not exist, leave it out. Never invent stats like "GB freed" or "10k users", even when a reviewer asks for them.
- Find the links. Take the repo URL from `git remote -v`. Check that it is public (`gh repo view --json visibility`) and whether it has a LICENSE. Say "source on GitHub", not "open source", when there is no license.
  - Search for the store or product URL. If you can't find it, use a `[STORE_LINK]` placeholder and flag it at the end.
- Check pricing, for example for payment code. Claim "Free" only when the evidence supports it.
- Check safety and retention claims, such as undo windows and recovery periods, with the user if the code does not prove them. Prefer wording that has no number ("always recoverable from the bin") over a number that might be wrong.

## 2. Positioning and storyboard

Write a short brief at the top of `facts.md`: audience, pain, differentiator, three proof points, and the CTA.

Default storyboard, 30–40s at 30fps. It must be silent and work on mute, because feeds autoplay muted:

| Scene | Seconds | Purpose |
|---|---|---|
| Brand card | 2.5 | Icon, name, one-line promise and a "Now on …" chip. **Fully visible on frame 0**, because frame 0 becomes the thumbnail. |
| Hook | 5 | Show the pain visually. Put several visibly different variants of the problem in a grid, then say why existing tools fail. |
| The smart part | 6 | The real mechanism, simplified to 1–2 steps plus a result, e.g. "95% alike ✓ Same photo". Hold each badge until its counter lands. |
| Speed / proof | 5 | Lead with the outcome number ("100,000 photos in ~15 minutes"). A counter and timer that agree with each other. |
| Product demo | 10–13 | Real screenshots with a camera zoom, a cursor and click ripples, and the product's own UI states (progress bar or pill, results, toast). Numbered captions: 1, 2, 3, 4. |
| Trust | 4 | Three short lines, each on one line. Cover privacy and reversibility. |
| CTA | 4 | Name, "Add to …" button, "Free on …". An independent/not-affiliated line if the product touches a third-party brand. |

Keep a persistent brand lockup (icon + name, 40px) top-left on every scene between the brand card and the CTA.

## 3. Build the video

Load the `remotion-best-practices` skill first; its `remotion-create` and `remotion-markup` references are the rules. Then:

1. Scaffold into `marketing/launch-video` with `npx create-video@latest --yes --blank --no-tailwind launch-video`. Pin every `@remotion/*` package to the exact `remotion` version, and add `@remotion/transitions` and `@remotion/google-fonts`.
2. Copy `templates/theme.ts` and `templates/ui.tsx` from this skill into `src/`. They provide:
   - **Font:** Google Sans, with Google Sans Code for mono.
   - **Palette:** a vibrant dark palette, plus a `GRADIENT` for accent words.
   - **Components:**
     - `Background`: animated colour glows and a dot grid.
     - `Rise`: the one entrance animation.
     - `Kicker`: a chip with a dot.
     - `Grad`: gradient text.
     - `Check`, `Cross`, `Cursor`: icons and the demo cursor.
     - `Split` and `useLandscape`: the layout helpers described below.
3. Write every scene in its own file on the 1080×1350 portrait canvas. Wrap it as `<Background><Split text={…} visual={…} band={[top, bottom]} /></Background>`.
   - `text`: the kicker and headline, in normal flow.
   - `visual`: absolutely positioned elements on the portrait canvas.
   - `band`: the vertical range the visual occupies. In landscape, `Split` moves the text to a left column and centres that band on the right.
   - If an element sits under the visual in portrait but belongs in the text column in landscape, branch on `useLandscape()`.
4. In `Launch.tsx`, lay out a `TransitionSeries` with 12–14 frame fades and slides. Put the brand card inside `<Sequence from={-44}>` so its entrance has finished by frame 0. Add a `Lockup` overlay.
5. In `Root.tsx`, register the scenes in a `Folder`, plus `Launch` at 1080×1350 and `LaunchWide` at 1920×1080. Both compositions use the same component and the same `TOTAL`, where `TOTAL` = sum of scenes − sum of transitions.

### Gotchas (all hit in practice)

- **Tailwind preflight** sets `img { max-width: 100% }`. Any `<Img>` wider than its parent shrinks silently, so set `maxWidth: "none"` on it.
- CSS `transition` and `animation` do not render. Drive everything with `useCurrentFrame()` and `interpolate()`.
- **Screenshot camera:** put the 1280×800 screenshot in a div with `transform: translate(VW/2 - cx*s, VH/2 - cy*s) scale(s)` and `transformOrigin: 0 0`, and keyframe `s`, `cx` and `cy`.
  - Map UI coordinates to the screen with `VW/2 + (x - cx) * s`, `VH/2 + (y - cy) * s`, so the cursor and labels track the zoom.
  - Take UI coordinates by reading the actual screenshot pixels.
- **Hiding a UI panel:** overlay a crop of another screenshot of the same page without the panel, clipped to the panel rect. Recreate the product's real minimised state from its own CSS (colours, radius, position), not an invented widget.
- **Privacy:** never show real people's photos or data.
  - Use the repo's blurred screenshots.
  - For "photos" of people, use a polished flat illustration in the Google/Headspace style: egg-shaped head, hair with volume and highlight, ears, neck shadow, brows, eyes with catch-lights, a collared top.
  - Make SVG gradient ids unique with `useId()`.
  - If the illustration looks amateur, delegate it to a designer agent (see §5) that owns only that component.
- **Legibility:**
  - Minimum 28px for anything that must be read at 1080 wide; headlines 84–96px.
  - Captions stay on screen at least 2s for every 8 words.
  - Labels under tiles get an explicit width and `whiteSpace: nowrap`.
  - Check that nothing wraps unexpectedly in either aspect ratio.
- **Brand look:** don't borrow a third party's signature button colour for the CTA. Use a white or brand button.
- **Checking layout:** render stills and a contact sheet before the full render:
  ```bash
  npx remotion still LaunchWide out/w.png --frame=N --scale=0.33
  ffmpeg -i out.mp4 -vf "select='eq(n\,0)+eq(n\,300)',scale=540:-1,tile=5x2" -frames:v 1 sheet.png
  ```
  Then Read the sheet.
- **Render:** `npx remotion render Launch out/<slug>-4x5.mp4 --codec=h264 --crf=18`, and the same for `LaunchWide`. Copy both finals to `marketing/` and delete superseded renders.

## 4. Write the posts (`posts.md`)

Use only claims from `facts.md`. Every post covers the pain, the differentiator, 3–5 proof points, the CTA and the links.

- **LinkedIn:** if a `linkedin-post` skill exists, load it and follow its voice and format. Otherwise: first person, ~150–220 words, no rhetorical-question close, a `Links` block (store and source), and exactly 3 specific hashtags. Attach the **4:5** video.
- **X/Twitter:**
  - Write one standalone post of ≤280 characters: a hook plus the link.
  - Then write an optional 4–6 post thread: pain, how it works, proof, privacy, CTA.
  - Use 1–2 hashtags at most. Attach the **16:9** video, which fits the X timeline best.
- **Instagram:**
  - The caption's first 125 characters are the hook, because that's all that shows before "more".
  - Keep short lines with line breaks, "Link in bio", and 5–10 niche hashtags at the end.
  - Attach the **4:5** video. If a Reel is wanted, say that 9:16 needs a third composition.

Match the user's own voice when they have one. Say "try it now and tell me what you think" rather than generic engagement bait.

## 5. Review loop (mandatory)

Spawn a reviewer with the Agent tool (`general-purpose`, foreground) using this prompt, filled in:

> You are a senior B2C product-marketing director approving paid spend. Review harshly and specifically. Product: `<one line>`. Audience: `<…>`. Videos (read-only): `<4x5 path>`, `<16x9 path>` (silent; feeds autoplay muted; most viewers watch 3–8s). Posts: `<posts.md>`. Extract frames with `ffmpeg -i <mp4> -vf fps=2,scale=540:-1 <scratch>/f_%03d.png`, tile them into contact sheets, and Read them; inspect the first 3s closely. Judge the hook in 2s, value-prop clarity, readability on mute, polish, claim credibility, demo clarity, CTA, brand consistency, platform fit and each post. Budget 25 tool calls. Return ONLY: score /10 with a one-line verdict; at most 12 fixes, highest impact first, each with a timestamp, the problem and the exact change; up to 3 edits per post. Under 450 words; no file contents.

Then:

1. Apply the fixes. **Decline** any that would fabricate data, show private content, or contradict `facts.md`, and tell the reviewer (via SendMessage) not to re-raise them.
2. Re-render. Ask the same reviewer (SendMessage) for a re-score, with at most 6 remaining fixes and an explicit "ready to ship?".
3. Stop when the score is ≥ 7.5/10 and the reviewer says it is ready to ship, after applying its blocking fixes. Stop after 3 rounds at most and report what is left.

For illustration or visual-design problems the reviewer or user flags, spawn a designer agent. Give it scope over one file or component, a style brief, hard constraints (props and coordinates it must keep), a verify step (render a still and Read it) and a budget. Run it in the background while you work on other files.

## 6. Deliver

- Send both MP4s with SendUserFile, and show the post text inline.
- List placeholders still to fill, such as the store link. Report the reviewer's final score and any declined fixes, each with a one-line reason.
- Do not commit, push or publish anything unless asked.
