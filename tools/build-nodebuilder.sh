#!/bin/bash
# Build ZDBSP (the node builder) to WebAssembly. Vanilla Doom needs BSP nodes,
# a blockmap and a reject table, which the generated house map lacks.
# Output: dist/housewad-zdbsp.js + dist/housewad-zdbsp.wasm
set -euo pipefail
cd "$(dirname "$0")/.."
source "${EMSDK:-$HOME/.cache/emsdk}/emsdk_env.sh" >/dev/null 2>&1
Z=third_party/zdbsp
[ -d "$Z" ] || git clone -q --depth 1 https://github.com/rheit/zdbsp.git "$Z"
mkdir -p build/zdbsp dist
SRCS="main.cpp getopt.c getopt1.c blockmapbuilder.cpp processor.cpp processor_udmf.cpp sc_man.cpp wad.cpp nodebuild.cpp nodebuild_events.cpp nodebuild_extract.cpp nodebuild_gl.cpp nodebuild_utility.cpp nodebuild_classify_nosse2.cpp"
OBJS=()
for s in $SRCS; do
    o="build/zdbsp/${s%.*}.o"
    [ -f "$o" ] || em++ -O2 -DDISABLE_SSE -DNO_MAP_VIEWER -Dstricmp=strcasecmp -Dstrnicmp=strncasecmp -include strings.h -include stdlib.h -sUSE_ZLIB=1 -Wno-everything -c "$Z/$s" -o "$o"
    OBJS+=("$o")
done
em++ -O2 "${OBJS[@]}" -o dist/housewad-zdbsp.js -sUSE_ZLIB=1 \
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createZdbsp \
    -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,node \
    -sEXPORTED_RUNTIME_METHODS=callMain,FS
ls -la dist/housewad-zdbsp.*
