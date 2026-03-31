# Email HTML Generator — Figma Plugin

A Figma plugin that converts your email designs into email-client-compliant HTML,
using a hashtag-based naming convention to encode HTML attributes directly into
Figma layer names.

---

## File Structure

```
email-plugin/
├── manifest.json   ← Figma plugin descriptor
├── code.js         ← Main plugin thread (Figma API + HTML generator)
├── ui.html         ← Plugin UI (Properties panel + Export + Guide)
└── README.md
```

---

## How to install & run locally in Figma

1. Open **Figma Desktop**
2. Go to **Plugins → Development → Import plugin from manifest…**
3. Select the `manifest.json` file from this folder
4. The plugin will appear under **Plugins → Development → Email HTML Generator**

---

## Layer Naming Convention

All config is stored in the **Figma layer name** using hashtag syntax:

| Tag                       | HTML output                            |
|---------------------------|----------------------------------------|
| `#href(https://...)`      | Wraps element in `<a href="...">`      |
| `#alt(My image)`          | Sets `alt="My image"` on `<img>`       |
| `#src(https://cdn/img)`   | Sets `<img src="...">`                 |
| `#class(hero-block)`      | Adds `class="hero-block"`              |
| `#id(header)`             | Adds `id="header"`                     |
| `#title(Tooltip text)`    | Adds `title="..."` attribute           |
| `#bgcolor(#f4f4f4)`       | Sets TD background color               |
| `#preheader(text)`        | Hidden inbox preview text              |
| `#head(<!-- code -->)`    | Code injected into `<head>`            |
| `#frameType:template`     | Root email container frame             |
| `#frameType:button`       | CTA button (MSO VML-safe)              |
| `#frameType:image`        | Force render as `<img>`                |
| `#frameType:divider`      | Renders as `<hr>`                      |
| `#frameType:section`      | Generic table wrapper                  |
| `#exportimg`              | Flag: export this frame as `<img>`     |
| `#fullwidth`              | Button stretches full-width on mobile  |

---

## Recommended Figma Structure

```
[Desktop] Email Frame              ← #frameType:template
  ├── Header Section               ← #frameType:section
  │   └── Logo Image               ← #frameType:image #src(url) #alt(Logo)
  ├── Hero Section
  │   ├── Hero Image               ← #exportimg #alt(Hero) #href(url)
  │   ├── Headline Text            ← (auto-detected as TEXT node)
  │   └── CTA Button              ← #frameType:button #href(url)
  ├── Body Section
  │   └── Body Text               ← (auto-detected as TEXT node)
  └── Footer Section
      └── Footer Text             ← (auto-detected as TEXT node)
```

---

## HTML Generation Rules

| Node type            | HTML output                                      |
|----------------------|--------------------------------------------------|
| `TEXT`               | `<p>` or `<h2>` (based on font size ≥ 24px)     |
| `RECTANGLE` w/ image | `<img>` with dimensions                          |
| `#frameType:button`  | MSO VML button + standard `<a>` fallback         |
| `#frameType:image`   | `<img>` block                                    |
| `#frameType:divider` | `<hr>` with fill color                           |
| Horizontal auto-layout frame | Multi-column `<table>` layout          |
| Any frame with `#href` | Entire block wrapped in `<a>`                  |
| Root `#frameType:template` | Full email HTML document with reset CSS    |

---

## Email Compliance

The generated HTML includes:
- ✅ Full DOCTYPE and charset declarations
- ✅ Outlook VML button support
- ✅ `mso-table-lspace/rspace` reset
- ✅ Mobile-responsive CSS via `@media` queries
- ✅ `role="presentation"` on all layout tables
- ✅ Preheader hidden text with zero-width joiners
- ✅ `-webkit-text-size-adjust` for iOS
- ✅ Max-width container pattern (default 600px)
- ✅ `display:block` on all images
