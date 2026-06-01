import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, ChevronDown } from 'lucide-react';
import { useFilesStore } from '@/stores/filesStore';

export const TranscodingIndicator: React.FC = () => {
  const tasks = useFilesStore((s) => s.tasks);
  const [isExpanded, setIsExpanded] = useState(false);

  const transcodingFiles = useMemo(
    () => tasks.filter((t) => t.phases.converting.status === 'active'),
    [tasks]
  );

  const count = transcodingFiles.length;

  if (count === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="transcoding-indicator"
        initial={{ opacity: 0, y: -8, height: 0 }}
        animate={{ opacity: 1, y: 0, height: 'auto' }}
        exit={{ opacity: 0, y: -8, height: 0 }}
        transition={{
          type: 'spring',
          stiffness: 280,
          damping: 24,
          opacity: { duration: 0.2 },
        }}
        data-testid="transcoding-indicator-root"
        style={{
          background: 'linear-gradient(135deg, #EFF6FF 0%, #F0F9FF 100%)',
          border: '1px solid rgba(0, 102, 255, 0.15)',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(0, 102, 255, 0.04)',
        }}
      >
          <button
            onClick={() => setIsExpanded((v) => !v)}
            aria-expanded={isExpanded}
            data-testid="transcoding-indicator-toggle"
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#1D1D1F',
              transition: 'background 200ms ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(0, 102, 255, 0.04)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Loader2
                size={16}
                color="#0066FF"
                style={{ animation: 'spin 0.8s linear infinite' }}
              />
              <span style={{ fontSize: 14, fontWeight: 500 }} data-testid="transcoding-count">
                正在转码 {count} 个文件
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#86868B' }}>
              <span style={{ fontSize: 12 }}>{isExpanded ? '收起' : '展开'}</span>
              <motion.span
                animate={{ rotate: isExpanded ? 180 : 0 }}
                transition={{ duration: 0.2 }}
                style={{ display: 'inline-flex' }}
              >
                <ChevronDown size={16} />
              </motion.span>
            </div>
          </button>

          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                style={{ overflow: 'hidden' }}
              >
                <div
                  style={{
                    padding: '8px 16px 12px 42px',
                    borderTop: '1px solid rgba(0, 102, 255, 0.08)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  {transcodingFiles.map((file) => (
                    <div
                      key={file.taskId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 13,
                        color: '#1D1D1F',
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: '#0066FF',
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: 280,
                        }}
                        title={file.subtitle_filename}
                      >
                        {file.subtitle_filename}
                      </span>
                      <span style={{ color: '#86868B' }}>转码中</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </motion.div>
    </AnimatePresence>
  );
};
