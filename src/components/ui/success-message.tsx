"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";

interface SuccessMessageProps {
  message: string;
  subtitle?: string;
  isVisible: boolean;
  onClose?: () => void;
}

export function SuccessMessage({ message, subtitle, isVisible, onClose }: SuccessMessageProps) {
  if (!isVisible) return null;

  return (
    <motion.div 
      className="fixed top-24 right-6 z-50"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 100 }}
    >
      <div className="bg-green-500 text-white px-6 py-4 rounded-lg shadow-lg border border-green-400">
        <div className="flex items-center space-x-3">
          <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center">
            <Check className="w-3 h-3 text-green-500" />
          </div>
          <div>
            <p className="font-semibold font-nanum">{message}</p>
            {subtitle && (
              <p className="text-sm opacity-90 font-nanum">{subtitle}</p>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
