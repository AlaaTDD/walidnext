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
  const [view, setView] = useState<View>("upload");

  // Mirrors the Dart provider's constructor-triggered _initialize(): load
  // settings, restore the persisted job/manifest, check server reachability,
  // and resume any pending uploads -- once, on first mount.
  useEffect(() => {
    void initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If server-state recovery (initialize -> recoverRemoteState) discovers the
  // job is already past upload (e.g. reopening the tab mid-computation or
  // with a cached result), jump straight to the right screen instead of
  // stranding the person on the upload list.
  useEffect(() => {
    if (view !== "upload") return;
    if (job.stage === "computing" || job.stage === "proofPreview") {
      setView("preview");
    } else if (job.stage === "exporting" || job.stage === "completed") {
      setView("export");
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
