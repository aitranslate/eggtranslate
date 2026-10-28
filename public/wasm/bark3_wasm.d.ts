/* tslint:disable */
/* eslint-disable */

/**
 * A loaded model. Created once per page, reused for every recording.
 */
export class BarkAsr {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * `"gpu"` or `"cpu"`, after `auto` resolved.
     */
    backend(): string;
    /**
     * Releases the GPU device — every buffer it owns goes back to the driver now.
     *
     * Call it when the page stops transcribing: WebGPU only returns a dropped
     * buffer once its JavaScript wrapper is collected, so without this the card
     * stays occupied until the tab closes. The instance cannot transcribe
     * afterwards; create a new one.
     */
    close(): void;
    /**
     * Loads a checkpoint from its bytes.
     *
     * `model` is the whole official file — `model.bark` for a compressed release
     * or `model.safetensors` for the full-precision one — as fetched by the page.
     * `backend` is `"auto"` (default), `"gpu"` or `"cpu"`.
     */
    static create(model: Uint8Array, release?: string | null, backend?: string | null): Promise<BarkAsr>;
    /**
     * The device that runs the encoder (adapter name, or `cpu`).
     */
    device(): string;
    /**
     * Largest audio this instance accepts, in seconds. The encoder pads to whole
     * frames and its positional embedding reaches 5000 frames (400 s); the page
     * should cut long recordings with the VAD instead of relying on this.
     */
    static maxSeconds(): number;
    /**
     * What was loaded: release name, weight layout, parameter count, architecture.
     */
    modelInfo(): string;
    /**
     * Transcribes the whole recording with VAD-driven cuts.
     *
     * `cuts` are absolute times in seconds; the natural choice is the midpoint of
     * each silence between two speech runs. Word times come back on the
     * recording's timeline, in one JSON document.
     */
    transcribeChunked(samples: Float32Array, cuts: Float32Array): Promise<string>;
    /**
     * One JSON document: `{ text, duration, segments, words }`, the same the CLI
     * prints. `samples` are 16 kHz mono f32.
     */
    transcribe(samples: Float32Array): Promise<string>;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_barkasr_free: (a: number, b: number) => void;
    readonly barkasr_backend: (a: number) => [number, number];
    readonly barkasr_close: (a: number) => void;
    readonly barkasr_create: (a: number, b: number, c: number, d: number, e: number, f: number) => any;
    readonly barkasr_device: (a: number) => [number, number];
    readonly barkasr_maxSeconds: () => number;
    readonly barkasr_modelInfo: (a: number) => [number, number];
    readonly barkasr_transcribe: (a: number, b: number, c: number) => any;
    readonly barkasr_transcribeChunked: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly wasm_bindgen_45aa438ad1d54d33___convert__closures_____invoke___js_sys_f84e99fd49de3b4a___Function_fn_wasm_bindgen_45aa438ad1d54d33___JsValue_____wasm_bindgen_45aa438ad1d54d33___sys__Undefined___js_sys_f84e99fd49de3b4a___Function_fn_wasm_bindgen_45aa438ad1d54d33___JsValue_____wasm_bindgen_45aa438ad1d54d33___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_45aa438ad1d54d33___convert__closures_____invoke___wasm_bindgen_45aa438ad1d54d33___JsValue__core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_45aa438ad1d54d33___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_45aa438ad1d54d33___convert__closures_____invoke___wasm_bindgen_45aa438ad1d54d33___sys__JsNullable_wgpu_932e8b3987b4a414___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_45aa438ad1d54d33___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_45aa438ad1d54d33___convert__closures_____invoke___wasm_bindgen_45aa438ad1d54d33___sys__JsNullable_wgpu_932e8b3987b4a414___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_45aa438ad1d54d33___JsError___true__12: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_45aa438ad1d54d33___convert__closures_____invoke___wasm_bindgen_45aa438ad1d54d33___sys__JsNullable_wgpu_932e8b3987b4a414___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_45aa438ad1d54d33___JsError___true__13: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_45aa438ad1d54d33___convert__closures_____invoke___wgpu_932e8b3987b4a414___backend__webgpu__webgpu_sys__gen_GpuDeviceLostInfo__GpuDeviceLostInfo______true_: (a: number, b: number, c: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
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
