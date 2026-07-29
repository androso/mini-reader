import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useSession } from "@/providers/SessionProvider";
import { color } from "@/theme/tokens";

export default function Index() {
    const { session, isHydrating } = useSession();
    if (isHydrating) {
        return (
            <View style={styles.loading}>
                <ActivityIndicator color={color.accent} />
            </View>
        );
    }
    return <Redirect href={session ? "/(app)/library" : "/(auth)/login"} />;
}

const styles = StyleSheet.create({
    loading: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: color.darkPaper,
    },
});
