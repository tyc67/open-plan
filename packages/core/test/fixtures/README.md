# Test fixtures

- **`sample-v1.json`:** the sample apartment as a schema version 1 document, with fixed ids. Made for the tests from the v1 sample data.
- **`export-v1-9e1715d.json`:** a real export from the original editor, for the Step B "v1 compatibility" check. The bytes are exactly what its 匯出 JSON button downloaded (no final newline). SHA-256 `bf4d834882586b28de82398981fe1a7bdf4b3dcfaf2054377344f398c2ee45bf`.
    - **Source:** commit `9e1715d` (the initial commit), built with `pnpm build` and served with `vite preview`, in headless Chrome, on 2026-10-07.
    - **Edits before the export**, on the sample that the editor opened with:
        1. The plan name changed to `v1 匯出測試`.
        2. A `雙人床 1.8m` added from the furniture library (random id `5ead59d8-0880-4e4a-9270-8874ffe79303`, at 7600, 8500).
        3. The partition wall `wall-26` marked demolished.
        4. The waste percentage of the cost estimate set to 12.5 (this adds `costEstimate`).
    - The export is the same document that the editor stored in `localStorage`, formatted with two spaces.
