import {
  ATTACHMENT_IMAGE_TOO_LARGE_MESSAGE,
  CHAT_ATTACHMENT_RULES,
  attachmentByteLimit,
  classifyAttachment,
} from "@bookmark-ai/types";
import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat, type ImageRef } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import {
  IMAGE_SOURCE_TOO_LARGE_MESSAGE,
  PHOTO_LIBRARY_UNAVAILABLE_MESSAGE,
  PickerError,
  attachmentFilename,
  base64ByteLength,
  dataUrl,
  newAttachmentId,
  tooLargeMessage,
  type PendingAttachment,
} from "./chatAttachments";

/**
 * The native half of Ask AI attachments: the system pickers, the image
 * downscale/re-encode, and reading a picked file into a `data:` URL. Every
 * policy decision (what's allowed, how big) comes from the shared contract in
 * @bookmark-ai/types + ./chatAttachments; this module only executes it.
 */

export interface PickOutcome {
  attachments: PendingAttachment[];
  /** Why the LAST refused file was refused (contract copy), or null. */
  rejected: string | null;
}

type Prepared = { attachment: PendingAttachment } | { reason: string };

const NONE: PickOutcome = { attachments: [], rejected: null };

/**
 * A "cancel" that comes back faster than a picker can even be drawn. On Android
 * `launchImageLibraryAsync` answers `{ canceled: true }` for more than the
 * user's Cancel, and the two extra cases start NO activity and throw nothing:
 *
 * - the module's native `isPickerOpen` latch is still set (ImagePickerModule
 *   returns `canceled` up-front while it believes a pick is in flight), and
 * - the system Photo Picker can't be launched on this build.
 *
 * A person cannot see and dismiss a picker inside 600 ms, so that answer is
 * read as "never opened" rather than as a cancel — otherwise the tap is a
 * silent no-op with no pill and no error, which is exactly how this looked in
 * QA on the Pixel emulator.
 */
const INSTANT_CANCEL_MS = 600;

type LibraryLaunch =
  | { kind: "picked"; assets: ImagePicker.ImagePickerAsset[] }
  | { kind: "canceled" }
  | { kind: "never-opened" };

async function launchLibrary(options: ImagePicker.ImagePickerOptions): Promise<LibraryLaunch> {
  const startedAt = Date.now();
  const result = await ImagePicker.launchImageLibraryAsync(options);
  if (!result.canceled) return { kind: "picked", assets: result.assets };
  const instant = Date.now() - startedAt < INSTANT_CANCEL_MS;
  return { kind: Platform.OS === "android" && instant ? "never-opened" : "canceled" };
}

/** Photo library → images downscaled to the contract's longest edge and re-encoded.
 * `maxCount` is how many slots the composer still has. */
export async function pickImages(maxCount: number): Promise<PickOutcome> {
  if (maxCount <= 0) return NONE;
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    allowsMultipleSelection: maxCount > 1,
    selectionLimit: maxCount,
    // Full quality here: WE re-encode after the downscale, so a lossy pass in the
    // picker would just compress the same pixels twice.
    quality: 1,
    exif: false,
    base64: false,
  };
  let launch = await launchLibrary(options);
  if (launch.kind === "never-opened") {
    // Android without a working system Photo Picker: the legacy
    // ACTION_GET_CONTENT chooser (DocumentsUI) is on every image.
    console.warn("[chat] photo picker never opened; retrying with the legacy Android picker");
    launch = await launchLibrary({ ...options, legacy: true });
    if (launch.kind === "never-opened") {
      // Both refused without opening anything — the native latch is stuck (it
      // only clears when the app restarts). Say so instead of failing silently.
      console.warn("[chat] legacy picker never opened either; ImagePicker is latched shut");
      throw new PickerError(PHOTO_LIBRARY_UNAVAILABLE_MESSAGE);
    }
  }
  if (launch.kind === "canceled") return NONE;
  return collect(
    launch.assets.slice(0, maxCount).map((asset) =>
      prepareImage({
        uri: asset.uri,
        name: asset.fileName ?? null,
        mimeType: asset.mimeType ?? null,
        bytes: asset.fileSize ?? null,
      }),
    ),
  );
}

/** Files app → documents, PDFs and images from the allowlist (extension first,
 * then reported MIME — see `classifyAttachment`). */
