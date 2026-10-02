import { useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/providers/language-provider';
import logoImage from '@/assets/images/logo.png';

interface ChatMessage {
  id: string;
  text: string;
  sentAt: number;
}

export default function ChatScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');

  const canSend = draft.trim().length > 0;

  const send = () => {
    if (!canSend) {
      return;
    }
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-${prev.length}`, text: draft.trim(), sentAt: Date.now() },
    ]);
    setDraft('');
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <FlatList
        data={messages}
        keyExtractor={(message) => message.id}
        contentContainerStyle={[styles.list, messages.length === 0 && styles.listEmpty]}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Image
              source={logoImage}
              style={styles.logo}
              accessibilityLabel={t('app.name')}
            />
            <ThemedText type="small" themeColor="textSecondary">
              {t('chat.empty')}
            </ThemedText>
          </View>
        }
        renderItem={({ item }) => (
          <ThemedView type="backgroundElement" style={styles.bubble}>
            <ThemedText type="smallBold">{t('chat.you')}</ThemedText>
            <ThemedText type="small">{item.text}</ThemedText>
          </ThemedView>
        )}
      />
      <View style={styles.composer}>
        <TextInput
          style={[
            styles.input,
            {
              color: theme.text,
              borderColor: theme.backgroundSelected,
              backgroundColor: theme.backgroundElement,
            },
          ]}
          value={draft}
          onChangeText={setDraft}
          placeholder={t('chat.inputPlaceholder')}
          placeholderTextColor={theme.textSecondary}
          accessibilityLabel={t('chat.inputPlaceholder')}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('chat.send')}
          onPress={send}
          disabled={!canSend}
          style={[styles.sendButton, !canSend && styles.disabled]}
        >
          <ThemedText type="smallBold" themeColor="textInverse">
            {t('chat.send')}
          </ThemedText>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  list: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  listEmpty: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.three,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 16,
  },
  bubble: {
    borderRadius: Spacing.three,
    padding: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
    gap: Spacing.half,
    maxWidth: '90%',
  },
  composer: {
    flexDirection: 'row',
    gap: Spacing.two,
    padding: Spacing.three,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  sendButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: Spacing.two,
    // Brand-gold primary button with an inverse (white) label.
    backgroundColor: '#B45309',
  },
  disabled: {
    opacity: 0.5,
  },
});
