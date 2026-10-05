// Builds BSP nodes, blockmap and reject for a generated PWAD with ZDBSP.

export async function buildNodes(createZdbsp, wadBytes, { wasmUrl, log } = {}) {
  let output = '';
  const capture = (s) => {
    output += s + '\n';
    if (log) log(s);
  };
  const module = await createZdbsp({
    locateFile: (path, prefix) => (path.endsWith('.wasm') && wasmUrl ? wasmUrl : prefix + path),
    print: capture,
    printErr: capture,
  });
  module.FS.writeFile('in.wad', wadBytes);
  let status = 0;
  try {
    // -q keeps every sidedef and sector so the indices the generator recorded
    // stay valid; -R writes a zeroed reject table, which vanilla needs.
    status = module.callMain(['-q', '-R', '-o', 'out.wad', 'in.wad']);
  } catch (e) {
    if (!(e && e.name === 'ExitStatus')) throw e;
    status = e.status;
  }
  if (status) throw new Error(`node builder failed (${status}): ${output.trim()}`);
  return module.FS.readFile('out.wad');
}
