import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { RequestListener } from "node:http";
import { createServer } from "node:http";

export const withHttpServer = async (
    listener: RequestListener,
    run: (baseUrl: string) => Promise<void>
): Promise<void> => {
    const server = createServer(listener);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    try {
        await run(`http://127.0.0.1:${port}`);
    } finally {
        server.close();
        await once(server, "close");
    }
};

export const firstSessionCookie = (response: Response): string => {
    const headers = response.headers as Headers & {
        getSetCookie?: () => string[];
    };
    const cookies = headers.getSetCookie?.() ?? [];
    const session = cookies.find(
        (cookie: string) =>
            cookie.startsWith("__Host-reader_session=") ||
            cookie.startsWith("reader_session=")
    );
    if (!session) {
        throw new Error("Expected a session cookie in the response");
    }
    return session.split(";", 1)[0]!;
};
