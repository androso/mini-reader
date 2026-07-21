import assert from "node:assert/strict";
import test from "node:test";
import type { LoginTicket, VerifyIdTokenOptions } from "google-auth-library";

process.env.JWT_SECRET ??= "test-jwt-secret";
process.env.GOOGLE_CLIENT_ID = "reader-web.apps.googleusercontent.com";

test("verifyGoogleToken returns identity from a verified ID token payload", async () => {
    const { verifyGoogleToken } = await import("../src/services/AuthService");
    const verifier = {
        async verifyIdToken(options: VerifyIdTokenOptions) {
            assert.deepEqual(options, {
                idToken: "valid-id-token",
                audience: "reader-web.apps.googleusercontent.com",
            });
            return {
                getPayload: () => ({
                    sub: "google-user-123",
                    email: "reader@example.com",
                    name: "Reader User",
                    picture: "https://example.com/avatar.png",
                }),
            } as LoginTicket;
        },
    };

    const identity = await verifyGoogleToken("valid-id-token", verifier);

    assert.deepEqual(identity, {
        sub: "google-user-123",
        email: "reader@example.com",
        name: "Reader User",
        picture: "https://example.com/avatar.png",
    });
});

test("verifyGoogleToken rejects a token for a mismatched audience", async () => {
    const { verifyGoogleToken } = await import("../src/services/AuthService");
    const verifier = {
        async verifyIdToken() {
            throw new Error(
                "Wrong recipient, payload audience != requiredAudience"
            );
        },
    };

    await assert.rejects(
        verifyGoogleToken("wrong-audience-id-token", verifier),
        /Failed to verify token/
    );
});

test("verifyGoogleToken does not log verifier errors containing the submitted token", async (t) => {
    const { verifyGoogleToken } = await import("../src/services/AuthService");
    const submittedToken = "header.payload.signature";
    const errorLog = t.mock.method(console, "error");
    const verifier = {
        async verifyIdToken() {
            throw new Error(`Invalid token: ${submittedToken}`);
        },
    };

    await assert.rejects(verifyGoogleToken(submittedToken, verifier), {
        message: "Failed to verify token",
    });
    assert.equal(errorLog.mock.callCount(), 0);
});
test("hashPassword and verifyPassword round-trip with random salts and timing safe rejection", async () => {
    const { hashPassword, verifyPassword } = await import(
        "../src/services/AuthService"
    );

    const hash1 = await hashPassword("MySecretPass123");
    const hash2 = await hashPassword("MySecretPass123");

    assert.notEqual(hash1, hash2);
    assert.match(
        hash1,
        /^scrypt\$v1\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/
    );

    const valid = await verifyPassword("MySecretPass123", hash1);
    assert.equal(valid, true);

    const wrongPass = await verifyPassword("WrongPass123", hash1);
    assert.equal(wrongPass, false);

    assert.equal(
        await verifyPassword("MySecretPass123", "invalid-hash-string"),
        false
    );
    assert.equal(
        await verifyPassword("MySecretPass123", "scrypt$v2$16384$8$1$abc$def"),
        false
    );
    assert.equal(
        await verifyPassword(
            "MySecretPass123",
            "scrypt$v1$invalid$8$1$abc$def"
        ),
        false
    );
});

test("validation helpers enforce email, username, and password bounds and formats", async () => {
    const { validateEmailInput, validateUsernameInput, validatePasswordInput } =
        await import("../src/services/AuthService");

    assert.equal(validateEmailInput("user@example.com"), null);
    assert.equal(validateEmailInput("  User@Example.COM  "), null);
    assert.equal(
        validateEmailInput("invalid-email"),
        "Enter a valid email address"
    );
    assert.equal(
        validateEmailInput("a".repeat(250) + "@example.com"),
        "Enter a valid email address"
    );

    assert.equal(validateUsernameInput("reader_1"), null);
    assert.equal(
        validateUsernameInput("ab"),
        "Username must be 3-30 characters using letters, numbers, or underscores"
    );
    assert.equal(
        validateUsernameInput("user-name!"),
        "Username must be 3-30 characters using letters, numbers, or underscores"
    );

    assert.equal(validatePasswordInput("password123"), null);
    assert.equal(
        validatePasswordInput("short"),
        "Password must be 8-128 characters"
    );
    assert.equal(
        validatePasswordInput("a".repeat(129)),
        "Password must be 8-128 characters"
    );
});

