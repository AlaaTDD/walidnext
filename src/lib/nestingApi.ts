/**
 * Ported field-for-field from frontend/lib/services/nesting_api.dart.
 * Every endpoint, timeout, and error-shape below mirrors the Dart client
 * exactly so the backend (unchanged) speaks the same wire protocol.
 */

const LOCAL_BACKEND_URL = "http://127.0.0.1:8000";

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

function _xhrGet(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        xhr.setRequestHeader(key, value);
      }
    }
    xhr.timeout = timeoutMs;
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
      else reject(new ApiException(`HTTP ${xhr.status}`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiException("Network Error"));
    xhr.ontimeout = () => reject(new ApiException("Timeout"));
    xhr.send();
  });
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return defaultBaseUrl();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

/** The standard setup is entirely local: browser -> loopback -> Python. */
function defaultBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL?.trim() || LOCAL_BACKEND_URL;
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


export class NestingApiClient {
  private readonly _baseUrl: string;

  constructor(baseUrl?: string) {
    this._baseUrl = normalizeBaseUrl(baseUrl ?? defaultBaseUrl());
  }

  get baseUrl(): string {
    return this._baseUrl;
  }

  private async _safeFetch(
    input: string | URL | Request,
    init?: RequestInit,
    timeoutMs?: number
  ): Promise<Response> {
    try {
      if (!timeoutMs) {
        return await fetch(input, init);
      }
      
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      
      try {
        const response = await fetch(input, {
          ...init,
          signal: controller.signal,
        });
        clearTimeout(id);
        return response;
      } catch (err) {
        clearTimeout(id);
        if (err instanceof DOMException && err.name === "AbortError") {
          throw new Error("انتهت مهلة الاتصال بالخادم.");
        }
        throw err;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ApiException(`فشل الاتصال بالخادم: ${message}`);
    }
  }

  async healthCheck(timeoutMs = 3000): Promise<void> {
    await _xhrGet(`${this._baseUrl}/health`, timeoutMs);
  }

  async createJob(): Promise<Record<string, unknown>> {
    const response = await this._safeFetch(
      `${this._baseUrl}/jobs`,
      { method: "POST" },
      15000
    );
    await ensure2xx(response);
    return asMap(response);
  }

  async getJob(jobId: string): Promise<Record<string, unknown>> {
    const response = await this._safeFetch(
      `${this._baseUrl}/jobs/${encodeURIComponent(jobId)}`,
      undefined,
      10000
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
    const response = await this._safeFetch(
      `${this._baseUrl}/jobs/${encodeURIComponent(jobId)}/parts/${encodeURIComponent(clientPartId)}`,
      { method: "DELETE" },
      10000
    );
    await ensure2xx(response);
  }

  async deleteJob(jobId: string): Promise<void> {
    const response = await this._safeFetch(
      `${this._baseUrl}/jobs/${encodeURIComponent(jobId)}`,
      { method: "DELETE" },
      10000
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
    const response = await this._safeFetch(
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
      },
      30 * 60 * 1000
    );
    await ensure2xx(response);
    return asMap(response);
  }

  async getProgress(jobId: string): Promise<Record<string, unknown>> {
    const response = await this._safeFetch(
      `${this._baseUrl}/layout/progress/${encodeURIComponent(jobId)}`,
      undefined,
      3000
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
    onStreamOpened?: (cancel: () => void) => void,
  ): AsyncGenerator<Record<string, unknown>, void, unknown> {
    const response = await this._safeFetch(
      `${this._baseUrl}/layout/progress/stream/${encodeURIComponent(jobId)}`,
      {
        headers: { Accept: "text/event-stream", "Cache-Control": "no-cache" },
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
    if (onStreamOpened) {
      onStreamOpened(() => {
        reader.cancel().catch(() => {});
      });
    }
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
    const response = await this._safeFetch(
      `${this._baseUrl}/layout/cancel/${encodeURIComponent(jobId)}`,
      { method: "POST" },
      5000
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
    const response = await this._safeFetch(
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
      },
      30 * 60 * 1000
    );
    await ensure2xx(response);
    return asMap(response);
  }

  async downloadTiff(jobId: string): Promise<Uint8Array> {
    const response = await this._safeFetch(
      `${this._baseUrl}/download/${encodeURIComponent(jobId)}`,
      {},
      10 * 60 * 1000
    );
    await ensure2xx(response);
    return new Uint8Array(await response.arrayBuffer());
  }

  async exportCurrentLayout(jobId: string): Promise<Uint8Array> {
    const response = await this._safeFetch(
      `${this._baseUrl}/layout/export/${encodeURIComponent(jobId)}`,
      { method: "POST" },
      10 * 60 * 1000
    );
    await ensure2xx(response);
    return new Uint8Array(await response.arrayBuffer());
  }
}
