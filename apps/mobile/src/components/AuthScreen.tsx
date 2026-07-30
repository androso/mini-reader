import { useState } from "react";
import {
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from "react-native";
import { Link } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActionButton } from "./ActionButton";
import { FormField } from "./FormField";
import { ApiError } from "@/lib/api";
import { color, radius, space, type } from "@/theme/tokens";
import { useSession } from "@/providers/SessionProvider";

type Props = { mode: "login" | "signup" };

const emailError = (email: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
        ? null
        : "Use a complete email address, such as reader@example.com.";
const passwordError = (password: string) =>
    password.length >= 8
        ? null
        : "Use at least 8 characters so the password can be accepted.";
const usernameError = (username: string) =>
    /^[A-Za-z0-9_]{3,30}$/.test(username.trim())
        ? null
        : "Use 3–30 letters, numbers, or underscores.";

export const AuthScreen = ({ mode }: Props) => {
    const { width } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const { signIn, signUp } = useSession();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [username, setUsername] = useState("");
    const [touched, setTouched] = useState<Record<string, boolean>>({});
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const errors = {
        email: emailError(email),
        password: passwordError(password),
        username: mode === "signup" ? usernameError(username) : null,
    };
    const invalid = Object.values(errors).some(Boolean);
    const submit = async () => {
        setTouched({ email: true, password: true, username: true });
        if (invalid) return;
        setLoading(true);
        setError("");
        try {
            if (mode === "signup") {
                await signUp({ email, password, username });
            } else {
                await signIn({ email, password });
            }
        } catch (caught) {
            setError(
                caught instanceof ApiError
                    ? caught.message
                    : "Mentarie couldn’t reach the Reader API. Check the connection and try again."
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <KeyboardAvoidingView
            style={styles.root}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
            <StatusBar style="dark" />
            <ScrollView
                contentContainerStyle={[
                    styles.scroll,
                    width >= 768 && styles.scrollTablet,
                    {
                        paddingTop: insets.top + space.lg,
                        paddingBottom: insets.bottom + space.lg,
                    },
                ]}
                keyboardShouldPersistTaps="handled"
            >
                <View style={[styles.purpose, width >= 768 && styles.column]}>
                    <Text style={styles.mark}>M</Text>
                    <Text style={styles.wordmark}>Mentarie</Text>
                    <Text style={styles.purposeTitle}>
                        Read the book. Keep the question beside it.
                    </Text>
                    <Text style={styles.purposeCopy}>
                        Your library, progress, offline copies, and grounded
                        conversations stay together across iPhone, iPad, and
                        Android.
                    </Text>
                </View>
                <View style={[styles.form, width >= 768 && styles.column]}>
                    <Text style={styles.title}>
                        {mode === "login" ? "Sign in" : "Create account"}
                    </Text>
                    {mode === "signup" && (
                        <FormField
                            label="Username"
                            value={username}
                            onChangeText={setUsername}
                            autoCapitalize="none"
                            autoComplete="username-new"
                            helper="Letters, numbers, and underscores."
                            error={errors.username}
                            touched={touched.username}
                            onBlur={() =>
                                setTouched((value) => ({
                                    ...value,
                                    username: true,
                                }))
                            }
                        />
                    )}
                    <FormField
                        label="Email address"
                        value={email}
                        onChangeText={setEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoComplete="email"
                        textContentType="emailAddress"
                        helper="Use the address attached to your library."
                        error={errors.email}
                        touched={touched.email}
                        onBlur={() =>
                            setTouched((value) => ({
                                ...value,
                                email: true,
                            }))
                        }
                    />
                    <FormField
                        label="Password"
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                        autoComplete={
                            mode === "login"
                                ? "current-password"
                                : "new-password"
                        }
                        textContentType={
                            mode === "login" ? "password" : "newPassword"
                        }
                        helper="At least 8 characters."
                        error={errors.password}
                        touched={touched.password}
                        onBlur={() =>
                            setTouched((value) => ({
                                ...value,
                                password: true,
                            }))
                        }
                    />
                    <Text
                        accessibilityLiveRegion="polite"
                        style={styles.formError}
                    >
                        {error || " "}
                    </Text>
                    <ActionButton
                        label={mode === "login" ? "Sign in" : "Create account"}
                        icon="arrow-right"
                        onPress={() => void submit()}
                        loading={loading}
                    />
                    <Link
                        href={
                            mode === "login"
                                ? "/(auth)/signup"
                                : "/(auth)/login"
                        }
                        style={styles.link}
                    >
                        {mode === "login"
                            ? "Create an account"
                            : "Sign in instead"}
                    </Link>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: color.paper },
    scroll: {
        flexGrow: 1,
        padding: space.lg,
        justifyContent: "center",
        gap: space.xl,
    },
    scrollTablet: {
        flexDirection: "row",
        alignItems: "stretch",
        padding: space.xl,
    },
    column: { flex: 1, maxWidth: 560 },
    purpose: { gap: space.md, justifyContent: "center" },
    mark: {
        width: 48,
        height: 48,
        borderRadius: radius.pill,
        backgroundColor: color.accent,
        color: color.darkInk,
        textAlign: "center",
        textAlignVertical: "center",
        fontFamily: type.bold,
        fontSize: 20,
    },
    wordmark: {
        color: color.ink,
        fontFamily: type.bold,
        fontSize: 18,
        letterSpacing: -0.4,
    },
    purposeTitle: {
        color: color.ink,
        fontFamily: type.bold,
        fontSize: 34,
        lineHeight: 39,
        letterSpacing: -0.8,
        maxWidth: 470,
    },
    purposeCopy: {
        color: color.ink2,
        fontFamily: type.body,
        fontSize: 16,
        lineHeight: 25,
        maxWidth: 520,
    },
    form: {
        alignSelf: "center",
        width: "100%",
        maxWidth: 480,
        gap: space.sm,
        borderWidth: 1,
        borderColor: color.rule,
        borderRadius: radius.lg,
        padding: space.lg,
        backgroundColor: color.paper2,
    },
    title: {
        color: color.ink,
        fontFamily: type.bold,
        fontSize: 26,
        letterSpacing: -0.5,
        marginBottom: space.xs,
    },
    formError: {
        minHeight: 20,
        color: color.coral,
        fontFamily: type.body,
        fontSize: 13,
    },
    link: {
        minHeight: 44,
        paddingVertical: space.sm,
        textAlign: "center",
        color: color.link,
        fontFamily: type.semibold,
        fontSize: 15,
    },
});
