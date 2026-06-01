import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface PhaseTooltipCardProps {
  phaseName: string;
  progress?: number;
  tokens?: number;
  entryCount?: number;
  totalEntries?: number;
  language?: string;
  errorMessage?: string;
  keytermGroupName?: string;
  isVisible: boolean;
}

const formatNumber = (n: number): string => n.toLocaleString();

export const PhaseTooltipCard: React.FC<PhaseTooltipCardProps> = ({
  phaseName,
  progress,
  tokens,
  entryCount,
  totalEntries,
  language,
  errorMessage,
  keytermGroupName,
  isVisible,
}) => {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 380, damping: 26 }}
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'white',
            borderRadius: 12,
            padding: '12px 16px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
            minWidth: 160,
            zIndex: 100,
            pointerEvents: 'none',
          }}
        >
          {/* 阶段名称 */}
          <div style={{ fontSize: 12, color: '#86868B', marginBottom: 6 }}>{phaseName}</div>

          {/* 报错信息（红色高亮） */}
          {errorMessage && (
            <div style={{
              fontSize: 11,
              color: '#FF3B30',
              marginBottom: 8,
              padding: '6px 8px',
              background: '#FFF5F5',
              borderRadius: 6,
              border: '1px solid #FFDAD6',
            }}>
              ❌ {errorMessage}
            </div>
          )}

          {/* 进度条（有进度时显示） */}
          {progress !== undefined && progress > 0 && progress < 100 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <div style={{ flex: 1, height: 4, background: '#E5E5EA', borderRadius: 2, overflow: 'hidden' }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    style={{ height: '100%', background: '#0066FF', borderRadius: 2 }}
                  />
                </div>
                <span style={{ fontSize: 11, color: '#0066FF', fontWeight: 600 }}>{progress}%</span>
              </div>
            </div>
          )}

          {/* 第二行信息 */}
          {(language || entryCount !== undefined || tokens !== undefined || keytermGroupName) && (
            <div style={{
              fontSize: 12,
              color: '#1D1D1F',
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              alignItems: 'center'
            }}>
              {language && <span style={{ background: '#F5F5F7', padding: '2px 6px', borderRadius: 4 }}>{language}</span>}
              {entryCount !== undefined && totalEntries !== undefined && (
                <span>{formatNumber(entryCount)}/{formatNumber(totalEntries)} 条</span>
              )}
              {tokens !== undefined && tokens > 0 && (
                <span>{formatNumber(tokens)} tokens</span>
              )}
              {keytermGroupName && (
                <span>热词组: {keytermGroupName}</span>
              )}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};