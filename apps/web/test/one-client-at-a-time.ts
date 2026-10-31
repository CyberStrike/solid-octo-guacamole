import net from "node:net";

// PGlite is one Postgres session, and pglite-socket serves every client's wire
// messages on it in arrival order. The Worker's pg writes each message as it goes,
// so two clients' messages interleave, and each clobbers the other's unnamed
// statement and portal: "portal "" does not exist". On Neon every connection has
// its own session, so this is the test database's fault, never the Worker's.
//
// This proxy gives each client its own connection to pglite-socket but lets one
// client talk at a time: a client takes the turn with its first bytes and keeps
// it until the server is ready for a query outside a transaction, so a whole
// statement, or a whole BEGIN ... COMMIT, runs without another client's messages
// in between. It assumes clients don't pipeline queries, which pg doesn't.

// SSLRequest: length 8, then this code. The server answers with one bare byte.
const SSL_REQUEST = 80877103;
// ReadyForQuery ('Z'), and its status byte for "idle, not in a transaction" ('I').
const READY = 0x5a;
const IDLE = 0x49;

interface Client {
  /** What the client sent before it had the turn. */
  pending: Buffer[];
  upstream: net.Socket;
}

/**
 * Starts the proxy in front of `connectionString`'s host and port, and returns
 * the same connection string pointing at the proxy instead.
 */
export async function oneClientAtATime(
  connectionString: string,
): Promise<{ connectionString: string; close(): Promise<void> }> {
  const target = new URL(connectionString);
  let owner: Client | null = null;
  const waiting: Client[] = [];

  const give = (client: Client) => {
    owner = client;
    for (const chunk of client.pending.splice(0)) client.upstream.write(chunk);
  };
  const take = (client: Client) => {
    if (owner === null) give(client);
    else if (owner !== client && !waiting.includes(client)) waiting.push(client);
  };
  const release = (client: Client) => {
    const queued = waiting.indexOf(client);
    if (queued !== -1) waiting.splice(queued, 1);
    if (owner !== client) return;
    owner = null;
    const next = waiting.shift();
    if (next !== undefined) give(next);
  };

  const open = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    open.add(socket);
    socket.on("close", () => open.delete(socket));
    const upstream = net.connect(Number(target.port), target.hostname);
    const client: Client = { pending: [], upstream };
    let sslAnswerDue = false;
    let fromServer = Buffer.alloc(0);

    socket.on("data", (chunk) => {
      if (chunk.length >= 8 && chunk.readInt32BE(0) === 8 && chunk.readInt32BE(4) === SSL_REQUEST)
        sslAnswerDue = true;
      if (owner === client) {
        upstream.write(chunk);
      } else {
        client.pending.push(chunk);
        take(client);
      }
    });

    upstream.on("data", (chunk) => {
      socket.write(chunk);
      fromServer = Buffer.concat([fromServer, chunk]);
      if (sslAnswerDue) {
        // The one bare byte that answers an SSLRequest.
        sslAnswerDue = false;
        fromServer = fromServer.subarray(1);
        release(client);
      }
      // Every other server message: a type byte, then an int32 length that counts itself.
      let ready = false;
      while (fromServer.length >= 5) {
        const end = 1 + fromServer.readInt32BE(1);
        if (fromServer.length < end) break;
        ready = fromServer[0] === READY && fromServer[5] === IDLE;
        fromServer = fromServer.subarray(end);
      }
      if (ready) release(client);
    });

    const end = () => {
      socket.destroy();
      upstream.destroy();
      release(client);
    };
    socket.on("close", end);
    socket.on("error", end);
    upstream.on("close", end);
    upstream.on("error", end);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  // SAFETY: a TCP server listening on a port has an AddressInfo address.
  const { port } = server.address() as net.AddressInfo;
  const proxied = new URL(connectionString);
  proxied.host = `127.0.0.1:${port}`;
  return {
    connectionString: proxied.href,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        for (const socket of open) socket.destroy();
      }),
  };
}
