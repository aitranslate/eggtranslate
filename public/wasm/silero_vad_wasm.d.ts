/* tslint:disable */
/* eslint-disable */

/**
 * A VAD instance. Cheap to create; keep one per page.
 */
export class SileroVad {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Everything the page needs in one call: both lists plus the speech duration.
     */
    analyse(samples: Float32Array, max_seconds?: number | null): string;
    /**
     * Builds the detector with the embedded 16 kHz weights.
     */
    static create(): SileroVad;
    /**
     * Cut times in seconds — the silence midpoints a chunker should split on.
     *
     * `max_seconds` (default 60) caps a chunk; a speech run that does not fit is
     * cut at the last pause before the limit, as described in the module docs.
     */
    cuts(samples: Float32Array, max_seconds?: number | null): string;
    /**
     * Speech runs as JSON `[[start, end], ...]` in seconds.
     */
    speech(samples: Float32Array): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_silerovad_free: (a: number, b: number) => void;
    readonly silerovad_analyse: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly silerovad_create: () => [number, number, number];
    readonly silerovad_cuts: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly silerovad_speech: (a: number, b: number, c: number) => [number, number, number, number];
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
