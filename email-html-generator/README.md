# Email HTML Generator — Figma Plugin

A Figma plugin that converts your email designs into email-client-compliant HTML.
You set up your design using a small number of frame types and configure each
layer through the plugin's **Properties panel** — no code required. A built-in
Issues tab scans your design for problems that would break rendering across major
email clients.

---

## File Structure

```
email-plugin/
├── manifest.json          ← Figma plugin descriptor
├── code.js                ← Main plugin thread (Figma API, HTML generator, issues scanner)
├── ui.html                ← Plugin UI (Properties panel, Export mode, Issues tab)
└── README.md
```

---

## How to install & run locally in Figma

1. Open **Figma Desktop**
2. Go to **Plugins → Development → Import plugin from manifest…**
3. Select the `manifest.json` file from this folder
4. The plugin will appear under **Plugins → Development → Email HTML Generator**

---

## Frame Types

Select a frame and choose its **Frame type** in the Properties panel. There are
four types:

| Frame type   | Purpose                                                       |
|--------------|---------------------------------------------------------------|
| **Template** | Root email container. Wrap the whole email in one of these.   |
| **Section**  | Layout block inside the template. Becomes a layout table.     |
| **Image**    | Renders as an `<img>` using the source URL you set.           |
| **Button**   | CTA button — outputs an Outlook VML button with an `<a>` fallback. |

TEXT layers don't need a frame type — they're detected automatically and rendered
as text.

---

## Setting Properties

Everything is configured through the **Properties panel** for the selected layer.
Depending on the layer type, you can set:

- **Hyperlink** — wraps the layer (or button) in an `<a href="…">`.
- **Image source & alt text** — for Image frames.
- **Semantic text tag** — output a TEXT layer as `<p>` (default) or `<h1>`–`<h6>`.
- **Visibility** — show a layer on mobile only, desktop only, or both.
- **Full-width mobile** — stretch a button to full width on mobile.
- **Background image** — for Template and Section frames.
- **Mobile overrides** — stacking, alignment, padding, gap, font size, and line
  height that apply only on mobile.
- **Email metadata** — subject line, preheader text, and UTM parameters (set on
  the Template).
- **Custom code** — inject raw HTML into the `<head>` or `<body>`.

The panel writes these to the layer for you; there's no need to edit layer names
by hand.

---

## Recommended Figma Structure

The layout itself is up to you — arrange sections and content in any order. What
matters is the nesting:

- **Root frame** — set one frame to the **Template** type. Give it a **fixed
  width** — this defines the email's container width (600px recommended).
  Everything else lives inside it.
- **Sections** — group related content into **Section** frames. Set their
  horizontal resizing to **Fill** so they stretch to the container width and stay
  responsive. These become the layout tables: a horizontal auto-layout section
  renders as a multi-column row; a vertical one stacks its children.
- **Content inside sections** — add text, images (Image frames), and buttons
  (Button frames). Text is picked up automatically.

Nesting is the only rule: Template at the root, Sections inside it, and content
inside the Sections. Order and arrangement can be anything.

---

## HTML Generation Rules

| Layer                        | HTML output                                    |
|------------------------------|------------------------------------------------|
| TEXT layer                   | `<p>` (default), or `<h1>`–`<h6>` if a semantic tag is set |
| Layer with an image fill     | `<img>` with dimensions                        |
| **Image** frame              | `<img>` using the source URL                   |
| **Button** frame             | Outlook VML button + standard `<a>` fallback   |
| Horizontal auto-layout frame | Multi-column `<table>` layout                  |
| Any layer with a link set    | Wrapped in an `<a>`                            |
| **Template** frame (root)    | Full email HTML document with reset CSS        |

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
- ✅ Max-width container pattern (600px recommended)
- ✅ `display:block` on all images

---

## Issues Tab

The Issues tab scans your design and flags anything that would break or degrade
rendering across major email clients — missing image URLs, unsupported fills,
non-web-safe fonts, layout problems, and more. Each issue has a View action to
jump to the layer in Figma, and an Edit action (where applicable) to open the
relevant Properties field directly. The list updates automatically as you make
changes through the Properties panel.
