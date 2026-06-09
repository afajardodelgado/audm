import Link from "next/link";
import styles from "./login.module.css";

// Placeholder sign-in. Auth is NOT enforced anywhere yet — this page exists so
// the surface is ready when Supabase login is switched on. The form is inert.
export default function LoginPage() {
  return (
    <main className={`theme-shelf ${styles.page}`}>
      <div className={styles.card}>
        <Link href="/" className={styles.back}>
          ← Audm
        </Link>
        <h1 className={`wordmark ${styles.title}`}>Sign in</h1>
        <p className={`byline ${styles.note}`}>
          Accounts aren’t on yet — your library lives on this device. Sign-in is
          coming, so your books and notes can follow you.
        </p>

        <form className={styles.form}>
          <label className={styles.label}>
            Email
            <input
              type="email"
              placeholder="you@example.com"
              disabled
              className={styles.input}
            />
          </label>
          <button type="button" className={styles.submit} disabled>
            Continue with email
          </button>
        </form>

        <Link href="/" className={styles.skip}>
          Keep reading without an account →
        </Link>
      </div>
    </main>
  );
}
