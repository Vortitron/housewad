#!/bin/bash
# Build the Doom engine (doomgeneric + house.wad hooks) to WebAssembly.
# Output: dist/housewad-engine.js + dist/housewad-engine.wasm
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_SH="${EMSDK:-$HOME/.cache/emsdk}/emsdk_env.sh"
[ -f "$ENV_SH" ] && source "$ENV_SH" >/dev/null 2>&1
command -v emcc >/dev/null || { echo "emcc not found: install emsdk" >&2; exit 1; }
mkdir -p build/engine dist

CFLAGS="-O2 -DFEATURE_SOUND -DDOOMGENERIC_RESX=320 -DDOOMGENERIC_RESY=200 -Iengine/doom -Iengine -Wno-everything"
OBJS=()
for src in engine/doom/*.c engine/*.c; do
    obj="build/engine/$(basename "${src%.c}").o"
    if [ ! -f "$obj" ] || [ "$src" -nt "$obj" ] || [ -n "$(find engine -name '*.h' -newer "$obj" -print -quit)" ]; then
        emcc $CFLAGS -c "$src" -o "$obj"
    fi
    OBJS+=("$obj")
done

emcc -O2 ${LINK_EXTRA:-} "${OBJS[@]}" -o dist/housewad-engine.js \
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createHouseWadEngine \
    -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 -sALLOW_MEMORY_GROWTH=1 \
    -sINITIAL_MEMORY=64MB -sENVIRONMENT=web,node \
    -sEXPORTED_RUNTIME_METHODS=callMain,FS,HEAPU8,HEAPU32,HEAP32,UTF8ToString,ccall \
    -sEXPORTED_FUNCTIONS=_main,_malloc,_free
ls -la dist/housewad-engine.*
