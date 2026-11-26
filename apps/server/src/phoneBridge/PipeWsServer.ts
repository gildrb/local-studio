import * as NodeCrypto from "node:crypto";
import * as NodeNet from "node:net";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

interface PipeSocketHandlers {
  readonly onText: (text: string) => void;
  readonly onClose: () => void;
}

export class PipeSocket {
  buffer: Buffer = Buffer.alloc(0);
  fragments: Array<Buffer> = [];
  fragmentsFin = false;
  closed = false;
  socket: NodeNet.Socket;
  handlers: PipeSocketHandlers;

  constructor(socket: NodeNet.Socket, handlers: PipeSocketHandlers) {
    this.socket = socket;
    this.handlers = handlers;
    socket.on("data", (chunk: Buffer) => this.consume(chunk));
    socket.on("close", () => this.markClosed());
    socket.on("error", () => this.markClosed());
  }

  markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.handlers.onClose();
  }

  sendText(text: string): void {
    if (this.closed) return;
    const payload = Buffer.from(text, "utf8");
    if (payload.length < 126) {
      this.socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
      return;
    }
    if (payload.length < 65536) {
      this.socket.write(
        Buffer.concat([
          Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]),
          payload,
        ]),
      );
      return;
    }
    const extended = Buffer.alloc(8);
    extended.writeBigUInt64BE(BigInt(payload.length));
    this.socket.write(Buffer.concat([Buffer.from([0x81, 127]), extended, payload]));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.write(Buffer.from([0x88, 0x00]));
    this.socket.end();
  }

  consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const frame = this.readFrame();
      if (frame === undefined) return;
      if (frame.opcode === 0x8) {
        if (!this.closed) {
          this.closed = true;
          this.socket.write(Buffer.from([0x88, 0x00]));
          this.socket.end();
          this.handlers.onClose();
        }
        return;
      }
      if (frame.opcode === 0x9) {
        this.socket.write(
          Buffer.concat([Buffer.from([0x8a, frame.payload.length]), frame.payload]),
        );
        continue;
      }
      if (frame.opcode === 0xa) continue;
      if (frame.opcode === 0x1) {
        if (frame.fin) {
          this.handlers.onText(frame.payload.toString("utf8"));
        } else {
          this.fragments = [frame.payload];
          this.fragmentsFin = false;
        }
        continue;
      }
      if (frame.opcode === 0x0 && this.fragments.length > 0) {
        this.fragments.push(frame.payload);
        if (frame.fin) {
          const assembled = Buffer.concat(this.fragments);
          this.fragments = [];
          this.fragmentsFin = false;
          this.handlers.onText(assembled.toString("utf8"));
        }
      }
    }
  }

  readFrame(): { opcode: number; fin: boolean; payload: Buffer } | undefined {
    if (this.buffer.length < 2) return undefined;
    const first = this.buffer[0]!;
    const second = this.buffer[1]!;
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let offset = 2;
    let length = second & 0x7f;
    if (length === 126) {
      if (this.buffer.length < offset + 2) return undefined;
      length = this.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (this.buffer.length < offset + 8) return undefined;
      const big = this.buffer.readBigUInt64BE(offset);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
      length = Number(big);
      offset += 8;
    }
    const maskLength = masked ? 4 : 0;
    if (this.buffer.length < offset + maskLength + length) return undefined;
    const mask = masked ? this.buffer.subarray(offset, offset + 4) : undefined;
    offset += maskLength;
    const payload = Buffer.from(this.buffer.subarray(offset, offset + length));
    if (mask !== undefined) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] = payload[index]! ^ mask[index % 4]!;
      }
    }
    this.buffer = this.buffer.subarray(offset + length);
    return { opcode, fin, payload };
  }
}

export interface PipeRoutes {
  readonly onControl: (socket: NodeNet.Socket) => void;
  readonly onStream: (id: number, socket: NodeNet.Socket) => void;
}

const handshakeResponse = (key: string): string => {
  const accept = NodeCrypto.createHash("sha1")
    .update(key + WS_GUID)
    .digest("base64");
  return (
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    "\r\n"
  );
};

interface UpgradeRequest {
  readonly path: string;
  readonly token: string | undefined;
  readonly key: string | undefined;
}

const parseUpgradeRequest = (head: Buffer): UpgradeRequest | undefined => {
  const text = head.toString("utf8");
  const headerEnd = text.indexOf("\r\n\r\n");
  if (headerEnd === -1) return undefined;
  const lines = text.slice(0, headerEnd).split("\r\n");
  const requestLine = lines[0] ?? "";
  const path = requestLine.split(" ")[1];
  if (path === undefined) return undefined;
  let token: string | undefined;
  let key: string | undefined;
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name === "x-pipe-token") token = value;
    if (name === "sec-websocket-key") key = value;
  }
  return { path, token, key };
};

export const listenPipeServer = (input: {
  readonly token: string;
  readonly routes: PipeRoutes;
}): Promise<{ readonly port: number; readonly close: () => void }> => {
  const { promise, resolve, reject } = Promise.withResolvers<{
    readonly port: number;
    readonly close: () => void;
  }>();
  const server = NodeNet.createServer((socket) => {
    let pending: Buffer = Buffer.alloc(0);
    let routed = false;
    socket.on("data", (chunk: Buffer) => {
      if (routed) return;
      pending = Buffer.concat([pending, chunk]);
      const headerEnd = pending.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        if (pending.length > 16_384) socket.destroy();
        return;
      }
      routed = true;
      const request = parseUpgradeRequest(pending);
      const rest = pending.subarray(headerEnd + 4);
      pending = Buffer.alloc(0);
      if (
        request === undefined ||
        typeof request.key !== "string" ||
        request.token !== input.token
      ) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      const streamMatch = /^\/stream\/(\d+)$/.exec(request.path);
      if (request.path !== "/control" && streamMatch === null) {
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      socket.write(handshakeResponse(request.key));
      if (streamMatch !== null) {
        input.routes.onStream(Number(streamMatch[1]), socket);
      } else {
        input.routes.onControl(socket);
      }
      if (rest.length > 0) {
        socket.emit("data", rest);
      }
    });
  });
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    resolve({ port, close: () => server.close() });
  });
  return promise;
};
