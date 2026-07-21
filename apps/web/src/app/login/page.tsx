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
        <div className="container mx-auto flex items-center justify-center min-h-screen p-4">
            <Card className="w-full max-w-md p-6">
                <div className="flex border-b mb-6" role="tablist">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={mode === "login"}
                        disabled={isPending}
                        className={`flex-1 py-2 text-center text-sm font-medium border-b-2 transition-colors ${
                            mode === "login"
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => handleModeSwitch("login")}
                    >
                        Login
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={mode === "signup"}
                        disabled={isPending}
                        className={`flex-1 py-2 text-center text-sm font-medium border-b-2 transition-colors ${
                            mode === "signup"
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => handleModeSwitch("signup")}
                    >
                        Sign up
                    </button>
                </div>

                <div
                    role="alert"
                    aria-live="polite"
                    className={`text-sm text-destructive font-medium min-h-[1.5rem] mb-4 ${
                        errorMessage ? "block" : "hidden"
                    }`}
                >
                    {errorMessage}
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {mode === "signup" && (
                        <div className="space-y-1">
                            <label
                                htmlFor="username"
                                className="text-sm font-medium text-foreground"
                            >
                                Username
                            </label>
                            <Input
                                id="username"
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
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

                    <div className="space-y-1">
                        <label
                            htmlFor="email"
                            className="text-sm font-medium text-foreground"
                        >
                            Email
                        </label>
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

                    <div className="space-y-1">
                        <label
                            htmlFor="password"
                            className="text-sm font-medium text-foreground"
                        >
                            Password
                        </label>
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

                <div className="relative my-6">
                    <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-card px-2 text-muted-foreground">
                            Or
                        </span>
                    </div>
                </div>

                {isDevelopment ? (
                    <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={handleDevLogin}
                        disabled={isPending}
                    >
                        {devPending ? "Signing in..." : "Continue as Dev User"}
                    </Button>
                ) : (
                    <div className="flex justify-center">
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
        </div>
    );
}
