import { router } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActionButton } from "@/components/ActionButton";
import { useReadingTheme } from "@/providers/ReadingThemeProvider";
import { useSession } from "@/providers/SessionProvider";
import { color, radius, space, type } from "@/theme/tokens";

export default function Settings() {
    const insets = useSafeAreaInsets();
    const { session, signOut } = useSession();
    const { preference, setPreference } = useReadingTheme();
    return (
        <ScrollView
            style={styles.root}
            contentContainerStyle={[
                styles.content,
                {
                    paddingTop: insets.top + space.lg,
                    paddingBottom: space.lg + insets.bottom,
                },
            ]}
        >
            <ActionButton
                label="Library"
                icon="arrow-left"
                tone="secondary"
                compact
                onPress={() => router.back()}
            />
            <Text style={styles.heading}>Settings</Text>
            <View style={styles.section}>
                <Text style={styles.title}>Reading appearance</Text>
                <Text style={styles.copy}>
                    The preference applies to the library and reader. Book text
                    keeps its own Literata reading face.
                </Text>
                <View style={styles.options}>
                    {(["system", "light", "dark"] as const).map((value) => (
                        <ActionButton
                            key={value}
                            label={
                                value.slice(0, 1).toUpperCase() + value.slice(1)
                            }
                            tone={
                                preference === value ? "primary" : "secondary"
                            }
                            compact
                            onPress={() => setPreference(value)}
                        />
                    ))}
                </View>
            </View>
            <View style={styles.section}>
                <Text style={styles.title}>Account</Text>
                <Text style={styles.copy}>{session?.user.email}</Text>
                <ActionButton
                    label="Sign out"
                    icon="log-out"
                    tone="danger"
                    onPress={() => void signOut()}
                />
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: color.darkPaper },
    content: {
        paddingHorizontal: space.lg,
        gap: space.lg,
        maxWidth: 760,
        width: "100%",
        alignSelf: "center",
    },
    heading: {
        color: color.darkInk,
        fontFamily: type.bold,
        fontSize: 34,
        letterSpacing: -0.8,
    },
    section: {
        gap: space.md,
        padding: space.lg,
        borderRadius: radius.lg,
        backgroundColor: color.darkRaised,
    },
    title: {
        color: color.darkInk,
        fontFamily: type.semibold,
        fontSize: 20,
    },
    copy: {
        color: color.darkInk2,
        fontFamily: type.body,
        fontSize: 15,
        lineHeight: 23,
    },
    options: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
});
