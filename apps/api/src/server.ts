import http, { RequestListener, Server } from "http";
import { shutdownLangfuseTracing } from "./observability/langfuse";
import {
    startBookProcessingRunner,
    stopBookProcessingRunner,
} from "./services/BookProcessingRunner";
import { pool } from "./db";

const PORT = process.env.PORT || 3000;
const SHUTDOWN_TIMEOUT_MS = 10000;

export function startHttpServer(
    requestListener: RequestListener,
    closeRequestHandler?: () => Promise<void>
): Server {
    const server = http.createServer(requestListener);

    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        startBookProcessingRunner();
    });

    let isShuttingDown = false;

    const shutdown = (signal: NodeJS.Signals) => {
        if (isShuttingDown) return;
        isShuttingDown = true;

        console.log(`Received ${signal}; closing API server`);

        const timeout = setTimeout(() => {
            console.error("Graceful shutdown timed out");
            process.exit(1);
        }, SHUTDOWN_TIMEOUT_MS);
        timeout.unref();

        server.close(async (error) => {
            if (error) {
                console.error("Error closing API server", error);
            }

            await stopBookProcessingRunner();
            if (closeRequestHandler) {
                try {
                    await closeRequestHandler();
                } catch (closeError) {
                    console.error("Error closing request handler", closeError);
                }
            }
            await shutdownLangfuseTracing();
            await pool.end();
            clearTimeout(timeout);
            process.exit(error ? 1 : 0);
        });
    };

    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);

    return server;
}
