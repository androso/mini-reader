import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../services/AuthService";

export async function authenticate(
	req: Request,
	res: Response,
	next: NextFunction
) {
	const token = req.headers.authorization?.split(" ")[1];
	if (!token) {
		return res.status(401).json({ message: "No token provided" });
	}
	const user = await verifyToken(token);
	if (!user) {
		return res.status(401).json({ message: "Invalid token" });
	}

	req.user = user;
	next();
}
