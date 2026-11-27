# RAR decoder and Content Security Policy

`node-unrar-js@2.0.2` includes two Emscripten binding helpers that generate JavaScript with `Function`. The application permits WebAssembly compilation but does not permit JavaScript string evaluation.

The pinned patch replaces `createNamedFunction` and `craftInvokerFunction` with static closures. Argument validation, conversion to and from WebAssembly values, method receivers and destructor handling retain the original behaviour. Archive data is never evaluated. The upstream UnRAR implementation and its license are unchanged.

The Docker file-viewer browser test exercises ordinary RAR and password-protected RAR listing and extraction under the production CSP. Remove this patch only when the replacement decoder passes those same checks without enabling `unsafe-eval`.