export async function pickDocuments(maxCount: number): Promise<PickOutcome> {
  if (maxCount <= 0) return NONE;
  const result = await DocumentPicker.getDocumentAsync({
    // Everything is selectable and the allowlist is enforced on pick, WITH the
    // contract's copy. A MIME filter would silently grey out `.md` on both
    // platforms (iOS maps it to a UTType inconsistently, Android often reports
    // application/octet-stream), and a greyed-out file explains nothing.
    type: "*/*",
    multiple: maxCount > 1,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return NONE;
  return collect(result.assets.slice(0, maxCount).map((asset) => prepareDocument(asset)));
}

async function collect(prepared: Promise<Prepared>[]): Promise<PickOutcome> {
  const attachments: PendingAttachment[] = [];
  let rejected: string | null = null;
  // Sequential on purpose: decoding two 10 MB photos at once is a memory spike
  // on older phones, and the order of the pills should match the pick order.
  for (const item of prepared) {
    const outcome = await item;
    if ("attachment" in outcome) attachments.push(outcome.attachment);
    else rejected = outcome.reason;
  }
  return { attachments, rejected };
}

interface ImageSource {
  uri: string;
  name: string | null;
  mimeType: string | null;
  bytes: number | null;
}

/**
 * Downscale to ≤ `maxEdgePx` on the longest edge and re-encode: JPEG ~0.85 by
 * default, PNG kept for PNG sources (the only way to keep transparency — there
 * is no cheap alpha probe on the phone; a PNG that still busts the cap gets one
 * JPEG retry before rejection), GIF passed through untouched when it fits
 * (re-encoding would drop the animation). Rejects with the contract copy.
 */
async function prepareImage(source: ImageSource): Promise<Prepared> {
  const rules = CHAT_ATTACHMENT_RULES.image;
  const sourceBytes = source.bytes ?? safeFileSize(source.uri);
  if (sourceBytes !== null && sourceBytes > rules.maxSourceBytes) {
    return { reason: IMAGE_SOURCE_TOO_LARGE_MESSAGE };
  }
  const mime = (source.mimeType ?? "").toLowerCase();
  const name = source.name ?? "";

  if (mime === "image/gif" || /\.gif$/i.test(name)) {
    const base64 = await new File(source.uri).base64();
    const bytes = base64ByteLength(base64);
    if (bytes > rules.maxEncodedBytes) return { reason: ATTACHMENT_IMAGE_TOO_LARGE_MESSAGE };
    return {
      attachment: {
        id: newAttachmentId(),
        kind: "image",
        filename: attachmentFilename(name, "image/gif"),
        mediaType: "image/gif",
        url: dataUrl("image/gif", base64),
        bytes,
      },
    };
  }

  // Decode once to learn the real pixel size (the picker may report 0×0), then
  // downscale from the decoded ref so the file is only read once.
  const decoded = await ImageManipulator.manipulate(source.uri).renderAsync();
  const longest = Math.max(decoded.width, decoded.height);
  const scale = longest > rules.maxEdgePx ? rules.maxEdgePx / longest : 1;
  const sized: ImageRef =
    scale < 1
      ? await ImageManipulator.manipulate(decoded)
          .resize({
            width: Math.max(1, Math.round(decoded.width * scale)),
            height: Math.max(1, Math.round(decoded.height * scale)),
          })
          .renderAsync()
      : decoded;

  const preferPng = mime === "image/png" || /\.png$/i.test(name);
  let mediaType = preferPng ? "image/png" : "image/jpeg";
  let saved = await sized.saveAsync(
    preferPng
      ? { format: SaveFormat.PNG, base64: true }
      : { format: SaveFormat.JPEG, compress: 0.85, base64: true },
  );
  let bytes = base64ByteLength(saved.base64 ?? "");
  if (preferPng && bytes > rules.maxEncodedBytes) {
    saved = await sized.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
    mediaType = "image/jpeg";
    bytes = base64ByteLength(saved.base64 ?? "");
  }
  if (!saved.base64 || bytes > rules.maxEncodedBytes) {
    return { reason: ATTACHMENT_IMAGE_TOO_LARGE_MESSAGE };
  }
  return {
    attachment: {
      id: newAttachmentId(),
      kind: "image",
      filename: attachmentFilename(name, mediaType),
      mediaType,
      url: dataUrl(mediaType, saved.base64),
      bytes,
      width: saved.width,
      height: saved.height,
    },
  };
}

async function prepareDocument(asset: DocumentPicker.DocumentPickerAsset): Promise<Prepared> {
  const classified = classifyAttachment(asset.name, asset.mimeType ?? null);
  if (classified.kind === "rejected") return { reason: classified.reason };
  if (classified.kind === "image") {
    // An image picked from Files goes through the same downscale as the library.
    return prepareImage({
      uri: asset.uri,
      name: asset.name,
      mimeType: classified.mediaType,
      bytes: asset.size ?? null,
    });
  }
  const limit = attachmentByteLimit(classified.kind);
  const file = new File(asset.uri);
  const size = asset.size ?? safeFileSize(asset.uri);
  if (size !== null && size > limit) return { reason: tooLargeMessage(classified.kind, limit) };
  const base64 = await file.base64();
  const bytes = base64ByteLength(base64);
  // The picker's `size` can be missing or stale — the encoded bytes are the truth.
  if (bytes > limit) return { reason: tooLargeMessage(classified.kind, limit) };
  // The picker copied the document into our cache; it's in memory now.
  try {
    file.delete();
  } catch {
    // A leftover cache copy is harmless.
  }
  return {
    attachment: {
      id: newAttachmentId(),
      kind: classified.kind,
      filename: asset.name,
      mediaType: classified.mediaType,
      url: dataUrl(classified.mediaType, base64),
      bytes,
    },
  };
}

/** File size in bytes, or null when the file can't be stat'ed (never a throw). */
function safeFileSize(uri: string): number | null {
  try {
    const size = new File(uri).size;
    return typeof size === "number" && Number.isFinite(size) ? size : null;
  } catch {
    return null;
  }
}
