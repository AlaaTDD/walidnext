/**
 * Ported field-for-field from frontend/lib/services/nesting_api.dart.
 * Every endpoint, timeout, and error-shape below mirrors the Dart client
 * exactly so the backend (unchanged) speaks the same wire protocol.
 */

export class ApiException extends Error {
  readonly statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "ApiException";
    this.statusCode = statusCode;
  }
}

export interface UploadPayload {
  fileName: string;
  bytes: Uint8Array;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return defaultBaseUrl();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

/**
 * Web always talks to whatever NEXT_PUBLIC_API_URL points at (set at build
 * time / deploy time) — mirrors the Dart client's kIsWeb branch, which used
 * http://127.0.0.1:8000 as a *local dev* default. In production the backend
 * lives on a separate always-on host (Render/Railway/Fly), never on Vercel
 * itself — see next.config.ts for why.
 */
function defaultBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL?.trim() || "http://127.0.0.1:8000";
}

function numberParam(value: number): string {
  return value % 1 === 0 ? String(Math.trunc(value)) : String(value);
}

async function detailFromBody(
  body: string,
  statusCode: number,
): Promise<string> {
  try {
    const decoded = JSON.parse(body);
    const detail =
      decoded && typeof decoded === "object" ? decoded.detail : undefined;
    if (typeof detail === "string" && detail.trim().length > 0) return detail;
  } catch {
    // fall through to generic message
  }
  return `فشل طلب الخادم (HTTP ${statusCode}).`;
}

async function ensure2xx(response: Response): Promise<void> {
  if (response.ok) return;
  const body = await response.text();
  throw new ApiException(
    await detailFromBody(body, response.status),
    response.status,
  );
}

async function asMap(response: Response): Promise<Record<string, unknown>> {
  const decoded = await response.json();
  if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
    return decoded as Record<string, unknown>;
  }
  throw new ApiException("استجابة غير صالحة من الخادم.");
}

/** AbortSignal.timeout is Baseline-widely-available; used for every fetch to mirror Dart's .timeout(...) on each call. */
function withTimeout(ms: number, external?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(ms);
  return external ? AbortSignal.any([timeoutSignal, external]) : timeoutSignal;
}

export class NestingApiClient {
  private readonly _baseUrl: string;

  constructor(baseUrl?: string) {
    this._baseUrl = normalizeBaseUrl(baseUrl ?? defaultBaseUrl());
  }

  get baseUrl(): string {
    return this._baseUrl;
  }

  async healthCheck(timeoutMs = 3000): Promise<void> {
    const response = await fetch(`${this._baseUrl}/health`, {
      signal: withTimeout(timeoutMs),
    });
    await ensure2xx(response);
  }

  async createJob(): Promise<Record<string, unknown>> {
    const response = await fetch(`${this._baseUrl}/jobs`, {
      method: "POST",
      signal: withTimeout(15000),
    });
    await ensure2xx(response);
    return asMap(response);
  }

  async getJob(jobId: string): Promise<Record<string, unknown>> {
    const response = await fetch(
      `${this._baseUrl}/jobs/${encodeURIComponent(jobId)}`,
      {
        signal: withTimeout(10000),
      },
    );
    await ensure2xx(response);
    return asMap(response);
  }

  async uploadImages(params: {
    files: UploadPayload[];
    clientPartIds: string[];
    originalSourcePaths: (string | undefined)[];
    dpi: number;
    jobId: string;
    onProgress?: (sentBytes: number, totalBytes: number) => void;
  }): Promise<Record<string, unknown>> {
    const {
      files,
      clientPartIds,
      originalSourcePaths,
      dpi,
      jobId,
      onProgress,
    } = params;
    if (files.length === 0) throw new ApiException("لا توجد صور لإرسالها.");
    if (
      files.length !== clientPartIds.length ||
      files.length !== originalSourcePaths.length
    ) {
      throw new ApiException(
        "بيانات الرفع غير متطابقة: عدد الصور مختلف عن عدد المعرفات.",
      );
    }

    const form = new FormData();
    form.append("dpi", numberParam(dpi));
    form.append("job_id", jobId);
    form.append("client_part_ids_json", JSON.stringify(clientPartIds));
    form.append(
      "original_source_paths_json",
      JSON.stringify(originalSourcePaths),
    );

    let totalBytes = 0;
    for (const payload of files) {
      totalBytes += payload.bytes.length;
      form.append(
        "files",
        new Blob([new Uint8Array(payload.bytes)]),
        payload.fileName,
      );
    }

    onProgress?.(0, totalBytes);
    // fetch has no native upload-progress event; XHR is used only for this one
    // call so onProgress still reports real bytes-sent (mirrors the Dart
    // client's onProgress passed through http.MultipartRequest.send()).
    const body = await this._uploadWithXhr(form, totalBytes, onProgress);
    onProgress?.(totalBytes, totalBytes);
    return asMap(new Response(body));
  }

