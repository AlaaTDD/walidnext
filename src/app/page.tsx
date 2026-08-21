"use client";

/**
 * Web port of frontend/lib/main.dart's navigation shell.
 *
 * The Flutter app mounts UploadScreen as `home` and reaches Preview/Export
 * via Navigator.push -- a one-directional push stack. This router mirrors
 * that with local view state driven by the same job.stage the Dart
 * Navigator implicitly tracks, since Next.js has no server-rendered route
 * per stage (the whole workflow is client-side, single-page, matching the
 * SPA-like nature of the original desktop/mobile app).
 */
import { useEffect, useState } from "react";
import { useNestingJobStore } from "@/lib/nestingJobStore";
import { UploadScreen } from "@/components/UploadScreen";
import { PreviewScreen } from "@/components/PreviewScreen";
import { ExportScreen } from "@/components/ExportScreen";

type View = "upload" | "preview" | "export";

export default function Home() {
  const job = useNestingJobStore((s) => s.job);
  const initialize = useNestingJobStore((s) => s.initialize);
  const checkServer = useNestingJobStore((s) => s.checkServer);
  const [view, setView] = useState<View>("upload");

  // Mirrors the Dart provider's constructor-triggered _initialize(): load
  // settings, restore the persisted job/manifest, check server reachability,
  // and resume any pending uploads -- once, on first mount.
  useEffect(() => {
    void initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The one-shot check inside initialize() above only proves reachability at
  // the exact moment the page loaded. If the backend was still starting up
  // (or the tunnel wasn't up yet) at that instant, serverReachable is pinned
  // to false forever after -- nothing previously re-asked the question, so
  // the connection dot stayed red even once the backend became healthy
  // seconds later, until the person manually pressed "save and connect".
  // This keeps re-checking on its own so the dot recovers by itself:
  //   - every 5s while the tab is visible (cheap: healthCheck() is a single
  //     GET /health with a 3s timeout, see nestingApi.ts)
  //   - immediately whenever the tab regains focus/visibility, since that's
  //     exactly the moment someone switches back after starting the backend
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void checkServer();
    }, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkServer();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If server-state recovery (initialize -> recoverRemoteState) discovers the
  // job is already past upload (e.g. reopening the tab mid-computation or
  // with a cached result), jump straight to the right screen instead of
  // stranding the person on the upload list. This direction (upload ->
  // preview/export) is intentionally the common case: any store action that
  // legitimately advances job.stage should also move view forward here.
  useEffect(() => {
    if (view !== "upload") return;
    if (job.stage === "computing" || job.stage === "proofPreview") {
      setView("preview");
    } else if (job.stage === "exporting" || job.stage === "completed") {
      setView("export");
    }
  }, [job.stage, view]);

  // The reverse direction matters too, and used to be entirely unhandled:
  // job.stage is store-global state that has no idea which screen is
  // currently mounted, so any code path that resets a job back to "upload"
  // while view is already "preview" or "export" -- a lost/expired remote
  // job discovered on reconnect, a cleared part list, a future feature, or
  // any path other than PreviewScreen's own onBack-calling cancel button --
  // used to leave view permanently stuck forward of upload forever, because
  // the effect above only ever runs its body while view === "upload". Since
  // neither PreviewScreen's nor ExportScreen's own render switch has (or
  // should have) a fallback case for stage === "upload" -- that state
  // belongs to UploadScreen -- the only correct response the instant it's
  // observed is to leave, exactly as if the person had pressed back
  // themselves. This is what actually eliminates the whole class of
  // white-screen bug at its root, independent of which future code path
  // causes the regression.
  useEffect(() => {
    if (view !== "upload" && job.stage === "upload") {
      setView("upload");
    }
  }, [job.stage, view]);

  if (view === "export") {
    return <ExportScreen onDone={() => setView("upload")} />;
  }
  if (view === "preview") {
    return (
      <PreviewScreen
        onBack={() => setView("upload")}
        onProceed={() => setView("export")}
      />
    );
  }
  return <UploadScreen onProceed={() => setView("preview")} />;
}
