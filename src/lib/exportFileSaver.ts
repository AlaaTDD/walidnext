/**
 * Web port of frontend/lib/services/export_file_saver_web.dart.
 * Browser saver: create a normal TIFF download without a native picker.
 */
export async function saveExportedTiff(
  bytes: Uint8Array,
  fileName: string,
): Promise<boolean> {
  const blob = new Blob([new Uint8Array(bytes)], { type: "image/tiff" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking synchronously in the same tick as click() can race Safari's
  // download handoff -- it reads the blob URL asynchronously after the
  // click event, and a URL revoked before that read completes can abort or
  // truncate the download. Deferring to a macrotask (setTimeout 0, not a
  // microtask/Promise) guarantees the click's own synchronous handling and
  // Safari's async download start have both had a chance to run first, on
  // every browser -- Chrome/Firefox already tolerate this ordering, so the
  // delay changes nothing for them and only removes the race for Safari.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