  private _uploadWithXhr(
    form: FormData,
    totalBytes: number,
    onProgress?: (sentBytes: number, totalBytes: number) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${this._baseUrl}/upload`);
      xhr.timeout = 15 * 60 * 1000; // 15 minutes, matches Dart's Duration(minutes: 15)
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded, totalBytes);
      };
      xhr.onload = async () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.responseText);
        } else {
          reject(
            new ApiException(
              await detailFromBody(xhr.responseText, xhr.status),
              xhr.status,
            ),
          );
        }
      };
      xhr.onerror = () => reject(new ApiException("فشل طلب الخادم."));
      xhr.ontimeout = () => reject(new ApiException("انتهت مهلة الرفع."));
      xhr.send(form);
    });
  }

  async deleteJobPart(jobId: string, clientPartId: string): Promise<void> {
    const response = await fetch(
      `${this._baseUrl}/jobs/${encodeURIComponent(jobId)}/parts/${encodeURIComponent(clientPartId)}`,
      { method: "DELETE", signal: withTimeout(10000) },
    );
    await ensure2xx(response);
  }

  async deleteJob(jobId: string): Promise<void> {
    const response = await fetch(
      `${this._baseUrl}/jobs/${encodeURIComponent(jobId)}`,
      {
        method: "DELETE",
        signal: withTimeout(10000),
      },
    );
    await ensure2xx(response);
  }

  async computeLayout(params: {
    jobId: string;
    sheetWidthMm: number;
    sheetHeightMm: number;
    sheetMarginMm: number;
    clearanceMm: number;
    dpi: number;
    packingAttempts: number;
  }): Promise<Record<string, unknown>> {
    const response = await fetch(
      `${this._baseUrl}/layout/compute/${encodeURIComponent(params.jobId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheet_width_mm: params.sheetWidthMm,
          sheet_height_mm: params.sheetHeightMm,
          sheet_margin_mm: params.sheetMarginMm,
          clearance_mm: params.clearanceMm,
          dpi: params.dpi,
          packing_attempts: params.packingAttempts,
        }),
        signal: withTimeout(30 * 60 * 1000),
      },
    );
    await ensure2xx(response);
    return asMap(response);
  }

  async getProgress(jobId: string): Promise<Record<string, unknown>> {
    const response = await fetch(
      `${this._baseUrl}/layout/progress/${encodeURIComponent(jobId)}`,
      {
        signal: withTimeout(3000),
      },
    );
    await ensure2xx(response);
    return asMap(response);
  }

  /**
   * SSE stream of compute/export progress. Mirrors the Dart client's
   * streamLayoutProgress: compact one-line JSON per `data:` line, a
   * comment-only heartbeat is ignored silently, and a malformed line does not
   * abort the stream (the next SSE event is independent).
   */
  async *streamLayoutProgress(
    jobId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<Record<string, unknown>, void, unknown> {
    const response = await fetch(
      `${this._baseUrl}/layout/progress/stream/${encodeURIComponent(jobId)}`,
      {
        headers: { Accept: "text/event-stream", "Cache-Control": "no-cache" },
        signal: withTimeout(15000, signal),
      },
    );
    if (!response.ok) {
      const body = await response.text();
      throw new ApiException(
        await detailFromBody(body, response.status),
        response.status,
      );
    }
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (!line.startsWith("data:")) continue;
          try {
            const decoded = JSON.parse(line.slice(5).trim());
            if (decoded && typeof decoded === "object")
              yield decoded as Record<string, unknown>;
          } catch {
            // Ignore a malformed transient event; the next SSE event is an
            // independent JSON message and does not require reconnecting.
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async cancelLayout(jobId: string): Promise<void> {
    const response = await fetch(
      `${this._baseUrl}/layout/cancel/${encodeURIComponent(jobId)}`,
      {
        method: "POST",
        signal: withTimeout(5000),
      },
    );
    await ensure2xx(response);
  }

  async confirmLayout(params: {
    jobId: string;
    mode: string;
    backgroundColor: string;
    processedImagesPath: string;
    folderName?: string;
  }): Promise<Record<string, unknown>> {
    const response = await fetch(
      `${this._baseUrl}/layout/confirm/${encodeURIComponent(params.jobId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: params.mode,
          background_color: params.backgroundColor,
          processed_images_path:
            params.processedImagesPath.length === 0
              ? null
              : params.processedImagesPath,
          ...(params.folderName && params.folderName.length > 0
            ? { folder_name: params.folderName }
            : {}),
        }),
        signal: withTimeout(30 * 60 * 1000),
      },
    );
    await ensure2xx(response);
    return asMap(response);
  }

  async downloadTiff(jobId: string): Promise<Uint8Array> {
    const response = await fetch(
      `${this._baseUrl}/download/${encodeURIComponent(jobId)}`,
      {
        signal: withTimeout(10 * 60 * 1000),
      },
    );
    await ensure2xx(response);
    return new Uint8Array(await response.arrayBuffer());
  }
}
