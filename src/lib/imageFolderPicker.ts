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

function hasImageExtension(fileName: string): boolean {
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
 */
export function pickImageFolder(): Promise<File[]> {
  return new Promise((resolve) => {
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
        const files = Array.from(input.files ?? []).filter((file) =>
          hasImageExtension(file.name),
        );
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
    window.addEventListener(
      "focus",
      () => {
        setTimeout(() => {
          if (document.body.contains(input)) {
            input.remove();
            resolve([]);
          }
        }, 300);
      },
      { once: true },
    );

    document.body.appendChild(input);
    input.click();
  });
}
