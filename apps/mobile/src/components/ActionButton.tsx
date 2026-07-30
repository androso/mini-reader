import { Feather } from "@expo/vector-icons";
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    ViewStyle,
} from "react-native";
import { useState } from "react";
import { color, radius, space, type } from "@/theme/tokens";

type Props = {
    label: string;
    onPress(): void;
    icon?: keyof typeof Feather.glyphMap;
    tone?: "primary" | "secondary" | "quiet" | "danger";
    disabled?: boolean;
    loading?: boolean;
    error?: boolean;
    success?: boolean;
    compact?: boolean;
    style?: ViewStyle;
    accessibilityHint?: string;
};

export const ActionButton = ({
    label,
    onPress,
    icon,
    tone = "primary",
    disabled = false,
    loading = false,
    error = false,
    success = false,
    compact = false,
    style,
    accessibilityHint,
}: Props) => {
    const [focused, setFocused] = useState(false);
    const [hovered, setHovered] = useState(false);
    const unavailable = disabled || loading;
    const stateIcon = loading
        ? null
        : error
          ? "alert-circle"
          : success
            ? "check"
            : icon;
    const contentColor =
        tone === "primary" || tone === "quiet"
            ? color.darkInk
            : tone === "danger"
              ? color.coral
              : color.ink;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityHint={accessibilityHint}
            accessibilityState={{
                disabled: unavailable,
                busy: loading,
            }}
            disabled={unavailable}
            onPress={onPress}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onHoverIn={() => setHovered(true)}
            onHoverOut={() => setHovered(false)}
            style={({ pressed }) => [
                styles.base,
                compact && styles.compact,
                tone === "primary" && styles.primary,
                tone === "secondary" && styles.secondary,
                tone === "quiet" && styles.quiet,
                tone === "danger" && styles.danger,
                hovered && !unavailable && styles.hovered,
                focused && styles.focused,
                pressed && !unavailable && styles.pressed,
                unavailable && styles.disabled,
                error && styles.error,
                success && styles.success,
                style,
            ]}
        >
            {loading ? (
                <ActivityIndicator size="small" color={contentColor} />
            ) : (
                stateIcon && (
                    <Feather name={stateIcon} size={18} color={contentColor} />
                )
            )}
            <Text
                numberOfLines={1}
                style={[
                    styles.label,
                    tone === "primary" && styles.primaryLabel,
                    tone === "danger" && styles.dangerLabel,
                    tone === "quiet" && styles.quietLabel,
                ]}
            >
                {loading ? "Working…" : label}
            </Text>
        </Pressable>
    );
};

const styles = StyleSheet.create({
    base: {
        minHeight: 48,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color.rule,
        backgroundColor: color.paper,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: space.xs,
    },
    compact: { minHeight: 44, paddingHorizontal: space.sm },
    primary: {
        backgroundColor: color.accent,
        borderColor: color.accent,
    },
    secondary: { backgroundColor: color.paper2 },
    quiet: {
        backgroundColor: color.darkRaised,
        borderColor: color.darkRaised,
    },
    danger: {
        backgroundColor: color.transparent,
        borderColor: color.coral,
    },
    hovered: { transform: [{ translateY: -1 }] },
    focused: {
        borderColor: color.focus,
        shadowColor: color.focus,
        shadowOpacity: 0.5,
        shadowRadius: 0,
        shadowOffset: { width: 0, height: 0 },
        elevation: 2,
    },
    pressed: {
        transform: [{ translateY: 1 }],
    },
    disabled: { opacity: 0.5 },
    error: { borderColor: color.coral },
    success: { borderColor: color.accent },
    label: {
        color: color.ink,
        fontFamily: type.semibold,
        fontSize: 15,
    },
    primaryLabel: { color: color.darkInk },
    quietLabel: { color: color.darkInk },
    dangerLabel: { color: color.coral },
});
