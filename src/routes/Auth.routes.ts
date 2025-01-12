import express, { Router } from "express";
import { generateToken, verifyGoogleToken } from "../services/AuthService";
import { db } from "../db";
import { Users } from "../db/schema";
import { eq } from "drizzle-orm";
const router: Router = express.Router();

router.post("/google", async (req, res) => {
	try {
		const { token } = req.body;
		const payload = await verifyGoogleToken(token);
		const user = await db
			.select()
			.from(Users)
			.where(eq(Users.googleId, payload.sub));

		if (user.length === 0) {
			await db.insert(Users).values({
				googleId: payload.sub,
				email: payload.email,
				name: payload.name,
				// picture: payload.picture
			});
		} else {
			await db
				.update(Users)
				.set({ updatedAt: new Date() })
				.where(eq(Users.googleId, payload.sub));
		}
		
		const jwtToken = generateToken(user[0]);
		res.json({ token: jwtToken, user: user[0] });
	} catch (e) {
		console.error(e);
		res.status(401).json({ message: "Authentication failed" });
	}
});

export default router;
