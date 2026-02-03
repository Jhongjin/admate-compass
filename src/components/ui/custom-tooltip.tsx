'use client';

import React, { useState, useRef, useEffect } from 'react';

interface CustomTooltipProps {
  children: React.ReactNode;
  content: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  className?: string;
}

export function CustomTooltip({ 
  children, 
  content, 
  side = 'top', 
  align = 'center',
  sideOffset = 8,
  className = ''
}: CustomTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const showTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const updatePosition = () => {
    if (!triggerRef.current || !tooltipRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;

    let top = 0;
    let left = 0;

    switch (side) {
      case 'top':
        top = triggerRect.top + scrollY - tooltipRect.height - sideOffset;
        left = triggerRect.left + scrollX + (triggerRect.width - tooltipRect.width) / 2;
        break;
      case 'bottom':
        top = triggerRect.bottom + scrollY + sideOffset;
        left = triggerRect.left + scrollX + (triggerRect.width - tooltipRect.width) / 2;
        break;
      case 'left':
        top = triggerRect.top + scrollY + (triggerRect.height - tooltipRect.height) / 2;
        left = triggerRect.left + scrollX - tooltipRect.width - sideOffset;
        break;
      case 'right':
        top = triggerRect.top + scrollY + (triggerRect.height - tooltipRect.height) / 2;
        left = triggerRect.right + scrollX + sideOffset;
        break;
    }

    // Align adjustment
    if (align === 'start') {
      if (side === 'top' || side === 'bottom') {
        left = triggerRect.left + scrollX;
      } else {
        top = triggerRect.top + scrollY;
      }
    } else if (align === 'end') {
      if (side === 'top' || side === 'bottom') {
        left = triggerRect.right + scrollX - tooltipRect.width;
      } else {
        top = triggerRect.bottom + scrollY - tooltipRect.height;
      }
    }

    // Keep tooltip within viewport
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (left < 8) left = 8;
    if (left + tooltipRect.width > viewportWidth - 8) {
      left = viewportWidth - tooltipRect.width - 8;
    }
    if (top < 8) top = 8;
    if (top + tooltipRect.height > viewportHeight - 8) {
      top = viewportHeight - tooltipRect.height - 8;
    }

    setPosition({ top, left });
  };

  useEffect(() => {
    if (isVisible) {
      // 약간의 지연을 두어 DOM이 완전히 렌더링된 후 위치 계산
      const timer = setTimeout(() => {
        updatePosition();
      }, 10);
      
      const handleScroll = () => {
        clearTimeout(timer);
        updatePosition();
      };
      const handleResize = () => {
        clearTimeout(timer);
        updatePosition();
      };
      
      window.addEventListener('scroll', handleScroll, { passive: true });
      window.addEventListener('resize', handleResize, { passive: true });
      
      return () => {
        clearTimeout(timer);
        window.removeEventListener('scroll', handleScroll);
        window.removeEventListener('resize', handleResize);
      };
    }
  }, [isVisible, side, align, sideOffset]);

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (showTimeoutRef.current) {
        clearTimeout(showTimeoutRef.current);
      }
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  const handleMouseEnter = () => {
    console.log('🖱️ 툴팁 마우스 진입:', content.substring(0, 20) + '...');
    
    // 기존 타이머들 클리어
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    
    // 100ms 후에 툴팁 표시
    showTimeoutRef.current = setTimeout(() => {
      console.log('✅ 툴팁 표시:', content.substring(0, 20) + '...');
      setIsVisible(true);
    }, 100);
  };

  const handleMouseLeave = () => {
    console.log('🖱️ 툴팁 마우스 이탈:', content.substring(0, 20) + '...');
    
    // 기존 타이머들 클리어
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }
    
    // 200ms 후에 툴팁 숨김
    hideTimeoutRef.current = setTimeout(() => {
      console.log('❌ 툴팁 숨김:', content.substring(0, 20) + '...');
      setIsVisible(false);
    }, 200);
  };

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="inline-block"
      >
        {children}
      </div>
      
      {isVisible && (
        <div
          ref={tooltipRef}
          className={`fixed z-[9999] px-3 py-2 text-sm bg-gray-900 text-white rounded-lg shadow-lg border border-gray-700 max-w-xs ${className}`}
          style={{
            top: position.top,
            left: position.left,
            transform: 'translateZ(0)', // GPU 가속으로 부드러운 렌더링
            pointerEvents: 'auto', // 툴팁과의 상호작용 허용
          }}
          onMouseEnter={() => {
            console.log('🖱️ 툴팁 내부 마우스 진입');
            // 툴팁에 마우스가 올라가면 숨김 타이머 취소
            if (hideTimeoutRef.current) {
              clearTimeout(hideTimeoutRef.current);
              hideTimeoutRef.current = null;
            }
          }}
          onMouseLeave={() => {
            console.log('🖱️ 툴팁 내부 마우스 이탈');
            // 툴팁에서 마우스가 벗어나면 100ms 후 숨김
            hideTimeoutRef.current = setTimeout(() => {
              setIsVisible(false);
            }, 100);
          }}
        >
          <div className="whitespace-pre-line leading-relaxed">
            {content}
          </div>
          {/* Arrow */}
          <div
            className={`absolute w-2 h-2 bg-gray-900 border-gray-700 transform rotate-45 ${
              side === 'top' ? 'bottom-[-4px] left-1/2 -translate-x-1/2 border-r border-b' :
              side === 'bottom' ? 'top-[-4px] left-1/2 -translate-x-1/2 border-l border-t' :
              side === 'left' ? 'right-[-4px] top-1/2 -translate-y-1/2 border-t border-r' :
              'left-[-4px] top-1/2 -translate-y-1/2 border-b border-l'
            }`}
          />
        </div>
      )}
    </>
  );
}
