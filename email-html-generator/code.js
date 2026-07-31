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
  // Use depth-counting so values containing ')' (e.g. template expressions) are read correctly.
  var prefix = '#' + key + '(';
  var idx = name.toLowerCase().indexOf(prefix.toLowerCase());
  if (idx === -1) return null;
  var start = idx + prefix.length;
  var depth = 1;
  var i = start;
  while (i < name.length && depth > 0) {
    if (name[i] === '(') depth++;
    else if (name[i] === ')') depth--;
    if (depth > 0) i++;
  }
  return depth === 0 ? name.slice(start, i).trim() : null;
}
function hasTag(name, key) {
  return new RegExp('#' + key + '\\b', 'i').test(name);
}
function getFrameType(name) {
  var m = name.match(/#frametype:(template|button|image|section|divider)/i);
  return m ? m[1].toLowerCase() : null;
}
function setTag(node, key, value) {
  // Use depth-counting to find existing tag bounds so values with ')' are handled correctly.
  var prefix = '#' + key + '(';
  var idx = node.name.toLowerCase().indexOf(prefix.toLowerCase());
  if (idx === -1) {
    // Tag not present — append if there's a value.
    if (value) node.name = node.name.trim() + ' #' + key + '(' + value + ')';
    return;
  }
  var valueStart = idx + prefix.length;
  var depth = 1;
  var i = valueStart;
  while (i < node.name.length && depth > 0) {
    if (node.name[i] === '(') depth++;
    else if (node.name[i] === ')') depth--;
    if (depth > 0) i++;
  }
  var tagEnd = i + 1; // position after the closing ')'
  var before = node.name.slice(0, idx);
  var after  = node.name.slice(tagEnd);
  if (!value) {
    node.name = (before + after).replace(/\s+/g, ' ').trim();
  } else {
    node.name = (before + '#' + key + '(' + value + ')' + after).replace(/\s+/g, ' ').trim();
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
    // preheader and custom injection points stored in pluginData (may contain parens that break tag regex)
    preheader:       gpd('preheader') || getTag(n, 'preheader') || '',
    headStart:       gpd('headStart') || '',
    headEnd:         gpd('headEnd')   || '',
    bodyStart:       gpd('bodyStart') || '',
    bodyEnd:         gpd('bodyEnd')   || '',
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
    // Mobile overrides
    mobileStack:      gpd('mobileStack')      || '',  // 'vertical'
    mobileAlign:      gpd('mobileAlign')      || '',  // 'left' | 'center' | 'right'
    mobilePadTop:     gpd('mobilePadTop')     || '',
    mobilePadRight:   gpd('mobilePadRight')   || '',
    mobilePadBottom:  gpd('mobilePadBottom')  || '',
    mobilePadLeft:    gpd('mobilePadLeft')    || '',
    mobileFontSize:   gpd('mobileFontSize')   || '',
    mobileLineHeight: gpd('mobileLineHeight') || '',
    mobileTextAlign:  gpd('mobileTextAlign')  || '',  // 'left' | 'center' | 'right'
    mobileGap:        gpd('mobileGap')        || '',
    // Semantic HTML tag for TEXT nodes: '' (auto → <p>) | 'h1'…'h6' | 'p'
    htmlTag:          gpd('htmlTag')          || '',
    // Background image — section/template frames only
    bgImgOn:  gpd('bgImgOn') === '1',
    bgImgSrc: gpd('bgImgSrc') || '',
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

// ── Blend (Gmail dark-mode white-preservation) ───────────────
// STRICTLY OPT-IN. A text layer is "flagged for blend" when the designer sets
// a non-normal blend mode on it (or its fill) in Figma — no colour/position
// inference. When flagged, renderText wraps the <p> in the black-background
// screen/difference sandwich (see BLEND markers in renderText + the generators)
// so pure-white text survives Gmail's forced dark-mode colour inversion. The
// wrapper rules are scoped to `u + .body`, which only Gmail matches, so Outlook
// never renders the black boxes. Not flagged → zero blend traces in the output.
function textBlendFlagged(node) {
  if (!node) return false;
  if (node.fills && node.fills !== figma.mixed && node.fills.length) {
    var f = node.fills[0];
    if (f && f.visible !== false && f.blendMode &&
        f.blendMode !== 'NORMAL' && f.blendMode !== 'PASS_THROUGH') return true;
  }
  if (node.blendMode && node.blendMode !== 'NORMAL' && node.blendMode !== 'PASS_THROUGH') return true;
  return false;
}
// True when a hex colour is (near) pure white — blend only reconstructs white.
function isNearWhite(hex) {
  if (!hex) return false;
  var h = hex.replace('#', '');
  if (h.length !== 6) return false;
  var r = parseInt(h.slice(0, 2), 16),
      g = parseInt(h.slice(2, 4), 16),
      b = parseInt(h.slice(4, 6), 16);
  return r >= 250 && g >= 250 && b >= 250;
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
// For href/src attributes: same as escapeHtml but preserves " so template
// expressions like {{ func "string" }} are not corrupted.
function escapeUrl(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
  var rad = getCornerRadii(node);

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
    var sst = 'display:block;width:' + w + 'px;height:auto;border:0;' + (rad.any ? rad.css : '');
    var simgTag = ind(d) + '<img src="' + escapeUrl(src) + '" alt="' + escapeHtml(alt) +
                 '" width="' + w + '" height="' + h + '" border="0" style="' + sst + '">';
    if (cfg.href) {
      simgTag = ind(d) + '<a href="' + escapeUrl(cfg.href) + '" target="_blank" ' +
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
  // Apply corner radius + overflow:hidden to the wrapping table so the image
  // is clipped to the rounded corners. border-collapse:separate is required
  // for border-radius to take effect on a <table> element.
  var tblWSty   = tblW ? 'width:' + tblW + 'px;max-width:' + tblW + 'px;' + marginStyle : 'width:100%;';
  if (rad.any) {
    tblWSty += 'border-collapse:separate;border-spacing:0;' + rad.css + 'overflow:hidden;';
  }
  // Fluid mobile img: use width:100% on the img tag so it scales with the container.
  // Fixed: keep exact pixel width (preserves size on desktop/Outlook).
  // FILL img: wrapper is width:100% so margin on the img itself handles alignment.
  var fillImgMargin = (isFillImg && !isMobileFluidImg)
    ? (align === 'left'  ? 'margin:0 auto;'
     : align === 'right' ? 'margin-left:auto;'
     : 'margin:0 auto;')
    : '';
  var st = isMobileFluidImg
    ? 'display:block;width:100%;max-width:' + w + 'px;height:auto;border:0;'
    : 'display:block;width:' + w + 'px;height:auto;border:0;' + fillImgMargin;
  // Also stamp border-radius directly on the <img> for clients (e.g. Apple Mail,
  // some webmail) that render img radius independently of the table wrapper.
  if (rad.any) { st += rad.css; }
  var imgTag = ind(d+2) + '<img src="' + escapeUrl(src) + '" alt="' + escapeHtml(alt) +
               '" width="' + w + '" height="' + h + '" border="0" style="' + st + '">';

  var inner = ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' + tblWAttr + ' style="' + tblWSty + '">\n' +
    ind(d+1) + '<tr>\n' +
    ind(d+1) + '<td>\n' +
    imgTag + '\n' +
    ind(d+1) + '</td>\n' +
    ind(d+1) + '</tr>\n' +
    ind(d) + '</table>';

  if (cfg.href) {
    inner = ind(d) + '<a href="' + escapeUrl(cfg.href) + '" target="_blank" ' +
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
  return ind(d) + '<img src="' + escapeUrl(src) + '" alt="' + escapeHtml(alt) +
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
    inner = roundedWrapper(bgS, padS, rad, imgHtml.trim(), d, false, '', w, Math.round(node.height));
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
    inner = ind(d) + '<a href="' + escapeUrl(cfg.href) + '" target="_blank" style="display:block;text-decoration:none;">\n' +
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
// Also detects Figma bullet/numbered list formatting (listOptions +
// indentation) and, when present, returns a { list:true, blocks:[...] }
// structure instead of a plain string — see renderListBlocks / renderText.
function buildSegmentedText(node, baseColor, baseFontSize) {
  var segments;
  try {
    segments = node.getStyledTextSegments([
      'fills', 'fontSize', 'fontName',
      'textDecoration', 'textCase', 'letterSpacing',
      'listOptions', 'indentation'
    ]);
  } catch(e) {
    return escapeHtml(node.characters || '').replace(/\n/g, '<br>');
  }
  if (!segments || !segments.length) {
    return escapeHtml(node.characters || '').replace(/\n/g, '<br>');
  }

  // A single uniform-style bullet list can still come back as ONE segment
  // (nothing but listOptions/indentation distinguishes its lines), so list
  // detection must run before the "too few segments, skip the overhead"
  // shortcut below — otherwise a plain, evenly-styled bullet list would
  // silently fall through to the plain-text path and lose its bullets.
  var hasList = false;
  for (var hi = 0; hi < segments.length; hi++) {
    var hlo = segments[hi].listOptions;
    if (hlo && hlo !== figma.mixed && hlo.type && hlo.type !== 'NONE') { hasList = true; break; }
  }
  if (hasList) return buildListAwareText(segments, baseColor, baseFontSize);

  if (segments.length < 2) {
    return escapeHtml(node.characters || '').replace(/\n/g, '<br>');
  }

  var html = '';
  for (var si = 0; si < segments.length; si++) {
    var seg = segments[si];
    if (!seg.characters) continue;
    html += buildRunSpanHtml(seg.characters, seg, baseColor, baseFontSize).replace(/\n/g, '<br>');
  }
  return html;
}

// ── Per-run inline HTML (color/size/weight/style/decoration/case/spacing) ──
// `text` may contain literal newlines when called from the non-list path
// (caller converts them to <br> afterward); the list path pre-splits on
// \n before calling, so no newlines ever reach escapeHtml() from there.
function buildRunSpanHtml(text, seg, baseColor, baseFontSize) {
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
    // Always set font-family explicitly on the span — Outlook and some email
    // clients do not inherit font-family from the parent <p> onto child <span>
    // elements, causing styled spans to fall back to the default serif font.
    spanSt.push("font-family:'" + escapeHtml(seg.fontName.family) + "',Arial,sans-serif");
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

  var segText = escapeHtml(text);
  return spanSt.length > 0
    ? ('<span style="' + spanSt.join(';') + '">' + segText + '</span>')
    : segText;
}

// ── List-aware text: groups styled runs into lines, then groups
// consecutive lines sharing the same list mode (plain / bullet / numbered)
// into blocks. A single text node can mix plain paragraphs and list items
// (e.g. a heading line followed by bullets) — each contiguous run of the
// same mode becomes its own block; renderListBlocks turns blocks into
// <p>/<ul>/<ol> HTML and joins them.
function buildListAwareText(segments, baseColor, baseFontSize) {
  var lines = [];   // { type: 'NONE'|'UNORDERED'|'ORDERED', indent: number, html: string }
  var curRuns   = [];
  var curType   = 'NONE';
  var curIndent = 0;

  for (var si = 0; si < segments.length; si++) {
    var seg   = segments[si];
    var chars = seg.characters || '';
    if (!chars) continue;
    var lo = seg.listOptions;
    var segType   = (lo && lo !== figma.mixed && lo.type) ? lo.type : 'NONE';
    var segIndent = safeNum(seg.indentation, 0);
    var parts = chars.split('\n');
    for (var pi = 0; pi < parts.length; pi++) {
      curType   = segType;
      curIndent = segIndent;
      if (parts[pi]) {
        curRuns.push(buildRunSpanHtml(parts[pi], seg, baseColor, baseFontSize));
      }
      // A '\n' followed this chunk (i.e. it's not the last split piece) → line ends here.
      if (pi < parts.length - 1) {
        lines.push({ type: curType, indent: curIndent, html: curRuns.join('') });
        curRuns = [];
      }
    }
  }
  if (curRuns.length) {
    lines.push({ type: curType, indent: curIndent, html: curRuns.join('') });
  }
  // Drop trailing wholly-empty lines (mirrors the trailing-<br> stripping
  // done for plain text — a trailing \n in Figma shouldn't emit an empty
  // bullet/paragraph).
  while (lines.length && !lines[lines.length - 1].html) lines.pop();

  if (!lines.length) return { list: true, blocks: [] };

  // Group consecutive lines sharing the same mode.
  var blocks = [];
  var gi = 0;
  while (gi < lines.length) {
    var mode = lines[gi].type === 'ORDERED'   ? 'ol'
             : lines[gi].type === 'UNORDERED' ? 'ul'
             : 'text';
    var group = [lines[gi]];
    gi++;
    while (gi < lines.length) {
      var nextMode = lines[gi].type === 'ORDERED'   ? 'ol'
                   : lines[gi].type === 'UNORDERED' ? 'ul'
                   : 'text';
      if (nextMode !== mode) break;
      group.push(lines[gi]);
      gi++;
    }
    blocks.push({ mode: mode, lines: group });
  }
  return { list: true, blocks: blocks };
}

// ── Render list-aware blocks into concatenated HTML ───────────
// textTag/st/pClasses/d come from renderText — plain-mode blocks reuse the
// node's own tag+typography exactly as non-list text would; list blocks
// wrap in <ul>/<ol> with the same typography repeated inline (Outlook does
// not reliably inherit font styling onto <li> from an ancestor <ul>).
function renderListBlocks(blocks, textTag, st, pClasses, d) {
  var baseStyle = st.join(';');
  var out = [];
  for (var bi = 0; bi < blocks.length; bi++) {
    var block = blocks[bi];
    if (block.mode === 'text') {
      var joined = [];
      for (var li = 0; li < block.lines.length; li++) joined.push(block.lines[li].html);
      out.push(
        ind(d) + '<' + textTag + (pClasses.length ? ' class="' + pClasses.join(' ') + '"' : '') +
        ' style="' + baseStyle + '">' + joined.join('<br>') + '</' + textTag + '>'
      );
    } else {
      var tag       = (block.mode === 'ol') ? 'ol' : 'ul';
      var listType  = (block.mode === 'ol') ? 'decimal' : 'disc';
      // Shorthand 'padding:0' already sits in baseStyle (pushed by renderText);
      // the longhand padding-left declared after it wins for that one side
      // only, leaving room for the marker while top/right/bottom stay 0.
      var wrapStyle = baseStyle + ';padding-left:20px;list-style-type:' + listType + ';list-style-position:outside;';
      var itemsHtml = '';
      for (var ii = 0; ii < block.lines.length; ii++) {
        var lvl       = safeNum(block.lines[ii].indent, 0);
        // Mobile-override class (font-size/line-height/text-align !important
        // rules built in renderText) must land on every element the CSS rule
        // could plausibly target — repeat it on each <li>, not just the <ul>/
        // <ol> wrapper, since some clients apply @media rules per-element
        // rather than relying on inheritance from the list container.
        var itemStyle = baseStyle + (lvl > 0 ? ';margin-left:' + (lvl * 20) + 'px' : '');
        itemsHtml += ind(d + 1) + '<li' + (pClasses.length ? ' class="' + pClasses.join(' ') + '"' : '') +
          ' style="' + itemStyle + '">' + block.lines[ii].html + '</li>\n';
      }
      out.push(
        ind(d) + '<' + tag + (pClasses.length ? ' class="' + pClasses.join(' ') + '"' : '') +
        ' style="' + wrapStyle + '">\n' + itemsHtml + ind(d) + '</' + tag + '>'
      );
    }
  }
  return out.join('\n');
}

// ── Render TEXT node ─────────────────────────────────────────
function renderText(node, cfg, d) {
  var st = [];
  var fs = safeNum(node.fontSize, 14);
  st.push('font-size:' + Math.round(fs) + 'px');
  st.push('mso-line-height-rule:exactly');

  // Semantic tag: user-selected h1–h6 (stored in pluginData), default <p>.
  // Validated against a whitelist so corrupt pluginData can never emit an
  // arbitrary tag into the HTML.
  var _tagOk  = { h1:1, h2:1, h3:1, h4:1, h5:1, h6:1, p:1 };
  var textTag = (cfg.htmlTag && _tagOk[cfg.htmlTag]) ? cfg.htmlTag : 'p';

  var _weightSet = false;
  if (node.fontName && node.fontName !== figma.mixed) {
    st.push("font-family:'" + escapeHtml(node.fontName.family) + "',Arial,sans-serif");
    var style  = node.fontName.style || '';
    var bold   = style.toLowerCase().indexOf('bold')   !== -1;
    var italic = style.toLowerCase().indexOf('italic') !== -1;
    st.push('font-weight:' + (bold ? 'bold' : 'normal'));
    _weightSet = true;
    if (italic) st.push('font-style:italic');
  }
  // Heading tags default to bold in every client. When fontName is mixed the
  // block above pushes no font-weight, which is fine for <p> (clients default
  // to normal — matching current output) but would silently bold an h1–h6.
  // Pin font-weight:normal so the rendered weight is identical to what the
  // same layer produced as <p>; per-segment spans still override per run.
  if (textTag !== 'p' && !_weightSet) {
    st.push('font-weight:normal');
  }

  // When fills are mixed (per-character color), getTextColor returns #000000
  // as the base <p> colour.  buildSegmentedText will wrap each run that
  // differs from the base in a <span style="color:..."> so the per-character
  // colour is always honoured in the generated HTML.
  var _origTextColor = getTextColor(node);
  // BLEND opt-in: a flagged text layer is forced to pure white — the black-bg
  // screen/difference sandwich can only reconstruct white. Warn (build-time)
  // if the designer flagged a non-white layer, since its colour will change.
  var _blendOn = textBlendFlagged(node);
  if (_blendOn && !isNearWhite(_origTextColor) && typeof console !== 'undefined' && console.warn) {
    console.warn('[blend] "' + (node.name || 'text') + '" is flagged for blend but its colour (' +
      _origTextColor + ') is not white; forcing #ffffff (blend only reconstructs pure white).');
  }
  var baseColor = _blendOn ? '#ffffff' : _origTextColor;
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

  // Use segmented rendering to capture per-run color / weight / size changes,
  // and to detect Figma bullet/numbered list formatting. Falls back to plain
  // text for single-style, non-list nodes (no overhead).
  var segResult    = buildSegmentedText(node, baseColor, fs);
  var isListResult = !!(segResult && typeof segResult === 'object' && segResult.list);
  var rawText      = isListResult ? '' : segResult;
  // Strip trailing <br> tags that correspond to trailing \n characters in
  // Figma. Email clients render trailing <br> inconsistently — some collapse
  // them, some don't — so we remove them here and let the parent layout emit
  // explicit spacer rows instead (see trailing-newline spacer in rows loop).
  // (List blocks handle their own trailing-empty-line stripping.)
  if (!isListResult) rawText = rawText.replace(/(<br>)+$/, '');
  // nowrap-lbl ensures the mobile media query does not strip white-space:nowrap
  // from short hug-text labels (dates, counters, etc.).
  // Wide hug text in mobile mode omits the class so @media can reset white-space.
  var isHugP = isHugText && mobileNowrap;
  // Build <p> class list — nowrap-lbl first (existing), then mobile override class if needed.
  var pClasses = [];
  if (isHugP) pClasses.push('nowrap-lbl');
  if (cfg.mobileFontSize || cfg.mobileLineHeight || cfg.mobileTextAlign) {
    var mc = mobClass(node.id);
    var mProps = [];
    if (cfg.mobileFontSize)   mProps.push('font-size:'   + parseInt(cfg.mobileFontSize,   10) + 'px !important');
    if (cfg.mobileLineHeight) mProps.push('line-height:' + parseInt(cfg.mobileLineHeight, 10) + 'px !important; mso-line-height-rule:exactly !important');
    if (cfg.mobileTextAlign)  mProps.push('text-align:'  + cfg.mobileTextAlign + ' !important');
    _mobileCssRules.push('    .' + mc + ' { ' + mProps.join('; ') + '; }');
    pClasses.push(mc);
  }
  var html = isListResult
    ? renderListBlocks(segResult.blocks, textTag, st, pClasses, d)
    : '<' + textTag + (pClasses.length ? ' class="' + pClasses.join(' ') + '"' : '') + ' style="' + st.join(';') + '">' + rawText + '</' + textTag + '>';
  // BLEND: wrap the <p> ONLY (all-or-nothing) in the fixed screen/difference
  // black-bg sandwich. Order is fixed: outer screen, inner difference. Lists /
  // rich multi-block text are skipped (the pattern must wrap a single <p>).
  if (_blendOn && !isListResult) {
    html = '<div class="q-blend-screen"><div class="q-blend-difference">' + html + '</div></div>';
    _blendUsed = true;
  } else if (_blendOn && isListResult && typeof console !== 'undefined' && console.warn) {
    console.warn('[blend] "' + (node.name || 'text') + '" is a list/rich-text block; blend wraps a single <p> only — skipped.');
  }
  if (cfg.href) {
    html = '<a href="' + escapeUrl(cfg.href) + '" target="_blank" style="color:inherit;text-decoration:none;">' + html + '</a>';
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
  var bg    = getSolidFill(node);
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

  // Stroke/outline: check outer frame first, fall back to inner child frame
  var btnStroke = getStroke(node);
  if (!btnStroke && innerFrame) btnStroke = getStroke(innerFrame);

  // For a plain filled button with no stroke, keep the legacy blue default.
  // Skip the fallback when the user explicitly cleared all fills (text-only button).
  var fillsExplicitlyEmpty = node.fills && node.fills !== figma.mixed && node.fills.length === 0;
  if (!bg && !btnStroke && !fillsExplicitlyEmpty) bg = '#0066cc';

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
  var href   = escapeUrl(cfg.href || '#');
  // VML arcsize uses the largest corner value against the shorter dimension
  var arcPct = btnH > 0 ? Math.min(100, Math.round((rad.maxVal / (btnH / 2)) * 100)) : 0;

  // Per-corner border-radius for the <a> tag (modern clients)
  var radCSS = rad.any ? rad.css : '';

  // Mobile overrides for the button <a> tag.
  //   Font-size / line-height — stored on the TEXT node inside the button
  //     (user selects the text layer and sets them in the mobile panel).
  //   Padding — stored on the button FRAME itself (set in the button panel).
  // All overrides are emitted as a single @media !important class on the <a>
  // tag, which beats the inline padding/font-size on mobile clients.
  // VML (Outlook) is unaffected — it never runs @media rules.
  var tnCfg = tn ? parseNodeConfig(tn) : null;
  var btnMobFontSize   = (tnCfg && tnCfg.mobileFontSize)  || '';
  var btnMobLineHeight = (tnCfg && tnCfg.mobileLineHeight) || '';
  var hasMobPad = cfg.mobilePadTop !== '' || cfg.mobilePadRight !== '' ||
                  cfg.mobilePadBottom !== '' || cfg.mobilePadLeft !== '';
  var btnMobClass = '';
  if (btnMobFontSize || btnMobLineHeight || hasMobPad) {
    btnMobClass = mobClass(node.id);
    var btnMProps = [];
    if (btnMobFontSize)   btnMProps.push('font-size:'   + parseInt(btnMobFontSize,   10) + 'px !important');
    if (btnMobLineHeight) btnMProps.push('line-height:' + parseInt(btnMobLineHeight, 10) + 'px !important');
    if (hasMobPad) {
      var bmpt = cfg.mobilePadTop    !== '' ? parseInt(cfg.mobilePadTop,    10) : pad.t;
      var bmpr = cfg.mobilePadRight  !== '' ? parseInt(cfg.mobilePadRight,  10) : pad.r;
      var bmpb = cfg.mobilePadBottom !== '' ? parseInt(cfg.mobilePadBottom, 10) : pad.b;
      var bmpl = cfg.mobilePadLeft   !== '' ? parseInt(cfg.mobilePadLeft,   10) : pad.l;
      btnMProps.push('padding:' + bmpt + 'px ' + bmpr + 'px ' + bmpb + 'px ' + bmpl + 'px !important');
    }
    _mobileCssRules.push('    .' + btnMobClass + ' { ' + btnMProps.join('; ') + '; }');
  }

  var aDisplay = (isFill || isMobileFluidBtn) ? 'display:block;width:100%;box-sizing:border-box;' : 'display:block;width:100%;box-sizing:border-box;';
  var aStyle = aDisplay + 'white-space:nowrap;background-color:' + (bg || 'transparent') + ';color:' + tColor +
    ';text-decoration:none;font-family:' + tFont + ';font-size:' + tSize +
    'px;font-weight:' + tWeight + ';padding:' + btnP + ';' +
    radCSS + (btnStroke ? btnStroke.css : '') + 'mso-padding-alt:0;text-align:' + tAlign + ';-webkit-text-size-adjust:none;';

  var vml = '<!--[if mso]>' +
    '<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"' +
    ' href="' + href + '"' +
    ' style="' + vmlWidthStyle + '"' +
    ' arcsize="' + arcPct + '%"' +
    (btnStroke ? ' stroke="t" strokecolor="' + btnStroke.color + '" strokeweight="' + btnStroke.weight + 'px"' : ' stroke="f"') +
    (bg ? ' fillcolor="' + bg + '"' : ' filled="f"') + '>' +
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
    ind(d+2) + '<td align="' + tAlign + '"' + (bg ? ' bgcolor="' + bg + '"' : '') +
    ' style="' + tdRadCSS + (bg ? 'background-color:' + bg + ';' : '') + 'mso-line-height-rule:exactly;">\n' +
    ind(d+3) + vml + '\n' +
    ind(d+3) + '<!--[if !mso]><!-->\n' +
    ind(d+3) + '<a href="' + href + '" target="_blank"' + (btnMobClass ? ' class="' + btnMobClass + '"' : '') + ' style="' + aStyle + '">' + label + '</a>\n' +
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
// mobCls — optional CSS class string to stamp on the padding-carrying <td>
// so that @media mobile-override rules can change padding/alignment on mobile.
function roundedWrapper(bg, pad, rad, innerHtml, d, nested, mobCls, nodeW, nodeH) {
  var _mc = mobCls ? ' class="' + mobCls + '"' : '';
  if (!rad || !rad.any) {
    var plainStyle = (bg || '') + (pad || '');
    if (!plainStyle) return innerHtml;
    return ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%">\n' +
      ind(d+1) + '<tr>\n' +
      ind(d+2) + '<td' + _mc + (bg ? ' bgcolor="' + bg.replace('background-color:', '').replace(';','').trim() + '"' : '') +
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
    // msoSafeInner: a version of innerHtml safe to embed inside <!--[if mso]>.
    //
    // Two conditional-comment types must be neutralised:
    //
    //   <!--[if !mso]><!--> ... <!--<![endif]-->
    //     Non-MSO block — visible to browsers, hidden from Outlook.
    //     The embedded --> inside <!--<![endif]--> would prematurely close the
    //     outer MSO HTML comment for browsers, leaking duplicate content.
    //     These blocks are removed entirely (Outlook must never see the
    //     CSS-only alternative rendering that lives inside them).
    //
    //   <!--[if mso]> ... <![endif]-->
    //     Nested MSO block — unwrap it (keep content, discard markers) since
    //     we are already inside an Outlook-only conditional block.
    //
    // WHY INNERMOST-FIRST MATTERS
    // Non-MSO blocks can nest arbitrarily: e.g. a rounded section (bg-image)
    // wraps a rounded child section, which contains a button — each layer
    // produces its own <!--[if !mso]><!-->/<!--<![endif]--> pair.
    //
    // A plain non-greedy regex ([\s\S]*?) mis-pairs the markers: it matches
    // the outermost OPEN to the first (innermost) CLOSE it encounters, then
    // exits — leaving the outer CLOSE orphaned inside the MSO block.  That
    // orphan's --> still closes the browser HTML comment, so the leak remains.
    //
    // The regex below uses a negative lookahead to enforce innermost-first
    // matching: it only matches a non-MSO open/close pair whose interior
    // contains no further open markers.  Iterating until the string stops
    // changing peels one nesting level per pass — correct at any depth.
    // A final sweep removes any orphaned close markers that could not be
    // paired (guards against malformed input).
    var msoSafeInner = innerHtml;
    var _msiPrev;
    do {
      _msiPrev = msoSafeInner;
      // Innermost non-MSO block: interior must contain no nested open marker.
      msoSafeInner = msoSafeInner
        .replace(/<!--\[if !mso\]><!-->((?!<!--\[if !mso\]><!-->)[\s\S])*<!--<!\[endif\]-->/g, '');
      // Innermost MSO block: non-greedy naturally finds innermost first.
      msoSafeInner = msoSafeInner
        .replace(/<!--\[if mso\]>([\s\S]*?)<!\[endif\]-->/g, '$1');
    } while (msoSafeInner !== _msiPrev);
    // Safety: remove any orphaned non-MSO close markers left by malformed input.
    msoSafeInner = msoSafeInner.replace(/<!--<!\[endif\]-->/g, '');

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
        msoSafeInner + '\n' +
        ind(d) + '<![endif]-->';
    }

    // Has bg or padding. Table carries radius, TD carries padding + bg.
    // For Outlook (no border-radius support): MSO conditional injects padding
    // on a plain table without radius styling.
    return ind(d) + '<!--[if !mso]><!-->\n' +
      ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="' + tblRadStyle + '">\n' +
      ind(d+1) + '<tr>\n' +
      ind(d+2) + '<td' + _mc + tdBgAttr + (tdStyle ? ' style="' + tdStyle + '"' : '') + '>\n' +
      innerHtml + '\n' +
      ind(d+2) + '</td>\n' +
      ind(d+1) + '</tr>\n' +
      ind(d) + '</table>\n' +
      ind(d) + '<!--<![endif]-->\n' +
      ind(d) + '<!--[if mso]>\n' +
      ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%">\n' +
      ind(d+1) + '<tr>\n' +
      ind(d+2) + '<td' + _mc + tdBgAttr + (tdStyle ? ' style="' + tdStyle + '"' : '') + '>\n' +
      msoSafeInner + '\n' +
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
  // arcsize = (cornerRadius / halfShortestSide) * 100.
  // When node dimensions are provided (preferred), compute exactly as renderButton does.
  // Fall back to the legacy heuristic only if dimensions are unknown.
  var _arcShorter = (nodeW > 0 && nodeH > 0) ? Math.min(nodeW, nodeH) : 0;
  var arcPct = _arcShorter > 0
    ? Math.min(100, Math.round((rad.maxVal / (_arcShorter / 2)) * 100))
    : Math.min(50, Math.round(rad.maxVal * 2));

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
    ind(d+2) + '<td' + _mc + tdBgAttr + (outerTdStyle ? ' style="' + outerTdStyle + '"' : '') + '>\n' +
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
    // When a border-radius is also present, border-collapse:separate is required
    // for the radius to render on the table (the global CSS sets border-collapse:collapse).
    // border-spacing:0 prevents any cell gaps that separate normally introduces.
    // The <td> gets innerRadStyle (= radStyle + overflow:hidden) instead of bare
    // radStyle so inner content is clipped to the rounded corners, matching the
    // behaviour of the non-perSide branch.
    var perSideTableStyle = wStyle + (hasRad ? 'border-collapse:separate;border-spacing:0;' : '') + radStyle;
    var perSideTdStyle    = 'padding:0;' + (hasRad ? innerRadStyle : radStyle) + stroke.css;
    return ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' + wAttr + '\n' +
      ind(d) + '       style="' + perSideTableStyle + '">\n' +
      ind(d+1) + '<tr>\n' +
      ind(d+2) + '<td style="' + perSideTdStyle + '">\n' +
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

// ── Visibility-aware gap helpers ─────────────────────────────
// A gap between two auto-layout children must only be visible on a device when
// BOTH its neighbours are visible on that device — exactly like Figma: hiding a
// node collapses its gap contribution so no phantom space is left behind.
//
//   v1, v2  —  '' | 'mobile' | 'desktop'  (from parseNodeConfig .visibility)
// Returns    'always' | 'desktop' | 'mobile' | 'never'
function gapVisibility(v1, v2) {
  if (!v1 && !v2) return 'always';
  // Opposing visibility: they can never both be on screen simultaneously → no gap.
  if ((v1 === 'mobile' && v2 === 'desktop') ||
      (v1 === 'desktop' && v2 === 'mobile')) return 'never';
  if (v1 === 'mobile' || v2 === 'mobile') return 'mobile';
  if (v1 === 'desktop' || v2 === 'desktop') return 'desktop';
  return 'always';
}

// Emits a VERTICAL gap <tr> row conditioned on gapVis.
//
//   'always'  → unchanged: plain spacer row visible everywhere.
//   'desktop' → gap row gets class="gap-dt"; the @media rule collapses it to
//               height:0 on mobile. Outlook sees height="N" attribute (correct).
//   'mobile'  → gap row is wrapped in <!--[if !mso]> so Outlook never sees it;
//               its inline style defaults to height:0; a per-height rule pushed
//               to _mobileCssRules reveals the correct height at mobile widths.
//   'never'   → returns '' (gap omitted entirely).
// mobileGapOverride: null  → no override (mobile gap = desktop gap)
//                    number → override gap height on mobile to this value (0 = remove gap)
function emitVerticalGap(px, gapVis, d, mobileGapOverride) {
  if (!px || px <= 0 || gapVis === 'never') return '';

  if (gapVis === 'always') {
    // Mobile gap override: add a class that changes the height at mobile widths.
    var hasMobOv = (mobileGapOverride !== null && mobileGapOverride !== undefined && mobileGapOverride !== px);
    if (hasMobOv) {
      var ovCls = 'gap-mob-ov-' + mobileGapOverride;
      if (!_mobileGapClassSeen[ovCls]) {
        _mobileGapClassSeen[ovCls] = true;
        if (mobileGapOverride <= 0) {
          _mobileCssRules.push('    .' + ovCls + ' { height:0 !important; max-height:0 !important; overflow:hidden !important; font-size:0 !important; line-height:0 !important; }');
        } else {
          _mobileCssRules.push('    .' + ovCls + ' { height:' + mobileGapOverride + 'px !important; max-height:none !important; overflow:visible !important; }');
        }
      }
      return ind(d) + '<tr><td class="' + ovCls + '" height="' + px + '" style="height:' + px + 'px;font-size:0;line-height:0;">&nbsp;</td></tr>\n';
    }
    return ind(d) + '<tr><td height="' + px + '" style="height:' + px + 'px;font-size:0;line-height:0;">&nbsp;</td></tr>\n';
  }

  if (gapVis === 'desktop') {
    // Desktop-only gap: .gap-dt hides it on mobile. Mobile override irrelevant.
    return ind(d) + '<tr><td class="gap-dt" height="' + px + '" style="height:' + px + 'px;font-size:0;line-height:0;">&nbsp;</td></tr>\n';
  }

  // gapVis === 'mobile': invisible in Outlook and on desktop; revealed via @media.
  // If mobileGapOverride is set, use that height instead of px.
  var effectivePx = (mobileGapOverride !== null && mobileGapOverride !== undefined) ? mobileGapOverride : px;
  if (effectivePx <= 0) return ''; // override to 0 on a mobile-only gap — omit entirely
  var cls = 'gap-mb-' + effectivePx;
  if (!_mobileGapClassSeen[cls]) {
    _mobileGapClassSeen[cls] = true;
    _mobileCssRules.push('    .' + cls + ' { height:' + effectivePx + 'px !important; max-height:none !important; overflow:visible !important; }');
  }
  return ind(d) + '<!--[if !mso]><!-->\n' +
    ind(d) + '<tr><td class="' + cls + '" height="0" style="height:0;max-height:0;overflow:hidden;font-size:0;line-height:0;">&nbsp;</td></tr>\n' +
    ind(d) + '<!--<![endif]-->\n';
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

  // BG image: suppress fill so the bg-image wrapper in renderNode can show through
  var _sbSpCfg = parseNodeConfig(node);
  if (_sbSpCfg.bgImgOn && _sbSpCfg.bgImgSrc) { bg = null; }

  var bgS  = bg ? 'background-color:' + bg + ';' : '';
  var padS = padCSS(pad);

  // Mobile padding / alignment overrides for the outer wrapper of this frame.
  var sbMobCls = '';
  if (_sbSpCfg.mobileAlign) {
    var sbAlignCls = mobClass(node.id) + '-al';
    var _sbImgMargin = _sbSpCfg.mobileAlign === 'center' ? 'margin: 0 auto'
                     : _sbSpCfg.mobileAlign === 'right'  ? 'margin-left: auto; margin-right: 0'
                                                         : 'margin-right: auto; margin-left: 0';
    _mobileCssRules.push(
      '    .' + sbAlignCls + ',\n    .' + sbAlignCls + ' td { text-align: ' + _sbSpCfg.mobileAlign + ' !important; }\n' +
      '    .' + sbAlignCls + ' img { display: block !important; ' + _sbImgMargin + ' !important; }'
    );
    sbMobCls = sbAlignCls;
  }
  var sbHasMobPad = _sbSpCfg.mobilePadTop !== '' || _sbSpCfg.mobilePadRight !== '' || _sbSpCfg.mobilePadBottom !== '' || _sbSpCfg.mobilePadLeft !== '';
  if (sbHasMobPad) {
    var sbPadCls = mobClass(node.id) + '-pd';
    var smpt = _sbSpCfg.mobilePadTop    !== '' ? parseInt(_sbSpCfg.mobilePadTop,    10) : pad.t;
    var smpr = _sbSpCfg.mobilePadRight  !== '' ? parseInt(_sbSpCfg.mobilePadRight,  10) : pad.r;
    var smpb = _sbSpCfg.mobilePadBottom !== '' ? parseInt(_sbSpCfg.mobilePadBottom, 10) : pad.b;
    var smpl = _sbSpCfg.mobilePadLeft   !== '' ? parseInt(_sbSpCfg.mobilePadLeft,   10) : pad.l;
    _mobileCssRules.push('    .' + sbPadCls + ' { padding: ' + smpt + 'px ' + smpr + 'px ' + smpb + 'px ' + smpl + 'px !important; }');
    sbMobCls = sbMobCls ? sbMobCls + ' ' + sbPadCls : sbPadCls;
  }

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
    var sbTdClasses = [];
    if (kids.length > 2 && kidIsFill && kidW) sbTdClasses.push('fill-col');
    // Column visibility conditioning — same logic as regular horizontal layout.
    // Space-between has no gap TDs, but hidden columns still claim their declared
    // width, so we must collapse them to 0 on the device where they are hidden.
    var sbKidVis = getTag(kid.name || '', 'visibility') || '';
    if (sbKidVis === 'desktop') {
      sbTdClasses.push('col-dt-hide');
    } else if (sbKidVis === 'mobile') {
      var _sbColMbCls = mobClass(kid.id) + '-col';
      var _sbColMbW   = kidW > 0 ? kidW : Math.round(kid.width);
      _mobileCssRules.push('    .' + _sbColMbCls + ' { width:' + _sbColMbW + 'px !important; max-width:' + _sbColMbW + 'px !important; overflow:visible !important; }');
      sbTdClasses.push(_sbColMbCls);
      tdWAttr = ' width="0"';
      tdWSty  = 'width:0;max-width:0;overflow:hidden;padding:0;font-size:0;line-height:0;mso-hide:all;';
    }
    var sbFillClass = sbTdClasses.length ? ' class="' + sbTdClasses.join(' ') + '"' : '';
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
    block = roundedWrapper(bgS, padS, rad, innerTbl, d, insideRounded, sbMobCls, nodeW, Math.round(node.height));
  } else if (rad.any && stroke) {
    var sbRSMobCls = sbMobCls ? ' class="' + sbMobCls + '"' : '';
    var radContent = (bgS || padS)
      ? ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' + outerWAttr + ' style="' + outerWSty + '">\n' +
        ind(d+1) + '<tr><td' + sbRSMobCls + (bg ? ' bgcolor="' + bg + '"' : '') + (outerStyle ? ' style="' + outerStyle + '"' : '') + '>\n' +
        innerTbl + '\n' +
        ind(d+1) + '</td></tr>\n' +
        ind(d) + '</table>'
      : innerTbl;
    block = borderWrapper(stroke, radContent, d, useFixedW ? nodeW : 0, rad);
  } else if (outerStyle || sbMobCls) {
    var sbOuterTdCls = sbMobCls ? ' class="' + sbMobCls + '"' : '';
    block = ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' + outerWAttr + ' style="' + outerWSty + '">\n' +
      ind(d+1) + '<tr><td' + sbOuterTdCls + (bg ? ' bgcolor="' + bg + '"' : '') + (outerStyle ? ' style="' + outerStyle + '"' : '') + '>\n' +
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

  // BG image: suppress the node's own solid fill from inner rendering.
  // The outer renderNode wrapper will apply bg-image + fill-as-fallback on
  // its own <td>, so the inner tables must be transparent (no bgcolor) to
  // let the background image show through.
  if (cfg.bgImgOn && cfg.bgImgSrc) { bg = null; }

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

    // ALL-FILL mode: every child is FILL (no fixed-width children).
    // These layouts get two special treatments further below:
    //   1. fill-col class is emitted on every fill TD (not gated by omitTdW alone)
    //      so that the u+#body and @media .fill-col{width:auto} rules fire correctly.
    //   2. table-layout:fixed is added to the cells table so desktop email clients
    //      honour the declared pixel (fillShare) column widths and gap TDs receive
    //      their full pixel allocation. Without fixed layout, auto table layout either
    //      collapses gap TDs (old percentage approach: 50%+50%+gapPx > 100%) or lets
    //      min-content-width expand a column beyond its designed share (long nowrap
    //      text overriding the declared width). Both desktop bugs are fixed by fixed
    //      layout without harming Gmail iOS: fixed layout + u+#body fill-col:auto
    //      distributes auto-width columns equally after honouring gap TDs — exactly
    //      the correct equal-column semantic.
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

    // Pre-compute packed-content info for cell alignment.
    // A "packed-content" table is a fill-width parent whose children are all
    // fixed/hug (fillCount === 0). By Figma's layout semantics this is always
    // a compact group — if the designer wanted content to fill the row they
    // would have given a child FILL sizing or used SPACE_BETWEEN. We use this
    // flag solely to set each cell's alignment to packAlign (the frame's own
    // primary-axis pack direction: left/center/right) rather than to each
    // child's counterAxisAlignItems. This keeps cell alignment consistent with
    // the designed pack direction and avoids incorrect centering when a child
    // frame has counterAxisAlignItems=CENTER but the row packs to the left.
    var _hzCellsContentW = (fillCount === 0 && fixedTotal + totalSpacers > 0)
      ? (fixedTotal + totalSpacers) : 0;
    var _hzCellsPackAlign = node.primaryAxisAlignItems === 'CENTER' ? 'center'
                          : node.primaryAxisAlignItems === 'MAX'    ? 'right'
                          : 'left';
    var _isHzCellsTbl = isFill && !isMobileFluid && _hzCellsContentW > 0;

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
      // hz-cells alignment fix: for packed-content tables, override kidHAlign to
      // packAlign. This propagates into both the <td align="..."> attribute and,
      // via parentCellAlign → hzOuterAlign in renderNode, the child's inner wrapper
      // table — so all levels stay anchored when Gmail iOS expands the table to 100%.
      if (_isHzCellsTbl) { kidHAlign = _hzCellsPackAlign; }

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
      var kidWAttr, kidWStyle;
      if (omitTdW) {
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
      if (kidIsFillCol && !omitTdW) tdClasses.push('fill-col');
      if (kidIsHugTxt) tdClasses.push('nowrap-lbl');
      // Mobile stack-vertical: each content cell stacks as a block on mobile.
      if (cfg.mobileStack === 'vertical') tdClasses.push('stack-column');

      // ── Column visibility conditioning ─────────────────────────────────────
      // display:none on a <div> inside a <td> hides the content but the <td>
      // still occupies its declared column width in the table layout — email
      // clients do not collapse hidden <div> children to 0 column width.
      // We fix this at the <td> level:
      //
      //   visibility=desktop → add col-dt-hide; @media collapses width to 0
      //                        on mobile.  Outlook/desktop see the full width
      //                        via the unchanged width attribute (correct).
      //
      //   visibility=mobile  → override width to 0 + mso-hide:all so the
      //                        column takes no space by default (desktop +
      //                        Outlook).  A per-node @media rule restores the
      //                        correct pixel width on mobile.
      var kidVis = getTag(kid.name || '', 'visibility') || '';
      if (kidVis === 'desktop') {
        tdClasses.push('col-dt-hide');
      } else if (kidVis === 'mobile') {
        var _colMbCls = mobClass(kid.id) + '-col';
        var _colMbW   = kidW > 0 ? kidW : Math.round(kid.width);
        _mobileCssRules.push('    .' + _colMbCls + ' { width:' + _colMbW + 'px !important; max-width:' + _colMbW + 'px !important; overflow:visible !important; }');
        tdClasses.push(_colMbCls);
        // Override the width attributes so the column is invisible by default.
        // tdStyle is rebuilt here to incorporate the overridden kidWStyle.
        kidWAttr  = ' width="0"';
        kidWStyle = 'width:0;max-width:0;overflow:hidden;padding:0;font-size:0;line-height:0;mso-hide:all;';
        tdStyle   = kidWStyle + 'vertical-align:' + vAlign + ';text-align:' + kidHAlign + ';' + (kidIsHugTxt ? 'white-space:nowrap;' : '');
      }

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
          // Gap cell visibility: AND of current column's visibility and next
          // column's visibility — a gap only appears when both neighbours do.
          var _nextColVis  = getTag((kids[ci + 1].name || ''), 'visibility') || '';
          var _hzGapVis    = gapVisibility(kidVis, _nextColVis);
          // Mobile gap override: when set, replaces the desktop gap value on mobile.
          var _hzIsStacking = (cfg.mobileStack === 'vertical');
          var _hzMobGapPx   = cfg.mobileGap !== '' ? parseInt(cfg.mobileGap, 10) : null;

          if (_hzGapVis !== 'never') {
            // Base classes: stack-column carries over if mobileStack is set.
            var _hzGapClasses = _hzIsStacking ? ['stack-column'] : [];

            if (_hzGapVis === 'desktop') {
              // Desktop-only gap: .gap-dt collapses it on mobile. No mobile override needed.
              _hzGapClasses.push('gap-dt');
              var _hzGapDtCls = _hzGapClasses.length ? ' class="' + _hzGapClasses.join(' ') + '"' : '';
              cells += ind(d+2) + '<td' + _hzGapDtCls + ' width="' + gapW + '" style="width:' + gapW + 'px;font-size:0;line-height:0;">&nbsp;</td>\n';
            } else if (_hzGapVis === 'mobile') {
              // Mobile-only gap: hidden on desktop/Outlook, revealed via @media.
              // Use mobileGap override value if set.
              var _hzEffGapW = (_hzMobGapPx !== null) ? _hzMobGapPx : gapW;
              if (_hzEffGapW > 0) {
                var _hzGapMbCls;
                if (_hzIsStacking) {
                  // Stacking: gap TD is display:block — use height for vertical spacing.
                  _hzGapMbCls = 'gap-mb-stack-' + _hzEffGapW;
                  if (!_mobileGapClassSeen[_hzGapMbCls]) {
                    _mobileGapClassSeen[_hzGapMbCls] = true;
                    _mobileCssRules.push('    .' + _hzGapMbCls + ' { height:' + _hzEffGapW + 'px !important; min-height:' + _hzEffGapW + 'px !important; overflow:visible !important; font-size:0 !important; line-height:0 !important; }');
                  }
                } else {
                  // Not stacking: restore column gap width.
                  _hzGapMbCls = 'gap-mb-hz-' + _hzEffGapW;
                  if (!_mobileGapClassSeen[_hzGapMbCls]) {
                    _mobileGapClassSeen[_hzGapMbCls] = true;
                    _mobileCssRules.push('    .' + _hzGapMbCls + ' { width:' + _hzEffGapW + 'px !important; max-width:' + _hzEffGapW + 'px !important; overflow:visible !important; font-size:0 !important; line-height:0 !important; }');
                  }
                }
                _hzGapClasses.push(_hzGapMbCls);
                var _hzGapMbClsAttr = _hzGapClasses.length ? ' class="' + _hzGapClasses.join(' ') + '"' : '';
                cells += ind(d+2) + '<!--[if !mso]><!-->\n';
                cells += ind(d+2) + '<td' + _hzGapMbClsAttr + ' width="0" style="width:0;max-width:0;overflow:hidden;font-size:0;line-height:0;mso-hide:all;">&nbsp;</td>\n';
                cells += ind(d+2) + '<!--<![endif]-->\n';
              }
              // _hzEffGapW === 0 → gap overridden to nothing, emit nothing.
            } else {
              // 'always' — apply mobile override class if mobileGap differs from desktop gap.
              if (_hzMobGapPx !== null && _hzMobGapPx !== gapW) {
                if (_hzIsStacking) {
                  // On mobile, gap TD is display:block; override its height for vertical spacing.
                  var _hzSOvCls = 'gap-mob-stack-' + _hzMobGapPx;
                  if (!_mobileGapClassSeen[_hzSOvCls]) {
                    _mobileGapClassSeen[_hzSOvCls] = true;
                    if (_hzMobGapPx <= 0) {
                      _mobileCssRules.push('    .' + _hzSOvCls + ' { height:0 !important; min-height:0 !important; overflow:hidden !important; font-size:0 !important; line-height:0 !important; }');
                    } else {
                      _mobileCssRules.push('    .' + _hzSOvCls + ' { height:' + _hzMobGapPx + 'px !important; min-height:' + _hzMobGapPx + 'px !important; overflow:visible !important; }');
                    }
                  }
                  _hzGapClasses.push(_hzSOvCls);
                } else {
                  // Not stacking: override column gap width on mobile.
                  var _hzWOvCls = 'gap-mob-hz-' + _hzMobGapPx;
                  if (!_mobileGapClassSeen[_hzWOvCls]) {
                    _mobileGapClassSeen[_hzWOvCls] = true;
                    if (_hzMobGapPx <= 0) {
                      _mobileCssRules.push('    .' + _hzWOvCls + ' { width:0 !important; max-width:0 !important; overflow:hidden !important; font-size:0 !important; line-height:0 !important; }');
                    } else {
                      _mobileCssRules.push('    .' + _hzWOvCls + ' { width:' + _hzMobGapPx + 'px !important; max-width:' + _hzMobGapPx + 'px !important; overflow:visible !important; font-size:0 !important; line-height:0 !important; }');
                    }
                  }
                  _hzGapClasses.push(_hzWOvCls);
                }
              }
              var _hzGapAlwaysCls = _hzGapClasses.length ? ' class="' + _hzGapClasses.join(' ') + '"' : '';
              cells += ind(d+2) + '<td' + _hzGapAlwaysCls + ' width="' + gapW + '" style="width:' + gapW + 'px;font-size:0;line-height:0;">&nbsp;</td>\n';
            }
          }
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
    // ALL-FILL layouts: add table-layout:fixed so desktop email clients honour
    // the declared pixel column widths (fillShare) and gap TDs get their pixel
    // allocation. Without this, auto table layout either collapses gap TDs
    // (when percentage widths claimed 100%) or lets min-content-width override
    // column widths (when long nowrap text forces a column wider than designed).
    // With table-layout:fixed, the u+#body .fill-col{width:auto} rule still
    // achieves equal distribution on Gmail iOS because fixed layout distributes
    // auto-width columns equally after honoring explicit-width columns (gap TDs).
    if (allFillPctMode) tblWSty += 'table-layout:fixed;';

    // hz-cells was previously used to force packed-content tables to width:100%
    // in Gmail iOS (via a u+#body CSS rule) to eliminate scaled-in side margins.
    // It has been removed because:
    // 1. Semantics: a fill-width parent with all-fixed/hug children is always a
    //    compact group by Figma's own layout model. The u+#body expansion was
    //    only ever correct for the edge case of a wide banner whose fill-width
    //    child was mis-classified as fixed — a fill-detection failure, not a
    //    feature. The correct remedy for that edge case is accurate fill
    //    detection, not a broad CSS expansion.
    // 2. Harm: when the rule fires on any compact group that has gap/spacer TDs
    //    (stats rows, author rows, social-icon clusters), those spacers absorb
    //    all the extra space (often 400px+) because auto table-layout treats
    //    content-free TDs as elastic. This completely breaks the layout on every
    //    client where u+#body is active — far worse than the original artifact.
    // 3. Asymmetry: a false positive (class applied to compact group) breaks the
    //    layout everywhere; a false negative (class absent from a near-full-width
    //    banner) shows a subtle scaled-in margin on Gmail iOS only. The risk is
    //    one-sided and clearly favours never emitting the class.
    var isPackedContentTbl = false;
    var tblClassAttr = '';

    // ── Mobile overrides: alignment + padding ─────────────────
    var hzMobCls = '';  // class added to outer wrapper <td> for mobile pad
    if (cfg.mobileAlign) {
      var hzAlignCls = mobClass(node.id) + '-al';
      var _hzImgMargin = cfg.mobileAlign === 'center' ? 'margin: 0 auto'
                       : cfg.mobileAlign === 'right'  ? 'margin-left: auto; margin-right: 0'
                                                      : 'margin-right: auto; margin-left: 0';
      _mobileCssRules.push(
        '    .' + hzAlignCls + ',\n    .' + hzAlignCls + ' td { text-align: ' + cfg.mobileAlign + ' !important; }\n' +
        '    .' + hzAlignCls + ' img { display: block !important; ' + _hzImgMargin + ' !important; }'
      );
      tblClassAttr = ' class="' + hzAlignCls + '"';
    }
    var hasMobPad = cfg.mobilePadTop !== '' || cfg.mobilePadRight !== '' || cfg.mobilePadBottom !== '' || cfg.mobilePadLeft !== '';
    if (hasMobPad) {
      hzMobCls = mobClass(node.id) + '-pd';
      var mpt = cfg.mobilePadTop    !== '' ? parseInt(cfg.mobilePadTop,    10) : pad.t;
      var mpr = cfg.mobilePadRight  !== '' ? parseInt(cfg.mobilePadRight,  10) : pad.r;
      var mpb = cfg.mobilePadBottom !== '' ? parseInt(cfg.mobilePadBottom, 10) : pad.b;
      var mpl = cfg.mobilePadLeft   !== '' ? parseInt(cfg.mobilePadLeft,   10) : pad.l;
      _mobileCssRules.push('    .' + hzMobCls + ' { padding: ' + mpt + 'px ' + mpr + 'px ' + mpb + 'px ' + mpl + 'px !important; }');
    }

    var tblW       = useFixedW ? nodeW : null;
    var outerWAttr = tblW ? ' width="' + tblW + '" align="' + hzOuterAlign + '"' : ' width="100%"';
    var outerWSty  = tblW ? 'width:' + tblW + 'px;max-width:' + tblW + 'px;' + hzMargin : 'width:100%';

    // The cells table already carries a width="N" attribute (via tblWAttr) that
    // Outlook reads directly. An additional <!--[if mso]><table><tr><![endif]-->
    // wrapper would place a <table> as a direct child of <tr> without <td> —
    // invalid HTML that Outlook fixes by auto-inserting an anonymous <td>,
    // producing an undocumented extra nesting layer. Removed.
    var innerTbl = ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' + tblWAttr + tblClassAttr + ' style="' + tblWSty + '">\n' +
      ind(d+1) + '<tr>\n' +
      cells +
      ind(d+1) + '</tr>\n' +
      ind(d) + '</table>';

    // HREF: wrap the inner content in <a>, NOT the outer table.
    // Gmail iOS doesn't reliably honour display:block on <a> tags wrapping tables,
    // causing the <a> to shrink-wrap to content width instead of filling 100%.
    // By placing the <a> inside the <td>, it inherits the td's width naturally.
    if (cfg.href) {
      innerTbl = ind(d) + '<a href="' + escapeUrl(cfg.href) + '" target="_blank" style="display:block;text-decoration:none;">\n' +
        innerTbl + '\n' + ind(d) + '</a>';
    }

    var tbl;
    if (rad.any && !stroke) {
      tbl = roundedWrapper(bgS, padS, rad, innerTbl, d, insideRounded, hzMobCls, nodeW, Math.round(node.height));
    } else if (rad.any && stroke) {
      // hzMobCls carries mobile padding/alignment overrides for this frame.
      // Apply it to the inner <td> that holds the background + padding so that
      // the @media rule can override it on mobile (same as the plain else branch).
      var hzRSMobCls = hzMobCls ? ' class="' + hzMobCls + '"' : '';
      var radPadContent = (bgS || padS)
        ? ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' + outerWAttr + ' style="' + outerWSty + '">\n' +
          ind(d+1) + '<tr><td' + hzRSMobCls + (bg ? ' bgcolor="' + bg + '"' : '') + (bgS || padS ? ' style="' + bgS + padS + '"' : '') + '>\n' +
          innerTbl + '\n' +
          ind(d+1) + '</td></tr>\n' +
          ind(d) + '</table>'
        : innerTbl;
      tbl = borderWrapper(stroke, radPadContent, d, useFixedW ? nodeW : 0, rad);
    } else if (outerTdStyle || hzMobCls) {
      var hzOuterTdClass = hzMobCls ? ' class="' + hzMobCls + '"' : '';
      tbl = ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' + outerWAttr + ' style="' + outerWSty + '">\n' +
        ind(d+1) + '<tr><td' + hzOuterTdClass + (bg ? ' bgcolor="' + bg + '"' : '') + (outerTdStyle ? ' style="' + outerTdStyle + '"' : '') + '>\n' +
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
    if (!rowHtml) {
      // Spacer pattern: a childless frame or rectangle with a positive Figma
      // height acts as an explicit vertical spacer. Currently such nodes return
      // '' and are silently skipped (along with their gap row). Instead, emit a
      // plain spacer <tr> using the node's pixel height so designers can pad
      // content to a target height — e.g. making two sibling card tiles equal
      // height — without adding visible content.
      var _spacerH = 0;
      var _t = rowKid.type;
      if (_t === 'FRAME' || _t === 'COMPONENT' || _t === 'INSTANCE' || _t === 'RECTANGLE') {
        var _hasKids = rowKid.children && rowKid.children.length > 0;
        if (!_hasKids) _spacerH = Math.round(rowKid.height) || 0;
      }
      if (_spacerH > 0) {
        rows += emitVerticalGap(_spacerH, 'always', d+1, null);
      }
      continue;
    }

    // When a child has a visibility tag its shell <td> can contribute phantom
    // height even after the inner div collapses to 0 — some clients add a
    // residual line-height to any <td> that is non-empty in the DOM.
    // font-size:0;line-height:0; on the shell <td> eliminates that sliver.
    var _rowTdExtra = rowCfg.visibility ? 'font-size:0;line-height:0;' : '';
    rows += ind(d+1) + '<tr>\n' +
      ind(d+2) + '<td align="' + rowAlign + '" style="text-align:' + rowAlign + ';' + _rowTdExtra + '">\n' +
      rowHtml + '\n' +
      ind(d+2) + '</td>\n' +
      ind(d+1) + '</tr>\n';

    // Trailing-newline spacer: renderText strips trailing <br> tags for
    // consistent cross-client rendering. Emit an explicit spacer row here for
    // each trailing \n so the vertical space matches the Figma text node height.
    if (rowKid.type === 'TEXT' && rowKid.characters) {
      var _tnChars = rowKid.characters;
      var _tnCount = 0;
      var _tnIdx   = _tnChars.length - 1;
      while (_tnIdx >= 0 && _tnChars[_tnIdx] === '\n') { _tnCount++; _tnIdx--; }
      if (_tnCount > 0) {
        var _tnLh = rowKid.lineHeight;
        var _tnFs = typeof rowKid.fontSize === 'number' ? rowKid.fontSize : 14;
        var _tnLineH;
        if (_tnLh && _tnLh !== figma.mixed && _tnLh.unit === 'PIXELS') {
          _tnLineH = Math.round(_tnLh.value);
        } else if (_tnLh && _tnLh !== figma.mixed && _tnLh.unit === 'PERCENT') {
          _tnLineH = Math.round(_tnFs * _tnLh.value / 100);
        } else {
          _tnLineH = Math.round(_tnFs * 1.5);
        }
        var _tnSpacerPx = _tnCount * _tnLineH;
        if (_tnSpacerPx > 0) rows += emitVerticalGap(_tnSpacerPx, 'always', d+1, null);
      }
    }

    if (g > 0 && ri < kids.length - 1) {
      // A gap is only rendered on a device when BOTH the child that precedes it
      // AND the child that follows it are visible on that device. Look ahead to
      // kids[ri+1] (safe: ri < kids.length-1 is already checked above) and
      // compute the gap's effective visibility via gapVisibility().
      var _nextChildVis = getTag((kids[ri + 1].name || ''), 'visibility') || '';
      var _rowGapVis    = gapVisibility(rowCfg.visibility, _nextChildVis);
      var _vtMobGapOv   = cfg.mobileGap !== '' ? parseInt(cfg.mobileGap, 10) : null;
      rows += emitVerticalGap(g, _rowGapVis, d+1, _vtMobGapOv);
    }
  }

  // ── Vertical frame mobile overrides: alignment + padding ──
  var vtMobCls = '';
  if (cfg.mobileAlign) {
    var vtAlignCls = mobClass(node.id) + '-al';
    var _vtImgMargin = cfg.mobileAlign === 'center' ? 'margin: 0 auto'
                     : cfg.mobileAlign === 'right'  ? 'margin-left: auto; margin-right: 0'
                                                    : 'margin-right: auto; margin-left: 0';
    _mobileCssRules.push(
      '    .' + vtAlignCls + ',\n    .' + vtAlignCls + ' td { text-align: ' + cfg.mobileAlign + ' !important; }\n' +
      '    .' + vtAlignCls + ' img { display: block !important; ' + _vtImgMargin + ' !important; }'
    );
    vtMobCls = vtAlignCls;
  }
  var vtHasMobPad = cfg.mobilePadTop !== '' || cfg.mobilePadRight !== '' || cfg.mobilePadBottom !== '' || cfg.mobilePadLeft !== '';
  if (vtHasMobPad) {
    var vtPadCls = mobClass(node.id) + '-pd';
    var vmpt = cfg.mobilePadTop    !== '' ? parseInt(cfg.mobilePadTop,    10) : pad.t;
    var vmpr = cfg.mobilePadRight  !== '' ? parseInt(cfg.mobilePadRight,  10) : pad.r;
    var vmpb = cfg.mobilePadBottom !== '' ? parseInt(cfg.mobilePadBottom, 10) : pad.b;
    var vmpl = cfg.mobilePadLeft   !== '' ? parseInt(cfg.mobilePadLeft,   10) : pad.l;
    _mobileCssRules.push('    .' + vtPadCls + ' { padding: ' + vmpt + 'px ' + vmpr + 'px ' + vmpb + 'px ' + vmpl + 'px !important; }');
    vtMobCls = vtMobCls ? vtMobCls + ' ' + vtPadCls : vtPadCls;
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
    innerTable = ind(d+3) + '<a href="' + escapeUrl(cfg.href) + '" target="_blank" style="display:block;text-decoration:none;">\n' +
      innerTable + '\n' + ind(d+3) + '</a>';
  }

  var block;
  if (rad.any && !stroke) {
    var wrappedRadius = roundedWrapper(bgStr, padStr, rad, innerTable, d+2, insideRounded, vtMobCls, nodeW, Math.round(node.height));
    block = ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' + tblWAttr2 + ' style="' + tblWSty2 + '">\n' +
      ind(d+1) + '<tr>\n' +
      ind(d+2) + '<td align="' + childAlign + '">\n' +
      wrappedRadius + '\n' +
      ind(d+2) + '</td>\n' +
      ind(d+1) + '</tr>\n' +
      ind(d) + '</table>';
  } else if (rad.any && stroke) {
    // vtMobCls carries mobile padding/alignment overrides for this frame.
    // Apply it to the inner <td> that holds the background + padding so that
    // the @media rule can override it on mobile (same as the plain else branch).
    var vtRSMobCls = vtMobCls ? ' class="' + vtMobCls + '"' : '';
    var radPadContent2 = (bgStr || padStr)
      ? ind(d+2) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%">\n' +
        ind(d+3) + '<tr><td' + vtRSMobCls + ' align="' + childAlign + '"' + (bg ? ' bgcolor="' + bg + '"' : '') + (bgStr || padStr ? ' style="' + bgStr + padStr + '"' : '') + '>\n' +
        innerTable + '\n' +
        ind(d+3) + '</td></tr>\n' +
        ind(d+2) + '</table>'
      : innerTable;
    block = borderWrapper(stroke, radPadContent2, d, useFixedW ? nodeW : 0, rad);
  } else {
    var outerTdStyle2 = bgStr + padStr;
    var vtOuterTdClass = vtMobCls ? ' class="' + vtMobCls + '"' : '';
    block = ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' + tblWAttr2 + ' style="' + tblWSty2 + '">\n' +
      ind(d+1) + '<tr>\n' +
      ind(d+2) + '<td' + vtOuterTdClass + ' align="' + childAlign + '"' +
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

  // ── BG image wrapper ─────────────────────────────────────────
  // Applies to section/template frames that have bgImgOn enabled and a valid
  // bgImgSrc URL.  Must run BEFORE comment/visibility wrapping so those can
  // enclose the complete visual block (including the bg-image table).
  //
  // The inner rendering already suppressed bg (fill) so inner tables are
  // transparent.  Here we:
  //   • Retrieve the Figma fill to use as a bgcolor FALLBACK (clients with no
  //     background-image support will show the fill colour instead).
  //   • Wrap the inner HTML in a new table whose <td> carries both the
  //     background="URL" attribute (basic Outlook support) and the CSS
  //     background-image / background-size / background-position / background-repeat
  //     properties (modern clients).
  //   • This does NOT apply to image, button, or divider frame types, nor to
  //     nodes that are themselves rendered as flat <img> tags.
  // 'template' is intentionally excluded: template bg images are applied
  // directly to the .email-container table inside generateEmailHtml /
  // generateBreakpointEmailHtml, not via renderNode.
  var _bgImgFrameTypes = { '': true, 'section': true };
  if (cfg.bgImgOn && cfg.bgImgSrc &&
      _bgImgFrameTypes[cfg.frameType || ''] &&
      !isImgNode(node)) {
    var _bgFill    = getSolidFill(node) || '#ffffff';
    var _bgSrcEsc  = escapeUrl(cfg.bgImgSrc);
    var _bgNodeW   = Math.round(node.width);
    // In mobile-fluid mode, wide sections should stretch to 100% so the bg
    // image also fills the screen edge-to-edge on narrow phones.
    var _bgIsMob   = _mobileMode && _bgNodeW >= (_mobileFrameW * 0.5);
    var _bgWAttr   = (_bgIsMob || !_bgNodeW)
      ? ' width="100%"'
      : (' width="100%" align="center"');
    var _bgWSty    = (_bgIsMob || !_bgNodeW)
      ? 'width:100%;'
      : ('width:100%;max-width:' + _bgNodeW + 'px;margin:0 auto;');
    // background-image CSS is rendered ON TOP of background-color in CSS layer order,
    // so the image is always visible in supporting clients; bgcolor is fallback.
    var _bgTdSty   = 'background-color:' + _bgFill + ';' +
      'background-image:url(\'' + _bgSrcEsc + '\');' +
      'background-size:cover;background-position:center top;background-repeat:no-repeat;';
    html =
      ind(d) + '<table cellpadding="0" cellspacing="0" border="0" role="presentation"' +
        _bgWAttr + ' style="' + _bgWSty + '">\n' +
      ind(d+1) + '<tr>\n' +
      ind(d+2) + '<td align="center"' +
        ' bgcolor="' + _bgFill + '"' +
        ' background="' + _bgSrcEsc + '"' +
        ' style="' + _bgTdSty + '">\n' +
      html + '\n' +
      ind(d+2) + '</td>\n' +
      ind(d+1) + '</tr>\n' +
      ind(d) + '</table>';
  }

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

// ── UTM helpers ───────────────────────────────────────────────
// buildUtmString — assembles a utm_* query string from parts.
// Returns '' when no parts are provided so callers can guard cheaply.
function buildUtmString(src, medium, campaign, content, term) {
  var parts = [];
  if (src)      parts.push('utm_source='   + encodeURIComponent(src));
  if (medium)   parts.push('utm_medium='   + encodeURIComponent(medium));
  if (campaign) parts.push('utm_campaign=' + encodeURIComponent(campaign));
  if (content)  parts.push('utm_content='  + encodeURIComponent(content));
  if (term)     parts.push('utm_term='     + encodeURIComponent(term));
  return parts.join('&');
}

// appendUtmToUrl — appends utmString to a single URL.
// Guards: skips empty URLs, anchor-only (#), non-http schemes
// (mailto:, tel: etc.), and URLs that already carry utm_ params.
function appendUtmToUrl(url, utmString) {
  if (!utmString || !url || url === '#') return url;
  if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0) return url;
  if (url.indexOf('utm_') !== -1) return url;
  return url + (url.indexOf('?') !== -1 ? '&' : '?') + utmString;
}

// appendUtmToHtml — post-processes a full HTML string and appends
// UTM params to every href="..." attribute that qualifies.
// Uses a simple regex over the final rendered string so no rendering
// logic needs to be changed.
function appendUtmToHtml(html, utmString) {
  if (!utmString) return html;
  return html.replace(/href="([^"]+)"/g, function(match, url) {
    return 'href="' + appendUtmToUrl(url, utmString) + '"';
  });
}

// ══════════════════════════════════════════════════════════════
// generateEmailHtml — builds complete HTML document
// ══════════════════════════════════════════════════════════════
function generateEmailHtml(tmpl, config) {
  _mobileCssRules     = []; // reset per-generation mobile rules
  _mobileGapClassSeen = {}; // reset dedup set for conditional gap/col CSS classes
  _blendUsed          = false; // reset per-generation blend flag
  var preheader   = config.preheader   || '';
  var headStart   = config.headStart   || '';
  var headEnd     = config.headEnd     || '';
  var bodyStart   = config.bodyStart   || '';
  var bodyEnd     = config.bodyEnd     || '';
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
  var tmplRad    = getCornerRadii(tmpl);
  var tmplCfg    = parseNodeConfig(tmpl);
  var tmplBgImg  = (tmplCfg.bgImgOn && tmplCfg.bgImgSrc) ? tmplCfg.bgImgSrc : null;

  // ── Section assembly: sibling tables vs single container ────
  // Sibling-table mode (BeeFree row pattern): each section becomes its own
  // root-level <table class="email-container">, stacked sequentially. Benefits:
  //   • Gmail's ~102KB clipping cuts cleanly BETWEEN tables instead of leaving
  //     one giant unclosed table (broken layout).
  //   • Outlook's tall-table rendering artifacts (~1790px page-break bug) are
  //     per-table — short individual section tables never trigger them.
  //   • A markup error in one section cannot cascade into the sections after it.
  // Fallback: when the template frame carries decorations that must wrap ALL
  // sections in one box — corner radius, border stroke, or a full-template
  // background image — the legacy single-container structure is kept so
  // clipping/border/bg behaviour is unchanged.
  var splitSections = !(tmplRad.any || tmplStroke || tmplBgImg);

  var rows          = '';
  var sectionTables = '';
  var sections      = tmpl.children || [];
  for (var si = 0; si < sections.length; si++) {
    var sec = sections[si];
    if (!sec || sec.visible === false) continue;

    if (splitSections) {
      sectionTables +=
        '<table role="presentation" cellspacing="0" cellpadding="0" border="0"\n' +
        '       class="email-container"\n' +
        '       align="center"\n' +
        '       width="' + emailWidth + '"\n' +
        '       bgcolor="' + tmplBg + '"\n' +
        '       style="width:100%;max-width:' + emailWidth + 'px;margin:0 auto;' +
        'background-color:' + tmplBg + ';border-collapse:collapse;">\n' +
        ind(1) + '<tr>\n' +
        ind(2) + '<td align="center">\n' +
        renderNode(sec, 3) + '\n' +
        ind(2) + '</td>\n' +
        ind(1) + '</tr>\n' +
        '</table>\n';
    } else {
      rows +=
        ind(3) + '<tr>\n' +
        ind(4) + '<td align="center">\n' +
        renderNode(sec, 5) + '\n' +
        ind(4) + '</td>\n' +
        ind(3) + '</tr>\n';
    }
  }

  // When the template frame has corner radii, wrap all rows in a single clipping
  // <td> so inner content is clipped to the rounded corners (mirrors breakpoint mode).
  // (Only reachable in single-container mode — splitSections is false when radii exist.)
  if (!splitSections && tmplRad.any) {
    rows = ind(1) + '<tr>\n' +
      ind(2) + '<td style="padding:0;' + tmplRad.css + 'overflow:hidden;">\n' +
      ind(2) + '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">\n' +
      rows +
      ind(2) + '</table>\n' +
      ind(2) + '</td>\n' +
      ind(1) + '</tr>\n';
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

  // Container markup: stacked sibling section tables (sibling mode) or the
  // legacy single wrapper table (fallback for radius / stroke / bg-image).
  // width:100% + max-width:<emailWidth>px (instead of a fixed pixel width)
  // lets clients that strip <style> entirely shrink the email to the viewport
  // instead of forcing horizontal scroll; the MSO ghost table outside this
  // block still pins Outlook at exactly emailWidth.
  var containerHtml;
  if (splitSections) {
    containerHtml = sectionTables;
  } else {
    containerHtml =
      '<table role="presentation" cellspacing="0" cellpadding="0"\n' +
      '       class="email-container"\n' +
      '       width="' + emailWidth + '"\n' +
      '       bgcolor="' + tmplBg + '"\n' +
      (tmplBgImg ? '       background="' + escapeHtml(tmplBgImg) + '"\n' : '') +
      '       style="width:100%;max-width:' + emailWidth + 'px;' +
      'background-color:' + tmplBg + ';' +
      (tmplBgImg ? 'background-image:url(\'' + escapeHtml(tmplBgImg) + '\');background-size:cover;background-position:center top;background-repeat:no-repeat;' : '') +
      (tmplStroke || tmplRad.any ? 'border-collapse:separate;border-spacing:0;' + tmplRad.css + (tmplStroke ? tmplStroke.css : '') : 'border-collapse:collapse;') +
      '">\n' +
      rows +
      '</table>\n';
  }

  var _html = '<!DOCTYPE html>\n' +
'<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">\n' +
'<head>\n' +
(headStart ? headStart + '\n' : '') +
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
'  body, table, td, p, a, h1, h2, h3, h4, h5, h6 {\n' +
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
'  u + #body .email-container p img,\n' +
'  u + #body .email-container h1 img, u + #body .email-container h2 img,\n' +
'  u + #body .email-container h3 img, u + #body .email-container h4 img,\n' +
'  u + #body .email-container h5 img, u + #body .email-container h6 img {\n' +
'    display: inline !important;\n' +
'    vertical-align: middle !important;\n' +
'  }\n' +
'  body {\n' +
'    margin: 0 !important;\n' +
'    padding: 0 !important;\n' +
'    background-color: ' + bodyBg + ';\n' +
'    width: 100% !important;\n' +
'  }\n' +
'  h1, h2, h3, h4, h5, h6, p { margin: 0; padding: 0; }\n' +
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
'    .email-container p:not(.nowrap-lbl),\n' +
'    .email-container h1:not(.nowrap-lbl), .email-container h2:not(.nowrap-lbl),\n' +
'    .email-container h3:not(.nowrap-lbl), .email-container h4:not(.nowrap-lbl),\n' +
'    .email-container h5:not(.nowrap-lbl), .email-container h6:not(.nowrap-lbl) {\n' +
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
'    /* Visibility-conditioned gap rows/cells (.gap-dt) and columns (.col-dt-hide).\n' +
'       These are desktop-only elements that must take zero space on mobile.\n' +
'       height:0 + width:0 handles both vertical spacer rows and horizontal gap\n' +
'       cells from a single class. The height="N" / width="N" HTML attributes\n' +
'       are preserved so Outlook (which ignores the @media rule) still renders\n' +
'       the correct dimensions — which is exactly right for desktop-only content. */\n' +
'    .gap-dt {\n' +
'      height: 0 !important; max-height: 0 !important;\n' +
'      width: 0 !important;  max-width: 0 !important;\n' +
'      overflow: hidden !important;\n' +
'      padding: 0 !important;\n' +
'      font-size: 0 !important;\n' +
'      line-height: 0 !important;\n' +
'    }\n' +
'    .col-dt-hide {\n' +
'      width: 0 !important; max-width: 0 !important;\n' +
'      overflow: hidden !important;\n' +
'      padding: 0 !important;\n' +
'      font-size: 0 !important;\n' +
'      line-height: 0 !important;\n' +
'    }\n' +
'    /* Visibility — these rules live in the same @media block so they fire at\n' +
'       the same breakpoint as the container/layout rules above. Both used\n' +
'       (emailWidth-1)px, so merging them is safe and avoids the duplication. */\n' +
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
(headEnd ? headEnd + '\n' : '') +
'</head>\n' +
'<body id="body" bgcolor="' + bodyBg + '" style="margin:0;padding:0;background-color:' + bodyBg + ';">\n' +
(bodyStart ? bodyStart + '\n' : '') +
preheaderHtml +
'<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"\n' +
'       bgcolor="' + bodyBg + '" style="background-color:' + bodyBg + ';">\n' +
ind(1) + '<tr>\n' +
ind(2) + '<td align="center" valign="top" style="padding:0;">\n' +
'<!--[if mso]><table role="presentation" align="center" width="' + emailWidth + '" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->\n' +
containerHtml +
'<!--[if mso]></td></tr></table><![endif]-->\n' +
ind(2) + '</td>\n' +
ind(1) + '</tr>\n' +
'</table>\n' +
(bodyEnd ? bodyEnd + '\n' : '') +
'</body>\n' +
'</html>';
  // Inject per-node mobile override rules collected during rendering.
  if (_mobileCssRules.length > 0) {
    var _mobStyle = '<style type="text/css">\n@media only screen and (max-width: ' + (emailWidth - 1) + 'px) {\n' +
      _mobileCssRules.join('\n') + '\n}\n</style>\n';
    _html = _html.replace('</head>', _mobStyle + '</head>');
  }
  // Inject blend assets (class="body" + scoped rules) only if a blend layer fired.
  _html = injectBlendAssets(_html);
  var _utmStr = buildUtmString(utmSource, utmMedium, utmCampaign, utmContent, utmTerm);
  return appendUtmToHtml(_html, _utmStr);
}

// ══════════════════════════════════════════════════════════════
// generateBreakpointEmailHtml — two frames → one HTML document
// Desktop content visible by default; mobile content hidden by
// default and revealed via @media query on small screens.
// Outlook (no media-query support) always sees the desktop version.
// ══════════════════════════════════════════════════════════════
function generateBreakpointEmailHtml(desktopNode, mobileNode, config) {
  _mobileCssRules     = []; // reset per-generation mobile rules
  _mobileGapClassSeen = {}; // reset dedup set for conditional gap/col CSS classes
  _blendUsed          = false; // reset per-generation blend flag
  var preheader    = config.preheader   || '';
  var headStart    = config.headStart   || '';
  var headEnd      = config.headEnd     || '';
  var bodyStart    = config.bodyStart   || '';
  var bodyEnd      = config.bodyEnd     || '';
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
  var bpDesktopCfg  = parseNodeConfig(desktopNode);
  var bpMobileCfg   = parseNodeConfig(mobileNode);
  var bpDesktopBgImg = (bpDesktopCfg.bgImgOn && bpDesktopCfg.bgImgSrc) ? bpDesktopCfg.bgImgSrc : null;
  var bpMobileBgImg  = (bpMobileCfg.bgImgOn  && bpMobileCfg.bgImgSrc)  ? bpMobileCfg.bgImgSrc  : null;

  // Sibling-table mode (see single-frame mode comments): each section becomes
  // its own root-level table. Falls back to the legacy single container when
  // the frame carries whole-email decorations (radius / stroke / bg image).
  var splitDesktop = !(desktopRad.any || desktopStroke || bpDesktopBgImg);
  var splitMobile  = !(mobileRad.any  || mobileStroke  || bpMobileBgImg);

  // ── Build desktop rows ──────────────────────────────────────
  var desktopRows   = '';
  var desktopTables = '';
  var desktopSecs   = desktopNode.children || [];
  for (var di = 0; di < desktopSecs.length; di++) {
    var dsec = desktopSecs[di];
    if (!dsec || dsec.visible === false) continue;
    if (splitDesktop) {
      desktopTables +=
        '<table role="presentation" cellspacing="0" cellpadding="0" border="0"\n' +
        '       class="email-container"\n' +
        '       align="center"\n' +
        '       width="' + desktopWidth + '"\n' +
        '       bgcolor="' + desktopBg + '"\n' +
        '       style="width:100%;max-width:' + desktopWidth + 'px;margin:0 auto;' +
        'background-color:' + desktopBg + ';border-collapse:collapse;">\n' +
        ind(1) + '<tr>\n' +
        ind(2) + '<td align="center">\n' +
        renderNode(dsec, 3) + '\n' +
        ind(2) + '</td>\n' +
        ind(1) + '</tr>\n' +
        '</table>\n';
    } else {
      desktopRows +=
        ind(3) + '<tr>\n' +
        ind(4) + '<td align="center">\n' +
        renderNode(dsec, 5) + '\n' +
        ind(4) + '</td>\n' +
        ind(3) + '</tr>\n';
    }
  }

  // ── Build mobile rows ───────────────────────────────────────
  // Enable mobile fluid mode: tables >= 50% of mobile frame width
  // render as width:100% instead of fixed px, so all container tables
  // adapt to the device screen width (critical for Gmail on narrow phones).
  var mobileRows   = '';
  var mobileTables = '';
  var mobileSecs   = mobileNode.children || [];
  _mobileMode   = true;
  _mobileFrameW = mobileWidth;
  for (var mi = 0; mi < mobileSecs.length; mi++) {
    var msec = mobileSecs[mi];
    if (!msec || msec.visible === false) continue;
    if (splitMobile) {
      mobileTables +=
        '<table role="presentation" cellspacing="0" cellpadding="0" border="0"\n' +
        '       class="email-container"\n' +
        '       align="center"\n' +
        '       width="100%"\n' +
        '       bgcolor="' + mobileBg + '"\n' +
        '       style="width:100%;max-width:100%;margin:0 auto;' +
        'background-color:' + mobileBg + ';border-collapse:collapse;">\n' +
        ind(1) + '<tr>\n' +
        ind(2) + '<td align="center">\n' +
        renderNode(msec, 3) + '\n' +
        ind(2) + '</td>\n' +
        ind(1) + '</tr>\n' +
        '</table>\n';
    } else {
      mobileRows +=
        ind(3) + '<tr>\n' +
        ind(4) + '<td align="center">\n' +
        renderNode(msec, 5) + '\n' +
        ind(4) + '</td>\n' +
        ind(3) + '</tr>\n';
    }
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
  var desktopTable = splitDesktop
    ? desktopTables
    : '<table role="presentation" cellspacing="0" cellpadding="0" border="0"\n' +
    '       class="email-container"\n' +
    '       width="' + desktopWidth + '"\n' +
    '       bgcolor="' + desktopBg + '"\n' +
    (bpDesktopBgImg ? '       background="' + escapeHtml(bpDesktopBgImg) + '"\n' : '') +
    '       style="width:100%;max-width:' + desktopWidth + 'px;' +
    'background-color:' + desktopBg + ';' +
    (bpDesktopBgImg ? 'background-image:url(\'' + escapeHtml(bpDesktopBgImg) + '\');background-size:cover;background-position:center top;background-repeat:no-repeat;' : '') +
    desktopCollapse +
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
  var mobileTable = splitMobile
    ? mobileTables
    : '<table role="presentation" cellspacing="0" cellpadding="0" border="0"\n' +
    '       class="email-container"\n' +
    '       align="center"\n' +
    '       width="100%"\n' +
    '       bgcolor="' + mobileBg + '"\n' +
    (bpMobileBgImg ? '       background="' + escapeHtml(bpMobileBgImg) + '"\n' : '') +
    '       style="width:100%;max-width:100%;margin:0 auto;' +
    'background-color:' + mobileBg + ';' +
    (bpMobileBgImg ? 'background-image:url(\'' + escapeHtml(bpMobileBgImg) + '\');background-size:cover;background-position:center top;background-repeat:no-repeat;' : '') +
    mobileCollapse +
    '">\n' +
    mobileInnerRows +
    '</table>';

  var bpUtmMetaTags =
    (utmSource   ? '<meta name="utm-source"   content="' + escapeHtml(utmSource)   + '">\n' : '') +
    (utmMedium   ? '<meta name="utm-medium"   content="' + escapeHtml(utmMedium)   + '">\n' : '') +
    (utmCampaign ? '<meta name="utm-campaign" content="' + escapeHtml(utmCampaign) + '">\n' : '') +
    (utmContent  ? '<meta name="utm-content"  content="' + escapeHtml(utmContent)  + '">\n' : '') +
    (utmTerm     ? '<meta name="utm-term"     content="' + escapeHtml(utmTerm)     + '">\n' : '');

  var _bpHtml = '<!DOCTYPE html>\n' +
'<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">\n' +
'<head>\n' +
(headStart ? headStart + '\n' : '') +
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
'  body, table, td, p, a, h1, h2, h3, h4, h5, h6 {\n' +
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
'  u + #body .email-container p img,\n' +
'  u + #body .email-container h1 img, u + #body .email-container h2 img,\n' +
'  u + #body .email-container h3 img, u + #body .email-container h4 img,\n' +
'  u + #body .email-container h5 img, u + #body .email-container h6 img {\n' +
'    display: inline !important;\n' +
'    vertical-align: middle !important;\n' +
'  }\n' +
'  body {\n' +
'    margin: 0 !important;\n' +
'    padding: 0 !important;\n' +
'    background-color: ' + bodyBg + ';\n' +
'    width: 100% !important;\n' +
'  }\n' +
'  h1, h2, h3, h4, h5, h6, p { margin: 0; padding: 0; }\n' +
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
'    .for-mobile p:not(.nowrap-lbl),\n' +
'    .for-mobile h1:not(.nowrap-lbl), .for-mobile h2:not(.nowrap-lbl),\n' +
'    .for-mobile h3:not(.nowrap-lbl), .for-mobile h4:not(.nowrap-lbl),\n' +
'    .for-mobile h5:not(.nowrap-lbl), .for-mobile h6:not(.nowrap-lbl) {\n' +
'      white-space: normal !important;\n' +
'    }\n' +
'    /* FILL columns absorb remaining space after fixed columns take their share.\n' +
'       With table-layout:fixed, width:auto means "take what is left" — exactly\n' +
'       the same semantic as Figma\'s FILL sizing. */\n' +
'    .for-mobile .fill-col {\n' +
'      width: auto !important;\n' +
'      min-width: 0 !important;\n' +
'    }\n' +
'    /* Visibility-conditioned gap rows/cells and columns — same semantics as\n' +
'       single-frame mode. See the single-frame @media block for full comments. */\n' +
'    .gap-dt {\n' +
'      height: 0 !important; max-height: 0 !important;\n' +
'      width: 0 !important;  max-width: 0 !important;\n' +
'      overflow: hidden !important;\n' +
'      padding: 0 !important;\n' +
'      font-size: 0 !important;\n' +
'      line-height: 0 !important;\n' +
'    }\n' +
'    .col-dt-hide {\n' +
'      width: 0 !important; max-width: 0 !important;\n' +
'      overflow: hidden !important;\n' +
'      padding: 0 !important;\n' +
'      font-size: 0 !important;\n' +
'      line-height: 0 !important;\n' +
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
(headEnd ? headEnd + '\n' : '') +
'</head>\n' +
'<body id="body" bgcolor="' + bodyBg + '" style="margin:0;padding:0;background-color:' + bodyBg + ';">\n' +
(bodyStart ? bodyStart + '\n' : '') +
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
(bodyEnd ? bodyEnd + '\n' : '') +
'</body>\n' +
'</html>';
  // Inject per-node mobile override rules collected during rendering.
  if (_mobileCssRules.length > 0) {
    var _bpMobStyle = '<style type="text/css">\n@media only screen and (max-width: ' + (desktopWidth - 1) + 'px) {\n' +
      _mobileCssRules.join('\n') + '\n}\n</style>\n';
    _bpHtml = _bpHtml.replace('</head>', _bpMobStyle + '</head>');
  }
  // Inject blend assets (class="body" + scoped rules) only if a blend layer fired.
  _bpHtml = injectBlendAssets(_bpHtml);
  var _bpUtmStr = buildUtmString(utmSource, utmMedium, utmCampaign, utmContent, utmTerm);
  return appendUtmToHtml(_bpHtml, _bpUtmStr);
}

// ══════════════════════════════════════════════════════════════
// Issues scanner
// ══════════════════════════════════════════════════════════════

var _SAFE_FONTS = [
  'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Verdana',
  'Trebuchet MS', 'Courier New', 'Tahoma', 'Courier', 'Palatino',
  'Garamond', 'Bookman', 'Arial Black', 'Impact',
  'Lucida Console', 'Lucida Sans Unicode', 'Comic Sans MS',
];

function _isSafeFont(family) {
  var f = (family || '').toLowerCase();
  for (var i = 0; i < _SAFE_FONTS.length; i++) {
    if (_SAFE_FONTS[i].toLowerCase() === f) return true;
  }
  return false;
}

function scanForIssues(templateNode) {
  var issues = [];
  var _seenFonts = {}; // deduplicate per font family

  function push(severity, id, title, desc, node, fieldId) {
    issues.push({
      severity: severity,
      id:       id,
      title:    title,
      desc:     desc,
      nodeId:   node ? node.id                  : null,
      nodeName: node ? (node.name || 'Unnamed') : null,
      fieldId:  fieldId || null,
    });
  }

  // ── Template-level checks ─────────────────────────────────
  var tw = Math.round(templateNode.width);
  if (tw > 600) {
    push('minor', 'tmpl-wide',
      'Template width exceeds 600px',
      'Most email clients cap content at 600px. Templates wider than this may cause horizontal scrolling.',
      templateNode);
  }
  if (tw < 320) {
    push('minor', 'tmpl-narrow',
      'Template width is below 320px',
      '320px is the smallest common mobile viewport. Templates narrower than this may appear clipped or compressed on phones.',
      templateNode);
  }

  // ── Recursive tree walk ───────────────────────────────────
  function walk(node, depth, parentInnerW, parentLayoutMode) {
    if (!node || node.visible === false) return;
    var cfg = parseNodeConfig(node);
    var t   = node.type;

    // Href validity — applies to every node type
    if (cfg.href && cfg.href.indexOf('http') !== 0) {
      var _hrefField = cfg.frameType === 'button' ? 'inp-btn-link'
                     : cfg.frameType === 'image'  ? 'inp-img-href'
                     : 'inp-href';
      push('major', 'bad-href',
        'Hyperlink uses a relative URL',
        'URLs without https:// may not resolve correctly in some email clients.',
        node, _hrefField);
    }

    // If this node is tagged as an image frame, treat it as a leaf —
    // run only image-level checks and do not recurse into its children.
    if (cfg.frameType === 'image' || cfg.exportImg) {
      if (!cfg.src) {
        push('critical', 'img-no-src',
          'Image has no source URL',
          'The src attribute on this image is empty. Without a source URL, the image won\'t load.',
          node, 'inp-src');
      } else if (cfg.src.indexOf('http') !== 0) {
        push('major', 'img-relative-url',
          'Image source URL uses a relative URL',
          'URLs without https:// may not resolve correctly in some email clients.',
          node, 'inp-src');
      }
      if (!cfg.alt) {
        push('minor', 'img-no-alt',
          'Image is missing alt text',
          'Set alt text in the plugin so readers see a description if images are blocked or fail to load.',
          node, 'inp-alt');
      }
      return; // do not inspect children of an image frame
    }

    // 4 — Auto-layout OFF with multiple children
    if ((t === 'FRAME' || t === 'COMPONENT' || t === 'INSTANCE') &&
        node.layoutMode === 'NONE' && node.children && node.children.length > 1) {
      var visCount = 0;
      for (var vi = 0; vi < node.children.length; vi++) {
        if (node.children[vi].visible !== false) visCount++;
      }
      if (visCount > 1) {
        push('critical', 'no-autolayout',
          'Frame has no auto-layout',
          'The plugin will stack its children vertically in layer order, ignoring any positions, overlaps, or offsets.',
          node);
      }
    }

    // 10 — Horizontal children overflow parent
    if ((t === 'FRAME' || t === 'COMPONENT' || t === 'INSTANCE') &&
        node.layoutMode === 'HORIZONTAL' && node.children && node.children.length > 0) {
      var nodeW    = Math.round(node.width);
      var innerW   = nodeW - safeNum(node.paddingLeft, 0) - safeNum(node.paddingRight, 0);
      var spacing  = safeNum(node.itemSpacing, 0);
      var fixedSum = 0;
      var fixedCnt = 0;
      for (var ki = 0; ki < node.children.length; ki++) {
        var kc = node.children[ki];
        if (kc.visible === false) continue;
        var kFill = (kc.layoutGrow === 1) || (kc.layoutSizingHorizontal === 'FILL');
        if (!kFill) { fixedSum += Math.round(kc.width); fixedCnt++; }
      }
      var gapSum = fixedCnt > 1 ? spacing * (fixedCnt - 1) : 0;
      if (innerW > 0 && (fixedSum + gapSum) > innerW + 1) {
        push('major', 'hz-overflow',
          'Content overflows the frame by ' + ((fixedSum + gapSum) - innerW) + 'px',
          'Children (' + fixedSum + 'px) and gaps (' + gapSum + 'px) add up to ' + (fixedSum + gapSum) + 'px, but the frame\'s inner width is ' + innerW + 'px. Content will overflow.',
          node);
      }
    }

    // 11 — Critical: section-level frame spans template width but is not Fill.
    // On iPhone Gmail, u+#body expands .email-container to phone width, but any
    // child table with a fixed pixel width overflows the container. Because Gmail
    // iOS table rendering does not reliably honour max-width on table elements, the
    // container expands back to that fixed width — forcing every other section
    // (even those that ARE fill) to also render at desktop width. One non-fill
    // section breaks the whole email layout on iPhone Gmail.
    if (tw > 0 &&
        depth === 1 &&
        !cfg.rawCode &&
        (t === 'FRAME' || t === 'COMPONENT' || t === 'INSTANCE') &&
        cfg.frameType !== 'button' && cfg.frameType !== 'image' && cfg.frameType !== 'divider' &&
        !cfg.exportImg && !isImgNode(node)) {
      var _secW    = Math.round(node.width);
      var _secFill = (node.layoutGrow === 1) || (node.layoutSizingHorizontal === 'FILL');
      var _secHug  = (node.layoutSizingHorizontal === 'HUG');
      if (!_secFill && !_secHug && _secW >= tw - 1) {
        push('critical', 'fill-sect-' + node.id,
          'Section not set to Fill',
          'Full-width section is not set to Fill. On iPhone Gmail this causes the entire email to render at desktop width. Set horizontal sizing to Fill in Figma.',
          node);
      }
    }

    // 12 — Major: inner frame spans its parent's full inner width but is not Fill.
    // Same overflow mechanism as Check 11, but scoped to the containing section
    // rather than the entire email. Skipped for children of horizontal layouts
    // (those are intentional fixed-width columns).
    if (tw > 0 &&
        depth === 2 &&
        parentInnerW > 0 &&
        !cfg.rawCode &&
        (t === 'FRAME' || t === 'COMPONENT' || t === 'INSTANCE') &&
        cfg.frameType !== 'button' && cfg.frameType !== 'image' && cfg.frameType !== 'divider' &&
        !cfg.exportImg && !isImgNode(node) &&
        parentLayoutMode !== 'HORIZONTAL') {
      var _innerW    = Math.round(node.width);
      var _innerFill = (node.layoutGrow === 1) || (node.layoutSizingHorizontal === 'FILL');
      var _innerHug  = (node.layoutSizingHorizontal === 'HUG');
      if (!_innerFill && !_innerHug && _innerW >= parentInnerW - 1 && _innerW > tw * 0.5) {
        push('major', 'fill-inner-' + node.id,
          'Full-width frame not set to Fill',
          'This frame is ' + _innerW + 'px wide — matching its parent\'s inner width — but its horizontal sizing is not Fill. On iPhone Gmail it may overflow its container and break the section layout. Set horizontal sizing to Fill in Figma.',
          node);
      }
    }

    // 1, 2, 6 — Image checks (nodes that resolve as images but aren't #frameType:image)
    if (isImgNode(node)) {
      // Detect IMAGE fill with no explicit plugin tag — user needs to set frame type first
      var _hasImgFill = false;
      if (node.fills && node.fills !== figma.mixed) {
        for (var ifi = 0; ifi < node.fills.length; ifi++) {
          if (node.fills[ifi].type === 'IMAGE' && node.fills[ifi].visible !== false) {
            _hasImgFill = true; break;
          }
        }
      }
      if (_hasImgFill && !cfg.src) {
        push('critical', 'img-fill-needs-tag',
          'Image fill detected but frame type is not set to Image',
          'Change the frame type to Image so the plugin can export this layer correctly.',
          node, 'custom-sel-frame');
      } else {
        if (!cfg.src) {
          push('critical', 'img-no-src',
            'Image has no source URL',
            'The src attribute on this image is empty. Without a source URL, the image won\'t load.',
            node);
        } else if (cfg.src.indexOf('http') !== 0) {
          push('major', 'img-relative-url',
            'Image source URL uses a relative URL',
            'URLs without https:// may not resolve correctly in some email clients.',
            node);
        }
        if (!cfg.alt) {
          push('minor', 'img-no-alt',
            'Image is missing alt text',
            'Set alt text in the plugin so readers see a description if images are blocked or fail to load.',
            node);
        }
      }
    }

    // 7 — Vector/shape silently skipped
    var _skipTypes = ['VECTOR','STAR','POLYGON','ELLIPSE','LINE','BOOLEAN_OPERATION'];
    var _isSkip = false;
    for (var si = 0; si < _skipTypes.length; si++) {
      if (t === _skipTypes[si]) { _isSkip = true; break; }
    }
    if (_isSkip && !cfg.src && !cfg.exportImg) {
      push('major', 'vector-skipped',
        (t.charAt(0) + t.slice(1).toLowerCase()).replace('_', ' ') + ' is not supported in email',
        'This shape type has no HTML equivalent. You can export this layer as an image instead.',
        node);
    }

    // 3, 19 — Button checks
    if (cfg.frameType === 'button') {
      if (!cfg.href) {
        push('critical', 'btn-no-href',
          'Button has no link',
          'No destination URL is set on this button. It will appear in the email but won\'t be clickable.',
          node, 'inp-btn-link');
      }
      var btnText = null;
      if (node.findOne) btnText = node.findOne(function(n) { return n.type === 'TEXT' && n.visible !== false; });
      if (!btnText) {
        push('major', 'btn-no-text',
          'Button has no visible text',
          'No text layer found inside this button. The email will default to \'Click here\' as the button label.',
          node);
      }
    }

    // TEXT node checks (12, 13, 14, 15)
    if (t === 'TEXT') {
      // 12 — Non-web-safe font (deduplicated per font family)
      var family = (node.fontName && node.fontName !== figma.mixed) ? node.fontName.family : null;
      if (family && !_isSafeFont(family) && !_seenFonts[family]) {
        _seenFonts[family] = true;
        push('major', 'unsafe-font-' + family,
          'Non-web-safe font: ' + family,
          'This font may not render in all email clients and fall back to a system font.',
          node);
      }
      // 15 — Text node opacity
      if (typeof node.opacity === 'number' && node.opacity < 1) {
        push('minor', 'text-opacity',
          'Text layer has opacity set to ' + Math.round(node.opacity * 100) + '%',
          'Opacity on text isn\'t supported in most email clients. This text will appear fully opaque.',
          node);
      }
      return; // no children on TEXT
    }

    // 15 — Frame opacity
    if ((t === 'FRAME' || t === 'COMPONENT' || t === 'INSTANCE') &&
        typeof node.opacity === 'number' && node.opacity < 1) {
      push('minor', 'frame-opacity',
        'Section has opacity set to ' + Math.round(node.opacity * 100) + '%',
        'Opacity on sections isn\'t applied in email. This section will appear fully opaque.',
        node);
    }

    // 16, 17 — Fill checks
    if (node.fills && node.fills !== figma.mixed && node.fills.length > 0) {
      var visibleFills = [];
      for (var fi = 0; fi < node.fills.length; fi++) {
        if (node.fills[fi].visible !== false) visibleFills.push(node.fills[fi]);
      }
      if (visibleFills.length > 0) {
        var hasSolid    = false;
        var hasGradient = false;
        for (var fj = 0; fj < visibleFills.length; fj++) {
          var ft = visibleFills[fj].type;
          if (ft === 'SOLID') { hasSolid = true; }
          if (ft === 'GRADIENT_LINEAR' || ft === 'GRADIENT_RADIAL' ||
              ft === 'GRADIENT_ANGULAR' || ft === 'GRADIENT_DIAMOND') { hasGradient = true; }
          // IMAGE fills are handled by isImgNode() — not a gradient, skip
        }
        if (hasGradient && !hasSolid) {
          push('major', 'gradient-fill',
            'Gradient fill is not supported',
            'Gradient fills aren\'t rendered in email HTML. This layer\'s background will appear transparent.',
            node);
        }
        if (visibleFills.length > 1) {
          push('minor', 'multi-fill',
            'Multiple fill values detected',
            'Email only supports a single fill per layer. Only the topmost fill will render and the rest will be dropped.',
            node);
        }
      }
    }

    // 18 — Effects
    if (node.effects && node.effects !== figma.mixed && node.effects.length > 0) {
      var _effectLabels = { DROP_SHADOW: 'drop shadow', INNER_SHADOW: 'inner shadow', LAYER_BLUR: 'layer blur', BACKGROUND_BLUR: 'background blur' };
      var foundEffects = [];
      for (var ei = 0; ei < node.effects.length; ei++) {
        var eff = node.effects[ei];
        if (eff.visible === false) continue;
        var lbl = _effectLabels[eff.type];
        if (!lbl) continue;
        var already = false;
        for (var ej = 0; ej < foundEffects.length; ej++) { if (foundEffects[ej] === lbl) { already = true; break; } }
        if (!already) foundEffects.push(lbl);
      }
      if (foundEffects.length > 0) {
        push('major', 'effects',
          'Figma effect not supported: ' + foundEffects.join(', '),
          'Figma effects aren\'t rendered in email HTML. This effect will not be visible in the email.',
          node);
      }
    }

    // 22 — GROUP nodes
    if (t === 'GROUP') {
      push('major', 'group-node',
        'Group node detected',
        'Groups don\'t have auto-layout. Convert this to a frame with auto-layout so positions and layering show correctly in email.',
        node);
    }

    // 23 — Background image checks (section/template frames only)
    var _bgImgCheckTypes = { '': true, 'section': true, 'template': true };
    if (cfg.bgImgOn && _bgImgCheckTypes[cfg.frameType || '']) {
      // Choose the correct Properties panel field ID based on frame type so the
      // Issues "Edit" button focuses the right input when the node is selected.
      var _bgFieldId = (cfg.frameType === 'template') ? 'inp-bgimg-src-tmpl' : 'inp-bgimg-src';
      if (!cfg.bgImgSrc) {
        push('critical', 'bgimg-no-src',
          'Background image has no source URL',
          'The background image setting is enabled on this frame but no source URL has been set. The image won\'t load.',
          node, _bgFieldId);
      } else if (cfg.bgImgSrc.indexOf('http') !== 0) {
        push('major', 'bgimg-relative-url',
          'Background image URL is not absolute',
          'Background image URLs must start with https:// to load correctly in email clients.',
          node, _bgFieldId);
      } else {
        push('minor', 'bgimg-outlook-' + node.id,
          'Background image: limited Outlook support',
          'Background images display via CSS background-image in modern clients and via the background= attribute in Outlook. Outlook does not support background-size:cover — the image will tile at its natural size. Consider using a wide image that covers the section at its natural dimensions.',
          node);
      }
    }

    // Recurse into children
    if (node.children) {
      var _walkInnerW      = Math.round(node.width) - safeNum(node.paddingLeft, 0) - safeNum(node.paddingRight, 0);
      var _walkLayoutMode  = node.layoutMode || 'NONE';
      for (var ci = 0; ci < node.children.length; ci++) {
        walk(node.children[ci], depth + 1, _walkInnerW, _walkLayoutMode);
      }
    }
  }

  walk(templateNode, 0, 0, 'NONE');
  return issues;
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
// Per-generation mobile CSS rules collected during node rendering, flushed into @media block.
var _mobileCssRules     = [];
// Tracks which conditional gap CSS class names have already been pushed to
// _mobileCssRules this generation so duplicate rules are never emitted.
var _mobileGapClassSeen = {};
// Set true when at least one text layer flagged for blend emits the black-bg
// sandwich this generation. Gates class="body" + the scoped blend <style>.
var _blendUsed = false;
function mobClass(nodeId) { return 'mob-' + nodeId.replace(/:/g, '-'); }

// The scoped blend rules — single source of truth, injected by both generators.
// `u + .body` is a Gmail-only selector, so Outlook/Apple Mail never match the
// wrappers and never show the black boxes. background:#000000 is the identity
// surface for both screen and difference.
var _BLEND_STYLE =
  '<style type="text/css">\n' +
  '  u + .body .q-blend-screen     { background:#000000; mix-blend-mode:screen; }\n' +
  '  u + .body .q-blend-difference { background:#000000; mix-blend-mode:difference; }\n' +
  '</style>\n';
// Adds class="body" alongside id="body" (never replaces it — Safety Rule 2) and
// injects the blend <style>, but ONLY when a blend layer was actually emitted.
function injectBlendAssets(html) {
  if (!_blendUsed) return html;
  html = html.replace('<body id="body"', '<body id="body" class="body"');
  html = html.replace('</head>', _BLEND_STYLE + '</head>');
  return html;
}

function sendSelectionToUI() {
  var sel = figma.currentPage.selection;
  if (!sel.length) { figma.ui.postMessage({ type: 'selection', node: null }); return; }
  var node = sel[0];
  var cfg = parseNodeConfig(node);
  figma.ui.postMessage({
    type: 'selection',
    node: { id: node.id, name: node.name, type: node.type, layoutMode: (node.layoutMode || 'NONE'), cfg: cfg }
  });
}
figma.on('selectionchange', sendSelectionToUI);
sendSelectionToUI();

// ── Live issues scan on document change ──────────────────────
var _issuesTabActive  = false;
var _lastLiveScanTs   = 0;
var _LIVE_SCAN_THROTTLE = 800; // ms — run at most once per 800ms during rapid edits

function _debouncedIssueScan() {
  if (!_issuesTabActive) return;
  var now = Date.now();
  if (now - _lastLiveScanTs < _LIVE_SCAN_THROTTLE) return;
  _lastLiveScanTs = now;
  if (_respFrameId) {
    figma.getNodeByIdAsync(_respFrameId).then(function(n) {
      if (n) _runLiveScan(n);
    }).catch(function() {});
    return;
  }
  var sel = figma.currentPage.selection[0];
  if (sel) _runLiveScan(sel);
}

function _runLiveScan(scanNode) {
  var scanCfg = parseNodeConfig(scanNode);
  if (scanCfg.frameType !== 'template') return;
  var issues = [];
  try { issues = scanForIssues(scanNode); } catch(e) {}
  figma.ui.postMessage({ type: 'issues-result', issues: issues, live: true });
}

figma.loadAllPagesAsync().then(function() {
  figma.on('documentchange', _debouncedIssueScan);
}).catch(function() {
  // If loadAllPagesAsync is unavailable the plugin still works — manual rescan remains functional
});

figma.ui.onmessage = function(msg) {
  var node = figma.currentPage.selection[0];

  if (msg.type === 'update-prop') {
    if (!node) return;
    var key = msg.key; var val = msg.value;
    if (key === 'frameType') {
      // ── Clear stale type-specific data when switching frame types ────────
      var _prevCfg  = parseNodeConfig(node);
      var _prevType = _prevCfg.frameType || '';
      setFrameType(node, val);
      // Leaving 'image': remove image-only name tags so the frame no longer
      // resolves to a flat <img> in the renderer.
      if (_prevType === 'image' && val !== 'image') {
        setTag(node,  'src',      null);
        setTag(node,  'alt',      null);
        setTag(node,  'imgformat', null);
        setFlag(node, 'exportimg', false);
        setFlag(node, 'fullwidth', false);
      }
      // Entering a type that doesn't support bg images: wipe bg-image pluginData
      // so it cannot leak into the HTML output of the new type.
      var _noBgFt = { 'image': 1, 'button': 1, 'divider': 1 };
      if (_noBgFt[val || '']) {
        node.setPluginData('bgImgOn',  '');
        node.setPluginData('bgImgSrc', '');
      }
    }
    else if (key === 'exportImg')       setFlag(node, 'exportimg', val);
    else if (key === 'fullWidthMobile') setFlag(node, 'fullwidth', val);
    else if (key === 'visibility')      setTag(node, 'visibility', val);
    else if (key === 'imgFormat')       setTag(node, 'imgformat', val);
    // Fields stored in pluginData (may contain parens or multi-line text)
    else if (key === 'comment')     { node.setPluginData('comment',     val || ''); }
    else if (key === 'rawCode')     { node.setPluginData('rawCode',     val || ''); }
    else if (key === 'preheader')   { node.setPluginData('preheader',   val || ''); }
    else if (key === 'headStart')   { node.setPluginData('headStart',   val || ''); }
    else if (key === 'headEnd')     { node.setPluginData('headEnd',     val || ''); }
    else if (key === 'bodyStart')   { node.setPluginData('bodyStart',   val || ''); }
    else if (key === 'bodyEnd')     { node.setPluginData('bodyEnd',     val || ''); }
    else if (key === 'subject')     { node.setPluginData('subject',     val || ''); }
    else if (key === 'utmSource')   { node.setPluginData('utmSource',   val || ''); }
    else if (key === 'utmMedium')   { node.setPluginData('utmMedium',   val || ''); }
    else if (key === 'utmCampaign') { node.setPluginData('utmCampaign', val || ''); }
    else if (key === 'utmContent')  { node.setPluginData('utmContent',  val || ''); }
    else if (key === 'utmTerm')        { node.setPluginData('utmTerm',        val || ''); }
    else if (key === 'mobileStack')    { node.setPluginData('mobileStack',    val || ''); }
    else if (key === 'mobileAlign')    { node.setPluginData('mobileAlign',    val || ''); }
    else if (key === 'mobilePadTop')   { node.setPluginData('mobilePadTop',   val || ''); }
    else if (key === 'mobilePadRight') { node.setPluginData('mobilePadRight', val || ''); }
    else if (key === 'mobilePadBottom'){ node.setPluginData('mobilePadBottom',val || ''); }
    else if (key === 'mobilePadLeft')  { node.setPluginData('mobilePadLeft',  val || ''); }
    else if (key === 'mobileFontSize')  { node.setPluginData('mobileFontSize',  val || ''); }
    else if (key === 'mobileLineHeight'){ node.setPluginData('mobileLineHeight', val || ''); }
    else if (key === 'mobileTextAlign') { node.setPluginData('mobileTextAlign', val || ''); }
    else if (key === 'mobileGap')      { node.setPluginData('mobileGap',       val || ''); }
    else if (key === 'htmlTag')        { node.setPluginData('htmlTag',         val || ''); }
    else if (key === 'bgImgOn')  {
      node.setPluginData('bgImgOn', val ? '1' : '');
      // When turning the toggle OFF, also wipe the stored URL so no ghost src
      // persists invisibly and could re-activate if bgImgOn is re-enabled later
      // with the same pluginData. The UI will also clear its input field.
      if (!val) { node.setPluginData('bgImgSrc', ''); }
    }
    else if (key === 'bgImgSrc') { node.setPluginData('bgImgSrc', val || ''); }
    else                                setTag(node, key, val);
    figma.ui.postMessage({ type: 'name-updated', name: node.name });
    // Live-update the Issues tab whenever a property is changed via the panel
    if (_issuesTabActive) {
      _lastLiveScanTs = 0; // bypass throttle — user just made a deliberate change
      _debouncedIssueScan();
    }
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
          headStart:   cfg.headStart   || '',
          headEnd:     cfg.headEnd     || '',
          bodyStart:   cfg.bodyStart   || '',
          bodyEnd:     cfg.bodyEnd     || '',
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
    // When the UI sends a nodeId (auto-lock or manual Set), look up that
    // specific node via getNodeByIdAsync.  This eliminates the race condition
    // where figma.currentPage.selection[0] has already changed to a different
    // frame by the time this message is processed (e.g. the user navigated to
    // an internal frame right after triggering the auto-lock on the Template).
    function doSetResp(respNode) {
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
    }
    if (msg.nodeId) {
      figma.getNodeByIdAsync(msg.nodeId).then(doSetResp).catch(function(e) {
        figma.ui.postMessage({ type: 'error', message: 'Could not load frame: ' + (e.message || String(e)) });
      });
    } else {
      doSetResp(figma.currentPage.selection[0]);
    }
    return;
  }

  if (msg.type === 'clear-resp-frame') {
    _respFrameId = null;
    figma.ui.postMessage({ type: 'resp-frame-cleared' });
    return;
  }

  // ── Breakpoint mode: capture a frame for desktop or mobile ──
  if (msg.type === 'set-breakpoint-frame') {
    // Same nodeId-first approach as set-resp-frame to avoid the race condition
    // where figma.currentPage.selection[0] has drifted by the time this message
    // is processed.
    var bpRole = msg.role;
    function doSetBp(bpNode) {
      if (!bpNode) {
        figma.ui.postMessage({ type: 'error', message: 'Select a frame in Figma first, then click Set.' });
        return;
      }
      if (bpNode.type !== 'FRAME' && bpNode.type !== 'COMPONENT' && bpNode.type !== 'INSTANCE') {
        figma.ui.postMessage({ type: 'error', message: 'Selection must be a Frame, Component, or Instance.' });
        return;
      }
      if (bpRole === 'desktop') {
        _bpDesktopId = bpNode.id;
      } else {
        _bpMobileId = bpNode.id;
      }
      figma.ui.postMessage({
        type: 'breakpoint-frame-set',
        role: bpRole,
        id:   bpNode.id,
        name: bpNode.name,
        width: Math.round(bpNode.width)
      });
    }
    if (msg.nodeId) {
      figma.getNodeByIdAsync(msg.nodeId).then(doSetBp).catch(function(e) {
        figma.ui.postMessage({ type: 'error', message: 'Could not load frame: ' + (e.message || String(e)) });
      });
    } else {
      doSetBp(figma.currentPage.selection[0]);
    }
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
            headStart:   desktopCfg.headStart   || '',
            headEnd:     desktopCfg.headEnd     || '',
            bodyStart:   desktopCfg.bodyStart   || '',
            bodyEnd:     desktopCfg.bodyEnd     || '',
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

  // ── Issues: scan the active template for issues ──────────────
  if (msg.type === 'scan-issues') {
    function runIssueScan(scanNode) {
      if (!scanNode) {
        figma.ui.postMessage({ type: 'issues-result', issues: [], error: 'no-template' });
        return;
      }
      var scanCfg = parseNodeConfig(scanNode);
      if (scanCfg.frameType !== 'template') {
        figma.ui.postMessage({ type: 'issues-result', issues: [], error: 'not-template' });
        return;
      }
      var issues = [];
      try { issues = scanForIssues(scanNode); } catch(e) {}
      figma.ui.postMessage({ type: 'issues-result', issues: issues });
    }

    if (_respFrameId) {
      figma.getNodeByIdAsync(_respFrameId).then(function(lockedNode) {
        if (!lockedNode) { _respFrameId = null; runIssueScan(figma.currentPage.selection[0]); }
        else runIssueScan(lockedNode);
      }).catch(function() { runIssueScan(figma.currentPage.selection[0]); });
    } else {
      runIssueScan(figma.currentPage.selection[0]);
    }
    return;
  }

  // ── Select node in Figma canvas (from Issues "View" button) ──
  if (msg.type === 'select-node') {
    figma.getNodeByIdAsync(msg.nodeId).then(function(targetNode) {
      if (targetNode) {
        figma.currentPage.selection = [targetNode];
        figma.viewport.scrollAndZoomIntoView([targetNode]);
      }
    }).catch(function() {});
    return;
  }

  if (msg.type === 'issues-tab-active') {
    _issuesTabActive = msg.active;
    return;
  }

  if (msg.type === 'close') figma.closePlugin();
};