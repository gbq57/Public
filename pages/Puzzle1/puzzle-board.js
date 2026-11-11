(() => {
  function create(container, rows, options) {
    const colours = new Set(['black', 'yellow', 'green', 'blue', 'purple']);
    const slots = [], tiles = new Map(), views = [];
    const maxWidth = Math.max(...rows.map(row => row.width));
    container.style.maxWidth = `${maxWidth}px`;
    rows.forEach((row, rowIndex) => {
      const view = document.createElement('div');
      view.className = 'row-view';
      view.style.width = `${100 * row.width / maxWidth}%`;
      if (rowIndex) {
        const previous = rows[rowIndex - 1];
        view.style.marginTop = `${100 * Math.max(0, row.sourceTop - previous.sourceTop - previous.height) / maxWidth}%`;
      }
      const canvas = document.createElement('canvas');
      canvas.width = row.width; canvas.height = row.height;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', row.type === 'bar' ? `Row ${rowIndex + 1}, ${row.color} solved bar` : `Row ${rowIndex + 1}, unsolved tiles`);
      view.append(canvas); container.append(view);
      const context = canvas.getContext('2d');
      const base = context.createImageData(row.width, row.height); base.data.set(row.pixels);
      views.push({row, context, base});
      if (row.type !== 'tiles') return;
      row.tiles.forEach((tile, column) => {
        const id = `${rowIndex}:${column}`;
        tiles.set(id, {tile, mark: null, cache: new Map()});
        const target = document.createElement('button');
        target.type = 'button'; target.className = 'tile-target';
        for (const [property, value] of Object.entries({left: tile.left / row.width, top: tile.top / row.height, width: tile.width / row.width, height: tile.height / row.height})) target.style[property] = `${100 * value}%`;
        view.append(target);
        slots.push({id, rowIndex, tile, target});
      });
    });
    const initial = slots.map(slot => slot.id);
    let order = initial.slice(), drag = null, suppressClick = false;
    const moving = new Set(), hiddenSlots = new Set();
    const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const saved = options.saved;
    if (saved && saved.version === 1 && Array.isArray(saved.order) && saved.order.length === initial.length && new Set(saved.order).size === initial.length && saved.order.every(id => tiles.has(id))) order = saved.order.slice();
    if (saved?.marks && typeof saved.marks === 'object') {
      for (const [id, colour] of Object.entries(saved.marks)) if (tiles.has(id) && colours.has(colour)) tiles.get(id).mark = colour;
    } else if (Array.isArray(options.legacyMarks)) {
      slots.forEach(slot => { const [r, c] = slot.id.split(':').map(Number); const colour = options.legacyMarks[r]?.[c]; if (colours.has(colour)) tiles.get(slot.id).mark = colour; });
    }
    function imageFor(id) {
      const entry = tiles.get(id), key = entry.mark || 'normal';
      if (!entry.cache.has(key)) {
        const canvas = document.createElement('canvas'); canvas.width = entry.tile.width; canvas.height = entry.tile.height;
        const ctx = canvas.getContext('2d'), image = ctx.createImageData(canvas.width, canvas.height);
        image.data.set(GridDetection.renderTile(entry.tile, entry.mark)); ctx.putImageData(image, 0, 0); entry.cache.set(key, canvas);
      }
      return entry.cache.get(key);
    }
    function draw() {
      views.forEach(({context, base}) => context.putImageData(base, 0, 0));
      slots.forEach((slot, i) => {
        let id = order[i];
        if (drag?.active && drag.candidate !== null && drag.candidate !== drag.source && i === drag.source) id = order[drag.candidate];
        const empty = hiddenSlots.has(i) || (drag?.active && i === (drag.candidate === null ? drag.source : drag.candidate));
        const context = views[slot.rowIndex].context, t = slot.tile;
        if (empty) {
          const blank = {...t, foregroundMask: new Uint8Array(t.foregroundMask.length)};
          const pixels = context.createImageData(t.width, t.height); pixels.data.set(GridDetection.renderTile(blank, null)); context.putImageData(pixels, t.left, t.top);
        } else context.drawImage(imageFor(id), t.left, t.top, t.width, t.height);
        const mark = tiles.get(order[i]).mark;
        slot.target.setAttribute('aria-label', `Row ${slot.rowIndex + 1}, tile ${Number(slot.id.split(':')[1]) + 1}, ${mark ? `marked ${mark}` : 'unmarked'}`);
        slot.target.setAttribute('aria-pressed', String(Boolean(mark)));
      });
    }
    function cancelAnimations() {
      for (const movement of moving) {
        movement.animation.cancel();
        movement.ghost.remove();
      }
      moving.clear();
      hiddenSlots.clear();
    }
    function animateTo(ghost, destination) {
      if (reducedMotion() || !ghost.animate) { ghost.remove(); return; }
      const from = ghost.getBoundingClientRect();
      const to = slots[destination].target.getBoundingClientRect();
      hiddenSlots.add(destination);
      const animation = ghost.animate([
        {transform: 'translate(0, 0)', opacity: 0.95},
        {transform: `translate(${to.left - from.left}px, ${to.top - from.top}px)`, opacity: 0.95}
      ], {duration: 260, easing: 'ease-in-out'});
      const movement = {animation, ghost};
      moving.add(movement);
      const done = () => {
        if (!moving.delete(movement)) return;
        hiddenSlots.delete(destination);
        ghost.remove();
        draw();
      };
      animation.onfinish = done;
      animation.oncancel = done;
    }
    function previewPositions(source, candidate) {
      const positions = new Map(order.map((id, index) => [id, index]));
      positions.delete(order[source]);
      if (candidate !== null && candidate !== source) positions.set(order[candidate], source);
      return positions;
    }
    function animatePreview(before, after) {
      cancelAnimations();
      for (const [id, destination] of after) {
        const origin = before.get(id);
        if (origin === destination) continue;
        const rect = slots[origin].target.getBoundingClientRect();
        const ghost = imageFor(id).cloneNode();
        ghost.getContext('2d').drawImage(imageFor(id), 0, 0);
        ghost.className = 'tile-ghost';
        Object.assign(ghost.style, {left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`});
        document.body.append(ghost);
        animateTo(ghost, destination);
      }
      draw();
    }
    function nearest(x, y) {
      let found = null, best = Infinity;
      slots.forEach((slot, i) => {
        const rect = slot.target.getBoundingClientRect();
        const dx = Math.max(rect.left - x, 0, x - rect.right), dy = Math.max(rect.top - y, 0, y - rect.bottom);
        const distance = Math.hypot(dx, dy);
        if (distance <= Math.min(rect.width, rect.height) * 0.15 && distance < best) { best = distance; found = i; }
      });
      return found;
    }
    function finish(event, cancelled) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const current = drag; drag = null;
      cancelAnimations();
      if (current.active) {
        suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
        if (!cancelled && current.candidate !== null && current.candidate !== current.source) {
          [order[current.source], order[current.candidate]] = [order[current.candidate], order[current.source]];
          options.onChange('Tiles swapped.');
        }
      }
      if (current.ghost) {
        const destination = !cancelled && current.candidate !== null ? current.candidate : current.source;
        animateTo(current.ghost, destination);
      }
      draw();
    }
    slots.forEach((slot, index) => {
      const target = slot.target;
      target.addEventListener('pointerdown', event => {
        if (event.button !== 0 || drag) return;
        cancelAnimations(); draw();
        drag = {source:index, pointerId:event.pointerId, x:event.clientX, y:event.clientY, active:false, candidate:index};
        try { target.setPointerCapture(event.pointerId); } catch {}
      });
      target.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 8) {
          drag.active = true;
          const rect = target.getBoundingClientRect(), ghost = imageFor(order[index]).cloneNode();
          ghost.getContext('2d').drawImage(imageFor(order[index]), 0, 0);
          ghost.className = 'tile-ghost'; ghost.style.width = `${rect.width}px`; ghost.style.height = `${rect.height}px`;
          drag.offsetX = drag.x - rect.left; drag.offsetY = drag.y - rect.top; drag.ghost = ghost; document.body.append(ghost);
        }
        if (drag.active) {
          event.preventDefault();
          const previous = previewPositions(drag.source, drag.candidate);
          const candidate = nearest(event.clientX, event.clientY);
          const changed = candidate !== drag.candidate;
          drag.candidate = candidate;
          drag.ghost.style.left = `${event.clientX - drag.offsetX}px`; drag.ghost.style.top = `${event.clientY - drag.offsetY}px`;
          if (changed) animatePreview(previous, previewPositions(drag.source, candidate));
          else if (!moving.size) draw();
        }
      });
      target.addEventListener('pointerup', event => finish(event, false));
      target.addEventListener('pointercancel', event => finish(event, true));
      target.addEventListener('click', () => {
        if (suppressClick) { suppressClick = false; return; }
        const entry = tiles.get(order[index]); entry.mark = entry.mark ? null : options.selectedColour();
        draw(); options.onChange(entry.mark ? `Tile marked ${entry.mark}.` : 'Tile cleared.');
      });
    });
    draw();
    return {
      snapshot() { return {version:1, order:order.slice(), marks:Object.fromEntries([...tiles].filter(([, entry]) => entry.mark).map(([id, entry]) => [id, entry.mark]))}; },
      hasMoved() { return order.some((id, i) => id !== initial[i]); },
      restore() { cancelAnimations(); order = initial.slice(); draw(); options.onChange('Original positions restored.'); },
      destroy() { cancelAnimations(); if (drag?.ghost) drag.ghost.remove(); drag = null; container.replaceChildren(); }
    };
  }
  globalThis.PuzzleBoard = {create};
})();
