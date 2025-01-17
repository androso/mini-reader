import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../services/AuthService";

export async function authenticate(
	req: Request,
	res: Response,
	next: NextFunction
) {
	const token = req.headers.authorization?.split(" ")[1];
	if (!token) {
		res.status(401).json({ message: "No token provided" });
		return
	}
	const user = await verifyToken(token);
	if (!user) {
		res.status(401).json({ message: "Invalid token" });
		return
	}

	req.user = user;
	next();
}
