import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FFMPEG_TIMEOUT_MS = 120_000;
const MAX_FFMPEG_STDERR = 4_000;

/**
 * Drop the static lead-in of an image-to-video clip by re-encoding it with a
 * start offset, so the result opens already in motion instead of holding the
 * exact input image as frame 0.
 *
 * Best-effort by design: a missing `ffmpeg` binary (e.g. serverless runtimes),
 * a clip shorter than the offset, or any encode error returns the original
 * bytes unchanged, so a run never fails because of trimming. Only `video/*`
 * outputs are touched; images and a non-positive offset pass straight through.
 */
export async function trimVideoLeadIn(input: {
  bytes: Uint8Array;
  contentType: string;
  leadInMs: number;
  ffmpegPath?: string;
}): Promise<Uint8Array> {
  if (input.leadInMs <= 0 || !input.contentType.startsWith('video/')) {
    return input.bytes;
  }

  const extension = videoExtension(input.contentType);
  const ffmpegPath = input.ffmpegPath?.trim() || 'ffmpeg';
  const seconds = (input.leadInMs / 1000).toFixed(3);

  let dir: string | null = null;

  try {
    dir = await mkdtemp(join(tmpdir(), 'marsha-trim-'));
    const inputPath = join(dir, `in.${extension}`);
    const outputPath = join(dir, `out.${extension}`);
    await writeFile(inputPath, input.bytes);

    // `-ss` before `-i` seeks the input; the first 0.x seconds of an i2v clip
    // have no keyframe to stream-copy, so the trimmed segment is re-encoded.
    await runFfmpeg(ffmpegPath, [
      '-y',
      '-ss',
      seconds,
      '-i',
      inputPath,
      '-map',
      '0',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      outputPath,
    ]);

    const trimmed = await readFile(outputPath);

    if (trimmed.byteLength === 0) {
      return input.bytes;
    }

    return Uint8Array.from(trimmed);
  } catch (error) {
    console.warn('[marsha] video trim skipped; using original output', {
      error: error instanceof Error ? error.message : String(error),
      leadInMs: input.leadInMs,
    });
    return input.bytes;
  } finally {
    if (dir) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function runFfmpeg(ffmpegPath: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('ffmpeg timed out'));
    }, FFMPEG_TIMEOUT_MS);

    child.stderr?.on('data', (chunk) => {
      if (stderr.length < MAX_FFMPEG_STDERR) {
        stderr += String(chunk);
      }
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(`ffmpeg exited with code ${code}: ${stderr.slice(0, 500)}`),
      );
    });
  });
}

function videoExtension(contentType: string) {
  if (contentType === 'video/webm') return 'webm';
  if (contentType === 'video/quicktime') return 'mov';
  return 'mp4';
}