test("registerEmailUser normalizes inputs, hashes password, and creates user via repository", async () => {
    const { registerEmailUser } = await import("../src/services/AuthService");
    const mockUsers: any[] = [];

    const mockRepo = {
        async findByEmail(email: string) {
            return mockUsers.find((u) => u.email === email);
        },
        async findByUsername(username: string) {
            return mockUsers.find((u) => u.username === username);
        },
        async createUser(input: any) {
            const user = {
                id: "user-1",
                image: null,
                googleId: null,
                passwordHash: null,
                username: null,
                ...input,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            mockUsers.push(user);
            return user;
        },
    };

    const result = await registerEmailUser(
        {
            username: " Reader_One ",
            email: " READER.one@Example.COM ",
            password: "password123",
        },
        mockRepo
    );

    assert.equal(result.ok, true);
    if (result.ok) {
        assert.equal(result.user.email, "reader.one@example.com");
        assert.equal(result.user.username, "reader_one");
        assert.equal(result.user.name, "Reader_One");
        assert.notEqual((result.user as any).passwordHash, "password123");
        assert.ok((result.user as any).passwordHash?.startsWith("scrypt$v1$"));
    }
});

test("registerEmailUser returns 409 conflict for duplicate email, username, or DB 23505 error", async () => {
    const { registerEmailUser } = await import("../src/services/AuthService");

    const existingUser = {
        id: "existing-1",
        email: "existing@example.com",
        username: "existing_user",
        name: "Existing User",
        image: null,
        googleId: null,
        passwordHash: "scrypt$v1$...",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const mockRepo = {
        async findByEmail(email: string) {
            return email === "existing@example.com" ? existingUser : undefined;
        },
        async findByUsername(username: string) {
            return username === "existing_user" ? existingUser : undefined;
        },
        async createUser() {
            const err: any = new Error("Unique violation");
            err.code = "23505";
            throw err;
        },
    };

    const res1 = await registerEmailUser(
        {
            username: "new_user",
            email: "existing@example.com",
            password: "password123",
        },
        mockRepo
    );
    assert.deepEqual(res1, {
        ok: false,
        status: 409,
        message: "Email or username is already registered",
    });

    const res2 = await registerEmailUser(
        {
            username: "existing_user",
            email: "new@example.com",
            password: "password123",
        },
        mockRepo
    );
    assert.deepEqual(res2, {
        ok: false,
        status: 409,
        message: "Email or username is already registered",
    });
});

test("authenticateEmailUser performs constant-time path and returns indistinguishable 401 for unknown, Google-only, or wrong password", async () => {
    const { authenticateEmailUser, hashPassword } = await import(
        "../src/services/AuthService"
    );

    const validHash = await hashPassword("password123");
    const emailUser = {
        id: "user-email",
        email: "user@example.com",
        name: "User",
        image: null,
        username: "user_name",
        passwordHash: validHash,
        googleId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const googleOnlyUser = {
        id: "user-google",
        email: "google@example.com",
        name: "Google User",
        image: null,
        username: null,
        passwordHash: null,
        googleId: "google-123",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const mockRepo = {
        async findByEmail(email: string) {
            if (email === "user@example.com") return emailUser;
            if (email === "google@example.com") return googleOnlyUser;
            return undefined;
        },
        async findByUsername() {
            return undefined;
        },
        async createUser() {
            throw new Error("Not implemented");
        },
    };

    const success = await authenticateEmailUser(
        { email: "user@example.com", password: "password123" },
        mockRepo
    );
    assert.equal(success.ok, true);

    const wrongPass = await authenticateEmailUser(
        { email: "user@example.com", password: "wrongpassword" },
        mockRepo
    );
    assert.deepEqual(wrongPass, {
        ok: false,
        status: 401,
        message: "Invalid email or password",
    });

    const unknownUser = await authenticateEmailUser(
        { email: "unknown@example.com", password: "password123" },
        mockRepo
    );
    assert.deepEqual(unknownUser, {
        ok: false,
        status: 401,
        message: "Invalid email or password",
    });

    const googleUser = await authenticateEmailUser(
        { email: "google@example.com", password: "password123" },
        mockRepo
    );
    assert.deepEqual(googleUser, {
        ok: false,
        status: 401,
        message: "Invalid email or password",
    });
});
