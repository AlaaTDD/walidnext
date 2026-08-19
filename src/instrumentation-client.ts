/**
 * Runs before the app becomes interactive (Next.js instrumentation-client
 * convention). Its only job here: stop browser extensions that globally
 * patch window.fetch (ad/popup blockers, privacy tools, etc.) from making
 * the Next.js dev-mode Redbox overlay pop up over the whole app when their
 * patched fetch throws.
 *
 * This is purely cosmetic. It never touches how our own code handles
 * failures -- checkServer()/healthCheck() in nestingJobStore.ts and
 * nestingApi.ts already catch every one of these errors themselves and
 * update the UI (the connection dot, error banners) accordingly. The only
 * thing this file prevents is the *browser* also treating the same already-
 * handled error as an unhandled one and showing a full-screen crash page
 * over a healthy, working app.
 *
 * The filter is intentionally narrow: it only suppresses errors whose
 * stack or message names a chrome-extension://... script as the source.
 * Real bugs in our own code never carry that marker, so nothing written by
 * us can ever be silenced by this -- only third-party extension code that
 * was never part of our error surface to begin with.
 */

function isBrowserExtensionNoise(value: unknown): boolean {
  if (value == null) return false;
  const text =
    value instanceof Error
      ? `${value.message}\n${value.stack ?? ""}`
      : String(value);
  return (
    text.includes("chrome-extension://") || text.includes("moz-extension://")
  );
}

if (typeof window !== "undefined") {
  window.addEventListener(
    "error",
    (event) => {
      if (
        isBrowserExtensionNoise(event.error) ||
        isBrowserExtensionNoise(event.message)
      ) {
        event.preventDefault();
      }
    },
    // Capture phase: run before Next.js's own overlay listeners, which are
    // attached at the bubble phase during React's client render.
    true,
  );

  window.addEventListener(
    "unhandledrejection",
    (event) => {
      if (isBrowserExtensionNoise(event.reason)) {
        event.preventDefault();
      }
    },
    true,
  );
}
