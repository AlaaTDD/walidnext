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

function _xhrGet(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<string> {
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

/**
 * The standard setup is entirely local: browser -> loopback -> Python.
 * On a remote deployment (e.g. Vercel), the loopback address is unreachable
 * from the visitor's browser, so the env-var or hardcoded fallback only
 * applies when the page is actually served from localhost.
 */
function defaultBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_API_URL?.trim();

  // If there's an explicit non-loopback env URL, always use it (the deployer
  // set it on purpose, e.g. pointing at a Render/Railway backend).
  if (envUrl && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(envUrl)) {
    return envUrl;
  }

  // On a non-localhost host (Vercel, etc.) a loopback URL is useless -- the
  // user must configure the backend URL via the settings sheet. Returning the
  // loopback anyway would cause every API call to silently fail with a CORS /
  // network error before the user even gets a chance to correct it.
  if (
    typeof window !== "undefined" &&
    !/(localhost|127\.0\.0\.1|\[::1\])/.test(window.location.hostname)
  ) {
    return envUrl || LOCAL_BACKEND_URL;
  }

  return envUrl || LOCAL_BACKEND_URL;
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

  private _safeFetch(
    input: string | URL | Request,
    init?: RequestInit,
    timeoutMs?: number,
  ): Promise<Response> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(init?.method || "GET", input.toString());

      if (init?.headers) {
        const h = init.headers;
        if (h instanceof Headers) {
          h.forEach((value, key) => xhr.setRequestHeader(key, value));
        } else if (Array.isArray(h)) {
          h.forEach(([key, value]) => xhr.setRequestHeader(key, value));
        } else {
          for (const [key, value] of Object.entries(h)) {
            xhr.setRequestHeader(key, value);
          }
        }
      }

      if (timeoutMs) xhr.timeout = timeoutMs;
      xhr.responseType = "blob";

      xhr.onload = () => {
        resolve(
          new Response(xhr.response, {
            status: xhr.status,
            statusText: xhr.statusText,
          }),
        );
      };

      xhr.onerror = () => {
        reject(new ApiException("فشل الاتصال بالخادم: Failed to fetch"));
      };

      xhr.ontimeout = () => {
        reject(
          new ApiException("فشل الاتصال بالخادم: انتهت مهلة الاتصال بالخادم."),
        );
      };

      if (init?.body) {
        xhr.send(init.body as XMLHttpRequestBodyInit);
      } else {
        xhr.send();
      }
    });
  }

  async healthCheck(timeoutMs = 3000): Promise<void> {
    await _xhrGet(`${this._baseUrl}/health`, timeoutMs);
  }

  async createJob(): Promise<Record<string, unknown>> {
    const response = await this._safeFetch(
      `${this._baseUrl}/jobs`,
      { method: "POST" },
      15000,
    );
    await ensure2xx(response);
    return asMap(response);
  }

  async getJob(jobId: string): Promise<Record<string, unknown>> {
    const response = await this._safeFetch(
      `${this._baseUrl}/jobs/${encodeURIComponent(jobId)}`,
      undefined,
      10000,
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
      10000,
    );
    await ensure2xx(response);
  }

  async deleteJob(jobId: string): Promise<void> {
    const response = await this._safeFetch(
      `${this._baseUrl}/jobs/${encodeURIComponent(jobId)}`,
      { method: "DELETE" },
      10000,
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
    // Optional per-job overrides for the backend's LARGE-tier LNS knobs.
    // Omitted entirely from the request body when undefined (rather than sent
    // as `null`) so ComputeRequest's own Optional[None] default on the backend
    // is what actually decides the fallback -- see schemas.py's
    // lns_max_iterations_large/lns_destroy_fraction_large fields.
    lnsMaxIterationsLarge?: number;
    lnsDestroyFractionLarge?: number;
  }): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      sheet_width_mm: params.sheetWidthMm,
      sheet_height_mm: params.sheetHeightMm,
      sheet_margin_mm: params.sheetMarginMm,
      clearance_mm: params.clearanceMm,
      dpi: params.dpi,
      packing_attempts: params.packingAttempts,
    };
    if (params.lnsMaxIterationsLarge !== undefined) {
      body.lns_max_iterations_large = params.lnsMaxIterationsLarge;
    }
    if (params.lnsDestroyFractionLarge !== undefined) {
      body.lns_destroy_fraction_large = params.lnsDestroyFractionLarge;
    }
    const response = await this._safeFetch(
      `${this._baseUrl}/layout/compute/${encodeURIComponent(params.jobId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      30 * 60 * 1000,
    );
    await ensure2xx(response);
    return asMap(response);
  }

  async getProgress(jobId: string): Promise<Record<string, unknown>> {
    const response = await this._safeFetch(
      `${this._baseUrl}/layout/progress/${encodeURIComponent(jobId)}`,
      undefined,
      3000,
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
    const url = `${this._baseUrl}/layout/progress/stream/${encodeURIComponent(jobId)}`;

    const xhr = new XMLHttpRequest();
    let isClosed = false;
    const pushQueue: ((
      value: IteratorResult<Record<string, unknown>, void>,
    ) => void)[] = [];
    const valueQueue: Record<string, unknown>[] = [];
    let position = 0;
    // BUG FIX: an XHR error/timeout that fires *after* the stream has already
    // opened (startPromise resolved) used to call the startPromise `reject`,
    // which is a no-op on an already-settled promise -- the failure vanished
    // silently and the `while` loop below waited forever on a dead connection
    // (see `pushQueue.push` below), since neither a new server event nor an
    // XHR callback could ever arrive again. It is now recorded here and
    // re-thrown once the generator's own loop unwinds, so the caller's
    // existing `catch` (openProgressStream in nestingJobStore.ts) sees it and
    // runs its normal reconnect logic, exactly as it already does for a
    // pre-open failure.
    let streamError: ApiException | null = null;

    const closeStream = () => {
      if (isClosed) return;
      isClosed = true;
      xhr.abort();
      while (pushQueue.length > 0) {
        const resolve = pushQueue.shift();
        resolve?.({ done: true, value: undefined });
      }
    };

    if (onStreamOpened) {
      onStreamOpened(closeStream);
    }

    const startPromise = new Promise<void>((resolve, reject) => {
      xhr.open("GET", url);
      xhr.setRequestHeader("Accept", "text/event-stream");
      xhr.setRequestHeader("Cache-Control", "no-cache");
      // Idle timeout, not a hard request cap: the browser resets this timer on
      // every readyState/progress event on the connection (including the
      // backend's own `: keep-alive` comment sent every
      // _PROGRESS_HEARTBEAT_SECONDS=20s -- see main.py's stream_layout_progress),
      // so a healthy multi-hour compute never trips it. It only fires when the
      // connection has gone silent for 3 missed heartbeats in a row, which is
      // exactly the silent-network-partition case (laptop sleep/wake, Wi-Fi
      // drop with no TCP RST/FIN) that neither `onerror` nor `onload` reliably
      // catches on their own.
      xhr.timeout = 60000;

      xhr.onreadystatechange = () => {
        if (xhr.readyState === XMLHttpRequest.HEADERS_RECEIVED) {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          }
        }
      };

      xhr.onprogress = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const text = xhr.responseText;
          const newText = text.substring(position);

          let newlineIndex: number;
          let buffer = newText;

          while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            position += newlineIndex + 1;

            if (!line.startsWith("data:")) continue;
            try {
              const decoded = JSON.parse(line.slice(5).trim());
              if (decoded && typeof decoded === "object") {
                const data = decoded as Record<string, unknown>;
                if (pushQueue.length > 0) {
                  const r = pushQueue.shift();
                  r?.({ done: false, value: data });
                } else {
                  valueQueue.push(data);
                }
              }
            } catch {
              // Ignore malformed transient event
            }
          }
        }
      };

      xhr.onload = async () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          closeStream();
        } else {
          try {
            const detail = await detailFromBody(xhr.responseText, xhr.status);
            reject(new ApiException(detail, xhr.status));
          } catch {
            reject(
              new ApiException(
                `فشل طلب الخادم (HTTP ${xhr.status}).`,
                xhr.status,
              ),
            );
          }
        }
      };

      // Fires both for a failure while opening (startPromise still pending --
      // `reject` below reaches the `await startPromise` and surfaces normally)
      // and for a failure after the stream is already flowing (startPromise
      // already resolved -- `reject` is then a harmless no-op, so the error is
      // additionally captured in `streamError` and closeStream() unblocks the
      // `while` loop, which re-throws it after the `finally` cleanup below).
      xhr.onerror = () => {
        const error = new ApiException("فشل الاتصال بالخادم لبدء البث.");
        streamError = error;
        reject(error);
        closeStream();
      };

      xhr.ontimeout = () => {
        const error = new ApiException(
          "انقطع اتصال البث (لم يصل أي رد من الخادم).",
        );
        streamError = error;
        reject(error);
        closeStream();
      };

      xhr.send();
    });

    await startPromise;

    try {
      while (!isClosed) {
        if (valueQueue.length > 0) {
          yield valueQueue.shift()!;
        } else {
          const value = await new Promise<
            IteratorResult<Record<string, unknown>, void>
          >((resolve) => {
            pushQueue.push(resolve);
          });
          if (value.done) break;
          yield value.value;
        }
      }
    } finally {
      closeStream();
    }

    if (streamError) throw streamError;
  }

  async cancelLayout(jobId: string): Promise<void> {
    const response = await this._safeFetch(
      `${this._baseUrl}/layout/cancel/${encodeURIComponent(jobId)}`,
      { method: "POST" },
      5000,
    );
    await ensure2xx(response);
  }

  async confirmLayout(params: {
    jobId: string;
    mode: string;
    backgroundColor: string;
  }): Promise<Record<string, unknown>> {
    const response = await this._safeFetch(
      `${this._baseUrl}/layout/confirm/${encodeURIComponent(params.jobId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: params.mode,
          background_color: params.backgroundColor,
        }),
      },
      30 * 60 * 1000,
    );
    await ensure2xx(response);
    return asMap(response);
  }

  async downloadTiff(jobId: string): Promise<Uint8Array> {
    const response = await this._safeFetch(
      `${this._baseUrl}/download/${encodeURIComponent(jobId)}`,
      {},
      10 * 60 * 1000,
    );
    await ensure2xx(response);
    return new Uint8Array(await response.arrayBuffer());
  }

  async exportCurrentLayout(jobId: string): Promise<Uint8Array> {
    const response = await this._safeFetch(
      `${this._baseUrl}/layout/export/${encodeURIComponent(jobId)}`,
      { method: "POST" },
      10 * 60 * 1000,
    );
    await ensure2xx(response);
    return new Uint8Array(await response.arrayBuffer());
  }
}
