// TD relay (Cloudflare Worker).
// - The page itself (everything in the `public` folder) is served by Cloudflare automatically.
// - This script only handles the WebSocket at  wss://<your-worker>.workers.dev/r
//   Whatever one side sends (your phone page, or TouchDesigner) is forwarded to the other side(s).
// Nothing protects the address: anyone who knows it can control your project.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/r' && request.headers.get('Upgrade') === 'websocket') {
      return env.ROOM.get(env.ROOM.idFromName('public')).fetch(request);
    }
    return new Response('Not found', { status: 404 });
  },
};

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server); // hibernation API: sockets survive while the object sleeps

    // A newcomer (typically TouchDesigner after a restart) gets the last known state right away
    const last = await this.ctx.storage.get('lastState');
    if (last) server.send(last);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > 32768) return;

    let type = null;
    try { type = JSON.parse(message).type; } catch (e) { return; }
    if (type === 'ping') return;                       // keep-alive only
    if (type === 'state') await this.ctx.storage.put('lastState', message);

    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws) other.send(message);
    }
  }

  webSocketClose(ws, code) {
    ws.close(code === 1005 ? 1000 : code, 'closing');
  }
}
