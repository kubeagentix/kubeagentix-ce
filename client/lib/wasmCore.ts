type StatusValue = "running" | "error" | "warning" | "pending";

type WasmCoreModule = {
  default: (module?: unknown) => Promise<unknown>;
  normalize_metric_series: (values: number[]) => number[];
  correlate_metric_series: (left: number[], right: number[]) => number;
  shape_resource_status: (kind: string, status: string) => string;
};

let wasmModulePromise: Promise<WasmCoreModule | null> | null = null;

async function loadWasmCore(): Promise<WasmCoreModule | null> {
  if (import.meta.env.VITE_USE_WASM_CORE === "false") {
    return null;
  }

  if (!wasmModulePromise) {
    wasmModulePromise = (async () => {
      try {
        const module = (await import("../../wasm-core/pkg/wasm_core.js")) as WasmCoreModule;
        await module.default();
        return module;
      } catch (error) {
        console.warn("WASM core unavailable, using TS fallback", error);
        return null;
      }
    })();
  }

  return wasmModulePromise;
}

function fallbackNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min === 0) return values.map(() => 0);
  return values.map((value) => (value - min) / (max - min));
}

function fallbackCorrelation(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0;

  const n = left.length;
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / n;
  const meanRight = right.reduce((sum, value) => sum + value, 0) / n;

  let numerator = 0;
  let leftSq = 0;
  let rightSq = 0;

  for (let i = 0; i < n; i++) {
    const dl = left[i] - meanLeft;
    const dr = right[i] - meanRight;
    numerator += dl * dr;
    leftSq += dl * dl;
    rightSq += dr * dr;
  }

  if (leftSq === 0 || rightSq === 0) return 0;
  return Math.max(-1, Math.min(1, numerator / (Math.sqrt(leftSq) * Math.sqrt(rightSq))));
}

function fallbackShapeStatus(kind: string, status: string): StatusValue {
  const normalized = status.toLowerCase();
  const resourceKind = kind.toLowerCase();

  if (resourceKind === "pod") {
    if (normalized.includes("running")) return "running";
    if (normalized.includes("pending")) return "pending";
    if (normalized.includes("failed") || normalized.includes("error")) return "error";
    return "warning";
  }

  if (normalized.includes("error") || normalized.includes("crash")) return "error";
  if (normalized.includes("pending")) return "pending";
  if (normalized.includes("running") || normalized.includes("ready")) return "running";
  return "warning";
}

export async function normalizeMetricSeries(values: number[]): Promise<number[]> {
  const wasm = await loadWasmCore();
  if (!wasm) return fallbackNormalize(values);

  try {
    return wasm.normalize_metric_series(values);
  } catch {
    return fallbackNormalize(values);
  }
}

export async function correlateMetricSeries(
  left: number[],
  right: number[],
): Promise<number> {
  const wasm = await loadWasmCore();
  if (!wasm) return fallbackCorrelation(left, right);

  try {
    return wasm.correlate_metric_series(left, right);
  } catch {
    return fallbackCorrelation(left, right);
  }
}

export async function shapeResourceStatus(
  kind: string,
  status: string,
): Promise<StatusValue> {
  const wasm = await loadWasmCore();
  if (!wasm) return fallbackShapeStatus(kind, status);

  try {
    const shaped = wasm.shape_resource_status(kind, status);
    if (shaped === "running" || shaped === "error" || shaped === "warning" || shaped === "pending") {
      return shaped;
    }
    return fallbackShapeStatus(kind, status);
  } catch {
    return fallbackShapeStatus(kind, status);
  }
}
