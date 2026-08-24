# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository overview

This is not a single app — it's a working directory holding one active project:

- **[parak-site/](parak-site/)** — a single-page marketing/landing site for **Parak** (پرک), an Iranian handmade baby-clothing and gift-box brand. This is the project you'll almost always be working in.
- `hadis 2024/` — an unrelated, empty scratch folder (only contains its own placeholder CLAUDE.md). Ignore it unless the user explicitly points there.
- `.agents/skills/frontend-design/` — a vendored skill (via `skills-lock.json`) with design guidance; see "Design conventions" below.

There is no git repo, no package manager, and no build system anywhere in this tree. Everything is plain, dependency-free HTML/CSS/JS.

## parak-site structure

- **[index.html](parak-site/index.html)** — the real, working source file. Loads images from `images/*.jpg` via normal `<img src="images/...">` references. **Edit this file** for any content/style/behavior change.
- **[index-artifact.html](parak-site/index-artifact.html)** — a generated, self-contained export of the same page for publishing as a Claude Artifact: every image is inlined as a base64 `data:` URI so the page has no external asset dependencies. It is otherwise byte-for-byte the same markup/CSS/JS as `index.html`. **Do not hand-edit this file directly** — it should be regenerated from `index.html` by re-inlining the images after `index.html` changes (e.g. via the Artifact tool's publish flow), otherwise the two will drift.
- `images/` — source JPGs referenced by `index.html` (hero, product, and gallery photos, plus a background ribbon texture).

## Working with this codebase

There is no build, lint, or test tooling — everything lives in one self-contained HTML file (inline `<style>` and `<script>`, no bundler, no npm scripts). To preview changes, just open `parak-site/index.html` in a browser (or use a simple static file server if `file://` image loading is restricted).

When editing:
- Keep everything inline in `index.html` (styles in the `<style>` block, script at the bottom) — this project intentionally has no build step.
- The page is RTL Persian (`<html lang="fa" dir="rtl">`). Preserve `dir="rtl"` semantics in any new markup, and keep new copy in Persian consistent with the existing tone (warm, brand-voiced, e.g. "لطافتی که حسش می‌کنی").
- All decorative icons are defined once as `<symbol>` elements in a hidden root `<svg>` near the top of `<body>` and referenced elsewhere via `<use href="#icon-name">`. Add new icons there rather than inlining duplicate `<svg>` markup.
- CSS custom properties in `:root` (brand colors, spacing scale `--space-1`…`--space-7`, radii, shadows) drive the whole design system — reuse these tokens instead of hardcoding new values.
- Scroll-reveal animation is class-driven (`.reveal` → `.reveal.in` via `IntersectionObserver`) and respects `prefers-reduced-motion`; follow the same pattern for any new animated section.
- If you change images or content in `index.html`, remember `index-artifact.html` will need to be regenerated to stay in sync (see above) — it is not auto-updated.

## Design conventions

The vendored `frontend-design` skill (in [.agents/skills/frontend-design/SKILL.md](.agents/skills/frontend-design/SKILL.md)) governs the visual/design approach for this project: make deliberate, brand-specific design choices rather than templated defaults, ground design in the brand's actual world (here: Iranian handmade baby goods — feather motif, warm dusty-rose/cream palette, Vazirmatn/Dancing Script type), and avoid generic AI-design patterns (stock cream+serif, numbered markers without real sequence, etc.). Consult that file before making significant visual changes to the site.
