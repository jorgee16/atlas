const SNAP_POINTS = {
  expanded: 0.12,
  half: 0.50,
  compact: 0.70,
  collapsed: 0.84
};

const clamp = (value, min, max) =>
  Math.min(Math.max(value, min), max);

export class DraggableBottomSheet {
  constructor({
    sheet,
    handle,
    onSettled = () => {},
    initialSnap = 'half'
  }) {
    if (!sheet || !handle) {
      throw new TypeError(
        'DraggableBottomSheet requires sheet and handle elements.'
      );
    }

    this.sheet = sheet;
    this.handle = handle;
    this.onSettled = onSettled;
    this.currentSnap = initialSnap;
    this.currentY = 0;
    this.dragging = false;
    this.startY = 0;
    this.startTranslateY = 0;
    this.velocityY = 0;
    this.lastY = 0;
    this.lastTime = 0;

    this.handle.addEventListener(
      'pointerdown',
      event => this.onPointerDown(event)
    );

    window.addEventListener(
      'resize',
      () => this.snapTo(this.currentSnap, false)
    );

    this.snapTo(initialSnap, false);
  }

  snapTo(name, animate = true) {
    const ratio = SNAP_POINTS[name];

    if (!Number.isFinite(ratio)) {
      throw new Error(`Unknown snap point: ${name}`);
    }

    this.currentSnap = name;
    this.currentY = Math.round(window.innerHeight * ratio);

    this.sheet.classList.toggle('is-dragging', !animate);
    this.sheet.style.transform =
      `translateY(${this.currentY}px)`;
    this.sheet.dataset.snap = name;

    if (!animate) {
      requestAnimationFrame(() => {
        this.sheet.classList.remove('is-dragging');
      });
    }

    this.onSettled(name);
  }

  expand() {
    this.snapTo('expanded');
  }

  half() {
    this.snapTo('half');
  }

  compact() {
    this.snapTo('compact');
  }

  fit() {
    const activeView =
      this.sheet.querySelector(
        '.panel-view.active'
      );

    if (!activeView) {
      this.half();
      return;
    }

    const visibleChildren =
      [...activeView.children]
        .filter(element => !element.hidden);

    const contentHeight =
      visibleChildren.reduce(
        (height, element) =>
          height + element.offsetHeight,
        0
      );

    const handleHeight =
      this.handle.offsetHeight || 34;

    const padding = 20;

    const visibleHeight =
      Math.min(
        contentHeight +
          handleHeight +
          padding,
        window.innerHeight * 0.46
      );

    this.currentSnap = 'fit';

    this.currentY =
      Math.round(
        window.innerHeight -
        visibleHeight
      );

    this.sheet.style.transform =
      `translateY(${this.currentY}px)`;

    this.sheet.dataset.snap = 'fit';

    this.onSettled('fit');
  }

  collapse() {
    this.snapTo('collapsed');
  }

  onPointerDown(event) {
    this.dragging = true;
    this.startY = event.clientY;
    this.startTranslateY = this.currentY;
    this.lastY = event.clientY;
    this.lastTime = performance.now();
    this.velocityY = 0;

    this.sheet.classList.add('is-dragging');
    this.handle.setPointerCapture(event.pointerId);

    const move = moveEvent => {
      const now = performance.now();
      const delta = moveEvent.clientY - this.startY;

      this.currentY = clamp(
        this.startTranslateY + delta,
        window.innerHeight * SNAP_POINTS.expanded,
        window.innerHeight * SNAP_POINTS.collapsed
      );

      const elapsed = Math.max(now - this.lastTime, 1);
      this.velocityY =
        (moveEvent.clientY - this.lastY) / elapsed;

      this.lastY = moveEvent.clientY;
      this.lastTime = now;

      this.sheet.style.transform =
        `translateY(${this.currentY}px)`;
    };

    const end = endEvent => {
      this.dragging = false;
      this.sheet.classList.remove('is-dragging');
      this.handle.releasePointerCapture(endEvent.pointerId);
      this.handle.removeEventListener('pointermove', move);

      const snap = this.resolveSnapPoint();
      this.snapTo(snap);
    };

    this.handle.addEventListener('pointermove', move);
    this.handle.addEventListener('pointerup', end, { once: true });
    this.handle.addEventListener('pointercancel', end, { once: true });
  }

  resolveSnapPoint() {
    const entries =
      Object.entries(SNAP_POINTS)
        .sort((a, b) => a[1] - b[1]);

    if (this.velocityY > 0.45) {
      const next =
        entries.find(
          ([, ratio]) =>
            window.innerHeight * ratio >
            this.currentY + 20
        );

      return next?.[0] ?? 'collapsed';
    }

    if (this.velocityY < -0.45) {
      const previous =
        [...entries]
          .reverse()
          .find(
            ([, ratio]) =>
              window.innerHeight * ratio <
              this.currentY - 20
          );

      return previous?.[0] ?? 'expanded';
    }

    return entries
      .map(([name, ratio]) => ({
        name,
        distance: Math.abs(
          window.innerHeight * ratio -
          this.currentY
        )
      }))
      .sort(
        (a, b) =>
          a.distance - b.distance
      )[0].name;
  }
}
