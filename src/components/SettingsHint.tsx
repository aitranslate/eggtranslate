import React from 'react';
import { motion } from 'framer-motion';

interface SettingsHintProps {
  children: React.ReactNode;
  delay?: number;
}

export const SettingsHint: React.FC<SettingsHintProps> = ({ children, delay = 0 }) => (
  <motion.p
    initial={{ opacity: 0, y: -4 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.25, delay, ease: [0.16, 1, 0.3, 1] }}
    className="text-xs text-gray-500 leading-relaxed"
  >
    {children}
  </motion.p>
);
