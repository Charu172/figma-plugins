figma.showUI(__html__, { width: 260, height: 140 });

let TEXT_GREY = { r: 0.85, g: 0.85, b: 0.85 };
let BLOCK_GREY = { r: 0.92, g: 0.92, b: 0.92 };

// Detect dark background
function isDarkMode(node) {
  if (!("fills" in node)) return false;

  const fills = node.fills;
  if (!fills || fills === figma.mixed || fills.length === 0) return false;

  const fill = fills[0];
  if (fill.type !== "SOLID") return false;

  const { r, g, b } = fill.color;

  // relative luminance
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  return luminance < 0.35;
}

function setSkeletonColors(node) {
  if (isDarkMode(node)) {
    TEXT_GREY = { r: 0.35, g: 0.35, b: 0.35 };
    BLOCK_GREY = { r: 0.25, g: 0.25, b: 0.25 };
  } else {
    TEXT_GREY = { r: 0.85, g: 0.85, b: 0.85 };
    BLOCK_GREY = { r: 0.92, g: 0.92, b: 0.92 };
  }
}

function createSkeletonRect(parent, x, y, width, height, index) {
  const rect = figma.createRectangle();
  rect.resize(width, height);
  rect.x = x;
  rect.y = y;
  rect.cornerRadius = Math.min(height / 2, 6);
  rect.fills = [{ type: "SOLID", color: TEXT_GREY }];
  parent.insertChild(index, rect);
}

function convertText(node) {
  const parent = node.parent;
  if (!parent) return;

  const index = parent.children.indexOf(node);
  createSkeletonRect(parent, node.x, node.y, node.width, node.height, index);
  node.remove();
}

function convertRectangle(node) {
  if (!node.parent) return;

  const parent = node.parent;

  if (node.width === node.height && node.width < 80) {
    const rect = figma.createRectangle();
    rect.resize(node.width, node.height);
    rect.x = node.x;
    rect.y = node.y;
    rect.cornerRadius = 4;
    rect.fills = [{ type: "SOLID", color: TEXT_GREY }];

    node.remove();
    parent.insertChild(parent.children.length, rect);
    return;
  }

  node.fills = [{ type: "SOLID", color: BLOCK_GREY }];
}

function blurImage(node) {
  node.fills = [{ type: "SOLID", color: BLOCK_GREY }];
  node.effects = [{ type: "LAYER_BLUR", radius: 12, visible: true }];
}

function isTransparentRect(node) {
  if (node.type !== "RECTANGLE") return false;
  const fills = node.fills;
  if (!fills || fills === figma.mixed) return false;
  return fills.length === 0 || fills.every(f => !f.visible || f.opacity < 0.05);
}

function isIconLike(node) {
  if (node.width > 64 || node.height > 64) return false;
  if (!("children" in node) || node.children.length === 0) return false;

  const vectorTypes = new Set(["VECTOR", "BOOLEAN_OPERATION", "LINE", "STAR", "POLYGON"]);
  let hasVector = false;

  const allSafe = node.children.every(child => {
    if (vectorTypes.has(child.type)) {
      hasVector = true;
      return true;
    }

    if (isTransparentRect(child)) return true;

    if ("children" in child) {
      const r = isIconLike(child);
      if (r) hasVector = true;
      return r;
    }

    return false;
  });

  return allSafe && hasVector;
}

function processNode(node) {

  if (node.type === "INSTANCE") {
    node = node.detachInstance();
  }

  if (node.type === "TEXT") {
    convertText(node);
    return;
  }

  if (node.type === "RECTANGLE") {
    if (node.fills !== figma.mixed) {
      const fills = node.fills;
      if (fills.length && fills[0].type === "IMAGE") {
        blurImage(node);
        return;
      }
    }

    convertRectangle(node);
    return;
  }

  if ("children" in node && isIconLike(node)) {
    return;
  }

  if ("children" in node) {
    const children = [...node.children];

    for (const child of children) {
      processNode(child);
    }
  }
}

function run() {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.notify("Select a frame or screen first");
    return;
  }

  for (const node of selection) {

    // Detect dark mode from container
    setSkeletonColors(node);

    if ("blendMode" in node) {
      node.blendMode = "LUMINOSITY";
    }

    processNode(node);
  }

  figma.notify("Skeleton UI generated");
}

figma.ui.onmessage = (msg) => {
  if (msg.type === "run") {
    run();
  }
};