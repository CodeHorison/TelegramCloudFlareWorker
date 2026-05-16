import { connect } from "cloudflare:sockets";

const encoder = new TextEncoder();

function toBytes(data) {
	if (data instanceof Uint8Array) {
		return data;
	}

	if (data instanceof ArrayBuffer) {
		return new Uint8Array(data);
	}

	if (ArrayBuffer.isView(data)) {
		return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	}

	if (typeof data === "string") {
		return encoder.encode(data);
	}

	if (data && typeof data.arrayBuffer === "function") {
		return data.arrayBuffer().then(function (ab) {
			return new Uint8Array(ab);
		});
	}

	return new Uint8Array();
}

function isIPv4(host) {
	const parts = host.split(".");

	if (parts.length !== 4) {
		return false;
	}

	for (let i = 0; i < parts.length; i += 1) {
		const part = parts[i];

		if (!/^\d{1,3}$/.test(part)) {
			return false;
		}

		const value = Number(part);
		if (value < 0 || value > 255) {
			return false;
		}

		if (part.length > 1 && part[0] === "0") {
			return false;
		}
	}

	return true;
}

function isHostname(host) {
	if (host.length > 253) {
		return false;
	}

	const labels = host.split(".");

	if (labels.length < 2) {
		return false;
	}

	for (let i = 0; i < labels.length; i += 1) {
		const label = labels[i];

		if (label.length < 1 || label.length > 63) {
			return false;
		}

		if (label[0] === "-" || label[label.length - 1] === "-") {
			return false;
		}

		if (!/^[a-z0-9-]+$/.test(label)) {
			return false;
		}
	}

	return true;
}

function normalizeDst(dst) {
	if (typeof dst !== "string") {
		return null;
	}

	const host = dst.trim().toLowerCase();

	if (!host) {
		return null;
	}

	if (
		host.includes("://") ||
		host.includes("/") ||
		host.includes("\\") ||
		host.includes("?") ||
		host.includes("#") ||
		host.includes("@") ||
		host.includes(" ") ||
		host.includes("\t") ||
		host.includes("\n") ||
		host.includes("\r")
	) {
		return null;
	}

	if (isIPv4(host) || isHostname(host)) {
		return host;
	}

	return null;
}

export default {
	async fetch(request) {
		if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
			return new Response("Expected websocket", { status: 426 });
		}

		const url = new URL(request.url);
		if (url.pathname !== "/apiws") {
			return new Response("Not found", { status: 404 });
		}

		const dst = normalizeDst(url.searchParams.get("dst"));
		if (!dst) {
			return new Response("Invalid dst", { status: 400 });
		}

		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];
		server.accept();

		let socket;
		let tcpReader;
		let tcpWriter;
		let closed = false;
		let writeQueue = Promise.resolve();

		function cleanup(code, reason) {
			if (closed) {
				return;
			}

			closed = true;

			try {
				server.removeEventListener("message", onMessage);
				server.removeEventListener("close", onClose);
				server.removeEventListener("error", onError);
			} catch {}

			try {
				if (tcpReader) {
					tcpReader.releaseLock();
				}
			} catch {}

			try {
				if (tcpWriter) {
					tcpWriter.releaseLock();
				}
			} catch {}

			try {
				if (tcpWriter) {
					void tcpWriter.close();
				}
			} catch {}

			try {
				if (socket) {
					socket.close();
				}
			} catch {}

			try {
				if (server.readyState === WebSocket.OPEN) {
					if (typeof code === "number") {
						server.close(code, reason);
					} else {
						server.close();
					}
				}
			} catch {}
		}

		function onClose() {
			cleanup(1000, "closed");
		}

		function onError() {
			cleanup(1011, "websocket error");
		}

		function onMessage(event) {
			if (closed) {
				return;
			}

			writeQueue = writeQueue
				.then(function () {
					return toBytes(event.data);
				})
				.then(function (bytes) {
					if (closed) {
						return;
					}

					return tcpWriter.write(bytes);
				})
				.catch(function () {
					cleanup(1011, "tcp write failed");
				});
		}

		server.addEventListener("close", onClose);
		server.addEventListener("error", onError);
		server.addEventListener("message", onMessage);

		try {
			socket = connect({
				hostname: dst,
				port: 443,
			});
			tcpReader = socket.readable.getReader();
			tcpWriter = socket.writable.getWriter();
		} catch {
			cleanup(1011, "tcp connect failed");
			return new Response("Bad gateway", { status: 502 });
		}

		(async function () {
			try {
				while (!closed) {
					const result = await tcpReader.read();

					if (result.done) {
						break;
					}

					if (result.value && !closed && server.readyState === WebSocket.OPEN) {
						server.send(result.value);
					}
				}
			} catch {
				cleanup(1011, "tcp read failed");
				return;
			} finally {
				cleanup(1000, "done");
			}
		})();

		return new Response(null, { status: 101, webSocket: client });
	},
};
