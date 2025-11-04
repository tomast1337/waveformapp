import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy, Pause, Play } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAudioService } from "./features/waveform-viewer/hooks/useAudioService";
import { useKeyboardShortcuts } from "./features/waveform-viewer/hooks/useKeyboardShortcuts";
import { useWaveformReducer } from "./features/waveform-viewer/hooks/useWaveformReducer";
import { calculateCanvasWidth, cssColorToRgb } from "./features/waveform-viewer/utils/canvas";
import { formatTime } from "./features/waveform-viewer/utils/time";
import { parseWavFile } from "./features/waveform-viewer/utils/wavParser";

const MINUTES_BASE = 60; // 60 minutes = full width

export function WaveformViewer() {
    const [state, dispatch] = useWaveformReducer();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const wasPlayingBeforeDragRef = useRef(false);

    // Destructure state for easier access
    const { audioData, fileName, loading, screenWidth, isPlaying, currentTime, startPosition, tags, pendingTagStart } = state;

    // Audio service hook - use useMemo to stabilize callbacks
    const audioCallbacks = useMemo(
        () => ({
            onTimeUpdate: (time: number) => {
                dispatch({ type: "TIME_UPDATE", payload: { time } });
            },
            onEnded: () => {
                // Only update time if we're actually playing (not already paused)
                // The pause() function already updates the time when pausing
                dispatch({ type: "PAUSE" });
                if (state.audioData && state.isPlaying) {
                    dispatch({ type: "TIME_UPDATE", payload: { time: state.audioData.duration } });
                }
            },
        }),
        [state.audioData, dispatch, state.isPlaying]
    );

    const audioService = useAudioService(state.isPlaying, state.isDragging, audioCallbacks);

    const calculateCanvasWidthMemo = useCallback(
        (duration: number): number => {
            return calculateCanvasWidth(duration, state.screenWidth);
        },
        [state.screenWidth]
    );

    const drawWaveform = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || !state.audioData) {
            return;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Get CSS variables for colors
        const root = document.documentElement;
        const bgColor = getComputedStyle(root).getPropertyValue("--background").trim() || "oklch(0.145 0 0)";
        const borderColor = getComputedStyle(root).getPropertyValue("--border").trim() || "oklch(0.922 0 0)";
        const primaryColor = getComputedStyle(root).getPropertyValue("--primary").trim() || "oklch(0.205 0 0)";
        const destructiveColor = getComputedStyle(root).getPropertyValue("--destructive").trim() || "oklch(0.577 0.245 27.325)";
        const chart1Color = getComputedStyle(root).getPropertyValue("--chart-1").trim() || "oklch(0.646 0.222 41.116)";

        const { samples, duration } = state.audioData;
        const dpr = window.devicePixelRatio || 1;

        // Calculate canvas width based on 60 minutes = screen width
        const displayWidth = Math.max(1, calculateCanvasWidthMemo(duration));
        const displayHeight = 256; // Fixed height
        const width = Math.max(1, displayWidth * dpr);
        const height = Math.max(1, displayHeight * dpr);

        // Set canvas internal size and CSS width
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = `${displayWidth}px`;
        canvas.style.height = `${displayHeight}px`;

        // Reset transform and scale context for high DPI displays
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);

        const centerY = displayHeight / 2;

        // Clear canvas with background color
        ctx.fillStyle = cssColorToRgb(bgColor);
        ctx.fillRect(0, 0, displayWidth, displayHeight);

        // Draw center line with border color
        ctx.strokeStyle = cssColorToRgb(borderColor);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(displayWidth, centerY);
        ctx.stroke();

        // Calculate samples per pixel for downsampling
        const samplesPerPixel: number = Math.max(1, Number(samples.length) / Number(displayWidth));
        const minValues = new Float32Array(displayWidth);
        const maxValues = new Float32Array(displayWidth);

        // Downsample and find min/max for each pixel
        for (let i = 0; i < displayWidth; i++) {
            let min = 1;
            let max = -1;
            const pixelOffset: number = i * samplesPerPixel;
            const nextPixelOffset: number = (i + 1) * samplesPerPixel;
            const start: number = Math.floor(pixelOffset);
            const end: number = Math.min(Math.floor(nextPixelOffset), samples.length);

            if (start < samples.length && end > start) {
                for (let j = start; j < end; j++) {
                    const value = samples[j];
                    if (value !== undefined && !Number.isNaN(value)) {
                        min = Math.min(min, value);
                        max = Math.max(max, value);
                    }
                }
            }

            minValues[i] = min;
            maxValues[i] = max;
        }

        // Draw waveform with primary color
        ctx.strokeStyle = cssColorToRgb(primaryColor);
        ctx.fillStyle = cssColorToRgb(primaryColor);
        ctx.lineWidth = 1;

        for (let i = 0; i < displayWidth; i++) {
            const min = minValues[i] ?? 0;
            const max = maxValues[i] ?? 0;

            const minY = centerY - min * centerY;
            const maxY = centerY - max * centerY;

            // Draw vertical line for each pixel (Audacity style)
            ctx.beginPath();
            ctx.moveTo(i, minY);
            ctx.lineTo(i, maxY);
            ctx.stroke();
        }

        // Draw playhead (current playback position) - make it thicker for easier dragging
        if (duration > 0 && state.currentTime !== undefined) {
            const playheadX = Math.max(0, Math.min((state.currentTime / duration) * displayWidth, displayWidth));
            ctx.strokeStyle = cssColorToRgb(destructiveColor);
            ctx.lineWidth = state.isDragging ? 3 : 2;
            ctx.beginPath();
            ctx.moveTo(playheadX, 0);
            ctx.lineTo(playheadX, displayHeight);
            ctx.stroke();

            // Draw a small circle at top for better visibility
            ctx.fillStyle = cssColorToRgb(destructiveColor);
            ctx.beginPath();
            ctx.arc(playheadX, 8, 6, 0, Math.PI * 2);
            ctx.fill();
        }

        // Draw start position marker (if set) with chart color
        if (state.startPosition > 0 && duration > 0) {
            const startX = (state.startPosition / duration) * displayWidth;
            ctx.strokeStyle = cssColorToRgb(chart1Color);
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(startX, 0);
            ctx.lineTo(startX, displayHeight);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }, [state.audioData, state.currentTime, state.startPosition, state.isDragging, calculateCanvasWidthMemo]);

    // Redraw waveform when currentTime changes (for playhead movement)
    useEffect(() => {
        if (!state.audioData) return;
        drawWaveform();
    }, [state.currentTime, state.audioData, drawWaveform]);

    // Effect to handle play/pause state changes
    useEffect(() => {
        if (!state.audioData) return;

        // Only auto-play/pause when not dragging (manual dragging handles its own playback)
        if (state.isPlaying && !state.isDragging) {
            // Initialize audio if needed, then play
            audioService
                .initialize(state.audioData.audioBuffer)
                .then(() => {
                    // Only play if still in playing state (state might have changed during async init)
                    if (state.isPlaying && !state.isDragging) {
                        audioService.play(state.audioData!, state.startPosition);
                    }
                })
                .catch((error) => {
                    console.error("Failed to initialize audio:", error);
                });
        } else if (!state.isPlaying) {
            audioService.pause();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.isPlaying, state.isDragging, state.audioData, state.startPosition]);

    useEffect(() => {
        if (state.audioData) {
            drawWaveform();
        }
    }, [state.audioData, drawWaveform]);

    useEffect(() => {
        const handleResize = () => {
            dispatch({ type: "RESIZE", payload: { screenWidth: window.innerWidth } });
            if (state.audioData) {
                drawWaveform();
            }
        };

        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [state.audioData, drawWaveform, dispatch]);

    const handlePlayPause = () => {
        if (!state.audioData) return;

        if (state.isPlaying) {
            // Pause and reset to start position
            dispatch({ type: "PAUSE" });
            dispatch({ type: "SEEK", payload: { time: state.startPosition } });
            drawWaveform();
        } else {
            // Play from start position (the effect will handle initialization and playback)
            dispatch({ type: "PLAY" });
            dispatch({ type: "SEEK", payload: { time: state.startPosition } });
            drawWaveform();
        }
    };

    // Keyboard shortcuts for spacebar (play/pause) and 'A' key (tagging)
    useKeyboardShortcuts({
        KeyA: () => {
            if (!state.audioData) return;
            dispatch({ type: "TOGGLE_TAG", payload: { currentTime: state.currentTime } });
        },
        a: () => {
            if (!state.audioData) return;
            dispatch({ type: "TOGGLE_TAG", payload: { currentTime: state.currentTime } });
        },
        Space: () => {
            handlePlayPause();
        },
        " ": () => {
            handlePlayPause();
        },
    });

    const getTimeFromX = useCallback(
        (clientX: number): number => {
            if (!state.audioData || !canvasRef.current) return 0;
            const canvas = canvasRef.current;
            const rect = canvas.getBoundingClientRect();
            const x = clientX - rect.left;
            const displayWidth = calculateCanvasWidthMemo(state.audioData.duration);
            const clickPosition = Math.max(0, Math.min(1, x / displayWidth));
            return Math.max(0, Math.min(clickPosition * state.audioData.duration, state.audioData.duration));
        },
        [state.audioData, calculateCanvasWidthMemo]
    );

    const isClickNearPlayhead = useCallback(
        (clientX: number, tolerance: number = 15): boolean => {
            if (!state.audioData || !canvasRef.current) return false;
            const canvas = canvasRef.current;
            const rect = canvas.getBoundingClientRect();
            const x = clientX - rect.left;
            const displayWidth = calculateCanvasWidthMemo(state.audioData.duration);
            const playheadX = (state.currentTime / state.audioData.duration) * displayWidth;
            return Math.abs(x - playheadX) <= tolerance;
        },
        [state.audioData, state.currentTime, calculateCanvasWidthMemo]
    );

    const seekToTime = useCallback(
        (time: number, pauseAudio: boolean = false) => {
            if (!state.audioData) return;

            const wasPlaying = state.isPlaying && !pauseAudio;

            if (state.isPlaying) {
                audioService.pause();
            }

            if (pauseAudio) {
                dispatch({ type: "PAUSE" });
            }

            dispatch({ type: "SEEK", payload: { time } });
            audioService.seek(time);

            // If it was playing and not pausing, continue from new position
            if (wasPlaying) {
                dispatch({ type: "PLAY" });
            }

            drawWaveform();
        },
        [state.audioData, state.isPlaying, drawWaveform, dispatch, audioService]
    );

    const handleCanvasMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
        if (!state.audioData || !canvasRef.current) return;

        event.preventDefault();
        const isNearPlayhead = isClickNearPlayhead(event.clientX);

        if (isNearPlayhead) {
            // Start dragging playhead
            dispatch({ type: "DRAG_START" });
            wasPlayingBeforeDragRef.current = state.isPlaying;

            // Pause audio when starting to drag
            if (state.isPlaying) {
                audioService.pause();
                dispatch({ type: "PAUSE" });
            }
        } else {
            // Regular click - set start position
            const time = getTimeFromX(event.clientX);
            dispatch({ type: "SET_START_POSITION", payload: { position: time } });
            seekToTime(time, false);
        }
    };

    const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        // Mouse move on canvas is handled by global handler when dragging
        // This is just for hover effects if needed
    };

    const handleCanvasMouseUp = (event: React.MouseEvent<HTMLCanvasElement>) => {
        if (!state.isDragging) return;

        const time = getTimeFromX(event.clientX);
        audioService.seek(time);
        dispatch({ type: "DRAG_END" });

        // Don't auto-resume - user needs to click play
        drawWaveform();
    };

    const handleCanvasMouseLeave = () => {
        if (state.isDragging) {
            dispatch({ type: "DRAG_END" });
            drawWaveform();
        }
    };

    // Touch handlers for mobile
    const handleCanvasTouchStart = (event: React.TouchEvent<HTMLCanvasElement>) => {
        if (!state.audioData || !canvasRef.current) return;
        const touch = event.touches[0];
        if (!touch) return;

        const isNearPlayhead = isClickNearPlayhead(touch.clientX);

        if (isNearPlayhead) {
            dispatch({ type: "DRAG_START" });
            wasPlayingBeforeDragRef.current = state.isPlaying;

            if (state.isPlaying) {
                audioService.pause();
                dispatch({ type: "PAUSE" });
            }

            event.preventDefault();
        } else {
            const time = getTimeFromX(touch.clientX);
            dispatch({ type: "SET_START_POSITION", payload: { position: time } });
            seekToTime(time, false);
        }
    };

    const handleCanvasTouchMove = (event: React.TouchEvent<HTMLCanvasElement>) => {
        if (!state.isDragging || !state.audioData) return;
        const touch = event.touches[0];
        if (!touch) return;

        const time = getTimeFromX(touch.clientX);
        dispatch({ type: "DRAG_MOVE", payload: { time } });
        audioService.seek(time);
        drawWaveform();
        event.preventDefault();
    };

    const handleCanvasTouchEnd = () => {
        if (state.isDragging) {
            dispatch({ type: "DRAG_END" });
            drawWaveform();
        }
    };

    // Handle mouse move and up globally for dragging
    useEffect(() => {
        const handleGlobalMouseMove = (event: MouseEvent) => {
            if (state.isDragging && state.audioData && canvasRef.current) {
                const time = getTimeFromX(event.clientX);
                dispatch({ type: "DRAG_MOVE", payload: { time } });
                audioService.seek(time);
                drawWaveform();
            }
        };

        const handleGlobalMouseUp = (event: MouseEvent) => {
            if (state.isDragging) {
                const time = state.audioData && canvasRef.current ? getTimeFromX(event.clientX) : state.currentTime;
                audioService.seek(time);
                dispatch({ type: "DRAG_END" });
                if (state.audioData) {
                    drawWaveform();
                }
            }
        };

        if (state.isDragging) {
            window.addEventListener("mousemove", handleGlobalMouseMove, { passive: false });
            window.addEventListener("mouseup", handleGlobalMouseUp);
            document.body.style.userSelect = "none"; // Prevent text selection while dragging
            return () => {
                window.removeEventListener("mousemove", handleGlobalMouseMove);
                window.removeEventListener("mouseup", handleGlobalMouseUp);
                document.body.style.userSelect = "";
            };
        }
    }, [state.isDragging, state.audioData, getTimeFromX, drawWaveform, dispatch]);

    const handleFileSelect = useCallback(
        async (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (!file) return;

            if (!file.name.toLowerCase().endsWith(".wav")) {
                alert("Please select a .wav file");
                return;
            }

            dispatch({ type: "FILE_LOAD_START" });
            try {
                const data = await parseWavFile(file);

                // Initialize audio for playback (will be done when play is clicked)
                dispatch({ type: "FILE_LOAD_SUCCESS", payload: { audioData: data, fileName: file.name } });
            } catch (error) {
                console.error("Error parsing WAV file:", error);
                alert(`Error loading WAV file: ${error instanceof Error ? error.message : "Unknown error"}`);
                dispatch({ type: "FILE_LOAD_ERROR" });
            }
        },
        [dispatch]
    );

    const handleButtonClick = () => {
        fileInputRef.current?.click();
    };

    return (
        <div className="h-screen flex flex-col w-full min-w-0 max-w-screen overflow-hidden">
            <Card className="shrink-0 max-w-full overflow-hidden">
                <CardHeader className="pb-3">
                    <CardTitle>Waveform Viewer</CardTitle>
                    <CardDescription>Upload a .wav file to visualize its waveform in Audacity-style</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center gap-4">
                        <Button onClick={handleButtonClick} disabled={loading}>
                            {loading ? "Loading..." : "Open WAV File"}
                        </Button>
                        <input ref={fileInputRef} type="file" accept=".wav" onChange={handleFileSelect} className="hidden" />
                        {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
                    </div>

                    {audioData && (
                        <>
                            <div className="flex items-center gap-4">
                                <Button onClick={handlePlayPause} disabled={!audioData} size="lg">
                                    {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
                                    {isPlaying ? "Reset & Pause" : "Reset & Play"}
                                </Button>
                                <div className="text-sm font-mono">
                                    <span>{formatTime(currentTime)}</span>
                                    {audioData && <span className="text-muted-foreground"> / {formatTime(audioData.duration)}</span>}
                                </div>
                                {startPosition > 0 && <div className="text-sm text-muted-foreground">Start: {formatTime(startPosition)}</div>}
                            </div>
                            <div className="flex gap-4 text-sm text-muted-foreground flex-wrap">
                                <span>Sample Rate: {audioData.sampleRate.toLocaleString()} Hz</span>
                                <span>Channels: {audioData.channels}</span>
                                <span>
                                    Duration: {audioData.duration.toFixed(2)}s ({(audioData.duration / 60).toFixed(2)} min)
                                </span>
                                <span>Samples: {audioData.samples.length.toLocaleString()}</span>
                                <span>
                                    Scale: {MINUTES_BASE} min = {screenWidth}px
                                </span>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>

            {audioData && (
                <div ref={containerRef} className="w-full min-w-0 flex-1 overflow-x-auto overflow-y-hidden" style={{ maxWidth: "100%", width: "100%", paddingTop: "16px", paddingBottom: "0", paddingLeft: "0", paddingRight: "0", boxSizing: "border-box" }}>
                    <div className="overflow-hidden rounded-lg border" style={{ height: "256px", display: "inline-block", maxWidth: "none", marginLeft: "16px", marginRight: "16px" }}>
                        <canvas
                            ref={canvasRef}
                            className="block cursor-pointer"
                            style={{ height: "256px" }}
                            onMouseDown={handleCanvasMouseDown}
                            onMouseMove={handleCanvasMouseMove}
                            onMouseUp={handleCanvasMouseUp}
                            onMouseLeave={handleCanvasMouseLeave}
                            onTouchStart={handleCanvasTouchStart}
                            onTouchMove={handleCanvasTouchMove}
                            onTouchEnd={handleCanvasTouchEnd}
                            title="Click to set playback start position, drag playhead to scrub"
                        />
                    </div>
                </div>
            )}

            {!audioData && !loading && (
                <div className="flex flex-1 items-center justify-center bg-background">
                    <div className="rounded-lg border-2 border-dashed p-12 text-center text-muted-foreground">
                        <p>No file loaded. Click "Open WAV File" to get started.</p>
                    </div>
                </div>
            )}

            {/* Tags list section */}
            {(tags.length > 0 || pendingTagStart !== null) && (
                <div className="max-h-64 shrink-0 overflow-y-auto border-border border-t bg-card p-4">
                    <div className="container mx-auto">
                        <div className="mb-3 flex items-center justify-between">
                            <h3 className="font-semibold text-card-foreground text-sm">Tags {pendingTagStart !== null && <span className="text-muted-foreground text-xs">(Press A again to set end)</span>}</h3>
                            {tags.length > 0 && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={async () => {
                                        try {
                                            // Format each value to 4 decimal places
                                            const formattedTags = tags.map(([start, end]) => [Math.round(start * 10000) / 10000, Math.round(end * 10000) / 10000]);
                                            const json = JSON.stringify(formattedTags, null, 2);
                                            await navigator.clipboard.writeText(json);
                                            // You could add a toast notification here if you have one
                                        } catch (error) {
                                            console.error("Failed to copy:", error);
                                            alert("Failed to copy to clipboard");
                                        }
                                    }}
                                    className="gap-2"
                                >
                                    <Copy className="size-4" />
                                    Copy JSON
                                </Button>
                            )}
                        </div>
                        <div className="space-y-2">
                            {tags.map((tag, index) => (
                                <div key={index} className="flex items-center justify-between rounded-md border border-border bg-background p-2">
                                    <div className="flex items-center gap-4 text-sm">
                                        <span className="font-mono text-card-foreground">
                                            {formatTime(tag[0])} - {formatTime(tag[1])}
                                        </span>
                                        <span className="text-muted-foreground text-xs">({formatTime(tag[1] - tag[0])})</span>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            dispatch({ type: "REMOVE_TAG", payload: { index } });
                                        }}
                                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                                    >
                                        ×
                                    </Button>
                                </div>
                            ))}
                            {pendingTagStart !== null && (
                                <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/10 p-2">
                                    <div className="flex items-center gap-4 text-sm">
                                        <span className="font-mono text-card-foreground">{formatTime(pendingTagStart)} - ...</span>
                                        <span className="text-primary text-xs">(Pending end time)</span>
                                    </div>
                                    <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "CLEAR_PENDING_TAG" })} className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive">
                                        ×
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <footer className="shrink-0 rounded-md p-2 bg-card text-card-foreground">
                <div className="flex flex-col items-center gap-2 mx-auto">
                    <div className="text-center">
                        <p className="text-lg font-bold">AudioTimes</p>
                    </div>
                    <div className="flex gap-2 justify-center flex-wrap">
                        <a href="https://github.com/tomast1337/audioTimes" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-card-foreground hover:text-primary transition-colors duration-200 rounded-md p-2">
                            <svg className="shrink-0" width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                            </svg>
                            Repository
                        </a>
                        <a href="https://github.com/tomast1337" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-card-foreground hover:text-primary transition-colors duration-200 rounded-md p-2">
                            <svg className="shrink-0" width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                            </svg>
                            @tomast1337
                        </a>
                        <a href="https://www.linkedin.com/in/nicolas-vycas/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-card-foreground hover:text-primary transition-colors duration-200 rounded-md p-2">
                            <svg className="shrink-0" width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                            </svg>
                            LinkedIn
                        </a>
                    </div>
                    <div className="text-center">
                        <p className="text-sm text-muted-foreground">
                            Created by <span className="text-primary">Nicolas Vyčas Nery</span>
                        </p>
                    </div>
                </div>
            </footer>
        </div>
    );
}
