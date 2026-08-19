/**
 * Web equivalent of frontend/lib/services/image_folder_picker_io.dart.
 *
 * Browsers cannot enumerate an arbitrary local folder path -- the desktop
 * client's `Directory(folderPath).list()` has no equivalent here. Instead,
 * the browser grants folder access through a native <input type="file"
 * webkitdirectory> picker, which returns every file inside the chosen
 * folder (including subfolders) as a normal FileList. This mirrors the
 * *feature* (pick a whole folder of images at once) using the platform's
 * own mechanism rather than raw path enumeration.
 */

const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".heic",
  ".heif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
]);

export function isSupportedImageFile(file: File): boolean {
  // Some browsers report an empty MIME type for TIFF/HEIC despite supporting
  // the file chooser. The filename is therefore the reliable check.
  const fileName = file.name;
  const lower = fileName.toLowerCase();
  for (const ext of IMAGE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

/**
 * Opens the browser's folder picker and resolves with only the direct
 * raster-image files found inside (sorted by name, matching the Dart
 * client's case-insensitive sort). Resolves to an empty array if the user
 * cancels the picker.
 *
 * BUG FIX: The previous 300ms focus-timeout was too short. When the user
 * selects a folder with many files, Chrome/Safari shows a secondary
 * confirmation dialog ("Upload N files to this site?"). The window regains
 * focus between the folder picker closing and the confirmation appearing,
 * causing the focus handler to fire and resolve([]). Increasing the timeout
 * to 2000ms gives the browser enough time to show its confirmation and
 * wait for the user to click Upload/Cancel.
 */
export function pickImageFolder(): Promise<File[]> {
  return new Promise((resolve) => {
    let resolved = false;
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    // webkitdirectory is supported by every major engine despite the
    // vendor-prefixed name; it is not yet a standardized DOM property.
    (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory =
      true;
    input.style.display = "none";

    input.addEventListener(
      "change",
      () => {
        if (resolved) return;
        resolved = true;
        const files = Array.from(input.files ?? []).filter(isSupportedImageFile);
        files.sort((a, b) =>
          a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
        );
        input.remove();
        resolve(files);
      },
      { once: true },
    );
    // A picker the user dismisses without choosing anything never fires
    // `change`; `focus` returning to the page is the closest cross-browser
    // signal that the dialog closed, so we resolve empty shortly after.
    // The timeout must be long enough (2s) to survive Chrome/Safari's
    // secondary "Upload N files?" confirmation dialog — the window gets a
    // brief `focus` flash between the folder picker closing and that
    // confirmation appearing, which at 300ms was enough to kill the pick.
    window.addEventListener(
      "focus",
      () => {
        setTimeout(() => {
          if (!resolved && document.body.contains(input)) {
            resolved = true;
            input.remove();
            resolve([]);
          }
        }, 2000);
      },
      { once: true },
    );

    document.body.appendChild(input);
    input.click();
  });
}
