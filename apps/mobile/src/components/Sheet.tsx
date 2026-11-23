import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useLayout } from "@/layout/useLayout";
import { useSheetInsets } from "./useSheetInsets";
import { colors, radius, spacing } from "@/theme";

/**
 * Hoja genérica (boceto apps-escenas 03, 05, 08, 11): en vertical sube desde abajo; en apaisado es un cuadro centrado
 * (el teclado ocupa media pantalla). `tall` la hace ocupar casi todo el alto. Montarla solo cuando hay algo que mostrar.
 */
export function Sheet({
  children,
  onClose,
  tall = false,
  center = false,
  dismissOnBackdrop = true,
  testID = "sheet",
}: {
  children: ReactNode;
  onClose: () => void;
  tall?: boolean;
  /** Siempre centrada (cuadros de confirmación). */
  center?: boolean;
  /** `false` en las hojas donde se escribe: un toque afuera no descarta lo escrito (queda Cancelar y Atrás). */
  dismissOnBackdrop?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { isLandscape } = useLayout();
  const centered = isLandscape || center;
  const inset = useSheetInsets();
  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType={center ? "fade" : "slide"}
      onRequestClose={onClose}
      supportedOrientations={["portrait", "landscape"]}
    >
      <KeyboardAvoidingView behavior="padding" style={[styles.backdrop, centered ? styles.center : styles.bottom, { paddingLeft: inset.left, paddingRight: inset.right }]}>
        <Pressable accessible={false} importantForAccessibility="no" style={StyleSheet.absoluteFill} onPress={dismissOnBackdrop ? onClose : undefined} />
        <View
          testID={testID}
          style={[styles.sheet, centered ? styles.sheetCenter : styles.sheetBottom, tall && !centered && styles.tall, tall && centered && styles.tallCenter, !centered && { paddingBottom: inset.bottom }]}
        >
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  bottom: { justifyContent: "flex-end" },
  center: { justifyContent: "center", alignItems: "center" },
  sheet: { backgroundColor: colors.surface, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  sheetBottom: { borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, maxHeight: "85%" },
  sheetCenter: { width: "78%", maxHeight: "92%", borderRadius: radius.lg },
  tall: { height: "88%" },
  tallCenter: { height: "92%", width: "86%" },
  scroll: { gap: spacing.sm },
});
