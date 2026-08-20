/**
 * Web port of nesting_job_provider.dart (NestingJobProvider).
 *
 * Same state machine, same upload queueing/retry semantics, same SSE
 * reconnect logic, same server-state reconciliation on reconnect. Flutter's
 * ChangeNotifier + notifyListeners() becomes Zustand's set(); Provider's
 * context.watch/context.read becomes the useNestingJobStore hook.
 */
"use client";

import { create } from "zustand";
import {
  ApiException,
  NestingApiClient,
  type UploadPayload,
} from "./nestingApi";
import { JobPersistence } from "./jobPersistence";
import {
  type NestingJob,
  type NestingJobSettings,
  type NestingSheetLayout,
  type NestingViolation,
  type QaReport,
  initialJob,
  canProceedToCompute,
  canConfirmExport,
} from "@/types/nestingJob";
import type {
  UploadedPart,
  PlacedPart,
  PartValidationStatus,
} from "@/types/sheetPart";

// Which stage's progress fields the shared SSE subscription should update.
type ProgressTarget = "compute" | "export";

function asInt(value: unknown): number | undefined {
  if (typeof value === "number") return Math.trunc(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}
function asDouble(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function asDoubleNullable(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function asStringMap(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
function asMapArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((v) => v && typeof v === "object")
    : [];
}

interface NestingJobState {
  job: NestingJob;
  jobId: string | null;
  computeProgressDone: number | null;
  computeProgressTotal: number | null;
  computeProgressMessage: string | null;
  exportProgressDone: number | null;
  exportProgressTotal: number | null;
  exportProgressMessage: string | null;
  uploading: boolean;
  uploadProgress: number;
  serverReachable: boolean;
  initializing: boolean;

  // Derived getters (mirror Dart getters on the provider)
  baseUrl: () => string;
  hasResumableJob: () => boolean;

  // Public actions (mirror the Dart provider's public methods 1:1)
  initialize: () => Promise<void>;
  updateServerUrl: (url: string) => Promise<void>;
  updateSettings: (settings: NestingJobSettings) => Promise<void>;
  checkServer: () => Promise<void>;
  refreshCurrentJob: () => Promise<void>;
  addUploadedParts: (parts: UploadedPart[]) => Promise<void>;
  resumePendingUploads: () => Promise<void>;
  removeUploadedPart: (localId: string) => Promise<void>;
  clearAllParts: () => Promise<void>;
  resetJob: () => void;
  cancelCompute: () => Promise<void>;
  computeLayout: () => Promise<void>;
  confirmAndExport: (folderName?: string) => Promise<void>;
  downloadExportedFile: () => Promise<boolean>;
  backToUpload: () => void;
  startNewJob: () => void;
}

// ---- Module-level (non-reactive) mutable state ----------------------------
// Mirrors the Dart provider's private instance fields that are not part of
// the widget-rebuilding state itself (the API client, upload queue, SSE
// subscription bookkeeping). These do not need to be in the Zustand store
// because nothing should re-render when they change — only the state fields
// above do that, exactly like Dart's non-notifying private fields.
let api = new NestingApiClient();
let uploadQueue: Promise<void> = Promise.resolve();
const persistence = JobPersistence;

let progressStreamGeneration = 0;
let progressCancelFn: (() => void) | null = null;
let progressStreamReconnectAttempts = 0;

const UPLOAD_BATCH_SIZE = 5;
const UPLOAD_RETRY_COUNT = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- localId -> in-memory File bytes, kept outside the store -------------
// The Dart client on desktop/mobile re-reads bytes from a durable staged
// file path on resume. The web port has no such path; IndexedDB already
// holds the staged bytes durably (see jobPersistence.stageFile), but we also
// keep an in-memory cache for the current tab session so a resume within the
// same page load doesn't have to round-trip through IndexedDB for every part.
const inMemoryBytes = new Map<string, Uint8Array>();

export const useNestingJobStore = create<NestingJobState>()((set, get) => ({
  job: initialJob(),
  jobId: null,
  computeProgressDone: null,
  computeProgressTotal: null,
  computeProgressMessage: null,
  exportProgressDone: null,
  exportProgressTotal: null,
  exportProgressMessage: null,
  uploading: false,
  uploadProgress: 0,
  serverReachable: false,
  initializing: true,

  baseUrl: () => api.baseUrl,
  hasResumableJob: () => get().job.uploadedParts.length > 0,

  initialize: async () => {
    try {
      await loadSettings(set);
      await restorePersistedJob(set, get);
      await get().checkServer();
      const { serverReachable, job, jobId } = get();
      if (serverReachable && job.uploadedParts.length > 0) {
        if (jobId != null) await recoverRemoteState(set, get);
        if (
          get().job.uploadedParts.some((p) => p.validationStatus === "pending")
        ) {
          void get().resumePendingUploads();
        }
      }
    } finally {
      set({ initializing: false });
    }
  },

  updateServerUrl: async (url) => {
    const normalized = url.trim();
    if (normalized.length === 0) return;
    api = new NestingApiClient(normalized);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem("serverUrl", normalized);
        window.localStorage.setItem("serverUrlExplicit", "true");
      } catch {
        // best-effort only
      }
    }
    await get().checkServer();
    if (get().jobId != null) void recoverRemoteState(set, get);
  },

  updateSettings: async (settings) => {
    const old = get().job.settings;
    const dpiChanged = old.dpi !== settings.dpi;

    set((state) => ({
      job: {
        ...state.job,
        settings,
        computeResult: undefined,
        qaReport: undefined,
        exportedFilePath: undefined,
        exportedFileBytes: undefined,
        stage: "upload",
      },
    }));

    if (typeof window !== "undefined") {
      try {
        const prefs = window.localStorage;
        prefs.setItem("sheetWidthMm", String(settings.sheetWidthMm));
        prefs.setItem("sheetHeightMm", String(settings.sheetHeightMm));
        prefs.setItem("sheetMarginMm", String(settings.sheetMarginMm));
        prefs.setItem("clearanceMm", String(settings.clearanceMm));
        prefs.setItem("dpi", String(settings.dpi));
        prefs.setItem("exportMode", settings.exportMode);
        prefs.setItem("backgroundColor", settings.backgroundColor);
        prefs.setItem("processedImagesPath", settings.processedImagesPath);
        prefs.setItem("packingAttempts", String(settings.packingAttempts));
      } catch {
        // best-effort only
      }
    }

    if (dpiChanged && get().job.uploadedParts.length > 0) {
      markPartsPending(
        set,
        get,
        "تغيير DPI يتطلب إعادة رفع الصور على job جديد.",
      );
      moduleJobId = null;
      set({ jobId: null });
    }
    await persistManifest(get);
  },

  checkServer: async () => {
    try {
      await api.healthCheck();
      set({ serverReachable: true });
    } catch {
      set({ serverReachable: false });
    }
  },

  refreshCurrentJob: () => recoverRemoteState(set, get),

  addUploadedParts: async (parts) => {
    if (parts.length === 0) return;

    set((state) => ({
      job: {
        ...state.job,
        stage: "upload",
        uploadedParts: [...state.job.uploadedParts, ...parts],
        errorMessage: undefined,
        computeResult: undefined,
        qaReport: undefined,
        exportedFilePath: undefined,
        exportedFileBytes: undefined,
      },
    }));

    uploadQueue = uploadQueue.then(() => prepareAndUpload(set, get, parts));
    await uploadQueue.catch(() => {});
  },

  resumePendingUploads: async () => {
    const pending = get().job.uploadedParts.filter(
      (p) => p.validationStatus === "pending",
    );
    if (pending.length === 0) {
      await recoverRemoteState(set, get);
      return;
    }
    uploadQueue = uploadQueue.then(() => prepareAndUpload(set, get, pending));
    await uploadQueue.catch(() => {});
  },

  removeUploadedPart: async (localId) => {
    const target = get().job.uploadedParts.find((p) => p.id === localId);
    const remoteJob = get().jobId;
    if (target != null && remoteJob != null && target.backendPartId != null) {
      try {
        await api.deleteJobPart(remoteJob, target.id);
      } catch (error) {
        console.warn(
          `Failed to delete part from server, but removing locally anyway: ${error}`,
        );
      }
    }
    set((state) => ({
      job: {
        ...state.job,
        uploadedParts: state.job.uploadedParts.filter((p) => p.id !== localId),
        computeResult: undefined,
        qaReport: undefined,
        exportedFilePath: undefined,
        exportedFileBytes: undefined,
        stage: "upload",
      },
    }));
    inMemoryBytes.delete(localId);
    await persistManifest(get);
  },

  clearAllParts: async () => {
    const remoteJob = get().jobId;
    if (remoteJob != null) {
      try {
        await api.deleteJob(remoteJob);
      } catch (error) {
        console.warn(
          `Failed to delete job from server, but clearing locally anyway: ${error}`,
        );
      }
    }
    stopProgressStreaming();
    resetProgress(set);
    set((state) => ({
      job: {
        ...state.job,
        uploadedParts: [],
        stage: "upload",
        computeResult: undefined,
        qaReport: undefined,
        exportedFilePath: undefined,
        exportedFileBytes: undefined,
        errorMessage: undefined,
      },
      jobId: null,
    }));
    moduleJobId = null;
    inMemoryBytes.clear();
    await persistence.clear();
  },

  resetJob: () => {
    const settings = get().job.settings;
    stopProgressStreaming();
    resetProgress(set);
    set({
      job: { ...initialJob(), settings },
      jobId: null,
      uploadProgress: 0,
      uploading: false,
    });
    moduleJobId = null;
    inMemoryBytes.clear();
    void persistence.clear();
  },

  cancelCompute: async () => {
    const id = get().jobId;
    if (id == null) return;
    try {
      await api.cancelLayout(id);
    } catch {
      // best-effort cancel; the compute request's own catch handles the 499
    }
  },

  computeLayout: async () => {
    const state0 = get();
    if (
      !canProceedToCompute(state0.job) ||
      state0.jobId == null ||
      state0.uploading
    ) {
      return;
    }
    const jobId = state0.jobId;

    stopProgressStreaming();
    resetProgress(set);
    set((state) => ({
      job: {
        ...state.job,
        stage: "computing",
        errorMessage: undefined,
        computeResult: undefined,
        qaReport: undefined,
        exportedFilePath: undefined,
        exportedFileBytes: undefined,
      },
    }));
    startProgressStreaming(set, jobId, "compute");

    try {
      const settings = get().job.settings;
      const data = await api.computeLayout({
        jobId,
        sheetWidthMm: settings.sheetWidthMm,
        sheetHeightMm: settings.sheetHeightMm,
        sheetMarginMm: settings.sheetMarginMm,
        clearanceMm: settings.clearanceMm,
        dpi: settings.dpi,
        packingAttempts: settings.packingAttempts,
      });
      applyComputeData(set, get, data, jobId);
      await persistManifest(get);
    } catch (error) {
      const recovered = await tryRecoverCompletedCompute(set, get, jobId);
      if (!recovered) {
        if (error instanceof ApiException) {
          set((state) => ({
            job: {
              ...state.job,
              stage: error.statusCode === 499 ? "upload" : "failed",
              errorMessage:
                error.statusCode === 499 ? "تم إلغاء الحساب." : error.message,
            },
          }));
        } else {
          set((state) => ({
            job: {
              ...state.job,
              stage: "failed",
              errorMessage: `تعذر إتمام الحساب: ${error}`,
            },
            serverReachable: false,
          }));
        }
      }
    } finally {
      stopProgressStreaming();
      resetProgress(set);
      await persistManifest(get);
    }
  },

  confirmAndExport: async (folderName) => {
    const state0 = get();
    if (!canConfirmExport(state0.job) || state0.jobId == null) return;
    const jobId = state0.jobId;

    stopProgressStreaming();
    resetProgress(set);
    set((state) => ({
      job: { ...state.job, stage: "exporting", errorMessage: undefined },
    }));
    // Opened once up front and closed in the finally below, so it stays open
    // through the lost-response retry path further down -- both attempts are
    // progress for the same backend job_id, not two separate operations.
    startProgressStreaming(set, jobId, "export");

    try {
      const settings = get().job.settings;
      const data = await api.confirmLayout({
        jobId,
        mode: settings.exportMode,
        backgroundColor: settings.backgroundColor,
        processedImagesPath: settings.processedImagesPath,
        folderName,
      });
      applyExportData(set, data);
      await get().downloadExportedFile();
      await persistManifest(get);
    } catch (error) {
      // A lost response after a successful export is recoverable through GET /jobs.
      let recovered = false;
      try {
        const remote = await api.getJob(jobId);
        if (remote.output_available === true) {
          const settings = get().job.settings;
          const confirm = await api.confirmLayout({
            jobId,
            mode: settings.exportMode,
            backgroundColor: settings.backgroundColor,
            processedImagesPath: settings.processedImagesPath,
            folderName,
          });
          applyExportData(set, confirm);
          await get().downloadExportedFile();
          recovered = true;
        }
      } catch {
        // fall through to the error branch below
      }
      if (!recovered) {
        if (error instanceof ApiException) {
          set((state) => ({
            job: { ...state.job, stage: "failed", errorMessage: error.message },
          }));
        } else {
          set((state) => ({
            job: {
              ...state.job,
              stage: "failed",
              errorMessage: `فشل التصدير: ${error}`,
            },
            serverReachable: false,
          }));
        }
      }
    } finally {
      stopProgressStreaming();
      resetProgress(set);
    }
  },

  downloadExportedFile: async () => {
    const id = get().jobId;
    if (id == null) {
      set((state) => ({
        job: { ...state.job, errorMessage: "معرف المهمة غير موجود." },
      }));
      return false;
    }
    try {
      const bytes = await api.downloadTiff(id);
      set((state) => ({
        job: {
          ...state.job,
          exportedFileBytes: bytes,
          errorMessage: undefined,
        },
      }));
      return true;
    } catch (error) {
      set((state) => ({
        job: {
          ...state.job,
          errorMessage: `تم إنشاء الملف على السيرفر، لكن تعذر تنزيله الآن: ${error}`,
        },
      }));
      return false;
    }
  },

  backToUpload: () => {
    stopProgressStreaming();
    set((state) => ({
      job: {
        ...state.job,
        stage: "upload",
        errorMessage: undefined,
        computeResult: undefined,
        qaReport: undefined,
        exportedFilePath: undefined,
        exportedFileBytes: undefined,
      },
    }));
    void persistManifest(get);
  },

  startNewJob: () => get().resetJob(),
}));

// ---- Private helpers (mirror the Dart provider's private methods) --------
// These take (set, get) explicitly since they sit outside the store literal.

type Setter = (
  partial:
    | Partial<NestingJobState>
    | ((state: NestingJobState) => Partial<NestingJobState>),
) => void;
type Getter = () => NestingJobState;

// Mirrors the Dart provider's private `_jobId` field, which the module-level
// `api`/`uploadQueue` siblings above already treat as non-reactive. The
// reactive `jobId` in the store stays in sync via every call site below.
let moduleJobId: string | null = null;

async function loadSettings(set: Setter): Promise<void> {
  if (typeof window === "undefined") return;
  let serverUrl: string | null = null;
  let isExplicitServerChoice = false;
  try {
    serverUrl = window.localStorage.getItem("serverUrl");
    isExplicitServerChoice =
      window.localStorage.getItem("serverUrlExplicit") === "true";
  } catch {
    // best-effort only
  }
  if (
    serverUrl != null &&
    serverUrl.trim().length > 0 &&
    isExplicitServerChoice
  ) {
    api = new NestingApiClient(serverUrl);
  } else if (serverUrl != null && serverUrl.trim().length > 0) {
    // Previous versions persisted an automatically generated ngrok URL.
    // It points outside this device and becomes invalid after a restart, so
    // never let that legacy value override the local backend.
    try {
      window.localStorage.removeItem("serverUrl");
    } catch {
      // best-effort only
    }
  }

  const prefs = window.localStorage;
  const readNum = (key: string, fallback: number): number => {
    try {
      const raw = prefs.getItem(key);
      const parsed = raw == null ? NaN : Number(raw);
      return Number.isFinite(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  };
  const readStr = (key: string, fallback: string): string => {
    try {
      return prefs.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  };

  const settings: NestingJobSettings = {
    sheetWidthMm: readNum("sheetWidthMm", 790.0),
    sheetHeightMm: readNum("sheetHeightMm", 1190.0),
    sheetMarginMm: readNum("sheetMarginMm", 5.0),
    clearanceMm: readNum("clearanceMm", 4.1),
    dpi: readNum("dpi", 300.0),
    exportMode: readStr("exportMode", "RGB"),
    backgroundColor: readStr("backgroundColor", "#FFFFFF"),
    processedImagesPath: readStr("processedImagesPath", ""),
    // Single attempt only: the LNS optimizer handles all optimization.
    packingAttempts: Math.min(1, Math.max(1, readNum("packingAttempts", 1))),
  };
  set((state) => ({ job: { ...state.job, settings } }));
}

function markPartsPending(set: Setter, get: Getter, message: string): void {
  set((state) => ({
    job: {
      ...state.job,
      stage: "upload",
      uploadedParts: state.job.uploadedParts.map((part) => ({
        ...part,
        backendPartId: undefined,
        validationStatus: "pending" as PartValidationStatus,
        rejectionReason: message,
      })),
      computeResult: undefined,
      qaReport: undefined,
      exportedFilePath: undefined,
      exportedFileBytes: undefined,
    },
  }));
}

async function prepareAndUpload(
  set: Setter,
  get: Getter,
  parts: UploadedPart[],
): Promise<void> {
  set({ uploading: true, uploadProgress: 0 });

  try {
    await ensureRemoteJob(set, get);
    const jobId = moduleJobId!;

    const staged: UploadedPart[] = [];
    for (const part of parts) {
      if (part.bytes != null) {
        inMemoryBytes.set(part.id, part.bytes);
      } else if (part.file != null) {
        // We will read arrayBuffer dynamically during upload to save memory
      }
      staged.push(part);
    }

    replaceParts(set, get, staged);
    await persistManifest(get);

    for (let start = 0; start < staged.length; start += UPLOAD_BATCH_SIZE) {
      const end = Math.min(start + UPLOAD_BATCH_SIZE, staged.length);
      const batch = staged.slice(start, end);
      await uploadWithRetry(set, get, batch, jobId);
      await persistManifest(get);
    }

    await recoverRemoteState(set, get);
  } catch (error) {
    if (error instanceof ApiException) {
      let message = error.message;
      if (error.statusCode === 404) {
        message = "الـjob المحفوظ لم يعد موجودًا على السيرفر. أنشئ مهمة جديدة.";
      }
      set((state) => ({
        job: { ...state.job, errorMessage: message },
        serverReachable: error.statusCode != null,
      }));
    } else {
      set((state) => ({
        job: {
          ...state.job,
          errorMessage: `توقف الرفع مع حفظ التقدم: ${error}`,
        },
        serverReachable: false,
      }));
    }
  } finally {
    set({ uploadProgress: 0, uploading: false });
    await persistManifest(get);
  }
}

async function ensureRemoteJob(set: Setter, get: Getter): Promise<void> {
  if (moduleJobId != null && moduleJobId.length > 0) return;
  const data = await api.createJob();
  const jobId = data.job_id?.toString();
  if (jobId == null || jobId.length === 0) {
    throw new ApiException("السيرفر لم يرجع معرف job صالح.");
  }
  moduleJobId = jobId;
  set({ jobId, serverReachable: true });
  await persistManifest(get);
}

async function uploadWithRetry(
  set: Setter,
  get: Getter,
  parts: UploadedPart[],
  jobId: string,
): Promise<void> {
  for (let attempt = 1; attempt <= UPLOAD_RETRY_COUNT; attempt++) {
    try {
      const payloads: UploadPayload[] = [];
      const readableIds: string[] = [];
      const unreadableIds = new Set<string>();

      for (const part of parts) {
        let bytes = part.bytes ?? inMemoryBytes.get(part.id);

        if (bytes == null && part.file != null) {
          bytes = new Uint8Array(await part.file.arrayBuffer());
          inMemoryBytes.set(part.id, bytes);
          persistence.stageFile(jobId, part.id, bytes).catch((e) => {
            console.warn(
              `Failed to stage file to IndexedDB, but continuing upload:`,
              e,
            );
          });
        }

        if (bytes == null) {
          bytes =
            (await persistence.getStagedFile(jobId, part.id)) ?? undefined;
          if (bytes != null) {
            inMemoryBytes.set(part.id, bytes);
          }
        }

        if (bytes == null) {
          unreadableIds.add(part.id);
        } else {
          payloads.push({ fileName: part.fileName, bytes });
          readableIds.push(part.id);
        }
      }

      if (unreadableIds.size > 0) {
        set((state) => ({
          job: {
            ...state.job,
            uploadedParts: state.job.uploadedParts.map((p) => {
              if (!unreadableIds.has(p.id)) return p;
              return {
                ...p,
                validationStatus: "rejected",
                rejectionReason:
                  "فقد المتصفح بيانات هذا الملف بسبب التحديث. يرجى إزالته وإعادة إضافته.",
              };
            }),
          },
        }));
      }

      if (payloads.length === 0) {
        return;
      }

      const dpi = get().job.settings.dpi;
      const data = await api.uploadImages({
        files: payloads,
        clientPartIds: readableIds,
        originalSourcePaths: parts
          .filter((p) => readableIds.includes(p.id))
          .map((p) => p.originalSourcePath),
        dpi,
        jobId,
        onProgress: (sent, total) => {
          set({ uploadProgress: total <= 0 ? 0 : sent / total });
        },
      });

      set({ serverReachable: true });
      applyUploadResults(set, get, parts, data);
      await persistManifest(get);
      return;
    } catch (error) {
      if (attempt === UPLOAD_RETRY_COUNT) throw error;
      await delay(attempt * attempt * 1000);
    }
  }
}

function applyUploadResults(
  set: Setter,
  get: Getter,
  batch: UploadedPart[],
  data: Record<string, unknown>,
): void {
  const results = asMapArray(data.parts);
  const byLocalId = new Map<string, Record<string, unknown>>();
  for (const item of results) {
    if (item.client_part_id != null) {
      byLocalId.set(item.client_part_id.toString(), item);
    }
  }

  set((state) => ({
    job: {
      ...state.job,
      uploadedParts: state.job.uploadedParts.map((part) => {
        const response = byLocalId.get(part.id);
        if (response == null) return part;
        const valid = response.is_valid === true;
        return {
          ...part,
          backendPartId: response.part_id?.toString(),
          validationStatus: (valid
            ? "valid"
            : "rejected") as PartValidationStatus,
          rejectionReason: response.rejection_reason?.toString(),
        };
      }),
      errorMessage: undefined,
    },
  }));
}

function replaceParts(
  set: Setter,
  get: Getter,
  replacements: UploadedPart[],
): void {
  const byId = new Map(replacements.map((p) => [p.id, p]));
  set((state) => ({
    job: {
      ...state.job,
      uploadedParts: state.job.uploadedParts.map(
        (part) => byId.get(part.id) ?? part,
      ),
    },
  }));
}

async function restorePersistedJob(set: Setter, get: Getter): Promise<void> {
  const raw = persistence.getManifest();
  if (raw == null || raw.trim().length === 0) return;

  try {
    const parsed = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object") return;
    const jobId: string | null =
      typeof parsed.jobId === "string" ? parsed.jobId : null;
    const settingsMap = asStringMap(parsed.settings);
    const partsRaw = parsed.parts;
    if (!Array.isArray(partsRaw)) return;

    const settings: NestingJobSettings = {
      sheetWidthMm: asDouble(settingsMap.sheetWidthMm),
      sheetHeightMm: asDouble(settingsMap.sheetHeightMm),
      sheetMarginMm: asDouble(settingsMap.sheetMarginMm),
      clearanceMm: asDouble(settingsMap.clearanceMm),
      dpi: asDouble(settingsMap.dpi),
      exportMode: settingsMap.exportMode?.toString() ?? "RGB",
      backgroundColor: settingsMap.backgroundColor?.toString() ?? "#FFFFFF",
      processedImagesPath: settingsMap.processedImagesPath?.toString() ?? "",
      packingAttempts: Math.min(
        1,
        Math.max(1, asInt(settingsMap.packingAttempts) ?? 1),
      ),
    };

    const parts: UploadedPart[] = partsRaw
      .filter((item) => item && typeof item === "object")
      .map((item: Record<string, unknown>) => {
        const status = item.validationStatus?.toString();
        const validationStatus: PartValidationStatus =
          status === "valid" || status === "rejected" || status === "pending"
            ? status
            : "pending";
        return {
          id: item.id?.toString() ?? "",
          fileName: item.fileName?.toString() ?? "unknown",
          filePath: item.filePath?.toString() ?? "",
          originalSourcePath: item.originalSourcePath?.toString(),
          backendPartId: item.backendPartId?.toString(),
          validationStatus,
          rejectionReason: item.rejectionReason?.toString(),
        };
      })
      .filter((part) => part.id.length > 0);

    moduleJobId = jobId && jobId.length > 0 ? jobId : null;
    set((state) => ({
      job: {
        ...state.job,
        settings,
        uploadedParts: parts,
        stage: "upload",
        errorMessage: undefined,
      },
      jobId: moduleJobId,
    }));

    if (await hasPendingRemoteSync()) {
      void recoverRemoteState(set, get);
    }
  } catch {
    // A corrupt local manifest must never prevent opening the application.
  }
}

async function hasPendingRemoteSync(): Promise<boolean> {
  if (moduleJobId == null) return false;
  try {
    await api.getJob(moduleJobId);
    return true;
  } catch {
    return false;
  }
}

async function recoverRemoteState(set: Setter, get: Getter): Promise<void> {
  const id = moduleJobId;
  if (id == null) return;

  try {
    const data = await api.getJob(id);
    set({ serverReachable: true });
    reconcileWithServer(set, get, data);
    const stage = data.stage?.toString();
    if (stage === "computed" || stage === "confirmed") {
      applyComputeData(set, get, data, id);
      if (data.output_available === true) {
        try {
          const settings = get().job.settings;
          const cachedExport = await api.confirmLayout({
            jobId: id,
            mode: settings.exportMode,
            backgroundColor: settings.backgroundColor,
            processedImagesPath: settings.processedImagesPath,
          });
          applyExportData(set, cachedExport);
          set((state) => ({
            job: {
              ...state.job,
              errorMessage:
                "تم استعادة نتيجة التصدير المحفوظة. يمكنك إعادة تنزيل ملف TIFF.",
            },
          }));
        } catch {
          set((state) => ({
            job: {
              ...state.job,
              errorMessage:
                "تم حفظ نتيجة التصدير على السيرفر. يمكنك إعادة تنزيلها.",
            },
          }));
        }
      }
    }
    await persistManifest(get);
  } catch (error) {
    if (error instanceof ApiException) {
      set((state) => ({
        job: {
          ...state.job,
          errorMessage:
            error.statusCode === 404
              ? "الـjob المحفوظ غير موجود على السيرفر."
              : `السيرفر متاح جزئيًا، وسيتم الاستكمال تلقائيًا عند عودته: ${error.message}`,
        },
        serverReachable: error.statusCode != null,
      }));
    } else {
      set((state) => ({
        job: {
          ...state.job,
          errorMessage: `تعذر الاتصال بالسيرفر: ${error}`,
        },
        serverReachable: false,
      }));
    }
  }
}

function reconcileWithServer(
  set: Setter,
  get: Getter,
  data: Record<string, unknown>,
): void {
  const remoteParts = asMapArray(data.parts);
  const byClient = new Map<string, Record<string, unknown>>();
  for (const item of remoteParts) {
    byClient.set(item.client_part_id?.toString() ?? "", item);
  }

  const merged: UploadedPart[] = [];
  for (const local of get().job.uploadedParts) {
    const remote = byClient.get(local.id);
    if (remote == null) {
      merged.push(local);
      continue;
    }
    merged.push({
      ...local,
      backendPartId: remote.part_id?.toString(),
      validationStatus: (remote.is_valid === true
        ? "valid"
        : "rejected") as PartValidationStatus,
      rejectionReason: remote.rejection_reason?.toString(),
    });
  }

  for (const remote of remoteParts) {
    const id = remote.client_part_id?.toString() ?? "";
    if (id.length === 0 || merged.some((p) => p.id === id)) continue;
    merged.push({
      id,
      fileName: remote.original_filename?.toString() ?? "server-image",
      filePath: "",
      backendPartId: remote.part_id?.toString(),
      validationStatus: (remote.is_valid === true
        ? "valid"
        : "rejected") as PartValidationStatus,
      rejectionReason: remote.rejection_reason?.toString(),
    });
  }

  const stage = data.stage?.toString();
  set((state) => ({
    job: {
      ...state.job,
      uploadedParts: merged,
      stage:
        stage === "computed" || stage === "confirmed"
          ? "proofPreview"
          : "upload",
      errorMessage: undefined,
    },
  }));
}

async function persistManifest(get: Getter): Promise<void> {
  const id = moduleJobId;
  const job = get().job;
  const payload = {
    version: 3,
    jobId: id,
    settings: {
      sheetWidthMm: job.settings.sheetWidthMm,
      sheetHeightMm: job.settings.sheetHeightMm,
      sheetMarginMm: job.settings.sheetMarginMm,
      clearanceMm: job.settings.clearanceMm,
      dpi: job.settings.dpi,
      exportMode: job.settings.exportMode,
      backgroundColor: job.settings.backgroundColor,
      processedImagesPath: job.settings.processedImagesPath,
      packingAttempts: job.settings.packingAttempts,
    },
    parts: job.uploadedParts.map((part) => ({
      id: part.id,
      fileName: part.fileName,
      filePath: part.filePath,
      originalSourcePath: part.originalSourcePath ?? null,
      backendPartId: part.backendPartId ?? null,
      validationStatus: part.validationStatus,
      rejectionReason: part.rejectionReason ?? null,
    })),
  };
  persistence.saveManifest(JSON.stringify(payload));
}

function resetProgress(set: Setter): void {
  set({
    computeProgressDone: null,
    computeProgressTotal: null,
    computeProgressMessage: null,
    exportProgressDone: null,
    exportProgressTotal: null,
    exportProgressMessage: null,
  });
}

function stopProgressStreaming(): void {
  // Bumping the generation makes late callbacks from an old connection
  // harmless; canceling the reader closes the single SSE fetch cleanly.
  progressStreamGeneration++;
  if (progressCancelFn) {
    progressCancelFn();
    progressCancelFn = null;
  }
}

function startProgressStreaming(
  set: Setter,
  jobId: string,
  target: ProgressTarget,
): void {
  stopProgressStreaming();
  const generation = progressStreamGeneration;
  progressStreamReconnectAttempts = 0;
  void openProgressStream(set, jobId, generation, target);
}

async function openProgressStream(
  set: Setter,
  jobId: string,
  generation: number,
  target: ProgressTarget,
): Promise<void> {
  if (generation !== progressStreamGeneration) return;

  let receivedTerminalEvent = false;

  try {
    for await (const data of api.streamLayoutProgress(jobId, (cancelFn) => {
      progressCancelFn = cancelFn;
    })) {
      if (generation !== progressStreamGeneration) return;
      const done = asInt(data.done);
      const total = asInt(data.total);
      const message = data.message?.toString() ?? null;
      set(() => ({
        serverReachable: true,
        ...(target === "compute"
          ? {
              computeProgressDone: done ?? null,
              computeProgressTotal: total ?? null,
              computeProgressMessage: message,
            }
          : {
              exportProgressDone: done ?? null,
              exportProgressTotal: total ?? null,
              exportProgressMessage: message,
            }),
      }));
      receivedTerminalEvent = data.complete === true;
    }
    if (!receivedTerminalEvent)
      reconnectProgressStream(set, jobId, generation, target);
  } catch {
    if (generation !== progressStreamGeneration) return; // ignore intentional aborts
    if (!receivedTerminalEvent) {
      set({
        serverReachable: false,
        ...(target === "compute"
          ? {
              computeProgressMessage:
                "انقطع الاتصال بالسيرفر، جارٍ إعادة المحاولة...",
            }
          : {
              exportProgressMessage:
                "انقطع الاتصال بالسيرفر، جارٍ إعادة المحاولة...",
            }),
      });
      reconnectProgressStream(set, jobId, generation, target);
    }
  }
}

function reconnectProgressStream(
  set: Setter,
  jobId: string,
  generation: number,
  target: ProgressTarget,
): void {
  // This is only recovery from a broken stream, never a recurring progress
  // poll: normal calculation/export has one persistent connection.
  progressStreamReconnectAttempts++;
  const delaySeconds = Math.min(
    5,
    Math.max(1, progressStreamReconnectAttempts),
  );
  void delay(delaySeconds * 1000).then(() => {
    // Access the live store here (module scope has no `get`), so this checks
    // the generation only -- the stage check happens via the store hook
    // itself when the caller re-derives state; a dead generation is already
    // harmless because openProgressStream re-checks it immediately.
    if (generation === progressStreamGeneration) {
      void openProgressStream(set, jobId, generation, target);
    }
  });
}

async function tryRecoverCompletedCompute(
  set: Setter,
  get: Getter,
  jobId: string,
): Promise<boolean> {
  try {
    const state = await api.getJob(jobId);
    const stage = state.stage?.toString();
    if (stage === "computed" || stage === "confirmed") {
      applyComputeData(set, get, state, jobId);
      return true;
    }
  } catch {
    // fall through to false
  }
  return false;
}

// Parses PlacedPartPreview.contour_mm (backend api/schemas.py) into the
// frontend's ContourPointMm[] shape. Requires at least 3 points -- fewer
// cannot form a closed polygon SheetLayoutCanvas can draw -- so a malformed
// or (from an older cached job) absent field falls back to the synthesized
// bounding-box rectangle below rather than rendering a degenerate shape.
function parseContourMm(value: unknown): { x: number; y: number }[] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const points: { x: number; y: number }[] = [];
  for (const entry of value) {
    if (entry == null || typeof entry !== "object") return null;
    const record = entry as Record<string, unknown>;
    points.push({ x: asDouble(record.x_mm), y: asDouble(record.y_mm) });
  }
  return points;
}

function decodePlaced(
  get: Getter,
  source: Record<string, unknown>[],
): PlacedPart[] {
  return source.map((item) => {
    const backendId = item.part_id?.toString() ?? "";
    const original = get().job.uploadedParts.find(
      (p) => p.backendPartId === backendId,
    );
    const minX = asDouble(item.bounds_min_x_mm);
    const minY = asDouble(item.bounds_min_y_mm);
    const maxX = asDouble(item.bounds_max_x_mm);
    const maxY = asDouble(item.bounds_max_y_mm);
    // Prefer the backend's real placed_shape_mm exterior ring (exact,
    // possibly irregular contour) over the synthesized axis-aligned
    // rectangle. The rectangle fallback stays exactly as it was (and is what
    // renders for a job computed before this field existed, since the
    // backend response then simply omits contour_mm), so this is additive:
    // any client -- old or new -- talking to any backend -- old or new --
    // still gets a renderable contour, real shape when available.
    const realContour = parseContourMm(item.contour_mm);
    return {
      partId: backendId,
      rotation: { degrees: asInt(item.rotation_deg) ?? 0 },
      contourMm: realContour ?? [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ],
      boundsMm: [minX, minY, maxX, maxY] as const,
      centroidMm: {
        x: asDouble(item.centroid_x_mm),
        y: asDouble(item.centroid_y_mm),
      },
      sourceThumbnail: original?.bytes,
    };
  });
}

function applyComputeData(
  set: Setter,
  get: Getter,
  data: Record<string, unknown>,
  fallbackJobId: string,
): void {
  const jobId = data.job_id?.toString() ?? fallbackJobId;
  moduleJobId = jobId;
  set({ jobId });

  const placedData = asMapArray(data.placed_parts);
  const unplaced = Array.isArray(data.unplaced_part_ids)
    ? data.unplaced_part_ids.map((e) => String(e))
    : [];
  const violationsData = asMapArray(data.violations);

  const sheetsData = asMapArray(data.sheets);
  const sheets: NestingSheetLayout[] = sheetsData.map((sheet) => {
    const pageParts = asMapArray(sheet.placed_parts);
    return {
      pageNumber: asInt(sheet.page_number) ?? 1,
      placedParts: decodePlaced(get, pageParts),
      collisionReportValid: sheet.collision_report_valid === true,
    };
  });
  // Old backend responses contain only placed_parts. Treat them as one page
  // so a saved job remains viewable after the client upgrade.
  const resolvedSheets: NestingSheetLayout[] =
    sheets.length === 0
      ? [
          {
            pageNumber: 1,
            placedParts: decodePlaced(get, placedData),
            collisionReportValid: data.collision_report_valid === true,
          },
        ]
      : sheets;
  const placed = resolvedSheets[0].placedParts;

  const violations: NestingViolation[] = violationsData.map((item) => ({
    severity: item.severity?.toString() ?? "unknown",
    detail: item.detail?.toString() ?? "مخالفة غير معروفة",
    partIdA: item.part_id_a?.toString(),
    partIdB: item.part_id_b?.toString(),
    measuredDistanceMm: asDoubleNullable(item.measured_distance_mm),
  }));

  set((state) => ({
    job: {
      ...state.job,
      stage: "proofPreview",
      computeResult: {
        jobId,
        placedParts: placed,
        sheets: resolvedSheets,
        unplacedPartIds: unplaced,
        collisionViolations: violations,
        allPlaced: data.all_placed === true || unplaced.length === 0,
        collisionReportValid: data.collision_report_valid === true,
        readyToConfirm: data.ready_to_confirm === true,
        sheetFull: data.sheet_full === true,
        processedCount:
          asInt(data.processed_count) ?? placed.length + unplaced.length,
        totalCount: asInt(data.total_count) ?? placed.length + unplaced.length,
        layoutMessage: data.layout_message?.toString() ?? "اكتمل الحساب.",
      },
      errorMessage: undefined,
    },
  }));
}

function applyExportData(set: Setter, data: Record<string, unknown>): void {
  const qaData = asMapArray(data.qa_violations);
  const violations: NestingViolation[] = qaData.map((item) => ({
    severity: item.severity?.toString() ?? "unknown",
    detail: item.detail?.toString() ?? "مخالفة QA غير معروفة",
    expected: item.expected?.toString(),
    actual: item.actual?.toString(),
  }));

  const outputServerPath = data.output_tiff_path?.toString() ?? "";

  set((state) => {
    const placedCount = state.job.computeResult?.placedParts.length ?? 0;
    const report: QaReport = {
      filePath: outputServerPath,
      violations,
      checkedDimension: !violations.some(
        (v) => v.severity === "dimension_mismatch",
      ),
      checkedDpi: !violations.some((v) => v.severity === "dpi_mismatch"),
      checkedClearancePairs:
        placedCount > 1 ? (placedCount * (placedCount - 1)) / 2 : 0,
      checkedIccAndMode: !violations.some(
        (v) =>
          v.severity === "invalid_mode" || v.severity === "missing_icc_profile",
      ),
      checkedLayers: !violations.some((v) => v.severity === "invalid_layers"),
      exportAccepted: data.export_accepted === true,
      widthPx: asInt(data.width_px) ?? 0,
      heightPx: asInt(data.height_px) ?? 0,
      dpi: asDouble(data.dpi),
      layerCount: asInt(data.layer_count) ?? 0,
      processedImagesDirectory: data.processed_images_directory?.toString(),
      movedProcessedImagesCount: asInt(data.moved_processed_images_count) ?? 0,
    };
    return {
      job: {
        ...state.job,
        stage: "completed",
        qaReport: report,
        exportedFilePath: outputServerPath,
        errorMessage: undefined,
      },
    };
  });
}
