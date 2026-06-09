import Link from "next/link";
import styles from "./shortcuts.module.css";

const GROUPS: { title: string; rows: { keys: string[]; label: string }[] }[] = [
  {
    title: "Reading",
    rows: [
      { keys: ["Space"], label: "Play / pause narration" },
      { keys: ["↑", "+"], label: "Narrate faster" },
      { keys: ["↓", "−"], label: "Narrate slower" },
      { keys: ["Esc"], label: "Stop narration" },
      { keys: ["t"], label: "Open / close the contents menu" },
    ],
  },
  {
    title: "Highlighting",
    rows: [
      { keys: ["c", "s"], label: "Highlight the current sentence" },
      { keys: ["c", "p"], label: "Highlight the current paragraph" },
      { keys: ["c", "d", "s"], label: "Highlight current + previous sentence" },
      { keys: ["c", "d", "p"], label: "Highlight current + previous paragraph" },
      { keys: ["x", "⌫"], label: "Remove the highlight under the focus line" },
    ],
  },
  {
    title: "Highlight colour",
    rows: [
      { keys: ["1"], label: "Amber" },
      { keys: ["2"], label: "Rose" },
      { keys: ["3"], label: "Blue" },
      { keys: ["4"], label: "Green" },
    ],
  },
  {
    title: "Notes",
    rows: [
      { keys: ["Enter"], label: "Save a note (in the note prompt)" },
      { keys: ["Esc"], label: "Highlight without a note" },
    ],
  },
];

export default function ShortcutsPage() {
  return (
    <main className={`theme-shelf ${styles.page}`}>
      <header className={styles.head}>
        <Link href="/" className={styles.back}>
          ← Audm
        </Link>
        <h1 className={`wordmark ${styles.title}`}>Shortcuts</h1>
        <p className={`byline ${styles.lead}`}>
          The whole reader is meant for the keyboard. Highlights follow the line
          at the centre of the screen — the “c” means current.
        </p>
      </header>

      <div className={styles.groups}>
        {GROUPS.map((g) => (
          <section key={g.title} className={styles.group}>
            <h2 className={styles.groupTitle}>{g.title}</h2>
            <div className={styles.rows}>
              {g.rows.map((r, i) => (
                <div key={i} className={`ghost-row ${styles.row}`}>
                  <span className={styles.rowLabel}>{r.label}</span>
                  <span className={styles.keys}>
                    {r.keys.map((k, j) => (
                      <kbd key={j} className={styles.kbd}>
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
