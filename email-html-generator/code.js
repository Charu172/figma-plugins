// ============================================================
// EMAIL HTML GENERATOR — FIGMA PLUGIN
// code.js — ES5 only. No const/let/arrow/spread/optional-chain
// ============================================================
//
// BUG FIXES IN THIS VERSION:
// 1. Width: all tables use fixed emailWidth px, NOT width="100%"
//    at the container level — prevents blowout beyond 600px
// 2. Padding: section padding applied to inner <td>, not stripped
// 3. Centering: every section <td> has align="center"; child
//    alignment derived from Figma counterAxisAlignItems
// 4. Grouping: horizontal auto-layout children render as real
//    multi-column <table> with correct fixed column widths
// 5. Text color: text nodes use their OWN fill color, never
//    inheriting their parent frame's background fill
// ============================================================

// ── Tag read/write helpers ───────────────────────────────────
function getTag(name, key) {
  var re = new RegExp('#' + key + '\\(([^)]+)\\)', 'i');
  var m  = name.match(re);
  return m ? m[1].trim() : null;
}
function hasTag(name, key) {
  return new RegExp('#' + key + '\\b', 'i').test(name);
}
function getFrameType(name) {
  var m = name.match(/#frametype:(template|button|image|section|divider)/i);
  return m ? m[1].toLowerCase() : null;
}
function setTag(node, key, value) {
  var re = new RegExp('#' + key + '\\([^)]*\\)', 'gi');
  if (!value) {
    node.name = node.name.replace(re, '').replace(/\s+/g, ' ').trim();
  } else if (re.test(node.name)) {
    node.name = node.name.replace(re, '#' + key + '(' + value + ')');
  } else {
    node.name = node.name.trim() + ' #' + key + '(' + value + ')';
  }
}
function setFrameType(node, type) {
  var n = node.name.replace(/#frametype:\w+/gi, '').replace(/\s+/g, ' ').trim();
  node.name = type ? n + ' #frameType:' + type : n;
}
function setFlag(node, key, active) {
  var n = node.name.replace(new RegExp('#' + key + '\\b', 'gi'), '').replace(/\s+/g, ' ').trim();
  node.name = active ? n + ' #' + key : n;
}
function parseNodeConfig(node) {
  var n = node.name || '';
  var gpd = function(key) { return (node.getPluginData ? (node.getPluginData(key) || '') : ''); };
  return {
    frameType:       getFrameType(n),
    href:            getTag(n, 'href'),
    alt:             getTag(n, 'alt'),
    src:             getTag(n, 'src'),
    className:       getTag(n, 'class'),
    id:              getTag(n, 'id'),
    // preheader and head stored in pluginData (may contain parens that break tag regex)
    preheader:       gpd('preheader') || getTag(n, 'preheader') || '',
    head:            gpd('head')     || getTag(n, 'head')     || '',
    exportImg:       hasTag(n, 'exportimg'),
    fullWidthMobile: hasTag(n, 'fullwidth'),
    // New fields
    visibility:      getTag(n, 'visibility') || '',   // '' | 'mobile' | 'desktop'
    imgFormat:       getTag(n, 'imgformat')  || 'png',
    comment:         gpd('comment'),
    rawCode:         gpd('rawCode'),
    // Template metadata fields
    subject:         gpd('subject'),
    utmSource:       gpd('utmSource'),
    utmMedium:       gpd('utmMedium'),
    utmCampaign:     gpd('utmCampaign'),
    utmContent:      gpd('utmContent'),
    utmTerm:         gpd('utmTerm'),
  };
}

// ── Colour ───────────────────────────────────────────────────
function toHex2(v) {
  var h = Math.round(Math.min(255, Math.max(0, v * 255))).toString(16);
  return h.length < 2 ? '0' + h : h;
}
function rgbaToHex(r, g, b) {
  return '#' + toHex2(r) + toHex2(g) + toHex2(b);
}
function getSolidFill(node) {
  if (!node.fills || node.fills === figma.mixed || !node.fills.length) return null;
  var f = node.fills[0];
  if (f.visible === false) return null;
  if (f.type !== 'SOLID') return null;
  var a = (typeof f.opacity === 'number') ? f.opacity : 1;
  if (a <= 0) return null;
  if (a >= 1) return rgbaToHex(f.color.r, f.color.g, f.color.b);
  var r = f.color.r * a + (1 - a);
  var g = f.color.g * a + (1 - a);
  var b = f.color.b * a + (1 - a);
  return rgbaToHex(r, g, b);
}
function getTextColor(node) {
  if (!node.fills || node.fills === figma.mixed || !node.fills.length) return '#000000';
  var f = node.fills[0];
  if (f.visible === false) return '#000000';
  if (f.type !== 'SOLID') return '#000000';
  var a = (typeof f.opacity === 'number') ? f.opacity : 1;
  if (a <= 0) return '#000000';
  if (a >= 1) return rgbaToHex(f.color.r, f.color.g, f.color.b);
  var r = f.color.r * a + (1 - a);
  var g = f.color.g * a + (1 - a);
  var b = f.color.b * a + (1 - a);
  return rgbaToHex(r, g, b);
}

// ── Safe helpers ─────────────────────────────────────────────
function safeNum(v, fb) {
  return (typeof v === 'number' && isFinite(v)) ? v : (fb !== undefined ? fb : 0);
}
function escapeHtml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function ind(depth) {
  var s = '';
  for (var i = 0; i < depth; i++) s += '  ';
  return s;
}

// ── Padding ──────────────────────────────────────────────────
function getPad(node) {
  return {
    t: safeNum(node.paddingTop,    0),
    r: safeNum(node.paddingRight,  0),
    b: safeNum(node.paddingBottom, 0),
    l: safeNum(node.paddingLeft,   0),
  };
}
function padCSS(p) {
  if (!p.t && !p.r && !p.b && !p.l) return '';
  return 'padding:' + p.t + 'px ' + p.r + 'px ' + p.b + 'px ' + p.l + 'px;';
}
function gap(node) { return safeNum(node.itemSpacing, 0); }

// ── Corner radii ─────────────────────────────────────────────
// Returns an object describing all four corner radii.
//   tl / tr / br / bl  — individual corner values in px
//   uniform            — true when all four are equal
//   any                — true when at least one corner > 0
//   css                — ready-to-emit border-radius CSS string
//                        e.g. "border-radius:8px;"
//                        or   "border-radius:8px 0px 8px 0px;"  (TL TR BR BL)
//   maxVal             — largest single corner value (used for VML arcsize)
function getCornerRadii(node) {
  var uniform = (node.cornerRadius !== figma.mixed && typeof node.cornerRadius === 'number');
  var tl, tr, br, bl;
  if (uniform) {
    tl = tr = br = bl = Math.round(node.cornerRadius);
  } else {
    tl = Math.round(typeof node.topLeftRadius     === 'number' ? node.topLeftRadius     : 0);
    tr = Math.round(typeof node.topRightRadius    === 'number' ? node.topRightRadius    : 0);
    br = Math.round(typeof node.bottomRightRadius === 'number' ? node.bottomRightRadius : 0);
    bl = Math.round(typeof node.bottomLeftRadius  === 'number' ? node.bottomLeftRadius  : 0);
  }
  var anyVal  = tl || tr || br || bl;
  var allSame = (tl === tr && tr === br && br === bl);
  var css = '';
  if (anyVal) {
    css = allSame
      ? 'border-radius:' + tl + 'px;'
      : 'border-radius:' + tl + 'px ' + tr + 'px ' + br + 'px ' + bl + 'px;';
  }
  var maxVal = Math.max(tl, tr, br, bl);
  return { tl: tl, tr: tr, br: br, bl: bl, uniform: allSame, any: !!anyVal, css: css, maxVal: maxVal };
}

// ── Stroke ───────────────────────────────────────────────────
function getStroke(node) {
  if (!node.strokes || node.strokes === figma.mixed || !node.strokes.length) return null;
  var s = node.strokes[0];
  if (s.visible === false) return null;
  if (s.type !== 'SOLID') return null;
  var color = rgbaToHex(s.color.r, s.color.g, s.color.b);

  var wTop    = safeNum(node.strokeTopWeight,    -1);
  var wRight  = safeNum(node.strokeRightWeight,  -1);
  var wBottom = safeNum(node.strokeBottomWeight, -1);
  var wLeft   = safeNum(node.strokeLeftWeight,   -1);
  var wUniform = (node.strokeWeight !== figma.mixed) ? safeNum(node.strokeWeight, 0) : 0;

  var hasPerSide = (wTop >= 0 || wRight >= 0 || wBottom >= 0 || wLeft >= 0) &&
                   (wTop !== wRight || wRight !== wBottom || wBottom !== wLeft);

  if (hasPerSide) {
    var t = wTop    >= 0 ? wTop    : wUniform;
    var r = wRight  >= 0 ? wRight  : wUniform;
    var b = wBottom >= 0 ? wBottom : wUniform;
    var l = wLeft   >= 0 ? wLeft   : wUniform;
    var css = '';
    if (t > 0) css += 'border-top:'    + t + 'px solid ' + color + ';';
    if (r > 0) css += 'border-right:'  + r + 'px solid ' + color + ';';
    if (b > 0) css += 'border-bottom:' + b + 'px solid ' + color + ';';
    if (l > 0) css += 'border-left:'   + l + 'px solid ' + color + ';';
    if (!css) return null;
    return { color: color, weight: Math.max(t, r, b, l), css: css, perSide: true };
  }

  var weight = wUniform > 0 ? wUniform : (wTop >= 0 ? wTop : 1);
  if (!weight) return null;
  weight = Math.round(weight);
  return { color: color, weight: weight, css: 'border:' + weight + 'px solid ' + color + ';', perSide: false };
}

// ── Figma alignment → HTML/CSS ───────────────────────────────
function hAlign(figmaAlign) {
  if (!figmaAlign) return 'left';
  var a = figmaAlign.toLowerCase();
  if (a === 'center') return 'center';
  if (a === 'right' || a === 'max') return 'right';
  return 'left';
}
function containerHAlign(node) {
  var ca = node.counterAxisAlignItems || 'MIN';
  return hAlign(ca);
}
function containerVAlign(node) {
  var ca = node.counterAxisAlignItems || 'MIN';
  if (ca === 'CENTER')   return 'middle';
  if (ca === 'MAX')      return 'bottom';
  if (ca === 'BASELINE') return 'baseline';
  return 'top';
}

// ── Is this a decorative background shape (skip in output)? ──
function isDecorative(node) {
  if (node.type !== 'RECTANGLE') return false;
  if (node.children && node.children.length > 0) return false;
  var cfg = parseNodeConfig(node);
  if (cfg.src || cfg.exportImg || cfg.frameType === 'image') return false;
  if (!node.fills || node.fills === figma.mixed || !node.fills.length) return false;
  for (var i = 0; i < node.fills.length; i++) {
    if (node.fills[i].type === 'IMAGE') return false;
  }
  return true;
}

// ── Is this node rendered as a flat <img>? ───────────────────
function isImgNode(node) {
  var cfg = parseNodeConfig(node);
  if (cfg.src || cfg.exportImg || cfg.frameType === 'image') return true;
  // Vector-type nodes can only become an <img> if the user explicitly tagged them
  // with #src() or #exportimg. Without that tag there is no URL to emit, so they
  // must NOT be treated as images — they will be silently skipped by the caller.
  var t = node.type;
  if (t === 'VECTOR' || t === 'STAR' || t === 'POLYGON' ||
      t === 'ELLIPSE' || t === 'BOOLEAN_OPERATION' || t === 'LINE') {
    // Only opt-in vectors become images
    return !!(cfg.src || cfg.exportImg || cfg.frameType === 'image');
  }
  if (node.fills && node.fills !== figma.mixed) {
    for (var i = 0; i < node.fills.length; i++) {
      if (node.fills[i].type === 'IMAGE') return true;
    }
  }
  return false;
}

// ── Is this frame a styled icon/image container? ─────────────
// ONLY matches a frame whose every visible non-decorative child is a
// true leaf image node — i.e. has no children of its own and resolves
// to a flat <img>. A child that is itself a frame (even one tagged
// #exportimg) with its own sub-children must NOT match here, because
// it needs its own full renderNode treatment (bg, padding, radius…).
function isIconContainer(node) {
  if (node.type !== 'FRAME' && node.type !== 'COMPONENT' && node.type !== 'INSTANCE') return false;
  if (!node.children || node.children.length === 0) return false;
  var hasFill = !!getSolidFill(node);
  var hasRad  = getCornerRadii(node).any;
  if (!hasFill && !hasRad) return false;
  var visKids = [];
  for (var i = 0; i < node.children.length; i++) {
    var c = node.children[i];
    if (c.visible === false) continue;
    if (isDecorative(c)) continue;
    visKids.push(c);
  }
  if (!visKids.length) return false;
  for (var j = 0; j < visKids.length; j++) {
    var kid = visKids[j];
    // Disqualify if the child has its own children — it needs full renderNode treatment
    if (kid.children && kid.children.length > 0) return false;
    if (!isImgNode(kid)) return false;
  }
  return true;
}

// ── Render <img> tag ─────────────────────────────────────────
// align: 'left'|'center'|'right' — defaults to 'center'
function renderImg(node, cfg, d, align) {
  align = align || 'center';
  var src = cfg.src || '';
  var alt = cfg.alt || '';
  var w   = Math.round(node.width);
  var h   = Math.round(node.height);

  // SMALL ICON OPTIMISATION: images ≤ 48px in both dimensions skip the
  // outer <table> wrapper and emit a bare <img> tag. This dramatically
  // reduces nesting depth for social media icons, avatar badges, and
  // similar small graphics. Deep nesting (table→tr→td→table→tr→td→img)
  // causes Gmail iOS's proportional-scaling engine to compound rounding
  // errors, shrinking 24px icons to ~15px. A bare <img> inside the
  // parent <td> renders at its declared width on all clients.
  // BeeFree uses this same flat pattern for social icons (width="32").
  var isSmallIcon = (w <= 48 && h <= 48 && w > 0 && h > 0);
  if (isSmallIcon) {
    var sst = 'display:block;width:' + w + 'px;height:auto;border:0;';
    var simgTag = ind(d) + '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(alt) +
                 '" width="' + w + '" height="' + h + '" border="0" style="' + sst + '">';
    if (cfg.href) {
      simgTag = ind(d) + '<a href="' + escapeHtml(cfg.href) + '" target="_blank" ' +
              'style="display:block;text-decoration:none;">\n' +
              simgTag + '\n' +
              ind(d) + '</a>';
    }
    return simgTag;
  }

  var isFillImg = (node.layoutGrow === 1) || (node.layoutSizingHorizontal === 'FILL');
  // In mobile render mode, large images (>= 50% of mobile frame width) become
  // fluid so they don't overflow narrow phone viewports.
  var isMobileFluidImg = _mobileMode && !isFillImg && w >= (_mobileFrameW * 0.5);
  var tblW      = (!isFillImg && !isMobileFluidImg && w > 0) ? w : null;
  var marginStyle = tblW
    ? (align === 'left'  ? 'margin-right:auto;'
     : align === 'right' ? 'margin-left:auto;'
     : 'margin:0 auto;')
    : '';
  var tblWAttr  = tblW ? ' width="' + tblW + '" align="' + align + '"' : ' width="100%"';
  var tblWSty   = tblW ? 'width:' + tblW + 'px;max-width:' + tblW + 'px;' + marginStyle : 'width:100%;';
  // Fluid mobile img: use width:100% on the img tag so it scales with the container.
  // Fixed: keep exact pixel width (preserves size on desktop/Outlook).
  var st = isMobileFluidImg
    ? 'display:block;width:100%;max-width:' + w + 'px;height:auto;border:0;'
    : 'display:block;width:' + w + 'px;height:auto;border:0;';
  var imgTag = ind(d+2) + '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(alt) +
               '" width="' + w + '" height="' + h + '" border="0" style="' + st + '">';

  var inner = ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' + tblWAttr + ' style="' + tblWSty + '">\n' +
    ind(d+1) + '<tr>\n' +
    ind(d+1) + '<td>\n' +
    imgTag + '\n' +
    ind(d+1) + '</td>\n' +
    ind(d+1) + '</tr>\n' +
    ind(d) + '</table>';

  if (cfg.href) {
    inner = ind(d) + '<a href="' + escapeHtml(cfg.href) + '" target="_blank" ' +
            'style="display:block;text-decoration:none;">\n' +
            inner + '\n' +
            ind(d) + '</a>';
  }
  return inner;
}

// ── Render bare <img> tag (no table wrapper) ─────────────────
function renderBareImg(node, cfg, d) {
  var src = cfg.src || '';
  var alt = cfg.alt || '';
  var w   = Math.round(node.width);
  var h   = Math.round(node.height);
  var st  = 'display:block;width:' + w + 'px;height:auto;border:0;margin:0 auto;';
  return ind(d) + '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(alt) +
         '" width="' + w + '" height="' + h + '" border="0" style="' + st + '">';
}

// ── Render icon/image container ──────────────────────────────
function renderIconContainer(node, cfg, d) {
  var bg  = getSolidFill(node);
  var rad = getCornerRadii(node);
  var pad = getPad(node);
  var w   = Math.round(node.width);

  var visKids = [];
  for (var i = 0; i < node.children.length; i++) {
    var c = node.children[i];
    if (c.visible === false || isDecorative(c)) continue;
    visKids.push(c);
  }

  var imgHtml = '';
  for (var j = 0; j < visKids.length; j++) {
    var kidCfg = parseNodeConfig(visKids[j]);
    imgHtml += renderBareImg(visKids[j], kidCfg, d+1) + '\n';
  }

  var bgS  = bg ? 'background-color:' + bg + ';' : '';
  var padS = padCSS(pad);

  var isFill   = (node.layoutGrow === 1);
  var tblW     = (!isFill && w > 0) ? w : null;
  var tblWAttr = tblW ? ' width="' + tblW + '" align="center"' : ' width="100%"';
  var tblWSty  = tblW ? 'width:' + tblW + 'px;max-width:' + tblW + 'px;margin:0 auto;' : 'width:100%;';

  var inner;
  if (rad.any) {
    inner = roundedWrapper(bgS, padS, rad, imgHtml.trim(), d);
  } else if (bgS || padS) {
    var tdStyle = bgS + padS;
    inner = ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' + tblWAttr + ' style="' + tblWSty + '">\n' +
      ind(d+1) + '<tr>\n' +
      ind(d+2) + '<td' + (bg ? ' bgcolor="' + bg + '"' : '') + (tdStyle ? ' style="' + tdStyle + '"' : '') + '>\n' +
      imgHtml.trim() + '\n' +
      ind(d+2) + '</td>\n' +
      ind(d+1) + '</tr>\n' +
      ind(d) + '</table>';
  } else {
    inner = imgHtml.trim();
  }

  if (cfg.href) {
    inner = ind(d) + '<a href="' + escapeHtml(cfg.href) + '" target="_blank" style="display:block;text-decoration:none;">\n' +
      inner + '\n' + ind(d) + '</a>';
  }
  return inner;
}

// ── Per-segment fill → hex (takes fills array, not node) ─────
function segmentFillColor(fills) {
  if (!fills || !fills.length) return null;
  var f = fills[0];
  if (f.visible === false) return null;
  if (f.type !== 'SOLID') return null;
  var a = (typeof f.opacity === 'number') ? f.opacity : 1;
  if (a <= 0) return null;
  if (a >= 1) return rgbaToHex(f.color.r, f.color.g, f.color.b);
  var r = f.color.r * a + (1 - a);
  var g = f.color.g * a + (1 - a);
  var b = f.color.b * a + (1 - a);
  return rgbaToHex(r, g, b);
}

// ── Build rich-text innerHTML using per-segment <span> tags ──
// Handles mixed color, size, weight, italic, decoration, case,
// and letter-spacing — all as inline CSS (email-client-safe).
// Falls back to plain escaped text if the node has only one
// uniform style or if getStyledTextSegments is unavailable.
function buildSegmentedText(node, baseColor, baseFontSize) {
  var segments;
  try {
    segments = node.getStyledTextSegments([
      'fills', 'fontSize', 'fontName',
      'textDecoration', 'textCase', 'letterSpacing'
    ]);
  } catch(e) {
    return escapeHtml(node.characters || '').replace(/\n/g, '<br>');
  }
  if (!segments || segments.length < 2) {
    return escapeHtml(node.characters || '').replace(/\n/g, '<br>');
  }

  var html = '';
  for (var si = 0; si < segments.length; si++) {
    var seg = segments[si];
    if (!seg.characters) continue;

    var spanSt = [];

    // ── Color ──────────────────────────────────────────────
    var sColor = segmentFillColor(seg.fills);
    if (sColor && sColor !== baseColor) {
      spanSt.push('color:' + sColor);
    }

    // ── Font size ──────────────────────────────────────────
    var sFs = safeNum(seg.fontSize, baseFontSize);
    if (Math.round(sFs) !== Math.round(baseFontSize)) {
      spanSt.push('font-size:' + Math.round(sFs) + 'px');
      // keep line-height proportional when size changes
      spanSt.push('line-height:' + Math.round(sFs * 1.5) + 'px');
    }

    // ── Font weight + style ────────────────────────────────
    if (seg.fontName && seg.fontName !== figma.mixed) {
      var sStyle  = (seg.fontName.style || '').toLowerCase();
      var sBold   = sStyle.indexOf('bold')   !== -1;
      var sItalic = sStyle.indexOf('italic') !== -1;
      if (sBold)   spanSt.push('font-weight:bold');
      if (sItalic) spanSt.push('font-style:italic');
    }

    // ── Text decoration ────────────────────────────────────
    var sTd = seg.textDecoration;
    if (sTd && sTd !== figma.mixed) {
      if      (sTd === 'UNDERLINE')      spanSt.push('text-decoration:underline');
      else if (sTd === 'STRIKETHROUGH')  spanSt.push('text-decoration:line-through');
    }

    // ── Text case ──────────────────────────────────────────
    var sTt = seg.textCase;
    if (sTt && sTt !== figma.mixed) {
      if      (sTt === 'UPPER') spanSt.push('text-transform:uppercase');
      else if (sTt === 'LOWER') spanSt.push('text-transform:lowercase');
      else if (sTt === 'TITLE') spanSt.push('text-transform:capitalize');
    }

    // ── Letter spacing ─────────────────────────────────────
    var sLs = seg.letterSpacing;
    if (sLs && sLs !== figma.mixed) {
      if (sLs.unit === 'PIXELS' && sLs.value !== 0) {
        spanSt.push('letter-spacing:' + sLs.value.toFixed(1) + 'px');
      } else if (sLs.unit === 'PERCENT' && sLs.value !== 0) {
        spanSt.push('letter-spacing:' + (sLs.value / 100).toFixed(3) + 'em');
      }
    }

    var segText = escapeHtml(seg.characters).replace(/\n/g, '<br>');
    if (spanSt.length > 0) {
      html += '<span style="' + spanSt.join(';') + '">' + segText + '</span>';
    } else {
      html += segText;
    }
  }
  return html;
}

// ── Render TEXT node ─────────────────────────────────────────
function renderText(node, cfg, d) {
  var st = [];
  var fs = safeNum(node.fontSize, 14);
  st.push('font-size:' + Math.round(fs) + 'px');
  st.push('mso-line-height-rule:exactly');

  if (node.fontName && node.fontName !== figma.mixed) {
    st.push("font-family:'" + escapeHtml(node.fontName.family) + "',Arial,sans-serif");
    var style  = node.fontName.style || '';
    var bold   = style.toLowerCase().indexOf('bold')   !== -1;
    var italic = style.toLowerCase().indexOf('italic') !== -1;
    st.push('font-weight:' + (bold ? 'bold' : 'normal'));
    if (italic) st.push('font-style:italic');
  }

  // When fills are mixed (per-character color), getTextColor returns #000000
  // as the base <p> colour.  buildSegmentedText will wrap each run that
  // differs from the base in a <span style="color:..."> so the per-character
  // colour is always honoured in the generated HTML.
  var baseColor = getTextColor(node);
  st.push('color:' + baseColor);

  if (node.textAlignHorizontal) st.push('text-align:' + hAlign(node.textAlignHorizontal));

  var lh = node.lineHeight;
  if (lh && lh !== figma.mixed && lh.unit === 'PIXELS') {
    st.push('line-height:' + Math.round(lh.value) + 'px');
  } else if (lh && lh !== figma.mixed && lh.unit === 'PERCENT') {
    st.push('line-height:' + Math.round(fs * lh.value / 100) + 'px');
  } else {
    st.push('line-height:' + Math.round(fs * 1.5) + 'px');
  }

  var ls = node.letterSpacing;
  if (ls && ls !== figma.mixed && ls.unit === 'PIXELS' && ls.value !== 0) {
    st.push('letter-spacing:' + ls.value.toFixed(1) + 'px');
  } else if (ls && ls !== figma.mixed && ls.unit === 'PERCENT' && ls.value !== 0) {
    st.push('letter-spacing:' + (ls.value / 100).toFixed(3) + 'em');
  }

  var td = node.textDecoration;
  if (td && td !== figma.mixed) {
    if (td === 'UNDERLINE')          st.push('text-decoration:underline');
    else if (td === 'STRIKETHROUGH') st.push('text-decoration:line-through');
  }

  var tt = node.textCase;
  if (tt && tt !== figma.mixed) {
    if (tt === 'UPPER')       st.push('text-transform:uppercase');
    else if (tt === 'LOWER')  st.push('text-transform:lowercase');
    else if (tt === 'TITLE')  st.push('text-transform:capitalize');
  }

  if (typeof node.opacity === 'number' && node.opacity < 1) {
    st.push('opacity:' + node.opacity.toFixed(2));
  }

  var autoResize = node.textAutoResize || 'NONE';
  var isHugText  = (autoResize === 'WIDTH_AND_HEIGHT' || autoResize === 'TRUNCATE');

  // In mobile rendering context, only protect genuinely narrow hug labels from
  // word-wrap (counters, dates, chip text — things < 50% of the mobile frame).
  // Wide hug text (>= 50% of mobile frame width) must be allowed to reflow so it
  // doesn't overflow a narrow phone viewport. In non-mobile mode, all hug text
  // keeps white-space:nowrap exactly as before (no change to desktop behaviour).
  var hugTextW     = isHugText ? Math.round(node.width) : 0;
  var mobileNowrap = !_mobileMode || (hugTextW > 0 && hugTextW < _mobileFrameW * 0.5);

  if (isHugText && mobileNowrap) {
    st.push('white-space:nowrap');
  }

  st.push('margin:0');
  st.push('padding:0');

  // Use segmented rendering to capture per-run color / weight / size changes.
  // Falls back to plain text for single-style nodes (no overhead).
  var rawText = buildSegmentedText(node, baseColor, fs);
  // nowrap-lbl ensures the mobile media query does not strip white-space:nowrap
  // from short hug-text labels (dates, counters, etc.).
  // Wide hug text in mobile mode omits the class so @media can reset white-space.
  var isHugP = isHugText && mobileNowrap;
  var html = '<p' + (isHugP ? ' class="nowrap-lbl"' : '') + ' style="' + st.join(';') + '">' + rawText + '</p>';
  if (cfg.href) {
    html = '<a href="' + escapeHtml(cfg.href) + '" target="_blank" style="color:inherit;text-decoration:none;">' + html + '</a>';
  }

  // layoutGrow=1               → fills PRIMARY axis (width when parent is HORIZONTAL).
  // layoutAlign='STRETCH'      → fills COUNTER axis (width when parent is VERTICAL).
  // layoutSizingHorizontal='FILL' → Figma's explicit fill-width flag (newer API).
  var isFillTxt = (node.layoutGrow === 1) || (node.layoutAlign === 'STRETCH') || (node.layoutSizingHorizontal === 'FILL');
  if (!isFillTxt && (autoResize === 'NONE' || autoResize === 'HEIGHT')) {
    var tw = Math.round(node.width);
    if (tw > 0) {
      // In mobile render mode, wide text wrappers become fluid so they never
      // overflow a narrow phone viewport. Small labels (< 50% of mobile frame)
      // keep their fixed pixel width to preserve badge / chip sizes.
      var isMobileFluidTxt = _mobileMode && tw >= (_mobileFrameW * 0.5);
      var txtWAttr, txtWSty;
      if (isMobileFluidTxt) {
        txtWAttr = ' width="100%"';
        txtWSty  = 'width:100%;';
      } else {
        txtWAttr = ' width="' + tw + '" align="center"';
        txtWSty  = 'width:' + tw + 'px;max-width:' + tw + 'px;margin:0 auto;';
      }
      html = ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' + txtWAttr + ' style="' + txtWSty + '">\n' +
        ind(d+1) + '<tr><td>\n' +
        ind(d+2) + html + '\n' +
        ind(d+1) + '</td></tr>\n' +
        ind(d) + '</table>';
      return html;
    }
  }

  return ind(d) + html;
}

// ── Render BUTTON ────────────────────────────────────────────
function renderButton(node, cfg, d, parentAlign) {
  var bg    = getSolidFill(node) || '#0066cc';
  var pad   = getPad(node);

  // If the button frame has no padding itself, check if the first child frame
  // carries the padding (common pattern: outer wrapper → inner rounded frame)
  var innerFrame = null;
  if (!pad.t && !pad.r && !pad.b && !pad.l && node.children) {
    for (var fi = 0; fi < node.children.length; fi++) {
      var fc = node.children[fi];
      if (fc.visible !== false && (fc.type === 'FRAME' || fc.type === 'COMPONENT' || fc.type === 'INSTANCE')) {
        innerFrame = fc;
        break;
      }
    }
    if (innerFrame) {
      var innerPad = getPad(innerFrame);
      if (innerPad.t || innerPad.r || innerPad.b || innerPad.l) pad = innerPad;
      var innerBg = getSolidFill(innerFrame);
      if (innerBg) bg = innerBg;
    }
  }

  var btnP  = (pad.t || pad.r || pad.b || pad.l)
    ? pad.t + 'px ' + pad.r + 'px ' + pad.b + 'px ' + pad.l + 'px'
    : '14px 32px';

  // Corner radius: check node first, then inner child frame
  var rad = getCornerRadii(node);
  if (!rad.any && innerFrame) rad = getCornerRadii(innerFrame);

  var btnW = Math.round(node.width);
  var btnH = Math.round(node.height);

  var isFill = (node.layoutGrow === 1) || (node.layoutSizingHorizontal === 'FILL') || (node.layoutAlign === 'STRETCH');
  // Mobile fluid: wide fixed-width buttons OR those explicitly marked fullWidthMobile.
  var isMobileFluidBtn = _mobileMode && !isFill && (cfg.fullWidthMobile || btnW >= (_mobileFrameW * 0.5));

  // Alignment: use parentAlign (from Figma's counterAxisAlignItems on the parent
  // or the button's own layoutAlign override). Default to 'center' only when no
  // alignment context exists — most standalone buttons are centered.
  var btnAlign  = parentAlign || 'center';
  var btnMargin = btnAlign === 'left'  ? 'margin-right:auto;margin-left:0;'
                : btnAlign === 'right' ? 'margin-left:auto;margin-right:0;'
                : 'margin:0 auto;';

  var vmlWidthStyle, tblAttrs, tblStyle;
  if (isFill || isMobileFluidBtn) {
    vmlWidthStyle = 'height:' + btnH + 'px;v-text-anchor:middle;width:100%;';
    tblAttrs      = ' width="100%"';
    tblStyle      = 'width:100%;';
  } else {
    vmlWidthStyle = 'height:' + btnH + 'px;v-text-anchor:middle;width:' + btnW + 'px;';
    tblAttrs      = ' width="' + btnW + '" align="' + btnAlign + '"';
    tblStyle      = 'width:' + btnW + 'px;max-width:' + btnW + 'px;' + btnMargin;
  }

  var tn = null;
  if (node.findOne) tn = node.findOne(function(n) { return n.type === 'TEXT'; });
  var label   = tn ? escapeHtml(tn.characters || '') : 'Click here';
  var tColor  = tn ? getTextColor(tn) : '#ffffff';
  var tSize   = tn ? safeNum(tn.fontSize, 16) : 16;
  var tFont   = 'Arial,sans-serif';
  var tWeight = 'bold';
  if (tn && tn.fontName && tn.fontName !== figma.mixed) {
    tFont   = "'" + escapeHtml(tn.fontName.family) + "',Arial,sans-serif";
    tWeight = tn.fontName.style && tn.fontName.style.toLowerCase().indexOf('bold') !== -1 ? 'bold' : 'normal';
  }

  var tAlign = (tn && tn.textAlignHorizontal) ? hAlign(tn.textAlignHorizontal) : 'center';
  var href   = escapeHtml(cfg.href || '#');
  // VML arcsize uses the largest corner value against the shorter dimension
  var arcPct = btnH > 0 ? Math.min(100, Math.round((rad.maxVal / (btnH / 2)) * 100)) : 0;

  // Per-corner border-radius for the <a> tag (modern clients)
  var radCSS = rad.any ? rad.css : '';

  var aStyle = 'display:inline-block;white-space:nowrap;background-color:' + bg + ';color:' + tColor +
    ';text-decoration:none;font-family:' + tFont + ';font-size:' + tSize +
    'px;font-weight:' + tWeight + ';padding:' + btnP + ';' +
    radCSS + 'mso-padding-alt:0;text-align:' + tAlign + ';-webkit-text-size-adjust:none;';

  var vml = '<!--[if mso]>' +
    '<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"' +
    ' href="' + href + '"' +
    ' style="' + vmlWidthStyle + '"' +
    ' arcsize="' + arcPct + '%" stroke="f" fillcolor="' + bg + '">' +
    '<w:anchorlock/>' +
    '<center style="white-space:nowrap;color:' + tColor + ';font-family:' + tFont + ';font-size:' + tSize + 'px;font-weight:' + tWeight + ';padding:' + btnP + ';">' + label + '</center>' +
    '</v:roundrect><![endif]-->';

  // td border-radius: use per-corner when mixed, single value when uniform
  var tdRadCSS = rad.any ? rad.css : '';

  // full-width-mobile class: in single-frame responsive mode _mobileMode is
  // never true, so we rely on the @media CSS rule to expand the button.
  var fwmClass = (cfg.fullWidthMobile && !isFill && !isMobileFluidBtn) ? ' class="full-width-mobile"' : '';

  return ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' +
    fwmClass + tblAttrs + ' style="' + tblStyle + '">\n' +
    ind(d+1) + '<tr>\n' +
    ind(d+2) + '<td align="' + tAlign + '" bgcolor="' + bg + '"' +
    ' style="' + tdRadCSS + 'overflow:hidden;background-color:' + bg + ';mso-line-height-rule:exactly;">\n' +
    ind(d+3) + vml + '\n' +
    ind(d+3) + '<!--[if !mso]><!-->\n' +
    ind(d+3) + '<a href="' + href + '" target="_blank" style="' + aStyle + '">' + label + '</a>\n' +
    ind(d+3) + '<!--<![endif]-->\n' +
    ind(d+2) + '</td>\n' +
    ind(d+1) + '</tr>\n' +
    ind(d) + '</table>';
}

// ── Render DIVIDER ───────────────────────────────────────────
function renderDivider(node, cfg, d) {
  var stroke = getStroke(node);
  var color  = stroke ? stroke.color  : '#cccccc';
  var weight = stroke ? stroke.weight : 1;
  var w      = Math.round(node.width) || 600;
  // Mobile fluid: wide dividers stretch to fill the container width.
  var isMobileFluidDiv = _mobileMode && w >= (_mobileFrameW * 0.5);
  var divWAttr = isMobileFluidDiv ? ' width="100%"' : (' width="' + w + '" align="center"');
  var divWSty  = isMobileFluidDiv ? 'width:100%;' : ('width:' + w + 'px;max-width:' + w + 'px;margin:0 auto;');

  return ind(d) +
    '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' + divWAttr + ' style="' + divWSty + '">\n' +
    ind(d+1) + '<tr>\n' +
    ind(d+2) + '<td style="border-top:' + weight + 'px solid ' + color + ';font-size:0;line-height:0;">&nbsp;</td>\n' +
    ind(d+1) + '</tr>\n' +
    ind(d) + '</table>';
}

// ── Rounded container helper ─────────────────────────────────
// rad    — object from getCornerRadii()
// nested — true when already inside another roundedWrapper
//
// APPROACH: border-radius lives on the outer <table> element (like BeeFree),
// NOT on a <div> wrapper. Gmail iOS doesn't reliably stretch <div> elements
// to 100% of their parent <td> width — it calculates div width from content,
// causing coloured sections (banners) to appear narrower than the container.
// Tables, by contrast, always respect their width attribute/style on Gmail iOS.
//
// Structure:
//   Modern clients: <table border-radius + bg + overflow:hidden> <td padding> content
//   Outlook (MSO):  VML roundrect with padding in the <td>
//
// border-collapse:separate is required for border-radius on <table> to work.
function roundedWrapper(bg, pad, rad, innerHtml, d, nested) {
  if (!rad || !rad.any) {
    var plainStyle = (bg || '') + (pad || '');
    if (!plainStyle) return innerHtml;
    return ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%">\n' +
      ind(d+1) + '<tr>\n' +
      ind(d+2) + '<td' + (bg ? ' bgcolor="' + bg.replace('background-color:', '').replace(';','').trim() + '"' : '') +
      (plainStyle ? ' style="' + plainStyle + '"' : '') + '>\n' +
      innerHtml + '\n' +
      ind(d+2) + '</td>\n' +
      ind(d+1) + '</tr>\n' +
      ind(d) + '</table>';
  }

  var bgColor      = bg  ? bg.replace('background-color:', '').replace(';', '').trim() : 'transparent';
  var padVal       = pad ? pad.replace('padding:', '').replace(';', '').trim() : '';
  var isTransparent = (bgColor === 'transparent' || bgColor === '');

  var radCSSValue = rad.uniform
    ? rad.tl + 'px'
    : rad.tl + 'px ' + rad.tr + 'px ' + rad.br + 'px ' + rad.bl + 'px';

  // Table-level border-radius style (for modern clients).
  // border-collapse:separate is required for border-radius on <table>.
  var tblRadStyle = 'border-collapse:separate;border-spacing:0;border-radius:' + radCSSValue + ';overflow:hidden;' +
    (!isTransparent ? 'background-color:' + bgColor + ';' : '');

  // TD carries padding + bg for all clients.
  var tdStyle = (padVal ? 'padding:' + padVal + ';' : '') +
    (!isTransparent ? 'background-color:' + bgColor + ';' : '');
  var tdBgAttr = !isTransparent ? ' bgcolor="' + bgColor + '"' : '';

  // CSS-only path: nested frames or transparent bg (no VML).
  if (nested || isTransparent) {
    // Pure visual clip (transparent + no padding) — just add radius to table.
    if (isTransparent && !padVal) {
      return ind(d) + '<!--[if !mso]><!-->\n' +
        ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="' + tblRadStyle + '">\n' +
        ind(d+1) + '<tr>\n' +
        ind(d+2) + '<td>\n' +
        innerHtml + '\n' +
        ind(d+2) + '</td>\n' +
        ind(d+1) + '</tr>\n' +
        ind(d) + '</table>\n' +
        ind(d) + '<!--<![endif]-->\n' +
        ind(d) + '<!--[if mso]>\n' +
        innerHtml + '\n' +
        ind(d) + '<![endif]-->';
    }

    // Has bg or padding. Table carries radius, TD carries padding + bg.
    // For Outlook (no border-radius support): MSO conditional injects padding
    // on a plain table without radius styling.
    return ind(d) + '<!--[if !mso]><!-->\n' +
      ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="' + tblRadStyle + '">\n' +
      ind(d+1) + '<tr>\n' +
      ind(d+2) + '<td' + tdBgAttr + (tdStyle ? ' style="' + tdStyle + '"' : '') + '>\n' +
      innerHtml + '\n' +
      ind(d+2) + '</td>\n' +
      ind(d+1) + '</tr>\n' +
      ind(d) + '</table>\n' +
      ind(d) + '<!--<![endif]-->\n' +
      ind(d) + '<!--[if mso]>\n' +
      ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%">\n' +
      ind(d+1) + '<tr>\n' +
      ind(d+2) + '<td' + tdBgAttr + (tdStyle ? ' style="' + tdStyle + '"' : '') + '>\n' +
      innerHtml + '\n' +
      ind(d+2) + '</td>\n' +
      ind(d+1) + '</tr>\n' +
      ind(d) + '</table>\n' +
      ind(d) + '<![endif]-->';
  }

  // Full VML path for Outlook (non-nested, has bg colour).
  // Modern clients: <table border-radius+bg+overflow:hidden> <td padding+bg> content
  // Outlook: VML roundrect <td padding> wraps content; outer <td> has no padding.
  //
  // To avoid double-padding in Outlook:
  //   outer <td> uses mso-padding-alt:0 so Outlook ignores its CSS padding.
  //   VML wrapper <td> carries the padding for Outlook only.
  //   Modern clients see the outer <td> padding (mso-padding-alt is ignored)
  //   and never see the VML wrapper (hidden by conditional comments).
  var arcPct = Math.min(50, Math.round(rad.maxVal * 2));

  var vmlOpen  = '<!--[if mso]>' +
    '<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%"><tr><td' +
    (padVal ? ' style="padding:' + padVal + ';"' : '') + '>' +
    '<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"' +
    ' style="width:100%;background-color:' + bgColor + ';"' +
    ' arcsize="' + arcPct + '%" stroke="f" fillcolor="' + bgColor + '">' +
    '<v:fill type="solid" color="' + bgColor + '"/>' +
    '<v:textbox inset="0,0,0,0"><![endif]-->';
  var vmlClose = '<!--[if mso]></v:textbox></v:roundrect></td></tr></table><![endif]-->';

  // Outer <td> style: padding + bg for modern clients, mso-padding-alt:0 to
  // suppress padding in Outlook (VML wrapper handles Outlook padding instead).
  var outerTdStyle = (!isTransparent ? 'background-color:' + bgColor + ';' : '') +
    (padVal ? 'padding:' + padVal + ';mso-padding-alt:0;' : '');

  // Modern clients: <table> carries border-radius + bg + overflow:hidden.
  // <td> carries padding + bg (mso-padding-alt:0 prevents Outlook double-pad).
  return ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%"\n' +
    ind(d) + '       style="' + tblRadStyle + '">\n' +
    ind(d+1) + '<tr>\n' +
    ind(d+2) + '<td' + tdBgAttr + (outerTdStyle ? ' style="' + outerTdStyle + '"' : '') + '>\n' +
    ind(d+3) + vmlOpen + '\n' +
    innerHtml + '\n' +
    ind(d+3) + vmlClose + '\n' +
    ind(d+2) + '</td>\n' +
    ind(d+1) + '</tr>\n' +
    ind(d) + '</table>';
}

// ── Border wrapper ───────────────────────────────────────────
// rad is the object returned by getCornerRadii() (or null/0 for no radius).
function borderWrapper(stroke, innerHtml, d, w, rad) {
  if (!stroke) return innerHtml;
  // Normalise: accept both the radii object and legacy plain number (0)
  var hasRad   = rad && typeof rad === 'object' ? rad.any : !!rad;
  var radStyle = '';
  var innerRadStyle = '';
  if (hasRad && typeof rad === 'object') {
    radStyle      = rad.css;                        // e.g. "border-radius:8px 0px 8px 0px;"
    innerRadStyle = rad.css + 'overflow:hidden;';
  } else if (hasRad) {
    radStyle      = 'border-radius:' + rad + 'px;';
    innerRadStyle = 'border-radius:' + rad + 'px;overflow:hidden;';
  }

  var wAttr  = (w && w > 0) ? ' width="' + w + '" align="center"' : ' width="100%"';
  var wStyle = (w && w > 0) ? 'width:' + w + 'px;max-width:' + w + 'px;margin:0 auto;' : 'width:100%;';

  if (stroke.perSide) {
    return ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' + wAttr + '\n' +
      ind(d) + '       style="' + wStyle + radStyle + '">\n' +
      ind(d+1) + '<tr>\n' +
      ind(d+2) + '<td style="padding:0;' + radStyle + stroke.css + '">\n' +
      innerHtml + '\n' +
      ind(d+2) + '</td>\n' +
      ind(d+1) + '</tr>\n' +
      ind(d) + '</table>';
  }

  return ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' + wAttr + '\n' +
    ind(d) + '       style="' + wStyle + 'border-collapse:separate;' + radStyle + stroke.css + '">\n' +
    ind(d+1) + '<tr>\n' +
    ind(d+2) + '<td style="padding:0;' + innerRadStyle + '">\n' +
    innerHtml + '\n' +
    ind(d+2) + '</td>\n' +
    ind(d+1) + '</tr>\n' +
    ind(d) + '</table>';
}

// ── Gap spacer row ───────────────────────────────────────────
function spacer(px, d) {
  if (!px || px <= 0) return '';
  return ind(d) + '<tr><td height="' + px + '" style="height:' + px + 'px;font-size:0;line-height:0;">&nbsp;</td></tr>\n';
}

// ── SPACE BETWEEN renderer (Figma AUTO gap) ──────────────────
// All children are rendered as independent cells in a single table row.
// First child gets align="left", last gets align="right", middle ones
// get align="center". The parent frame's own bg/pad/stroke/rad are
// applied as an outer wrapper around the space-between table.
function renderSpaceBetween(node, d, insideRounded) {
  var kids = [];
  for (var i = 0; i < node.children.length; i++) {
    if (node.children[i].visible !== false) kids.push(node.children[i]);
  }
  if (!kids.length) return '';

  var vAlign = containerVAlign(node);
  var bg     = getSolidFill(node);
  var pad    = getPad(node);
  var rad    = getCornerRadii(node);
  var stroke = getStroke(node);
  var nodeW  = Math.round(node.width);
  var isFill = (node.layoutGrow === 1) || (node.layoutSizingHorizontal === 'FILL');

  var bgS  = bg ? 'background-color:' + bg + ';' : '';
  var padS = padCSS(pad);

  // Build cells — each child is its own <td>.
  //
  // Alignment: read from the child frame's counterAxisAlignItems so that
  // a symmetric 3-column layout with all columns center-aligned renders as
  // center/center/center instead of the hard-coded left/center/right.
  // For non-frame children (TEXT, IMG) we fall back to positional alignment.
  //
  // Width distribution:
  // • 2-item layouts: first TD has no explicit width and stretches to fill
  //   the gap (the standard space-between email hack). Second TD is anchored
  //   with a pixel width. This keeps the logo-left / social-right footer pattern.
  // • 3+ item layouts: every TD gets its Figma pixel width. With equal-width
  //   columns the cells naturally distribute evenly; the "first-TD stretches"
  //   hack would make the first column consume all remaining space instead.
  var cells = '';
  for (var ci = 0; ci < kids.length; ci++) {
    var kid = kids[ci];
    var kidType = kid.type;
    var isFrameKid = (kidType === 'FRAME' || kidType === 'COMPONENT' || kidType === 'INSTANCE');
    var cellAlign;
    if (isFrameKid && kid.counterAxisAlignItems) {
      // counterAxisAlignItems on a vertical-layout column = horizontal align of its children.
      cellAlign = hAlign(kid.counterAxisAlignItems);
    } else {
      // Non-frame child (image, text directly in space-between): use positional fallback.
      cellAlign = (ci === 0) ? 'left' : (ci === kids.length - 1) ? 'right' : 'center';
    }
    // Pass cellAlign as parentCellAlign so the child frame's outer wrapper
    // respects the cell alignment rather than its own counterAxisAlignItems.
    var kidHtml = renderNode(kid, d+3, insideRounded || rad.any, cellAlign);
    var kidW;
    var kidIsFill = (kid.layoutGrow === 1) || (kid.layoutSizingHorizontal === 'FILL');
    if (kids.length > 2) {
      // 3+ children: give every TD an explicit width (no first-TD stretch).
      kidW = Math.round(kid.width);
    } else {
      // 2 children: anchor the FIRST child (e.g. logo/icon) at its designed
      // pixel width; let the LAST child (e.g. nav/text/links) fill the
      // remaining space with no explicit TD width.
      //
      // Why NOT the old "first=no-width, second=anchored" pattern:
      // The old pattern put the DESKTOP pixel width on the last column. On
      // mobile, table-layout:fixed honours that desktop width (e.g. 384 px)
      // even when the viewport is only 375 px — the last column demands more
      // space than is available, so the first column collapses to 0 px
      // (logo becomes invisible) and the table overflows (text exceeds the
      // viewport edge).
      //
      // With the new pattern:
      // • Desktop (auto table layout, no table-layout:fixed): the browser
      //   allocates the explicit first-child width first, then gives the
      //   remaining width to the no-width last column. The last child is
      //   right-aligned inside its auto-width TD via cellAlign='right' and
      //   margin-left:auto on its inner table — visually identical to the
      //   old approach.
      // • Mobile (table-layout:fixed via @media): the first-child TD keeps
      //   its pixel width (the mobile-frame dimension when _mobileMode=true,
      //   or the desktop dimension for universal banners). The last TD
      //   absorbs whatever space remains — exactly like Figma FILL sizing.
      kidW = (ci === 0) ? Math.round(kid.width) : 0;
    }
    var tdWAttr = kidW ? ' width="' + kidW + '"' : '';
    var tdWSty  = kidW ? 'width:' + kidW + 'px;' : '';
    // For 3+ child space-between: mark FILL children so the media query can
    // override their width to auto (absorbs remaining space under table-layout:fixed).
    // For 2-child: the last TD has no width — it naturally fills remaining space.
    var sbFillClass = (kids.length > 2 && kidIsFill && kidW) ? ' class="fill-col"' : '';
    cells += ind(d+2) + '<td' + tdWAttr + sbFillClass + ' align="' + cellAlign + '" valign="' + vAlign + '" style="' + tdWSty + 'text-align:' + cellAlign + ';vertical-align:' + vAlign + ';">\n' +
      kidHtml + '\n' +
      ind(d+2) + '</td>\n';
  }

  var innerTbl = ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="width:100%;">\n' +
    ind(d+1) + '<tr>\n' +
    cells +
    ind(d+1) + '</tr>\n' +
    ind(d) + '</table>';

  // Apply outer wrapper for bg / padding / radius / stroke — same logic as renderNode
  var isHugWidthSB    = (node.layoutSizingHorizontal === 'HUG');
  var isMobileFluidSB = _mobileMode && !isFill && !isHugWidthSB && nodeW >= (_mobileFrameW * 0.5);
  var useFixedW = !isFill && !isMobileFluidSB && nodeW > 0;
  var tblW      = useFixedW ? nodeW : null;
  var outerWAttr = tblW ? ' width="' + tblW + '" align="center"' : ' width="100%"';
  var outerWSty  = tblW ? 'width:' + tblW + 'px;max-width:' + tblW + 'px;margin:0 auto;' : 'width:100%';
  var outerStyle = bgS + padS;

  var block;
  if (rad.any && !stroke) {
    block = roundedWrapper(bgS, padS, rad, innerTbl, d, insideRounded);
  } else if (rad.any && stroke) {
    var radContent = (bgS || padS)
      ? ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' + outerWAttr + ' style="' + outerWSty + '">\n' +
        ind(d+1) + '<tr><td' + (bg ? ' bgcolor="' + bg + '"' : '') + (outerStyle ? ' style="' + outerStyle + '"' : '') + '>\n' +
        innerTbl + '\n' +
        ind(d+1) + '</td></tr>\n' +
        ind(d) + '</table>'
      : innerTbl;
    block = borderWrapper(stroke, radContent, d, useFixedW ? nodeW : 0, rad);
  } else if (outerStyle) {
    block = ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' + outerWAttr + ' style="' + outerWSty + '">\n' +
      ind(d+1) + '<tr><td' + (bg ? ' bgcolor="' + bg + '"' : '') + ' style="' + outerStyle + '">\n' +
      innerTbl + '\n' +
      ind(d+1) + '</td></tr>\n' +
      ind(d) + '</table>';
  } else {
    block = innerTbl;
  }
  if (stroke && !rad.any) block = borderWrapper(stroke, block, d, useFixedW ? nodeW : 0, 0);

  return block;
}

// ══════════════════════════════════════════════════════════════
// Core renderer — returns HTML string for any node
// insideRounded: true when already inside a roundedWrapper
// parentCellAlign: alignment from the containing <td> — used to
//   override the frame's own childAlign for its outer table wrapper
//   so a logo in a left-aligned space-between cell stays left.
// ══════════════════════════════════════════════════════════════

// _innerRenderNode: the actual layout engine. Called only from renderNode.
// cfg is pre-computed by the outer wrapper to avoid double-parsing.
function _innerRenderNode(node, cfg, d, insideRounded, parentCellAlign) {
  if (!node || node.visible === false) return '';
  if (isDecorative(node)) return '';

  if (node.type === 'GROUP') {
    var groupHtml = '';
    var groupKids = node.children || [];
    for (var gi = 0; gi < groupKids.length; gi++) {
      if (groupKids[gi].visible !== false) {
        groupHtml += renderNode(groupKids[gi], d, insideRounded, parentCellAlign);
      }
    }
    return groupHtml;
  }

  if (isImgNode(node))             return renderImg(node, cfg, d, parentCellAlign || 'center');
  if (node.type === 'TEXT')        return renderText(node, cfg, d);
  if (cfg.frameType === 'button')  return renderButton(node, cfg, d, parentCellAlign);
  if (cfg.frameType === 'divider') return renderDivider(node, cfg, d);
  if (isIconContainer(node))       return renderIconContainer(node, cfg, d);

  if (!node.children || node.children.length === 0) return '';

  var kids = [];
  for (var i = 0; i < node.children.length; i++) {
    if (node.children[i].visible !== false) kids.push(node.children[i]);
  }
  if (!kids.length) return '';

  var bg     = getSolidFill(node);
  var pad    = getPad(node);
  var g      = gap(node);
  var rad    = getCornerRadii(node);
  var stroke = getStroke(node);

  var nodeW     = Math.round(node.width);
  // layoutGrow=1         → fills primary axis (width when parent is HORIZONTAL).
  // layoutSizingHorizontal='FILL' → Figma's explicit fill-width flag (works for
  //   both HORIZONTAL and VERTICAL parents). Catches frames that use the newer
  //   Figma API where layoutGrow stays 0 even though the frame is set to Fill.
  var isFill    = (node.layoutGrow === 1) || (node.layoutSizingHorizontal === 'FILL');
  // layoutSizingHorizontal='HUG' → frame intentionally hugs its content width.
  // Hug frames must NOT be stretched fluid in mobile mode; their pixel width IS
  // their intended width (the content-fit size Figma computed for them).
  var isHugWidth = (node.layoutSizingHorizontal === 'HUG');
  // In mobile render mode, any container that is >= 50% of the mobile frame
  // width is treated as fill-width (width:100%) so inner tables adapt to the
  // device screen rather than overflowing at their Figma pixel width.
  // Exception: hug frames keep their pixel width — they should never stretch.
  var isMobileFluid = _mobileMode && !isFill && !isHugWidth && nodeW >= (_mobileFrameW * 0.5);
  var useFixedW = !isFill && !isMobileFluid && nodeW > 0;

  // ── HORIZONTAL layout → multi-column table ───────────────
  if (node.layoutMode === 'HORIZONTAL') {

    if (node.primaryAxisAlignItems === 'SPACE_BETWEEN') {
      return renderSpaceBetween(node, d, insideRounded);
    }

    var vAlign = containerVAlign(node);
    var isSpaceBetween = (node.primaryAxisAlignItems === 'SPACE_BETWEEN');
    var innerW = nodeW > 0 ? Math.max(0, nodeW - pad.l - pad.r) : 0;

    var fixedTotal = 0;
    var fillCount  = 0;
    for (var pi = 0; pi < kids.length; pi++) {
      // Detect fill children via EITHER the legacy layoutGrow API OR the newer
      // layoutSizingHorizontal API. Some Figma versions set layoutGrow=0 even
      // when the child is fill-width, relying on layoutSizingHorizontal='FILL'.
      // Missing these children causes them to be counted in fixedTotal, which
      // corrupts fillShare, contentOnlyW, and the stretchLastW calculation.
      var kidIsFill = (kids[pi].layoutGrow === 1) || (kids[pi].layoutSizingHorizontal === 'FILL');
      if (kidIsFill) {
        fillCount++;
      } else {
        fixedTotal += Math.round(kids[pi].width);
      }
    }

    var autoGapW = 0;
    if (isSpaceBetween && innerW > 0 && kids.length > 1) {
      autoGapW = Math.floor((innerW - fixedTotal) / (kids.length - 1));
    }
    var totalSpacers = isSpaceBetween
      ? autoGapW * (kids.length - 1)
      : g * (kids.length - 1);

    var fillShare = 0;
    if (fillCount > 0 && innerW > 0) {
      fillShare = Math.floor((innerW - fixedTotal - totalSpacers) / fillCount);
    }

    // ALL-FILL PERCENTAGE MODE: when every child is FILL (no fixed-width children),
    // use percentage-based TD widths instead of pixel widths with the fill-col class.
    // Why: Gmail iOS ignores @media queries and applies the u+#body .fill-col rule
    // which sets width:auto!important. When ALL cells are width:auto, auto table
    // layout distributes space based on content length — "A) Tax-loss harvesting"
    // gets much more width than "C) Both", breaking 2×2 quiz grids.
    // Percentage widths (e.g. width="50%") are honoured by ALL email clients
    // including Gmail iOS, producing even column distribution like BeeFree does.
    // This mode is ONLY used when fillCount === kids.length (all children are FILL);
    // mixed fixed+fill layouts still use the pixel-width + fill-col approach.
    var allFillPctMode = (fillCount === kids.length && kids.length > 1);

    // stretchLastW: only useful when the parent has a KNOWN fixed pixel width.
    // Skip when isMobileFluid: rendered width is unknown on narrow phones.
    // Skip when isFill: parent is fill-width (width:100%), so its actual rendered
    //   width is dynamic and not equal to the Figma pixel value. Stretching the
    //   last child to fill the Figma pixel space would give it a wrong fixed width
    //   (e.g. a 114px HUG "Ask a Question" frame becoming 483px because the math
    //   produces: 552 fill parent - 24 gap - 45 other child = 483).
    //   HUG children in fill-width parents are handled by hugNodeOmit instead.
    var stretchLastW = 0;
    if (!isMobileFluid && !isFill && !isSpaceBetween && fillCount === 0 && innerW > 0) {
      var lastKidW = Math.round(kids[kids.length - 1].width);
      var otherFixedTotal = fixedTotal - lastKidW;
      var computed = innerW - totalSpacers - otherFixedTotal;
      if (computed > lastKidW) {
        stretchLastW = computed;
      }
    }

    var cells = '';
    var lastNonSpacerIdx = kids.length - 1;
    for (var ci = 0; ci < kids.length; ci++) {
      var kid          = kids[ci];
      // Match the same fill detection used in the fillCount loop above.
      var kidIsFillCol = (kid.layoutGrow === 1) || (kid.layoutSizingHorizontal === 'FILL');
      var kidRawW      = Math.round(kid.width);
      var kidW;
      if (kidIsFillCol && fillShare > 0) {
        kidW = fillShare;
      } else if (stretchLastW > 0 && ci === lastNonSpacerIdx) {
        kidW = stretchLastW;
      } else {
        kidW = kidRawW;
      }

      var kidHAlign = 'left';
      if (kid.type === 'TEXT' && kid.textAlignHorizontal) {
        kidHAlign = hAlign(kid.textAlignHorizontal);
      } else if (kid.counterAxisAlignItems) {
        kidHAlign = hAlign(kid.counterAxisAlignItems);
      }

      // In mobile-fluid mode the parent table is width:100%.
      // Only FILL children must lose their explicit TD width — they are fluid by
      // design and their pixel width is only a Figma computed value, not a target.
      // Fixed-size children (even large ones, e.g. a 200px logo in a 375px frame)
      // MUST keep their pixel TD width so table-layout:fixed can allocate whatever
      // space remains to the fill column(s).
      //
      // The previous approach also dropped TD widths from "large" non-fill children
      // (>= 50% of mobile frame). That caused equal-split when both the logo TD and
      // a fill-text TD had no explicit width under table-layout:fixed — the logo got
      // half the available space instead of its designed pixel size, and the fill
      // text got half instead of the correct remainder. Removing kidIsLargeMobile
      // from this condition fixes both the image scaling and fill-text layout bugs.
      var parentIsFluidInMob = _mobileMode && (isMobileFluid || isFill);
      var kidIsFluidInMobile = parentIsFluidInMob && kidIsFillCol;

      // kidIsHugTxt: a TEXT node whose width wraps its content (hug).
      // In a fill-width horizontal container, hug TEXT behaves differently from
      // hug FRAMES: the first hug text stretches (no TD width) and the last hug
      // text anchors with its natural pixel width — creating a "label left / date
      // right" spread. Hug FRAMES always keep their explicit pixel widths so they
      // pack together naturally (e.g. "👁 943" and "💬 Ask a Question" side by side).
      var kidIsHugTxt     = (kid.type === 'TEXT' && (kid.textAutoResize === 'WIDTH_AND_HEIGHT' || kid.textAutoResize === 'TRUNCATE'));
      var parentIsFluidHz = isFill || isMobileFluid;
      var isLastKid       = (ci === lastNonSpacerIdx);
      // In a FLUID parent: first hug text stretches (no TD width); last hug
      // text anchors with its pixel width. In a FIXED/HUG parent: all hug
      // text gets its explicit pixel width so table-layout:fixed on mobile
      // cannot compress the column below its designed size (e.g. "943" in
      // a 45px icon+counter frame).
      var hugTxtOmit = kidIsHugTxt && parentIsFluidHz && !isLastKid;
      var omitTdW    = hugTxtOmit || kidIsFluidInMobile;
      // ALL-FILL PERCENTAGE MODE: use percentage width instead of pixel width
      var kidWAttr, kidWStyle;
      if (allFillPctMode) {
        var pct = Math.floor(100 / kids.length);
        // Last child gets the remainder to total 100%
        if (ci === lastNonSpacerIdx) pct = 100 - (Math.floor(100 / kids.length) * (kids.length - 1));
        kidWAttr  = ' width="' + pct + '%"';
        kidWStyle = 'width:' + pct + '%;';
      } else if (omitTdW) {
        kidWAttr  = '';
        kidWStyle = '';
      } else {
        kidWAttr  = ' width="' + kidW + '"';
        kidWStyle = 'width:' + kidW + 'px;';
      }
      var kidNoWrap  = kidIsHugTxt ? 'white-space:nowrap;' : '';
      var tdStyle  = kidWStyle + 'vertical-align:' + vAlign + ';text-align:' + kidHAlign + ';' + kidNoWrap;

      // Mark fill columns so the responsive media query can override their width
      // to `auto`, letting them absorb the remaining space after fixed columns
      // take their share. Without this class, table-layout:fixed scales every
      // column proportionally — squishing fixed columns (e.g. a 184px date column
      // down to 123px) and causing content to overflow its cell.
      // nowrap-lbl is added to hug-text TDs so the mobile media query does NOT
      // strip their white-space:nowrap — short labels like "943" or "5 days ago"
      // must never word-wrap inside their tight columns.
      var tdClasses = [];
      if (kidIsFillCol && !omitTdW && !allFillPctMode) tdClasses.push('fill-col');
      if (kidIsHugTxt) tdClasses.push('nowrap-lbl');
      var fillColClass = tdClasses.length > 0 ? ' class="' + tdClasses.join(' ') + '"' : '';

      // Pass kidHAlign as parentCellAlign so the child's inner table wrapper
      // inherits the correct alignment. Without this, hzOuterAlign defaults to
      // 'center' inside renderNode and the inner table centers itself regardless
      // of the TD alignment — e.g. a 114px "Ask a Question" table centering in
      // a 483px TD instead of aligning to the right edge.
      var kidHtml = renderNode(kid, d+3, insideRounded || rad.any, kidHAlign);

      cells += ind(d+2) + '<td' + kidWAttr + fillColClass + ' valign="' + vAlign + '" align="' + kidHAlign + '" style="' + tdStyle + '">\n' +
               kidHtml + '\n' +
               ind(d+2) + '</td>\n';

      if (ci < kids.length - 1) {
        var gapW = isSpaceBetween ? autoGapW : g;
        if (gapW > 0) {
          cells += ind(d+2) + '<td width="' + gapW + '" style="width:' + gapW + 'px;font-size:0;line-height:0;">&nbsp;</td>\n';
        }
      }
    }

    var bgS          = bg ? 'background-color:' + bg + ';' : '';
    var padS         = padCSS(pad);
    var outerTdStyle = bgS + padS;

    // Respect parentCellAlign so a fixed-width horizontal frame sitting inside
    // a right-aligned space-between cell doesn't accidentally re-centre itself.
    var hzOuterAlign = parentCellAlign || 'center';
    var hzMargin = hzOuterAlign === 'left'  ? 'margin-right:auto;margin-left:0;'
                 : hzOuterAlign === 'right' ? 'margin-left:auto;margin-right:0;'
                 : 'margin:0 auto;';

    // When a fill-width parent has NO fill children (all are HUG or fixed), the
    // inner cells table must NOT be width:100%. An auto-layout table at 100% width
    // stretches its TDs beyond their specified pixel widths, pushing items apart
    // (e.g. a 45px "943" frame and 114px "Ask a Question" frame in a 600px table
    // would appear at opposite ends instead of packed together).
    // Fix: use the actual content width (sum of child widths + gaps) so the cells
    // table is exactly as wide as its content and items pack together naturally.
    // The parent wrapper can still be width:100% — only the inner cells table shrinks.
    //
    // Pack alignment: read primaryAxisAlignItems to know if content should sit at
    // the left/center/right edge of the fill-width parent.
    var contentOnlyW = (fillCount === 0 && fixedTotal + totalSpacers > 0)
      ? (fixedTotal + totalSpacers) : 0;
    var packAlign = 'left';
    if (node.primaryAxisAlignItems === 'CENTER') { packAlign = 'center'; }
    else if (node.primaryAxisAlignItems === 'MAX') { packAlign = 'right'; }
    var packMargin = packAlign === 'left'  ? 'margin-right:auto;margin-left:0;'
                   : packAlign === 'right' ? 'margin-left:auto;margin-right:0;'
                   : 'margin:0 auto;';

    var innerTblW;
    if (useFixedW && innerW > 0) {
      innerTblW = innerW;
    } else if (isFill && !isMobileFluid && contentOnlyW > 0) {
      // Fill parent, all-fixed/hug children: pin the cells table to content width.
      innerTblW = contentOnlyW;
    } else {
      innerTblW = null;
    }

    var innerTblAlign = (isFill && !isMobileFluid && contentOnlyW > 0) ? packAlign : hzOuterAlign;
    var innerTblMargin = (isFill && !isMobileFluid && contentOnlyW > 0) ? packMargin : hzMargin;

    var tblWAttr   = innerTblW ? ' width="' + innerTblW + '" align="' + innerTblAlign + '"' : ' width="100%"';
    var tblWSty    = innerTblW ? 'width:' + innerTblW + 'px;max-width:' + innerTblW + 'px;' + innerTblMargin : 'width:100%;';

    // hz-cells class: marks inner cells tables that use the contentOnlyW pixel
    // width (fill-width parent, all-fixed/hug children — e.g. a banner where
    // the fill text child was not detected as FILL, or an icon+label row).
    // In Gmail iOS, these tables can appear narrower than the email-container
    // because Gmail renders emails at their declared width (600px) first, then
    // scales down — a 566px cells table inside a 600px container gets 17px
    // symmetric margins that are then baked into the scaled-down render.
    // The u+#body CSS rule below overrides their width to 100% for Gmail iOS
    // only, eliminating the side margins. In all other clients the explicit TD
    // widths still govern column sizing, so the pack-together behaviour is
    // preserved by the browser's auto table-layout algorithm.
    var isPackedContentTbl = (isFill && !isMobileFluid && contentOnlyW > 0);
    var tblClassAttr = isPackedContentTbl ? ' class="hz-cells"' : '';

    var tblW       = useFixedW ? nodeW : null;
    var outerWAttr = tblW ? ' width="' + tblW + '" align="' + hzOuterAlign + '"' : ' width="100%"';
    var outerWSty  = tblW ? 'width:' + tblW + 'px;max-width:' + tblW + 'px;' + hzMargin : 'width:100%';

    var innerTbl = ind(d) + '<!--[if mso]><table role="presentation" width="' + (innerTblW ? innerTblW : '100%') + '" cellpadding="0" cellspacing="0" border="0"><tr><![endif]-->\n' +
      ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' + tblWAttr + tblClassAttr + ' style="' + tblWSty + '">\n' +
      ind(d+1) + '<tr>\n' +
      cells +
      ind(d+1) + '</tr>\n' +
      ind(d) + '</table>\n' +
      ind(d) + '<!--[if mso]></tr></table><![endif]-->';

    // HREF: wrap the inner content in <a>, NOT the outer table.
    // Gmail iOS doesn't reliably honour display:block on <a> tags wrapping tables,
    // causing the <a> to shrink-wrap to content width instead of filling 100%.
    // By placing the <a> inside the <td>, it inherits the td's width naturally.
    if (cfg.href) {
      innerTbl = ind(d) + '<a href="' + escapeHtml(cfg.href) + '" target="_blank" style="display:block;text-decoration:none;">\n' +
        innerTbl + '\n' + ind(d) + '</a>';
    }

    var tbl;
    if (rad.any && !stroke) {
      tbl = roundedWrapper(bgS, padS, rad, innerTbl, d, insideRounded);
    } else if (rad.any && stroke) {
      var radPadContent = (bgS || padS)
        ? ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' + outerWAttr + ' style="' + outerWSty + '">\n' +
          ind(d+1) + '<tr><td' + (bg ? ' bgcolor="' + bg + '"' : '') + (bgS || padS ? ' style="' + bgS + padS + '"' : '') + '>\n' +
          innerTbl + '\n' +
          ind(d+1) + '</td></tr>\n' +
          ind(d) + '</table>'
        : innerTbl;
      tbl = borderWrapper(stroke, radPadContent, d, useFixedW ? nodeW : 0, rad);
    } else if (outerTdStyle) {
      tbl = ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' + outerWAttr + ' style="' + outerWSty + '">\n' +
        ind(d+1) + '<tr><td' + (bg ? ' bgcolor="' + bg + '"' : '') + ' style="' + outerTdStyle + '">\n' +
        innerTbl + '\n' +
        ind(d+1) + '</td></tr>\n' +
        ind(d) + '</table>';
    } else {
      tbl = innerTbl;
    }
    if (stroke && !rad.any) tbl = borderWrapper(stroke, tbl, d, useFixedW ? nodeW : 0, 0);
    return tbl;
  }

  // ── VERTICAL layout (or no layout) → stacked rows ────────
  // Use the frame's own counterAxisAlignItems to align its children.
  // Do NOT inherit parentCellAlign here: that is the outer context's alignment
  // (e.g. the outer section is center-aligned) and must not override the inner
  // frame's own design intent (e.g. poll section has children left-aligned).
  // Per-child layoutAlign overrides are applied below in the loop.
  var childAlign = containerHAlign(node);
  var bgStr      = bg ? 'background-color:' + bg + ';' : '';
  var padStr     = padCSS(pad);

  var rows = '';
  for (var ri = 0; ri < kids.length; ri++) {
    var rowKid   = kids[ri];
    var rowCfg   = parseNodeConfig(rowKid);
    var rowAlign = childAlign;

    // Per-child layoutAlign override: in Figma a child can have its own alignment
    // that differs from the parent's counterAxisAlignItems. Read it here so that
    // e.g. a left-aligned button in a center-aligned column renders correctly.
    // 'INHERIT' means use parent's alignment (no override). 'STRETCH' means
    // fill-width (handled via isFill in the renderers, not as an alignment value).
    if (rowKid.layoutAlign && rowKid.layoutAlign !== 'INHERIT' && rowKid.layoutAlign !== 'STRETCH') {
      rowAlign = hAlign(rowKid.layoutAlign);
    }
    // Text nodes always use their own horizontal text alignment.
    if (rowKid.type === 'TEXT' && rowKid.textAlignHorizontal) {
      rowAlign = hAlign(rowKid.textAlignHorizontal);
    }

    // Pass rowAlign as parentCellAlign so child frames and images inherit it.
    var rowHtml = renderNode(rowKid, d+3, insideRounded || rad.any, rowAlign);
    if (!rowHtml) continue;

    rows += ind(d+1) + '<tr>\n' +
      ind(d+2) + '<td align="' + rowAlign + '" style="text-align:' + rowAlign + ';">\n' +
      rowHtml + '\n' +
      ind(d+2) + '</td>\n' +
      ind(d+1) + '</tr>\n';

    if (g > 0 && ri < kids.length - 1) {
      rows += ind(d+1) + '<tr><td height="' + g + '" style="height:' + g + 'px;font-size:0;line-height:0;">&nbsp;</td></tr>\n';
    }
  }

  var tblW2     = useFixedW ? nodeW : null;
  // When parentCellAlign is set (e.g. left in a space-between cell), use it
  // for the outer table's align attribute and margin so content doesn't re-center.
  var outerAlign2 = parentCellAlign || 'center';
  var tblWAttr2 = tblW2 ? ' width="' + tblW2 + '" align="' + outerAlign2 + '"' : ' width="100%"';
  var tblWSty2  = tblW2
    ? 'width:' + tblW2 + 'px;max-width:' + tblW2 + 'px;' + (outerAlign2 === 'left' ? 'margin-right:auto;' : outerAlign2 === 'right' ? 'margin-left:auto;' : 'margin:0 auto;')
    : 'width:100%;';

  var innerTable = ind(d+3) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%">\n' +
    rows +
    ind(d+3) + '</table>';

  // HREF: wrap the inner content in <a>, NOT the outer table.
  // Gmail iOS doesn't reliably honour display:block on <a> tags wrapping tables,
  // causing the <a> to shrink-wrap to content width instead of filling 100%.
  // By placing the <a> inside the <td>, it inherits the td's width naturally.
  if (cfg.href) {
    innerTable = ind(d+3) + '<a href="' + escapeHtml(cfg.href) + '" target="_blank" style="display:block;text-decoration:none;">\n' +
      innerTable + '\n' + ind(d+3) + '</a>';
  }

  var block;
  if (rad.any && !stroke) {
    var wrappedRadius = roundedWrapper(bgStr, padStr, rad, innerTable, d+2, insideRounded);
    block = ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' + tblWAttr2 + ' style="' + tblWSty2 + '">\n' +
      ind(d+1) + '<tr>\n' +
      ind(d+2) + '<td align="' + childAlign + '">\n' +
      wrappedRadius + '\n' +
      ind(d+2) + '</td>\n' +
      ind(d+1) + '</tr>\n' +
      ind(d) + '</table>';
  } else if (rad.any && stroke) {
    var radPadContent2 = (bgStr || padStr)
      ? ind(d+2) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%">\n' +
        ind(d+3) + '<tr><td align="' + childAlign + '"' + (bg ? ' bgcolor="' + bg + '"' : '') + (bgStr || padStr ? ' style="' + bgStr + padStr + '"' : '') + '>\n' +
        innerTable + '\n' +
        ind(d+3) + '</td></tr>\n' +
        ind(d+2) + '</table>'
      : innerTable;
    block = borderWrapper(stroke, radPadContent2, d, useFixedW ? nodeW : 0, rad);
  } else {
    var outerTdStyle2 = bgStr + padStr;
    block = ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' + tblWAttr2 + ' style="' + tblWSty2 + '">\n' +
      ind(d+1) + '<tr>\n' +
      ind(d+2) + '<td align="' + childAlign + '"' +
      (bg ? ' bgcolor="' + bg + '"' : '') +
      (outerTdStyle2 ? ' style="' + outerTdStyle2 + '"' : '') + '>\n' +
      innerTable + '\n' +
      ind(d+2) + '</td>\n' +
      ind(d+1) + '</tr>\n' +
      ind(d) + '</table>';
  }
  if (stroke && !rad.any) block = borderWrapper(stroke, block, d, useFixedW ? nodeW : 0, 0);

  return block;
}

// ══════════════════════════════════════════════════════════════
// renderNode — public API. Parses cfg, applies rawCode / comment /
// visibility meta-properties, then delegates layout to _innerRenderNode.
// ══════════════════════════════════════════════════════════════
function renderNode(node, d, insideRounded, parentCellAlign) {
  if (!node || node.visible === false) return '';
  if (isDecorative(node)) return '';
  var cfg = parseNodeConfig(node);

  // rawCode: replace entire HTML output with verbatim code string
  if (cfg.rawCode) {
    var rawHtml = cfg.rawCode;
    if (cfg.comment) rawHtml = ind(d) + '<!-- ' + cfg.comment + ' -->\n' + rawHtml;
    return rawHtml;
  }

  // visibility=mobile in single-frame mode: _mobileMode is normally false here
  // (only breakpoint mode sets it). Enable it temporarily so images and text
  // inside the mobile-only section get the same fluid sizing logic they would
  // get in breakpoint mode — otherwise images render with fixed desktop px widths
  // and can overflow or scale incorrectly on narrow phone viewports.
  var _savedMobileMode  = _mobileMode;
  var _savedMobileFrameW = _mobileFrameW;
  if (cfg.visibility === 'mobile' && !_mobileMode) {
    _mobileMode   = true;
    // Use the node's own width as the reference frame for the 50% fluid threshold.
    // For sections that span the full email width this equals the email width, which
    // matches the breakpoint-mode behaviour where _mobileFrameW = mobileNode.width.
    _mobileFrameW = Math.round(node.width) || 375;
  }
  var html = _innerRenderNode(node, cfg, d, insideRounded, parentCellAlign);
  _mobileMode   = _savedMobileMode;
  _mobileFrameW = _savedMobileFrameW;
  if (!html) return '';

  // comment: inject HTML comment immediately before the block
  if (cfg.comment) {
    html = ind(d) + '<!-- ' + cfg.comment + ' -->\n' + html;
  }

  // visibility: wrap in .for-mobile or .for-desktop div.
  // .for-mobile: conditional comment hides from Outlook entirely (it never
  //   parses the content); inline style hides in Gmail webmail which strips
  //   <style> blocks; CSS class handles all @media-capable clients.
  // .for-desktop: no conditional comment needed — Outlook sees it and renders
  //   it, which is correct (desktop-only content should show in Outlook).
  if (cfg.visibility === 'mobile') {
    html = ind(d) + '<!--[if !mso]><!-->\n' +
      ind(d) + '<div class="for-mobile" style="display:none;max-height:0;overflow:hidden;mso-hide:all;">\n' +
      html + '\n' +
      ind(d) + '</div>\n' +
      ind(d) + '<!--<![endif]-->';
  } else if (cfg.visibility === 'desktop') {
    // No conditional comment: Outlook should render desktop-only content (correct).
    // The mso-hide:all trick is intentionally absent here.
    // display:block is stated explicitly (not just left as the browser default)
    // because Gmail web strips <style> blocks — without an inline display value,
    // Gmail web cannot override it and desktop content always shows regardless
    // of viewport width. Explicit display:block lets the @media rule (and any
    // inline override injected by the preview) win via !important.
    html = ind(d) + '<div class="for-desktop" style="display:block;max-height:none;overflow:visible;">\n' +
      html + '\n' + ind(d) + '</div>';
  }

  return html;
}

// ══════════════════════════════════════════════════════════════
// generateEmailHtml — builds complete HTML document
// ══════════════════════════════════════════════════════════════
function generateEmailHtml(tmpl, config) {
  var preheader   = config.preheader   || '';
  var headCode    = config.headCode    || '';
  var emailTitle  = config.emailTitle  || tmpl.name;
  var emailWidth  = safeNum(config.emailWidth, Math.round(tmpl.width) || 600);
  var utmSource   = config.utmSource   || '';
  var utmMedium   = config.utmMedium   || '';
  var utmCampaign = config.utmCampaign || '';
  var utmContent  = config.utmContent  || '';
  var utmTerm     = config.utmTerm     || '';
  var bodyBg     = '#f4f4f4';
  var tmplBg     = getSolidFill(tmpl) || '#ffffff';
  var tmplStroke = getStroke(tmpl);

  var rows     = '';
  var sections = tmpl.children || [];
  for (var si = 0; si < sections.length; si++) {
    var sec = sections[si];
    if (!sec || sec.visible === false) continue;

    rows +=
      ind(3) + '<tr>\n' +
      ind(4) + '<td align="center">\n' +
      renderNode(sec, 5) + '\n' +
      ind(4) + '</td>\n' +
      ind(3) + '</tr>\n';
  }

  var preheaderHtml = preheader
    ? ind(1) + '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">' +
      escapeHtml(preheader) + '&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>\n'
    : '';

  var utmMetaTags =
    (utmSource   ? '<meta name="utm-source"   content="' + escapeHtml(utmSource)   + '">\n' : '') +
    (utmMedium   ? '<meta name="utm-medium"   content="' + escapeHtml(utmMedium)   + '">\n' : '') +
    (utmCampaign ? '<meta name="utm-campaign" content="' + escapeHtml(utmCampaign) + '">\n' : '') +
    (utmContent  ? '<meta name="utm-content"  content="' + escapeHtml(utmContent)  + '">\n' : '') +
    (utmTerm     ? '<meta name="utm-term"     content="' + escapeHtml(utmTerm)     + '">\n' : '');

  return '<!DOCTYPE html>\n' +
'<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">\n' +
'<head>\n' +
'<meta charset="UTF-8">\n' +
'<meta http-equiv="X-UA-Compatible" content="IE=edge">\n' +
'<meta name="viewport" content="width=device-width,initial-scale=1.0">\n' +
'<meta name="x-apple-disable-message-reformatting">\n' +
'<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">\n' +
utmMetaTags +
'<title>' + escapeHtml(emailTitle) + '</title>\n' +
'<!--[if mso]><noscript><xml><o:OfficeDocumentSettings>' +
'<o:AllowPNG/>' +
'<o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->\n' +
'<style type="text/css">\n' +
'  * { box-sizing: border-box; }\n' +
'  body, table, td, p, a, h1, h2, h3 {\n' +
'    -webkit-text-size-adjust: 100%;\n' +
'    -ms-text-size-adjust: 100%;\n' +
'  }\n' +
'  table, td {\n' +
'    mso-table-lspace: 0pt;\n' +
'    mso-table-rspace: 0pt;\n' +
'    border-collapse: collapse;\n' +
'  }\n' +
'  img {\n' +
'    -ms-interpolation-mode: bicubic;\n' +
'    border: 0;\n' +
'    display: block;\n' +
'    height: auto;\n' +
'    max-width: 100%;\n' +
'    outline: none;\n' +
'    text-decoration: none;\n' +
'  }\n' +
'  /* Gmail (web) replaces emoji unicode with <img class="il"> elements.\n' +
'     Our display:block above would push each emoji to its own line.\n' +
'     img.il targets only Gmail\'s emoji images and keeps them inline.\n' +
'     The second rule covers any <img> Gmail injects inside <p> tags\n' +
'     regardless of whether class="il" is present. */\n' +
'  img.il { display: inline !important; vertical-align: middle !important; }\n' +
'  u + #body .email-container p img {\n' +
'    display: inline !important;\n' +
'    vertical-align: middle !important;\n' +
'  }\n' +
'  body {\n' +
'    margin: 0 !important;\n' +
'    padding: 0 !important;\n' +
'    background-color: ' + bodyBg + ';\n' +
'    width: 100% !important;\n' +
'  }\n' +
'  h1, h2, h3, p { margin: 0; padding: 0; }\n' +
'  a { color: inherit; }\n' +
'  a[x-apple-data-detectors] {\n' +
'    color: inherit !important;\n' +
'    text-decoration: none !important;\n' +
'  }\n' +
'  u + #body a {\n' +
'    color: inherit;\n' +
'    text-decoration: none;\n' +
'  }\n' +
'  /* Gmail iOS app ignores @media queries — it renders the email at its declared\n' +
'     width (' + emailWidth + 'px) and scales it down, producing equal margins on both sides.\n' +
'     u+#body targets Gmail specifically and forces the container to fill the full\n' +
'     available width so the banner stretches edge-to-edge on iPhone Gmail. */\n' +
'  u + #body .email-container {\n' +
'    width: 100% !important;\n' +
'    max-width: ' + emailWidth + 'px !important;\n' +
'  }\n' +
'  /* Gmail iOS renders at the email\'s declared width then scales down.\n' +
'     Horizontal-layout cells tables pinned to a sub-' + emailWidth + 'px pixel width\n' +
'     (the "pack-content" pattern: fill parent, all-fixed/hug children) appear\n' +
'     narrower than their container in Gmail iOS\'s internal viewport, creating\n' +
'     visible side margins on sections with a distinct background colour (e.g.\n' +
'     a coloured banner). Forcing them to width:100% in Gmail iOS eliminates the\n' +
'     margins; the TDs\' explicit pixel widths still control column sizing via\n' +
'     the browser\'s auto table-layout, so items still pack together. */\n' +
'  u + #body .email-container .hz-cells {\n' +
'    width: 100% !important;\n' +
'    max-width: 100% !important;\n' +
'  }\n' +
'  /* Gmail iOS does not apply @media queries, so the .fill-col width:auto\n' +
'     override that normally fires on narrow viewports never runs. Without it,\n' +
'     Gmail iOS uses auto table-layout with every TD at its declared pixel\n' +
'     width (the desktop fillShare value). When the sum of TD widths exceeds\n' +
'     the Gmail-internal viewport, all columns proportionally shrink — the\n' +
'     fixed-size logo shrinks alongside the fill text instead of anchoring at\n' +
'     its designed size. Replicate the fill-col override here via u+#body so\n' +
'     Gmail iOS gives fixed columns their pixel width and fill columns absorb\n' +
'     whatever remains — exactly the Figma FILL semantic. */\n' +
'  u + #body .email-container .fill-col {\n' +
'    width: auto !important;\n' +
'    min-width: 0 !important;\n' +
'  }\n' +
'  /* Visibility field: .for-mobile hidden at desktop size by default.\n' +
'     Deliberately NO !important here — the @media show-rule below uses\n' +
'     !important, which always beats a non-!important rule regardless of\n' +
'     source order (BeeFree pattern: cascade-order-independent). */\n' +
'  .for-mobile { display: none; max-height: 0; overflow: hidden; mso-hide: all; }\n' +
'  @media only screen and (max-width: ' + (emailWidth - 1) + 'px) {\n' +
'    .email-container {\n' +
'      width: 100% !important;\n' +
'      max-width: 100% !important;\n' +
'    }\n' +
'    /* table-layout:fixed stops browsers from expanding a table beyond\n' +
'       max-width:100% to accommodate fixed-width TD cells. With this,\n' +
'       every table is hard-capped at the device viewport width. */\n' +
'    .email-container table {\n' +
'      max-width: 100% !important;\n' +
'      table-layout: fixed !important;\n' +
'    }\n' +
'    /* FILL columns: give them width:auto so table-layout:fixed allocates\n' +
'       whatever space remains after fixed-width columns take their share.\n' +
'       This mirrors Figma\'s FILL property: fixed elements keep their\n' +
'       designed px width; fill elements absorb the leftover space.\n' +
'       Without this, table-layout:fixed scales every column proportionally,\n' +
'       squishing fixed columns (e.g. a 184px date column → 123px on a\n' +
'       390px phone) and causing text to overflow its cell. */\n' +
'    .email-container .fill-col {\n' +
'      width: auto !important;\n' +
'      min-width: 0 !important;\n' +
'    }\n' +
'    /* Strip white-space:nowrap on mobile so long text reflows naturally.\n' +
'       .nowrap-lbl is excluded: short labels (dates, counters, icon+text\n' +
'       combos) must never word-wrap inside their tight columns. */\n' +
'    .email-container td:not(.nowrap-lbl),\n' +
'    .email-container p:not(.nowrap-lbl) {\n' +
'      white-space: normal !important;\n' +
'    }\n' +
'    .stack-column {\n' +
'      display: block !important;\n' +
'      width: 100% !important;\n' +
'      max-width: 100% !important;\n' +
'    }\n' +
'    .full-width-mobile { width: 100% !important; }\n' +
'    .full-width-mobile td { width: 100% !important; }\n' +
'    .full-width-mobile a { display: block !important; width: 100% !important; box-sizing: border-box !important; }\n' +
'    .hide-mobile { display: none !important; max-height: 0 !important; overflow: hidden !important; }\n' +
'  }\n' +
'  /* Visibility breakpoint: one pixel narrower than the email width so this\n' +
'     block NEVER fires when the email is rendered at its designed desktop\n' +
'     width (emailWidth px). It only fires on genuinely narrow viewports.\n' +
'     Keeping it separate from the container @media above prevents the\n' +
'     "fires at exactly emailWidth" problem that hides desktop content in\n' +
'     the plugin preview and in email clients that constrain the reading\n' +
'     pane to the email\'s declared width. */\n' +
'  @media only screen and (max-width: ' + (emailWidth - 1) + 'px) {\n' +
'    .for-mobile {\n' +
'      display: block !important;\n' +
'      max-height: none !important;\n' +
'      overflow: visible !important;\n' +
'    }\n' +
'    .for-desktop {\n' +
'      display: none !important;\n' +
'      max-height: 0 !important;\n' +
'      overflow: hidden !important;\n' +
'      font-size: 0 !important;\n' +
'    }\n' +
'  }\n' +
'</style>\n' +
(headCode ? headCode + '\n' : '') +
'</head>\n' +
'<body id="body" bgcolor="' + bodyBg + '" style="margin:0;padding:0;background-color:' + bodyBg + ';">\n' +
preheaderHtml +
'<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"\n' +
'       bgcolor="' + bodyBg + '" style="background-color:' + bodyBg + ';">\n' +
ind(1) + '<tr>\n' +
ind(2) + '<td align="center" valign="top" style="padding:0;">\n' +
'<!--[if mso]><table role="presentation" align="center" width="' + emailWidth + '" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->\n' +
'<table role="presentation" cellspacing="0" cellpadding="0"\n' +
'       class="email-container"\n' +
'       width="' + emailWidth + '"\n' +
'       bgcolor="' + tmplBg + '"\n' +
'       style="width:' + emailWidth + 'px;max-width:' + emailWidth + 'px;' +
'background-color:' + tmplBg + ';' +
(tmplStroke ? 'border-collapse:separate;' + tmplStroke.css : 'border-collapse:collapse;') +
'">\n' +
rows +
'</table>\n' +
'<!--[if mso]></td></tr></table><![endif]-->\n' +
ind(2) + '</td>\n' +
ind(1) + '</tr>\n' +
'</table>\n' +
'</body>\n' +
'</html>';
}

// ══════════════════════════════════════════════════════════════
// generateBreakpointEmailHtml — two frames → one HTML document
// Desktop content visible by default; mobile content hidden by
// default and revealed via @media query on small screens.
// Outlook (no media-query support) always sees the desktop version.
// ══════════════════════════════════════════════════════════════
function generateBreakpointEmailHtml(desktopNode, mobileNode, config) {
  var preheader    = config.preheader   || '';
  var headCode     = config.headCode    || '';
  var emailTitle   = config.emailTitle  || desktopNode.name;
  var utmSource    = config.utmSource   || '';
  var utmMedium    = config.utmMedium   || '';
  var utmCampaign  = config.utmCampaign || '';
  var utmContent   = config.utmContent  || '';
  var utmTerm      = config.utmTerm     || '';
  var desktopWidth = Math.round(desktopNode.width) || 600;
  var mobileWidth  = Math.round(mobileNode.width)  || 375;
  var bodyBg       = '#f4f4f4';
  var desktopBg    = getSolidFill(desktopNode) || '#ffffff';
  var mobileBg     = getSolidFill(mobileNode)  || '#ffffff';
  var desktopStroke = getStroke(desktopNode);
  var mobileStroke  = getStroke(mobileNode);
  var desktopRad    = getCornerRadii(desktopNode);
  var mobileRad     = getCornerRadii(mobileNode);

  // ── Build desktop rows ──────────────────────────────────────
  var desktopRows = '';
  var desktopSecs = desktopNode.children || [];
  for (var di = 0; di < desktopSecs.length; di++) {
    var dsec = desktopSecs[di];
    if (!dsec || dsec.visible === false) continue;
    desktopRows +=
      ind(3) + '<tr>\n' +
      ind(4) + '<td align="center">\n' +
      renderNode(dsec, 5) + '\n' +
      ind(4) + '</td>\n' +
      ind(3) + '</tr>\n';
  }

  // ── Build mobile rows ───────────────────────────────────────
  // Enable mobile fluid mode: tables >= 50% of mobile frame width
  // render as width:100% instead of fixed px, so all container tables
  // adapt to the device screen width (critical for Gmail on narrow phones).
  var mobileRows = '';
  var mobileSecs = mobileNode.children || [];
  _mobileMode   = true;
  _mobileFrameW = mobileWidth;
  for (var mi = 0; mi < mobileSecs.length; mi++) {
    var msec = mobileSecs[mi];
    if (!msec || msec.visible === false) continue;
    mobileRows +=
      ind(3) + '<tr>\n' +
      ind(4) + '<td align="center">\n' +
      renderNode(msec, 5) + '\n' +
      ind(4) + '</td>\n' +
      ind(3) + '</tr>\n';
  }
  _mobileMode = false;

  var preheaderHtml = preheader
    ? ind(1) + '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">' +
      escapeHtml(preheader) + '&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>\n'
    : '';

  // ── Assemble desktop email table ────────────────────────────
  // When the desktop frame itself carries corner radii, add border-radius to
  // the outer table and wrap all rows in a single <td overflow:hidden> so
  // content is clipped correctly at the rounded corners.
  var desktopRadCSS = desktopRad.any ? desktopRad.css : '';
  var desktopCollapse = (desktopStroke || desktopRad.any)
    ? 'border-collapse:separate;border-spacing:0;' + desktopRadCSS + (desktopStroke ? desktopStroke.css : '')
    : 'border-collapse:collapse;';
  var desktopInnerRows = desktopRad.any
    ? (ind(1) + '<tr>\n' +
       ind(2) + '<td style="padding:0;' + desktopRadCSS + 'overflow:hidden;">\n' +
       ind(2) + '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">\n' +
       desktopRows +
       ind(2) + '</table>\n' +
       ind(2) + '</td>\n' +
       ind(1) + '</tr>\n')
    : desktopRows;
  var desktopTable =
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0"\n' +
    '       class="email-container"\n' +
    '       width="' + desktopWidth + '"\n' +
    '       bgcolor="' + desktopBg + '"\n' +
    '       style="width:' + desktopWidth + 'px;max-width:' + desktopWidth + 'px;' +
    'background-color:' + desktopBg + ';' + desktopCollapse +
    '">\n' +
    desktopInnerRows +
    '</table>';

  // ── Assemble mobile email table ─────────────────────────────
  // Same pattern: if the mobile frame has corner radii, apply them to the
  // outer table and clip all inner content with a single <td overflow:hidden>.
  var mobileRadCSS = mobileRad.any ? mobileRad.css : '';
  var mobileCollapse = (mobileStroke || mobileRad.any)
    ? 'border-collapse:separate;border-spacing:0;' + mobileRadCSS + (mobileStroke ? mobileStroke.css : '')
    : 'border-collapse:collapse;';
  var mobileInnerRows = mobileRad.any
    ? (ind(1) + '<tr>\n' +
       ind(2) + '<td style="padding:0;' + mobileRadCSS + 'overflow:hidden;">\n' +
       ind(2) + '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">\n' +
       mobileRows +
       ind(2) + '</table>\n' +
       ind(2) + '</td>\n' +
       ind(1) + '</tr>\n')
    : mobileRows;
  // Mobile table fills 100% of available screen width so the email spans
  // edge-to-edge on any phone (360px, 375px, 390px, 430px, etc.).
  // max-width:100% is already implied by width:100%, but kept for clarity.
  // The inner sections render as width:100% via _mobileMode fluid logic,
  // so content also scales up correctly when the screen is wider than the
  // Figma mobile frame width.
  var mobileTable =
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0"\n' +
    '       class="email-container"\n' +
    '       align="center"\n' +
    '       width="100%"\n' +
    '       bgcolor="' + mobileBg + '"\n' +
    '       style="width:100%;max-width:100%;margin:0 auto;' +
    'background-color:' + mobileBg + ';' + mobileCollapse +
    '">\n' +
    mobileInnerRows +
    '</table>';

  var bpUtmMetaTags =
    (utmSource   ? '<meta name="utm-source"   content="' + escapeHtml(utmSource)   + '">\n' : '') +
    (utmMedium   ? '<meta name="utm-medium"   content="' + escapeHtml(utmMedium)   + '">\n' : '') +
    (utmCampaign ? '<meta name="utm-campaign" content="' + escapeHtml(utmCampaign) + '">\n' : '') +
    (utmContent  ? '<meta name="utm-content"  content="' + escapeHtml(utmContent)  + '">\n' : '') +
    (utmTerm     ? '<meta name="utm-term"     content="' + escapeHtml(utmTerm)     + '">\n' : '');

  return '<!DOCTYPE html>\n' +
'<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">\n' +
'<head>\n' +
'<meta charset="UTF-8">\n' +
'<meta http-equiv="X-UA-Compatible" content="IE=edge">\n' +
'<meta name="viewport" content="width=device-width,initial-scale=1.0">\n' +
'<meta name="x-apple-disable-message-reformatting">\n' +
'<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">\n' +
bpUtmMetaTags +
'<title>' + escapeHtml(emailTitle) + '</title>\n' +
'<!--[if mso]><noscript><xml><o:OfficeDocumentSettings>' +
'<o:AllowPNG/>' +
'<o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->\n' +
'<style type="text/css">\n' +
'  * { box-sizing: border-box; }\n' +
'  body, table, td, p, a, h1, h2, h3 {\n' +
'    -webkit-text-size-adjust: 100%;\n' +
'    -ms-text-size-adjust: 100%;\n' +
'  }\n' +
'  table, td {\n' +
'    mso-table-lspace: 0pt;\n' +
'    mso-table-rspace: 0pt;\n' +
'    border-collapse: collapse;\n' +
'  }\n' +
'  img {\n' +
'    -ms-interpolation-mode: bicubic;\n' +
'    border: 0;\n' +
'    display: block;\n' +
'    height: auto;\n' +
'    max-width: 100%;\n' +
'    outline: none;\n' +
'    text-decoration: none;\n' +
'  }\n' +
'  /* Gmail (web) replaces emoji unicode with <img class="il"> elements.\n' +
'     Our display:block above would push each emoji to its own line.\n' +
'     img.il targets only Gmail\'s emoji images and keeps them inline.\n' +
'     The second rule covers any <img> Gmail injects inside <p> tags\n' +
'     regardless of whether class="il" is present. */\n' +
'  img.il { display: inline !important; vertical-align: middle !important; }\n' +
'  u + #body .email-container p img {\n' +
'    display: inline !important;\n' +
'    vertical-align: middle !important;\n' +
'  }\n' +
'  body {\n' +
'    margin: 0 !important;\n' +
'    padding: 0 !important;\n' +
'    background-color: ' + bodyBg + ';\n' +
'    width: 100% !important;\n' +
'  }\n' +
'  h1, h2, h3, p { margin: 0; padding: 0; }\n' +
'  a { color: inherit; }\n' +
'  a[x-apple-data-detectors] {\n' +
'    color: inherit !important;\n' +
'    text-decoration: none !important;\n' +
'  }\n' +
'  u + #body a {\n' +
'    color: inherit;\n' +
'    text-decoration: none;\n' +
'  }\n' +
'  /* Gmail iOS app ignores @media queries — it renders the email at its declared\n' +
'     width (' + desktopWidth + 'px) and scales it down, producing equal margins on both sides.\n' +
'     u+#body targets Gmail specifically and forces the container to fill the full\n' +
'     available width so the banner stretches edge-to-edge on iPhone Gmail. */\n' +
'  u + #body .email-container {\n' +
'    width: 100% !important;\n' +
'    max-width: ' + desktopWidth + 'px !important;\n' +
'  }\n' +
'  /* Gmail iOS renders at the email\'s declared width then scales down.\n' +
'     Horizontal-layout cells tables pinned to a sub-' + desktopWidth + 'px pixel width\n' +
'     (the "pack-content" pattern: fill parent, all-fixed/hug children) appear\n' +
'     narrower than their container in Gmail iOS\'s internal viewport, creating\n' +
'     visible side margins on sections with a distinct background colour (e.g.\n' +
'     a coloured banner). Forcing them to width:100% in Gmail iOS eliminates the\n' +
'     margins; the TDs\' explicit pixel widths still control column sizing via\n' +
'     the browser\'s auto table-layout, so items still pack together. */\n' +
'  u + #body .email-container .hz-cells {\n' +
'    width: 100% !important;\n' +
'    max-width: 100% !important;\n' +
'  }\n' +
'  /* Gmail iOS does not apply @media queries, so the .fill-col width:auto\n' +
'     override that normally fires on narrow viewports never runs. Without it,\n' +
'     Gmail iOS uses auto table-layout with every TD at its declared pixel\n' +
'     width (the desktop fillShare value). When the sum of TD widths exceeds\n' +
'     the Gmail-internal viewport, all columns proportionally shrink — the\n' +
'     fixed-size logo shrinks alongside the fill text instead of anchoring at\n' +
'     its designed size. Replicate the fill-col override here via u+#body so\n' +
'     Gmail iOS gives fixed columns their pixel width and fill columns absorb\n' +
'     whatever remains — exactly the Figma FILL semantic. */\n' +
'  u + #body .email-container .fill-col {\n' +
'    width: auto !important;\n' +
'    min-width: 0 !important;\n' +
'  }\n' +
'  /* BREAKPOINT MODE — mobile div hidden by default.\n' +
'     No !important on the global hide rule so the @media show-rule below\n' +
'     can always override it with !important, regardless of source order\n' +
'     (BeeFree pattern). The inline style also hides in Gmail webmail. */\n' +
'  .for-mobile { display: none; max-height: 0; overflow: hidden; mso-hide: all; }\n' +
'  /* At mobile width: show mobile, hide desktop. */\n' +
'  @media only screen and (max-width: ' + (desktopWidth - 1) + 'px) {\n' +
'    .email-container { width: 100% !important; max-width: 100% !important; }\n' +
'    /* Same fix as single-frame mode: table-layout:fixed forces the browser\n' +
'       to respect the table\'s constrained width rather than expanding it\n' +
'       to fit fixed-width TD cells. Columns scale proportionally to fit\n' +
'       any phone viewport with no horizontal scroll. */\n' +
'    .for-mobile table {\n' +
'      max-width: 100% !important;\n' +
'      table-layout: fixed !important;\n' +
'    }\n' +
'    .for-mobile td:not(.nowrap-lbl),\n' +
'    .for-mobile p:not(.nowrap-lbl) {\n' +
'      white-space: normal !important;\n' +
'    }\n' +
'    /* FILL columns absorb remaining space after fixed columns take their share.\n' +
'       With table-layout:fixed, width:auto means "take what is left" — exactly\n' +
'       the same semantic as Figma\'s FILL sizing. */\n' +
'    .for-mobile .fill-col {\n' +
'      width: auto !important;\n' +
'      min-width: 0 !important;\n' +
'    }\n' +
'    .for-desktop {\n' +
'      display: none !important;\n' +
'      max-height: 0 !important;\n' +
'      overflow: hidden !important;\n' +
'      height: 0 !important;\n' +
'    }\n' +
'    .for-mobile {\n' +
'      display: block !important;\n' +
'      max-height: none !important;\n' +
'      overflow: visible !important;\n' +
'      height: auto !important;\n' +
'      margin: 0 !important;\n' +
'      padding: 0 !important;\n' +
'    }\n' +
'  }\n' +
'</style>\n' +
(headCode ? headCode + '\n' : '') +
'</head>\n' +
'<body id="body" bgcolor="' + bodyBg + '" style="margin:0;padding:0;background-color:' + bodyBg + ';">\n' +
preheaderHtml +
'<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"\n' +
'       bgcolor="' + bodyBg + '" style="background-color:' + bodyBg + ';">\n' +
ind(1) + '<tr>\n' +
ind(2) + '<td align="center" valign="top" style="padding:0;">\n' +
'\n' +
ind(2) + '<!-- ═══ DESKTOP VERSION (Outlook always sees this) ═══ -->\n' +
ind(2) + '<div class="for-desktop" style="display:block;">\n' +
ind(2) + '<!--[if mso]><table role="presentation" align="center" width="' + desktopWidth + '" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->\n' +
desktopTable + '\n' +
ind(2) + '<!--[if mso]></td></tr></table><![endif]-->\n' +
ind(2) + '</div>\n' +
'\n' +
ind(2) + '<!-- ═══ MOBILE VERSION (media-query clients only) ═══ -->\n' +
ind(2) + '<!--[if !mso]><!-->\n' +
ind(2) + '<div class="for-mobile" style="display:none;max-height:0;overflow:hidden;mso-hide:all;text-align:center;margin:0;padding:0;">\n' +
mobileTable + '\n' +
ind(2) + '</div>\n' +
ind(2) + '<!--<![endif]-->\n' +
'\n' +
ind(2) + '</td>\n' +
ind(1) + '</tr>\n' +
'</table>\n' +
'</body>\n' +
'</html>';
}

// ══════════════════════════════════════════════════════════════
// Plugin bootstrap
// ══════════════════════════════════════════════════════════════
// Open at max width so figma.ui.resize() can expand up to this ceiling later.
// We immediately shrink to the default editing width (480px).
figma.showUI(__html__, { width: 1200, height: 700, themeColors: true });
figma.ui.resize(480, 700);

// ── Responsive mode: stored frame reference ──────────────────
var _respFrameId    = null;

// ── Breakpoint mode: stored frame references ─────────────────
var _bpDesktopId    = null;
var _bpMobileId     = null;
// When true, tables wider than 50% of the mobile frame use width:100%
// so inner content adapts to the screen instead of staying at fixed px widths.
var _mobileMode      = false;
var _mobileFrameW    = 380; // updated before each mobile render

function sendSelectionToUI() {
  var sel = figma.currentPage.selection;
  if (!sel.length) { figma.ui.postMessage({ type: 'selection', node: null }); return; }
  var node = sel[0];
  var cfg = parseNodeConfig(node);
  figma.ui.postMessage({
    type: 'selection',
    node: { id: node.id, name: node.name, type: node.type, cfg: cfg }
  });
}
figma.on('selectionchange', sendSelectionToUI);
sendSelectionToUI();

figma.ui.onmessage = function(msg) {
  var node = figma.currentPage.selection[0];

  if (msg.type === 'update-prop') {
    if (!node) return;
    var key = msg.key; var val = msg.value;
    if      (key === 'frameType')       setFrameType(node, val);
    else if (key === 'exportImg')       setFlag(node, 'exportimg', val);
    else if (key === 'fullWidthMobile') setFlag(node, 'fullwidth', val);
    else if (key === 'visibility')      setTag(node, 'visibility', val);
    else if (key === 'imgFormat')       setTag(node, 'imgformat', val);
    // Fields stored in pluginData (may contain parens or multi-line text)
    else if (key === 'comment')     { node.setPluginData('comment',     val || ''); }
    else if (key === 'rawCode')     { node.setPluginData('rawCode',     val || ''); }
    else if (key === 'preheader')   { node.setPluginData('preheader',   val || ''); }
    else if (key === 'head')        { node.setPluginData('head',        val || ''); }
    else if (key === 'subject')     { node.setPluginData('subject',     val || ''); }
    else if (key === 'utmSource')   { node.setPluginData('utmSource',   val || ''); }
    else if (key === 'utmMedium')   { node.setPluginData('utmMedium',   val || ''); }
    else if (key === 'utmCampaign') { node.setPluginData('utmCampaign', val || ''); }
    else if (key === 'utmContent')  { node.setPluginData('utmContent',  val || ''); }
    else if (key === 'utmTerm')     { node.setPluginData('utmTerm',     val || ''); }
    else                                setTag(node, key, val);
    figma.ui.postMessage({ type: 'name-updated', name: node.name });
    return;
  }

  if (msg.type === 'generate') {
    // Use locked responsive frame if one is set, otherwise fall back to current selection
    var genMsg = msg;
    function runGenerate(genNode) {
      if (!genNode) { figma.ui.postMessage({ type: 'error', message: 'Please select or set a frame first.' }); return; }
      var cfg = parseNodeConfig(genNode);
      if (cfg.frameType !== 'template') {
        figma.ui.postMessage({ type: 'error', message: 'Select the root frame and set type to Template first.' });
        return;
      }
      try {
        var html = generateEmailHtml(genNode, {
          preheader:   cfg.preheader   || '',
          headCode:    cfg.head        || '',
          emailTitle:  cfg.subject     || genMsg.emailTitle || genNode.name,
          emailWidth:  Math.round(genNode.width),
          utmSource:   cfg.utmSource   || '',
          utmMedium:   cfg.utmMedium   || '',
          utmCampaign: cfg.utmCampaign || '',
          utmContent:  cfg.utmContent  || '',
          utmTerm:     cfg.utmTerm     || '',
        });
        figma.ui.postMessage({ type: 'html-result', html: html, emailWidth: Math.round(genNode.width) });
      } catch(e) {
        figma.ui.postMessage({ type: 'error', message: 'Error: ' + (e.message || String(e)) });
      }
    }
    if (_respFrameId) {
      figma.getNodeByIdAsync(_respFrameId).then(function(lockedNode) {
        if (!lockedNode) {
          _respFrameId = null;
          figma.ui.postMessage({ type: 'resp-frame-cleared' });
          runGenerate(node); // fall back to current selection
        } else {
          runGenerate(lockedNode);
        }
      }).catch(function(e) {
        figma.ui.postMessage({ type: 'error', message: 'Could not load frame: ' + (e.message || String(e)) });
      });
    } else {
      runGenerate(node);
    }
    return;
  }

  // ── Responsive mode: capture a frame ────────────────────────
  if (msg.type === 'set-resp-frame') {
    var respNode = figma.currentPage.selection[0];
    if (!respNode) {
      figma.ui.postMessage({ type: 'error', message: 'Select a frame in Figma first, then click Set.' });
      return;
    }
    if (respNode.type !== 'FRAME' && respNode.type !== 'COMPONENT' && respNode.type !== 'INSTANCE') {
      figma.ui.postMessage({ type: 'error', message: 'Selection must be a Frame, Component, or Instance.' });
      return;
    }
    _respFrameId = respNode.id;
    figma.ui.postMessage({ type: 'resp-frame-set', id: respNode.id, name: respNode.name });
    return;
  }

  if (msg.type === 'clear-resp-frame') {
    _respFrameId = null;
    figma.ui.postMessage({ type: 'resp-frame-cleared' });
    return;
  }

  // ── Breakpoint mode: capture a frame for desktop or mobile ──
  if (msg.type === 'set-breakpoint-frame') {
    var bpNode = figma.currentPage.selection[0];
    if (!bpNode) {
      figma.ui.postMessage({ type: 'error', message: 'Select a frame in Figma first, then click Set.' });
      return;
    }
    if (bpNode.type !== 'FRAME' && bpNode.type !== 'COMPONENT' && bpNode.type !== 'INSTANCE') {
      figma.ui.postMessage({ type: 'error', message: 'Selection must be a Frame, Component, or Instance.' });
      return;
    }
    if (msg.role === 'desktop') {
      _bpDesktopId = bpNode.id;
    } else {
      _bpMobileId = bpNode.id;
    }
    figma.ui.postMessage({
      type: 'breakpoint-frame-set',
      role: msg.role,
      id:   bpNode.id,
      name: bpNode.name,
      width: Math.round(bpNode.width)
    });
    return;
  }

  // ── Breakpoint mode: generate combined desktop + mobile HTML ─
  if (msg.type === 'generate-breakpoint') {
    if (!_bpDesktopId || !_bpMobileId) {
      figma.ui.postMessage({ type: 'error', message: 'Please set both a Desktop and Mobile frame first.' });
      return;
    }
    // dynamic-page documentAccess requires the async variant
    var bpMsg = msg;
    figma.getNodeByIdAsync(_bpDesktopId).then(function(desktopNode) {
      if (!desktopNode) {
        figma.ui.postMessage({ type: 'error', message: 'Desktop frame not found. Please re-select it.' });
        _bpDesktopId = null;
        return;
      }
      figma.getNodeByIdAsync(_bpMobileId).then(function(mobileNode) {
        if (!mobileNode) {
          figma.ui.postMessage({ type: 'error', message: 'Mobile frame not found. Please re-select it.' });
          _bpMobileId = null;
          return;
        }
        try {
          var desktopCfg = parseNodeConfig(desktopNode);
          var bpHtml = generateBreakpointEmailHtml(desktopNode, mobileNode, {
            preheader:   desktopCfg.preheader   || '',
            headCode:    desktopCfg.head        || '',
            emailTitle:  desktopCfg.subject     || bpMsg.emailTitle || desktopNode.name,
            utmSource:   desktopCfg.utmSource   || '',
            utmMedium:   desktopCfg.utmMedium   || '',
            utmCampaign: desktopCfg.utmCampaign || '',
            utmContent:  desktopCfg.utmContent  || '',
            utmTerm:     desktopCfg.utmTerm     || '',
          });
          figma.ui.postMessage({ type: 'html-result', html: bpHtml, emailWidth: Math.round(desktopNode.width) });
        } catch(e) {
          figma.ui.postMessage({ type: 'error', message: 'Error: ' + (e.message || String(e)) });
        }
      }).catch(function(e) {
        figma.ui.postMessage({ type: 'error', message: 'Could not load mobile frame: ' + (e.message || String(e)) });
      });
    }).catch(function(e) {
      figma.ui.postMessage({ type: 'error', message: 'Could not load desktop frame: ' + (e.message || String(e)) });
    });
    return;
  }

  // ── Breakpoint mode: clear a frame assignment ────────────
  if (msg.type === 'clear-breakpoint-frame') {
    if (msg.role === 'desktop') _bpDesktopId = null;
    else if (msg.role === 'mobile') _bpMobileId = null;
    return;
  }

  if (msg.type === 'resize-ui') {
    figma.ui.resize(Math.round(msg.width), Math.round(msg.height));
    return;
  }

  if (msg.type === 'close') figma.closePlugin();
};