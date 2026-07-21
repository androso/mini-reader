import "./observability/bootstrap";
import path from "path";
import next from "next";
import type { IncomingMessage, ServerResponse } from "http";
import app from "./app";
import swaggerdocs from "./utils/swagger";
import { startHttpServer } from "./server";

async function main() {
    const nextDir = path.resolve(__dirname, "../../web");
    const nextApp = next({ dev: false, dir: nextDir });

    try {
        await nextApp.prepare();
    } catch (err) {
        console.error("Failed to prepare Next.js app", err);
        process.exit(1);
    }

    const nextHandler = nextApp.getRequestHandler();
    swaggerdocs(app);

    const isExpressRoute = (pathname: string): boolean => {
        return (
            pathname === "/api" ||
            pathname.startsWith("/api/") ||
            pathname === "/health" ||
            pathname.startsWith("/health/") ||
            pathname === "/api-docs" ||
            pathname.startsWith("/api-docs/") ||
            pathname === "/api-docs.json"
        );
    };

    const requestListener = (req: IncomingMessage, res: ServerResponse) => {
        const rawUrl = req.url || "/";
        const pathname = rawUrl.split("?")[0] || "/";

        if (isExpressRoute(pathname)) {
            app(req, res);
        } else {
            nextHandler(req, res).catch((err: unknown) => {
                console.error("Next request failed", err);
                if (!res.headersSent) {
                    res.statusCode = 500;
                    res.setHeader("Content-Type", "text/plain");
                    res.end("Internal Server Error");
                } else {
                    res.destroy();
                }
            });
        }
    };

    startHttpServer(requestListener, async () => {
        await nextApp.close();
    });
}

main().catch((err) => {
    console.error("Failed to start production server", err);
    process.exit(1);
});
