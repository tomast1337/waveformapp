import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Play, Pause, Copy } from 'lucide-react';

interface AudioData {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
  duration: number;
  audioBuffer: ArrayBuffer; // Store original file for playback
}

const MINUTES_BASE = 60; // 60 minutes = full width

export function WaveformViewer() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);
  
  const [audioData, setAudioData] = useState<AudioData | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [screenWidth, setScreenWidth] = useState(window.innerWidth);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [startPosition, setStartPosition] = useState(0); // Position set by clicking
  const [isDragging, setIsDragging] = useState(false);
  const wasPlayingBeforeDragRef = useRef(false);
  const [tags, setTags] = useState<Array<[number, number]>>([]); // Array of [start, end] pairs
  const [pendingTagStart, setPendingTagStart] = useState<number | null>(null);

  const parseWavFile = async (file: File): Promise<AudioData> => {
    const arrayBuffer = await file.arrayBuffer();
    const view = new DataView(arrayBuffer);

    // Check for RIFF header
    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (riff !== 'RIFF') {
      throw new Error('Not a valid WAV file');
    }

    // Check for WAVE format
    const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    if (wave !== 'WAVE') {
      throw new Error('Not a valid WAV file');
    }

    let offset = 12;
    let sampleRate = 44100;
    let channels = 1;
    let bitsPerSample = 16;
    let dataOffset = 0;
    let dataSize = 0;

    // Parse chunks
    while (offset < arrayBuffer.byteLength) {
      const chunkId = String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3)
      );
      const chunkSize = view.getUint32(offset + 4, true);

      if (chunkId === 'fmt ') {
        // Parse format chunk
        const audioFormat = view.getUint16(offset + 8, true);
        if (audioFormat !== 1) {
          throw new Error('Only PCM format is supported');
        }
        channels = view.getUint16(offset + 10, true);
        sampleRate = view.getUint32(offset + 12, true);
        bitsPerSample = view.getUint16(offset + 22, true);
      } else if (chunkId === 'data') {
        // Found data chunk
        dataOffset = offset + 8;
        dataSize = chunkSize;
        break;
      }

      offset += 8 + chunkSize;
    }

    if (dataOffset === 0) {
      throw new Error('No data chunk found');
    }

    // Read audio samples
    const bytesPerSample = bitsPerSample / 8;
    const numSamples = dataSize / (bytesPerSample * channels);
    const samples = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
      const sampleOffset = dataOffset + i * bytesPerSample * channels;
      let sample = 0;

      if (bitsPerSample === 8) {
        sample = (view.getUint8(sampleOffset) - 128) / 128;
      } else if (bitsPerSample === 16) {
        sample = view.getInt16(sampleOffset, true) / 32768;
      } else if (bitsPerSample === 24) {
        const b1 = view.getUint8(sampleOffset);
        const b2 = view.getUint8(sampleOffset + 1);
        const b3 = view.getUint8(sampleOffset + 2);
        const combined = (b3 << 16) | (b2 << 8) | b1;
        sample = (combined > 8388607 ? combined - 16777216 : combined) / 8388608;
      } else if (bitsPerSample === 32) {
        sample = view.getInt32(sampleOffset, true) / 2147483648;
      }

      // For multi-channel, take the average of all channels
      if (channels > 1) {
        let sum = sample;
        for (let ch = 1; ch < channels; ch++) {
          const chOffset = sampleOffset + ch * bytesPerSample;
          let chSample = 0;
          
          if (bitsPerSample === 8) {
            chSample = (view.getUint8(chOffset) - 128) / 128;
          } else if (bitsPerSample === 16) {
            chSample = view.getInt16(chOffset, true) / 32768;
          } else if (bitsPerSample === 24) {
            const b1 = view.getUint8(chOffset);
            const b2 = view.getUint8(chOffset + 1);
            const b3 = view.getUint8(chOffset + 2);
            const combined = (b3 << 16) | (b2 << 8) | b1;
            chSample = (combined > 8388607 ? combined - 16777216 : combined) / 8388608;
          } else if (bitsPerSample === 32) {
            chSample = view.getInt32(chOffset, true) / 2147483648;
          }
          
          sum += chSample;
        }
        sample = sum / channels;
      }

      samples[i] = sample;
    }

    const duration = numSamples / sampleRate;

    // Decode audio for playback using Web Audio API
    let audioBuffer: AudioBuffer;
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      audioContext.close();
    } catch (error) {
      throw new Error('Failed to decode audio file');
    }

    return { samples, sampleRate, channels, duration, audioBuffer: arrayBuffer };
  };

  const calculateCanvasWidth = useCallback((duration: number): number => {
    // 60 minutes = available container width, scale proportionally for longer/shorter audio
    // Account for main container padding (16px on each side = 32px total)
    // and canvas wrapper margins (16px on each side = 32px total)
    const totalHorizontalSpace = 64; // 32px main container padding + 32px canvas wrapper margins
    const availableWidth = Math.max(1, screenWidth - totalHorizontalSpace);
    return Math.ceil((duration / MINUTES_BASE) * availableWidth);
  }, [screenWidth]);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioData) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get CSS variables for colors
    const root = document.documentElement;
    const bgColor = getComputedStyle(root).getPropertyValue('--background').trim() || 'oklch(0.145 0 0)';
    const borderColor = getComputedStyle(root).getPropertyValue('--border').trim() || 'oklch(0.922 0 0)';
    const primaryColor = getComputedStyle(root).getPropertyValue('--primary').trim() || 'oklch(0.205 0 0)';
    const destructiveColor = getComputedStyle(root).getPropertyValue('--destructive').trim() || 'oklch(0.577 0.245 27.325)';
    const chart1Color = getComputedStyle(root).getPropertyValue('--chart-1').trim() || 'oklch(0.646 0.222 41.116)';

    const { samples, duration } = audioData;
    const dpr = window.devicePixelRatio || 1;
    
    // Calculate canvas width based on 60 minutes = screen width
    const displayWidth = Math.max(1, calculateCanvasWidth(duration));
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

    // Convert CSS color (oklch or any format) to rgb for canvas
    const cssColorToRgb = (cssColor: string): string => {
      // Remove parentheses if present (for oklch values)
      const cleanColor = cssColor.trim();
      
      // Try to use the color directly first (modern browsers support oklch in canvas)
      try {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = 1;
        tempCanvas.height = 1;
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        if (tempCtx) {
          // Try oklch format
          if (cleanColor.includes('oklch')) {
            tempCtx.fillStyle = cleanColor;
          } else {
            tempCtx.fillStyle = cleanColor;
          }
          tempCtx.fillRect(0, 0, 1, 1);
          const data = tempCtx.getImageData(0, 0, 1, 1).data;
          return `rgb(${data[0]}, ${data[1]}, ${data[2]})`;
        }
      } catch (e) {
        // Fallback if conversion fails
      }
      
      // Fallback colors based on dark/light mode
      const isDark = document.documentElement.classList.contains('dark') || 
                     window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (isDark) {
        if (cleanColor.includes('background') || cleanColor.includes('0.145') || cleanColor.includes('0.205')) {
          return '#1a1a1a';
        }
        if (cleanColor.includes('border') || cleanColor.includes('0.922')) {
          return '#404040';
        }
        if (cleanColor.includes('primary') || cleanColor.includes('0.922')) {
          return '#e5e5e5';
        }
        if (cleanColor.includes('destructive')) {
          return '#ef4444';
        }
        if (cleanColor.includes('chart')) {
          return '#22c55e';
        }
      } else {
        if (cleanColor.includes('background')) {
          return '#ffffff';
        }
        if (cleanColor.includes('border') || cleanColor.includes('0.922')) {
          return '#e5e5e5';
        }
        if (cleanColor.includes('primary')) {
          return '#171717';
        }
        if (cleanColor.includes('destructive')) {
          return '#dc2626';
        }
        if (cleanColor.includes('chart')) {
          return '#16a34a';
        }
      }
      return '#000000';
    };

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
          if (value !== undefined && !isNaN(value)) {
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
    if (duration > 0) {
      const playheadX = (currentTime / duration) * displayWidth;
      ctx.strokeStyle = cssColorToRgb(destructiveColor);
      ctx.lineWidth = isDragging ? 3 : 2;
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
    if (startPosition > 0 && duration > 0) {
      const startX = (startPosition / duration) * displayWidth;
      ctx.strokeStyle = cssColorToRgb(chart1Color);
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(startX, 0);
      ctx.lineTo(startX, displayHeight);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [audioData, calculateCanvasWidth, currentTime, startPosition, isDragging]);

  // Update playhead position (only when not dragging)
  useEffect(() => {
    const updatePlayhead = () => {
      if (isPlaying && !isDragging && audioContextRef.current && audioData) {
        // Calculate elapsed time since current play session started
        const sessionElapsed = audioContextRef.current.currentTime - startTimeRef.current;
        // Total time is the position when we started this session plus elapsed
        const totalTime = pausedAtRef.current + sessionElapsed;
        const newTime = Math.min(totalTime, audioData.duration);
        setCurrentTime(newTime);
        drawWaveform();
        
        if (newTime < audioData.duration) {
          animationFrameRef.current = requestAnimationFrame(updatePlayhead);
        } else {
          // Reached end
          setIsPlaying(false);
          setCurrentTime(audioData.duration);
        }
      }
    };

    if (isPlaying && !isDragging) {
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
  }, [isPlaying, isDragging, audioData, drawWaveform]);

  useEffect(() => {
    if (audioData) {
      drawWaveform();
    }
  }, [audioData, drawWaveform]);

  useEffect(() => {
    const handleResize = () => {
      setScreenWidth(window.innerWidth);
      if (audioData) {
        drawWaveform();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [audioData, drawWaveform]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
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
    };
  }, []);

  const initializeAudio = async (arrayBuffer: ArrayBuffer) => {
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
      alert('Failed to initialize audio playback');
    }
  };

  const handlePlayPause = async () => {
    if (!audioData || !audioBufferRef.current) return;

    if (!audioContextRef.current) {
      await initializeAudio(audioData.audioBuffer);
    }

    const audioContext = audioContextRef.current;
    if (!audioContext || !audioBufferRef.current) return;

    if (isPlaying) {
      // Pause and reset to start position
      if (sourceNodeRef.current) {
        sourceNodeRef.current.stop();
        sourceNodeRef.current = null;
      }
      setIsPlaying(false);
      setCurrentTime(startPosition);
      pausedAtRef.current = startPosition;
      drawWaveform();
    } else {
      // Play from start position (reset and play)
      const source = audioContext.createBufferSource();
      source.buffer = audioBufferRef.current;
      source.connect(audioContext.destination);

      const startOffset = Math.max(0, startPosition);
      const remainingDuration = audioData.duration - startOffset;
      
      if (remainingDuration > 0) {
        source.start(0, startOffset);
        startTimeRef.current = audioContext.currentTime;
        pausedAtRef.current = startPosition;
        
        sourceNodeRef.current = source;

        source.onended = () => {
          setIsPlaying(false);
          setCurrentTime(audioData.duration);
          pausedAtRef.current = audioData.duration;
          sourceNodeRef.current = null;
        };

        setIsPlaying(true);
        setCurrentTime(startPosition);
        drawWaveform();
      }
    }
  };

  // Keyboard shortcuts for spacebar (play/pause) and 'A' key (tagging)
  useEffect(() => {
    const handleKeyDown = async (event: KeyboardEvent) => {
      // Don't trigger if user is typing in an input field
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      // 'A' key for tagging
      if (event.code === 'KeyA' || event.key === 'a' || event.key === 'A') {
        event.preventDefault();
        if (!audioData) return;

        if (pendingTagStart === null) {
          // Start a new tag at current time
          setPendingTagStart(currentTime);
        } else {
          // Complete the tag
          const startTime = pendingTagStart;
          const endTime = currentTime;
          
          // Only add tag if end time is after start time
          if (endTime > startTime) {
            setTags(prev => [...prev, [startTime, endTime]]);
            setPendingTagStart(null);
          } else {
            // If end is before start, reset
            setPendingTagStart(null);
          }
        }
        return;
      }

      // Spacebar pressed
      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();
        if (!audioData || !audioBufferRef.current) return;

        if (!audioContextRef.current) {
          await initializeAudio(audioData.audioBuffer);
        }

        const audioContext = audioContextRef.current;
        if (!audioContext || !audioBufferRef.current) return;

        if (isPlaying) {
          // Pause and reset to start position
          if (sourceNodeRef.current) {
            sourceNodeRef.current.stop();
            sourceNodeRef.current = null;
          }
          setIsPlaying(false);
          setCurrentTime(startPosition);
          pausedAtRef.current = startPosition;
          drawWaveform();
        } else {
          // Play from start position (reset and play)
          const source = audioContext.createBufferSource();
          source.buffer = audioBufferRef.current;
          source.connect(audioContext.destination);

          const startOffset = Math.max(0, startPosition);
          const remainingDuration = audioData.duration - startOffset;
          
          if (remainingDuration > 0) {
            source.start(0, startOffset);
            startTimeRef.current = audioContext.currentTime;
            pausedAtRef.current = startPosition;
            
            sourceNodeRef.current = source;

            source.onended = () => {
              setIsPlaying(false);
              setCurrentTime(audioData.duration);
              pausedAtRef.current = audioData.duration;
              sourceNodeRef.current = null;
            };

            setIsPlaying(true);
            setCurrentTime(startPosition);
            drawWaveform();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [audioData, isPlaying, startPosition, drawWaveform, currentTime, pendingTagStart]);

  const getTimeFromX = useCallback((clientX: number): number => {
    if (!audioData || !canvasRef.current) return 0;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const displayWidth = calculateCanvasWidth(audioData.duration);
    const clickPosition = Math.max(0, Math.min(1, x / displayWidth));
    return Math.max(0, Math.min(clickPosition * audioData.duration, audioData.duration));
  }, [audioData, calculateCanvasWidth]);

  const isClickNearPlayhead = useCallback((clientX: number, tolerance: number = 15): boolean => {
    if (!audioData || !canvasRef.current) return false;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const displayWidth = calculateCanvasWidth(audioData.duration);
    const playheadX = (currentTime / audioData.duration) * displayWidth;
    return Math.abs(x - playheadX) <= tolerance;
  }, [audioData, currentTime, calculateCanvasWidth]);

  const seekToTime = useCallback((time: number, pauseAudio: boolean = false) => {
    if (!audioData) return;

    const wasPlaying = isPlaying && !pauseAudio;
    
    if (isPlaying && sourceNodeRef.current && audioContextRef.current) {
      // Stop current playback
      sourceNodeRef.current.stop();
      sourceNodeRef.current = null;
    }

    if (pauseAudio) {
      setIsPlaying(false);
    }

    setCurrentTime(time);
    pausedAtRef.current = time;

    // If it was playing and not pausing, continue from new position
    if (wasPlaying && audioContextRef.current && audioBufferRef.current) {
      const audioContext = audioContextRef.current;
      const source = audioContext.createBufferSource();
      source.buffer = audioBufferRef.current;
      source.connect(audioContext.destination);
      
      const remainingDuration = audioData.duration - time;
      if (remainingDuration > 0) {
        source.start(0, time);
        startTimeRef.current = audioContext.currentTime;
        sourceNodeRef.current = source;

        source.onended = () => {
          setIsPlaying(false);
          setCurrentTime(audioData.duration);
          pausedAtRef.current = audioData.duration;
          sourceNodeRef.current = null;
        };
      } else {
        setIsPlaying(false);
      }
    }

    drawWaveform();
  }, [audioData, isPlaying, drawWaveform]);

  const handleCanvasMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!audioData || !canvasRef.current) return;

    event.preventDefault();
    const isNearPlayhead = isClickNearPlayhead(event.clientX);
    
    if (isNearPlayhead) {
      // Start dragging playhead
      setIsDragging(true);
      wasPlayingBeforeDragRef.current = isPlaying;
      
      // Pause audio when starting to drag
      if (isPlaying && sourceNodeRef.current && audioContextRef.current) {
        const audioContext = audioContextRef.current;
        const sessionElapsed = audioContext.currentTime - startTimeRef.current;
        pausedAtRef.current = pausedAtRef.current + sessionElapsed;
        sourceNodeRef.current.stop();
        sourceNodeRef.current = null;
        setIsPlaying(false);
      }
    } else {
      // Regular click - set start position
      const time = getTimeFromX(event.clientX);
      setStartPosition(time);
      seekToTime(time, false);
    }
  };

  const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    // Mouse move on canvas is handled by global handler when dragging
    // This is just for hover effects if needed
  };

  const handleCanvasMouseUp = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;

    const time = getTimeFromX(event.clientX);
    pausedAtRef.current = time;
    setIsDragging(false);
    
    // Don't auto-resume - user needs to click play
    drawWaveform();
  };

  const handleCanvasMouseLeave = () => {
    if (isDragging) {
      setIsDragging(false);
      drawWaveform();
    }
  };

  // Touch handlers for mobile
  const handleCanvasTouchStart = (event: React.TouchEvent<HTMLCanvasElement>) => {
    if (!audioData || !canvasRef.current) return;
    const touch = event.touches[0];
    if (!touch) return;

    const isNearPlayhead = isClickNearPlayhead(touch.clientX);
    
    if (isNearPlayhead) {
      setIsDragging(true);
      wasPlayingBeforeDragRef.current = isPlaying;
      
      if (isPlaying && sourceNodeRef.current && audioContextRef.current) {
        const audioContext = audioContextRef.current;
        const sessionElapsed = audioContext.currentTime - startTimeRef.current;
        pausedAtRef.current = pausedAtRef.current + sessionElapsed;
        sourceNodeRef.current.stop();
        sourceNodeRef.current = null;
        setIsPlaying(false);
      }
      
      event.preventDefault();
    } else {
      const time = getTimeFromX(touch.clientX);
      setStartPosition(time);
      seekToTime(time, false);
    }
  };

  const handleCanvasTouchMove = (event: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDragging || !audioData) return;
    const touch = event.touches[0];
    if (!touch) return;

    const time = getTimeFromX(touch.clientX);
    setCurrentTime(time);
    pausedAtRef.current = time;
    drawWaveform();
    event.preventDefault();
  };

  const handleCanvasTouchEnd = () => {
    if (isDragging) {
      setIsDragging(false);
      drawWaveform();
    }
  };

  // Handle mouse move and up globally for dragging
  useEffect(() => {
    const handleGlobalMouseMove = (event: MouseEvent) => {
      if (isDragging && audioData && canvasRef.current) {
        const time = getTimeFromX(event.clientX);
        setCurrentTime(time);
        pausedAtRef.current = time;
        drawWaveform();
      }
    };

    const handleGlobalMouseUp = (event: MouseEvent) => {
      if (isDragging) {
        const time = audioData && canvasRef.current ? getTimeFromX(event.clientX) : pausedAtRef.current;
        pausedAtRef.current = time;
        setIsDragging(false);
        if (audioData) {
          drawWaveform();
        }
      }
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleGlobalMouseMove, { passive: false });
      window.addEventListener('mouseup', handleGlobalMouseUp);
      document.body.style.userSelect = 'none'; // Prevent text selection while dragging
      return () => {
        window.removeEventListener('mousemove', handleGlobalMouseMove);
        window.removeEventListener('mouseup', handleGlobalMouseUp);
        document.body.style.userSelect = '';
      };
    }
  }, [isDragging, audioData, getTimeFromX, drawWaveform]);

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.wav')) {
      alert('Please select a .wav file');
      return;
    }

    setLoading(true);
    try {
      const data = await parseWavFile(file);
      setAudioData(data);
      setFileName(file.name);
      setCurrentTime(0);
      setStartPosition(0);
      pausedAtRef.current = 0;
      setIsPlaying(false);
      setTags([]); // Clear tags when loading new file
      setPendingTagStart(null); // Clear pending tag
      
      // Initialize audio for playback
      await initializeAudio(data.audioBuffer);
    } catch (error) {
      console.error('Error parsing WAV file:', error);
      alert(`Error loading WAV file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  const formatTime = (seconds: number): string => {
    const secs = Math.floor(seconds);
    const millis = Math.floor((seconds - secs) * 1000);
    return `${secs}.${millis.toString().padStart(3, '0')}`;
  };

  return (
    <div className="h-screen flex flex-col w-full min-w-0 max-w-screen overflow-hidden">
      <Card className="shrink-0 max-w-full overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle>Waveform Viewer</CardTitle>
          <CardDescription>
            Upload a .wav file to visualize its waveform in Audacity-style
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Button onClick={handleButtonClick} disabled={loading}>
              {loading ? 'Loading...' : 'Open WAV File'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".wav"
              onChange={handleFileSelect}
              className="hidden"
            />
            {fileName && (
              <span className="text-sm text-muted-foreground">
                {fileName}
              </span>
            )}
          </div>

          {audioData && (
            <>
              <div className="flex items-center gap-4">
                <Button 
                  onClick={handlePlayPause} 
                  disabled={!audioBufferRef.current}
                  size="lg"
                >
                  {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
                  {isPlaying ? 'Reset & Pause' : 'Reset & Play'}
                </Button>
                <div className="text-sm font-mono">
                  <span>{formatTime(currentTime)}</span>
                  {audioData && <span className="text-muted-foreground"> / {formatTime(audioData.duration)}</span>}
                </div>
                {startPosition > 0 && (
                  <div className="text-sm text-muted-foreground">
                    Start: {formatTime(startPosition)}
                  </div>
                )}
              </div>
              <div className="flex gap-4 text-sm text-muted-foreground flex-wrap">
                <span>Sample Rate: {audioData.sampleRate.toLocaleString()} Hz</span>
                <span>Channels: {audioData.channels}</span>
                <span>Duration: {audioData.duration.toFixed(2)}s ({(audioData.duration / 60).toFixed(2)} min)</span>
                <span>Samples: {audioData.samples.length.toLocaleString()}</span>
                <span>Scale: {MINUTES_BASE} min = {screenWidth}px</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {audioData && (
        <div 
          ref={containerRef}
          className="flex-1 overflow-x-auto overflow-y-hidden min-w-0 w-full"
          style={{ maxWidth: '100%', width: '100%', paddingTop: '16px', paddingBottom: '0', paddingLeft: '0', paddingRight: '0', boxSizing: 'border-box' }}
        >
          <div className="border rounded-lg overflow-hidden" style={{ height: '256px', display: 'inline-block', maxWidth: 'none', marginLeft: '16px', marginRight: '16px' }}>
            <canvas
              ref={canvasRef}
              className="block cursor-pointer"
              style={{ height: '256px' }}
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
        <div className="flex-1 flex items-center justify-center bg-background">
          <div className="border-2 border-dashed rounded-lg p-12 text-center text-muted-foreground">
            <p>No file loaded. Click "Open WAV File" to get started.</p>
          </div>
        </div>
      )}

      {/* Tags list section */}
      {(tags.length > 0 || pendingTagStart !== null) && (
        <div className="shrink-0 border-t border-border bg-card p-4 max-h-64 overflow-y-auto">
          <div className="container mx-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-card-foreground">
                Tags {pendingTagStart !== null && <span className="text-muted-foreground text-xs">(Press A again to set end)</span>}
              </h3>
              {tags.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      const json = JSON.stringify(tags, null, 2);
                      await navigator.clipboard.writeText(json);
                      // You could add a toast notification here if you have one
                    } catch (error) {
                      console.error('Failed to copy:', error);
                      alert('Failed to copy to clipboard');
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
                <div
                  key={index}
                  className="flex items-center justify-between p-2 bg-background rounded-md border border-border"
                >
                  <div className="flex items-center gap-4 text-sm">
                    <span className="font-mono text-card-foreground">
                      {formatTime(tag[0])} - {formatTime(tag[1])}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      ({formatTime(tag[1] - tag[0])})
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setTags(prev => prev.filter((_, i) => i !== index));
                    }}
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                  >
                    ×
                  </Button>
                </div>
              ))}
              {pendingTagStart !== null && (
                <div className="flex items-center justify-between p-2 bg-primary/10 rounded-md border border-primary/30">
                  <div className="flex items-center gap-4 text-sm">
                    <span className="font-mono text-card-foreground">
                      {formatTime(pendingTagStart)} - ...
                    </span>
                    <span className="text-primary text-xs">(Pending end time)</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingTagStart(null)}
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                  >
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
            <a 
              href="https://github.com/tomast1337/audioTimes" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-card-foreground hover:text-primary transition-colors duration-200 rounded-md p-2"
            >
              <svg className="shrink-0" width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
                <path
                  d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                />
              </svg>
              Repository
            </a>
            <a 
              href="https://github.com/tomast1337" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-card-foreground hover:text-primary transition-colors duration-200 rounded-md p-2"
            >
              <svg className="shrink-0" width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
                <path
                  d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                />
              </svg>
              @tomast1337
            </a>
            <a 
              href="https://www.linkedin.com/in/nicolas-vycas/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-card-foreground hover:text-primary transition-colors duration-200 rounded-md p-2"
            >
              <svg className="shrink-0" width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
                <path
                  d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
                />
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
