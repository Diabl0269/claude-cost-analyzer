/**
 * Narration: macOS `say` → one AIFF per scene, measured with ffprobe.
 * No network, no third-party TTS — the voices are whatever the machine has installed.
 */
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const FFMPEG = process.env.CCA_FFMPEG ?? '/opt/homebrew/bin/ffmpeg';
export const FFPROBE = process.env.CCA_FFPROBE ?? '/opt/homebrew/bin/ffprobe';

/** Words per minute handed to `say`. Slow enough to follow a screen tour. */
export const SPEAK_RATE = 178;

/**
 * `say`'s PCM spec for the per-scene AIFFs. AIFF is a big-endian container, so `LEF32` is
 * rejected outright ("Opening output file failed: fmt?"); `BEF32` is the same 32-bit float at the
 * same rate, byte order aside. The little-endian spellings are kept as fallbacks in case a future
 * macOS accepts them.
 */
export const DATA_FORMATS = ['BEF32@22050', 'LEF32@22050', 'BEI16@22050'] as const;

export interface Voice {
  name: string;
  locale: string;
}

/** `say -v '?'` prints `Name<2+ spaces>locale  # sample`; the name itself can hold spaces and parens. */
export async function installedVoices(): Promise<Voice[]> {
  const { stdout } = await run('say', ['-v', '?']);
  const voices: Voice[] = [];
  for (const line of stdout.split('\n')) {
    const match = /^(.+?)\s{2,}([A-Za-z_-]+)\s+#/.exec(line);
    if (match?.[1] && match[2]) voices.push({ name: match[1].trim(), locale: match[2] });
  }
  return voices;
}

/**
 * Best available en_US voice: a Premium download beats an Enhanced one, which beats the
 * compact "Samantha" every Mac ships with. `docs/dev/demo-video.md` says how to install one.
 */
export function pickVoice(voices: Voice[], requested?: string): string {
  if (requested) return requested;
  const enUs = voices.filter((voice) => voice.locale === 'en_US');
  const tier = (voice: Voice): number =>
    voice.name.includes('(Premium)') ? 0 : voice.name.includes('(Enhanced)') ? 1 : voice.name === 'Samantha' ? 2 : 3;
  const ranked = [...enUs].sort((a, b) => tier(a) - tier(b) || a.name.localeCompare(b.name));
  return ranked[0]?.name ?? 'Samantha';
}

/** Seconds, from the container header. Throws only if ffprobe cannot read the file at all. */
export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    file,
  ]);
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds)) throw new Error(`ffprobe could not measure ${path.basename(file)}`);
  return seconds;
}

export interface Segment {
  /** scene id */
  id: string;
  file: string;
  seconds: number;
}

/** Anything smaller than this is a header and nothing else. */
const MIN_AIFF_BYTES = 8 * 1024;

async function speak(text: string, voice: string, file: string, format: string): Promise<void> {
  await run('say', ['-v', voice, '-r', String(SPEAK_RATE), '-o', file, `--data-format=${format}`, text]);
  const { size } = await stat(file);
  if (size < MIN_AIFF_BYTES) throw new Error(`say wrote only ${size} bytes`);
}

/**
 * One AIFF per scene, float32 @ 22.05 kHz — lossless enough that the AAC pass is the only loss.
 *
 * Note for anyone running this from an agent shell: a sandboxed shell makes `say` exit 0 while
 * writing a 4 KB header and no samples, because it cannot reach the speech-synthesis service.
 * The size check below turns that into a readable error instead of a silent video.
 */
export async function synthesize(
  scenes: { id: string; narration: string }[],
  voice: string,
  dir: string,
): Promise<Segment[]> {
  const segments: Segment[] = [];
  let chosen: string | null = null;
  for (const [index, scene] of scenes.entries()) {
    const file = path.join(dir, `seg-${String(index).padStart(2, '0')}.aiff`);
    if (chosen) {
      await speak(scene.narration, voice, file, chosen);
    } else {
      const failures: string[] = [];
      for (const format of DATA_FORMATS) {
        try {
          await speak(scene.narration, voice, file, format);
          chosen = format;
          break;
        } catch (error) {
          failures.push(`${format}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
        }
      }
      if (!chosen) {
        throw new Error(
          `say produced no audio for voice "${voice}". Tried ${DATA_FORMATS.join(', ')}.\n  ${failures.join('\n  ')}\n` +
            '  If this is an agent shell, rerun it unsandboxed — `say` needs the speech-synthesis service.',
        );
      }
    }
    segments.push({ id: scene.id, file, seconds: await probeDuration(file) });
  }
  return segments;
}
