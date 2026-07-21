"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { GoogleLogin } from "@react-oauth/google";
import {
    useUser,
    useGoogleSignIn,
    useDevSignIn,
    useEmailLogin,
    useEmailSignup,
} from "@/lib/auth";
import { BookOpenText, MessageCircleQuestion } from "lucide-react";

export default function Login() {
    const router = useRouter();
    const isDevelopment = process.env.NODE_ENV === "development";
    const { data: userData, status: userStatus } = useUser();

    const [mode, setMode] = useState<"login" | "signup">("login");
    const [email, setEmail] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const {
        mutateAsync: signInGoogle,
        isPending: googlePending,
        status: googleStatus,
    } = useGoogleSignIn();

    const {
        mutateAsync: signInDev,
        isPending: devPending,
        status: devStatus,
    } = useDevSignIn();

    const {
        mutateAsync: loginEmail,
        isPending: loginPending,
        status: loginStatus,
    } = useEmailLogin();

    const {
        mutateAsync: signupEmail,
        isPending: signupPending,
        status: signupStatus,
    } = useEmailSignup();

    const isPending =
        googlePending || devPending || loginPending || signupPending;

    useEffect(() => {
        if (userStatus === "success" && userData) {
            router.push("/");
        }
    }, [userStatus, userData, router]);

    const handleModeSwitch = (newMode: "login" | "signup") => {
        if (isPending) return;
        setMode(newMode);
        setErrorMessage(null);
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setErrorMessage(null);

        try {
            if (mode === "login") {
                await loginEmail({ email, password });
            } else {
                await signupEmail({ username, email, password });
            }
            router.push("/");
        } catch (err: unknown) {
            const message =
                err instanceof Error
                    ? err.message
                    : "An unexpected error occurred";
            setErrorMessage(message);
        }
    };

    const handleDevLogin = async () => {
        setErrorMessage(null);
        try {
            await signInDev();
            router.push("/");
        } catch (err: unknown) {
            const message =
                err instanceof Error
                    ? err.message
                    : "Dev authentication failed";
            setErrorMessage(message);
        }
    };

    if (
        userStatus === "pending" &&
        (googlePending ||
            googleStatus === "success" ||
            devPending ||
            devStatus === "success" ||
            loginPending ||
            loginStatus === "success" ||
            signupPending ||
            signupStatus === "success")
    ) {
        return <LoadingSpinner />;
    }

    return (
        <main className="auth-shell">
            <section className="auth-story" aria-labelledby="mentarie-intro">
                <div className="mentarie-wordmark flex items-center gap-3">
                    <span className="mentarie-mark" aria-hidden="true" />
                    Mentarie
                </div>
                <div>
                    <h1 id="mentarie-intro">Stay with the question.</h1>
                    <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--color-chat-muted)]">
                        Read the book in front of you, then ask about the
                        history, people, and ideas around it. Mentarie keeps the
                        full text in view while you explore beyond the page.
                    </p>
                    <div className="mt-10 grid max-w-xl gap-3 sm:grid-cols-2">
                        <div className="rounded-[var(--radius-card)] bg-[var(--color-paper-raised)] p-5 text-[var(--color-ink)]">
                            <BookOpenText className="h-6 w-6 text-[var(--color-focus)]" />
                            <p className="mt-4 font-bold">
                                Read without leaving your place
                            </p>
                        </div>
                        <div className="rounded-[var(--radius-card)] bg-[var(--color-accent)] p-5 text-[var(--color-accent-ink)]">
                            <MessageCircleQuestion className="h-6 w-6" />
                            <p className="mt-4 font-bold">
                                Ask with the whole book in context
                            </p>
                        </div>
                    </div>
                </div>
                <p className="text-sm text-[var(--color-chat-muted)]">
                    EPUB and PDF reading, grounded conversations, one workspace.
                </p>
            </section>

            <section className="auth-panel" aria-label="Account access">
                <Card className="auth-card">
                    <div className="mb-8 md:hidden">
                        <div className="mentarie-wordmark flex items-center gap-3">
                            <span
                                className="mentarie-mark"
                                aria-hidden="true"
                            />
                            Mentarie
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-2)]">
                            Read closely. Ask beyond the page.
                        </p>
                    </div>
                    <h2 className="text-2xl font-bold tracking-[-0.035em]">
                        {mode === "login"
                            ? "Welcome back"
                            : "Create your reading room"}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-2)]">
                        {mode === "login"
                            ? "Return to your books and conversations."
                            : "Keep books, questions, and context together."}
                    </p>

                    <div className="auth-tabs mt-7" role="tablist">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={mode === "login"}
                            disabled={isPending}
                            className="auth-tab"
                            onClick={() => handleModeSwitch("login")}
                        >
                            Login
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={mode === "signup"}
                            disabled={isPending}
                            className="auth-tab"
                            onClick={() => handleModeSwitch("signup")}
                        >
                            Sign up
                        </button>
                    </div>

                    <div
                        role="alert"
                        aria-live="polite"
                        className={`mt-4 min-h-6 text-sm font-medium text-[var(--color-accent-3)] ${
                            errorMessage ? "block" : "hidden"
                        }`}
                    >
                        {errorMessage}
                    </div>

                    <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                        {mode === "signup" && (
                            <div className="auth-field">
                                <label htmlFor="username">Username</label>
                                <Input
                                    id="username"
                                    type="text"
                                    value={username}
                                    onChange={(e) =>
                                        setUsername(e.target.value)
                                    }
                                    autoComplete="username"
                                    minLength={3}
                                    maxLength={30}
                                    pattern="^[A-Za-z0-9_]+$"
                                    required
                                    disabled={isPending}
                                    placeholder="reader_one"
                                />
                            </div>
                        )}

                        <div className="auth-field">
                            <label htmlFor="email">Email</label>
                            <Input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                autoComplete="email"
                                maxLength={254}
                                required
                                disabled={isPending}
                                placeholder="you@example.com"
                            />
                        </div>

                        <div className="auth-field">
                            <label htmlFor="password">Password</label>
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete={
                                    mode === "signup"
                                        ? "new-password"
                                        : "current-password"
                                }
                                minLength={8}
                                maxLength={128}
                                required
                                disabled={isPending}
                            />
                        </div>

                        <Button
                            type="submit"
                            className="w-full"
                            disabled={isPending}
                        >
                            {isPending
                                ? mode === "login"
                                    ? "Signing in..."
                                    : "Signing up..."
                                : mode === "login"
                                  ? "Sign in"
                                  : "Create account"}
                        </Button>
                    </form>

                    <div className="auth-divider my-6">or</div>

                    {isDevelopment ? (
                        <Button
                            type="button"
                            variant="outline"
                            className="w-full"
                            onClick={handleDevLogin}
                            disabled={isPending}
                        >
                            {devPending
                                ? "Signing in..."
                                : "Continue as Dev User"}
                        </Button>
                    ) : (
                        <div className="flex min-h-11 justify-center">
                            <GoogleLogin
                                onSuccess={async ({ credential }) => {
                                    if (!credential) return;
                                    setErrorMessage(null);
                                    try {
                                        await signInGoogle(credential);
                                        router.push("/");
                                    } catch (err: unknown) {
                                        const message =
                                            err instanceof Error
                                                ? err.message
                                                : "Google login failed";
                                        setErrorMessage(message);
                                    }
                                }}
                                onError={() =>
                                    setErrorMessage(
                                        "Google sign-in was cancelled or failed"
                                    )
                                }
                            />
                        </div>
                    )}
                </Card>
            </section>
        </main>
    );
}
