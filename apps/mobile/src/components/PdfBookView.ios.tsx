import { StyleSheet, Text, View } from "react-native";
import { IOS_PDF_UNAVAILABLE_MESSAGE } from "@/lib/bookCompatibility";
import { color, space, type } from "@/theme/tokens";

export const PdfBookView = ({
    bookId: _bookId,
    offlineUri: _offlineUri,
    initialPage: _initialPage,
    onPage: _onPage,
}: {
    bookId: string;
    offlineUri: string | null;
    initialPage: number;
    onPage(page: number): void;
}) => (
    <View
        accessibilityRole="text"
        accessibilityLabel={IOS_PDF_UNAVAILABLE_MESSAGE}
        style={styles.root}
    >
        <Text style={styles.message}>{IOS_PDF_UNAVAILABLE_MESSAGE}</Text>
    </View>
);

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: color.darkPaper,
        alignItems: "center",
        justifyContent: "center",
        padding: space.lg,
    },
    message: {
        color: color.darkInk2,
        fontFamily: type.body,
        fontSize: 16,
        lineHeight: 24,
        textAlign: "center",
    },
});
