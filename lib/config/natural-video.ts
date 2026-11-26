/**
 * Natural video openings
 *
 * Image-to-video models pin the conditioning image as the literal first frame
 * (frame 0), so a clip opens on a frozen copy of the previous step before
 * motion begins. These constants control how the app softens that. They are
 * intentionally plain code constants (not env vars) - edit them here, in one
 * place, to change behaviour. See the "Natural video openings" section of the
 * README for the full explanation.
 */

/**
 * Opt-in (off by default). Send the auto chain handoff image (the previous
 * step's output) to the providers that support it as a subject
 * `reference_image` instead of a pinned `first_frame`, so those clips open
 * already in motion at the source with no re-encode.
 *
 * Off by default because it only covers BytePlus (Seedance) and Alibaba
 * (Wan i2v) - Runway and Google have no reference mode - so the default instead
 * relies on `VIDEO_TRIM_LEAD_IN_MS` to soften every provider uniformly. Turn
 * this on to additionally fix BytePlus/Alibaba at the source, which is the
 * recommended opening fix on runtimes without ffmpeg (e.g. Vercel), where the
 * trim cannot run.
 *
 * A caller-provided first image (`generation_input_image_file`) always stays
 * `first_frame`, and Alibaba `r2v` models already use a reference frame and are
 * unchanged.
 */
export const VIDEO_HANDOFF_AS_REFERENCE: boolean = false;

/**
 * The default opening fix. Trim this many milliseconds off the start of every
 * stored video output to drop the brief static hold every image-to-video model
 * emits before motion begins. It is provider-agnostic, so it treats every model
 * the same - Runway and Google included, which ignore
 * {@link VIDEO_HANDOFF_AS_REFERENCE}.
 *
 * `0` disables it (and the re-encode entirely). `800` clears the typical hold
 * without cutting meaningful motion; keep it under ~1000 so it can never eat
 * real content. Tune it to your providers (lower if motion is clipped, higher
 * if a hold remains).
 *
 * Only runs when an output storage provider is configured (the bytes must be
 * downloaded to be re-encoded), re-encodes the clip with ffmpeg, and fails open
 * to the original bytes on any error - so it is a safe no-op on runtimes
 * without ffmpeg (e.g. Vercel serverless), where you would enable the reference
 * option above instead.
 */
export const VIDEO_TRIM_LEAD_IN_MS: number = 800;

/**
 * Path to the ffmpeg binary used by {@link VIDEO_TRIM_LEAD_IN_MS}. The default
 * resolves `ffmpeg` on `PATH` (bundled in the Docker image). Point it at an
 * absolute path if ffmpeg lives elsewhere.
 */
export const VIDEO_FFMPEG_PATH = 'ffmpeg';
