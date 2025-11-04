export function formatTime(seconds: number): string {
    const secs = Math.floor(seconds);
    const millis = Math.floor((seconds - secs) * 1000);
    return `${secs}.${millis.toString().padStart(3, "0")}`;
}
