"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Horizontal scroller behaviour for the 3D shelf: drag-to-pan (pointer),
// wheel → horizontal, and ‹ › step buttons, with the buttons disabling at the
// ends. A drag past a small threshold suppresses the click that follows so
// panning the shelf never accidentally opens a book.

export interface ShelfScroll {
  ref: React.RefObject<HTMLDivElement | null>;
  dragging: boolean;
  canPrev: boolean;
  canNext: boolean;
  scrollPrev: () => void;
  scrollNext: () => void;
  /** Spread onto book wrappers to swallow the post-drag click. */
  onClickCapture: (e: React.MouseEvent) => void;
}

const DRAG_THRESHOLD = 6; // px moved before a drag suppresses the click

export function useShelfScroll(): ShelfScroll {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  // Live drag state in refs to avoid re-renders mid-drag.
  const down = useRef(false);
  const startX = useRef(0);
  const startLeft = useRef(0);
  const moved = useRef(0);

  const step = useCallback(() => {
    const el = ref.current;
    return el ? Math.max(260, el.clientWidth * 0.7) : 260;
  }, []);

  const updateArrows = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 8);
    setCanNext(el.scrollLeft < el.scrollWidth - el.clientWidth - 8);
  }, []);

  const scrollPrev = useCallback(() => {
    ref.current?.scrollBy({ left: -step(), behavior: "smooth" });
  }, [step]);
  const scrollNext = useCallback(() => {
    ref.current?.scrollBy({ left: step(), behavior: "smooth" });
  }, [step]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    updateArrows();

    const onScroll = () => updateArrows();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", updateArrows);

    // Wheel: translate vertical intent into horizontal scroll.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    // Pointer drag-to-pan.
    const onDown = (e: PointerEvent) => {
      down.current = true;
      moved.current = 0;
      startX.current = e.clientX;
      startLeft.current = el.scrollLeft;
      setDragging(true);
    };
    const onMove = (e: PointerEvent) => {
      if (!down.current) return;
      const dx = e.clientX - startX.current;
      moved.current += Math.abs(dx);
      el.scrollLeft = startLeft.current - dx;
    };
    const endDrag = () => {
      down.current = false;
      setDragging(false);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointerleave", endDrag);
    el.addEventListener("pointercancel", endDrag);

    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", updateArrows);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", endDrag);
      el.removeEventListener("pointerleave", endDrag);
      el.removeEventListener("pointercancel", endDrag);
    };
  }, [updateArrows]);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (moved.current > DRAG_THRESHOLD) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return {
    ref,
    dragging,
    canPrev,
    canNext,
    scrollPrev,
    scrollNext,
    onClickCapture,
  };
}
