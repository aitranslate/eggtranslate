# public/wasm

本地识别用的两个 wasm 模块，**产物直接提交在仓库里**（不走 npm，也不在构建时生成）。

| 文件 | 来源仓库 | 版本 | 说明 |
|---|---|---|---|
| `bark3_wasm.{js,wasm}` | `D:\\bark3-wgpu` | `3959f5d` | Bark 3.0 推理（WebGPU / CPU），构建时带 `+simd128`（仓库内 `.cargo/config.toml`） |
| `silero_vad_wasm.{js,wasm}` | `D:\\silero-rs` | `7e17f1b` | Silero VAD，权重内嵌（约 1.4 MB） |

两边的 wasm crate 都是 `--target web` 的 wasm-bindgen 产物；升级时重新构建并把 6 个文件（`*.js` / `*_bg.wasm` / `*.d.ts`）整体覆盖过来。

```powershell
# bark3-wgpu
cd D:\\bark3-wgpu
cargo build --release -p bark3-wasm --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir D:\\EggTranslate\\public\\wasm --out-name bark3_wasm `
  target\\wasm32-unknown-unknown\\release\\bark3_wasm.wasm

# silero-rs
cd D:\\silero-rs
cargo build --release -p silero-vad-wasm --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir D:\\EggTranslate\\public\\wasm --out-name silero_vad_wasm `
  target\\wasm32-unknown-unknown\\release\\silero_vad_wasm.wasm
```

两个模块的 JS 胶水用 `import.meta.url` 定位同名 `.wasm`，必须同目录、同名；
`src/services/localAsrService.ts` 通过 `import(/* @vite-ignore */ new URL(BASE_URL + 'wasm/...'))` 运行时加载。
