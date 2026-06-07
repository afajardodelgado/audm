"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  SORT_OPTIONS,
  type StatusFilter,
  type TypeFilter,
  type SortKey,
} from "./filterShelf";
import styles from "./Shelf.module.css";

type MenuKey = "status" | "type" | "sort" | null;
type AddKind = "upload" | "note" | "url";

export default function LibraryToolbar({
  query,
  onQuery,
  statusFilter,
  onStatus,
  typeFilter,
  onType,
  sort,
  onSort,
  view,
  onView,
  onOpenAdd,
  addOpen,
}: {
  query: string;
  onQuery: (s: string) => void;
  statusFilter: StatusFilter;
  onStatus: (f: StatusFilter) => void;
  typeFilter: TypeFilter;
  onType: (f: TypeFilter) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  view: "grid" | "list";
  onView: (v: "grid" | "list") => void;
  onOpenAdd: (which: AddKind) => void;
  addOpen: AddKind | null;
}) {
  const [openMenu, setOpenMenu] = useState<MenuKey>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Dismiss an open filter menu on an outside click or Escape.
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  const toggle = (key: Exclude<MenuKey, null>) =>
    setOpenMenu((cur) => (cur === key ? null : key));

  const label = <T extends string>(
    options: ReadonlyArray<readonly [T, string]>,
    value: T
  ) => options.find(([v]) => v === value)?.[1] ?? "";

  // One filter dropdown: a labelled trigger + an espresso popover of options.
  // Active option is marked by a gold seam AND a check glyph (never colour
  // alone — Von Restorff + colour-vision safety).
  const dropdown = <T extends string>(
    key: Exclude<MenuKey, null>,
    triggerLabel: string,
    options: ReadonlyArray<readonly [T, string]>,
    value: T,
    onPick: (v: T) => void
  ) => (
    <div className={styles.menuWrap}>
      <button
        type="button"
        className={`${styles.toolBtn} ${openMenu === key ? styles.toolBtnActive : ""}`}
        aria-haspopup="listbox"
        aria-expanded={openMenu === key}
        onClick={() => toggle(key)}
      >
        {triggerLabel}: {label(options, value)} <span aria-hidden>▾</span>
      </button>
      {openMenu === key && (
        <ul className={styles.menu} role="listbox" aria-label={triggerLabel}>
          {options.map(([v, text]) => (
            <li key={v}>
              <button
                type="button"
                role="option"
                aria-selected={v === value}
                className={`${styles.menuItem} ${v === value ? styles.menuItemActive : ""}`}
                onClick={() => {
                  onPick(v);
                  setOpenMenu(null);
                }}
              >
                <span className={styles.menuCheck} aria-hidden>
                  {v === value ? "✓" : ""}
                </span>
                {text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const addBtn = (which: AddKind, text: string) => (
    <button
      type="button"
      className={`${styles.toolBtn} ${addOpen === which ? styles.toolBtnActive : ""}`}
      aria-expanded={addOpen === which}
      onClick={() => onOpenAdd(which)}
    >
      {text}
    </button>
  );

  return (
    <div className={styles.toolbar} ref={barRef}>
      <div className={styles.toolbarRow}>
        <div className={styles.toolbarLeft}>
          <span className={styles.toolbarLabel}>Library</span>
          <div className={styles.searchWrap}>
            <span className={styles.searchIcon} aria-hidden>
              🔍
            </span>
            <input
              type="search"
              className={styles.searchInput}
              placeholder="Search title or author…"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              aria-label="Search the library"
            />
          </div>
          <div className={styles.addCluster}>
            {addBtn("upload", "Upload File")}
            {addBtn("note", "Create Note")}
            {addBtn("url", "Import URL")}
          </div>
        </div>

        <div className={styles.toolbarRight}>
          {dropdown("status", "Status", STATUS_OPTIONS, statusFilter, onStatus)}
          {dropdown("type", "Type", TYPE_OPTIONS, typeFilter, onType)}
          {dropdown("sort", "Sort", SORT_OPTIONS, sort, onSort)}

          <div
            className={styles.viewToggle}
            role="group"
            aria-label="View as shelf or list"
          >
            <button
              type="button"
              className={`${styles.viewBtn} ${view === "grid" ? styles.viewBtnActive : ""}`}
              aria-pressed={view === "grid"}
              aria-label="Grid view"
              title="Grid view"
              onClick={() => onView("grid")}
            >
              ▦
            </button>
            <button
              type="button"
              className={`${styles.viewBtn} ${view === "list" ? styles.viewBtnActive : ""}`}
              aria-pressed={view === "list"}
              aria-label="List view"
              title="List view"
              onClick={() => onView("list")}
            >
              ☰
            </button>
          </div>

          {/* Auth is dormant (User has no name/avatar yet) — a static initial
              placeholder linking to the sign-in page. */}
          <Link href="/login" className={styles.avatar} aria-label="Account">
            A
          </Link>
        </div>
      </div>
    </div>
  );
}
