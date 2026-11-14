import { WebSocket } from "ws";
import type { AzureConnectionConfig } from "./types.js";

export interface RelayOptions {
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
  onMessage?: (direction: "client-to-azure" | "azure-to-client", text: string) => void;
  /** Limit messages waiting for authentication and the upstream handshake. */
  maxPendingBytes?: number;
  createSocket?: (connection: AzureConnectionConfig) => WebSocket;
}

/** Relay the persistent control channel, including SDP sent before Azure connects. */
export async function relayWebSocket(
  client: WebSocket,
  getConnection: () => Promise<AzureConnectionConfig>,
  options: RelayOptions = {}
): Promise<void> {
  let upstream: WebSocket | undefined;
  let ended = false;
  let pendingBytes = 0;
  const pending: string[] = [];
  const maxPendingBytes = options.maxPendingBytes ?? 1024 * 1024;

  const finish = (): void => {
    if (ended) return;
    ended = true;
    pending.length = 0;
    pendingBytes = 0;
    if (upstream?.readyState === WebSocket.CONNECTING) upstream.terminate();
    else if (upstream?.readyState === WebSocket.OPEN) upstream.close();
    if (client.readyState === WebSocket.OPEN) client.close();
    options.onClose?.();
  };

  const fail = (error: Error): void => {
    if (ended) return;
    options.onError?.(error);
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "error", error: { message: error.message } }));
    }
    finish();
  };

  // Register before awaiting credentials: the proxy has already accepted the browser.
  client.on("close", finish);
  client.on("error", fail);
  client.on("message", (data) => {
    if (ended) return;
    const text = data.toString();
    options.onMessage?.("client-to-azure", text);
    if (upstream?.readyState === WebSocket.OPEN) {
      upstream.send(text);
    } else {
      pendingBytes += Buffer.byteLength(text);
      if (pendingBytes > maxPendingBytes) {
        fail(new Error("Pending control messages exceed the connection buffer limit"));
        return;
      }
      pending.push(text);
    }
  });

  try {
    const connection = await getConnection();
    if (ended || client.readyState !== WebSocket.OPEN) {
      finish();
      return;
    }
    upstream = options.createSocket
      ? options.createSocket(connection)
      : new WebSocket(connection.url, connection.protocols ?? [], {
          headers: connection.headers,
          handshakeTimeout: 15000,
        });
    upstream.on("error", fail);
    upstream.on("close", finish);
    upstream.on("message", (data) => {
      if (ended || client.readyState !== WebSocket.OPEN) return;
      const text = data.toString();
      options.onMessage?.("azure-to-client", text);
      client.send(text);
    });
    upstream.once("open", () => {
      if (ended || client.readyState !== WebSocket.OPEN) {
        finish();
        return;
      }
      for (const text of pending) upstream?.send(text);
      pending.length = 0;
      pendingBytes = 0;
      options.onOpen?.();
    });
  } catch (error) {
    fail(error instanceof Error ? error : new Error("Upstream connection failed"));
  }
}
