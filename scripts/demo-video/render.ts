/**
 * ffmpeg passes: narration mixdown, H.264 + AAC mp4, VP9 + Opus webm, a palettised GIF and a
 * poster frame. Alignment lives in `mixNarration`: each segment is delayed to its scene's start.
 */
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { FFMPEG, FFPROBE, type Segment } from './tts.js';

const run = promisify(execFile);

async function ffmpeg(args: string[]): Promise<void> {
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 32 * 1024 * 1024 });
}

export async function fileSize(file: string): Promise<number> {
  return (await stat(file)).size;
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * One stereo wav, `totalSeconds` long, with segment k starting at `startsMs[k]`.
 * `adelay` is sample-accurate, so the offset is exact rather than ±a frame.
 */
export async function mixNarration(
  segments: Segment[],
  startsMs: number[],
  totalSeconds: number,
  outFile: string,
): Promise<void> {
  const inputs: string[] = [];
  const chains: string[] = [];
  const labels: string[] = [];
  segments.forEach((segment, index) => {
    inputs.push('-i', segment.file);
    const delay = Math.max(0, Math.round(startsMs[index] ?? 0));
    chains.push(`[${index}:a]aresample=48000,adelay=delays=${delay}:all=1[a${index}]`);
    labels.push(`[a${index}]`);
  });
  const mix = `${labels.join('')}amix=inputs=${segments.length}:normalize=0:dropout_transition=0[m]`;
  const filter = `${chains.join(';')};${mix};[m]apad[out]`;
  await ffmpeg([
    ...inputs,
    '-filter_complex', filter,
    '-map', '[out]',
    '-t', totalSeconds.toFixed(3),
    '-ac', '2',
    '-ar', '48000',
    '-c:a', 'pcm_s16le',
    outFile,
  ]);
}

export interface EncodeInput {
  video: string;
  /** seconds trimmed off the front of the recording, so frame 0 is the tour's t0 */
  preRollSeconds: number;
  audio: string | null;
  width: number;
  height: number;
  durationSeconds: number;
}

/** libx264 crf 19 / preset slow, faststart so it streams in GitHub's file viewer. */
export async function encodeMp4(input: EncodeInput, outFile: string): Promise<void> {
  const args = ['-ss', input.preRollSeconds.toFixed(3), '-i', input.video];
  if (input.audio) args.push('-i', input.audio);
  args.push(
    '-map', '0:v:0',
    ...(input.audio ? ['-map', '1:a:0'] : []),
    '-vf', `scale=${input.width}:${input.height}:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264',
    '-crf', '19',
    '-preset', 'slow',
    '-pix_fmt', 'yuv420p',
    '-r', '30',
    '-movflags', '+faststart',
  );
  if (input.audio) args.push('-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2');
  args.push('-t', input.durationSeconds.toFixed(3), outFile);
  await ffmpeg(args);
}

/** VP9 + Opus, so the mp4 is not the only file a browser will play. */
export async function encodeWebm(input: EncodeInput, outFile: string): Promise<void> {
  const args = ['-ss', input.preRollSeconds.toFixed(3), '-i', input.video];
  if (input.audio) args.push('-i', input.audio);
  args.push(
    '-map', '0:v:0',
    ...(input.audio ? ['-map', '1:a:0'] : []),
    '-vf', `scale=${input.width}:${input.height}:flags=lanczos,format=yuv420p`,
    '-c:v', 'libvpx-vp9',
    '-crf', '34',
    '-b:v', '0',
    '-row-mt', '1',
    '-deadline', 'good',
    '-cpu-used', '3',
    '-r', '30',
  );
  if (input.audio) args.push('-c:a', 'libopus', '-b:a', '96k');
  args.push('-t', input.durationSeconds.toFixed(3), outFile);
  await ffmpeg(args);
}

export interface GifResult {
  bytes: number;
  fps: number;
  width: number;
}

/**
 * The first `seconds` of the tour as a GIF — that is what GitHub renders inline in a README.
 * Steps fps/width down until it fits `maxBytes`, because a 20 MB GIF in a README is a bug.
 */
export async function encodeGif(
  mp4: string,
  seconds: number,
  outFile: string,
  paletteFile: string,
  maxBytes: number,
): Promise<GifResult> {
  const ladder: { fps: number; width: number }[] = [
    { fps: 12, width: 1000 },
    { fps: 10, width: 1000 },
    { fps: 10, width: 900 },
    { fps: 8, width: 800 },
    { fps: 8, width: 720 },
  ];
  let last: GifResult = { bytes: 0, fps: 12, width: 1000 };
  for (const step of ladder) {
    const chain = `fps=${step.fps},scale=${step.width}:-1:flags=lanczos`;
    await ffmpeg(['-t', seconds.toFixed(3), '-i', mp4, '-vf', `${chain},palettegen=stats_mode=diff`, paletteFile]);
    await ffmpeg([
      '-t', seconds.toFixed(3), '-i', mp4,
      '-i', paletteFile,
      '-lavfi', `${chain}[x];[x][1:v]paletteuse=dither=sierra2_4a`,
      '-loop', '0',
      outFile,
    ]);
    last = { bytes: await fileSize(outFile), fps: step.fps, width: step.width };
    if (last.bytes <= maxBytes) return last;
  }
  return last;
}

/** `-q:v 3` on the mjpeg encoder is roughly JPEG quality 85–90. */
export async function encodePoster(mp4: string, atSeconds: number, width: number, outFile: string): Promise<void> {
  await ffmpeg([
    '-ss', atSeconds.toFixed(3),
    '-i', mp4,
    '-frames:v', '1',
    '-vf', `scale=${width}:-2:flags=lanczos`,
    '-q:v', '3',
    outFile,
  ]);
}

export async function extractFrame(video: string, atSeconds: number, outFile: string): Promise<void> {
  await ffmpeg(['-ss', atSeconds.toFixed(3), '-i', video, '-frames:v', '1', outFile]);
}

export async function probeStreams(file: string): Promise<string> {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels,bit_rate',
    '-show_entries', 'format=duration,size,bit_rate',
    '-of', 'default=noprint_wrappers=0',
    file,
  ]);
  return stdout.trim();
}

/** mean/max dB over the whole file — a silent narration track reports -91 dB. */
export async function volumeDetect(file: string): Promise<string> {
  const { stderr } = await run(
    FFMPEG,
    ['-hide_banner', '-i', file, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-'],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  return stderr
    .split('\n')
    .filter((line) => line.includes('volumedetect'))
    .map((line) => line.replace(/^.*volumedetect.*?\]\s*/, ''))
    .join(' · ');
}
