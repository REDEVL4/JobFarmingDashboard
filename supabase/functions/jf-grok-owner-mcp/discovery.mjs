export async function recordToolList(response, requestId) {
  try {
    const body = await response.text();
    const messages = response.headers.get('content-type')?.includes('text/event-stream')
      ? body.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5))
      : [body];
    for (const message of messages) {
      const payload = JSON.parse(message);
      if (payload.id !== requestId || !Array.isArray(payload.result?.tools)) continue;
      const names = payload.result.tools.map(tool => tool.name);
      if (names.every(name => typeof name === 'string' && /^[a-z_]{1,40}$/.test(name))) {
        console.info('jf_owner_mcp_tools_list_v4 ' + JSON.stringify(names));
      }
    }
  } catch {
    // Diagnostics cannot affect the MCP response.
  }
}
