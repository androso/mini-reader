"use client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useDevSignIn, useGoogleSignIn, useUser } from "@/lib/auth";
import { useGoogleLogin } from "@react-oauth/google";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { useEffect } from "react";

export default function Login() {
    const router = useRouter();
    const isDevelopment = process.env.NODE_ENV === "development";
    const { data: userData, status: userStatus } = useUser();
    const {
        mutateAsync: signIn,
        isPending: googlePending,
        status: googleStatus,
    } = useGoogleSignIn();
    const {
        mutateAsync: signInDev,
        isPending: devPending,
        status: devStatus,
    } = useDevSignIn();

    const login = useGoogleLogin({
        onSuccess: async (codeResponse) => {
            await signIn(codeResponse.access_token);
            router.push("/");
        },
        onError: (error) => {
            console.error("Login Failed:", error);
        },
    });

    const loginDevUser = async () => {
        await signInDev();
        router.push("/");
    };

    useEffect(() => {
        if (userStatus == "success" && userData) {
            router.push("/");
        }
    }, [userStatus, userData]);

    // Show loading state while redirecting
    if (
        userStatus == "pending" &&
        (googlePending ||
            googleStatus == "success" ||
            devPending ||
            devStatus == "success")
    ) {
        return <LoadingSpinner />;
    }

    return (
        <div className="container mx-auto flex items-center justify-center min-h-screen">
            <Card className="w-full max-w-md p-6">
                <h1 className="text-2xl font-semibold text-center mb-6">
                    Login
                </h1>
                {isDevelopment ? (
                    <Button
                        className="w-full"
                        onClick={loginDevUser}
                        disabled={devPending}
                    >
                        {devPending ? "Signing in..." : "Continue as Dev User"}
                    </Button>
                ) : (
                    <GoogleSignInButton
                        onClick={() => {
                            login();
                        }}
                        isLoading={googlePending}
                    />
                )}
            </Card>
        </div>
    );
}
