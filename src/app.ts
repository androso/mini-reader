import express from "express";
import dotenv from "dotenv";
import authRoutes from "./routes/Auth.routes";
import userRoutes from "./routes/User.routes";
import bookRoutes from "./routes/Book.routes";
import cors from "cors";
import { logger } from "./middleware/logger";
import { queryController } from "./controllers/QueryControllers";
dotenv.config();

const app = express();
if (!process.env.FRONTEND_URL) {
	console.warn("FRONTEND_URL not set, CORS is not enabled");
}

app.use(
	cors({
		origin: process.env.FRONTEND_URL || false,
		methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
		allowedHeaders: ["Content-Type", "Authorization"],
		credentials: true,
	}),
);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(logger);

app.get("/", (req, res) => {
	res.send("Hello World");
});
app.post("/query", (req, res) => queryController.handleQuery(req, res));
app.delete(
	"/collection/:collectionName",
	queryController.handleDelete.bind(queryController),
);

// auth routes
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/books", bookRoutes)
export default app;
