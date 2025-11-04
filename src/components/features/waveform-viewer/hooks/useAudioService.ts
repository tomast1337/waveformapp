import { useRef, useCallback, useEffect } from 'react';
import type { AudioData } from '../types';

export interface AudioServiceCallbacks {
  onTimeUpdate: (time: number) => void;
  onEnded: () => void;
}

export interface AudioService {
  initialize: (arrayBuffer: ArrayBuffer) => Promise<void>;
  play: (audioData: AudioData, startTime: number) => void;
  pause: () => void;
  seek: (time: number) => void;
  cleanup: () => void;
}

export function useAudioService(
  isPlaying: boolean,
  callbacks: AudioServiceCallbacks
): AudioService {
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);
  const currentAudioDataRef = useRef<AudioData | null>(null);

  const initialize = useCallback(async (arrayBuffer: ArrayBuffer) => {
    try {
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        await audioContextRef.current.close();
      }
      
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      
      audioContextRef.current = audioContext;
      audioBufferRef.current = audioBuffer;
    } catch (error) {
      console.error('Failed to initialize audio:', error);
      throw new Error('Failed to initialize audio playback');
    }
  }, []);

  const play = useCallback((audioData: AudioData, startTime: number) => {
    if (!audioContextRef.current || !audioBufferRef.current) return;

    const audioContext = audioContextRef.current;
    const source = audioContext.createBufferSource();
    source.buffer = audioBufferRef.current;
    source.connect(audioContext.destination);

    const startOffset = Math.max(0, startTime);
    const remainingDuration = audioData.duration - startOffset;
    
    if (remainingDuration > 0) {
      source.start(0, startOffset);
      startTimeRef.current = audioContext.currentTime;
      pausedAtRef.current = startTime;
      currentAudioDataRef.current = audioData;
      
      sourceNodeRef.current = source;

      source.onended = () => {
        callbacks.onEnded();
        pausedAtRef.current = audioData.duration;
        sourceNodeRef.current = null;
      };
    }
  }, [callbacks]);

  const pause = useCallback(() => {
    if (sourceNodeRef.current && audioContextRef.current) {
      const audioContext = audioContextRef.current;
      const sessionElapsed = audioContext.currentTime - startTimeRef.current;
      pausedAtRef.current = pausedAtRef.current + sessionElapsed;
      sourceNodeRef.current.stop();
      sourceNodeRef.current = null;
    }

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const seek = useCallback((time: number) => {
    pausedAtRef.current = time;
  }, []);

  const cleanup = useCallback(() => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch (e) {
        // Ignore if already stopped
      }
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }
  }, []);

  // Update playhead position (only when playing)
  useEffect(() => {
    const updatePlayhead = () => {
      if (isPlaying && audioContextRef.current && currentAudioDataRef.current) {
        const sessionElapsed = audioContextRef.current.currentTime - startTimeRef.current;
        const totalTime = pausedAtRef.current + sessionElapsed;
        const newTime = Math.min(totalTime, currentAudioDataRef.current.duration);
        callbacks.onTimeUpdate(newTime);
        
        if (newTime < currentAudioDataRef.current.duration) {
          animationFrameRef.current = requestAnimationFrame(updatePlayhead);
        } else {
          // Reached end
          callbacks.onEnded();
        }
      }
    };

    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(updatePlayhead);
    } else if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, callbacks]);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return { initialize, play, pause, seek, cleanup };
}
