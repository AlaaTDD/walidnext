/**
 * Web equivalent of job_persistence_io.dart.
 *
 * Dart's SharedPreferences (manifest JSON) -> localStorage.
 * Dart's local filesystem file copy (staged bytes for resumable upload) ->
 * IndexedDB, since localStorage cannot hold arbitrary binary payloads at the
 * size real print images reach and has a ~5-10MB total quota per origin.
 *
 * Same manifest key version (v2) and same clear-on-job-change semantics.
 */

const MANIFEST_KEY = "nesting_job_manifest_v2";
const DB_NAME = "nesting_jobs";
const DB_VERSION = 1;
const STORE_NAME = "staged_files";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function stagedKey(jobId: string, localId: string): string {
  const safeJob = jobId.replace(/[^A-Za-z0-9_-]/g, "_");
  const safeId = localId.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${safeJob}/${safeId}`;
}

export const JobPersistence = {
  getManifest(): string | null {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(MANIFEST_KEY);
    } catch {
      // Private browsing / storage disabled must not crash the app.
      return null;
    }
  },

  saveManifest(json: string): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(MANIFEST_KEY, json);
    } catch {
      // Quota exceeded or storage disabled: resuming across reloads is
      // best-effort, never a reason to block the current session.
    }
  },

  /**
   * Stores the file's bytes under (jobId, localId) for later resumable
   * upload, mirroring stageFile's "copy once, reuse on resume" contract.
   * Web has no durable local path to copy from (unlike desktop/mobile), so
   * this always stores the in-memory bytes directly — the same path the Dart
   * client already takes for kIsWeb.
   */
  async stageFile(
    jobId: string,
    localId: string,
    bytes: Uint8Array,
  ): Promise<void> {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(bytes, stagedKey(jobId, localId));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  },

  async getStagedFile(
    jobId: string,
    localId: string,
  ): Promise<Uint8Array | null> {
    const db = await openDb();
    try {
      return await new Promise<Uint8Array | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx
          .objectStore(STORE_NAME)
          .get(stagedKey(jobId, localId));
        request.onsuccess = () =>
          resolve((request.result as Uint8Array | undefined) ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  },

  /** Clears the manifest and every staged file belonging to the job it referenced — mirrors clear() deleting the whole per-job directory. */
  async clear(): Promise<void> {
    const raw = this.getManifest();
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(MANIFEST_KEY);
      } catch {
        // ignore
      }
    }
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      const jobId = typeof parsed?.jobId === "string" ? parsed.jobId : null;
      if (!jobId) return;
      const safeJob = jobId.replace(/[^A-Za-z0-9_-]/g, "_");
      const db = await openDb();
      try {
        const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readonly");
          const request = tx.objectStore(STORE_NAME).getAllKeys();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const toDelete = keys.filter(
          (k) => typeof k === "string" && k.startsWith(`${safeJob}/`),
        );
        if (toDelete.length > 0) {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            for (const key of toDelete) store.delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
        }
      } finally {
        db.close();
      }
    } catch {
      // Manifest cleanup must not block starting a new job.
    }
  },
};
