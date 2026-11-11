(function (root) {
  "use strict";

  const PALETTE = [
    { name: "normal", rgb: [239, 239, 230], type: "tile" },
    { name: "selected", rgb: [90, 89, 78], type: "tile" },
    { name: "yellow", rgb: [249, 223, 110], type: "bar" },
    { name: "green", rgb: [160, 196, 90], type: "bar" },
    { name: "blue", rgb: [177, 196, 239], type: "bar" },
    { name: "purple", rgb: [186, 129, 197], type: "bar" }
  ];
  const COLOR_TOLERANCE_SQUARED = 28 * 28;

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function findComponents(image) {
    const { width, height, data } = image;
    const length = width * height;
    const labels = new Uint8Array(length);
    const queue = new Int32Array(length);
    const components = [];

    for (let pixel = 0, offset = 0; pixel < length; pixel++, offset += 4) {
      if (data[offset + 3] < 128) continue;
      let best = COLOR_TOLERANCE_SQUARED + 1;
      let label = 0;
      for (let i = 0; i < PALETTE.length; i++) {
        const color = PALETTE[i].rgb;
        // A neutral grey overlay can become pale when a screenshot is
        // resized. Do not join it to the slightly warm, buff tile colour.
        if (PALETTE[i].name === "normal" && data[offset] - data[offset + 2] < 5) continue;
        const dr = data[offset] - color[0];
        const dg = data[offset + 1] - color[1];
        const db = data[offset + 2] - color[2];
        const distance = dr * dr + dg * dg + db * db;
        if (distance < best) {
          best = distance;
          label = i + 1;
        }
      }
      if (best <= COLOR_TOLERANCE_SQUARED) labels[pixel] = label;
    }

    for (let start = 0; start < length; start++) {
      const label = labels[start];
      if (!label) continue;
      labels[start] = 0;
      queue[0] = start;
      let head = 0;
      let tail = 1;
      let left = width, top = height, right = 0, bottom = 0;
      while (head < tail) {
        const pixel = queue[head++];
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
        if (x > 0 && labels[pixel - 1] === label) { labels[pixel - 1] = 0; queue[tail++] = pixel - 1; }
        if (x + 1 < width && labels[pixel + 1] === label) { labels[pixel + 1] = 0; queue[tail++] = pixel + 1; }
        if (y > 0 && labels[pixel - width] === label) { labels[pixel - width] = 0; queue[tail++] = pixel - width; }
        if (y + 1 < height && labels[pixel + width] === label) { labels[pixel + width] = 0; queue[tail++] = pixel + width; }
      }
      const componentWidth = right - left + 1;
      const componentHeight = bottom - top + 1;
      if (tail >= 50 && componentWidth >= 10 && componentHeight >= 10 &&
          tail / (componentWidth * componentHeight) >= 0.25) {
        components.push({ id: components.length, left, top, right, bottom,
          width: componentWidth, height: componentHeight, pixels: tail,
          name: PALETTE[label - 1].name, type: PALETTE[label - 1].type });
      }
    }
    return components;
  }

  function makeRows(components) {
    const tiles = components.filter((c) => c.type === "tile" && c.width / c.height > 0.45 && c.width / c.height < 4);
    const rows = [];
    const seen = new Set();

    for (const anchor of tiles) {
      const aligned = tiles.filter((tile) =>
        Math.abs(tile.top - anchor.top) <= Math.max(4, anchor.height * 0.12) &&
        Math.abs(tile.bottom - anchor.bottom) <= Math.max(4, anchor.height * 0.12))
        .sort((a, b) => a.left - b.left);
      for (let i = 0; i + 3 < aligned.length; i++) {
        const group = aligned.slice(i, i + 4);
        const ids = group.map((tile) => tile.id).join(",");
        if (seen.has(ids)) continue;
        const tileWidth = median(group.map((tile) => tile.width));
        const tileHeight = median(group.map((tile) => tile.height));
        const gaps = group.slice(1).map((tile, index) => tile.left - group[index].right - 1);
        const gap = median(gaps);
        if (group.some((tile) => Math.abs(tile.width - tileWidth) > Math.max(4, tileWidth * 0.18) ||
                                 Math.abs(tile.height - tileHeight) > Math.max(4, tileHeight * 0.18)) ||
            gap < 1 || gap > tileWidth * 0.35 ||
            gaps.some((value) => Math.abs(value - gap) > Math.max(3, gap * 0.65, tileWidth * 0.035))) continue;
        seen.add(ids);
        rows.push({ type: "tiles", left: group[0].left, right: group[3].right,
          top: Math.round(median(group.map((tile) => tile.top))),
          bottom: Math.round(median(group.map((tile) => tile.bottom))),
          width: group[3].right - group[0].left + 1, height: Math.round(tileHeight),
          gap, tiles: group });
      }
    }

    for (const bar of components.filter((c) => c.type === "bar" && c.width >= c.height * 2.8)) {
      rows.push({ type: "bar", color: bar.name, left: bar.left, right: bar.right,
        top: bar.top, bottom: bar.bottom, width: bar.width, height: bar.height });
    }
    return rows.sort((a, b) => a.top - b.top);
  }

  function detectGrid(image) {
    if (!image || !image.data || image.width < 1 || image.height < 1) {
      throw new Error("The image could not be read.");
    }
    const rows = makeRows(findComponents(image));
    let best = null;

    for (let i = 0; i < rows.length; i++) {
      const first = rows[i];
      for (let j = i + 1; j < rows.length; j++) {
        const second = rows[j];
        const pitch = second.top - first.top;
        if (pitch < first.height * 0.98 || pitch > first.height * 1.5) continue;
        const toleranceX = Math.max(4, first.width * 0.035);
        const toleranceY = Math.max(4, first.height * 0.14);
        const compatible = (row) =>
          Math.abs(row.left - first.left) <= toleranceX &&
          Math.abs(row.width - first.width) <= Math.max(6, first.width * 0.07) &&
          Math.abs(row.height - first.height) <= Math.max(5, first.height * 0.18);
        if (!compatible(second)) continue;

        const group = [first, second];
        let score = 0;
        for (let k = 2; k < 4; k++) {
          const expected = first.top + pitch * k;
          const matches = rows.filter((row) => compatible(row) && Math.abs(row.top - expected) <= toleranceY)
            .sort((a, b) => Math.abs(a.top - expected) - Math.abs(b.top - expected));
          if (!matches.length) break;
          group.push(matches[0]);
          score += Math.abs(matches[0].top - expected);
        }
        if (group.length !== 4 || new Set(group).size !== 4) continue;
        const verticalGap = pitch - median(group.map((row) => row.height));
        const tileGaps = group.filter((row) => row.type === "tiles").map((row) => row.gap);
        if (tileGaps.length && Math.abs(verticalGap - median(tileGaps)) > Math.max(5, first.height * 0.1)) continue;
        score += group.reduce((sum, row) => sum + Math.abs(row.left - first.left) + Math.abs(row.width - first.width), 0);
        if (!best || score < best.score) best = { score, group };
      }
    }

    if (!best) return null;
    const left = Math.round(median(best.group.map((row) => row.left)));
    const right = Math.round(median(best.group.map((row) => row.right)));
    const tileRows = best.group.filter((row) => row.type === "tiles");
    const columns = tileRows.length ? Array.from({ length: 4 }, (_, column) => ({
      left: Math.round(median(tileRows.map((row) => row.tiles[column].left))),
      right: Math.round(median(tileRows.map((row) => row.tiles[column].right)))
    })) : [];
    return { left, right, rows: best.group.map((row) => ({
      type: row.type, color: row.color || null, left, right,
      top: row.top, bottom: row.bottom,
      tiles: row.type === "tiles" ? row.tiles.map((tile, column) => ({
        left: columns[column].left, right: columns[column].right,
        top: row.top, bottom: row.bottom, state: tile.name
      })) : []
    })) };
  }

  function scaleGrid(grid, scaleX, scaleY) {
    const horizontal = (left, right) => ({
      left: Math.round(left * scaleX), right: Math.round((right + 1) * scaleX) - 1
    });
    const vertical = (top, bottom) => ({
      top: Math.round(top * scaleY), bottom: Math.round((bottom + 1) * scaleY) - 1
    });
    return { ...horizontal(grid.left, grid.right), rows: grid.rows.map((row) => ({
      type: row.type, color: row.color, ...horizontal(row.left, row.right),
      ...vertical(row.top, row.bottom),
      tiles: row.tiles.map((tile) => ({
        state: tile.state, ...horizontal(tile.left, tile.right), ...vertical(tile.top, tile.bottom)
      }))
    })) };
  }

  function clamp(value) { return Math.min(1, Math.max(0, value)); }
  function luminance(rgb) { return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722; }

  function extractRows(image, grid) {
    const { width: imageWidth, height: imageHeight, data: source } = image;
    const white = [255, 255, 255];
    const normalBackground = PALETTE[0].rgb;
    const normalForeground = [18, 18, 18];
    const selectedForeground = [248, 248, 248];
    const paletteByName = Object.fromEntries(PALETTE.map((entry) => [entry.name, entry.rgb]));

    function pixelAt(x, y) {
      if (x < 0 || y < 0 || x >= imageWidth || y >= imageHeight) return white;
      const index = (y * imageWidth + x) * 4;
      return [source[index], source[index + 1], source[index + 2]];
    }

    function isGreyTab(color) {
      const low = Math.min(...color), high = Math.max(...color);
      return low >= 140 && high <= 225 && high - low <= 12;
    }

    function shapeCoverage(color, background) {
      let numerator = 0, denominator = 0;
      for (let channel = 0; channel < 3; channel++) {
        const delta = 255 - background[channel];
        numerator += (255 - color[channel]) * delta;
        denominator += delta * delta;
      }
      return denominator ? clamp(numerator / denominator) : 1;
    }

    function nearEdge(x, y, box) {
      const radius = Math.max(2, Math.round(Math.min(box.right - box.left + 1, box.bottom - box.top + 1) * 0.14));
      const nearHorizontalEnd = x - box.left < radius || box.right - x < radius;
      const nearVerticalEnd = y - box.top < radius || box.bottom - y < radius;
      return (nearHorizontalEnd && nearVerticalEnd) ||
             x - box.left < 4 || box.right - x < 4 ||
             y - box.top < 4 || box.bottom - y < 4;
    }

    return grid.rows.map((row) => {
      const padding = 2;
      const left = Math.max(0, row.left - padding), right = Math.min(imageWidth - 1, row.right + padding);
      const top = Math.max(0, row.top - padding), bottom = Math.min(imageHeight - 1, row.bottom + padding);
      const width = right - left + 1, height = bottom - top + 1;
      const pixels = new Uint8ClampedArray(width * height * 4);
      const tabRows = new Uint8Array(height);
      let overlayDetected = false;

      if (row.left > 1) {
        for (let y = row.top; y <= row.bottom; y++) {
          if (isGreyTab(pixelAt(row.left - 2, y))) {
            tabRows[y - top] = 1;
            overlayDetected = true;
          }
        }
      }

      function correctedPixel(x, y, mirrorRight) {
        const color = pixelAt(x, y);
        // The tab can touch the padding above a row as well as its left edge.
        const tabAtEdge = x < row.left + 4 && isGreyTab(color);
        if ((tabRows[y - top] || tabAtEdge) && x < row.left) return white;
        if ((tabRows[y - top] || tabAtEdge) && x >= row.left && x < row.left + 4) {
          return pixelAt(mirrorRight - (x - row.left), y);
        }
        return color;
      }

      function writePixel(x, y, color) {
        const offset = ((y - top) * width + (x - left)) * 4;
        pixels[offset] = Math.round(color[0]);
        pixels[offset + 1] = Math.round(color[1]);
        pixels[offset + 2] = Math.round(color[2]);
        pixels[offset + 3] = 255;
      }

      for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
          const mirrorRight = row.type === "tiles" ? row.tiles[0].right : row.right;
          // Tile backgrounds are rebuilt below. Starting with white prevents
          // the old selected-tile fringe remaining in the gaps around them.
          writePixel(x, y, row.type === "tiles" ? white : correctedPixel(x, y, mirrorRight));
        }
      }

      if (row.type === "bar") {
        const background = paletteByName[row.color];
        const edgeMask = new Uint8Array(width * height);
        for (let y = row.top; y <= row.bottom; y++) {
          for (let x = row.left; x <= row.right; x++) {
            const color = correctedPixel(x, y, row.right);
            const coverage = nearEdge(x, y, row) ? shapeCoverage(color, background) : 1;
            edgeMask[(y - top) * width + (x - left)] = Math.round(coverage * 255);
          }
        }
        return { type: "bar", color: row.color, width, height, sourceLeft: left, sourceTop: top,
          pixels, edgeMask, overlayDetected };
      }

      const tiles = row.tiles.map((detectedTile, column) => {
        // Colour matching finds the solid interior, not necessarily every
        // anti-aliased edge pixel. Include some of the surrounding white gap.
        const leftLimit = column ? Math.floor((row.tiles[column - 1].right + detectedTile.left + 1) / 2) : left;
        const rightLimit = column < row.tiles.length - 1 ? Math.floor((detectedTile.right + row.tiles[column + 1].left) / 2) : right;
        const tile = { ...detectedTile,
          left: Math.max(leftLimit, detectedTile.left - padding),
          right: Math.min(rightLimit, detectedTile.right + padding),
          top: Math.max(top, detectedTile.top - padding),
          bottom: Math.min(bottom, detectedTile.bottom + padding) };
        const tileWidth = tile.right - tile.left + 1, tileHeight = tile.bottom - tile.top + 1;
        const foregroundMask = new Uint8Array(tileWidth * tileHeight);
        const shapeMask = new Uint8Array(tileWidth * tileHeight);
        const background = paletteByName[tile.state];
        const foreground = tile.state === "selected" ? selectedForeground : normalForeground;
        const backgroundLuminance = luminance(background), foregroundLuminance = luminance(foreground);

        for (let y = tile.top; y <= tile.bottom; y++) {
          for (let x = tile.left; x <= tile.right; x++) {
            const color = correctedPixel(x, y, row.tiles[0].right);
            const shape = nearEdge(x, y, tile) ? shapeCoverage(color, background) : 1;
            const shapeSafe = Math.max(shape, 0.001);
            const unblended = color.map((value) => clamp((value - 255 * (1 - shape)) / (shapeSafe * 255)) * 255);
            let foregroundAmount = clamp((luminance(unblended) - backgroundLuminance) / (foregroundLuminance - backgroundLuminance));
            // A light fringe around a dark selected tile is a blend with the
            // page, not white lettering. Treating it as lettering creates a
            // dark line when the tile is recoloured. Keep the shape's partial
            // coverage, but don't infer foreground in the outer edge strip.
            const edgeStrip = x - tile.left < 4 || tile.right - x < 4 ||
              y - tile.top < 4 || tile.bottom - y < 4;
            if (edgeStrip && shape < 0.98) foregroundAmount = 0;
            if (foregroundAmount < 0.015) foregroundAmount = 0;
            if (foregroundAmount > 0.985) foregroundAmount = 1;
            const index = (y - tile.top) * tileWidth + (x - tile.left);
            foregroundMask[index] = Math.round(foregroundAmount * 255);
            shapeMask[index] = Math.round(shape * 255);
            const normalized = normalBackground.map((value, channel) =>
              255 * (1 - shape) + shape * (value + foregroundAmount * (normalForeground[channel] - value)));
            writePixel(x, y, normalized);
          }
        }
        return { left: tile.left - left, top: tile.top - top, width: tileWidth, height: tileHeight,
          sourceState: tile.state, foregroundMask, shapeMask };
      });
      return { type: "tiles", width, height, sourceLeft: left, sourceTop: top, pixels, tiles, overlayDetected };
    });
  }

  function renderTile(tile, colour) {
    const name = colour === "black" ? "selected" : (colour || "normal");
    const entry = PALETTE.find((item) => item.name === name);
    if (!entry) throw new Error("Unknown tile colour.");
    const background = entry.rgb;
    const foreground = colour === "black" ? [248, 248, 248] : [18, 18, 18];
    const pixels = new Uint8ClampedArray(tile.width * tile.height * 4);
    for (let i = 0; i < tile.width * tile.height; i++) {
      const shape = tile.shapeMask[i] / 255;
      const foregroundAmount = tile.foregroundMask[i] / 255;
      for (let channel = 0; channel < 3; channel++) {
        const tileColor = background[channel] + foregroundAmount * (foreground[channel] - background[channel]);
        pixels[i * 4 + channel] = 255 * (1 - shape) + shape * tileColor;
      }
      pixels[i * 4 + 3] = 255;
    }
    return pixels;
  }

  const api = { detectGrid, scaleGrid, extractRows, renderTile, palette: PALETTE };
  root.GridDetection = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
