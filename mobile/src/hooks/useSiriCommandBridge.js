import { useEffect, useRef } from 'react';
import { requireOptionalNativeModule } from 'expo-modules-core';

export function useSiriCommandBridge(onCommand) {
  const callbackRef = useRef(onCommand);
  callbackRef.current = onCommand;

  useEffect(() => {
    const module = requireOptionalNativeModule('MapPartySiri');
    if (!module?.consumeCommand) return undefined;
    let active = true;
    let timer;
    const poll = async () => {
      if (!active) return;
      try {
        const command = await module.consumeCommand();
        if (command) await callbackRef.current?.(command);
      } finally {
        if (active) timer = setTimeout(poll, 700);
      }
    };
    poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, []);
}
