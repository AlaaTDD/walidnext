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
  URL.revokeObjectURL(url);
  return true;
}
