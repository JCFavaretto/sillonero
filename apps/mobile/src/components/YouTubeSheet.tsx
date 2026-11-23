import type { BrowserFailure, BrowserItem } from "@proyecto-e/protocol";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { browserActions } from "@/browser/actions";
import type { YouTubeTab } from "@/browser/match";
import { ListRow, ListState } from "@/components/BrowserRows";
import { Sheet } from "@/components/Sheet";
import { AppText, Button, Notice } from "@/components/ui";
import { tap } from "@/haptics";
import { useMounted } from "@/useMounted";
import { colors, radius, spacing, touch, type } from "@/theme";

export type YouTubeSection = "queue" | "search" | "lists";
type Loaded<T> = { items: T } | { error: BrowserFailure | "offline" } | null;

const AFTER_PLAY_REFRESH_MS = 1_500;

/**
 * Cola, buscador y "mis listas" de YouTube y YouTube Music (boceto comodidad 04 y 06). Todo se manda a la pestaña de YouTube
 * por la extensión: no se trae nada al frente, así quien está jugando en la PC no pierde el foco. Un toque en un tema o un
 * resultado lo pone a sonar.
 */
export function YouTubeSheet({ yt, initial = "queue", onClose }: { yt: YouTubeTab | null; initial?: YouTubeSection; onClose: () => void }) {
  const { t } = useTranslation();
  const music = yt?.site === "youtubeMusic";
  const [section, setSection] = useState<YouTubeSection>(music && initial !== "queue" ? "queue" : initial);
  const [queue, setQueue] = useState<Loaded<BrowserItem[]>>(null);
  const [results, setResults] = useState<Loaded<BrowserItem[]>>(null);
  const [lists, setLists] = useState<Loaded<BrowserItem[]>>(null);
  const [text, setText] = useState("");
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "info" | "danger" } | null>(null);
  const mounted = useMounted();
  /** Qué secciones ya se pidieron (para no pedir dos veces lo mismo mientras llega la respuesta). */
  const asked = useRef(new Set<YouTubeSection>());

  const tabId = yt?.tab.id ?? null;

  const queueKind = music ? ('ytm.queue' as const) : ('yt.queue' as const);

  // `null` = todavía leyendo. Cada sección se pide la primera vez que se mira y solo se guarda al llegar la respuesta.
  useEffect(() => {
    if (section === "queue" && queue === null && !asked.current.has("queue")) {
      asked.current.add("queue");
      if (tabId === null) void Promise.resolve().then(() => mounted.current && setQueue({ error: "failed" }));
      else
        void browserActions.ask({ kind: queueKind, tabId }).then((r) => {
          if (mounted.current) setQueue(r.ok ? { items: r.items } : { error: r.reason });
        });
    }
    if (section === "lists" && lists === null && !asked.current.has("lists")) {
      asked.current.add("lists");
      void browserActions.ask({ kind: "yt.lists" }).then((r) => {
        if (mounted.current) setLists(r.ok ? { items: r.items } : { error: r.reason });
      });
    }
  }, [section, queue, lists, tabId, queueKind, mounted]);

  function retry(which: YouTubeSection) {
    asked.current.delete(which);
    if (which === "queue") setQueue(null);
    else if (which === "lists") setLists(null);
    else void search(text);
  }

  async function search(q: string) {
    if (!q.trim()) return;
    setSearching(true);
    const r = await browserActions.ask({ kind: "yt.search", text: q.trim() });
    if (!mounted.current) return;
    setSearching(false);
    setResults(r.ok ? { items: r.items } : { error: r.reason });
  }

  async function play(item: BrowserItem) {
    tap();
    let r;
    if (item.kind === "track" && tabId !== null) r = await browserActions.act({ op: "ytm.play", tabId, index: item.index ?? 0 });
    else if (item.kind === "list") r = await browserActions.act({ op: "yt.playList", listId: item.id, ...(tabId !== null ? { tabId } : {}) });
    else if (tabId !== null) r = await browserActions.act({ op: "yt.play", tabId, videoId: item.id, ...(item.listId && item.index !== undefined ? { listId: item.listId, index: item.index } : {}) });
    else r = await browserActions.act({ op: "tab.open", url: `https://www.youtube.com/watch?v=${item.id}`, mode: "tab" });
    if (!mounted.current) return;
    if (!r.ok) return setNotice({ text: t(r.error), tone: "danger" });
    setNotice({ text: t("browser.yt.playing", { title: item.title }), tone: "info" });
    if (section === "queue" && tabId !== null) {
      // La marca del tema pasa al nuevo: se vuelve a leer la cola un momento después.
      setTimeout(() => {
        void browserActions.ask({ kind: queueKind, tabId }).then((q) => {
          if (mounted.current && q.ok) setQueue({ items: q.items });
        });
      }, AFTER_PLAY_REFRESH_MS);
    }
  }

  const rowsOf = (data: Loaded<BrowserItem[]>, empty: string) => {
    if (!data) return null;
    if ("error" in data) return <ListState error={data.error} onRetry={() => retry(section)} />;
    if (data.items.length === 0) return <ListState empty={empty} />;
    return data.items.map((item, i) => (
      <ListRow
        key={`${item.id}-${i}`}
        testID={`yt-item-${i}`}
        label={`${item.title}${item.subtitle ? `, ${item.subtitle}` : ""}`}
        left={<Ionicons name={item.kind === "list" ? "albums-outline" : item.current ? "volume-high" : "play-circle-outline"} size={22} color={item.current ? colors.accent : colors.muted} />}
        title={item.title}
        subtitle={item.subtitle}
        meta={item.meta}
        current={item.current === true}
        onPress={() => void play(item)}
      />
    ));
  };

  const sections: YouTubeSection[] = music ? ["queue"] : ["queue", "search", "lists"];
  const submit = () => void search(text);
  const reading = (section === "queue" && queue === null) || (section === "lists" && lists === null) || (section === "search" && searching);

  return (
    <Sheet tall dismissOnBackdrop={false} onClose={onClose} testID="youtube-sheet">
      <View style={styles.head}>
        <View style={styles.grow}>
          <AppText kind="heading">{t(music ? "browser.yt.titleMusic" : "browser.yt.title")}</AppText>
          <AppText kind="small" muted>
            {t("browser.yt.background")}
          </AppText>
        </View>
        <Button kind="secondary" label={t("common.close")} onPress={onClose} style={styles.small} />
      </View>

      {sections.length > 1 && (
        <View style={styles.tabs}>
          {sections.map((k) => (
            <Button key={k} kind={section === k ? "primary" : "secondary"} selected={section === k} label={t(`browser.yt.${k}`)} onPress={() => setSection(k)} style={styles.seg} />
          ))}
        </View>
      )}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {section === "search" && (
        <View style={styles.searchRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t("browser.yt.searchHint")}
            placeholderTextColor={colors.muted}
            selectionColor={colors.accent}
            style={styles.field}
            accessibilityLabel={t("browser.yt.searchHint")}
            autoFocus
            returnKeyType="search"
            onSubmitEditing={submit}
            maxLength={100}
          />
          <Button label={t("browser.yt.searchGo")} disabled={!text.trim() || searching} onPress={submit} style={styles.small} />
        </View>
      )}

      <ListState loading={reading} />
      {!reading && section === "queue" && rowsOf(queue, t("browser.yt.queueEmpty"))}
      {!reading && section === "search" && (results ? rowsOf(results, t("browser.yt.noResults", { text })) : <ListState empty={t("browser.yt.searchFirst")} />)}
      {!reading && section === "lists" && rowsOf(lists, t("browser.yt.listsEmpty"))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  grow: { flex: 1, minWidth: 0 },
  small: { minHeight: 48, paddingHorizontal: spacing.lg },
  tabs: { flexDirection: "row", gap: spacing.sm },
  seg: { flex: 1, minHeight: 48 },
  searchRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  field: { ...type.body, flex: 1, minHeight: touch, borderWidth: 1.5, borderColor: colors.accent, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.text },
});
