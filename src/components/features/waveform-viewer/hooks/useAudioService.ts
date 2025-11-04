import { useRef, useCallback, useEffect } from "react";
import type { AudioData } from "../types";

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

export function useAudioService(isPlaying: boolean, isDragging: boolean, callbacks: AudioServiceCallbacks): AudioService {
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioBufferRef = useRef<AudioBuffer | null>(null);
    const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
    const startTimeRef = useRef<number>(0);
    const pausedAtRef = useRef<number>(0);
    const animationFrameRef = useRef<number | null>(null);
    const currentAudioDataRef = useRef<AudioData | null>(null);
    const isInitializedRef = useRef<boolean>(false);
    const isPlayingRef = useRef<boolean>(false);
    const isDraggingRef = useRef<boolean>(false);

    const initialize = useCallback(async (arrayBuffer: ArrayBuffer) => {
        try {
            // Always reinitialize to ensure we have the latest buffer
            if (audioContextRef.current && audioContextRef.current.state !== "closed") {
                // Stop any playing source
                if (sourceNodeRef.current) {
                    try {
                        sourceNodeRef.current.stop();
                    } catch (_e) {
                        // Ignore
                    }
                    sourceNodeRef.current = null;
                }
                await audioContextRef.current.close();
            }

            // biome-ignore lint/suspicious/noExplicitAny: < >
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));

            audioContextRef.current = audioContext;
            audioBufferRef.current = audioBuffer;
            isInitializedRef.current = true;
        } catch (error) {
            console.error("Failed to initialize audio:", error);
            isInitializedRef.current = false;
            throw new Error("Failed to initialize audio playback");
        }
    }, []);

    const startPlayheadUpdate = useCallback(() => {
        // Cancel any existing animation frame
        if (animationFrameRef.current !== null) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }

        if (!isPlayingRef.current || isDraggingRef.current || !audioContextRef.current || !currentAudioDataRef.current || !sourceNodeRef.current) {
            return;
        }

        const updatePlayhead = () => {
            // Check conditions using refs (which are always up-to-date)
            if (!isPlayingRef.current || isDraggingRef.current || !audioContextRef.current || !currentAudioDataRef.current || !sourceNodeRef.current) {
                if (animationFrameRef.current !== null) {
                    cancelAnimationFrame(animationFrameRef.current);
                    animationFrameRef.current = null;
                }
                return;
            }

            const audioContext = audioContextRef.current;
            const sessionElapsed = audioContext.currentTime - startTimeRef.current;
            const totalTime = pausedAtRef.current + sessionElapsed;
            const newTime = Math.min(totalTime, currentAudioDataRef.current.duration);

            callbacks.onTimeUpdate(newTime);

            if (newTime < currentAudioDataRef.current.duration) {
                animationFrameRef.current = requestAnimationFrame(updatePlayhead);
            } else {
                // Reached end
                animationFrameRef.current = null;
                callbacks.onEnded();
            }
        };

        // Start the animation loop
        animationFrameRef.current = requestAnimationFrame(updatePlayhead);
    }, [callbacks]);

    const play = useCallback(
        (audioData: AudioData, startTime: number) => {
            if (!audioContextRef.current || !audioBufferRef.current) {
                return;
            }

            // Stop any existing playback first
            if (sourceNodeRef.current) {
                try {
                    sourceNodeRef.current.stop();
                } catch (_e) {
                    // Ignore if already stopped
                }
                sourceNodeRef.current = null;
            }

            // Cancel any existing playhead update
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }

            const audioContext = audioContextRef.current;
            const source = audioContext.createBufferSource();
            source.buffer = audioBufferRef.current;
            source.connect(audioContext.destination);

            const startOffset = Math.max(0, startTime);
            const remainingDuration = audioData.duration - startOffset;

            if (remainingDuration > 0) {
                // Set refs BEFORE starting playback
                currentAudioDataRef.current = audioData;
                pausedAtRef.current = startTime;

                source.start(0, startOffset);
                startTimeRef.current = audioContext.currentTime;

                sourceNodeRef.current = source;

                // Start the playhead update loop now that everything is ready
                startPlayheadUpdate();

                source.onended = () => {
                    if (animationFrameRef.current !== null) {
                        cancelAnimationFrame(animationFrameRef.current);
                        animationFrameRef.current = null;
                    }
                    sourceNodeRef.current = null;
                    // Only call onEnded if we're still playing (not manually paused)
                    // This handles the case where audio reaches the end naturally
                    if (isPlayingRef.current && !isDraggingRef.current) {
                        pausedAtRef.current = audioData.duration;
                        callbacks.onEnded();
                    }
                    // If we're already paused, don't update pausedAtRef - keep the current paused position
                };
            }
        },
        [callbacks, startPlayheadUpdate]
    );

    const pause = useCallback(() => {
        if (sourceNodeRef.current && audioContextRef.current) {
            const audioContext = audioContextRef.current;
            const sessionElapsed = audioContext.currentTime - startTimeRef.current;
            const newPausedTime = pausedAtRef.current + sessionElapsed;
            pausedAtRef.current = newPausedTime;

            // Update the current time to the paused position before stopping
            if (currentAudioDataRef.current) {
                const finalTime = Math.min(newPausedTime, currentAudioDataRef.current.duration);
                callbacks.onTimeUpdate(finalTime);
            }

            sourceNodeRef.current.stop();
            sourceNodeRef.current = null;
        }

        if (animationFrameRef.current !== null) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
    }, [callbacks]);

    const seek = useCallback((time: number) => {
        pausedAtRef.current = time;
    }, []);

    const cleanup = useCallback(() => {
        if (sourceNodeRef.current) {
            try {
                sourceNodeRef.current.stop();
            } catch (_e) {
                // Ignore if already stopped
            }
        }
        if (audioContextRef.current && audioContextRef.current.state !== "closed") {
            audioContextRef.current.close();
        }
        if (animationFrameRef.current !== null) {
            cancelAnimationFrame(animationFrameRef.current);
        }
    }, []);

    // Update refs when props change
    useEffect(() => {
        isPlayingRef.current = isPlaying;
        isDraggingRef.current = isDragging;
    }, [isPlaying, isDragging]);

    // Stop playhead update when pausing or dragging
    useEffect(() => {
        if (!isPlaying || isDragging) {
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
        }
    }, [isPlaying, isDragging]);

    // Cleanup on unmount
    useEffect(() => {
        return cleanup;
    }, [cleanup]);

    return { initialize, play, pause, seek, cleanup };
}
