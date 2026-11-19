/**
 * 转录 Service
 * 取 IndexedDB 中 addFile 已就绪的 ASR 音频（MP3 / AAC 抽轨 / 原音频）
 * → AssemblyAI（submit + id 续跑）→ 写字幕。
 */

import { useFilesStore, flushFilesStorePersist } from '@/stores/filesStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { runTranscriptionPipeline } from './transcriptionPipeline';
import { saveTranslationHistory } from './TranslationOrchestrator';
import { toAppError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { loadAsrAudioFile } from '@/utils/asrAudioStorage';
import { needsTranscriptionWork } from '@/utils/taskGuards';
import {
  asrWordsFingerprint,
  loadTaskCheckpoint,
  saveTaskCheckpoint,
} from '@/services/checkpoint';
import toast from 'react-hot-toast';

export async function startTranscription(fileId: string): Promise<void> {
  const file = useFilesStore.getState().getFile(fileId);
  if (!file || file.fileType === 'srt') return;

  if (!needsTranscriptionWork(file)) {
    logger.info('转录已完成，跳过');
    return;
  }

  const prevTr = file.phases.transcribing;
  useFilesStore.getState().updatePhase(fileId, 'transcribing', {
    status: 'active',
    progress: prevTr.transcriptId || prevTr.asrReady ? prevTr.progress : -1,
    transcriptId: prevTr.transcriptId,
    transcriptKeyFp: prevTr.transcriptKeyFp,
    asrReady: prevTr.asrReady,
    language: prevTr.language,
  });

  let asrCompleted = Boolean(prevTr.asrReady);

  try {
    const checkpoint = await loadTaskCheckpoint(file.taskId);
    const resumeWords =
      prevTr.asrReady && checkpoint?.words && checkpoint.language
        ? { words: checkpoint.words, language: checkpoint.language }
        : undefined;

    const asrFile = await loadAsrAudioFile(file.taskId);
    if (!asrFile && !resumeWords && !prevTr.transcriptId && !checkpoint?.asr?.transcriptId) {
      useFilesStore.getState().updatePhase(fileId, 'transcribing', { status: 'failed' });
      toast.error('音频缓存丢失，请重新上传文件');
      return;
    }

    const { apiKeys } = useTranscriptionStore.getState();
    if (!apiKeys.trim() && !resumeWords) {
      useFilesStore.getState().updatePhase(fileId, 'transcribing', { status: 'failed' });
      toast.error('请先在设置中配置 AssemblyAI API Key');
      return;
    }

    const { keytermGroups, subtitleLengthPreset } = useTranscriptionStore.getState();
    const task = useFilesStore.getState().tasks.find((t) => t.taskId === file.taskId);
    const groupId = task?.selectedKeytermGroupId;
    const selectedKeytermGroup = groupId
      ? keytermGroups.find((g) => g.id === groupId)
      : null;
    const allKeyterms = selectedKeytermGroup?.keyterms ?? [];

    if (selectedKeytermGroup) {
      useFilesStore.getState().updatePhase(fileId, 'transcribing', {
        keytermGroupName: selectedKeytermGroup.name,
      });
    }

    if (asrFile) {
      logger.info(
        `[transcription] 上传 ${asrFile.name} ${(asrFile.size / 1024 / 1024).toFixed(2)}MB (${asrFile.type})`
      );
    } else {
      logger.info('[transcription] 无本地音频，使用检查点续跑');
    }

    const preset = subtitleLengthPreset || 'standard';
    const resumeFingerprint = checkpoint?.asrFingerprint;
    const expectedFp =
      resumeWords && checkpoint?.language
        ? asrWordsFingerprint(resumeWords.words, checkpoint.language, preset)
        : undefined;
    const result = await runTranscriptionPipeline(
      asrFile,
      allKeyterms,
      {
        onTranscribing: () => {
          if (asrCompleted) return;
          const live = useFilesStore.getState().getFile(fileId)?.phases.transcribing;
          useFilesStore.getState().updatePhase(fileId, 'transcribing', {
            status: 'active',
            transcriptId: live?.transcriptId,
            transcriptKeyFp: live?.transcriptKeyFp,
            asrReady: live?.asrReady,
          });
        },
        onProgress: (percent) => {
          useFilesStore.getState().updatePhase(fileId, 'transcribing', { progress: percent });
        },
      },
      {
        resume: {
          transcriptId: prevTr.transcriptId || checkpoint?.asr?.transcriptId,
          keyFingerprint: prevTr.transcriptKeyFp || checkpoint?.asr?.keyFingerprint,
          words: resumeWords?.words,
          language: resumeWords?.language,
        },
        onAsrSubmitted: async ({ transcriptId, keyFingerprint }) => {
          useFilesStore.getState().updatePhase(fileId, 'transcribing', {
            status: 'active',
            transcriptId,
            transcriptKeyFp: keyFingerprint,
          });
          await saveTaskCheckpoint(file.taskId, {
            asr: { transcriptId, keyFingerprint, status: 'submitted' },
          });
          await flushFilesStorePersist();
        },
        onAsrCompleted: async ({ words, language, transcriptId, keyFingerprint }) => {
          asrCompleted = true;
          const fp = asrWordsFingerprint(words, language, preset);
          useFilesStore.getState().updatePhase(fileId, 'transcribing', {
            progress: 80,
            language,
            asrReady: true,
            transcriptId,
            transcriptKeyFp: keyFingerprint,
          });
          await saveTaskCheckpoint(file.taskId, {
            asr: {
              transcriptId,
              keyFingerprint,
              status: 'completed',
              language,
            },
            words,
            language,
            preset,
            asrFingerprint: fp,
          });
          await flushFilesStorePersist();
        },
      }
    );

    useFilesStore.setState((state) => ({
      tasks: state.tasks.map((t) =>
        t.taskId === file.taskId
          ? {
              ...t,
              phases: {
                ...t.phases,
                converting: { status: 'completed', progress: 100, tokens: 0 },
                transcribing: {
                  ...t.phases.transcribing,
                  status: 'completed',
                  progress: 100,
                  tokens: 0,
                  language: result.language,
                  entryCount: result.entries.length,
                  totalEntries: result.entries.length,
                  asrReady: true,
                  keytermGroupName: selectedKeytermGroup?.name,
                },
              },
            }
          : t
      ),
    }));
    useFilesStore.getState().replaceTaskEntries(file.taskId, result.entries);

    toast.success(`转录完成！生成 ${result.entries.length} 条字幕`);

    if (result.entries.length > 0) {
      void saveTranslationHistory(
        file.taskId,
        file.name,
        0,
        (entry) => useHistoryStore.getState().addHistory(entry)
      );
    }
  } catch (error) {
    const appError = toAppError(error, '转录失败');
    logger.error(appError.message, appError);
    toast.error(`转录失败: ${appError.message}`);

    if (asrCompleted) {
      useFilesStore.getState().updatePhase(fileId, 'transcribing', { status: 'completed' });
    } else {
      useFilesStore.getState().updatePhase(fileId, 'transcribing', { status: 'failed' });
    }
  }
}
