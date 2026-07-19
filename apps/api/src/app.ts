import express from "express";
import dotenv from "dotenv";
import authRoutes from "./routes/Auth.routes";
import userRoutes from "./routes/User.routes";
import bookRoutes from "./routes/Book.routes";
import chatRoutes from "./routes/Chat.routes";
import healthRoutes from "./routes/Health.routes";
import tracker from "./routes/Tracker.routes";
import cors from "cors";
import { logger } from "./middleware/logger";
import {
    configuredFrontendOrigin,
    enforceTrustedOrigin,
    frontendCorsOptions,
} from "./middleware/csrf";
import { terminalErrorHandler } from "./middleware/errorHandler";
import { authRateLimit } from "./middleware/rateLimit";
dotenv.config();

const app = express();
// Caddy is the only trusted hop; Docker may expose it as a bridge gateway.
app.set("trust proxy", 1);
const frontendOrigin = configuredFrontendOrigin();

if (!frontendOrigin) {
    console.warn(
        "FRONTEND_URL is missing or malformed; browser mutations will be rejected"
    );
}

app.use(cors(frontendCorsOptions()));

app.use(enforceTrustedOrigin);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(logger);

app.get("/", (req, res) => {
    res.send("Hello World");
});

app.use("/health", healthRoutes);

// auth routes
app.use("/api/auth", authRateLimit, authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/books", bookRoutes);
app.use("/api", chatRoutes);
app.use("/api", tracker);
app.use(terminalErrorHandler);
export default app;
