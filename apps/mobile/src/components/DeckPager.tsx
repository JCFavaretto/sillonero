import { useEffect, useRef, useState, type ReactNode } from "react";
import { type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, type ScrollViewInstance, StyleSheet, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import type { Deck } from "@/decks/model";
import { AppText } from "@/components/ui";
import { useLayout } from "@/layout/useLayout";
import { colors, radius, spacing, touch } from "@/theme";

/** La tira con los nombres de los decks (boceto rediseño 04 A): el elegido en ámbar; se desliza si no entran. */
export function DeckChips({ decks, currentId, onSelect, onMore }: { decks: Deck[]; currentId: string; onSelect: (id: string) => void; onMore?: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.chipsRow}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.grow}>
        {decks.map((d) => (
          <Pressable key={d.id} testID={`chip-${d.id}`} accessibilityRole="button" accessibilityLabel={d.name} accessibilityState={{ selected: d.id === currentId }} onPress={() => onSelect(d.id)} style={[styles.chip, d.id === currentId && styles.chipOn]}>
            <AppText kind="small" numberOfLines={1} style={{ color: d.id === currentId ? colors.accent : colors.text }}>
              {d.name}
            </AppText>
          </Pressable>
        ))}
      </ScrollView>
      {onMore && (
        <Pressable testID="chips-more" accessibilityRole="button" accessibilityLabel={t("decks.tabs")} onPress={onMore} style={styles.chip}>
          <AppText kind="small">☰</AppText>
        </Pressable>
      )}
    </View>
  );
}

/** Los puntos de abajo: en cuál de los decks estás. */
export function DeckDots({ count, index }: { count: number; index: number }) {
  const { t } = useTranslation();
  if (count < 2) return null;
  return (
    <View testID="deck-dots" accessible accessibilityLabel={t("decks.page", { n: index + 1, total: count })} style={styles.dots}>
      {Array.from({ length: Math.min(count, 12) }, (_, i) => (
        <View key={i} style={[styles.dot, i === Math.min(index, 11) && styles.dotOn]} />
      ))}
    </View>
  );
}

/**
 * Los decks, uno por página: se pasa de uno a otro deslizando al costado. Solo se dibuja el deck a la vista y sus vecinos (hay
 * hasta 32). Con "reducir movimiento" el salto al elegir un nombre es directo. Mientras se edita no se desliza.
 */
export function DeckPager({ decks, index, scrollEnabled, onIndex, renderDeck }: { decks: Deck[]; index: number; scrollEnabled: boolean; onIndex: (i: number) => void; renderDeck: (deck: Deck, active: boolean) => ReactNode }) {
  const reduce = useReducedMotion();
  const { width: screenWidth } = useLayout();
  const [width, setWidth] = useState(0);
  const ref = useRef<ScrollViewInstance>(null);
  const w = width || screenWidth;
  const last = useRef(index);
  const prevIndex = useRef(index);

  // Si el deck cambia desde afuera (un nombre de la tira, la lista), la página se mueve hasta ahí.
  useEffect(() => {
    if (last.current === index) return;
    last.current = index;
    // Un salto de más de una página (un nombre lejano, la lista) no se anima: pasar por páginas en blanco se vería roto.
    const far = Math.abs(index - prevIndex.current) > 1;
    prevIndex.current = index;
    ref.current?.scrollTo({ x: index * w, animated: !reduce && !far });
  }, [index, w, reduce]);

  // Al rotar cambia el ancho de página: se vuelve a la página de ahora sin animar (`contentOffset` solo vale al montar).
  useEffect(() => {
    ref.current?.scrollTo({ x: last.current * w, animated: false });
  }, [w]);

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.max(0, Math.min(decks.length - 1, Math.round(e.nativeEvent.contentOffset.x / w)));
    last.current = i;
    if (i !== index) onIndex(i);
  };

  return (
    <ScrollView
      ref={ref}
      testID="deck-pager"
      horizontal
      pagingEnabled
      scrollEnabled={scrollEnabled && decks.length > 1}
      showsHorizontalScrollIndicator={false}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onMomentumScrollEnd={settle}
      contentOffset={{ x: index * w, y: 0 }}
    >
      {decks.map((d, i) => (
        <View key={d.id} testID={`page-${d.id}`} style={{ width: w }} importantForAccessibility={i === index ? "auto" : "no-hide-descendants"} accessibilityElementsHidden={i !== index}>
          {Math.abs(i - index) <= 1 ? renderDeck(d, i === index) : null}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  chipsRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  chips: { gap: spacing.sm, paddingVertical: 2 },
  chip: { minHeight: touch, minWidth: 48, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, paddingVertical: spacing.xs },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotOn: { width: 16, backgroundColor: colors.accent },
});
