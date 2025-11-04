import { useReducer } from "react";
import type { AudioData } from "../types";

export interface WaveformState {
    audioData: AudioData | null;
    fileName: string;
    loading: boolean;
    screenWidth: number;
    isPlaying: boolean;
    currentTime: number;
    startPosition: number;
    isDragging: boolean;
    tags: Array<[number, number]>;
    pendingTagStart: number | null;
}

export type WaveformAction =
    | { type: "FILE_LOAD_START" }
    | { type: "FILE_LOAD_SUCCESS"; payload: { audioData: AudioData; fileName: string } }
    | { type: "FILE_LOAD_ERROR" }
    | { type: "PLAY" }
    | { type: "PAUSE" }
    | { type: "SEEK"; payload: { time: number } }
    | { type: "SET_START_POSITION"; payload: { position: number } }
    | { type: "DRAG_START" }
    | { type: "DRAG_MOVE"; payload: { time: number } }
    | { type: "DRAG_END" }
    | { type: "TIME_UPDATE"; payload: { time: number } }
    | { type: "TOGGLE_TAG"; payload: { currentTime: number } }
    | { type: "REMOVE_TAG"; payload: { index: number } }
    | { type: "CLEAR_PENDING_TAG" }
    | { type: "RESIZE"; payload: { screenWidth: number } };

export const initialState: WaveformState = {
    audioData: null,
    fileName: "",
    loading: false,
    screenWidth: typeof window !== "undefined" ? window.innerWidth : 1920,
    isPlaying: false,
    currentTime: 0,
    startPosition: 0,
    isDragging: false,
    tags: [],
    pendingTagStart: null,
};

export function waveformReducer(state: WaveformState, action: WaveformAction): WaveformState {
    switch (action.type) {
        case "FILE_LOAD_START":
            return { ...state, loading: true };

        case "FILE_LOAD_SUCCESS":
            return {
                ...state,
                audioData: action.payload.audioData,
                fileName: action.payload.fileName,
                loading: false,
                currentTime: 0,
                startPosition: 0,
                isPlaying: false,
                tags: [],
                pendingTagStart: null,
            };

        case "FILE_LOAD_ERROR":
            return { ...state, loading: false };

        case "PLAY":
            return { ...state, isPlaying: true };

        case "PAUSE":
            return { ...state, isPlaying: false };

        case "SEEK":
            return { ...state, currentTime: action.payload.time };

        case "SET_START_POSITION":
            return { ...state, startPosition: action.payload.position };

        case "DRAG_START":
            return { ...state, isDragging: true };

        case "DRAG_MOVE":
            return { ...state, currentTime: action.payload.time, isDragging: true };

        case "DRAG_END":
            return { ...state, isDragging: false };

        case "TIME_UPDATE":
            return { ...state, currentTime: action.payload.time };

        case "TOGGLE_TAG": {
            const { currentTime } = action.payload;
            if (state.pendingTagStart === null) {
                // Start a new tag at current time
                return { ...state, pendingTagStart: currentTime };
            } else {
                // Complete the tag
                const startTime = state.pendingTagStart;
                const endTime = currentTime;

                // Only add tag if end time is after start time
                if (endTime > startTime) {
                    return {
                        ...state,
                        tags: [...state.tags, [startTime, endTime]],
                        pendingTagStart: null,
                    };
                } else {
                    // If end is before start, reset
                    return { ...state, pendingTagStart: null };
                }
            }
        }

        case "REMOVE_TAG":
            return {
                ...state,
                tags: state.tags.filter((_, i) => i !== action.payload.index),
            };

        case "CLEAR_PENDING_TAG":
            return { ...state, pendingTagStart: null };

        case "RESIZE":
            return { ...state, screenWidth: action.payload.screenWidth };

        default:
            return state;
    }
}

export function useWaveformReducer() {
    return useReducer(waveformReducer, initialState);
}
